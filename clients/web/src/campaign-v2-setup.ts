const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function isLoopbackV2Origin(browserHostname: string, configuredHost: string | null | undefined) {
  if (!configuredHost || !LOOPBACK_HOSTS.has(browserHostname.toLowerCase())) return false
  try { return LOOPBACK_HOSTS.has(new URL(configuredHost).hostname.toLowerCase()) } catch { return false }
}

export type V2SetupBlock = 'loopback-only' | 'host-disabled' | 'v1-pinned' | 'legacy-data' | 'already-pinned' | 'module-unavailable'
export function v2CampaignSetupBlockReason(input: {
  loopback: boolean
  hostReady: boolean
  v1Pinned: boolean
  hasLegacyData: boolean
  v2Pinned: boolean
  moduleSelected: boolean
}): V2SetupBlock | null {
  if (!input.loopback) return 'loopback-only'
  if (!input.hostReady) return 'host-disabled'
  if (input.v1Pinned) return 'v1-pinned'
  if (input.hasLegacyData) return 'legacy-data'
  if (input.v2Pinned) return 'already-pinned'
  if (!input.moduleSelected) return 'module-unavailable'
  return null
}
