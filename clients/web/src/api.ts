import { initialActors, type Actor, type GameModule } from './modules'
import { loadRememberedIdentity, rememberIdentity } from './identity'
import type { OfflineOperation, OfflineReceipt } from './offline/storage'

export type Role = 'gm' | 'player'
export type Encounter = { id: string; name: string; summary: string; status?: 'prepared' | 'active' | 'completed'; revision?: number; participants?: Array<{ actorId: string; initiative?: number | null; status?: string; activationOrder?: number | null }> }
export type CampaignConfig = { id: string; name: string; systemModuleId: string | null; systemModuleVersion: string | null; revision: number }
export type SessionContext = { campaignId: string; activeEncounter: Encounter | null; cursor: number }
export type Activity = { id: string; actor: string; action: string; detail: string; time: string; visibility: 'all' | 'gm'; cursor: number }
export type SessionRecord = { id: string; status: 'active' | 'paused' | 'finished'; revision: number; startedAt: string; updatedAt: string; finishedAt: string | null }
export type SessionSnapshot = { revision: number; current: SessionRecord | null; history: SessionRecord[] }
export type Snapshot = { role: Role; memberId: string | null; actors: Actor[]; encounters: Encounter[]; context: SessionContext; activity: Activity[]; modules?: GameModule[]; session?: SessionSnapshot }
export type ActionRequest = { operationId: string; entityId: string; baseRevision: number; actionId: string; parameters: Record<string, unknown> }
export type SessionActionRequest = ActionRequest & {
  sessionId: string
  campaignId?: string
  memberId?: string
  moduleId?: string
  moduleVersion?: string
  schemaVersion?: number
  dependencies?: Array<{ entityId: string; revision: number }>
}
export type ActionReceipt = {
  operationId: string
  entityId: string
  actorId: string
  actionId: string
  status: 'applied'
  revision: number
  sessionId?: string
  moduleId?: string
  moduleVersion?: string
  schemaVersion?: number
  ruleVersion?: number
  eventCursor?: number
  verified?: boolean
  rolls?: number[]
  resolution?: Record<string, unknown>
}
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'
export type HostAdapter = {
  mode: 'demo' | 'host'
  load(role: Role): Promise<Snapshot>
  command(role: Role, body: ActionRequest): Promise<void>
  setEncounter(role: Role, id: string | null): Promise<void>
  createActor(role: Role, input: { id: string; moduleId: string; moduleVersion: string; data: Record<string, unknown>; visibility?: Record<string, unknown> }): Promise<void>
  subscribe(role: Role, onSnapshot: (snapshot: Snapshot) => void, onStatus: (status: ConnectionStatus) => void): () => void
}

export async function loadSessionSnapshot(role: Role): Promise<SessionSnapshot> {
  if (!baseUrl) return { revision: 0, current: null, history: [] }
  return http<SessionSnapshot>('/api/session', role)
}

export async function commandSession(command: 'start' | 'pause' | 'resume' | 'finish', sessionId: string, baseRevision: number, encounter?: { id: string; revision: number }): Promise<SessionSnapshot> {
  if (!baseUrl) throw new Error('Session controls require a configured host')
  if (command === 'start' && (!encounter || !encounter.id || !Number.isInteger(encounter.revision) || encounter.revision < 1)) {
    throw new Error('Choose an active encounter with a current host revision before starting a session')
  }
  return http<SessionSnapshot>('/api/session/commands', 'gm', { method: 'POST', body: JSON.stringify({ operationId: crypto.randomUUID(), command, sessionId, baseRevision, ...(command === 'start' ? { encounterId: encounter!.id, encounterRevision: encounter!.revision } : {}) }) })
}

export async function submitSessionAction(role: Role, command: SessionActionRequest): Promise<ActionReceipt> {
  if (!baseUrl) throw new Error('Session actions require a configured host')
  return http<ActionReceipt>('/api/session/actions', role, { method: 'POST', body: JSON.stringify(command) })
}

const baseUrl = import.meta.env.VITE_POTOMAC_HOST?.replace(/\/$/, '')
export const configuredHost = baseUrl || null
const hostConfigured = Boolean(baseUrl)
const events = new EventTarget()
const demoEncounters: Encounter[] = [
  { id: 'encounter-a', name: 'The Glass Bridge', summary: 'The party crosses a flooded causeway beneath the old watchtower.' },
  { id: 'encounter-b', name: 'The Ashen Gate', summary: 'A sealed gate waits beyond the ridge; distant lights mark the approach.' },
]
let demo: Snapshot = {
  role: 'gm', memberId: null, actors: structuredClone(initialActors), encounters: demoEncounters,
  context: { campaignId: 'foundation-demo', activeEncounter: demoEncounters[0], cursor: 1 }, activity: [],
}
let fixtureBootstrap: Promise<void> | undefined

function tokenFor(role: Role) {
  return role === 'gm' ? (import.meta.env.VITE_POTOMAC_GM_TOKEN || 'local-gm') : (baseUrl && loadRememberedIdentity(baseUrl)?.credential || import.meta.env.VITE_POTOMAC_PLAYER_TOKEN || 'local-player')
}

export async function connectPlayerCredential(credential: string): Promise<Snapshot> {
  if (!baseUrl || !credential) throw new Error('A local host and player credential are required')
  const response = await fetch(`${baseUrl}/api/state`, { headers: { authorization: `Bearer ${credential}` } })
  const body = await response.json().catch(() => ({})) as HostState
  if (!response.ok || body.role !== 'player' || typeof body.memberId !== 'string' || !body.memberId || typeof body.campaignId !== 'string') {
    throw new Error('Player credential was not accepted by this host')
  }
  rememberIdentity({ version: 1, host: baseUrl, campaignId: body.campaignId, memberId: body.memberId, credential })
  return fromHost(body, 'player')
}
async function http<T>(path: string, role: Role, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenFor(role)}`, ...init?.headers } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Host request failed (${response.status})`)
  return body as T
}

export async function submitOfflineOperation(operation: OfflineOperation): Promise<OfflineReceipt> {
  if (!baseUrl) throw new Error('An authoritative host is required to reconcile offline work')
  return http<OfflineReceipt>('/api/offline/operations', 'player', { method: 'POST', body: JSON.stringify(operation) })
}

export async function enrollLocalPlayer(displayName: string): Promise<{ memberId: string; displayName: string; credential: string }> {
  if (!baseUrl) throw new Error('A local host is required to enroll players')
  return http('/api/members/enroll', 'gm', { method: 'POST', body: JSON.stringify({ displayName }) })
}

export async function grantActorToMember(actorId: string, memberId: string): Promise<void> {
  if (!baseUrl) throw new Error('A local host is required to grant access')
  await http(`/api/actors/${encodeURIComponent(actorId)}/grants`, 'gm', { method: 'POST', body: JSON.stringify({ memberId, permissions: ['read', 'act'] }) })
}

export async function createCampaignActor(input: { id: string; moduleId: string; moduleVersion: string; data: Record<string, unknown>; visibility?: Record<string, unknown> }): Promise<void> {
  if (!baseUrl) throw new Error('A local host is required to create a character')
  await http('/api/actors', 'gm', { method: 'POST', body: JSON.stringify(input) })
}


export async function getCampaignConfig(): Promise<CampaignConfig> {
  return http<CampaignConfig>('/api/campaign', 'gm')
}
export async function saveCampaignConfig(config: Omit<CampaignConfig, 'id'>): Promise<CampaignConfig> {
  return http<CampaignConfig>('/api/campaign', 'gm', { method: 'PUT', body: JSON.stringify({
    name: config.name, systemModuleId: config.systemModuleId, systemModuleVersion: config.systemModuleVersion,
    baseRevision: config.revision
  }) })
}
export async function editCharacterFields(entityId: string, baseRevision: number, changes: Record<string, unknown>, operationId: string): Promise<void> {
  await http('/api/actors/' + encodeURIComponent(entityId), 'gm', { method: 'PUT', body: JSON.stringify({ operationId, baseRevision, changes }) })
}
export async function createCampaignEncounter(name: string, summary: string): Promise<Encounter> {
  return http('/api/encounters', 'gm', { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), name, summary }) })
}
export async function loadCampaignEncounter(id: string): Promise<Encounter> {
  return http('/api/encounters/' + encodeURIComponent(id), 'gm')
}
export async function loadAuthorizedEncounter(id: string, role: Role): Promise<Encounter> {
  return http('/api/encounters/' + encodeURIComponent(id), role)
}
export async function editCampaignEncounter(id: string, baseRevision: number, fields: { name: string; summary: string; status: 'prepared' | 'active' | 'completed' }): Promise<Encounter> {
  return http('/api/encounters/' + encodeURIComponent(id), 'gm', { method: 'PUT', body: JSON.stringify({ ...fields, baseRevision }) })
}
export async function saveEncounterParticipants(id: string, baseRevision: number, participants: NonNullable<Encounter['participants']>): Promise<Encounter> {
  return http('/api/encounters/' + encodeURIComponent(id) + '/participants', 'gm', { method: 'PUT', body: JSON.stringify({ baseRevision, participants }) })
}

export type ReviewProposal = { id: string; operationId: string; memberId: string; entityId: string; actionId: string; campaignId?: string | null; baseRevision?: number | null; ruleVersion?: number | null; status: string; createdAt: string; request?: OfflineOperation }

export async function listReviewProposals(): Promise<ReviewProposal[]> {
  return (await http<{ proposals: ReviewProposal[] }>('/api/proposals?status=pending', 'gm')).proposals
}

export async function loadReviewProposal(id: string): Promise<ReviewProposal> {
  return http(`/api/proposals/${encodeURIComponent(id)}`, 'gm')
}

export async function decideReviewProposal(id: string, decisionId: string, decision: 'accept' | 'reject', reason?: string): Promise<OfflineReceipt> {
  return http(`/api/proposals/${encodeURIComponent(id)}/decisions`, 'gm', { method: 'POST', body: JSON.stringify({ decisionId, decision, reason }) })
}

export async function listMyOfflineReceipts(): Promise<OfflineReceipt[]> {
  return (await http<{ receipts: OfflineReceipt[] }>('/api/proposals/mine', 'player')).receipts
}

type HostState = {
  campaignId: string; role?: Role; memberId?: string | null; revision: number; context?: { activeEncounter?: string | null }; encounters?: Encounter[]; session?: SessionSnapshot
  modules?: Array<Record<string, unknown> & { id?: string; version?: string; schema?: Record<string, unknown> }>
  actors?: Array<{ id: string; moduleId: string; moduleVersion: string; revision: number; data: Record<string, any> }>
  events?: Array<{ id: string; actorId: string | null; kind: string; payload: Record<string, any>; createdAt: string; visibility: string; cursor: number }>
}
function fromHost(body: HostState, role: Role): Snapshot {
  const modules = new Map((body.modules || []).map(entry => [`${entry.id}@${entry.version}`, entry]))
  const installedModules: GameModule[] = [...modules.values()].map(definition => ({
    manifest: { id: String(definition.id), version: String(definition.version), name: String(definition.name || definition.id), tagline: String(definition.tagline || definition.type || 'Game system') },
    view: (definition.view || { title: 'Character', layout: [], brick: [] }) as GameModule['view'],
    actions: (definition.actions || []) as GameModule['actions'],
    schema: definition.schema as Record<string, unknown> | undefined,
  }))
  const actors: Actor[] = (body.actors || []).flatMap(row => {
    const definition = modules.get(`${row.moduleId}@${row.moduleVersion}`)
    if (!definition) return []
    const module: GameModule = {
      manifest: { id: String(definition.id), version: String(definition.version), name: String(definition.name || definition.id), tagline: String(definition.tagline || definition.type || 'Game system') },
      view: definition.view as GameModule['view'], actions: (definition.actions || []) as GameModule['actions'],
      schema: definition.schema as Record<string, unknown> | undefined,
    }
    return [{ entityId: row.id, revision: row.revision, module, data: row.data, name: String(row.data.name || row.id), epithet: String(row.data.epithet || ''), secretNote: row.data.secretNote }]
  })
  const encounters = body.encounters || []
  const activity: Activity[] = (body.events || []).map(event => ({
    id: event.id, actor: event.actorId || 'GM',
    action: event.kind === 'action.applied' ? String(event.payload.actionId || 'Action') : event.kind === 'context.changed' ? 'Encounter updated' : event.kind,
    detail: event.kind === 'context.changed'
      ? encounters.find(item => item.id === event.payload.activeEncounter)?.name || 'No active encounter'
      : Array.isArray(event.payload.rolls) && event.payload.rolls.length ? `Verified roll: ${event.payload.rolls.join(' + ')}` : String(event.payload.actionId || ''),
    time: event.createdAt, visibility: event.visibility === 'gm' ? 'gm' : 'all', cursor: event.cursor,
  }))
  return { role, memberId: body.memberId ?? null, actors, encounters, modules: installedModules, context: { campaignId: body.campaignId, activeEncounter: encounters.find(item => item.id === body.context?.activeEncounter) || null, cursor: body.revision || 0 }, activity, ...(body.session ? { session: body.session } : {}) }
}
async function loadHost(role: Role) {
  const body = await http<HostState>('/api/state', role)
  const snapshot = fromHost(body, role)
  if (role !== 'gm' || snapshot.actors.length && !snapshot.actors.some(actor => initialActors.some(fixture => fixture.entityId === actor.entityId))) return snapshot
  if (initialActors.every(fixture => snapshot.actors.some(actor => actor.entityId === fixture.entityId))) return snapshot
  // A genuinely fresh host is intentionally unpinned and must not receive the
  // legacy demo actors until GM setup chooses a module.
  const campaign = await http<CampaignConfig>('/api/campaign', 'gm')
  if (!campaign.systemModuleId || !campaign.systemModuleVersion) return snapshot
  if (!fixtureBootstrap) fixtureBootstrap = (async () => {
    for (const fixture of initialActors) {
      const current = await http<HostState>('/api/state', 'gm')
      if (current.actors?.some(actor => actor.id === fixture.entityId)) continue
      const data = structuredClone({ ...fixture.data, name: fixture.name, epithet: fixture.epithet })
      try {
        await http('/api/actors', role, { method: 'POST', body: JSON.stringify({ id: fixture.entityId, moduleId: fixture.module.manifest.id, moduleVersion: fixture.module.manifest.version, data, visibility: { gmOnly: fixture.secretNote ? ['secretNote'] : [] } }) })
      } catch (error) {
        const after = await http<HostState>('/api/state', 'gm')
        if (!after.actors?.some(actor => actor.id === fixture.entityId)) throw error
      }
    }
  })().finally(() => { fixtureBootstrap = undefined })
  await fixtureBootstrap
  return fromHost(await http<HostState>('/api/state', role), role)
}

export const host: HostAdapter = hostConfigured ? {
  mode: 'host', load: loadHost,
  async command(role, body) { await http('/api/actions', role, { method: 'POST', body: JSON.stringify(body) }) },
  async setEncounter(role, id) { await http('/api/context', role, { method: 'POST', body: JSON.stringify({ context: { activeEncounter: id } }) }) },
  async createActor(_role, input) { await createCampaignActor(input) },
  subscribe(role, onSnapshot, onStatus) {
    let stopped = false
    let controller: AbortController | undefined
    let cursor = 0
    const run = async () => {
      while (!stopped) {
        controller = new AbortController()
        onStatus('connecting')
        try {
          const fresh = await loadHost(role)
          if (stopped) break
          cursor = fresh.context.cursor
          onSnapshot(fresh)
          const response = await fetch(`${baseUrl}/api/stream?since=${cursor}`, { headers: { authorization: `Bearer ${tokenFor(role)}` }, signal: controller.signal })
          if (!response.ok || !response.body) throw new Error('Stream unavailable')
          onStatus('connected')
          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          while (!stopped) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
            const blocks = buffer.split('\n\n')
            buffer = blocks.pop() || ''
            if (blocks.some(block => block.includes('event: update'))) {
              const next = await loadHost(role)
              if (stopped) break
              cursor = next.context.cursor
              onSnapshot(next)
            }
          }
        } catch {
          // Fresh snapshot on reconnect closes stream gaps.
        }
        if (!stopped) { onStatus('disconnected'); await new Promise(resolve => setTimeout(resolve, 1200)) }
      }
    }
    void run()
    return () => { stopped = true; controller?.abort() }
  },
} : {
  mode: 'demo',
  async load(role) {
    return structuredClone({ ...demo, role, activity: role === 'gm' ? demo.activity : demo.activity.filter(item => item.visibility === 'all'), actors: demo.actors.map(actor => role === 'gm' ? actor : { ...actor, secretNote: undefined, data: { ...actor.data, secretNote: undefined } }) })
  },
  async command(role, body) {
    const actor = demo.actors.find(item => item.entityId === body.entityId)
    if (!actor) throw new Error('Character unavailable')
    if (role === 'player' && actor.entityId !== initialActors[1].entityId) throw new Error('Action not permitted')
    if (actor.revision !== body.baseRevision) throw new Error('Revision conflict')
    const action = actor.module.actions.find(item => item.id === body.actionId)
    if (!action) throw new Error('Action unavailable')
    const effect = action.effects?.find(item => item.op === 'changeResource')
    if (effect) {
      const path = effect.resource.startsWith('resources.') ? effect.resource : `resources.${effect.resource}`
      const keys = path.split('.')
      const target = keys.slice(0, -1).reduce((value: any, key) => value?.[key], actor.data)
      const key = keys.at(-1) || ''
      const amount = effect.amount.literal || 0
      if (!target || typeof target[key] !== 'number' || target[key] + amount < 0 || target[key] + amount > (target.maximum ?? Infinity)) throw new Error('Resource outside allowed range')
      target[key] += amount
    }
    actor.revision += 1
    const activity: Activity = { id: body.operationId, actor: actor.name, action: action.id, detail: 'Preview action applied', time: new Date().toISOString(), visibility: 'all', cursor: demo.context.cursor + 1 }
    demo = { ...demo, context: { ...demo.context, cursor: activity.cursor }, activity: [activity, ...demo.activity] }
    events.dispatchEvent(new Event('change'))
  },
  async setEncounter(role, id) {
    if (role !== 'gm') throw new Error('GM role required')
    const encounter = id === null ? null : demo.encounters.find(item => item.id === id)
    if (id !== null && !encounter) throw new Error('Encounter unavailable')
    demo = { ...demo, context: { ...demo.context, activeEncounter: encounter || null, cursor: demo.context.cursor + 1 } }
    events.dispatchEvent(new Event('change'))
  },
  async createActor() { throw new Error('Character creation requires a configured host') },
  subscribe(role, onSnapshot, onStatus) {
    onStatus('connected')
    const listener = () => void host.load(role).then(onSnapshot)
    events.addEventListener('change', listener)
    return () => events.removeEventListener('change', listener)
  },
}
