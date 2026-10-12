// Local-host experiment only: the bearer credential is remembered in this
// browser profile for offline reopening. It is not protected from profile users.
const storageKey = 'potomac.identity.v1'

export type RememberedIdentity = {
  version: 1
  host: string
  campaignId: string
  memberId: string
  credential: string
}

function isIdentity(value: unknown): value is RememberedIdentity {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return item.version === 1 && ['host', 'campaignId', 'memberId', 'credential']
    .every(key => typeof item[key] === 'string' && (item[key] as string).length > 0)
}

export function loadRememberedIdentity(host: string): RememberedIdentity | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isIdentity(parsed) && parsed.host === host ? parsed : null
  } catch { return null }
}

export function rememberIdentity(identity: RememberedIdentity): void {
  if (!isIdentity(identity)) throw new Error('Invalid member identity')
  localStorage.setItem(storageKey, JSON.stringify(identity))
}

export function forgetRememberedIdentity(host: string): void {
  if (loadRememberedIdentity(host)) localStorage.removeItem(storageKey)
}
