import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthorizedBrickAdapter, resolveTableParticipants } from './authorized-adapter.ts';

const actor = (entityId, name) => ({ entityId, name });
const encounter = (id, participants) => ({ id, name: id, summary: '', participants });

test('Table participants resolve the authorized assigned roster for follow and pinned bindings', () => {
  const firstActor = actor('actor-1', 'First');
  const secondActor = actor('actor-2', 'Second');
  const firstEncounter = encounter('encounter-1', [
    { actorId: firstActor.entityId, status: 'active' },
    { actorId: 'not-authorized', status: 'active' },
  ]);
  const secondEncounter = encounter('encounter-2', [{ actorId: secondActor.entityId, status: 'waiting' }]);
  const firstAdapter = createAuthorizedBrickAdapter([firstActor, secondActor], [firstEncounter, secondEncounter], firstEncounter, [], undefined, 'gm');

  assert.deepEqual(resolveTableParticipants({ mode: 'follow', contextKey: 'session.activeEncounter' }, firstAdapter), [
    { actor: firstActor, status: 'active' },
  ]);
  assert.deepEqual(resolveTableParticipants({ mode: 'pinned', entityId: secondEncounter.id }, firstAdapter), [
    { actor: secondActor, status: 'waiting' },
  ]);

  const changedEncounterAdapter = createAuthorizedBrickAdapter([firstActor, secondActor], [firstEncounter, secondEncounter], secondEncounter, [], undefined, 'gm');
  assert.deepEqual(resolveTableParticipants({ mode: 'follow', contextKey: 'session.activeEncounter' }, changedEncounterAdapter), [
    { actor: secondActor, status: 'waiting' },
  ]);
  assert.deepEqual(resolveTableParticipants({ mode: 'pinned', entityId: firstEncounter.id }, changedEncounterAdapter), [
    { actor: firstActor, status: 'active' },
  ]);
});
