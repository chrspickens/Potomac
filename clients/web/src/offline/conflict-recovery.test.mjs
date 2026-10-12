import assert from 'node:assert/strict'
import test from 'node:test'
import { createReplacementOperation } from './conflict-recovery.ts'

const original = () => ({
  operationId: 'operation-original',
  campaignId: 'campaign-1',
  memberId: 'member-1',
  entityId: 'actor-1',
  baseRevision: 4,
  moduleId: 'example.system-a',
  moduleVersion: '1.2.0',
  schemaVersion: 3,
  actionId: 'spend-resource',
  parameters: { amount: 2, options: { mode: 'careful' } },
  dependencies: [],
})

test('replacement uses a new ID and current revision while preserving immutable intent', () => {
  const source = original()
  const before = structuredClone(source)
  const actor = { entityId: 'actor-1', revision: 9, module: { manifest: { id: 'example.system-a', version: '1.2.0' } }, data: { schemaVersion: 3 } }

  const result = createReplacementOperation(source, actor, 'operation-new')

  assert.equal(result.ok, true)
  assert.notEqual(result.operation.operationId, source.operationId)
  assert.equal(result.operation.baseRevision, 9)
  assert.equal(result.operation.actionId, source.actionId)
  assert.deepEqual(result.operation.parameters, source.parameters)
  assert.deepEqual(result.operation.dependencies, source.dependencies)
  assert.deepEqual(source, before)
  assert.notStrictEqual(result.operation.parameters, source.parameters)
  assert.notStrictEqual(result.operation.dependencies, source.dependencies)
})

test('replacement is blocked when no authorized current actor is available', () => {
  const result = createReplacementOperation(original(), null, 'operation-new')

  assert.deepEqual(result, { ok: false, reason: 'current-actor-unavailable' })
})

test('replacement is blocked when the current actor does not match the operation entity', () => {
  const result = createReplacementOperation(original(), { entityId: 'other-actor', revision: 9 }, 'operation-new')

  assert.deepEqual(result, { ok: false, reason: 'actor-does-not-match' })
})

test('replacement refuses to silently refresh stale dependency bases', () => {
  const actor = { entityId: 'actor-1', revision: 9, module: { manifest: { id: 'example.system-a', version: '1.2.0' } }, data: { schemaVersion: 3 } }
  const operation = { ...original(), dependencies: [{ entityId: 'item-1', revision: 7 }] }
  assert.deepEqual(createReplacementOperation(operation, actor, 'operation-new'), { ok: false, reason: 'dependency-review-required' })
})
