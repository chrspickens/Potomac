// Minimal trusted-bundled authoring shape. This file is executed by the validator.
const digest = 'sha256:32b30d763422e8c141b7a4c4a1d9d293fe7c708a5c64ba27009685ff817ec127';
const ref = id => ({ id, apiVersion: '1.0.0', implementationVersion: '1.0.0', digest });
export const refs = {
  root: ref('example.starter'), entity: ref('example.starter.scene'), command: ref('example.starter.advance'), resolver: ref('example.starter.advance-resolver'), handler: ref('example.starter.scene-state')
};
export const scene = {
  descriptorVersion: 1, typeId: refs.entity.id, schemaVersion: 1, capability: refs.entity,
  schema: { type: 'object', properties: { progress: { type: 'integer', minimum: 0, maximum: 3 } }, required: ['progress'], additionalProperties: false },
  ownership: { kind: 'campaign' }, visibility: ['public'], creationRoles: ['gm'],
  migration: { migrationId: 'example.starter.scene.v1', fromSchemaVersion: 0, toSchemaVersion: 1 }
};
export const resolver = {
  ref: refs.resolver,
  resolve: ({ state }) => ({ outcomes: [{ kind: 'advanced', data: { progress: state.progress + 1 }, visibility: 'public' }], decisions: [], effects: [{ effectId: 'advance-scene', handler: refs.handler.id, targetId: 'scene', payload: { progress: state.progress + 1 }, visibility: 'public' }] })
};
export const resolvers = [resolver];
export const handler = {
  ...refs.handler, atomic: true, conflict: 'reject-overlap', targetType: refs.entity.id,
  payloadSchema: { type: 'object', properties: { progress: { type: 'integer', minimum: 0, maximum: 3 } }, required: ['progress'], additionalProperties: false },
  eventKind: 'example.starter.scene-advanced', eventVisibility: 'public',
  eventSchema: { type: 'object', properties: { progress: { type: 'integer', minimum: 0, maximum: 3 } }, required: ['progress'], additionalProperties: false },
  apply: ({ entity, effect }) => ({ data: effect.payload, revision: entity.revision + 1, event: { kind: 'example.starter.scene-advanced', visibility: 'public', payload: effect.payload } })
};
export const effectHandlers = [handler];
export const commands = [{
  descriptorVersion: 1, commandId: refs.command.id, capability: refs.command, entityTypeId: refs.entity.id,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false }, resultSchema: { type: 'object', properties: {}, additionalProperties: true },
  permission: { roles: ['gm'], ownership: 'gm' }, resolver: refs.resolver, effects: [refs.handler]
}];
