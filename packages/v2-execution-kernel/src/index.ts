import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type Entity = { id: string; type: string; revision: number; data: Record<string, JsonValue> };
export type Visibility = 'public' | 'gm' | { principals: string[] };
export type EffectProposal = {
  effectId: string; operationId: string; principalId: string;
  target: { entityId: string; expectedRevision: number };
  handler: 'entity.patch' | 'resource.delta'; path: string;
  value?: JsonValue; delta?: number; visibility: Visibility;
};
export type ReactionContinuation = {
  windowId: string; operationId: string; state: JsonValue;
  eligibleResponders: string[]; permittedActions: Record<string, string[]>;
  expiresAt: number; ordering: 'submission'; status: 'pending' | 'resolved' | 'declined' | 'expired';
};
export type ReactionSubmission = {
  windowId: string; operationId: string; responderId: string; actionId: string;
  submittedAt: number; input: JsonValue;
};
export type ReactionResolution = { effects: EffectProposal[]; terminal: 'resolved' | 'declined' } | null;
export type FailurePoint = 'afterReactionSubmission' | 'afterEffects' | 'afterOperationReceipt' | 'afterWindowTransition' | 'afterEvent';

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, type TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operations (operation_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, status TEXT NOT NULL, response TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS continuations (
  window_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL,
  eligible TEXT NOT NULL, permitted_actions TEXT NOT NULL, expires_at INTEGER NOT NULL,
  ordering TEXT NOT NULL CHECK(ordering = 'submission'), status TEXT NOT NULL CHECK(status IN ('pending','resolved','declined','expired'))
);
CREATE TABLE IF NOT EXISTS reaction_submissions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, window_id TEXT NOT NULL REFERENCES continuations(window_id),
  operation_id TEXT NOT NULL, responder_id TEXT NOT NULL, action_id TEXT NOT NULL,
  submitted_at INTEGER NOT NULL, input TEXT NOT NULL, UNIQUE(window_id, responder_id, operation_id)
);
CREATE TABLE IF NOT EXISTS events (event_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
`;

function assertJson(value: unknown, path = '$'): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (Number.isFinite(value)) return; throw new Error(`${path}: non-finite number`); }
  if (Array.isArray(value)) { value.forEach((item, index) => assertJson(item, `${path}[${index}]`)); return; }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error(`${path}: unsafe key`);
      assertJson(item, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`${path}: not JSON`);
}

function clone<T extends JsonValue>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
function hash(value: unknown): string { return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`; }

function parseEntity(row: Record<string, unknown>): Entity {
  const data = JSON.parse(String(row.data)); assertJson(data, 'entity.data');
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('entity.data must be an object');
  return { id: String(row.id), type: String(row.type), revision: Number(row.revision), data: data as Record<string, JsonValue> };
}

export type KernelOptions = {
  authorizeEffect?: (effect: EffectProposal, entity: Entity) => boolean;
  validateEffect?: (effect: EffectProposal, entity: Entity, next: Record<string, JsonValue>) => void;
  now?: () => number;
  failAt?: (point: FailurePoint) => void;
};

export class V2ExecutionKernel {
  readonly db: DatabaseSync;
  private readonly authorizeEffect: (effect: EffectProposal, entity: Entity) => boolean;
  private readonly validateEffect: (effect: EffectProposal, entity: Entity, next: Record<string, JsonValue>) => void;
  private readonly now: () => number;
  private readonly failAt?: (point: FailurePoint) => void;

  constructor(database: DatabaseSync, options: KernelOptions = {}) {
    this.db = database; this.authorizeEffect = options.authorizeEffect || (() => true);
    this.validateEffect = options.validateEffect || (() => undefined); this.now = options.now || (() => Date.now()); this.failAt = options.failAt;
    this.db.exec(schema);
  }

  putEntity(entity: Entity): void { assertJson(entity.data, 'entity.data'); this.db.prepare('INSERT INTO entities(id,type,revision,data) VALUES(?,?,?,?)').run(entity.id, entity.type, entity.revision, JSON.stringify(entity.data)); }
  getEntity(id: string): Entity {
    const row = this.db.prepare('SELECT id,type,revision,data FROM entities WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`unknown entity: ${id}`); return parseEntity(row);
  }
  getEvents(operationId: string): Array<Record<string, unknown>> { return this.db.prepare('SELECT * FROM events WHERE operation_id=? ORDER BY event_id').all(operationId) as Array<Record<string, unknown>>; }
  getSubmissions(windowId: string): Array<Record<string, unknown>> { return this.db.prepare('SELECT * FROM reaction_submissions WHERE window_id=? ORDER BY sequence').all(windowId) as Array<Record<string, unknown>>; }

  applyEffects(effects: EffectProposal[]): { operationId: string; appliedEffectIds: string[]; payloadHash: string } {
    if (!effects.length) throw new Error('no effects');
    const operationId = effects[0].operationId; const ordered = this.prepareEffects(effects); const payloadHash = hash({ kind: 'effects', effects: ordered });
    const existing = this.existingOperation(operationId, payloadHash); if (existing) return JSON.parse(existing.response) as { operationId: string; appliedEffectIds: string[]; payloadHash: string };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const appliedEffectIds = this.applyEffectsInTransaction(ordered);
      this.recordOperation(operationId, payloadHash, 'applied', { operationId, appliedEffectIds, payloadHash });
      this.recordEvent(operationId, 'effects.applied', { effectIds: appliedEffectIds });
      this.db.exec('COMMIT'); return { operationId, appliedEffectIds, payloadHash };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private prepareEffects(effects: EffectProposal[]): EffectProposal[] {
    const ids = new Set(effects.map(effect => effect.operationId)); if (ids.size !== 1) throw new Error('effects must share one operation');
    for (const effect of effects) { assertJson(effect, 'effect'); if (!effect.effectId || !effect.target.entityId || !Number.isSafeInteger(effect.target.expectedRevision) || effect.target.expectedRevision < 0) throw new Error('invalid effect identity or revision'); }
    return [...effects].sort((a, b) => a.effectId.localeCompare(b.effectId) || a.target.entityId.localeCompare(b.target.entityId));
  }

  private existingOperation(operationId: string, payloadHash: string): { response: string } | undefined {
    const existing = this.db.prepare('SELECT payload_hash,response FROM operations WHERE operation_id=?').get(operationId) as { payload_hash: string; response: string } | undefined;
    if (!existing) return undefined; if (existing.payload_hash !== payloadHash) throw new Error('operation ID reuse with different payload'); return existing;
  }

  private applyEffectsInTransaction(ordered: EffectProposal[]): string[] {
    const seen = new Set<string>(); const working = new Map<string, Entity>();
    for (const effect of ordered) {
      const conflictKey = `${effect.target.entityId}:${effect.path}`; if (seen.has(conflictKey)) throw new Error('conflicting effects'); seen.add(conflictKey);
      const entity = working.get(effect.target.entityId) || this.getEntity(effect.target.entityId);
      if (entity.revision !== effect.target.expectedRevision) throw new Error('stale revision');
      if (!this.authorizeEffect(effect, entity)) throw new Error('effect unauthorized');
      const next = clone(entity.data); this.applyEffect(next, effect); this.validateEffect(effect, entity, next);
      working.set(entity.id, { ...entity, data: next });
    }
    for (const entity of working.values()) {
      const result = this.db.prepare('UPDATE entities SET revision=?,data=? WHERE id=? AND revision=?').run(entity.revision + 1, JSON.stringify(entity.data), entity.id, entity.revision);
      if (result.changes !== 1) throw new Error('concurrent revision conflict');
    }
    this.failAt?.('afterEffects'); return ordered.map(effect => effect.effectId);
  }

  private applyEffect(data: Record<string, JsonValue>, effect: EffectProposal): void {
    const parts = effect.path.split('.'); if (parts.some(part => !part || part === '__proto__' || part === 'constructor' || part === 'prototype')) throw new Error('invalid effect path');
    const key = parts.pop()!; let parent = data;
    for (const part of parts) { const current = parent[part]; if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error('effect path missing'); parent = current as Record<string, JsonValue>; }
    if (!['entity.patch', 'resource.delta'].includes(effect.handler)) throw new Error('unsupported effect handler');
    if (effect.handler === 'entity.patch') { if (!('value' in effect)) throw new Error('patch value missing'); assertJson(effect.value, 'effect.value'); parent[key] = clone(effect.value!); return; }
    if (typeof effect.delta !== 'number' || !Number.isFinite(effect.delta) || typeof parent[key] !== 'number' || !Number.isFinite(parent[key])) throw new Error('invalid resource delta');
    const result = (parent[key] as number) + effect.delta; if (!Number.isFinite(result)) throw new Error('non-finite resource result'); parent[key] = result;
  }

  private recordOperation(operationId: string, payloadHash: string, status: string, response: JsonValue): void { this.db.prepare('INSERT INTO operations(operation_id,payload_hash,status,response) VALUES(?,?,?,?)').run(operationId, payloadHash, status, JSON.stringify(response)); this.failAt?.('afterOperationReceipt'); }
  private recordEvent(operationId: string, kind: string, payload: JsonValue): void { assertJson(payload, 'event.payload'); this.db.prepare('INSERT INTO events(event_id,operation_id,kind,payload,created_at) VALUES(?,?,?,?,?)').run(`${operationId}:${kind}`, operationId, kind, JSON.stringify(payload), this.now()); this.failAt?.('afterEvent'); }

  saveContinuation(continuation: ReactionContinuation): void {
    assertJson(continuation.state, 'continuation.state'); if (!continuation.windowId || !continuation.operationId || !Number.isSafeInteger(continuation.expiresAt) || continuation.eligibleResponders.some(id => !id)) throw new Error('invalid continuation');
    for (const responder of continuation.eligibleResponders) if (!Array.isArray(continuation.permittedActions[responder]) || !continuation.permittedActions[responder].length) throw new Error('missing permitted reaction actions');
    this.db.prepare('INSERT INTO continuations(window_id,operation_id,state,eligible,permitted_actions,expires_at,ordering,status) VALUES(?,?,?,?,?,?,?,?)').run(continuation.windowId, continuation.operationId, JSON.stringify(continuation.state), JSON.stringify(continuation.eligibleResponders), JSON.stringify(continuation.permittedActions), continuation.expiresAt, continuation.ordering, continuation.status);
  }
  getContinuation(windowId: string): ReactionContinuation {
    const row = this.db.prepare('SELECT * FROM continuations WHERE window_id=?').get(windowId) as Record<string, unknown> | undefined; if (!row) throw new Error('unknown reaction window');
    const state = JSON.parse(String(row.state)); const eligibleResponders = JSON.parse(String(row.eligible)); const permittedActions = JSON.parse(String(row.permitted_actions)); assertJson(state, 'continuation.state');
    return { windowId: String(row.window_id), operationId: String(row.operation_id), state, eligibleResponders, permittedActions, expiresAt: Number(row.expires_at), ordering: 'submission', status: String(row.status) as ReactionContinuation['status'] };
  }

  submitReaction(submission: ReactionSubmission, resolve: (continuation: ReactionContinuation, submission: ReactionSubmission) => ReactionResolution): { status: 'pending' | 'resolved' | 'declined' | 'duplicate' | 'expired' } {
    assertJson(submission.input, 'reaction.input'); if (!Number.isSafeInteger(submission.submittedAt)) throw new Error('invalid submission time');
    const payloadHash = hash({ kind: 'reaction', windowId: submission.windowId, responderId: submission.responderId, actionId: submission.actionId, input: submission.input });
    const existing = this.existingOperation(submission.operationId, payloadHash); if (existing) return JSON.parse(existing.response) as { status: 'pending' | 'resolved' | 'declined' | 'duplicate' | 'expired' };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const continuation = this.getContinuation(submission.windowId);
      if (continuation.status !== 'pending') { const response = { status: continuation.status === 'expired' ? 'expired' : continuation.status } as { status: 'resolved' | 'declined' | 'expired' }; this.recordOperation(submission.operationId, payloadHash, response.status, response); this.recordEvent(submission.operationId, 'reaction.terminal.retry', response); this.db.exec('COMMIT'); return response; }
      if (!continuation.eligibleResponders.includes(submission.responderId)) throw new Error('responder unauthorized');
      if (!continuation.permittedActions[submission.responderId]?.includes(submission.actionId)) throw new Error('reaction action unauthorized');
      if (this.now() >= continuation.expiresAt) {
        this.db.prepare('UPDATE continuations SET status=? WHERE window_id=? AND status=?').run('expired', submission.windowId, 'pending');
        const response = { status: 'expired' as const }; this.recordOperation(submission.operationId, payloadHash, 'expired', response); this.recordEvent(submission.operationId, 'reaction.expired', response); this.db.exec('COMMIT'); return response;
      }
      this.db.prepare('INSERT INTO reaction_submissions(window_id,operation_id,responder_id,action_id,submitted_at,input) VALUES(?,?,?,?,?,?)').run(submission.windowId, submission.operationId, submission.responderId, submission.actionId, submission.submittedAt, JSON.stringify(submission.input)); this.failAt?.('afterReactionSubmission');
      const resolution = resolve(continuation, submission);
      if (resolution === null) { const response = { status: 'pending' as const }; this.recordOperation(submission.operationId, payloadHash, 'pending', response); this.recordEvent(submission.operationId, 'reaction.submitted', { windowId: submission.windowId }); this.db.exec('COMMIT'); return response; }
      const appliedEffectIds = resolution.terminal === 'declined' ? [] : this.applyEffectsInTransaction(this.prepareEffects(resolution.effects));
      const response = { status: resolution.terminal, appliedEffectIds, payloadHash } as const;
      this.recordOperation(submission.operationId, payloadHash, resolution.terminal, response); this.db.prepare('UPDATE continuations SET status=? WHERE window_id=? AND status=?').run(resolution.terminal, submission.windowId, 'pending'); this.failAt?.('afterWindowTransition');
      this.recordEvent(submission.operationId, resolution.terminal === 'declined' ? 'reaction.declined' : 'reaction.resolved', { windowId: submission.windowId, appliedEffectIds }); this.db.exec('COMMIT'); return response;
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch { /* preserve original failure */ } throw error; }
  }
}

export function openKernel(databasePath: string, options?: KernelOptions): V2ExecutionKernel { return new V2ExecutionKernel(new DatabaseSync(databasePath), options); }
