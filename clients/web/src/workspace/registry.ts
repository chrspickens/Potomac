import type { BrickDefinition } from './types.ts';

const definitions: BrickDefinition<unknown>[] = [
  { typeId: 'characters.sheet', version: 1, ownerAppId: 'characters', title: 'Character Sheet', supportedBindings: ['pinned'], defaultSize: { w: 4, h: 3 }, resolve: () => undefined, render: () => null, validateOptions: isCharacterOptions, getBindingOptions: adapter => adapter.getActorOptions() },
  { typeId: 'encounters.summary', version: 1, ownerAppId: 'encounters', title: 'Encounter Summary', supportedBindings: ['follow', 'pinned'], defaultSize: { w: 4, h: 3 }, defaultBinding: { mode: 'follow', contextKey: 'session.activeEncounter' }, resolve: () => undefined, render: () => null, validateOptions: isEmptyRecord, getBindingOptions: adapter => adapter.getEncounterOptions() },
  { typeId: 'activity.log', version: 1, ownerAppId: 'activity', title: 'Activity Log', supportedBindings: ['none'], defaultSize: { w: 4, h: 3 }, defaultBinding: { mode: 'none' }, resolve: (_binding, adapter) => adapter.getActivity(), render: () => null, validateOptions: isEmptyRecord },
  { typeId: 'table.session', version: 1, ownerAppId: 'table', title: 'Session', supportedBindings: ['none'], defaultBinding: { mode: 'none' }, defaultSize: { w: 4, h: 2 }, resolve: (_binding, adapter) => adapter.getSession(), render: () => null, validateOptions: isEmptyRecord },
  { typeId: 'table.participants', version: 1, ownerAppId: 'table', title: 'Participants', supportedBindings: ['follow', 'pinned'], defaultBinding: { mode: 'follow', contextKey: 'session.activeEncounter' }, defaultSize: { w: 6, h: 4 }, resolve: (_binding, adapter) => adapter.getParticipants(), render: () => null, validateOptions: isEmptyRecord, getBindingOptions: adapter => adapter.getEncounterOptions() },
  { typeId: 'table.activity', version: 1, ownerAppId: 'table', title: 'Table Activity', supportedBindings: ['none'], defaultBinding: { mode: 'none' }, defaultSize: { w: 4, h: 3 }, resolve: (_binding, adapter) => adapter.getActivity(), render: () => null, validateOptions: isEmptyRecord },
];
const contributions = new Map<string, BrickDefinition<unknown>>(definitions.map(definition => [definition.typeId, definition]));

export function registerBrickDefinition<TData>(definition: BrickDefinition<TData>, replaceDeclared = false): () => void {
  if (!definition.typeId.trim() || !Number.isInteger(definition.version) || definition.version < 1) throw new Error('Brick contributions require a type ID and positive integer version');
  if (contributions.has(definition.typeId) && !replaceDeclared) throw new Error(`Brick type already registered: ${definition.typeId}`);
  const previous = contributions.get(definition.typeId);
  contributions.set(definition.typeId, definition as unknown as BrickDefinition<unknown>);
  return () => {
    if (contributions.get(definition.typeId) === definition && previous) contributions.set(definition.typeId, previous);
    else if (contributions.get(definition.typeId) === definition) contributions.delete(definition.typeId);
  };
}

export function getBrickDefinition(typeId: string): BrickDefinition<unknown> | undefined { return contributions.get(typeId); }
export function getBrickDefinitions(): BrickDefinition<unknown>[] { return [...contributions.values()]; }

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isEmptyRecord(value: unknown): value is Record<string, unknown> { return isRecord(value) && Object.keys(value).length === 0; }
function isCharacterOptions(value: unknown): value is Record<string, unknown> { return isRecord(value) && Object.keys(value).every(key => key === 'compact' && typeof value[key] === 'boolean'); }
