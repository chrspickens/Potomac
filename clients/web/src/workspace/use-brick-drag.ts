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
  initial: BrickLayout
  bricks: BrickInstance[]
  dashboardId: string
}

export function useBrickDrag({
  editing,
  dashboardId,
  bricks,
  onCommit,
}: {
  editing: boolean
  dashboardId: string
  bricks: BrickInstance[]
  onCommit: (dashboardId: string, bricks: BrickInstance[]) => void
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<DragSession | null>(null)
  const resultRef = useRef<BrickInstance[] | null>(null)
  const commitRef = useRef(onCommit)
  const [preview, setPreview] = useState<BrickInstance[] | null>(null)
  const [active, setActive] = useState<{ id: string; mode: DragMode } | null>(null)
  commitRef.current = onCommit

  const cancel = () => {
    sessionRef.current = null
    resultRef.current = null
    setPreview(null)
    setActive(null)
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
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const start = (event: ReactPointerEvent<HTMLButtonElement>, brickId: string, mode: DragMode) => {
    if (!editing || event.button !== 0 || window.matchMedia('(max-width: 800px)').matches) return
    const grid = gridRef.current
    const brick = bricks.find(item => item.id === brickId)
    if (!grid || !brick) return
    const style = getComputedStyle(grid)
    const rect = grid.getBoundingClientRect()
    const columnGap = parseFloat(style.columnGap) || 0
    const rowGap = parseFloat(style.rowGap) || 0
    const rowHeight = parseFloat(style.gridAutoRows) || 90
    const contentWidth = rect.width - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0) - (parseFloat(style.borderLeftWidth) || 0) - (parseFloat(style.borderRightWidth) || 0)
    const columnStep = (contentWidth - 11 * columnGap) / 12 + columnGap
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
      initial: brick.layout,
      bricks,
      dashboardId,
    }
    resultRef.current = null
    setActive({ id: brickId, mode })
  }

  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    const columns = Math.round((event.clientX - session.startX) / session.columnStep)
    const rows = Math.round((event.clientY - session.startY) / session.rowStep)
    const proposed: BrickLayout = session.mode === 'move'
      ? { ...session.initial, x: session.initial.x + columns, y: session.initial.y + rows }
      : { ...session.initial, w: session.initial.w + columns, h: session.initial.h + rows }
    const next = resolveBrickLayout(session.bricks, session.brickId, proposed)
    resultRef.current = next
    setPreview(next)
  }

  const finish = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    move(event)
    const result = resultRef.current
    cancel()
    if (result) commitRef.current(session.dashboardId, result)
  }

  return { gridRef, preview, active, start, move, finish, cancel }
}
