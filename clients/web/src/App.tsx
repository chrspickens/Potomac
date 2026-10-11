import { useEffect, useMemo, useState } from 'react'
import { host, type Role, type Snapshot } from './api'
import type { Actor } from './modules'

function fieldValue(source: any, path = ''): any { return path.split('.').filter(Boolean).reduce((value, key) => value?.[key], source) }

function Character({ actor, gm, busy, action, compact = false }: { actor: Actor; gm: boolean; busy: boolean; action: (actor: Actor, id: string) => void; compact?: boolean }) {
  const module = actor.module
  const controls = compact ? module.view.brick : module.view.layout
  const stats = controls.filter(item => item.control === 'stat')
  const resources = controls.filter(item => item.control === 'resource')
  const actions = controls.filter(item => item.control === 'actionButton')
  return <article className="character-card">
    <header className="character-header"><div><span className="eyebrow">{module.manifest.name} · v{module.manifest.version}</span><h2>{actor.name}</h2><p>{actor.epithet}</p></div><span className="revision">REV {actor.revision}</span></header>
    {stats.length > 0 && <div className="stats">{stats.map((stat, index) => <div className="stat" key={`${stat.field}-${index}`}><span>{stat.label}</span><strong>{String(fieldValue(actor.data, stat.field) ?? '—')}</strong><small>{stat.field}</small></div>)}</div>}
    {resources.length > 0 && <div className="resources">{resources.map((resource, index) => { const value = fieldValue(actor.data, resource.field); const current = typeof value === 'object' ? value.current : value; const maximum = typeof value === 'object' ? value.maximum : current; const ratio = maximum ? current / maximum * 100 : 0; return <div className="resource" key={`${resource.field}-${index}`}><div><span>{resource.label}</span><strong>{String(current ?? '—')}<small> / {String(maximum ?? '—')}</small></strong></div><div className="meter"><i style={{ width: `${Math.max(0, Math.min(100, ratio))}%` }} /></div></div>})}</div>}
    <div className="actions">{actions.map((item, index) => <button key={`${item.actionId}-${index}`} disabled={busy} title={item.label} onClick={() => item.actionId && action(actor, item.actionId)}>{item.label}</button>)}</div>
    {gm && actor.secretNote && <aside className="secret"><b>GM only</b> {actor.secretNote}</aside>}
    <footer className="card-footer">{module.manifest.tagline}<span>{compact ? 'Reusable brick' : module.view.title}</span></footer>
  </article>
}

export default function App() {
  const [role, setRole] = useState<Role>('gm')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [encounter, setEncounter] = useState('')

  useEffect(() => {
    let mounted = true
    void host.load(role).then(value => { if (mounted) { setSnapshot(value); setEncounter(value.context.activeEncounter?.name || ''); setError('') } }).catch(cause => { if (mounted) setError(cause.message) })
    const stop = host.subscribe(role, value => { if (mounted) { setSnapshot(value); setEncounter(value.context.activeEncounter?.name || '') } })
    return () => { mounted = false; stop() }
  }, [role])

  const actor = useMemo(() => snapshot?.actors.find(item => item.entityId === selected) || snapshot?.actors[0], [snapshot, selected])
  async function refresh() { const value = await host.load(role); setSnapshot(value); setError('') }
  async function act(target: Actor, actionId: string) {
    setBusy(true); setError('')
    try { const parameters = target.module.view.layout.concat(target.module.view.brick).find(item => item.actionId === actionId)?.parameters || {}; await host.command({ operationId: crypto.randomUUID(), entityId: target.entityId, baseRevision: target.revision, actionId, parameters }); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Action failed') }
    finally { setBusy(false) }
  }
  async function saveEncounter() {
    try { await host.setEncounter(encounter.trim() || null); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update encounter') }
  }

  return <main className="shell">
    <nav className="topbar"><a className="brand" href="#"><span>p</span> POTOMAC</a><span className={`connection ${host.mode}`}>● {host.mode === 'host' ? 'LOCAL HOST' : 'LOCAL PREVIEW'}</span><label className="role">CLIENT PROJECTION<select value={role} onChange={event => { setSnapshot(null); setSelected(''); setRole(event.target.value as Role) }}><option value="gm">Game master</option><option value="player">Player</option></select></label></nav>
    <section className="hero"><div><p className="eyebrow">FOUNDATION EXPERIMENT · TABLE</p><h1>{role === 'gm' ? 'The table is yours.' : 'Welcome back.'}</h1><p>Two game systems. One character view. Campaign data stays on your host.</p></div><div className="campaign-badge"><span>CAMPAIGN</span><b>{snapshot?.context.campaignId || 'Connecting…'}</b><small>Cursor {snapshot?.context.cursor ?? '—'}</small></div></section>
    {error && <div className="error" role="alert">{error}<button onClick={() => void refresh()}>Retry</button></div>}
    <section className="encounter"><div><p className="eyebrow">ACTIVE ENCOUNTER · SHARED CONTEXT</p>{role === 'gm' ? <div className="encounter-edit"><input aria-label="Active encounter" placeholder="Encounter name" value={encounter} onChange={event => setEncounter(event.target.value)} /><button onClick={() => void saveEncounter()}>Update context</button></div> : <h2>{snapshot?.context.activeEncounter?.name || 'No active encounter'}</h2>}<p className="muted">{snapshot?.context.activeEncounter ? 'Updates are delivered to connected clients.' : 'Start an encounter to set the table context.'}</p></div><span className="live">● LIVE</span></section>
    <div className="layout"><section className="characters"><div className="section-heading"><div><p className="eyebrow">CHARACTERS · MODULE-DRIVEN</p><h2>{actor?.name || 'Characters'}</h2></div><div className="actor-tabs">{snapshot?.actors.map(item => <button className={item.entityId === actor?.entityId ? 'active' : ''} onClick={() => setSelected(item.entityId)} key={item.entityId}>{item.name}</button>)}</div></div>
      {actor ? <Character actor={actor} gm={role === 'gm'} busy={busy} action={act} /> : <div className="empty">No actors were returned. Connect as GM to create the example actors.</div>}
      <div className="section-heading party-heading"><div><p className="eyebrow">REUSABLE PARTY BRICK</p><h2>At the table</h2></div><span className="live">● SUBSCRIBED</span></div><div className="bricks">{snapshot?.actors.filter(item => item.entityId !== actor?.entityId).map(item => <Character compact key={item.entityId} actor={item} gm={role === 'gm'} busy={busy} action={act} />)}</div>
    </section>
    <aside className="feed"><div className="section-heading"><div><p className="eyebrow">AUDIT EVENTS · CURSOR {snapshot?.context.cursor ?? '—'}</p><h2>Session activity</h2></div></div>{snapshot?.activity.map(item => <article className="event" key={item.id}><div><strong>{item.action}</strong><span>{item.actor} · {item.time}</span></div><p>{item.detail || 'Campaign event'}</p>{item.visibility === 'gm' && <small className="private">GM PRIVATE</small>}</article>)}{!snapshot?.activity.length && <p className="muted">Actions and context changes will appear here.</p>}<p className="feed-note">Host filtered projection · revisions from server</p></aside></div>
    <footer className="footnote">{host.mode === 'host' ? 'Connected to the localhost foundation host' : 'Preview state is in memory and not authoritative'}<span>Module view definitions contain no system ID branches.</span></footer>
  </main>
}
