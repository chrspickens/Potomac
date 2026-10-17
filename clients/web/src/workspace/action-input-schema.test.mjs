import assert from 'node:assert/strict';
import test from 'node:test';
import { getActionEnumIndex, getActionEnumValue, isSupportedActionEnum } from './action-input-schema.ts';

test('action enum selections preserve declared primitive types, including booleans', () => {
  const booleanSchema = { type: 'boolean', enum: [true, false] };
  assert.equal(isSupportedActionEnum(booleanSchema), true);
  assert.equal(getActionEnumIndex(booleanSchema, true), '0');
  assert.equal(getActionEnumIndex(booleanSchema, false), '1');
  assert.equal(getActionEnumValue(booleanSchema, '0'), true);
  assert.equal(getActionEnumValue(booleanSchema, '1'), false);
  assert.equal(getActionEnumValue(booleanSchema, ''), undefined);
  assert.equal(getActionEnumValue(booleanSchema, '2'), undefined);
});

test('action enum selections preserve numbers and strings without coercion', () => {
  assert.equal(getActionEnumValue({ type: 'integer', enum: [1, 2] }, '1'), 2);
  assert.equal(getActionEnumValue({ type: 'string', enum: ['1', '2'] }, '1'), '2');
});

test('unsupported or type-inconsistent action enums are rejected before submission', () => {
  for (const schema of [
    { type: 'string', enum: [true, false] },
    { type: 'boolean', enum: ['yes', 'no'] },
    { type: 'number', enum: [1, Number.NaN] },
    { enum: [{ value: 'unsafe' }] },
  ]) {
    assert.equal(isSupportedActionEnum(schema), false);
    assert.equal(getActionEnumValue(schema, '0'), undefined);
  }
});
