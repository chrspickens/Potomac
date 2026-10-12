import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluate, executeAction, getRequiredRollCount } from './index.ts';

const literal = (value) => ({ literal: value });
const binary = (op, left, right) => ({ op, left, right });

test('evaluates scalar types, arithmetic, comparison and boolean expressions', () => {
  const state = { traits: { instinct: 3 }, enabled: true, title: 'Scout' };
  assert.equal(evaluate({ ref: 'traits.instinct' }, state), 3);
  assert.equal(evaluate(binary('add', literal(2), literal(3)), state), 5);
  assert.equal(evaluate(binary('subtract', literal(9), literal(4)), state), 5);
  assert.equal(evaluate(binary('multiply', literal(3), literal(4)), state), 12);
  assert.equal(evaluate(binary('divide', literal(12), literal(3)), state), 4);
  assert.equal(evaluate(binary('gte', literal(3), literal(3)), state), true);
  assert.equal(evaluate(binary('eq', literal('Scout'), { ref: 'title' }), state), true);
  assert.equal(evaluate({ op: 'not', value: { ref: 'enabled' } }, state), false);
  assert.equal(evaluate(binary('and', { ref: 'enabled' }, literal(true)), state), true);
  assert.equal(evaluate(binary('or', { ref: 'enabled' }, literal(false)), state), true);
});

test('rejects invalid, missing, composite and inherited references', () => {
  const state = { traits: { instinct: 3 }, nil: null };
  assert.throws(() => evaluate({ ref: 'traits.missing' }, state), /Unknown field reference/);
  assert.throws(() => evaluate({ ref: 'nil' }, state), /Invalid scalar reference/);
  assert.throws(() => evaluate({ ref: 'traits' }, state), /Invalid scalar reference/);
  assert.throws(() => evaluate({ ref: 'toString' }, state), /Unknown field reference/);
  assert.throws(() => evaluate({ ref: '__proto__.polluted' }, state), /Invalid field reference/);
  assert.throws(() => evaluate(binary('add', literal(1), literal('1')), state), /expects numbers/);
  assert.throws(() => evaluate(binary('and', literal(true), literal(1)), state), /expects booleans/);
});

test('rejects division by zero and non-finite arithmetic', () => {
  assert.throws(() => evaluate(binary('div', literal(1), literal(0)), {}), /Division by zero/);
  assert.throws(() => evaluate(binary('multiply', literal(Number.MAX_VALUE), literal(2)), {}), /Non-finite/);
});

test('bounds expression depth and total evaluation budget', () => {
  let deep = literal(1);
  for (let i = 0; i < 34; i++) deep = { op: 'not', value: deep };
  assert.throws(() => evaluate(deep, {}), /depth exceeded/);
  let broad = literal(1);
  for (let i = 0; i < 8; i++) broad = binary('add', broad, broad);
  assert.throws(() => evaluate(broad, {}), /budget exhausted/);
});

test('applies bounded resource effects without mutating input and enforces preconditions', () => {
  const state = { resources: { mana: { current: 2, maximum: 4 } } };
  const action = { id: 'spend', requires: binary('gt', { ref: 'resources.mana.current' }, literal(0)), effects: [
    { op: 'changeResource', target: 'self', resource: 'mana.current', amount: literal(-1) },
  ] };
  const result = executeAction(action, state);
  assert.equal(result.state.resources.mana.current, 1);
  assert.equal(state.resources.mana.current, 2);
  assert.throws(() => executeAction({ ...action, effects: [{ ...action.effects[0], amount: literal(-3) }] }, state), /out of bounds/);
  assert.throws(() => executeAction({ ...action, requires: literal(false) }, state), /precondition/);
});

test('validates host random inputs against both system dice definitions', () => {
  const systemA = { id: 'system-a-check', effects: [], resolution: { dice: [{ count: 1, sides: 20 }] } };
  const systemB = { id: 'system-b-check', effects: [], resolution: { dice: [{ count: 2, sides: 6, role: 'hope' }, { count: 2, sides: 6, role: 'stress' }] } };
  assert.deepEqual(executeAction(systemA, {}, [17]).rolls, [17]);
  assert.deepEqual(executeAction(systemB, {}, [1, 6, 2, 5]).rolls, [1, 6, 2, 5]);
  assert.equal(getRequiredRollCount(systemA), 1);
  assert.equal(getRequiredRollCount(systemB), 4);
  for (const rolls of [[], [0], [21], [1, 2]]) assert.throws(() => executeAction(systemA, {}, rolls), /roll results/);
  for (const rolls of [[1, 2, 3], [1, 2, 3, 7]]) assert.throws(() => executeAction(systemB, {}, rolls), /roll results/);
  assert.throws(() => getRequiredRollCount({ effects: [], resolution: { dice: [{ count: 257, sides: 6 }] } }), /budget exhausted/);
  assert.throws(() => getRequiredRollCount({ effects: [], resolution: { dice: [{ count: 1.5, sides: 6 }] } }), /Invalid dice definition/);
});
