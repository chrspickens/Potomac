import assert from 'node:assert/strict';
import test from 'node:test';
import { clampMapZoom, clampPoint, nearestGridPoint, positionForMove, selectEncounterPreviewScene, viewportToScene } from './maps.ts';

test('map zoom is clamped to 1–4 for every input method', () => {
  assert.equal(clampMapZoom(0.5), 1);
  assert.equal(clampMapZoom(1), 1);
  assert.equal(clampMapZoom(2.4), 2.4);
  assert.equal(clampMapZoom(8), 4);
  assert.equal(clampMapZoom(Number.NaN), 1);
});

test('encounter preview uses the assigned scene consistently for its background and geometry', () => {
  const assigned = { id: 'assigned', width: 120, height: 80, grid: { type: 'square', size: 10 }, background: { id: 'assigned-image' } };
  const selectedReusable = { id: 'reusable', width: 400, height: 300, grid: { type: 'hex', size: 20 }, background: { id: 'reusable-image' } };
  const scene = selectEncounterPreviewScene(assigned, [selectedReusable], 'reusable');
  const imageSource = selectEncounterPreviewScene(assigned, [selectedReusable], 'reusable');
  assert.equal(scene, assigned);
  assert.equal(imageSource, scene);
  assert.equal(imageSource?.background.id, scene?.background.id);
  assert.equal(selectEncounterPreviewScene(null, [selectedReusable], 'reusable'), selectedReusable);
});

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

test('opt-in square and hex snap applies only to proposed moves and keeps unsnapped fractional coordinates', () => {
  const squareScene = { width: 100, height: 80, grid: { type: 'square', size: 10 } };
  const hexScene = { width: 100, height: 80, grid: { type: 'hex', size: 10 } };
  const fractional = { x: 17.25, y: 32.75 };
  assert.deepEqual(positionForMove(fractional, squareScene, false), fractional);
  assert.deepEqual(positionForMove(fractional, squareScene, true), { x: 20, y: 30 });
  assert.deepEqual(positionForMove(fractional, hexScene, false), fractional);
  assert.deepEqual(positionForMove(fractional, hexScene, true), nearestGridPoint(fractional, hexScene.grid));
  assert.deepEqual(positionForMove({ x: 110, y: -2 }, squareScene, false), { x: 100, y: 0 });
});
