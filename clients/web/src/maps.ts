import type { MapGrid, MapPiece, MapSceneView } from './api.ts'

export type Point = { x: number; y: number }

export function viewportToScene(point: Point, pan: Point, zoom: number): Point {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error('Zoom must be a positive finite number')
  return { x: (point.x - pan.x) / zoom, y: (point.y - pan.y) / zoom }
}

export function gridPoints(width: number, height: number, grid: MapGrid): Point[] {
  if (grid.type === 'none' || !Number.isFinite(grid.size) || grid.size <= 0) return []
  const points: Point[] = []
  if (grid.type === 'square') {
    for (let x = 0; x <= width; x += grid.size) for (let y = 0; y <= height; y += grid.size) points.push({ x, y })
    return points
  }
  const rowStep = grid.size * Math.sqrt(3) / 2
  for (let row = 0, y = 0; y <= height; row++, y = row * rowStep) {
    for (let x = (row % 2) * grid.size / 2; x <= width; x += grid.size) points.push({ x, y })
  }
  return points
}

export function nearestGridPoint(point: Point, grid: MapGrid): Point {
  if (grid.type === 'none' || grid.size <= 0) return point
  if (grid.type === 'square') return { x: Math.round(point.x / grid.size) * grid.size, y: Math.round(point.y / grid.size) * grid.size }
  const q = (2 / 3 * point.x) / grid.size
  const r = (-point.x / 3 + Math.sqrt(3) / 3 * point.y) / grid.size
  const cubeX = q, cubeZ = r, cubeY = -cubeX - cubeZ
  let rx = Math.round(cubeX), ry = Math.round(cubeY), rz = Math.round(cubeZ)
  const dx = Math.abs(rx - cubeX), dy = Math.abs(ry - cubeY), dz = Math.abs(rz - cubeZ)
  if (dx > dy && dx > dz) rx = -ry - rz
  else if (dy > dz) ry = -rx - rz
  else rz = -rx - ry
  return { x: grid.size * (3 / 2 * rx), y: grid.size * (Math.sqrt(3) * (rz + rx / 2)) }
}

export function positionForMove(point: Point, scene: Pick<MapSceneView, 'width' | 'height' | 'grid'>, snap: boolean): Point {
  return clampPoint(snap ? nearestGridPoint(point, scene.grid) : point, scene)
}

export function clampPoint(point: Point, scene: Pick<MapSceneView, 'width' | 'height'>): Point {
  return { x: Math.min(scene.width, Math.max(0, point.x)), y: Math.min(scene.height, Math.max(0, point.y)) }
}

export function pieceDisplayLabel(piece: MapPiece, actorNames: ReadonlyMap<string, string>): string {
  return piece.kind === 'actor' ? actorNames.get(piece.actorId || '') || 'Authorized actor unavailable' : piece.label || 'Pin'
}
