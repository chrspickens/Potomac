import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { addLoreLink, createLore, fetchLoreAsset, getLoreLinks, HostRequestError, listLore, listLoreAssets, readLore, removeLoreAsset, removeLoreLink, setLoreArchived, setLorePublication, updateLore, uploadLoreAsset, type ConnectionStatus, type LoreArticle, type LoreAsset, type LoreInput, type LoreKind, type LoreLink, type LoreTargetKind, type Role, type Encounter } from './api.ts'
import { filterLore, LORE_KINDS, projectCachedPlayerLore, safeLorePreview, validateLoreImage } from './lore.ts'
import { loadRememberedIdentity } from './identity.ts'
import type { Actor } from './modules.ts'
import { cacheAuthorizedLore, loadCachedAuthorizedLore } from './offline/snapshots.ts'
import './lore.css'
import { CharacterPreparationContext } from './workspace/contributions.tsx'

const emptyForm = (): LoreInput => ({ title: '', kind: 'note', tags: [], body: '', visibility: 'gm', gmNotes: '' })
export const LoreArticlesContext = createContext<LoreArticle[]>([])
export const LoreTargetContext = createContext<(id?: string) => void>(() => {})
export const LoreRelationsContext = createContext<Record<string, string[]>>({})

export function LoreApp({ role, connection, targetId, initialArticles = [], onArticlesChange, hostAvailable, onBackToMap, availableActors = [], availableEncounters = [], onOpenTarget }: {
  role: Role; connection: ConnectionStatus; targetId?: string; initialArticles?: LoreArticle[];
  onArticlesChange?: (articles: LoreArticle[]) => void; hostAvailable: boolean;
  onBackToMap?: () => void;
  availableActors?: Actor[]; availableEncounters?: Encounter[];
  onOpenTarget?: (kind: 'actor' | 'encounter', id: string) => void
}) {
  const [articles, setArticles] = useState<LoreArticle[]>(initialArticles)
  const preparation = useContext(CharacterPreparationContext)
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
  const [links, setLinks] = useState<LoreLink[]>([])
  const [backlinks, setBacklinks] = useState<Array<{ id: string; sourceId: string; sourceTitle: string; label?: string }>>([])
  const [assets, setAssets] = useState<LoreAsset[]>([])
  const [linkTargetKind, setLinkTargetKind] = useState<LoreTargetKind>('lore')
  const [previews, setPreviews] = useState<Record<string,string>>({})
  const [offlineCachedAt, setOfflineCachedAt] = useState<number | null>(null)
  const previewUrls = useRef<string[]>([])
  const canEdit = role === 'gm' && connection === 'connected' && hostAvailable
  useEffect(() => () => { for (const url of previewUrls.current) URL.revokeObjectURL(url); previewUrls.current = [] }, [selectedId])

  const reload = async () => {
    if (connection !== 'connected') {
      // Never reuse a previous role's in-memory projection when offline.
      // A cache may be shown only for the exact remembered player scope.
      setArticles([]); onArticlesChange?.([]); setSelectedId(''); setLinks([]); setBacklinks([]); setAssets([])
      setOfflineCachedAt(null)
      if (role === 'player' && hostAvailable) {
        const host = import.meta.env.VITE_POTOMAC_HOST?.replace(/\/$/, '')
        const identity = host ? loadRememberedIdentity(host) : null
        if (identity) try {
          const cached = await loadCachedAuthorizedLore(identity)
          const rows = projectCachedPlayerLore(cached)
          setOfflineCachedAt(Math.max(0, ...cached.map(entry => entry.cachedAt ?? 0)) || null)
          setArticles(rows); onArticlesChange?.(rows)
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Cached Lore could not be loaded') }
      }
      setLoading(false); return
    }
    setLoading(true)
    try {
      const result = await listLore(role); setArticles(result); onArticlesChange?.(result); setOfflineCachedAt(null); setError('')
      if (role === 'player') {
        const host = import.meta.env.VITE_POTOMAC_HOST?.replace(/\/$/, '')
        const identity = host ? loadRememberedIdentity(host) : null
        if (identity) {
          const cachedAt = Date.now()
          const entries = await Promise.all(result.map(async article => {
            const detail = await getLoreLinks(role, article.id)
            return { id: article.id, revision: article.revision, article: article as unknown as Record<string, unknown>, links: [...detail.links, ...detail.backlinks] as unknown as Array<Record<string, unknown>>, cachedAt }
          }))
          await cacheAuthorizedLore(identity, entries)
        }
      }
    }
    catch (cause) {
      if (cause instanceof HostRequestError && (cause.status === 401 || cause.status === 403)) {
        setArticles([]); onArticlesChange?.([]); setSelectedId(''); setLinks([]); setBacklinks([]); setAssets([])
        setError('Lore access changed on the host. Cached articles are hidden until an authorized connection is restored.')
      } else setError(cause instanceof Error ? cause.message : 'Lore could not be loaded')
    }
    finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [role, connection])
  // The parent live snapshot must not overwrite offline cached articles with
  // an empty list while the host is unavailable.
  useEffect(() => {
    if (connection !== 'connected') return
    setArticles(current => initialArticles.map(article => {
      if (role !== 'gm') return article // Player projections are always host-authorized
      const previous = current.find(item => item.id === article.id)
      return previous && previous.revision > article.revision ? previous : article
    }))
  }, [initialArticles, connection, role])
  useEffect(() => { if (targetId) setSelectedId(targetId) }, [targetId])
  useEffect(() => {
    let cancelled = false
    if (!selected || connection !== 'connected') { setLinks([]); setBacklinks([]); setAssets([]); return }
    void Promise.all([getLoreLinks(role, selected.id), listLoreAssets(role, selected.id)]).then(([relationData, assetData]) => {
      if (!cancelled) { setLinks(relationData.links); setBacklinks(relationData.backlinks); setAssets(assetData) }
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Lore details could not be loaded') })
    return () => { cancelled = true }
  }, [selectedId, connection, role, articles])

  const visible = useMemo(() => filterLore(articles, query, kind, tag, showArchived), [articles, query, kind, tag, showArchived])
  const selected = articles.find(item => item.id === selectedId)
  useEffect(() => {
    // A deep-linked target can arrive before the offline Lore projection has
    // finished loading. Do not discard it against the temporary empty list.
    if (!loading && selectedId && !visible.some(item => item.id === selectedId)) setSelectedId('')
  }, [selectedId, visible, loading])

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
      // Persist the article first: publishing is a distinct, audited host
      // operation. A failed publication must never be represented as shared.
      const next = [...articles.filter(item => item.id !== saved.id), saved]
      setArticles(next); onArticlesChange?.(next)
      setSelectedId(saved.id); setEditing(false)
      if (saved.visibility !== input.visibility) {
        const published = await setLorePublication(saved.id, saved.revision, input.visibility === 'shared')
        const next = articles.map(item => item.id === saved.id ? { ...item, ...published } : item)
        setArticles(next); onArticlesChange?.(next)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Lore could not be saved') }
    finally { setBusy(false) }
  }
  const archive = async () => {
    if (!selected || !canEdit) return
    setBusy(true); setError('')
    try { const latest = await readLore('gm', selected.id); const saved = await setLoreArchived(selected.id, latest.article.revision, !selected.archived); const next = articles.map(item => item.id === saved.id ? { ...item, ...saved } : item); setArticles(next); onArticlesChange?.(next); setSelectedId('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Lore archive state could not be changed') }
    finally { setBusy(false) }
  }
  const changePublication = async () => {
    if (!selected || !canEdit || selected.archived) return
    setBusy(true); setError('')
    try {
      // Link/create operations can advance a revision before an SSE-driven list
      // catches up. Resolve the current GM-authorized revision at click time.
      const latest = await readLore('gm', selected.id)
      const publication = await setLorePublication(selected.id, latest.article.revision, selected.visibility !== 'shared')
      const next = articles.map(item => item.id === selected.id ? { ...item, ...publication } : item)
      setArticles(next); onArticlesChange?.(next)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change article sharing') }
    finally { setBusy(false) }
  }
  const linkLore = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected || !canEdit) return
    const formData = new FormData(event.currentTarget)
    try {
      const latest = await readLore('gm', selected.id)
      await addLoreLink(selected.id, latest.article.revision, linkTargetKind, String(formData.get('targetId') || ''))
      await reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Lore relationship could not be added') }
  }
  const unlinkLore = async (link: LoreLink) => {
    if (!selected || !canEdit) return
    try { const latest = await readLore('gm', selected.id); await removeLoreLink(selected.id, link.id, latest.article.revision); await reload() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Lore relationship could not be removed') }
  }
  const removeAsset = async (asset: LoreAsset) => {
    if (!selected || !canEdit || !window.confirm(`Remove attachment “${asset.name}” from this article?`)) return
    setBusy(true); setError('')
    try {
      await removeLoreAsset(asset.id)
      setAssets(current => current.filter(item => item.id !== asset.id))
      setPreviews(current => { const next = { ...current }; delete next[asset.id]; return next })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Attachment could not be removed') }
    finally { setBusy(false) }
  }
  const previewAsset = async (asset: LoreAsset) => {
    try {
      const blob = await fetchLoreAsset(role, asset.id)
      if (!['image/png','image/jpeg','image/gif','image/webp'].includes(blob.type)) throw new Error('Image preview is unavailable for this file type')
      const url = URL.createObjectURL(blob)
      previewUrls.current.push(url)
      setPreviews(current => ({ ...current, [asset.id]: url }))
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Attachment preview failed') }
  }
  const attachFile = async (file?: File) => {
    if (!selected || !canEdit || !file) return
    const invalid = validateLoreImage(file)
    if (invalid) { setError(invalid); return }
    try { const asset = await uploadLoreAsset(selected.id, file); setAssets(current => [...current, asset]); setError(''); await previewAsset(asset) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Attachment upload failed') }
  }
  const openAsset = async (asset: LoreAsset, download = false) => {
    try {
      const blob = await fetchLoreAsset(role, asset.id)
      const url = URL.createObjectURL(blob)
      if (download) { const anchor = document.createElement('a'); anchor.href = url; anchor.download = asset.name; anchor.click() }
      else window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Attachment could not be opened') }
  }

  return <main className="lore-page">
      <div className="page-intro"><div><p className="eyebrow">APPLICATION / LORE</p><h1>Lore &amp; handouts</h1><p>Browse campaign articles by type and tag. The host filters content by visibility.</p></div><div>{onBackToMap && <button type="button" onClick={onBackToMap}>Back to map</button>}{canEdit && <button className="primary" onClick={() => { setSelectedId(''); startEdit() }}>New article</button>}</div></div>
      {role === 'gm' && preparation.onReturn && <button type="button" onClick={preparation.onReturn}>Return to encounter preparation</button>}
    {connection === 'disconnected' && <p role="status" className="capability-note">Host disconnected. Previously authorized Lore is read-only and stale{offlineCachedAt ? ` (last synchronized ${new Date(offlineCachedAt).toLocaleString()})` : ' (sync date unavailable)'}. Previously downloaded data may remain on this device after access is revoked.</p>}
    {!hostAvailable && <p role="status" className="capability-note">Lore requires a configured host; local preview has no Lore storage.</p>}
    {error && <p role="alert" className="error-banner">{error}{/revision|conflict|stale/i.test(error) ? ' Reload the latest article before editing again.' : ''}<button onClick={() => void reload()}>Retry</button></p>}
    <div className="lore-layout"><aside className="lore-browser"><label>Search<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Title, tags, or text" /></label>{role === 'gm' && <label>Type<select value={kind} onChange={event => setKind(event.target.value as LoreKind | 'all')}><option value="all">All types</option>{LORE_KINDS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>}{role === 'gm' && <label>Tag<input value={tag} onChange={event => setTag(event.target.value)} placeholder="Any tag" /></label>}{role === 'gm' && <label className="lore-check"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} /> Show archived</label>}
      <nav aria-label="Lore articles" className="lore-list">{loading ? <p role="status">Loading Lore…</p> : visible.length ? visible.map(item => <button key={item.id} className={item.id === selectedId ? 'active' : ''} onClick={() => { setSelectedId(item.id); setEditing(false) }}><strong>{item.title}</strong><small>{role === 'gm' ? `${item.kind} · ${item.tags.join(', ') || 'No tags'} · ${item.visibility}` : 'Shared article'}</small></button>) : <p>{connection !== 'connected' ? 'Connect to the host to browse Lore.' : 'No matching Lore articles.'}</p>}</nav>
    </aside><section className="lore-detail" aria-label="Lore detail">
      {editing && canEdit ? <form className="schema-form" onSubmit={event => void save(event)}><h2>{selected ? 'Edit article' : 'New article'}</h2><label>Title<input required maxLength={160} value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} /></label><label>Type<select value={form.kind} onChange={event => setForm(current => ({ ...current, kind: event.target.value as LoreKind }))}>{LORE_KINDS.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Tags, separated by commas<input value={form.tags.join(', ')} onChange={event => setForm(current => ({ ...current, tags: event.target.value.split(',') }))} /></label><label>Visibility<select value={form.visibility} onChange={event => setForm(current => ({ ...current, visibility: event.target.value as LoreInput['visibility'] }))}><option value="gm">GM only</option><option value="shared">Shared with authorized players</option></select></label><div className="lore-editor-toolbar"><strong>Markdown body</strong><button type="button" aria-pressed={preview} onClick={() => setPreview(value => !value)}>{preview ? 'Edit text' : 'Preview safely'}</button></div>{preview ? <div className="lore-markdown" aria-label="Safe Markdown preview">{safeLorePreview(form.body)}</div> : <label className="lore-body">Article body<textarea maxLength={50000} value={form.body} onChange={event => setForm(current => ({ ...current, body: event.target.value }))} /></label>}{role === 'gm' && <label>GM notes<textarea maxLength={8000} value={form.gmNotes || ''} onChange={event => setForm(current => ({ ...current, gmNotes: event.target.value }))} /></label>}<div><button className="primary" disabled={busy || !canEdit}>Save on host</button><button type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button></div></form> : selected ? <article className="lore-article"><p className="eyebrow">{selected.kind} · {selected.visibility}{selected.archived ? ' · archived' : ''}</p><h2>{selected.title}</h2><p className="lore-tags">{selected.tags.map(item => <span key={item}>{item}</span>)}</p><div className="lore-markdown">{safeLorePreview(selected.body)}</div>{role === 'gm' && selected.gmNotes && <aside className="gm-note"><b>GM notes</b><div>{selected.gmNotes}</div></aside>}<section className="lore-relations"><h3>Relationships</h3>{links.map(link => <p key={link.id}><button type="button" onClick={() => link.targetKind === 'lore' ? setSelectedId(link.targetId) : onOpenTarget?.(link.targetKind, link.targetId)}>{link.targetTitle || link.targetId} · {link.targetKind}</button>{link.label && ` · ${link.label}`}{canEdit && <button type="button" onClick={() => void unlinkLore(link)}>Remove</button>}</p>)}{backlinks.map(link => <p key={link.id}>Backlink: <button type="button" onClick={() => setSelectedId(link.sourceId)}>{link.sourceTitle}</button>{link.label && ` · ${link.label}`}</p>)}{canEdit && <form onSubmit={event => void linkLore(event)}><label>Link target type<select aria-label="Link target type" value={linkTargetKind} onChange={event => setLinkTargetKind(event.target.value as LoreTargetKind)}><option value="lore">Lore article</option><option value="actor">Character</option><option value="encounter">Encounter</option></select></label><label>Related record<select key={linkTargetKind} name="targetId" required defaultValue=""><option value="" disabled>Choose a record</option>{(linkTargetKind === 'lore'
      ? articles.filter(article => article.id !== selected.id && !article.archived).map(article => ({ id: article.id, title: article.title }))
      : linkTargetKind === 'actor' ? availableActors.map(actor => ({ id: actor.entityId, title: actor.name }))
      : availableEncounters.map(encounter => ({ id: encounter.id, title: encounter.name })))
      .filter(item => !links.some(link => link.targetKind === linkTargetKind && link.targetId === item.id))
      .map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><button disabled={busy}>Add relationship</button></form>}</section><section className="lore-assets"><h3>Attachments</h3>{assets.map(asset => <div key={asset.id} className="lore-asset"><p><button type="button" onClick={() => void openAsset(asset)}>{asset.name}</button> · {(asset.byteSize / 1024).toFixed(1)} KiB · {asset.mediaType}</p><button type="button" onClick={() => void previewAsset(asset)}>Preview image</button>{canEdit && <button type="button" disabled={busy} onClick={() => void removeAsset(asset)}>Remove attachment</button>}{previews[asset.id] && <img src={previews[asset.id]} alt={asset.name} className="lore-asset-preview" />}</div>)}{canEdit && <label>Upload image attachment<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={event => void attachFile(event.currentTarget.files?.[0])} /></label>}</section><small>Revision {selected.revision}{selected.updatedAt ? ` · Updated ${selected.updatedAt}` : ''}</small>{canEdit && <div className="action-grid">{!selected.archived && <button disabled={busy} onClick={() => startEdit(selected)}>Edit</button>}{!selected.archived && <button disabled={busy} onClick={() => void changePublication()}>{selected.visibility === 'shared' ? 'Revoke from players' : 'Publish to players'}</button>}<button disabled={busy} onClick={() => void archive()}>{selected.archived ? 'Restore' : 'Archive'}</button></div>}</article> : <p className="brick-message">{loading ? 'Loading Lore…' : 'Select an article to read.'}</p>}
      {selected && assets.length > 0 && <section className="lore-assets" aria-label="Download attachments">{assets.map(asset => <button type="button" key={`download-${asset.id}`} onClick={() => void openAsset(asset, true)}>Download {asset.name}</button>)}</section>}
    </section></div>
  </main>
}
