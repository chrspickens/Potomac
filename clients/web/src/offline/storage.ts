import type { OfflineOperation, OfflineReceipt } from '@potomac/contracts';
import type { MapSceneView } from '../api.ts';
export type { OfflineOperation, OfflineReceipt } from '@potomac/contracts';

export type OfflineScope = {
  host: string;
  campaignId: string;
  memberId: string;
};

export type AuthorizedSnapshot<TData = unknown> = {
  entityId: string;
  revision: number;
  moduleId: string;
  moduleVersion: string;
  schemaVersion: number;
  data: TData;
};

export type OfflineSessionMetadata = {
  cursor: number;
  session?: { revision: number; current: { id: string; status: 'active' | 'paused' | 'finished'; revision: number; startedAt: string; updatedAt: string; finishedAt: string | null } | null; history: Array<{ id: string; status: 'active' | 'paused' | 'finished'; revision: number; startedAt: string; updatedAt: string; finishedAt: string | null }> };
  lastSyncedAt: number;
  activeEncounter: { id: string; name: string; summary: string } | null;
  encounters: Array<{ id: string; name: string; summary: string }>;
};

export type PrivateDraft = {
  draftId: string;
  entityId?: string;
  payload: unknown;
  updatedAt?: number;
};

export type QueuedOperation = {
  operation: OfflineOperation;
  state: 'queued' | 'submitting' | OfflineReceipt['status'];
  receipt?: OfflineReceipt;
  lastError?: 'transport';
  createdAt: number;
  firstSubmittedAt?: number;
  updatedAt: number;
};

export class OfflineStorageCorruptionError extends Error {
  readonly storeName: string;
  readonly count: number;

  constructor(storeName: string, count: number) {
    super(`Offline ${storeName} contains ${count} invalid record${count === 1 ? '' : 's'}; data was preserved`);
    this.name = 'OfflineStorageCorruptionError';
    this.storeName = storeName;
    this.count = count;
  }
}

const DATABASE_NAME = 'potomac-offline';
const DATABASE_VERSION = 4;
const SNAPSHOTS = 'authorizedSnapshots';
const OPERATIONS = 'queuedOperations';
const DRAFTS = 'privateDrafts';
const METADATA = 'sessionMetadata';
const LORE = 'authorizedLore';
const MAPS = 'authorizedMaps';

type Stored<T> = T & {
  key: string;
  scopeKey: string;
  host: string;
  campaignId: string;
  memberId: string;
};

export function offlineScopeKey(scope: OfflineScope): string {
  requireText(scope.host, 'host');
  requireText(scope.campaignId, 'campaignId');
  requireText(scope.memberId, 'memberId');
  return JSON.stringify([scope.host, scope.campaignId, scope.memberId]);
}

export function nextOperationState(
  current: QueuedOperation['state'],
  next: QueuedOperation['state'],
): boolean {
  if (current === next) return true;
  if (current === 'queued') return next === 'submitting' || isReceiptState(next);
  if (current === 'submitting') return next === 'queued' || isReceiptState(next);
  if (current === 'awaitingReview') return next === 'applied' || next === 'rejected' || next === 'conflicted';
  return false;
}

export type OfflineStorage = {
  close(): void;
  clearScope(): Promise<void>;
  putSessionMetadata(metadata: OfflineSessionMetadata): Promise<void>;
  getSessionMetadata(): Promise<OfflineSessionMetadata | undefined>;
  putAuthorizedSnapshot(snapshot: AuthorizedSnapshot): Promise<void>;
  replaceAuthorizedSnapshots(snapshots: AuthorizedSnapshot[]): Promise<void>;
  getAuthorizedSnapshot(entityId: string): Promise<AuthorizedSnapshot | undefined>;
  listAuthorizedSnapshots(): Promise<AuthorizedSnapshot[]>;
  enqueueOperation(operation: OfflineOperation): Promise<QueuedOperation>;
  listOperations(): Promise<QueuedOperation[]>;
  markSubmitting(operationId: string): Promise<QueuedOperation>;
  retryOperation(operationId: string): Promise<QueuedOperation>;
  markRetryableFailure(operationId: string): Promise<QueuedOperation>;
  /** Delete only an operation that has never entered submitting state. */
  cancelUnsentOperation(operationId: string): Promise<void>;
  recordReceipt(receipt: OfflineReceipt): Promise<QueuedOperation>;
  deleteLocalOutcome(operationId: string): Promise<void>;
  savePrivateDraft(draft: PrivateDraft): Promise<PrivateDraft>;
  listPrivateDrafts(): Promise<PrivateDraft[]>;
  deletePrivateDraft(draftId: string): Promise<void>;
  replaceAuthorizedLore(entries: AuthorizedLoreEntry[]): Promise<void>;
  listAuthorizedLore(): Promise<AuthorizedLoreEntry[]>;
  replaceAuthorizedMaps(scenes: MapSceneView[]): Promise<void>;
  listAuthorizedMaps(): Promise<MapSceneView[]>;
  replaceAuthorizedMapCache(entries: CachedMapScene[]): Promise<void>;
  listAuthorizedMapCache(): Promise<CachedMapScene[]>;
};

export type CachedMapScene = { scene: MapSceneView; cachedAt: number; background?: Blob };
export const MAP_CACHE_MAX_SCENES = 20;
export const MAP_CACHE_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type AuthorizedLoreEntry = { id: string; revision: number; article: Record<string, unknown>; links: Array<Record<string, unknown>>; cachedAt?: number };

/** Opens storage scoped to one host, campaign, and member. Never put credentials in a draft payload. */
export function openOfflineStorage(
  scope: OfflineScope,
  factory: IDBFactory = globalThis.indexedDB,
): Promise<OfflineStorage> {
  const scopedKey = offlineScopeKey(scope);
  if (!factory) return Promise.reject(new Error('IndexedDB is unavailable'));

  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const transaction = request.transaction!;
      for (const storeName of [SNAPSHOTS, OPERATIONS, DRAFTS, METADATA, LORE, MAPS]) {
        const store = db.objectStoreNames.contains(storeName)
          ? transaction.objectStore(storeName)
          : db.createObjectStore(storeName, { keyPath: 'key' });
        if (!store.indexNames.contains('scopeKey')) store.createIndex('scopeKey', 'scopeKey');
      }
      if (event.oldVersion < 3 && db.objectStoreNames.contains(OPERATIONS)) {
        const store = transaction.objectStore(OPERATIONS);
        const existing = store.getAll();
        existing.onsuccess = () => {
          for (const row of existing.result) {
            if (isRecord(row) && !Number.isFinite(row.createdAt) && Number.isFinite(row.updatedAt)) {
              store.put({
                ...row,
                createdAt: row.updatedAt,
                ...(row.state === 'submitting' && !Number.isFinite(row.firstSubmittedAt) ? { firstSubmittedAt: row.updatedAt } : {}),
              });
            } else if (isRecord(row) && row.state === 'submitting' && !Number.isFinite(row.firstSubmittedAt) && Number.isFinite(row.updatedAt)) {
              store.put({ ...row, firstSubmittedAt: row.updatedAt });
            }
          }
        };
      }
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open offline storage'));
    request.onblocked = () => reject(new Error('Offline storage upgrade is blocked by another tab'));
    request.onsuccess = () => resolve(createStorage(request.result, scope, scopedKey));
  });
}

function createStorage(db: IDBDatabase, scope: OfflineScope, scopedKey: string): OfflineStorage {
  const scoped = <T extends object>(value: T, id: string): Stored<T> => ({
    ...value,
    key: JSON.stringify([scopedKey, id]),
    scopeKey: scopedKey,
    host: scope.host,
    campaignId: scope.campaignId,
    memberId: scope.memberId,
  });

  return {
    close: () => db.close(),

    async clearScope() {
      const tx = db.transaction([SNAPSHOTS, OPERATIONS, DRAFTS, METADATA, LORE, MAPS], 'readwrite');
      for (const storeName of [SNAPSHOTS, OPERATIONS, DRAFTS, METADATA, LORE, MAPS]) {
        const store = tx.objectStore(storeName);
        const request = store.index('scopeKey').getAllKeys(scopedKey);
        request.onsuccess = () => { for (const key of request.result) store.delete(key); };
      }
      await transactionResult(tx);
    },

    async putSessionMetadata(metadata) {
      if (!isSessionMetadata(metadata)) throw new Error('Invalid offline session metadata');
      const tx = db.transaction(METADATA, 'readwrite');
      const store = tx.objectStore(METADATA);
      let corrupt = false;
      const request = store.get(JSON.stringify([scopedKey, 'session']));
      request.onsuccess = () => {
        if (request.result && !isSessionMetadataRecord(request.result, scope)) {
          corrupt = true;
          tx.abort();
          return;
        }
        const previous = request.result as Stored<{ metadata: OfflineSessionMetadata }> | undefined;
        if (previous && !isSessionMetadata(previous.metadata)) {
          corrupt = true;
          tx.abort();
          return;
        }
        if (previous && !canReplaceSessionMetadata(metadata, previous.metadata)) return;
        store.put(scoped({ metadata: structuredClone(metadata) }, 'session'));
      };
      try { await transactionResult(tx) } catch (error) {
        if (corrupt) throw new OfflineStorageCorruptionError(METADATA, 1);
        throw error;
      }
    },

    async getSessionMetadata() {
      const tx = db.transaction(METADATA, 'readonly');
      const result = await requestResult(tx.objectStore(METADATA).get(JSON.stringify([scopedKey, 'session'])));
      await transactionResult(tx);
      const row = result as Stored<{ metadata: OfflineSessionMetadata }> | undefined;
      if (!row) return undefined;
      if (!isSessionMetadataRecord(row, scope) || !isSessionMetadata(row.metadata)) {
        throw new OfflineStorageCorruptionError(METADATA, 1);
      }
      return row.metadata;
    },

    async putAuthorizedSnapshot(snapshot) {
      validateSnapshot(snapshot);
      const key = JSON.stringify([scopedKey, snapshot.entityId]);
      const tx = db.transaction(SNAPSHOTS, 'readwrite');
      const store = tx.objectStore(SNAPSHOTS);
      let corrupt = false;
      const request = store.get(key);
      request.onsuccess = () => {
        const old = request.result as Stored<{ snapshot: AuthorizedSnapshot }> | undefined;
        if (old && !isSnapshotRecord(old, scope)) {
          corrupt = true;
          tx.abort();
          return;
        }
        if (old && old.snapshot.revision > snapshot.revision) return;
        if (old && old.snapshot.revision === snapshot.revision && !sameJson(old.snapshot, snapshot)) {
          tx.abort();
          return;
        }
        store.put(scoped({ snapshot }, snapshot.entityId));
      };
      try { await transactionResult(tx) } catch (error) {
        if (corrupt) throw new OfflineStorageCorruptionError(SNAPSHOTS, 1);
        throw error;
      }
    },

    async replaceAuthorizedSnapshots(snapshots) {
      for (const snapshot of snapshots) validateSnapshot(snapshot);
      const ids = new Set(snapshots.map(snapshot => snapshot.entityId));
      if (ids.size !== snapshots.length) throw new Error('Duplicate authorized snapshot ID');
      const tx = db.transaction(SNAPSHOTS, 'readwrite');
      const store = tx.objectStore(SNAPSHOTS);
      let corrupt = false;
      const existing = store.index('scopeKey').getAll(scopedKey);
      existing.onsuccess = () => {
        const invalid = existing.result.filter((row) => !isSnapshotRecord(row, scope)).length;
        if (invalid) {
          corrupt = true;
          tx.abort();
          return;
        }
        for (const row of existing.result) store.delete(row.key);
        for (const snapshot of snapshots) store.put(scoped({ snapshot: structuredClone(snapshot) }, snapshot.entityId));
      };
      try { await transactionResult(tx) } catch (error) {
        if (corrupt) throw new OfflineStorageCorruptionError(SNAPSHOTS, 1);
        throw error;
      }
    },

    async getAuthorizedSnapshot(entityId) {
      requireText(entityId, 'entityId');
      const key = JSON.stringify([scopedKey, entityId]);
      const tx = db.transaction(SNAPSHOTS, 'readonly');
      const result = await requestResult(tx.objectStore(SNAPSHOTS).get(key));
      await transactionResult(tx);
      const row = result as Stored<{ snapshot: AuthorizedSnapshot }> | undefined;
      if (!row) return undefined;
      if (!isSnapshotRecord(row, scope)) throw new OfflineStorageCorruptionError(SNAPSHOTS, 1);
      return row.snapshot;
    },

    async listAuthorizedSnapshots() {
      const rows = await listScoped(db, SNAPSHOTS, scopedKey) as Array<Stored<{ snapshot: AuthorizedSnapshot }>>;
      const invalid = rows.filter((row) => !isSnapshotRecord(row, scope)).length;
      if (invalid) throw new OfflineStorageCorruptionError(SNAPSHOTS, invalid);
      return rows.map((row) => row.snapshot);
    },

    async enqueueOperation(operation) {
      validateOperation(operation, scope);
      const key = JSON.stringify([scopedKey, operation.operationId]);
      const tx = db.transaction(OPERATIONS, 'readwrite');
      const store = tx.objectStore(OPERATIONS);
      let result: QueuedOperation | undefined;
      let collision = false;
      let corrupt = false;
      const request = store.get(key);
      request.onsuccess = () => {
        const existing = request.result as Stored<QueuedOperation> | undefined;
        if (existing) {
          if (!isQueuedOperation(existing, scope, scopedKey)) {
            corrupt = true;
            tx.abort();
          } else if (!sameJson(existing.operation, operation)) {
            collision = true;
            tx.abort();
          } else result = existing;
          return;
        }
        const now = Date.now();
        result = { operation: structuredClone(operation), state: 'queued', createdAt: now, updatedAt: now };
        store.put(scoped(result, operation.operationId));
      };
      try { await transactionResult(tx) } catch (error) {
        if (corrupt) throw new OfflineStorageCorruptionError(OPERATIONS, 1);
        if (collision) throw new Error('Operation ID already exists with different content');
        throw error;
      }
      if (collision) throw new Error('Operation ID already exists with different content');
      return result!;
    },

    async listOperations() {
      const rows = await listScoped(db, OPERATIONS, scopedKey) as Array<Stored<QueuedOperation>>;
      const invalid = rows.filter((row) => !isQueuedOperation(row, scope, scopedKey)).length;
      if (invalid) throw new OfflineStorageCorruptionError(OPERATIONS, invalid);
      return rows.map((row) => ({
        operation: row.operation,
        state: row.state,
        ...(row.receipt ? { receipt: row.receipt } : {}),
        ...(row.lastError ? { lastError: row.lastError } : {}),
        createdAt: row.createdAt,
        ...(row.firstSubmittedAt !== undefined ? { firstSubmittedAt: row.firstSubmittedAt } : {}),
        updatedAt: row.updatedAt,
      }));
    },

    markSubmitting: (operationId) => updateOperation(db, scope, scopedKey, operationId, (row) => {
      transition(row, 'submitting');
      row.firstSubmittedAt ??= Date.now();
      row.lastError = undefined;
    }),

    retryOperation: (operationId) => updateOperation(db, scope, scopedKey, operationId, (row) => {
      transition(row, 'queued');
      row.lastError = undefined;
    }),

    markRetryableFailure: (operationId) => updateOperation(db, scope, scopedKey, operationId, (row) => {
      transition(row, 'queued');
      row.lastError = 'transport';
    }),

    async cancelUnsentOperation(operationId) {
      requireText(operationId, 'operationId');
      const tx = db.transaction(OPERATIONS, 'readwrite');
      const store = tx.objectStore(OPERATIONS);
      let failure: Error | undefined;
      const request = store.get(JSON.stringify([scopedKey, operationId]));
      request.onsuccess = () => {
        const row = request.result as Stored<QueuedOperation> | undefined;
        if (!row || !isQueuedOperation(row, scope, scopedKey)) {
          failure = new Error('Queued operation was not found or is corrupt');
          tx.abort();
        } else if (row.state !== 'queued' || row.firstSubmittedAt !== undefined) {
          failure = new Error('Only an operation with no submission attempt can be canceled');
          tx.abort();
        } else store.delete(row.key);
      };
      try { await transactionResult(tx) } catch (error) { throw failure ?? error }
    },

    recordReceipt: (receipt) => {
      validateReceipt(receipt);
      return updateOperation(db, scope, scopedKey, receipt.operationId, (row) => {
        if (receipt.entityId !== row.operation.entityId) throw new Error('Receipt entity does not match operation');
        transition(row, receipt.status);
        row.receipt = structuredClone(receipt);
      });
    },

    async deleteLocalOutcome(operationId) {
      requireText(operationId, 'operationId');
      const tx = db.transaction(OPERATIONS, 'readwrite');
      const store = tx.objectStore(OPERATIONS);
      let failure: Error | undefined;
      const request = store.get(JSON.stringify([scopedKey, operationId]));
      request.onsuccess = () => {
        const row = request.result as Stored<QueuedOperation> | undefined;
        if (!row || row.scopeKey !== scopedKey || !['conflicted', 'rejected'].includes(row.state)) {
          failure = new Error('Only a rejected or conflicted local copy can be discarded');
          tx.abort();
        } else store.delete(row.key);
      };
      try { await transactionResult(tx) } catch (error) { throw failure ?? error }
    },

    async savePrivateDraft(draft) {
      requireText(draft.draftId, 'draftId');
      assertJson(draft);
      const tx = db.transaction(DRAFTS, 'readwrite');
      const store = tx.objectStore(DRAFTS);
      const saved: PrivateDraft = { ...structuredClone(draft), updatedAt: Date.now() };
      let corrupt = false;
      const request = store.get(JSON.stringify([scopedKey, draft.draftId]));
      request.onsuccess = () => {
        if (request.result && !isDraftRecord(request.result, scope)) {
          corrupt = true;
          tx.abort();
          return;
        }
        store.put(scoped({ draft: saved }, draft.draftId));
      };
      try { await transactionResult(tx) } catch (error) {
        if (corrupt) throw new OfflineStorageCorruptionError(DRAFTS, 1);
        throw error;
      }
      return saved;
    },

    async listPrivateDrafts() {
      const rows = await listScoped(db, DRAFTS, scopedKey) as Array<Stored<{ draft: PrivateDraft }>>;
      const invalid = rows.filter((row) => !isDraftRecord(row, scope)).length;
      if (invalid) throw new OfflineStorageCorruptionError(DRAFTS, invalid);
      return rows.map((row) => row.draft);
    },

    async deletePrivateDraft(draftId) {
      requireText(draftId, 'draftId');
      const tx = db.transaction(DRAFTS, 'readwrite');
      tx.objectStore(DRAFTS).delete(JSON.stringify([scopedKey, draftId]));
      await transactionResult(tx);
    },

    async replaceAuthorizedLore(entries) {
      for (const entry of entries) validateLoreEntry(entry);
      if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('Duplicate authorized Lore ID');
      const tx = db.transaction(LORE, 'readwrite');
      const store = tx.objectStore(LORE);
      const existing = store.index('scopeKey').getAllKeys(scopedKey);
      existing.onsuccess = () => {
        for (const key of existing.result) store.delete(key);
        for (const entry of entries) store.put(scoped({ entry: structuredClone(entry) }, entry.id));
      };
      await transactionResult(tx);
    },

    async listAuthorizedLore() {
      const rows = await listScoped(db, LORE, scopedKey) as Array<Stored<{ entry: AuthorizedLoreEntry }>>;
      for (const row of rows) if (!isLoreRecord(row, scope)) throw new OfflineStorageCorruptionError(LORE, 1);
      return rows.map(row => row.entry);
    },
    async replaceAuthorizedMaps(scenes) {
      return this.replaceAuthorizedMapCache(scenes.map(scene => ({ scene, cachedAt: Date.now() })));
    },
    async replaceAuthorizedMapCache(entries) {
      validateAuthorizedMapCache(entries, scope.campaignId);
      const tx = db.transaction(MAPS, 'readwrite');
      const store = tx.objectStore(MAPS);
      const existing = store.index('scopeKey').getAllKeys(scopedKey);
      existing.onsuccess = () => {
        for (const key of existing.result) store.delete(key);
        for (const entry of entries) store.put(scoped({ scene: structuredClone(entry.scene), cachedAt: entry.cachedAt, ...(entry.background ? { background: entry.background } : {}) }, entry.scene.id));
      };
      await transactionResult(tx);
    },
    async listAuthorizedMaps() {
      return (await this.listAuthorizedMapCache()).map(entry => entry.scene);
    },
    async listAuthorizedMapCache() {
      const rows = await listScoped(db, MAPS, scopedKey) as Array<Stored<CachedMapScene>>;
      if (rows.length > MAP_CACHE_MAX_SCENES) throw new OfflineStorageCorruptionError(MAPS, rows.length);
      for (const row of rows) if (!isMapRecord(row, scope)) throw new OfflineStorageCorruptionError(MAPS, 1);
      if (rows.reduce((total, row) => total + (row.background instanceof Blob ? row.background.size : 0), 0) > MAP_CACHE_MAX_IMAGE_BYTES) throw new OfflineStorageCorruptionError(MAPS, rows.length);
      return rows.map(({ scene, cachedAt, background }) => ({ scene, cachedAt: Number.isFinite(cachedAt) ? cachedAt : 0, ...(background ? { background } : {}) }));
    },
  };
}

export function validateAuthorizedMapCache(entries: CachedMapScene[], campaignId: string): void {
  if (entries.length > MAP_CACHE_MAX_SCENES) throw new Error(`Offline map cache is limited to ${MAP_CACHE_MAX_SCENES} scenes`);
  let imageBytes = 0;
  for (const entry of entries) {
    validateMapScene(entry.scene, campaignId);
    if (!Number.isFinite(entry.cachedAt) || entry.cachedAt < 0) throw new Error('Invalid map cache timestamp');
    if (entry.background !== undefined) {
      if (!(entry.background instanceof Blob) || entry.background.size > 10 * 1024 * 1024) throw new Error('Offline map image exceeds the 10 MiB per-image cache limit');
      imageBytes += entry.background.size;
    }
  }
  if (imageBytes > MAP_CACHE_MAX_IMAGE_BYTES) throw new Error('Offline map images exceed the 20 MiB device cache limit');
  if (new Set(entries.map(entry => entry.scene.id)).size !== entries.length) throw new Error('Duplicate authorized map ID');
}

function validateMapScene(scene: MapSceneView, campaignId: string): void {
  if (!isRecord(scene) || !isNonEmptyString(scene.id) || scene.campaignId !== campaignId || !isNonEmptyString(scene.name) || !['world', 'battle'].includes(scene.kind) || !Number.isSafeInteger(scene.revision) || scene.revision < 1 || !Number.isFinite(scene.width) || scene.width < 1 || !Number.isFinite(scene.height) || scene.height < 1 || !isRecord(scene.grid) || !['none', 'square', 'hex'].includes(String(scene.grid.type)) || !Number.isFinite(scene.grid.size) || !['gm', 'shared'].includes(scene.visibility) || !Array.isArray(scene.pieces) || typeof scene.archived !== 'boolean') throw new Error('Invalid authorized map scene');
  for (const piece of scene.pieces) {
    if (!isRecord(piece) || !isNonEmptyString(piece.id) || piece.sceneId !== scene.id || !['actor', 'pin'].includes(piece.kind) || !Number.isFinite(piece.x) || !Number.isFinite(piece.y) || piece.x < 0 || piece.y < 0 || piece.x > scene.width || piece.y > scene.height || !Number.isSafeInteger(piece.revision) || piece.revision < 1) throw new Error('Invalid authorized map piece');
    if (piece.destination !== undefined) {
      const destination = piece.destination;
      const mapTarget = isRecord(destination) && Object.keys(destination).every(key => ['kind', 'sceneId', 'name', 'label'].includes(key)) && (destination.kind === 'map_scene' || destination.kind === undefined) && isNonEmptyString(destination.sceneId) && isNonEmptyString(destination.name) && typeof destination.label === 'string';
      const loreTarget = isRecord(destination) && Object.keys(destination).every(key => ['kind', 'entryId', 'title', 'label'].includes(key)) && destination.kind === 'lore_entry' && isNonEmptyString(destination.entryId) && isNonEmptyString(destination.title) && typeof destination.label === 'string';
      if (piece.kind !== 'pin' || (!mapTarget && !loreTarget)) throw new Error('Invalid authorized map destination');
    }
  }
  assertJson(scene);
}
function isMapRecord(value: unknown, scope: OfflineScope): value is Stored<CachedMapScene> {
  const scopeKey = offlineScopeKey(scope);
  if (!isRecord(value) || value.scopeKey !== scopeKey || value.host !== scope.host || value.campaignId !== scope.campaignId || value.memberId !== scope.memberId || !isRecord(value.scene)) return false;
  try { validateMapScene(value.scene as MapSceneView, scope.campaignId) } catch { return false }
  if (value.key !== JSON.stringify([scopeKey, value.scene.id]) || (value.cachedAt !== undefined && (!Number.isFinite(value.cachedAt) || Number(value.cachedAt) < 0))) return false;
  if (value.background !== undefined && (!(value.background instanceof Blob) || value.background.size > 10 * 1024 * 1024)) return false;
  return true;
}

function validateLoreEntry(entry: AuthorizedLoreEntry): void {
  if (!isRecord(entry) || !isNonEmptyString(entry.id) || !Number.isSafeInteger(entry.revision) || entry.revision < 1 || !isRecord(entry.article) || !Array.isArray(entry.links)) throw new Error('Invalid authorized Lore entry');
  if (entry.cachedAt !== undefined && (!Number.isFinite(entry.cachedAt) || entry.cachedAt < 0))
    throw new Error('Invalid authorized Lore cache timestamp');
  assertJson(entry);
}
function isLoreRecord(value: unknown, scope: OfflineScope): value is Stored<{ entry: AuthorizedLoreEntry }> {
  const scopeKey = offlineScopeKey(scope);
  if (!isRecord(value) || value.scopeKey !== scopeKey || value.host !== scope.host || value.campaignId !== scope.campaignId || value.memberId !== scope.memberId || !isRecord(value.entry)) return false;
  try { validateLoreEntry(value.entry as AuthorizedLoreEntry) } catch { return false }
  return value.key === JSON.stringify([scopeKey, value.entry.id]);
}

async function updateOperation(
  db: IDBDatabase,
  scope: OfflineScope,
  scopedKey: string,
  operationId: string,
  update: (row: QueuedOperation) => void,
): Promise<QueuedOperation> {
  requireText(operationId, 'operationId');
  const key = JSON.stringify([scopedKey, operationId]);
  const tx = db.transaction(OPERATIONS, 'readwrite');
  const store = tx.objectStore(OPERATIONS);
  let result: QueuedOperation | undefined;
  let failure: unknown;
  const request = store.get(key);
  request.onsuccess = () => {
    const stored = request.result as Stored<QueuedOperation> | undefined;
    if (!stored || !isQueuedOperation(stored, scope, scopedKey)) {
      failure = new Error('Queued operation was not found or is corrupt');
      tx.abort();
      return;
    }
    const row = structuredClone({ operation: stored.operation, state: stored.state, receipt: stored.receipt, lastError: stored.lastError, createdAt: stored.createdAt, firstSubmittedAt: stored.firstSubmittedAt, updatedAt: stored.updatedAt });
    try {
      update(row);
      row.updatedAt = Date.now();
      result = row;
      store.put({ ...stored, ...row, host: scope.host, campaignId: scope.campaignId, memberId: scope.memberId });
    } catch (error) {
      failure = error;
      tx.abort();
    }
  };
  try {
    await transactionResult(tx);
  } catch (error) {
    throw failure ?? error;
  }
  return result!;
}

function transition(row: QueuedOperation, next: QueuedOperation['state']): void {
  if (!nextOperationState(row.state, next)) throw new Error(`Invalid operation state transition: ${row.state} -> ${next}`);
  row.state = next;
}

function listScoped(db: IDBDatabase, storeName: string, scopeKey: string): Promise<unknown[]> {
  const tx = db.transaction(storeName, 'readonly');
  const request = tx.objectStore(storeName).index('scopeKey').getAll(scopeKey);
  return Promise.all([requestResult(request), transactionResult(tx)]).then(([rows]) => rows as unknown[]);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionResult(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

function validateOperation(operation: OfflineOperation, scope: OfflineScope): void {
  for (const name of ['operationId', 'campaignId', 'memberId', 'entityId', 'moduleId', 'moduleVersion', 'actionId'] as const) {
    requireText(operation[name], name);
  }
  if (operation.campaignId !== scope.campaignId || operation.memberId !== scope.memberId) throw new Error('Operation scope does not match storage scope');
  if (!Number.isSafeInteger(operation.baseRevision) || operation.baseRevision < 0) throw new Error('Invalid baseRevision');
  if (!Number.isSafeInteger(operation.schemaVersion) || operation.schemaVersion < 1) throw new Error('Invalid schemaVersion');
  if (!isRecord(operation.parameters)) throw new Error('parameters must be an object');
  if (operation.dependencies?.some((item) => !isRecord(item) || !isNonEmptyString(item.entityId) || !Number.isSafeInteger(item.revision) || item.revision < 0)) throw new Error('Invalid operation dependency');
  assertJson(operation);
}

function validateSnapshot(snapshot: AuthorizedSnapshot): void {
  if (!isSnapshot(snapshot)) throw new Error('Invalid authorized snapshot');
  assertJson(snapshot);
}

function validateReceipt(receipt: OfflineReceipt): void {
  if (!isRecord(receipt) || !isNonEmptyString(receipt.operationId) || !isNonEmptyString(receipt.entityId) || !isReceiptState(receipt.status)) throw new Error('Invalid offline receipt');
  if (receipt.revision !== undefined && (!Number.isSafeInteger(receipt.revision) || receipt.revision < 0)) throw new Error('Invalid receipt revision');
}

function isSnapshot(value: unknown): value is AuthorizedSnapshot {
  return isRecord(value) && isNonEmptyString(value.entityId) && Number.isSafeInteger(value.revision) && (value.revision as number) >= 0 && isNonEmptyString(value.moduleId) && isNonEmptyString(value.moduleVersion) && Number.isSafeInteger(value.schemaVersion) && (value.schemaVersion as number) > 0 && 'data' in value;
}

function isSnapshotRecord(value: unknown, scope: OfflineScope): value is Stored<{ snapshot: AuthorizedSnapshot }> {
  const scopeKey = offlineScopeKey(scope);
  if (!isRecord(value) || value.scopeKey !== scopeKey || value.host !== scope.host || value.campaignId !== scope.campaignId
    || value.memberId !== scope.memberId || !isSnapshot(value.snapshot)) return false;
  return value.key === JSON.stringify([scopeKey, value.snapshot.entityId]);
}

function isSessionMetadataRecord(value: unknown, scope: OfflineScope): value is Stored<{ metadata: OfflineSessionMetadata }> {
  const scopeKey = offlineScopeKey(scope);
  return isRecord(value) && value.scopeKey === scopeKey && value.host === scope.host && value.campaignId === scope.campaignId
    && value.memberId === scope.memberId && value.key === JSON.stringify([scopeKey, 'session']);
}

function isDraftRecord(value: unknown, scope: OfflineScope): value is Stored<{ draft: PrivateDraft }> {
  const scopeKey = offlineScopeKey(scope);
  if (!isRecord(value) || value.scopeKey !== scopeKey || value.host !== scope.host || value.campaignId !== scope.campaignId
    || value.memberId !== scope.memberId || !isRecord(value.draft)
    || !isNonEmptyString(value.draft.draftId) || !('payload' in value.draft)) return false;
  return value.key === JSON.stringify([scopeKey, value.draft.draftId]);
}

export function isSessionMetadata(value: unknown): value is OfflineSessionMetadata {
  if (!isRecord(value) || !Number.isSafeInteger(value.cursor) || (value.cursor as number) < 0 || !Number.isFinite(value.lastSyncedAt) || !Array.isArray(value.encounters)) return false;
  const sessionRecord = (item: unknown) => isRecord(item) && isNonEmptyString(item.id)
    && ['active', 'paused', 'finished'].includes(String(item.status))
    && Number.isSafeInteger(item.revision) && (item.revision as number) > 0
    && typeof item.startedAt === 'string' && typeof item.updatedAt === 'string'
    && (item.finishedAt === null || typeof item.finishedAt === 'string');
  if (value.session !== undefined && (!isRecord(value.session) || !Number.isSafeInteger(value.session.revision) || (value.session.revision as number) < 0
    || !Array.isArray(value.session.history) || !value.session.history.every(sessionRecord)
    || (value.session.current !== null && !sessionRecord(value.session.current)))) return false;
  const encounter = (item: unknown) => isRecord(item) && isNonEmptyString(item.id) && typeof item.name === 'string' && typeof item.summary === 'string';
  return (value.activeEncounter === null || encounter(value.activeEncounter)) && value.encounters.every(encounter);
}

/** Prevent delayed snapshot writes from moving recovery state backwards. */
export function canReplaceSessionMetadata(next: OfflineSessionMetadata, current: OfflineSessionMetadata): boolean {
  if (next.cursor < current.cursor) return false;
  const currentRevision = current.session?.revision;
  const nextRevision = next.session?.revision;
  return currentRevision === undefined || nextRevision !== undefined && nextRevision >= currentRevision;
}

function isQueuedOperation(value: unknown, scope: OfflineScope, scopeKey: string): value is Stored<QueuedOperation> {
  if (!isRecord(value) || value.scopeKey !== scopeKey || value.host !== scope.host || value.campaignId !== scope.campaignId || value.memberId !== scope.memberId
    || !isRecord(value.operation) || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)) return false;
  try { validateOperation(value.operation as OfflineOperation, scope) } catch { return false }
  if (value.key !== JSON.stringify([scopeKey, value.operation.operationId])) return false;
  if (value.lastError !== undefined && (value.lastError !== 'transport' || value.state !== 'queued')) return false;
  if (value.firstSubmittedAt !== undefined && !Number.isFinite(value.firstSubmittedAt)) return false;
  if (value.receipt !== undefined) {
    if (!isRecord(value.receipt) || !isNonEmptyString(value.receipt.operationId) || !isNonEmptyString(value.receipt.entityId) || !isReceiptState(value.receipt.status)
      || value.receipt.operationId !== value.operation.operationId || value.receipt.entityId !== value.operation.entityId || value.receipt.status !== value.state) return false;
  }
  return value.state === 'queued' || value.state === 'submitting' || isReceiptState(value.state);
}

function isReceiptState(value: unknown): value is OfflineReceipt['status'] {
  return value === 'applied' || value === 'awaitingReview' || value === 'rejected' || value === 'conflicted';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireText(value: unknown, name: string): asserts value is string {
  if (!isNonEmptyString(value)) throw new Error(`${name} must be a non-empty string`);
}

function assertJson(value: unknown): void {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error();
  } catch {
    throw new Error('Offline data must be JSON-compatible');
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
