#!/usr/bin/env node
// Development-only validator for trusted bundled V2 module source.
// Importing an entry executes it. Never use this tool on downloaded/untrusted code.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { CapabilityRegistry, validateCapabilityManifest } from '../packages/module-registry/src/v2.ts';
import { validateV2SchemaDefinition } from '../server/host/v2-effects.mjs';

const fail = message => { throw new Error(message); };
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const digestPattern = /^sha256:[0-9a-f]{64}$/;
export const canonicalFileDigest = async (root, files, normalizeDigests = true) => {
  if (!Array.isArray(files) || !files.length || files.some(file => typeof file !== 'string' || path.isAbsolute(file) || file.split(/[\\/]/).includes('..'))) fail('digestFiles must be a non-empty safe list of relative paths');
  const normalized = [];
  for (const file of files) {
    let content = (await readFile(path.join(root, file), 'utf8')).replace(/\r\n/g, '\n');
    if (normalizeDigests) content = content.replace(/sha256:[0-9a-f]{64}/g, 'sha256:<content-digest>');
    normalized.push(content);
  }
  return `sha256:${createHash('sha256').update(normalized.join('\n')).digest('hex')}`;
};
const refKey = ref => `${ref.id}@${ref.apiVersion}@${ref.implementationVersion}@${ref.digest}`;
export const assertCapabilityRef = (ref, known, where = 'reference') => {
  if (!ref || !known.has(refKey(ref))) fail(`${where} has unresolved capability reference ${ref?.id ?? '<missing>'}`);
};
export const validateAuthoringSchema = (schema, where = '$schema') => { try { validateV2SchemaDefinition(schema, where); } catch (error) { fail(`${where}: ${error.message}`); } };
const checkSchema = validateAuthoringSchema;
const walkJson = (value, where) => {
  if (!value || typeof value !== 'object') return;
  if (value.type && ['object','array','string','integer','number','boolean'].includes(value.type)) checkSchema(value, where);
  if (Array.isArray(value)) value.forEach((child, index) => walkJson(child, `${where}[${index}]`));
  else for (const [key, child] of Object.entries(value)) walkJson(child, `${where}.${key}`);
};

export function resolveCapabilityLock(capabilities, campaignId, rootId, rootVersion) {
  if (!Array.isArray(capabilities)) fail('capabilities must be an array');
  const seen = new Set();
  const registry = new CapabilityRegistry();
  for (const value of capabilities) {
    const cap = validateCapabilityManifest(value);
    const identity = `${cap.id}@${cap.implementationVersion}`;
    if (seen.has(identity)) fail(`duplicate capability ${identity}`);
    seen.add(identity);
    registry.register(cap, () => true);
  }
  const result = registry.resolve(campaignId, rootId, rootVersion);
  if (result.status !== 'resolved' || !result.lock) fail(`capability closure ${result.status}: ${result.diagnostics.join('; ') || JSON.stringify(result.missing)}`);
  return result.lock;
}

export async function validateModule(root) {
  root = path.resolve(typeof root === 'string' ? root : fileURLToPath(root));
  const [manifest, authoring] = await Promise.all([json(path.join(root, 'manifest.json')), json(path.join(root, 'authoring.json'))]);
  if (manifest.formatVersion !== 2 || typeof manifest.id !== 'string' || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(manifest.id) || !/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.trust !== 'bundled-trusted' || typeof manifest.entry !== 'string') fail('manifest must declare formatVersion 2, namespaced id, semver version, trust bundled-trusted, and entry');
  if (path.isAbsolute(manifest.entry) || manifest.entry.split(/[\\/]/).includes('..')) fail('manifest entry must be a safe relative path');
  if (!Array.isArray(authoring.digestFiles) || !authoring.digestFiles.includes('manifest.json') || !authoring.digestFiles.includes(manifest.entry) || !digestPattern.test(authoring.contentDigest)) fail('authoring.json must list manifest.json and entry in digestFiles and declare a sha256 contentDigest');
  if (!(authoring.uiFiles ?? []).every(file => authoring.digestFiles.includes(file))) fail('every UI contribution file must be covered by digestFiles');
  if (!authoring.legacyBundledReferences && !authoring.digestFiles.includes(authoring.capabilitiesFile ?? 'capabilities.json')) fail('capabilitiesFile must be covered by digestFiles');
  const contentDigest = await canonicalFileDigest(root, authoring.digestFiles, !authoring.legacyBundledReferences);
  if (contentDigest !== authoring.contentDigest) fail(`content digest mismatch: expected ${authoring.contentDigest}, computed ${contentDigest}`);
  let rootDigest = contentDigest;
  if (authoring.legacyBundledReferences) {
    if (!digestPattern.test(authoring.hostDigest) || !Array.isArray(authoring.hostDigestFiles)) fail('legacy authoring sidecar must record hostDigest and hostDigestFiles');
    rootDigest = await canonicalFileDigest(root, authoring.hostDigestFiles, false);
    if (rootDigest !== authoring.hostDigest) fail(`historical host digest mismatch: expected ${authoring.hostDigest}, computed ${rootDigest}`);
  }
  let capabilities;
  try { capabilities = await json(path.join(root, authoring.capabilitiesFile ?? 'capabilities.json')); }
  catch (error) {
    if (!authoring.legacyBundledReferences || error.code !== 'ENOENT') throw error;
    // Compatibility adapter for the two pre-spec bundled examples: their host lock
    // was historically assembled from refs exported by trusted source, not manifests.
    capabilities = undefined;
  }
  const entryUrl = pathToFileURL(path.join(root, manifest.entry)).href;
  // Explicitly trusted author code only. This is not a sandbox or safe inspection of untrusted modules.
  const source = await import(entryUrl);
  if (!capabilities) {
    const refs = new Map();
    for (const exported of Object.values(source)) {
      const candidates = exported && typeof exported === 'object' && !Array.isArray(exported) ? Object.values(exported) : [exported];
      for (const value of candidates) if (value && typeof value === 'object' && typeof value.id === 'string' && typeof value.apiVersion === 'string' && typeof value.implementationVersion === 'string' && typeof value.digest === 'string') {
        const identity = `${value.id}@${value.implementationVersion}`;
        if (refs.has(identity) && refKey(refs.get(identity)) !== refKey(value)) fail(`duplicate capability identity ${identity}`);
        refs.set(identity, value);
      }
    }
    const dependencies = [...refs.values()].map(ref => ({ id: ref.id, apiRange: `=${ref.apiVersion}`, optional: false }));
    capabilities = [{ formatVersion: 2, id: manifest.id, api: { id: manifest.id, apiVersion: '1.0.0' }, implementationVersion: manifest.version, digest: rootDigest, kind: 'module', provides: [{ id: manifest.id, apiVersion: '1.0.0' }], requires: dependencies, trust: 'bundled-trusted' }, ...[...refs.values()].map(ref => ({ formatVersion: 2, id: ref.id, api: { id: ref.id, apiVersion: ref.apiVersion }, implementationVersion: ref.implementationVersion, digest: ref.digest, kind: 'library', provides: [{ id: ref.id, apiVersion: ref.apiVersion }], requires: [], trust: 'bundled-trusted' }))];
  }
  if (!Array.isArray(capabilities) || !capabilities.length) fail('capabilities file must be a non-empty array');
  const byIdentity = new Map();
  for (const value of capabilities) {
    const cap = validateCapabilityManifest(value);
    const key = `${cap.id}@${cap.implementationVersion}`;
    if (byIdentity.has(key)) fail(`duplicate capability ${key}`);
    byIdentity.set(key, cap);
  }
  const rootCapability = byIdentity.get(`${manifest.id}@${manifest.version}`);
  if (!rootCapability || rootCapability.digest !== rootDigest || rootCapability.kind !== 'module') fail('capabilities must contain the module root with matching version and root digest');
  if (!authoring.legacyBundledReferences) {
    const external = new Set(authoring.externalCapabilities ?? []);
    for (const capability of capabilities) if (!external.has(capability.id) && capability.digest !== contentDigest) fail(`module-owned capability ${capability.id} must use the verified package content digest`);
    for (const id of external) if (![...byIdentity.keys()].some(key => key.startsWith(`${id}@`))) fail(`external capability ${id} is not declared in capabilities`);
  }
  const lock = resolveCapabilityLock(capabilities, 'authoring-validation', manifest.id, manifest.version);

  const exports = Object.values(source);
  const arrays = exports.filter(Array.isArray).flat();
  const objects = exports.filter(value => value && typeof value === 'object' && !Array.isArray(value));
  const entities = [...objects, ...arrays].filter(value => value && typeof value.typeId === 'string' && value.schema);
  const commands = arrays.filter(value => value && typeof value.commandId === 'string' && value.resolver && value.inputSchema);
  const resolvers = arrays.filter(value => value && value.ref && typeof value.resolve === 'function');
  const handlers = arrays.filter(value => value && value.id && value.payloadSchema && typeof value.apply === 'function');
  if (!entities.length || !commands.length || !resolvers.length || !handlers.length) fail('entry exports must include at least one entity, command, resolver and effect handler descriptor');
  const knownCapabilities = new Set(capabilities.map(cap => refKey({ id: cap.id, apiVersion: cap.api.apiVersion, implementationVersion: cap.implementationVersion, digest: cap.digest })));
  const checkRef = (ref, where) => assertCapabilityRef(ref, knownCapabilities, where);
  for (const entity of entities) { checkRef(entity.capability, `entity ${entity.typeId}`); checkSchema(entity.schema, `entity ${entity.typeId} schema`); }
  const resolverRefs = new Set(resolvers.map(resolver => refKey(resolver.ref)));
  const handlerRefs = new Set(handlers.map(refKey));
  const entityTypes = new Set(entities.map(entity => entity.typeId));
  for (const command of commands) {
    checkRef(command.capability, `command ${command.commandId}`);
    if (!entityTypes.has(command.entityTypeId)) fail(`command ${command.commandId} references unknown entity ${command.entityTypeId}`);
    if (!resolverRefs.has(refKey(command.resolver))) fail(`command ${command.commandId} references an unresolved resolver`);
    checkSchema(command.inputSchema, `command ${command.commandId} input`);
    if (command.resultSchema) checkSchema(command.resultSchema, `command ${command.commandId} result`);
    for (const ref of command.effects ?? []) if (!handlerRefs.has(refKey(ref))) fail(`command ${command.commandId} references an unresolved effect handler ${ref.id}`);
  }
  for (const resolver of resolvers) checkRef(resolver.ref, `resolver ${resolver.ref.id}`);
  for (const handler of handlers) { checkRef(handler, `effect handler ${handler.id}`); checkSchema(handler.payloadSchema, `handler ${handler.id} payload`); checkSchema(handler.eventSchema, `handler ${handler.id} event`); }
  for (const file of authoring.uiFiles ?? []) walkJson(await json(path.join(root, file)), file);
  return { id: manifest.id, version: manifest.version, contentDigest, rootDigest, capabilities: capabilities.length, externalCapabilities: authoring.externalCapabilities?.length ?? 0, lock, entities: entities.length, commands: commands.length, resolvers: resolvers.length, effectHandlers: handlers.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2); if (args[0] === '--') args.shift();
    const [command, ...rest] = args;
    if (command === 'validate' && rest.length === 1) process.stdout.write(`${JSON.stringify(await validateModule(rest[0]), null, 2)}\n`);
    else if (command === 'digest' && rest.length === 1) {
      const root = path.resolve(rest[0]); const authoring = await json(path.join(root, 'authoring.json'));
      process.stdout.write(`${await canonicalFileDigest(root, authoring.digestFiles, !authoring.legacyBundledReferences)}\n`);
    }
    else fail('usage: node --experimental-strip-types scripts/v2-module.mjs validate <module-dir> | digest <module-dir>');
  } catch (error) { console.error(`V2 module validation failed: ${error.message}`); process.exitCode = 1; }
}
