import { useState } from 'react';
import { validateV2PreparationConstraints, type JsonValue, type V2PreparationConstraint } from '@potomac/contracts';
import { validateEntitySchemaValue, type EntityJsonSchema } from './v2-entity-schema';

export type V2PreparationMember = { memberId: string; displayName: string };
export type V2PreparationField = { path: string; label: string; type: 'text' | 'integer' | 'number' | 'member' | 'select'; min?: number; max?: number; options?: Array<{ value: string | number; label: string }> };
export type V2PreparationRepeater = { path: string; startIndex: number; minItems: number; maxItems: number; label: string; itemTemplatePath: string; idPath: string; namePath?: string; positionPath?: string; idPrefix: string; addLabel: string; removeLabel: string; fields: V2PreparationField[] };
export type V2PreparationPlacement = { participantsPath: string; positionPath: string; gridPath: string; blockedPath: string; namePath: string; title: string; description: string };
export type V2PreparationProfile = { entityTypeId: string; title: string; description: string; template: JsonValue; fields: V2PreparationField[]; assignmentPaths: string[]; repeaters?: V2PreparationRepeater[]; placement?: V2PreparationPlacement; constraints?: V2PreparationConstraint[] };

const getPath = (value: unknown, path: string): unknown => path.split('.').reduce((current, part) => current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined, value);
const setPath = (value: unknown, path: string, next: unknown): JsonValue => {
  const result = structuredClone(value) as Record<string, unknown>;
  const parts = path.split('.'); let current = result;
  for (const part of parts.slice(0, -1)) current = current[part] as Record<string, unknown>;
  current[parts.at(-1)!] = next;
  return result as JsonValue;
};

export function V2GuidedPreparationForm({ profile, schema, members, formId, disabled, submitLabel, onSubmit }: {
  profile: V2PreparationProfile; schema: EntityJsonSchema; members: V2PreparationMember[]; formId: string; disabled: boolean; submitLabel: string;
  onSubmit: (value: JsonValue, assignedMembers: string[]) => Promise<void>;
}) {
  const [value, setValue] = useState<JsonValue>(() => structuredClone(profile.template));
  const [submitting, setSubmitting] = useState(false);
  const errors = [
    ...validateEntitySchemaValue(schema, value),
    ...validateV2PreparationConstraints(value, profile.constraints),
    ...profile.fields.flatMap(field => {
      if (field.type !== 'integer' && field.type !== 'number') return [];
      const current = getPath(value, field.path);
      if (typeof current !== 'number' || !Number.isFinite(current)) return [];
      if (field.min !== undefined && current < field.min) return [`${field.label} must be at least ${field.min}.`];
      if (field.max !== undefined && current > field.max) return [`${field.label} must be at most ${field.max}.`];
      return [];
    }),
  ];
  const update = (path: string, next: unknown) => setValue(current => setPath(current, path, next));
  const addRepeaterItem = (repeater: V2PreparationRepeater) => setValue(current => {
    const items = getPath(current, repeater.path);
    const template = getPath(profile.template, repeater.itemTemplatePath);
    if (!Array.isArray(items) || !template || typeof template !== 'object' || Array.isArray(template) || items.length - repeater.startIndex >= repeater.maxItems) return current;
    const existingIds = new Set(items.flatMap(item => item && typeof item === 'object' && !Array.isArray(item) && typeof (item as Record<string, JsonValue>).id === 'string' ? [(item as Record<string, JsonValue>).id as string] : []));
    let suffix = 1;
    while (existingIds.has(`${repeater.idPrefix}${suffix}`)) suffix++;
    let created = setPath(template, repeater.idPath, `${repeater.idPrefix}${suffix}`);
    if (repeater.namePath) created = setPath(created, repeater.namePath, `Opponent ${suffix + repeater.startIndex - 1}`);
    if (profile.placement && repeater.positionPath) {
      const placement = profile.placement;
      const actors = getPath(current, placement.participantsPath);
      const grid = getPath(current, placement.gridPath);
      const blocked = getPath(current, placement.blockedPath);
      if (Array.isArray(actors) && grid && typeof grid === 'object' && !Array.isArray(grid)) {
        const dimensions = grid as Record<string, unknown>;
        const occupied = new Set(actors.flatMap(actor => {
          const point = getPath(actor, placement.positionPath);
          return point && typeof point === 'object' && !Array.isArray(point) && Number.isInteger((point as Record<string, unknown>).x) && Number.isInteger((point as Record<string, unknown>).y) ? [`${(point as Record<string, unknown>).x},${(point as Record<string, unknown>).y}`] : [];
        }));
        const blockedSquares = new Set(Array.isArray(blocked) ? blocked.flatMap(point => point && typeof point === 'object' && !Array.isArray(point) && Number.isInteger((point as Record<string, unknown>).x) && Number.isInteger((point as Record<string, unknown>).y) ? [`${(point as Record<string, unknown>).x},${(point as Record<string, unknown>).y}`] : []) : []);
        const width = typeof dimensions.width === 'number' ? dimensions.width : 0;
        const height = typeof dimensions.height === 'number' ? dimensions.height : 0;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (!occupied.has(`${x},${y}`) && !blockedSquares.has(`${x},${y}`)) {
              created = setPath(created, repeater.positionPath, { x, y });
              return setPath(current, repeater.path, [...items, created]);
            }
          }
        }
      }
    }
    return setPath(current, repeater.path, [...items, created]);
  });
  const removeRepeaterItem = (repeater: V2PreparationRepeater, itemIndex: number) => setValue(current => {
    const items = getPath(current, repeater.path);
    if (!Array.isArray(items) || items.length - repeater.startIndex <= repeater.minItems) return current;
    return setPath(current, repeater.path, items.filter((_, index) => index !== repeater.startIndex + itemIndex));
  });
  const participants = profile.placement ? getPath(value, profile.placement.participantsPath) : undefined;
  const grid = profile.placement ? getPath(value, profile.placement.gridPath) : undefined;
  const blocked = profile.placement ? getPath(value, profile.placement.blockedPath) : undefined;
  const actors = Array.isArray(participants) ? participants.filter((actor): actor is Record<string, JsonValue> => Boolean(actor && typeof actor === 'object' && !Array.isArray(actor))) : [];
  const selectedIdState = useState(() => String(actors[0]?.id ?? ''));
  const [selectedParticipantId, setSelectedParticipantId] = selectedIdState;
  const selectedParticipant = actors.find(actor => actor.id === selectedParticipantId) ?? actors[0];
  const selectedParticipantIndex = selectedParticipant ? actors.findIndex(actor => actor.id === selectedParticipant.id) : -1;
  const placementConfig = profile.placement;
  const gridRecord = grid && typeof grid === 'object' && !Array.isArray(grid) ? grid as Record<string, JsonValue> : undefined;
  const gridWidth = Number.isInteger(gridRecord?.width) ? Math.min(20, Number(gridRecord?.width)) : 0;
  const gridHeight = Number.isInteger(gridRecord?.height) ? Math.min(20, Number(gridRecord?.height)) : 0;
  const blockedKeys = new Set(Array.isArray(blocked) ? blocked.flatMap(square => square && typeof square === 'object' && !Array.isArray(square) && Number.isInteger((square as Record<string, JsonValue>).x) && Number.isInteger((square as Record<string, JsonValue>).y) ? [`${(square as Record<string, JsonValue>).x},${(square as Record<string, JsonValue>).y}`] : []) : []);
  const positionOf = (actor: Record<string, JsonValue>) => placementConfig ? getPath(actor, placementConfig.positionPath) as Record<string, JsonValue> | undefined : undefined;
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (errors.length || submitting || disabled) return;
    const assignedMembers = profile.assignmentPaths.map(path => String(getPath(value, path)));
    setSubmitting(true);
    try { await onSubmit(value, assignedMembers); }
    finally { setSubmitting(false); }
  };
  return <form className="v2-entity-create-form v2-guided-preparation-form" aria-label={profile.title} noValidate onSubmit={event => void submit(event)}>
    <h3>{profile.title}</h3><p>{profile.description}</p>
    {profile.fields.map((field, index) => <div className="v2-entity-field" key={field.path}>
      <label htmlFor={`${formId}-field-${index}`}>{field.label}</label>
      {field.type === 'member' ? <select id={`${formId}-field-${index}`} required value={String(getPath(value, field.path) ?? '')} disabled={disabled || submitting} onChange={event => update(field.path, event.target.value)}>
        <option value="">Choose an enrolled player</option>{members.map(member => <option key={member.memberId} value={member.memberId}>{member.displayName}</option>)}
      </select> : field.type === 'select' ? <select id={`${formId}-field-${index}`} value={String(getPath(value, field.path) ?? '')} disabled={disabled || submitting} onChange={event => { const option = field.options?.find(item => String(item.value) === event.target.value); if (option) update(field.path, option.value); }}>{field.options?.map(option => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}</select> : <input id={`${formId}-field-${index}`} type={field.type === 'text' ? 'text' : 'number'} step={field.type === 'integer' ? 1 : field.type === 'number' ? 'any' : undefined} min={field.type === 'integer' || field.type === 'number' ? field.min : undefined} max={field.type === 'integer' || field.type === 'number' ? field.max : undefined} value={String(getPath(value, field.path) ?? '')} disabled={disabled || submitting} onChange={event => update(field.path, field.type === 'text' ? event.target.value : event.target.value === '' ? undefined : Number(event.target.value))} />}
    </div>)}
    {profile.repeaters?.map((repeater, repeaterIndex) => {
      const items = getPath(value, repeater.path);
      const repeatedItems = Array.isArray(items) ? items.slice(repeater.startIndex) : [];
      return <fieldset className="v2-preparation-repeater" key={repeater.path}>
        <legend>{repeater.label} ({repeatedItems.length} of {repeater.maxItems})</legend>
        <p>Keep at least {repeater.minItems} enemy. Add up to {repeater.maxItems}; each has its own name and starting square.</p>
        {repeatedItems.map((item, itemIndex) => {
          const itemData = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
          const actorId = String((itemData as Record<string, JsonValue>).id ?? itemIndex);
          const actorName = String((itemData as Record<string, JsonValue>).name ?? `Opponent ${itemIndex + 1}`);
          return <fieldset className="v2-preparation-opponent" key={actorId}>
            <legend>Enemy {itemIndex + 1}: {actorName}</legend>
            {repeater.fields.map((field, fieldIndex) => {
              const fieldPath = `${repeater.path}.${repeater.startIndex + itemIndex}.${field.path}`;
              const inputId = `${formId}-repeater-${repeaterIndex}-${itemIndex}-${fieldIndex}`;
              return <div className="v2-entity-field" key={field.path}>
                <label htmlFor={inputId}>{field.label}</label>
                {field.type === 'select' ? <select id={inputId} value={String(getPath(value, fieldPath) ?? '')} disabled={disabled || submitting} onChange={event => { const option = field.options?.find(candidate => String(candidate.value) === event.target.value); if (option) update(fieldPath, option.value); }}>{field.options?.map(option => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}</select>
                  : <input id={inputId} type={field.type === 'text' ? 'text' : 'number'} step={field.type === 'integer' ? 1 : field.type === 'number' ? 'any' : undefined} min={field.min} max={field.max} value={String(getPath(value, fieldPath) ?? '')} disabled={disabled || submitting} onChange={event => update(fieldPath, field.type === 'text' ? event.target.value : event.target.value === '' ? undefined : Number(event.target.value))} />}
              </div>;
            })}
            <button type="button" disabled={disabled || submitting || repeatedItems.length <= repeater.minItems} onClick={() => removeRepeaterItem(repeater, itemIndex)}>{repeater.removeLabel}</button>
          </fieldset>;
        })}
        <button type="button" disabled={disabled || submitting || repeatedItems.length >= repeater.maxItems} onClick={() => addRepeaterItem(repeater)}>{repeater.addLabel}</button>
      </fieldset>;
    })}
    {placementConfig && gridWidth > 0 && gridHeight > 0 && <fieldset className="v2-preparation-placement">
      <legend>{placementConfig.title}</legend>
      <p>{placementConfig.description}</p>
      {selectedParticipant && <label htmlFor={`${formId}-placement-participant`}>Place this participant
        <select id={`${formId}-placement-participant`} value={String(selectedParticipant.id ?? '')} disabled={disabled || submitting} onChange={event => setSelectedParticipantId(event.target.value)}>{actors.map(actor => <option key={String(actor.id)} value={String(actor.id)}>{String(getPath(actor, placementConfig.namePath) ?? actor.id)}</option>)}</select>
      </label>}
      <div className="v2-preparation-grid" role="grid" aria-label="Initial encounter positions" style={{ gridTemplateColumns: `repeat(${gridWidth}, minmax(2.5rem, 1fr))` }}>
        {Array.from({ length: gridWidth * gridHeight }, (_, index) => {
          const x = index % gridWidth, y = Math.floor(index / gridWidth), key = `${x},${y}`;
          const occupant = actors.find(actor => { const position = positionOf(actor); return position?.x === x && position.y === y; });
          const isBlocked = blockedKeys.has(key);
          const isSelected = occupant?.id === selectedParticipant?.id;
          const label = isBlocked ? `Square ${x}, ${y}, blocked` : occupant ? `Square ${x}, ${y}, occupied by ${String(getPath(occupant, placementConfig.namePath) ?? 'participant')}` : `Choose square ${x}, ${y}`;
          return <button key={key} type="button" role="gridcell" className={`v2-preparation-grid-cell${isBlocked ? ' is-blocked' : ''}${occupant ? ' is-occupied' : ''}${isSelected ? ' is-selected' : ''}`} aria-label={label} title={label} disabled={disabled || submitting || isBlocked || Boolean(occupant && !isSelected) || selectedParticipantIndex < 0} onClick={() => selectedParticipant && update(`${placementConfig.participantsPath}.${selectedParticipantIndex}.${placementConfig.positionPath}`, { x, y })}>{isBlocked ? '■' : occupant ? String(getPath(occupant, placementConfig.namePath) ?? '?').split(/\s+/).map(word => word[0]).join('').slice(0, 2) : `${x},${y}`}</button>;
        })}
      </div>
      {selectedParticipant && <p role="status">{String(getPath(selectedParticipant, placementConfig.namePath) ?? 'Participant')} starts at ({String(positionOf(selectedParticipant)?.x ?? '—')}, {String(positionOf(selectedParticipant)?.y ?? '—')}). Occupied and blocked squares cannot be selected.</p>}
    </fieldset>}
    {errors.length > 0 && <ul className="v2-entity-validation" role="alert">{errors.map(error => <li key={error}>{error}</li>)}</ul>}
    <button type="submit" disabled={disabled || submitting || errors.length > 0 || members.length === 0}>{submitting ? 'Preparing…' : submitLabel}</button>
  </form>;
}
