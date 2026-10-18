import { createHash } from 'node:crypto';

const ref = id => ({ id, apiVersion: '1.0.0', implementationVersion: '1.0.0', digest: `sha256:${createHash('sha256').update(id).digest('hex')}` });
export const interruptionRefs = {
  entity: ref('example.interruption.record'), command: ref('example.interruption.commands'),
  resolver: ref('example.interruption.request-resolver'), effect: ref('example.interruption.record-decision')
};
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const empty = object({});
const resultSchema = { type: 'array', maxItems: 4, items: object({ kind: { type: 'string', minLength: 1, maxLength: 80 }, data: { type: 'object', properties: {}, additionalProperties: true }, visibility: { type: 'string', enum: ['public', 'gm', 'private'] } }) };
export const interruptionEntity = {
  descriptorVersion: 1, typeId: 'example.interruption.record', schemaVersion: 1, capability: interruptionRefs.entity,
  schema: object({ title: { type: 'string', minLength: 1, maxLength: 80 }, status: { type: 'string', enum: ['ready', 'accepted', 'declined', 'expired'] }, lastChoice: { type: 'string', enum: ['none', 'accept', 'decline', 'expired'] }, gmNote: { type: 'string', maxLength: 120 } }),
  ownership: { kind: 'principal' }, visibility: ['owner'], creationRoles: ['gm'], fieldVisibility: [{ path: 'gmNote', roles: ['gm'] }],
  migration: { migrationId: 'example.interruption.record.v1-initial', fromSchemaVersion: 0, toSchemaVersion: 1 }
};
export const interruptionCommands = [{ descriptorVersion: 1, commandId: 'example.interruption.request', capability: interruptionRefs.command, entityTypeId: interruptionEntity.typeId,
  inputSchema: empty, resultSchema, permission: { roles: ['player', 'gm'], ownership: 'owner-or-participant' }, resolver: interruptionRefs.resolver, effects: [interruptionRefs.effect] }];
const choiceSchema = object({ choice: { type: 'string', enum: ['accept', 'decline'] } });
const intent = { ordering: 'priorityThenSubmission', visibility: 'gm', audiences: [{ audience: 'entity-owner', priority: 1, actions: [{ actionId: 'example.interruption.choose', inputSchema: choiceSchema, visibility: 'public' }] }] };
export const interruptionResolvers = [{ ref: interruptionRefs.resolver,
  randomRequests: ({ randomness }) => randomness.length ? [] : [{ requestId: 'suspension-audit-draw', kind: 'die', count: 1, sides: 20, visibility: 'gm' }],
  resolve: input => ({ outcomes: [{ kind: 'interruption.requested', data: { title: input.state.data.title }, visibility: 'public' }], decisions: [], effects: [], continuation: { continuationId: `${input.operationId}.continuation`, state: { secretPrompt: 'The hidden table prompt is: choose whether the signal is trusted.' }, resumeOn: 'reaction', expiresAt: new Date(Date.parse(input.logicalTime) + 60 * 60 * 1000).toISOString(), step: 1, reaction: intent } }),
  randomRequestsResume: undefined,
  resume: input => {
    const decision = input.reaction.decisions.find(item => item.decision === 'accept');
    const lastChoice = input.reaction.status === 'expired' ? 'expired' : decision ? 'accept' : 'decline';
    const status = lastChoice === 'accept' ? 'accepted' : lastChoice === 'decline' ? 'declined' : 'expired';
    return { outcomes: [
      { kind: 'interruption.completed', data: { status: lastChoice }, visibility: 'public' },
      { kind: 'interruption.gm-note', data: { note: input.continuation.state.secretPrompt, die: input.randomness[0]?.values[0] }, visibility: 'gm' }
    ], decisions: [], effects: [{ effectId: `${input.operationId}.decision`, handler: interruptionRefs.effect.id, targetId: input.state.entityId, payload: { status, lastChoice, gmNote: input.continuation.state.secretPrompt }, visibility: 'private' }] };
  }
}];
export const interruptionEffectHandlers = [{ ...interruptionRefs.effect, atomic: true, conflict: 'reject-overlap', targetType: interruptionEntity.typeId, targetVisibility: 'private',
  payloadSchema: object({ status: { type: 'string', enum: ['accepted', 'declined', 'expired'] }, lastChoice: { type: 'string', enum: ['accept', 'decline', 'expired'] }, gmNote: { type: 'string', maxLength: 120 } }),
  eventKind: 'interruption.completed', eventVisibility: 'private', eventSchema: object({ effectId: { type: 'string' }, status: { type: 'string' } }),
  apply: ({ entity, effect }) => ({ data: { ...entity.data, status: effect.payload.status, lastChoice: effect.payload.lastChoice, gmNote: effect.payload.gmNote }, revision: entity.revision + 1,
    event: { kind: 'interruption.completed', visibility: 'private', payload: { effectId: effect.effectId, status: effect.payload.status } } })
}];
