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

test('Lore brick adapters expose only active, explicitly linked Lore IDs', async () => {
  const { createAuthorizedBrickAdapter } = await import('./authorized-adapter.ts');
  const article = { id: 'lore-visible', title: 'Archive', kind: 'location', tags: [], body: '', revision: 1, visibility: 'shared', archived: false };
  const archived = { ...article, id: 'lore-archived', archived: true };
  const active = { id: 'encounter-a', name: 'A', summary: '', loreIds: [article.id, archived.id, 'forged-id'] };
  const adapter = createAuthorizedBrickAdapter([], [active], active, [], undefined, 'player', [article, archived]);
  assert.equal(adapter.getLore(article.id), article);
  assert.equal(adapter.getLore(archived.id), undefined);
  assert.deepEqual(adapter.getRelatedLore(), [article]);
  assert.equal(adapter.getLore('forged-id'), undefined);
});
