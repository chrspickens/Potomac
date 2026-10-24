import assert from 'node:assert/strict';
import test from 'node:test';
import { selectV2TaskEntity } from './v2-task-entities.ts';

const records = [
  { entityId: 'encounter-a', typeId: 'test.encounter', revision: 3 },
  { entityId: 'character-a', typeId: 'test.character', revision: 1 },
  { entityId: 'encounter-b', typeId: 'test.encounter', revision: 2 },
  { entityId: 'character-b', typeId: 'test.character', revision: 4 },
];
const preparedTypes = ['test.encounter'];

test('mixed character and encounter descriptors never select a record outside the active task', () => {
  for (const [view, staleSelection, expectedOptions, expectedActive] of [
    ['characters', 'encounter-b', ['character-a', 'character-b'], 'character-a'],
    ['encounters', 'character-a', ['encounter-a', 'encounter-b'], 'encounter-a'],
    ['table', 'character-b', ['encounter-a', 'encounter-b'], 'encounter-a'],
    ['workspace', 'encounter-b', ['encounter-a', 'character-a', 'encounter-b', 'character-b'], 'encounter-b'],
  ]) {
    const { taskEntities, entity } = selectV2TaskEntity(records, preparedTypes, view, staleSelection);
    assert.deepEqual(taskEntities.map(item => item.entityId), expectedOptions, view);
    assert.equal(entity?.entityId, expectedActive, view);
    assert.ok(taskEntities.includes(entity), `${view}: the displayed selection must be an option and the action target`);
  }
});

test('each task preserves its valid selection and safely handles missing or empty options', () => {
  assert.equal(selectV2TaskEntity(records, preparedTypes, 'characters', 'character-b').entity?.entityId, 'character-b');
  assert.equal(selectV2TaskEntity(records, preparedTypes, 'encounters', 'encounter-b').entity?.entityId, 'encounter-b');
  assert.equal(selectV2TaskEntity(records, preparedTypes, 'table', 'not-an-entity').entity?.entityId, 'encounter-a');

  const embeddedCharacters = records.filter(item => item.typeId === 'test.encounter');
  const characters = selectV2TaskEntity(embeddedCharacters, preparedTypes, 'characters', 'encounter-a');
  assert.deepEqual(characters.taskEntities, []);
  assert.equal(characters.entity, undefined);
  assert.equal(selectV2TaskEntity([], preparedTypes, 'table', 'encounter-a').entity, undefined);
});
