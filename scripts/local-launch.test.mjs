import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ensureViteShim, viteShimPath } from './local-launch.mjs';

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
