import { useEffect, useMemo, useState } from 'react';
import type { CapabilityLock, JsonValue, UiContribution, UiDescriptorCatalog, UiEntityProjection } from '@potomac/contracts';
import { UiContributionRegistry } from './workspace/v2-ui-registry.ts';
import { V2UiContributionView } from './workspace/v2-ui-renderer.tsx';
import './v2-combat.css';

type CatalogModule = { id: string; name: string; version: string; digest: string; capabilities: CapabilityLock['entries']; entities: UiDescriptorCatalog['entities'] & Array<{ creationRoles: string[]; visibility: Array<'public' | 'gm' | 'owner'>; ownership: { kind: 'campaign' | 'principal' } }>; commands: Array<UiDescriptorCatalog['commands'][number] & { permission: { roles: string[] } }>; workflows: UiDescriptorCatalog['workflows']; contributions: UiContribution[] };
type LockView = { lock: CapabilityLock; digest: string };
type Entity = UiEntityProjection & { revision: number };
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
const initialValue = (schema: any): JsonValue => {
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([key]) => (schema.required ?? []).includes(key)).map(([key, child]) => [key, initialValue(child)]));
  if (schema.type === 'array') return [];
  if (schema.type === 'boolean') return false;
  if (schema.type === 'string') return schema.minLength ? 'x'.repeat(schema.minLength) : '';
  if (schema.type === 'integer' || schema.type === 'number') return schema.minimum ?? 0;
  return null;
};

export function V2ModulesApp() {
  const [credential, setCredential] = useState(''); const [connected, setConnected] = useState(false); const [isGm, setIsGm] = useState(false); const [principalId, setPrincipalId] = useState('');
  const [modules, setModules] = useState<CatalogModule[]>([]); const [selectedId, setSelectedId] = useState(''); const [lock, setLock] = useState<LockView>();
  const [entities, setEntities] = useState<Entity[]>([]); const [selectedEntityId, setSelectedEntityId] = useState(''); const [allowedCommandIds, setAllowedCommandIds] = useState<string[]>([]);
  const [players, setPlayers] = useState<Array<{ memberId: string; credential: string; displayName: string }>>([]); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const selected = modules.find(module => module.id === (lock?.lock.rootModule.id ?? selectedId));
  const entityType = selected?.entities[0];
  const entity = entities.find(item => item.entityId === selectedEntityId) ?? entities[0];
  const uiCatalog = useMemo<UiDescriptorCatalog>(() => selected ? ({ entities: selected.entities, commands: selected.commands, workflows: selected.workflows }) : ({ entities: [], commands: [], workflows: [] }), [selected]);
  const uiRegistry = useMemo(() => {
    if (!selected || !lock) return undefined;
    try { const registry = new UiContributionRegistry(lock.lock, lock.lock.campaignId, uiCatalog); for (const contribution of selected.contributions) registry.register(contribution); return registry; }
    catch (error) { setMessage(error instanceof Error ? `Module UI rejected: ${error.message}` : 'Module UI rejected.'); return undefined; }
  }, [selected, lock, uiCatalog]);
  const request = async (url: string, init: RequestInit = {}, withLock = true, exactDigest = lock?.digest) => {
    const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${credential}`, ...(withLock && exactDigest ? { 'x-v2-lock-digest': exactDigest } : {}), ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) } });
    const body = await response.json(); if (!response.ok) throw new Error(String(body.error ?? body.message ?? `Request failed (${response.status})`)); return body;
  };
  const refresh = async (current = lock, currentModules = modules) => {
    if (!current) return;
    const module = currentModules.find(item => item.id === current.lock.rootModule.id); if (!module?.entities[0]) return;
    const rows = await request(`/api/v2/entities?typeId=${encodeURIComponent(module.entities[0].typeId)}`, {}, true, current.digest);
    const records = rows.entities ?? rows; setEntities(records); setSelectedEntityId(value => records.some((row: Entity) => row.entityId === value) ? value : records[0]?.entityId ?? '');
  };
  const connect = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const session = await fetch('/api/v2/session', { headers: { authorization: `Bearer ${credential}` } }); if (!session.ok) throw new Error('Authentication failed');
      const identity = await session.json(); setPrincipalId(identity.principalId); setIsGm(identity.role === 'gm');
      const catalogResponse = await fetch('/api/v2/modules', { headers: { authorization: `Bearer ${credential}` } }); if (!catalogResponse.ok) throw new Error('Trusted module catalog is unavailable.');
      const catalogBody = await catalogResponse.json(); setModules(catalogBody.modules); setSelectedId(catalogBody.modules[0]?.id ?? '');
      const current = await fetch('/api/v2/campaign/lock', { headers: { authorization: `Bearer ${credential}` } });
      if (current.ok) { const pinned = await current.json(); setLock(pinned); setConnected(true); await refresh(pinned, catalogBody.modules); setMessage('Authenticated; the campaign lock is unchanged.'); }
      else if ([409, 422].includes(current.status)) { setLock(undefined); setConnected(true); setMessage(identity.role === 'gm' ? 'Select and pin an approved module to this fresh campaign.' : 'Waiting for the GM to pin a trusted module.'); }
      else throw new Error('Could not read the campaign module lock.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Connection failed.'); }
    finally { setBusy(false); }
  };
  const pin = async () => { setBusy(true); try { const body = await request('/api/v2/campaign/lock', { method: 'PUT', body: JSON.stringify({ moduleId: selectedId }) }, false); setLock(body); await refresh(body); setMessage(`${selected?.name ?? selectedId} pinned at its exact validated digest.`); } catch (error) { setMessage(error instanceof Error ? error.message : 'Pin failed.'); } finally { setBusy(false); } };
  const createScene = async () => {
    if (!entityType || !lock) return; setBusy(true);
    try {
      const key = `create:${selected!.id}`;
      const body = await request('/api/v2/entities', { method: 'POST', body: JSON.stringify({ operationId: operationId(key), entityId: stableEntityId(key), typeId: entityType.typeId, visibility: entityType.visibility[0], data: initialValue((entityType as any).schema) }) });
      sessionStorage.removeItem(`potomac.v2.generic.operation.${key}`); sessionStorage.removeItem(`potomac.v2.generic.entity.${key}`); await refresh(); setSelectedEntityId(body.entityId); setMessage('Scene created and committed by the host.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Scene creation failed.'); } finally { setBusy(false); }
  };
  const enrollPlayer = async () => {
    setBusy(true); try { const body = await request('/api/members/enroll', { method: 'POST', body: JSON.stringify({ displayName: `Player ${players.length + 1}` }) }, false); setPlayers(values => [...values, body]); setMessage('Player enrolled. Share the displayed one-time local test credential securely.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Enrollment failed.'); } finally { setBusy(false); }
  };
  const grantPlayer = async (memberId: string) => {
    if (!entity) return; setBusy(true); try { await request(`/api/v2/entities/${encodeURIComponent(entity.entityId)}/grants`, { method: 'POST', body: JSON.stringify({ memberId, permissions: ['read', 'act'] }) }); await refresh(); setMessage('Read and act grants committed for this scene.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Grant failed.'); } finally { setBusy(false); }
  };
  useEffect(() => { if (!lock || !entity) { setAllowedCommandIds([]); return; } let cancelled = false; void request(`/api/v2/entities/${encodeURIComponent(entity.entityId)}/commands`).then(body => { if (!cancelled) setAllowedCommandIds(body.commandIds); }).catch(error => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Command permissions unavailable.'); }); return () => { cancelled = true; }; }, [lock?.digest, entity?.entityId, entity?.revision, principalId]);
  const submitCommand = async (command: { operationId: string; commandId: string; entityId: string; expectedRevision: number; input: Record<string, JsonValue> }) => {
    if (!lock) throw new Error('No pinned campaign lock.');
    const result = await request('/api/v2/commands', { method: 'POST', body: JSON.stringify({ operationId: command.operationId, commandId: command.commandId, entityId: command.entityId, expectedRevision: command.expectedRevision, input: command.input }) });
    await refresh(); return result;
  };
  if (!connected) return <main className="v2-combat-page"><section className="v2-login-card"><p className="v2-eyebrow">Potomac · Experimental V2</p><h1>Trusted module workspace</h1><form onSubmit={connect}><label htmlFor="v2-catalog-credential">Host credential</label><input id="v2-catalog-credential" type="password" value={credential} onChange={event => setCredential(event.target.value)} required /><button disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button></form>{message && <p role="alert">{message}</p>}</section></main>;
  return <main className="v2-combat-page"><header className="v2-combat-header"><div><p className="v2-eyebrow">Static trusted catalog · Experimental V2</p><h1>{selected?.name ?? 'Module workspace'}</h1></div><span className="v2-identity">Authenticated as {principalId} · {isGm ? 'GM' : 'Player'}</span></header>
    {message && <p className="v2-message" role="status">{message}</p>}
    {!lock && isGm && <section className="v2-setup-card"><h2>Pin a trusted module</h2><label htmlFor="v2-module-picker">Available modules</label><select id="v2-module-picker" value={selectedId} onChange={event => setSelectedId(event.target.value)}>{modules.map(module => <option key={`${module.id}@${module.version}`} value={module.id}>{module.name} · {module.version} · {module.digest.slice(0, 19)}</option>)}</select><button disabled={busy || !selectedId} onClick={() => void pin()}>Pin exact module lock</button></section>}
    {!lock && !isGm && <section className="v2-setup-card"><h2>Waiting for GM</h2><p>The GM must choose a catalog module for this fresh campaign.</p></section>}
    {lock && <><section className="v2-setup-card"><h2>Immutable campaign module</h2><p>{lock.lock.rootModule.id}@{lock.lock.rootModule.version} · {lock.lock.rootModule.digest}</p>{isGm && !entity && entityType?.creationRoles.includes('gm') && <button disabled={busy} onClick={() => void createScene()}>Create {entityType.typeId}</button>}{isGm && <><button disabled={busy} onClick={() => void enrollPlayer()}>Enroll a player</button>{players.map(player => <p key={player.memberId}><output>{player.displayName}: {player.credential}</output>{entity && <button disabled={busy} onClick={() => void grantPlayer(player.memberId)}>Grant {player.displayName} read/act</button>}</p>)}</>}</section>
      {entity && <section className="v2-setup-card"><label htmlFor="v2-entity-picker">Authorized scene</label><select id="v2-entity-picker" value={entity.entityId} onChange={event => setSelectedEntityId(event.target.value)}>{entities.map(item => <option key={item.entityId} value={item.entityId}>{item.entityId}</option>)}</select><p>Entity revision {entity.revision}</p>
        {uiRegistry && selected?.contributions.map(contribution => contribution.entityTypeId === entity.typeId && <V2UiContributionView key={contribution.contributionId} experimentalEnabled registry={uiRegistry} contributionId={contribution.contributionId} entity={entity} host={{ lock: lock.lock, principalId, allowedCommandIds, submitCommand }} />)}
      </section>}</>}
    <button type="button" onClick={() => void refresh()}>Refresh authorized state</button>
  </main>;
}
