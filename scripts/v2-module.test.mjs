import { strict as assert } from 'node:assert';
import test from 'node:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertCapabilityRef, canonicalFileDigest, resolveCapabilityLock, validateAuthoringSchema, validateModule } from './v2-module.mjs';

test('the public authoring validator accepts the current Revised 5e and dice-pool bundles', async () => {
  const expected = { 'example.revised5e': 'sha256:c7a4b28a88161825b8f788cb4290388084cb168900778734fc02876508c95192', 'example.dicepool': 'sha256:6920a4b162ed3ad2a80d9444f282cd63fcdbf32a1c2ef9f4e3e4072b3ea519cc' };
  for (const [name, folder] of [['example.revised5e', 'example.revised5e'], ['example.dicepool', 'example.dicepool'], ['example.starter', 'module-starter']]) {
    const result = await validateModule(new URL(`../examples/${folder}/v2`, import.meta.url));
    const authoring = JSON.parse(await readFile(new URL(`../examples/${folder}/v2/authoring.json`, import.meta.url), 'utf8'));
    assert.equal(result.id, name);
    assert.match(result.contentDigest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(result.contentDigest, authoring.contentDigest);
    assert.equal(result.rootDigest, authoring.legacyBundledReferences ? authoring.hostDigest : authoring.contentDigest);
    if (expected[name]) assert.equal(result.rootDigest, expected[name], `${name} authored package and exact root digest match`);
    assert.ok(result.entities > 0 && result.commands > 0 && result.resolvers > 0 && result.effectHandlers > 0);
    assert.ok(result.lock.entries.length > 1);
  }
});

test('schema contract rejects unsupported keywords and malformed schema definitions', () => {
  assert.doesNotThrow(() => validateAuthoringSchema({ type: 'object', properties: { count: { type: 'integer', minimum: 0 } }, required: ['count'], additionalProperties: false }));
  assert.throws(() => validateAuthoringSchema({ type: 'string', pattern: '.*' }), /unsupported schema keyword pattern/);
  assert.throws(() => validateAuthoringSchema({ type: 'array' }), /items is required/);
  assert.throws(() => validateAuthoringSchema({ type: 'object', properties: {}, required: ['missing'] }), /undeclared property/);
  assert.throws(() => assertCapabilityRef({ id: 'example.missing', apiVersion: '1.0.0', implementationVersion: '1.0.0', digest: `sha256:${'0'.repeat(64)}` }, new Set(), 'command'), /unresolved capability reference/);
});

test('capability lock construction rejects duplicate IDs and missing transitive dependencies', () => {
  const d = n => `sha256:${String(n).repeat(64).slice(0, 64)}`;
  const cap = (id, digest, requires = []) => ({ formatVersion: 2, id, api: { id, apiVersion: '1.0.0' }, implementationVersion: '1.0.0', digest, kind: 'library', provides: [{ id, apiVersion: '1.0.0' }], requires, trust: 'bundled-trusted' });
  const root = { ...cap('example.root', d('a'), [{ id: 'example.dep', apiRange: '=1.0.0', optional: false }]), kind: 'module' };
  assert.equal(resolveCapabilityLock([root, cap('example.dep', d('b'))], 'test-campaign', root.id, '1.0.0').entries.length, 2);
  assert.throws(() => resolveCapabilityLock([root, root], 'c', root.id, '1.0.0'), /duplicate capability/);
  assert.throws(() => resolveCapabilityLock([root], 'c', root.id, '1.0.0'), /missing/);
});

test('canonical digest uses the declared order, normalized line endings, and rejects traversal', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'v2-module-digest-'));
  try {
    await writeFile(path.join(dir, 'a.txt'), 'alpha\r\n'); await writeFile(path.join(dir, 'b.txt'), 'beta\n');
    assert.equal(await canonicalFileDigest(dir, ['a.txt', 'b.txt']), await canonicalFileDigest(dir, ['a.txt', 'b.txt']));
    assert.notEqual(await canonicalFileDigest(dir, ['a.txt', 'b.txt']), await canonicalFileDigest(dir, ['b.txt', 'a.txt']));
    await assert.rejects(canonicalFileDigest(dir, ['../escape']), /safe list/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('malformed manifest and content digest mismatch fail with actionable errors', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'v2-module-invalid-'));
  try {
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ formatVersion: 1 }));
    await writeFile(path.join(dir, 'authoring.json'), JSON.stringify({ digestFiles: ['manifest.json', 'capabilities.json', 'extensions.mjs'], contentDigest: `sha256:${'0'.repeat(64)}` }));
    await writeFile(path.join(dir, 'capabilities.json'), '[]');
    await writeFile(path.join(dir, 'extensions.mjs'), '');
    await assert.rejects(validateModule(dir), /manifest must declare/);
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ formatVersion: 2, id: 'example.bad', name: 'Bad', version: '1.0.0', trust: 'bundled-trusted', entry: 'extensions.mjs' }));
    await assert.rejects(validateModule(dir), /digest mismatch/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('malformed source fixtures fail on unsupported schema keywords and unresolved resolver refs', async () => {
  const sourceDir = new URL('../examples/module-starter/v2', import.meta.url);
  const prepare = async (mutation) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'v2-module-contract-'));
    await cp(sourceDir, dir, { recursive: true });
    const entry = path.join(dir, 'extensions.mjs');
    await writeFile(entry, mutation(await readFile(entry, 'utf8')));
    const capsPath = path.join(dir, 'capabilities.json');
    const caps = JSON.parse(await readFile(capsPath, 'utf8'));
    const placeholder = `sha256:${'0'.repeat(64)}`;
    for (const cap of caps) cap.digest = placeholder;
    await writeFile(capsPath, JSON.stringify(caps));
    // Refs in source are digest-normalized for hashing, but must agree with the catalog.
    await writeFile(entry, (await readFile(entry, 'utf8')).replace(/sha256:[0-9a-f]{64}/g, placeholder));
    const authoringPath = path.join(dir, 'authoring.json');
    const authoring = JSON.parse(await readFile(authoringPath, 'utf8'));
    const digest = await canonicalFileDigest(dir, authoring.digestFiles);
    authoring.contentDigest = digest;
    await writeFile(authoringPath, JSON.stringify(authoring));
    for (const cap of caps) cap.digest = digest;
    await writeFile(capsPath, JSON.stringify(caps));
    await writeFile(entry, (await readFile(entry, 'utf8')).replace(/sha256:[0-9a-f]{64}/g, digest));
    return dir;
  };
  const badSchema = await prepare(source => source.replace("type: 'integer'", "type: 'integer', pattern: 'x'"));
  const badRef = await prepare(source => source.replace('resolver: refs.resolver, effects:', "resolver: { ...refs.resolver, id: 'example.missing-resolver' }, effects:"));
  try {
    assert.match(await readFile(path.join(badSchema, 'extensions.mjs'), 'utf8'), /pattern: 'x'/);
    await assert.rejects(validateModule(badSchema), /unsupported schema keyword pattern/);
    await assert.rejects(validateModule(badRef), /unresolved resolver/);
  } finally { await rm(badSchema, { recursive: true, force: true }); await rm(badRef, { recursive: true, force: true }); }
});
