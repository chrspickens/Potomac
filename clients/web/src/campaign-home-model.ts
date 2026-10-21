import type { Activity, CampaignConfig, ConnectionStatus, Encounter, Role, Snapshot } from './api'

export type CampaignHomeState = 'loading' | 'unavailable' | 'offline' | 'error' | 'empty' | 'ready'

export function campaignHomeState(input: {
  snapshot: Snapshot | null
  connection: ConnectionStatus
  error?: string
  hasContent?: boolean
}): CampaignHomeState {
  if (input.error) return 'error'
  if (!input.snapshot) return input.connection === 'connecting' ? 'loading' : 'unavailable'
  if (input.connection === 'disconnected') return 'offline'
  if (!input.snapshot.actors.length && !input.snapshot.encounters.length && !input.hasContent) return 'empty'
  return 'ready'
}

export function campaignHomeActivity(snapshot: Snapshot | null, role: Role): Activity[] {
  if (!snapshot || snapshot.role !== role) return []
  return snapshot.activity.filter(item => role === 'gm' || item.visibility === 'all').slice(-6).reverse()
}

export function lastPreparedEncounter(encounters: Encounter[]): Encounter | null {
  return encounters.find(encounter => encounter.status === 'prepared') ?? encounters[0] ?? null
}

export function campaignHomeIdentity(campaign: CampaignConfig | null, snapshot: Snapshot | null, v2Ruleset?: { id: string; version: string; name?: string } | null): { name: string; system: string } {
  return {
    name: campaign?.name || snapshot?.context.campaignId || 'Campaign',
    system: v2Ruleset
      ? `${v2Ruleset.name || v2Ruleset.id} · ${v2Ruleset.version} (experimental V2)`
      : campaign?.systemModuleId && campaign.systemModuleVersion
      ? `${campaign.systemModuleId}@${campaign.systemModuleVersion}`
      : 'System not configured',
  }
}
