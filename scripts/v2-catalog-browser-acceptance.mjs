import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { validateModule } from './v2-module.mjs';
import { createHost } from '../server/host/index.mjs';

const root = resolve(import.meta.dirname, '..');
const chrome = [process.env.POTOMAC_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
if (!chrome) throw new Error('Chrome/Edge not found. Set POTOMAC_CHROME.');
const scratch = await mkdtemp(join(tmpdir(), 'potomac-v2-catalog-acceptance-'));
const port = async () => { const server = createServer(); await new Promise((ok, bad) => server.once('error', bad).listen(0, '127.0.0.1', ok)); const value = server.address().port; await new Promise((ok, bad) => server.close(error => error ? bad(error) : ok())); return value; };
const hostPort = await port(), webPort = await port(), debugPort = await port();
let host, socket, sequence = 0; const children = [], pending = new Map(), sessions = {}, contexts = [];
const startChild = (cmd, args, options = {}) => { const child = spawn(cmd, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options }); let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk); children.push({ child, get output() { return output; } }); return child; };
const call = (method, params = {}, sessionId) => new Promise((ok, bad) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); bad(new Error(`CDP ${method} timed out`)); }, 15000); pending.set(id, message => { clearTimeout(timer); message.error ? bad(new Error(message.error.message)) : ok(message.result); }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
const evaluate = async (name, expression) => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessions[name]); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
const wait = async (name, expression, label) => { const end = Date.now() + 20000; while (Date.now() < end) { if (await evaluate(name, expression)) return; await delay(100); } throw new Error(`Timed out: ${label}; ${await evaluate(name, 'document.body.innerText.slice(0,1200)')}`); };
const click = async (name, label) => assert.equal(await evaluate(name, `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)return false;b.click();return true})()`), true, `enabled button ${label}`);
const input = async (name, selector, value) => assert.equal(await evaluate(name, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;const s=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set;s.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`), true, `input ${selector}`);
async function startHost() { host = createHost({ databasePath: join(scratch, 'host.sqlite'), campaignId: 'campaign-v2-generic-catalog', enableV2Api: true }); await host.listen(hostPort); }
async function openPage(name, url = '/v2-modules') { const context = await call('Target.createBrowserContext'); contexts.push(context.browserContextId); const target = await call('Target.createTarget', { url: 'about:blank', browserContextId: context.browserContextId }); const attached = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true }); sessions[name] = attached.sessionId; await call('Page.enable', {}, attached.sessionId); await call('Runtime.enable', {}, attached.sessionId); await call('Page.navigate', { url: `http://127.0.0.1:${webPort}${url}` }, attached.sessionId); await wait(name, `Boolean(document.querySelector('#v2-catalog-credential'))`, `${name} login page`); }
const api = (url, token = 'local-gm', init = {}) => fetch(`http://127.0.0.1:${hostPort}${url}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } });
try {
  const cli = await validateModule(join(root, 'examples/module-starter/v2'));
  await startHost();
  startChild(process.execPath, [join(root, 'clients/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { cwd: join(root, 'clients/web'), env: { ...process.env, POTOMAC_WEB_HOST: `http://127.0.0.1:${hostPort}` } });
  for (let n = 0; n < 200; n++) { try { if ((await fetch(`http://127.0.0.1:${webPort}/v2-modules`)).ok) break; } catch {} await delay(100); }
  startChild(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(scratch, 'chrome')}`, 'about:blank']);
  let info; for (let n = 0; n < 200; n++) { try { info = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); break; } catch { await delay(100); } } assert.ok(info?.webSocketDebuggerUrl);
  socket = new WebSocket(info.webSocketDebuggerUrl); await new Promise((ok, bad) => { socket.addEventListener('open', ok, { once: true }); socket.addEventListener('error', bad, { once: true }); }); socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const done = pending.get(message.id); pending.delete(message.id); done(message); } });
  await openPage('gm'); await input('gm', '#v2-catalog-credential', 'local-gm'); await click('gm', 'Connect'); await wait('gm', `Boolean(document.querySelector('#v2-module-picker'))`, 'authenticated module catalog');
  const catalogResponse = await api('/api/v2/modules'); assert.equal(catalogResponse.status, 200); const { modules } = await catalogResponse.json();
  assert.deepEqual(new Set(modules.map(item => item.id)), new Set(['example.starship.system', 'example.revised5e', 'example.interruption', 'example.dicepool', 'example.starter', 'example.generic-entity-setup', 'example.tides-omens']));
  const starter = modules.find(item => item.id === 'example.starter'); assert.equal(starter.digest, cli.rootDigest); assert.deepEqual(new Set(starter.capabilities.map(item => item.id)), new Set(cli.lock.entries.map(item => item.id)));
  await input('gm', '#v2-module-picker', 'example.starter'); await click('gm', 'Pin exact module lock'); await wait('gm', `document.body.innerText.includes('Immutable campaign module')`, 'starter pin');
  const pin = await api('/api/v2/campaign/lock'); assert.equal(pin.status, 200); const { lock, digest } = await pin.json(); assert.equal(lock.rootModule.digest, cli.rootDigest); assert.deepEqual(lock.entries.map(({ id, apiVersion, implementationVersion, digest, source, optional }) => ({ id, apiVersion, implementationVersion, digest, source, optional })).sort((a, b) => a.id.localeCompare(b.id)), cli.lock.entries.map(({ id, apiVersion, implementationVersion, digest, source, optional }) => ({ id, apiVersion, implementationVersion, digest, source, optional })).sort((a, b) => a.id.localeCompare(b.id)));
  await click('gm', 'Create example.starter.scene'); await wait('gm', `Boolean(document.querySelector('.v2-ui-contribution'))`, 'generic starter contribution mount'); await wait('gm', `document.body.innerText.includes('Progress')`, 'generic entity detail');
  await click('gm', 'Enroll a player'); await wait('gm', `Boolean(document.querySelector('output')?.textContent.includes(':'))`, 'player enrollment credential');
  const enrollment = await evaluate('gm', `(()=>{const text=document.querySelector('output').textContent;const marker=': ';return {displayName:text.split(marker)[0],credential:text.slice(text.indexOf(marker)+marker.length)}})()`);
  const secondEnrollment = await api('/api/members/enroll', 'local-gm', { method: 'POST', body: JSON.stringify({ displayName: 'Unprivileged' }) }); assert.equal(secondEnrollment.status, 201); const unauthorizedMember = await secondEnrollment.json();
  const enrollmentPrincipal = await (await api('/api/v2/session', enrollment.credential)).json();
  await evaluate('gm', `(()=>{const s=document.querySelector('#v2-grant-member');if(!s)return false;const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(s,${JSON.stringify(enrollmentPrincipal.principalId)});s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await click('gm', 'Grant selected player read/act'); await wait('gm', `document.body.innerText.includes('Read and act grant committed')`, 'scene grant');
  const scene = await (await api('/api/v2/entities?typeId=example.starter.scene', 'local-gm', { headers: { 'x-v2-lock-digest': digest } })).json(); const entity = (scene.entities ?? scene)[0];
  await openPage('player'); await input('player', '#v2-catalog-credential', enrollment.credential); await click('player', 'Connect'); await wait('player', `Boolean(document.querySelector('.v2-ui-contribution'))`, 'player generic view'); await wait('player', `document.body.innerText.includes('Advance scene')`, 'authorized player command');
  await evaluate('player', `(()=>{window.__v2Commands=[];const f=window.fetch.bind(window);window.fetch=async(i,o={})=>{const r=await f(i,o);if(String(i).endsWith('/api/v2/commands'))window.__v2Commands.push({body:JSON.parse(o.body),response:await r.clone().json()});return r}})()`);
  await click('player', 'Advance scene'); await wait('player', `window.__v2Commands.length > 0`, 'generic player command submitted'); await wait('player', `document.body.innerText.includes('Progress') && document.body.innerText.includes('1')`, 'committed generic player effect');
  const command = await evaluate('player', `window.__v2Commands.at(-1)`); assert.ok(command?.response?.status === 'applied', JSON.stringify(command));
  const retry = await api('/api/v2/commands', enrollment.credential, { method: 'POST', body: JSON.stringify(command.body), headers: { 'x-v2-lock-digest': digest } }); assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), command.response);
  const altered = await api('/api/v2/commands', enrollment.credential, { method: 'POST', body: JSON.stringify({ ...command.body, expectedRevision: command.body.expectedRevision + 1 }), headers: { 'x-v2-lock-digest': digest } }); assert.equal(altered.status, 409);
  assert.equal((await api('/api/v2/commands', unauthorizedMember.credential, { method: 'POST', body: JSON.stringify({ ...command.body, operationId: 'unauthorized-player', expectedRevision: 2 }), headers: { 'x-v2-lock-digest': digest } })).status, 403);
  assert.equal((await api('/api/v2/campaign/lock', enrollment.credential, { method: 'PUT', body: JSON.stringify({ moduleId: 'example.dicepool' }) })).status, 403);
  assert.equal((await api('/api/v2/campaign/lock', 'local-gm', { method: 'PUT', body: JSON.stringify({ moduleId: 'example.unlisted' }) })).status, 409);
  assert.equal((await api('/api/v2/campaign/lock', 'local-gm', { method: 'PUT', body: JSON.stringify({ moduleId: 'example.dicepool' }) })).status, 409);
  assert.equal((await api('/api/v2/commands', enrollment.credential, { method: 'POST', body: JSON.stringify({ ...command.body, operationId: 'forged-principal', principalId: 'gm' }), headers: { 'x-v2-lock-digest': digest } })).status, 400);
  assert.equal(host.db.prepare('SELECT COUNT(*) AS count FROM v2_extension_receipts WHERE operation_id=?').get(command.body.operationId).count, 1);
  assert.equal(host.db.prepare('SELECT COUNT(*) AS count FROM v2_effect_events WHERE operation_id=?').get(command.body.operationId).count, 1, 'one atomic effect event is persisted');
  assert.equal(host.db.prepare('SELECT COUNT(*) AS count FROM v2_extension_events WHERE operation_id=?').get(command.body.operationId).count, 1, 'one authorized command event is persisted');
  host.close(); host = undefined; await delay(200); await startHost();
  assert.equal((await api('/api/v2/campaign/lock', enrollment.credential)).status, 200, 'exact pinned lock survives host restart');
  await click('player', 'Refresh authorized state'); await wait('player', `document.body.innerText.includes('1')`, 'player scene survives host restart');
  assert.equal((await api(`/api/v2/entities/${entity.entityId}`, enrollment.credential, { headers: { 'x-v2-lock-digest': digest } })).status, 200);
  console.log('PASS: real authenticated GM/player browsers listed and pinned exact Starter digest/lock; created generic scene; player action committed once; retry replayed; altered retry, forged identity, unauthorized/unlisted/repin attempts rejected; lock and scene survived restart.');
} catch (error) {
  console.error(error);
  console.error(children.map(item => item.output).join('\n'));
  process.exitCode = 1;
} finally {
  try { host?.close(); } catch {}
  for (const context of contexts) try { await call('Target.disposeBrowserContext', { browserContextId: context }); } catch {}
  try { await call('Browser.close'); } catch {}
  try { socket?.close(); } catch {}
  for (const item of children) try { if (item.child.exitCode === null) item.child.kill(); } catch {}
  await Promise.all(children.map(item => item.child.exitCode !== null ? Promise.resolve() : new Promise(resolveExit => { item.child.once('exit', resolveExit); setTimeout(resolveExit, 1500); })));
  await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
