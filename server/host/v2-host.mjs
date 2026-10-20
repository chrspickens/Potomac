import { createHash, randomInt as cryptoRandomInt, timingSafeEqual } from 'node:crypto';
import { createV2ExtensionKernel } from './v2-extensions.mjs';
import { hashV2Json } from './v2-effects.mjs';
import { loadTrustedV2Catalog, lockForTrustedModule } from './v2-catalog.mjs';
const TRUSTED_CATALOG = await loadTrustedV2Catalog();

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

const secureEqual = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const installAuthorityVersionTriggers = (db, campaignId) => {
  const campaign = `'${campaignId.replaceAll("'", "''")}'`;
  const prefix = `v2_authority_${createHash('sha256').update(campaignId).digest('hex').slice(0, 16)}`;
  db.prepare('INSERT OR IGNORE INTO v2_authority_versions(campaign_id,version) VALUES(?,0)').run(campaignId);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS ${prefix}_lock_insert AFTER INSERT ON v2_campaign_locks
      WHEN NEW.campaign_id=${campaign}
      BEGIN UPDATE v2_authority_versions SET version=version+1 WHERE campaign_id=${campaign}; END;
    CREATE TRIGGER IF NOT EXISTS ${prefix}_member_insert AFTER INSERT ON members
      BEGIN UPDATE v2_authority_versions SET version=version+1 WHERE campaign_id=${campaign}; END;
    CREATE TRIGGER IF NOT EXISTS ${prefix}_member_update AFTER UPDATE OF credential_hash,revoked_at ON members
      WHEN OLD.credential_hash IS NOT NEW.credential_hash OR OLD.revoked_at IS NOT NEW.revoked_at
      BEGIN UPDATE v2_authority_versions SET version=version+1 WHERE campaign_id=${campaign}; END;
    CREATE TRIGGER IF NOT EXISTS ${prefix}_member_delete AFTER DELETE ON members
      BEGIN UPDATE v2_authority_versions SET version=version+1 WHERE campaign_id=${campaign}; END;
    CREATE TRIGGER IF NOT EXISTS ${prefix}_grant_insert AFTER INSERT ON actor_grants
      WHEN substr(NEW.actor_id,1,length('v2:'||${campaign}||':'))='v2:'||${campaign}||':'
      BEGIN UPDATE v2_authority_versions SET version=version+1 WHERE campaign_id=${campaign}; END;
    CREATE TRIGGER IF NOT EXISTS ${prefix}_grant_update AFTER UPDATE OF actor_id,member_id,can_read,can_act ON actor_grants
      WHEN substr(OLD.actor_id,1,length('v2:'||${campaign}||':'))='v2:'||${campaign}||':' OR substr(NEW.actor_id,1,length('v2:'||${campaign}||':'))='v2:'||${campaign}||':'
      BEGIN UPDATE v2_authority_versions SET version=version+1 WHERE campaign_id=${campaign}; END;
    CREATE TRIGGER IF NOT EXISTS ${prefix}_grant_delete AFTER DELETE ON actor_grants
      WHEN substr(OLD.actor_id,1,length('v2:'||${campaign}||':'))='v2:'||${campaign}||':'
      BEGIN UPDATE v2_authority_versions SET version=version+1 WHERE campaign_id=${campaign}; END;
    CREATE TRIGGER IF NOT EXISTS ${prefix}_extension_owner_update AFTER UPDATE OF owner_principal_id,descriptor_id,schema_version,migration_id,capability ON v2_extension_entities
      WHEN OLD.campaign_id=${campaign} AND (OLD.owner_principal_id IS NOT NEW.owner_principal_id OR OLD.descriptor_id IS NOT NEW.descriptor_id OR OLD.schema_version IS NOT NEW.schema_version OR OLD.migration_id IS NOT NEW.migration_id OR OLD.capability IS NOT NEW.capability)
      BEGIN UPDATE v2_authority_versions SET version=version+1 WHERE campaign_id=${campaign}; END;
    CREATE TRIGGER IF NOT EXISTS ${prefix}_extension_owner_delete AFTER DELETE ON v2_extension_entities
      WHEN OLD.campaign_id=${campaign}
      BEGIN UPDATE v2_authority_versions SET version=version+1 WHERE campaign_id=${campaign}; END;
    CREATE TRIGGER IF NOT EXISTS ${prefix}_entity_visibility_update AFTER UPDATE OF campaign_id,entity_type,visibility ON v2_effect_entities
      WHEN OLD.campaign_id=${campaign} AND (OLD.campaign_id IS NOT NEW.campaign_id OR OLD.entity_type IS NOT NEW.entity_type OR OLD.visibility IS NOT NEW.visibility)
      BEGIN UPDATE v2_authority_versions SET version=version+1 WHERE campaign_id=${campaign}; END;
    CREATE TRIGGER IF NOT EXISTS ${prefix}_entity_delete AFTER DELETE ON v2_effect_entities
      WHEN OLD.campaign_id=${campaign}
      BEGIN UPDATE v2_authority_versions SET version=version+1 WHERE campaign_id=${campaign}; END;
  `);
};
const begin = (db, mode, work) => {
  if (db.isTransaction) throw Object.assign(new Error('nested V2 host transaction is not supported'), { code: 'invalid' });
  db.exec(`BEGIN ${mode}`);
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
};

export function createV2HostAdapter({ db, campaignId, authenticateBearer, reauthorizePrincipal, writeGrantAudit = () => undefined, drawRandom = cryptoRandomInt, catalog } = {}) {
  if (!db || typeof campaignId !== 'string' || typeof authenticateBearer !== 'function') throw new Error('invalid V2 host adapter configuration');
  catalog ??= TRUSTED_CATALOG;
  const providers = catalog.providers;
  const entities = providers.flatMap(provider => provider.entities);
  const commands = providers.flatMap(provider => provider.commands);
  const workflows = providers.flatMap(provider => provider.workflows);
  const effectHandlers = providers.flatMap(provider => provider.effectHandlers);
  const resolvers = providers.flatMap(provider => provider.resolvers);
  const intentAuthorizers = new Map(providers.flatMap(provider => provider.intentAuthorizers.map(policy => [policy.commandId, policy.authorize])));
  const reactionAudiencePolicies = new Map(providers.flatMap(provider => provider.reactionPrincipalResolvers.map(policy => [policy.commandId, { resolve: policy.resolve }])));
  const buildLock = (id, moduleId = 'example.starship.system') => lockForTrustedModule(catalog, id, moduleId);
  db.exec(V2_HOST_LOCK_SCHEMA);
  const authenticate = (principalId, { campaignId: requestedCampaign, authorityToken } = {}) => {
    if (requestedCampaign !== campaignId || !db.prepare('SELECT 1 FROM campaign WHERE id=?').get(campaignId) || !authenticateBearer(principalId, authorityToken)) return undefined;
    return { principalId, role: principalId === 'gm' ? 'gm' : 'player' };
  };
  const getCampaignLock = requestedCampaign => {
    if (requestedCampaign !== campaignId) return undefined;
    const row = db.prepare('SELECT lock_json,lock_digest,root_module_id FROM v2_campaign_locks WHERE campaign_id=?').get(campaignId);
    if (!row) return undefined;
    const lock = JSON.parse(row.lock_json);
    if (hashV2Json(lock) !== row.lock_digest || hashV2Json(buildLock(campaignId, row.root_module_id)) !== row.lock_digest) return undefined;
    return lock;
  };
  const validateLock = (requestedCampaign, lock) => {
    const stored = db.prepare('SELECT lock_digest,lock_json,root_module_id FROM v2_campaign_locks WHERE campaign_id=?').get(requestedCampaign);
    if (!stored || requestedCampaign !== campaignId || hashV2Json(lock) !== stored.lock_digest || stored.lock_json !== JSON.stringify(lock) || hashV2Json(buildLock(campaignId, stored.root_module_id)) !== stored.lock_digest) throw Object.assign(new Error('campaign capability lock is unavailable or incompatible'), { code: 'unsupported' });
  };
  const grantKey = entityId => `v2:${campaignId}:${entityId}`;
  const hasGrant = (entityId, memberId, permission) => Boolean(db.prepare(`SELECT 1 FROM actor_grants g JOIN members m ON m.id=g.member_id WHERE g.actor_id=? AND g.member_id=? AND m.revoked_at IS NULL AND g.can_${permission}=1`).get(grantKey(entityId), memberId));
  const resolveReactionEligibility = ({ campaignId: requestedCampaign, actorPrincipalId, commandId, entityId, intent, entity, input }) => {
    if (requestedCampaign !== campaignId) return [];
    const owner = db.prepare('SELECT owner_principal_id FROM v2_extension_entities WHERE campaign_id=? AND entity_id=?').get(campaignId, entityId)?.owner_principal_id;
    return intent.audiences.flatMap(audience => {
      const modulePolicy = reactionAudiencePolicies.get(commandId);
      const modulePrincipal = modulePolicy?.resolve({ audience, entity, input, actorPrincipalId });
      const identities = { 'command-actor': actorPrincipalId, 'entity-owner': owner, 'campaign-gm': 'gm' };
      const principalId = modulePolicy ? modulePrincipal : identities[audience.audience]; if (!principalId || !reauthorizePrincipal?.(principalId)) return [];
      return [{ audience: audience.audience, principalId, priority: audience.priority, actions: audience.actions }];
    });
  };
  const kernel = createV2ExtensionKernel({
    db, entities, commands, workflows, effectHandlers, resolvers, drawRandom,
    authenticate, getCampaignLock, validateLock,
    authorizeCommandIntent: context => intentAuthorizers.get(context.command.commandId)?.(context) ?? true,
    authorizeRead: ({ member, entity }) => member.role === 'player' && hasGrant(entity.entityId, member.principalId, 'read'),
    authorizeCommand: ({ member, entity }) => member.role === 'player' && hasGrant(entity.entityId, member.principalId, 'act'),
    authorizeOwner: ({ campaignId: requestedCampaign, ownerPrincipalId }) => requestedCampaign === campaignId && (ownerPrincipalId === 'gm' || Boolean(db.prepare('SELECT 1 FROM members WHERE id=? AND revoked_at IS NULL').get(ownerPrincipalId))),
    reauthorizePendingActor: ({ principalId, campaignId: requestedCampaign }) => requestedCampaign === campaignId ? reauthorizePrincipal?.(principalId) : undefined,
    resolveReactionEligibility,
    authorizeReactionResponder: ({ principalId, window, action }) => {
      const pending = db.prepare("SELECT principal_id,entity_id,campaign_id,request,command_id FROM v2_extension_pending_commands WHERE window_id=? AND status IN ('pending','completed','conflicted')").get(window.windowId);
      if (!pending || pending.campaign_id !== campaignId || !reauthorizePrincipal?.(principalId) || !window.eligible.some(item => item.principalId === principalId && item.actions.some(candidate => candidate.actionId === action.actionId))) return false;
      const entity = db.prepare('SELECT data FROM v2_effect_entities WHERE campaign_id=? AND entity_id=?').get(campaignId, pending.entity_id);
      const data = entity ? JSON.parse(entity.data) : undefined;
      const pendingInput = JSON.parse(pending.request).input;
      const audiences = window.continuation?.continuation?.reaction?.audiences || [];
      const requestedAudience = audiences.find(audience => audience.actions.some(candidate => candidate.actionId === action.actionId));
      if (!requestedAudience) return false;
      const entityView = data ? { entityId: pending.entity_id, data } : undefined;
      const modulePolicy = reactionAudiencePolicies.get(pending.command_id);
      const modulePrincipal = modulePolicy?.resolve({ audience: requestedAudience, entity: entityView, input: pendingInput, actorPrincipalId: pending.principal_id });
      const owner = db.prepare('SELECT owner_principal_id FROM v2_extension_entities WHERE campaign_id=? AND entity_id=?').get(campaignId, pending.entity_id)?.owner_principal_id;
      const expectedPrincipal = modulePolicy ? modulePrincipal : (requestedAudience.audience === 'command-actor' ? pending.principal_id : requestedAudience.audience === 'entity-owner' ? owner : requestedAudience.audience === 'campaign-gm' ? 'gm' : undefined);
      return expectedPrincipal === principalId;
    }
  });
  installAuthorityVersionTriggers(db, campaignId);

  return {
    listModules(principalId, authorityToken) {
      return begin(db, 'DEFERRED', () => {
        if (!authenticate(principalId, { campaignId, authorityToken })) throw Object.assign(new Error('authenticated campaign member required'), { code: 'unauthorized' });
        return providers.map(provider => ({ id: provider.id, name: provider.manifest.name, version: provider.version, digest: provider.digest, contentDigest: provider.contentDigest, capabilities: provider.moduleRefs.map(({ id, apiVersion, implementationVersion, digest }) => ({ id, apiVersion, implementationVersion, digest })), entities: provider.entities.map(({ typeId, schemaVersion, schema, capability, creationRoles, visibility, ownership }) => ({ typeId, schemaVersion, schema, capability, creationRoles, visibility, ownership })), commands: provider.commands.map(({ commandId, entityTypeId, capability, inputSchema, permission }) => ({ commandId, entityTypeId, capability, inputSchema, permission })), workflows: provider.workflows, contributions: provider.ui }));
      });
    },
    getLock(principalId, authorityToken) {
      return begin(db, 'DEFERRED', () => {
        if (!authenticate(principalId, { campaignId, authorityToken })) throw Object.assign(new Error('authenticated campaign member required'), { code: 'unauthorized' });
        const lock = getCampaignLock(campaignId);
        if (!lock) throw Object.assign(new Error('campaign capability lock is not pinned'), { code: 'unavailable' });
        validateLock(campaignId, lock);
        return { lock, digest: hashV2Json(lock) };
      });
    },
    pinLock(principalId, authorityToken, moduleId = 'example.starship.system') {
      return begin(db, 'IMMEDIATE', () => {
        const member = authenticate(principalId, { campaignId, authorityToken });
        if (!member) throw Object.assign(new Error('authenticated campaign member required'), { code: 'unauthorized' });
        if (member.role !== 'gm') throw Object.assign(new Error('GM authority required'), { code: 'forbidden' });
        const legacyCampaign = db.prepare('SELECT system_module_id FROM campaign WHERE id=?').get(campaignId);
        const legacyState = db.prepare('SELECT 1 FROM actors UNION ALL SELECT 1 FROM encounters UNION ALL SELECT 1 FROM sessions UNION ALL SELECT 1 FROM lore_entries UNION ALL SELECT 1 FROM map_scenes LIMIT 1').get();
        if (legacyCampaign?.system_module_id || legacyState) throw Object.assign(new Error('this host already contains a V1 ruleset or campaign records; create a fresh host campaign for experimental V2'), { code: 'conflict' });
        const lock = buildLock(campaignId, moduleId), serialized = JSON.stringify(lock), digest = hashV2Json(lock);
        const existing = db.prepare('SELECT lock_digest,lock_json FROM v2_campaign_locks WHERE campaign_id=?').get(campaignId);
        if (existing) {
          if (existing.lock_digest !== digest || existing.lock_json !== serialized) throw Object.assign(new Error('campaign capability lock is already pinned and immutable'), { code: 'conflict' });
          return { lock, digest, alreadyPinned: true };
        }
        db.prepare('INSERT INTO v2_campaign_locks(campaign_id,lock_version,lock_digest,lock_json,root_module_id,root_module_version,root_module_digest,pinned_by,pinned_at) VALUES(?,1,?,?,?,?,?,?,?)')
          .run(campaignId, digest, serialized, lock.rootModule.id, lock.rootModule.version, lock.rootModule.digest, principalId, new Date().toISOString());
        writeGrantAudit({ kind: 'v2.capability-lock.pinned', visibility: 'gm', payload: { campaignId, digest, lockVersion: 1 } });
        return { lock, digest, alreadyPinned: false };
      });
    },
    createEntity(request) { return kernel.createEntity(request); },
    read(campaignIdValue, entityId, principalId, expectedLockDigest, authorityToken) { return kernel.read(campaignIdValue, entityId, principalId, expectedLockDigest, authorityToken); },
    list(campaignIdValue, typeId, principalId, expectedLockDigest, authorityToken) { return kernel.list(campaignIdValue, typeId, principalId, expectedLockDigest, authorityToken); },
    availableCommands(campaignIdValue, entityId, principalId, expectedLockDigest, authorityToken) { return kernel.availableCommands(campaignIdValue, entityId, principalId, expectedLockDigest, authorityToken); },
    events(campaignIdValue, principalId, authorityToken) { return kernel.events(campaignIdValue, principalId, authorityToken); },
    executeCommand(request) { return kernel.executeCommand(request); },
    // Reaction projections and decisions remain authority-filtered by the existing kernels.
    submitReaction(principalId, authorityToken, submission) {
      if (!submission || Object.hasOwn(submission, 'principalId')) throw Object.assign(new Error('reaction principal identity is host-derived'), { code: 'invalid' });
      return kernel.submitReaction({ ...submission, campaignId, principalId }, authorityToken);
    },
    expireReaction(principalId, authorityToken, windowId) { return kernel.expireReaction(windowId, principalId, authorityToken); },
    adjudicateReaction(principalId, authorityToken, windowId, decision) { return kernel.adjudicateReaction(windowId, principalId, decision, authorityToken); },
    declineReaction(principalId, authorityToken, windowId, operationId, actionId, input) { return kernel.submitReaction({ operationId, windowId, actionId, input, decision: 'decline', campaignId, principalId }, authorityToken); },
    listReactions(campaignIdValue, principalId, authorityToken) { return kernel.listReactions(campaignIdValue, principalId, authorityToken); },
    viewReaction(windowId, principalId, authorityToken) { return kernel.viewReaction(windowId, principalId, authorityToken); },
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
