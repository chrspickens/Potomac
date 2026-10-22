import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadTrustedV2Catalog, lockForTrustedModule } from '../server/host/v2-catalog.mjs';
import { canonicalFileDigest, validateModule } from './v2-module.mjs';

test('catalog and authoring validator agree on all seven bundled modules and exact roots', async () => {
  const catalog = await loadTrustedV2Catalog();
  for (const directory of ['example.starship/v2', 'example.revised5e/v2', 'example.interruption/v2', 'example.dicepool/v2', 'module-starter/v2', 'example.generic-entity-setup/v2', 'tides-omens/v2']) {
    const validated = await validateModule(join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', directory));
    const registered = catalog.byId.get(validated.id);
    assert.ok(registered, `${validated.id} is in the trusted catalog`);
    assert.equal(registered.version, validated.version);
    assert.equal(registered.digest, validated.rootDigest);
    assert.deepEqual(lockForTrustedModule(catalog, 'campaign-contract', validated.id).entries.map(item => `${item.id}@${item.implementationVersion}:${item.digest}`).sort(), validated.lock.entries.map(item => `${item.id}@${item.implementationVersion}:${item.digest}`).sort());
  }
  assert.deepEqual(new Set(catalog.providers.map(item => item.id)), new Set(['example.starship.system', 'example.revised5e', 'example.interruption', 'example.dicepool', 'example.starter', 'example.generic-entity-setup', 'example.tides-omens']));
  for (const [moduleId, contributionId] of [['example.revised5e', 'example.revised5e.combat'], ['example.dicepool', 'example.dicepool.scene-ui']]) {
    const provider = catalog.byId.get(moduleId);
    assert.deepEqual(provider.ui.map(item => item.contributionId), [contributionId], `${moduleId} authored contribution is present in the trusted catalog`);
    assert.ok(provider.ui[0].nodes.length > 0 && provider.ui[0].commands.length > 0);
    assert.equal(provider.preparation.length, 1, `${moduleId} has one exact-digest-bound guided preparation profile`);
    assert.equal(provider.preparation[0].entityTypeId, provider.entities[0].typeId);
  }
});

test('guided preparation catalog refuses stale module digest bindings', async () => {
  const directory = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), '..', 'server/host', '.preparation-test-'));
  const catalogFile = join(directory, 'catalog.json'); const moduleSource = join(directory, 'module');
  try {
    await cp(join(dirname(fileURLToPath(import.meta.url)), '..', 'examples/example.revised5e/v2'), moduleSource, { recursive: true });
    const preparationPath = join(moduleSource, 'preparation.json'); const profile = JSON.parse(await readFile(preparationPath, 'utf8'));
    profile.moduleDigest = `sha256:${'0'.repeat(64)}`; await writeFile(preparationPath, JSON.stringify(profile, null, 2) + '\n');
    const preparationDigest = await canonicalFileDigest(moduleSource, ['preparation.json'], false);
    await writeFile(catalogFile, JSON.stringify({ formatVersion: 1, modules: [{ id: 'example.revised5e', version: '1.3.0', source: './module', entry: 'extensions.mjs', authoring: true, intentAuthorizerExport: 'revised5eAuthorizeIntent', creationValidatorExport: 'revised5eValidateCreation', creationValidatorEntityType: 'example.revised5e.encounter', preparationFile: 'preparation.json', preparationDigest }] }));
    await assert.rejects(loadTrustedV2Catalog({ catalogFile }), /preparation metadata does not match the exact trusted module digest/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('catalog rejects duplicate identities, conflicting versions, missing local source and unlisted pins with actionable errors', async () => {
  const catalog = await loadTrustedV2Catalog();
  assert.throws(() => lockForTrustedModule(catalog, 'campaign', 'example.not-listed'), /not on the trusted allowlist/);
  const directory = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), '..', 'server/host', '.catalog-test-'));
  const file = join(directory, 'catalog.json');
  try {
    const starter = { id: 'example.starter', version: '1.0.0', source: '../../../examples/module-starter/v2', entry: 'extensions.mjs', authoring: true };
    const duplicate = { formatVersion: 1, modules: [starter, { ...starter, version: '2.0.0' }] };
    await writeFile(file, JSON.stringify(duplicate));
    await assert.rejects(loadTrustedV2Catalog({ catalogFile: file }), /duplicate module id/);
    const conflict = { formatVersion: 1, modules: [starter, starter] };
    await writeFile(file, JSON.stringify(conflict));
    await assert.rejects(loadTrustedV2Catalog({ catalogFile: file }), /duplicate module id/);
    const unavailable = { formatVersion: 1, modules: [{ id: 'example.missing', version: '1.0.0', source: '../../../missing-module-v2-catalog-test', entry: 'extensions.mjs', legacyDigestFiles: ['extensions.mjs'] }] };
    await writeFile(file, JSON.stringify(unavailable));
    await assert.rejects(loadTrustedV2Catalog({ catalogFile: file }), /unavailable or invalid/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('catalog refuses to silently omit authored UI outside the bounded contribution contract', async () => {
  const directory = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), '..', 'server/host', '.catalog-ui-test-'));
  const moduleSource = join(directory, 'module');
  try {
    await cp(join(dirname(fileURLToPath(import.meta.url)), '..', 'examples/example.dicepool/v2'), moduleSource, { recursive: true });
    const uiPath = join(moduleSource, 'ui/scene.json');
    const ui = JSON.parse(await readFile(uiPath, 'utf8'));
    delete ui.nodes; delete ui.commands;
    ui.fields = [{ path: 'title', label: 'Scene', control: 'text', readOnly: true }];
    ui.actions = [{ commandId: 'example.dicepool.skill-challenge', label: 'Resolve skill challenge' }];
    await writeFile(uiPath, JSON.stringify(ui, null, 2) + '\n');
    const authoringPath = join(moduleSource, 'authoring.json');
    const authoring = JSON.parse(await readFile(authoringPath, 'utf8'));
    authoring.contentDigest = await canonicalFileDigest(moduleSource, authoring.digestFiles, false);
    authoring.hostDigest = await canonicalFileDigest(moduleSource, authoring.hostDigestFiles, false);
    await writeFile(authoringPath, JSON.stringify(authoring, null, 2) + '\n');
    const catalogFile = join(directory, 'catalog.json');
    await writeFile(catalogFile, JSON.stringify({ formatVersion: 1, modules: [{ id: 'example.dicepool', version: '1.1.0', source: './module', entry: 'extensions.mjs', authoring: true }] }));
    await assert.rejects(loadTrustedV2Catalog({ catalogFile }), /bounded nodes\/commands contract/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
