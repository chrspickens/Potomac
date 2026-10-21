import { useEffect, useMemo, useState } from 'react';
import type { CapabilityLock, JsonValue, UiContribution, UiDescriptorCatalog, UiEntityProjection, UiNode } from '@potomac/contracts';
import { UiContributionRegistry, readUiPath, uiNodeIsVisible } from './workspace/v2-ui-registry.ts';
import './v2-table.css';

type Module = { id: string; version: string; digest: string; capabilities: CapabilityLock['entries']; entities: UiDescriptorCatalog['entities']; commands: UiDescriptorCatalog['commands']; workflows: UiDescriptorCatalog['workflows']; contributions: UiContribution[] };
type LockView = { lock: CapabilityLock; digest: string };
type CurrentSession = { status: 'none' | 'live' | 'finished'; revision: number; encounter?: { entityId: string; revision: number; title?: string } };
const api = (path: string) => `${(import.meta.env.VITE_POTOMAC_HOST || '').replace(/\/$/, '')}${path}`;
const text = (value: JsonValue | undefined): string => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);

function ReadOnlyNode({ node, data }: { node: UiNode; data: JsonValue }) {
  if (!uiNodeIsVisible(node, data)) return null;
  if (node.kind === 'group') return <div>{node.children.map(child => <ReadOnlyNode key={child.id} node={child} data={data} />)}</div>;
  if (node.kind === 'section') return <section className="v2-table-section" aria-label={node.label}>{node.label && <h3>{node.label}</h3>}{node.children.map(child => <ReadOnlyNode key={child.id} node={child} data={data} />)}</section>;
  if (node.kind === 'display') { const value = readUiPath(data, node.path); return value === undefined ? null : <p><strong>{node.label}:</strong> {Array.isArray(value) ? value.map(text).join(' · ') : text(value)}</p>; }
  if (node.kind === 'resource') {
    const current = readUiPath(data, node.currentPath), maximum = readUiPath(data, node.maximumPath);
    const values = Array.isArray(current) ? current : [current], maxima = Array.isArray(maximum) ? maximum : [maximum];
    if (values.length !== maxima.length || values.some(value => typeof value !== 'number') || maxima.some(value => typeof value !== 'number')) return null;
    return <div className="v2-table-resources">{values.map((value, index) => <span key={index}>{node.label}{values.length > 1 ? ` ${index + 1}` : ''}: {text(value)} / {text(maxima[index])}</span>)}</div>;
  }
  return null;
}

function PositionView({ entity, schema }: { entity: UiEntityProjection; schema: JsonValue }) {
  if (!entity.data || typeof entity.data !== 'object' || Array.isArray(entity.data)) return <p>No spatial data is declared for this entity.</p>;
  const data = entity.data as Record<string, JsonValue>;
  const properties = schema && typeof schema === 'object' && !Array.isArray(schema) && 'properties' in schema && schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties) ? schema.properties as Record<string, JsonValue> : {};
  const gridKey = Object.keys(properties).find(key => key === 'grid' && data[key] && typeof data[key] === 'object' && !Array.isArray(data[key]));
  const grid = gridKey ? data[gridKey] as Record<string, JsonValue> : undefined;
  const participantKey = Object.entries(properties).find(([, value]) => value && typeof value === 'object' && !Array.isArray(value) && 'type' in value && value.type === 'array' && 'items' in value && value.items && typeof value.items === 'object' && !Array.isArray(value.items) && 'properties' in value.items && value.items.properties && typeof value.items.properties === 'object' && !Array.isArray(value.items.properties) && 'position' in value.items.properties)?.[0];
  const actors = participantKey && Array.isArray(data[participantKey]) ? data[participantKey] as JsonValue[] : [];
  const positioned = actors.filter((actor): actor is Record<string, JsonValue> => Boolean(actor && typeof actor === 'object' && !Array.isArray(actor) && actor.position && typeof actor.position === 'object' && !Array.isArray(actor.position)));
  if (grid && Number.isInteger(grid.width) && Number.isInteger(grid.height) && (grid.width as number) > 0 && (grid.height as number) > 0 && positioned.length) {
    const width = Math.min(30, grid.width as number), height = Math.min(30, grid.height as number);
    const at = new Map<string, string[]>();
    for (const actor of positioned) { const pos = actor.position as Record<string, JsonValue>; if (!Number.isInteger(pos.x) || !Number.isInteger(pos.y)) continue; const key = `${pos.x},${pos.y}`; at.set(key, [...(at.get(key) ?? []), String(actor.name ?? actor.id ?? 'Participant')]); }
    const blocked = new Set(Array.isArray(grid.blocked) ? grid.blocked.flatMap(item => item && typeof item === 'object' && !Array.isArray(item) && Number.isInteger(item.x) && Number.isInteger(item.y) ? [`${item.x},${item.y}`] : []) : []);
    return <div className="v2-table-map" aria-label="Encounter battle map"><p>Grid · {String(grid.width)} × {String(grid.height)}{typeof grid.squareFeet === 'number' ? ` · ${grid.squareFeet} ft squares` : ''}</p><div className="v2-table-grid" style={{ gridTemplateColumns: `repeat(${width}, minmax(2rem, 1fr))` }}>{Array.from({ length: width * height }, (_, i) => { const x = i % width, y = Math.floor(i / width), labels = at.get(`${x},${y}`) ?? [], isBlocked = blocked.has(`${x},${y}`); return <div className={isBlocked ? 'is-blocked' : ''} key={`${x},${y}`} aria-label={`Square ${x}, ${y}${isBlocked ? ', blocked' : ''}${labels.length ? `: ${labels.join(', ')}` : ''}`} title={`${isBlocked ? 'Blocked · ' : ''}${labels.join(', ')}`}>{labels.map(label => label.slice(0, 2)).join('/') || (isBlocked ? '×' : '')}</div>; })}</div>{positioned.map((actor, index) => { const pos = actor.position as Record<string, JsonValue>; return <p key={String(actor.id ?? index)}>{String(actor.name ?? actor.id ?? 'Participant')} · ({text(pos.x)}, {text(pos.y)})</p>; })}</div>;
  }
  return <div className="v2-table-roster"><p>{grid ? 'Grid is available; participant positions are not declared.' : 'No grid is declared; showing the authorized participant roster.'}</p>{actors.map((actor, index) => actor && typeof actor === 'object' && !Array.isArray(actor) ? <p key={String(actor.id ?? index)}><strong>{String(actor.name ?? actor.id ?? 'Participant')}</strong>{typeof actor.kind === 'string' ? ` · ${actor.kind}` : ''}{actor.resources && typeof actor.resources === 'object' ? ` · ${text(actor.resources)}` : ''}</p> : null)}</div>;
}

export function V2TableView({ credential, entityId, onOpenRules, onReturn }: { credential: string; entityId: string; onOpenRules: (entityId: string) => void; onReturn: () => void }) {
  const [lockView, setLockView] = useState<LockView>(); const [entity, setEntity] = useState<UiEntityProjection>(); const [module, setModule] = useState<Module>(); const [message, setMessage] = useState('Loading the authorized encounter projection…'); const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [currentSession, setCurrentSession] = useState<CurrentSession>();
  const registry = useMemo(() => { if (!lockView || !module) return undefined; try { const value = new UiContributionRegistry(lockView.lock, lockView.lock.campaignId, { entities: module.entities, commands: module.commands, workflows: module.workflows }); for (const contribution of module.contributions) value.register(contribution); return value; } catch { return undefined; } }, [lockView, module]);
  useEffect(() => {
    let cancelled = false;
    const request = async (path: string, headers: Record<string, string> = {}) => { const response = await fetch(api(path), { headers: { authorization: `Bearer ${credential}`, ...headers } }); const body = await response.json(); if (!response.ok) throw Object.assign(new Error(String(body.error ?? `Request failed (${response.status})`)), { status: response.status }); return body; };
    void (async () => {
      try {
        await request('/api/v2/session');
        const pinned = await request('/api/v2/campaign/lock');
        const current = await request('/api/v2/session/current') as CurrentSession;
        const catalog = await request('/api/v2/modules');
        const exact = (catalog.modules as Module[]).find(item => item.id === pinned.lock.rootModule.id && item.version === pinned.lock.rootModule.version && item.digest === pinned.lock.rootModule.digest);
        if (!exact) throw new Error('The exact pinned module is unavailable. Table will not substitute another version.');
        const headers = { 'x-v2-lock-digest': pinned.digest };
        const lists = await Promise.all(exact.entities.map(descriptor => request(`/api/v2/entities?typeId=${encodeURIComponent(descriptor.typeId)}`, headers)));
        const authorized = lists.flatMap((result: { entities?: UiEntityProjection[] } | UiEntityProjection[]) => Array.isArray(result) ? result : result.entities ?? []);
        if (!authorized.some(item => item.entityId === entityId)) throw Object.assign(new Error('This encounter is unavailable to the authenticated account.'), { status: 404 });
        const projection = await request(`/api/v2/entities/${encodeURIComponent(entityId)}`, headers) as UiEntityProjection;
        const descriptor = exact.entities.find(item => item.typeId === projection.typeId), capability = projection.capability, expected = descriptor?.capability;
        if (projection.campaignId !== pinned.lock.campaignId || !descriptor || projection.schemaVersion !== descriptor.schemaVersion || !capability || !expected || capability.id !== expected.id || capability.apiVersion !== expected.apiVersion || capability.implementationVersion !== expected.implementationVersion || capability.digest !== expected.digest || !pinned.lock.entries.some((entry: { id: string; apiVersion: string; implementationVersion: string; digest: string }) => entry.id === capability.id && entry.apiVersion === capability.apiVersion && entry.implementationVersion === capability.implementationVersion && entry.digest === capability.digest)) throw new Error('The entity provenance does not match the exact campaign lock.');
        if (!cancelled) { setLockView(pinned); setModule(exact); setEntity(projection); setCurrentSession(current); setError(''); setMessage('Authorized encounter state loaded from the host.'); }
      } catch (cause) { if (!cancelled) { setEntity(undefined); setError(cause instanceof Error ? cause.message : 'Encounter projection unavailable.'); setMessage(''); } }
    })();
    return () => { cancelled = true; };
  }, [credential, entityId, refreshKey]);
  useEffect(() => {
    let cancelled = false;
    const refreshSession = async () => {
      try { const response = await fetch(api('/api/v2/session/current'), { headers: { authorization: `Bearer ${credential}` } }); if (!response.ok) throw new Error('Session status is unavailable'); const projection = await response.json() as CurrentSession; if (!cancelled) setCurrentSession(projection); }
      catch { if (!cancelled) setCurrentSession(undefined); }
    };
    void refreshSession(); const timer = window.setInterval(() => void refreshSession(), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [credential, entityId]);
  const contributions = module && entity && registry ? module.contributions.filter(item => item.entityTypeId === entity.typeId).flatMap(item => { try { const exact = registry.get(item.contributionId); if (!exact) return []; registry.validate(exact, lockView!.lock, entity.campaignId); return [exact]; } catch { return []; } }) : [];
  const entitySchema = module?.entities.find(item => item.typeId === entity?.typeId)?.schema ?? {};
  return <main className="v2-table-page"><header><div><p className="v2-eyebrow">TABLE · EXPERIMENTAL V2</p><h1>{entity && entity.data && typeof entity.data === 'object' && !Array.isArray(entity.data) && typeof entity.data.title === 'string' ? entity.data.title : 'Encounter'}</h1><p>{entity?.entityId ?? entityId} · {entity ? `revision ${entity.revision}` : 'authorizing'}</p>{lockView && <small>Exact lock: {lockView.lock.rootModule.id}@{lockView.lock.rootModule.version} · {lockView.lock.rootModule.digest} · {lockView.lock.entries.length} capabilities</small>}</div><span>{!currentSession ? 'Checking host session' : currentSession.status === 'live' ? 'Session live' : currentSession.status === 'finished' ? 'Session finished' : 'No live session'}</span></header><nav aria-label="Encounter navigation"><button type="button" onClick={() => onOpenRules(entityId)}>Open in Rules</button><button type="button" onClick={() => { setEntity(undefined); setError(''); setMessage('Refreshing authorized state…'); setRefreshKey(value => value + 1); }}>Refresh authorized state</button><button type="button" onClick={onReturn}>Return to campaign</button></nav>{message && <p role="status" aria-live="polite">{message}</p>}{error && <section role="alert"><p>{error}</p><button type="button" onClick={onReturn}>Return to campaign</button></section>}{entity && <><section aria-label="Encounter participants"><h2>Participants and spatial view</h2><PositionView entity={entity} schema={entitySchema} /></section>{contributions.map(item => <section key={item.contributionId} aria-label={`Read-only ${item.kind} contribution`}><h2>{item.contributionId}</h2>{item.nodes.map(node => <ReadOnlyNode key={node.id} node={node} data={entity.data} />)}</section>)}<p>Mechanical actions and reactions remain in Rules. Refresh or reopen this Table view to load the current host revision.</p></>}</main>;
}
