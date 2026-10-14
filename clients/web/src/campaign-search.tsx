import { useEffect, useState } from 'react'
import { resolveCampaignNavigation, searchCampaign, type CampaignSearchResult, type Role } from './api'
import './campaign-search.css'

export function CampaignSearch({ role, connected, onOpen }: { role: Role; connected: boolean; onOpen: (result: CampaignSearchResult) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CampaignSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [open, setOpen] = useState(false)
  const [next, setNext] = useState<string | null>(null)
  useEffect(() => {
    if (!open || !connected || !query.trim()) { setResults([]); setMessage(''); setNext(null); return }
    let current = true
    const timer = window.setTimeout(() => {
      setLoading(true)
      void searchCampaign(role, query, { limit: 25 }).then(page => {
        if (current) { setResults(page.results); setNext(page.next); setMessage(page.results.length ? '' : 'No matching authorized results.') }
      }).catch(() => { if (current) { setResults([]); setMessage('Search is unavailable. Reconnect and try again.') } })
        .finally(() => { if (current) setLoading(false) })
    }, 180)
    return () => { current = false; window.clearTimeout(timer) }
  }, [open, connected, role, query])
  const loadMore = async () => {
    if (!next || loading) return
    setLoading(true)
    try { const page = await searchCampaign(role, query, { after: next, limit: 25 }); setResults(current => [...current, ...page.results]); setNext(page.next) }
    catch { setMessage('Search is unavailable. Reconnect and try again.') }
    finally { setLoading(false) }
  }
  const activate = async (result: CampaignSearchResult) => {
    if (!connected) { setMessage('Reconnect to open a current result.'); return }
    setLoading(true)
    try {
      // Recheck current authorization by stable ID immediately before handoff.
      const current = await resolveCampaignNavigation(role, result)
      setOpen(false); setQuery(''); setResults([]); onOpen(current)
    } catch { setMessage('This item is unavailable.') }
    finally { setLoading(false) }
  }
  return <div className="campaign-search">
    <label htmlFor="campaign-search-input">Search campaign</label>
    <input id="campaign-search-input" type="search" value={query} placeholder="Characters, encounters, Lore, maps" maxLength={200}
      aria-controls="campaign-search-results" aria-expanded={open} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true) }}
      onKeyDown={event => { if (event.key === 'Escape') setOpen(false); if (event.key === 'Enter' && results[0]) { event.preventDefault(); void activate(results[0]) } }} />
    {open && <section id="campaign-search-results" className="campaign-search-results" aria-label="Search results" aria-live="polite">
      {!connected ? <p>Search requires a live host connection.</p> : loading ? <p role="status">Searching…</p> : message ? <p role="status">{message}</p> : results.map(result => <button type="button" key={`${result.kind}:${result.id}`} onMouseDown={event => event.preventDefault()} onClick={() => void activate(result)}>
        <strong>{result.label}</strong><small>{result.kind}{result.status ? ` · ${result.status}` : ''}</small>
      </button>)}
      {connected && next && !loading && <button type="button" onClick={() => void loadMore()}>Load more results</button>}
    </section>}
  </div>
}
