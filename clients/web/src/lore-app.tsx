import { createContext, useEffect, useMemo, useState, type FormEvent } from 'react'
import { createLore, listLore, setLoreArchived, updateLore, type ConnectionStatus, type LoreArticle, type LoreInput, type LoreKind, type Role } from './api.ts'
import { filterLore, LORE_KINDS, safeLorePreview } from './lore.ts'
import './lore.css'

const emptyForm = (): LoreInput => ({ title: '', kind: 'note', tags: [], body: '', visibility: 'gm', gmNotes: '' })
export const LoreArticlesContext = createContext<LoreArticle[]>([])
export const LoreTargetContext = createContext<(id?: string) => void>(() => {})
export const LoreRelationsContext = createContext<Record<string, string[]>>({})

export function LoreApp({ role, connection, targetId, initialArticles = [], onArticlesChange, hostAvailable }: { role: Role; connection: ConnectionStatus; targetId?: string; initialArticles?: LoreArticle[]; onArticlesChange?: (articles: LoreArticle[]) => void; hostAvailable: boolean }) {
  const [articles, setArticles] = useState<LoreArticle[]>(initialArticles)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<LoreKind | 'all'>('all')
  const [tag, setTag] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [selectedId, setSelectedId] = useState(targetId ?? '')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<LoreInput>(emptyForm)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(false)
  const canEdit = role === 'gm' && connection === 'connected' && hostAvailable

  const reload = async () => {
    if (connection !== 'connected') { setLoading(false); return }
    setLoading(true)
    try { const result = await listLore(role); setArticles(result); onArticlesChange?.(result); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Lore could not be loaded') }
    finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [role, connection])
  useEffect(() => { setArticles(initialArticles) }, [initialArticles])
  useEffect(() => { if (targetId) setSelectedId(targetId) }, [targetId])

  const visible = useMemo(() => filterLore(articles, query, kind, tag, showArchived), [articles, query, kind, tag, showArchived])
  const selected = articles.find(item => item.id === selectedId)
  useEffect(() => {
    if (selectedId && !visible.some(item => item.id === selectedId)) setSelectedId('')
  }, [selectedId, visible])

  const startEdit = (article?: LoreArticle) => {
    setForm(article ? { title: article.title, kind: article.kind, tags: [...article.tags], body: article.body, visibility: article.visibility, gmNotes: role === 'gm' ? article.gmNotes || '' : '' } : emptyForm())
    setEditing(true); setPreview(false); setError('')
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!canEdit) return
    setBusy(true); setError('')
    const input = { ...form, title: form.title.trim(), tags: [...new Set(form.tags.map(item => item.trim()).filter(Boolean))] }
    try {
      const saved = selected && editing && selectedId === selected.id ? await updateLore(selected.id, selected.revision, input) : await createLore(input)
      setArticles(current => { const next = [...current.filter(item => item.id !== saved.id), saved]; onArticlesChange?.(next); return next }); setSelectedId(saved.id); setEditing(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Lore could not be saved') }
    finally { setBusy(false) }
  }
  const archive = async () => {
    if (!selected || !canEdit) return
    setBusy(true); setError('')
    try { const saved = await setLoreArchived(selected.id, selected.revision, !selected.archived); setArticles(current => { const next = current.map(item => item.id === saved.id ? { ...item, ...saved } : item); onArticlesChange?.(next); return next }); setSelectedId('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Lore archive state could not be changed') }
    finally { setBusy(false) }
  }

  return <main className="lore-page">
      <div className="page-intro"><div><p className="eyebrow">APPLICATION / LORE</p><h1>Lore &amp; handouts</h1><p>Browse campaign articles by type and tag. The host filters content by visibility.</p></div>{canEdit && <button className="primary" onClick={() => { setSelectedId(''); startEdit() }}>New article</button>}</div>
    {connection === 'disconnected' && <p role="status" className="capability-note">Host disconnected. Lore edits are unavailable; this view is not saved locally.</p>}
    {!hostAvailable && <p role="status" className="capability-note">Lore requires a configured host; local preview has no Lore storage.</p>}
    {error && <p role="alert" className="error-banner">{error}{/revision|conflict|stale/i.test(error) ? ' Reload the latest article before editing again.' : ''}<button onClick={() => void reload()}>Retry</button></p>}
    <div className="lore-layout"><aside className="lore-browser"><label>Search<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Title, tags, or text" /></label>{role === 'gm' && <label>Type<select value={kind} onChange={event => setKind(event.target.value as LoreKind | 'all')}><option value="all">All types</option>{LORE_KINDS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>}{role === 'gm' && <label>Tag<input value={tag} onChange={event => setTag(event.target.value)} placeholder="Any tag" /></label>}{role === 'gm' && <label className="lore-check"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} /> Show archived</label>}
      <nav aria-label="Lore articles" className="lore-list">{loading ? <p role="status">Loading Lore…</p> : visible.length ? visible.map(item => <button key={item.id} className={item.id === selectedId ? 'active' : ''} onClick={() => { setSelectedId(item.id); setEditing(false) }}><strong>{item.title}</strong><small>{role === 'gm' ? `${item.kind} · ${item.tags.join(', ') || 'No tags'} · ${item.visibility}` : 'Shared article'}</small></button>) : <p>{connection !== 'connected' ? 'Connect to the host to browse Lore.' : 'No matching Lore articles.'}</p>}</nav>
    </aside><section className="lore-detail" aria-label="Lore detail">
      {editing && canEdit ? <form className="schema-form" onSubmit={event => void save(event)}><h2>{selected ? 'Edit article' : 'New article'}</h2><label>Title<input required maxLength={160} value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} /></label><label>Type<select value={form.kind} onChange={event => setForm(current => ({ ...current, kind: event.target.value as LoreKind }))}>{LORE_KINDS.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Tags, separated by commas<input value={form.tags.join(', ')} onChange={event => setForm(current => ({ ...current, tags: event.target.value.split(',') }))} /></label><label>Visibility<select value={form.visibility} onChange={event => setForm(current => ({ ...current, visibility: event.target.value as LoreInput['visibility'] }))}><option value="gm">GM only</option><option value="shared">Shared with authorized players</option></select></label><div className="lore-editor-toolbar"><strong>Markdown body</strong><button type="button" aria-pressed={preview} onClick={() => setPreview(value => !value)}>{preview ? 'Edit text' : 'Preview safely'}</button></div>{preview ? <div className="lore-markdown" aria-label="Safe Markdown preview">{safeLorePreview(form.body)}</div> : <label className="lore-body">Article body<textarea maxLength={50000} value={form.body} onChange={event => setForm(current => ({ ...current, body: event.target.value }))} /></label>}{role === 'gm' && <label>GM notes<textarea maxLength={8000} value={form.gmNotes || ''} onChange={event => setForm(current => ({ ...current, gmNotes: event.target.value }))} /></label>}<div><button className="primary" disabled={busy || !canEdit}>Save on host</button><button type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button></div></form> : selected ? <article className="lore-article"><p className="eyebrow">{selected.kind} · {selected.visibility}{selected.archived ? ' · archived' : ''}</p><h2>{selected.title}</h2><p className="lore-tags">{selected.tags.map(item => <span key={item}>{item}</span>)}</p><div className="lore-markdown">{safeLorePreview(selected.body)}</div>{role === 'gm' && selected.gmNotes && <aside className="gm-note"><b>GM notes</b><div>{selected.gmNotes}</div></aside>}<small>Revision {selected.revision}{selected.updatedAt ? ` · Updated ${selected.updatedAt}` : ''}</small>{canEdit && <div className="action-grid">{!selected.archived && <button disabled={busy} onClick={() => startEdit(selected)}>Edit</button>}<button disabled={busy} onClick={() => void archive()}>{selected.archived ? 'Restore' : 'Archive'}</button></div>}</article> : <p className="brick-message">{loading ? 'Loading Lore…' : 'Select an article to read.'}</p>}
    </section></div>
  </main>
}
