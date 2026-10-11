import { initialActors, type Actor, type GameModule } from './modules'

export type Role = 'gm' | 'player'
export type Encounter = { id: string; name: string; summary: string }
export type SessionContext = { campaignId: string; activeEncounter: Encounter | null; cursor: number }
export type Activity = { id: string; actor: string; action: string; detail: string; time: string; visibility: 'all' | 'gm'; cursor: number }
export type Snapshot = { role: Role; actors: Actor[]; encounters: Encounter[]; context: SessionContext; activity: Activity[] }
export type ActionRequest = { operationId: string; entityId: string; baseRevision: number; actionId: string; parameters: Record<string, unknown> }
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'
export type HostAdapter = {
  mode: 'demo' | 'host'
  load(role: Role): Promise<Snapshot>
  command(role: Role, body: ActionRequest): Promise<void>
  setEncounter(role: Role, id: string | null): Promise<void>
  subscribe(role: Role, onSnapshot: (snapshot: Snapshot) => void, onStatus: (status: ConnectionStatus) => void): () => void
}

const baseUrl = import.meta.env.VITE_POTOMAC_HOST?.replace(/\/$/, '')
const hostConfigured = Boolean(baseUrl)
const events = new EventTarget()
const demoEncounters: Encounter[] = [
  { id: 'encounter-a', name: 'The Glass Bridge', summary: 'The party crosses a flooded causeway beneath the old watchtower.' },
  { id: 'encounter-b', name: 'The Ashen Gate', summary: 'A sealed gate waits beyond the ridge; distant lights mark the approach.' },
]
let demo: Snapshot = {
  role: 'gm', actors: structuredClone(initialActors), encounters: demoEncounters,
  context: { campaignId: 'foundation-demo', activeEncounter: demoEncounters[0], cursor: 1 }, activity: [],
}

function tokenFor(role: Role) {
  return role === 'gm' ? (import.meta.env.VITE_POTOMAC_GM_TOKEN || 'local-gm') : (import.meta.env.VITE_POTOMAC_PLAYER_TOKEN || 'local-player')
}
async function http<T>(path: string, role: Role, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenFor(role)}`, ...init?.headers } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Host request failed (${response.status})`)
  return body as T
}

type HostState = {
  campaignId: string; revision: number; context?: { activeEncounter?: string | null }; encounters?: Encounter[]
  modules?: Array<Record<string, unknown>>
  actors?: Array<{ id: string; moduleId: string; moduleVersion: string; revision: number; data: Record<string, any> }>
  events?: Array<{ id: string; actorId: string | null; kind: string; payload: Record<string, any>; createdAt: string; visibility: string; cursor: number }>
}
function fromHost(body: HostState, role: Role): Snapshot {
  const modules = new Map((body.modules || []).map(entry => [`${entry.id}@${entry.version}`, entry]))
  const actors: Actor[] = (body.actors || []).flatMap(row => {
    const definition = modules.get(`${row.moduleId}@${row.moduleVersion}`)
    if (!definition) return []
    const module: GameModule = {
      manifest: { id: String(definition.id), version: String(definition.version), name: String(definition.name || definition.id), tagline: String(definition.tagline || definition.type || 'Game system') },
      view: definition.view as GameModule['view'], actions: (definition.actions || []) as GameModule['actions'],
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
  return { role, actors, encounters, context: { campaignId: body.campaignId, activeEncounter: encounters.find(item => item.id === body.context?.activeEncounter) || null, cursor: body.revision || 0 }, activity }
}
async function loadHost(role: Role) {
  const body = await http<HostState>('/api/state', role)
  const snapshot = fromHost(body, role)
  if (snapshot.actors.length || role !== 'gm') return snapshot
  for (const fixture of initialActors) {
    const data = structuredClone({ ...fixture.data, name: fixture.name, epithet: fixture.epithet })
    await http('/api/actors', role, { method: 'POST', body: JSON.stringify({ id: fixture.entityId, moduleId: fixture.module.manifest.id, moduleVersion: fixture.module.manifest.version, data, visibility: { gmOnly: fixture.secretNote ? ['secretNote'] : [] } }) })
  }
  return fromHost(await http<HostState>('/api/state', role), role)
}

export const host: HostAdapter = hostConfigured ? {
  mode: 'host', load: loadHost,
  async command(role, body) { await http('/api/actions', role, { method: 'POST', body: JSON.stringify(body) }) },
  async setEncounter(role, id) { await http('/api/context', role, { method: 'POST', body: JSON.stringify({ context: { activeEncounter: id } }) }) },
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
  subscribe(role, onSnapshot, onStatus) {
    onStatus('connected')
    const listener = () => void host.load(role).then(onSnapshot)
    events.addEventListener('change', listener)
    return () => events.removeEventListener('change', listener)
  },
}
