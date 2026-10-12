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
  const bodies = []
  const failed = await flushOfflineQueue(storage, async submitted => { ids.push(submitted.operationId); bodies.push(structuredClone(submitted)); throw new Error('ack lost') })
  assert.deepEqual(failed, { processed: 0, transportFailed: true })
  assert.equal(row.state, 'queued')
  assert.equal(row.lastError, 'transport')
  const passed = await flushOfflineQueue(storage, async submitted => {
    ids.push(submitted.operationId)
    bodies.push(structuredClone(submitted))
    return { operationId: submitted.operationId, entityId: submitted.entityId, status: 'applied' }
  })
  assert.deepEqual(passed, { processed: 1, transportFailed: false })
  assert.deepEqual(ids, ['op-1', 'op-1'])
  assert.deepEqual(bodies, [operation, operation], 'retry keeps the exact operation body so the host can return its original receipt without rerunning effects')
  assert.equal(row.state, 'applied')
  assert.equal(row.lastError, undefined)
})

test('an edit queued while another submission is in flight is flushed in the same pass', async () => {
  const one = { operationId: 'op-1', entityId: 'actor-a' }
  const two = { operationId: 'op-2', entityId: 'actor-b' }
  const rows = [{ operation: one, state: 'queued' }]
  const update = (id, changes) => {
    const index = rows.findIndex(row => row.operation.operationId === id)
    rows[index] = { ...rows[index], ...changes }
  }
  const storage = {
    listOperations: async () => rows.map(row => ({ ...row })),
    markSubmitting: async id => update(id, { state: 'submitting' }),
    retryOperation: async id => update(id, { state: 'queued' }),
    markRetryableFailure: async id => update(id, { state: 'queued', lastError: 'transport' }),
    recordReceipt: async receipt => update(receipt.operationId, { state: receipt.status }),
  }
  const sent = []
  const result = await flushOfflineQueue(storage, async operation => {
    sent.push(operation.operationId)
    if (operation.operationId === one.operationId) rows.push({ operation: two, state: 'queued' })
    return { operationId: operation.operationId, entityId: operation.entityId, status: 'applied' }
  })
  assert.deepEqual(result, { processed: 2, transportFailed: false })
  assert.deepEqual(sent, ['op-1', 'op-2'])
  assert.deepEqual(rows.map(row => row.state), ['applied', 'applied'])
})
