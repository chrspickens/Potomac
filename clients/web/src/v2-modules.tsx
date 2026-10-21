import { useEffect, useMemo, useRef, useState } from 'react';
import type { CapabilityLock, JsonValue, UiContribution, UiDescriptorCatalog, UiEntityProjection } from '@potomac/contracts';
import { UiContributionRegistry } from './workspace/v2-ui-registry.ts';
import { commandResultFeedback, V2UiContributionView } from './workspace/v2-ui-renderer.tsx';
import { V2EntitySchemaForm } from './workspace/v2-entity-schema-form.tsx';
import type { EntityJsonSchema } from './workspace/v2-entity-schema.ts';
import { V2GuidedPreparationForm, type V2PreparationMember, type V2PreparationProfile } from './workspace/v2-guided-preparation-form.tsx';
import './v2-combat.css';
import './v2-modules.css';

type CatalogModule = { id: string; name: string; version: string; digest: string; capabilities: CapabilityLock['entries']; entities: Array<UiDescriptorCatalog['entities'][number] & { creationRoles: string[]; visibility: Array<'public' | 'gm' | 'owner'>; ownership: { kind: 'campaign' | 'principal' } }>; commands: Array<UiDescriptorCatalog['commands'][number] & { permission: { roles: string[] } }>; workflows: UiDescriptorCatalog['workflows']; contributions: UiContribution[]; preparation: V2PreparationProfile[] };
type LockView = { lock: CapabilityLock; digest: string };
type Entity = UiEntityProjection & { revision: number; ownerPrincipalId?: string | null };
function entityLabel(item: Entity, index: number): string {
  const data = item.data && typeof item.data === 'object' && !Array.isArray(item.data) ? item.data as Record<string, JsonValue> : {};
  const named = [data.title, data.name, data.label].find(value => typeof value === 'string' && value.trim());
  return typeof named === 'string' ? named : `${item.typeId.split('.').at(-1)?.replaceAll('-', ' ') ?? 'Entity'} ${index + 1}`;
}
function actionLabel(actionId: string): string {
  const words = actionId.split('.').at(-1)?.replaceAll('-', ' ') ?? 'module action';
  return words.replace(/^./, character => character.toUpperCase());
}
type EnrolledPlayer = V2PreparationMember & { credential?: string };
type CreationRequest = { data: JsonValue; ownerPrincipalId?: string; visibility: 'public' | 'gm' | 'owner' };
type PreparationRecovery = { key: string; entityTypeId: string; entityId?: string; assignedMemberIds: string[]; grantedMemberIds: string[] };
type ReactionProjection = { windowId: string; parentOperationId: string; status: string; expiresAt: string; permissions: { submit: boolean; expire: boolean; adjudicate: boolean }; availableActions: Array<{ actionId: string; inputSchema: JsonValue }> };
type CurrentSession = { status: 'none' | 'live' | 'finished'; revision: number; encounter?: { entityId: string; revision: number; title?: string } };
const apiEndpoint = (path: string) => `${(import.meta.env.VITE_POTOMAC_HOST || '').replace(/\/$/, '')}${path}`;
const preparationRecoveryStorageKey = 'potomac.v2.generic.preparation-recovery';
const readPreparationRecovery = (): PreparationRecovery | undefined => {
  try {
    const value = sessionStorage.getItem(preparationRecoveryStorageKey);
    if (!value) return undefined;
    const parsed = JSON.parse(value) as PreparationRecovery;
    return typeof parsed.key === 'string' && typeof parsed.entityTypeId === 'string' && Array.isArray(parsed.assignedMemberIds) && Array.isArray(parsed.grantedMemberIds) ? parsed : undefined;
  } catch { return undefined; }
};

const operationId = (key: string) => {
  const storageKey = `potomac.v2.generic.operation.${key}`;
  const previous = sessionStorage.getItem(storageKey);
  if (previous) return previous;
  const id = `generic-${crypto.randomUUID()}`;
  sessionStorage.setItem(storageKey, id);
  return id;
};
const stableEntityId = (key: string) => {
  const storageKey = `potomac.v2.generic.entity.${key}`;
  const previous = sessionStorage.getItem(storageKey);
  if (previous) return previous;
  const id = `scene-${crypto.randomUUID()}`;
  sessionStorage.setItem(storageKey, id);
  return id;
};

function EntityCreationPanel({ moduleId, descriptor, preparation, players, busy, onCreate }: {
  moduleId: string; descriptor: CatalogModule['entities'][number]; preparation?: V2PreparationProfile; players: EnrolledPlayer[]; busy: boolean; onCreate: (request: CreationRequest, assignedMembers?: string[]) => Promise<void>;
}) {
  const [ownerPrincipalId, setOwnerPrincipalId] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'gm' | 'owner'>(descriptor.ownership.kind === 'principal' ? 'owner' : descriptor.visibility[0]);
  const [ownerError, setOwnerError] = useState('');
  const principalOwned = descriptor.ownership.kind === 'principal';
  const formId = `${moduleId}-${descriptor.typeId}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  return <section className="v2-setup-card v2-entity-create-panel" aria-label={preparation?.title ?? `Create ${descriptor.typeId}`}>
    {!preparation && <h3>Create {descriptor.typeId}</h3>}
    {principalOwned ? <label htmlFor={`${formId}-owner`}>Entity owner<select id={`${formId}-owner`} value={ownerPrincipalId} disabled={busy} onChange={event => { setOwnerPrincipalId(event.target.value); setOwnerError(''); }}><option value="">Choose an enrolled player</option>{players.map(player => <option key={player.memberId} value={player.memberId}>{player.displayName}</option>)}</select></label>
      : <label htmlFor={`${formId}-visibility`}>Entity visibility<select id={`${formId}-visibility`} value={visibility} disabled={busy} onChange={event => setVisibility(event.target.value as CreationRequest['visibility'])}>{descriptor.visibility.filter(value => value !== 'owner').map(value => <option key={value} value={value}>{value === 'gm' ? 'GM only' : 'Campaign visible'}</option>)}</select></label>}
    {ownerError && <p role="alert">{ownerError}</p>}
    {preparation ? <V2GuidedPreparationForm profile={preparation} schema={descriptor.schema as unknown as EntityJsonSchema} members={players} formId={formId} disabled={busy} submitLabel="Prepare encounter and assign players" onSubmit={(data, assignedMembers) => onCreate({ data, visibility: descriptor.visibility[0] }, assignedMembers)} /> : <V2EntitySchemaForm schema={descriptor.schema as unknown as EntityJsonSchema} formId={formId} disabled={busy || principalOwned && !ownerPrincipalId} submitLabel={`Create ${descriptor.typeId}`} onSubmit={async data => {
      if (principalOwned && !ownerPrincipalId) { setOwnerError('Choose an enrolled player to own this entity.'); return; }
      await onCreate({ data, ...(principalOwned ? { ownerPrincipalId } : {}), visibility: principalOwned ? 'owner' : visibility });
    }} />}
  </section>;
}

export function V2ModulesApp({ initialCredential, initialModuleId, initialEntityId, onExit, onOpenInTable }: { initialCredential?: string; initialModuleId?: string; initialEntityId?: string; onExit?: () => void; onOpenInTable?: (entityId: string) => void }) {
  const [credential, setCredential] = useState(initialCredential ?? ''); const [connected, setConnected] = useState(false); const [isGm, setIsGm] = useState(false); const [principalId, setPrincipalId] = useState(''); const autoConnected = useRef(false);
  const [modules, setModules] = useState<CatalogModule[]>([]); const [selectedId, setSelectedId] = useState(''); const [lock, setLock] = useState<LockView>();
  const [entities, setEntities] = useState<Entity[]>([]); const [selectedEntityId, setSelectedEntityId] = useState(initialEntityId ?? ''); const [allowedCommandIds, setAllowedCommandIds] = useState<string[]>([]); const [commandsLoading, setCommandsLoading] = useState(false);
  const [reactions, setReactions] = useState<ReactionProjection[]>([]);
  const [currentSession, setCurrentSession] = useState<CurrentSession>();
  const [players, setPlayers] = useState<EnrolledPlayer[]>([]); const [grantMemberId, setGrantMemberId] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [preparationRecovery, setPreparationRecovery] = useState<PreparationRecovery | undefined>(() => readPreparationRecovery());
  const selected = lock ? modules.find(module => module.id === lock.lock.rootModule.id && module.version === lock.lock.rootModule.version && module.digest === lock.lock.rootModule.digest) : modules.find(module => module.id === selectedId);
  const entity = entities.find(item => item.entityId === selectedEntityId);
  const uiCatalog = useMemo<UiDescriptorCatalog>(() => selected ? ({ entities: selected.entities, commands: selected.commands, workflows: selected.workflows }) : ({ entities: [], commands: [], workflows: [] }), [selected]);
  const uiRegistry = useMemo(() => {
    if (!selected || !lock) return undefined;
    try { const registry = new UiContributionRegistry(lock.lock, lock.lock.campaignId, uiCatalog); for (const contribution of selected.contributions) registry.register(contribution); return registry; }
    catch (error) { setMessage(error instanceof Error ? `Module UI rejected: ${error.message}` : 'Module UI rejected.'); return undefined; }
  }, [selected, lock, uiCatalog]);
  const request = async (url: string, init: RequestInit = {}, withLock = true, exactDigest = lock?.digest, activeCredential = credential) => {
    const response = await fetch(apiEndpoint(url), { ...init, headers: { authorization: `Bearer ${activeCredential}`, ...(withLock && exactDigest ? { 'x-v2-lock-digest': exactDigest } : {}), ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) } });
    const body = await response.json(); if (!response.ok) throw Object.assign(new Error(String(body.error ?? body.message ?? `Request failed (${response.status})`)), { status: response.status, code: body.error }); return body;
  };
  const refresh = async (current = lock, currentModules = modules, activeCredential = credential) => {
    if (!current) { setEntities([]); setSelectedEntityId(''); setReactions([]); setCurrentSession(undefined); return; }
    const module = currentModules.find(item => item.id === current.lock.rootModule.id);
    const [responses, reactionRows, sessionProjection] = await Promise.all([
      module?.entities.length ? Promise.all(module.entities.map(descriptor => request(`/api/v2/entities?typeId=${encodeURIComponent(descriptor.typeId)}`, {}, true, current.digest, activeCredential))) : Promise.resolve([]),
      request('/api/v2/reactions', {}, true, current.digest, activeCredential),
      request('/api/v2/session/current', {}, false, current.digest, activeCredential)
    ]);
    const records = responses.flatMap(rows => rows.entities ?? rows) as Entity[];
    setEntities(records); setSelectedEntityId(value => records.some(row => row.entityId === initialEntityId) ? initialEntityId! : records.some(row => row.entityId === value) ? value : records[0]?.entityId ?? ''); setReactions((reactionRows.reactions ?? reactionRows) as ReactionProjection[]); setCurrentSession(sessionProjection as CurrentSession);
  };
  const connectCredential = async (activeCredential: string) => {
    setCredential(activeCredential); setBusy(true);
    try {
      const session = await fetch(apiEndpoint('/api/v2/session'), { headers: { authorization: `Bearer ${activeCredential}` } }); if (!session.ok) throw new Error(session.status === 403 ? 'Permission denied for this campaign.' : 'Authentication failed');
      const identity = await session.json(); setPrincipalId(identity.principalId); setIsGm(identity.role === 'gm');
      const catalogResponse = await fetch(apiEndpoint('/api/v2/modules'), { headers: { authorization: `Bearer ${activeCredential}` } }); if (!catalogResponse.ok) throw new Error(catalogResponse.status === 404 ? 'Experimental V2 host API is disabled.' : catalogResponse.status === 403 ? 'Permission denied while reading the trusted catalog.' : 'Trusted module catalog is unavailable.');
      const catalogBody = await catalogResponse.json(); setModules(catalogBody.modules); setSelectedId(current => current || catalogBody.modules.find((item: CatalogModule) => item.id === initialModuleId)?.id || catalogBody.modules[0]?.id || '');
      if (identity.role === 'gm') { const roster = await fetch(apiEndpoint('/api/v2/members'), { headers: { authorization: `Bearer ${activeCredential}` } }); if (!roster.ok) throw new Error(roster.status === 403 ? 'Permission denied while reading enrolled players.' : 'Enrolled player list is unavailable.'); setPlayers((await roster.json()).members); }
      const current = await fetch(apiEndpoint('/api/v2/campaign/lock'), { headers: { authorization: `Bearer ${activeCredential}` } });
      if (current.ok) { const pinned = await current.json(); setLock(pinned); setConnected(true); await refresh(pinned, catalogBody.modules, activeCredential); setMessage('Authenticated; the campaign lock is unchanged.'); }
      else if (current.status === 404) { setLock(undefined); setConnected(true); setMessage(identity.role === 'gm' ? 'Select and pin an approved module to this fresh campaign.' : 'Waiting for the GM to pin a trusted module.'); }
      else throw new Error(current.status === 409 || current.status === 422 ? 'The pinned campaign lock is unsupported or its exact trusted module is unavailable. It will not be replaced.' : 'Could not read the campaign module lock.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Connection failed.'); }
    finally { setBusy(false); }
  };
  const connect = (event: React.FormEvent) => { event.preventDefault(); void connectCredential(credential); };
  useEffect(() => { if (!initialCredential || autoConnected.current) return; autoConnected.current = true; void connectCredential(initialCredential); }, [initialCredential]);
  useEffect(() => {
    if (!connected || !lock) return;
    let cancelled = false;
    const refreshSession = async () => { try { const projection = await request('/api/v2/session/current', {}, false) as CurrentSession; if (!cancelled) setCurrentSession(projection); } catch { if (!cancelled) setCurrentSession(undefined); } };
    void refreshSession(); const timer = window.setInterval(() => void refreshSession(), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [connected, lock?.digest, principalId]);
  const pin = async () => { setBusy(true); try { const body = await request('/api/v2/campaign/lock', { method: 'PUT', body: JSON.stringify({ moduleId: selectedId }) }, false); setLock(body); await refresh(body); setMessage(`${selected?.name ?? selectedId} pinned at its exact validated digest.`); } catch (error) { setMessage(error instanceof Error ? error.message : 'Pin failed.'); } finally { setBusy(false); } };
  const savePreparationRecovery = (value: PreparationRecovery) => { sessionStorage.setItem(preparationRecoveryStorageKey, JSON.stringify(value)); setPreparationRecovery(value); };
  const clearPreparationRecovery = (key: string) => {
    if (readPreparationRecovery()?.key !== key) return;
    sessionStorage.removeItem(preparationRecoveryStorageKey);
    sessionStorage.removeItem(`potomac.v2.generic.operation.${key}`);
    sessionStorage.removeItem(`potomac.v2.generic.entity.${key}`);
    setPreparationRecovery(undefined);
  };
  const refreshAuthorizedState = async () => {
    setBusy(true);
    try {
      await refresh();
      setMessage(preparationRecovery ? 'Authorized state refreshed from the host. Retry the exact original preparation to confirm its receipt, or complete each missing GM grant; the original identity remains reserved.' : 'Authorized state refreshed from the host.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Authorized state refresh failed.'); }
    finally { setBusy(false); }
  };
  const createEntity = async (descriptor: CatalogModule['entities'][number], submission: CreationRequest, assignedMembers: string[] = []) => {
    if (!selected || !lock) return; setBusy(true);
    const key = `create:${selected.id}:${descriptor.typeId}`;
    const memberIds = [...new Set(assignedMembers.filter(Boolean))];
    let createdEntityId: string | undefined;
    let grantsComplete = false;
    try {
      const existingAttempt = readPreparationRecovery();
      if (!existingAttempt) savePreparationRecovery({ key, entityTypeId: descriptor.typeId, assignedMemberIds: memberIds, grantedMemberIds: [] });
      const body = await request('/api/v2/entities', { method: 'POST', body: JSON.stringify({ operationId: operationId(key), entityId: stableEntityId(key), typeId: descriptor.typeId, visibility: submission.visibility, ...(submission.ownerPrincipalId ? { ownerPrincipalId: submission.ownerPrincipalId } : {}), data: submission.data }) });
      createdEntityId = body.entityId;
      const attempt = readPreparationRecovery();
      if (attempt?.key === key) savePreparationRecovery({ ...attempt, entityId: body.entityId });
      for (const memberId of memberIds) {
        await request(`/api/v2/entities/${encodeURIComponent(body.entityId)}/grants`, { method: 'POST', body: JSON.stringify({ memberId, permissions: ['read', 'act'] }) });
        const current = readPreparationRecovery();
        if (current?.key === key) savePreparationRecovery({ ...current, entityId: body.entityId, grantedMemberIds: [...new Set([...current.grantedMemberIds, memberId])] });
      }
      grantsComplete = true;
      await refresh();
      setSelectedEntityId(body.entityId);
      clearPreparationRecovery(key);
      setMessage(`${descriptor.typeId} prepared by the host and read/act access granted to the selected players.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      if (createdEntityId && !grantsComplete) {
        try { await refresh(); setSelectedEntityId(createdEntityId); } catch { /* Preserve the attempt when the projection is unavailable. */ }
      }
      setMessage(createdEntityId
        ? grantsComplete
          ? `The entity and player grants are committed, but the authorized state refresh failed. Use Refresh authorized state or retry with the same form values; the original operation is retained to prevent a duplicate. ${detail}`
          : `The entity exists, but player access could not be confirmed. Keep the same form values and retry to complete the grants, or refresh and grant players individually. ${detail}`
        : error instanceof Error ? error.message : 'Entity creation failed.');
    }
    finally { setBusy(false); }
  };
  const enrollPlayer = async () => {
    setBusy(true); try { const body = await request('/api/members/enroll', { method: 'POST', body: JSON.stringify({ displayName: `Player ${players.length + 1}` }) }, false); setPlayers(values => [...values, body]); setMessage('Player enrolled. Share the displayed one-time local test credential securely.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Enrollment failed.'); } finally { setBusy(false); }
  };
  const grantPlayer = async () => {
    if (!entity || !grantMemberId) return; setBusy(true); try {
      await request(`/api/v2/entities/${encodeURIComponent(entity.entityId)}/grants`, { method: 'POST', body: JSON.stringify({ memberId: grantMemberId, permissions: ['read', 'act'] }) });
      await refresh();
      const current = readPreparationRecovery();
      if (current?.entityId === entity.entityId && current.assignedMemberIds.includes(grantMemberId)) {
        const grantedMemberIds = [...new Set([...current.grantedMemberIds, grantMemberId])];
        const updated = { ...current, grantedMemberIds };
        if (current.assignedMemberIds.every(memberId => grantedMemberIds.includes(memberId))) {
          clearPreparationRecovery(current.key);
          setMessage('All assigned player grants were confirmed by the host. The recovered preparation is complete; a new preparation can now be created.');
        } else {
          savePreparationRecovery(updated);
          setMessage('Read and act grant committed for the selected player. The original preparation remains pending until every assigned player is granted.');
        }
      } else setMessage('Read and act grant committed for the selected enrolled player.');
    }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Grant failed.'); } finally { setBusy(false); }
  };
  const decideReaction = async (reaction: ReactionProjection, actionId: string, decision: 'accept' | 'decline', input: JsonValue) => {
    if (!lock) return; setBusy(true);
    const key = `reaction:${reaction.windowId}:${actionId}:${decision}`;
    try {
      await request(`/api/v2/reactions/${encodeURIComponent(reaction.windowId)}/${decision === 'accept' ? 'decisions' : 'decline'}`, { method: 'POST', body: JSON.stringify({ operationId: operationId(key), actionId, input, ...(decision === 'accept' ? { decision } : {}) }) });
      await refresh(); sessionStorage.removeItem(`potomac.v2.generic.operation.${key}`); setMessage(`Reaction ${decision} committed by the host.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Reaction response was rejected.'); }
    finally { setBusy(false); }
  };
  const adjudicateReaction = async (reaction: ReactionProjection, decision: 'accept' | 'decline', actionId?: string, input: JsonValue = {}) => {
    const key = `adjudicate:${reaction.windowId}:${decision}:${actionId ?? ''}`;
    setBusy(true); try {
      const result = await request(`/api/v2/reactions/${encodeURIComponent(reaction.windowId)}/adjudicate`, { method: 'POST', body: JSON.stringify({ operationId: operationId(key), decision, ...(actionId ? { actionId, input } : {}) }) });
      await refresh(); sessionStorage.removeItem(`potomac.v2.generic.operation.${key}`);
      setMessage(`GM ${decision === 'accept' ? `accepted ${actionId ? actionLabel(actionId) : 'the reaction'}` : 'declined the reaction'}; host resolution is ${result.status}.`);
    }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Reaction adjudication failed. The pending decision identity is retained for an exact retry.'); }
    finally { setBusy(false); }
  };
  const expireReaction = async (reaction: ReactionProjection) => {
    setBusy(true); try { await request(`/api/v2/reactions/${encodeURIComponent(reaction.windowId)}/expire`, { method: 'POST', body: JSON.stringify({}) }); await refresh(); setMessage('Host-confirmed reaction expiry recorded.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Reaction expiry failed.'); } finally { setBusy(false); }
  };
  const transitionSession = async (action: 'start' | 'finish') => {
    if (!lock || !entity || !currentSession) return;
    const key = `session:${action}:${entity.entityId}:${currentSession.revision}:${entity.revision}`;
    setBusy(true);
    try {
      const body = { operationId: operationId(key), expectedSessionRevision: currentSession.revision, expectedEncounterRevision: entity.revision, expectedLockDigest: lock.digest, ...(action === 'start' ? { encounterId: entity.entityId } : {}) };
      await request(`/api/v2/session/${action}`, { method: 'POST', body: JSON.stringify(body) });
      await refresh(); sessionStorage.removeItem(`potomac.v2.generic.operation.${key}`);
      setMessage(action === 'start' ? 'Session started from the selected host encounter.' : 'Session finished. Encounter history remains available.');
    } catch (error) { setMessage(error instanceof Error ? error.message : `Session ${action} failed; refresh and retry the exact operation.`); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (!lock || !entity) { setAllowedCommandIds([]); setCommandsLoading(false); return; } let cancelled = false; setCommandsLoading(true); setAllowedCommandIds([]); void request(`/api/v2/entities/${encodeURIComponent(entity.entityId)}/commands`).then(body => { if (!cancelled) setAllowedCommandIds(body.commandIds); }).catch(error => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Command permissions unavailable.'); }).finally(() => { if (!cancelled) setCommandsLoading(false); }); return () => { cancelled = true; }; }, [lock?.digest, entity?.entityId, entity?.revision, principalId]);
  const submitCommand = async (command: { operationId: string; commandId: string; entityId: string; expectedRevision: number; input: Record<string, JsonValue> }) => {
    if (!lock) throw new Error('No pinned campaign lock.');
    const result = await request('/api/v2/commands', { method: 'POST', body: JSON.stringify({ operationId: command.operationId, commandId: command.commandId, entityId: command.entityId, expectedRevision: command.expectedRevision, input: command.input }) });
    const feedback = commandResultFeedback(result);
    const prefix = `${command.commandId} ${feedback.message.replace(/^Command /, '')}`;
    setMessage(prefix);
    if (feedback.status === 'applied' || feedback.status === 'pending') {
      try { await refresh(); } catch { setMessage(`${prefix} The refreshed projection is unavailable; use Refresh authorized state before acting again.`); }
    }
    return result;
  };
  if (!connected) return <main className="v2-combat-page"><section className="v2-login-card"><p className="v2-eyebrow">Potomac · Experimental V2</p><h1>Trusted module workspace</h1><form onSubmit={connect}><label htmlFor="v2-catalog-credential">Host credential</label><input id="v2-catalog-credential" type="password" value={credential} onChange={event => setCredential(event.target.value)} required /><button disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button></form>{message && <p role="alert">{message}</p>}{onExit && <button type="button" onClick={onExit}>Return to campaign</button>}</section></main>;
  return <main className="v2-combat-page"><header className="v2-combat-header"><div><p className="v2-eyebrow">Static trusted catalog · Experimental V2</p><h1>{selected?.name ?? 'Module workspace'}</h1></div><span className="v2-identity">Authenticated as {principalId} · {isGm ? 'GM' : 'Player'}</span>{onExit && <button type="button" onClick={onExit}>Return to campaign</button>}</header>
    {message && <p className="v2-message" role="status">{message}</p>}
    {!lock && isGm && <section className="v2-setup-card"><h2>Pin a trusted module</h2><label htmlFor="v2-module-picker">Available modules</label><select id="v2-module-picker" value={selectedId} onChange={event => setSelectedId(event.target.value)}>{modules.map(module => <option key={`${module.id}@${module.version}`} value={module.id}>{module.name} · {module.version} · {module.digest.slice(0, 19)}</option>)}</select><button disabled={busy || !selectedId} onClick={() => void pin()}>Pin exact module lock</button></section>}
    {!lock && !isGm && <section className="v2-setup-card"><h2>Waiting for GM</h2><p>The GM must choose a catalog module for this fresh campaign.</p></section>}
    {lock && !selected && <section className="v2-setup-card" role="alert"><h2>Required module unavailable</h2><p>The pinned trusted implementation is missing from this host catalog. The campaign lock was preserved; no substitute is selected.</p></section>}
    {lock && selected && <><section className="v2-setup-card"><h2>Immutable campaign module</h2><p>{lock.lock.rootModule.id}@{lock.lock.rootModule.version} · {lock.lock.rootModule.digest}</p>{isGm && <><button disabled={busy} onClick={() => void enrollPlayer()}>Enroll a player</button>{players.map(player => <p key={player.memberId}>{player.credential ? <output>{player.displayName}: {player.credential}</output> : <span>{player.displayName} · enrolled</span>}</p>)}</>}</section>
      {isGm && preparationRecovery && <section className="v2-setup-card" aria-label="Preparation recovery" role="status"><h2>Preparation recovery</h2>{preparationRecovery.entityId ? <><p>{preparationRecovery.entityTypeId} exists as {preparationRecovery.entityId}. Confirmed grants: {preparationRecovery.grantedMemberIds.map(id => players.find(player => player.memberId === id)?.displayName ?? 'enrolled player').join(', ') || 'none'}.</p><p>Still required: {preparationRecovery.assignedMemberIds.filter(id => !preparationRecovery.grantedMemberIds.includes(id)).map(id => players.find(player => player.memberId === id)?.displayName ?? 'enrolled player').join(', ') || 'none'}. Select this entity below and grant each remaining player, or retry the exact original preparation.</p><button type="button" disabled={busy} onClick={() => setSelectedEntityId(preparationRecovery.entityId!)}>Open recovered entity</button></> : <p>The preparation outcome is uncertain. Retry the exact original form values; its saved operation identity will prevent duplicate creation. This attempt cannot be cleared until the host confirms its result.</p>}</section>}
      {reactions.map(reaction => <section className="v2-setup-card" key={reaction.windowId} aria-label="Authorized reaction"><h3>Pending reaction</h3><p>Movement or the parent action is paused until this decision resolves. Expires {new Date(reaction.expiresAt).toLocaleString()}.</p>{reaction.permissions.adjudicate ? <><h4>GM adjudication</h4>{reaction.availableActions.map(action => <V2EntitySchemaForm key={action.actionId} schema={action.inputSchema as EntityJsonSchema} formId={`reaction-${reaction.windowId}-${action.actionId}-gm-accept`} disabled={busy} submitLabel={`GM: Accept ${actionLabel(action.actionId)}`} onSubmit={input => adjudicateReaction(reaction, 'accept', action.actionId, input)} />)}<button disabled={busy} onClick={() => void adjudicateReaction(reaction, 'decline')}>GM: Decline reaction and resume</button></> : reaction.permissions.submit && reaction.availableActions.map(action => <div key={action.actionId}><V2EntitySchemaForm schema={action.inputSchema as EntityJsonSchema} formId={`reaction-${reaction.windowId}-${action.actionId}-accept`} disabled={busy} submitLabel={`Accept ${actionLabel(action.actionId)}`} onSubmit={input => decideReaction(reaction, action.actionId, 'accept', input)} /><V2EntitySchemaForm schema={action.inputSchema as EntityJsonSchema} formId={`reaction-${reaction.windowId}-${action.actionId}-decline`} disabled={busy} submitLabel={`Decline ${actionLabel(action.actionId)}`} onSubmit={input => decideReaction(reaction, action.actionId, 'decline', input)} /></div>)}{reaction.permissions.expire && <button disabled={busy || Date.parse(reaction.expiresAt) > Date.now()} onClick={() => void expireReaction(reaction)}>Expire after deadline</button>}</section>)}
      {entity && <section className="v2-setup-card" aria-label="Current V2 session"><h3>Current session</h3><p>{!currentSession ? 'Checking host session status' : currentSession.status === 'live' ? `Live${currentSession.encounter?.title ? ` · ${currentSession.encounter.title}` : ''}` : currentSession.status === 'finished' ? 'Finished' : 'Not started'}</p>{isGm && (currentSession?.status === 'live' && currentSession.encounter?.entityId === entity.entityId ? <button type="button" disabled={busy} onClick={() => void transitionSession('finish')}>Finish session</button> : currentSession?.status !== 'live' && (entity.typeId.endsWith('.encounter') || entity.typeId.endsWith('.scene')) ? <button type="button" disabled={busy || !currentSession} onClick={() => void transitionSession('start')}>Start session</button> : null)}</section>}
      {isGm && selected.entities.filter(descriptor => descriptor.creationRoles.includes('gm')).map(descriptor => <EntityCreationPanel key={`${selected.id}:${descriptor.typeId}`} moduleId={selected.id} descriptor={descriptor} preparation={selected.preparation?.find(form => form.entityTypeId === descriptor.typeId)} players={players} busy={busy} onCreate={(submission, assignedMembers) => createEntity(descriptor, submission, assignedMembers)} />)}
      {entities.length > 0 && <section className="v2-setup-card"><label htmlFor="v2-entity-picker">Authorized entities</label><select id="v2-entity-picker" value={entity?.entityId ?? ''} onChange={event => setSelectedEntityId(event.target.value)}>{entities.map((item, index) => <option key={item.entityId} value={item.entityId}>{entityLabel(item, index)}</option>)}</select>{entity && <><p>Entity revision {entity.revision}</p>{onOpenInTable && <button type="button" onClick={() => onOpenInTable(entity.entityId)}>Open in Table</button>}{isGm && players.length > 0 && <div className="v2-grant-controls"><label htmlFor="v2-grant-member">Grant read and act</label><select id="v2-grant-member" value={grantMemberId} onChange={event => setGrantMemberId(event.target.value)}><option value="">Choose an enrolled player</option>{players.map(player => <option key={player.memberId} value={player.memberId}>{player.displayName}</option>)}</select><button disabled={busy || !grantMemberId} onClick={() => void grantPlayer()}>Grant selected player read/act</button></div>}{commandsLoading && <p role="status" aria-live="polite">Loading available module actions…</p>}{!commandsLoading && uiRegistry && selected.contributions.filter(contribution => contribution.entityTypeId === entity.typeId).map(contribution => <V2UiContributionView key={contribution.contributionId} experimentalEnabled registry={uiRegistry} contributionId={contribution.contributionId} entity={entity} host={{ lock: lock.lock, principalId, allowedCommandIds, submitCommand }} />)}{!commandsLoading && allowedCommandIds.length === 0 && selected.contributions.some(contribution => contribution.entityTypeId === entity.typeId && contribution.commands.length > 0) && <p role="status">No module actions are currently authorized for this account.</p>}</>}</section>}
    </>}
    <button type="button" disabled={busy} onClick={() => void refreshAuthorizedState()}>Refresh authorized state</button>
  </main>;
}
