import { createContext, useContext, useState } from 'react';
import type { FormEvent } from 'react';
import type { Activity, Encounter, SessionSnapshot } from '../api.ts';
import type { Actor } from '../modules.ts';
import type { LoreArticle } from '../api.ts';
import type { BrickBinding, BrickDefinition, BrickRenderProps, AuthorizedBrickDataAdapter } from './types.ts';
import { resolveMapSceneBinding, resolveTableParticipants } from './authorized-adapter.ts';
import { getBrickDefinition, registerBrickDefinition } from './registry.ts';
import { MapCanvas } from '../maps-app.tsx';
import type { MapSceneView } from '../api.ts';
import { getActionEnumIndex, getActionEnumValue, isSupportedActionEnum } from './action-input-schema.ts';

export const CharacterPreparationContext = createContext<{ encounters: Encounter[]; onLinkEncounter?: (actorId: string, encounterId: string) => void; onReturn?: () => void }>({ encounters: [] });

function ActionControl({ actor, actionId, label, parameters, busy, offline, onAction }: { actor: Actor; actionId: string; label: string; parameters?: Record<string, unknown>; busy: boolean; offline: boolean; onAction: (actor: Actor, actionId: string, parameters?: Record<string, unknown>) => void }) {
  const action = actor.module.actions.find(item => item.id === actionId);
  const properties = action?.input?.properties || {};
  const required = action?.input?.required || [];
  const hostOnly = Boolean(action?.resolution) || !['selfService', 'gmReview'].includes(action?.policy || '');
  const [validationMessage, setValidationMessage] = useState('');
  const fields = Object.entries(properties);
  const unsupported = fields.find(([, schema]) => Array.isArray(schema.enum)
    ? !isSupportedActionEnum(schema)
    : !['string', 'integer', 'number'].includes(schema.type || ''));
  if (parameters) return <button type="button" disabled={busy || offline && hostOnly} title={offline && hostOnly ? 'Host connection required' : undefined} onClick={() => onAction(actor, actionId, parameters)}>{label}</button>;
  if (unsupported || required.some(key => !Object.hasOwn(properties, key))) {
    return <div className="character-action-input-error" role="status">{label} is unavailable because its module input schema cannot be collected safely.</div>;
  }
  if (!fields.length) return <button type="button" disabled={busy || offline && hostOnly} title={offline && hostOnly ? 'Host connection required' : undefined} onClick={() => onAction(actor, actionId, {})}>{label}</button>;

  const inputLabel = (key: string, schema?: { title?: string }) => schema?.title || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^./, value => value.toUpperCase());
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parameters: Record<string, unknown> = {};
    for (const [key, schema] of fields) {
      const control = event.currentTarget.elements.namedItem(key);
      if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement) || control.value === '') continue;
      if (Array.isArray(schema.enum)) {
        const value = getActionEnumValue(schema, control.value);
        if (value === undefined) continue;
        parameters[key] = value;
      } else {
        parameters[key] = schema.type === 'integer' || schema.type === 'number' ? Number(control.value) : control.value;
      }
    }
    setValidationMessage('');
    onAction(actor, actionId, parameters);
  };
  return <form className="character-action-form" aria-label={label} onSubmit={submit} onInvalidCapture={event => {
    const control = event.target;
    if (control instanceof HTMLInputElement && control.name) setValidationMessage(`Check ${inputLabel(control.name, properties[control.name])}: ${control.validationMessage}`);
  }}>
    {fields.map(([key, schema]) => {
      const fieldLabel = inputLabel(key, schema);
      const requiredField = required.includes(key);
      const constraints = [requiredField ? 'Required' : '', schema.type === 'integer' ? 'whole number' : schema.type === 'number' ? 'number' : '', schema.minimum !== undefined ? `minimum ${schema.minimum}` : '', schema.maximum !== undefined ? `maximum ${schema.maximum}` : ''].filter(Boolean).join('; ');
      return <label key={key}>{fieldLabel}{requiredField ? ' *' : ''}{Array.isArray(schema.enum)
        ? <select name={key} required={requiredField} defaultValue={getActionEnumIndex(schema, schema.default)} aria-describedby={`${actionId}-${key}-hint`}><option value="" disabled>Choose {fieldLabel.toLowerCase()}</option>{schema.enum?.map((value, index) => <option key={index} value={String(index)}>{String(value)}</option>)}</select>
        : <input name={key} type={schema.type === 'integer' || schema.type === 'number' ? 'number' : 'text'} step={schema.type === 'integer' ? 1 : schema.type === 'number' ? 'any' : undefined} required={requiredField} min={schema.minimum} max={schema.maximum} minLength={schema.minLength} maxLength={schema.maxLength} defaultValue={schema.default === undefined ? '' : String(schema.default)} aria-describedby={`${actionId}-${key}-hint`} />}
        {schema.description && <small>{schema.description}</small>}
        <small id={`${actionId}-${key}-hint`}>{constraints || 'Enter a value declared by this action.'}</small>
      </label>;
    })}
    {validationMessage && <p role="alert">{validationMessage}</p>}
    <button type="submit" disabled={busy || offline && hostOnly} title={offline && hostOnly ? 'Host connection required' : undefined}>{label}</button>
  </form>;
}

function declaredBrickDefinition(typeId: string): BrickDefinition<unknown> {
  const definition = getBrickDefinition(typeId);
  if (!definition) throw new Error(`Missing built-in brick metadata: ${typeId}`);
  return definition;
}

function valueAt(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((value, key) =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined, source);
}

export function CharacterView({ actor, busy, offline = false, onAction, compact, gm = false, encounters = [], onLinkEncounter }: { actor: Actor; busy: boolean; offline?: boolean; onAction: (actor: Actor, actionId: string, parameters?: Record<string, unknown>) => void; compact?: boolean; gm?: boolean; encounters?: Encounter[]; onLinkEncounter?: (encounterId: string) => void }) {
  const preparation = useContext(CharacterPreparationContext);
  const encounterOptions = encounters.length ? encounters : preparation.encounters;
  const linkEncounter = onLinkEncounter || ((encounterId: string) => preparation.onLinkEncounter?.(actor.entityId, encounterId));
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
    {actions.length > 0 && <div className="action-grid">{actions.map((item, index) => item.actionId && <ActionControl key={`${actor.entityId}-${item.actionId}-${index}`} actor={actor} actionId={item.actionId} label={item.label} parameters={compact ? item.parameters : undefined} busy={busy} offline={offline} onAction={onAction} />)}</div>}
    {gm && actor.secretNote && <div className="gm-note"><b>GM only</b> {actor.secretNote}</div>}
    {gm && !compact && <form className="character-encounter-link" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); linkEncounter(String(data.get('encounterId') || '')) }}><label>Link to encounter<select name="encounterId" defaultValue="" required disabled={busy || offline}><option value="" disabled>Choose an encounter</option>{encounterOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="submit" disabled={busy || offline || !encounterOptions.length}>Add as participant</button>{!encounterOptions.length && <small>No available encounters.</small>}</form>}
    {gm && !compact && preparation.onReturn && <button type="button" onClick={preparation.onReturn}>Return to encounter preparation</button>}
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

function MapSceneBrick({ data, adapter, onOpenApp, offline }: BrickRenderProps<MapSceneView>) {
  if (!data) return <p className="brick-message">This map is unavailable to your current host authorization.</p>;
  return <div className="map-brick"><button type="button" onClick={() => onOpenApp?.('maps', data.id)}>Open Maps app · {data.name}</button><MapCanvas scene={data} actors={adapter.getActorOptions().map(item => adapter.getActor(item.id)).filter((actor): actor is Actor => Boolean(actor))} showPrivate={adapter.getRole() === 'gm'} /><small>{data.kind} scene · {offline ? 'cached and read only' : `host revision ${data.revision}`}</small></div>;
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

function LoreArticleBrick({ data, onOpenApp }: BrickRenderProps<LoreArticle>) {
  return data ? <div className="lore-brick"><p className="eyebrow">{data.kind}</p><h3>{data.title}</h3><p>{data.body.slice(0, 360) || 'This article has no body yet.'}</p><button type="button" onClick={() => onOpenApp?.('lore', data.id)}>Open Lore</button></div> : <p className="brick-message">This Lore article is unavailable, archived, or not shared with you.</p>;
}

function RelatedLoreBrick({ data, onOpenApp, offline }: BrickRenderProps<LoreArticle[]>) {
  if (offline) return <p className="brick-message">Reconnect to refresh encounter-linked Lore.</p>;
  if (!data?.length) return <p className="brick-message">No accessible Lore is linked to this encounter.</p>;
  return <div className="lore-related">{data.map(item => <article key={item.id}><p className="eyebrow">{item.kind}</p><h3>{item.title}</h3><p>{item.body.slice(0, 140)}</p><button type="button" onClick={() => onOpenApp?.('lore', item.id)}>Open Lore</button></article>)}</div>;
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
const loreArticleDefinition: BrickDefinition<LoreArticle> = {
  ...declaredBrickDefinition('lore.article'),
  resolve: (binding, adapter) => binding.mode === 'pinned' ? adapter.getLore?.(binding.entityId) : undefined,
  render: LoreArticleBrick,
};
const loreRelatedDefinition: BrickDefinition<LoreArticle[]> = {
  ...declaredBrickDefinition('lore.related'),
  resolve: (binding, adapter) => binding.mode === 'follow' ? adapter.getRelatedLore?.() : undefined,
  render: RelatedLoreBrick,
};

const mapSceneDefinition: BrickDefinition<MapSceneView> = {
  ...declaredBrickDefinition('maps.scene'),
  supportedBindings: ['pinned', 'follow'],
  defaultBinding: { mode: 'follow', contextKey: 'session.activeEncounter' },
  resolve: resolveMapSceneBinding,
  render: MapSceneBrick,
};

export const brickDefinitions: BrickDefinition<unknown>[] = [characterDefinition, encounterDefinition, activityDefinition, tableSessionDefinition, tableParticipantsDefinition, tableActivityDefinition, loreArticleDefinition, loreRelatedDefinition, mapSceneDefinition] as unknown as BrickDefinition<unknown>[];
for (const definition of brickDefinitions) registerBrickDefinition(definition, true);

export function resolveDefaultBinding<TData>(definition: BrickDefinition<TData>, adapter: AuthorizedBrickDataAdapter): BrickBinding {
  if (definition.defaultBinding) return definition.defaultBinding;
  if (definition.supportedBindings.includes('none')) return { mode: 'none' };
  const options = definition.getBindingOptions?.(adapter) ?? [];
  if (definition.supportedBindings.includes('pinned')) return { mode: 'pinned', entityId: options[0]?.id ?? '' };
  return { mode: 'none' };
}


export type { BrickBinding };
