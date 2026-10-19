import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHost } from '../server/host/index.mjs';

const root = resolve(import.meta.dirname, '..');
const chrome = [process.env.POTOMAC_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
if (!chrome) throw new Error('Chrome/Edge not found. Set POTOMAC_CHROME.');
const scratch = await mkdtemp(join(tmpdir(), 'potomac-tides-omens-acceptance-'));
const freePort = async () => { const server = createServer(); await new Promise((ok, bad) => server.once('error', bad).listen(0, '127.0.0.1', ok)); const value = server.address().port; await new Promise((ok, bad) => server.close(error => error ? bad(error) : ok())); return value; };
const hostPort = await freePort(), webPort = await freePort(), debugPort = await freePort();
let host, socket, sequence = 0; const children = [], pending = new Map(), sessions = {}, contexts = [];
const child = (cmd, args, options = {}) => { const proc = spawn(cmd, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options }); let output = ''; proc.stdout.on('data', chunk => output += chunk); proc.stderr.on('data', chunk => output += chunk); children.push({ proc, get output() { return output; } }); return proc; };
const cdp = (method, params = {}, sessionId) => new Promise((ok, bad) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); bad(new Error(`CDP ${method} timed out`)); }, 15000); pending.set(id, message => { clearTimeout(timer); message.error ? bad(new Error(message.error.message)) : ok(message.result); }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
const evaluate = async (name, expression) => { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessions[name]); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
const waitFor = async (name, expression, label) => { const until = Date.now() + 20000; while (Date.now() < until) { if (await evaluate(name, expression)) return; await delay(100); } throw new Error(`Timed out ${label}: ${await evaluate(name, 'document.body.innerText.slice(0,1600)')}`); };
const click = async (name, label) => { const result = await evaluate(name, `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)return {ok:false,buttons:[...document.querySelectorAll('button')].map(x=>[x.textContent.trim(),x.disabled]),body:document.body.innerText.slice(-1000)};b.click();return {ok:true}})()`); assert.equal(result.ok, true, `click ${label}: ${JSON.stringify(result)}`); };
const setValue = async (name, selector, value) => assert.equal(await evaluate(name, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;const p=e instanceof HTMLSelectElement?HTMLSelectElement.prototype:e instanceof HTMLInputElement?HTMLInputElement.prototype:null;const setter=p&&Object.getOwnPropertyDescriptor(p,'value')?.set;if(setter)setter.call(e,${JSON.stringify(value)});else e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`), true, `set ${selector}`);
const api = (url, token = 'local-gm', init = {}) => fetch(`http://127.0.0.1:${hostPort}${url}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } });
async function startHost() { host = createHost({ databasePath: join(scratch, 'host.sqlite'), campaignId: 'campaign-tides-omens-browser', enableV2Api: true }); await host.listen(hostPort); }
async function newPage(name) { const context = await cdp('Target.createBrowserContext'); contexts.push(context.browserContextId); const target = await cdp('Target.createTarget', { url: 'about:blank', browserContextId: context.browserContextId }); const attached = await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true }); sessions[name] = attached.sessionId; await cdp('Page.enable', {}, attached.sessionId); await cdp('Runtime.enable', {}, attached.sessionId); await cdp('Page.navigate', { url: `http://127.0.0.1:${webPort}/v2-modules` }, attached.sessionId); await waitFor(name, `Boolean(document.querySelector('#v2-catalog-credential'))`, `${name} login`); }
async function login(name, credential) { await setValue(name, '#v2-catalog-credential', credential); await click(name, 'Connect'); await waitFor(name, `Boolean(document.querySelector('#v2-module-picker')) || document.body.innerText.includes('Immutable campaign module')`, `${name} authenticated workspace`); }
const digest = 'sha256:d1a26989f1e831b5cb4679a415c7ab8299d748ebe65943b12bb3044b8f214273';
const typeId = 'example.tides-omens.player-decision';
try {
  await startHost();
  child(process.execPath, [join(root, 'clients/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { cwd: join(root, 'clients/web'), env: { ...process.env, POTOMAC_WEB_HOST: `http://127.0.0.1:${hostPort}` } });
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`http://127.0.0.1:${webPort}/v2-modules`)).ok) break; } catch {} await delay(100); }
  child(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(scratch, 'chrome')}`, 'about:blank']);
  let info; for (let i = 0; i < 200; i++) { try { info = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); break; } catch { await delay(100); } } assert.ok(info?.webSocketDebuggerUrl);
  socket = new WebSocket(info.webSocketDebuggerUrl); await new Promise((ok, bad) => { socket.addEventListener('open', ok, { once: true }); socket.addEventListener('error', bad, { once: true }); }); socket.addEventListener('message', event => { const msg = JSON.parse(event.data); if (msg.id && pending.has(msg.id)) { const done = pending.get(msg.id); pending.delete(msg.id); done(msg); } });

  await newPage('gm'); await login('gm', 'local-gm');
  const listed = await (await api('/api/v2/modules')).json(); const module = listed.modules.find(row => row.id === 'example.tides-omens'); assert.ok(module, 'Tides & Omens appears in the trusted catalog'); assert.equal(module.digest, digest);
  await setValue('gm', '#v2-module-picker', module.id); await click('gm', 'Pin exact module lock'); await waitFor('gm', `document.body.innerText.includes('Immutable campaign module')`, 'exact pin');
  let pin = await (await api('/api/v2/campaign/lock')).json(); assert.equal(pin.lock.rootModule.digest, digest); assert.equal(pin.lock.entries.length, 5);
  await click('gm', 'Enroll a player'); await waitFor('gm', `document.querySelectorAll('output').length>=1`, 'Player A enrollment');
  await click('gm', 'Enroll a player'); await waitFor('gm', `document.querySelectorAll('output').length>=2`, 'Player B enrollment');
  const players = await evaluate('gm', `(()=>[...document.querySelectorAll('output')].map(o=>{const text=o.textContent,sep=': ';return {name:text.slice(0,text.indexOf(sep)),credential:text.slice(text.indexOf(sep)+sep.length)}}))()`);
  assert.equal(players.length, 2); for (const player of players) player.memberId = (await (await api('/api/v2/session', player.credential)).json()).principalId;
  const records = [];
  for (const [index, player, role] of [[0, players[0], 'navigator'], [1, players[1], 'keeper']]) {
    await setValue('gm', '[id$="-owner"]', player.memberId);
    const formId = await evaluate('gm', `document.querySelector('.v2-entity-create-form select[id$="Entity-role"]')?.id`); assert.ok(formId, 'schema form exposes role enum');
    const prefix = formId.slice(0, -'Entity-role'.length);
    const roleSelect = `#${formId}`; // initial enum is navigator; set keeper explicitly for Player B.
    if (role === 'keeper') await evaluate('gm', `(()=>{const s=document.querySelector(${JSON.stringify(roleSelect)});if(!s)return false;const option=[...s.options].find(o=>o.textContent==='keeper');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(s,option.value);s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    for (const [token, count] of [['calm', 2], ['storm', 2], ['omen', 1]]) await setValue('gm', `#${prefix}Entity-tokens-${token}`, String(count));
    await click('gm', 'Create example.tides-omens.player-decision'); await waitFor('gm', `document.body.innerText.includes('Immutable campaign module') && document.querySelectorAll('#v2-entity-picker option').length>=${index + 1}`, `created ${role} entity`);
    const all = await (await api(`/api/v2/entities?typeId=${encodeURIComponent(typeId)}`, 'local-gm', { headers: { 'x-v2-lock-digest': pin.digest } })).json(); const recordsForType = all.entities ?? all; const record = recordsForType.find(row => row.ownerPrincipalId === player.memberId); assert.ok(record, `${role} owner assigned by GM`); assert.equal(record.data.role, role); assert.deepEqual(record.data.tokens, { calm: 2, storm: 2, omen: 1 }); records.push(record);
    await setValue('gm', '#v2-grant-member', player.memberId); await click('gm', 'Grant selected player read/act'); await waitFor('gm', `document.body.innerText.includes('Read and act grant committed')`, `${role} owner grant`);
  }

  const [a, b] = players; const [entityA, entityB] = records;
  assert.equal((await api('/api/v2/entities', a.credential, { method: 'POST', body: JSON.stringify({ operationId: 'tides-forged-owner', entityId: 'tides-forged-owner', typeId, ownerPrincipalId: b.memberId, visibility: 'owner', data: entityA.data }), headers: { 'x-v2-lock-digest': pin.digest } })).status, 403, 'player cannot forge a different principal owner');
  assert.equal((await api(`/api/v2/entities/${entityB.entityId}`, a.credential, { headers: { 'x-v2-lock-digest': pin.digest } })).status, 404, 'Player A cannot read Player B private entity');
  assert.equal((await api(`/api/v2/entities/${entityA.entityId}/grants`, a.credential, { method: 'POST', body: JSON.stringify({ memberId: b.memberId, permissions: ['act'] }), headers: { 'x-v2-lock-digest': pin.digest } })).status, 403, 'player cannot grant access');

  const submitDecision = async (name, player, own, other, approach, fate) => {
    await newPage(name); await login(name, player.credential);
    const visibleIds = await evaluate(name, `([...document.querySelectorAll('#v2-entity-picker option')].map(option=>option.value))`);
    assert.ok(visibleIds.includes(own.entityId), `${name} sees own entity in generic list`); assert.equal(visibleIds.includes(other.entityId), false, `${name} cannot see the other private entity`);
    await setValue(name, '#v2-entity-picker', own.entityId);
    assert.equal((await api(`/api/v2/entities/${other.entityId}`, player.credential, { headers: { 'x-v2-lock-digest': pin.digest } })).status, 404);
    const actionForm = await evaluate(name, `(()=>[...document.querySelectorAll('form.v2-ui-form')].find(f=>f.querySelector('select[name="approach"]'))?.outerHTML)()`); assert.ok(actionForm, 'declarative action form mounted for authorized entity');
    await evaluate(name, `(()=>{const set=(n,v)=>{const s=document.querySelector('form.v2-ui-form select[name="'+n+'"]');if(!s)return false;const option=[...s.options].find(o=>o.textContent===v);if(!option)return false;const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(s,option.value);s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));return true};return set('approach',${JSON.stringify(approach)})&&set('fate',${JSON.stringify(fate)})})()`);
    await evaluate(name, `(()=>{window.__tides=[];const prior=fetch.bind(window);window.fetch=async(u,o={})=>{const r=await prior(u,o);if(String(u).endsWith('/api/v2/commands'))window.__tides.push({body:JSON.parse(o.body),response:await r.clone().json()});return r}})()`);
    const buttonLabel = 'Choose an approach and commit a fate token'; await click(name, buttonLabel); await waitFor(name, 'window.__tides?.length===1', `${name} committed decision`);
    const captured = await evaluate(name, 'window.__tides[0]'); assert.equal(captured.response.status, 'applied', JSON.stringify(captured.response));
    assert.equal(captured.body.input.approach, approach); assert.equal(captured.body.input.fate, fate);
    const exact = await api('/api/v2/commands', player.credential, { method: 'POST', body: JSON.stringify(captured.body), headers: { 'x-v2-lock-digest': pin.digest } }); assert.equal(exact.status, 200); assert.deepEqual(await exact.json(), captured.response, 'exact retry returns original receipt without reapplying');
    const alteredPayload = { ...captured.body, input: { approach, fate: fate === 'omen' ? 'calm' : 'omen' } };
    const altered = await api('/api/v2/commands', player.credential, { method: 'POST', body: JSON.stringify(alteredPayload), headers: { 'x-v2-lock-digest': pin.digest } }); const alteredResult = await altered.json(); assert.equal(altered.status, 409, `same operation ID with altered input conflicts: ${JSON.stringify({ captured: captured.body, alteredPayload, alteredResult })}`);
    assert.equal((await api('/api/v2/commands', player.credential, { method: 'POST', body: JSON.stringify({ ...captured.body, operationId: `${captured.body.operationId}-stale`, expectedRevision: own.revision }), headers: { 'x-v2-lock-digest': pin.digest } })).status, 409, 'stale entity revision rejected');
    assert.ok([400, 422].includes((await api('/api/v2/commands', player.credential, { method: 'POST', body: JSON.stringify({ ...captured.body, operationId: `${captured.body.operationId}-malformed`, input: { approach: 'attack', fate: 'calm' } }), headers: { 'x-v2-lock-digest': pin.digest } })).status), 'malformed module input rejected');
    assert.ok([403, 404].includes((await api('/api/v2/commands', player === a ? b.credential : a.credential, { method: 'POST', body: JSON.stringify({ ...captured.body, operationId: `${captured.body.operationId}-cross-player` }), headers: { 'x-v2-lock-digest': pin.digest } })).status), 'other player cannot act on this private entity');
    const stateResponse = await api(`/api/v2/entities/${own.entityId}`, player.credential, { headers: { 'x-v2-lock-digest': pin.digest } }); assert.equal(stateResponse.status, 200); const state = await stateResponse.json();
    const expected = approach === 'observe' ? { result: 'opening', progress: 1, danger: 0 } : approach === 'endure' || fate === 'storm' ? { result: 'setback', progress: 0, danger: 1 } : { result: 'revelation', progress: 1, danger: 1 };
    assert.equal(state.data.progress, expected.progress); assert.equal(state.data.danger, expected.danger); assert.equal(state.data.tokens[fate], own.data.tokens[fate] - 1); assert.deepEqual(state.data.choices.at(-1), { approach, fate, result: expected.result });
    return { captured, state };
  };
  const resultA = await submitDecision('player-a', a, entityA, entityB, 'observe', 'calm');
  const resultB = await submitDecision('player-b', b, entityB, entityA, 'bargain', 'omen');
  for (const { captured } of [resultA, resultB]) {
    assert.equal(host.db.prepare('SELECT COUNT(*) n FROM v2_extension_receipts WHERE operation_id=?').get(captured.body.operationId).n, 1);
    assert.equal(host.db.prepare('SELECT COUNT(*) n FROM v2_effect_events WHERE operation_id=?').get(captured.body.operationId).n, 1);
    assert.equal(host.db.prepare('SELECT COUNT(*) n FROM v2_extension_events WHERE operation_id=?').get(captured.body.operationId).n, 1);
  }
  const committedEvents = host.db.prepare("SELECT COUNT(*) n FROM v2_effect_events WHERE kind='tides-omens.fate-chosen'").get().n; assert.equal(committedEvents, 2);

  host.close(); host = undefined; await delay(200); await startHost();
  pin = await (await api('/api/v2/campaign/lock')).json(); assert.equal(pin.lock.rootModule.digest, digest); assert.equal(pin.lock.entries.length, 5);
  for (const [name, player, own, other, finalState] of [['gm', null, entityA, entityB, resultA.state], ['player-a', a, entityA, entityB, resultA.state], ['player-b', b, entityB, entityA, resultB.state]]) {
    await cdp('Page.navigate', { url: `http://127.0.0.1:${webPort}/v2-modules` }, sessions[name]); await waitFor(name, `Boolean(document.querySelector('#v2-catalog-credential'))`, `${name} re-login after restart`); await login(name, player?.credential ?? 'local-gm');
    await setValue(name, '#v2-entity-picker', own.entityId);
    await waitFor(name, `document.body.innerText.includes('Entity revision ${finalState?.revision ?? own.revision}')`, `${name} own entity after restart`);
    const visibleIds = await evaluate(name, `([...document.querySelectorAll('#v2-entity-picker option')].map(option=>option.value))`);
    assert.ok(visibleIds.includes(own.entityId), `${name} sees own entity in generic list after restart`);
    assert.equal(visibleIds.includes(other.entityId), name === 'gm', `${name} entity list after restart respects GM/player visibility`);
    const response = await api(`/api/v2/entities/${own.entityId}`, player?.credential ?? 'local-gm', { headers: { 'x-v2-lock-digest': pin.digest } }); assert.equal(response.status, 200); const after = await response.json();
    if (finalState) { assert.equal(after.revision, finalState.revision); assert.deepEqual(after.data, finalState.data); }
    assert.equal((await api(`/api/v2/entities/${other.entityId}`, player?.credential ?? 'local-gm', { headers: { 'x-v2-lock-digest': pin.digest } })).status, name === 'gm' ? 200 : 404);
  }
  assert.equal(host.db.prepare('SELECT COUNT(*) n FROM v2_effect_events WHERE kind=?').get('tides-omens.fate-chosen').n, 2);
  for (const { captured } of [resultA, resultB]) { assert.equal(host.db.prepare('SELECT COUNT(*) n FROM v2_extension_receipts WHERE operation_id=?').get(captured.body.operationId).n, 1); assert.equal(host.db.prepare('SELECT COUNT(*) n FROM v2_effect_events WHERE operation_id=?').get(captured.body.operationId).n, 1); }
  console.log('PASS: real gated loopback host and isolated authenticated GM/Player A/Player B Chromium contexts pinned Tides & Omens; GM created and assigned Navigator/Keeper entities via schema forms; owners chose observe/calm and bargain/omen; deterministic module outcomes, bounded state, effects/events/receipts persisted. Cross-player reads/actions, forged owner, unauthorized grant, stale revisions and malformed input rejected; exact retry replayed and altered retry conflicted; host restart preserved exact five-capability lock, ownership and state.');
} catch (error) { console.error(error); console.error(children.map(item => item.output).join('\n')); process.exitCode = 1; }
finally { try { host?.close(); } catch {} for (const context of contexts) try { await cdp('Target.disposeBrowserContext', { browserContextId: context }); } catch {} try { await cdp('Browser.close'); } catch {} try { socket?.close(); } catch {} for (const item of children) try { if (item.proc.exitCode === null) item.proc.kill(); } catch {} await Promise.all(children.map(item => item.proc.exitCode !== null ? Promise.resolve() : new Promise(resolveExit => { item.proc.once('exit', resolveExit); setTimeout(resolveExit, 1500); }))); await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
