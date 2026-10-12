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
  /** Current authorized dependency actors only; absent actors must remain unavailable. */
  authorizedCurrentDependencies?: Actor[]
  /** Host receipt remains durable; this removes only a terminal local copy. */
  canDiscardLocalOutcome: boolean
  onRetainAsPrivateDraft: (draft: PrivateDraft) => void | Promise<void>
  onDiscardLocalOutcome: (operationId: string) => void | Promise<void>
  onCreateOperation: (operation: OfflineOperation) => void | Promise<void>
  createId?: () => string
}

const defaultCreateId = () => globalThis.crypto.randomUUID()

/** A focused recovery surface; persistence and host authorization remain with the caller. */
export function ConflictRecovery({
  queuedOperation,
  reason,
  authorizedCurrentActor,
  authorizedCurrentDependencies = [],
  canDiscardLocalOutcome,
  onRetainAsPrivateDraft,
  onDiscardLocalOutcome,
  onCreateOperation,
  createId = defaultCreateId,
}: ConflictRecoveryProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const operation = queuedOperation.operation
  const matchingActor = authorizedCurrentActor?.entityId === operation.entityId ? authorizedCurrentActor : null
  const dependencies = operation.dependencies || []
  const currentDependencies = dependencies.map(dependency => authorizedCurrentDependencies.find(actor => actor.entityId === dependency.entityId) || null)
  const dependenciesAvailable = currentDependencies.every(Boolean)
  const [reviewedDependencies, setReviewedDependencies] = useState(false)
  const discardable = canDiscardLocalOutcome && ['conflicted', 'rejected'].includes(queuedOperation.state)

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
      if (result.reason === 'dependency-review-required' && reviewedDependencies && dependenciesAvailable && matchingActor) {
        const replacement = structuredClone(operation)
        replacement.operationId = createId()
        replacement.baseRevision = matchingActor.revision
        replacement.dependencies = dependencies.map(dependency => {
          const current = currentDependencies.find(actor => actor?.entityId === dependency.entityId)
          if (!current) throw new Error('An authorized current dependency is required before rebasing.')
          return { entityId: dependency.entityId, revision: current.revision }
        })
        return run(() => onCreateOperation(replacement), `New operation ${replacement.operationId} created after reviewing current dependencies.`)
      }
      setFeedback(result.reason === 'invalid-operation-id'
        ? 'A new operation ID could not be created. Try again.'
        : result.reason === 'module-incompatible'
          ? 'The actor module or schema changed. Keep a draft and review the edit against the new version.'
          : result.reason === 'dependency-review-required'
            ? 'Referenced dependencies must be reviewed against current host state. Keep a draft before creating a new request.'
          : 'A currently authorized version of this actor is required to create a new operation.')
      return
    }
    return run(() => onCreateOperation(result.operation), 'New operation sent to the caller for queueing.')
  }

  const discard = () => run(async () => {
    if (!discardable) throw new Error('Only a rejected or conflicted local copy can be discarded here.')
    await onDiscardLocalOutcome(operation.operationId)
    setConfirmDiscard(false)
  }, 'Local copy discarded; the host receipt remains in audit history.')

  return (
    <section aria-labelledby="conflict-recovery-title">
      <h2 id="conflict-recovery-title">{queuedOperation.state === 'rejected' ? 'Review rejected edit' : 'Resolve offline conflict'}</h2>

      <section aria-labelledby="conflict-original-title">
        <h3 id="conflict-original-title">Original intent</h3>
        <p><strong>Action:</strong> {operation.actionId}</p>
        <p><strong>Operation ID:</strong> <code>{operation.operationId}</code></p>
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

      {dependencies.length > 0 && (
        <section aria-label="Current dependency review">
          <h3>Authorized current dependencies</h3>
          <ul>{dependencies.map((dependency, index) => {
            const current = currentDependencies[index]
            return <li key={dependency.entityId}>{current ? `${current.name} — current revision ${current.revision}` : 'A dependency is unavailable in your current authorized view.'}</li>
          })}</ul>
          <label><input aria-label="Confirm dependency rebase" type="checkbox" checked={reviewedDependencies} disabled={!dependenciesAvailable} onChange={event => setReviewedDependencies(event.target.checked)} /> I reviewed these dependency revisions and want a newly validated operation.</label>
        </section>
      )}

      <div aria-label="Conflict recovery actions">
        <button type="button" disabled={busy} onClick={() => void retainAsDraft()}>
          Retain as private draft
        </button>
        <button type="button" disabled={busy || !discardable} onClick={() => setConfirmDiscard(true)}>
          Discard local conflict copy
        </button>
        <button type="button" disabled={busy || !matchingActor || queuedOperation.state === 'rejected' || (dependencies.length > 0 && (!dependenciesAvailable || !reviewedDependencies))} onClick={() => void createReplacement()}>
          Create new operation from current revision
        </button>
      </div>

      {!discardable && <p>Discard is available only for a rejected or conflicted local copy.</p>}
      {confirmDiscard && discardable && (
        <fieldset>
          <legend>Confirm discard</legend>
          <p>This removes the local copy, but not the host receipt or audit history. Save a private draft first if you want to retain your intent.</p>
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
