import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHost } from '../server/host/index.mjs';

const root = resolve(import.meta.dirname, '..');
const chromePath = [process.env.POTOMAC_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
if (!chromePath) throw new Error('Chrome/Edge not found. Set POTOMAC_CHROME to its executable path.');
async function freePort() { const server = createServer(); await new Promise((ok, bad) => server.once('error', bad).listen(0, '127.0.0.1', ok)); const value = server.address().port; await new Promise((ok, bad) => server.close(error => error ? bad(error) : ok())); return value; }
const scratch = await mkdtemp(join(tmpdir(), 'potomac-v2-reactions-browser-'));
const databasePath = join(scratch, 'host.sqlite'); const hostPort = await freePort(); const webPort = await freePort(); const debugPort = await freePort();
const children = []; let host; let socket; let webServer; let sequence = 0; const pendingCalls = new Map(); const contexts = new Map(); let draws = 0;
const spawnTracked = (command, args, options = {}) => { const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options }); let output = ''; child.stdout.on('data', chunk => { output += chunk.toString(); }); child.stderr.on('data', chunk => { output += chunk.toString(); }); children.push({ child, get output() { return output; } }); return child; };
const call = (method, params = {}, sessionId) => new Promise((ok, bad) => { const id = ++sequence; const timer = setTimeout(() => { pendingCalls.delete(id); bad(new Error('CDP ' + method + ' timed out')); }, 15000); pendingCalls.set(id, message => { clearTimeout(timer); message.error ? bad(new Error(message.error.message)) : ok(message.result); }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
const evaluate = async (session, expression) => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
async function waitFor(session, expression, label, timeoutMs = 20000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { if (await evaluate(session, expression)) return; await delay(120); } throw new Error('Timed out waiting for ' + label + ': ' + await evaluate(session, 'document.body.innerText.slice(0,1000)')); }
async function setInput(session, selector, value) { await evaluate(session, "(()=>{const el=document.querySelector(" + JSON.stringify(selector) + ");const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(el," + JSON.stringify(value) + ");el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true})()"); }
async function clickText(session, text) { await call('Page.bringToFront', {}, session); const clicked = await evaluate(session, "(()=>{const el=[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===" + JSON.stringify(text) + ");if(!el||el.disabled)return false;el.scrollIntoView({block:'center'});el.click();return true})()"); assert.equal(clicked, true, 'button ' + text + ' is enabled and present'); }
async function openPage(name) { const context = await call('Target.createBrowserContext'); contexts.set(name, context.browserContextId); const target = await call('Target.createTarget', { url: 'about:blank', browserContextId: context.browserContextId }); const attached = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true }); const session = attached.sessionId; await call('Page.enable', {}, session); await call('Runtime.enable', {}, session); await call('Page.navigate', { url: 'http://127.0.0.1:' + webPort + '/v2-reactions.html?experimentalV2=1&entity=interrupt-record&host=' + encodeURIComponent('http://127.0.0.1:' + hostPort) }, session); await waitFor(session, 'Boolean(document.querySelector("#credential"))', name + ' reaction panel'); return session; }
async function startHost() { host = createHost({ databasePath, campaignId: 'campaign-v2-browser-reactions', enableV2Api: true, v2RandomInt: min => { draws++; return min; } }); await host.listen(hostPort); }
const request = (path, token, options = {}) => fetch('http://127.0.0.1:' + hostPort + path, { ...options, headers: { authorization: 'Bearer ' + token, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
const send = (path, body, token = 'local-gm', headers = {}) => request(path, token, { method: 'POST', body: JSON.stringify(body), headers });

try {
  await startHost();
  webServer = createHttpServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const files = { '/v2-reactions.html': ['clients/web/v2-reactions.html', 'text/html; charset=utf-8'], '/src/v2-reaction-panel.js': ['clients/web/src/v2-reaction-panel.js', 'text/javascript; charset=utf-8'] };
    const file = files[pathname]; if (!file) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': file[1] }); res.end(readFileSync(join(root, file[0])));
  });
  await new Promise((ok, bad) => webServer.once('error', bad).listen(webPort, '127.0.0.1', ok));
  const playerA = await (await send('/api/members/enroll', { displayName: 'Browser Player A' })).json();
  const playerB = await (await send('/api/members/enroll', { displayName: 'Browser Player B' })).json();
  const pin = await request('/api/v2/campaign/lock', 'local-gm', { method: 'PUT', body: JSON.stringify({ moduleId: 'example.interruption' }), headers: { 'content-type': 'application/json' } }); assert.equal(pin.status, 201, await pin.clone().text()); const lockDigest = (await pin.json()).digest; const lockHeader = { 'x-v2-lock-digest': lockDigest };
  const create = await send('/api/v2/entities', { operationId: 'browser-interruption-create', entityId: 'interrupt-record', typeId: 'example.interruption.record', visibility: 'owner', ownerPrincipalId: playerB.memberId, data: { title: 'Signal from the old station', status: 'ready', lastChoice: 'none', gmNote: '' } }, 'local-gm', lockHeader); assert.equal(create.status, 201, await create.clone().text());
  assert.equal((await send('/api/v2/entities/interrupt-record/grants', { memberId: playerA.memberId, permissions: ['act'] }, 'local-gm', lockHeader)).status, 201);
  spawnTracked(chromePath, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', '--remote-debugging-port=' + debugPort, '--user-data-dir=' + join(scratch, 'chrome-profile'), 'about:blank']);
  let info; for (let i = 0; i < 200; i++) { try { info = await (await fetch('http://127.0.0.1:' + debugPort + '/json/version')).json(); break; } catch { await delay(100); } }
  assert.ok(info?.webSocketDebuggerUrl, 'Chromium remote debugging started'); socket = new WebSocket(info.webSocketDebuggerUrl); await new Promise((ok, bad) => { socket.addEventListener('open', ok, { once: true }); socket.addEventListener('error', bad, { once: true }); });
  socket.addEventListener('message', event => { const msg = JSON.parse(event.data); if (msg.id && pendingCalls.has(msg.id)) { const resolveCall = pendingCalls.get(msg.id); pendingCalls.delete(msg.id); resolveCall(msg); } });
  const gm = await openPage('gm'); const a = await openPage('playerA'); const b = await openPage('playerB');
  for (const [session, credential] of [[gm, 'local-gm'], [a, playerA.credential], [b, playerB.credential]]) { await setInput(session, '#credential', credential); await clickText(session, 'Refresh host state'); await waitFor(session, 'document.querySelector("[data-testid=committed-state]")', 'authenticated V2 projection'); }
  assert.equal(await evaluate(a, 'document.querySelector("#initiate").disabled'), false, 'Player A action is enabled');
  await evaluate(a, 'document.querySelector("#initiate").click()');
  for (let attempt = 0; attempt < 8 && host.db.prepare("SELECT COUNT(*) AS n FROM v2_extension_pending_commands WHERE status='pending'").get().n === 0; attempt++) { await delay(300); await evaluate(a, 'document.querySelector("#initiate").click()'); }
  await delay(200);
  assert.equal(host.db.prepare("SELECT COUNT(*) AS n FROM v2_extension_pending_commands WHERE status='pending'").get().n, 1, 'Player A browser control creates a durable suspended command: ' + await evaluate(a, 'document.querySelector("#message").textContent'));
  await waitFor(b, 'document.querySelector("article[aria-label^=\\"Reaction\\"]")', 'Player B sees pending reaction');
  await waitFor(gm, 'document.body.innerText.includes("GM adjudicate: accept")', 'GM adjudication controls');
  assert.equal(await evaluate(a, 'document.querySelector("article[aria-label^=\\"Reaction\\"]")===null'), true, 'initiator cannot see the GM-private window');
  assert.equal(await evaluate(b, 'document.body.innerText.includes("GM adjudicate")'), false, 'player projection omits GM controls');
  const parent = host.db.prepare("SELECT operation_id,window_id,status FROM v2_extension_pending_commands WHERE entity_id='interrupt-record'").get(); assert.equal(parent.status, 'pending'); const operationId = parent.operation_id; const windowId = parent.window_id;
  assert.equal(draws, 1); host.close(); await delay(150); await startHost();
  await waitFor(b, 'document.body.innerText.includes("Pending decision")', 'reaction survives host restart');
  await clickText(b, 'Accept');
  await waitFor(b, 'document.querySelector("[data-testid=committed-state]")?.textContent.includes("accepted")', 'Player B sees resumed state');
  await waitFor(b, 'document.querySelector("#combat-log")?.textContent.includes("command.resumed")', 'authorized result appears in the browser event feed');
  await waitFor(gm, 'document.body.innerText.includes("GM note: The hidden table prompt")', 'GM projection retains private continuation result');
  assert.equal(await evaluate(b, 'document.body.innerText.includes("hidden table prompt")'), false, 'private continuation and GM result stay hidden from Player B');
  assert.equal(draws, 2, 'resume random draw is host-generated after restart');
  const parentDone = host.db.prepare('SELECT status FROM v2_extension_pending_commands WHERE operation_id=?').get(operationId); assert.equal(parentDone.status, 'completed');
  assert.equal(host.db.prepare('SELECT COUNT(*) AS n FROM v2_effect_receipts WHERE operation_id=?').get(operationId).n, 1);
  const audit = host.db.prepare("SELECT payload FROM v2_extension_events WHERE operation_id=? AND kind='command.resumed'").get(operationId); assert.deepEqual(JSON.parse(audit.payload).randomness, []);
  const gmView = await (await request('/api/v2/entities/interrupt-record', 'local-gm', { headers: lockHeader })).json(); assert.match(gmView.data.gmNote, /hidden table prompt/);
  const playerView = await (await request('/api/v2/entities/interrupt-record', playerB.credential, { headers: lockHeader })).json(); assert.equal('gmNote' in playerView.data, false);
  assert.equal(host.db.prepare('SELECT status FROM v2_reaction_windows WHERE window_id=?').get(windowId).status, 'resolved');
  console.log('V2 reaction real-browser acceptance passed: isolated GM/Player A/Player B Chromium contexts, Player A UI suspension, restart while pending, Player B UI response, exactly-once resume and private projection.');
  for (const browserContextId of contexts.values()) await call('Target.disposeBrowserContext', { browserContextId });
} finally {
  try { if (socket?.readyState === WebSocket.OPEN) socket.close(); } catch {}
  if (webServer) await new Promise(ok => webServer.close(ok));
  host?.close();
  for (const { child } of children) {
    if (!child.killed) child.kill();
    if (child.exitCode === null) await Promise.race([new Promise(resolveExit => child.once('exit', resolveExit)), delay(3000)]);
  }
  await delay(100);
  for (let attempt = 0; attempt < 5; attempt++) { try { await rm(scratch, { recursive: true, force: true }); break; } catch (error) { if (attempt === 4 || !['EBUSY', 'EPERM'].includes(error.code)) throw error; await delay(250); } }
}
