import assert from 'node:assert/strict';
import test from 'node:test';
import { clampPoint, nearestGridPoint, viewportToScene } from './maps.ts';

test('viewport transforms preserve scene coordinates at any pan and zoom', () => {
  assert.deepEqual(viewportToScene({ x: 120, y: 100 }, { x: 20, y: 40 }, 2), { x: 50, y: 30 });
  const scenePoint = viewportToScene({ x: 54, y: 45 }, { x: 4, y: 5 }, 1);
  assert.deepEqual(scenePoint, { x: 50, y: 40 });
});

test('coordinate clamping is explicit and grid snapping is opt-in at the caller', () => {
  const exact = { x: 17.25, y: 32.75 };
  assert.deepEqual(clampPoint(exact, { width: 100, height: 100 }), exact);
  assert.deepEqual(clampPoint({ x: -4, y: 102 }, { width: 100, height: 100 }), { x: 0, y: 100 });
  assert.deepEqual(nearestGridPoint(exact, { type: 'square', size: 10 }), { x: 20, y: 30 });
});
