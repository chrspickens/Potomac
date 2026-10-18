import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const chromePath = [process.env.POTOMAC_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
if (!chromePath) throw new Error('Chrome/Edge not found. Set POTOMAC_CHROME.');
const scratch = await mkdtemp(join(tmpdir(), 'potomac-revised5e-browser-'));
const hostPort = await freePort(), webPort = await freePort(), debugPort = await freePort();
const children = [];
let socket, sequence = 0;
const pending = new Map(), sessions = {};
async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolveListen));
  const result = server.address().port;
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return result;
}
function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let output = '';
  child.stdout.on('data', data => { output += data.toString(); }); child.stderr.on('data', data => { output += data.toString(); });
  children.push({ child, get output() { return output; } }); return child;
}
function call(method, params = {}, sessionId) {
  return new Promise((resolveCall, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 15000);
    pending.set(id, message => { clearTimeout(timer); message.error ? reject(new Error(message.error.message)) : resolveCall(message.result); });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(name, expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessions[name]);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function wait(name, expression, label, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await evaluate(name, expression)) return; await delay(100); }
  throw new Error(`Timed out waiting for ${label}: ${await evaluate(name, 'document.body.innerText.slice(0,1200)')}`);
}
async function click(name, label) {
  const found = await evaluate(name, `(() => { const node=[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===${JSON.stringify(label)}); if(!node)return false; node.click(); return true; })()`);
  assert.equal(found, true, `button ${label} is present`);
}
async function setInput(name, selector, value) {
  const result = await evaluate(name, `(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el)return false; const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value')?.set; setter?.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  assert.equal(result, true, `input ${selector} is present`);
}
async function selectActor(name, actorId) {
  const selected = await evaluate(name, `(() => { const form=document.querySelector('form[aria-label="Attack"]'); const fields=form?.querySelectorAll('select'); if(!fields||fields.length!==2)return false; const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; const values=[${JSON.stringify(actorId)},${JSON.stringify(actorId === 'enemy' ? 'player-a' : 'enemy')}]; for(let index=0;index<2;index++){const option=[...fields[index].options].find(item=>item.textContent===values[index]);if(!option)return false;setter.call(fields[index],option.value);fields[index].dispatchEvent(new Event('change',{bubbles:true}));} return true; })()`);
  assert.equal(selected, true, 'module actor and target choices are selected');
  const submit = await evaluate(name, `(() => { const form=document.querySelector('form[aria-label="Attack"]'); const b=form?.querySelector('button[type="submit"]'); if(!b||b.disabled)return false; b.click(); return true; })()`);
  assert.equal(submit, true, `Attack form is ready for ${actorId}`);
}
async function page(name) {
  const context = await call('Target.createBrowserContext');
  const { targetId } = await call('Target.createTarget', { url: 'about:blank', browserContextId: context.browserContextId });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }); sessions[name] = sessionId;
  await call('Page.enable', {}, sessionId); await call('Runtime.enable', {}, sessionId);
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.__v2Commands=[]; const original=window.fetch.bind(window); window.fetch=async (input,init={})=>{const response=await original(input,init); if(String(input).includes('/api/v2/commands')){let body;try{body=JSON.parse(init.body)}catch{};window.__v2Commands.push({body,response:await response.clone().json()})} return response}` }, sessionId);
  await call('Page.navigate', { url: `http://127.0.0.1:${webPort}/v2-combat` }, sessionId);
  await wait(name, `Boolean(document.querySelector('#v2-credential'))`, `${name} login page`);
  return context.browserContextId;
}
async function connect(name, credential) {
  await setInput(name, '#v2-credential', credential); await click(name, 'Connect to host');
  await wait(name, `Boolean(document.querySelector('.v2-combat-header') || document.querySelector('.v2-setup-card'))`, `${name} authenticated`);
}
async function hostReady() {
  const until = Date.now() + 20000;
  while (Date.now() < until) { try { if ((await fetch(`http://127.0.0.1:${hostPort}/health`)).ok) return; } catch {} await delay(100); }
  throw new Error(`host failed to start: ${children.map(item => item.output).join('\n')}`);
}
function startHost() {
  return start(process.execPath, [join(root, 'server/host/index.mjs')], { env: { ...process.env, PORT: String(hostPort), POTOMAC_DB: join(scratch, 'encounter.sqlite'), POTOMAC_ENABLE_EXPERIMENTAL_V2: '1' } });
}

try {
  let host = startHost();
  start(process.execPath, [join(root, 'clients/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { cwd: join(root, 'clients/web'), env: { ...process.env, POTOMAC_WEB_HOST: `http://127.0.0.1:${hostPort}` } });
  await hostReady();
  for (let attempt = 0; attempt < 200; attempt++) { try { if ((await fetch(`http://127.0.0.1:${webPort}/v2-combat`)).ok) break; } catch {} await delay(100); }
  start(chromePath, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(scratch, 'chrome')}`, 'about:blank']);
  let browserInfo;
  for (let attempt = 0; attempt < 200; attempt++) { try { browserInfo = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); break; } catch { await delay(100); } }
  assert.ok(browserInfo?.webSocketDebuggerUrl, 'Chromium remote debugging endpoint started');
  socket = new WebSocket(browserInfo.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => { const message=JSON.parse(event.data); if(message.id&&pending.has(message.id)){const done=pending.get(message.id);pending.delete(message.id);done(message);} });

  const gmContext = await page('gm'); await connect('gm', 'local-gm');
  if (await evaluate('gm', `Boolean(document.querySelector('.v2-setup-card button')?.textContent.includes('Pin Revised'))`)) await click('gm', 'Pin Revised 5e V2 module');
  await wait('gm', `[...document.querySelectorAll('button')].some(item=>item.textContent.trim()==='Enroll Player A')`, 'GM enrollment controls');
  await click('gm', 'Enroll Player A'); await wait('gm', `Boolean(document.querySelector('[data-player-credential="playerA"]'))`, 'Player A enrollment');
  const playerACredential = await evaluate('gm', `document.querySelector('[data-player-credential="playerA"]').textContent`);
  await click('gm', 'Enroll Player B'); await wait('gm', `Boolean(document.querySelector('[data-player-credential="playerB"]'))`, 'Player B enrollment');
  const playerBCredential = await evaluate('gm', `document.querySelector('[data-player-credential="playerB"]').textContent`);
  await click('gm', 'Create encounter and grant player access'); await wait('gm', `Boolean(document.querySelector('.v2-actor-grid'))`, 'encounter creation');
  const playerAContext = await page('playerA'); await connect('playerA', playerACredential);
  const playerBContext = await page('playerB'); await connect('playerB', playerBCredential);
  await wait('playerB', `Boolean(document.querySelector('.v2-actor-grid'))`, 'Player B authorized encounter projection');
  await click('gm', 'Roll initiative and begin');
  await wait('gm', `document.querySelector('.v2-turn-card')?.textContent.includes('Round 1')`, 'initiative committed');

  let playerAAttacked = false;
  for (let turn = 0; turn < 3; turn++) {
    const current = await evaluate('gm', `document.querySelector('.v2-turn-card strong')?.textContent || ''`);
    const actorId = current.includes('Mira Vale') ? 'player-a' : current.includes('Oren Pike') ? 'player-b' : 'enemy';
    const context = actorId === 'player-a' ? 'playerA' : actorId === 'player-b' ? 'playerB' : 'gm';
    await wait(context, `Boolean(document.querySelector('form[aria-label="Attack"]'))`, `${context} Attack form`);
    await wait(context, `document.querySelector('.v2-turn-card strong')?.textContent.includes(${JSON.stringify(actorId === 'player-a' ? 'Mira Vale' : actorId === 'player-b' ? 'Oren Pike' : 'Mire Warden')})`, `${context} current turn projection`);
    await selectActor(context, actorId);
    if (actorId === 'player-a') { playerAAttacked = true; break; }
    await wait(context, `Boolean(document.querySelector('.v2-audit'))`, `${context} action settled`);
    await wait('gm', `!document.querySelector('.v2-turn-card strong')?.textContent.includes(${JSON.stringify(current.slice(current.indexOf('·') + 2))})`, 'next initiative turn');
  }
  assert.equal(playerAAttacked, true, 'initiative reaches Player A and its browser form submits the attack');
  // The loop above submits when the actor is A; wait for the host receipt and projected update.
  await wait('playerA', `window.__v2Commands.length===1`, 'Player A browser command receipt');
  const commandCapture = await evaluate('playerA', `window.__v2Commands[0]`);
  assert.equal(commandCapture.body.input.actorId, 'player-a');
  await wait('playerB', `document.querySelector('.v2-log')?.innerText.includes('Mira Vale attacks')`, 'Player B sees Player A combat result');
  await wait('playerB', `document.querySelector('.v2-audit')?.innerText.includes('attack: d20')`, 'Player B sees host-supplied attack roll audit');
  const enemyHpBeforeRestart = await evaluate('playerB', `([...document.querySelectorAll('.v2-actor-card')].find(card=>card.querySelector('h2')?.textContent==='Mire Warden')?.querySelector('.v2-hp')?.textContent||'').trim()`);
  assert.match(enemyHpBeforeRestart, /^([0-9]|1[0-9]|2[01]) \/ 22 HP$/, `Player B sees committed HP loss: ${enemyHpBeforeRestart}`);

  const forbidden = await evaluate('playerB', `(async()=>{const lock=await fetch('/api/v2/campaign/lock',{headers:{authorization:'Bearer '+sessionStorage.getItem('potomac.v2.revised5e.credential')}}).then(r=>r.json());const entity=await fetch('/api/v2/entities/revised5e-demo-encounter',{headers:{authorization:'Bearer '+sessionStorage.getItem('potomac.v2.revised5e.credential'),'x-v2-lock-digest':lock.digest}}).then(r=>r.json());const response=await fetch('/api/v2/commands',{method:'POST',headers:{authorization:'Bearer '+sessionStorage.getItem('potomac.v2.revised5e.credential'),'content-type':'application/json','x-v2-lock-digest':lock.digest},body:JSON.stringify({operationId:'browser-cross-player',commandId:'example.revised5e.attack',entityId:'revised5e-demo-encounter',expectedRevision:entity.revision,input:{actorId:'player-a',targetId:'enemy'}})});return response.status})()`);
  assert.equal(forbidden, 403, 'Player B cannot submit an attack as Player A');
  const beforeEvents = await evaluate('playerB', `(async()=>{const lock=await fetch('/api/v2/campaign/lock',{headers:{authorization:'Bearer '+sessionStorage.getItem('potomac.v2.revised5e.credential')}}).then(r=>r.json());return fetch('/api/v2/events',{headers:{authorization:'Bearer '+sessionStorage.getItem('potomac.v2.revised5e.credential'),'x-v2-lock-digest':lock.digest}}).then(r=>r.json())})()`);
  host.kill(); await delay(500); host = startHost(); await hostReady();
  await click('playerB', 'Refresh host state');
  await wait('playerB', `document.querySelector('.v2-log')?.innerText.includes('Mira Vale attacks')`, 'recovered combat result');
  const enemyHpAfterRestart = await evaluate('playerB', `([...document.querySelectorAll('.v2-actor-card')].find(card=>card.querySelector('h2')?.textContent==='Mire Warden')?.querySelector('.v2-hp')?.textContent||'').trim()`);
  assert.equal(enemyHpAfterRestart, enemyHpBeforeRestart, 'enemy HP is unchanged after host restart');
  const retry = await evaluate('playerA', `(async()=>{const capture=window.__v2Commands[0];const lock=await fetch('/api/v2/campaign/lock',{headers:{authorization:'Bearer '+sessionStorage.getItem('potomac.v2.revised5e.credential')}}).then(r=>r.json());const response=await fetch('/api/v2/commands',{method:'POST',headers:{authorization:'Bearer '+sessionStorage.getItem('potomac.v2.revised5e.credential'),'content-type':'application/json','x-v2-lock-digest':lock.digest},body:JSON.stringify(capture.body)});return {status:response.status,body:await response.json()}})()`);
  assert.equal(retry.status, 200, 'exact browser command retry succeeds after restart');
  assert.deepEqual(retry.body, commandCapture.response, 'restart retry returns the same committed receipt');
  const afterEvents = await evaluate('playerB', `(async()=>{const lock=await fetch('/api/v2/campaign/lock',{headers:{authorization:'Bearer '+sessionStorage.getItem('potomac.v2.revised5e.credential')}}).then(r=>r.json());return fetch('/api/v2/events',{headers:{authorization:'Bearer '+sessionStorage.getItem('potomac.v2.revised5e.credential'),'x-v2-lock-digest':lock.digest}}).then(r=>r.json())})()`);
  assert.equal(afterEvents.filter(event => event.operationId === commandCapture.body.operationId).length, 1, 'one command event persisted exactly once');
  assert.equal(beforeEvents.filter(event => event.operationId === commandCapture.body.operationId).length, 1);
  console.log('Revised 5e real-host browser acceptance passed: independent GM/Player A/Player B contexts, authenticated setup and grants, initiative and Player A UI attack, Player B refreshed log/projection, cross-player denial, restart recovery and exact retry.');
  await call('Target.disposeBrowserContext', { browserContextId: playerAContext });
  await call('Target.disposeBrowserContext', { browserContextId: playerBContext });
  await call('Target.disposeBrowserContext', { browserContextId: gmContext });
} finally {
  try { if (socket?.readyState === WebSocket.OPEN) socket.close(); } catch {}
  for (const { child } of children) if (!child.killed) child.kill();
  await delay(200); await rm(scratch, { recursive: true, force: true });
}
