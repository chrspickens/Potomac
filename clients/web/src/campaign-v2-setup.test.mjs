import assert from 'node:assert/strict'
import test from 'node:test'
import { isLoopbackV2Origin, v2CampaignSetupBlockReason } from './campaign-v2-setup.ts'

test('experimental V2 campaign entry requires loopback browser and loopback host', () => {
  assert.equal(isLoopbackV2Origin('127.0.0.1', 'http://127.0.0.1:4177'), true)
  assert.equal(isLoopbackV2Origin('localhost', 'http://localhost:4177'), true)
  assert.equal(isLoopbackV2Origin('campaign.example.test', 'http://127.0.0.1:4177'), false)
  assert.equal(isLoopbackV2Origin('127.0.0.1', 'https://campaign.example.test'), false)
  assert.equal(isLoopbackV2Origin('127.0.0.1', undefined), false)
})

test('V2 setup fails closed for disabled host, existing rules/data, locks, or missing module choice', () => {
  const ready = { loopback: true, hostReady: true, v1Pinned: false, hasLegacyData: false, v2Pinned: false, moduleSelected: true }
  assert.equal(v2CampaignSetupBlockReason(ready), null)
  for (const [change, expected] of [
    [{ loopback: false }, 'loopback-only'],
    [{ hostReady: false }, 'host-disabled'],
    [{ v1Pinned: true }, 'v1-pinned'],
    [{ hasLegacyData: true }, 'legacy-data'],
    [{ v2Pinned: true }, 'already-pinned'],
    [{ moduleSelected: false }, 'module-unavailable'],
  ]) assert.equal(v2CampaignSetupBlockReason({ ...ready, ...change }), expected)
})
