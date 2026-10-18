import type { EffectHandlerDescriptor } from '../packages/contracts/src/effects.js';

const digest = `sha256:${'a'.repeat(64)}` as const;
const handler: EffectHandlerDescriptor = {
  id: 'example.module.state', apiVersion: '1.0.0', implementationVersion: '1.0.0', digest,
  atomic: true, targetType: 'example.module.scene', targetVisibility: 'public',
  payloadSchema: { type: 'object', properties: {} }, eventSchema: { type: 'object', properties: {} },
  eventKind: 'example.module.updated', eventVisibility: 'public', conflict: 'reject-overlap',
  apply: ({ entity, effect }) => ({
    data: effect.payload, revision: entity.revision + 1,
    event: { kind: 'example.module.updated', visibility: effect.visibility, payload: effect.payload }
  })
};

void handler;
