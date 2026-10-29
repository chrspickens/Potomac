import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Actor } from './modules.ts'
import type { ConnectionStatus, Encounter, LoreArticle, MapPiece, MapPieceView, MapSceneView, Role } from './api.ts'
import { commandMap, createMap, fetchMapBackground, listMaps, loadMap, uploadMapBackground } from './api.ts'
import { clampMapPan, clampMapZoom, gridPoints, mapMarkerRadius, pieceDisplayLabel, positionForMove, viewportToScene } from './maps.ts'
import './maps.css'
import './maps-controls.css'
import './maps-responsive.css'

type Props = { role: Role; connection: ConnectionStatus; campaignId: string; actors: Actor[]; encounters: Encounter[]; loreArticles?: LoreArticle[]; hostAvailable: boolean; initialSceneId?: string; cachedScenes?: MapSceneView[]; cachedBackgrounds?: Record<string, Blob>; cacheTimes?: Record<string, number>; onHandoff?: (app: 'encounters' | 'characters' | 'lore', id?: string, originSceneId?: string) => void; onSceneChange?: (scenes: MapSceneView[]) => void; onSelectedSceneChange?: (sceneId: string) => void }
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

export function MapCanvas({ scene, actors, onSelect, onDropPiece, onKeyboardMovePiece, backgroundUrl, entityMarkers = [], showPrivate = false, snapToGrid = false, onSnapToGridChange, paintEnabled = false, paintColor, onPaintCell, calibratingGrid = false, calibrationPoints = [], imageSize, onCalibrationPoint }: { scene: MapSceneView; actors: Actor[]; onSelect?: (piece: MapPieceView) => void; onDropPiece?: (piece: MapPieceView, point: { x: number; y: number }) => void; onKeyboardMovePiece?: (piece: MapPieceView, point: { x: number; y: number }) => void; backgroundUrl?: string; entityMarkers?: Array<{ key: string; name: string; imageUrl?: string; position: { x: number; y: number } }>; showPrivate?: boolean; snapToGrid?: boolean; onSnapToGridChange?: (enabled: boolean) => void; paintEnabled?: boolean; paintColor?: string; onPaintCell?: (cell: { x: number; y: number }, color: string | null) => void; calibratingGrid?: boolean; calibrationPoints?: { x: number; y: number }[]; imageSize?: { width: number; height: number }; onCalibrationPoint?: (point: { x: number; y: number }) => void }) {
  const markerId = useId()
  const actorNames = useMemo(() => new Map(actors.map(actor => [actor.entityId, actor.name])), [actors])
  const [dragging, setDragging] = useState<string>()
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number }>()
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [panStart, setPanStart] = useState<{ x: number; y: number; originX: number; originY: number }>()
  const zoomMapTo = useCallback((value: number) => {
    const nextZoom = clampMapZoom(value)
    setZoom(nextZoom)
    setPan(current => clampMapPan(current, scene.width, scene.height, nextZoom))
    if (nextZoom === 1) setPanStart(undefined)
  }, [scene.width, scene.height])
  const dragPointRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const piecePointerStart = useRef<{ id: string; startX: number; startY: number } | undefined>(undefined)
  const mapCanvasRef = useRef<SVGSVGElement | null>(null)
  const points = useMemo(() => gridPoints(scene.width, scene.height, scene.grid), [scene.width, scene.height, scene.grid])
  const squareGridLines = useMemo(() => {
    if (scene.grid.type !== 'square' || scene.grid.size <= 0) return { x: [] as number[], y: [] as number[] }
    const origin = scene.grid.origin || { x: 0, y: 0 }
    const first = (value: number) => value - Math.ceil(value / scene.grid.size) * scene.grid.size
    const startX = first(origin.x), startY = first(origin.y)
    return { x: Array.from({ length: Math.ceil((scene.width - startX) / scene.grid.size) + 1 }, (_, index) => startX + index * scene.grid.size).filter(value => value >= 0), y: Array.from({ length: Math.ceil((scene.height - startY) / scene.grid.size) + 1 }, (_, index) => startY + index * scene.grid.size).filter(value => value >= 0) }
  }, [scene.width, scene.height, scene.grid])
  const scenePosition = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return viewportToScene({ x: (event.clientX - bounds.left) / bounds.width * scene.width, y: (event.clientY - bounds.top) / bounds.height * scene.height }, pan, zoom)
  }
  const position = (event: React.PointerEvent<SVGSVGElement>) => positionForMove(scenePosition(event), scene, snapToGrid)
  useEffect(() => {
    const canvas = mapCanvasRef.current
    if (!canvas) return
    const zoomMap = (event: WheelEvent) => {
      event.preventDefault()
      zoomMapTo(zoom * (event.deltaY < 0 ? 1.1 : .9))
    }
    canvas.addEventListener('wheel', zoomMap, { passive: false })
    return () => canvas.removeEventListener('wheel', zoomMap)
  }, [zoom, zoomMapTo])
  return <div className="map-canvas-wrap"><div className="map-viewport-controls" aria-label="Map viewport controls"><button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>Fit / Reset view</button><button type="button" aria-label="Zoom in" onClick={() => zoomMapTo(zoom + .1)}>+</button><label>Zoom<input aria-label="Zoom level" type="number" min="1" max="4" step="0.1" value={zoom.toFixed(1)} onChange={event => zoomMapTo(Number(event.target.value))} /></label><button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => zoomMapTo(zoom - .1)}>−</button>{onDropPiece && scene.grid.type !== 'none' && <label><input type="checkbox" checked={snapToGrid} onChange={event => onSnapToGridChange?.(event.target.checked)} /> Snap to grid</label>}<small>Map is fitted to its grid window. Pan by dragging or using arrow keys when zoomed in.</small></div><div className="map-grid-window" style={{ width: `min(100%, ${(scene.width / scene.height) * 65}vh)`, aspectRatio: `${scene.width} / ${scene.height}` }}><svg ref={mapCanvasRef} className="map-canvas" viewBox={`0 0 ${scene.width} ${scene.height}`} preserveAspectRatio="none" role="img" aria-label={`${scene.name} map`} tabIndex={0} onKeyDown={event => { const amount = scene.grid.type === 'square' ? scene.grid.size : 5; if (event.key === '+' || event.key === '=') zoomMapTo(zoom * 1.2); else if (event.key === '-') zoomMapTo(zoom / 1.2); else if (zoom > 1 && event.key === 'ArrowLeft') setPan(value => clampMapPan({ ...value, x: value.x + amount }, scene.width, scene.height, zoom)); else if (zoom > 1 && event.key === 'ArrowRight') setPan(value => clampMapPan({ ...value, x: value.x - amount }, scene.width, scene.height, zoom)); else if (zoom > 1 && event.key === 'ArrowUp') setPan(value => clampMapPan({ ...value, y: value.y + amount }, scene.width, scene.height, zoom)); else if (zoom > 1 && event.key === 'ArrowDown') setPan(value => clampMapPan({ ...value, y: value.y - amount }, scene.width, scene.height, zoom)) }} onPointerDown={event => { if (zoom > 1 && !calibratingGrid && !(event.target as Element).closest('.map-piece')) { event.currentTarget.setPointerCapture(event.pointerId); setPanStart({ x: event.clientX, y: event.clientY, originX: pan.x, originY: pan.y }) } }} onPointerMove={event => {
    if (!dragging || !onDropPiece) return
    const start = piecePointerStart.current
    if (start && Math.hypot(event.clientX - start.startX, event.clientY - start.startY) < 4) return
    const next = position(event)
    dragPointRef.current = next
    setDragPoint(next)
  }} onPointerMoveCapture={event => { if (panStart && zoom > 1 && Math.hypot(event.clientX - panStart.x, event.clientY - panStart.y) >= 4) { const bounds = event.currentTarget.getBoundingClientRect(); setPan(clampMapPan({ x: panStart.originX + (event.clientX - panStart.x) / bounds.width * scene.width / zoom, y: panStart.originY + (event.clientY - panStart.y) / bounds.height * scene.height / zoom }, scene.width, scene.height, zoom)) } }} onPointerUp={event => { if (calibratingGrid) { const point = scenePosition(event); if (imageSize) { const scale = Math.min(scene.width / imageSize.width, scene.height / imageSize.height); const x = (point.x - (scene.width - imageSize.width * scale) / 2) / scale; const y = (point.y - (scene.height - imageSize.height * scale) / 2) / scale; if (x >= 0 && y >= 0 && x <= imageSize.width && y <= imageSize.height) onCalibrationPoint?.({ x, y }) } setPanStart(undefined); return } const pointerDistance = panStart ? Math.hypot(event.clientX - panStart.x, event.clientY - panStart.y) : Infinity
    if (pointerDistance < 4 && paintEnabled && onPaintCell && scene.grid.type === 'square') { const point = scenePosition(event), origin = scene.grid.origin || { x: 0, y: 0 }; if (point.x >= 0 && point.y >= 0 && point.x < scene.width && point.y < scene.height) onPaintCell({ x: Math.floor((point.x - origin.x) / scene.grid.size), y: Math.floor((point.y - origin.y) / scene.grid.size) }, paintColor ?? null) }
    setPanStart(undefined)
    const piece = scene.pieces.find(item => item.id === dragging)
    const finalPoint = piece ? position(event) : dragPointRef.current
    const start = piecePointerStart.current
    if (piece && finalPoint && start?.id === piece.id && Math.hypot(event.clientX - start.startX, event.clientY - start.startY) >= 4 && (finalPoint.x !== piece.x || finalPoint.y !== piece.y)) onDropPiece?.(piece, finalPoint)
    piecePointerStart.current = undefined
    dragPointRef.current = undefined
    setDragging(undefined); setDragPoint(undefined)
  }} onPointerCancel={() => { piecePointerStart.current = undefined; dragPointRef.current = undefined; setDragging(undefined); setDragPoint(undefined); setPanStart(undefined) }}>
    <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}><rect width={scene.width} height={scene.height} fill="#101d27" />
    {backgroundUrl && <image className="map-background" href={backgroundUrl} x="0" y="0" width={scene.width} height={scene.height} preserveAspectRatio="xMidYMid meet" />}
    {scene.grid.type === 'square' && scene.grid.fills?.map(fill => <rect key={`${fill.x},${fill.y}`} className="map-cell-fill" x={(scene.grid.origin?.x || 0) + fill.x * scene.grid.size} y={(scene.grid.origin?.y || 0) + fill.y * scene.grid.size} width={scene.grid.size} height={scene.grid.size} fill={fill.color} />)}
    {scene.grid.type === 'square' && <g className="map-square-grid">{squareGridLines.x.map(x => <line key={`x${x}`} x1={x} y1={0} x2={x} y2={scene.height} />)}{squareGridLines.y.map(y => <line key={`y${y}`} x1={0} y1={y} x2={scene.width} y2={y} />)}</g>}
    {calibratingGrid && calibrationPoints.map((point, index) => imageSize && <circle key={index} className="map-calibration-point" cx={(scene.width - imageSize.width * Math.min(scene.width / imageSize.width, scene.height / imageSize.height)) / 2 + point.x * Math.min(scene.width / imageSize.width, scene.height / imageSize.height)} cy={(scene.height - imageSize.height * Math.min(scene.width / imageSize.width, scene.height / imageSize.height)) / 2 + point.y * Math.min(scene.width / imageSize.width, scene.height / imageSize.height)} r={Math.max(2, scene.grid.size * .12)}><title>{`Calibration point ${index + 1}`}</title></circle>)}
    {scene.grid.type === 'hex' && <g className="map-hex-grid">{points.map((point, index) => <polygon key={index} points={Array.from({ length: 6 }, (_, side) => `${point.x + scene.grid.size / Math.sqrt(3) * Math.cos(Math.PI / 3 * side)},${point.y + scene.grid.size / Math.sqrt(3) * Math.sin(Math.PI / 3 * side)}`).join(' ')} />)}</g>}
    {scene.pieces.filter(piece => piece.visible || showPrivate).map(piece => {
      const mapUnit = Math.min(scene.width, scene.height)
      const markerRadius = mapMarkerRadius(scene.width, scene.height, scene.grid.size)
      return <g key={piece.id} className={`map-piece map-piece-${piece.kind}`} transform={`translate(${dragging === piece.id && dragPoint ? dragPoint.x : piece.x} ${dragging === piece.id && dragPoint ? dragPoint.y : piece.y})`} tabIndex={0} role="button" aria-label={`${pieceDisplayLabel(piece, actorNames)}, ${piece.kind}, coordinates ${piece.x}, ${piece.y}${onDropPiece ? ', draggable; numeric coordinate controls are available' : ', read only'}`} aria-keyshortcuts="Enter Space ArrowLeft ArrowRight ArrowUp ArrowDown" onClick={() => onSelect?.(piece)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelect?.(piece) } else if (onKeyboardMovePiece && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); const amount = event.shiftKey ? 1 : scene.grid.type === 'square' ? scene.grid.size : 1; const point = positionForMove({ x: piece.x + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0), y: piece.y + (event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0) }, scene, snapToGrid); onKeyboardMovePiece(piece, point) } }} onPointerDown={event => { onSelect?.(piece); if (!onDropPiece) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); piecePointerStart.current = { id: piece.id, startX: event.clientX, startY: event.clientY }; setDragging(piece.id); dragPointRef.current = { x: piece.x, y: piece.y }; setDragPoint({ x: piece.x, y: piece.y }) }}>
        <circle r={markerRadius} />
        <text y={markerRadius * 1.55} fontSize={Math.max(1, Math.min(mapUnit * .018, markerRadius * .55))} textAnchor="middle">{pieceDisplayLabel(piece, actorNames)}</text>
      </g>
    })}
    {entityMarkers.map((marker, index) => {
      const radius = mapMarkerRadius(scene.width, scene.height, scene.grid.size)
      const iconRadius = radius * .78
      const clipId = `map-encounter-${markerId.replace(/[^A-Za-z0-9_-]/g, '')}-${index}`
      return <g key={marker.key} className="map-encounter-entity" transform={`translate(${marker.position.x * scene.width} ${marker.position.y * scene.height})`} role="img" aria-label={marker.name}>
        <circle r={radius} className="map-encounter-entity-ring" />
        {marker.imageUrl ? <><defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse"><circle r={iconRadius} /></clipPath></defs><image href={marker.imageUrl} x={-iconRadius} y={-iconRadius} width={iconRadius * 2} height={iconRadius * 2} preserveAspectRatio="xMidYMid meet" clipPath={`url(#${clipId})`} /></> : <text className="map-encounter-entity-symbol" fontSize={radius * 1.2} textAnchor="middle" dominantBaseline="central">✦</text>}
        <circle r={radius} className="map-encounter-entity-outline" />
        <title>{marker.name}</title>
      </g>
    })}
    </g>
  </svg></div></div>
}

export function MapsApp({ role, connection, campaignId, actors, encounters, loreArticles = [], hostAvailable, initialSceneId, cachedScenes = [], cachedBackgrounds = {}, cacheTimes = {}, onHandoff, onSceneChange, onSelectedSceneChange }: Props) {
  const [scenes, setScenes] = useState(cachedScenes)
  const [selectedId, setSelectedId] = useState(initialSceneId || cachedScenes[0]?.id || '')
  const [selectedPiece, setSelectedPiece] = useState<MapPieceView>()
  const keyboardMoveQueue = useRef<Promise<void>>(Promise.resolve())
  const keyboardPosition = useRef(new Map<string, { x: number; y: number }>())
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(hostAvailable && connection === 'connected')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const selected = scenes.find(scene => scene.id === selectedId)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'world' | 'battle'>('world')
  const [width, setWidth] = useState(100)
  const [height, setHeight] = useState(70)
  const [gridType, setGridType] = useState<'none' | 'square' | 'hex'>('none')
  const [gridSize, setGridSize] = useState(5)
  const [backgroundFile, setBackgroundFile] = useState<File>()
  const [snapToGrid, setSnapToGrid] = useState(false)
  const [paintMode, setPaintMode] = useState<'off' | 'paint' | 'erase'>('off')
  const [paintColor, setPaintColor] = useState('#3b82f6')
  const [mapFilter, setMapFilter] = useState<'world' | 'battle'>('world')
  const [backgroundUrl, setBackgroundUrl] = useState('')
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>()
  const [calibratingGrid, setCalibratingGrid] = useState(false)
  const [calibrationPoints, setCalibrationPoints] = useState<{ x: number; y: number }[]>([])
  const [calibrationCellCount, setCalibrationCellCount] = useState(1)
  const [navigation, setNavigation] = useState<string[]>([])

  useEffect(() => { if (initialSceneId) { setSelectedId(initialSceneId); onSelectedSceneChange?.(initialSceneId); const target = scenes.find(scene => scene.id === initialSceneId); if (target) { setMapFilter(target.kind); setKind(target.kind) } } }, [initialSceneId, onSelectedSceneChange])
  useEffect(() => { setPaintMode('off'); setCalibratingGrid(false); setCalibrationPoints([]) }, [selectedId])
  useEffect(() => {
    setScenes(cachedScenes)
    if (selectedId && !cachedScenes.some(scene => scene.id === selectedId)) { const firstId = cachedScenes[0]?.id || ''; setSelectedId(firstId); onSelectedSceneChange?.(firstId) }
  }, [cachedScenes])
  useEffect(() => {
    let active = true
    let objectUrl = ''
    setBackgroundUrl('')
    const useBlob = (blob: Blob) => { if (active) { objectUrl = URL.createObjectURL(blob); setBackgroundUrl(objectUrl) } }
    if (connection === 'connected' && selected?.background && hostAvailable) void fetchMapBackground(role, selected.id).then(useBlob).catch(() => { if (active) setError('Map background is unavailable to this account.') })
    else if (selected && cachedBackgrounds[selected.id]) useBlob(cachedBackgrounds[selected.id])
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [selected?.id, selected?.background?.id, role, connection, hostAvailable, cachedBackgrounds])
  useEffect(() => { setImageSize(undefined); if (!backgroundUrl) return; const image = new Image(); image.onload = () => setImageSize({ width: image.naturalWidth, height: image.naturalHeight }); image.src = backgroundUrl }, [backgroundUrl])
  useEffect(() => {
    if (!hostAvailable || connection !== 'connected') return
    let active = true
    setLoading(true)
    void listMaps(role).then(async listed => {
      const full = await Promise.all(listed.map(scene => loadMap(role, scene.id).catch(() => scene)))
      if (active) { setScenes(full); onSceneChange?.(full); if (initialSceneId && full.some(scene => scene.id === initialSceneId)) { const target = full.find(scene => scene.id === initialSceneId)!; setMapFilter(target.kind); setKind(target.kind); setSelectedId(initialSceneId); onSelectedSceneChange?.(initialSceneId) } else if (!selectedId || !full.some(scene => scene.id === selectedId)) { const first = full[0]; const firstId = first?.id || ''; setSelectedId(firstId); if (first) { setMapFilter(first.kind); setKind(first.kind) } onSelectedSceneChange?.(firstId) } setError('') }
    }).catch(() => { if (active) { setScenes([]); onSceneChange?.([]); setSelectedId(''); setError('Authorized maps are unavailable.') } }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [role, connection, campaignId, hostAvailable])
  useEffect(() => { setLoading(hostAvailable && connection === 'connected') }, [hostAvailable, connection])

  async function refresh(sceneId = selectedId) {
    if (!sceneId) return
    const fresh = await loadMap(role, sceneId)
    const next = [...scenes.filter(scene => scene.id !== fresh.id), fresh]
    setScenes(next)
    onSceneChange?.(next)
  }
  async function send(scene: MapSceneView, command: Parameters<typeof commandMap>[2], { showFeedback = true }: { showFeedback?: boolean } = {}) {
    if (role !== 'gm' || connection !== 'connected') return
    setBusy(true); if (showFeedback) { setError(''); setNotice('') }
    try { await commandMap(role, scene.id, command); await refresh(scene.id); if (showFeedback) setNotice('Saved on host.'); return true }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Map change failed'); return false }
    finally { setBusy(false) }
  }
  async function paintCell(cell: { x: number; y: number }, color: string | null) {
    if (!selected || busy || role !== 'gm' || connection !== 'connected' || selected.kind !== 'battle' || selected.grid.type !== 'square') return
    const fills = [...(selected.grid.fills || [])]
    const existing = fills.findIndex(fill => fill.x === cell.x && fill.y === cell.y)
    if (color === null) {
      if (existing < 0) return
      fills.splice(existing, 1)
    } else {
      if (existing >= 0 && fills[existing].color.toLowerCase() === color.toLowerCase()) return
      if (existing >= 0) fills.splice(existing, 1)
      fills.push({ ...cell, color: color.toUpperCase() })
    }
    await send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'update', grid: { ...selected.grid, fills } }, { showFeedback: false })
  }
  function beginGridCalibration() {
    if (!selected || !imageSize || busy) return
    if (selected.grid.fills?.length && !window.confirm('Calibrating this map will clear its painted square colors because they are tied to the current grid. Continue?')) return
    setPaintMode('off'); setCalibrationPoints([]); setCalibrationCellCount(1); setCalibratingGrid(true); setNotice('Click two grid intersections along the same row or column on the map image.')
  }
  async function addCalibrationPoint(point: { x: number; y: number }) {
    if (!selected || !imageSize) return
    const points = [...calibrationPoints, point]
    if (points.length < 2) { setCalibrationPoints(points); return }
    const [first, second] = points
    const dx = Math.abs(second.x - first.x), dy = Math.abs(second.y - first.y)
    const distance = Math.max(dx, dy), tolerance = Math.max(5, distance * .03)
    if (distance < 2 || Math.min(dx, dy) > tolerance) { setCalibrationPoints([]); setError('Choose two grid intersections on the same row or column, then try again.'); setNotice(''); return }
    const size = distance / calibrationCellCount
    if (!Number.isFinite(size) || size < 1 || size > 10000) { setCalibrationPoints([]); setError('That measurement produces a grid size outside the supported range.'); setNotice(''); return }
    const positiveMod = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor
    const origin = { x: positiveMod(first.x, size), y: positiveMod(first.y, size) }
    const saved = await send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'update', width: imageSize.width, height: imageSize.height, grid: { type: 'square', size, origin, fills: [] }, scalePieces: true }, { showFeedback: false })
    setCalibratingGrid(false); setCalibrationPoints([])
    if (saved) setNotice(`Grid calibrated to ${size.toFixed(2)} image pixels per cell. Map size set to ${imageSize.width} × ${imageSize.height}.`)
  }
  function changeGridType(type: 'none' | 'square') {
    if (!selected) return
    if (selected.grid.fills?.length && type !== 'square' && !window.confirm('Turning off the square grid will clear its painted cell colors. Continue?')) return
    void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'update', grid: { type, size: type === 'none' ? 0 : selected.grid.size || 100 } })
  }
  function changeGridCellSize(size: number) {
    if (!selected || !Number.isFinite(size) || size < 1 || size > 10000) return
    const oldGrid = selected.grid
    if (oldGrid.type !== 'square') {
      void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'update', grid: { ...oldGrid, size } })
      return
    }
    const oldOrigin = oldGrid.origin || { x: 0, y: 0 }
    const origin = { x: ((oldOrigin.x % size) + size) % size, y: ((oldOrigin.y % size) + size) % size }
    const fillsByCell = new Map<string, { x: number; y: number; color: string }>()
    for (const fill of oldGrid.fills || []) {
      const centerX = oldOrigin.x + (fill.x + 0.5) * oldGrid.size
      const centerY = oldOrigin.y + (fill.y + 0.5) * oldGrid.size
      const x = Math.floor((centerX - origin.x) / size)
      const y = Math.floor((centerY - origin.y) / size)
      const cellLeft = origin.x + x * size, cellTop = origin.y + y * size
      if (cellLeft + size <= 0 || cellLeft >= selected.width || cellTop + size <= 0 || cellTop >= selected.height) continue
      const key = `${x},${y}`
      if (!fillsByCell.has(key)) fillsByCell.set(key, { x, y, color: fill.color })
    }
    void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'update', grid: { ...oldGrid, size, origin, fills: [...fillsByCell.values()] } })
  }
  function changeSceneKind(kind: 'world' | 'battle') {
    if (!selected) return
    const hasFills = Boolean(selected.grid.fills?.length)
    if (hasFills && kind === 'world' && !window.confirm('Changing this scene to a World Map clears its battle-map square colors. Continue?')) return
    void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'update', kind, ...(hasFills && kind === 'world' ? { grid: { ...selected.grid, fills: [] } } : {}) })
  }
  async function addScene(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const input = { id: newId('map'), operationId: newId('op'), baseRevision: 0, campaignId, name: name.trim(), kind, width, height, grid: { type: gridType, size: gridType === 'none' ? 0 : gridSize }, visibility: 'gm' as const }
      const result = await createMap(role, input); let created = await loadMap(role, result.sceneId)
      if (backgroundFile) { await uploadMapBackground(created.id, backgroundFile, created.revision); created = await loadMap(role, created.id); setBackgroundFile(undefined) }
      const next = [...scenes, created]
      setScenes(next); onSceneChange?.(next); setSelectedId(created.id); onSelectedSceneChange?.(created.id); setMapFilter(created.kind); setName(''); setNotice('Map created on host.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Map could not be created') }
    finally { setBusy(false) }
  }
  async function savePiece(piece: MapPiece, point: { x: number; y: number }) {
    if (!selected || connection !== 'connected' || role !== 'gm' || (piece.x === point.x && piece.y === point.y)) return
    await send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'piece.put', piece: { id: piece.id, sceneId: selected.id, kind: piece.kind, x: point.x, y: point.y, visible: piece.visible, ...(piece.actorId ? { actorId: piece.actorId } : {}), ...(piece.label ? { label: piece.label } : {}) } })
  }
  function queueKeyboardMove(piece: MapPieceView, point: { x: number; y: number }) {
    const sceneId = selected?.id
    if (!sceneId || role !== 'gm' || connection !== 'connected') return
    const current = keyboardPosition.current.get(piece.id) || { x: piece.x, y: piece.y }
    const delta = { x: point.x - piece.x, y: point.y - piece.y }
    const next = positionForMove({ x: current.x + delta.x, y: current.y + delta.y }, selected, snapToGrid)
    if (next.x === current.x && next.y === current.y) return
    keyboardPosition.current.set(piece.id, next)
    keyboardMoveQueue.current = keyboardMoveQueue.current.then(async () => {
      const latest = await loadMap(role, sceneId)
      const latestPiece = latest.pieces.find(item => item.id === piece.id)
      if (!latestPiece) return
      const target = keyboardPosition.current.get(piece.id)
      if (!target || target.x === latestPiece.x && target.y === latestPiece.y) return
      await commandMap(role, sceneId, { operationId: newId('op'), baseRevision: latest.revision, command: 'piece.put', piece: { id: latestPiece.id, sceneId, kind: latestPiece.kind, x: target.x, y: target.y, visible: latestPiece.visible, ...(latestPiece.actorId ? { actorId: latestPiece.actorId } : {}), ...(latestPiece.label ? { label: latestPiece.label } : {}) } })
      const fresh = await loadMap(role, sceneId)
      keyboardPosition.current.set(piece.id, { x: fresh.pieces.find(item => item.id === piece.id)?.x ?? target.x, y: fresh.pieces.find(item => item.id === piece.id)?.y ?? target.y })
      const nextScenes = [...scenes.filter(item => item.id !== fresh.id), fresh]
      setScenes(nextScenes); onSceneChange?.(nextScenes)
    }).catch(cause => { keyboardPosition.current.delete(piece.id); setError(cause instanceof Error ? cause.message : 'Map change failed') })
  }
  async function updatePiece(piece: MapPieceView, changes: Partial<Pick<MapPiece, 'x' | 'y' | 'label' | 'visible'>>) {
    if (!selected) return
    await send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'piece.put', piece: { id: piece.id, sceneId: selected.id, kind: piece.kind, x: changes.x ?? piece.x, y: changes.y ?? piece.y, visible: changes.visible ?? piece.visible, ...(piece.actorId ? { actorId: piece.actorId } : {}), ...((changes.label ?? piece.label) ? { label: changes.label ?? piece.label } : {}) } })
  }
  async function goToMap(targetId: string) {
    if (!scenes.some(scene => scene.id === targetId)) { setError('Map unavailable.'); return }
    if (selectedId) setNavigation(current => [...current, selectedId])
    setSelectedId(targetId); onSelectedSceneChange?.(targetId); setSelectedPiece(undefined)
  }
  function followDestination(destination: NonNullable<MapPieceView['destination']>) {
    if (destination.kind === 'map_scene') void goToMap(destination.sceneId)
    else if (selected) onHandoff?.('lore', destination.entryId, selected.id)
  }
  async function addBackground(file?: File) {
    if (!file || !selected) return
    setBusy(true); setError('')
    try { await uploadMapBackground(selected.id, file, selected.revision); await refresh(selected.id); setNotice('Background saved on host.') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Background upload failed') }
    finally { setBusy(false) }
  }
  function selectMapKind(next: 'world' | 'battle') {
    setMapFilter(next); setKind(next); setGridType(next === 'world' ? 'none' : 'square')
    if (next === 'battle') setGridSize(value => value || 100)
    const first = scenes.find(scene => scene.kind === next)
    setSelectedId(first?.id || ''); setSelectedPiece(undefined)
    if (first) onSelectedSceneChange?.(first.id)
  }

  return <main className={`maps-page maps-kind-${selected?.kind || mapFilter}`}>
    <div className="page-intro"><div><p className="eyebrow">APPLICATION / MAPS</p><h1>Maps</h1><p>World maps hold location pins and Lore links. Battle maps are reusable designs that encounters can import as independent copies.</p></div>{selected && <span className="map-revision">{connection === 'connected' ? `Host revision ${selected.revision}` : `Cached · revision ${selected.revision} · read only`}</span>}</div>
    {connection !== 'connected' && <p className="map-cache-state" role="status">Showing the last authorized map snapshots. Offline maps are read only and may be stale{selected && cacheTimes[selected.id] ? ` · last synced ${new Date(cacheTimes[selected.id]).toLocaleString()}` : ''}.</p>}
    {loading && <p role="status">Loading authorized maps…</p>}{error && <p className="map-error" role="alert">{error}</p>}{notice && <p className="map-notice" role="status">{notice}</p>}
    <div className="maps-layout"><aside className="map-browser"><h2>{mapFilter === 'world' ? 'World maps' : 'Battle map designs'}</h2><div className="map-kind-tabs" role="group" aria-label="Map collection"><button type="button" aria-pressed={mapFilter === 'world'} onClick={() => selectMapKind('world')}>World maps</button><button type="button" aria-pressed={mapFilter === 'battle'} onClick={() => selectMapKind('battle')}>Battle maps</button></div>{scenes.filter(scene => scene.kind === mapFilter).length ? scenes.filter(scene => scene.kind === mapFilter).map(scene => <button key={scene.id} className={selectedId === scene.id ? 'active' : ''} onClick={() => { setSelectedId(scene.id); onSelectedSceneChange?.(scene.id); setSelectedPiece(undefined) }}><strong>{scene.name}</strong><small>{scene.kind === 'world' ? 'World map' : scene.encounterId ? 'Encounter copy' : 'Reusable design'} · {scene.visibility} · {scene.width}×{scene.height}</small></button>) : <p>{connection === 'connected' ? `No ${mapFilter === 'world' ? 'world maps' : 'battle map designs'} yet.` : 'No cached maps.'}</p>}
      {role === 'gm' && <details><summary>Create scene</summary><form className="map-create-form" onSubmit={event => void addScene(event)}><label>Name<input required maxLength={160} value={name} onChange={event => setName(event.target.value)} /></label><label>Map type<select value={kind} onChange={event => { const next = event.target.value as typeof kind; setKind(next); setGridType(next === 'world' ? 'none' : 'square'); if (next === 'battle') setGridSize(100) }}><option value="world">World map · locations and Lore</option><option value="battle">Battle map design · grid and tokens</option></select></label><div className="map-field-row"><label>Width<input type="number" min="1" max="100000" value={width} onChange={event => setWidth(Number(event.target.value))} /></label><label>Height<input type="number" min="1" max="100000" value={height} onChange={event => setHeight(Number(event.target.value))} /></label></div><label>Grid<select value={gridType} onChange={event => setGridType(event.target.value as typeof gridType)}><option value="none">None</option><option value="square">Square</option></select></label>{gridType !== 'none' && <label>Grid size<input type="number" min="1" max="10000" value={gridSize} onChange={event => setGridSize(Number(event.target.value))} /></label>}<label>Background image (optional)<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={event => setBackgroundFile(event.currentTarget.files?.[0])} /></label><button className="primary" disabled={busy || connection !== 'connected'}>Create on host</button></form></details>}</aside>
      <section className="map-workspace">{selected ? <><header className="map-toolbar"><div><strong>{selected.name}</strong><small>{selected.kind === 'world' ? 'World map · locations and Lore' : selected.encounterId ? 'Independent encounter map copy' : 'Reusable battle map design'} · {selected.grid.type === 'none' ? 'No grid' : `${selected.grid.type} grid · ${selected.grid.size} units`}</small></div><div>{navigation.length > 0 && <button onClick={() => { const previousId = navigation.at(-1)!; setSelectedId(previousId); onSelectedSceneChange?.(previousId); setNavigation(items => items.slice(0, -1)) }}>Back to previous map</button>}{selected.kind === 'world' && <label>Related encounter<select aria-label="Related encounter" value={selected.encounterId || ''} disabled={role !== 'gm' || connection !== 'connected' || busy} onChange={event => void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'encounter.set', encounterId: event.target.value || null })}><option value="">None</option>{encounters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}{selected.encounterId && <span>Imported into {encounters.find(item => item.id === selected.encounterId)?.name || 'an encounter'}</span>}{role === 'gm' && <><button disabled={busy || connection !== 'connected'} onClick={() => void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: selected.visibility === 'shared' ? 'revoke' : 'publish' })}>{selected.visibility === 'shared' ? 'Revoke from players' : 'Publish to players'}</button><button disabled={busy || connection !== 'connected'} onClick={() => void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'archive' })}>Archive</button></>}</div></header>
        <div className="map-controls" aria-label="Map scene controls">{role === 'gm' && connection === 'connected' && <><label>Title<input aria-label="Map title" key={`title-${selected.id}-${selected.revision}`} defaultValue={selected.name} maxLength={160} onBlur={event => { const value = event.target.value.trim(); if (value && value !== selected.name) void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'update', name: value }) }} /></label><label>Width<input aria-label="Map width" type="number" min="1" max="100000" key={`width-${selected.id}-${selected.revision}`} defaultValue={selected.width} onBlur={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value > 0 && value <= 100000 && value !== selected.width) void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'update', width: value }) }} /></label><label>Height<input aria-label="Map height" type="number" min="1" max="100000" key={`height-${selected.id}-${selected.revision}`} defaultValue={selected.height} onBlur={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value > 0 && value <= 100000 && value !== selected.height) void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'update', height: value }) }} /></label><label>Kind<select aria-label="Scene kind" value={selected.kind} disabled={busy} onChange={event => changeSceneKind(event.target.value as 'world' | 'battle')}><option value="world">World</option><option value="battle">Battle</option></select></label><label>Grid<select aria-label="Grid" value={selected.grid.type} disabled={busy} onChange={event => changeGridType(event.target.value as 'none' | 'square')}><option value="none">Off</option><option value="square">Square</option></select></label>{selected.grid.type !== 'none' && <label>Cell size<input aria-label="Grid cell size" type="number" min="1" max="10000" key={`grid-${selected.id}-${selected.revision}`} defaultValue={selected.grid.size} onBlur={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 1 && value <= 10000 && value !== selected.grid.size) changeGridCellSize(value) }} /></label>}<label>Background image<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={busy} onChange={event => void addBackground(event.currentTarget.files?.[0])} /></label></>}</div>
        {selected.kind === 'battle' && role === 'gm' && connection === 'connected' && <div className="map-calibration-controls" aria-label="Battle map grid calibration">{!calibratingGrid ? <button type="button" disabled={busy || !backgroundUrl || !imageSize} onClick={beginGridCalibration}>Auto-size grid from image</button> : <><label>Cells between clicks<input aria-label="Cells between calibration points" type="number" min="1" max="100" step="1" value={calibrationCellCount} onChange={event => setCalibrationCellCount(Math.max(1, Math.min(100, Math.floor(Number(event.target.value) || 1))))} /></label><span>{calibrationPoints.length === 0 ? 'Click the first grid intersection.' : 'Click a second intersection on the same row or column.'}</span><button type="button" onClick={() => { setCalibratingGrid(false); setCalibrationPoints([]); setNotice('') }}>Cancel</button></>}</div>}
        {selected.kind === 'battle' && selected.grid.type === 'square' && role === 'gm' && connection === 'connected' && !calibratingGrid && <div className="map-paint-controls" aria-label="Battle map square coloring"><label><input type="checkbox" checked={paintMode !== 'off'} onChange={event => setPaintMode(event.target.checked ? 'paint' : 'off')} /> Paint squares</label>{paintMode !== 'off' && <><label>RGB color<input aria-label="Square RGB color" type="color" value={paintColor} onChange={event => setPaintColor(event.target.value)} /></label><button type="button" aria-pressed={paintMode === 'erase'} onClick={() => setPaintMode(paintMode === 'erase' ? 'paint' : 'erase')}>{paintMode === 'erase' ? 'Eraser selected' : 'Erase squares'}</button><small>Click a square inside the map window to paint it. Changes save to the host.</small></>}</div>}
        {selected.encounterId && <button type="button" onClick={() => onHandoff?.('encounters', selected.encounterId!)}>Open associated encounter</button>}
        {selected.background && !backgroundUrl && <p role="status">{connection === 'connected' ? 'Loading authorized background…' : 'Background unavailable offline unless previously cached.'}</p>}
        <MapCanvas key={selected.id} scene={selected} actors={actors} backgroundUrl={backgroundUrl} imageSize={imageSize} calibratingGrid={calibratingGrid} calibrationPoints={calibrationPoints} onCalibrationPoint={addCalibrationPoint} showPrivate={role === 'gm'} snapToGrid={snapToGrid} onSnapToGridChange={setSnapToGrid} paintEnabled={paintMode !== 'off'} paintColor={paintMode === 'erase' ? undefined : paintColor} onPaintCell={(cell, color) => void paintCell(cell, color)} onSelect={setSelectedPiece} onDropPiece={role === 'gm' && connection === 'connected' && !calibratingGrid ? (piece, point) => void savePiece(piece, point) : undefined} onKeyboardMovePiece={role === 'gm' && connection === 'connected' && !calibratingGrid ? (piece, point) => queueKeyboardMove(piece, point) : undefined} />
        <div className="map-piece-list"><div><h2>Pieces</h2>{role === 'gm' && connection === 'connected' && <details><summary>{selected.kind === 'world' ? 'Add location pin or actor token' : 'Add actor token or location pin'}</summary><form className="map-add-piece" onSubmit={event => { event.preventDefault(); if (!selected) return; const form = new FormData(event.currentTarget); const actorId = String(form.get('actorId') || ''); const label = String(form.get('label') || '').trim(); const piece: MapPiece = { id: newId('piece'), sceneId: selected.id, kind: actorId ? 'actor' : 'pin', x: selected.width / 2, y: selected.height / 2, visible: false, revision: 1, ...(actorId ? { actorId } : { label: label || 'Pin' }) }; void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'piece.put', piece: { ...piece } }); event.currentTarget.reset() }}><label>Actor<select name="actorId" defaultValue=""><option value="">Place a pin instead</option>{actors.map(actor => <option key={actor.entityId} value={actor.entityId}>{actor.name}</option>)}</select></label><label>Pin label<input name="label" maxLength={200} /></label><button>Add at center · GM only</button></form></details>}</div>
          {selected.pieces.map(piece => <div className={`map-piece-row ${selectedPiece?.id === piece.id ? 'active' : ''}`} key={piece.id}><button onClick={() => setSelectedPiece(piece)}><strong>{pieceDisplayLabel(piece, new Map(actors.map(actor => [actor.entityId, actor.name])))}</strong><small>{piece.kind} · {piece.x.toFixed(1)}, {piece.y.toFixed(1)}{piece.visible ? ' · shared' : ' · GM only'}</small></button>{piece.kind === 'actor' && piece.actorId && <button onClick={() => onHandoff?.('characters', piece.actorId)}>Open character</button>}{piece.destination && <button onClick={() => followDestination(piece.destination!)}>{piece.destination.kind === 'map_scene' ? `Go to ${piece.destination.name}` : `Open ${piece.destination.title}`}</button>}{role === 'gm' && connection === 'connected' && <><label>Label<input aria-label={`Label for ${pieceDisplayLabel(piece, new Map(actors.map(actor => [actor.entityId, actor.name])))}`} maxLength={200} defaultValue={piece.label || ''} onBlur={event => { if (piece.kind === 'pin' && event.target.value !== (piece.label || '')) void updatePiece(piece, { label: event.target.value }) }} /></label><label>X<input aria-label={`X coordinate for ${piece.id}`} type="number" min="0" max={selected.width} step="any" defaultValue={piece.x} onBlur={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0 && value <= selected.width && value !== piece.x) void updatePiece(piece, { x: value }) }} /></label><label>Y<input aria-label={`Y coordinate for ${piece.id}`} type="number" min="0" max={selected.height} step="any" defaultValue={piece.y} onBlur={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0 && value <= selected.height && value !== piece.y) void updatePiece(piece, { y: value }) }} /></label><label><input type="checkbox" checked={piece.visible} disabled={busy} onChange={event => void updatePiece(piece, { visible: event.target.checked })} /> Shared</label><button disabled={busy} onClick={() => void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'piece.delete', pieceId: piece.id })}>Remove</button></>}</div>)}</div>
        <div className="map-links"><h2>Pin destinations</h2>{selected.pieces.filter(piece => piece.kind === 'pin').map(piece => <div className="map-pin-destination" key={piece.id}><form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'link.put', pieceId: piece.id, targetSceneId: String(data.get('targetSceneId')), label: String(data.get('label') || '') }) }}><span>{piece.label || 'Pin'} · Map</span><select aria-label={`Destination for ${piece.label || piece.id}`} name="targetSceneId" defaultValue={piece.destination?.kind === 'map_scene' ? piece.destination.sceneId : ''} disabled={role !== 'gm' || connection !== 'connected'}><option value="" disabled>Select destination</option>{scenes.filter(scene => scene.id !== selected.id).map(scene => <option key={scene.id} value={scene.id}>{scene.name}</option>)}</select><input aria-label="Link label" name="label" placeholder="Handoff label" defaultValue={piece.destination?.label || ''} disabled={role !== 'gm' || connection !== 'connected'} />{role === 'gm' && <><button disabled={busy || connection !== 'connected'}>Save link</button>{piece.destination?.kind === 'map_scene' && <button type="button" disabled={busy || connection !== 'connected'} onClick={() => void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'link.delete', pieceId: piece.id })}>Unlink</button>}</>}</form><form className="map-lore-link" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'lore-link.put', pieceId: piece.id, targetLoreEntryId: String(data.get('targetLoreEntryId')), label: String(data.get('label') || '') }) }}><label>Lore destination<select aria-label={`Lore destination for ${piece.label || piece.id}`} name="targetLoreEntryId" defaultValue={piece.destination?.kind === 'lore_entry' ? piece.destination.entryId : ''} disabled={role !== 'gm' || connection !== 'connected'}><option value="">No Lore destination</option>{loreArticles.filter(article => !article.archived).map(article => <option key={article.id} value={article.id}>{article.title}{article.visibility === 'gm' ? ' · GM only' : ''}</option>)}</select></label><label>Lore link label<input aria-label={`Lore link label for ${piece.label || piece.id}`} name="label" placeholder="Optional label" defaultValue={piece.destination?.kind === 'lore_entry' ? piece.destination.label : ''} disabled={role !== 'gm' || connection !== 'connected'} /></label>{role === 'gm' && <><button disabled={busy || connection !== 'connected'}>Save Lore link</button>{piece.destination?.kind === 'lore_entry' && <button type="button" disabled={busy || connection !== 'connected'} onClick={() => void send(selected, { operationId: newId('op'), baseRevision: selected.revision, command: 'lore-link.delete', pieceId: piece.id })}>Remove Lore link</button>}</>}</form></div>)}</div>
        {selectedPiece?.destination && <button className="primary" onClick={() => followDestination(selectedPiece.destination!)}>{selectedPiece.destination.kind === 'map_scene' ? `Travel to ${selectedPiece.destination.name}` : `Open ${selectedPiece.destination.title}`}</button>}
      </> : <p className="map-empty">{connection === 'connected' ? 'Create a scene or select one to open it.' : 'No authorized scene is available in this cache.'}</p>}</section></div>
  </main>
}
