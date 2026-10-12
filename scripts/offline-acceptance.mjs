// Repeatable Workspace 0.3 offline acceptance: pnpm acceptance:offline
// Requires the repository's Node/Vite dependencies and an installed Chrome/Edge.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const chromePath = [
  process.env.POTOMAC_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find(existsSync);
if (!chromePath) throw new Error('Chrome/Edge not found. Set POTOMAC_CHROME to its executable path.');

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  await new Promise((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()));
  return port;
}

const scratch = await mkdtemp(join(tmpdir(), 'potomac-offline-acceptance-'));
const dbPath = join(scratch, 'host.sqlite');
const chromeProfile = join(scratch, 'chrome');
const hostPort = await freePort();
const webPort = await freePort();
const playerWebPort = await freePort();
const debugPort = await freePort();
const gmToken = `offline-acceptance-gm-${randomUUID()}`;
const legacyPlayerToken = `offline-acceptance-unused-${randomUUID()}`;
const baseUrl = `http://127.0.0.1:${hostPort}`;
const webUrl = `http://127.0.0.1:${webPort}/`;
const playerWebUrl = `http://127.0.0.1:${playerWebPort}/`;
const children = [];
let browserSocket;
let browserSequence = 0;
const pending = new Map();

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root, windowsHide: true, stdio: 'ignore', ...options,
  });
  const record = { child };
  children.push(record);
  return record;
}

async function stop(record) {
  if (!record || record.child.exitCode !== null || record.child.signalCode !== null) return;
  const exited = new Promise(resolvePromise => record.child.once('exit', resolvePromise));
  if (!record.child.kill('SIGTERM')) throw new Error('Could not stop isolated process');
  const stopped = await Promise.race([exited.then(() => true), delay(4000).then(() => false)]);
  if (!stopped) {
    const forcedExit = new Promise(resolvePromise => record.child.once('exit', resolvePromise));
    record.child.kill('SIGKILL');
    await Promise.race([forcedExit, delay(1500)]);
  }
  if (record.child.exitCode === null && record.child.signalCode === null) throw new Error('Isolated process did not stop');
}

async function waitForHostDown(timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try { await fetch(`${baseUrl}/health`); } catch { return; }
    await delay(100);
  }
  throw new Error('Isolated host remained available after stop');
}

async function waitFor(url, label, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await delay(150);
  }
  throw new Error(`${label} did not become ready`);
}

function cdp(method, params = {}, sessionId) {
  return new Promise((resolvePromise, reject) => {
    const id = ++browserSequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP ${method} timed out`));
    }, 12000);
    pending.set(id, message => {
      clearTimeout(timer);
      if (message.error) reject(new Error(`CDP ${method} failed`));
      else resolvePromise(message.result);
    });
    browserSocket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

async function evaluate(sessionId, expression) {
  const result = await cdp('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  }, sessionId);
  if (result.exceptionDetails) throw new Error('Browser evaluation failed');
  return result.result.value;
}

async function waitForExpression(sessionId, expression, label, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try { if (await evaluate(sessionId, expression)) return; } catch {}
    await delay(120);
  }
  const detail = await evaluate(sessionId, "({role:document.querySelector('.topbar-right select')?.value, status:document.querySelector('.status')?.textContent, error:document.querySelector('.error-banner')?.textContent, campaign:document.querySelector('.campaign-select strong')?.textContent, body:document.body.innerText.slice(0,500)})").catch(() => undefined);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(detail)}`);
}

async function clickText(sessionId, text, selector = 'button') {
  const clicked = await evaluate(sessionId, `(() => {
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find(element => element.textContent.trim().includes(${JSON.stringify(text)}));
    if (!target || target.disabled) return false;
    target.click(); return true;
  })()`);
  assert.equal(clicked, true, `Expected an enabled ${selector} containing ${text}`);
}

async function clickSelector(sessionId, selector) {
  const clicked = await evaluate(sessionId, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return { clicked: false, navLabel: document.querySelector('nav')?.getAttribute('aria-label') || null };
    if (target.disabled) return { clicked: false, disabled: true };
    target.click(); return { clicked: true };
  })()`);
  assert.equal(clicked.clicked, true, `Expected an enabled element matching ${selector}; found ${JSON.stringify(clicked)}`);
}

async function chooseRole(sessionId, role) {
  await evaluate(sessionId, `(() => {
    const selector = document.querySelector('.topbar-right select');
    if (!selector) throw new Error('role selector unavailable');
    if (selector.value === ${JSON.stringify(role)}) return;
    selector.value = ${JSON.stringify(role)};
    selector.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

async function openContext(browserContextId, clientUrl) {
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Page.enable', {}, sessionId);
  await cdp('Runtime.enable', {}, sessionId);
  await cdp('Network.enable', {}, sessionId);
  await cdp('Page.navigate', { url: clientUrl }, sessionId);
  await waitForExpression(sessionId, "document.readyState === 'complete'", 'client page');
  await waitForExpression(sessionId, "Boolean(document.querySelector('.topbar-right select'))", 'role selector');
  return sessionId;
}

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let value = {};
  try { value = await response.json(); } catch {}
  return { status: response.status, value };
}

async function readBrowserQueue(sessionId) {
  return evaluate(sessionId, `new Promise((resolve, reject) => {
    const request = indexedDB.open('potomac-offline');
    request.onerror = () => reject(new Error('offline database unavailable'));
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(['queuedOperations', 'authorizedSnapshots'], 'readonly');
      const operations = transaction.objectStore('queuedOperations').getAll();
      const snapshots = transaction.objectStore('authorizedSnapshots').getAll();
      transaction.oncomplete = () => {
        database.close();
        resolve({
          operations: operations.result.map(row => ({ operation: row.operation, state: row.state, receipt: row.receipt })),
          snapshots: snapshots.result.map(row => ({ entityId: row.snapshot.entityId, name: row.snapshot.data.name, secretNote: row.snapshot.data.secretNote })),
        });
      };
      transaction.onerror = () => reject(new Error('offline database read failed'));
    };
  })`);
}

async function hostState(token) {
  const result = await request('/api/state', token);
  assert.equal(result.status, 200, 'authorized host state query succeeds');
  return result.value;
}

try {
  await mkdir(chromeProfile, { recursive: true });
  let host = start(process.execPath, [join(root, 'server/host/index.mjs')], {
    env: { ...process.env, PORT: String(hostPort), POTOMAC_DB: dbPath, POTOMAC_GM_TOKEN: gmToken, POTOMAC_PLAYER_TOKEN: legacyPlayerToken },
  });
  await waitFor(`${baseUrl}/health`, 'isolated host');
  start(process.execPath, [join(root, 'clients/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], {
    cwd: join(root, 'clients/web'),
    env: { ...process.env, VITE_POTOMAC_HOST: baseUrl, VITE_POTOMAC_GM_TOKEN: gmToken, VITE_POTOMAC_PLAYER_TOKEN: legacyPlayerToken },
  });
  await waitFor(webUrl, 'isolated Vite client');
  start(process.execPath, [join(root, 'clients/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(playerWebPort), '--strictPort'], {
    cwd: join(root, 'clients/web'),
    env: { ...process.env, VITE_POTOMAC_HOST: baseUrl, VITE_POTOMAC_GM_TOKEN: 'no-gm-access-in-player-client', VITE_POTOMAC_PLAYER_TOKEN: legacyPlayerToken },
  });
  await waitFor(playerWebUrl, 'isolated player Vite client');

  start(chromePath, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-features=Translate,BackForwardCache', '--remote-allow-origins=*',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, 'about:blank',
  ]);
  const version = await waitFor(`http://127.0.0.1:${debugPort}/json/version`, 'Chrome DevTools');
  const browserInfo = await version.json();
  browserSocket = new WebSocket(browserInfo.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    browserSocket.addEventListener('open', resolvePromise, { once: true });
    browserSocket.addEventListener('error', reject, { once: true });
  });
  browserSocket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const resolvePending = pending.get(message.id);
      pending.delete(message.id);
      resolvePending?.(message);
    }
  });

  const gmContext = await cdp('Target.createBrowserContext');
  const memberAContext = await cdp('Target.createBrowserContext');
  const memberBContext = await cdp('Target.createBrowserContext');
  const gm = await openContext(gmContext.browserContextId, webUrl);
  await chooseRole(gm, 'gm');
  await waitForExpression(gm, "document.querySelector('.campaign-select strong')?.textContent === 'foundation-demo'", 'GM host session');

  let seeded;
  const seedDeadline = Date.now() + 15000;
  while (Date.now() < seedDeadline) {
    const state = await request('/api/state', gmToken);
    if (state.status === 200 && state.value.actors?.length >= 2) { seeded = state.value; break; }
    await delay(150);
  }
  assert.ok(seeded, 'GM client seeds the two fixture actors');

  const enrolledA = await request('/api/members/enroll', gmToken, 'POST', { displayName: 'Acceptance Member A' });
  const enrolledB = await request('/api/members/enroll', gmToken, 'POST', { displayName: 'Acceptance Member B' });
  assert.equal(enrolledA.status, 201, 'GM enrolls member A');
  assert.equal(enrolledB.status, 201, 'GM enrolls member B');
  const memberA = enrolledA.value;
  const memberB = enrolledB.value;
  const actorA = 'actor-emberfall-01';
  const actorDependency = 'actor-tidebound-01';
  for (const actorId of [actorA, actorDependency]) {
    const grant = await request(`/api/actors/${encodeURIComponent(actorId)}/grants`, gmToken, 'POST', {
      memberId: memberA.memberId, permissions: ['read', 'act'],
    });
    assert.equal(grant.status, 201, 'GM grants member A actor access');
  }

  const memberAClient = await openContext(memberAContext.browserContextId, playerWebUrl);
  const memberBClient = await openContext(memberBContext.browserContextId, playerWebUrl);
  for (const [sessionId, member] of [[memberAClient, memberA], [memberBClient, memberB]]) {
    await evaluate(sessionId, `localStorage.setItem('potomac.identity.v1', JSON.stringify({
      version: 1, host: ${JSON.stringify(baseUrl)}, campaignId: 'foundation-demo',
      memberId: ${JSON.stringify(member.memberId)}, credential: ${JSON.stringify(member.credential)},
    }));`);
    await chooseRole(sessionId, 'player');
    await waitForExpression(sessionId, "document.querySelector('.status-connected') && document.querySelector('.campaign-select strong')?.textContent === 'foundation-demo'", 'enrolled member connection');
  }

  const memberBState = await request('/api/state', memberB.credential);
  assert.equal(memberBState.status, 200, 'member B state query succeeds');
  assert.equal(memberBState.value.actors.some(actor => actor.id === actorA), false, 'member B host projection excludes member A actor');
  assert.equal(await evaluate(memberBClient, `document.body.innerText.includes('Mira Vell')`), false, 'member B browser cannot see member A actor');

  await waitForExpression(memberAClient, `new Promise(resolve => {
    const request = indexedDB.open('potomac-offline');
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction('authorizedSnapshots', 'readonly');
      const rows = tx.objectStore('authorizedSnapshots').getAll();
      tx.oncomplete = () => { database.close(); resolve(rows.result.some(row => row.snapshot.entityId === '${actorA}')); };
    };
  })`, 'member A authorized actor in raw IndexedDB');
  let cache = await readBrowserQueue(memberAClient);
  assert.ok(cache.snapshots.some(row => row.entityId === actorA && row.name === 'Mira Vell'), 'member A caches its authorized actor in IndexedDB');
  assert.ok(cache.snapshots.every(row => !row.secretNote), 'cached player projection omits the GM-only field');
  assert.equal(cache.snapshots.some(row => row.entityId === actorA) && memberBState.value.actors.some(actor => actor.id === actorA), false, 'member B remains outside member A actor projection');

  await stop(host);
  await waitForHostDown();
  const beforeOfflineReload = await evaluate(memberAClient, 'performance.timeOrigin');
  await cdp('Page.reload', { ignoreCache: true }, memberAClient);
  await waitForExpression(memberAClient, `performance.timeOrigin !== ${beforeOfflineReload} && document.readyState === 'complete'`, 'offline page reload completion');
  await waitForExpression(memberAClient, "document.querySelector('.status-disconnected') && document.querySelector('.topbar-right .status')?.textContent.includes('OFFLINE')", 'offline stale view after browser reload', 30000);
  await clickSelector(memberAClient, 'nav[aria-label="Applications"] button:nth-child(2)');
  await waitForExpression(memberAClient, `document.querySelector('.character-list')?.innerText.includes('Mira Vell')`, 'offline character list');
  assert.equal(await evaluate(memberAClient, `document.querySelector('.character-list')?.innerText.includes('Mira Vell')`), true, 'offline reload renders the cached authorized actor in Characters');

  await clickText(memberAClient, 'Mira Vell', '.character-list button');
  await waitForExpression(memberAClient, "document.querySelector('.full-character .character-view h3')?.textContent === 'Mira Vell'", 'offline actor A view');
  await clickText(memberAClient, 'Spend 1 Mana', '.full-character .action-grid button');
  await waitForExpression(memberAClient, "document.querySelector('[aria-label=\"Your local operation status\"]')?.innerText.includes('spend-mana · queued')", 'self service operation queued offline');

  await clickText(memberAClient, 'Tarin Vale', '.character-list button');
  await waitForExpression(memberAClient, "document.querySelector('.full-character .character-view h3')?.textContent === 'Tarin Vale'", 'offline dependency actor view');
  await clickText(memberAClient, 'Request Stress Recovery', '.full-character .action-grid button');
  await waitForExpression(memberAClient, "document.querySelector('[aria-label=\"Your local operation status\"]')?.innerText.includes('clear-stress · queued')", 'GM review operation queued offline');

  const dependencyQueued = await evaluate(memberAClient, `(async () => {
    const { openOfflineStorage } = await import('/src/offline/storage.ts');
    const storage = await openOfflineStorage({ host: ${JSON.stringify(baseUrl)}, campaignId: 'foundation-demo', memberId: ${JSON.stringify(memberA.memberId)} });
    try {
      const operation = {
        operationId: 'offline-dependency-conflict-${randomUUID()}', campaignId: 'foundation-demo',
        memberId: ${JSON.stringify(memberA.memberId)}, entityId: '${actorDependency}', baseRevision: 1,
        moduleId: 'example.system-b', moduleVersion: '0.1.0', schemaVersion: 1,
        actionId: 'spend-hope', parameters: {}, dependencies: [{ entityId: '${actorA}', revision: 1 }],
      };
      await storage.enqueueOperation(operation);
      return (await storage.listOperations()).length;
    } finally { storage.close(); }
  })()`);
  assert.equal(dependencyQueued, 3, 'browser IndexedDB contains both UI edits and a stale dependency case');
  cache = await readBrowserQueue(memberAClient);
  assert.equal(cache.operations.length, 3, 'three immutable offline operations persist in IndexedDB');
  assert.ok(cache.operations.every(row => row.state === 'queued'), 'all offline operations remain visibly pending before host acknowledgement');

  await cdp('Network.setBlockedURLs', { urls: [`*127.0.0.1:${hostPort}*`] }, memberAClient);
  host = start(process.execPath, [join(root, 'server/host/index.mjs')], {
    env: { ...process.env, PORT: String(hostPort), POTOMAC_DB: dbPath, POTOMAC_GM_TOKEN: gmToken, POTOMAC_PLAYER_TOKEN: legacyPlayerToken },
  });
  await waitFor(`${baseUrl}/health`, 'restarted host');
  await cdp('Network.setBlockedURLs', { urls: [] }, memberAClient);
  await cdp('Page.reload', { ignoreCache: true }, memberAClient);
  await waitForExpression(memberAClient, "document.querySelector('.status-connected') && document.querySelector('.campaign-select strong')?.textContent === 'foundation-demo'", 'member A reconnect after host restart', 30000);

  const receiptsDeadline = Date.now() + 20000;
  let memberReceipts;
  while (Date.now() < receiptsDeadline) {
    const result = await request('/api/proposals/mine', memberA.credential);
    memberReceipts = result.value.receipts || [];
    if (memberReceipts.length === 3 && memberReceipts.some(receipt => receipt.status === 'awaitingReview') && memberReceipts.some(receipt => receipt.status === 'conflicted')) break;
    await delay(150);
  }
  assert.equal(memberReceipts.length, 3, `host durably records all three queued operation receipts: ${JSON.stringify({ browser: await evaluate(memberAClient, "({status:document.querySelector('.status')?.textContent,error:document.querySelector('.error-banner')?.textContent,queue:document.querySelector('[aria-label=\"Your local operation status\"]')?.textContent})"), queue: await readBrowserQueue(memberAClient) })}`);
  const selfReceipt = memberReceipts.find(receipt => receipt.entityId === actorA && receipt.status === 'applied');
  const proposalReceipt = memberReceipts.find(receipt => receipt.entityId === actorDependency && receipt.status === 'awaitingReview');
  const conflictReceipt = memberReceipts.find(receipt => receipt.status === 'conflicted');
  assert.ok(selfReceipt, 'selfService action applies once');
  assert.ok(proposalReceipt?.proposalId, 'gmReview action becomes a proposal');
  assert.equal(conflictReceipt?.reasonCode, 'dependency_revision_conflict', 'stale dependency is rejected as a conflict');

  await waitForExpression(gm, "document.querySelector('.gm-admin summary')?.textContent.includes('1 pending')", 'GM proposal queue');
  await clickText(gm, 'Review', '.gm-admin [aria-label="GM proposal review"] button');
  await waitForExpression(gm, "document.querySelector('.gm-admin h2')?.textContent === 'Review clear-stress'", 'GM proposal details');
  await clickText(gm, 'Accept after revalidation', '.gm-admin button');
  await waitForExpression(gm, "document.querySelector('.gm-admin summary')?.textContent.includes('0 pending')", 'GM proposal decision');

  const finalReceiptsResult = await request('/api/proposals/mine', memberA.credential);
  assert.equal(finalReceiptsResult.status, 200, 'member receipt query succeeds after GM decision');
  const finalReceipts = finalReceiptsResult.value.receipts;
  const acceptedReceipt = finalReceipts.find(receipt => receipt.operationId === proposalReceipt.operationId);
  assert.equal(acceptedReceipt?.status, 'applied', 'GM decision updates the member receipt to applied');

  const finalState = await hostState(gmToken);
  const mira = finalState.actors.find(actor => actor.id === actorA);
  const tarin = finalState.actors.find(actor => actor.id === actorDependency);
  assert.equal(mira.revision, 2, 'selfService operation increments Mira exactly once');
  assert.equal(mira.data.resources.mana.current, 4, 'selfService operation changes mana exactly once');
  assert.equal(tarin.revision, 2, 'accepted review proposal increments Tarin exactly once');
  assert.equal(tarin.data.resources.stress.current, 0, 'accepted review proposal applies its effect');

  const queueBeforeRetry = await readBrowserQueue(memberAClient);
  const selfOperation = queueBeforeRetry.operations.find(row => row.operation.operationId === selfReceipt.operationId)?.operation;
  assert.ok(selfOperation, 'the original selfService request remains available in the local queue');
  const duplicate = await request('/api/offline/operations', memberA.credential, 'POST', selfOperation);
  assert.equal(duplicate.status, 200, 'retry of the same operation ID returns the committed receipt');
  assert.equal(duplicate.value.status, 'applied', 'duplicate operation returns its original outcome');
  const afterRetry = await hostState(gmToken);
  const miraAfterRetry = afterRetry.actors.find(actor => actor.id === actorA);
  assert.equal(miraAfterRetry.revision, 2, 'idempotent retry does not increment actor revision again');
  assert.equal(miraAfterRetry.data.resources.mana.current, 4, 'idempotent retry does not repeat the resource effect');

  await waitForExpression(memberAClient, `new Promise(resolve => {
    const request = indexedDB.open('potomac-offline');
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction('queuedOperations', 'readonly');
      const rows = tx.objectStore('queuedOperations').getAll();
      tx.oncomplete = () => { database.close(); resolve(rows.result.length === 3 && rows.result.every(row => ['applied', 'conflicted'].includes(row.state))); };
    };
  })`, 'host receipts persisted back to IndexedDB');
  const persisted = await readBrowserQueue(memberAClient);
  assert.equal(persisted.operations.length, 3, 'operation queue history remains in IndexedDB after reconciliation');
  assert.equal(persisted.operations.filter(row => row.state === 'applied').length, 2, 'applied receipts persist for selfService and reviewed operations');
  assert.equal(persisted.operations.filter(row => row.state === 'conflicted').length, 1, 'dependency conflict receipt persists locally');

  console.log('PASS: isolated loopback host; GM and two enrolled members; member-scoped actor visibility; authorized IndexedDB cache; offline reload and stale view; durable selfService, gmReview, and stale-dependency operations; one-time host application; GM proposal decision; authorized receipts persist in host and browser storage.');
  console.log('Temporary host database and browser profile are removed when the runner exits.');
} catch (error) {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  try { if (browserSocket?.readyState === WebSocket.OPEN) await cdp('Browser.close'); } catch {}
  try { browserSocket?.close(); } catch {}
  for (const child of [...children].reverse()) await stop(child);
  await rm(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
