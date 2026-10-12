import assert from 'node:assert/strict';
import test from 'node:test';
import { getBrickDefinition, getBrickDefinitions, registerBrickDefinition } from './registry.ts';

test('a fourth trusted brick resolves only data exposed by its authorized adapter', () => {
  const unregister = registerBrickDefinition({
    typeId: 'test.trusted-feed',
    version: 1,
    ownerAppId: 'test',
    title: 'Trusted feed',
    supportedBindings: ['none'],
    defaultBinding: { mode: 'none' },
    defaultSize: { w: 2, h: 2 },
    resolve: (_binding, adapter) => adapter.getActivity(),
    render: () => null,
  });
  try {
    const allowedEntry = { id: 'event-visible', action: 'Allowed event', actor: 'Player', detail: '', time: '', visibility: 'all', cursor: 1 };
    const adapter = {
      getActor: () => undefined,
      getEncounter: () => undefined,
      getActorOptions: () => [],
      getEncounterOptions: () => [],
      getActiveEncounter: () => undefined,
      getActivity: () => [allowedEntry],
    };
    const definition = getBrickDefinition('test.trusted-feed');
    assert.ok(definition);
    assert.deepEqual(definition.resolve({ mode: 'none' }, adapter), [allowedEntry]);
    assert.equal(typeof definition.render, 'function');
    assert.equal(adapter.getActor('unavailable-entity'), undefined);
  } finally {
    unregister();
  }
  assert.equal(getBrickDefinition('test.trusted-feed'), undefined);
});

test('Table brick contributions are registered with safe context bindings', () => {
  const expected = ['table.session', 'table.participants', 'table.activity'];
  for (const typeId of expected) assert.ok(getBrickDefinition(typeId), `${typeId} is registered`);
  assert.ok(expected.every(typeId => getBrickDefinitions().some(definition => definition.typeId === typeId)));
  assert.deepEqual(getBrickDefinition('table.participants').defaultBinding, { mode: 'follow', contextKey: 'session.activeEncounter' });
  assert.deepEqual(getBrickDefinition('table.participants').supportedBindings, ['follow', 'pinned']);
  assert.deepEqual(getBrickDefinition('table.session').supportedBindings, ['none']);
});
