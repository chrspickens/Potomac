import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const evidence = join(root, 'docs/evidence/v09-playtest/2026-10-19-revised5e');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ports = await Promise.all([0, 0, 0].map(async () => {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}));
const [debugPort] = ports;
const profile = join(root, '.playtest-issue110-20261019', 'chromium');
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket, serial = 0;
const pending = new Map(), sessions = new Map(), dialogs = new Map(), contexts = [];
const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
  pending.set(id, message => { clearTimeout(timer); message.error ? reject(new Error(message.error.message)) : resolve(message.result); });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
socket = await (async () => {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    try {
      const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then(response => response.json());
      const ws = new WebSocket(version.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
      ws.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) { const done = pending.get(message.id); pending.delete(message.id); done(message); }
        if (message.method === 'Page.javascriptDialogOpening') {
          const sessionId = message.sessionId, promptText = dialogs.get(sessionId);
          void cdp('Page.handleJavaScriptDialog', { accept: typeof promptText === 'string', ...(typeof promptText === 'string' ? { promptText } : {}) }, sessionId);
          dialogs.delete(sessionId);
        }
      });
      return ws;
    } catch { await delay(100); }
  }
  throw new Error('Chromium did not start');
})();
const evaluate = async (name, expression) => {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessions.get(name));
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (name, expression, label) => {
  const until = Date.now() + 15000;
  while (Date.now() < until) { if (await evaluate(name, expression)) return; await delay(75); }
  throw new Error(`Timed out waiting for ${label}: ${(await evaluate(name, 'document.body.innerText')).slice(0, 1800)}`);
};
const click = async (name, label) => {
  const result = await evaluate(name, `(()=>{const bs=[...document.querySelectorAll('button,a,[role="button"]')];const b=bs.find(x=>(x.innerText+' '+x.textContent+' '+x.getAttribute('aria-label')).replace(/\\s+/g,' ').trim().includes(${JSON.stringify(label)}));if(!b||b.disabled)return {ok:false,buttons:bs.map(x=>[x.innerText,x.textContent,x.title,x.getAttribute('aria-label'),x.outerHTML.slice(0,260),x.disabled])};b.click();return {ok:true}})()`);
  assert.equal(result.ok, true, `enabled UI button: ${label}; ${JSON.stringify(result.buttons)}`);
};
const newPage = async (name) => {
  const context = await cdp('Target.createBrowserContext'); contexts.push(context.browserContextId);
  const target = await cdp('Target.createTarget', { url: 'http://127.0.0.1:5173/', browserContextId: context.browserContextId });
  const attached = await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  sessions.set(name, attached.sessionId);
  await cdp('Page.enable', {}, attached.sessionId); await cdp('Runtime.enable', {}, attached.sessionId);
  await waitFor(name, `document.body.innerText.includes('Campaign Home')`, `${name} Campaign Home`);
};
try {
  await mkdir(evidence, { recursive: true });
  await newPage('gm');
  await waitFor('gm', `document.body.innerText.includes('Locked: example.revised5e@1.1.0')`, 'GM exact lock');
  await click('gm', 'Rules');
  await waitFor('gm', `document.body.innerText.includes('Immutable campaign module')`, 'GM Rules workspace');
  await click('gm', 'Enroll a player'); await waitFor('gm', `document.querySelectorAll('output').length===1`, 'Player A enrollment');
  await click('gm', 'Enroll a player'); await waitFor('gm', `document.querySelectorAll('output').length===2`, 'Player B enrollment');
  const credentials = await evaluate('gm', `Array.from(document.querySelectorAll('output'),o=>o.textContent.split(': ').slice(1).join(': '))`);
  assert.equal(credentials.length, 2);
  const playerViews = {};
  for (const [name, credential] of [['playerA', credentials[0]], ['playerB', credentials[1]]]) {
    await newPage(name);
    dialogs.set(sessions.get(name), credential);
    await click(name, 'Use player credential');
    await waitFor(name, `[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Role'))?.querySelector('select')?.value==='player'`, `${name} credential authentication`);
    await waitFor(name, `[...document.querySelectorAll('.app-rail nav button span')].some(s=>s.textContent.trim()==='Rules')`, `${name} Rules navigation`);
    await click(name, 'Rules');
    await waitFor(name, `document.body.innerText.includes('Immutable campaign module')`, `${name} Rules workspace`);
    playerViews[name] = await evaluate(name, `({text:document.body.innerText.replace(/Player \\d+: [A-Za-z0-9_-]{20,}/g,'[credential redacted]').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'[principal id redacted]'),buttons:Array.from(document.querySelectorAll('button'),b=>b.textContent.trim()).filter(Boolean),rulesNav:[...document.querySelectorAll('.app-rail nav button span')].some(s=>s.textContent.trim()==='Rules')})`);
    assert.equal(await evaluate(name, `document.body.innerText.includes(${JSON.stringify(credential)})`), false, 'player view never displays its bearer credential');
    await click(name, 'Return to campaign');
    await waitFor(name, `document.body.innerText.includes('CAMPAIGN HOME')`, `${name} campaign return`);
    await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessions.get(name)).then(result => writeFile(join(evidence, `${name}-campaign-home.png`), Buffer.from(result.data, 'base64')));
  }
  await click('gm', 'Return to campaign');
  await waitFor('gm', `document.body.innerText.includes('CAMPAIGN HOME')`, 'GM Campaign Home return');
  await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessions.get('gm')).then(result => writeFile(join(evidence, 'gm-campaign-home.png'), Buffer.from(result.data, 'base64')));
  const summary = {
    browser: 'Chromium headless, isolated CDP browser contexts',
    origin: 'http://127.0.0.1:5173/',
    campaign: 'Issue 110 Revised 5e Playtest',
    lock: 'example.revised5e@1.1.0 sha256:d8a631a927bc43ae219c23d02d2aca4471b505e52bd5d479b71cd6029b60811e',
    playerA: playerViews.playerA,
    playerB: playerViews.playerB,
    credentialDisclosure: 'No player Rules view contained its own bearer credential. GM one-time enrollment credential output was excluded from screenshots; values remained only in the runner memory.',
    limits: 'This capture confirms enrollment, credential authentication, ordinary Rules navigation, role identity, and the visible workspace only. It does not claim the Revised 5e combat workflow, private-field isolation, reactions, or session integration passed.'
  };
  await writeFile(join(evidence, 'automated-ui-observations.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log('PASS: isolated GM, Player A and Player B Chromium contexts loaded the real loopback app; GM enrolled both players through the UI; each player authenticated with an original credential and opened the campaign Rules workspace. Credentials were not written to evidence.');
} finally {
  for (const context of contexts) { try { await cdp('Target.disposeBrowserContext', { browserContextId: context }); } catch {} }
  try { await cdp('Browser.close'); } catch {}
  try { socket?.close(); } catch {}
  if (child.exitCode === null) child.kill();
}
