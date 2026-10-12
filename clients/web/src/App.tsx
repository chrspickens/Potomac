import { Component, useEffect, useMemo, useState, type ReactNode } from 'react'
import { configuredHost, connectPlayerCredential, host, type ConnectionStatus, type Role, type Snapshot } from './api'
import { forgetRememberedIdentity, loadRememberedIdentity } from './identity'
import { cachePlayerSnapshot, clearRememberedPlayerData, loadCachedPlayerSnapshot } from './offline/snapshots'
import type { Actor } from './modules'
import { createDefaultWorkspace, getBrickDefinition, getBrickDefinitions, isSupportedBinding, loadWorkspaceWithRecovery, saveWorkspace, type BrickInstance, type WorkspaceState } from './workspace'
import { CharacterView, createAuthorizedBrickAdapter, resolveDefaultBinding } from './workspace/contributions.tsx'
import { resolveBrickLayout } from './workspace/layout.ts'
import { useBrickDrag } from './workspace/use-brick-drag.ts'
import './workspace/brick-canvas.css'

const profileKey = 'potomac.workspace.demo-profile'
const newId = () => crypto.randomUUID()
const displayError = (cause: unknown) => cause instanceof Error ? cause.message : 'Request failed'

class BrickBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <div className="brick-message" role="alert">This brick could not render. Your layout is preserved.</div> : this.props.children }
}

function ActivityLog({ snapshot }: { snapshot: Snapshot | null }) {
  return <div className="activity-list">{snapshot?.activity.length ? snapshot.activity.slice(-12).reverse().map(item => <div className="activity-item" key={item.id}><span className="activity-dot" /><div><strong>{item.action}</strong><p>{item.detail || 'Campaign event'}</p><small>{item.actor} · {item.time}{item.visibility === 'gm' ? ' · GM only' : ''}</small></div></div>) : <p className="brick-message">Actions and encounter changes will appear here.</p>}</div>
}

function defaultBinding(typeId: string, snapshot: Snapshot | null): BrickInstance['binding'] {
  const definition = getBrickDefinition(typeId)
  if (!definition) return { mode: 'none' }
  return resolveDefaultBinding(definition, createAuthorizedBrickAdapter(snapshot?.actors ?? [], snapshot?.encounters ?? [], snapshot?.context.activeEncounter ?? null, snapshot?.activity ?? []))
}

function BrickContent({ brick, snapshot, role: _role, busy, onAction }: { brick: BrickInstance; snapshot: Snapshot | null; role: Role; busy: boolean; onAction: (actor: Actor, actionId: string) => void }) {
  const definition = getBrickDefinition(brick.typeId)
  if (!definition) return <p className="brick-message">Brick “{brick.typeId}” is unavailable. Its saved settings are preserved.</p>
  if (!isSupportedBinding(brick.typeId, brick.binding)) return <p className="brick-message">This saved binding is unsupported. Choose a supported binding to repair it; saved settings are preserved.</p>
  if (!snapshot) return <p className="brick-message">Waiting for the host…</p>
  const adapter = createAuthorizedBrickAdapter(snapshot.actors, snapshot.encounters, snapshot.context.activeEncounter, snapshot.activity)
  return <definition.render brick={brick} data={definition.resolve(brick.binding, adapter)} adapter={adapter} busy={busy} onAction={onAction} />
}

export default function App() {
  const [role, setRole] = useState<Role>(() => configuredHost && loadRememberedIdentity(configuredHost) ? 'player' : 'gm')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [connection, setConnection] = useState<ConnectionStatus>('connecting')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionState, setActionState] = useState('')
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const [identityRevision, setIdentityRevision] = useState(0)
  const [section, setSection] = useState<'dashboard' | 'characters'>('dashboard')
  const [selectedActorId, setSelectedActorId] = useState('')
  const [editing, setEditing] = useState(false)
  const [picker, setPicker] = useState(false)
  const [profileId, setProfileId] = useState(() => {
    try { return localStorage.getItem(profileKey) || 'local-demo' } catch { return 'local-demo' }
  })
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => createDefaultWorkspace('foundation-demo', profileId))
  const [loadedWorkspace, setLoadedWorkspace] = useState(false)
  const [encounterDraft, setEncounterDraft] = useState('')

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
    const adapter = createAuthorizedBrickAdapter(snapshot?.actors ?? [], snapshot?.encounters ?? [], snapshot?.context.activeEncounter ?? null, snapshot?.activity ?? [])
    const brick: BrickInstance = { id: newId(), typeId, definitionVersion: definition.version, binding: resolveDefaultBinding(definition, adapter), options: {}, layout: { x: 0, y: bottom, w: definition.defaultSize.w, h: definition.defaultSize.h } }
    updateDashboard(dashboard.id, item => ({ ...item, bricks: [...item.bricks, brick] }))
    setPicker(false)
  }
  const act = async (actor: Actor, actionId: string) => {
    const parameters = actor.module.view.layout.concat(actor.module.view.brick).find(item => item.actionId === actionId)?.parameters || {}
    setBusy(true); setError(''); setActionState(`Sending ${actionId} for ${actor.name}…`)
    try {
      await host.command(role, { operationId: newId(), entityId: actor.entityId, baseRevision: actor.revision, actionId, parameters })
      setSnapshot(await host.load(role))
      setActionState(`${actionId} accepted by host.`)
    } catch (cause) { setError(displayError(cause)); setActionState(`${actionId} rejected; no local state was committed.`) }
    finally { setBusy(false) }
  }
  const saveEncounter = async () => {
    setBusy(true); setError('')
    try { await host.setEncounter(role, encounterDraft || null); setSnapshot(await host.load(role)) }
    catch (cause) { setError(displayError(cause)) }
    finally { setBusy(false) }
  }
  const changeProfile = () => {
    const id = window.prompt('Local layout profile (not an account or permission)', profileId)?.trim()
    if (!id) return
    try { localStorage.setItem(profileKey, id) } catch { setError('Profile preference could not be saved.') }
    setProfileId(id)
  }

  const usePlayerCredential = async () => {
    const credential = window.prompt('Enter the credential issued by your GM for this local host')?.trim()
    if (!credential) return
    try {
      const verified = await connectPlayerCredential(credential)
      setSnapshot(verified); setRole('player'); setIdentityRevision(value => value + 1); setError('')
    } catch (cause) { setError(displayError(cause)) }
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

  return <div className="app-shell">
    <aside className="app-rail"><div className="rail-brand"><span className="brand-mark">◆</span><span>Potomac</span></div><div className="campaign-select"><small>CAMPAIGN</small><strong>{snapshot?.context.campaignId || 'Connecting…'}</strong></div><nav aria-label="Applications"><button className={section === 'dashboard' ? 'active' : ''} onClick={() => setSection('dashboard')}>▦ <span>Dashboard</span></button><button className={section === 'characters' ? 'active' : ''} onClick={() => setSection('characters')}>♙ <span>Characters</span></button><div className="rail-future">Encounters <small>Coming later</small></div><div className="rail-future">Maps <small>Coming later</small></div><div className="rail-future">Lore <small>Coming later</small></div></nav><div className="rail-bottom"><button onClick={changeProfile}>◉ <span>Local profile: {profileId}</span></button><p>Preferences only · not identity</p></div></aside>
    <div className="app-main"><header className="app-topbar"><div><span className="eyebrow">WORKSPACE / {section.toUpperCase()}</span><strong>{section === 'dashboard' ? dashboard?.name || 'Dashboard' : 'Characters'}</strong></div><div className="topbar-right"><span className={`status status-${connection}`} role="status">● {host.mode === 'demo' ? 'LOCAL PREVIEW' : connection === 'disconnected' && snapshot && lastSyncedAt ? `OFFLINE · cached ${new Date(lastSyncedAt).toLocaleString()}` : connection.toUpperCase()}</span>{configuredHost && <button onClick={() => void usePlayerCredential()}>Use player credential</button>}{configuredHost && loadRememberedIdentity(configuredHost) && <button onClick={() => void forgetDevice()}>Forget this device</button>}<label>Role <select value={role} onChange={event => { setSnapshot(null); setRole(event.target.value as Role); setSelectedActorId('') }}><option value="gm">GM</option><option value="player">Player</option></select></label></div></header>
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => { setError(''); void host.load(role).then(setSnapshot).catch(cause => setError(displayError(cause))) }}>Retry</button></div>}
    {actionState && <div className="action-status" role="status">{actionState}</div>}
    {section === 'dashboard' ? <main className="dashboard-page">
      <div className="page-intro"><div><p className="eyebrow">YOUR CAMPAIGN, YOUR LAYOUT</p><h1>{dashboard?.name || 'Start a dashboard'}</h1><p>Personal panels follow shared play, while your arrangement stays yours.</p></div><div className="intro-actions"><button className={editing ? 'primary' : ''} onClick={() => setEditing(!editing)}>{editing ? 'Done editing' : 'Edit layout'}</button></div></div>
      <div className="dashboard-toolbar"><label>Group <select value={activeGroup?.id || ''} onChange={event => { const group = workspace.groups.find(item => item.id === event.target.value); update({ ...workspace, activeGroupId: event.target.value, activeDashboardId: group?.dashboardIds[0] || '' }) }}>{workspace.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><div className="dashboard-tabs" role="tablist" aria-label="Dashboards">{groupDashboards.map(item => <button role="tab" aria-selected={item.id === dashboard?.id} className={item.id === dashboard?.id ? 'active' : ''} key={item.id} onClick={() => update({ ...workspace, activeDashboardId: item.id })}>{item.name}</button>)}</div>{editing && <div className="toolbar-actions"><label>Move to <select aria-label="Move dashboard to group" value={activeGroup?.id || ''} disabled={!dashboard} onChange={event => { if (!dashboard) return; const groupId = event.target.value; update({ ...workspace, activeGroupId: groupId, groups: workspace.groups.map(group => ({ ...group, dashboardIds: group.id === groupId ? [...group.dashboardIds.filter(id => id !== dashboard.id), dashboard.id] : group.dashboardIds.filter(id => id !== dashboard.id) })) }) }}>{workspace.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><button onClick={createGroup}>+ Group</button><button onClick={renameGroup} disabled={!activeGroup}>Rename group</button><button onClick={createDashboard}>+ Dashboard</button><button onClick={renameDashboard} disabled={!dashboard}>Rename</button><button onClick={deleteDashboard} disabled={!dashboard}>Delete</button><button className="primary" onClick={() => setPicker(!picker)}>+ Add brick</button></div>}</div>
      {picker && editing && <div className="brick-picker"><strong>Brick library</strong><div>{getBrickDefinitions().map(definition => <button key={definition.typeId} onClick={() => addBrick(definition.typeId)}><span>{definition.title}</span><small>{definition.ownerAppId}</small></button>)}</div></div>}
      <div className="session-strip"><div><p className="eyebrow">SHARED SESSION CONTEXT</p><strong>{snapshot?.context.activeEncounter?.name || 'No active encounter'}</strong><small>Followers update for connected clients. Pinned bricks do not move.</small></div>{role === 'gm' && <div className="context-control"><label htmlFor="encounter-select">Active encounter</label><select id="encounter-select" value={encounterDraft} onChange={event => setEncounterDraft(event.target.value)}><option value="">None</option>{snapshot?.encounters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button disabled={busy || connection === 'disconnected'} onClick={() => void saveEncounter()}>Set active</button></div>}</div>
      {editing && dashboard?.bricks.length ? <p className="brick-layout-caption">On desktop, drag a panel by its grip or resize from the lower-right corner. It follows your pointer and snaps into place when released; Escape cancels. The buttons inside each panel work with a keyboard. Changes save to this local profile.</p> : null}
      {dashboard?.bricks.length ? <div ref={drag.gridRef} className={`brick-grid ${editing ? 'is-editing' : ''}`}>{drag.visual && <div className="brick-drop-target" aria-hidden="true" style={{ gridColumn: `${drag.visual.dropLayout.x + 1} / span ${drag.visual.dropLayout.w}`, gridRow: `${drag.visual.dropLayout.y + 1} / span ${drag.visual.dropLayout.h}` }} />}{visibleBricks.map(brick => {
        const definition = getBrickDefinition(brick.typeId)
        const pinnedEntityId = brick.binding.mode === 'pinned' ? brick.binding.entityId : ''
        return <section className={`brick ${drag.visual?.id === brick.id ? drag.visual.mode === 'move' ? 'is-dragging' : 'is-resizing' : ''}`} key={brick.id} style={{ gridColumn: `${brick.layout.x + 1} / span ${brick.layout.w}`, gridRow: `${brick.layout.y + 1} / span ${brick.layout.h}`, ...(drag.visual?.id === brick.id ? drag.visual.mode === 'move' ? { transform: `translate3d(${drag.visual.dx}px, ${drag.visual.dy}px, 0)` } : { width: `${drag.visual.width}px`, height: `${drag.visual.height}px` } : {}) }}><header className="brick-head"><div>{editing && <button type="button" className="brick-drag-handle" aria-label={`Drag ${definition?.title || brick.typeId}`} aria-pressed={drag.visual?.id === brick.id && drag.visual.mode === 'move'} onPointerDown={event => drag.start(event, brick.id, 'move')} onPointerMove={drag.move} onPointerUp={drag.finish} onPointerCancel={drag.cancel} />}<span className="brick-icon">◇</span><strong>{definition?.title || brick.typeId}</strong></div><small>{brick.binding.mode === 'follow' ? '↻ Following' : brick.binding.mode === 'pinned' ? '◆ Pinned' : 'Session'}</small></header><BrickBoundary><BrickContent brick={brick} snapshot={snapshot} role={role} busy={busy || connection === 'disconnected'} onAction={act} /></BrickBoundary>{editing && <div className="brick-edit"><label>Binding <select value={brick.binding.mode} onChange={event => updateBrick(brick.id, item => ({ ...item, binding: event.target.value === 'follow' ? { mode: 'follow', contextKey: 'session.activeEncounter' } : event.target.value === 'none' ? { mode: 'none' } : defaultBinding(brick.typeId, snapshot) }))}>{definition?.supportedBindings.map(mode => <option value={mode} key={mode}>{mode}</option>)}</select></label>{brick.binding.mode === 'pinned' && <label>Entity <select value={pinnedEntityId} onChange={event => updateBrick(brick.id, item => ({ ...item, binding: { mode: 'pinned', entityId: event.target.value } }))}><option value={pinnedEntityId}>{pinnedEntityId}</option>{(brick.typeId === 'characters.sheet' ? snapshot?.actors.map(item => ({ id: item.entityId, name: item.name })) : snapshot?.encounters)?.filter(item => item.id !== pinnedEntityId).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}<div className="brick-edit-buttons"><button aria-label="Move brick left" onClick={() => adjustBrick(brick.id, layout => ({ ...layout, x: Math.max(0, layout.x - 1) }))}>←</button><button aria-label="Move brick right" onClick={() => adjustBrick(brick.id, layout => ({ ...layout, x: Math.min(11, layout.x + 1) }))}>→</button><button aria-label="Move brick up" onClick={() => adjustBrick(brick.id, layout => ({ ...layout, y: Math.max(0, layout.y - 1) }))}>↑</button><button aria-label="Move brick down" onClick={() => adjustBrick(brick.id, layout => ({ ...layout, y: layout.y + 1 }))}>↓</button><button aria-label="Make brick narrower" onClick={() => adjustBrick(brick.id, layout => ({ ...layout, w: Math.max(2, layout.w - 1) }))}>− width</button><button aria-label="Make brick wider" onClick={() => adjustBrick(brick.id, layout => ({ ...layout, w: Math.min(12 - layout.x, layout.w + 1) }))}>+ width</button><button aria-label="Make brick shorter" onClick={() => adjustBrick(brick.id, layout => ({ ...layout, h: Math.max(2, layout.h - 1) }))}>− height</button><button aria-label="Make brick taller" onClick={() => adjustBrick(brick.id, layout => ({ ...layout, h: layout.h + 1 }))}>+ height</button><button className="danger" onClick={() => updateDashboard(dashboard.id, item => ({ ...item, bricks: item.bricks.filter(value => value.id !== brick.id) }))}>Remove</button></div></div>}{editing && <button type="button" className="brick-resize-handle" aria-label={`Resize ${definition?.title || brick.typeId}`} onPointerDown={event => drag.start(event, brick.id, 'resize')} onPointerMove={drag.move} onPointerUp={drag.finish} onPointerCancel={drag.cancel} />}</section>
      })}</div> : <div className="empty-dashboard"><h2>No bricks here yet</h2><p>{editing ? 'Open the brick library to add a character, encounter, or activity panel.' : 'Turn on Edit layout to build this dashboard.'}</p><button onClick={() => { setEditing(true); setPicker(true) }}>Add a brick</button></div>}
      <p className="workspace-footnote">Saved locally in this browser · Host data is never stored in the layout · Cursor {snapshot?.context.cursor ?? '—'}</p>
    </main> : <main className="characters-page"><div className="page-intro"><div><p className="eyebrow">APPLICATION / CHARACTERS</p><h1>Characters</h1><p>The full view and dashboard brick share the same host action contract.</p></div></div><div className="character-layout"><nav aria-label="Characters" className="character-list">{snapshot?.actors.map(actor => <button className={selectedActor?.entityId === actor.entityId ? 'active' : ''} key={actor.entityId} onClick={() => setSelectedActorId(actor.entityId)}><span className="avatar">{actor.name.slice(0, 1)}</span><span><strong>{actor.name}</strong><small>{actor.module.manifest.name}</small></span></button>)}</nav><section className="full-character brick">{selectedActor ? <CharacterView actor={selectedActor} busy={busy || connection === 'disconnected'} onAction={act} gm={role === 'gm'} /> : <p className="brick-message">No authorized characters available.</p>}</section><aside className="brick app-activity"><header className="brick-head"><strong>Activity Log</strong></header><ActivityLog snapshot={snapshot} /></aside></div></main>}</div>
  </div>
}
