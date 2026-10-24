import assert from 'node:assert/strict';
import test from 'node:test';
import { canOpenV2TaskEntityInTable, selectV2TaskEntity } from './v2-task-entities.ts';

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

test('task switching keeps GM and player projections scoped and only hands encounters to Table', () => {
  const roleProjections = {
    gm: records,
    playerA: [records[0], records[1]],
    playerB: [records[2], records[3]],
  };
  for (const [role, visibleRecords] of Object.entries(roleProjections)) {
    const character = selectV2TaskEntity(visibleRecords, preparedTypes, 'characters', 'encounter-a').entity;
    assert.ok(character, `${role} falls back to an authorized standalone character after entering Characters`);
    assert.equal(character.typeId, 'test.character', `${role} Characters never selects an encounter record`);
    assert.equal(canOpenV2TaskEntityInTable('characters', character.typeId, preparedTypes), false, 'Characters cannot hand a standalone record to Table');

    const encounter = selectV2TaskEntity(visibleRecords, preparedTypes, 'encounters', character.entityId).entity;
    assert.ok(encounter, `${role} falls back to an authorized encounter after switching from Characters`);
    assert.equal(encounter.typeId, 'test.encounter');
    assert.ok(visibleRecords.includes(encounter), `${role} cannot acquire a record omitted from the host projection`);
    assert.equal(canOpenV2TaskEntityInTable('encounters', encounter.typeId, preparedTypes), true);

    const table = selectV2TaskEntity(visibleRecords, preparedTypes, 'table', character.entityId).entity;
    assert.equal(table?.entityId, encounter.entityId, `${role} Table ignores the stale character selection`);
    assert.equal(canOpenV2TaskEntityInTable('table', table.typeId, preparedTypes), false, 'Table does not offer a nested handoff to itself');
  }
});

test('legacy workspace handoff remains available only for prepared encounter records', () => {
  assert.equal(canOpenV2TaskEntityInTable('workspace', 'test.encounter', preparedTypes), true);
  assert.equal(canOpenV2TaskEntityInTable('workspace', 'test.character', preparedTypes), false);
  assert.equal(canOpenV2TaskEntityInTable('encounters', 'test.encounter', preparedTypes), true);
  assert.equal(canOpenV2TaskEntityInTable('characters', 'test.character', preparedTypes), false);
});
