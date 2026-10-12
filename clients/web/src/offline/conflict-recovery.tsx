import { useState } from 'react'
import type { Actor } from '../modules'
import type { OfflineOperation, PrivateDraft, QueuedOperation } from './storage'
import {
  createConflictPrivateDraft,
  createReplacementOperation,
  type ConflictReason,
} from './conflict-recovery'

export type ConflictRecoveryProps = {
  queuedOperation: QueuedOperation
  reason: ConflictReason
  /** Supply only an actor from the caller's currently authorized snapshot. */
  authorizedCurrentActor?: Actor | null
  /** True only when the caller can establish that this operation has never been submitted. */
  isUnsentLocalWork: boolean
  onRetainAsPrivateDraft: (draft: PrivateDraft) => void | Promise<void>
  onDiscardUnsent: (operationId: string) => void | Promise<void>
  onCreateOperation: (operation: OfflineOperation) => void | Promise<void>
  createId?: () => string
}

const defaultCreateId = () => globalThis.crypto.randomUUID()

/** A focused recovery surface; persistence and host authorization remain with the caller. */
export function ConflictRecovery({
  queuedOperation,
  reason,
  authorizedCurrentActor,
  isUnsentLocalWork,
  onRetainAsPrivateDraft,
  onDiscardUnsent,
  onCreateOperation,
  createId = defaultCreateId,
}: ConflictRecoveryProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const operation = queuedOperation.operation
  const matchingActor = authorizedCurrentActor?.entityId === operation.entityId ? authorizedCurrentActor : null
  const discardable = isUnsentLocalWork && queuedOperation.state === 'queued'

  const run = async (action: () => void | Promise<void>, successMessage: string) => {
    setBusy(true)
    setFeedback('')
    try {
      await action()
      setFeedback(successMessage)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Recovery action could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  const retainAsDraft = () => run(
    () => onRetainAsPrivateDraft(createConflictPrivateDraft(queuedOperation, reason, createId())),
    'Original intent saved as a private draft.',
  )

  const createReplacement = () => {
    const result = createReplacementOperation(operation, matchingActor, createId())
    if (!result.ok) {
      setFeedback(result.reason === 'invalid-operation-id'
        ? 'A new operation ID could not be created. Try again.'
        : 'A currently authorized version of this actor is required to create a new operation.')
      return
    }
    return run(() => onCreateOperation(result.operation), 'New operation sent to the caller for queueing.')
  }

  const discard = () => run(async () => {
    if (!discardable) throw new Error('Only an unsent queued operation can be discarded here.')
    await onDiscardUnsent(operation.operationId)
    setConfirmDiscard(false)
  }, 'Unsent local operation discarded.')

  return (
    <section aria-labelledby="conflict-recovery-title">
      <h2 id="conflict-recovery-title">Resolve offline conflict</h2>

      <section aria-labelledby="conflict-original-title">
        <h3 id="conflict-original-title">Original intent</h3>
        <p><strong>Action:</strong> {operation.actionId}</p>
        <p><strong>Base revision:</strong> {operation.baseRevision}</p>
        <details>
          <summary>Show action parameters</summary>
          <pre>{JSON.stringify(operation.parameters, null, 2)}</pre>
        </details>
      </section>

      <section aria-labelledby="conflict-reason-title">
        <h3 id="conflict-reason-title">Conflict reason</h3>
        <p><strong>{reason.code}</strong>: {reason.message}</p>
      </section>

      <section aria-labelledby="conflict-actor-title">
        <h3 id="conflict-actor-title">Authorized current actor</h3>
        {matchingActor ? (
          <p>{matchingActor.name} — {matchingActor.epithet}; current revision {matchingActor.revision}</p>
        ) : (
          <p role="status">No currently authorized version of this actor is available.</p>
        )}
      </section>

      <div aria-label="Conflict recovery actions">
        <button type="button" disabled={busy} onClick={() => void retainAsDraft()}>
          Retain as private draft
        </button>
        <button type="button" disabled={busy || !discardable} onClick={() => setConfirmDiscard(true)}>
          Discard unsent local work
        </button>
        <button type="button" disabled={busy || !matchingActor} onClick={() => void createReplacement()}>
          Create new operation from current revision
        </button>
      </div>

      {!discardable && <p>Discard is available only while this operation is still queued and unsent.</p>}
      {confirmDiscard && discardable && (
        <fieldset>
          <legend>Confirm discard</legend>
          <p>This permanently removes this unsent operation from the local queue. The original intent will not be retained.</p>
          <button type="button" disabled={busy} onClick={() => void discard()}>
            Confirm discard
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirmDiscard(false)}>
            Keep operation
          </button>
        </fieldset>
      )}

      <p role="status" aria-live="polite">{feedback}</p>
    </section>
  )
}
