// Repeatable localhost acceptance run: node scripts/workspace-acceptance.mjs
// Uses only the repository's Node/Vite/host dependencies and an installed Chrome.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const chromePath = [
  process.env.POTOMAC_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find(existsSync);
if (!chromePath) throw new Error('Chrome/Edge not found. Set POTOMAC_CHROME to its executable path.');

async function freePort() {
  const server = await import('node:net').then(({ createServer }) => createServer());
  await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
  const { port } = server.address();
  await new Promise((ok, fail) => server.close(error => error ? fail(error) : ok()));
  return port;
}

const scratch = await mkdtemp(join(tmpdir(), 'potomac-workspace-acceptance-'));
const dbPath = join(scratch, 'host.sqlite');
const chromeProfile = join(scratch, 'chrome');
const hostPort = await freePort();
const webPort = await freePort();
const playerWebPort = await freePort();
const debugPort = await freePort();
const gmToken = `workspace-acceptance-gm-${process.pid}`;
const legacyPlayerToken = `workspace-acceptance-legacy-player-${process.pid}`;
let playerToken;
let playerMemberId;
const baseUrl = `http://127.0.0.1:${hostPort}`;
const webUrl = `http://127.0.0.1:${webPort}/`;
const playerWebUrl = `http://127.0.0.1:${playerWebPort}/`;
const children = [];
let browserSocket;
let browserSequence = 0;
const pending = new Map();

function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  children.push({ child, getOutput: () => output });
  return children.at(-1);
}

async function waitFor(url, label, timeoutMs = 30000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`${label} returned HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await delay(150);
  }
  const logs = children.map(({ getOutput }) => getOutput()).filter(Boolean).join('\n');
  throw new Error(`${label} did not become ready: ${lastError?.message || 'timeout'}\n${logs}`);
}

function cdp(method, params = {}, sessionId) {
  return new Promise((resolvePromise, reject) => {
    const id = ++browserSequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 10000);
    pending.set(id, message => {
      clearTimeout(timer);
      if (message.error) reject(new Error(`CDP ${method}: ${message.error.message}`));
      else resolvePromise(message.result);
    });
    browserSocket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

async function evaluate(sessionId, expression) {
  let result;
  try { result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId); }
  catch (error) { throw new Error(`${error.message} while evaluating ${expression.slice(0, 180)}`); }
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function click(sessionId, selector) {
  const result = await evaluate(sessionId, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('Missing selector: ' + ${JSON.stringify(selector)}); e.click(); return true })()`);
  assert.equal(result, true);
}

async function clickText(sessionId, text, selector = 'button') {
  const found = await evaluate(sessionId, `(() => { const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim().includes(${JSON.stringify(text)})); if (!target) return false; target.click(); return true; })()`);
  assert.equal(found, true, `Found clickable ${selector} containing “${text}”`);
}

async function waitForExpression(sessionId, expression, label, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(sessionId, expression)) return;
    await delay(100);
  }
  const detail = await evaluate(sessionId, "({body:document.body.innerText.slice(0,1200), alert:document.querySelector('.error-banner')?.textContent})").catch(() => undefined);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(detail)}`);
}

async function openContext(browserContextId, role, profile, clientUrl) {
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Page.enable', {}, sessionId);
  await cdp('Runtime.enable', {}, sessionId);
  await cdp('Network.enable', {}, sessionId);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  const secrets = [];
  const requests = new Map();
  browserSocket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Network.responseReceived' && /\/api\//.test(message.params.response.url)) requests.set(message.params.requestId, message.params.response.url);
    if (message.method === 'Network.loadingFinished' && requests.has(message.params.requestId)) {
      const requestId = message.params.requestId;
      void cdp('Network.getResponseBody', { requestId }, sessionId).then(({ body }) => secrets.push({ url: requests.get(requestId), body })).catch(() => {});
    }
  });
  await cdp('Page.navigate', { url: clientUrl }, sessionId);
  await waitForExpression(sessionId, "document.readyState === 'complete'", 'client document');
  await evaluate(sessionId, `localStorage.setItem('potomac.workspace.demo-profile', ${JSON.stringify(profile)}); window.__workspaceAcceptanceRole = ${JSON.stringify(role)};`);
  await cdp('Page.reload', { ignoreCache: true }, sessionId);
  await delay(300);
  await waitForExpression(sessionId, "Boolean(document.querySelector('.topbar-right select'))", `${role} role selector`);
  await evaluate(sessionId, `(() => { const s = document.querySelector('.topbar-right select'); if (s.value !== ${JSON.stringify(role)}) { s.value = ${JSON.stringify(role)}; s.dispatchEvent(new Event('change', {bubbles:true})); } })()`);
  await waitForExpression(sessionId, `document.querySelector('.status')?.textContent.includes('CONNECTED')`, `${role} connection`);
  await waitForExpression(sessionId, "document.querySelector('.workspace-footnote')?.textContent.includes('Cursor') && !document.querySelector('.workspace-footnote')?.textContent.includes('Cursor —')", `${role} authorized snapshot`);
  await delay(250);
  return { sessionId, secrets };
}

try {
  await mkdir(chromeProfile, { recursive: true });
  const host = start(process.execPath, [join(root, 'server/host/index.mjs')], {
    env: { ...process.env, PORT: String(hostPort), POTOMAC_DB: dbPath, POTOMAC_GM_TOKEN: gmToken, POTOMAC_PLAYER_TOKEN: legacyPlayerToken },
  });
  await waitFor(`${baseUrl}/health`, 'isolated host');
  const enrollment = await fetch(`${baseUrl}/api/members/enroll`, { method: 'POST', headers: { authorization: `Bearer ${gmToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Acceptance Player' }) });
  assert.equal(enrollment.status, 201, 'GM enrolls an individual player');
  ({ credential: playerToken, memberId: playerMemberId } = await enrollment.json());
  const web = start(process.execPath, [join(root, 'clients/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], {
    cwd: join(root, 'clients/web'),
    env: { ...process.env, VITE_POTOMAC_HOST: baseUrl, VITE_POTOMAC_GM_TOKEN: gmToken, VITE_POTOMAC_PLAYER_TOKEN: playerToken },
  });
  await waitFor(webUrl, 'isolated Vite client');
  start(process.execPath, [join(root, 'clients/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(playerWebPort), '--strictPort'], {
    cwd: join(root, 'clients/web'),
    env: { ...process.env, VITE_POTOMAC_HOST: baseUrl, VITE_POTOMAC_GM_TOKEN: 'no-gm-access-in-player-client', VITE_POTOMAC_PLAYER_TOKEN: playerToken },
  });
  await waitFor(playerWebUrl, 'isolated player Vite client');
  const chrome = start(chromePath, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-features=Translate,BackForwardCache', '--remote-allow-origins=*',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, 'about:blank',
  ]);
  const version = await waitFor(`http://127.0.0.1:${debugPort}/json/version`, 'Chrome DevTools');
  const browserInfo = await version.json();
  browserSocket = new WebSocket(browserInfo.webSocketDebuggerUrl);
  await new Promise((ok, fail) => {
    browserSocket.addEventListener('open', ok, { once: true });
    browserSocket.addEventListener('error', fail, { once: true });
  });
  browserSocket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const resolvePending = pending.get(message.id); pending.delete(message.id); resolvePending?.(message); }
  });

  const gmCtx = await cdp('Target.createBrowserContext');
  const playerCtx = await cdp('Target.createBrowserContext');
  const gm = await openContext(gmCtx.browserContextId, 'gm', `workspace-acceptance-gm-${process.pid}`, webUrl);
  const gmProjectionResponse = await fetch(`${baseUrl}/api/state`, { headers: { authorization: `Bearer ${gmToken}` } });
  const gmProjection = await gmProjectionResponse.json();
  assert.equal(gmProjectionResponse.status, 200);
  assert.ok(gmProjection.actors.length >= 2, 'GM seeded the fixture actors');
  for (const actor of gmProjection.actors) {
    const grant = await fetch(`${baseUrl}/api/actors/${encodeURIComponent(actor.id)}/grants`, { method: 'POST', headers: { authorization: `Bearer ${gmToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ memberId: playerMemberId, permissions: ['read', 'act'] }) });
    assert.equal(grant.status, 201, `GM grants player access to ${actor.id}`);
  }
  const player = await openContext(playerCtx.browserContextId, 'player', `workspace-acceptance-player-${process.pid}`, playerWebUrl);

  const gmState = await evaluate(gm.sessionId, `(() => { const e = document.querySelector('.gm-note'); return {note:e?.textContent || '', actor:document.querySelector('.character-view h3')?.textContent || '', key:Object.keys(localStorage).find(k=>k.startsWith('potomac:workspace:')), body:document.body.innerText.slice(0,900)} })()`);
  assert.match(gmState.note, /The magistrate recognizes Mira\./, `GM sees the fixture secret note: ${JSON.stringify(gmState)}`);
  const playerState = await evaluate(player.sessionId, `(() => ({ note:document.querySelector('.gm-note')?.textContent || '', text:document.body.innerText }))()`);
  assert.equal(playerState.note, '', 'player UI has no GM-only note');
  await delay(450);
  assert.ok(player.secrets.some(item => item.url.includes('/api/state') && !item.body.includes('The magistrate recognizes Mira.')), 'player /api/state network response excludes the GM-only fixture note');
  assert.ok(player.secrets.every(item => !item.body.includes('The magistrate recognizes Mira.')), 'no captured player API payload contains the forbidden note');

  // Separate browser contexts must retain separate profile-specific layouts.
  assert.notEqual(gmState.key, undefined);
  const initialPlayerKey = await evaluate(player.sessionId, `Object.keys(localStorage).find(k=>k.startsWith('potomac:workspace:'))`);
  assert.notEqual(gmState.key, initialPlayerKey, 'GM and player browser contexts have distinct layout storage');

  await evaluate(gm.sessionId, "(() => { const select=document.querySelector('#encounter-select'); select.value='encounter-a'; select.dispatchEvent(new Event('change',{bubbles:true})); })()");
  await clickText(gm.sessionId, 'Set active');
  await waitForExpression(gm.sessionId, "document.querySelector('.session-strip strong')?.textContent === 'The Glass Bridge'", 'active encounter A');

  // Exercise dashboard/group/brick creation through the actual controls.
  await clickText(gm.sessionId, 'Edit layout');
  await evaluate(gm.sessionId, "window.prompt = (_message, fallback) => _message === 'Group name' ? 'Acceptance Group' : 'Acceptance Dashboard'; window.confirm = () => true");
  await clickText(gm.sessionId, '+ Group');
  await waitForExpression(gm.sessionId, "document.querySelector('.dashboard-tabs [role=tab]')?.textContent === 'New dashboard'", 'new dashboard after group creation');
  await clickText(gm.sessionId, '+ Add brick');
  await clickText(gm.sessionId, 'Encounter Summary');
  await waitForExpression(gm.sessionId, "document.querySelector('.brick')?.textContent.includes('The Glass Bridge')", 'follow encounter brick');
  await clickText(gm.sessionId, '+ Add brick');
  await clickText(gm.sessionId, 'Character Sheet');
  await waitForExpression(gm.sessionId, "[...document.querySelectorAll('.character-view h3')].some(e=>e.textContent==='Mira Vell')", 'pinned character brick');
  const gmLayoutsBefore = await evaluate(gm.sessionId, `JSON.parse(localStorage.getItem(${JSON.stringify(gmState.key)}))`);
  assert.ok(gmLayoutsBefore.groups.some(group => group.name === 'Acceptance Group'), 'dashboard group is saved in the GM profile');
  const playerLayoutsBefore = await evaluate(player.sessionId, `JSON.parse(localStorage.getItem(${JSON.stringify(initialPlayerKey)}))`);
  assert.equal(playerLayoutsBefore.groups.some(group => group.name === 'Acceptance Group'), false, 'player layout is independent of GM group creation');

  // Pointer move, pointer resize, Escape cancellation and keyboard movement.
  const handle = await evaluate(gm.sessionId, "(() => { const r=document.querySelector('.brick-drag-handle').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()");
  const initialLayout = await evaluate(gm.sessionId, `JSON.parse(localStorage.getItem(${JSON.stringify(gmState.key)})).dashboards.find(d=>d.id===JSON.parse(localStorage.getItem(${JSON.stringify(gmState.key)})).activeDashboardId).bricks[0].layout`);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...handle }, gm.sessionId);
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...handle, button: 'left', clickCount: 1 }, gm.sessionId);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + 65, y: handle.y + 45, button: 'left' }, gm.sessionId);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, gm.sessionId);
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, gm.sessionId);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x + 65, y: handle.y + 45, button: 'left', clickCount: 1 }, gm.sessionId);
  await delay(160);
  assert.deepEqual(await evaluate(gm.sessionId, `JSON.parse(localStorage.getItem(${JSON.stringify(gmState.key)})).dashboards.find(d=>d.id===JSON.parse(localStorage.getItem(${JSON.stringify(gmState.key)})).activeDashboardId).bricks[0].layout`), initialLayout, 'Escape cancels pointer drag without saving');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...handle }, gm.sessionId);
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...handle, button: 'left', clickCount: 1 }, gm.sessionId);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + 120, y: handle.y + 80, button: 'left' }, gm.sessionId);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x + 120, y: handle.y + 80, button: 'left', clickCount: 1 }, gm.sessionId);
  await delay(200);
  const movedLayout = await evaluate(gm.sessionId, `JSON.parse(localStorage.getItem(${JSON.stringify(gmState.key)})).dashboards.find(d=>d.id===JSON.parse(localStorage.getItem(${JSON.stringify(gmState.key)})).activeDashboardId).bricks[0].layout`);
  assert.notDeepEqual(movedLayout, initialLayout, 'pointer drag commits a changed grid layout');
  assert.ok(Number.isInteger(movedLayout.x) && Number.isInteger(movedLayout.y), 'pointer drag snaps to integer grid coordinates');
  const resizePoint = await evaluate(gm.sessionId, "(() => { const r=document.querySelector('.brick-resize-handle').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()");
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...resizePoint }, gm.sessionId);
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...resizePoint, button: 'left', clickCount: 1 }, gm.sessionId);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: resizePoint.x + 95, y: resizePoint.y + 80, button: 'left' }, gm.sessionId);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: resizePoint.x + 95, y: resizePoint.y + 80, button: 'left', clickCount: 1 }, gm.sessionId);
  await delay(180);
  const resizedLayout = await evaluate(gm.sessionId, `JSON.parse(localStorage.getItem(${JSON.stringify(gmState.key)})).dashboards.find(d=>d.id===JSON.parse(localStorage.getItem(${JSON.stringify(gmState.key)})).activeDashboardId).bricks[0].layout`);
  assert.ok(resizedLayout.w !== movedLayout.w || resizedLayout.h !== movedLayout.h, 'pointer resize changes brick grid dimensions');
  assert.ok(Number.isInteger(resizedLayout.w) && Number.isInteger(resizedLayout.h), 'pointer resize snaps to integer grid dimensions');
  const beforeKeyboard = await evaluate(gm.sessionId, `JSON.parse(localStorage.getItem(${JSON.stringify(gmState.key)})).dashboards.find(d=>d.id===JSON.parse(localStorage.getItem(${JSON.stringify(gmState.key)})).activeDashboardId).bricks[0].layout`);
  await evaluate(gm.sessionId, "document.querySelector('[aria-label=\"Move brick right\"]').focus()");
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, gm.sessionId);
  await cdp('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 }, gm.sessionId);
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, gm.sessionId);
  await delay(100);
  const afterKeyboard = await evaluate(gm.sessionId, `JSON.parse(localStorage.getItem(${JSON.stringify(gmState.key)})).dashboards.find(d=>d.id===JSON.parse(localStorage.getItem(${JSON.stringify(gmState.key)})).activeDashboardId).bricks[0].layout`);
  assert.notEqual(afterKeyboard.x, beforeKeyboard.x, `keyboard move control changes brick position: ${JSON.stringify({ beforeKeyboard, afterKeyboard })}`);
  await evaluate(gm.sessionId, "document.querySelector('[aria-label=\"Make brick taller\"]').focus()");
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, gm.sessionId);
  await cdp('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 }, gm.sessionId);
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, gm.sessionId);
  await delay(100);
  const afterKeyboardResize = await evaluate(gm.sessionId, `JSON.parse(localStorage.getItem(${JSON.stringify(gmState.key)})).dashboards.find(d=>d.id===JSON.parse(localStorage.getItem(${JSON.stringify(gmState.key)})).activeDashboardId).bricks[0].layout`);
  assert.notEqual(afterKeyboardResize.h, afterKeyboard.h, 'keyboard resize control changes brick height');
  const rectangles = await evaluate(gm.sessionId, "[...document.querySelectorAll('.brick')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})");
  for (let a = 0; a < rectangles.length; a++) for (let b = a + 1; b < rectangles.length; b++) {
    const x = rectangles[a], y = rectangles[b];
    assert.equal(x.x < y.x + y.w && x.x + x.w > y.x && x.y < y.y + y.h && x.y + x.h > y.y, false, 'brick grid has no overlapping rectangles');
  }
  const gmSavedWorkspace = await evaluate(gm.sessionId, `localStorage.getItem(${JSON.stringify(gmState.key)})`);
  await cdp('Page.reload', { ignoreCache: true }, gm.sessionId);
  await delay(300);
  await waitForExpression(gm.sessionId, "document.querySelector('.campaign-select strong')?.textContent !== 'Connecting…'", 'GM reload');
  await waitForExpression(gm.sessionId, "[...document.querySelectorAll('.intro-actions button')].some(button => button.textContent.includes('Edit layout'))", 'GM view mode after reload');
  assert.equal(await evaluate(gm.sessionId, `localStorage.getItem(${JSON.stringify(gmState.key)})`), gmSavedWorkspace, 'GM dashboard, group and brick layouts persist across reload');
  await clickText(gm.sessionId, 'Edit layout');

  // Context following versus a separately pinned character; accepted action and live activity refresh.
  await waitForExpression(player.sessionId, "document.querySelector('.encounter-summary h3')?.textContent === 'The Glass Bridge'", 'player follower at encounter A');
  const playerLayoutBeforeContext = await evaluate(player.sessionId, `localStorage.getItem(${JSON.stringify(initialPlayerKey)})`);
  await evaluate(gm.sessionId, `(() => { const select=document.querySelector('#encounter-select'); select.value='encounter-b'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await clickText(gm.sessionId, 'Set active');
  await waitForExpression(gm.sessionId, "document.querySelector('.encounter-summary h3')?.textContent === 'The Sunken Archive'", 'follower updated to encounter B');
  await waitForExpression(player.sessionId, "document.querySelector('.encounter-summary h3')?.textContent === 'The Sunken Archive'", 'player follower updated to encounter B');
  assert.equal(await evaluate(player.sessionId, `localStorage.getItem(${JSON.stringify(initialPlayerKey)})`), playerLayoutBeforeContext, 'shared context update does not change player layout');
  assert.match(await evaluate(gm.sessionId, "document.querySelector('.character-view h3')?.textContent || ''"), /Mira Vell/, 'pinned character brick remains bound to its character');
  await click(gm.sessionId, '.character-view .action-grid button');
  await waitForExpression(gm.sessionId, "document.querySelector('.action-status')?.textContent.includes('accepted by host')", 'host-accepted action');
  assert.ok(gm.secrets.some(item => item.url.includes('/api/actions') && item.body.includes('"actionId":"spend-mana"')), 'host action response is present in the GM network trace');
  await waitForExpression(player.sessionId, "document.querySelector('.activity-item strong')?.textContent", 'player activity refresh after authorized action');
  assert.ok(player.secrets.every(item => !item.body.includes('The magistrate recognizes Mira.')), 'player payloads stay redacted after activity refresh');

  // Host-side authorization and client recovery are checked independently.
  const denied = await fetch(`${baseUrl}/api/context`, { method: 'POST', headers: { authorization: `Bearer ${playerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ context: { activeEncounter: 'encounter-a' } }) });
  assert.equal(denied.status, 403, 'host rejects player context mutation');
  const gmKey = gmState.key;
  const savedPlayerWorkspace = await evaluate(player.sessionId, `localStorage.getItem(${JSON.stringify(initialPlayerKey)})`);
  assert.ok(savedPlayerWorkspace, 'player layout has been persisted before reload');
  await evaluate(gm.sessionId, `localStorage.setItem(${JSON.stringify(gmKey)}, JSON.stringify({schemaVersion:999}))`);
  await cdp('Page.reload', { ignoreCache: true }, gm.sessionId);
  await waitForExpression(gm.sessionId, "document.querySelector('.error-banner')?.textContent.includes('safe layout was recovered')", 'invalid layout recovery banner');
  await click(gm.sessionId, '.error-banner button');
  await waitForExpression(gm.sessionId, "Boolean(document.querySelector('.brick') || document.querySelector('.empty-dashboard'))", 'recovered dashboard remains usable');

  // Reload validates per-profile persistence in both isolated browser contexts.
  await cdp('Page.reload', { ignoreCache: true }, player.sessionId);
  await delay(300);
  await waitForExpression(player.sessionId, "Boolean(document.querySelector('.topbar-right select'))", 'player role selector after reload');
  await evaluate(player.sessionId, "(() => { const select=document.querySelector('.topbar-right select'); select.value='player'; select.dispatchEvent(new Event('change',{bubbles:true})); })()");
  await waitForExpression(player.sessionId, "document.querySelector('.campaign-select strong')?.textContent !== 'Connecting…'", 'player reload');
  assert.equal(await evaluate(player.sessionId, "localStorage.getItem('potomac.workspace.demo-profile')"), `workspace-acceptance-player-${process.pid}`);
  assert.equal(await evaluate(player.sessionId, `localStorage.getItem(${JSON.stringify(initialPlayerKey)})`), savedPlayerWorkspace, 'player layout remains unchanged across reload');
  console.log('PASS: isolated GM/player sessions; dashboard/group/brick flows; pointer snap and keyboard movement; encounter follow and pinned character; accepted action and live authorized activity; player network secrecy; host permission denial; recovery and reload persistence.');
  console.log(`Isolated host database: ${dbPath}`);
  console.log('Note: browser profile layout is verified across reload; the runner cleans its temporary profile and database on exit.');
} catch (error) {
  const logs = children.map(({ getOutput }) => getOutput()).filter(Boolean).join('\n');
  console.error(`FAIL: ${error.stack || error.message}${logs ? `\nProcess output:\n${logs}` : ''}`);
  process.exitCode = 1;
} finally {
  try { if (browserSocket?.readyState === WebSocket.OPEN) await cdp('Browser.close', {}, undefined); } catch {}
  try { browserSocket?.close(); } catch {}
  for (const { child } of [...children].reverse()) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  await Promise.all(children.map(({ child }) => new Promise(resolvePromise => {
    if (child.exitCode !== null) return resolvePromise();
    const timeout = setTimeout(() => { child.kill('SIGKILL'); resolvePromise(); }, 2500);
    child.once('exit', () => { clearTimeout(timeout); resolvePromise(); });
  })));
  // Chrome may briefly recreate profile files after Browser.close acknowledges.
  await rm(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
