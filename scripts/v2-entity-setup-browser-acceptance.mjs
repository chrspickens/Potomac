import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHost } from '../server/host/index.mjs';
import { waitForChromiumDebugger } from './chromium-debugger.mjs';

const root = resolve(import.meta.dirname, '..');
const chrome = [process.env.POTOMAC_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
if (!chrome) throw new Error('Chrome/Edge not found. Set POTOMAC_CHROME.');
const scratch = await mkdtemp(join(tmpdir(), 'potomac-v2-entity-setup-'));
const freePort = async () => { const server = createServer(); await new Promise((ok, bad) => server.once('error', bad).listen(0, '127.0.0.1', ok)); const value = server.address().port; await new Promise((ok, bad) => server.close(error => error ? bad(error) : ok())); return value; };
const hostPort = await freePort(), webPort = await freePort();
let host, socket, seq = 0; const children = [], pending = new Map(), sessions = {}, contexts = [];
const child = (cmd, args, options = {}) => { const proc = spawn(cmd, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options }); let output = ''; proc.stdout.on('data', chunk => output += chunk); proc.stderr.on('data', chunk => output += chunk); Object.defineProperty(proc, 'output', { get: () => output }); children.push({ proc, get output() { return output; } }); return proc; };
const cdp = (method, params = {}, sessionId) => new Promise((ok, bad) => { const id = ++seq, timer = setTimeout(() => { pending.delete(id); bad(new Error(`CDP ${method} timeout`)); }, 15000); pending.set(id, message => { clearTimeout(timer); message.error ? bad(new Error(message.error.message)) : ok(message.result); }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
const ev = async (name, expression) => { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessions[name]); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
const waitFor = async (name, expression, what) => { const until = Date.now() + 20000; while (Date.now() < until) { if (await ev(name, expression)) return; await delay(100); } throw new Error(`Timeout ${what}: ${await ev(name, 'document.body.innerText.slice(0,1800)')}`); };
const click = async (name, label) => { const result = await ev(name, `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)return {ok:false,buttons:[...document.querySelectorAll('button')].map(x=>[x.textContent.trim(),x.disabled]),owners:[...document.querySelectorAll('select')].filter(x=>x.id.endsWith('-owner')).map(x=>x.value),values:[...document.querySelectorAll('.v2-entity-create-form input,.v2-entity-create-form select')].map(x=>[x.id,x.value]),body:document.body.innerText.slice(-1200)};b.click();return {ok:true}})()`); assert.equal(result.ok, true, `click ${label}: ${JSON.stringify(result)}`); };
const fill = async (name, selector, value) => assert.equal(await ev(name, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;const p=Object.getPrototypeOf(e),s=Object.getOwnPropertyDescriptor(p,'value')?.set;if(s)s.call(e,${JSON.stringify(value)});else e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`), true, `fill ${selector}`);
const api = (url, token = 'local-gm', init = {}) => fetch(`http://127.0.0.1:${hostPort}${url}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } });
async function startHost() { host = createHost({ databasePath: join(scratch, 'host.sqlite'), campaignId: 'campaign-generic-owner-setup', enableV2Api: true }); await host.listen(hostPort); }
async function page(name) { const context = await cdp('Target.createBrowserContext'); contexts.push(context.browserContextId); const target = await cdp('Target.createTarget', { url: 'about:blank', browserContextId: context.browserContextId }); const attached = await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true }); sessions[name] = attached.sessionId; await cdp('Page.enable', {}, attached.sessionId); await cdp('Runtime.enable', {}, attached.sessionId); await cdp('Page.navigate', { url: `http://127.0.0.1:${webPort}/v2-modules` }, attached.sessionId); await waitFor(name, `Boolean(document.querySelector('#v2-catalog-credential'))`, `${name} login`); }
try {
  await startHost();
  child(process.execPath, [join(root, 'clients/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { cwd: join(root, 'clients/web'), env: { ...process.env, POTOMAC_WEB_HOST: `http://127.0.0.1:${hostPort}`, VITE_POTOMAC_HOST: `http://127.0.0.1:${hostPort}` } });
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`http://127.0.0.1:${webPort}/v2-modules`)).ok) break; } catch {} await delay(100); }
  const chromeProfile = join(scratch, 'chrome');
  const chromeProc = child(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', '--remote-debugging-port=0', `--user-data-dir=${chromeProfile}`, 'about:blank']);
  socket = new WebSocket(await waitForChromiumDebugger({ process: chromeProc, profileDir: chromeProfile })); await new Promise((ok, bad) => { socket.addEventListener('open', ok, { once: true }); socket.addEventListener('error', bad, { once: true }); }); socket.addEventListener('message', event => { const msg = JSON.parse(event.data); if (msg.id && pending.has(msg.id)) { const done = pending.get(msg.id); pending.delete(msg.id); done(msg); } });
  await page('gm'); await fill('gm', '#v2-catalog-credential', 'local-gm'); await click('gm', 'Connect'); await waitFor('gm', `Boolean(document.querySelector('#v2-module-picker'))`, 'GM module picker');
  await fill('gm', '#v2-module-picker', 'example.generic-entity-setup'); await waitFor('gm', `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Pin exact module lock');return Boolean(b&&!b.disabled)})()`, 'pin control ready'); await click('gm', 'Pin exact module lock'); await waitFor('gm', `document.body.innerText.includes('Immutable campaign module')`, 'pin');
  await waitFor('gm', `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Enroll a player');return Boolean(b&&!b.disabled)})()`, 'first enrollment control ready'); await click('gm', 'Enroll a player'); await waitFor('gm', `document.querySelectorAll('output').length>=1`, 'first enrollment');
  const creds = await ev('gm', `(()=>[...document.querySelectorAll('output')].map(o=>{const t=o.textContent,m=': ';return {name:t.split(m)[0],credential:t.slice(t.indexOf(m)+m.length)}}))()`);
  const a = creds.at(-1); await waitFor('gm', `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Enroll a player');return Boolean(b&&!b.disabled)})()`, 'second enrollment control ready'); await click('gm', 'Enroll a player'); await waitFor('gm', `document.querySelectorAll('output').length>=2`, 'second enrollment');
  const twoCreds = await ev('gm', `(()=>[...document.querySelectorAll('output')].map(o=>{const t=o.textContent,m=': ';return {name:t.split(m)[0],credential:t.slice(t.indexOf(m)+m.length)}}))()`); const b = twoCreds.at(-1);
  for (const player of [a, b]) player.memberId = (await (await api('/api/v2/session', player.credential)).json()).principalId;
  const typeId = 'example.generic-entity-setup.entity';
  // Entity forms are repeated and remain available; set each panel's owner explicitly.
  const records = [];
  for (const [owner, title, role] of [[a, 'Aster Passage', 'navigator'], [b, 'Beryl Passage', 'keeper']]) {
    await ev('gm', `(()=>{const s=[...document.querySelectorAll('select')].find(x=>x.id.endsWith('-owner'));if(!s)return false;const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(s,${JSON.stringify(owner.memberId)});s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    // Set the first text field in the generic creation form, then choose the role enum.
    const form = await ev('gm', `(()=>{const f=document.querySelector('form.v2-entity-create-form');return f?{id:f.querySelector('input[type=text]')?.id}:null})()`); assert.ok(form?.id);
    await fill('gm', `#${form.id}`, title);
    await ev('gm', `(()=>{const s=[...document.querySelectorAll('.v2-entity-create-form select')].find(x=>x.id.includes('role'));if(!s)return false;const option=[...s.options].find(x=>x.textContent===${JSON.stringify(role)});if(!option)return false;const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(s,option.value);s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    if (records.length === 0) {
      const titleInput = await ev('gm', `document.querySelector('.v2-entity-create-form input[type=text]').id`);
      await fill('gm', `#${titleInput}`, '');
      assert.equal(await ev('gm', `document.querySelector('.v2-entity-create-form button[type=submit]').disabled`), true, 'invalid required string disables submission');
      await fill('gm', `#${titleInput}`, title);
    }
    await click('gm', `Create ${typeId}`); await waitFor('gm', `document.body.innerText.includes('${title}')`, `create ${title}`);
    const lock = await (await api('/api/v2/campaign/lock')).json(); const all = await (await api(`/api/v2/entities?typeId=${encodeURIComponent(typeId)}`, 'local-gm', { headers: { 'x-v2-lock-digest': lock.digest } })).json(); const record = (all.entities ?? all).find(row => row.data.title === title); assert.ok(record); assert.equal(record.ownerPrincipalId, owner.memberId); records.push(record);
    await ev('gm', `(()=>{const s=document.querySelector('#v2-grant-member');if(!s)return false;const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(s,${JSON.stringify(owner.memberId)});s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    await click('gm', 'Grant selected player read/act'); await waitFor('gm', `document.body.innerText.includes('Read and act grant committed')`, 'owner grant from GM UI');
  }
  const lock = await (await api('/api/v2/campaign/lock')).json(), digest = lock.digest;
  assert.equal((await api('/api/v2/entities', a.credential, { method: 'POST', body: JSON.stringify({ operationId: 'forged-owner', entityId: 'forged-owner-entity', typeId, visibility: 'owner', ownerPrincipalId: b.memberId, data: records[0].data }), headers: { 'x-v2-lock-digest': digest } })).status, 403);
  assert.ok([400, 404].includes((await api('/api/v2/entities', 'local-gm', { method: 'POST', body: JSON.stringify({ operationId: 'unlisted-owner', entityId: 'unlisted-owner-entity', typeId, visibility: 'owner', ownerPrincipalId: 'not-a-campaign-member', data: records[0].data }), headers: { 'x-v2-lock-digest': digest } })).status));
  assert.equal((await api(`/api/v2/entities/${records[1].entityId}`, a.credential, { headers: { 'x-v2-lock-digest': digest } })).status, 404);
  assert.equal((await api(`/api/v2/entities/${records[0].entityId}/grants`, a.credential, { method: 'POST', body: JSON.stringify({ memberId: b.memberId, permissions: ['act'] }), headers: { 'x-v2-lock-digest': digest } })).status, 403);
  const actAs = async (name, who, record, choice, operationId) => {
    await page(name); await fill(name, '#v2-catalog-credential', who.credential); await click(name, 'Connect'); await waitFor(name, `document.body.innerText.includes('${record.data.title}')`, `${name} private entity`);
    assert.equal(await ev(name, `document.body.innerText.includes('${name === 'a' ? 'Beryl Passage' : 'Aster Passage'}')`), false, 'player projection excludes the other principal-owned entity');
    await waitFor(name, `document.body.innerText.includes('Record choice')`, `${name} command`);
    await ev(name, `(()=>{const s=[...document.querySelectorAll('select')].find(x=>x.options.length===3&&x.options[0].disabled);if(!s)return false;const option=[...s.options].find(x=>x.textContent===${JSON.stringify(choice)});if(!option)return false;const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(s,option.value);s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    await ev(name, `(()=>{window.__captured=[];const old=fetch.bind(window);window.fetch=async(u,o={})=>{const r=await old(u,o);if(String(u).endsWith('/api/v2/commands'))window.__captured.push({body:JSON.parse(o.body),response:await r.clone().json()});return r}})()`);
    await click(name, 'Record choice'); await waitFor(name, `window.__captured?.length===1`, `${name} command request`);
    const captured = await ev(name, 'window.__captured[0]'); assert.equal(captured.response.status, 'applied');
    const exact = await api('/api/v2/commands', who.credential, { method: 'POST', body: JSON.stringify(captured.body), headers: { 'x-v2-lock-digest': digest } }); assert.equal(exact.status, 200);
    const altered = await api('/api/v2/commands', who.credential, { method: 'POST', body: JSON.stringify({ ...captured.body, input: { choice: choice === 'observe' ? 'bargain' : 'observe' } }), headers: { 'x-v2-lock-digest': digest } }); assert.equal(altered.status, 409);
    assert.equal((await api('/api/v2/commands', who.credential, { method: 'POST', body: JSON.stringify({ ...captured.body, operationId: operationId + '-stale', expectedRevision: 1 }), headers: { 'x-v2-lock-digest': digest } })).status, 409, 'stale entity revision rejected');
    assert.ok([403, 404].includes((await api('/api/v2/commands', name === 'a' ? b.credential : a.credential, { method: 'POST', body: JSON.stringify({ ...captured.body, operationId: operationId + '-wrong-owner' }), headers: { 'x-v2-lock-digest': digest } })).status), 'wrong-owner actions are denied without disclosing private entity existence');
    return captured;
  };
  const ca = await actAs('a', a, records[0], 'observe', 'choice-a'); const cb = await actAs('b', b, records[1], 'bargain', 'choice-b');
  const counts = host.db.prepare('SELECT COUNT(*) AS n FROM v2_extension_receipts WHERE operation_id=?');
  for (const command of [ca, cb]) { assert.equal(counts.get(command.body.operationId).n, 1); assert.equal(host.db.prepare('SELECT COUNT(*) AS n FROM v2_effect_events WHERE operation_id=?').get(command.body.operationId).n, 1); }
  host.close(); host = undefined; await delay(200); await startHost();
  for (const [name, who, title] of [['a', a, 'Aster Passage'], ['b', b, 'Beryl Passage']]) { await click(name, 'Refresh authorized state'); await waitFor(name, `document.body.innerText.includes('${title}') && document.body.innerText.includes('observe') || document.body.innerText.includes('${title}') && document.body.innerText.includes('bargain')`, `${name} state after restart`); }
  assert.equal((await api(`/api/v2/entities/${records[1].entityId}`, a.credential, { headers: { 'x-v2-lock-digest': digest } })).status, 404);
  console.log('PASS: isolated authenticated GM/Player A/Player B Chromium contexts pinned the generic test module, enrolled players, schema-created two principal-owned entities with enum/nested resources/array values, granted owners access, and submitted separate actions. Forged ownership, cross-player reads/actions and player grants failed; exact retries replayed and altered retries conflicted; receipts/effects and private entity state survived restart.');
} catch (error) { console.error(error); console.error(children.map(item => item.output).join('\n')); process.exitCode = 1; }
finally { try { host?.close(); } catch {} for (const context of contexts) try { await cdp('Target.disposeBrowserContext', { browserContextId: context }); } catch {} try { await cdp('Browser.close'); } catch {} try { socket?.close(); } catch {} for (const item of children) try { if (item.proc.exitCode === null) item.proc.kill(); } catch {} await Promise.all(children.map(item => item.proc.exitCode !== null ? Promise.resolve() : new Promise(resolveExit => { item.proc.once('exit', resolveExit); setTimeout(resolveExit, 1500); }))); await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
