import assert from 'node:assert/strict'
import test from 'node:test'
import { flushOfflineQueue } from './reconcile.ts'

test('lost acknowledgement retries the same immutable operation', async () => {
  const operation = { operationId: 'op-1', entityId: 'actor-a' }
  let row = { operation, state: 'queued' }
  const storage = {
    listOperations: async () => [row],
    markSubmitting: async () => { row = { ...row, state: 'submitting', lastError: undefined } },
    retryOperation: async () => { row = { ...row, state: 'queued' } },
    markRetryableFailure: async () => { row = { ...row, state: 'queued', lastError: 'transport' } },
    recordReceipt: async receipt => { row = { ...row, state: receipt.status } },
  }
  const ids = []
  const failed = await flushOfflineQueue(storage, async submitted => { ids.push(submitted.operationId); throw new Error('ack lost') })
  assert.deepEqual(failed, { processed: 0, transportFailed: true })
  assert.equal(row.state, 'queued')
  assert.equal(row.lastError, 'transport')
  const passed = await flushOfflineQueue(storage, async submitted => {
    ids.push(submitted.operationId)
    return { operationId: submitted.operationId, entityId: submitted.entityId, status: 'applied' }
  })
  assert.deepEqual(passed, { processed: 1, transportFailed: false })
  assert.deepEqual(ids, ['op-1', 'op-1'])
  assert.equal(row.state, 'applied')
  assert.equal(row.lastError, undefined)
})
