import test from 'node:test';
import assert from 'node:assert/strict';
import { resolver } from '../extensions.mjs';

const state = (overrides = {}) => ({
  entityId: 'player-decision-1',
  data: {
    role: 'navigator', progress: 0, danger: 0,
    tokens: { calm: 2, storm: 2, omen: 1 }, choices: [],
    ...overrides
  }
});
const resolve = (data, input) => resolver.resolve({ state: data, input });

test('calm observation consumes one token and advances progress deterministically', () => {
  const output = resolve(state(), { approach: 'observe', fate: 'calm' });
  assert.deepEqual(output.outcomes[0].data, { result: 'opening', progress: 1, danger: 0 });
  assert.equal(output.effects[0].payload.state.tokens.calm, 1);
  assert.deepEqual(output.effects[0].payload.state.choices, [{ approach: 'observe', fate: 'calm', result: 'opening' }]);
});

test('storm endurance increases danger and consumes committed resource', () => {
  const output = resolve(state(), { approach: 'endure', fate: 'storm' });
  assert.equal(output.outcomes[0].data.danger, 1);
  assert.equal(output.effects[0].payload.state.tokens.storm, 1);
});

test('bargaining with an omen advances both progress and danger', () => {
  const output = resolve(state(), { approach: 'bargain', fate: 'omen' });
  assert.deepEqual(output.outcomes[0].data, { result: 'revelation', progress: 1, danger: 1 });
});

test('exhausted fate pool is rejected without proposing an effect', () => {
  assert.throws(() => resolve(state({ tokens: { calm: 0, storm: 0, omen: 0 } }), { approach: 'observe', fate: 'calm' }), /resource_exhausted/);
});

test('invalid approach and fate inputs are rejected', () => {
  assert.throws(() => resolve(state(), { approach: 'attack', fate: 'calm' }), /invalid_approach/);
  assert.throws(() => resolve(state(), { approach: 'observe', fate: 'wild' }), /invalid_fate/);
});

test('progress, danger, token pools, and choice history remain bounded', () => {
  const full = state({ progress: 4, danger: 4, choices: Array.from({ length: 4 }, () => ({ approach: 'observe', fate: 'calm', result: 'opening' })) });
  const output = resolve(full, { approach: 'observe', fate: 'calm' });
  const next = output.effects[0].payload.state;
  assert.equal(next.progress, 4);
  assert.equal(next.choices.length, 4);
  assert.equal(next.tokens.calm, 1);
});

test('same committed state and input produce byte-for-byte equivalent proposals', () => {
  const first = resolve(state(), { approach: 'bargain', fate: 'omen' });
  const second = resolve(state(), { approach: 'bargain', fate: 'omen' });
  assert.deepEqual(second, first);
});
