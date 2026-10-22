import { Component, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { configuredHost, credentialForRole, commandSession, connectPlayerCredential, createCampaignEncounter, decideReviewProposal, editCampaignEncounter, editCharacterFields, enrollLocalPlayer, fetchMapBackground, getCampaignConfig, grantActorToMember, host, listLore, listLoreLinkedToEncounter, listMaps, listMyOfflineReceipts, listReviewProposals, loadAuthorizedEncounter, loadCampaignEncounter, loadMap, loadReviewProposal, loadSessionSnapshot, saveCampaignConfig, saveEncounterParticipants, submitOfflineOperation, submitSessionAction, type CampaignSearchResult, type CampaignConfig, type Encounter, type ConnectionStatus, type LoreArticle, type MapPieceView, type MapSceneView, type ReviewProposal, type Role, type SessionSnapshot, type Snapshot } from './api'
import { forgetRememberedIdentity, loadRememberedIdentity } from './identity'
import { cachePlayerSnapshot, clearRememberedPlayerData, loadCachedPlayerSnapshot } from './offline/snapshots'
import { openOfflineStorage, type OfflineOperation, type PrivateDraft, type QueuedOperation } from './offline/storage'
import { flushOfflineQueue } from './offline/reconcile'
import { ConflictRecovery } from './offline/conflict-recovery.tsx'
import type { Actor } from './modules'
import { createDefaultWorkspace, getBrickDefinition, getBrickDefinitions, isSupportedBinding, loadWorkspaceWithRecovery, saveWorkspace, type BrickInstance, type WorkspaceState } from './workspace'
import { CharacterPreparationContext, CharacterView, resolveDefaultBinding } from './workspace/contributions.tsx'
import { resolveBindingMode } from './workspace/binding.ts'
import { createAuthorizedBrickAdapter } from './workspace/authorized-adapter.ts'
import { resolveBrickLayout } from './workspace/layout.ts'
import { useBrickDrag } from './workspace/use-brick-drag.ts'
import { createSchemaDefaults } from './schema-form.ts'
import { LoreApp, LoreArticlesContext, LoreRelationsContext, LoreTargetContext } from './lore-app.tsx'
import './workspace/brick-canvas.css'
import { MapsApp } from './maps-app.tsx'
import './maps.css'
import { CampaignSearch } from './campaign-search'
import { campaignSearchAvailable } from './campaign-search-availability'
import { CampaignHome } from './campaign-home'
import './campaign-home.css'
import './v2-navigation.css'
import { V2ModulesApp } from './v2-modules'
import { V2TableView } from './v2-table-view'
import { isLoopbackV2Origin, v2CampaignSetupBlockReason } from './campaign-v2-setup'

const profileKey = 'potomac.workspace.demo-profile'
const newId = () => crypto.randomUUID()
const displayError = (cause: unknown) => cause instanceof Error ? cause.message : 'Request failed'
type TrustedV2Module = { id: string; name: string; version: string; digest: string }
type V2CampaignLock = { lock: { campaignId: string; rootModule: { id: string; version: string; digest: string } }; digest: string }
type V2SetupState = 'loading' | 'unavailable' | 'ready' | 'error'
function loopbackV2EnabledInBrowser() { return isLoopbackV2Origin(window.location.hostname, configuredHost) }
async function v2HostRequest(path: string, role: Role, init: RequestInit = {}) {
  if (!configuredHost) throw new Error('A configured local host is required for experimental modules.')
  const response = await fetch(`${configuredHost}${path}`, { ...init, headers: { authorization: `Bearer ${credentialForRole(role)}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } })
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw Object.assign(new Error(String(body.error || body.message || `Host request failed (${response.status})`)), { status: response.status, reasonCode: body.reasonCode })
  return body
}

function SchemaFields({ schema, value, onChange }: { schema?: Record<string, unknown>; value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const definitions = schema && typeof schema.$defs === 'object' && schema.$defs !== null ? schema.$defs as Record<string, Record<string, unknown>> : {}
  const resolve = (definition: Record<string, unknown>): Record<string, unknown> => typeof definition.$ref === 'string' && definition.$ref.startsWith('#/$defs/') ? resolve(definitions[definition.$ref.slice('#/$defs/'.length)] || {}) : definition
  const rawProperties = schema && typeof schema.properties === 'object' && schema.properties !== null ? schema.properties as Record<string, Record<string, unknown>> : {}
  const properties = Object.fromEntries(Object.entries(rawProperties).map(([key, definition]) => [key, resolve(definition)])) as Record<string, Record<string, unknown>>
  const required = Array.isArray(schema?.required) ? schema.required.filter((item): item is string => typeof item === 'string') : []
  return <div className="schema-fields">{Object.entries(properties).filter(([key, definition]) => !['moduleId', 'moduleVersion', 'schemaVersion', 'entityId', 'revision', 'derived', 'secretNote'].includes(key) && (definition.type === 'string' || definition.type === 'integer' || definition.type === 'number')).map(([key, definition]) => {
    const current = value[key]
    const numeric = definition.type === 'integer' || definition.type === 'number'
    return <label key={key}>{key === 'name' ? 'Name' : key === 'epithet' ? 'Description / epithet' : key}{required.includes(key) ? ' *' : ''}<input type={numeric ? 'number' : 'text'} required={required.includes(key)} min={typeof definition.minimum === 'number' ? definition.minimum : undefined} max={typeof definition.maximum === 'number' ? definition.maximum : undefined} maxLength={typeof definition.maxLength === 'number' ? definition.maxLength : undefined} value={current === undefined ? '' : String(current)} onChange={event => onChange({ ...value, [key]: numeric ? Number(event.target.value) : event.target.value })} /></label>
  })}{Object.entries(properties).filter(([key, definition]) => !['moduleId', 'moduleVersion', 'schemaVersion', 'entityId', 'revision', 'derived', 'secretNote'].includes(key) && definition.type === 'object').map(([group, definition]) => {
    const children = definition.properties && typeof definition.properties === 'object' ? Object.fromEntries(Object.entries(definition.properties as Record<string, Record<string, unknown>>).map(([key, child]) => [key, resolve(child)])) as Record<string, Record<string, unknown>> : {}
    const existing = value[group] && typeof value[group] === 'object' ? value[group] as Record<string, unknown> : {}
    return <fieldset key={group}><legend>{group}</legend>{Object.entries(children).map(([key, child]) => {
      if (child.type === 'object') {
        const nested = child.properties && typeof child.properties === 'object' ? child.properties as Record<string, Record<string, unknown>> : {}
        const nestedValue = existing[key] && typeof existing[key] === 'object' ? existing[key] as Record<string, unknown> : {}
        return <fieldset key={key}><legend>{key}</legend>{Object.entries(nested).map(([leaf, leafSchema]) => <label key={leaf}>{leaf}<input type="number" required={Array.isArray(child.required) && child.required.includes(leaf)} min={typeof leafSchema.minimum === 'number' ? leafSchema.minimum : undefined} max={typeof leafSchema.maximum === 'number' ? leafSchema.maximum : undefined} value={nestedValue[leaf] === undefined ? '' : String(nestedValue[leaf])} onChange={event => onChange({ ...value, [group]: { ...existing, [key]: { ...nestedValue, [leaf]: Number(event.target.value) } } })} /></label>)}</fieldset>
      }
      const current = existing[key]
      return <label key={key}>{key}<input type={child.type === 'integer' || child.type === 'number' ? 'number' : 'text'} required={Array.isArray(definition.required) && definition.required.includes(key)} min={typeof child.minimum === 'number' ? child.minimum : undefined} max={typeof child.maximum === 'number' ? child.maximum : undefined} value={current === undefined ? '' : String(current)} onChange={event => onChange({ ...value, [group]: { ...existing, [key]: child.type === 'integer' || child.type === 'number' ? Number(event.target.value) : event.target.value } })} /></label>
    })}</fieldset>
  })}</div>
}

class BrickBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <div className="brick-message" role="alert">This brick could not render. Your layout is preserved.</div> : this.props.children }
}

function ActivityLog({ snapshot }: { snapshot: Snapshot | null }) {
  return <div className="activity-list">{snapshot?.activity.length ? snapshot.activity.slice(-12).reverse().map(item => <div className="activity-item" key={item.id}><span className="activity-dot" /><div><strong>{item.action}</strong><p>{item.detail || 'Campaign event'}</p><small>{item.actor} · {item.time}{item.visibility === 'gm' ? ' · GM only' : ''}</small></div></div>) : <p className="brick-message">Actions and encounter changes will appear here.</p>}</div>
}

function defaultBinding(typeId: string, snapshot: Snapshot | null, role: Role = 'player', session?: SessionSnapshot, encounters?: Encounter[], lore: LoreArticle[] = []): BrickInstance['binding'] {
  const definition = getBrickDefinition(typeId)
  if (!definition) return { mode: 'none' }
  return resolveDefaultBinding(definition, createAuthorizedBrickAdapter(snapshot?.actors ?? [], encounters ?? snapshot?.encounters ?? [], snapshot?.context.activeEncounter ?? null, snapshot?.activity ?? [], session, role, lore))
}

function BrickContent({ brick, snapshot, encounters, lore = [], maps = [], busy, offline, onAction, onOpenApp, onMoveMapPiece = () => {}, session, role, onSessionCommand }: { brick: BrickInstance; snapshot: Snapshot | null; encounters: Encounter[]; lore?: LoreArticle[]; maps?: MapSceneView[]; busy: boolean; offline: boolean; onAction: (actor: Actor, actionId: string) => void; onOpenApp: (appId: 'table' | 'characters' | 'encounters' | 'lore' | 'maps', entityId?: string) => void; onMoveMapPiece?: (sceneId: string, piece: MapPieceView, point: { x: number; y: number }) => void; session?: SessionSnapshot; role: Role; onSessionCommand: (command: 'start' | 'pause' | 'resume' | 'finish', encounter?: { id: string; revision: number }) => void }) {
  const authorizedLore = useContext(LoreArticlesContext)
  const loreRelations = useContext(LoreRelationsContext)
  const setLoreTarget = useContext(LoreTargetContext)
  const definition = getBrickDefinition(brick.typeId)
  if (!definition) return <p className="brick-message">Brick “{brick.typeId}” is unavailable. Its saved settings are preserved.</p>
  if (!isSupportedBinding(brick.typeId, brick.binding)) return <p className="brick-message">This saved binding is unsupported. Choose a supported binding to repair it; saved settings are preserved.</p>
  if (!snapshot) return <p className="brick-message">Waiting for the host…</p>
  const activeEncounter = encounters.find(item => item.id === snapshot.context.activeEncounter?.id) ?? null
  const activeWithLore = activeEncounter ? { ...activeEncounter, loreIds: loreRelations[activeEncounter.id] ?? activeEncounter.loreIds } : null
  const adapter = createAuthorizedBrickAdapter(snapshot.actors, encounters, activeWithLore, snapshot.activity, session, role, lore.length ? lore : authorizedLore, maps)
  return <definition.render brick={brick} data={definition.resolve(brick.binding, adapter)} adapter={adapter} busy={busy} offline={offline} onAction={onAction} onOpenApp={(appId, entityId) => { if (appId === 'lore') setLoreTarget(entityId); onOpenApp(appId, entityId) }} onMoveMapPiece={onMoveMapPiece} onSessionCommand={onSessionCommand} />
}

export default function App() {
  void defaultBinding
  const [role, setRole] = useState<Role>(() => configuredHost && loadRememberedIdentity(configuredHost) ? 'player' : 'gm')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [connection, setConnection] = useState<ConnectionStatus>('connecting')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionState, setActionState] = useState('')
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const [identityRevision, setIdentityRevision] = useState(0)
  const [playerCredentialDialogOpen, setPlayerCredentialDialogOpen] = useState(false)
  const [playerCredentialDraft, setPlayerCredentialDraft] = useState('')
  const [playerCredentialBusy, setPlayerCredentialBusy] = useState(false)
  const playerCredentialDialogRef = useRef<HTMLDialogElement>(null)
  const [queued, setQueued] = useState<QueuedOperation[]>([])
  const [drafts, setDrafts] = useState<PrivateDraft[]>([])
  const [draftNextEdit, setDraftNextEdit] = useState(false)
  const [dependencyEntityId, setDependencyEntityId] = useState('')
  const dependencyEntityIdRef = useRef('')
  const [issuedCredential, setIssuedCredential] = useState<{ memberId: string; credential: string } | null>(null)
  const [proposals, setProposals] = useState<ReviewProposal[]>([])
  const [activeProposal, setActiveProposal] = useState<ReviewProposal | null>(null)
  const decisionIds = useRef(new Map<string, string>())
  const syncInFlight = useRef(false)
  const syncRequested = useRef(false)
  const [section, setSection] = useState<'home' | 'dashboard' | 'table' | 'characters' | 'encounters' | 'lore' | 'maps' | 'rules'>('home')
  const [v2SetupState, setV2SetupState] = useState<V2SetupState>('loading')
  const [v2SetupMessage, setV2SetupMessage] = useState('')
  const [trustedV2Modules, setTrustedV2Modules] = useState<TrustedV2Module[]>([])
  const [selectedV2ModuleId, setSelectedV2ModuleId] = useState('')
  const [v2CampaignLock, setV2CampaignLock] = useState<V2CampaignLock | null>(null)
  const [v2TableEntityId, setV2TableEntityId] = useState<string>(() => { try { return sessionStorage.getItem('potomac.v2.table.entity') || '' } catch { return '' } })
  const openV2Table = (entityId: string) => { setV2TableEntityId(entityId); try { sessionStorage.setItem('potomac.v2.table.entity', entityId) } catch { /* Navigation still works for this view. */ } setSection('table') }
  const [mapScenes, setMapScenes] = useState<MapSceneView[]>([])
  const [mapBackgrounds, setMapBackgrounds] = useState<Record<string, Blob>>({})
  const [mapCacheTimes, setMapCacheTimes] = useState<Record<string, number>>({})
  const [mapTargetId, setMapTargetId] = useState<string>()
  const [loreArticles, setLoreArticles] = useState<LoreArticle[]>([])
  const [loreRelations, setLoreRelations] = useState<Record<string, string[]>>({})
  const [loreTargetId, setLoreTargetId] = useState<string>()
  const [loreReturnMapId, setLoreReturnMapId] = useState<string>()
  const [sessionSnapshot, setSessionSnapshot] = useState<SessionSnapshot>()
  const [tableEncounters, setTableEncounters] = useState<Encounter[]>([])
  const [selectedActorId, setSelectedActorId] = useState('')
  const [editing, setEditing] = useState(false)
  const [picker, setPicker] = useState(false)
  const [profileId, setProfileId] = useState(() => {
    try { return localStorage.getItem(profileKey) || 'local-demo' } catch { return 'local-demo' }
  })
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => createDefaultWorkspace('foundation-demo', profileId))
  const [loadedWorkspace, setLoadedWorkspace] = useState(false)
  const [encounterDraft, setEncounterDraft] = useState('')
  const [creatingCharacter, setCreatingCharacter] = useState(false)
  const [characterModuleId, setCharacterModuleId] = useState('')
  const [newCharacterData, setNewCharacterData] = useState<Record<string, unknown>>({})
  const [campaign, setCampaign] = useState<CampaignConfig | null>(null)
  const [campaignNameDraft, setCampaignNameDraft] = useState('')
  const [campaignSystemChoice, setCampaignSystemChoice] = useState('')
  const [editingCharacter, setEditingCharacter] = useState(false)
  const [editedCharacterData, setEditedCharacterData] = useState<Record<string, unknown>>({})
  const [encounterDetails, setEncounterDetails] = useState<Encounter | null>(null)
  const [encounterNameInput, setEncounterNameInput] = useState('')
  const [encounterSummaryInput, setEncounterSummaryInput] = useState('')
  const [encounterStatusInput, setEncounterStatusInput] = useState<'prepared' | 'active' | 'completed'>('prepared')
  const [encounterParticipantIds, setEncounterParticipantIds] = useState<string[]>([])
  const [creatingEncounter, setCreatingEncounter] = useState(false)
  const [openedLoreEncounterId, setOpenedLoreEncounterId] = useState('')
  const [preparationReturn, setPreparationReturn] = useState<{
    encounterId: string
    encounterName: string
    encounter: Encounter
    name: string
    summary: string
    status: 'prepared' | 'active' | 'completed'
    participantIds: string[]
  } | null>(null)
  const [searchReturn, setSearchReturn] = useState<{ section: 'home' | 'dashboard' | 'table' | 'characters' | 'encounters' | 'lore' | 'maps'; actorId: string; mapId?: string; loreId?: string } | null>(null)

  useEffect(() => {
    let stopped = false
    let live = false
    setSnapshot(null)
    setLastSyncedAt(null)
    setConnection('connecting')
    if (role === 'player' && configuredHost) {
      const identity = loadRememberedIdentity(configuredHost)
      if (identity) void loadCachedPlayerSnapshot(identity).then(cached => {
        if (!stopped && !live && cached) { setSnapshot(cached.snapshot); setLastSyncedAt(cached.lastSyncedAt) }
      }).catch(cause => { if (!stopped) setError(displayError(cause)) })
    }
    const stop = host.subscribe(role, value => {
      if (stopped) return
      live = true
      setSnapshot(value); setError(''); setLastSyncedAt(Date.now())
      if (role === 'player' && configuredHost && value.memberId) void cachePlayerSnapshot(configuredHost, value).catch(cause => setError(`Offline cache: ${displayError(cause)}`))
    }, setConnection)
    if (host.mode === 'demo') void host.load(role).then(value => { setSnapshot(value); setError('') }).catch(cause => setError(displayError(cause)))
    return () => { stopped = true; stop() }
  }, [role, identityRevision])

  useEffect(() => {
    const dialog = playerCredentialDialogRef.current
    if (playerCredentialDialogOpen && dialog && !dialog.open) dialog.showModal()
    else if (!playerCredentialDialogOpen && dialog?.open) dialog.close()
  }, [playerCredentialDialogOpen])

  useEffect(() => {
    if (!snapshot) return
    const campaignId = snapshot.context.campaignId
    const loaded = loadWorkspaceWithRecovery(campaignId, profileId, snapshot.actors.map(item => item.entityId))
    setWorkspace(loaded.state)
    if (loaded.recovered && loaded.reason !== 'missing') setError('Saved layout had invalid data. A safe layout was recovered; review it before editing.')
    setLoadedWorkspace(true)
  }, [snapshot?.context.campaignId, profileId])
  useEffect(() => {
    if (!loadedWorkspace) return
    try { saveWorkspace(workspace) } catch { setError('Layout could not be saved in this browser.') }
  }, [workspace, loadedWorkspace])
  useEffect(() => { setEncounterDraft(snapshot?.context.activeEncounter?.id || '') }, [snapshot?.context.activeEncounter?.id])
  useEffect(() => {
    if (!snapshot) { setSessionSnapshot(undefined); return }
    if (connection !== 'connected') { setSessionSnapshot(snapshot.session); return }
    let active = true
    void loadSessionSnapshot(role).then(value => { if (active) setSessionSnapshot(value) }).catch(() => { if (active) setSessionSnapshot(undefined) })
    return () => { active = false }
  }, [role, connection, snapshot?.context.cursor, snapshot?.session])
  useEffect(() => {
    if (!snapshot) { setTableEncounters([]); return }
    let active = true
    setTableEncounters(snapshot.encounters)
    if (host.mode !== 'host') return () => { active = false }
    const encounterIds = [...new Set([
      ...snapshot.encounters.map(encounter => encounter.id),
      ...(snapshot.context.activeEncounter ? [snapshot.context.activeEncounter.id] : []),
    ])]
    void Promise.all(encounterIds.map(id => loadAuthorizedEncounter(id, role).catch(() => undefined))).then(details => {
      if (active) setTableEncounters(details.filter((item): item is Encounter => Boolean(item)))
    })
    return () => { active = false }
  }, [role, snapshot?.context.cursor, snapshot?.context.activeEncounter?.id, snapshot?.encounters])
  useEffect(() => {
    if (!configuredHost || !snapshot) { setCampaign(null); return }
    let active = true
    const cacheKey = `potomac.campaign-config.${snapshot.context.campaignId}`
    if (connection !== 'connected') {
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null') as CampaignConfig | null
        if (cached && cached.id === snapshot.context.campaignId) setCampaign(cached)
      } catch { /* stale or malformed metadata is ignored while offline */ }
      return () => { active = false }
    }
    void getCampaignConfig(role).then(next => {
      if (!active) return
      setCampaign(next)
      try { localStorage.setItem(cacheKey, JSON.stringify(next)) } catch { /* metadata cache is optional */ }
    }).catch(cause => { if (active) setError(displayError(cause)) })
    return () => { active = false }
  }, [role, connection, snapshot?.context.campaignId, snapshot?.context.cursor])
  useEffect(() => {
    if (!configuredHost || !campaign || connection !== 'connected') return
    if (!loopbackV2EnabledInBrowser()) { setV2SetupState('unavailable'); setV2SetupMessage('Experimental V2 setup is available only from a loopback browser connected to a loopback host.'); setTrustedV2Modules([]); setV2CampaignLock(null); return }
    let active = true
    setV2SetupState('loading'); setV2SetupMessage('')
    void (async () => {
      try {
        const catalog = await v2HostRequest('/api/v2/modules', role, {}) as { modules?: TrustedV2Module[] }
        const modules = Array.isArray(catalog.modules) ? catalog.modules : []
        const lockResponse = await fetch(`${configuredHost}/api/v2/campaign/lock`, { headers: { authorization: `Bearer ${credentialForRole(role)}` } })
        let lock: V2CampaignLock | null = null
        if (lockResponse.ok) lock = await lockResponse.json() as V2CampaignLock
        else if (lockResponse.status !== 404) throw new Error(lockResponse.status === 403 ? 'Campaign permission denied.' : `V2 campaign lock is unsupported or unavailable (${lockResponse.status}).`)
        if (!active) return
        setTrustedV2Modules(modules); setV2CampaignLock(lock); setSelectedV2ModuleId(current => modules.some(module => module.id === current) ? current : modules[0]?.id ?? ''); setV2SetupMessage('')
        setV2SetupState('ready')
      } catch (cause) {
        if (!active) return
        const status = (cause as { status?: number }).status
        setTrustedV2Modules([]); setV2CampaignLock(null); setV2SetupState(status === 404 ? 'unavailable' : 'error'); setV2SetupMessage(displayError(cause))
      }
    })()
    return () => { active = false }
  }, [role, connection, campaign?.id, campaign?.revision, identityRevision])
  useEffect(() => {
    if (!campaign) return
    setCampaignNameDraft(campaign.name)
    setCampaignSystemChoice(campaign.systemModuleId && campaign.systemModuleVersion ? `${campaign.systemModuleId}@${campaign.systemModuleVersion}` : '')
  }, [campaign?.id, campaign?.revision])
  useEffect(() => {
    if (!snapshot || connection !== 'connected') { setLoreArticles([]); return }
    let active = true
    void listLore(role).then(items => { if (active) setLoreArticles(items) }).catch(() => { if (active) setLoreArticles([]) })
    return () => { active = false }
  }, [role, connection, snapshot?.context.campaignId, snapshot?.context.cursor])
  useEffect(() => {
    const id = snapshot?.context.activeEncounter?.id
    if (!id || connection !== 'connected') return
    let active = true
    void listLoreLinkedToEncounter(role, id).then(items => { if (active) setLoreRelations(current => ({ ...current, [id]: items.map(item => item.id) })) }).catch(() => { if (active) setLoreRelations(current => ({ ...current, [id]: [] })) })
    return () => { active = false }
  }, [role, connection, snapshot?.context.activeEncounter?.id])
  useEffect(() => {
    if (!snapshot || snapshot.role !== role || !configuredHost) { setMapScenes([]); setMapBackgrounds({}); setMapCacheTimes({}); return }
    const campaignId = snapshot.context.campaignId
    const memberId = snapshot.memberId || 'gm'
    let active = true
    const loadMaps = async () => {
      if (connection !== 'connected' && (role === 'gm' || memberId !== 'gm')) {
        const storage = await openOfflineStorage({ host: configuredHost, campaignId, memberId })
        try { const cached = await storage.listAuthorizedMapCache(); if (active) { setMapScenes(cached.map(item => item.scene)); setMapBackgrounds(Object.fromEntries(cached.flatMap(item => item.background ? [[item.scene.id, item.background]] : []))); setMapCacheTimes(Object.fromEntries(cached.map(item => [item.scene.id, item.cachedAt]))) } } finally { storage.close() }
        return
      }
      if (connection !== 'connected') return
      const maps = await listMaps(role)
      const full = await Promise.all(maps.map(scene => loadMap(role, scene.id).catch(() => scene)))
      if (!active) return
      setMapScenes(full)
      const cachedEntries: Array<{ scene: MapSceneView; cachedAt: number; background?: Blob }> = []
      const backgrounds: Record<string, Blob> = {}
      const cacheTimes: Record<string, number> = {}
      let imageBytes = 0
      for (const scene of full.slice(0, 20)) {
        const cachedAt = Date.now(); cacheTimes[scene.id] = cachedAt
        let background: Blob | undefined
        if (scene.background) {
          try {
            const image = await fetchMapBackground(role, scene.id)
            if (image.size <= 10 * 1024 * 1024 && imageBytes + image.size <= 20 * 1024 * 1024) { background = image; backgrounds[scene.id] = image; imageBytes += image.size }
          } catch { /* A scene can be cached without its image; the Maps UI reports the image unavailable. */ }
        }
        cachedEntries.push({ scene, cachedAt, ...(background ? { background } : {}) })
      }
      setMapBackgrounds(backgrounds); setMapCacheTimes(cacheTimes)
      if (snapshot.memberId || role === 'gm') {
        const storage = await openOfflineStorage({ host: configuredHost, campaignId, memberId: snapshot.memberId || 'gm' })
        try { await storage.replaceAuthorizedMapCache(cachedEntries) } finally { storage.close() }
      }
    }
    void loadMaps().catch(cause => { if (active) setError(`Maps: ${displayError(cause)}`) })
    return () => { active = false }
  }, [role, connection, snapshot?.context.campaignId, snapshot?.memberId, snapshot?.context.cursor])
  useEffect(() => { setEditingCharacter(false); setEditedCharacterData({}) }, [selectedActorId])

  const dashboard = workspace.dashboards.find(item => item.id === workspace.activeDashboardId) || workspace.dashboards[0]
  const drag = useBrickDrag({
    editing,
    dashboardId: dashboard?.id || '',
    bricks: dashboard?.bricks || [],
    onCommit: (dashboardId, bricks) => {
      const layouts = new Map(bricks.map(item => [item.id, item.layout]))
      setWorkspace(current => ({ ...current, dashboards: current.dashboards.map(item => item.id === dashboardId ? { ...item, bricks: item.bricks.map(brick => ({ ...brick, layout: layouts.get(brick.id) || brick.layout })) } : item) }))
    },
  })
  const visibleBricks = dashboard?.bricks || []
  const activeGroup = workspace.groups.find(item => item.id === workspace.activeGroupId) || workspace.groups[0]
  const groupDashboards = workspace.dashboards.filter(item => activeGroup?.dashboardIds.includes(item.id))
  const selectedActor = useMemo(() => snapshot?.actors.find(item => item.entityId === selectedActorId) || snapshot?.actors[0], [snapshot, selectedActorId])
  const update = (next: WorkspaceState) => setWorkspace(next)
  const updateDashboard = (id: string, transform: (dashboard: WorkspaceState['dashboards'][number]) => WorkspaceState['dashboards'][number]) =>
    update({ ...workspace, dashboards: workspace.dashboards.map(item => item.id === id ? transform(item) : item) })
  const updateBrick = (id: string, transform: (brick: BrickInstance) => BrickInstance) => {
    if (!dashboard) return
    updateDashboard(dashboard.id, item => ({ ...item, bricks: item.bricks.map(brick => brick.id === id ? transform(brick) : brick) }))
  }
  const adjustBrick = (id: string, transform: (layout: BrickInstance['layout']) => BrickInstance['layout']) => {
    if (!dashboard) return
    const target = dashboard.bricks.find(item => item.id === id)
    if (!target) return
    updateDashboard(dashboard.id, item => ({ ...item, bricks: resolveBrickLayout(item.bricks, id, transform(target.layout)) }))
  }
  void updateBrick
  void adjustBrick
  const createDashboard = () => {
    const name = window.prompt('Dashboard name', 'New dashboard')?.trim()
    if (!name || !activeGroup) return
    const id = newId()
    update({ ...workspace, activeDashboardId: id, groups: workspace.groups.map(group => group.id === activeGroup.id ? { ...group, dashboardIds: [...group.dashboardIds, id] } : group), dashboards: [...workspace.dashboards, { id, name, bricks: [] }] })
  }
  const renameDashboard = () => {
    if (!dashboard) return
    const name = window.prompt('Rename dashboard', dashboard.name)?.trim()
    if (name) updateDashboard(dashboard.id, item => ({ ...item, name }))
  }
  const deleteDashboard = () => {
    if (!dashboard || !window.confirm(`Delete “${dashboard.name}” from this local profile?`)) return
    const dashboards = workspace.dashboards.filter(item => item.id !== dashboard.id)
    const groups = workspace.groups.map(group => ({ ...group, dashboardIds: group.dashboardIds.filter(id => id !== dashboard.id) }))
    update({ ...workspace, dashboards, groups, activeDashboardId: dashboards[0]?.id || '' })
  }
  const createGroup = () => {
    const name = window.prompt('Group name', 'New group')?.trim()
    if (!name) return
    const id = newId()
    const dashboardId = newId()
    update({ ...workspace, activeGroupId: id, activeDashboardId: dashboardId, groups: [...workspace.groups, { id, name, dashboardIds: [dashboardId] }], dashboards: [...workspace.dashboards, { id: dashboardId, name: 'New dashboard', bricks: [] }] })
  }
  const renameGroup = () => {
    if (!activeGroup) return
    const name = window.prompt('Rename group', activeGroup.name)?.trim()
    if (name) update({ ...workspace, groups: workspace.groups.map(group => group.id === activeGroup.id ? { ...group, name } : group) })
  }
  const addBrick = (typeId: string) => {
    if (!dashboard) return
    const definition = getBrickDefinition(typeId)
    if (!definition) return
    const bottom = Math.max(0, ...dashboard.bricks.map(item => item.layout.y + item.layout.h))
    const adapter = createAuthorizedBrickAdapter(snapshot?.actors ?? [], snapshot?.encounters ?? [], snapshot?.context.activeEncounter ?? null, snapshot?.activity ?? [], sessionSnapshot, role, loreArticles, mapScenes)
    const brick: BrickInstance = { id: newId(), typeId, definitionVersion: definition.version, binding: resolveDefaultBinding(definition, adapter), options: {}, layout: { x: 0, y: bottom, w: definition.defaultSize.w, h: definition.defaultSize.h } }
    updateDashboard(dashboard.id, item => ({ ...item, bricks: [...item.bricks, brick] }))
    setPicker(false)
  }
  const act = async (actor: Actor, actionId: string, parameters: Record<string, unknown> = {}) => {
    setBusy(true); setError(''); setActionState(`Sending ${actionId} for ${actor.name}…`)
    try {
      const declaredAction = actor.module.actions.find(item => item.id === actionId)
      const currentSession = sessionSnapshot?.current || snapshot?.session?.current
      const useSessionCommand = Boolean(configuredHost && currentSession && (
        role === 'gm' || currentSession.status !== 'active' || declaredAction?.policy !== 'gmReview'
      ))
      if (useSessionCommand && currentSession) {
        if (connection !== 'connected') throw new Error('Reconnect to submit a session action; it was not queued or committed offline')
        const receipt = await submitSessionAction(role, {
          operationId: newId(), sessionId: currentSession.id, entityId: actor.entityId,
          baseRevision: actor.revision, actionId, parameters,
          ...(snapshot?.memberId ? {
            campaignId: snapshot.context.campaignId, memberId: snapshot.memberId,
            moduleId: actor.module.manifest.id, moduleVersion: actor.module.manifest.version,
            schemaVersion: typeof actor.data.schemaVersion === 'number' ? actor.data.schemaVersion : 1,
            dependencies: []
          } : {})
        })
        setSnapshot(await host.load(role))
        const roll = receipt.verified ? ` Verified roll: ${(receipt.rolls || []).join(' + ')}.` : ''
        setActionState(`${actionId} accepted at revision ${receipt.revision}.${roll}`)
        return
      }
      if (role === 'player' && snapshot?.memberId && configuredHost) {
        const action = declaredAction
        if (connection !== 'connected' && (action?.resolution || !['selfService', 'gmReview'].includes(action?.policy || ''))) throw new Error('This action requires a host connection; no offline roll was accepted')
        const operation: OfflineOperation = {
          operationId: newId(), campaignId: snapshot.context.campaignId, memberId: snapshot.memberId,
          entityId: actor.entityId, baseRevision: actor.revision, moduleId: actor.module.manifest.id,
          moduleVersion: actor.module.manifest.version,
          schemaVersion: typeof actor.data.schemaVersion === 'number' ? actor.data.schemaVersion : 1,
          actionId, parameters,
          dependencies: snapshot.actors
            .filter(dependency => dependency.entityId === dependencyEntityIdRef.current && dependency.entityId !== actor.entityId)
            .map(dependency => ({ entityId: dependency.entityId, revision: dependency.revision })),
        }
        const storage = await openOfflineStorage({ host: configuredHost, campaignId: operation.campaignId, memberId: operation.memberId })
        try {
          if (draftNextEdit) {
            await storage.savePrivateDraft({ draftId: newId(), entityId: actor.entityId, payload: { kind: 'offline-intent', operation } })
            setDrafts(await storage.listPrivateDrafts()); setDraftNextEdit(false)
          } else { await storage.enqueueOperation(operation); setQueued(await storage.listOperations()) }
        }
        finally { storage.close() }
        setActionState(draftNextEdit ? `${actionId} saved as a private local draft; not submitted.` : `${actionId} queued locally; awaiting host acknowledgement.`)
        if (!draftNextEdit && connection === 'connected') void syncPending(snapshot)
        return
      }
      await host.command(role, { operationId: newId(), entityId: actor.entityId, baseRevision: actor.revision, actionId, parameters })
      setSnapshot(await host.load(role))
      setActionState(`${actionId} accepted by host.`)
    } catch (cause) { setError(displayError(cause)); setActionState(`${actionId} rejected; no local state was committed.`) }
    finally { setBusy(false) }
  }
  const changeSession = async (command: 'start' | 'pause' | 'resume' | 'finish', encounter?: { id: string; revision: number }) => {
    const current = sessionSnapshot?.current
    if (role !== 'gm' || command !== 'start' && !current) return
    if (command === 'start' && !encounter) {
      setError('Choose an active encounter with a current host revision before starting a session.')
      return
    }
    setBusy(true); setError('')
    try {
      const result = await commandSession(command, command === 'start' ? newId() : current!.id, sessionSnapshot?.revision ?? 0, encounter)
      setSessionSnapshot(result)
      if (snapshot) setSnapshot(await host.load(role))
      setActionState({
        start: 'Session started.',
        pause: 'Session paused.',
        resume: 'Session resumed.',
        finish: 'Session ended.',
      }[command])
    } catch (cause) { setError(displayError(cause)) } finally { setBusy(false) }
  }
  const syncPending = async (current: Snapshot) => {
    if (!configuredHost || !current.memberId) return
    if (syncInFlight.current) { syncRequested.current = true; return }
    syncInFlight.current = true
    let transportFailed = false
    try {
      const storage = await openOfflineStorage({ host: configuredHost, campaignId: current.context.campaignId, memberId: current.memberId })
      try {
        setQueued(await storage.listOperations())
        setDrafts(await storage.listPrivateDrafts())
        if (connection === 'connected') {
          const result = await flushOfflineQueue(storage, submitOfflineOperation, setQueued)
          transportFailed = result.transportFailed
          if (transportFailed) setActionState('Some edits remain queued; the host acknowledgement was unavailable.')
        }
      } finally { storage.close() }
    } catch (cause) { setError(`Offline queue: ${displayError(cause)}`) }
    finally {
      syncInFlight.current = false
      const needsAnotherPass = syncRequested.current
      syncRequested.current = false
      // A request issued during the active flush must not disappear. Avoid a
      // tight retry loop on network failure: the reconnect/timer handles that.
      if (needsAnotherPass && !transportFailed && connection === 'connected') void syncPending(current)
    }
  }
  useEffect(() => {
    if (role === 'player' && snapshot?.memberId) void syncPending(snapshot)
  }, [role, snapshot?.memberId, snapshot?.context.campaignId, connection])
  useEffect(() => {
    if (role !== 'player' || connection !== 'connected' || !snapshot?.memberId) return
    const timer = setInterval(() => void syncPending(snapshot), 3000)
    return () => clearInterval(timer)
  }, [role, connection, snapshot?.memberId, snapshot?.context.campaignId])
  useEffect(() => {
    if (role !== 'gm' || connection !== 'connected' || !configuredHost) return
    void listReviewProposals().then(setProposals).catch(cause => setError(displayError(cause)))
  }, [role, connection, snapshot?.context.cursor])
  useEffect(() => {
    if (role !== 'player' || connection !== 'connected' || !configuredHost || !snapshot?.memberId) return
    const campaignId = snapshot.context.campaignId
    const memberId = snapshot.memberId
    let stopped = false
    const poll = async () => {
      try {
        const receipts = await listMyOfflineReceipts()
        const refreshedSnapshot = await host.load('player')
        const storage = await openOfflineStorage({ host: configuredHost, campaignId, memberId })
        try {
          const own = new Set((await storage.listOperations()).map(row => row.operation.operationId))
          for (const receipt of receipts) if (own.has(receipt.operationId)) await storage.recordReceipt(receipt)
          if (!stopped) { setSnapshot(refreshedSnapshot); setLastSyncedAt(Date.now()); setQueued(await storage.listOperations()) }
        } finally { storage.close() }
      } catch (cause) { if (!stopped) setError(`Receipt refresh: ${displayError(cause)}`) }
    }
    void poll()
    const timer = setInterval(() => void poll(), 3000)
    return () => { stopped = true; clearInterval(timer) }
  }, [role, connection, snapshot?.memberId, snapshot?.context.campaignId])
  const saveEncounter = async () => {
    setBusy(true); setError('')
    try { await host.setEncounter(role, encounterDraft || null); setSnapshot(await host.load(role)) }
    catch (cause) { setError(displayError(cause)) }
    finally { setBusy(false) }
  }
  const availableModules = useMemo(() => {
    const unique = new Map((snapshot?.modules || snapshot?.actors.map(actor => actor.module) || []).map(module => [`${module.manifest.id}@${module.manifest.version}`, module]))
    const modules = [...unique.values()]
    return campaign?.systemModuleId && campaign.systemModuleVersion
      ? modules.filter(module => module.manifest.id === campaign.systemModuleId && module.manifest.version === campaign.systemModuleVersion)
      : modules
  }, [snapshot?.modules, snapshot?.actors, campaign?.systemModuleId, campaign?.systemModuleVersion])
  const selectedModule = availableModules.find(module => module.manifest.id === characterModuleId) || availableModules[0]
  const startV2BlockReason = v2CampaignSetupBlockReason({ loopback: loopbackV2EnabledInBrowser(), hostReady: v2SetupState === 'ready', v1Pinned: Boolean(campaign?.systemModuleId), hasLegacyData: !snapshot || snapshot.actors.length > 0, v2Pinned: Boolean(v2CampaignLock), moduleSelected: Boolean(trustedV2Modules.find(module => module.id === selectedV2ModuleId)) })
  useEffect(() => {
    if (creatingCharacter && selectedModule && Object.keys(newCharacterData).length === 0) setNewCharacterData(createSchemaDefaults(selectedModule.schema || {}))
  }, [creatingCharacter, selectedModule?.manifest.id])
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { const heading = document.querySelector<HTMLElement>('.app-main h1'); if (heading) { heading.tabIndex = -1; heading.focus() } })
    return () => window.cancelAnimationFrame(frame)
  }, [section])
  const createCharacter = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedModule || role !== 'gm') return
    setBusy(true); setError('')
    try {
      const data: Record<string, unknown> = { ...createSchemaDefaults(selectedModule.schema || {}), ...newCharacterData, name: String(newCharacterData.name || '').trim(), epithet: String(newCharacterData.epithet || '').trim() }
      const id = newId()
      await host.createActor(role, { id, moduleId: selectedModule.manifest.id, moduleVersion: selectedModule.manifest.version, data, visibility: data.secretNote ? { gmOnly: ['secretNote'] } : {} })
      setSnapshot(await host.load(role)); setSelectedActorId(id); setCreatingCharacter(false); setNewCharacterData({})
      setActionState('Character created and accepted by host.')
    } catch (cause) { setError(displayError(cause)) }
    finally { setBusy(false) }
  }

  const saveCampaignSetup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!campaign || !campaignSystemChoice || !campaignNameDraft.trim()) return
    const selected = snapshot?.modules?.find(module => `${module.manifest.id}@${module.manifest.version}` === campaignSystemChoice)
    if (!selected) { setError('Select an installed game system'); return }
    if (v2CampaignLock) { setError('This campaign has an immutable V2 ruleset lock.'); return }
    setBusy(true); setError('')
    try {
      const updated = await saveCampaignConfig({
        name: campaignNameDraft.trim(), systemModuleId: selected.manifest.id,
        systemModuleVersion: selected.manifest.version, revision: campaign.revision
      })
      setCampaign(updated); setActionState(`Campaign ${updated.name} saved on host.`)
    } catch (cause) { setError(displayError(cause)) }
    finally { setBusy(false) }
  }
  const startExperimentalV2Campaign = async () => {
    if (!campaign || role !== 'gm' || connection !== 'connected' || !configuredHost) return
    if (v2CampaignLock) { setSection('rules'); return }
    const selected = trustedV2Modules.find(module => module.id === selectedV2ModuleId)
    if (startV2BlockReason) {
      const messages = { 'loopback-only': 'Experimental V2 is available only on a loopback browser and host.', 'host-disabled': v2SetupMessage || 'The trusted V2 host API is disabled or unavailable.', 'v1-pinned': 'This V1 campaign has an immutable ruleset. Start V2 on a fresh local host campaign.', 'legacy-data': 'This host already contains campaign data. Experimental V2 setup requires a fresh host.', 'already-pinned': 'The campaign already has an immutable V2 lock. Open its rules workspace.', 'module-unavailable': 'The selected trusted module is unavailable. Refresh the catalog and try again.' }
      setError(messages[startV2BlockReason]); return
    }
    if (!selected) { setError('The selected trusted module is unavailable. Refresh the catalog and try again.'); return }
    setBusy(true); setError('')
    try {
      const updated = await saveCampaignConfig({ name: campaignNameDraft.trim() || campaign.name || 'Experimental V2 campaign', systemModuleId: null, systemModuleVersion: null, revision: campaign.revision })
      const pinned = await v2HostRequest('/api/v2/campaign/lock', 'gm', { method: 'PUT', body: JSON.stringify({ moduleId: selected.id }) }) as V2CampaignLock
      setCampaign(updated); setV2CampaignLock(pinned); setSection('rules'); setActionState(`${selected.name} pinned from the trusted catalog for this fresh local host campaign.`)
    } catch (cause) { setError(displayError(cause)) }
    finally { setBusy(false) }
  }
  const saveCharacterEdit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedActor || !selectedActor.module.schema) return
    const properties = selectedActor.module.schema.properties as Record<string, unknown> | undefined
    const reserved = new Set(['moduleId', 'moduleVersion', 'schemaVersion', 'entityId', 'revision', 'derived'])
    const changes = Object.fromEntries(Object.entries(editedCharacterData).filter(([key]) => !!properties && Object.hasOwn(properties, key) && !reserved.has(key)))
    setBusy(true); setError('')
    try {
      await editCharacterFields(selectedActor.entityId, selectedActor.revision, changes, newId())
      setSnapshot(await host.load('gm')); setEditingCharacter(false)
      setActionState('Character fields updated on host.')
    } catch (cause) { setError(displayError(cause)) }
    finally { setBusy(false) }
  }
  const chooseEncounter = async (id: string) => {
    setBusy(true); setError('')
    try {
      const detail = await loadCampaignEncounter(id)
      setEncounterDetails(detail); setEncounterNameInput(detail.name); setEncounterSummaryInput(detail.summary)
      setEncounterStatusInput(detail.status || 'prepared')
      setEncounterParticipantIds((detail.participants || []).map(item => item.actorId))
    } catch (cause) { setError(displayError(cause)) }
    finally { setBusy(false) }
  }
  const returnToEncounterPreparation = async () => {
    const target = preparationReturn
    if (!target || role !== 'gm' || connection !== 'connected') return
    setSection('encounters'); setPreparationReturn(null); setOpenedLoreEncounterId('')
    setEncounterDetails(target.encounter); setEncounterNameInput(target.name); setEncounterSummaryInput(target.summary)
    setEncounterStatusInput(target.status); setEncounterParticipantIds(target.participantIds)
    setActionState(`Returned to preparation for ${target.encounterName}.`)
  }
  const handoffFromPreparation = (target: 'characters' | 'maps' | 'lore') => {
    if (!encounterDetails) return
    setPreparationReturn({ encounterId: encounterDetails.id, encounterName: encounterDetails.name, encounter: structuredClone(encounterDetails), name: encounterNameInput, summary: encounterSummaryInput, status: encounterStatusInput, participantIds: [...encounterParticipantIds] })
    if (target === 'maps') setMapTargetId(undefined)
    if (target === 'lore') setLoreTargetId(undefined)
    setSection(target)
  }
  const activateEncounterAndOpenTable = async (encounter: Encounter) => {
    if (role !== 'gm' || connection !== 'connected') return
    setBusy(true); setError('')
    try {
      // Activation is an explicit host context command. Opening Table only
      // changes this browser's local app selection; it never activates a
      // target implicitly.
      await host.setEncounter(role, encounter.id)
      // The encounter rail is a summary projection. Do not seed the editable
      // preparation form from it: participant details are loaded separately.
      setEncounterDetails(null)
      setSnapshot(await host.load(role))
      setSection('table')
      setActionState(`Prepared ${encounter.name}; ready to start the Table session.`)
    } catch (cause) { setError(displayError(cause)) }
    finally { setBusy(false) }
  }
  const openTableForEncounter = (encounter: Encounter) => {
    // Opening Table is local navigation only. Encounter cards are summaries
    // and must never become the source for a participant roster save.
    setEncounterDetails(null)
    setSection('table')
    setActionState(`Opened Table for ${encounter.name}; shared session context was not changed.`)
  }
  const returnToPreparation = async () => {
    const encounterId = snapshot?.context.activeEncounter?.id
    setSection('encounters')
    if (encounterId) {
      setOpenedLoreEncounterId('')
      await chooseEncounter(encounterId)
      setActionState('Returned to encounter preparation. Shared session context was not changed.')
    }
  }
  const createEncounter = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const created = await createCampaignEncounter(encounterNameInput.trim(), encounterSummaryInput)
      setCreatingEncounter(false)
      setSnapshot(await host.load('gm'))
      await chooseEncounter(created.id)
      setActionState('Encounter created on host.')
    } catch (cause) { setError(displayError(cause)) }
    finally { setBusy(false) }
  }
  const saveEncounterEdits = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!encounterDetails?.revision) return
    setBusy(true); setError('')
    try {
      const updated = await editCampaignEncounter(encounterDetails.id, encounterDetails.revision,
        { name: encounterNameInput.trim(), summary: encounterSummaryInput, status: encounterStatusInput })
      if (updated.revision === undefined) throw new Error('Encounter revision missing from host response')
      const latest = await saveEncounterParticipants(updated.id, updated.revision,
        encounterParticipantIds.map((actorId, index) => ({ actorId, status: 'active', activationOrder: index })))
      setEncounterDetails(latest)
      setTableEncounters(current => [...current.filter(item => item.id !== latest.id), latest])
      setSnapshot(await host.load('gm'))
      setActionState('Encounter and participants saved on host.')
    } catch (cause) { setError(displayError(cause)) }
    finally { setBusy(false) }
  }
  const changeProfile = () => {
    const id = window.prompt('Local layout profile (not an account or permission)', profileId)?.trim()
    if (!id) return
    try { localStorage.setItem(profileKey, id) } catch { setError('Profile preference could not be saved.') }
    setProfileId(id)
  }

  const usePlayerCredential = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const credential = playerCredentialDraft.trim()
    if (!credential || playerCredentialBusy) return
    setPlayerCredentialBusy(true)
    try {
      const verified = await connectPlayerCredential(credential)
      setSnapshot(verified); setRole('player'); setIdentityRevision(value => value + 1); setError('')
      setPlayerCredentialDialogOpen(false); setPlayerCredentialDraft('')
    } catch (cause) { setError(displayError(cause)) }
    finally { setPlayerCredentialBusy(false) }
  }
  const forgetDevice = async () => {
    if (!configuredHost) return
    const identity = loadRememberedIdentity(configuredHost)
    if (!identity || !window.confirm('Forget this player credential, cached characters, pending operations, and private drafts on this device?')) return
    try {
      await clearRememberedPlayerData(identity)
      forgetRememberedIdentity(configuredHost)
      setSnapshot(null); setLastSyncedAt(null); setIdentityRevision(value => value + 1)
    } catch (cause) { setError(`Could not clear local data: ${displayError(cause)}`) }
  }
  const enrollPlayer = async () => {
    const displayName = window.prompt('Player display name')?.trim()
    if (!displayName) return
    try {
      const enrolled = await enrollLocalPlayer(displayName)
      setIssuedCredential({ memberId: enrolled.memberId, credential: enrolled.credential })
      setActionState(`Player ${enrolled.displayName} enrolled. Share the credential privately; it is shown here only until dismissed.`)
    } catch (cause) { setError(displayError(cause)) }
  }
  const grantSelectedActor = async () => {
    if (!selectedActor) return
    const memberId = window.prompt(`Member ID to grant read/action access to ${selectedActor.name}`, issuedCredential?.memberId || '')?.trim()
    if (!memberId) return
    try { await grantActorToMember(selectedActor.entityId, memberId); setActionState(`${selectedActor.name} granted to member ${memberId}.`) }
    catch (cause) { setError(displayError(cause)) }
  }
  const reviewProposal = async (id: string) => {
    try { setActiveProposal(await loadReviewProposal(id)) }
    catch (cause) { setError(displayError(cause)) }
  }
  const decideProposal = async (decision: 'accept' | 'reject') => {
    if (!activeProposal) return
    const reason = decision === 'reject' ? window.prompt('Reason for rejection (optional)', '') : undefined
    if (reason === null) return
    const key = `${activeProposal.id}:${decision}:${reason || ''}`
    let decisionId = decisionIds.current.get(key)
    if (!decisionId) { decisionId = newId(); decisionIds.current.set(key, decisionId) }
    setBusy(true)
    try {
      const receipt = await decideReviewProposal(activeProposal.id, decisionId, decision, reason || undefined)
      setActionState(`Proposal ${receipt.status}; operation ${receipt.operationId}.`)
      setActiveProposal(null)
      setProposals(await listReviewProposals())
      setSnapshot(await host.load('gm'))
    } catch (cause) { setError(displayError(cause)) }
    finally { setBusy(false) }
  }
  const withPlayerStorage = async (work: (storage: Awaited<ReturnType<typeof openOfflineStorage>>) => Promise<void>) => {
    if (!configuredHost || !snapshot?.memberId) throw new Error('An enrolled player scope is required')
    const storage = await openOfflineStorage({ host: configuredHost, campaignId: snapshot.context.campaignId, memberId: snapshot.memberId })
    try { await work(storage); setQueued(await storage.listOperations()); setDrafts(await storage.listPrivateDrafts()) }
    finally { storage.close() }
  }
  const submitPrivateDraft = async (draft: PrivateDraft) => {
    const payload = draft.payload as { kind?: string; operation?: OfflineOperation } | null
    if (payload?.kind !== 'offline-intent' || !payload.operation || !snapshot?.memberId || payload.operation.memberId !== snapshot.memberId || payload.operation.campaignId !== snapshot.context.campaignId) {
      setError('This draft is not a compatible new operation; retain it until reviewed.'); return
    }
    try {
      await withPlayerStorage(async storage => { await storage.enqueueOperation(payload.operation!); await storage.deletePrivateDraft(draft.draftId) })
      setActionState(`${payload.operation.actionId} moved from private draft to pending queue.`)
      if (connection === 'connected') void syncPending(snapshot)
    } catch (cause) { setError(displayError(cause)) }
  }
  const discardPrivateDraft = async (draft: PrivateDraft) => {
    if (!window.confirm('Discard this private local draft? This cannot be undone.')) return
    try { await withPlayerStorage(storage => storage.deletePrivateDraft(draft.draftId)) }
    catch (cause) { setError(displayError(cause)) }
  }
  const editPrivateDraft = async (draft: PrivateDraft) => {
    const payload = draft.payload as { kind?: string; operation?: OfflineOperation } | null
    if (payload?.kind !== 'offline-conflict' || !payload.operation) return
    const input = window.prompt('Edit private draft action parameters as JSON (not submitted)', JSON.stringify(payload.operation.parameters, null, 2))
    if (input === null) return
    try {
      const parameters: unknown = JSON.parse(input)
      if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new Error('Parameters must be a JSON object')
      await withPlayerStorage(storage => storage.savePrivateDraft({ ...draft, payload: { ...payload, operation: { ...payload.operation!, parameters: parameters as Record<string, unknown> } } }).then(() => {}))
      setActionState('Private draft parameters updated locally; nothing was submitted to the host.')
    } catch (cause) { setError(`Edit draft: ${displayError(cause)}`) }
  }
  const cancelUnsentEdit = async (operationId: string) => {
    if (!window.confirm('Cancel this unsent local edit? Its authored input will be removed from this device.')) return
    try { await withPlayerStorage(storage => storage.cancelUnsentOperation(operationId)); setActionState('Unsent local edit canceled.') }
    catch (cause) { setError(`Cancel edit: ${displayError(cause)}`) }
  }
  const conflictMessage = (code: string) => ({
    gm_rejected: 'The GM rejected this request. You can keep your intent as a private draft or discard the local copy; ask the GM before submitting it again.',
    dependency_revision_conflict: 'A referenced character or prerequisite changed on the host.',
    revision_conflict: 'The authoritative character changed since this edit was prepared.',
    module_schema_conflict: 'The actor module or schema is no longer compatible.',
    actor_unavailable: 'The actor is no longer available to this member.',
  } as Record<string, string>)[code] || 'The host could not apply this edit; review it against current authorized state.'

  const activeEncounter = snapshot?.context.activeEncounter
  const playerCharacter = role === 'player' ? (selectedActor || snapshot?.actors[0] || null) : null
  const v2ModuleName = v2CampaignLock ? trustedV2Modules.find(module => module.id === v2CampaignLock.lock.rootModule.id && module.version === v2CampaignLock.lock.rootModule.version && module.digest === v2CampaignLock.lock.rootModule.digest)?.name || v2CampaignLock.lock.rootModule.id : ''
  const v2NavigationGuidance = v2CampaignLock && section === 'characters' ? `The Characters app lists legacy V1 records. Records owned by ${v2ModuleName} are managed in its Rules workspace.`
    : v2CampaignLock && section === 'encounters' ? `The Encounters app manages legacy V1 sessions. Prepare ${v2ModuleName} records in its Rules workspace.`
      : v2CampaignLock && section === 'maps' ? `Maps is a separate app and does not display ${v2ModuleName} records. Use its Rules workspace to prepare the module and Table to review supported views.` : ''
  const returnToTable = () => {
    setSection('table')
    setMapTargetId(undefined)
    setLoreTargetId(undefined)
    setActionState('Returned to the live Table view. Shared session context was not changed.')
  }
  const openCampaignHomeTarget = (target: 'table' | 'characters' | 'encounters' | 'lore' | 'maps' | 'rules', id?: string) => {
    if (target === 'rules') { setSection('rules'); return }
    if (target === 'table' && v2CampaignLock && id) { openV2Table(id); return }
    if (target === 'characters' && id) setSelectedActorId(id)
    if (target === 'encounters' && id) {
      setOpenedLoreEncounterId(id)
      if (role === 'gm') void chooseEncounter(id)
    }
    if (target === 'maps') setMapTargetId(id)
    if (target === 'lore') setLoreTargetId(id)
    setSection(target)
  }
  const createFromCampaignHome = (target: 'character' | 'encounter') => {
    if (target === 'character') {
      setCharacterModuleId(availableModules[0]?.manifest.id || '')
      setNewCharacterData({})
      setCreatingCharacter(true)
      setSection('characters')
      return
    }
    setCreatingEncounter(true)
    setEncounterDetails(null)
    setEncounterNameInput('')
    setEncounterSummaryInput('')
    setEncounterStatusInput('prepared')
    setEncounterParticipantIds([])
    setSection('encounters')
  }
  const openSearchResult = (result: CampaignSearchResult) => {
    if (!snapshot) return
    setSearchReturn({ section: section === 'rules' ? 'home' : section, actorId: selectedActorId, mapId: mapTargetId, loreId: loreTargetId })
    if (result.kind === 'actor') { setSelectedActorId(result.id); setSection('characters') }
    else if (result.kind === 'encounter') { setOpenedLoreEncounterId(result.id); setSection('encounters') }
    else if (result.kind === 'map') { setMapTargetId(result.id); setSection('maps') }
    else { setLoreTargetId(result.id); setSection('lore') }
  }
  const returnFromSearchResult = () => {
    if (!searchReturn) return
    setSection(searchReturn.section); setSelectedActorId(searchReturn.actorId); setMapTargetId(searchReturn.mapId); setLoreTargetId(searchReturn.loreId); setSearchReturn(null)
  }
  return <CharacterPreparationContext.Provider value={{ encounters: tableEncounters, onReturn: preparationReturn ? () => void returnToPreparation() : undefined, onLinkEncounter: async (actorId, encounterId) => {
    if (role !== 'gm' || connection !== 'connected') return
    setBusy(true); setError('')
    try {
      const actor = snapshot?.actors.find(item => item.entityId === actorId)
      const latest = await loadCampaignEncounter(encounterId)
      const roster = latest.participants || []
      if (roster.some(item => item.actorId === actorId)) { setActionState(`${actor?.name || 'Character'} is already linked to ${latest.name}.`); return }
      await saveEncounterParticipants(latest.id, latest.revision || 0, [...roster, { actorId, status: 'active', activationOrder: roster.length }])
      setActionState(`${actor?.name || 'Character'} linked to ${latest.name} on the host.`)
    } catch (cause) { setError(displayError(cause)) }
    finally { setBusy(false) }
  } }}><LoreTargetContext.Provider value={setLoreTargetId}><LoreRelationsContext.Provider value={loreRelations}><LoreArticlesContext.Provider value={loreArticles}><div className="app-shell">
    <aside className="app-rail"><div className="rail-brand"><span className="brand-mark">◆</span><span>Potomac</span></div><div className="campaign-select"><small>CAMPAIGN</small><strong>{campaign?.name || snapshot?.context.campaignId || 'Connecting…'}</strong><small>{v2CampaignLock ? `${trustedV2Modules.find(module => module.id === v2CampaignLock.lock.rootModule.id && module.version === v2CampaignLock.lock.rootModule.version && module.digest === v2CampaignLock.lock.rootModule.digest)?.name || v2CampaignLock.lock.rootModule.id} · ${v2CampaignLock.lock.rootModule.version} (V2)` : campaign?.systemModuleId ? `${campaign.systemModuleId}@${campaign.systemModuleVersion}` : v2SetupState === 'loading' ? 'Checking ruleset lock…' : 'Configure campaign in GM setup'}</small></div><nav aria-label="Applications"><button className={section === 'home' ? 'active' : ''} onClick={() => setSection('home')}>⌂ <span>Home</span></button><button className={section === 'table' ? 'active' : ''} onClick={() => setSection('table')}>▦ <span>Table</span></button><button className={section === 'dashboard' ? 'active' : ''} onClick={() => setSection('dashboard')}>▤ <span>Dashboard</span></button><button className={section === 'characters' ? 'active' : ''} onClick={() => setSection('characters')}>♙ <span>Characters</span></button><button className={section === 'encounters' ? 'active' : ''} onClick={() => setSection('encounters')}>⚑ <span>Encounters</span></button><button className={section === 'maps' ? 'active' : ''} onClick={() => { setMapTargetId(undefined); setSection('maps') }}>⌖ <span>Maps</span></button><button className={section === 'lore' ? 'active' : ''} onClick={() => { setLoreTargetId(undefined); setSection('lore') }}>▤ <span>Lore</span></button>{v2CampaignLock && <button className={section === 'rules' ? 'active' : ''} onClick={() => setSection('rules')}>⚙ <span>Rules</span></button>}</nav><div className="rail-bottom"><button onClick={changeProfile}>◉ <span>Local profile: {profileId}</span></button><p>Preferences only · not identity</p></div></aside>
    <div className="app-main"><header className="app-topbar"><div><span className="eyebrow">{section === 'home' ? 'CAMPAIGN' : `WORKSPACE / ${section.toUpperCase()}`}</span><strong>{section === 'home' ? 'Campaign Home' : section === 'dashboard' ? dashboard?.name || 'Dashboard' : section === 'table' ? 'Table' : section === 'characters' ? 'Characters' : section === 'lore' ? 'Lore' : section === 'maps' ? 'Maps' : section === 'rules' ? 'Rules' : 'Encounters'}</strong></div><div className="topbar-right">{searchReturn && <button type="button" onClick={returnFromSearchResult}>Back to origin</button>}{campaignSearchAvailable(host.mode) ? <CampaignSearch key={`${role}:${snapshot?.context.campaignId || ''}:${snapshot?.memberId || 'role-token'}:${identityRevision}:${snapshot?.context.cursor || 0}`} role={role} identityKey={`${snapshot?.context.campaignId || ''}:${snapshot?.memberId || 'role-token'}:${identityRevision}:${snapshot?.context.cursor || 0}`} connected={connection === 'connected' && Boolean(snapshot)} onOpen={openSearchResult} /> : <span className="capability-note" role="status">Campaign search requires a configured host.</span>}<span className={`status status-${connection}`} role="status">● {host.mode === 'demo' ? 'LOCAL PREVIEW' : connection === 'disconnected' && snapshot && lastSyncedAt ? `OFFLINE · cached ${new Date(lastSyncedAt).toLocaleString()}` : connection.toUpperCase()}</span>{configuredHost && <button onClick={() => { setPlayerCredentialDraft(''); setPlayerCredentialDialogOpen(true) }}>Use player credential</button>}{configuredHost && loadRememberedIdentity(configuredHost) && <button onClick={() => void forgetDevice()}>Forget this device</button>}<label>Role <select value={role} onChange={event => { setSnapshot(null); setRole(event.target.value as Role); setSelectedActorId(''); setSearchReturn(null) }}><option value="gm">GM</option><option value="player">Player</option></select></label></div></header>    <dialog className="player-credential-dialog" ref={playerCredentialDialogRef} aria-labelledby="player-credential-title" onCancel={event => { event.preventDefault(); setPlayerCredentialDialogOpen(false); setPlayerCredentialDraft('') }}>
      <form onSubmit={event => void usePlayerCredential(event)}>
        <h2 id="player-credential-title">Sign in with your player credential</h2>
        <p>Paste the reusable credential your GM gave you. It stays in this browser profile for this campaign.</p>
        <label htmlFor="player-credential-input">Player credential</label>
        <input id="player-credential-input" type="password" autoComplete="off" required value={playerCredentialDraft} onChange={event => setPlayerCredentialDraft(event.target.value)} />
        {error && <p role="alert">{error}</p>}
        <div><button className="primary" disabled={playerCredentialBusy || !playerCredentialDraft.trim()}>{playerCredentialBusy ? 'Connecting…' : 'Connect as player'}</button><button type="button" onClick={() => { setPlayerCredentialDialogOpen(false); setPlayerCredentialDraft('') }}>Cancel</button></div>
      </form>
    </dialog>
    {section === 'table' && Boolean(v2CampaignLock) && !v2TableEntityId && <section className="v2-table-navigation" aria-label="Experimental V2 Table navigation"><h2>Review a V2 encounter</h2><p>Choose a prepared encounter in Rules, then open it in Table. V2 encounters do not use the legacy active-encounter selector.</p><button type="button" className="primary" onClick={() => setSection('rules')}>Open Rules to choose an encounter</button></section>}
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => { setError(''); void host.load(role).then(setSnapshot).catch(cause => setError(displayError(cause))) }}>Retry</button></div>}
    {role === 'player' && section !== 'home' && (section === 'rules' && v2CampaignLock ? <section className="session-strip player-session-focus" aria-label="Player Rules workspace"><div><p className="eyebrow">PLAYER WORKSPACE</p><strong>Module actions and session status</strong><small>Use the authorized Rules controls below. Your assigned character and active turn are identified in the encounter tracker when available.</small></div><button type="button" onClick={returnToTable}>Return to Table</button></section> : <section className="session-strip player-session-focus" aria-label="Your live session"><div><p className="eyebrow">PLAYER SESSION</p><strong>{sessionSnapshot?.current?.status === 'paused' ? 'Session paused' : sessionSnapshot?.current?.status === 'active' ? 'Session live' : 'No live session'}</strong><small>{activeEncounter ? `Current encounter: ${activeEncounter.name}` : 'No current encounter is published.'}{playerCharacter ? ` · Your character: ${playerCharacter.name}` : ' · No authorized character yet.'}</small></div>{section !== 'table' && <button type="button" onClick={returnToTable}>Return to Table</button>}</section>)}
    {actionState && <div className="action-status" role="status">{actionState}</div>}
    {v2CampaignLock && section !== 'rules' && section !== 'home' && section !== 'table' && !v2NavigationGuidance && <button type="button" className="primary" onClick={() => setSection('rules')}>Open {v2ModuleName} workspace</button>}
    {v2NavigationGuidance && <section className="v2-navigation-guidance" aria-label="V2 application scope"><div><p className="eyebrow">PINNED V2 CAMPAIGN</p><p>{v2NavigationGuidance}</p></div><button type="button" className="primary" onClick={() => setSection('rules')}>Open {v2ModuleName} workspace</button></section>}
    {role === 'gm' && configuredHost && campaign && !Boolean(v2CampaignLock) && <section className="campaign-setup" aria-label="Campaign setup">
      <form onSubmit={event => void saveCampaignSetup(event)}>
        <strong>Campaign setup</strong>
        <label>Campaign name <input required maxLength={160} value={campaignNameDraft} onChange={event => setCampaignNameDraft(event.target.value)} /></label>
        <label>Game system <select required value={campaignSystemChoice} disabled={!!campaign.systemModuleId || !!v2CampaignLock}
          onChange={event => setCampaignSystemChoice(event.target.value)}>
          <option value="">Select installed system</option>
          {(snapshot?.modules || []).map(module => <option key={module.manifest.id + '@' + module.manifest.version} value={module.manifest.id + '@' + module.manifest.version}>{module.manifest.name} · {module.manifest.version}</option>)}
        </select></label>
        <button disabled={busy || connection !== 'connected' || !campaignNameDraft.trim() || !campaignSystemChoice || !!v2CampaignLock}>Save campaign</button>
        {campaign.systemModuleId && <small>System pin is locked; changing rules versions needs an explicit migration.</small>}
      </form>
    </section>}
    {role === 'gm' && configuredHost && campaign && !Boolean(v2CampaignLock) && <section className="campaign-setup" aria-label="Experimental V2 campaign setup">
      <strong>Trusted V2 rulesets <span className="eyebrow">Experimental</span></strong>
      <p>Choose a reviewed bundled module for a fresh local host campaign. The host pins its exact version and capability closure. V2 modules are experimental and do not replace a V1 campaign.</p>
      {v2SetupState === 'loading' && <p role="status">Checking the loopback host’s trusted catalog…</p>}
      {v2SetupState === 'unavailable' && <p role="status">{v2SetupMessage || 'Experimental V2 is disabled or unavailable on this host.'}</p>}
      {v2SetupState === 'error' && <p role="alert">{v2SetupMessage || 'Trusted module catalog could not be loaded.'}</p>}
      {v2SetupState === 'ready' && campaign.systemModuleId && <p role="status">This existing V1 campaign has an immutable ruleset. Start a V2 campaign on a fresh local host.</p>}
      {v2SetupState === 'ready' && v2CampaignLock && <><p>Locked: <code>{v2CampaignLock.lock.rootModule.id}@{v2CampaignLock.lock.rootModule.version}</code> · {v2CampaignLock.lock.rootModule.digest}</p><button type="button" onClick={() => setSection('rules')}>Open rules workspace</button></>}
      {v2SetupState === 'ready' && !campaign.systemModuleId && !v2CampaignLock && <><label>Reviewed V2 module <select aria-label="Reviewed V2 module" value={selectedV2ModuleId} onChange={event => setSelectedV2ModuleId(event.target.value)}><option value="">Select trusted ruleset</option>{trustedV2Modules.map(module => <option key={`${module.id}@${module.version}`} value={module.id}>{module.name} · {module.version} · {module.digest.slice(0, 19)}</option>)}</select></label><button type="button" disabled={busy || connection !== 'connected' || startV2BlockReason !== null} onClick={() => void startExperimentalV2Campaign()}>Create fresh experimental V2 campaign</button>{startV2BlockReason === 'legacy-data' && <small>This host already has campaign data. V2 setup requires a fresh host.</small>}{startV2BlockReason === 'module-unavailable' && <small>Select an available trusted ruleset to continue.</small>}{startV2BlockReason === null && <small>This local host supports one configured campaign; creating V2 here locks its ruleset.</small>}</>}
    </section>}
    {role === 'gm' && configuredHost && <details className="gm-admin"><summary>GM administration · {proposals.length} pending</summary><div><button onClick={() => void enrollPlayer()}>Enroll player</button><button disabled={!selectedActor} onClick={() => void grantSelectedActor()}>Grant selected character</button>{issuedCredential && <p>Member ID: <code>{issuedCredential.memberId}</code> · One-time credential: <code>{issuedCredential.credential}</code> <button onClick={() => setIssuedCredential(null)}>Hide credential</button></p>}<section aria-label="GM proposal review"><strong>Review queue</strong>{proposals.map(proposal => <p key={proposal.id}>{proposal.actionId} · {proposal.entityId} · member {proposal.memberId.slice(0, 8)} <button onClick={() => void reviewProposal(proposal.id)}>Review</button></p>)}{activeProposal && <div><h2>Review {activeProposal.actionId}</h2><p>Member {activeProposal.memberId} · actor {activeProposal.entityId}</p><pre>{JSON.stringify(activeProposal.request, null, 2)}</pre><button disabled={busy} onClick={() => void decideProposal('accept')}>Accept after revalidation</button><button disabled={busy} onClick={() => void decideProposal('reject')}>Reject</button><button onClick={() => setActiveProposal(null)}>Close</button></div>}</section></div></details>}
    {role === 'player' && queued.length > 0 && <section className="action-status" aria-label="Your local operation status"><strong>Local edits</strong>{queued.slice(-8).map(row => <p key={row.operation.operationId}>{row.operation.actionId} · {row.state}{row.receipt?.reasonCode ? ` · ${row.receipt.reasonCode}` : ''}{row.lastError === 'transport' ? ' · host acknowledgement unavailable; retrying' : ''} · {row.operation.operationId.slice(0, 8)}{row.state === 'queued' && row.firstSubmittedAt === undefined && <button onClick={() => void cancelUnsentEdit(row.operation.operationId)}>Cancel unsent edit</button>}</p>)}</section>}
    {role === 'player' && snapshot?.memberId && <section className="action-status" aria-label="Private local drafts"><label><input type="checkbox" checked={draftNextEdit} onChange={event => setDraftNextEdit(event.target.checked)} /> Save next permitted action as a private draft (do not submit)</label><label>Require this authorized character to stay unchanged <select aria-label="Dependency guard" value={dependencyEntityId} onChange={event => { dependencyEntityIdRef.current = event.target.value; setDependencyEntityId(event.target.value) }}><option value="">No dependency guard</option>{snapshot.actors.filter(actor => actor.entityId !== selectedActor?.entityId).map(actor => <option key={actor.entityId} value={actor.entityId}>{actor.name} · revision {actor.revision}</option>)}</select></label>{drafts.length > 0 && <div><strong>Private drafts · {drafts.length}</strong>{drafts.map(draft => { const payload = draft.payload as { kind?: string; operation?: OfflineOperation; reason?: { code?: string; message?: string } } | null; return <div key={draft.draftId}><p>{payload?.operation?.actionId || 'Saved edit'} · local only {payload?.kind === 'offline-intent' && <button onClick={() => void submitPrivateDraft(draft)}>Queue for host</button>}{payload?.kind === 'offline-conflict' && <button onClick={() => void editPrivateDraft(draft)}>Edit private draft parameters</button>}<button onClick={() => void discardPrivateDraft(draft)}>Discard draft</button></p>{payload?.kind === 'offline-conflict' && <details><summary>Review saved intent · {payload.reason?.code || 'conflict'}</summary><p>{payload.reason?.message || 'Original offline intent retained locally.'}</p><p>Original operation <code>{payload.operation?.operationId}</code></p><pre>{JSON.stringify(payload.operation?.parameters, null, 2)}</pre></details>}</div> })}</div>}</section>}
    {role === 'player' && queued.filter(row => row.state === 'conflicted' || row.state === 'rejected').map(row => <div className="action-status" key={row.operation.operationId}><ConflictRecovery queuedOperation={row} reason={{ code: row.receipt?.reasonCode || (row.state === 'rejected' ? 'gm_rejected' : 'conflict'), message: conflictMessage(row.receipt?.reasonCode || (row.state === 'rejected' ? 'gm_rejected' : 'conflict')) }} authorizedCurrentActor={connection === 'connected' ? snapshot?.actors.find(actor => actor.entityId === row.operation.entityId) : null} authorizedCurrentDependencies={connection === 'connected' ? (row.operation.dependencies || []).map(dependency => snapshot?.actors.find(actor => actor.entityId === dependency.entityId)).filter((actor): actor is Actor => Boolean(actor)) : []} canDiscardLocalOutcome onRetainAsPrivateDraft={draft => withPlayerStorage(storage => storage.savePrivateDraft(draft).then(() => {}))} onDiscardLocalOutcome={operationId => withPlayerStorage(storage => storage.deleteLocalOutcome(operationId))} onCreateOperation={operation => withPlayerStorage(async storage => { await storage.enqueueOperation(operation); if (connection === 'connected' && snapshot) void syncPending(snapshot) })} /></div>)}
    {section === 'rules' ? <V2ModulesApp key={role + ':' + (snapshot?.memberId || 'gm')} initialCredential={credentialForRole(role)} initialEntityId={v2TableEntityId || undefined} onOpenInTable={openV2Table} onExit={() => setSection('home')} /> : section === 'home' ? <CampaignHome role={role} snapshot={snapshot} campaign={campaign} connection={connection} session={sessionSnapshot} v2SessionEnabled={Boolean(v2CampaignLock)} v2Credential={credentialForRole(role)} v2Ruleset={v2CampaignLock ? { id: v2CampaignLock.lock.rootModule.id, version: v2CampaignLock.lock.rootModule.version, name: trustedV2Modules.find(module => module.id === v2CampaignLock.lock.rootModule.id && module.version === v2CampaignLock.lock.rootModule.version && module.digest === v2CampaignLock.lock.rootModule.digest)?.name } : null} error={error} lore={loreArticles} maps={mapScenes} onOpen={openCampaignHomeTarget} onCreate={createFromCampaignHome} /> : section === 'maps' ? <MapsApp key={`${role}:${snapshot?.context.campaignId || 'connecting'}`} role={role} connection={connection} campaignId={snapshot?.context.campaignId || ''} actors={snapshot?.actors || []} encounters={tableEncounters} loreArticles={loreArticles} hostAvailable={Boolean(configuredHost)} initialSceneId={mapTargetId} cachedScenes={snapshot?.role === role ? mapScenes : []} cachedBackgrounds={snapshot?.role === role ? mapBackgrounds : {}} cacheTimes={snapshot?.role === role ? mapCacheTimes : {}} onSceneChange={setMapScenes} onSelectedSceneChange={setMapTargetId} onHandoff={(app, entityId, originSceneId) => { if (app === 'lore' && entityId) { setLoreReturnMapId(originSceneId); setLoreTargetId(entityId); setSection('lore'); return } setSection(app); if (app === 'characters' && entityId) setSelectedActorId(entityId); if (app === 'encounters' && entityId) { const target = tableEncounters.find(item => item.id === entityId); if (target) { setEncounterDetails(target); setEncounterNameInput(target.name); setEncounterSummaryInput(target.summary) } } }} /> : section === 'table' && v2TableEntityId ? <V2TableView key={`${role}:${v2TableEntityId}`} credential={credentialForRole(role)} entityId={v2TableEntityId} onOpenRules={entityId => { setV2TableEntityId(entityId); try { sessionStorage.setItem('potomac.v2.table.entity', entityId) } catch { /* Keep in-memory route. */ } setSection('rules') }} onReturn={() => { setV2TableEntityId(''); try { sessionStorage.removeItem('potomac.v2.table.entity') } catch { /* Best-effort route cleanup. */ } setSection('home') }} /> : section === 'dashboard' || section === 'table' ? <main className="dashboard-page">
      <div className="page-intro"><div><p className="eyebrow">{section === 'table' ? 'APPLICATION / TABLE' : 'YOUR CAMPAIGN, YOUR LAYOUT'}</p><h1>{section === 'table' ? 'Table' : dashboard?.name || 'Start a dashboard'}</h1><p>{section === 'table' ? 'Live session, authorized participants and recent activity.' : 'Personal panels follow shared play, while your arrangement stays yours.'}</p></div><div className="intro-actions">{section === 'table' && role === 'gm' && <button onClick={() => void returnToPreparation()}>Return to preparation</button>}<button className={editing ? 'primary' : ''} onClick={() => setEditing(!editing)}>{editing ? 'Done editing' : 'Edit layout'}</button></div></div>
      {section === 'table' && <section className="session-strip" aria-label="Table workflow"><div><p className="eyebrow">GM WORKFLOW</p><strong>{sessionSnapshot?.current ? sessionSnapshot.current.status === 'finished' ? 'Session ended' : `Session ${sessionSnapshot.current.status}` : 'Ready for a session'}</strong><small>{activeEncounter ? `Current encounter: ${activeEncounter.name}` : 'Choose and activate a prepared encounter before starting.'}</small></div>{role === 'gm' && activeEncounter && !sessionSnapshot?.current && <button className="primary" disabled={busy || connection !== 'connected'} onClick={() => void changeSession('start', { id: activeEncounter.id, revision: activeEncounter.revision || 0 })}>Start Table session</button>}</section>}
      <div className="dashboard-toolbar"><label>Group <select value={activeGroup?.id || ''} onChange={event => { const group = workspace.groups.find(item => item.id === event.target.value); update({ ...workspace, activeGroupId: event.target.value, activeDashboardId: group?.dashboardIds[0] || '' }) }}>{workspace.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><div className="dashboard-tabs" role="tablist" aria-label="Dashboards">{groupDashboards.map(item => <button role="tab" aria-selected={item.id === dashboard?.id} className={item.id === dashboard?.id ? 'active' : ''} key={item.id} onClick={() => update({ ...workspace, activeDashboardId: item.id })}>{item.name}</button>)}</div>{editing && <div className="toolbar-actions"><label>Move to <select aria-label="Move dashboard to group" value={activeGroup?.id || ''} disabled={!dashboard} onChange={event => { if (!dashboard) return; const groupId = event.target.value; update({ ...workspace, activeGroupId: groupId, groups: workspace.groups.map(group => ({ ...group, dashboardIds: group.id === groupId ? [...group.dashboardIds.filter(id => id !== dashboard.id), dashboard.id] : group.dashboardIds.filter(id => id !== dashboard.id) })) }) }}>{workspace.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><button onClick={createGroup}>+ Group</button><button onClick={renameGroup} disabled={!activeGroup}>Rename group</button><button onClick={createDashboard}>+ Dashboard</button><button onClick={renameDashboard} disabled={!dashboard}>Rename</button><button onClick={deleteDashboard} disabled={!dashboard}>Delete</button><button className="primary" onClick={() => setPicker(!picker)}>+ Add brick</button></div>}</div>
      {picker && editing && <div className="brick-picker"><strong>Brick library</strong><div>{getBrickDefinitions().map(definition => <button key={definition.typeId} onClick={() => addBrick(definition.typeId)}><span>{definition.title}</span><small>{definition.ownerAppId}</small></button>)}</div></div>}
      <div className="session-strip"><div><p className="eyebrow">SHARED SESSION CONTEXT</p><strong>{snapshot?.context.activeEncounter?.name || 'No active encounter'}</strong><small>Followers update for connected clients. Pinned bricks do not move.</small></div>{role === 'gm' && <div className="context-control"><label htmlFor="encounter-select">Active encounter</label><select id="encounter-select" value={encounterDraft} onChange={event => setEncounterDraft(event.target.value)}><option value="">None</option>{snapshot?.encounters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button disabled={busy || connection === 'disconnected'} onClick={() => void saveEncounter()}>Set active</button></div>}</div>
      {editing && dashboard?.bricks.length ? <p className="brick-layout-caption">On desktop, drag a panel by its grip or resize from the lower-right corner. It follows your pointer and snaps into place when released; Escape cancels. The buttons inside each panel work with a keyboard. Changes save to this local profile.</p> : null}
      {dashboard?.bricks.length ? <div ref={drag.gridRef} className={`brick-grid ${editing ? 'is-editing' : ''}`}>{drag.visual && <div className="brick-drop-target" aria-hidden="true" style={{ gridColumn: `${drag.visual.dropLayout.x + 1} / span ${drag.visual.dropLayout.w}`, gridRow: `${drag.visual.dropLayout.y + 1} / span ${drag.visual.dropLayout.h}` }} />}{visibleBricks.map(brick => {
        const definition = getBrickDefinition(brick.typeId)
        const pinnedEntityId = brick.binding.mode === 'pinned' ? brick.binding.entityId : ''
        return <section className={`brick ${drag.visual?.id === brick.id ? drag.visual.mode === 'move' ? 'is-dragging' : 'is-resizing' : ''}`} key={brick.id} style={{ gridColumn: `${brick.layout.x + 1} / span ${brick.layout.w}`, gridRow: `${brick.layout.y + 1} / span ${brick.layout.h}`, ...(drag.visual?.id === brick.id ? drag.visual.mode === 'move' ? { transform: `translate3d(${drag.visual.dx}px, ${drag.visual.dy}px, 0)` } : { width: `${drag.visual.width}px`, height: `${drag.visual.height}px` } : {}) }}><header className="brick-head"><div>{editing && <button type="button" className="brick-drag-handle" aria-label={`Drag ${definition?.title || brick.typeId}`} aria-pressed={drag.visual?.id === brick.id && drag.visual.mode === 'move'} onPointerDown={event => drag.start(event, brick.id, 'move')} onPointerMove={drag.move} onPointerUp={drag.finish} onPointerCancel={drag.cancel} />}<span className="brick-icon">◇</span><strong>{definition?.title || brick.typeId}</strong></div><small>{brick.binding.mode === 'follow' ? '↻ Following' : brick.binding.mode === 'pinned' ? '◆ Pinned' : 'Session'}</small></header><BrickBoundary><BrickContent brick={brick} snapshot={snapshot} encounters={tableEncounters} lore={loreArticles} maps={snapshot?.role === role ? mapScenes : []} session={sessionSnapshot} role={role} busy={busy || (connection === 'disconnected' && !(role === 'player' && snapshot?.memberId))} offline={connection === 'disconnected'} onAction={act} onSessionCommand={(command, encounter) => void changeSession(command, encounter)} onOpenApp={(appId, entityId) => { setSection(appId); if (appId === 'maps') setMapTargetId(entityId); if (entityId && appId === 'characters') setSelectedActorId(entityId); if (entityId && appId === 'encounters') { const target = tableEncounters.find(item => item.id === entityId); if (target) { setEncounterDetails(target); setEncounterNameInput(target.name); setEncounterSummaryInput(target.summary) } } if (appId === 'lore') setLoreTargetId(entityId) }} /></BrickBoundary>{editing && <div className="brick-edit"><label>Binding <select value={brick.binding.mode} onChange={event => updateBrick(brick.id, item => ({ ...item, binding: resolveBindingMode(event.target.value as 'follow' | 'pinned' | 'none', definition!, createAuthorizedBrickAdapter(snapshot?.actors ?? [], tableEncounters, snapshot?.context.activeEncounter ?? null, snapshot?.activity ?? [], sessionSnapshot, role, loreArticles, mapScenes)) }))}>{definition?.supportedBindings.map(mode => <option value={mode} key={mode}>{mode}</option>)}</select></label>{brick.binding.mode === 'pinned' && <label>Entity <select value={pinnedEntityId} onChange={event => updateBrick(brick.id, item => ({ ...item, binding: { mode: 'pinned', entityId: event.target.value } }))}><option value={pinnedEntityId}>{pinnedEntityId}</option>{(brick.typeId === 'characters.sheet' ? snapshot?.actors.map(item => ({ id: item.entityId, name: item.name })) : brick.typeId === 'lore.article' ? loreArticles.filter(item => !item.archived).map(item => ({ id: item.id, name: item.title })) : brick.typeId === 'maps.scene' ? mapScenes.map(item => ({ id: item.id, name: item.name })) : tableEncounters)?.filter(item => item.id !== pinnedEntityId).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}<div className="brick-edit-buttons"><button aria-label="Move brick left" onClick={() => adjustBrick(brick.id, layout => ({ ...layout, x: Math.max(0, layout.x - 1) }))}>←</button><button aria-label="Move brick right" onClick={() => adjustBrick(brick.id, layout => ({ ...layout, x: Math.min(11, layout.x + 1) }))}>→</button><button aria-label="Move brick up" onClick={() => adjustBrick(brick.id, layout => ({ ...layout, y: Math.max(0, layout.y - 1) }))}>↑</button><button aria-label="Move brick down" onClick={() => adjustBrick(brick.id, layout => ({ ...layout, y: layout.y + 1 }))}>↓</button><button aria-label="Make brick narrower" onClick={() => adjustBrick(brick.id, layout => ({ ...layout, w: Math.max(2, layout.w - 1) }))}>− width</button><button aria-label="Make brick wider" onClick={() => adjustBrick(brick.id, layout => ({ ...layout, w: Math.min(12 - layout.x, layout.w + 1) }))}>+ width</button><button aria-label="Make brick shorter" onClick={() => adjustBrick(brick.id, layout => ({ ...layout, h: Math.max(2, layout.h - 1) }))}>− height</button><button aria-label="Make brick taller" onClick={() => adjustBrick(brick.id, layout => ({ ...layout, h: brick.layout.h + 1 }))}>+ height</button><button className="danger" onClick={() => updateDashboard(dashboard.id, item => ({ ...item, bricks: item.bricks.filter(value => value.id !== brick.id) }))}>Remove</button></div></div>}{editing && <button type="button" className="brick-resize-handle" aria-label={`Resize ${definition?.title || brick.typeId}`} onPointerDown={event => drag.start(event, brick.id, 'resize')} onPointerMove={drag.move} onPointerUp={drag.finish} onPointerCancel={drag.cancel} />}</section>
      })}</div> : <div className="empty-dashboard"><h2>No bricks here yet</h2><p>{editing ? 'Open the brick library to add a character, encounter, or activity panel.' : 'Turn on Edit layout to build this dashboard.'}</p><button onClick={() => { setEditing(true); setPicker(true) }}>Add a brick</button></div>}
      <p className="workspace-footnote">Saved locally in this browser · Host data is never stored in the layout · Cursor {snapshot?.context.cursor ?? '—'}</p>
    </main> : section === 'characters' ? <main className="characters-page"><div className="page-intro"><div><p className="eyebrow">APPLICATION / CHARACTERS</p><h1>Characters</h1><p>Module actions are sent through the shared host contract. Character records are host-authoritative.</p></div>{role === 'gm' && <button className="primary" disabled={!availableModules.length || host.mode !== 'host'} onClick={() => { const first = availableModules[0]; setCharacterModuleId(first?.manifest.id || ''); setNewCharacterData({}); setCreatingCharacter(true) }}>Create character</button>}</div>{host.mode === 'demo' && <p className="capability-note">Creation is disabled in local preview because it has no persistent actor API.</p>}<div className="character-layout"><nav aria-label="Characters" className="character-list">{snapshot?.actors.map(actor => <button className={selectedActor?.entityId === actor.entityId ? 'active' : ''} key={actor.entityId} onClick={() => setSelectedActorId(actor.entityId)}><span className="avatar">{actor.name.slice(0, 1)}</span><span><strong>{actor.name}</strong><small>{actor.module.manifest.name}</small></span></button>)}</nav><section className="full-character brick">{selectedActor ? <><CharacterView actor={selectedActor} busy={busy || (connection === 'disconnected' && !(role === 'player' && snapshot?.memberId))} offline={connection === 'disconnected'} onAction={act} gm={role === 'gm'} />{role === 'gm' && !editingCharacter && <button disabled={busy || connection !== 'connected'} onClick={() => { setEditedCharacterData(structuredClone(selectedActor.data)); setEditingCharacter(true) }}>Edit character fields</button>}
        {role === 'gm' && editingCharacter && <form className="schema-form" onSubmit={event => void saveCharacterEdit(event)}>
          <h2>Edit character</h2>
          <SchemaFields schema={selectedActor.module.schema} value={editedCharacterData} onChange={setEditedCharacterData} />
          <button disabled={busy || connection !== 'connected'}>Save changes</button>
          <button type="button" onClick={() => setEditingCharacter(false)}>Cancel</button>
        </form>}</> : <p className="brick-message">No authorized characters available.</p>}{creatingCharacter && <form className="schema-form" onSubmit={event => void createCharacter(event)}><h2>New character</h2><label>System<select value={selectedModule?.manifest.id || ''} onChange={event => { setCharacterModuleId(event.target.value); setNewCharacterData({}) }}>{availableModules.map(module => <option key={module.manifest.id} value={module.manifest.id}>{module.manifest.name} · {module.manifest.version}</option>)}</select></label>{selectedModule && <SchemaFields schema={selectedModule.schema} value={newCharacterData} onChange={setNewCharacterData} />}{selectedModule?.schema && <><label>Secret note (GM only)<textarea value={String(newCharacterData.secretNote || '')} onChange={event => setNewCharacterData(current => ({ ...current, secretNote: event.target.value }))} /></label><div><button className="primary" disabled={busy || connection !== 'connected'}>Create on host</button><button type="button" onClick={() => setCreatingCharacter(false)}>Cancel</button></div></>}</form>}</section><aside className="brick app-activity"><header className="brick-head"><strong>Activity Log</strong></header><ActivityLog snapshot={snapshot} /></aside></div></main> : section === 'lore' ? <LoreApp role={role} connection={connection} targetId={loreTargetId} initialArticles={loreArticles} onArticlesChange={setLoreArticles} hostAvailable={Boolean(configuredHost)}
      availableActors={snapshot?.actors ?? []} availableEncounters={snapshot?.encounters ?? []}
      onOpenTarget={(kind, id) => {
        if (kind === 'actor') { setSelectedActorId(id); setSection('characters') }
        else {
          setOpenedLoreEncounterId(id)
          setSection('encounters')
          // Player navigation never calls the GM-only encounter detail endpoint.
          if (role === 'gm') void chooseEncounter(id)
        }
       }} onBackToMap={loreReturnMapId ? () => { const source = loreReturnMapId; setLoreReturnMapId(undefined); setLoreTargetId(undefined); setMapTargetId(source); setSection('maps') } : undefined} /> : <main className="encounters-page">
      <div className="page-intro">
        <div><p className="eyebrow">APPLICATION / ENCOUNTERS</p><h1>Encounters</h1>
          <p>Prepare encounter records, choose participants, and control the shared session.</p></div>
        {role === 'gm' && <button disabled={busy || connection !== 'connected'} onClick={() => {
          setCreatingEncounter(true); setEncounterDetails(null); setEncounterNameInput(''); setEncounterSummaryInput('');
          setEncounterStatusInput('prepared'); setEncounterParticipantIds([])
        }}>Create encounter</button>}
      </div>
      {snapshot?.context.activeEncounter && <section className="active-encounter">
        <p className="eyebrow">ACTIVE ENCOUNTER</p>
        <h2>{snapshot.context.activeEncounter.name}</h2><p>{snapshot.context.activeEncounter.summary}</p>
        <small>Following bricks update automatically. Pinned bricks remain pinned.</small>
      </section>}
      {role === 'gm' && creatingEncounter && <form className="schema-form" onSubmit={event => void createEncounter(event)}>
        <h2>New encounter</h2>
        <label>Name <input required maxLength={160} value={encounterNameInput} onChange={event => setEncounterNameInput(event.target.value)} /></label>
        <label>Summary <textarea maxLength={4000} value={encounterSummaryInput} onChange={event => setEncounterSummaryInput(event.target.value)} /></label>
        <button disabled={busy || connection !== 'connected'}>Create on host</button>
        <button type="button" onClick={() => setCreatingEncounter(false)}>Cancel</button>
      </form>}
      <div className="encounter-list">
        {snapshot?.encounters.map(encounter => <article className={`encounter-card${openedLoreEncounterId === encounter.id ? ' is-focused' : ''}`} key={encounter.id} aria-current={openedLoreEncounterId === encounter.id ? 'true' : undefined}>
          <div><p className="eyebrow">ENCOUNTER · {encounter.id}</p><h2>{encounter.name}</h2><p>{encounter.summary}</p>{openedLoreEncounterId === encounter.id && <small role="status">Opened from Lore</small>}</div>
          <div>{role === 'gm' && <button disabled={busy || connection !== 'connected'}
            onClick={() => { setCreatingEncounter(false); void chooseEncounter(encounter.id) }}>Prepare / edit</button>}
            {role === 'gm' && <button disabled={busy || connection !== 'connected'}
              onClick={() => snapshot.context.activeEncounter?.id === encounter.id ? openTableForEncounter(encounter) : void activateEncounterAndOpenTable(encounter)}>{snapshot.context.activeEncounter?.id === encounter.id ? 'Open Table' : 'Activate and open Table'}</button>}
            {snapshot?.context.activeEncounter?.id === encounter.id && <span className="active-label">Active for campaign</span>}
          </div>
        </article>)}
      </div>
      {role === 'gm' && encounterDetails && !creatingEncounter && <form className="schema-form" onSubmit={event => void saveEncounterEdits(event)}>
        <h2>Prepare {encounterDetails.name}</h2>
        <div className="preparation-handoffs" aria-label="Related preparation"><button type="button" onClick={() => handoffFromPreparation('characters')}>Create or link character</button><button type="button" onClick={() => handoffFromPreparation('maps')}>Create or link map</button><button type="button" onClick={() => handoffFromPreparation('lore')}>Create or link Lore</button>{preparationReturn && <button type="button" onClick={() => void returnToEncounterPreparation()}>Return to {preparationReturn.encounterName}</button>}</div>
        <label>Encounter name <input required maxLength={160} value={encounterNameInput} onChange={event => setEncounterNameInput(event.target.value)} /></label>
        <label>Player-visible summary <textarea maxLength={4000} value={encounterSummaryInput} onChange={event => setEncounterSummaryInput(event.target.value)} /></label>
        <label>Lifecycle <select value={encounterStatusInput} onChange={event => setEncounterStatusInput(event.target.value as 'prepared' | 'active' | 'completed')}>
          <option value="prepared">Prepared</option><option value="active">Active</option><option value="completed">Completed</option>
        </select></label>
        <fieldset><legend>Participants</legend>{snapshot?.actors.map(actor => <label key={actor.entityId}>
          <input type="checkbox" checked={encounterParticipantIds.includes(actor.entityId)} onChange={event => setEncounterParticipantIds(current => event.target.checked ? [...current, actor.entityId] : current.filter(id => id !== actor.entityId))} />
          {actor.name}
        </label>)}{!snapshot?.actors.length && <p>No characters available yet.</p>}</fieldset>
        <button disabled={busy || connection !== 'connected'}>Save encounter and participants</button>
        <button type="button" onClick={() => setEncounterDetails(null)}>Close</button>
      </form>}
      {role === 'gm' && snapshot?.context.activeEncounter && <button disabled={busy || connection !== 'connected'}
        onClick={async () => {
          setBusy(true); setError('')
          try { await host.setEncounter(role, null); setSnapshot(await host.load(role)); setActionState('Active encounter cleared.') }
          catch (cause) { setError(displayError(cause)) } finally { setBusy(false) }
        }}>Clear active encounter</button>}
    </main>}</div>
  </div></LoreArticlesContext.Provider></LoreRelationsContext.Provider></LoreTargetContext.Provider></CharacterPreparationContext.Provider>
}
