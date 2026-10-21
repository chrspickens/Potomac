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

export function campaignHomeIdentity(campaign: CampaignConfig | null, snapshot: Snapshot | null): { name: string; system: string } {
  const pinnedModule = campaign?.systemModuleId && campaign.systemModuleVersion
    ? snapshot?.modules?.find(module => module.manifest.id === campaign.systemModuleId && module.manifest.version === campaign.systemModuleVersion)
    : undefined
  return {
    name: campaign?.name || snapshot?.context.campaignId || 'Campaign',
    system: campaign?.systemModuleId && campaign.systemModuleVersion
      ? `${pinnedModule?.manifest.name || campaign.systemModuleId} · ${campaign.systemModuleVersion}`
      : 'No game system is pinned',
  }
}
