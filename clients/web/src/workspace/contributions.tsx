import type { Activity, Encounter, SessionSnapshot } from '../api.ts';
import type { Actor } from '../modules.ts';
import type { BrickBinding, BrickDefinition, BrickRenderProps, AuthorizedBrickDataAdapter } from './types.ts';
import { resolveTableParticipants } from './authorized-adapter.ts';
import { getBrickDefinition, registerBrickDefinition } from './registry.ts';

function declaredBrickDefinition(typeId: string): BrickDefinition<unknown> {
  const definition = getBrickDefinition(typeId);
  if (!definition) throw new Error(`Missing built-in brick metadata: ${typeId}`);
  return definition;
}

function valueAt(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((value, key) =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined, source);
}

export function CharacterView({ actor, busy, offline = false, onAction, compact, gm = false }: { actor: Actor; busy: boolean; offline?: boolean; onAction: (actor: Actor, actionId: string) => void; compact?: boolean; gm?: boolean }) {
  const controls = compact ? actor.module.view.brick : actor.module.view.layout;
  const stats = controls.filter(item => item.control === 'stat');
  const resources = controls.filter(item => item.control === 'resource');
  const actions = controls.filter(item => item.control === 'actionButton');
  return <div className="character-view">
    <div className="character-identity"><div className="avatar">{actor.name.slice(0, 1)}</div><div><p className="eyebrow">{actor.module.manifest.name} · {actor.module.manifest.version}</p><h3>{actor.name}</h3><p>{actor.epithet}</p></div><span className="revision">REV {actor.revision}</span></div>
    {stats.length > 0 && <div className="stat-grid">{stats.map((item, index) => <div className="stat" key={`${item.field}-${index}`}><span>{item.label}</span><strong>{String(item.field ? valueAt(actor.data, item.field) ?? '—' : '—')}</strong></div>)}</div>}
    {resources.length > 0 && <div className="resource-grid">{resources.map((item, index) => {
      const data = item.field ? valueAt(actor.data, item.field) : undefined;
      const current = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).current : data;
      const maximum = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).maximum : current;
      const ratio = typeof current === 'number' && typeof maximum === 'number' && maximum > 0 ? Math.max(0, Math.min(100, current / maximum * 100)) : 0;
      return <div className="resource" key={`${item.field}-${index}`}><div><span>{item.label}</span><strong>{String(current ?? '—')} / {String(maximum ?? '—')}</strong></div><div className="meter"><i style={{ width: `${ratio}%` }} /></div></div>;
    })}</div>}
    {actions.length > 0 && <div className="action-grid">{actions.map((item, index) => {
      const action = actor.module.actions.find(value => value.id === item.actionId);
      const hostOnly = Boolean(action?.resolution) || !['selfService', 'gmReview'].includes(action?.policy || '');
      return <button type="button" key={`${item.actionId}-${index}`} disabled={busy || offline && hostOnly} title={offline && hostOnly ? 'Host connection required' : undefined} onClick={() => item.actionId && onAction(actor, item.actionId)}>{item.label}</button>;
    })}</div>}
    {gm && actor.secretNote && <div className="gm-note"><b>GM only</b> {actor.secretNote}</div>}
  </div>;
}

function CharacterBrick({ data, busy, offline, onAction, onOpenApp }: BrickRenderProps<Actor>) {
  return data ? <><button type="button" onClick={() => onOpenApp?.('characters', data.entityId)}>Open character app</button><CharacterView actor={data} compact busy={busy} offline={offline} onAction={onAction} gm={Boolean(data.secretNote)} /></> : <p className="brick-message">Character unavailable for this binding.</p>;
}

function EncounterBrick({ data, onOpenApp }: BrickRenderProps<{ encounter: Encounter; following: boolean }>) {
  if (!data) return <p className="brick-message">No accessible encounter for this binding.</p>;
  return <div className="encounter-summary"><p className="eyebrow">{data.following ? 'FOLLOWING SESSION' : 'PINNED ENCOUNTER'}</p><h3>{data.encounter.name}</h3><p>{data.encounter.summary}</p><small>Stable ID · {data.encounter.id}</small><div><button type="button" onClick={() => onOpenApp?.('encounters', data.encounter.id)}>Open encounter app</button></div></div>;
}

function ActivityBrick({ data }: BrickRenderProps<Activity[]>) {
  return <div className="activity-list">{data?.length ? data.slice(-12).reverse().map(item => <div className="activity-item" key={item.id}><span className="activity-dot" /><div><strong>{item.action}</strong><p>{item.detail || 'Campaign event'}</p><small>{item.actor} · {item.time}{item.visibility === 'gm' ? ' · GM only' : ''}</small></div></div>) : <p className="brick-message">Actions and encounter changes will appear here.</p>}</div>;
}

function TableSessionBrick({ data, adapter, onSessionCommand, onOpenApp, busy, offline }: BrickRenderProps<SessionSnapshot>) {
  const session = data?.current;
  if (!data) return <p className="brick-message">Session status is unavailable while connecting to the host.</p>;
  const encounter = adapter.getActiveEncounter();
  const startTarget = encounter && typeof encounter.revision === 'number' && Number.isInteger(encounter.revision) && encounter.revision >= 1
    ? { id: encounter.id, revision: encounter.revision }
    : undefined;
  const canStart = Boolean(startTarget);
  return <div className="table-session-panel"><p className="eyebrow">LIVE SESSION</p><strong>{session ? session.status[0].toUpperCase() + session.status.slice(1) : 'No active session'}</strong>{session && <small>Started {new Date(session.startedAt).toLocaleString()}</small>}{adapter.getRole() === 'gm' && <div className="action-grid">{!session || session.status === 'finished' ? <button type="button" disabled={busy || offline || !onSessionCommand || !canStart} title={!canStart ? 'Set an active encounter with a current host revision before starting' : undefined} onClick={() => { if (startTarget) onSessionCommand?.('start', startTarget) }}>Start session</button> : session.status === 'active' ? <><button type="button" disabled={busy || offline || !onSessionCommand} onClick={() => onSessionCommand?.('pause')}>Pause session</button><button type="button" disabled={busy || offline || !onSessionCommand} onClick={() => onSessionCommand?.('finish')}>End session</button></> : <><button type="button" disabled={busy || offline || !onSessionCommand} onClick={() => onSessionCommand?.('resume')}>Resume session</button><button type="button" disabled={busy || offline || !onSessionCommand} onClick={() => onSessionCommand?.('finish')}>End session</button></>}</div>}{adapter.getRole() === 'gm' && !canStart && (!session || session.status === 'finished') && <small role="status">Choose an active encounter before starting a session.</small>}{adapter.getRole() === 'player' && <small>Session controls are managed by the GM.</small>}{offline && <small role="status">Reconnect to manage the session.</small>}{session && <button type="button" onClick={() => onOpenApp?.('encounters', adapter.getActiveEncounter()?.id)}>Open encounter</button>}</div>;
}

function TableParticipantsBrick({ data, onOpenApp }: BrickRenderProps<Array<{ actor: Actor; status?: string }>>) {
  if (!data?.length) return <p className="brick-message">No participants are currently available.</p>;
  return <div className="table-participants">{data.map(({ actor, status }) => <article key={actor.entityId}><div><strong>{actor.name}</strong><small>{actor.module.manifest.name}{status ? ` · ${status}` : ''}</small></div><div className="table-participant-fields">{actor.module.view.brick.filter(item => item.control === 'stat' || item.control === 'resource').map((item, index) => <span key={`${item.field}-${index}`}><small>{item.label}</small><b>{formatPublicValue(valueAt(actor.data, item.field || ''))}</b></span>)}</div><button type="button" onClick={() => onOpenApp?.('characters', actor.entityId)}>Open Character</button></article>)}</div>;
}

function formatPublicValue(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'current' in value) {
    const resource = value as { current?: unknown; maximum?: unknown };
    return `${String(resource.current ?? '—')} / ${String(resource.maximum ?? '—')}`;
  }
  return value == null ? '—' : String(value);
}

const characterDefinition: BrickDefinition<Actor> = {
  ...declaredBrickDefinition('characters.sheet'),
  resolve: (binding, adapter) => binding.mode === 'pinned' && binding.entityId ? adapter.getActor(binding.entityId) : undefined,
  render: CharacterBrick,
};

const encounterDefinition: BrickDefinition<{ encounter: Encounter; following: boolean }> = {
  ...declaredBrickDefinition('encounters.summary'),
  resolve: (binding, adapter) => {
    const encounter = binding.mode === 'follow' ? adapter.getActiveEncounter() : binding.mode === 'pinned' && binding.entityId ? adapter.getEncounter(binding.entityId) : undefined;
    return encounter ? { encounter, following: binding.mode === 'follow' } : undefined;
  },
  render: EncounterBrick,
};

const activityDefinition: BrickDefinition<Activity[]> = {
  ...declaredBrickDefinition('activity.log'),
  resolve: (_binding, adapter) => adapter.getActivity(), render: ActivityBrick,
};

const tableSessionDefinition: BrickDefinition<SessionSnapshot> = {
  ...declaredBrickDefinition('table.session'), resolve: (_binding, adapter) => adapter.getSession(), render: TableSessionBrick,
};
const tableParticipantsDefinition: BrickDefinition<Array<{ actor: Actor; status?: string }>> = {
  ...declaredBrickDefinition('table.participants'),
  resolve: resolveTableParticipants,
  render: TableParticipantsBrick,
};
const tableActivityDefinition: BrickDefinition<Activity[]> = {
  ...declaredBrickDefinition('table.activity'), resolve: (_binding, adapter) => adapter.getActivity(), render: ActivityBrick,
};

export const brickDefinitions: BrickDefinition<unknown>[] = [characterDefinition, encounterDefinition, activityDefinition, tableSessionDefinition, tableParticipantsDefinition, tableActivityDefinition] as unknown as BrickDefinition<unknown>[];
for (const definition of brickDefinitions) registerBrickDefinition(definition, true);

export function resolveDefaultBinding<TData>(definition: BrickDefinition<TData>, adapter: AuthorizedBrickDataAdapter): BrickBinding {
  if (definition.defaultBinding) return definition.defaultBinding;
  if (definition.supportedBindings.includes('none')) return { mode: 'none' };
  const options = definition.getBindingOptions?.(adapter) ?? [];
  if (definition.supportedBindings.includes('pinned')) return { mode: 'pinned', entityId: options[0]?.id ?? '' };
  return { mode: 'none' };
}

export type { BrickBinding };
