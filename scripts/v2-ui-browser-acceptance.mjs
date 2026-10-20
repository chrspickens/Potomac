import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const chromePath = [process.env.POTOMAC_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
if (!chromePath) throw new Error('Chrome/Edge not found. Set POTOMAC_CHROME to its executable path.');

async function port() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolveListen));
  const value = server.address().port;
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return value;
}
const scratch = await mkdtemp(join(tmpdir(), 'potomac-v2-ui-acceptance-'));
const profile = join(scratch, 'chrome-profile');
const webPort = await port();
const debugPort = await port();
const children = [];
let socket;
let sequence = 0;
const pending = new Map();
const spawnTracked = (command, args, options = {}) => {
  const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  children.push({ child, get output() { return output; } });
  return child;
};
function cdp(method, params = {}, sessionId) {
  return new Promise((resolveMessage, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 10000);
    pending.set(id, message => { clearTimeout(timer); message.error ? reject(new Error(message.error.message)) : resolveMessage(message.result); });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(sessionId, expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(sessionId, expression, label, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await evaluate(sessionId, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}: ${await evaluate(sessionId, 'document.body.innerText.slice(0,800)')}`);
}
async function key(sessionId, keyName, code = keyName, modifiers = 0) {
  if (keyName === 'Enter') {
    await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code, modifiers, windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, sessionId);
    await cdp('Input.dispatchKeyEvent', { type: 'char', key: keyName, code, modifiers, text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 }, sessionId);
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, modifiers, windowsVirtualKeyCode: 13 }, sessionId);
    return;
  }
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, modifiers }, sessionId);
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, modifiers }, sessionId);
}

try {
  spawnTracked(process.execPath, [join(root, 'clients/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { cwd: join(root, 'clients/web') });
  let serverReady = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${webPort}/v2-ui-test-harness.html`)).ok) { serverReady = true; break; } } catch {}
    await delay(100);
  }
  assert.ok(serverReady, `Vite did not start. ${children.map(item => item.output).join('\n')}`);

  spawnTracked(chromePath, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank']);
  let browserInfo;
  for (let attempt = 0; attempt < 200; attempt++) {
    try { browserInfo = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); break; } catch { await delay(100); }
  }
  assert.ok(browserInfo?.webSocketDebuggerUrl, 'Chromium remote debugging endpoint did not start');
  socket = new WebSocket(browserInfo.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { const resolveMessage = pending.get(message.id); pending.delete(message.id); resolveMessage(message); }
  });
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Page.enable', {}, sessionId);
  await cdp('Runtime.enable', {}, sessionId);
  await cdp('Page.navigate', { url: `http://127.0.0.1:${webPort}/v2-ui-test-harness.html` }, sessionId);
  await waitFor(sessionId, 'window.__v2Ready === true && document.querySelectorAll(".v2-ui-contribution").length === 2', 'experimental React contribution mounts');

  const privacy = await evaluate(sessionId, `({permitted:document.querySelector('#permitted').innerText, denied:document.querySelector('#denied').innerText, deniedButtons:document.querySelectorAll('#denied button').length, labels:[...document.querySelectorAll('#permitted label')].map(item=>item.textContent.trim())})`);
  assert.match(privacy.permitted, /Available power/);
  assert.equal(privacy.deniedButtons, 0, 'host-denied commands are not rendered');
  assert.ok(privacy.labels.includes('Subsystem *') && privacy.labels.includes('Amount *'), `composed form has associated accessible labels; labels=${JSON.stringify(privacy.labels)}; permitted text=${JSON.stringify(privacy.permitted)}; markup=${await evaluate(sessionId, 'document.querySelector("#permitted").innerHTML')}`);

  await key(sessionId, 'Tab');
  assert.equal(await evaluate(sessionId, 'document.activeElement.tagName'), 'SELECT', 'native select is reachable by keyboard');
  assert.equal(await evaluate(sessionId, 'document.activeElement.matches(":focus-visible")'), true, 'keyboard focus has visible styling');
  await key(sessionId, 'ArrowDown');
  await key(sessionId, 'Tab');
  assert.equal(await evaluate(sessionId, 'document.activeElement.name'), 'amount', 'next Tab reaches the numeric form field');
  await key(sessionId, 'Tab');
  assert.equal(await evaluate(sessionId, 'document.activeElement.type'), 'submit', 'submit control is keyboard reachable');
  await key(sessionId, 'Enter');
  await waitFor(sessionId, 'Boolean(document.querySelector("#permitted [role=alert]"))', 'friendly required-input error');
  assert.equal(await evaluate(sessionId, 'window.__v2Submissions.length'), 0, 'invalid form does not invoke the host command');

  await key(sessionId, 'Tab', 'Tab', 8);
  await cdp('Input.insertText', { text: '101' }, sessionId);
  await key(sessionId, 'Tab');
  await key(sessionId, 'Enter');
  await waitFor(sessionId, 'document.querySelector("#permitted [role=alert]")?.textContent.includes("0–100")', 'friendly numeric-bound error');
  assert.equal(await evaluate(sessionId, 'window.__v2Submissions.length'), 0, 'out-of-range input does not invoke the host command');
  await key(sessionId, 'Tab', 'Tab', 8);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2 }, sessionId);
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2 }, sessionId);
  await cdp('Input.insertText', { text: '12' }, sessionId);
  await key(sessionId, 'Tab');
  assert.equal(await evaluate(sessionId, 'document.activeElement.type'), 'submit');
  await key(sessionId, 'Enter');
  await waitFor(sessionId, 'document.querySelector("#permitted button[type=submit]")?.textContent === "Submitting…"', 'pending feedback after keyboard submit');
  await waitFor(sessionId, 'window.__v2Submissions.length === 1', 'host command callback');
  const submitted = await evaluate(sessionId, 'window.__v2Submissions[0]');
  assert.equal(submitted.commandId, 'example.starship.reactor.allocate-power');
  assert.equal(submitted.input.subsystem, 'propulsion', 'enum retains its typed value');
  assert.equal(submitted.input.amount, 12, 'numeric input is submitted as a number');
  assert.equal(submitted.expectedRevision, 4, 'command carries the host projection revision');
  assert.ok(submitted.operationId, 'command has an operation identity');

  await evaluate(sessionId, `(()=>{window.__v2ResponseStatus = 'pending'; const subsystem = document.querySelector('#permitted select[name="subsystem"]'); subsystem.value = '0'; subsystem.dispatchEvent(new Event('change', { bubbles: true })); const amount = document.querySelector('#permitted input[name="amount"]'); amount.value = '13'; amount.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#permitted form').requestSubmit()})()`);
  await waitFor(sessionId, 'window.__v2Submissions.length === 2 && document.querySelector("#permitted form [role=status]")?.textContent.includes("effects are not committed yet")', 'durable pending feedback without claiming commit');
  const pendingSubmission = await evaluate(sessionId, 'window.__v2Submissions[1]');
  assert.equal(pendingSubmission.input.amount, 13);
  const pendingText = await evaluate(sessionId, 'document.querySelector("#permitted form").innerText');
  assert.match(pendingText, /effects are not committed yet/);
  assert.doesNotMatch(pendingText, /committed by the host/);

  await evaluate(sessionId, `(()=>{const amount = document.querySelector('#permitted input[name="amount"]'); amount.value = '14'; amount.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#permitted form').requestSubmit()})()`);
  await waitFor(sessionId, 'document.querySelector("#permitted form [role=alert]")?.textContent.includes("Retry its exact inputs")', 'changed input blocked while prior command outcome is unknown');
  assert.equal(await evaluate(sessionId, 'window.__v2Submissions.length'), 2, 'changed input cannot create a second operation while the pending receipt is unresolved');

  await evaluate(sessionId, `sessionStorage.setItem('harnessRevision', '5')`);
  await cdp('Page.navigate', { url: `http://127.0.0.1:${webPort}/v2-ui-test-harness.html` }, sessionId);
  await waitFor(sessionId, `location.pathname==='/v2-ui-test-harness.html' && document.readyState==='complete' && window.__v2Ready===true && window.__v2Submissions.length===2`, 'restore pending exact intent after refreshed revision', 30000);
  assert.equal(await evaluate(sessionId, 'document.querySelector("#permitted input[name=amount]").value'), '13', 'pending input is retained across renderer restart');
  await evaluate(sessionId, `document.querySelector('#permitted form').requestSubmit()`);
  await waitFor(sessionId, 'window.__v2Submissions.length === 3 && document.querySelector("#permitted form [role=status]")?.textContent.includes("committed by the host")', 'exact retry replays the original intent');
  const exactRetry = await evaluate(sessionId, 'window.__v2Submissions[2]');
  assert.equal(exactRetry.operationId, pendingSubmission.operationId, 'retry after refresh preserves the original operation id');
  assert.equal(exactRetry.expectedRevision, pendingSubmission.expectedRevision, 'retry after refresh preserves original expected revision');
  assert.deepEqual(exactRetry.input, pendingSubmission.input, 'retry after refresh preserves exact command payload');

  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
  const narrow = await evaluate(sessionId, '({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,formWidth:document.querySelector("#permitted form").getBoundingClientRect().width})');
  assert.ok(narrow.scrollWidth <= narrow.width, `V2 contribution introduces no horizontal overflow at 390px: ${JSON.stringify(narrow)}`);
  console.log('V2 UI browser acceptance passed: privacy-filtered commands, accessible labels, keyboard validation/submission, typed inputs, pending feedback, revision/idempotency metadata, and 390px layout.');
} finally {
  try { if (socket?.readyState === WebSocket.OPEN) socket.close(); } catch {}
  for (const { child } of children) if (!child.killed) child.kill();
  await delay(150);
  await rm(scratch, { recursive: true, force: true });
}
