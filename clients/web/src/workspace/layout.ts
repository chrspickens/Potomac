import type { BrickInstance, BrickLayout } from './types.ts';

const DEFAULT_COLUMNS = 12;
const MIN_DIMENSION = 2;

/** Returns whether two grid rectangles share at least one cell. */
export function layoutsOverlap(a: BrickLayout, b: BrickLayout): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/**
 * Resolves a proposed brick move or resize into a stable, non-overlapping grid.
 * The active brick keeps the proposed position; colliding siblings are pushed
 * down in their existing array order. The input array and its bricks are never
 * mutated.
 */
export function resolveBrickLayout(
  bricks: BrickInstance[],
  activeId: string,
  proposed: BrickLayout,
  columns = DEFAULT_COLUMNS,
): BrickInstance[] {
  const gridColumns = Math.max(MIN_DIMENSION, finiteInteger(columns, DEFAULT_COLUMNS));
  const activeIndex = bricks.findIndex((brick) => brick.id === activeId);
  if (activeIndex < 0) return bricks.slice();

  const active = bricks[activeIndex];
  const activeLayout = normalizeLayout(proposed, gridColumns, active.layout);
  const placed: BrickLayout[] = [activeLayout];

  const resolved = bricks.map((brick, index) => {
    if (index === activeIndex) return { ...brick, layout: activeLayout };

    const base = normalizeLayout(brick.layout, gridColumns, brick.layout);
    const layout = findAvailableBelow(base, placed);
    placed.push(layout);
    return { ...brick, layout };
  });

  return resolved;
}

function normalizeLayout(
  layout: BrickLayout,
  columns: number,
  fallback: BrickLayout,
): BrickLayout {
  const w = Math.min(columns, Math.max(MIN_DIMENSION, finiteInteger(layout.w, fallback.w)));
  const h = Math.max(MIN_DIMENSION, finiteInteger(layout.h, fallback.h));
  const x = Math.min(columns - w, Math.max(0, finiteInteger(layout.x, fallback.x)));
  const y = Math.max(0, finiteInteger(layout.y, fallback.y));
  return { x, y, w, h };
}

function findAvailableBelow(layout: BrickLayout, placed: BrickLayout[]): BrickLayout {
  let y = layout.y;
  while (true) {
    const candidate = { ...layout, y };
    const collision = placed.find((other) => layoutsOverlap(candidate, other));
    if (!collision) return candidate;
    y = collision.y + collision.h;
  }
}

function finiteInteger(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.floor(value) : Math.floor(fallback);
}
