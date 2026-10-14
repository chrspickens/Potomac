import assert from 'node:assert/strict'
import test from 'node:test'
import { campaignSearchAvailable } from './campaign-search-availability.ts'

test('campaign search is host-only and unavailable in default local preview', () => {
  assert.equal(campaignSearchAvailable('demo'), false)
  assert.equal(campaignSearchAvailable('host'), true)
})
