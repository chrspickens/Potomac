import type { LoreArticle, LoreKind } from './api.ts'
import type { AuthorizedLoreEntry } from './offline/storage.ts'

export const LORE_KINDS: LoreKind[] = ['location', 'person', 'faction', 'quest', 'item', 'handout', 'note']

export function filterLore(articles: LoreArticle[], query: string, kind: LoreKind | 'all', tag: string, archived = false): LoreArticle[] {
  const needle = query.trim().toLocaleLowerCase()
  const wantedTag = tag.trim().toLocaleLowerCase()
  return articles.filter(article => article.archived === archived
    && (kind === 'all' || article.kind === kind)
    && (!wantedTag || article.tags.some(item => item.toLocaleLowerCase() === wantedTag))
    && (!needle || `${article.title} ${article.tags.join(' ')} ${article.body}`.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => a.title.localeCompare(b.title))
}

// Keep preview deliberately text-only: raw HTML, image syntax, and link targets are
// never handed to the browser as markup or navigation.
export function safeLorePreview(markdown: string): string {
  return markdown
    .replace(/<[^>]*>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*\d+\.\s+/gm, '• ')
    .replace(/(`{1,3}|\*\*|__|\*|_)/g, '')
    .trim()
}

export function resolveRelatedLore(encounterLoreIds: string[] | undefined, articles: LoreArticle[]): LoreArticle[] {
  if (!encounterLoreIds) return []
  const byId = new Map(articles.filter(article => !article.archived).map(article => [article.id, article]))
  return encounterLoreIds.flatMap(id => {
    const article = byId.get(id)
    return article ? [article] : []
  })
}

/** Cached player views accept only correctly scoped, shared article records. */
export function projectCachedPlayerLore(entries: AuthorizedLoreEntry[]): LoreArticle[] {
  return entries.flatMap(entry => {
    const article = entry.article as Partial<LoreArticle>
    if (article.id !== entry.id || article.revision !== entry.revision || article.visibility !== 'shared'
      || typeof article.title !== 'string' || !Array.isArray(article.tags) || typeof article.body !== 'string'
      || article.archived !== false || !['location', 'person', 'faction', 'quest', 'item', 'handout', 'note'].includes(String(article.kind))) return []
    return [article as LoreArticle]
  })
}

export function validateLoreImage(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  const extensions: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }
  const extension = extensions[file.type]
  if (!extension || !file.name.toLowerCase().endsWith(extension)) return 'Choose a PNG, JPEG, GIF, or WebP image with a matching file extension.'
  if (file.size < 1 || file.size > 5 * 1024 * 1024) return 'Image attachments must be between 1 byte and 5 MiB.'
  return null
}
