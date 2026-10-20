import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateModule } from '../../scripts/v2-module.mjs';
import { validateCapabilityManifest } from '../../packages/module-registry/src/v2.ts';
import { UiContributionRegistry } from '../../clients/web/src/workspace/v2-ui-registry.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../..');
const configFile = path.join(here, 'trusted-v2-catalog.json');
const fail = message => { throw Object.assign(new Error(`trusted V2 catalog: ${message}`), { code: 'unsupported' }); };
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const digestFiles = async (root, files) => `sha256:${createHash('sha256').update((await Promise.all(files.map(file => readFile(path.join(root, file), 'utf8')))).map(value => value.replace(/\r\n/g, '\n')).join('\n')).digest('hex')}`;
const refs = value => value && typeof value === 'object' && typeof value.id === 'string' && typeof value.apiVersion === 'string' && typeof value.implementationVersion === 'string' && typeof value.digest === 'string';
const flatten = exports => [...new Set(Object.values(exports).flatMap(value => Array.isArray(value) ? value : [value]))];
const allRefs = exports => {
  const result = new Map(); const seen = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (refs(value)) { result.set(`${value.id}@${value.implementationVersion}`, value); return; }
    for (const child of Object.values(value)) visit(child);
  };
  for (const value of Object.values(exports)) visit(value);
  return [...result.values()];
};

export async function loadTrustedV2Catalog({ catalogFile = configFile } = {}) {
  const config = await readJson(catalogFile);
  if (config.formatVersion !== 1 || !Array.isArray(config.modules)) fail('invalid allowlist configuration');
  const ids = new Set(); const versions = new Set(); const providers = [];
  for (const item of config.modules) {
    if (!item || ids.has(item.id)) fail(`duplicate module id ${item?.id ?? '<missing>'}`);
    const versionKey = `${item.id}@${item.version}`;
    if (versions.has(versionKey)) fail(`duplicate module version ${versionKey}`);
    ids.add(item.id); versions.add(versionKey);
    const root = path.resolve(path.dirname(catalogFile), item.source);
    if (typeof item.source !== 'string' || path.isAbsolute(item.source) || !(root.startsWith(`${repositoryRoot}${path.sep}`))) fail(`${item.id}: source must resolve within the reviewed repository allowlist`);
    const entry = path.resolve(root, item.entry);
    if (!entry.startsWith(`${root}${path.sep}`)) fail(`${item.id}: entry escapes its allowlisted source directory`);
    let verification;
    try {
      verification = item.authoring ? await validateModule(root) : { contentDigest: await digestFiles(root, item.legacyDigestFiles), rootDigest: await digestFiles(root, item.legacyDigestFiles) };
    } catch (error) { fail(`${item.id}@${item.version} unavailable or invalid: ${error.message}`); }
    let manifest;
    try { manifest = await readJson(path.join(root, 'manifest.json')); } catch { fail(`${item.id}: trusted manifest is unavailable`); }
    if (manifest.id !== item.id || manifest.version !== item.version || manifest.trust !== 'bundled-trusted') fail(`${item.id}: allowlist and trusted manifest identity/version disagree`);
    const source = await import(pathToFileURL(entry).href);
    const descriptors = flatten(source);
    const authoring = item.authoring ? await readJson(path.join(root, 'authoring.json')) : undefined;
    let capabilities;
    if (item.authoring && !authoring.legacyBundledReferences) capabilities = await readJson(path.join(root, authoring.capabilitiesFile ?? 'capabilities.json'));
    const entities = descriptors.filter(value => value?.descriptorVersion === 1 && typeof value.typeId === 'string' && value.schema);
    const commands = descriptors.filter(value => value?.descriptorVersion === 1 && typeof value.commandId === 'string' && value.inputSchema && value.resolver);
    const resolvers = descriptors.filter(value => value?.ref && typeof value.resolve === 'function');
    const effectHandlers = descriptors.filter(value => refs(value) && value.payloadSchema && typeof value.apply === 'function');
    if (!entities.length || !commands.length || !resolvers.length || !effectHandlers.length) fail(`${item.id}: source lacks a complete entity/command/resolver/effect contribution`);
    const capabilityById = new Map();
    if (capabilities) for (const candidate of capabilities) {
      const capability = validateCapabilityManifest(candidate); const key = `${capability.id}@${capability.implementationVersion}`;
      if (capabilityById.has(key)) fail(`${item.id}: duplicate capability ${key}`);
      capabilityById.set(key, capability);
    }
    const rootDigest = verification.rootDigest;
    const rootCapability = capabilities?.find(capability => capability.id === item.id && capability.implementationVersion === item.version);
    if (capabilities && (!rootCapability || rootCapability.digest !== rootDigest)) fail(`${item.id}: capability root digest mismatch`);
    const moduleRefs = capabilities ? capabilities.map(capability => ({ id: capability.id, apiVersion: capability.api.apiVersion, implementationVersion: capability.implementationVersion, digest: capability.digest })) : allRefs(source);
    const refIds = new Map();
    for (const ref of moduleRefs) {
      const identity = `${ref.id}@${ref.apiVersion}@${ref.implementationVersion}@${ref.digest}`;
      const previous = refIds.get(ref.id);
      if (previous && previous !== identity) fail(`${item.id}: conflicting capability versions for ${ref.id}`);
      refIds.set(ref.id, identity);
    }
    for (const entity of entities) if (!moduleRefs.some(ref => ref.id === entity.capability.id && ref.digest === entity.capability.digest)) fail(`${item.id}: entity capability is outside the catalog closure`);
    for (const command of commands) if (!moduleRefs.some(ref => ref.id === command.capability.id && ref.digest === command.capability.digest && ref.implementationVersion === command.capability.implementationVersion)) fail(`${item.id}: command capability is outside the catalog closure`);
    const uiValues = item.authoring ? await Promise.all((authoring.uiFiles ?? []).map(file => readJson(path.join(root, file)))) : [];
    for (const contribution of uiValues) {
      if (!contribution || !Array.isArray(contribution.nodes) || !Array.isArray(contribution.commands)) fail(`${item.id}: declared UI must use the bounded nodes/commands contract`);
      const inClosure = ref => moduleRefs.some(candidate => candidate.id === ref?.id && candidate.apiVersion === ref?.apiVersion && candidate.implementationVersion === ref?.implementationVersion && candidate.digest === ref?.digest);
      const entity = entities.find(candidate => candidate.typeId === contribution.entityTypeId);
      if (!entity || contribution.entitySchemaVersion !== entity.schemaVersion || JSON.stringify(contribution.entitySchema) !== JSON.stringify(entity.schema) || !inClosure(contribution.capability) || !inClosure(contribution.entityCapability)) fail(`${item.id}: declarative UI entity/capability contract is incompatible`);
      for (const commandContract of contribution.commands) {
        const command = commands.find(candidate => candidate.commandId === commandContract.commandId);
        if (!command || !inClosure(commandContract.capability) || JSON.stringify(command.inputSchema) !== JSON.stringify(commandContract.inputSchema)) fail(`${item.id}: declarative UI command is unresolved or mismatched`);
      }
    }
    const uiLock = { lockVersion: 1, campaignId: 'trusted-catalog-validation', rootModule: { id: item.id, version: item.version, digest: rootDigest }, entries: [...new Map([[item.id, { id: item.id, apiVersion: rootCapability?.api.apiVersion ?? '1.0.0', implementationVersion: item.version, digest: rootDigest }], ...moduleRefs.map(ref => [ref.id, { id: ref.id, apiVersion: ref.apiVersion, implementationVersion: ref.implementationVersion, digest: ref.digest }])]).values()].map(ref => ({ ...ref, source: 'bundled', optional: false })) };
    const uiCatalog = { entities: entities.map(({ typeId, schemaVersion, schema, capability }) => ({ typeId, schemaVersion, schema, capability })), commands: commands.map(({ commandId, entityTypeId, capability, inputSchema }) => ({ commandId, entityTypeId, capability, inputSchema })), workflows: descriptors.filter(value => value?.descriptorVersion === 1 && typeof value.workflowType === 'string').map(({ workflowType, entityTypeId, capability, states, transitions }) => ({ workflowType, entityTypeId, capability, states, transitions })) };
    const uiRegistry = new UiContributionRegistry(uiLock, uiLock.campaignId, uiCatalog);
    for (const contribution of uiValues) uiRegistry.register(contribution);
    if (item.intentAuthorizerExport && typeof source[item.intentAuthorizerExport] !== 'function') fail(`${item.id}: configured intent authorizer export is unavailable`);
    if (item.reactionPrincipalExport && typeof source[item.reactionPrincipalExport] !== 'function') fail(`${item.id}: configured reaction principal export is unavailable`);
    providers.push({ ...item, root, manifest, version: item.version, digest: rootDigest, contentDigest: verification.contentDigest, moduleRefs, capabilities, source, entities, commands, resolvers, effectHandlers,
      workflows: descriptors.filter(value => value?.descriptorVersion === 1 && typeof value.workflowType === 'string'),
      intentAuthorizers: item.intentAuthorizerExport ? commands.map(command => ({ commandId: command.commandId, authorize: source[item.intentAuthorizerExport] })) : [], reactionPrincipalResolvers: item.reactionPrincipalExport ? commands.map(command => ({ commandId: command.commandId, resolve: source[item.reactionPrincipalExport] })) : [],
      ui: item.authoring ? await Promise.all(((await readJson(path.join(root, 'authoring.json'))).uiFiles ?? []).map(file => readJson(path.join(root, file)))) : [] });
  }
  return Object.freeze({ formatVersion: 1, providers: Object.freeze(providers), byId: new Map(providers.map(provider => [provider.id, provider])) });
}

export function lockForTrustedModule(catalog, campaignId, moduleId) {
  const module = catalog.byId.get(moduleId);
  if (!module) fail(`module ${moduleId} is not on the trusted allowlist`);
  const rootRef = { id: module.id, apiVersion: '1.0.0', implementationVersion: module.version, digest: module.digest };
  const entries = new Map([[rootRef.id, rootRef], ...module.moduleRefs.map(ref => [ref.id, { id: ref.id, apiVersion: ref.apiVersion, implementationVersion: ref.implementationVersion, digest: ref.digest }])]);
  const lock = { lockVersion: 1, campaignId, rootModule: { id: module.id, version: module.version, digest: module.digest }, entries: [...entries.values()].map(ref => ({ ...ref, source: 'bundled', optional: false })) };
  if (module.capabilities) {
    const requiredIds = new Set(module.capabilities.flatMap(capability => capability.requires.filter(requirement => !requirement.optional).map(requirement => requirement.id)));
    for (const id of requiredIds) if (!entries.has(id)) fail(`${module.id}: capability closure is missing ${id}`);
  }
  return lock;
}
