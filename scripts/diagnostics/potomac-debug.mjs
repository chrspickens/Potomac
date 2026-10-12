#!/usr/bin/env node
// Agent-facing diagnostics for the localhost Potomac foundation host.
// No production credentials, debug endpoints, or campaign DB writes are required.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHost } from '../../server/host/index.mjs';

const emit = (type, data = {}) => process.stdout.write(JSON.stringify({ type, ...data }) + '\n');

function help() {
  process.stdout.write([
    'Potomac agent/debug CLI (Node 22.5+)',
    '',
    '  node scripts/diagnostics/potomac-debug.mjs smoke',
    '      Start an isolated localhost host with a temporary SQLite DB;',
    '      test modules, permissions, rules, events, retries and SSE replay.',
    '  node scripts/diagnostics/potomac-debug.mjs doctor [--role player|gm] [--url URL]',
    '      Check a running host and print a redacted, machine-readable summary.',
    '  node scripts/diagnostics/potomac-debug.mjs watch [--role player|gm] [--url URL]',
    '      Follow authorized host events as NDJSON; reconnect automatically.',
    '      Optional: --since now|CURSOR (default now), --limit N (default unlimited).',
    '',
    '  URL defaults to http://127.0.0.1:4177. Only loopback URLs are permitted.',
    '  Authentication: POTOMAC_GM_TOKEN / POTOMAC_PLAYER_TOKEN environment variables.',
    '  The built-in local-gm and local-player fallbacks are for development only.',
    '  Stdout: one JSON object per line; nonzero exit status on errors.',
    '',
  ].join('\n'));
}

function parseArgs(argv) {
  const command = argv[0] || 'help';
  const options = {};
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--') continue;
    if (!key.startsWith('--')) throw new Error('Unexpected argument: ' + key);
    if (key === '--help') return { command: 'help', options: {} };
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error('Missing value for ' + key);
    if (!['--url', '--role', '--since', '--limit'].includes(key)) throw new Error('Unknown flag: ' + key);
    options[key.slice(2)] = value;
  }
  return { command: command === '--help' ? 'help' : command, options };
}

function hostUrl(options) {
  const url = new URL(options.url || process.env.POTOMAC_HOST_URL || 'http://127.0.0.1:4177');
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Diagnostics only accept a loopback HTTP host URL (no credentials or path)');
  }
  return url;
}

function authToken(role) {
  if (!['gm', 'player'].includes(role)) throw new Error('Role must be gm or player');
  return role === 'gm' ? (process.env.POTOMAC_GM_TOKEN || 'local-gm') : (process.env.POTOMAC_PLAYER_TOKEN || 'local-player');
}

async function request(base, path, { token, method = 'GET', body } = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

function requiredStatus(actual, code, label) {
  assert.equal(actual.status, code, label + ': ' + JSON.stringify(actual.payload).slice(0, 250));
  return actual.payload;
}

async function doctor(options) {
  const base = hostUrl(options);
  const role = options.role || 'player';
  const token = authToken(role);
  const health = await request(base, '/health');
  requiredStatus(health, 200, 'Host health');
  assert.equal(health.payload.ok, true, 'Host reported unhealthy');
  const state = requiredStatus(await request(base, '/api/state', { token }), 200, 'Authorized state');
  assert.equal(state.role, role, 'Unexpected authorization projection');
  assert.ok(Array.isArray(state.modules) && Array.isArray(state.actors), 'Invalid host state');
  emit('doctor', {
    ok: true, host: base.origin, role, campaignId: state.campaignId,
    cursor: state.revision, moduleIds: state.modules.map(item => item.id),
    actorCount: state.actors.length, eventCount: state.events?.length || 0,
    note: 'Read-only diagnostics; no campaign data modified',
  });
}

async function smoke() {
  const dir = await mkdtemp(join(tmpdir(), 'potomac-smoke-'));
  const gm = randomUUID();
  const player = randomUUID();
  let host;
  let checks = 0;
  let passed = false;
  const check = async (name, work) => {
    const start = performance.now();
    try {
      await work();
      checks++;
      emit('check', { name, ok: true, durationMs: Math.round(performance.now() - start) });
    } catch (error) {
      emit('check', { name, ok: false, error: error.message });
      throw error;
    }
  };
  try {
    host = createHost({
      databasePath: join(dir, 'experiment.sqlite'),
      campaignId: 'agent-smoke-' + randomUUID(),
      gmToken: gm, playerToken: player,
    });
    const address = await host.listen(0, '127.0.0.1');
    const base = new URL('http://127.0.0.1:' + address.port + '/');
    const get = (path, token) => request(base, path, { token });
    const post = (path, token, body) => request(base, path, { token, method: 'POST', body });
    const actorA = 'smoke-a-' + randomUUID();
    const actorB = 'smoke-b-' + randomUUID();
    let cursorBeforeActions = 0;
    let aRevision = 1;

    await check('host-health-and-authentication', async () => {
      assert.equal(requiredStatus(await get('/health'), 200, 'health').ok, true);
      requiredStatus(await get('/api/state'), 401, 'unauthenticated state');
      requiredStatus(await post('/api/context', player, { context: { activeEncounter: 'unauthorized' } }), 403, 'player context write');
    });

    await check('two-different-game-modules', async () => {
      const state = requiredStatus(await get('/api/state', gm), 200, 'initial state');
      const ids = new Set(state.modules.map(item => item.id));
      assert.ok(ids.has('example.system-a') && ids.has('example.system-b'));
    });

    await check('create-and-filter-characters', async () => {
      requiredStatus(await post('/api/actors', gm, {
        id: actorA, moduleId: 'example.system-a', moduleVersion: '0.1.0',
        data: {
          name: 'Smoke Mage', secretNote: 'GM-SMOKE-SECRET',
          attributes: { strength: 14, intelligence: 12 },
          resources: { hp: { current: 10, maximum: 12 }, mana: { current: 2, maximum: 4 } },
        },
        visibility: { gmOnly: ['secretNote'] },
      }), 201, 'System A character');
      requiredStatus(await post('/api/actors', gm, {
        id: actorB, moduleId: 'example.system-b', moduleVersion: '0.1.0',
        data: {
          name: 'Smoke Wanderer',
          traits: { agility: 2, instinct: 3 },
          resources: { stress: { current: 1, maximum: 6 }, hope: { current: 3, maximum: 6 } },
        },
      }), 201, 'System B character');
      const gmState = requiredStatus(await get('/api/state', gm), 200, 'GM projection');
      const playerState = requiredStatus(await get('/api/state', player), 200, 'player projection');
      assert.equal(gmState.actors.find(a => a.id === actorA).data.secretNote, 'GM-SMOKE-SECRET');
      assert.equal(playerState.actors.find(a => a.id === actorA).data.secretNote, undefined);
      assert.equal(playerState.actors.length, 2);
      cursorBeforeActions = playerState.revision;
    });

    await check('role-protected-shared-context', async () => {
      requiredStatus(await post('/api/context', gm, { context: { activeEncounter: 'encounter-a' } }), 200, 'GM context');
      const state = requiredStatus(await get('/api/state', player), 200, 'player context');
      assert.equal(state.context.activeEncounter, 'encounter-a');
    });

    await check('validated-action-and-exactly-once-retry', async () => {
      const command = { operationId: randomUUID(), entityId: actorA, baseRevision: aRevision, actionId: 'spend-mana', parameters: {} };
      const first = requiredStatus(await post('/api/actions', player, command), 200, 'action');
      const retry = requiredStatus(await post('/api/actions', player, command), 200, 'idempotent retry');
      assert.deepEqual(retry, first);
      const state = requiredStatus(await get('/api/state', player), 200, 'post-action state');
      const a = state.actors.find(item => item.id === actorA);
      assert.equal(a.data.resources.mana.current, 1);
      assert.equal(a.revision, 2);
      assert.equal(state.events.filter(item => item.payload?.operationId === command.operationId).length, 1);
      aRevision = a.revision;
    });

    await check('stale-revision-rejected', async () => {
      requiredStatus(await post('/api/actions', player, {
        operationId: randomUUID(), entityId: actorA, baseRevision: 1, actionId: 'spend-mana', parameters: {},
      }), 409, 'stale revision');
    });

    await check('second-system-independent-rule', async () => {
      requiredStatus(await post('/api/actions', player, {
        operationId: randomUUID(), entityId: actorB, baseRevision: 1, actionId: 'spend-hope', parameters: {},
      }), 200, 'System B resource change');
      const state = requiredStatus(await get('/api/state', player), 200, 'System B projection');
      assert.equal(state.actors.find(item => item.id === actorB).data.resources.hope.current, 2);
    });

    await check('host-verified-roll-and-event-history', async () => {
      const command = { operationId: randomUUID(), entityId: actorA, baseRevision: aRevision, actionId: 'strength-check', parameters: { difficulty: 12 } };
      const result = requiredStatus(await post('/api/actions', player, command), 200, 'dice action');
      const die = result.resolution?.groups?.[0]?.dice?.[0];
      assert.ok(Number.isInteger(die) && die >= 1 && die <= 20, 'Missing host-generated d20 result');
      const state = requiredStatus(await get('/api/state', gm), 200, 'GM roll history');
      const event = state.events.find(item => item.payload?.operationId === command.operationId);
      assert.equal(event?.payload?.verified, true);
      assert.deepEqual(event.payload.rolls, [die]);
    });

    await check('sse-event-replay', async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(new URL('/api/stream?since=' + cursorBeforeActions, base), {
          headers: { authorization: 'Bearer ' + player }, signal: controller.signal,
        });
        assert.equal(response.status, 200);
        const reader = response.body.getReader();
        const chunk = await reader.read();
        assert.equal(chunk.done, false, 'Expected replayed event');
        assert.match(new TextDecoder().decode(chunk.value), /event: update/);
        await reader.cancel();
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
    });

    passed = true;
  } finally {
    if (host) host.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
  if (passed) emit('summary', { command: 'smoke', status: 'pass', checks, temporaryDatabaseDeleted: true });
}

async function watch(options) {
  const base = hostUrl(options);
  const role = options.role || 'player';
  const token = authToken(role);
  const limit = options.limit === undefined ? 0 : Number(options.limit);
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('--limit must be a non-negative integer');
  const initial = options.since === undefined ? 'now' : options.since;
  let cursor;
  if (initial === 'now') {
    const state = requiredStatus(await request(base, '/api/state', { token }), 200, 'Initial cursor');
    cursor = state.revision;
  } else {
    cursor = Number(initial);
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('--since must be now or a non-negative cursor');
  }
  let count = 0;
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  emit('watch-start', { role, host: base.origin, since: cursor });
  try {
    while (!controller.signal.aborted) {
      try {
        const response = await fetch(new URL('/api/stream?since=' + cursor, base), {
          headers: { authorization: 'Bearer ' + token }, signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error('SSE stream returned HTTP ' + response.status);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() || '';
          for (const block of blocks) {
            if (!/^event: update$/m.test(block)) continue;
            const id = block.match(/^id: (\d+)$/m)?.[1];
            const data = block.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
            if (!id || !data) continue;
            const next = Number(id);
            if (next <= cursor) continue;
            const event = JSON.parse(data);
            cursor = next;
            emit('event', { cursor, event });
            count++;
            if (limit > 0 && count >= limit) {
              controller.abort();
              break;
            }
          }
        }
      } catch (error) {
        if (controller.signal.aborted) break;
        emit('reconnect', { cursor, error: error.message });
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    emit('watch-stop', { cursor, events: count });
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === 'help') return help();
  if (command === 'smoke') return smoke();
  if (command === 'doctor') return doctor(options);
  if (command === 'watch') return watch(options);
  throw new Error('Unknown command: ' + command + '. Run with --help.');
}

main().catch(error => {
  emit('error', { message: error.message });
  process.exitCode = 1;
});
