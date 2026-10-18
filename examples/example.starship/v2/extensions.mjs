import { createHash } from 'node:crypto';

const capability = id => ({ id, apiVersion: '1.0.0', implementationVersion: '1.0.0', digest: `sha256:${createHash('sha256').update(id).digest('hex')}` });

export const starshipRefs = {
  entity: capability('example.starship.reactor'),
  command: capability('example.starship.commands'),
  workflow: capability('example.starship.engineering'),
  powerResolver: capability('example.starship.power-resolver'),
  inspectResolver: capability('example.starship.inspect-resolver'),
  stabilizeResolver: capability('example.starship.stabilize-resolver'),
  cancelResolver: capability('example.starship.cancel-resolver'),
  allocateEffect: capability('example.starship.allocate-power'),
  stabilizeEffect: capability('example.starship.stabilize-reactor')
};

const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const empty = object({});
const outcomeSchema = { type: 'array', minItems: 0, maxItems: 4, items: object({ kind: { type: 'string', minLength: 1, maxLength: 80 }, data: { type: 'object', properties: {}, additionalProperties: true }, visibility: { type: 'string', enum: ['public', 'gm', 'private'] } }) };

export const starshipEntity = {
  descriptorVersion: 1,
  typeId: 'example.starship.reactor', schemaVersion: 1, capability: starshipRefs.entity,
  schema: object({
    power: { type: 'integer', minimum: 0, maximum: 100 }, safe: { type: 'boolean' },
    allocations: object({ propulsion: { type: 'integer', minimum: 0, maximum: 100 }, lifeSupport: { type: 'integer', minimum: 0, maximum: 100 } }),
    engineeringLog: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 160 } }
  }),
  ownership: { kind: 'principal' }, visibility: ['owner'], creationRoles: ['gm'],
  migration: { migrationId: 'example.starship.reactor.v1-initial', fromSchemaVersion: 0, toSchemaVersion: 1 }
};

const command = (commandId, resolver, inputSchema, permission, effects = []) => ({ descriptorVersion: 1, commandId, capability: starshipRefs.command, entityTypeId: starshipEntity.typeId, inputSchema, resultSchema: outcomeSchema, permission, resolver, effects });
const gmPower = { roles: ['gm'], ownership: 'any' };
const ownerCommand = { roles: ['gm', 'player'], ownership: 'owner-or-participant' };
const allocationInput = object({ subsystem: { type: 'string', enum: ['propulsion', 'lifeSupport'] }, amount: { type: 'integer', minimum: 0, maximum: 100 } });
const inspectInput = object({ finding: { type: 'string', minLength: 1, maxLength: 120 } });
const stabilizeInput = object({ tool: { type: 'string', minLength: 1, maxLength: 80 } });

export const starshipCommands = [
  command('example.starship.reactor.allocate-power', starshipRefs.powerResolver, allocationInput, gmPower, [starshipRefs.allocateEffect]),
  { ...command('example.starship.engineering.inspect', starshipRefs.inspectResolver, inspectInput, ownerCommand), workflowOnly: true },
  { ...command('example.starship.engineering.stabilize', starshipRefs.stabilizeResolver, stabilizeInput, ownerCommand, [starshipRefs.stabilizeEffect]), workflowOnly: true },
  { ...command('example.starship.engineering.cancel', starshipRefs.cancelResolver, empty, ownerCommand), workflowOnly: true }
];

export const starshipWorkflow = {
  descriptorVersion: 1, workflowType: 'example.starship.engineering.reactor-recovery', capability: starshipRefs.workflow,
  entityTypeId: starshipEntity.typeId, initialState: 'example.starship.engineering.unassessed',
  terminalStates: ['example.starship.engineering.safe', 'example.starship.engineering.aborted'],
  states: [
    { stateId: 'example.starship.engineering.unassessed', schema: empty },
    { stateId: 'example.starship.engineering.isolated', schema: object({ finding: { type: 'string', minLength: 1, maxLength: 120 } }) },
    { stateId: 'example.starship.engineering.safe', schema: object({ report: { type: 'string', minLength: 1, maxLength: 160 } }) },
    { stateId: 'example.starship.engineering.aborted', schema: empty }
  ],
  transitions: [
    { transitionId: 'example.starship.engineering.inspect-step', commandId: 'example.starship.engineering.inspect', from: ['example.starship.engineering.unassessed'], to: 'example.starship.engineering.isolated', kind: 'transition', participantPolicy: 'owner-or-participant' },
    { transitionId: 'example.starship.engineering.stabilize-step', commandId: 'example.starship.engineering.stabilize', from: ['example.starship.engineering.isolated'], to: 'example.starship.engineering.safe', kind: 'transition', participantPolicy: 'owner-or-participant' },
    { transitionId: 'example.starship.engineering.cancel-step', commandId: 'example.starship.engineering.cancel', from: ['example.starship.engineering.unassessed', 'example.starship.engineering.isolated'], to: 'example.starship.engineering.aborted', kind: 'cancel', participantPolicy: 'owner-or-participant' }
  ],
  expirationRoles: ['gm']
};

const resolver = (ref, resolve) => ({ ref, resolve });
export const starshipResolvers = [
  resolver(starshipRefs.powerResolver, input => {
    const subsystem = input.input.subsystem; const amount = input.input.amount;
    return { outcomes: [{ kind: 'reactor.power-allocated', data: { subsystem, amount }, visibility: 'gm' }], decisions: [], effects: [{ effectId: `${input.operationId}.allocate`, handler: starshipRefs.allocateEffect.id, targetId: input.state.entityId, payload: { subsystem, amount }, visibility: 'private' }] };
  }),
  resolver(starshipRefs.inspectResolver, input => ({ outcomes: [{ kind: 'reactor.inspected', data: { finding: input.input.finding }, visibility: 'public' }], decisions: [], effects: [], continuation: { continuationId: `${input.operationId}.inspection`, state: { finding: input.input.finding }, resumeOn: 'command', expiresAt: new Date(Date.parse(input.logicalTime) + 3600000).toISOString(), step: 1 } })),
  resolver(starshipRefs.stabilizeResolver, input => ({ outcomes: [{ kind: 'reactor.stabilized', data: { tool: input.input.tool }, visibility: 'private' }], decisions: [], effects: [{ effectId: `${input.operationId}.stabilize`, handler: starshipRefs.stabilizeEffect.id, targetId: input.state.entityId, payload: { tool: input.input.tool }, visibility: 'private' }], continuation: { continuationId: `${input.operationId}.stabilization`, state: { report: `Stabilized with ${input.input.tool}` }, resumeOn: 'command', expiresAt: new Date(Date.parse(input.logicalTime) + 3600000).toISOString(), step: 2 } })),
  resolver(starshipRefs.cancelResolver, input => ({ outcomes: [{ kind: 'reactor.recovery-cancelled', data: {}, visibility: 'gm' }], decisions: [], effects: [], continuation: { continuationId: `${input.operationId}.cancelled`, state: {}, resumeOn: 'command', expiresAt: new Date(Date.parse(input.logicalTime) + 3600000).toISOString(), step: 3 } }))
];

export const starshipEffectHandlers = [
  {
    ...starshipRefs.allocateEffect, atomic: true, conflict: 'reject-overlap', targetType: starshipEntity.typeId, targetVisibility: 'private',
    payloadSchema: object({ subsystem: { type: 'string', enum: ['propulsion', 'lifeSupport'] }, amount: { type: 'integer', minimum: 0, maximum: 100 } }),
    eventKind: 'reactor.power-allocated', eventVisibility: 'private', eventSchema: object({ effectId: { type: 'string' }, subsystem: { type: 'string' }, allocated: { type: 'integer', minimum: 0, maximum: 100 } }),
    apply: ({ entity, effect }) => {
      const allocations = { ...entity.data.allocations, [effect.payload.subsystem]: entity.data.allocations[effect.payload.subsystem] + effect.payload.amount };
      return { data: { ...entity.data, allocations }, revision: entity.revision + 1, event: { kind: 'reactor.power-allocated', visibility: 'private', payload: { effectId: effect.effectId, subsystem: effect.payload.subsystem, allocated: allocations[effect.payload.subsystem] } } };
    }
  },
  {
    ...starshipRefs.stabilizeEffect, atomic: true, conflict: 'reject-overlap', targetType: starshipEntity.typeId, targetVisibility: 'private',
    payloadSchema: object({ tool: { type: 'string', minLength: 1, maxLength: 80 } }),
    eventKind: 'reactor.stabilized', eventVisibility: 'private', eventSchema: object({ effectId: { type: 'string' }, report: { type: 'string' } }),
    apply: ({ entity, effect }) => ({ data: { ...entity.data, safe: true, engineeringLog: [...entity.data.engineeringLog, `Stabilized with ${effect.payload.tool}`].slice(-20) }, revision: entity.revision + 1, event: { kind: 'reactor.stabilized', visibility: 'private', payload: { effectId: effect.effectId, report: `Stabilized with ${effect.payload.tool}` } } })
  }
];
