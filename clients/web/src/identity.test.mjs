import assert from 'node:assert/strict'
import test from 'node:test'
import { forgetRememberedIdentity, loadRememberedIdentity, rememberIdentity } from './identity.ts'

test('remembered credentials stay scoped to their host and can be forgotten', () => {
  const values = new Map()
  const previous = globalThis.localStorage
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
  try {
    const identity = { version: 1, host: 'http://127.0.0.1:4177', campaignId: 'campaign', memberId: 'member-a', credential: 'secret' }
    rememberIdentity(identity)
    assert.deepEqual(loadRememberedIdentity(identity.host), identity)
    assert.equal(loadRememberedIdentity('http://127.0.0.1:4178'), null)
    forgetRememberedIdentity('http://127.0.0.1:4178')
    assert.deepEqual(loadRememberedIdentity(identity.host), identity)
    forgetRememberedIdentity(identity.host)
    assert.equal(loadRememberedIdentity(identity.host), null)
  } finally { globalThis.localStorage = previous }
})

test('corrupt remembered identity cannot become an authentication scope', () => {
  const previous = globalThis.localStorage
  globalThis.localStorage = { getItem: () => '{bad-json' }
  try { assert.equal(loadRememberedIdentity('http://127.0.0.1:4177'), null) }
  finally { globalThis.localStorage = previous }
})

test('remembered identity rejects empty campaign scope fields', () => {
  const previous = globalThis.localStorage
  const values = new Map([['potomac.identity.v1', JSON.stringify({ version: 1, host: 'http://127.0.0.1:4177', campaignId: '', memberId: 'member-a', credential: 'secret' })]])
  globalThis.localStorage = { getItem: key => values.get(key) ?? null }
  try { assert.equal(loadRememberedIdentity('http://127.0.0.1:4177'), null) }
  finally { globalThis.localStorage = previous }
})
