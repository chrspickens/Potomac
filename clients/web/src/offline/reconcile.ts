import type { OfflineOperation, OfflineReceipt, OfflineStorage, QueuedOperation } from './storage'

/** Submit immutable queued intents sequentially; a lost acknowledgement keeps the same ID. */
export async function flushOfflineQueue(
  storage: OfflineStorage,
  submit: (operation: OfflineOperation) => Promise<OfflineReceipt>,
  onUpdate?: (rows: QueuedOperation[]) => void,
): Promise<{ processed: number; transportFailed: boolean }> {
  let processed = 0
  // Re-read after each receipt: a player can enqueue another intent while the
  // previous submission is in flight. A single snapshot would strand that edit.
  const attempted = new Set<string>()
  while (true) {
    const rows = await storage.listOperations()
    const row = rows.find(item => (item.state === 'queued' || item.state === 'submitting') && !attempted.has(item.operation.operationId))
    if (!row) break
    attempted.add(row.operation.operationId)
    if (row.state === 'submitting') await storage.retryOperation(row.operation.operationId)
    await storage.markSubmitting(row.operation.operationId)
    onUpdate?.(await storage.listOperations())
    let receipt: OfflineReceipt
    try {
      receipt = await submit(row.operation)
    } catch {
      // A response may have been lost after commit. Retry the original request.
      await storage.markRetryableFailure(row.operation.operationId)
      onUpdate?.(await storage.listOperations())
      return { processed, transportFailed: true }
    }
    await storage.recordReceipt(receipt)
    processed += 1
    onUpdate?.(await storage.listOperations())
  }
  return { processed, transportFailed: false }
}
