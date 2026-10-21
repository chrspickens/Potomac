import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ensureViteShim, resetPlaytest, viteShimPath } from './local-launch.mjs';

async function withDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), 'potomac-local-launch-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('Vite shim path uses the Windows command shim name', () => {
  assert.match(viteShimPath('C:/potomac', 'win32'), /\.bin[\\/]vite\.CMD$/);
});

test('a missing Vite shim gets one repair attempt and succeeds when restored', async () => withDirectory(async directory => {
  const shim = viteShimPath(directory, 'win32');
  let attempts = 0;
  const result = await ensureViteShim({ repoRoot: directory, platform: 'win32', runInstall: async () => {
    attempts++;
    await mkdir(join(directory, 'clients', 'web', 'node_modules', '.bin'), { recursive: true });
    await writeFile(shim, '@echo off\r\n');
    return { code: 0 };
  } });
  assert.equal(result, shim);
  assert.equal(attempts, 1);
}));

test('a failed Vite shim repair stops after one attempt with an actionable error', async () => withDirectory(async directory => {
  let attempts = 0;
  await assert.rejects(ensureViteShim({ repoRoot: directory, platform: 'win32', runInstall: async () => { attempts++; return { code: 1, detail: 'pnpm exited with code 1' }; } }), /pnpm install --filter @potomac\/web\.\.\./);
  assert.equal(attempts, 1);
}));

test('a successful install that leaves the shim missing is reported after one attempt', async () => withDirectory(async directory => {
  let attempts = 0;
  await assert.rejects(ensureViteShim({ repoRoot: directory, platform: 'win32', runInstall: async () => { attempts++; return { code: 0 }; } }), /still missing/);
  assert.equal(attempts, 1);
}));

test('an existing Vite shim does not invoke repair', async () => withDirectory(async directory => {
  const shim = viteShimPath(directory, 'linux');
  await mkdir(join(directory, 'clients', 'web', 'node_modules', '.bin'), { recursive: true });
  await writeFile(shim, '#!/bin/sh\n');
  let attempts = 0;
  assert.equal(await ensureViteShim({ repoRoot: directory, platform: 'linux', runInstall: async () => { attempts++; return { code: 1 }; } }), shim);
  assert.equal(attempts, 0);
}));

test('reset removes only one playtest ID and preserves neighboring evidence', async () => withDirectory(async directory => {
  const first = '2026-10-21T04-08-52-236Z-dcf68b67';
  const second = '2026-10-21T04-09-18-677Z-12c21940';
  for (const id of [first, second]) {
    await writeFile(join(directory, `${id}.sqlite`), 'database');
    await writeFile(join(directory, `${id}.sqlite-wal`), 'sidecar');
    await mkdir(join(directory, `${id}.sqlite.assets`));
    await writeFile(join(directory, `${id}.sqlite.assets`, 'evidence.txt'), id);
    await mkdir(join(directory, `${id}-browser-profile`));
    await writeFile(join(directory, `${id}-browser-profile`, 'profile.txt'), id);
  }
  await writeFile(join(directory, 'unrelated-evidence.txt'), 'preserve');
  await resetPlaytest(first, { directory, activeCheck: async () => false, profileActiveCheck: async () => false });
  await assert.rejects(stat(join(directory, `${first}.sqlite`)), { code: 'ENOENT' });
  await assert.rejects(stat(join(directory, `${first}.sqlite.assets`)), { code: 'ENOENT' });
  await assert.rejects(stat(join(directory, `${first}-browser-profile`)), { code: 'ENOENT' });
  assert.equal(await readFile(join(directory, `${second}.sqlite.assets`, 'evidence.txt'), 'utf8'), second);
  assert.equal(await readFile(join(directory, 'unrelated-evidence.txt'), 'utf8'), 'preserve');
}));

test('reset refuses an active playtest without removing its files', async () => withDirectory(async directory => {
  const id = '2026-10-21T04-08-52-236Z-dcf68b67';
  await writeFile(join(directory, `${id}.sqlite`), 'database');
  await assert.rejects(resetPlaytest(id, { directory, activeCheck: async () => true, profileActiveCheck: async () => false }), /still running/);
  assert.equal(await readFile(join(directory, `${id}.sqlite`), 'utf8'), 'database');
}));
