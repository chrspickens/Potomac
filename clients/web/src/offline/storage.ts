export type OfflineScope = {
  host: string;
  campaignId: string;
  memberId: string;
};

export type OfflineOperation = {
  operationId: string;
  campaignId: string;
  memberId: string;
  entityId: string;
  baseRevision: number;
  moduleId: string;
  moduleVersion: string;
  schemaVersion: number;
  actionId: string;
  parameters: Record<string, unknown>;
  dependencies?: Array<{ entityId: string; revision: number }>;
};

export type OfflineReceipt = {
  operationId: string;
  status: 'applied' | 'awaitingReview' | 'rejected' | 'conflicted';
  entityId: string;
  revision?: number;
  proposalId?: string;
  reasonCode?: string;
};

export type AuthorizedSnapshot<TData = unknown> = {
  entityId: string;
  revision: number;
  moduleId: string;
  moduleVersion: string;
  schemaVersion: number;
  data: TData;
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
  updatedAt: number;
};

const DATABASE_NAME = 'potomac-offline';
const DATABASE_VERSION = 1;
const SNAPSHOTS = 'authorizedSnapshots';
const OPERATIONS = 'queuedOperations';
const DRAFTS = 'privateDrafts';

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
  putAuthorizedSnapshot(snapshot: AuthorizedSnapshot): Promise<void>;
  getAuthorizedSnapshot(entityId: string): Promise<AuthorizedSnapshot | undefined>;
  listAuthorizedSnapshots(): Promise<AuthorizedSnapshot[]>;
  enqueueOperation(operation: OfflineOperation): Promise<QueuedOperation>;
  listOperations(): Promise<QueuedOperation[]>;
  markSubmitting(operationId: string): Promise<QueuedOperation>;
  retryOperation(operationId: string): Promise<QueuedOperation>;
  recordReceipt(receipt: OfflineReceipt): Promise<QueuedOperation>;
  savePrivateDraft(draft: PrivateDraft): Promise<PrivateDraft>;
  listPrivateDrafts(): Promise<PrivateDraft[]>;
  deletePrivateDraft(draftId: string): Promise<void>;
};

/** Opens storage scoped to one host, campaign, and member. Never put credentials in a draft payload. */
export function openOfflineStorage(
  scope: OfflineScope,
  factory: IDBFactory = globalThis.indexedDB,
): Promise<OfflineStorage> {
  const scopedKey = offlineScopeKey(scope);
  if (!factory) return Promise.reject(new Error('IndexedDB is unavailable'));

  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of [SNAPSHOTS, OPERATIONS, DRAFTS]) {
        const store = db.objectStoreNames.contains(storeName)
          ? request.transaction!.objectStore(storeName)
          : db.createObjectStore(storeName, { keyPath: 'key' });
        if (!store.indexNames.contains('scopeKey')) store.createIndex('scopeKey', 'scopeKey');
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

    async putAuthorizedSnapshot(snapshot) {
      validateSnapshot(snapshot);
      const key = JSON.stringify([scopedKey, snapshot.entityId]);
      const tx = db.transaction(SNAPSHOTS, 'readwrite');
      const store = tx.objectStore(SNAPSHOTS);
      const request = store.get(key);
      request.onsuccess = () => {
        const old = request.result as Stored<{ snapshot: AuthorizedSnapshot }> | undefined;
        if (old && old.snapshot.revision > snapshot.revision) return;
        if (old && old.snapshot.revision === snapshot.revision && !sameJson(old.snapshot, snapshot)) {
          tx.abort();
          return;
        }
        store.put(scoped({ snapshot }, snapshot.entityId));
      };
      await transactionResult(tx);
    },

    async getAuthorizedSnapshot(entityId) {
      requireText(entityId, 'entityId');
      const key = JSON.stringify([scopedKey, entityId]);
      const tx = db.transaction(SNAPSHOTS, 'readonly');
      const result = await requestResult(tx.objectStore(SNAPSHOTS).get(key));
      await transactionResult(tx);
      const row = result as Stored<{ snapshot: AuthorizedSnapshot }> | undefined;
      return row?.scopeKey === scopedKey && isSnapshot(row.snapshot) ? row.snapshot : undefined;
    },

    async listAuthorizedSnapshots() {
      const rows = await listScoped(db, SNAPSHOTS, scopedKey) as Array<Stored<{ snapshot: AuthorizedSnapshot }>>;
      return rows.filter((row) => row.scopeKey === scopedKey && isSnapshot(row.snapshot)).map((row) => row.snapshot);
    },

    async enqueueOperation(operation) {
      validateOperation(operation, scope);
      const key = JSON.stringify([scopedKey, operation.operationId]);
      const tx = db.transaction(OPERATIONS, 'readwrite');
      const store = tx.objectStore(OPERATIONS);
      let result: QueuedOperation | undefined;
      let collision = false;
      const request = store.get(key);
      request.onsuccess = () => {
        const existing = request.result as Stored<QueuedOperation> | undefined;
        if (existing) {
          if (!sameJson(existing.operation, operation)) {
            collision = true;
            tx.abort();
          } else result = existing;
          return;
        }
        result = { operation: structuredClone(operation), state: 'queued', updatedAt: Date.now() };
        store.put(scoped(result, operation.operationId));
      };
      await transactionResult(tx);
      if (collision) throw new Error('Operation ID already exists with different content');
      return result!;
    },

    async listOperations() {
      const rows = await listScoped(db, OPERATIONS, scopedKey) as Array<Stored<QueuedOperation>>;
      return rows.filter((row) => row.scopeKey === scopedKey && isQueuedOperation(row)).map((row) => ({
        operation: row.operation,
        state: row.state,
        ...(row.receipt ? { receipt: row.receipt } : {}),
        updatedAt: row.updatedAt,
      }));
    },

    markSubmitting: (operationId) => updateOperation(db, scope, scopedKey, operationId, (row) => {
      transition(row, 'submitting');
    }),

    retryOperation: (operationId) => updateOperation(db, scope, scopedKey, operationId, (row) => {
      transition(row, 'queued');
    }),

    recordReceipt: (receipt) => {
      validateReceipt(receipt);
      return updateOperation(db, scope, scopedKey, receipt.operationId, (row) => {
        if (receipt.entityId !== row.operation.entityId) throw new Error('Receipt entity does not match operation');
        transition(row, receipt.status);
        row.receipt = structuredClone(receipt);
      });
    },

    async savePrivateDraft(draft) {
      requireText(draft.draftId, 'draftId');
      const tx = db.transaction(DRAFTS, 'readwrite');
      const store = tx.objectStore(DRAFTS);
      const saved: PrivateDraft = { ...structuredClone(draft), updatedAt: Date.now() };
      store.put(scoped({ draft: saved }, draft.draftId));
      await transactionResult(tx);
      return saved;
    },

    async listPrivateDrafts() {
      const rows = await listScoped(db, DRAFTS, scopedKey) as Array<Stored<{ draft: PrivateDraft }>>;
      return rows.filter((row) => row.scopeKey === scopedKey && isRecord(row.draft)).map((row) => row.draft);
    },

    async deletePrivateDraft(draftId) {
      requireText(draftId, 'draftId');
      const tx = db.transaction(DRAFTS, 'readwrite');
      tx.objectStore(DRAFTS).delete(JSON.stringify([scopedKey, draftId]));
      await transactionResult(tx);
    },
  };
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
    if (!stored || stored.scopeKey !== scopedKey || !isQueuedOperation(stored)) {
      failure = new Error('Queued operation was not found or is corrupt');
      tx.abort();
      return;
    }
    const row = structuredClone({ operation: stored.operation, state: stored.state, receipt: stored.receipt, updatedAt: stored.updatedAt });
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

function isQueuedOperation(value: unknown): value is Stored<QueuedOperation> {
  if (!isRecord(value) || !isRecord(value.operation) || !isNonEmptyString(value.operation.operationId) || !isNonEmptyString(value.operation.entityId) || !Number.isFinite(value.updatedAt)) return false;
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
