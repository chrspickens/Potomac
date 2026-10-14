import type { AuthorizedBrickDataAdapter, BrickBinding, BrickDefinition } from './types.ts'

export function resolveBindingMode(mode: 'follow' | 'pinned' | 'none', definition: BrickDefinition<unknown>, adapter: AuthorizedBrickDataAdapter): BrickBinding {
  if (mode === 'follow') return { mode: 'follow', contextKey: 'session.activeEncounter' }
  if (mode === 'none') return { mode: 'none' }
  const option = definition.getBindingOptions?.(adapter)?.[0]
  return { mode: 'pinned', entityId: option?.id ?? '' }
}
