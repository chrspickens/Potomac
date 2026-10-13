import type { LoreArticle, LoreKind } from './api.ts'

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
