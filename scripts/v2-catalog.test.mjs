import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadTrustedV2Catalog, lockForTrustedModule } from '../server/host/v2-catalog.mjs';
import { validateModule } from './v2-module.mjs';

test('catalog and authoring validator agree on all six bundled modules and exact roots', async () => {
  const catalog = await loadTrustedV2Catalog();
  for (const directory of ['example.starship/v2', 'example.revised5e/v2', 'example.interruption/v2', 'example.dicepool/v2', 'module-starter/v2', 'example.generic-entity-setup/v2']) {
    const validated = await validateModule(join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', directory));
    const registered = catalog.byId.get(validated.id);
    assert.ok(registered, `${validated.id} is in the trusted catalog`);
    assert.equal(registered.version, validated.version);
    assert.equal(registered.digest, validated.rootDigest);
    assert.deepEqual(lockForTrustedModule(catalog, 'campaign-contract', validated.id).entries.map(item => `${item.id}@${item.implementationVersion}:${item.digest}`).sort(), validated.lock.entries.map(item => `${item.id}@${item.implementationVersion}:${item.digest}`).sort());
  }
  assert.deepEqual(new Set(catalog.providers.map(item => item.id)), new Set(['example.starship.system', 'example.revised5e', 'example.interruption', 'example.dicepool', 'example.starter', 'example.generic-entity-setup']));
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
