import type { ReviewProposal } from './api'

export type IssuedPlayerCredential = { memberId: string; displayName: string; credential: string; visible: boolean }

export function GmAdminPanel({ proposals, credentials, selectedActor, activeProposal, onEnroll, onGrant, onReview, onDecide, onCloseProposal, onToggleCredential }: {
  proposals: ReviewProposal[]
  credentials: IssuedPlayerCredential[]
  selectedActor?: { name: string }
  activeProposal: ReviewProposal | null
  onEnroll: () => void
  onGrant: () => void
  onReview: (id: string) => void
  onDecide: (decision: 'accept' | 'reject') => void
  onCloseProposal: () => void
  onToggleCredential: (memberId: string) => void
}) {
  return <details className="gm-admin"><summary>GM administration · {proposals.length} pending</summary>
    <div>
      <button type="button" onClick={onEnroll}>Enroll player</button>
      <button type="button" disabled={!selectedActor} onClick={onGrant}>Grant selected character</button>
      <section className="gm-admin-credentials" aria-label="Issued player credentials">
        <strong>Recently enrolled players</strong>
        {credentials.length ? credentials.map(item => <article key={item.memberId}>
          <strong>{item.displayName}</strong><p>Member ID: <code>{item.memberId}</code></p>
          <p>Credential: <code>{item.visible ? item.credential : 'Hidden'}</code></p>
          <button type="button" aria-pressed={item.visible} onClick={() => onToggleCredential(item.memberId)}>{item.visible ? 'Hide credential' : 'Show credential'}</button>
        </article>) : <p>New player credentials will appear here after enrollment.</p>}
      </section>
      <section aria-label="GM proposal review"><strong>Review queue</strong>
        {proposals.map(proposal => <p key={proposal.id}>{proposal.actionId} · {proposal.entityId} · member {proposal.memberId.slice(0, 8)} <button type="button" onClick={() => onReview(proposal.id)}>Review</button></p>)}
        {activeProposal && <div><h2>Review {activeProposal.actionId}</h2><p>Member {activeProposal.memberId} · actor {activeProposal.entityId}</p><pre>{JSON.stringify(activeProposal.request, null, 2)}</pre><button type="button" onClick={() => onDecide('accept')}>Accept after revalidation</button><button type="button" onClick={() => onDecide('reject')}>Reject</button><button type="button" onClick={onCloseProposal}>Close</button></div>}
      </section>
    </div>
  </details>
}
