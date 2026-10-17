import { DatabaseSync } from 'node:sqlite';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type Entity = { id: string; type: string; revision: number; data: Record<string, JsonValue> };
export type Visibility = 'public' | 'gm' | { principals: string[] };
export type EffectProposal = {
  effectId: string;
  operationId: string;
  principalId: string;
  target: { entityId: string; expectedRevision: number };
  handler: 'entity.patch' | 'resource.delta';
  path: string;
  value?: JsonValue;
  delta?: number;
  visibility: Visibility;
};
export type ReactionContinuation = {
  windowId: string;
  operationId: string;
  state: JsonValue;
  eligibleResponders: string[];
  expiresAt: number;
  ordering: 'submission';
  status: 'pending' | 'resolved' | 'expired';
};
export type ReactionSubmission = {
  windowId: string;
  operationId: string;
  responderId: string;
  actionId: string;
  submittedAt: number;
  input: JsonValue;
};

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  revision INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operations (
  operation_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  response TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS continuations (
  window_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  eligible TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  ordering TEXT NOT NULL CHECK(ordering = 'submission'),
  status TEXT NOT NULL CHECK(status IN ('pending','resolved','expired'))
);
CREATE TABLE IF NOT EXISTS reaction_submissions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  window_id TEXT NOT NULL REFERENCES continuations(window_id),
  operation_id TEXT NOT NULL,
  responder_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  input TEXT NOT NULL,
  UNIQUE(window_id, responder_id, operation_id)
);
`;

function assertJson(value: unknown, path = '$'): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new Error(`${path}: non-finite number`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJson(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error(`${path}: unsafe key`);
      assertJson(item, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`${path}: not JSON`);
}

function clone<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseEntity(row: Record<string, unknown>): Entity {
  const data = JSON.parse(String(row.data));
  assertJson(data, 'entity.data');
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('entity.data must be an object');
  return { id: String(row.id), type: String(row.type), revision: Number(row.revision), data: data as Record<string, JsonValue> };
}

export type KernelOptions = {
  authorizeEffect?: (effect: EffectProposal, entity: Entity) => boolean;
  validateEffect?: (effect: EffectProposal, entity: Entity, next: Record<string, JsonValue>) => void;
  now?: () => number;
};

export class V2ExecutionKernel {
  readonly db: DatabaseSync;
  private readonly authorizeEffect: (effect: EffectProposal, entity: Entity) => boolean;
  private readonly validateEffect: (effect: EffectProposal, entity: Entity, next: Record<string, JsonValue>) => void;
  private readonly now: () => number;

  constructor(database: DatabaseSync, options: KernelOptions = {}) {
    this.db = database;
    this.authorizeEffect = options.authorizeEffect || (() => true);
    this.validateEffect = options.validateEffect || (() => undefined);
    this.now = options.now || (() => Date.now());
    this.db.exec(schema);
  }

  putEntity(entity: Entity): void {
    assertJson(entity.data, 'entity.data');
    this.db.prepare('INSERT INTO entities(id,type,revision,data) VALUES(?,?,?,?)').run(entity.id, entity.type, entity.revision, JSON.stringify(entity.data));
  }

  getEntity(id: string): Entity {
    const row = this.db.prepare('SELECT id,type,revision,data FROM entities WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`unknown entity: ${id}`);
    return parseEntity(row);
  }

  applyEffects(effects: EffectProposal[]): { operationId: string; appliedEffectIds: string[] } {
    if (!effects.length) throw new Error('no effects');
    const operationIds = new Set(effects.map(effect => effect.operationId));
    if (operationIds.size !== 1) throw new Error('effects must share one operation');
    const operationId = effects[0].operationId;
    const existing = this.db.prepare('SELECT response FROM operations WHERE operation_id=?').get(operationId) as { response: string } | undefined;
    if (existing) return JSON.parse(existing.response) as { operationId: string; appliedEffectIds: string[] };
    const ordered = [...effects].sort((a, b) => a.effectId.localeCompare(b.effectId) || a.target.entityId.localeCompare(b.target.entityId));
    const seen = new Set<string>();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const working = new Map<string, Entity>();
      for (const effect of ordered) {
        if (seen.has(`${effect.target.entityId}:${effect.path}`)) throw new Error('conflicting effects');
        seen.add(`${effect.target.entityId}:${effect.path}`);
        const entity = working.get(effect.target.entityId) || this.getEntity(effect.target.entityId);
        if (entity.revision !== effect.target.expectedRevision) throw new Error('stale revision');
        if (!this.authorizeEffect(effect, entity)) throw new Error('effect unauthorized');
        const next = clone(entity.data);
        this.applyEffect(next, effect);
        this.validateEffect(effect, entity, next);
        working.set(entity.id, { ...entity, data: next });
      }
      for (const entity of working.values()) {
        const update = this.db.prepare('UPDATE entities SET revision=?,data=? WHERE id=? AND revision=?')
          .run(entity.revision + 1, JSON.stringify(entity.data), entity.id, entity.revision);
        if (update.changes !== 1) throw new Error('concurrent revision conflict');
      }
      const response = { operationId, appliedEffectIds: ordered.map(effect => effect.effectId) };
      this.db.prepare('INSERT INTO operations(operation_id,status,response) VALUES(?,?,?)').run(operationId, 'applied', JSON.stringify(response));
      this.db.exec('COMMIT');
      return response;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private applyEffect(data: Record<string, JsonValue>, effect: EffectProposal): void {
    const parts = effect.path.split('.');
    if (parts.some(part => !part || part === '__proto__' || part === 'constructor' || part === 'prototype')) throw new Error('invalid effect path');
    const key = parts.pop()!;
    let parent = data;
    for (const part of parts) {
      const current = parent[part];
      if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error('effect path missing');
      parent = current as Record<string, JsonValue>;
    }
    if (effect.handler === 'entity.patch') {
      if (!('value' in effect)) throw new Error('patch value missing');
      assertJson(effect.value, 'effect.value');
      parent[key] = clone(effect.value!);
    } else {
      if (typeof effect.delta !== 'number' || !Number.isFinite(effect.delta) || typeof parent[key] !== 'number') throw new Error('invalid resource delta');
      parent[key] = parent[key] as number + effect.delta;
    }
  }

  saveContinuation(continuation: ReactionContinuation): void {
    assertJson(continuation.state, 'continuation.state');
    if (!continuation.windowId || !continuation.operationId || !Number.isSafeInteger(continuation.expiresAt) || continuation.eligibleResponders.some(id => !id)) throw new Error('invalid continuation');
    this.db.prepare('INSERT INTO continuations(window_id,operation_id,state,eligible,expires_at,ordering,status) VALUES(?,?,?,?,?,?,?)')
      .run(continuation.windowId, continuation.operationId, JSON.stringify(continuation.state), JSON.stringify(continuation.eligibleResponders), continuation.expiresAt, continuation.ordering, continuation.status);
  }

  getContinuation(windowId: string): ReactionContinuation {
    const row = this.db.prepare('SELECT * FROM continuations WHERE window_id=?').get(windowId) as Record<string, unknown> | undefined;
    if (!row) throw new Error('unknown reaction window');
    const state = JSON.parse(String(row.state));
    const eligibleResponders = JSON.parse(String(row.eligible));
    assertJson(state, 'continuation.state');
    return { windowId: String(row.window_id), operationId: String(row.operation_id), state, eligibleResponders, expiresAt: Number(row.expires_at), ordering: 'submission', status: String(row.status) as ReactionContinuation['status'] };
  }

  submitReaction(submission: ReactionSubmission, resolve: (continuation: ReactionContinuation, submission: ReactionSubmission) => EffectProposal[] | null): { status: 'pending' | 'resolved' | 'duplicate' | 'expired' } {
    const existing = this.db.prepare('SELECT 1 FROM reaction_submissions WHERE window_id=? AND responder_id=? AND operation_id=?').get(submission.windowId, submission.responderId, submission.operationId);
    if (existing) return { status: 'duplicate' };
    const continuation = this.getContinuation(submission.windowId);
    if (continuation.status !== 'pending') return { status: continuation.status };
    if (this.now() >= continuation.expiresAt) {
      this.db.prepare('UPDATE continuations SET status=? WHERE window_id=? AND status=?').run('expired', submission.windowId, 'pending');
      return { status: 'expired' };
    }
    if (!continuation.eligibleResponders.includes(submission.responderId)) throw new Error('responder unauthorized');
    assertJson(submission.input, 'reaction.input');
    this.db.prepare('INSERT INTO reaction_submissions(window_id,operation_id,responder_id,action_id,submitted_at,input) VALUES(?,?,?,?,?,?)')
      .run(submission.windowId, submission.operationId, submission.responderId, submission.actionId, submission.submittedAt, JSON.stringify(submission.input));
    try {
      const effects = resolve(continuation, submission);
      if (effects === null) return { status: 'pending' };
      this.applyEffects(effects);
      this.db.prepare('UPDATE continuations SET status=? WHERE window_id=? AND status=?').run('resolved', submission.windowId, 'pending');
      return { status: 'resolved' };
    } catch (error) {
      // A failed continuation resolution must remain retryable, not consume the responder's operation.
      this.db.prepare('DELETE FROM reaction_submissions WHERE window_id=? AND responder_id=? AND operation_id=?')
        .run(submission.windowId, submission.responderId, submission.operationId);
      throw error;
    }
  }
}

export function openKernel(databasePath: string, options?: KernelOptions): V2ExecutionKernel {
  return new V2ExecutionKernel(new DatabaseSync(databasePath), options);
}
