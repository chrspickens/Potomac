import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { resolveBrickLayout } from './layout.ts'
import type { BrickInstance, BrickLayout } from './types.ts'

type DragMode = 'move' | 'resize'
type DragSession = {
  pointerId: number
  brickId: string
  mode: DragMode
  startX: number
  startY: number
  columnStep: number
  rowStep: number
  width: number
  height: number
  initial: BrickLayout
  bricks: BrickInstance[]
  dashboardId: string
  columns: number
}

type DragVisual = {
  id: string
  mode: DragMode
  dx: number
  dy: number
  width: number
  height: number
  dropLayout: BrickLayout
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value))

export function useBrickDrag({
  editing,
  dashboardId,
  columns,
  bricks,
  onCommit,
}: {
  editing: boolean
  dashboardId: string
  columns: number
  bricks: BrickInstance[]
  onCommit: (dashboardId: string, bricks: BrickInstance[]) => void
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<DragSession | null>(null)
  const resultRef = useRef<BrickInstance[] | null>(null)
  const visualRef = useRef<DragVisual | null>(null)
  const frameRef = useRef<number | null>(null)
  const commitRef = useRef(onCommit)
  const [visual, setVisual] = useState<DragVisual | null>(null)
  commitRef.current = onCommit

  const cancel = () => {
    sessionRef.current = null
    resultRef.current = null
    visualRef.current = null
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    setVisual(null)
  }

  useEffect(() => { cancel() }, [dashboardId, editing])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && sessionRef.current) {
        event.preventDefault()
        cancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [])

  const publish = (next: DragVisual) => {
    visualRef.current = next
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      setVisual(visualRef.current)
    })
  }

  const start = (event: ReactPointerEvent<HTMLButtonElement>, brickId: string, mode: DragMode) => {
    if (!editing || event.button !== 0 || window.matchMedia('(max-width: 800px)').matches) return
    const grid = gridRef.current
    const brick = bricks.find(item => item.id === brickId)
    const element = event.currentTarget.closest('.brick') || event.currentTarget.closest('.brick-frame')?.querySelector('.brick')
    if (!grid || !brick || !element) return
    const style = getComputedStyle(grid)
    const rect = grid.getBoundingClientRect()
    const brickRect = element.getBoundingClientRect()
    const columnGap = parseFloat(style.columnGap) || 0
    const rowGap = parseFloat(style.rowGap) || 0
    const rowHeight = parseFloat(style.gridTemplateRows.split(' ')[0]) || parseFloat(style.gridAutoRows) || 90
    const contentWidth = rect.width
      - (parseFloat(style.paddingLeft) || 0)
      - (parseFloat(style.paddingRight) || 0)
      - (parseFloat(style.borderLeftWidth) || 0)
      - (parseFloat(style.borderRightWidth) || 0)
    const columnStep = (contentWidth - (columns - 1) * columnGap) / columns + columnGap
    if (columnStep <= 0 || rowHeight <= 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    sessionRef.current = {
      pointerId: event.pointerId,
      brickId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      columnStep,
      rowStep: rowHeight + rowGap,
      width: brickRect.width,
      height: brickRect.height,
      initial: brick.layout,
      bricks,
      dashboardId,
      columns,
    }
    resultRef.current = null
    const initialVisual = {
      id: brickId,
      mode,
      dx: 0,
      dy: 0,
      width: brickRect.width,
      height: brickRect.height,
      dropLayout: brick.layout,
    }
    visualRef.current = initialVisual
    setVisual(initialVisual)
  }

  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    const { initial, mode, columnStep, rowStep } = session
    const rawDx = event.clientX - session.startX
    const rawDy = event.clientY - session.startY
    const dx = mode === 'move'
      ? clamp(rawDx, -initial.x * columnStep, (session.columns - initial.x - initial.w) * columnStep)
      : clamp(rawDx, (2 - initial.w) * columnStep, (session.columns - initial.x - initial.w) * columnStep)
    const dy = mode === 'move'
      ? Math.max(-initial.y * rowStep, rawDy)
      : Math.max((2 - initial.h) * rowStep, rawDy)
    const columns = Math.round(dx / columnStep)
    const rows = Math.round(dy / rowStep)
    const proposed: BrickLayout = mode === 'move'
      ? { ...initial, x: initial.x + columns, y: initial.y + rows }
      : { ...initial, w: initial.w + columns, h: initial.h + rows }
    const next = resolveBrickLayout(session.bricks, session.brickId, proposed, session.columns)
    const dropLayout = next.find(item => item.id === session.brickId)?.layout || initial
    const changed = Object.keys(initial).some(key =>
      initial[key as keyof BrickLayout] !== dropLayout[key as keyof BrickLayout])
    resultRef.current = changed ? next : null
    publish({
      id: session.brickId,
      mode,
      dx,
      dy,
      width: Math.max(1, session.width + dx),
      height: Math.max(1, session.height + dy),
      dropLayout,
    })
  }

  const finish = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    move(event)
    const result = resultRef.current
    cancel()
    if (result) commitRef.current(session.dashboardId, result)
  }

  return { gridRef, visual, start, move, finish, cancel }
}
