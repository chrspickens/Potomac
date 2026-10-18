import assert from 'node:assert/strict';
import test from 'node:test';
import { entitySchemaDefaults, validateEntitySchemaValue } from './v2-entity-schema.ts';

const schema = {
  type: 'object',
  properties: {
    role: { type: 'string', enum: ['navigator', 'keeper'] },
    resources: { type: 'object', properties: { calm: { type: 'integer', minimum: 0, maximum: 3 }, storm: { type: 'integer', minimum: 0, maximum: 3 } }, required: ['calm', 'storm'], additionalProperties: false },
    tags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 12 }, minItems: 1, maxItems: 3 }
  },
  required: ['role', 'resources', 'tags'],
  additionalProperties: false
};

test('schema defaults choose valid enum, nested required values, and bounded array items', () => {
  const value = entitySchemaDefaults(schema);
  assert.deepEqual(value, { role: 'navigator', resources: { calm: 0, storm: 0 }, tags: ['x'] });
  assert.deepEqual(validateEntitySchemaValue(schema, value), []);
});

test('schema validation reports missing required, nested numeric and array bounds', () => {
  assert.deepEqual(validateEntitySchemaValue(schema, { role: 'navigator', resources: { calm: -1 }, tags: [] }), [
    'entity.resources.storm is required.', 'entity.resources.calm must be at least 0.', 'entity.tags must contain at least 1 item(s).'
  ]);
});

test('schema validation rejects invalid enum, types, lengths and unexpected properties', () => {
  const errors = validateEntitySchemaValue(schema, { role: 'captain', resources: { calm: 1.5, storm: 0, extra: 2 }, tags: ['this label is much too long'] });
  assert.ok(errors.some(error => error.includes('role must be one of the listed values')));
  assert.ok(errors.some(error => error.includes('resources.calm must be a valid integer')));
  assert.ok(errors.some(error => error.includes('resources.extra is not allowed')));
  assert.ok(errors.some(error => error.includes('tags[0] is longer than')));
});
