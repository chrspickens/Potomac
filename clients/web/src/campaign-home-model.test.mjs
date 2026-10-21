import test from 'node:test'
import assert from 'node:assert/strict'
import { campaignHomeActivity, campaignHomeIdentity, campaignHomeState, lastPreparedEncounter } from './campaign-home-model.ts'

const snapshot = {
  role: 'player', memberId: 'member-1', actors: [{ entityId: 'a' }], encounters: [],
  context: { campaignId: 'campaign-1', activeEncounter: null, cursor: 3 },
  activity: [
    { id: 'public', visibility: 'all' },
    { id: 'private', visibility: 'gm' },
  ],
}

test('Campaign Home distinguishes loading, unavailable, offline, error, empty and ready', () => {
  assert.equal(campaignHomeState({ snapshot: null, connection: 'connecting' }), 'loading')
  assert.equal(campaignHomeState({ snapshot: null, connection: 'disconnected' }), 'unavailable')
  assert.equal(campaignHomeState({ snapshot, connection: 'disconnected' }), 'offline')
  assert.equal(campaignHomeState({ snapshot, connection: 'connected', error: 'failed' }), 'error')
  assert.equal(campaignHomeState({ snapshot: { ...snapshot, actors: [], encounters: [] }, connection: 'connected' }), 'empty')
  assert.equal(campaignHomeState({ snapshot, connection: 'connected' }), 'ready')
})

test('Campaign Home activity requires a role-matched projection and omits GM-only events for players', () => {
  assert.deepEqual(campaignHomeActivity(snapshot, 'player').map(item => item.id), ['public'])
  assert.deepEqual(campaignHomeActivity(snapshot, 'gm'), [])
  assert.deepEqual(campaignHomeActivity({ ...snapshot, role: 'gm' }, 'gm').map(item => item.id), ['private', 'public'])
})

test('Campaign Home identifies the campaign and continues a prepared encounter', () => {
  assert.deepEqual(campaignHomeIdentity(null, snapshot), { name: 'campaign-1', system: 'System not configured' })
  const encounters = [{ id: 'a', status: 'active' }, { id: 'p', status: 'prepared' }]
  assert.equal(lastPreparedEncounter(encounters)?.id, 'p')
  assert.equal(lastPreparedEncounter([]), null)
})

test('Campaign Home confirms the authoritative V2 lock instead of showing an unconfigured V1 system', () => {
  const identity = campaignHomeIdentity({ id: 'c', name: 'Test Campaign', systemModuleId: null, systemModuleVersion: null }, snapshot, { id: 'example.revised5e', version: '1.2.1', name: 'Revised 5e Encounter' })
  assert.equal(identity.system, 'Revised 5e Encounter · 1.2.1 (experimental V2)')
})
