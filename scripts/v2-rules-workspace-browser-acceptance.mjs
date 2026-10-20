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
const scratch = await mkdtemp(join(tmpdir(), 'potomac-v2-rules-ui-'));
const freePort = async () => { const server = createServer(); await new Promise((ok, bad) => server.once('error', bad).listen(0, '127.0.0.1', ok)); const value = server.address().port; await new Promise((ok, bad) => server.close(error => error ? bad(error) : ok())); return value; };
const hostPort = await freePort(), webPort = await freePort(), debugPort = await freePort();
let host, socket, seq = 0; const children = [], pending = new Map(), sessions = {}, contexts = [];
const child = (cmd, args, options = {}) => { const proc = spawn(cmd, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options }); let output = ''; proc.stdout.on('data', chunk => output += chunk); proc.stderr.on('data', chunk => output += chunk); children.push({ proc, get output() { return output; } }); return proc; };
const cdp = (method, params = {}, sessionId) => new Promise((ok, bad) => { const id = ++seq, timer = setTimeout(() => { pending.delete(id); bad(new Error(`CDP ${method} timeout`)); }, 20000); pending.set(id, message => { clearTimeout(timer); message.error ? bad(new Error(message.error.message)) : ok(message.result); }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
const ev = async (name, expression) => { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessions[name]); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
const waitFor = async (name, expression, what, timeout = 25000) => { const until = Date.now() + timeout; while (Date.now() < until) { if (await ev(name, expression)) return; await delay(100); } throw new Error(`Timeout ${what}: ${await ev(name, 'document.body.innerText.slice(-1800)')}`); };
const click = async (name, label, rootSelector = 'body') => { const result = await ev(name, `(()=>{const r=document.querySelector(${JSON.stringify(rootSelector)})||document;const b=[...r.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)return {ok:false,buttons:[...r.querySelectorAll('button')].map(x=>[x.textContent.trim(),x.disabled]),tail:document.body.innerText.slice(-900)};b.click();return {ok:true}})()`); assert.equal(result.ok, true, `click ${label}: ${JSON.stringify(result)}`); };
const setValue = async (name, selector, value, selectText = false) => {
  const result = await ev(name, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return {ok:false,reason:'missing'};if(e instanceof HTMLSelectElement){const o=[...e.options].find(x=>x.value===${JSON.stringify(String(value))}||x.textContent.trim()===${JSON.stringify(String(value))});if(!o)return {ok:false,reason:'option',options:[...e.options].map(x=>[x.value,x.textContent.trim()])};Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,o.value)}else{const p=Object.getPrototypeOf(e),s=Object.getOwnPropertyDescriptor(p,'value')?.set;if(s)s.call(e,${JSON.stringify(String(value))});else e.value=${JSON.stringify(String(value))}}e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true}})()`);
  assert.equal(result.ok, true, `set ${selector}=${value}: ${JSON.stringify(result)}${selectText ? '' : ''}`);
};
const setLabeledValue = async (name, label, value) => {
  const id = await ev(name, `(()=>[...document.querySelectorAll('label')].find(item=>item.textContent.trim()===${JSON.stringify(label)})?.htmlFor)()`);
  assert.ok(id, `guided preparation control ${label}`);
  await setValue(name, `#${id}`, value);
};
const api = (url, token = 'local-gm', init = {}) => fetch(`http://127.0.0.1:${hostPort}${url}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } });
async function startHost(databaseName, campaignId) { host = createHost({ databasePath: join(scratch, databaseName), campaignId, enableV2Api: true, v2RandomInt: (_min, max) => max - 1 }); await host.listen(hostPort); }
async function page(name) { const context = await cdp('Target.createBrowserContext'); contexts.push(context.browserContextId); const target = await cdp('Target.createTarget', { url: 'about:blank', browserContextId: context.browserContextId }); const attached = await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true }); sessions[name] = attached.sessionId; await cdp('Page.enable', {}, attached.sessionId); await cdp('Runtime.enable', {}, attached.sessionId); await cdp('Page.navigate', { url: `http://127.0.0.1:${webPort}/` }, attached.sessionId); await waitFor(name, `Boolean(document.querySelector('.campaign-home'))`, `${name} Campaign Home`); }
async function installCommandCapture(name) { await ev(name, `(()=>{window.__potomacCommands=[];const old=fetch.bind(window);window.fetch=async(url,init={})=>{const response=await old(url,init);if(String(url).endsWith('/api/v2/commands'))window.__potomacCommands.push({request:JSON.parse(init.body),status:response.status,response:await response.clone().json()});return response}})()`); }
async function normalSetup(name, moduleId, campaignName) {
  await page(name);
  await waitFor(name, `Boolean(document.querySelector('select[aria-label="Reviewed V2 module"]'))`, 'ordinary Campaign Home V2 setup');
  await setValue(name, '.campaign-setup input', campaignName);
  await setValue(name, 'select[aria-label="Reviewed V2 module"]', moduleId);
  await click(name, 'Create fresh experimental V2 campaign');
  await waitFor(name, `Boolean(document.querySelector('.v2-combat-header')) && document.body.innerText.includes('Immutable campaign module')`, 'normal setup into Rules');
  await waitFor(name, `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Enroll a player');return Boolean(b&&!b.disabled)})()`, 'GM enrollment ready');
}
async function enrollTwo(name) {
  await click(name, 'Enroll a player'); await waitFor(name, 'document.querySelectorAll("output").length >= 1', 'Player A enrollment');
  const first = await ev(name, `(()=>{const t=document.querySelector('output').textContent;const i=t.indexOf(': ');return {name:t.slice(0,i),credential:t.slice(i+2)}})()`);
  await click(name, 'Enroll a player'); await waitFor(name, 'document.querySelectorAll("output").length >= 2', 'Player B enrollment');
  const second = await ev(name, `(()=>{const t=[...document.querySelectorAll('output')].at(-1).textContent;const i=t.indexOf(': ');return {name:t.slice(0,i),credential:t.slice(i+2)}})()`);
  for (const player of [first, second]) player.principalId = (await (await api('/api/v2/session', player.credential)).json()).principalId;
  return [first, second];
}
async function ordinaryPlayer(name, player) {
  await page(name);
  await ev(name, `window.prompt=()=>${JSON.stringify(player.credential)}`);
  await click(name, 'Use player credential');
  await waitFor(name, `document.querySelector('.app-topbar select')?.value==='player' && (()=>{try{return JSON.parse(localStorage.getItem('potomac.identity.v1')||'null')?.credential===${JSON.stringify(player.credential)}}catch{return false}})()`, `${name} authenticated with its issued player credential`);
  await waitFor(name, ` [...document.querySelectorAll('.app-rail nav button')].some(b=>b.textContent.includes('Rules'))`, `${name} Rules navigation`);
  await click(name, '⚙ Rules');
  await waitFor(name, `Boolean(document.querySelector('.v2-combat-header'))`, `${name} generic Rules workspace`);
}
async function commandForm(name, label, values) {
  const selector = `form[aria-label=${JSON.stringify(label)}]`;
  await waitFor(name, `(()=>{const f=document.querySelector(${JSON.stringify(selector)});return Boolean(f&&${JSON.stringify(Object.keys(values))}.every(field=>f.elements.namedItem(field)))})()`, `${label} form and declared fields`);
  for (const [field, value] of Object.entries(values)) {
    const setBy = await ev(name, `(()=>{const f=document.querySelector(${JSON.stringify(selector)});const e=f?.elements.namedItem(${JSON.stringify(field)});return e?e.tagName.toLowerCase():''})()`);
    assert.ok(setBy, `${label}.${field} exists`);
    if (setBy === 'select') await setValue(name, `${selector} [name=${JSON.stringify(field)}]`, value, true);
    else await setValue(name, `${selector} [name=${JSON.stringify(field)}]`, value);
  }
  await click(name, label, selector);
}
async function lockFor(token) { return (await api('/api/v2/campaign/lock', token)).json(); }

try {
  await startHost('revised5e.sqlite', 'campaign-issue-166-revised5e');
  child(process.execPath, [join(root, 'clients/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { cwd: join(root, 'clients/web'), env: { ...process.env, POTOMAC_WEB_HOST: `http://127.0.0.1:${hostPort}`, VITE_POTOMAC_HOST: `http://127.0.0.1:${hostPort}` } });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://127.0.0.1:${webPort}/`)).ok) break; } catch {} await delay(100); }
  child(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(scratch, 'chrome')}`, 'about:blank']);
  let info; for (let i = 0; i < 200; i++) { try { info = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); break; } catch { await delay(100); } } assert.ok(info?.webSocketDebuggerUrl);
  socket = new WebSocket(info.webSocketDebuggerUrl); await new Promise((ok, bad) => { socket.addEventListener('open', ok, { once: true }); socket.addEventListener('error', bad, { once: true }); }); socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const done = pending.get(message.id); pending.delete(message.id); done(message); } });

  // Revised 5e begins at ordinary Campaign Home and uses its trusted guided preparation profile.
  await normalSetup('gm', 'example.revised5e', 'Issue 166 Revised 5e');
  const [a, b] = await enrollTwo('gm');
  const lock = await lockFor(); assert.equal(lock.lock.rootModule.id, 'example.revised5e'); assert.equal(lock.lock.rootModule.version, '1.2.0'); assert.equal(lock.lock.rootModule.digest, lock.lock.entries.find(item => item.id === 'example.revised5e').digest);
  const catalog = await (await api('/api/v2/modules')).json(); const provider = catalog.modules.find(item => item.id === 'example.revised5e');
  const completeClosure = [{ id: provider.id, apiVersion: '1.0.0', implementationVersion: provider.version, digest: provider.digest }, ...provider.capabilities];
  assert.deepEqual(completeClosure.map(({ id, apiVersion, implementationVersion, digest }) => `${id}@${apiVersion}@${implementationVersion}:${digest}`).sort(), lock.lock.entries.map(item => `${item.id}@${item.apiVersion}@${item.implementationVersion}:${item.digest}`).sort());
  assert.ok(provider.contributions.some(item => item.contributionId === 'example.revised5e.combat' && JSON.stringify(item).includes('example.revised5e.rules.hit-points')));
  assert.equal(provider.preparation[0].entityTypeId, 'example.revised5e.encounter');
  await setLabeledValue('gm', 'Encounter name', 'Ash Bridge');
  await setLabeledValue('gm', 'Player A character name', 'Asha');
  await setLabeledValue('gm', 'Assign Player A', a.principalId);
  await setLabeledValue('gm', 'Player B character name', 'Borin');
  await setLabeledValue('gm', 'Assign Player B', b.principalId);
  await setLabeledValue('gm', 'Opponent name', 'Warden');
  // A projection refresh can fail after the entity and grants have committed. The
  // retained idempotency key must make a same-form retry replay that creation.
  await ev('gm', `(()=>{const original=fetch.bind(window);window.__failOneReactionRefresh=true;window.fetch=async(url,init)=>{if(window.__failOneReactionRefresh&&String(url).endsWith('/api/v2/reactions')){window.__failOneReactionRefresh=false;return new Response(JSON.stringify({error:'injected refresh failure'}),{status:503,headers:{'content-type':'application/json'}})}return original(url,init)}})()`);
  await click('gm', 'Prepare encounter and assign players');
  await waitFor('gm', `document.body.innerText.includes('player grants are committed') && document.body.innerText.includes('original operation is retained')`, 'committed preparation with failed projection refresh');
  const preparationKey = 'create:example.revised5e:example.revised5e.encounter';
  const retainedOperation = await ev('gm', `sessionStorage.getItem(${JSON.stringify(`potomac.v2.generic.operation.${preparationKey}`)})`);
  assert.ok(retainedOperation, 'create operation remains available after refresh failure');
  const afterRefreshFailure = await (await api('/api/v2/entities?typeId=example.revised5e.encounter', 'local-gm', { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  const committedEntityId = (afterRefreshFailure.entities ?? afterRefreshFailure)[0].entityId;
  const grantActorId = `v2:${lock.lock.campaignId}:${committedEntityId}`;
  assert.equal(host.db.prepare('SELECT COUNT(*) AS n FROM actor_grants WHERE actor_id=?').get(grantActorId).n, 2, 'both selected player grants committed before refresh failure');

  await setLabeledValue('gm', 'Encounter name', 'Changed retry payload');
  await click('gm', 'Prepare encounter and assign players');
  await waitFor('gm', `document.body.innerText.includes('operation ID is bound to another command payload')`, 'changed preparation payload rejected under retained operation identity');
  const afterChangedRetry = await (await api('/api/v2/entities?typeId=example.revised5e.encounter', 'local-gm', { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  assert.equal((afterChangedRetry.entities ?? afterChangedRetry).length, 1, 'changed retry payload did not create a duplicate');
  assert.equal(host.db.prepare('SELECT COUNT(*) AS n FROM actor_grants WHERE actor_id=?').get(grantActorId).n, 2, 'changed retry payload did not alter grants');

  // A host restart and browser refresh preserve the committed receipt and the
  // tab's pending operation identity. Re-enter the original form data, then
  // verify the exact retry resumes that operation.
  await host.close(); host = undefined; await delay(150); await startHost('revised5e.sqlite', 'campaign-issue-166-revised5e');
  await cdp('Page.reload', {}, sessions.gm);
  await waitFor('gm', `Boolean(document.querySelector('.campaign-home'))`, 'Campaign Home after host restart and browser refresh');
  await waitFor('gm', `[...document.querySelectorAll('.app-rail nav button')].some(button=>button.textContent.includes('Rules'))`, 'restored Rules navigation after host restart and browser refresh');
  await click('gm', '⚙ Rules');
  await waitFor('gm', `Boolean(document.querySelector('.v2-guided-preparation-form'))`, 'guided preparation form after host restart and browser refresh');
  await setLabeledValue('gm', 'Encounter name', 'Ash Bridge');
  await setLabeledValue('gm', 'Player A character name', 'Asha');
  await setLabeledValue('gm', 'Assign Player A', a.principalId);
  await setLabeledValue('gm', 'Player B character name', 'Borin');
  await setLabeledValue('gm', 'Assign Player B', b.principalId);
  await setLabeledValue('gm', 'Opponent name', 'Warden');
  await click('gm', 'Prepare encounter and assign players');
  await waitFor('gm', `document.body.innerText.includes('prepared by the host and read/act access granted to the selected players') && document.body.innerText.includes('Ash Bridge') && Boolean(document.querySelector('[aria-label="example.revised5e.combat"]'))`, 'created Revised 5e encounter and generic contribution');
  const afterExactRetry = await (await api('/api/v2/entities?typeId=example.revised5e.encounter', 'local-gm', { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  assert.equal((afterExactRetry.entities ?? afterExactRetry).length, 1, 'exact preparation retry did not create a duplicate');
  assert.equal((afterExactRetry.entities ?? afterExactRetry)[0].entityId, committedEntityId, 'exact retry selected the original entity');
  assert.equal(host.db.prepare('SELECT COUNT(*) AS n FROM actor_grants WHERE actor_id=?').get(grantActorId).n, 2, 'replayed grants remain unique');
  assert.equal(await ev('gm', `sessionStorage.getItem(${JSON.stringify(`potomac.v2.generic.operation.${preparationKey}`)})`), null, 'operation identity clears after authoritative entity refresh succeeds');

  // Fail the second independent grant after entity creation and Player A's grant
  // have committed. The same identity must remain unresolved across restart.
  await setLabeledValue('gm', 'Encounter name', 'Stone Harbor');
  await ev('gm', `(()=>{const previous=fetch.bind(window);window.__failPlayerBGrant=true;window.fetch=async(url,init={})=>{if(window.__failPlayerBGrant&&String(url).includes('/api/v2/entities/')&&String(url).endsWith('/grants')&&init.method==='POST'&&JSON.parse(init.body).memberId===${JSON.stringify(b.principalId)}){window.__failPlayerBGrant=false;return new Response(JSON.stringify({error:'injected Player B grant failure'}),{status:503,headers:{'content-type':'application/json'}})}return previous(url,init)}})()`);
  await click('gm', 'Prepare encounter and assign players');
  await waitFor('gm', `document.body.innerText.includes('player access could not be confirmed')`, 'partial grant failure after entity and Player A grant');
  const secondAttemptOperation = await ev('gm', `sessionStorage.getItem(${JSON.stringify(`potomac.v2.generic.operation.${preparationKey}`)})`);
  const recoveryBeforeRestart = await ev('gm', `JSON.parse(sessionStorage.getItem('potomac.v2.generic.preparation-recovery')||'null')`);
  assert.ok(secondAttemptOperation, 'operation identity retained during incomplete grants');
  assert.equal(recoveryBeforeRestart?.assignedMemberIds.length, 2, 'recovery records the exact expected assignment set');
  const afterPartialGrant = await (await api('/api/v2/entities?typeId=example.revised5e.encounter', 'local-gm', { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  assert.equal((afterPartialGrant.entities ?? afterPartialGrant).length, 2, 'partial grant failure leaves exactly one new entity');
  const partialEntity = (afterPartialGrant.entities ?? afterPartialGrant).find(row => row.data.title === 'Stone Harbor');
  assert.ok(partialEntity, 'partially assigned entity is present');
  const partialGrantActorId = `v2:${lock.lock.campaignId}:${partialEntity.entityId}`;
  assert.equal(host.db.prepare('SELECT COUNT(*) AS n FROM actor_grants WHERE actor_id=?').get(partialGrantActorId).n, 1, 'only Player A grant committed before injected failure');

  await host.close(); host = undefined; await delay(150); await startHost('revised5e.sqlite', 'campaign-issue-166-revised5e');
  await cdp('Page.reload', {}, sessions.gm);
  await waitFor('gm', `Boolean(document.querySelector('.campaign-home'))`, 'Campaign Home after partial-grant host restart');
  await waitFor('gm', ` [...document.querySelectorAll('.app-rail nav button')].some(button=>button.textContent.trim()==='⚙ Rules')`, 'V2 lock discovery and Rules navigation after restart');
  await click('gm', '⚙ Rules');
  await waitFor('gm', `document.body.innerText.includes('Preparation recovery') && document.body.innerText.includes('Player B')`, 'recovered pending manual grant after restart');
  assert.equal(await ev('gm', `sessionStorage.getItem(${JSON.stringify(`potomac.v2.generic.operation.${preparationKey}`)})`), secondAttemptOperation, 'unresolved create identity survives restart');
  await click('gm', 'Open recovered entity');
  await setValue('gm', '#v2-grant-member', b.principalId);
  await click('gm', 'Grant selected player read/act');
  await waitFor('gm', `document.body.innerText.includes('All assigned player grants were confirmed by the host')`, 'manual grant recovery completion');
  assert.equal(await ev('gm', `sessionStorage.getItem(${JSON.stringify(`potomac.v2.generic.operation.${preparationKey}`)})`), null, 'completed manual recovery retires the prior operation identity');
  assert.equal(await ev('gm', `sessionStorage.getItem('potomac.v2.generic.preparation-recovery')`), null, 'completed manual recovery retires the recovery record');
  assert.equal(host.db.prepare('SELECT COUNT(*) AS n FROM actor_grants WHERE actor_id=?').get(partialGrantActorId).n, 2, 'manual recovery commits exactly one missing grant without duplicating Player A');

  await setLabeledValue('gm', 'Encounter name', 'Cinder Watch');
  await setLabeledValue('gm', 'Player A character name', 'CinderA');
  await setLabeledValue('gm', 'Assign Player A', a.principalId);
  await setLabeledValue('gm', 'Player B character name', 'CinderB');
  await setLabeledValue('gm', 'Assign Player B', b.principalId);
  await setLabeledValue('gm', 'Opponent name', 'Ash Knight');
  await click('gm', 'Prepare encounter and assign players');
  await waitFor('gm', `document.body.innerText.includes('Cinder Watch') && document.body.innerText.includes('prepared by the host and read/act access granted to the selected players')`, 'new preparation accepted after confirmed manual grant recovery');
  const afterNewPreparation = await (await api('/api/v2/entities?typeId=example.revised5e.encounter', 'local-gm', { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  assert.equal((afterNewPreparation.entities ?? afterNewPreparation).length, 3, 'confirmed recovery permits a genuinely new entity after the original operation keys are retired');
  await setValue('gm', '#v2-entity-picker', committedEntityId);

  await waitFor('gm', `document.querySelectorAll('progress[aria-label="Hit points 1"]').length === 1`, 'per-character hit point resources');
  const revisedEntities = await (await api('/api/v2/entities?typeId=example.revised5e.encounter', 'local-gm', { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  const encounterId = committedEntityId;
  await installCommandCapture('gm'); await click('gm', 'Roll initiative and begin', '[aria-label="example.revised5e.combat"]');
  await waitFor('gm', `window.__potomacCommands.some(item=>item.request.commandId==='example.revised5e.initialize')`, 'initiative command request');
  const initCapture = await ev('gm', `window.__potomacCommands.find(item=>item.request.commandId==='example.revised5e.initialize')`); assert.equal(initCapture.status, 200, JSON.stringify(initCapture)); assert.equal(initCapture.response.status, 'applied', JSON.stringify(initCapture));
  await waitFor('gm', `document.body.innerText.includes('example.revised5e.initialize committed by the host.') && document.body.innerText.includes('active')`, 'host-confirmed initiative result');

  await ordinaryPlayer('playerA', a); await setValue('playerA', '#v2-entity-picker', committedEntityId); await installCommandCapture('playerA');
  await waitFor('playerA', `Boolean(document.querySelector('[aria-label="example.revised5e.combat"]')) && document.body.innerText.includes('Asha')`, 'Player A authorized contribution and projection');
  const gmPrincipalId = (await (await api('/api/v2/session', 'local-gm')).json()).principalId;
  assert.equal((await ev('playerA', `document.body.innerText.includes(${JSON.stringify(gmPrincipalId)})`)), false, 'player UI does not render GM-only principal fields');
  const playerProjection = await (await api(`/api/v2/entities/${encodeURIComponent(encounterId)}`, a.credential, { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  assert.ok(playerProjection.data.actors.every(actor => !Object.hasOwn(actor, 'ownerPrincipalId')), 'nested owner principal fields are filtered before reaching players');
  await commandForm('playerA', 'Attack', { actorId: 'player-a', targetId: 'enemy' });
  await waitFor('playerA', `window.__potomacCommands.some(item=>item.request.commandId==='example.revised5e.attack')`, 'Player A attack request');
  const attackA = await ev('playerA', `window.__potomacCommands.find(item=>item.request.commandId==='example.revised5e.attack')`); assert.equal(attackA.status, 200, JSON.stringify(attackA)); assert.equal(attackA.response.status, 'applied', JSON.stringify(attackA));
  await waitFor('playerA', `document.body.innerText.includes('example.revised5e.attack committed by the host.')`, 'Player A attack confirmed');
  const retry = async (player, body, changed) => api('/api/v2/commands', player.credential, { method: 'POST', body: JSON.stringify(body), headers: { 'x-v2-lock-digest': lock.digest } });
  assert.equal((await retry(a, attackA.request)).status, 200, 'exact command retry replays the committed receipt');
  assert.equal((await retry(a, { ...attackA.request, input: { actorId: 'player-a', targetId: 'player-b' } })).status, 409, 'altered payload with the same operation ID conflicts');
  assert.equal((await retry(a, { ...attackA.request, operationId: `${attackA.request.operationId}-stale`, expectedRevision: attackA.request.expectedRevision - 1 })).status, 409, 'stale revision is rejected');
  await ordinaryPlayer('playerB', b); await setValue('playerB', '#v2-entity-picker', committedEntityId); await installCommandCapture('playerB');
  await waitFor('playerB', `Boolean(document.querySelector('[aria-label="example.revised5e.combat"]'))`, 'Player B authorized contribution');
  await commandForm('playerB', 'Attack', { actorId: 'player-a', targetId: 'enemy' });
  await waitFor('playerB', `document.body.innerText.includes('host denied this action')`, 'cross-player attack denial feedback');
  const denied = await ev('playerB', `window.__potomacCommands.find(item=>item.request.commandId==='example.revised5e.attack')`); assert.equal(denied.status, 403);
  await commandForm('playerB', 'Attack', { actorId: 'player-b', targetId: 'enemy' }); await waitFor('playerB', `document.body.innerText.includes('example.revised5e.attack committed by the host.')`, 'Player B permitted attack');
  const attackB = await ev('playerB', `window.__potomacCommands.filter(item=>item.request.commandId==='example.revised5e.attack').at(-1)`); assert.equal(attackB.status, 200);
  await host.close(); host = undefined; await delay(150); await startHost('revised5e.sqlite', 'campaign-issue-166-revised5e');
  for (const [name, principal] of [['gm', 'gm'], ['playerA', a], ['playerB', b]]) { await click(name, 'Refresh authorized state'); await waitFor(name, `document.body.innerText.includes('Ash Bridge') && document.body.innerText.includes('complete')`, `${name} completed Revised 5e state after host restart`); }
  assert.deepEqual((await lockFor()).lock, lock.lock, 'exact root and full module capability closure survive host restart');
  assert.equal((await retry(a, attackA.request)).status, 200, 'completed receipt remains idempotent after restart');
  assert.equal(host.db.prepare('SELECT COUNT(*) AS n FROM v2_effect_events WHERE operation_id=?').get(attackA.request.operationId).n, 1, 'one effect event exists for the UI command');
  await click('gm', 'Open in Table');
  await waitFor('gm', `Boolean(document.querySelector('.v2-table-page')) && document.body.innerText.includes('Participants and spatial view') && document.body.innerText.includes('Grid · 8 × 5')`, 'GM opens the exact V2 encounter in Table with its grid');
  assert.equal(await ev('gm', `document.body.innerText.includes(${JSON.stringify(encounterId)})`), true, 'Table route retains the original stable entity reference');
  assert.equal(await ev('gm', `document.body.innerText.includes(${JSON.stringify(lock.lock.rootModule.digest)})`), true, 'Table displays the exact pinned module provenance');
  assert.equal(await ev('gm', `document.querySelectorAll('.v2-table-grid').length`), 1, 'declared grid and actor positions render as a spatial table');
  await click('gm', 'Refresh authorized state');
  await waitFor('gm', `document.body.innerText.includes('Authorized encounter state loaded from the host') && document.body.innerText.includes('Grid · 8 × 5')`, 'Table refresh reloads the latest authoritative projection');
  await click('gm', 'Open in Rules');
  await waitFor('gm', `Boolean(document.querySelector('.v2-combat-header')) && document.querySelector('#v2-entity-picker')?.value===${JSON.stringify(encounterId)}`, 'return to Rules preserves selected encounter');
  await click('playerA', 'Open in Table');
  await waitFor('playerA', `Boolean(document.querySelector('.v2-table-page')) && document.body.innerText.includes('Grid · 8 × 5')`, 'Player A opens an authorized host-filtered encounter in Table');
  assert.equal(await ev('playerA', `document.body.innerText.includes(${JSON.stringify(gmPrincipalId)})`), false, 'Table never renders GM-only actor ownership principals');
  assert.equal(await ev('playerA', `Boolean(document.querySelector('.v2-table-grid'))`), true, 'authorized player receives the declared spatial projection');
  await click('playerA', 'Open in Rules');
  await waitFor('playerA', `Boolean(document.querySelector('.v2-combat-header')) && document.querySelector('#v2-entity-picker')?.value===${JSON.stringify(encounterId)}`, 'player returns to Rules with the same encounter selected');
  await cdp('Page.reload', {}, sessions.playerA);
  await waitFor('playerA', `Boolean(document.querySelector('.campaign-home'))`, 'player reconnects after page reload');
  await click('playerA', '▦ Table');
  await waitFor('playerA', `Boolean(document.querySelector('.v2-table-page')) && document.body.innerText.includes('Grid · 8 × 5')`, 'normal Table navigation reconnects to the same authorized entity');
  assert.equal(await ev('playerA', `document.body.innerText.includes(${JSON.stringify(gmPrincipalId)})`), false, 'reconnected Table projection remains privacy filtered');
  await click('playerB', 'Open in Table');
  await waitFor('playerB', `Boolean(document.querySelector('.v2-table-page')) && document.body.innerText.includes('Grid · 8 × 5')`, 'Player B opens the same authorized encounter in Table');
  assert.equal(await ev('playerB', `document.body.innerText.includes(${JSON.stringify(gmPrincipalId)})`), false, 'Player B Table projection excludes GM-only actor ownership');
  await click('playerB', 'Open in Rules');
  await waitFor('playerB', `Boolean(document.querySelector('.v2-combat-header')) && document.querySelector('#v2-entity-picker')?.value===${JSON.stringify(encounterId)}`, 'Player B returns to Rules with the same stable entity reference');
  console.log('PASS Revised 5e Rules-to-Table: stable entity handoff, exact lock provenance, schema-declared grid/positions, authorized GM and Player A projection, owner-principal filtering, Rules return and reconnect persistence.');
  console.log('PASS Revised 5e normal Rules: ordinary Campaign Home setup, exact trusted lock closure, guided character and encounter forms with roster assignment, host-confirmed initiative and player attacks, per-actor HP resources, two isolated player contexts, cross-player denial, nested owner-field filtering, exact/altered/stale retries, and restart persistence.');

  // Separate fresh host and browser profiles provide a module-neutral Dice-pool scene/action/reaction walkthrough.
  for (const context of contexts.splice(0)) try { await cdp('Target.disposeBrowserContext', { browserContextId: context }); } catch {}
  sessions.gm = sessions.playerA = sessions.playerB = undefined;
  await host.close(); host = undefined; await startHost('dicepool.sqlite', 'campaign-issue-166-dicepool');
  await normalSetup('diceGm', 'example.dicepool', 'Issue 166 Dice-pool');
  const [diceA, diceB] = await enrollTwo('diceGm');
  const diceLock = await lockFor(); assert.equal(diceLock.lock.rootModule.id, 'example.dicepool');
  const diceCatalog = await (await api('/api/v2/modules')).json(); const diceModule = diceCatalog.modules.find(item => item.id === 'example.dicepool');
  assert.ok(diceModule.contributions.some(item => item.contributionId === 'example.dicepool.scene-ui' && JSON.stringify(item).includes('characters.*.stress')));
  assert.equal(diceModule.preparation[0].entityTypeId, 'example.dicepool.scene');
  await setLabeledValue('diceGm', 'Scene name', 'Lantern Bridge'); await setLabeledValue('diceGm', 'Scene challenge', 'Flooded arch');
  await setLabeledValue('diceGm', 'Player A character name', 'Asha'); await setLabeledValue('diceGm', 'Assign Player A', diceA.principalId);
  await setLabeledValue('diceGm', 'Player B character name', 'Borin'); await setLabeledValue('diceGm', 'Assign Player B', diceB.principalId);
  await click('diceGm', 'Prepare encounter and assign players');
  await waitFor('diceGm', `document.body.innerText.includes('Lantern Bridge') && Boolean(document.querySelector('[aria-label="example.dicepool.scene-ui"]'))`, 'Dice-pool scene contribution in ordinary Rules');
  const diceScenes = await (await api('/api/v2/entities?typeId=example.dicepool.scene', 'local-gm', { headers: { 'x-v2-lock-digest': diceLock.digest } })).json();
  const sceneId = (diceScenes.entities ?? diceScenes)[0].entityId;
  await click('diceGm', 'Open in Table');
  await waitFor('diceGm', `Boolean(document.querySelector('.v2-table-page')) && document.body.innerText.includes('No grid is declared') && document.body.innerText.includes('Asha')`, 'Dice-pool uses generic non-grid Table roster');
  assert.equal(await ev('diceGm', `Boolean(document.querySelector('.v2-table-grid'))`), false, 'non-grid module is not presented as a battle map');
  assert.equal(await ev('diceGm', `document.body.innerText.includes(${JSON.stringify(sceneId)})`), true, 'Dice-pool Table handoff retains the original scene entity ID');
  await click('diceGm', 'Open in Rules');
  await waitFor('diceGm', `Boolean(document.querySelector('.v2-combat-header')) && document.querySelector('#v2-entity-picker')?.value===${JSON.stringify(sceneId)}`, 'Dice-pool Rules return retains the same scene');
  await ordinaryPlayer('diceA', diceA); await installCommandCapture('diceA');
  await commandForm('diceA', 'Resolve skill challenge', { actorId: 'player-a', difficulty: '8', push: 'false' });
  await waitFor('diceA', `document.body.innerText.includes('example.dicepool.skill-challenge committed by the host.')`, 'Dice-pool authorized skill action');
  const skill = await ev('diceA', `window.__potomacCommands.find(item=>item.request.commandId==='example.dicepool.skill-challenge')`); assert.equal(skill.status, 200);
  const gmScene = await (await api(`/api/v2/entities/${encodeURIComponent(sceneId)}`, 'local-gm', { headers: { 'x-v2-lock-digest': diceLock.digest } })).json();
  assert.equal(gmScene.data.gmNote, 'The bell answers from below.');
  const playerScene = await (await api(`/api/v2/entities/${encodeURIComponent(sceneId)}`, diceA.credential, { headers: { 'x-v2-lock-digest': diceLock.digest } })).json();
  assert.equal(Object.hasOwn(playerScene.data, 'gmNote'), false, 'GM-only module field is removed from the player projection');
  assert.equal(await ev('diceA', `document.body.innerText.includes('The bell answers from below.')`), false, 'GM-only field never appears in the player UI');
  await commandForm('diceA', 'Start contested action', { actorId: 'player-a', defenderId: 'player-b', push: 'false' });
  await waitFor('diceA', `document.body.innerText.includes('example.dicepool.contested-action is waiting for its authorized reaction; its effects are not committed yet.')`, 'Dice-pool parent command reports its durable reaction as pending');
  const contest = await ev('diceA', `window.__potomacCommands.find(item=>item.request.commandId==='example.dicepool.contested-action')`); assert.equal(contest.status, 200); assert.equal(contest.response.status, 'pending', JSON.stringify(contest));
  const pendingRows = await host.db.prepare("SELECT window_id FROM v2_reaction_windows WHERE parent_operation_id=?").all(contest.request.operationId);
  assert.equal(pendingRows.length, 1, 'one durable reaction window is linked to the parent command'); const windowId = pendingRows[0].window_id;
  await ordinaryPlayer('diceB', diceB); await click('diceB', 'Refresh authorized state');
  await waitFor('diceB', `document.body.innerText.includes(${JSON.stringify(windowId)}) && document.body.innerText.includes('Accept example.dicepool.brace')`, 'authorized responder sees the pending reaction');
  assert.equal(await ev('diceA', ` [...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Accept example.dicepool.brace')`), false, 'unauthorized initiator does not receive responder controls');
  const unauthorizedReaction = await api(`/api/v2/reactions/${encodeURIComponent(windowId)}/decisions`, diceA.credential, { method: 'POST', body: JSON.stringify({ operationId: 'issue-166-unauthorized-reaction', actionId: 'example.dicepool.brace', decision: 'accept', input: {} }), headers: { 'x-v2-lock-digest': diceLock.digest } });
  assert.ok([403, 404].includes(unauthorizedReaction.status), `unauthorized reaction responder rejected (${unauthorizedReaction.status})`);
  await click('diceB', 'Accept example.dicepool.brace');
  await waitFor('diceB', `!document.body.innerText.includes(${JSON.stringify(windowId)})`, 'reaction resolved and continuation projection refreshed');
  const parentEffects = host.db.prepare('SELECT COUNT(*) AS n FROM v2_effect_events WHERE operation_id=?').get(contest.request.operationId).n;
  assert.equal(parentEffects, 1, 'continuation commits parent effects once');
  assert.equal((await api('/api/v2/commands', diceA.credential, { method: 'POST', body: JSON.stringify(contest.request), headers: { 'x-v2-lock-digest': diceLock.digest } })).status, 200, 'exact parent retry replays its receipt after reaction completion');
  assert.equal((await api('/api/v2/commands', diceA.credential, { method: 'POST', body: JSON.stringify({ ...contest.request, input: { actorId: 'player-a', defenderId: 'player-a', push: false } }), headers: { 'x-v2-lock-digest': diceLock.digest } })).status, 409, 'altered parent retry conflicts after recovery');
  assert.equal(host.db.prepare('SELECT COUNT(*) AS n FROM v2_effect_events WHERE operation_id=?').get(contest.request.operationId).n, 1, 'parent retry does not duplicate effects');
  await host.close(); host = undefined; await delay(150); await startHost('dicepool.sqlite', 'campaign-issue-166-dicepool');
  await click('diceB', 'Refresh authorized state'); await waitFor('diceB', `document.body.innerText.includes('Lantern Bridge') && document.body.innerText.includes('resolved')`, 'Dice-pool continuation result persists after second host start');
  assert.deepEqual((await lockFor()).lock, diceLock.lock, 'Dice-pool exact lock is unchanged after restart');
  assert.equal(host.db.prepare('SELECT COUNT(*) AS n FROM v2_reaction_windows WHERE parent_operation_id=? AND status=?').get(contest.request.operationId, 'resolved').n, 1, 'reaction resolution persists exactly once');
  console.log('PASS Dice-pool normal Rules: separate fresh host, exact root lock, guided scene form with roster assignment, generic resource contribution, authorized skill action, GM-only field filtering, pending continuation, authorized Player B one-time reaction, unauthorized Player A rejection, parent-effect exactly-once retry and restart persistence.');
} catch (error) { console.error(error); console.error(children.map(item => item.output).join('\n')); process.exitCode = 1; }
finally { try { host?.close(); } catch {} for (const context of contexts) try { await cdp('Target.disposeBrowserContext', { browserContextId: context }); } catch {} try { await cdp('Browser.close'); } catch {} try { socket?.close(); } catch {} for (const item of children) try { if (item.proc.exitCode === null) item.proc.kill(); } catch {} await Promise.all(children.map(item => item.proc.exitCode !== null ? Promise.resolve() : new Promise(resolveExit => { item.proc.once('exit', resolveExit); setTimeout(resolveExit, 1500); }))); await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
