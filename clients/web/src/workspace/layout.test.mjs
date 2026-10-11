import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutsOverlap, resolveBrickLayout } from './layout.ts';

function brick(id, layout, extra = {}) {
  return {
    id,
    typeId: `test.${id}`,
    definitionVersion: 1,
    binding: { mode: 'none' },
    options: { label: id },
    layout,
    ...extra,
  };
}

test('moves the active brick and pushes a colliding sibling down', () => {
  const input = [brick('a', { x: 0, y: 0, w: 4, h: 3 }), brick('b', { x: 0, y: 3, w: 4, h: 2 })];
  const result = resolveBrickLayout(input, 'a', { x: 0, y: 2, w: 4, h: 3 });

  assert.deepEqual(result.map(({ layout }) => layout), [
    { x: 0, y: 2, w: 4, h: 3 },
    { x: 0, y: 5, w: 4, h: 2 },
  ]);
  assert.equal(layoutsOverlap(result[0].layout, result[1].layout), false);
});

test('resizes the active brick while preserving non-colliding sibling placement', () => {
  const input = [brick('a', { x: 0, y: 0, w: 4, h: 2 }), brick('b', { x: 5, y: 0, w: 3, h: 2 })];
  const result = resolveBrickLayout(input, 'a', { x: 0, y: 0, w: 6, h: 4 });
  assert.deepEqual(result[0].layout, { x: 0, y: 0, w: 6, h: 4 });
  assert.deepEqual(result[1].layout, { x: 5, y: 4, w: 3, h: 2 });
});

test('clamps the active brick to the grid and enforces minimum dimensions', () => {
  const input = [brick('a', { x: 0, y: 0, w: 2, h: 2 })];
  const [result] = resolveBrickLayout(input, 'a', { x: -5, y: -2, w: 40, h: 1 }, 8);
  assert.deepEqual(result.layout, { x: 0, y: 0, w: 8, h: 2 });
});

test('repairs preexisting sibling overlaps deterministically in stable order', () => {
  const input = [
    brick('active', { x: 0, y: 0, w: 2, h: 2 }),
    brick('first', { x: 4, y: 0, w: 3, h: 3 }),
    brick('second', { x: 5, y: 1, w: 3, h: 2 }),
    brick('third', { x: 4, y: 2, w: 3, h: 2 }),
  ];
  const result = resolveBrickLayout(input, 'active', input[0].layout, 8);

  assert.deepEqual(result.map((item) => item.layout), [
    { x: 0, y: 0, w: 2, h: 2 },
    { x: 4, y: 0, w: 3, h: 3 },
    { x: 5, y: 3, w: 3, h: 2 },
    { x: 4, y: 5, w: 3, h: 2 },
  ]);
  for (let i = 0; i < result.length; i += 1) {
    for (let j = i + 1; j < result.length; j += 1) {
      assert.equal(layoutsOverlap(result[i].layout, result[j].layout), false);
    }
  }
});

test('does not mutate inputs and preserves identity, options, and bindings', () => {
  const first = brick('a', { x: 1, y: 2, w: 3, h: 2 }, {
    binding: { mode: 'pinned', entityId: 'entity-1' },
    options: { color: 'blue', nested: { value: 4 } },
  });
  const second = brick('b', { x: 1, y: 4, w: 3, h: 2 });
  const before = structuredClone([first, second]);
  const result = resolveBrickLayout([first, second], 'a', { x: 1, y: 3, w: 3, h: 2 });

  assert.deepEqual([first, second], before);
  assert.notEqual(result[0], first);
  assert.equal(result[0].id, first.id);
  assert.equal(result[0].options, first.options);
  assert.equal(result[0].binding, first.binding);
  assert.deepEqual(Object.keys(result[0]).sort(), Object.keys(first).sort());
});

test('keeps the persisted brick shape JSON-compatible after resolving layout', () => {
  const input = [brick('sheet', { x: 1, y: 2, w: 4, h: 3 }, {
    binding: { mode: 'pinned', entityId: 'character-7' },
    options: { showPortrait: true },
  })];
  const [resolved] = resolveBrickLayout(input, 'sheet', { x: 3, y: 4, w: 5, h: 4 });
  const restored = JSON.parse(JSON.stringify(resolved));

  assert.deepEqual(restored, {
    id: 'sheet',
    typeId: 'test.sheet',
    definitionVersion: 1,
    binding: { mode: 'pinned', entityId: 'character-7' },
    options: { showPortrait: true },
    layout: { x: 3, y: 4, w: 5, h: 4 },
  });
});

test('returns a new array without changing layout when active ID is missing', () => {
  const input = [brick('a', { x: 0, y: 0, w: 2, h: 2 })];
  const result = resolveBrickLayout(input, 'missing', { x: 3, y: 3, w: 2, h: 2 });
  assert.notEqual(result, input);
  assert.deepEqual(result, input);
});
