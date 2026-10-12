import type { Snapshot } from '../api'
import type { Actor } from '../modules'
import type { RememberedIdentity } from '../identity'
import { openOfflineStorage, type AuthorizedSnapshot } from './storage'

export async function cachePlayerSnapshot(host: string, snapshot: Snapshot): Promise<void> {
  if (snapshot.role !== 'player' || !snapshot.memberId) return
  const storage = await openOfflineStorage({ host, campaignId: snapshot.context.campaignId, memberId: snapshot.memberId })
  try {
    const actors: AuthorizedSnapshot<Actor>[] = snapshot.actors.map(actor => ({
      entityId: actor.entityId,
      revision: actor.revision,
      moduleId: actor.module.manifest.id,
      moduleVersion: actor.module.manifest.version,
      schemaVersion: typeof actor.data.schemaVersion === 'number' ? actor.data.schemaVersion : 1,
      data: actor,
    }))
    // Keep previously downloaded records as local copies. Revocation cannot
    // recall browser data; the live snapshot remains the only current view.
    for (const actor of actors) await storage.putAuthorizedSnapshot(actor)
    await storage.putSessionMetadata({
      cursor: snapshot.context.cursor,
      ...(snapshot.session ? { session: snapshot.session } : {}),
      lastSyncedAt: Date.now(),
      activeEncounter: snapshot.context.activeEncounter,
      encounters: snapshot.encounters,
    })
  } finally { storage.close() }
}

export async function loadCachedPlayerSnapshot(identity: RememberedIdentity): Promise<{ snapshot: Snapshot; lastSyncedAt: number } | null> {
  const storage = await openOfflineStorage({ host: identity.host, campaignId: identity.campaignId, memberId: identity.memberId })
  try {
    const metadata = await storage.getSessionMetadata()
    if (!metadata) return null
    const rows = await storage.listAuthorizedSnapshots()
    if (rows.some(row => !isCachedActor(row))) throw new Error('Cached character data is incompatible; reconnect to refresh it')
    return {
      snapshot: {
        role: 'player', memberId: identity.memberId, actors: rows.map(row => row.data as Actor),
        encounters: metadata.encounters,
        context: { campaignId: identity.campaignId, activeEncounter: metadata.activeEncounter, cursor: metadata.cursor },
        activity: [],
        ...(metadata.session ? { session: metadata.session } : {}),
      },
      lastSyncedAt: metadata.lastSyncedAt,
    }
  } finally { storage.close() }
}

export async function clearRememberedPlayerData(identity: RememberedIdentity): Promise<void> {
  const storage = await openOfflineStorage({ host: identity.host, campaignId: identity.campaignId, memberId: identity.memberId })
  try { await storage.clearScope() } finally { storage.close() }
}

function isCachedActor(row: AuthorizedSnapshot): row is AuthorizedSnapshot<Actor> {
  if (!row.data || typeof row.data !== 'object') return false
  const actor = row.data as Partial<Actor>
  return actor.entityId === row.entityId && actor.revision === row.revision
    && actor.module?.manifest.id === row.moduleId && actor.module.manifest.version === row.moduleVersion
    && Array.isArray(actor.module.view?.layout) && Array.isArray(actor.module.view?.brick)
    && typeof actor.data === 'object' && actor.data !== null
}
