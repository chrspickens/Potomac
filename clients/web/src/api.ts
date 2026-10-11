import { initialActors, type Actor, type GameModule } from './modules'

export type Role = 'gm' | 'player'
export type SessionContext = { campaignId: string; activeEncounter: { id: string; name: string } | null; cursor: number }
export type Activity = { id: string; actor: string; action: string; detail: string; time: string; visibility: 'all' | 'gm'; cursor: number }
export type Snapshot = { role: Role; actors: Actor[]; context: SessionContext; activity: Activity[] }
export type ActionRequest = { operationId: string; entityId: string; baseRevision: number; actionId: string; parameters: Record<string, unknown> }
export type HostAdapter = {
  mode: 'demo' | 'host'
  load(role: Role): Promise<Snapshot>
  command(body: ActionRequest): Promise<{ actor: Actor; activity: Activity }>
  setEncounter(name: string | null): Promise<SessionContext>
  subscribe(role: Role, onSnapshot: (snapshot: Snapshot) => void): () => void
}

const baseUrl = import.meta.env.VITE_POTOMAC_HOST?.replace(/\/$/, '')
const hostConfigured = Boolean(baseUrl)
const events = new EventTarget()
let currentRole: Role = 'player'
let state: Snapshot = {
  role: 'player', actors: structuredClone(initialActors),
  context: { campaignId: 'campaign-demo', activeEncounter: { id: 'encounter-bridge', name: 'The Glass Bridge' }, cursor: 18 },
  activity: [
    { id: 'evt-18', actor: 'GM', action: 'Encounter started', detail: 'The Glass Bridge', time: 'Just now', visibility: 'all', cursor: 18 },
    { id: 'evt-17', actor: 'Tarin Vale', action: 'Changed scene', detail: 'Approaching the flooded causeway', time: '4 min ago', visibility: 'all', cursor: 17 },
    { id: 'evt-16', actor: 'GM', action: 'GM note', detail: 'A watcher follows the party from the ridge.', time: '6 min ago', visibility: 'gm', cursor: 16 },
  ],
}
function emit() { events.dispatchEvent(new Event('change')) }
async function http<T>(path: string, role: Role, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${role === 'gm' ? (import.meta.env.VITE_POTOMAC_GM_TOKEN || 'local-gm') : (import.meta.env.VITE_POTOMAC_PLAYER_TOKEN || 'local-player')}`, ...init?.headers } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Host request failed (${response.status})`)
  return body as T
}

function snapshotFromHost(body: any, role: Role): Snapshot {
  const modules = new Map<string, any>()
  for (const entry of body.modules || []) modules.set(`${entry.id}@${entry.version}`, entry)
  const actors: Actor[] = (body.actors || []).flatMap((row: any) => {
    const definition = modules.get(`${row.moduleId}@${row.moduleVersion}`)
    if (!definition) return []
    const module: GameModule = {
      manifest: { id: definition.id, version: definition.version, name: definition.name || definition.id, tagline: definition.tagline || definition.type || 'Game system' },
      view: definition.view,
      actions: definition.actions || [],
    }
    return [{ entityId: row.id, revision: row.revision, module, data: row.data, name: row.data.name || row.id, epithet: row.data.epithet || '', secretNote: row.data.secretNote }]
  })
  return {
    role, actors,
    context: { campaignId: body.campaignId, activeEncounter: body.context?.activeEncounter ? { id: body.context.activeEncounter, name: body.context.activeEncounter } : null, cursor: body.revision || 0 },
    activity: (body.events || []).map((event: any) => ({ id: event.id, actor: event.actorId || 'GM', action: event.kind === 'action.applied' ? event.payload.actionId : event.kind === 'context.changed' ? 'Encounter updated' : event.kind, detail: event.payload.activeEncounter || (event.payload.rolls?.length ? `Verified roll: ${event.payload.rolls.join(' + ')}` : `${event.payload.resource || ''} ${event.payload.value ?? ''}`.trim()), time: event.createdAt, visibility: event.visibility === 'gm' ? 'gm' : 'all', cursor: event.cursor })),
  }
}

export const host: HostAdapter = hostConfigured ? {
  mode: 'host',
  async load(role) {
    currentRole = role
    const body = await http<any>('/api/state', role)
    const snapshot = snapshotFromHost(body, role)
    if (snapshot.actors.length === 0 && role === 'gm') {
      for (const fixture of initialActors) {
        const data = structuredClone({ ...fixture.data, name: fixture.name, epithet: fixture.epithet })
        await http('/api/actors', role, { method: 'POST', body: JSON.stringify({ id: fixture.entityId, moduleId: fixture.module.manifest.id, moduleVersion: fixture.module.manifest.version, data, visibility: { gmOnly: fixture.secretNote ? ['secretNote'] : [] } }) })
      }
      return snapshotFromHost(await http<any>('/api/state', role), role)
    }
    return snapshot
  },
  async command(body) {
    const result = await http<any>('/api/actions', currentRole, { method: 'POST', body: JSON.stringify(body) })
    const snapshot = await http<any>('/api/state', currentRole)
    const normalized = snapshotFromHost(snapshot, currentRole)
    const actor = normalized.actors.find(item => item.entityId === body.entityId)
    const activity = normalized.activity.find(item => item.id === result.operationId) || { id: result.operationId, actor: actor?.name || 'You', action: body.actionId, detail: result.resolution ? `Verified roll: ${result.resolution.groups.flatMap((group: any) => group.dice).join(' + ')}` : body.actionId, time: 'Just now', visibility: 'all' as const, cursor: snapshot.revision }
    return { actor: actor!, activity }
  },
  async setEncounter(name) {
    await http('/api/context', currentRole, { method: 'POST', body: JSON.stringify({ context: { activeEncounter: name } }) })
    return (await host.load(currentRole)).context
  },
  subscribe(role, onSnapshot) {
    let stopped = false
    let controller: AbortController | undefined
    let cursor = 0
    const run = async () => {
      while (!stopped) {
        controller = new AbortController()
        try {
          const token = role === 'gm' ? (import.meta.env.VITE_POTOMAC_GM_TOKEN || 'local-gm') : (import.meta.env.VITE_POTOMAC_PLAYER_TOKEN || 'local-player')
          const response = await fetch(`${baseUrl}/api/stream?since=${cursor}`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal })
          if (!response.ok || !response.body) throw new Error('Stream unavailable')
          const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''
          while (!stopped) {
            const { value, done } = await reader.read(); if (done) break
            buffer += decoder.decode(value, { stream: true })
            const blocks = buffer.split('\n\n'); buffer = blocks.pop() || ''
            if (blocks.some(block => block.includes('event: update'))) {
              const id = [...blocks.join('\n').matchAll(/^id: (\d+)$/gm)].at(-1)?.[1]; if (id) cursor = Number(id)
              const fresh = await host.load(role); cursor = Math.max(cursor, fresh.context.cursor); onSnapshot(fresh)
            }
          }
        } catch { if (!stopped) await new Promise(resolve => setTimeout(resolve, 1200)) }
      }
    }
    void run()
    return () => { stopped = true; controller?.abort() }
  },
} : {
  mode: 'demo',
  async load(role) {
    // This local preview projection is illustrative; real secret filtering belongs on the host.
    return structuredClone({ ...state, role, activity: role === 'gm' ? state.activity : state.activity.filter(item => item.visibility === 'all'), actors: state.actors.map(actor => role === 'gm' ? actor : { ...actor, secretNote: undefined }) })
  },
  async command(body) {
    const actor = state.actors.find(item => item.entityId === body.entityId)
    if (!actor) throw new Error('Character not found')
    const action = actor.module.actions.find(item => item.id === body.actionId)
    if (!action) throw new Error('Action is not available in this module')
    const effect = action.effects?.find(item => item.op === 'changeResource')
    if (effect) {
      const path = effect.resource.startsWith('resources.') ? effect.resource : `resources.${effect.resource}`
      const target = path.split('.').slice(0, -1).reduce((value: any, key) => value?.[key], actor.data)
      const key = path.split('.').at(-1)!
      const amount = effect.amount.literal || 0
      if (!target || typeof target[key] !== 'number' || target[key] + amount < 0 || target[key] + amount > (target.maximum ?? Infinity)) throw new Error('Resource is outside its allowed range')
      target[key] += amount
    }
    actor.revision += 1
    const dice = action.resolution?.dice.flatMap(group => Array.from({ length: group.count }, () => Math.ceil(Math.random() * group.sides))) || []
    const activity: Activity = { id: body.operationId, actor: actor.name, action: action.id, detail: dice.length ? `Preview roll: ${dice.join(' + ')}` : 'Preview action applied', time: 'Just now', visibility: 'all', cursor: state.context.cursor + 1 }
    state = { ...state, context: { ...state.context, cursor: activity.cursor }, activity: [activity, ...state.activity] }
    emit()
    return { actor: structuredClone(actor), activity }
  },
  async setEncounter(name) {
    state = { ...state, context: { ...state.context, activeEncounter: name ? { id: `encounter-${Date.now()}`, name } : null, cursor: state.context.cursor + 1 } }
    emit()
    return state.context
  },
  subscribe(role, onSnapshot) {
    const listener = () => void host.load(role).then(onSnapshot)
    events.addEventListener('change', listener)
    return () => events.removeEventListener('change', listener)
  },
}
