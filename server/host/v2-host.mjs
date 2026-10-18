import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createV2ExtensionKernel } from './v2-extensions.mjs';
import { hashV2Json } from './v2-effects.mjs';
import { starshipCommands, starshipEffectHandlers, starshipEntity, starshipRefs, starshipResolvers, starshipWorkflow } from '../../examples/example.starship/v2/extensions.mjs';

export const V2_HOST_LOCK_SCHEMA = `
CREATE TABLE IF NOT EXISTS v2_campaign_locks (
  campaign_id TEXT PRIMARY KEY, lock_version INTEGER NOT NULL, lock_digest TEXT NOT NULL,
  lock_json TEXT NOT NULL, root_module_id TEXT NOT NULL, root_module_version TEXT NOT NULL,
  root_module_digest TEXT NOT NULL, pinned_by TEXT NOT NULL, pinned_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS v2_campaign_locks_immutable_update
BEFORE UPDATE ON v2_campaign_locks BEGIN SELECT RAISE(ABORT, 'V2 campaign capability locks are immutable'); END;
CREATE TRIGGER IF NOT EXISTS v2_campaign_locks_immutable_delete
BEFORE DELETE ON v2_campaign_locks BEGIN SELECT RAISE(ABORT, 'V2 campaign capability locks are immutable'); END;`;

const ROOT_ID = 'example.starship.system';
const ROOT_VERSION = '1.0.0';
const bundledModuleSource = readFileSync(new URL('../../examples/example.starship/v2/extensions.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const rootDigest = `sha256:${createHash('sha256').update(bundledModuleSource).digest('hex')}`;
const rootRef = { id: ROOT_ID, apiVersion: '1.0.0', implementationVersion: ROOT_VERSION, digest: rootDigest };
const secureEqual = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const compiledRefs = [rootRef, ...Object.values(starshipRefs)];
const uniqueRefs = [...new Map(compiledRefs.map(ref => [ref.id, ref])).values()];
const buildLock = campaignId => ({
  lockVersion: 1,
  campaignId,
  rootModule: { id: ROOT_ID, version: ROOT_VERSION, digest: rootDigest },
  entries: uniqueRefs.map(ref => ({ ...ref, source: 'bundled', optional: false }))
});
const begin = (db, mode, work) => {
  if (db.isTransaction) throw Object.assign(new Error('nested V2 host transaction is not supported'), { code: 'invalid' });
  db.exec(`BEGIN ${mode}`);
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
};

export function createV2HostAdapter({ db, campaignId, authenticateBearer, writeGrantAudit = () => undefined } = {}) {
  if (!db || typeof campaignId !== 'string' || typeof authenticateBearer !== 'function') throw new Error('invalid V2 host adapter configuration');
  db.exec(V2_HOST_LOCK_SCHEMA);
  const authenticate = (principalId, { campaignId: requestedCampaign, authorityToken } = {}) => {
    if (requestedCampaign !== campaignId || !db.prepare('SELECT 1 FROM campaign WHERE id=?').get(campaignId) || !authenticateBearer(principalId, authorityToken)) return undefined;
    return { principalId, role: principalId === 'gm' ? 'gm' : 'player' };
  };
  const getCampaignLock = requestedCampaign => {
    if (requestedCampaign !== campaignId) return undefined;
    const row = db.prepare('SELECT lock_json,lock_digest FROM v2_campaign_locks WHERE campaign_id=?').get(campaignId);
    if (!row) return undefined;
    const lock = JSON.parse(row.lock_json);
    if (hashV2Json(lock) !== row.lock_digest || hashV2Json(buildLock(campaignId)) !== row.lock_digest) return undefined;
    return lock;
  };
  const validateLock = (requestedCampaign, lock) => {
    const stored = db.prepare('SELECT lock_digest,lock_json FROM v2_campaign_locks WHERE campaign_id=?').get(requestedCampaign);
    if (!stored || requestedCampaign !== campaignId || hashV2Json(lock) !== stored.lock_digest || stored.lock_json !== JSON.stringify(lock) || hashV2Json(buildLock(campaignId)) !== stored.lock_digest) throw Object.assign(new Error('campaign capability lock is unavailable or incompatible'), { code: 'unsupported' });
  };
  const grantKey = entityId => `v2:${campaignId}:${entityId}`;
  const hasGrant = (entityId, memberId, permission) => Boolean(db.prepare(`SELECT 1 FROM actor_grants g JOIN members m ON m.id=g.member_id WHERE g.actor_id=? AND g.member_id=? AND m.revoked_at IS NULL AND g.can_${permission}=1`).get(grantKey(entityId), memberId));
  const kernel = createV2ExtensionKernel({
    db, entities: [starshipEntity], commands: starshipCommands, workflows: [starshipWorkflow],
    effectHandlers: starshipEffectHandlers, resolvers: starshipResolvers,
    authenticate, getCampaignLock, validateLock,
    authorizeRead: ({ member, entity }) => member.role === 'player' && hasGrant(entity.entityId, member.principalId, 'read'),
    authorizeCommand: ({ member, entity }) => member.role === 'player' && hasGrant(entity.entityId, member.principalId, 'act'),
    authorizeOwner: ({ campaignId: requestedCampaign, ownerPrincipalId }) => requestedCampaign === campaignId && (ownerPrincipalId === 'gm' || Boolean(db.prepare('SELECT 1 FROM members WHERE id=? AND revoked_at IS NULL').get(ownerPrincipalId)))
  });

  return {
    getLock(principalId, authorityToken) {
      return begin(db, 'DEFERRED', () => {
        if (!authenticate(principalId, { campaignId, authorityToken })) throw Object.assign(new Error('authenticated campaign member required'), { code: 'unauthorized' });
        const lock = getCampaignLock(campaignId);
        if (!lock) throw Object.assign(new Error('campaign capability lock is not pinned'), { code: 'unsupported' });
        validateLock(campaignId, lock);
        return { lock, digest: hashV2Json(lock) };
      });
    },
    pinLock(principalId, authorityToken) {
      return begin(db, 'IMMEDIATE', () => {
        const member = authenticate(principalId, { campaignId, authorityToken });
        if (!member) throw Object.assign(new Error('authenticated campaign member required'), { code: 'unauthorized' });
        if (member.role !== 'gm') throw Object.assign(new Error('GM authority required'), { code: 'forbidden' });
        const lock = buildLock(campaignId), serialized = JSON.stringify(lock), digest = hashV2Json(lock);
        const existing = db.prepare('SELECT lock_digest,lock_json FROM v2_campaign_locks WHERE campaign_id=?').get(campaignId);
        if (existing) {
          if (existing.lock_digest !== digest || existing.lock_json !== serialized) throw Object.assign(new Error('campaign capability lock is already pinned and immutable'), { code: 'conflict' });
          return { lock, digest, alreadyPinned: true };
        }
        db.prepare('INSERT INTO v2_campaign_locks(campaign_id,lock_version,lock_digest,lock_json,root_module_id,root_module_version,root_module_digest,pinned_by,pinned_at) VALUES(?,1,?,?,?,?,?,?,?)')
          .run(campaignId, digest, serialized, ROOT_ID, ROOT_VERSION, rootDigest, principalId, new Date().toISOString());
        writeGrantAudit({ kind: 'v2.capability-lock.pinned', visibility: 'gm', payload: { campaignId, digest, lockVersion: 1 } });
        return { lock, digest, alreadyPinned: false };
      });
    },
    createEntity(request) { return kernel.createEntity(request); },
    read(campaignIdValue, entityId, principalId, expectedLockDigest, authorityToken) { return kernel.read(campaignIdValue, entityId, principalId, expectedLockDigest, authorityToken); },
    executeCommand(request) { return kernel.executeCommand(request); },
    grant(principalId, authorityToken, entityId, memberId, permissions) {
      return begin(db, 'IMMEDIATE', () => {
        const member = authenticate(principalId, { campaignId, authorityToken });
        if (!member) throw Object.assign(new Error('authenticated campaign member required'), { code: 'unauthorized' });
        if (member.role !== 'gm') throw Object.assign(new Error('GM authority required'), { code: 'forbidden' });
        const lock = getCampaignLock(campaignId); if (!lock) throw Object.assign(new Error('campaign capability lock is not pinned'), { code: 'unsupported' }); validateLock(campaignId, lock);
        if (!db.prepare('SELECT 1 FROM v2_extension_entities WHERE campaign_id=? AND entity_id=?').get(campaignId, entityId) || !db.prepare('SELECT 1 FROM members WHERE id=? AND revoked_at IS NULL').get(memberId)) throw Object.assign(new Error('entity or member is unavailable'), { code: 'unavailable' });
        if (!Array.isArray(permissions) || !permissions.length || permissions.some(item => !['read', 'act'].includes(item))) throw Object.assign(new Error('permissions must contain read and/or act'), { code: 'invalid' });
        const canRead = permissions.includes('read') || permissions.includes('act') ? 1 : 0;
        const canAct = permissions.includes('act') ? 1 : 0;
        db.prepare('INSERT INTO actor_grants(actor_id,member_id,can_read,can_act,granted_at) VALUES(?,?,?,?,?) ON CONFLICT(actor_id,member_id) DO UPDATE SET can_read=excluded.can_read,can_act=excluded.can_act,granted_at=excluded.granted_at').run(grantKey(entityId), memberId, canRead, canAct, new Date().toISOString());
        const result = { entityId, memberId, permissions: canAct ? ['read', 'act'] : ['read'] };
        writeGrantAudit({ kind: 'actor.granted', visibility: 'gm', payload: result });
        return result;
      });
    },
    revoke(principalId, authorityToken, entityId, memberId) {
      return begin(db, 'IMMEDIATE', () => {
        const member = authenticate(principalId, { campaignId, authorityToken });
        if (!member) throw Object.assign(new Error('authenticated campaign member required'), { code: 'unauthorized' });
        if (member.role !== 'gm') throw Object.assign(new Error('GM authority required'), { code: 'forbidden' });
        const lock = getCampaignLock(campaignId); if (!lock) throw Object.assign(new Error('campaign capability lock is not pinned'), { code: 'unsupported' }); validateLock(campaignId, lock);
        const removed = db.prepare('DELETE FROM actor_grants WHERE actor_id=? AND member_id=? AND EXISTS(SELECT 1 FROM v2_extension_entities WHERE campaign_id=? AND entity_id=?)').run(grantKey(entityId), memberId, campaignId, entityId);
        if (!removed.changes) throw Object.assign(new Error('grant is unavailable'), { code: 'unavailable' });
        const result = { entityId, memberId, revoked: true };
        writeGrantAudit({ kind: 'actor.grant_revoked', visibility: 'gm', payload: result });
        return result;
      });
    }
  };
}
