import assert from 'node:assert/strict'
import test from 'node:test'
import { fixturesForCampaign } from './fixture-bootstrap.ts'

const fixtures = [
  { id: 'a', module: { manifest: { id: 'example.system-a', version: '0.1.0' } } },
  { id: 'b', module: { manifest: { id: 'example.system-b', version: '0.1.0' } } },
]

test('campaign bootstrap selects only fixtures matching the pinned module and version', () => {
  assert.deepEqual(fixturesForCampaign(fixtures, { systemModuleId: 'example.system-a', systemModuleVersion: '0.1.0' }).map(item => item.id), ['a'])
  assert.deepEqual(fixturesForCampaign(fixtures, { systemModuleId: 'example.system-b', systemModuleVersion: '0.1.0' }).map(item => item.id), ['b'])
  assert.deepEqual(fixturesForCampaign(fixtures, { systemModuleId: 'example.system-a', systemModuleVersion: '2.0.0' }), [])
  assert.deepEqual(fixturesForCampaign(fixtures, { systemModuleId: null, systemModuleVersion: null }), [])
})
