// Focused Lore HTTP/privacy acceptance: pnpm acceptance:lore
// Exercises the current host contract against a disposable SQLite database.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { createHost } from '../server/host/index.mjs';

const directory = mkdtempSync(join(tmpdir(), 'potomac-lore-acceptance-'));
const gmToken = 'lore-acceptance-gm';
let host;
let baseUrl;
const root = resolve(import.meta.dirname, '..');
const chromePath = [process.env.POTOMAC_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
const children = [];
let browserSocket;
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

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(url, label, timeoutMs = 30000) {
  const started = Date.now(); let lastError;
  while (Date.now() - started < timeoutMs) {
    try { const response = await fetch(url); if (response.ok) return response; lastError = new Error(`HTTP ${response.status}`); }
    catch (error) { lastError = error; }
    await delay(120);
  }
  throw new Error(`${label} did not become ready: ${lastError?.message || 'timeout'}`);
}

function cdp(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 12000);
    pending.set(id, message => { clearTimeout(timer); message.error ? reject(new Error(`CDP ${method}: ${message.error.message}`)) : resolve(message.result); });
    browserSocket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

async function evaluate(sessionId, expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitForExpression(sessionId, expression, label, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { if (await evaluate(sessionId, expression)) return; } catch {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}: ${await evaluate(sessionId, 'document.body.innerText.slice(0,500)').catch(() => '')}`);
}

async function clickText(sessionId, text, selector = 'button') {
  const clicked = await evaluate(sessionId, `(() => { const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(item=>item.textContent.trim().includes(${JSON.stringify(text)})); if(!el || el.disabled) return false; el.click(); return true })()`);
  assert.equal(clicked, true, `Enabled ${selector} containing “${text}” exists`);
}

async function openLoreClient(contextId, role, url) {
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId: contextId });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Page.enable', {}, sessionId); await cdp('Runtime.enable', {}, sessionId); await cdp('Page.navigate', { url }, sessionId);
  await waitForExpression(sessionId, 'Boolean(document.querySelector("nav[aria-label=Applications]"))', `${role} application shell`);
  await evaluate(sessionId, `(() => { const select=document.querySelector('.topbar-right select'); if(select.value!==${JSON.stringify(role)}) { select.value=${JSON.stringify(role)}; select.dispatchEvent(new Event('change',{bubbles:true})); } })()`);
  await waitForExpression(sessionId, "document.querySelector('.status')?.textContent.includes('CONNECTED')", `${role} authorized host connection`);
  await clickText(sessionId, 'Lore', 'nav[aria-label="Applications"] button');
  await waitForExpression(sessionId, "document.querySelector('.lore-page h1')?.textContent.includes('Lore')", `${role} Lore app`);
  return { sessionId };
}

async function startHost() {
  host = createHost({ databasePath: join(directory, 'host.sqlite'), gmToken, playerToken: 'lore-acceptance-unused', seedDemo: false });
  const address = await host.listen(0);
  baseUrl = `http://127.0.0.1:${address.port}`;
}

function stopHost() { host?.close(); host = undefined; }

async function request(path, credential = gmToken, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${credential}`, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers }
  });
}

async function json(response) { return { status: response.status, body: await response.json() }; }

try {
  await startHost();
  const enrolled = await json(await request('/api/members/enroll', gmToken, { method: 'POST', body: JSON.stringify({ displayName: 'Lore Reader' }) }));
  assert.equal(enrolled.status, 201);
  const playerToken = enrolled.body.credential;
  const enrolledSecond = await json(await request('/api/members/enroll', gmToken, { method: 'POST', body: JSON.stringify({ displayName: 'Lore Reader Two' }) }));
  assert.equal(enrolledSecond.status, 201);

  const invalidCredential = await request('/api/lore', 'invalid-lore-credential');
  assert.equal(invalidCredential.status, 401, 'Lore reads require host authentication');

  const draftInput = {
    operationId: 'lore-create-draft', baseRevision: 0, id: 'lore-moonwell', type: 'location', title: 'Moonwell', summary: 'A spring beneath the cliffs',
    body: 'Water reflects a second moon.', gmNotes: 'GM_ONLY_LORE_SECRET', tags: ['coast', 'ruins', 'potomac-kind:location']
  };
  const created = await json(await request('/api/lore', gmToken, { method: 'POST', body: JSON.stringify(draftInput) }));
  assert.equal(created.status, 201);
  assert.equal(created.body.revision, 1);
  assert.equal(created.body.published, false);
  const loreId = draftInput.id;

  const gmList = await json(await request('/api/lore'));
  assert.equal(gmList.status, 200);
  assert.equal(gmList.body.articles.length, 1);
  assert.equal(gmList.body.articles[0].gmNotes, 'GM_ONLY_LORE_SECRET');
  assert.equal(gmList.body.articles[0].type, 'location', 'Lore kind is explicit in the host contract');
  assert.equal(gmList.body.articles[0].visibility, 'gm', 'draft visibility is explicit in the host contract');
  assert.equal(gmList.body.articles[0].published, false, 'legacy publication alias agrees with visibility');
  assert.equal((await json(await request('/api/lore', playerToken))).body.articles.length, 0, 'player cannot list an unpublished draft');

  const deniedWrite = await request('/api/lore', playerToken, { method: 'POST', body: JSON.stringify({ ...draftInput, operationId: 'lore-player-create', id: 'player-created-lore' }) });
  assert.equal(deniedWrite.status, 403, 'player cannot create Lore');

  const published = await json(await request(`/api/lore/${encodeURIComponent(loreId)}/publication`, gmToken, {
    method: 'PUT', body: JSON.stringify({ operationId: 'lore-publish', baseRevision: 1, published: true })
  }));
  assert.equal(published.status, 200);
  assert.equal(published.body.visibility, 'shared', 'host publication state is explicit on the command response');

  const playerArticle = await json(await request(`/api/lore/${encodeURIComponent(loreId)}`, playerToken));
  assert.equal(playerArticle.status, 200);
  assert.equal(playerArticle.body.article.body, draftInput.body);
  assert.equal(playerArticle.body.article.type, 'location', 'player receives the explicit Lore kind');
  assert.equal(playerArticle.body.article.visibility, 'shared', 'player receives the explicit Lore visibility');
  assert.equal(Object.hasOwn(playerArticle.body.article, 'gmNotes'), false, 'player projection omits GM notes');
  assert.ok(!JSON.stringify(playerArticle.body).includes('GM_ONLY_LORE_SECRET'));

  const gmReplay = await json(await request('/api/state?since=0'));
  const createdEvent = gmReplay.body.events.find(event => event.kind === 'lore.created');
  const publishedEvent = gmReplay.body.events.find(event => event.kind === 'lore.published');
  assert.ok(createdEvent, 'creation event has the explicit lore.created kind');
  assert.equal(createdEvent.visibility, 'gm', 'creation event visibility is explicit');
  assert.deepEqual(createdEvent.payload, { entryId: loreId, revision: 1 });
  assert.ok(publishedEvent, 'publication event has the explicit lore.published kind');
  assert.equal(publishedEvent.visibility, 'gm', 'publication event visibility is explicit');
  assert.deepEqual(publishedEvent.payload, { entryId: loreId, revision: 2 });
  const playerReplay = await json(await request('/api/state?since=0', playerToken));
  assert.ok(playerReplay.body.events.some(event => event.kind === 'lore.published' && event.visibility === 'gm'), 'host filters Lore events by current entry access while retaining their explicit event visibility');
  assert.ok(playerReplay.body.events.every(event => !JSON.stringify(event).includes(draftInput.body) && !JSON.stringify(event).includes('GM_ONLY_LORE_SECRET')), 'Lore event payloads do not expose article content or GM notes');

  const revoked = await json(await request(`/api/lore/${encodeURIComponent(loreId)}/publication`, gmToken, {
    method: 'PUT', body: JSON.stringify({ operationId: 'lore-revoke', baseRevision: 2, published: false })
  }));
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.visibility, 'gm');
  assert.equal((await json(await request('/api/lore', playerToken))).body.articles.length, 0, 'unpublished Lore is unavailable to players');
  assert.equal((await json(await request(`/api/lore/${encodeURIComponent(loreId)}`, playerToken))).status, 404);

  assert.ok(chromePath, 'Chrome or Edge is available for real browser acceptance; set POTOMAC_CHROME if needed');
  const archiveResponse = await request(`/api/lore/${encodeURIComponent(loreId)}/archive`, gmToken, {
    method: 'PUT', body: JSON.stringify({ operationId: 'lore-client-archive-shape', baseRevision: 3 })
  });
  assert.equal(archiveResponse.status, 200, 'client archive method/path matches the host API');
  const archiveResult = await archiveResponse.json();
  assert.equal(archiveResult.archived, true);
  const archiveEvent = (await json(await request('/api/state?since=0'))).body.events.find(event => event.kind === 'lore.archived');
  assert.ok(archiveEvent, 'archive event has the explicit lore.archived kind');
  assert.equal(archiveEvent.visibility, 'gm', 'archive event visibility is explicit');

  // Drive the actual Lore app in three isolated Chromium browser contexts.
  const ports = await Promise.all([freePort(), freePort(), freePort(), freePort()]);
  const [gmPort, playerPort, secondPlayerPort, debugPort] = ports;
  for (const [port, playerCredential] of [[gmPort, 'unused-gm-player'], [playerPort, playerToken], [secondPlayerPort, enrolledSecond.body.credential]]) {
    start(process.execPath, [join(root, 'clients/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: join(root, 'clients/web'), env: { ...process.env, VITE_POTOMAC_HOST: baseUrl, VITE_POTOMAC_GM_TOKEN: gmToken, VITE_POTOMAC_PLAYER_TOKEN: playerCredential },
    });
    await waitFor(`http://127.0.0.1:${port}/`, `Lore web client ${port}`);
  }
  start(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(directory, 'chrome')}`, 'about:blank']);
  const version = await (await waitFor(`http://127.0.0.1:${debugPort}/json/version`, 'Chrome DevTools')).json();
  browserSocket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => { browserSocket.addEventListener('open', resolvePromise, { once: true }); browserSocket.addEventListener('error', reject, { once: true }); });
  browserSocket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const callback = pending.get(message.id); pending.delete(message.id); callback?.(message); }
  });
  const gmContext = await cdp('Target.createBrowserContext');
  const playerContext = await cdp('Target.createBrowserContext');
  const secondPlayerContext = await cdp('Target.createBrowserContext');
  const gmBrowser = await openLoreClient(gmContext.browserContextId, 'gm', `http://127.0.0.1:${gmPort}/`);
  const playerBrowser = await openLoreClient(playerContext.browserContextId, 'player', `http://127.0.0.1:${playerPort}/`);
  const secondPlayerBrowser = await openLoreClient(secondPlayerContext.browserContextId, 'player', `http://127.0.0.1:${secondPlayerPort}/`);
  await clickText(gmBrowser.sessionId, 'New article', '.lore-page button');
  await waitForExpression(gmBrowser.sessionId, "Boolean(document.querySelector('.lore-page form'))", 'GM Lore editor');
  const uiCreated = await evaluate(gmBrowser.sessionId, `(() => {
    const set = (label, value) => { const control = [...document.querySelectorAll('label')].find(item => item.textContent.trim().startsWith(label))?.querySelector('input,textarea'); if (!control) return false; const setter = Object.getOwnPropertyDescriptor(control.__proto__, 'value')?.set; setter?.call(control, value); control.dispatchEvent(new Event('input', { bubbles: true })); control.dispatchEvent(new Event('change', { bubbles: true })); return true };
    return set('Title', 'UI Created Atlas') && set('Article body', 'Created through the Lore editor.');
  })()`);
  assert.equal(uiCreated, true, 'Lore editor fields are available');
  await clickText(gmBrowser.sessionId, 'Save on host', '.lore-page button');
  await waitForExpression(gmBrowser.sessionId, "document.body.innerText.includes('UI Created Atlas')", 'UI-created Lore article');
  const browserArticle = await json(await request('/api/lore', gmToken, { method: 'POST', body: JSON.stringify({ id: 'lore-browser-shared', operationId: 'lore-browser-shared-create', baseRevision: 0, type: 'location', title: 'Browser Shared Atlas', body: 'A **shared** passage with a safe preview.', gmNotes: 'UI_ONLY_GM_SECRET', tags: ['browser', 'acceptance'] }) }));
  assert.equal(browserArticle.status, 201);
  const browserPublished = await json(await request('/api/lore/lore-browser-shared/publication', gmToken, { method: 'PUT', body: JSON.stringify({ operationId: 'lore-browser-shared-publish', baseRevision: 1, published: true }) }));
  assert.equal(browserPublished.status, 200);
  await waitForExpression(gmBrowser.sessionId, "[...document.querySelectorAll('.lore-list button')].some(item=>item.textContent.includes('Browser Shared Atlas'))", 'GM Lore list');
  await waitForExpression(playerBrowser.sessionId, "[...document.querySelectorAll('.lore-list button')].some(item=>item.textContent.includes('Browser Shared Atlas'))", 'player A receives shared article');
  await waitForExpression(secondPlayerBrowser.sessionId, "[...document.querySelectorAll('.lore-list button')].some(item=>item.textContent.includes('Browser Shared Atlas'))", 'player B receives shared article');
  await clickText(gmBrowser.sessionId, 'Browser Shared Atlas', '.lore-list button');
  await clickText(playerBrowser.sessionId, 'Browser Shared Atlas', '.lore-list button');
  await clickText(secondPlayerBrowser.sessionId, 'Browser Shared Atlas', '.lore-list button');
  assert.equal(await evaluate(gmBrowser.sessionId, "document.querySelector('.lore-article .gm-note')?.textContent.includes('UI_ONLY_GM_SECRET')"), true, 'GM UI shows GM notes');
  for (const browser of [playerBrowser, secondPlayerBrowser]) {
    const visible = await evaluate(browser.sessionId, 'document.body.innerText');
    assert.ok(visible.includes('A shared passage'), 'player UI renders the shared article');
    assert.ok(!visible.includes('UI_ONLY_GM_SECRET'), 'GM-only note is absent from both player DOMs');
  }
  const playerPayload = await request('/api/lore/lore-browser-shared', playerToken);
  const playerPayloadBytes = await playerPayload.text();
  assert.equal(playerPayload.status, 200);
  assert.ok(!playerPayloadBytes.includes('UI_ONLY_GM_SECRET'), 'GM notes are absent from actual player HTTP response bytes');

  console.log('PASS: Lore HTTP authorization/projection/event privacy plus real GM, player A and player B browser contexts; GM creation and all three shared-article views render correctly, and GM notes remain private.');
} catch (error) {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  stopHost();
  try { if (browserSocket?.readyState === WebSocket.OPEN) await cdp('Browser.close'); } catch {}
  try { browserSocket?.close(); } catch {}
  for (const { child } of [...children].reverse()) if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.all(children.map(({ child }) => new Promise(resolvePromise => {
    if (child.exitCode !== null) return resolvePromise();
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolvePromise(); }, 2500);
    child.once('exit', () => { clearTimeout(timer); resolvePromise(); });
  })));
  rmSync(directory, { recursive: true, force: true });
}
