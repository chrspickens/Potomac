import type { Actor } from '../modules'
import type { OfflineOperation, PrivateDraft, QueuedOperation } from './storage'

export type ConflictReason = {
  code: string
  message: string
}

export type ReplacementOperationResult =
  | { ok: true; operation: OfflineOperation }
  | { ok: false; reason: 'current-actor-unavailable' | 'actor-does-not-match' | 'invalid-operation-id' }

/**
 * Creates a fresh intent based on an explicitly authorized current actor.
 * This function never changes the original queued operation.
 */
export function createReplacementOperation(
  original: OfflineOperation,
  authorizedCurrentActor: Actor | null | undefined,
  newOperationId: string,
): ReplacementOperationResult {
  if (!authorizedCurrentActor) return { ok: false, reason: 'current-actor-unavailable' }
  if (authorizedCurrentActor.entityId !== original.entityId) return { ok: false, reason: 'actor-does-not-match' }
  if (!Number.isSafeInteger(authorizedCurrentActor.revision) || authorizedCurrentActor.revision < 0) {
    return { ok: false, reason: 'current-actor-unavailable' }
  }
  if (!newOperationId.trim() || newOperationId === original.operationId) {
    return { ok: false, reason: 'invalid-operation-id' }
  }

  const operation = structuredClone(original)
  operation.operationId = newOperationId
  operation.baseRevision = authorizedCurrentActor.revision
  return { ok: true, operation }
}

/** Retains the original intent and conflict reason in a new private draft. */
export function createConflictPrivateDraft(
  queuedOperation: QueuedOperation,
  reason: ConflictReason,
  draftId: string,
): PrivateDraft {
  if (!draftId.trim()) throw new Error('Draft ID must be a non-empty string')
  return {
    draftId,
    entityId: queuedOperation.operation.entityId,
    payload: {
      kind: 'offline-conflict',
      operation: structuredClone(queuedOperation.operation),
      reason: structuredClone(reason),
    },
  }
}
