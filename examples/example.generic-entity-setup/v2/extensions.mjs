const digest = 'sha256:f8e987b3dd4c191aca10709165eea94afef87263ff1df040bbbd635efcf46d4e';
const ref = id => ({ id, apiVersion: '1.0.0', implementationVersion: '1.0.0', digest });
export const refs = {
  root: ref('example.generic-entity-setup'), entity: ref('example.generic-entity-setup.entity'),
  command: ref('example.generic-entity-setup.command'), resolver: ref('example.generic-entity-setup.resolver'),
  effect: ref('example.generic-entity-setup.effect')
};

export const entity = {
  descriptorVersion: 1, typeId: refs.entity.id, schemaVersion: 1, capability: refs.entity,
  schema: { type: 'object', properties: {
    title: { type: 'string', minLength: 1, maxLength: 80 },
    role: { type: 'string', enum: ['navigator', 'keeper'] },
    resources: { type: 'object', properties: {
      calm: { type: 'integer', minimum: 0, maximum: 3 },
      omen: { type: 'integer', minimum: 0, maximum: 2 }
    }, required: ['calm', 'omen'], additionalProperties: false },
    tags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 24 }, minItems: 1, maxItems: 3 },
    progress: { type: 'integer', minimum: 0, maximum: 4 },
    lastChoice: { type: 'string', enum: ['none', 'observe', 'bargain'] }
  }, required: ['title', 'role', 'resources', 'tags', 'progress', 'lastChoice'], additionalProperties: false },
  ownership: { kind: 'principal' }, visibility: ['owner'], creationRoles: ['gm'],
  migration: { migrationId: 'example.generic-entity-setup.entity.v1', fromSchemaVersion: 0, toSchemaVersion: 1 }
};

export const resolver = { ref: refs.resolver, resolve: ({ state, input }) => {
  const progress = Math.min(4, state.data.progress + 1);
  const lastChoice = input.choice;
  const outcome = { role: state.data.role, choice: lastChoice, progress };
  return {
    outcomes: [{ kind: 'choice-recorded', data: outcome, visibility: 'private' }], decisions: [],
    effects: [{ effectId: 'record-choice', handler: refs.effect.id, targetId: state.entityId, payload: { progress, lastChoice }, visibility: 'private' }]
  };
} };
export const resolvers = [resolver];

const updateSchema = { type: 'object', properties: {
  progress: { type: 'integer', minimum: 0, maximum: 4 },
  lastChoice: { type: 'string', enum: ['none', 'observe', 'bargain'] }
}, required: ['progress', 'lastChoice'], additionalProperties: false };
export const effectHandler = {
  ...refs.effect, atomic: true, conflict: 'reject-overlap', targetType: refs.entity.id,
  payloadSchema: updateSchema, eventKind: 'example.generic-entity-setup.choice-recorded', eventVisibility: 'private', eventSchema: updateSchema,
  apply: ({ entity: current, effect }) => ({ data: { ...current.data, ...effect.payload }, revision: current.revision + 1, event: { kind: 'example.generic-entity-setup.choice-recorded', visibility: 'private', payload: effect.payload } })
};
export const effectHandlers = [effectHandler];

const resultSchema = { type: 'array', maxItems: 4, items: { type: 'object', properties: {
  kind: { type: 'string', minLength: 1, maxLength: 80 },
  data: { type: 'object', properties: {}, additionalProperties: true },
  visibility: { type: 'string', enum: ['public', 'gm', 'private'] }
}, required: ['kind', 'data', 'visibility'], additionalProperties: false } };
export const command = {
  descriptorVersion: 1, commandId: refs.command.id, capability: refs.command, entityTypeId: refs.entity.id,
  inputSchema: { type: 'object', properties: { choice: { type: 'string', enum: ['observe', 'bargain'] } }, required: ['choice'], additionalProperties: false },
  resultSchema, permission: { roles: ['player', 'gm'], ownership: 'owner' }, resolver: refs.resolver, effects: [refs.effect]
};
export const commands = [command];
