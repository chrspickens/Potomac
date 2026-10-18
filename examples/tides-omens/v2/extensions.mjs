// Trusted bundled module entry. Resolver and handler are pure and use no ambient randomness.
const digest = 'sha256:62ba14cf92848e6111c77ef8e2b2936fe5545542ca5cb4d4e89dd796a56bf5da';
const ref = id => ({ id, apiVersion: '1.0.0', implementationVersion: '1.0.0', digest });
export const refs = {
  root: ref('example.tides-omens'),
  entity: ref('example.tides-omens.player-decision'),
  command: ref('example.tides-omens.choose-fate'),
  resolver: ref('example.tides-omens.choose-fate-resolver'),
  handler: ref('example.tides-omens.decision-state')
};

export const decisionSchema = {
  type: 'object',
  properties: {
    role: { type: 'string', enum: ['navigator', 'keeper'] },
    progress: { type: 'integer', minimum: 0, maximum: 4 },
    danger: { type: 'integer', minimum: 0, maximum: 4 },
    tokens: {
      type: 'object',
      properties: {
        calm: { type: 'integer', minimum: 0, maximum: 3 },
        storm: { type: 'integer', minimum: 0, maximum: 3 },
        omen: { type: 'integer', minimum: 0, maximum: 3 }
      },
      required: ['calm', 'storm', 'omen'],
      additionalProperties: false
    },
    choices: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          approach: { type: 'string', enum: ['observe', 'bargain', 'endure'] },
          fate: { type: 'string', enum: ['calm', 'storm', 'omen'] },
          result: { type: 'string', enum: ['opening', 'setback', 'revelation'] }
        },
        required: ['approach', 'fate', 'result'],
        additionalProperties: false
      },
      maxItems: 4
    }
  },
  required: ['role', 'progress', 'danger', 'tokens', 'choices'],
  additionalProperties: false
};

export const scene = {
  descriptorVersion: 1,
  typeId: refs.entity.id,
  schemaVersion: 1,
  capability: refs.entity,
  schema: decisionSchema,
  ownership: { kind: 'principal' },
  visibility: ['owner', 'gm'],
  creationRoles: ['gm'],
  migration: { migrationId: 'example.tides-omens.player-decision.v1', fromSchemaVersion: 0, toSchemaVersion: 1 }
};

export const inputSchema = {
  type: 'object',
  properties: {
    approach: { type: 'string', enum: ['observe', 'bargain', 'endure'] },
    fate: { type: 'string', enum: ['calm', 'storm', 'omen'] }
  },
  required: ['approach', 'fate'],
  additionalProperties: false
};

const outcomeSchema = {
  type: 'array', maxItems: 1,
  items: {
    type: 'object',
    properties: {
      kind: { type: 'string', minLength: 1, maxLength: 80 },
      data: { type: 'object', properties: {}, additionalProperties: true },
      visibility: { type: 'string', enum: ['public', 'gm', 'private'] }
    },
    required: ['kind', 'data', 'visibility'],
    additionalProperties: false
  }
};

export const resolver = {
  ref: refs.resolver,
  resolve: ({ state, input }) => {
    const data = state.data;
    if (!['observe', 'bargain', 'endure'].includes(input.approach)) throw new Error('invalid_approach');
    if (!['calm', 'storm', 'omen'].includes(input.fate)) throw new Error('invalid_fate');
    if (!Number.isInteger(data.tokens?.[input.fate]) || data.tokens[input.fate] <= 0) throw new Error('resource_exhausted');

    const tokens = { ...data.tokens, [input.fate]: data.tokens[input.fate] - 1 };
    const next = { ...data, tokens };
    let result;
    if (input.fate === 'calm' || input.approach === 'observe') {
      next.progress = Math.min(4, data.progress + 1);
      result = 'opening';
    } else if (input.fate === 'storm' || input.approach === 'endure') {
      next.danger = Math.min(4, data.danger + 1);
      result = 'setback';
    } else {
      next.progress = Math.min(4, data.progress + 1);
      next.danger = Math.min(4, data.danger + 1);
      result = 'revelation';
    }
    if (input.approach === 'bargain' && result === 'opening' && tokens.calm < 3) tokens.calm += 1;
    next.choices = [...data.choices, { approach: input.approach, fate: input.fate, result }].slice(-4);

    return {
      outcomes: [{ kind: `tides-omens.${result}`, data: { result, progress: next.progress, danger: next.danger }, visibility: 'public' }],
      decisions: [],
      effects: [{ effectId: 'record-fate-choice', handler: refs.handler.id, targetId: state.entityId, payload: { state: next }, visibility: 'public' }]
    };
  }
};
export const resolvers = [resolver];

export const handler = {
  ...refs.handler,
  atomic: true,
  conflict: 'reject-overlap',
  targetType: refs.entity.id,
  targetVisibility: 'owner',
  payloadSchema: { type: 'object', properties: { state: decisionSchema }, required: ['state'], additionalProperties: false },
  eventKind: 'tides-omens.fate-chosen',
  eventVisibility: 'public',
  eventSchema: {
    type: 'object',
    properties: {
      role: { type: 'string', enum: ['navigator', 'keeper'] },
      progress: { type: 'integer', minimum: 0, maximum: 4 },
      danger: { type: 'integer', minimum: 0, maximum: 4 }
    },
    required: ['role', 'progress', 'danger'],
    additionalProperties: false
  },
  apply: ({ entity, effect }) => ({
    data: effect.payload.state,
    revision: entity.revision + 1,
    event: {
      kind: 'tides-omens.fate-chosen', visibility: 'public',
      payload: { role: effect.payload.state.role, progress: effect.payload.state.progress, danger: effect.payload.state.danger }
    }
  })
};
export const effectHandlers = [handler];

export const commands = [{
  descriptorVersion: 1,
  commandId: refs.command.id,
  capability: refs.command,
  entityTypeId: refs.entity.id,
  inputSchema,
  resultSchema: outcomeSchema,
  permission: { roles: ['player'], ownership: 'owner', effectTargetPolicy: 'source-entity' },
  resolver: refs.resolver,
  effects: [refs.handler]
}];
