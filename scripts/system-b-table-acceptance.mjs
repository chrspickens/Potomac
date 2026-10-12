// Isolated browser acceptance for the generic Table workflow on a fresh System B host.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const chromePath = [process.env.POTOMAC_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
if (!chromePath) throw new Error('Chrome/Edge not found. Set POTOMAC_CHROME to its executable path.');

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  await new Promise((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()));
  return port;
}

const scratch = await mkdtemp(join(tmpdir(), 'potomac-system-b-table-'));
const dbPath = join(scratch, 'fresh.sqlite');
const ports = await Promise.all(Array.from({ length: 4 }, freePort));
const [hostPort, gmWebPort, playerWebPort, debugPort] = ports;
const gmToken = `system-b-gm-${randomUUID()}`;
const unusedPlayerToken = `unused-${randomUUID()}`;
const baseUrl = `http://127.0.0.1:${hostPort}`;
const gmWebUrl = `http://127.0.0.1:${gmWebPort}/`;
const playerWebUrl = `http://127.0.0.1:${playerWebPort}/`;
const children = [];
let browserSocket;
let hostProcess;
let sequence = 0;
const pending = new Map();

function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  children.push({ child, getOutput: () => output });
  return children.at(-1);
}

function startHost() {
  hostProcess = start(process.execPath, [join(root, 'server/host/index.mjs')], {
    env: { ...process.env, PORT: String(hostPort), POTOMAC_DB: dbPath, POTOMAC_GM_TOKEN: gmToken, POTOMAC_PLAYER_TOKEN: unusedPlayerToken, POTOMAC_SEED_DEMO: '0' },
  });
  return hostProcess;
}

async function stopProcess(record) {
  if (!record || record.child.exitCode !== null || record.child.signalCode !== null) return;
  const exited = new Promise(resolvePromise => record.child.once('exit', resolvePromise));
  record.child.kill('SIGTERM');
  await Promise.race([exited, delay(4000)]);
  if (record.child.exitCode === null && record.child.signalCode === null) {
    record.child.kill('SIGKILL');
    await Promise.race([new Promise(resolvePromise => record.child.once('exit', resolvePromise)), delay(1500)]);
  }
}

async function waitFor(url, label, timeoutMs = 30000) {
  const startAt = Date.now();
  let lastError;
  while (Date.now() - startAt < timeoutMs) {
    try { const response = await fetch(url); if (response.ok) return response; lastError = new Error(`HTTP ${response.status}`); }
    catch (error) { lastError = error; }
    await delay(120);
  }
  throw new Error(`${label} did not become ready: ${lastError?.message || 'timeout'}`);
}

function cdp(method, params = {}, sessionId) {
  return new Promise((resolvePromise, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 12000);
    pending.set(id, message => { clearTimeout(timer); message.error ? reject(new Error(`CDP ${method}: ${message.error.message}`)) : resolvePromise(message.result); });
    browserSocket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

async function evaluate(sessionId, expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitForExpression(sessionId, expression, label, timeoutMs = 15000) {
  const startAt = Date.now();
  while (Date.now() - startAt < timeoutMs) {
    try { if (await evaluate(sessionId, expression)) return; } catch {}
    await delay(100);
  }
  const detail = await evaluate(sessionId, "({status:document.querySelector('.status')?.textContent,error:document.querySelector('.error-banner')?.textContent,body:document.body.innerText.slice(0,700)})").catch(() => null);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(detail)}`);
}

async function clickText(sessionId, text, selector = 'button') {
  const clicked = await evaluate(sessionId, `(() => { const item=[...document.querySelectorAll(${JSON.stringify(selector)})].find(element=>element.textContent.trim().includes(${JSON.stringify(text)})); if(!item || item.disabled) return false; item.click(); return true })()`);
  assert.equal(clicked, true, `Enabled ${selector} containing “${text}” exists`);
}

async function request(path, token, init = {}) {
  return fetch(`${baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } });
}

async function jsonRequest(path, token, init = {}) {
  const response = await request(path, token, init);
  const body = await response.json();
  assert.ok(response.ok, `${init.method || 'GET'} ${path} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function openBrowserClient(contextId, role, url) {
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId: contextId });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Page.enable', {}, sessionId);
  await cdp('Runtime.enable', {}, sessionId);
  await cdp('Network.enable', {}, sessionId);
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('potomac.workspace.demo-profile', ${JSON.stringify(`system-b-${role}`)});` }, sessionId);
  await cdp('Page.navigate', { url }, sessionId);
  await waitForExpression(sessionId, "Boolean(document.querySelector('.topbar-right select'))", `${role} role selector`);
  await evaluate(sessionId, `(() => { const select=document.querySelector('.topbar-right select'); if(select.value!==${JSON.stringify(role)}) { select.value=${JSON.stringify(role)}; select.dispatchEvent(new Event('change',{bubbles:true})); } })()`);
  await waitForExpression(sessionId, "document.querySelector('.status')?.textContent.includes('CONNECTED')", `${role} authorized connection`);
  await waitForExpression(sessionId, "document.querySelector('.workspace-footnote')?.textContent.includes('Cursor') && !document.querySelector('.workspace-footnote')?.textContent.includes('Cursor —')", `${role} authorized snapshot`);
  return { sessionId };
}

try {
  const [hostPortCheck, gmWebPortCheck, playerWebPortCheck, debugPortCheck] = ports;
  assert.equal(new Set([hostPortCheck, gmWebPortCheck, playerWebPortCheck, debugPortCheck]).size, 4);
  startHost();
  await waitFor(`${baseUrl}/health`, 'fresh System B host');

  const fresh = await jsonRequest('/api/state', gmToken);
  assert.deepEqual(fresh.actors, [], 'fresh host has no seeded actors');
  assert.deepEqual(fresh.encounters, [], 'fresh host has no seeded encounters');
  const campaign = await jsonRequest('/api/campaign', gmToken);
  assert.equal(campaign.systemModuleId, null, 'fresh campaign is unpinned before explicit setup');
  await jsonRequest('/api/context', gmToken, { method: 'POST', body: JSON.stringify({ context: { activeEncounter: null } }) });
  const pinned = await jsonRequest('/api/campaign', gmToken, { method: 'PUT', body: JSON.stringify({ name: 'System B Table Acceptance', systemModuleId: 'example.system-b', systemModuleVersion: '0.1.0', baseRevision: campaign.revision }) });
  assert.equal(pinned.systemModuleId, 'example.system-b');
  const enrollment = await jsonRequest('/api/members/enroll', gmToken, { method: 'POST', body: JSON.stringify({ displayName: 'System B Player' }) });
  const actorId = 'system-b-table-wayfarer';
  const secret = 'SYSTEM_B_GM_PRIVATE_STAR_CHART';
  await jsonRequest('/api/actors', gmToken, { method: 'POST', body: JSON.stringify({
    id: actorId, moduleId: 'example.system-b', moduleVersion: '0.1.0',
    data: { name: 'Nia Sol', epithet: 'Wayfarer', traits: { agility: 2, instinct: 3 }, resources: { stress: { current: 1, maximum: 6 }, hope: { current: 4, maximum: 6 } }, secretNote: secret },
    visibility: { gmOnly: ['secretNote'] },
  }) });
  await jsonRequest(`/api/actors/${actorId}/grants`, gmToken, { method: 'POST', body: JSON.stringify({ memberId: enrollment.memberId, permissions: ['read', 'act'] }) });
  const encounterId = 'system-b-table-encounter';
  const encounter = await jsonRequest('/api/encounters', gmToken, { method: 'POST', body: JSON.stringify({ id: encounterId, name: 'The Quiet Nebula', summary: 'A public course through starlit debris.' }) });
  const populated = await jsonRequest(`/api/encounters/${encounterId}/participants`, gmToken, { method: 'PUT', body: JSON.stringify({ baseRevision: encounter.revision, participants: [{ actorId, status: 'active', activationOrder: 0 }] }) });
  await jsonRequest('/api/context', gmToken, { method: 'POST', body: JSON.stringify({ context: { activeEncounter: encounterId } }) });
  assert.equal((await request(`/api/actors/${actorId}`, enrollment.credential)).status, 200, 'the enrolled player has the explicit character grant');

  start(process.execPath, [join(root, 'clients/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(gmWebPort), '--strictPort'], {
    cwd: join(root, 'clients/web'), env: { ...process.env, VITE_POTOMAC_HOST: baseUrl, VITE_POTOMAC_GM_TOKEN: gmToken, VITE_POTOMAC_PLAYER_TOKEN: unusedPlayerToken },
  });
  await waitFor(gmWebUrl, 'GM web client');
  start(process.execPath, [join(root, 'clients/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(playerWebPort), '--strictPort'], {
    cwd: join(root, 'clients/web'), env: { ...process.env, VITE_POTOMAC_HOST: baseUrl, VITE_POTOMAC_GM_TOKEN: 'no-gm-token-in-player-client', VITE_POTOMAC_PLAYER_TOKEN: enrollment.credential },
  });
  await waitFor(playerWebUrl, 'player web client');

  start(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-features=Translate,BackForwardCache', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(scratch, 'chrome')}`, 'about:blank']);
  const version = await (await waitFor(`http://127.0.0.1:${debugPort}/json/version`, 'Chrome DevTools')).json();
  browserSocket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => { browserSocket.addEventListener('open', resolvePromise, { once: true }); browserSocket.addEventListener('error', reject, { once: true }); });
  browserSocket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const callback = pending.get(message.id); pending.delete(message.id); callback?.(message); }
  });
  const gmContext = await cdp('Target.createBrowserContext');
  const playerContext = await cdp('Target.createBrowserContext');
  const gm = await openBrowserClient(gmContext.browserContextId, 'gm', gmWebUrl);
  const player = await openBrowserClient(playerContext.browserContextId, 'player', playerWebUrl);
  await waitForExpression(gm.sessionId, "document.querySelector('.table-session-panel') && document.querySelector('.table-session-panel strong')?.textContent === 'No active session'", 'generic Table session brick');
  await waitForExpression(gm.sessionId, "document.querySelector('.table-participants')?.textContent.includes('Nia Sol')", 'System B participant in generic Table roster');
  await waitForExpression(player.sessionId, "document.querySelector('.table-participants')?.textContent.includes('Nia Sol')", 'authorized System B player roster');
  await clickText(gm.sessionId, 'Start session', '.table-session-panel button');
  await waitForExpression(gm.sessionId, "document.querySelector('.table-session-panel strong')?.textContent === 'Active'", 'GM starts a session through Table UI');
  await waitForExpression(player.sessionId, "document.querySelector('.table-session-panel strong')?.textContent === 'Active'", 'player receives committed session start');

  await clickText(player.sessionId, 'Characters', 'nav[aria-label="Applications"] button');
  await waitForExpression(player.sessionId, "[...document.querySelectorAll('.character-list button')].some(button=>button.textContent.includes('Nia Sol'))", 'player character list');
  await clickText(player.sessionId, 'Nia Sol', '.character-list button');
  await waitForExpression(player.sessionId, "document.querySelector('.character-view h3')?.textContent === 'Nia Sol'", 'authorized System B character app');
  await clickText(player.sessionId, 'Spend 1 Hope', '.character-view button');
  await waitForExpression(player.sessionId, "document.querySelector('.action-status')?.textContent.includes('spend-hope accepted')", 'player submits generic System B action during active session');
  assert.equal(await evaluate(player.sessionId, "Boolean(document.querySelector('.gm-note')?.textContent.includes('SYSTEM_B_GM_PRIVATE_STAR_CHART'))"), false, 'GM-only actor field is absent from player DOM');

  const playerJsonChecks = await Promise.all([
    request('/api/state', enrollment.credential),
    request('/api/session', enrollment.credential),
    request(`/api/actors/${actorId}`, enrollment.credential),
    request(`/api/session/${encodeURIComponent((await jsonRequest('/api/session', gmToken)).current.id)}/timeline?after=0`, enrollment.credential),
  ]);
  for (const response of playerJsonChecks) {
    assert.equal(response.status, 200, 'authorized player HTTP projection is available');
    assert.ok(!(await response.text()).includes(secret), 'private field is absent from actual player HTTP response bytes');
  }
  const streamResponse = await request('/api/stream?since=0', enrollment.credential);
  assert.equal(streamResponse.status, 200, 'player event stream is authorized');
  const reader = streamResponse.body.getReader();
  let streamBytes = '';
  for (let index = 0; index < 8 && !streamBytes.includes('action.applied'); index++) {
    const { value, done } = await Promise.race([reader.read(), delay(2000).then(() => ({ done: true }))]);
    if (done) break;
    streamBytes += new TextDecoder().decode(value);
  }
  await reader.cancel();
  assert.ok(streamBytes.includes('action.applied'), 'player stream replay includes the committed action notification');
  assert.ok(!streamBytes.includes(secret), 'private field is absent from actual player SSE bytes');

  await stopProcess(hostProcess);
  const stoppedAt = Date.now();
  while (Date.now() - stoppedAt < 8000) {
    try { await fetch(`${baseUrl}/health`); } catch { break; }
    await delay(100);
  }
  await waitForExpression(player.sessionId, "document.querySelector('.status')?.textContent.includes('DISCONNECTED') || document.querySelector('.status')?.textContent.includes('OFFLINE')", 'player observes host disconnect');
  startHost();
  await waitFor(`${baseUrl}/health`, 'restarted System B host');
  await waitForExpression(player.sessionId, "document.querySelector('.status')?.textContent.includes('CONNECTED')", 'player transport reconnect');
  await clickText(player.sessionId, 'Table', 'nav[aria-label="Applications"] button');
  await waitForExpression(player.sessionId, "document.querySelector('.table-session-panel strong')?.textContent === 'Active'", 'reconnected Table shows authoritative active session');
  const refreshedState = await request('/api/state', enrollment.credential);
  const refreshedBytes = await refreshedState.text();
  assert.ok(!refreshedBytes.includes(secret), 'reconnect snapshot bytes remain redacted');
  assert.equal((await jsonRequest('/api/state', gmToken)).actors.find(actor => actor.id === actorId).data.secretNote, secret, 'GM retains the hidden System B note');
  const playerActor = await (await request(`/api/actors/${actorId}`, enrollment.credential)).json();
  assert.equal(playerActor.data.resources.hope.current, 3, 'player action commits the System B resource update');
  assert.equal(populated.revision, 2, 'encounter has a committed System B roster revision');

  console.log('PASS: fresh unseeded System B campaign; generic Table UI start; authorized player System B action; private-field HTTP/SSE/DOM redaction; reconnect to authoritative active-session state.');
  console.log(`Temporary host database: ${dbPath}`);
} catch (error) {
  const logs = children.map(({ getOutput }) => getOutput()).filter(Boolean).join('\n');
  console.error(`FAIL: ${error.stack || error.message}${logs ? `\nProcess output:\n${logs}` : ''}`);
  process.exitCode = 1;
} finally {
  try { if (browserSocket?.readyState === WebSocket.OPEN) await cdp('Browser.close'); } catch {}
  try { browserSocket?.close(); } catch {}
  for (const { child } of [...children].reverse()) if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.all(children.map(({ child }) => new Promise(resolvePromise => {
    if (child.exitCode !== null) return resolvePromise();
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolvePromise(); }, 2500);
    child.once('exit', () => { clearTimeout(timer); resolvePromise(); });
  })));
  await rm(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
