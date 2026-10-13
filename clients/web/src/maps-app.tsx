import { useEffect, useMemo, useState } from 'react'
import type { Actor } from './modules.ts'
import type { ConnectionStatus, Encounter, MapPiece, MapPieceView, MapSceneView, Role } from './api.ts'
import { commandMap, createMap, listMaps, loadMap } from './api.ts'
import { clampPoint, gridPoints, nearestGridPoint, pieceDisplayLabel } from './maps.ts'
import './maps.css'

type Props = { role: Role; connection: ConnectionStatus; campaignId: string; actors: Actor[]; encounters: Encounter[]; hostAvailable: boolean; initialSceneId?: string; cachedScenes?: MapSceneView[]; onHandoff?: (app: 'encounters' | 'characters', id?: string) => void; onSceneChange?: (scenes: MapSceneView[]) => void }
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

export function MapCanvas({ scene, actors, onSelect, onDropPiece }: { scene: MapSceneView; actors: Actor[]; onSelect?: (piece: MapPieceView) => void; onDropPiece?: (piece: MapPieceView, point: { x: number; y: number }) => void }) {
  const actorNames = useMemo(() => new Map(actors.map(actor => [actor.entityId, actor.name])), [actors])
  const [dragging, setDragging] = useState<string>()
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number }>()
  const points = useMemo(() => gridPoints(scene.width, scene.height, scene.grid), [scene.width, scene.height, scene.grid])
  const position = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const point = { x: (event.clientX - bounds.left) / bounds.width * scene.width, y: (event.clientY - bounds.top) / bounds.height * scene.height }
    return clampPoint(nearestGridPoint(point, scene.grid), scene)
  }
  return <svg className="map-canvas" viewBox={`0 0 ${scene.width} ${scene.height}`} role="img" aria-label={`${scene.name} map`} onPointerMove={event => {
    if (!dragging || !onDropPiece) return
    setDragPoint(position(event))
  }} onPointerUp={() => {
    const piece = scene.pieces.find(item => item.id === dragging)
    if (piece && dragPoint) onDropPiece?.(piece, dragPoint)
    setDragging(undefined); setDragPoint(undefined)
  }}>
    <rect width={scene.width} height={scene.height} fill="#101d27" />
    {scene.grid.type === 'square' && <g className="map-square-grid">{Array.from({ length: Math.ceil(scene.width / scene.grid.size) + 1 }, (_, index) => <line key={`x${index}`} x1={index * scene.grid.size} y1={0} x2={index * scene.grid.size} y2={scene.height} />)}{Array.from({ length: Math.ceil(scene.height / scene.grid.size) + 1 }, (_, index) => <line key={`y${index}`} x1={0} y1={index * scene.grid.size} x2={scene.width} y2={index * scene.grid.size} />)}</g>}
    {scene.grid.type === 'hex' && <g className="map-hex-grid">{points.map((point, index) => <polygon key={index} points={Array.from({ length: 6 }, (_, side) => `${point.x + scene.grid.size / Math.sqrt(3) * Math.cos(Math.PI / 3 * side)},${point.y + scene.grid.size / Math.sqrt(3) * Math.sin(Math.PI / 3 * side)}`).join(' ')} />)}</g>}
    {scene.pieces.filter(piece => piece.visible || !onDropPiece).map(piece => <g key={piece.id} className={`map-piece map-piece-${piece.kind}`} transform={`translate(${dragging === piece.id && dragPoint ? dragPoint.x : piece.x} ${dragging === piece.id && dragPoint ? dragPoint.y : piece.y})`} tabIndex={0} role="button" aria-label={pieceDisplayLabel(piece, actorNames)} onClick={() => onSelect?.(piece)} onPointerDown={event => { if (!onDropPiece) return; event.currentTarget.setPointerCapture(event.pointerId); setDragging(piece.id); setDragPoint({ x: piece.x, y: piece.y }) }}>
      <circle r={Math.max(1.5, scene.grid.size * .38)} />
      <text y={Math.max(1, scene.grid.size * .58)} textAnchor="middle">{pieceDisplayLabel(piece, actorNames)}</text>
    </g>)}
  </svg>
}

export function MapsApp({ role, connection, campaignId, actors, encounters, hostAvailable, initialSceneId, cachedScenes = [], onHandoff, onSceneChange }: Props) {
  const [scenes, setScenes] = useState(cachedScenes)
  const [selectedId, setSelectedId] = useState(initialSceneId || cachedScenes[0]?.id || '')
  const [selectedPiece, setSelectedPiece] = useState<MapPieceView>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const selected = scenes.find(scene => scene.id === selectedId)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'world' | 'battle'>('world')
  const [width, setWidth] = useState(100)
  const [height, setHeight] = useState(70)
  const [gridType, setGridType] = useState<'none' | 'square' | 'hex'>('square')
  const [gridSize, setGridSize] = useState(5)

  useEffect(() => { if (initialSceneId) setSelectedId(initialSceneId) }, [initialSceneId])
  useEffect(() => {
    if (!hostAvailable || connection !== 'connected') return
    let active = true
    void listMaps(role).then(async listed => {
      const full = await Promise.all(listed.map(scene => loadMap(role, scene.id).catch(() => scene)))
      if (active) { setScenes(full); onSceneChange?.(full); if (!selectedId || !full.some(scene => scene.id === selectedId)) setSelectedId(full[0]?.id || '') }
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Maps could not be loaded') })
    return () => { active = false }
  }, [role, connection, campaignId, hostAvailable])

  async function refresh(sceneId = selectedId) {
    if (!sceneId) return
    const fresh = await loadMap(role, sceneId)
    setScenes(current => { const next = [...current.filter(scene => scene.id !== fresh.id), fresh]; onSceneChange?.(next); return next })
  }
  async function send(scene: MapSceneView, command: Parameters<typeof commandMap>[2]) {
    if (role !== 'gm' || connection !== 'connected') return
    setBusy(true); setError(''); setNotice('')
    try { await commandMap(role, scene.id, command); await refresh(scene.id); setNotice('Saved on host.') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Map change failed') }
    finally { setBusy(false) }
  }
  async function addScene(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const input = { id: newId('map'), operationId: newId('op'), baseRevision: 0, campaignId, name: name.trim(), kind, width, height, grid: { type: gridType, size: gridType === 'none' ? 0 : gridSize }, visibility: 'gm' as const }
      const result = await createMap(role, input); const created = await loadMap(role, result.sceneId)
      setScenes(current => { const next = [...current, created]; onSceneChange?.(next); return next }); setSelectedId(created.id); setName(''); setNotice('Map created on host.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Map could not be created') }
    finally { setBusy(false) }
  }
  async function savePiece(piece: MapPiece, point: { x: number; y: number }) {
    if (!selected || connection !== 'connected' || role !== 'gm' || (piece.x === point.x && piece.y === point.y)) return
    await send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'piece.put', piece: { id: piece.id, sceneId: selected.id, kind: piece.kind, x: point.x, y: point.y, visible: piece.visible, ...(piece.actorId ? { actorId: piece.actorId } : {}), ...(piece.label ? { label: piece.label } : {}) } })
  }

  return <main className="maps-page">
    <div className="page-intro"><div><p className="eyebrow">APPLICATION / MAPS</p><h1>Maps</h1><p>Campaign scenes, encounter layouts, and authorized map pieces.</p></div>{selected && <span className="map-revision">{connection === 'connected' ? `Host revision ${selected.revision}` : `Cached · revision ${selected.revision} · read only`}</span>}</div>
    {connection !== 'connected' && <p className="map-cache-state" role="status">Showing the last authorized map snapshots. Offline maps are read only and may be stale.</p>}
    {error && <p className="map-error" role="alert">{error}</p>}{notice && <p className="map-notice" role="status">{notice}</p>}
    <div className="maps-layout"><aside className="map-browser"><h2>Scenes</h2>{scenes.length ? scenes.map(scene => <button key={scene.id} className={selectedId === scene.id ? 'active' : ''} onClick={() => { setSelectedId(scene.id); setSelectedPiece(undefined) }}><strong>{scene.name}</strong><small>{scene.kind} · {scene.visibility} · {scene.width}×{scene.height}</small></button>) : <p>{connection === 'connected' ? 'No authorized maps yet.' : 'No cached maps.'}</p>}
      {role === 'gm' && <details><summary>Create scene</summary><form className="map-create-form" onSubmit={event => void addScene(event)}><label>Name<input required maxLength={160} value={name} onChange={event => setName(event.target.value)} /></label><label>Scene type<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="world">World</option><option value="battle">Battle</option></select></label><div className="map-field-row"><label>Width<input type="number" min="1" max="100000" value={width} onChange={event => setWidth(Number(event.target.value))} /></label><label>Height<input type="number" min="1" max="100000" value={height} onChange={event => setHeight(Number(event.target.value))} /></label></div><label>Grid<select value={gridType} onChange={event => setGridType(event.target.value as typeof gridType)}><option value="square">Square</option><option value="hex">Hex</option><option value="none">None</option></select></label>{gridType !== 'none' && <label>Grid size<input type="number" min="1" max="10000" value={gridSize} onChange={event => setGridSize(Number(event.target.value))} /></label>}<button className="primary" disabled={busy || connection !== 'connected'}>Create on host</button></form></details>}</aside>
      <section className="map-workspace">{selected ? <><header className="map-toolbar"><div><strong>{selected.name}</strong><small>{selected.kind} · {selected.grid.type === 'none' ? 'No grid' : `${selected.grid.type} grid · ${selected.grid.size} units`}</small></div><div><label>Encounter<select aria-label="Associated encounter" value={selected.encounterId || ''} disabled={role !== 'gm' || connection !== 'connected' || busy} onChange={event => void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'encounter.set', encounterId: event.target.value || null })}><option value="">Not linked</option>{encounters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{role === 'gm' && <button disabled={busy || connection !== 'connected'} onClick={() => void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'archive' })}>Archive</button>}</div></header>
        <MapCanvas scene={selected} actors={actors} onSelect={setSelectedPiece} onDropPiece={role === 'gm' && connection === 'connected' ? (piece, point) => void savePiece(piece, point) : undefined} />
        <div className="map-piece-list"><div><h2>Pieces</h2>{role === 'gm' && connection === 'connected' && <details><summary>Add piece</summary><form className="map-add-piece" onSubmit={event => { event.preventDefault(); if (!selected) return; const form = new FormData(event.currentTarget); const actorId = String(form.get('actorId') || ''); const label = String(form.get('label') || '').trim(); const piece: MapPiece = { id: newId('piece'), sceneId: selected.id, kind: actorId ? 'actor' : 'pin', x: selected.width / 2, y: selected.height / 2, visible: true, revision: 1, ...(actorId ? { actorId } : { label: label || 'Pin' }) }; void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'piece.put', piece: { ...piece } }); event.currentTarget.reset() }}><label>Actor<select name="actorId" defaultValue=""><option value="">Place a pin instead</option>{actors.map(actor => <option key={actor.entityId} value={actor.entityId}>{actor.name}</option>)}</select></label><label>Pin label<input name="label" maxLength={200} /></label><button>Add at center</button></form></details>}</div>
          {selected.pieces.map(piece => <div className={`map-piece-row ${selectedPiece?.id === piece.id ? 'active' : ''}`} key={piece.id}><button onClick={() => setSelectedPiece(piece)}><strong>{pieceDisplayLabel(piece, new Map(actors.map(actor => [actor.entityId, actor.name])))}</strong><small>{piece.kind} · {piece.x.toFixed(1)}, {piece.y.toFixed(1)}{piece.visible ? '' : ' · hidden'}</small></button>{piece.kind === 'actor' && piece.actorId && <button onClick={() => onHandoff?.('characters', piece.actorId)}>Open character</button>}{piece.destination && <button onClick={() => setSelectedId(piece.destination!.sceneId)}>Go to {piece.destination.name}</button>}{role === 'gm' && <button disabled={busy || connection !== 'connected'} onClick={() => void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'piece.delete', pieceId: piece.id })}>Remove</button>}</div>)}</div>
        <div className="map-links"><h2>Scene links</h2>{selected.pieces.filter(piece => piece.kind === 'pin').map(piece => <form key={piece.id} onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); const targetSceneId = String(data.get('targetSceneId')); const label = String(data.get('label') || ''); void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'link.put', pieceId: piece.id, targetSceneId, label }) }}><span>{piece.label || 'Pin'}</span><select aria-label={`Destination for ${piece.label || piece.id}`} name="targetSceneId" defaultValue={piece.destination?.sceneId || ''} disabled={role !== 'gm' || connection !== 'connected'}><option value="" disabled>Select destination</option>{scenes.filter(scene => scene.id !== selected.id).map(scene => <option key={scene.id} value={scene.id}>{scene.name}</option>)}</select><input aria-label="Link label" name="label" placeholder="Handoff label" defaultValue={piece.destination?.label || ''} disabled={role !== 'gm' || connection !== 'connected'} />{role === 'gm' && <><button disabled={busy || connection !== 'connected'}>Save link</button>{piece.destination && <button type="button" disabled={busy || connection !== 'connected'} onClick={() => void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'link.delete', pieceId: piece.id })}>Unlink</button>}</>}</form>)}</div>
        {selectedPiece?.destination && <button className="primary" onClick={() => setSelectedId(selectedPiece.destination!.sceneId)}>Travel to {selectedPiece.destination.name}</button>}
      </> : <p className="map-empty">{connection === 'connected' ? 'Create a scene or select one to open it.' : 'No authorized scene is available in this cache.'}</p>}</section></div>
  </main>
}
