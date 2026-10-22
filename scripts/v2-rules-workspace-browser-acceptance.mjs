import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
const screenshot = async (name, filename) => {
  if (!process.env.POTOMAC_EVIDENCE_DIR) return;
  await mkdir(process.env.POTOMAC_EVIDENCE_DIR, { recursive: true });
  await ev(name, `(()=>{const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const saved=[];while(walker.nextNode()){const node=walker.currentNode,original=node.nodeValue;if(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|sha256:[0-9a-f]{64}/i.test(original)){saved.push([node,original]);node.nodeValue=original.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,'[redacted-id]').replace(/sha256:[0-9a-f]{64}/gi,'sha256:[redacted]')}}window.__evidenceRedactions=saved;return saved.length})()`);
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessions[name]);
  await writeFile(join(process.env.POTOMAC_EVIDENCE_DIR, filename), Buffer.from(data, 'base64'));
  await ev(name, `(()=>{for(const [node,original] of window.__evidenceRedactions||[])node.nodeValue=original;window.__evidenceRedactions=[];return true})()`);
};
const saveEvidenceJson = async (filename, value) => {
  if (!process.env.POTOMAC_EVIDENCE_DIR) return;
  await mkdir(process.env.POTOMAC_EVIDENCE_DIR, { recursive: true });
  await writeFile(join(process.env.POTOMAC_EVIDENCE_DIR, filename), `${JSON.stringify(value, null, 2)}\n`);
};
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
async function setTestStartingSquares(name) {
  const formId = 'example-revised5e-example-revised5e-encounter';
  await setValue(name, `#${formId}-placement-participant`, 'player-b');
  const placement = await ev(name, `(()=>{const square=document.querySelector('[aria-label="Choose square 0, 4"]');if(!square||square.disabled)return false;square.click();return true})()`);
  assert.equal(placement, true, 'GM can place Player B using the visible initial-position grid');
}
async function setStartingSquare(name, actorId, x, y) {
  const formId = 'example-revised5e-example-revised5e-encounter';
  await setValue(name, `#${formId}-placement-participant`, actorId);
  const placement = await ev(name, `(()=>{const square=document.querySelector(${JSON.stringify(`[aria-label="Choose square ${x}, ${y}"]`)});if(!square||square.disabled)return false;square.click();return true})()`);
  assert.equal(placement, true, `${actorId} can be placed on open square (${x}, ${y}) through the visible grid`);
}
async function addEnemy(name, enemyName) {
  await click(name, 'Add enemy');
  const index = await ev(name, `document.querySelectorAll('.v2-preparation-opponent').length`);
  const inputId = await ev(name, `document.querySelectorAll('.v2-preparation-opponent')[${index - 1}]?.querySelector('input')?.id`);
  assert.ok(inputId, `enemy ${index} has an editable name field`);
  await setValue(name, `#${inputId}`, enemyName);
}
async function setEnemyField(name, enemyIndex, label, value) {
  const inputId = await ev(name, `(()=>{const enemy=document.querySelectorAll('.v2-preparation-opponent')[${enemyIndex}];return [...(enemy?.querySelectorAll('.v2-entity-field')||[])].find(field=>field.querySelector('label')?.textContent.trim()===${JSON.stringify(label)})?.querySelector('label')?.htmlFor})()`);
  assert.ok(inputId, `enemy ${enemyIndex + 1} exposes ${label}`);
  await setValue(name, `#${inputId}`, value);
}
let scriptedRolls;
async function startHost(databaseName, campaignId) { host = createHost({ databasePath: join(scratch, databaseName), campaignId, enableV2Api: true, v2RandomInt: (_min, max) => scriptedRolls?.length ? scriptedRolls.shift() : max - 1 }); await host.listen(hostPort); }
async function page(name) {
  const context = await cdp('Target.createBrowserContext'); contexts.push(context.browserContextId);
  const target = await cdp('Target.createTarget', { url: `http://127.0.0.1:${webPort}/`, browserContextId: context.browserContextId });
  const attached = await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true }); sessions[name] = attached.sessionId;
  await cdp('Page.enable', {}, attached.sessionId); await cdp('Runtime.enable', {}, attached.sessionId);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, attached.sessionId);
  await waitFor(name, `Boolean(document.querySelector('.campaign-home'))`, `${name} Campaign Home`);
}
async function installCommandCapture(name) { await ev(name, `(()=>{window.__potomacCommands=[];const old=fetch.bind(window);window.fetch=async(url,init={})=>{const response=await old(url,init);if(String(url).endsWith('/api/v2/commands'))window.__potomacCommands.push({request:JSON.parse(init.body),status:response.status,response:await response.clone().json()});return response}})()`); }
async function normalSetup(name, moduleId, campaignName) {
  await page(name);
  await waitFor(name, `Boolean(document.querySelector('select[aria-label="Reviewed V2 module"]'))`, 'ordinary Campaign Home V2 setup');
  await setValue(name, '.campaign-setup input', campaignName);
  await setValue(name, 'select[aria-label="Reviewed V2 module"]', moduleId);
  if (name === 'gm') await screenshot(name, 'gm-campaign-home.png');
  await click(name, 'Create fresh experimental V2 campaign');
  await waitFor(name, `Boolean(document.querySelector('.v2-combat-header')) && document.body.innerText.includes('Immutable campaign module')`, 'normal setup into Rules');
  await waitFor(name, `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Enroll a player');return Boolean(b&&!b.disabled)})()`, 'GM enrollment ready');
  if (name === 'gm' && moduleId === 'example.revised5e') {
    await click(name, 'Return to campaign');
    await waitFor(name, `Boolean(document.querySelector('.campaign-home')) && document.body.innerText.includes('Revised 5e Encounter · 1.3.0 (experimental V2)')`, 'Campaign Home confirms exact authoritative V2 ruleset lock');
    assert.equal(await ev(name, `document.body.innerText.includes('System not configured') || document.body.innerText.includes('Configure campaign in GM setup')`), false, 'a valid V2 lock is not shown as unconfigured');
    assert.equal(await ev(name, `Boolean(document.querySelector('.campaign-setup[aria-label="Campaign setup"]'))`), false, 'V1 campaign setup is not shown for a valid V2 lock');
    const homeGuidance = await ev(name, `(()=>({actions:document.querySelector('.home-quick-actions')?.innerText||'',content:document.querySelector('.home-preview')?.innerText||''}))()`);
    assert.match(homeGuidance.actions, /Open Revised 5e Encounter workspace/);
    assert.doesNotMatch(homeGuidance.actions, /Create encounter|Create character/);
    assert.match(homeGuidance.content, /legacy Characters and Encounters pages list V1 records/);
    assert.doesNotMatch(homeGuidance.content, /No authorized characters/);
    await screenshot(name, 'gm-campaign-home-v2-workflow.png');
    await click(name, '♙ Characters');
    await waitFor(name, `document.querySelector('.v2-navigation-guidance')?.innerText.includes('legacy V1 records')`, 'Characters explains the legacy/V2 boundary');
    await click(name, '⚑ Encounters');
    await waitFor(name, `document.querySelector('.v2-navigation-guidance')?.innerText.includes('legacy V1 sessions')`, 'Encounters explains the legacy/V2 boundary');
    await click(name, '⌖ Maps');
    await waitFor(name, `document.querySelector('.v2-navigation-guidance')?.innerText.includes('separate app')`, 'Maps explains that it is separate from the module workspace');
    await click(name, '▦ Table');
    await waitFor(name, `document.body.innerText.includes('Choose a prepared encounter in Rules, then open it in Table')`,'V2 Table explains how to open a prepared encounter');
    await screenshot(name, 'gm-v2-table-route-help.png');
    await click(name, 'Open Rules to choose an encounter');
    await waitFor(name, `Boolean(document.querySelector('.v2-combat-header')) && document.body.innerText.includes('Immutable campaign module')`, 'Rules workspace reopened from Campaign Home');
    await screenshot(name, 'gm-rules-enrollment.png');
  }
}
async function enrollTwo(name) {
  await setValue(name, '#v2-player-display-name', 'Avery');
  await click(name, 'Enroll a player'); await waitFor(name, 'document.querySelectorAll("output").length >= 1', 'Player A enrollment');
  const first = await ev(name, `(()=>{const t=document.querySelector('output').textContent;const i=t.indexOf(': ');return {name:t.slice(0,i),credential:t.slice(i+2)}})()`);
  first.principalId = (await (await api('/api/v2/session', first.credential)).json()).principalId;
  await ev(name, `(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copiedCredential=value}}})})()`);
  await click(name, 'Copy credential');
  await waitFor(name, `window.__copiedCredential===${JSON.stringify(first.credential)}`, 'player credential copy handoff');
  await click(name, 'Hide credential');
  assert.equal(await ev(name, `Boolean(document.querySelector('#credential-${first.principalId}'))`), false, 'hidden first credential is removed from the visible UI');
  await setValue(name, '#v2-player-display-name', 'Morgan');
  await click(name, 'Enroll a player'); await waitFor(name, 'document.querySelectorAll("output").length >= 1', 'Player B enrollment');
  const second = await ev(name, `(()=>{const t=[...document.querySelectorAll('output')].at(-1).textContent;const i=t.indexOf(': ');return {name:t.slice(0,i),credential:t.slice(i+2)}})()`);
  second.principalId = (await (await api('/api/v2/session', second.credential)).json()).principalId;
  await click(name, 'Hide credential');
  assert.equal(await ev(name, `Boolean(document.querySelectorAll('output').length===0)`), true, 'both issued credentials can be hidden after handoff');
  if (name === 'gm') await screenshot(name, 'gm-player-credentials-handed-off.png');
  return [first, second];
}
async function ordinaryPlayer(name, player) {
  await page(name);
  await click(name, 'Use player credential');
  await waitFor(name, `Boolean(document.querySelector('#player-credential-input'))`, `${name} visible player credential dialog`);
  await setValue(name, '#player-credential-input', player.credential);
  await click(name, 'Connect as player');
  await waitFor(name, `document.querySelector('.app-topbar select')?.value==='player' && (()=>{try{return JSON.parse(localStorage.getItem('potomac.identity.v1')||'null')?.credential===${JSON.stringify(player.credential)}}catch{return false}})()`, `${name} authenticated with its issued player credential`);
  if (name === 'playerA') {
    await waitFor(name, `Boolean(document.querySelector('.home-player-status'))`, `${name} V2 Campaign Home guidance`);
    await waitFor(name, `document.querySelector('.home-player-status')?.innerText.includes('assigned character and actions appear in the Revised 5e Encounter workspace')`, `${name} authoritative V2 lock guidance on Campaign Home`);
    assert.equal(await ev(name, `document.querySelector('.home-player-status')?.innerText.includes('assigned character and actions appear in the Revised 5e Encounter workspace')`), true, 'player Campaign Home points to the V2 workspace instead of reporting no authorized V1 character');
    assert.equal(await ev(name, `document.querySelector('.home-player-status')?.innerText.includes('No character is currently available to this account.')`), false, 'player Campaign Home does not confuse an empty V1 snapshot with V2 ownership');
  }
  await waitFor(name, ` [...document.querySelectorAll('.app-rail nav button')].some(b=>b.textContent.includes('Rules'))`, `${name} Rules navigation`);
  await click(name, '⚙ Rules');
  await waitFor(name, `Boolean(document.querySelector('.v2-combat-header'))`, `${name} generic Rules workspace`);
}
async function commandForm(name, label, values) {
  const selector = `form[aria-label=${JSON.stringify(label)}]`;
  await waitFor(name, `(()=>{const f=document.querySelector(${JSON.stringify(selector)});return Boolean(f&&${JSON.stringify(Object.keys(values))}.every(field=>f.elements.namedItem(field)))})()`, `${label} form and declared fields`);
  for (const [field, value] of Object.entries(values)) {
    await waitFor(name, `(()=>{const e=document.querySelector(${JSON.stringify(selector)})?.elements.namedItem(${JSON.stringify(field)});return Boolean(e&&e.tagName)})()`, `${label}.${field} field remains mounted`);
    if (field === 'path') {
      const points = JSON.parse(value);
      for (const [index, point] of points.entries()) {
        await click(name, 'Add waypoint');
        await waitFor(name, `document.querySelectorAll(${JSON.stringify(`${selector} fieldset input[type=number]`)}).length>=${(index + 1) * 2}`, `${label} waypoint ${index + 1} controls`);
        const fields = ['x', 'y'];
        for (let axis = 0; axis < fields.length; axis++) await setValue(name, `${selector} .v2-ui-array-item:nth-of-type(${index + 1}) label:nth-of-type(${axis + 1}) input`, point[fields[axis]]);
      }
      continue;
    }
    const isSelect = field === 'actorId' || field === 'targetId';
    if (isSelect) await setValue(name, `${selector} [name=${JSON.stringify(field)}]`, value, true);
    else await setValue(name, `${selector} [name=${JSON.stringify(field)}]`, value);
  }
  await click(name, label, selector);
  await waitFor(name, `(()=>{const form=document.querySelector(${JSON.stringify(selector)});const button=[...(form?.querySelectorAll('button')||[])].find(item=>item.textContent.trim()===${JSON.stringify(label)});return Boolean(button&&!button.disabled)})()`, `${label} submission settles`);
}
async function waitForEncounterRound(encounterId, minimumRound) {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    const activeLock = await lockFor('local-gm');
    const response = await api(`/api/v2/entities/${encodeURIComponent(encounterId)}`, 'local-gm', { headers: { 'x-v2-lock-digest': activeLock.digest } });
    if (response.ok && (await response.json()).data.round >= minimumRound) return;
    await delay(100);
  }
  throw new Error(`Host encounter did not advance to round ${minimumRound}`);
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
  const lock = await lockFor(); assert.equal(lock.lock.rootModule.id, 'example.revised5e'); assert.equal(lock.lock.rootModule.version, '1.3.0'); assert.equal(lock.lock.rootModule.digest, lock.lock.entries.find(item => item.id === 'example.revised5e').digest);
  await saveEvidenceJson('revised5e-lock.json', lock);
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
  await setLabeledValue('gm', 'Enemy name', 'Warden');
  await setTestStartingSquares('gm');
  // A projection refresh can fail after the entity and grants have committed. The
  // retained idempotency key must make a same-form retry replay that creation.
  await ev('gm', `(()=>{const original=fetch.bind(window);window.__failOneReactionRefresh=true;window.fetch=async(url,init)=>{if(window.__failOneReactionRefresh&&String(url).endsWith('/api/v2/reactions')){window.__failOneReactionRefresh=false;return new Response(JSON.stringify({error:'injected refresh failure'}),{status:503,headers:{'content-type':'application/json'}})}return original(url,init)}})()`);
  await click('gm', 'Prepare encounter and assign players');
  await waitFor('gm', `document.body.innerText.includes('player grants are committed') && document.body.innerText.includes('original operation is retained')`, 'committed preparation with failed projection refresh');
  const preparationKey = 'create:example.revised5e:example.revised5e.encounter';
  const retainedOperation = await ev('gm', `sessionStorage.getItem(${JSON.stringify(`potomac.v2.generic.operation.${preparationKey}`)})`);
  assert.ok(retainedOperation, 'create operation remains available after refresh failure');
  const afterRefreshFailure = await (await api('/api/v2/entities?typeId=example.revised5e.encounter', 'local-gm', { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  assert.deepEqual((afterRefreshFailure.entities ?? afterRefreshFailure)[0].data.actors.find(actor => actor.id === 'player-b').position, { x: 0, y: 4 }, 'guided preparation start-square controls are committed to the host entity');
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
  await setLabeledValue('gm', 'Enemy name', 'Warden');
  await setTestStartingSquares('gm');
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
  await setLabeledValue('gm', 'Enemy name', 'Ash Knight');
  await click('gm', 'Prepare encounter and assign players');
  await waitFor('gm', `document.body.innerText.includes('Cinder Watch') && document.body.innerText.includes('prepared by the host and read/act access granted to the selected players')`, 'new preparation accepted after confirmed manual grant recovery');
  const afterNewPreparation = await (await api('/api/v2/entities?typeId=example.revised5e.encounter', 'local-gm', { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  assert.equal((afterNewPreparation.entities ?? afterNewPreparation).length, 3, 'confirmed recovery permits a genuinely new entity after the original operation keys are retired');
  await setValue('gm', '#v2-entity-picker', committedEntityId);
  await waitFor('gm', `document.body.innerText.includes('Not started') && [...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Start session')`, 'GM current-session start control');
  assert.equal(await ev('gm', `(()=>[...document.querySelector('#v2-entity-picker').options].some(option=>option.value===${JSON.stringify(committedEntityId)}&&option.textContent.trim()==='Ash Bridge'))()`), true, 'Rules entity picker shows the projected encounter title while retaining its stable internal ID as value');
  await click('gm', 'Start session');
  await waitFor('gm', `document.body.innerText.includes('Session started from the selected host encounter.') && document.body.innerText.includes('Live · Ash Bridge')`, 'GM session start is confirmed from the host projection');
  const startedSession = await (await api('/api/v2/session/current', 'local-gm')).json();
  assert.equal(startedSession.status, 'live'); assert.equal(startedSession.encounter.entityId, committedEntityId);
  await click('gm', 'Return to campaign');
  await waitFor('gm', `Boolean(document.querySelector('.campaign-home')) && document.body.innerText.includes('Session live') && document.body.innerText.includes('Active encounter: Ash Bridge')`, 'Campaign Home reflects the live V2 host session');
  await screenshot('gm', 'gm-campaign-home-session-live.png');
  await click('gm', '⚙ Rules');
  await waitFor('gm', `Boolean(document.querySelector('.v2-combat-header'))`, 'Rules return after live session Home check');
  await setValue('gm', '#v2-entity-picker', committedEntityId);
  await waitFor('gm', `document.body.innerText.includes('Live · Ash Bridge')`, 'Rules session projection is consistent with Campaign Home');

  await waitFor('gm', `document.querySelectorAll('progress[aria-label="Hit points 1"]').length === 1`, 'per-character hit point resources');
  const revisedEntities = await (await api('/api/v2/entities?typeId=example.revised5e.encounter', 'local-gm', { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  const encounterId = committedEntityId;
  await installCommandCapture('gm'); await click('gm', 'Roll initiative and begin', '[aria-label="example.revised5e.combat"]');
  await waitFor('gm', `window.__potomacCommands.some(item=>item.request.commandId==='example.revised5e.initialize')`, 'initiative command request');
  const initCapture = await ev('gm', `window.__potomacCommands.find(item=>item.request.commandId==='example.revised5e.initialize')`); assert.equal(initCapture.status, 200, JSON.stringify(initCapture)); assert.equal(initCapture.response.status, 'applied', JSON.stringify(initCapture));
  await waitFor('gm', `document.body.innerText.includes('Committed: initiative rolled.') && document.body.innerText.includes('active')`, 'host-confirmed initiative result is summarized in plain language');

  await ordinaryPlayer('playerA', a); await setValue('playerA', '#v2-entity-picker', committedEntityId); await installCommandCapture('playerA');
  await waitFor('playerA', `Boolean(document.querySelector('[aria-label="example.revised5e.combat"]')) && document.body.innerText.includes('Asha')`, 'Player A authorized contribution and projection');
  await screenshot('playerA', 'player-a-rules.png');
  const gmPrincipalId = (await (await api('/api/v2/session', 'local-gm')).json()).principalId;
  assert.equal((await ev('playerA', `document.body.innerText.includes(${JSON.stringify(gmPrincipalId)})`)), false, 'player UI does not render GM-only principal fields');
  const playerProjection = await (await api(`/api/v2/entities/${encodeURIComponent(encounterId)}`, a.credential, { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  assert.ok(playerProjection.data.actors.every(actor => !Object.hasOwn(actor, 'ownerPrincipalId')), 'nested owner principal fields are filtered before reaching players');
  assert.deepEqual(playerProjection.viewerOwnedPaths, ['actors.0'], 'the host returns only a path marker for Player A’s own character, without revealing either player principal ID');
  assert.equal(await ev('playerA', `document.body.innerText.includes('Your character') && document.body.innerText.includes('Asha')`), true, 'Player A can identify their assigned character from the authorized host marker');
  const movementFormVisible = await ev('playerA', `Boolean(document.querySelector('form[aria-label="Move"]'))`);
  assert.equal(movementFormVisible, true, 'Revised 5e movement command is exposed through the normal Rules contribution');
  assert.equal(await ev('playerA', `(()=>{const form=document.querySelector('form[aria-label="Move"]');const actor=form?.elements.namedItem('actorId');const options=actor?[...actor.options].map(option=>option.textContent.trim()):[];return options.includes('Asha')&&options.includes('Borin')&&options.includes('Warden')&&!options.includes('player-a')&&!options.includes('enemy')&&!form?.querySelector('textarea[name="path"]')&&Boolean(form?.querySelector('.v2-ui-array-field'))})()`), true, 'authorized actor choices use projected character names and movement uses guided waypoint controls');
  assert.equal(await ev('playerA', `(()=>{const form=document.querySelector('form[aria-label="Attack"]');return [...form.querySelectorAll('select')].map(select=>[...select.options].map(option=>option.textContent.trim())).every(options=>options.includes('Asha')&&options.includes('Warden')&&!options.includes('player-a')&&!options.includes('enemy'))})()`), true, 'attacker and target choices show character names while retaining IDs as submitted values');
  await ev('playerA', `document.querySelector('form[aria-label="Move"] select[name="actorId"]').focus()`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessions.playerA);
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessions.playerA);
  assert.equal(await ev('playerA', `document.activeElement?.textContent?.trim()==='Add waypoint'`), true, 'keyboard Tab moves from character selection to the guided path control');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessions.playerA);
  assert.equal(await ev('playerA', `(()=>{const path=document.querySelector('.v2-ui-array-field');return Boolean(path&&path.getBoundingClientRect().width<=innerWidth&&document.documentElement.scrollWidth<=innerWidth)})()`), true, 'movement controls fit a narrow Chromium viewport without horizontal page overflow');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sessions.playerA);
  await commandForm('playerA', 'Move', { actorId: 'player-a', path: '[{"x":1,"y":2}]' });
  await waitFor('playerA', `document.body.innerText.includes('waiting for its authorized reaction')`, 'movement suspension receipt in Rules');
  const moveA = await ev('playerA', `window.__potomacCommands.find(item=>item.request.commandId==='example.revised5e.move')`);
  assert.equal(moveA.status, 200); assert.equal(moveA.response.status, 'pending');
  assert.equal(moveA.request.input.actorId, 'player-a', 'human-readable character choice submits its stable module actor ID');
  assert.deepEqual(moveA.request.input.path, [{ x: 1, y: 2 }], 'guided waypoint controls submit the existing typed movement schema');
  const gmPendingReactions = await (await api('/api/v2/reactions', 'local-gm', { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  assert.ok((gmPendingReactions.reactions ?? gmPendingReactions).some(item => item.windowId === moveA.response.windowId), `GM host projection contains the movement reaction: ${JSON.stringify(gmPendingReactions)}`);
  const pendingProjection = await (await api(`/api/v2/entities/${encodeURIComponent(encounterId)}`, a.credential, { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  assert.equal(pendingProjection.revision, initCapture.response.revision, 'suspended movement keeps the committed entity revision');
  assert.deepEqual(pendingProjection.data.actors.find(actor => actor.id === 'player-a').position, { x: 2, y: 2 }, 'suspended movement has no partial position update');
  await ev('gm', `(()=>{const original=fetch.bind(window);window.__reactionRefreshes=[];window.fetch=async(url,init={})=>{const response=await original(url,init);if(String(url).includes('/api/v2/reactions')&&!String(url).includes('/adjudicate'))window.__reactionRefreshes.push({url:String(url),status:response.status,body:await response.clone().json()});return response}})()`);
  await waitFor('gm', `window.__reactionRefreshes.some(item=>(item.body.reactions ?? item.body).some(reaction=>reaction.windowId===${JSON.stringify(moveA.response.windowId)}))`, 'GM reaction projection updates automatically without manual refresh', 8000);
  await waitFor('gm', `[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='GM: Accept Opportunity attack')`, 'GM sees the pending opportunity attack and its human-readable action without manually refreshing', 8000);
  await screenshot('gm', 'gm-opportunity-attack-pending.png');
  await ev('gm', `(()=>{const original=fetch.bind(window);window.__reactionAdjudications=[];window.fetch=async(url,init={})=>{const response=await original(url,init);if(String(url).includes('/adjudicate'))window.__reactionAdjudications.push({url:String(url),request:JSON.parse(init.body),status:response.status,response:await response.clone().json()});return response}})()`);
  await click('gm', 'GM: Accept Opportunity attack');
  await waitFor('gm', `document.body.innerText.includes('GM accepted Opportunity attack')`, 'host-confirmed GM opportunity-attack adjudication');
  const movementAdjudication = await ev('gm', `window.__reactionAdjudications.at(-1)`);
  assert.equal(movementAdjudication.status, 200); assert.equal(movementAdjudication.request.actionId, 'example.revised5e.opportunity-attack');
  await click('playerA', 'Refresh authorized state');
  await waitFor('playerA', `document.body.innerText.includes('Warden critically hit Asha for 10 damage') && document.querySelector('progress[aria-label="Hit points 1"]')?.value===2`, 'player sees the host-confirmed opportunity attack, HP loss, and resumed movement in readable history');
  await screenshot('gm', 'gm-opportunity-attack-resolved.png');
  await screenshot('playerA', 'player-a-opportunity-attack-resolved.png');
  const resolvedMovement = await (await api(`/api/v2/entities/${encodeURIComponent(encounterId)}`, 'local-gm', { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  assert.equal(resolvedMovement.revision, pendingProjection.revision + 1, 'accepted OA and resumed movement commit one new revision');
  assert.deepEqual(resolvedMovement.data.actors.find(actor => actor.id === 'player-a').position, { x: 1, y: 2 });
  assert.equal(resolvedMovement.data.actors.find(actor => actor.id === 'player-a').currentHitPoints, 2);
  assert.equal(resolvedMovement.data.actors.find(actor => actor.id === 'enemy').reactionAvailable, false);
  assert.equal(resolvedMovement.data.combatLog.at(-1).kind, 'opportunity-critical');
  assert.equal(resolvedMovement.data.movementLog.at(-1).to.x, 1);
  const firstMoveRetry = await (await api('/api/v2/commands', a.credential, { method: 'POST', body: JSON.stringify(moveA.request), headers: { 'x-v2-lock-digest': lock.digest } })).json();
  assert.equal(firstMoveRetry.status, 'applied', 'exact movement retry returns the final host receipt');
  assert.deepEqual(await (await api('/api/v2/commands', a.credential, { method: 'POST', body: JSON.stringify(moveA.request), headers: { 'x-v2-lock-digest': lock.digest } })).json(), firstMoveRetry, 'repeated movement retry returns the same stable receipt');
  assert.equal((await api('/api/v2/commands', a.credential, { method: 'POST', body: JSON.stringify({ ...moveA.request, input: { actorId: 'player-a', path: [{ x: 1, y: 3 }] } }), headers: { 'x-v2-lock-digest': lock.digest } })).status, 409, 'changed movement retry is rejected');
  const eventBeforeAttack = await (await api('/api/v2/events', b.credential, { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  const resumedMoveEvent = eventBeforeAttack.find(event => event.kind === 'command.resumed' && event.operationId === moveA.request.operationId);
  assert.deepEqual(resumedMoveEvent.payload.randomness.map(item => item.values), [[20], [4, 4]], 'accepted OA randomness is host supplied and auditable');
  assert.equal(resumedMoveEvent.payload.resolutionTranscript, undefined, 'player event excludes the GM-only transcript');
  await commandForm('playerA', 'Attack', { actorId: 'player-a', targetId: 'enemy' });
  await waitFor('playerA', `window.__potomacCommands.some(item=>item.request.commandId==='example.revised5e.attack')`, 'Player A attack request');
  const attackA = await ev('playerA', `window.__potomacCommands.find(item=>item.request.commandId==='example.revised5e.attack')`); assert.equal(attackA.status, 200, JSON.stringify(attackA)); assert.equal(attackA.response.status, 'applied', JSON.stringify(attackA));
  await waitFor('playerA', `document.body.innerText.includes('Committed:')`, 'Player A attack receives a host-confirmed outcome summary');
  const retry = async (player, body, changed) => api('/api/v2/commands', player.credential, { method: 'POST', body: JSON.stringify(body), headers: { 'x-v2-lock-digest': lock.digest } });
  assert.equal((await retry(a, attackA.request)).status, 200, 'exact command retry replays the committed receipt');
  assert.equal((await retry(a, { ...attackA.request, input: { actorId: 'player-a', targetId: 'player-b' } })).status, 409, 'altered payload with the same operation ID conflicts');
  assert.equal((await retry(a, { ...attackA.request, operationId: `${attackA.request.operationId}-stale`, expectedRevision: attackA.request.expectedRevision - 1 })).status, 409, 'stale revision is rejected');
  await ordinaryPlayer('playerB', b); await setValue('playerB', '#v2-entity-picker', committedEntityId); await installCommandCapture('playerB');
  await waitFor('playerB', `Boolean(document.querySelector('[aria-label="example.revised5e.combat"]'))`, 'Player B authorized contribution');
  const playerBProjection = await (await api(`/api/v2/entities/${encodeURIComponent(encounterId)}`, b.credential, { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  assert.deepEqual(playerBProjection.viewerOwnedPaths, ['actors.1'], 'Player B receives only its own character path marker');
  assert.equal(await ev('playerB', `document.body.innerText.includes('Your character') && document.body.innerText.includes('Borin')`), true, 'Player B can identify their assigned character without either principal ID');
  await setValue('playerB', 'form[aria-label="Attack"] select[name="actorId"]', 'player-a');
  assert.equal(await ev('playerB', `(()=>{const form=document.querySelector('form[aria-label="Attack"]');return form?.querySelector('button[type="submit"]')?.disabled&&form.innerText.includes('it is Borin’s turn')})()`), true, 'out-of-turn character action is disabled with the current participant named');
  const playerBCommandsBeforeAttack = await ev('playerB', `window.__potomacCommands.length`);
  await commandForm('playerB', 'Attack', { actorId: 'player-b', targetId: 'enemy' });
  await waitFor('playerB', `window.__potomacCommands.length>${playerBCommandsBeforeAttack} && window.__potomacCommands.at(-1).request.commandId==='example.revised5e.attack'`, 'Player B attack request acknowledged');
  const attackB = await ev('playerB', `window.__potomacCommands.at(-1)`);
  assert.equal(attackB.status, 200, JSON.stringify(attackB));
  assert.equal(attackB.response.status, 'applied', JSON.stringify(attackB));
  assert.equal(attackB.request.input.actorId, 'player-b', JSON.stringify(attackB));
  await waitFor('playerB', `document.body.innerText.includes('Committed:') && document.body.innerText.includes('defeated')`, 'Player B sees the completed encounter and committed attack outcome');
  const authoritativeBeforeRestart = await (await api(`/api/v2/entities/${encodeURIComponent(encounterId)}`, 'local-gm', { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  assert.equal(authoritativeBeforeRestart.data.status, 'complete', `Player B attack must complete the encounter before restart: ${JSON.stringify({ response: attackB.response, entity: authoritativeBeforeRestart.data })}`);
  assert.equal(authoritativeBeforeRestart.data.actors.find(actor => actor.id === 'enemy').currentHitPoints, 0);
  await host.close(); host = undefined; await delay(150); await startHost('revised5e.sqlite', 'campaign-issue-166-revised5e');
  const waitForRecoveredHostProjection = async principal => {
    const token = principal === 'gm' ? 'local-gm' : principal.credential;
    const until = Date.now() + 25000;
    let last;
    while (Date.now() < until) {
      try {
        const [entityResponse, reactionsResponse, sessionResponse] = await Promise.all([
          api(`/api/v2/entities/${encodeURIComponent(encounterId)}`, token, { headers: { 'x-v2-lock-digest': lock.digest } }),
          api('/api/v2/reactions', token, { headers: { 'x-v2-lock-digest': lock.digest } }),
          api('/api/v2/session/current', token),
        ]);
        const [entity, reactions, session] = await Promise.all([entityResponse.json(), reactionsResponse.json(), sessionResponse.json()]);
        last = { entityStatus: entityResponse.status, entity, reactionsStatus: reactionsResponse.status, reactionsError: reactions.error, sessionStatus: sessionResponse.status, session: session.status };
        if (entityResponse.ok && reactionsResponse.ok && sessionResponse.ok && entity.data?.status === 'complete' && entity.data.actors?.find(actor => actor.id === 'enemy')?.currentHitPoints === 0 && session.status === 'live') return last;
      } catch (error) { last = String(error); }
      await delay(100);
    }
    throw new Error(`Host did not restore the completed encounter for ${principal === 'gm' ? 'GM' : 'player'}: ${JSON.stringify(last)}`);
  };
  for (const [name, principal] of [['gm', 'gm'], ['playerA', a], ['playerB', b]]) {
    const recovered = await waitForRecoveredHostProjection(principal);
    await ev(name, `(()=>{window.__recoveryRefreshRequests=[];const original=fetch.bind(window);window.fetch=async(url,init={})=>{const response=await original(url,init);let error='',entityRevision,entityStatus;try{const body=await response.clone().json();error=String(body.error||body.message||'');if(String(url).includes('/api/v2/entities?typeId=')){const rows=Array.isArray(body)?body:body.entities||[];const entity=rows.find(item=>item.entityId===${JSON.stringify(encounterId)});entityRevision=entity?.revision;entityStatus=entity?.data?.status}}catch{}window.__recoveryRefreshRequests.push({url:String(url).split('?')[0],status:response.status,error,entityRevision,entityStatus});return response}})()`);
    await click(name, 'Refresh authorized state');
    await waitFor(name, `(()=>{const message=document.querySelector('.v2-message')?.textContent||'';return message.includes('Authorized state refreshed from the host')||message.includes('Authorized state refresh failed')})()`, `${name} Rules refresh resolves after host restart`);
    const refreshEvidence = await ev(name, `({message:document.querySelector('.v2-message')?.textContent||'',requests:window.__recoveryRefreshRequests})`);
    assert.ok(refreshEvidence.message.includes('Authorized state refreshed from the host'), `${name} Rules refresh failed after host restart: ${JSON.stringify(refreshEvidence)}`);
    await waitFor(name, `(()=>{const status=[...document.querySelectorAll('dt')].find(node=>node.textContent.trim()==='Status')?.nextElementSibling?.textContent.trim();return document.querySelector('#v2-entity-picker')?.value===${JSON.stringify(encounterId)} && document.body.innerText.includes(${JSON.stringify(`Entity revision ${recovered.entity.revision}`)}) && status==='complete'})()`, `${name} renders the host-confirmed completed entity after restart`);
    const displayedProjection = await ev(name, `(()=>{const status=[...document.querySelectorAll('dt')].find(node=>node.textContent.trim()==='Status')?.nextElementSibling?.textContent.trim();return {hasRevision:document.body.innerText.includes(${JSON.stringify(`Entity revision ${recovered.entity.revision}`)}),displayedStatus:status,entityId:document.querySelector('#v2-entity-picker')?.value||''}})()`);
    assert.equal(displayedProjection.hasRevision && displayedProjection.displayedStatus === 'complete' && displayedProjection.entityId === encounterId, true, `${name} displays the recovered entity revision and completed state after host restart: ${JSON.stringify({ displayedProjection, refreshRequests: refreshEvidence.requests })}`);
  }
  assert.deepEqual((await lockFor()).lock, lock.lock, 'exact root and full module capability closure survive host restart');
  const authoritativeAfterRestart = await (await api(`/api/v2/entities/${encodeURIComponent(encounterId)}`, 'local-gm', { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  assert.equal(authoritativeAfterRestart.data.status, 'complete', 'authoritative Rules projection reports the completed encounter after restart');
  const adjudicationPath = new URL(movementAdjudication.url).pathname;
  const adjudicationRetry = await api(adjudicationPath, 'local-gm', { method: 'POST', body: JSON.stringify(movementAdjudication.request), headers: { 'x-v2-lock-digest': lock.digest } });
  assert.equal(adjudicationRetry.status, 200, 'GM adjudication receipt survives host restart and lost acknowledgement retry');
  assert.deepEqual(await adjudicationRetry.json(), movementAdjudication.response, 'adjudication retry returns its original terminal receipt');
  assert.equal((await api(adjudicationPath, 'local-gm', { method: 'POST', body: JSON.stringify({ ...movementAdjudication.request, input: { changed: true } }), headers: { 'x-v2-lock-digest': lock.digest } })).status, 409, 'changed GM adjudication retry conflicts after restart');
  assert.equal((await retry(a, attackA.request)).status, 200, 'completed receipt remains idempotent after restart');
  assert.equal(host.db.prepare('SELECT COUNT(*) AS n FROM v2_effect_events WHERE operation_id=?').get(attackA.request.operationId).n, 1, 'one effect event exists for the UI command');
  await click('gm', 'Open in Table');
  await waitFor('gm', `Boolean(document.querySelector('.v2-table-page')) && document.body.innerText.includes('Participants and spatial view') && document.body.innerText.includes('Grid · 8 × 5')`, 'GM opens the exact V2 encounter in Table with its grid');
  assert.equal(await ev('gm', `document.body.innerText.includes(${JSON.stringify(`revision ${authoritativeAfterRestart.revision}`)})`), true, 'GM Table displays the same authoritative revision as Rules');
  await screenshot('gm', 'gm-table-grid.png');
  assert.equal(await ev('gm', `document.body.innerText.includes(${JSON.stringify(encounterId)})`), true, 'Table route retains the original stable entity reference');
  assert.equal(await ev('gm', `document.body.innerText.includes(${JSON.stringify(lock.lock.rootModule.digest)})`), true, 'Table displays the exact pinned module provenance');
  assert.equal(await ev('gm', `document.body.innerText.includes('Session live')`), true, 'Table derives live-session status from the same host projection');
  assert.equal(await ev('gm', `document.querySelectorAll('.v2-table-grid').length`), 1, 'declared grid and actor positions render as a spatial table');
  await click('gm', 'Refresh authorized state');
  await waitFor('gm', `document.body.innerText.includes('Authorized encounter state loaded from the host') && document.body.innerText.includes('Grid · 8 × 5')`, 'Table refresh reloads the latest authoritative projection');
  await click('gm', 'Open in Rules');
  await waitFor('gm', `Boolean(document.querySelector('.v2-combat-header')) && document.querySelector('#v2-entity-picker')?.value===${JSON.stringify(encounterId)}`, 'return to Rules preserves selected encounter');
  assert.equal(await ev('gm', `document.body.innerText.includes(${JSON.stringify(`Entity revision ${authoritativeAfterRestart.revision}`)})`), true, 'Rules return shows the same authoritative revision as Table');
  await click('playerA', 'Open in Table');
  await waitFor('playerA', `Boolean(document.querySelector('.v2-table-page')) && document.body.innerText.includes('Grid · 8 × 5')`, 'Player A opens an authorized host-filtered encounter in Table');
  await screenshot('playerA', 'player-a-table-grid.png');
  assert.equal(await ev('playerA', `document.body.innerText.includes(${JSON.stringify(gmPrincipalId)})`), false, 'Table never renders GM-only actor ownership principals');
  assert.equal(await ev('playerA', `Boolean(document.querySelector('.v2-table-grid'))`), true, 'authorized player receives the declared spatial projection');
  assert.equal(await ev('playerA', `document.body.innerText.includes('Session live')`), true, 'player Table receives the consistent live-session projection');
  await click('playerA', 'Open in Rules');
  await waitFor('playerA', `Boolean(document.querySelector('.v2-combat-header')) && document.querySelector('#v2-entity-picker')?.value===${JSON.stringify(encounterId)}`, 'player returns to Rules with the same encounter selected');
  await cdp('Page.reload', {}, sessions.playerA);
  await waitFor('playerA', `Boolean(document.querySelector('.campaign-home'))`, 'player reconnects after page reload');
  await click('playerA', '▦ Table');
  await waitFor('playerA', `Boolean(document.querySelector('.v2-table-page')) && document.body.innerText.includes('Grid · 8 × 5')`, 'normal Table navigation reconnects to the same authorized entity');
  assert.equal(await ev('playerA', `document.body.innerText.includes(${JSON.stringify(gmPrincipalId)})`), false, 'reconnected Table projection remains privacy filtered');
  await click('playerB', 'Open in Table');
  await waitFor('playerB', `Boolean(document.querySelector('.v2-table-page')) && document.body.innerText.includes('Grid · 8 × 5')`, 'Player B opens the same authorized encounter in Table');
  assert.equal(await ev('playerB', `document.body.innerText.includes('Your character') && document.body.innerText.includes('Borin')`), true, 'Table preserves the authorized player ownership cue');
  assert.equal(await ev('playerB', `document.body.innerText.includes(${JSON.stringify(gmPrincipalId)})`), false, 'Player B Table projection excludes GM-only actor ownership');
  await click('playerB', 'Open in Rules');
  await waitFor('playerB', `Boolean(document.querySelector('.v2-combat-header')) && document.querySelector('#v2-entity-picker')?.value===${JSON.stringify(encounterId)}`, 'Player B returns to Rules with the same stable entity reference');
  await click('gm', 'Refresh authorized state');
  await waitFor('gm', `document.body.innerText.includes('Authorized state refreshed from the host') && document.body.innerText.includes('Live · Ash Bridge')`, 'GM refreshes the live session after player actions');
  await click('gm', 'Finish session');
  await waitFor('gm', `document.body.innerText.includes('Session finished. Encounter history remains available.') && document.body.innerText.includes('Finished')`, 'GM finishes the current session');
  const finishedSession = await (await api('/api/v2/session/current', 'local-gm')).json(); assert.equal(finishedSession.status, 'finished');
  await click('gm', 'Return to campaign');
  await waitFor('gm', `Boolean(document.querySelector('.campaign-home')) && document.body.innerText.includes('Session ended')`, 'Campaign Home reflects the finished V2 session');
  await cdp('Page.reload', {}, sessions.playerA);
  await waitFor('playerA', `Boolean(document.querySelector('.campaign-home')) && document.body.innerText.includes('Session ended')`, 'player reconnects to the finished V2 session after refresh');
  await screenshot('gm', 'gm-campaign-home-session-finished.png');

  // Re-run the full first-encounter workflow with the bounded 2-PC/3-enemy roster.
  // The old encounter tests above remain useful coverage for exact retries, but
  // this scenario proves the new guided form, Table roster, two live rounds,
  // single-responder OA, host authority and session finish together.
  await click('gm', '⚙ Rules');
  await waitFor('gm', `Boolean(document.querySelector('.v2-guided-preparation-form'))`, 'new encounter preparation is available after returning to campaign');
  await setLabeledValue('gm', 'Encounter name', 'Three Opponents');
  await setLabeledValue('gm', 'Player A character name', 'Asha');
  await setLabeledValue('gm', 'Assign Player A', a.principalId);
  await setLabeledValue('gm', 'Player B character name', 'Borin');
  await setLabeledValue('gm', 'Assign Player B', b.principalId);
  await setLabeledValue('gm', 'Enemy name', 'Warden');
  await addEnemy('gm', 'Bandit Two');
  await addEnemy('gm', 'Bandit Three');
  await setEnemyField('gm', 1, 'Armor Class', 13);
  await setEnemyField('gm', 1, 'Initiative modifier', 1);
  await setStartingSquare('gm', 'player-b', 0, 4);
  assert.equal(await ev('gm', `document.querySelectorAll('.v2-preparation-opponent').length`), 3, 'the normal preparation form contains exactly three configurable enemies');
  assert.equal(await ev('gm', `document.querySelectorAll('.v2-preparation-grid-cell.is-occupied').length`), 5, 'the starting grid displays all five placed participants');
  await screenshot('gm', 'gm-three-enemy-preparation.png');
  await click('gm', 'Prepare encounter and assign players');
  await waitFor('gm', `document.body.innerText.includes('Three Opponents') && document.body.innerText.includes('Committed roster:') && document.body.innerText.includes('Bandit Three')`, 'host confirms the committed five-participant roster and starting positions');
  const rosterRows = await (await api('/api/v2/entities?typeId=example.revised5e.encounter', 'local-gm', { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  const rosterEntity = (rosterRows.entities ?? rosterRows).find(row => row.data.title === 'Three Opponents');
  assert.ok(rosterEntity, 'the host persisted the newly prepared roster');
  assert.equal(rosterEntity.data.actors.length, 5, 'host-confirmed entity has two player characters and three enemies');
  assert.equal(rosterEntity.data.actors[3].armorClass, 13, 'the host confirms GM-configured enemy Armor Class');
  assert.equal(rosterEntity.data.actors[3].initiativeModifier, 1, 'the host confirms GM-configured enemy initiative modifier');
  assert.deepEqual(new Set(rosterEntity.data.actors.map(actor => `${actor.position.x},${actor.position.y}`)).size, 5, 'all five starting positions are unique');
  const rosterEncounterId = rosterEntity.entityId;
  await setValue('gm', '#v2-entity-picker', rosterEncounterId);
  await click('gm', 'Open in Table');
  await waitFor('gm', `Boolean(document.querySelector('.v2-table-page')) && ['Asha','Borin','Warden','Bandit Two','Bandit Three'].every(name=>document.body.innerText.includes(name))`, 'Table shows all five committed participants and their positions');
  await screenshot('gm', 'gm-three-enemy-table.png');
  await click('gm', 'Open in Rules');
  await waitFor('gm', `Boolean(document.querySelector('.v2-combat-header')) && document.querySelector('#v2-entity-picker')?.value===${JSON.stringify(rosterEncounterId)}`, 'Table returns to Rules with the same encounter selected');
  await click('gm', 'Start session');
  await waitFor('gm', `document.body.innerText.includes('Session started from the selected host encounter.') && document.body.innerText.includes('Live · Three Opponents')`, 'GM starts the five-participant live session');
  scriptedRolls = [20, 19, 18, 17, 16, 1, 1, 1, 1, 1, 1, 1];
  await click('gm', 'Roll initiative and begin');
  await waitFor('gm', `document.body.innerText.includes('Committed: initiative rolled.') && document.body.innerText.includes('Round 1')`, 'host rolls initiative for all five participants and the turn tracker shows round one');
  const rosterAfterInitiative = await (await api(`/api/v2/entities/${encodeURIComponent(rosterEncounterId)}`, 'local-gm', { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  assert.deepEqual(rosterAfterInitiative.data.initiativeOrder, ['player-a', 'player-b', 'enemy', 'enemy-1', 'enemy-2'], 'the host sorts five initiative results and ties/order remain module-defined');
  // The previous scenario leaves its player dashboards on a finished session.
  // Authenticate fresh independent contexts for this newly granted roster.
  await ordinaryPlayer('rosterPlayerA', a);
  await ordinaryPlayer('rosterPlayerB', b);
  for (const name of ['rosterPlayerA', 'rosterPlayerB']) {
    await setValue(name, '#v2-entity-picker', rosterEncounterId);
    await installCommandCapture(name);
  }
  await commandForm('rosterPlayerA', 'Move', { actorId: 'player-a', path: '[{"x":1,"y":2}]' });
  await waitFor('rosterPlayerA', `document.body.innerText.includes('is waiting for its authorized reaction')`, 'Player A movement opens one eligible opportunity-attack adjudication');
  const pendingRosterMove = await ev('rosterPlayerA', `window.__potomacCommands.at(-1)`);
  assert.equal(pendingRosterMove.status, 200); assert.equal(pendingRosterMove.response.status, 'pending');
  await waitFor('gm', `[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='GM: Accept Opportunity attack')`, 'GM receives the single eligible reaction prompt');
  await click('gm', 'GM: Accept Opportunity attack');
  await waitFor('gm', `document.body.innerText.includes('GM accepted Opportunity attack')`, 'GM adjudicates the opportunity attack through the normal control');
  // The GM resolves enemy attacks and ends the player turns through the normal
  // Rules controls. Player attack ownership was already exercised above; this
  // bounded roster pass focuses on two complete rounds with five participants.
  await click('gm', 'Refresh authorized state');
  await waitFor('gm', `document.body.innerText.includes('Authorized state refreshed from the host.')`, 'GM refreshes after the authorized reaction is committed');
  for (const actorId of ['player-a', 'player-b']) await commandForm('gm', 'End turn', { actorId });
  for (const [actorId, targetId] of [['enemy', 'player-a'], ['enemy-1', 'player-b'], ['enemy-2', 'player-a']]) await commandForm('gm', 'Attack', { actorId, targetId });
  await waitForEncounterRound(rosterEncounterId, 2);
  for (const actorId of ['player-a', 'player-b']) await commandForm('gm', 'End turn', { actorId });
  for (const [actorId, targetId] of [['enemy', 'player-a'], ['enemy-1', 'player-b'], ['enemy-2', 'player-a']]) await commandForm('gm', 'Attack', { actorId, targetId });
  await waitForEncounterRound(rosterEncounterId, 3);
  const twoRounds = await (await api(`/api/v2/entities/${encodeURIComponent(rosterEncounterId)}`, 'local-gm', { headers: { 'x-v2-lock-digest': lock.digest } })).json();
  assert.equal(twoRounds.data.round, 3, 'the host completed two full rounds');
  assert.equal(twoRounds.data.combatLog.filter(item => item.kind.startsWith('opportunity-')).length, 1, 'one opportunity attack was adjudicated; no multi-responder rule was added');
  assert.equal(twoRounds.data.combatLog.filter(item => item.kind === 'miss').length, 6, 'all three enemies resolved an attack in each of two rounds');
  await click('gm', 'Finish session');
  await waitFor('gm', `document.body.innerText.includes('Session finished. Encounter history remains available.')`, 'GM finishes the live session after two rounds');
  await click('gm', 'Return to campaign');
  await waitFor('gm', `Boolean(document.querySelector('.campaign-home')) && document.body.innerText.includes('Session ended')`, 'GM returns to campaign preparation after the session');
  await screenshot('gm', 'gm-three-enemy-session-finished.png');

  const revokeA = await api(`/api/v2/entities/${encodeURIComponent(encounterId)}/grants/${encodeURIComponent(a.principalId)}`, 'local-gm', { method: 'DELETE', headers: { 'x-v2-lock-digest': lock.digest } });
  assert.equal(revokeA.status, 200, 'GM grant revocation succeeds');
  const participantRead = await api(`/api/v2/entities/${encodeURIComponent(encounterId)}`, a.credential, { headers: { 'x-v2-lock-digest': lock.digest } });
  assert.equal(participantRead.status, 200, 'Player A remains authorized through explicit encounter participant assignment');
  const retainedBRead = await api(`/api/v2/entities/${encodeURIComponent(encounterId)}`, b.credential, { headers: { 'x-v2-lock-digest': lock.digest } });
  assert.equal(retainedBRead.status, 200, 'Player B retains its independent encounter grant');
  const revokeMember = await api(`/api/members/${encodeURIComponent(a.principalId)}`, 'local-gm', { method: 'DELETE' });
  assert.equal(revokeMember.status, 200, 'GM revokes Player A membership');
  const revokedRead = await api(`/api/v2/entities/${encodeURIComponent(encounterId)}`, a.credential, { headers: { 'x-v2-lock-digest': lock.digest } });
  assert.ok([401, 403].includes(revokedRead.status), `revoked Player A membership blocks reads (${revokedRead.status})`);
  const bAfterRevocation = await api(`/api/v2/entities/${encodeURIComponent(encounterId)}`, b.credential, { headers: { 'x-v2-lock-digest': lock.digest } });
  assert.equal(bAfterRevocation.status, 200, 'Player B remains authorized after Player A membership revocation');
  console.log('PASS revocation boundaries: direct grant removal preserves assigned-participant access; member revocation blocks Player A while Player B access remains intact.');
  console.log('PASS Revised 5e Rules-to-Table: stable entity handoff, exact lock provenance, schema-declared grid/positions, authorized GM and Player A projection, owner-principal filtering, Rules return and reconnect persistence.');
  console.log('PASS Revised 5e normal Rules: ordinary Campaign Home setup, exact trusted lock closure, guided character and encounter forms with roster assignment, host-confirmed initiative and player attacks, per-actor HP resources, two isolated player contexts, cross-player denial, nested owner-field filtering, exact/altered/stale retries, and restart persistence.');

  // Separate fresh host and browser profiles provide a module-neutral Dice-pool scene/action/reaction walkthrough.
  for (const context of contexts.splice(0)) try { await cdp('Target.disposeBrowserContext', { browserContextId: context }); } catch {}
  sessions.gm = sessions.playerA = sessions.playerB = undefined;
  await host.close(); host = undefined; await startHost('dicepool.sqlite', 'campaign-issue-166-dicepool');
  await normalSetup('diceGm', 'example.dicepool', 'Issue 166 Dice-pool');
  const [diceA, diceB] = await enrollTwo('diceGm');
  const diceLock = await lockFor(); assert.equal(diceLock.lock.rootModule.id, 'example.dicepool');
  await saveEvidenceJson('dicepool-lock.json', diceLock);
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
  await screenshot('diceGm', 'dicepool-table-roster.png');
  assert.equal(await ev('diceGm', `Boolean(document.querySelector('.v2-table-grid'))`), false, 'non-grid module is not presented as a battle map');
  assert.equal(await ev('diceGm', `document.body.innerText.includes(${JSON.stringify(sceneId)})`), true, 'Dice-pool Table handoff retains the original scene entity ID');
  await click('diceGm', 'Open in Rules');
  await waitFor('diceGm', `Boolean(document.querySelector('.v2-combat-header')) && document.querySelector('#v2-entity-picker')?.value===${JSON.stringify(sceneId)}`, 'Dice-pool Rules return retains the same scene');
  await waitFor('diceGm', `document.body.innerText.includes('Not started') && [...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Start session')`, 'Dice-pool scene offers the module-neutral session start');
  await click('diceGm', 'Start session');
  await waitFor('diceGm', `document.body.innerText.includes('Live · Lantern Bridge')`, 'Dice-pool scene starts a host-owned session');
  await click('diceGm', 'Open in Table');
  await waitFor('diceGm', `Boolean(document.querySelector('.v2-table-page')) && document.body.innerText.includes('Session live') && document.body.innerText.includes('No grid is declared')`, 'non-grid Dice-pool Table shares the current-session projection');
  await click('diceGm', 'Open in Rules');
  await waitFor('diceGm', `Boolean(document.querySelector('.v2-combat-header')) && document.querySelector('#v2-entity-picker')?.value===${JSON.stringify(sceneId)}`, 'Dice-pool session navigation preserves the selected scene');
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
  await waitFor('diceA', `document.body.innerText.includes('Command is waiting for its authorized reaction; its effects are not committed yet.')`, 'Dice-pool parent command clearly reports its durable reaction as pending without exposing an internal command ID');
  const contest = await ev('diceA', `window.__potomacCommands.find(item=>item.request.commandId==='example.dicepool.contested-action')`); assert.equal(contest.status, 200); assert.equal(contest.response.status, 'pending', JSON.stringify(contest));
  const pendingRows = await host.db.prepare("SELECT window_id FROM v2_reaction_windows WHERE parent_operation_id=?").all(contest.request.operationId);
  assert.equal(pendingRows.length, 1, 'one durable reaction window is linked to the parent command'); const windowId = pendingRows[0].window_id;
  await ordinaryPlayer('diceB', diceB); await click('diceB', 'Refresh authorized state');
  await waitFor('diceB', `document.body.innerText.includes('Pending reaction') && document.body.innerText.includes('Accept Brace')`, 'authorized responder sees the pending reaction');
  await waitFor('diceB', `[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Accept Brace' && !button.disabled)`, 'authorized responder control is enabled after its permission projection loads');
  assert.equal(await ev('diceA', ` [...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Accept Brace')`), false, 'unauthorized initiator does not receive responder controls');
  const unauthorizedReaction = await api(`/api/v2/reactions/${encodeURIComponent(windowId)}/decisions`, diceA.credential, { method: 'POST', body: JSON.stringify({ operationId: 'issue-166-unauthorized-reaction', actionId: 'example.dicepool.brace', decision: 'accept', input: {} }), headers: { 'x-v2-lock-digest': diceLock.digest } });
  assert.ok([403, 404].includes(unauthorizedReaction.status), `unauthorized reaction responder rejected (${unauthorizedReaction.status})`);
  await click('diceB', 'Accept Brace');
  await waitFor('diceB', `!document.body.innerText.includes(${JSON.stringify(windowId)})`, 'reaction resolved and continuation projection refreshed');
  const parentEffects = host.db.prepare('SELECT COUNT(*) AS n FROM v2_effect_events WHERE operation_id=?').get(contest.request.operationId).n;
  assert.equal(parentEffects, 1, `continuation commits parent effects once; pending=${JSON.stringify(host.db.prepare('SELECT status FROM v2_extension_pending_commands WHERE operation_id=?').get(contest.request.operationId))}; window=${JSON.stringify(host.db.prepare('SELECT status FROM v2_reaction_windows WHERE parent_operation_id=?').get(contest.request.operationId))}`);
  assert.equal((await api('/api/v2/commands', diceA.credential, { method: 'POST', body: JSON.stringify(contest.request), headers: { 'x-v2-lock-digest': diceLock.digest } })).status, 200, 'exact parent retry replays its receipt after reaction completion');
  assert.equal((await api('/api/v2/commands', diceA.credential, { method: 'POST', body: JSON.stringify({ ...contest.request, input: { actorId: 'player-a', defenderId: 'player-a', push: false } }), headers: { 'x-v2-lock-digest': diceLock.digest } })).status, 409, 'altered parent retry conflicts after recovery');
  assert.equal(host.db.prepare('SELECT COUNT(*) AS n FROM v2_effect_events WHERE operation_id=?').get(contest.request.operationId).n, 1, 'parent retry does not duplicate effects');
  await host.close(); host = undefined; await delay(150); await startHost('dicepool.sqlite', 'campaign-issue-166-dicepool');
  await click('diceB', 'Refresh authorized state'); await waitFor('diceB', `document.body.innerText.includes('Lantern Bridge') && document.body.innerText.includes('resolved')`, 'Dice-pool continuation result persists after second host start');
  await click('diceGm', 'Refresh authorized state'); await waitFor('diceGm', `document.body.innerText.includes('Live · Lantern Bridge')`, 'Dice-pool live session survives host restart');
  await waitFor('diceGm', `(()=>{const button=[...document.querySelectorAll('button')].find(item=>item.textContent.trim()==='Finish session');return Boolean(button&&!button.disabled)})()`, 'GM session controls finish loading after the authorized refresh');
  await click('diceGm', 'Finish session'); await waitFor('diceGm', `document.body.innerText.includes('Finished')`, 'GM finishes the module-neutral Dice-pool session');
  assert.deepEqual((await lockFor()).lock, diceLock.lock, 'Dice-pool exact lock is unchanged after restart');
  assert.equal(host.db.prepare('SELECT COUNT(*) AS n FROM v2_reaction_windows WHERE parent_operation_id=? AND status=?').get(contest.request.operationId, 'resolved').n, 1, 'reaction resolution persists exactly once');
  console.log('PASS Dice-pool normal Rules: separate fresh host, exact root lock, non-grid current-session start/Table projection/finish across restart, guided scene and roster assignment, generic resource contribution, authorized skill action, GM-only field filtering, pending continuation, authorized Player B one-time reaction, unauthorized Player A rejection, parent-effect exactly-once retry and restart persistence.');
} catch (error) { console.error(error); console.error(children.map(item => item.output).join('\n')); process.exitCode = 1; }
finally { try { host?.close(); } catch {} for (const context of contexts) try { await cdp('Target.disposeBrowserContext', { browserContextId: context }); } catch {} try { await cdp('Browser.close'); } catch {} try { socket?.close(); } catch {} for (const item of children) try { if (item.proc.exitCode === null) item.proc.kill(); } catch {} await Promise.all(children.map(item => item.proc.exitCode !== null ? Promise.resolve() : new Promise(resolveExit => { item.proc.once('exit', resolveExit); setTimeout(resolveExit, 1500); }))); await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
