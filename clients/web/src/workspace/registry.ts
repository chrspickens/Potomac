import type { BrickDefinition } from './types.ts';

export const brickDefinitions: BrickDefinition[] = [
  {
    typeId: 'characters.sheet',
    version: 1,
    ownerAppId: 'characters',
    title: 'Character Sheet',
    supportedBindings: ['pinned'],
    defaultSize: { w: 4, h: 3 },
  },
  {
    typeId: 'encounters.summary',
    version: 1,
    ownerAppId: 'encounters',
    title: 'Encounter Summary',
    supportedBindings: ['follow', 'pinned'],
    defaultSize: { w: 4, h: 3 },
    defaultBinding: { mode: 'follow', contextKey: 'session.activeEncounter' },
  },
  {
    typeId: 'activity.log',
    version: 1,
    ownerAppId: 'activity',
    title: 'Activity Log',
    supportedBindings: ['none'],
    defaultSize: { w: 4, h: 3 },
    defaultBinding: { mode: 'none' },
  },
];

export function getBrickDefinition(typeId: string): BrickDefinition | undefined {
  return brickDefinitions.find((definition) => definition.typeId === typeId);
}
