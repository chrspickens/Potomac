import { createHash } from 'node:crypto';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const VISIBILITY = new Set(['public', 'gm', 'private']);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const canonical = value => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('invalid', 'non-finite value'); return JSON.stringify(value); }
  if (!value || typeof value !== 'object' || value instanceof Date || value instanceof Map || value instanceof Set) fail('invalid', 'unsupported value');
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => { if (['__proto__', 'prototype', 'constructor'].includes(key) || value[key] === undefined) fail('invalid', 'unsafe value'); return `${JSON.stringify(key)}:${canonical(value[key])}`; }).join(',')}}`;
};
const hash = value => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
const requireOwnedTransaction = db => {
  if (db.isTransaction) fail('invalid', 'reaction operation cannot be nested in another transaction');
  db.exec('BEGIN IMMEDIATE;');
};
const requireHostTransaction = db => {
  if (!db.isTransaction) fail('invalid', 'host reaction operation requires an active host transaction');
};

export const V2_REACTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS v2_reaction_windows (
 window_id TEXT PRIMARY KEY, parent_operation_id TEXT NOT NULL, campaign_id TEXT NOT NULL,
 resolver TEXT NOT NULL, lock TEXT NOT NULL, eligible TEXT NOT NULL, ordering TEXT NOT NULL,
 expires_at TEXT NOT NULL, continuation TEXT NOT NULL, visibility TEXT NOT NULL, status TEXT NOT NULL,
 resolved_by TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v2_reaction_submissions (
 operation_id TEXT PRIMARY KEY, window_id TEXT NOT NULL, campaign_id TEXT NOT NULL,
 principal_id TEXT NOT NULL, action_id TEXT NOT NULL, input TEXT NOT NULL,
  decision TEXT NOT NULL, sequence INTEGER NOT NULL, visibility TEXT NOT NULL, request_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v2_reaction_events (
 event_id TEXT PRIMARY KEY, window_id TEXT NOT NULL, campaign_id TEXT NOT NULL,
 kind TEXT NOT NULL, visibility TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
);`;

const validateWindow = window => {
  if (!window || !ID.test(window.windowId) || !ID.test(window.parentOperationId) || !ID.test(window.campaignId) || !window.resolver || !Array.isArray(window.eligible) || !['priorityThenSubmission', 'simultaneous'].includes(window.ordering) || !Number.isFinite(Date.parse(window.expiresAt)) || !VISIBILITY.has(window.visibility)) fail('invalid', 'malformed reaction window');
  if (new Set(window.eligible.map(item => item.principalId)).size !== window.eligible.length || window.eligible.some(item => !ID.test(item.principalId) || !Number.isInteger(item.priority) || !Array.isArray(item.actions) || item.actions.some(action => !ID.test(action.actionId) || !VISIBILITY.has(action.visibility)))) fail('invalid', 'invalid reaction eligibility');
  canonical(window.continuation); canonical(window.lock); canonical(window.resolver);
};

export function createV2ReactionKernel({ db, authenticate, authorizeResponder, authorizeGm, authorizeView, authorizeExpiry, validateLock, validateInput = () => undefined, complete, applyEffects, now = () => new Date().toISOString(), failureAt } = {}) {
  if (!db || typeof authenticate !== 'function' || typeof authorizeResponder !== 'function' || typeof authorizeGm !== 'function' || typeof authorizeView !== 'function' || typeof authorizeExpiry !== 'function' || typeof validateLock !== 'function' || typeof validateInput !== 'function' || typeof complete !== 'function' || typeof applyEffects !== 'function') throw new Error('invalid_reaction_kernel_configuration');
  db.exec(V2_REACTION_SCHEMA);
  const row = windowId => db.prepare('SELECT * FROM v2_reaction_windows WHERE window_id=?').get(windowId);
  const decode = value => ({ windowId: value.window_id, parentOperationId: value.parent_operation_id, campaignId: value.campaign_id, resolver: JSON.parse(value.resolver), lock: JSON.parse(value.lock), eligible: JSON.parse(value.eligible), ordering: value.ordering, expiresAt: value.expires_at, continuation: JSON.parse(value.continuation), visibility: value.visibility, status: value.status });
  const view = (windowId, principalId, authorityToken) => {
    const stored = row(windowId); if (!stored) return undefined; const window = decode(stored);
    validateLock(window.campaignId, window.lock, window.resolver);
    if (!authenticate(principalId, { windowId, campaignId: window.campaignId, authorityToken })) fail('unauthorized', 'unauthenticated projection request');
    const projection = authorizeView({ principalId, window, authorityToken }); if (!projection || !['public', 'responder', 'gm'].includes(projection.role)) fail('unauthorized', 'unauthorized reaction projection');
    const visible = new Set(projection.visiblePrincipalIds || (projection.role === 'gm' ? window.eligible.map(item => item.principalId) : projection.role === 'responder' ? [principalId] : window.visibility === 'public' ? window.eligible.map(item => item.principalId) : []));
    const submissions = db.prepare('SELECT principal_id, action_id, decision, visibility FROM v2_reaction_submissions WHERE window_id=? ORDER BY sequence').all(windowId).filter(item => visible.has(item.principal_id) && (projection.role !== 'public' || item.visibility === 'public')).map(item => ({ principalId: item.principal_id, actionId: projection.role === 'gm' || item.visibility === 'public' ? item.action_id : 'hidden', decision: item.decision }));
    const availableActions = window.eligible.filter(item => visible.has(item.principalId)).flatMap(item => item.actions.filter(action => projection.role === 'gm' || item.principalId === principalId && action.visibility !== 'private' || projection.role === 'public' && action.visibility === 'public').map(action => ({ actionId: action.actionId, inputSchema: action.inputSchema, visibility: action.visibility })));
    return { windowId, parentOperationId: window.parentOperationId, campaignId: window.campaignId, status: stored.status, expiresAt: window.expiresAt, permissions: { submit: projection.role === 'responder', expire: projection.role === 'gm', adjudicate: projection.role === 'gm' }, eligiblePrincipalIds: [...visible], availableActions, submissions };
  };
  const order = submissions => [...submissions].sort((a, b) => b.priority - a.priority || a.sequence - b.sequence || a.principalId.localeCompare(b.principalId));
  const transition = (window, status, actor, decision, submissionRows = []) => {
    const ordered = order(submissionRows); const result = complete({ window, status, actor, decisions: ordered.map(item => ({ principalId: item.principalId, actionId: item.actionId, input: item.input, decision: item.decision })) });
    if (result?.effects) applyEffects(result.effects, { window: structuredClone(window) });
    const eventId = `${window.windowId}:${status}:${actor}`; const publicPayload = window.visibility === 'public' ? { windowId: window.windowId, status } : { windowId: window.windowId, status: 'updated' };
    db.prepare('INSERT INTO v2_reaction_events(event_id,window_id,campaign_id,kind,visibility,payload,created_at) VALUES(?,?,?,?,?,?,?)').run(eventId, window.windowId, window.campaignId, `reaction.${status}`, window.visibility, JSON.stringify(publicPayload), now());
    db.prepare('UPDATE v2_reaction_windows SET status=?, resolved_by=?, updated_at=? WHERE window_id=? AND status=\'pending\'').run(status, actor, now(), window.windowId);
    if (failureAt === 'after-transition') fail('injected', 'failure after reaction transition');
    return { windowId: window.windowId, status, eventId, hidden: window.visibility !== 'public' };
  };
  const openWork = (window, principalId, authorityToken, project = true) => { validateWindow(window); validateLock(window.campaignId, window.lock, window.resolver); if (!authenticate(principalId, { campaignId: window.campaignId, authorityToken }) || !authorizeGm({ principalId, campaignId: window.campaignId, window, authorityToken })) fail('unauthorized', 'unauthorized reaction creation'); db.prepare('INSERT INTO v2_reaction_windows VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(window.windowId, window.parentOperationId, window.campaignId, JSON.stringify(window.resolver), JSON.stringify(window.lock), JSON.stringify(window.eligible), window.ordering, window.expiresAt, JSON.stringify(window.continuation), window.visibility, 'pending', null, now()); if (failureAt === 'after-open') fail('injected', 'failure after reaction open'); return project ? view(window.windowId, principalId, authorityToken) : { windowId: window.windowId, status: 'pending' }; };
  const submitWork = (submission, authorityToken) => {
    if (!submission || !ID.test(submission.operationId) || !ID.test(submission.windowId) || !ID.test(submission.principalId) || !ID.test(submission.actionId) || !['accept', 'decline'].includes(submission.decision)) fail('invalid', 'malformed reaction submission');
    if (submission.campaignId === undefined && !authenticate(submission.principalId, { ...submission, authorityToken })) fail('unauthorized', 'unauthenticated responder');
    {
      const stored = row(submission.windowId); if (!stored) fail('missing', 'reaction window unavailable'); const window = decode(stored);
      if (!authenticate(submission.principalId, { ...submission, campaignId: window.campaignId, authorityToken })) fail('unauthorized', 'unauthenticated responder');
      validateLock(window.campaignId, window.lock, window.resolver);
      if (stored.status !== 'pending') { const prior = db.prepare('SELECT request_hash FROM v2_reaction_submissions WHERE operation_id=?').get(submission.operationId); if (prior) { if (prior.request_hash !== hash(submission)) fail('idempotency_conflict', 'operation ID is bound to another submission'); return view(submission.windowId, submission.principalId, authorityToken); } fail('conflict', 'reaction window is terminal'); }
      if (Date.parse(window.expiresAt) <= Date.parse(now())) { transition(window, 'expired', 'clock', { decision: 'decline' }); return view(submission.windowId, submission.principalId, authorityToken); }
      const eligible = window.eligible.find(item => item.principalId === submission.principalId); const action = eligible?.actions.find(item => item.actionId === submission.actionId); if (!eligible || !action || !authorizeResponder({ principalId: submission.principalId, window, action, authorityToken })) fail('unauthorized', 'responder or action is not eligible'); validateInput(submission.input, action.inputSchema);
      const existing = db.prepare('SELECT request_hash, window_id, principal_id FROM v2_reaction_submissions WHERE operation_id=?').get(submission.operationId); const payloadHash = hash(submission); if (existing) { if (existing.request_hash !== payloadHash || existing.window_id !== submission.windowId || existing.principal_id !== submission.principalId) fail('idempotency_conflict', 'operation ID is bound to another submission'); return view(submission.windowId, submission.principalId, authorityToken); }
      if (db.prepare('SELECT operation_id FROM v2_reaction_submissions WHERE window_id=? AND principal_id=?').get(submission.windowId, submission.principalId)) fail('conflict', 'responder already decided for this window');
      const sequence = db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM v2_reaction_submissions WHERE window_id=?').get(submission.windowId).next;
      db.prepare('INSERT INTO v2_reaction_submissions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(submission.operationId, submission.windowId, window.campaignId, submission.principalId, submission.actionId, JSON.stringify(submission.input), submission.decision, sequence, action.visibility, payloadHash, now());
      const submissions = db.prepare('SELECT principal_id AS principalId, action_id AS actionId, input, decision, sequence FROM v2_reaction_submissions WHERE window_id=? ORDER BY sequence').all(submission.windowId).map(item => ({ ...item, priority: window.eligible.find(candidate => candidate.principalId === item.principalId).priority, input: JSON.parse(item.input) }));
      const ready = window.ordering === 'priorityThenSubmission' || submissions.length === window.eligible.length;
      const allDeclined = submissions.length === window.eligible.length && submissions.every(item => item.decision === 'decline');
      const result = ready ? transition(window, allDeclined ? 'declined' : 'resolved', submission.principalId, submission, submissions) : { windowId: window.windowId, status: 'pending' };
      if (failureAt === 'after-submission') fail('injected', 'failure after submission'); return result;
    }
  };
  const expireWork = (windowId, principalId, authorityToken) => {
    const stored = row(windowId); if (!stored) fail('missing', 'reaction window unavailable'); const window = decode(stored); if (!authenticate(principalId, { windowId, campaignId: window.campaignId, authorityToken }) || !authorizeExpiry({ principalId, window, authorityToken })) fail('unauthorized', 'unauthorized reaction expiry');
    const current = row(windowId); const currentWindow = decode(current); if (current.status !== 'pending') return view(windowId, principalId); if (Date.parse(currentWindow.expiresAt) > Date.parse(now())) fail('conflict', 'reaction window has not expired'); return transition(currentWindow, 'expired', principalId, { decision: 'decline' });
  };
  const adjudicateWork = (windowId, principalId, decision = 'accept', authorityToken) => {
    const stored = row(windowId); if (!stored) fail('conflict', 'reaction window is not pending'); const window = decode(stored);
    if (!authenticate(principalId, { windowId, campaignId: window.campaignId, authorityToken }) || !authorizeGm({ principalId, windowId, campaignId: window.campaignId, window, authorityToken })) fail('unauthorized', 'unauthorized GM adjudication');
    if (stored.status !== 'pending') fail('conflict', 'reaction window is not pending'); return transition(window, decision === 'decline' ? 'declined' : 'resolved', principalId, { decision });
  };
  const standalone = work => { requireOwnedTransaction(db); try { const result = work(); db.exec('COMMIT;'); return result; } catch (error) { try { db.exec('ROLLBACK;'); } catch {} throw error; } };
  const inHostTransaction = work => { requireHostTransaction(db); return work(); };
  // Host-adapter-only composition API. Methods accept domain values only: no DB handle or transaction callback crosses into module code.
  const open = (window, principalId, authorityToken) => standalone(() => openWork(window, principalId, authorityToken));
  const submit = (submission, authorityToken) => standalone(() => submitWork(submission, authorityToken));
  const expire = (windowId, principalId, authorityToken) => standalone(() => expireWork(windowId, principalId, authorityToken));
  const adjudicate = (windowId, principalId, decision = 'accept', authorityToken) => standalone(() => adjudicateWork(windowId, principalId, decision, authorityToken));
  const openInTransaction = (window, principalId, authorityToken) => inHostTransaction(() => openWork(window, principalId, authorityToken, false));
  const submitInTransaction = (submission, authorityToken) => inHostTransaction(() => submitWork(submission, authorityToken));
  const expireInTransaction = (windowId, principalId, authorityToken) => inHostTransaction(() => expireWork(windowId, principalId, authorityToken));
  const adjudicateInTransaction = (windowId, principalId, decision = 'accept', authorityToken) => inHostTransaction(() => adjudicateWork(windowId, principalId, decision, authorityToken));
  return { open, submit, expire, adjudicate, view, openInTransaction, submitInTransaction, expireInTransaction, adjudicateInTransaction };
}
