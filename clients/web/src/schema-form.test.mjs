import assert from 'node:assert/strict'
import test from 'node:test'
import { createSchemaDefaults } from './schema-form.ts'

test('schema defaults include nested module fields and exclude host metadata', () => {
  assert.deepEqual(createSchemaDefaults({ properties: {
    moduleId: { type: 'string' }, name: { type: 'string' },
    attributes: { type: 'object', properties: { strength: { type: 'integer', minimum: 1 }, intelligence: { type: 'integer', minimum: 1 } } },
    resources: { type: 'object', properties: { mana: { type: 'object', properties: { current: { type: 'integer' }, maximum: { type: 'integer', default: 8 } } } } },
  } }), { name: '', attributes: { strength: 1, intelligence: 1 }, resources: { mana: { current: 0, maximum: 8 } } })
})
