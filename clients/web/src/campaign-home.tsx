import type { Activity, CampaignConfig, ConnectionStatus, LoreArticle, MapSceneView, Role, SessionSnapshot, Snapshot } from './api'
import { campaignHomeActivity, campaignHomeIdentity, campaignHomeState, lastPreparedEncounter } from './campaign-home-model'

type Props = {
  role: Role
  snapshot: Snapshot | null
  campaign: CampaignConfig | null
  connection: ConnectionStatus
  session?: SessionSnapshot
  error: string
  lore: LoreArticle[]
  maps: MapSceneView[]
  onOpen: (target: 'table' | 'characters' | 'encounters' | 'lore' | 'maps', id?: string) => void
  onCreate: (target: 'character' | 'encounter') => void
}

export function CampaignHome({ role, snapshot, campaign, connection, session, error, lore, maps, onOpen, onCreate }: Props) {
  const state = campaignHomeState({ snapshot, connection, error, hasContent: lore.length > 0 || maps.length > 0 || Boolean(snapshot?.activity.length) })
  const identity = campaignHomeIdentity(campaign, snapshot)
  const activity: Activity[] = campaignHomeActivity(snapshot, role)
  const activeEncounter = snapshot?.context.activeEncounter
  const preparedEncounter = lastPreparedEncounter(snapshot?.encounters || [])
  const currentSession = session?.current || snapshot?.session?.current
  const sessionLabel = currentSession?.status === 'active' ? 'Session live'
    : currentSession?.status === 'paused' ? 'Session paused'
      : currentSession?.status === 'finished' ? 'Session ended' : 'No live session'

  return <main className="campaign-home">
    <header className="home-heading">
      <div><p className="eyebrow">CAMPAIGN HOME</p><h1>{identity.name}</h1><p>{identity.system}</p></div>
      <div className={`home-connection connection-${connection}`} role="status">{connection === 'connected' ? 'Connected to host' : connection === 'connecting' ? 'Connecting to host' : snapshot ? 'Offline · cached view' : 'Host unavailable'}</div>
    </header>
    {state === 'loading' && <section className="home-state" role="status"><h2>Loading campaign</h2><p>Connecting to the host and loading authorized campaign details.</p></section>}
    {state === 'unavailable' && <section className="home-state" role="status"><h2>Campaign unavailable</h2><p>Reconnect to the host to load the campaign.</p></section>}
    {state === 'error' && <section className="home-state" role="alert"><h2>Campaign details could not be loaded</h2><p>{error}</p></section>}
    {state === 'offline' && <p className="home-stale" role="status">Showing this browser’s last authorized snapshot. Details may be stale until the host reconnects.</p>}
    {state === 'empty' && <section className="home-state"><h2>{role === 'gm' ? 'Your campaign is ready to prepare' : 'Your campaign is getting started'}</h2><p>{role === 'gm' ? 'Create a character or prepare an encounter to begin.' : 'No campaign content is currently available to you.'}</p></section>}

    <section className="home-session" aria-label="Current session">
      <div><p className="eyebrow">CURRENT SESSION</p><h2>{sessionLabel}</h2><p>{activeEncounter ? `Active encounter: ${activeEncounter.name}` : role === 'gm' ? 'No encounter is active.' : 'No current encounter is available.'}</p></div>
      <div className="home-actions">
        <button type="button" onClick={() => onOpen('table')}>{role === 'gm' ? 'Open Table' : 'Go to Table'}</button>
        {role === 'gm' && preparedEncounter && <button type="button" onClick={() => onOpen('encounters', preparedEncounter.id)}>Continue encounter preparation</button>}
      </div>
    </section>

    {role === 'gm' ? <section className="home-quick-actions" aria-label="GM quick actions"><h2>Preparation</h2>
      <button type="button" onClick={() => onCreate('encounter')}>Create encounter</button>
      <button type="button" onClick={() => onCreate('character')}>Create character</button>
      <button type="button" onClick={() => onOpen('lore')}>Create Lore entry · open Lore</button>
      <button type="button" onClick={() => onOpen('maps')}>Create map · open Maps</button>
    </section> : <section className="home-player-status" aria-label="Your campaign status"><h2>Your next step</h2><p>{currentSession?.status === 'active' ? 'Follow the live session and use your authorized character.' : currentSession?.status === 'paused' ? 'The session is paused. You can review your authorized campaign content.' : 'Wait for the GM to begin a session, or review your authorized campaign content.'}</p><p>{snapshot?.actors.length ? `Your authorized characters: ${snapshot.actors.map(actor => actor.name).join(', ')}` : 'No character is currently available to this account.'}</p><button type="button" onClick={() => onOpen('characters')}>View your characters</button></section>}

    <div className="home-content">
      <section className="home-preview" aria-label="Authorized campaign content"><h2>Campaign content</h2>
        {snapshot?.actors.length ? <div><h3>Characters</h3>{snapshot.actors.slice(0, 4).map(actor => <button type="button" key={actor.entityId} onClick={() => onOpen('characters', actor.entityId)}>{actor.name}</button>)}</div> : <p>No authorized characters.</p>}
        {snapshot?.encounters.length ? <div><h3>Encounters</h3>{snapshot.encounters.slice(0, 4).map(encounter => <button type="button" key={encounter.id} onClick={() => onOpen('encounters', encounter.id)}>{encounter.name}</button>)}</div> : null}
        {maps.length ? <div><h3>Maps</h3>{maps.slice(0, 3).map(map => <button type="button" key={map.id} onClick={() => onOpen('maps', map.id)}>{map.name}</button>)}</div> : null}
        {lore.filter(item => !item.archived).length ? <div><h3>Lore</h3>{lore.filter(item => !item.archived).slice(0, 3).map(item => <button type="button" key={item.id} onClick={() => onOpen('lore', item.id)}>{item.title}</button>)}</div> : null}
      </section>
      <section className="home-activity" aria-label="Recent authorized activity"><h2>Recent activity</h2>
        {activity.length ? activity.map(item => <article key={item.id}><strong>{item.action}</strong><p>{item.detail || 'Campaign activity'}</p><small>{item.actor} · {item.time}</small></article>) : <p>No recent activity is available.</p>}
      </section>
    </div>
  </main>
}
