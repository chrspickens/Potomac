import { useEffect, useRef, useState } from 'react'
import { createEntity, fetchEntityImage, listEntities, removeEntityImage, updateEntity, uploadEntityImage, type EntityKind, type EntityRecord } from './api'

export function EntitiesApp({ isGm, hostAvailable }: { isGm: boolean; hostAvailable: boolean }) {
  const [entities, setEntities] = useState<EntityRecord[]>([])
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<EntityKind>('creature')
  const [image, setImage] = useState<File | null>(null)
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null)
  const [editingRevision, setEditingRevision] = useState(0)
  const [editingName, setEditingName] = useState('')
  const [editingKind, setEditingKind] = useState<EntityKind>('creature')
  const [editingImage, setEditingImage] = useState<File | null>(null)
  const [removeImage, setRemoveImage] = useState(false)
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const searchRequest = useRef(0)
  const editDialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (editingEntityId && editDialogRef.current && !editDialogRef.current.open) editDialogRef.current.showModal()
  }, [editingEntityId])

  const refresh = async (search = query) => {
    const request = ++searchRequest.current
    try {
      const results = await listEntities(search)
      if (request === searchRequest.current) { setEntities(results); setMessage('') }
    } catch (error) {
      if (request === searchRequest.current) setMessage(error instanceof Error ? error.message : 'Could not load entities.')
    }
  }

  useEffect(() => {
    if (!isGm || !hostAvailable) return
    const timer = window.setTimeout(() => { void refresh(query) }, 180)
    return () => { window.clearTimeout(timer); searchRequest.current += 1 }
  }, [query, isGm, hostAvailable])

  useEffect(() => {
    let cancelled = false
    const urls: Record<string, string> = {}
    void Promise.all(entities.filter(entity => entity.image).map(async entity => {
      try { urls[entity.id] = URL.createObjectURL(await fetchEntityImage(entity.id)) } catch { /* The list remains useful if a preview is unavailable. */ }
    })).then(() => { if (!cancelled) setImageUrls(urls); else Object.values(urls).forEach(URL.revokeObjectURL) })
    return () => { cancelled = true; Object.values(urls).forEach(URL.revokeObjectURL) }
  }, [entities])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true); setMessage('')
    try {
      const saved = await createEntity(name.trim(), kind)
      let entity = saved
      if (image) {
        try { entity = await uploadEntityImage(saved, image) }
        catch (error) {
          setName(''); setImage(null)
          const fileInput = document.getElementById('entity-image') as HTMLInputElement | null
          if (fileInput) fileInput.value = ''
          setEntities(current => [saved, ...current.filter(item => item.id !== saved.id)].sort((left, right) => left.name.localeCompare(right.name)))
          setQuery(''); await refresh('')
          setMessage(`${saved.name} was saved, but the image could not be attached: ${error instanceof Error ? error.message : 'image upload failed'}`)
          return
        }
      }
      setName(''); setImage(null)
      setKind('creature')
      const fileInput = document.getElementById('entity-image') as HTMLInputElement | null
      if (fileInput) fileInput.value = ''
      setEntities(current => [entity, ...current.filter(item => item.id !== entity.id)].sort((left, right) => left.name.localeCompare(right.name)))
      setQuery('')
      await refresh('')
      setMessage(`${entity.name} saved.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save entity.') }
    finally { setBusy(false) }
  }

  const beginEdit = (entity: EntityRecord) => {
    setEditingEntityId(entity.id); setEditingRevision(entity.revision); setEditingName(entity.name); setEditingKind(entity.kind)
    setEditingImage(null); setRemoveImage(false); setMessage('')
  }
  const clearEdit = () => {
    setEditingEntityId(null); setEditingImage(null); setRemoveImage(false); setMessage('')
  }
  const cancelEdit = () => {
    if (editDialogRef.current?.open) editDialogRef.current.close()
    clearEdit()
  }
  const saveEdit = async (event: React.FormEvent<HTMLFormElement>, entity: EntityRecord) => {
    event.preventDefault()
    setBusy(true); setMessage('')
    let updated: EntityRecord | null = null
    try {
      updated = await updateEntity({ ...entity, revision: editingRevision }, editingName.trim(), editingKind)
      setEditingRevision(updated.revision)
      setEntities(current => current.map(item => item.id === updated!.id ? updated! : item).sort((left, right) => left.name.localeCompare(right.name)))
      if (editingImage) updated = await uploadEntityImage(updated, editingImage)
      else if (removeImage && entity.image) updated = await removeEntityImage(updated)
      setEntities(current => current.map(item => item.id === updated!.id ? updated! : item).sort((left, right) => left.name.localeCompare(right.name)))
      if (editDialogRef.current?.open) editDialogRef.current.close()
      setEditingEntityId(null); setEditingImage(null); setRemoveImage(false)
      setQuery(''); await refresh('')
      setMessage(`${updated.name} updated.`)
    } catch (error) {
      if (updated) {
        setEditingRevision(updated.revision)
        setEntities(current => current.map(item => item.id === updated!.id ? updated! : item).sort((left, right) => left.name.localeCompare(right.name)))
        setMessage(`${updated.name} details were saved, but the image change failed: ${error instanceof Error ? error.message : 'image update failed'}`)
      } else setMessage(error instanceof Error ? error.message : 'Could not update entity.')
    } finally { setBusy(false) }
  }

  if (!isGm) return <main className="entities-page"><div className="page-intro"><div><p className="eyebrow">APPLICATION / ENTITIES</p><h1>Entities</h1><p>Entity catalog editing is currently available to the GM.</p></div></div></main>

  return <main className="entities-page">
    <div className="page-intro"><div><p className="eyebrow">APPLICATION / ENTITIES</p><h1>Entities</h1><p>Create reusable creatures and items with optional images. Creatures can be added as encounter participants.</p></div></div>
    <details className="entities-create" open>
      <summary><h2>Add an entity</h2></summary>
      <form className="entities-create-form" onSubmit={event => void submit(event)}>
      {!hostAvailable && <p role="status">Connect a configured host to create and search saved entities.</p>}
      <label htmlFor="entity-name">Name</label>
      <input id="entity-name" required maxLength={160} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Wolf" />
      <label htmlFor="entity-kind">Type</label>
      <select id="entity-kind" value={kind} onChange={event => setKind(event.target.value as EntityKind)} disabled={busy}><option value="creature">Creature</option><option value="item">Item</option></select>
      <label htmlFor="entity-image">Image <span>(optional · PNG, JPEG, GIF, or WebP; up to 5 MB)</span></label>
      <input id="entity-image" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={event => setImage(event.target.files?.[0] ?? null)} />
      <button className="primary" disabled={!hostAvailable || busy || !name.trim()}>{busy ? 'Saving…' : 'Save entity'}</button>
      </form>
    </details>
    <details className="entities-library" aria-label="Created entities" open>
      <summary><h2>Created entities</h2></summary>
      <div className="entities-search"><label htmlFor="entity-search">Search</label><input id="entity-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by name" /></div>
      {message && <p role="status">{message}</p>}
      {!entities.length ? <p className="entities-empty">{query ? 'No matching entities.' : 'No entities yet. Add one above to start your catalog.'}</p> : <ul className="entities-list">{entities.map(entity => <li key={entity.id}>
        {imageUrls[entity.id] ? <img src={imageUrls[entity.id]} alt="" /> : <span className="entities-image-placeholder" aria-hidden="true">◇</span>}
        <strong>{entity.name}</strong>
        <small>{entity.kind === 'creature' ? 'Creature' : 'Item'}</small>
        {entity.image && <small>{entity.image.name}</small>}
        {editingEntityId === entity.id ? <dialog ref={editDialogRef} className="entities-edit-dialog" aria-labelledby={`entity-edit-title-${entity.id}`} onClose={() => { if (editingEntityId === entity.id) clearEdit() }}>
          <form className="entities-edit" aria-label={`Edit ${entity.name}`} onSubmit={event => void saveEdit(event, entity)}>
            <h2 id={`entity-edit-title-${entity.id}`}>Edit entity</h2>
            <p>Update {entity.name} and its image.</p>
            <label htmlFor={`entity-edit-name-${entity.id}`}>Name</label>
            <input id={`entity-edit-name-${entity.id}`} required maxLength={160} value={editingName} onChange={event => setEditingName(event.target.value)} />
            <label htmlFor={`entity-edit-kind-${entity.id}`}>Type</label>
            <select id={`entity-edit-kind-${entity.id}`} value={editingKind} onChange={event => setEditingKind(event.target.value as EntityKind)}><option value="creature">Creature</option><option value="item">Item</option></select>
            <label htmlFor={`entity-edit-image-${entity.id}`}>Replace image <span>(optional)</span></label>
            <input id={`entity-edit-image-${entity.id}`} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={event => { setEditingImage(event.target.files?.[0] ?? null); setRemoveImage(false) }} />
            {entity.image && <label className="entities-remove-image"><input type="checkbox" checked={removeImage} disabled={Boolean(editingImage)} onChange={event => setRemoveImage(event.target.checked)} /> Remove current image</label>}
            <div className="entities-edit-actions"><button type="submit" disabled={!hostAvailable || busy || !editingName.trim()}>{busy ? 'Saving…' : 'Save changes'}</button><button type="button" disabled={busy} onClick={cancelEdit}>Cancel</button></div>
          </form>
        </dialog> : <button type="button" aria-label={`Edit ${entity.name}`} disabled={!hostAvailable || busy} onClick={() => beginEdit(entity)}>Edit</button>}
      </li>)}</ul>}
    </details>
  </main>
}
