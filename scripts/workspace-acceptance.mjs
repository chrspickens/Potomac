// Repeatable localhost acceptance run: node scripts/workspace-acceptance.mjs
// Uses only the repository's Node/Vite/host dependencies and an installed Chrome.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { exportCampaignBackup, restoreCampaignBackup } from '../server/host/backup.mjs';
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

async function reservePorts(count) {
  // Keep all ephemeral sockets bound while discovering ports. Closing each
  // immediately allows the OS to hand out the same port again.
  const { createServer } = await import('node:net');
  const servers = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const server = createServer();
      await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
      servers.push(server);
    }
    return servers.map(server => server.address().port);
  } finally {
    await Promise.all(servers.map(server => new Promise((ok, fail) => server.close(error => error ? fail(error) : ok()))));
  }
}

const scratch = await mkdtemp(join(tmpdir(), 'potomac-workspace-acceptance-'));
const dbPath = join(scratch, 'host.sqlite');
const chromeProfile = join(scratch, 'chrome');
const [hostPort, webPort, playerWebPort, secondPlayerWebPort, debugPort] = await reservePorts(5);
const gmToken = `workspace-acceptance-gm-${process.pid}`;
const legacyPlayerToken = `workspace-acceptance-legacy-player-${process.pid}`;
let playerToken;
let playerMemberId;
let createdActor;
let secondPlayerToken;
let secondPlayerMemberId;
let hostProcess;
const baseUrl = `http://127.0.0.1:${hostPort}`;
const webUrl = `http://127.0.0.1:${webPort}/`;
const playerWebUrl = `http://127.0.0.1:${playerWebPort}/`;
const secondPlayerWebUrl = `http://127.0.0.1:${secondPlayerWebPort}/`;
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
  const ready = `(() => { const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim().includes(${JSON.stringify(text)})); return Boolean(target && !target.disabled); })()`;
  await waitForExpression(sessionId, ready, `enabled ${text} control`);
  const clicked = await evaluate(sessionId, `(() => { const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim().includes(${JSON.stringify(text)})); if (!target || target.disabled) return false; target.click(); return true; })()`);
  assert.equal(clicked, true, `Found enabled ${selector} containing “${text}”`);
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

function startHost() {
  hostProcess = start(process.execPath, [join(root, 'server/host/index.mjs')], {
    env: { ...process.env, PORT: String(hostPort), POTOMAC_DB: dbPath, POTOMAC_GM_TOKEN: gmToken, POTOMAC_PLAYER_TOKEN: legacyPlayerToken, POTOMAC_SEED_DEMO: '0' },
  });
  return hostProcess;
}

async function request(path, token, init = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
}

const jsonBody = value => JSON.stringify(value);

async function openContext(browserContextId, role, profile, clientUrl) {
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Page.enable', {}, sessionId);
  await cdp('Runtime.enable', {}, sessionId);
  await cdp('Network.enable', {}, sessionId);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  const secrets = [];
  const requests = new Map();
  const failures = [];
  browserSocket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Network.requestWillBeSent' && /\/api\//.test(message.params.request.url)) {
      requests.set(message.params.requestId, { url: message.params.request.url, method: message.params.request.method });
    }
    if (message.method === 'Network.responseReceived' && requests.has(message.params.requestId)) {
      const request = requests.get(message.params.requestId);
      request.status = message.params.response.status;
      request.statusText = message.params.response.statusText;
    }
    if (message.method === 'Network.loadingFailed' && requests.has(message.params.requestId)) {
      const request = requests.get(message.params.requestId);
      failures.push({ ...request, error: message.params.errorText });
    }
    if (message.method === 'Network.loadingFinished' && requests.has(message.params.requestId)) {
      const requestId = message.params.requestId;
      const request = requests.get(requestId);
      void cdp('Network.getResponseBody', { requestId }, sessionId).then(({ body }) => secrets.push({ ...request, body })).catch(() => {});
    }
  });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('potomac.workspace.demo-profile', ${JSON.stringify(profile)}); window.__workspaceAcceptanceRole = ${JSON.stringify(role)};` }, sessionId);
  await cdp('Page.navigate', { url: clientUrl }, sessionId);
  await waitForExpression(sessionId, "Boolean(document.querySelector('.topbar-right select'))", `${role} role selector`);
  assert.equal(await evaluate(sessionId, "localStorage.getItem('potomac.workspace.demo-profile')"), profile, `${role} profile is initialized before the app reads browser storage`);
  await evaluate(sessionId, `(() => { const s = document.querySelector('.topbar-right select'); if (s.value !== ${JSON.stringify(role)}) { s.value = ${JSON.stringify(role)}; s.dispatchEvent(new Event('change', {bubbles:true})); } })()`);
  try {
    await waitForExpression(sessionId, `document.querySelector('.status')?.textContent.includes('CONNECTED')`, `${role} connection`);
    await waitForExpression(sessionId, "document.querySelector('.workspace-footnote')?.textContent.includes('Cursor') && !document.querySelector('.workspace-footnote')?.textContent.includes('Cursor —')", `${role} authorized snapshot`);
  } catch (error) {
    const firstFailedRequest = [...requests.values()].find(request => request.status >= 400) || failures[0];
    throw new Error(`${error.message}\n${role} first failed API request: ${JSON.stringify(firstFailedRequest || null)}; API requests: ${JSON.stringify([...requests.values()])}`);
  }
  await delay(250);
  return { sessionId, secrets, requests: [...requests.values()], failures };
}

try {
  await mkdir(chromeProfile, { recursive: true });
  startHost();
  await waitFor(`${baseUrl}/health`, 'isolated host');
  const knownAcceptanceGaps = [];
  const uninitializedStateResponse = await request('/api/state', gmToken);
  if (uninitializedStateResponse.status !== 200) {
    const failure = await uninitializedStateResponse.json();
    knownAcceptanceGaps.push(`fresh GET /api/state returns ${uninitializedStateResponse.status}: ${failure.error}`);
  }
  const freshCampaignResponse = await request('/api/campaign', gmToken);
  if (freshCampaignResponse.status === 200) {
    const freshCampaign = await freshCampaignResponse.json();
    assert.deepEqual(freshCampaign, { id: 'foundation-demo', name: '', systemModuleId: null, systemModuleVersion: null, revision: 1 }, 'fresh campaign starts unnamed and without a pinned system module');
  } else {
    knownAcceptanceGaps.push(`GET /api/campaign returns ${freshCampaignResponse.status}; campaign details are currently available through /api/state`);
  }
  assert.equal((await request('/api/context', gmToken, { method: 'POST', body: jsonBody({ context: { activeEncounter: null } }) })).status, 200, 'GM initializes empty encounter context');
  const freshSetupResponse = await request('/api/state', gmToken);
  const freshSetup = await freshSetupResponse.json();
  assert.equal(freshSetupResponse.status, 200, `fresh campaign state is readable after empty context initialization: ${JSON.stringify(freshSetup)}`);
  assert.equal(freshSetup.campaignId, 'foundation-demo', 'fresh host exposes its configured campaign identity');
  assert.deepEqual(freshSetup.context, { activeEncounter: null }, 'fresh campaign can start without an active encounter');
  assert.deepEqual(freshSetup.actors, [], 'fresh campaign starts without characters before acceptance fixtures are explicitly installed');
  assert.deepEqual(freshSetup.encounters, [], 'fresh campaign starts without demo encounters');
  assert.ok(freshSetup.modules.some(module => module.id === 'example.system-a' && module.version === '0.1.0')
    && freshSetup.modules.some(module => module.id === 'example.system-b' && module.version === '0.1.0'), 'fresh campaign has both versioned system modules available');
  const deniedCampaignEdit = await request('/api/campaign', legacyPlayerToken, { method: 'PUT', body: jsonBody({ name: 'Denied', systemModuleId: 'example.system-a', systemModuleVersion: '0.1.0', baseRevision: 1 }) });
  if (deniedCampaignEdit.status === 403) assert.equal(deniedCampaignEdit.status, 403, 'participant cannot configure campaign metadata');
  else knownAcceptanceGaps.push(`PUT /api/campaign from a participant returns ${deniedCampaignEdit.status}, rather than reaching campaign authorization`);
  const configuredCampaignResponse = await request('/api/campaign', gmToken, { method: 'PUT', body: jsonBody({ name: 'Acceptance Campaign', systemModuleId: 'example.system-a', systemModuleVersion: '0.1.0', baseRevision: 1 }) });
  let configuredCampaign;
  if (configuredCampaignResponse.status === 200) {
    configuredCampaign = await configuredCampaignResponse.json();
    assert.equal(configuredCampaign.revision, 2, 'GM campaign edit advances revision');
    assert.equal((await request('/api/campaign', gmToken, { method: 'PUT', body: jsonBody({ name: 'Stale edit', systemModuleId: 'example.system-a', systemModuleVersion: '0.1.0', baseRevision: 1 }) })).status, 409, 'campaign edit rejects stale revisions');
  } else knownAcceptanceGaps.push(`PUT /api/campaign from the GM returns ${configuredCampaignResponse.status}; campaign setup changes cannot be committed through the advertised route`);
  const createdEncounterResponse = await request('/api/encounters', gmToken, { method: 'POST', body: jsonBody({ id: 'acceptance-encounter', name: 'Acceptance Encounter', summary: 'Created by the campaign acceptance run.' }) });
  const createdEncounter = await createdEncounterResponse.json();
  assert.equal(createdEncounterResponse.status, 201, 'GM creates an encounter through the host API');
  const editedEncounterResponse = await request(`/api/encounters/${encodeURIComponent(createdEncounter.id)}`, gmToken, { method: 'PUT', body: jsonBody({ baseRevision: createdEncounter.revision, name: 'Edited Acceptance Encounter', summary: 'Updated by the campaign acceptance run.' }) });
  const editedEncounter = await editedEncounterResponse.json();
  assert.equal(editedEncounterResponse.status, 200, 'GM edits an encounter using its current revision');
  assert.equal(editedEncounter.revision, 2);
  assert.equal(editedEncounter.name, 'Edited Acceptance Encounter');
  assert.equal((await request('/api/encounters', legacyPlayerToken, { method: 'POST', body: jsonBody({ id: 'denied-encounter', name: 'Denied' }) })).status, 403, 'participant cannot create encounters');
  assert.equal((await request(`/api/encounters/${encodeURIComponent(createdEncounter.id)}`, legacyPlayerToken, { method: 'PUT', body: jsonBody({ baseRevision: editedEncounter.revision, name: 'Denied' }) })).status, 403, 'participant cannot edit encounters');
  const encounterListResponse = await request('/api/encounters', gmToken);
  if (encounterListResponse.status === 200) {
    const encounterList = await encounterListResponse.json();
    assert.ok(encounterList.encounters.some(encounter => encounter.id === createdEncounter.id), 'GM encounter list includes the created encounter');
  } else {
    knownAcceptanceGaps.push(`GET /api/encounters returns ${encounterListResponse.status}; encounter listing is only exposed in /api/state`);
  }
  const configuredState = await (await request('/api/state', gmToken)).json();
  if (configuredCampaign) assert.ok(configuredState.events.some(event => event.kind === 'campaign.updated' && event.payload.revision === configuredCampaign.revision), 'campaign configuration update is recorded in its event history');
  assert.ok(configuredState.encounters.some(encounter => encounter.id === createdEncounter.id), 'fresh campaign exposes the newly created encounter');
  assert.equal((await request('/api/state', 'invalid-acceptance-credential')).status, 401, 'unknown credentials cannot read a fresh campaign');
  const enrollment = await fetch(`${baseUrl}/api/members/enroll`, { method: 'POST', headers: { authorization: `Bearer ${gmToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Acceptance Player' }) });
  assert.equal(enrollment.status, 201, 'GM enrolls an individual player');
  ({ credential: playerToken, memberId: playerMemberId } = await enrollment.json());
  const secondEnrollment = await fetch(`${baseUrl}/api/members/enroll`, { method: 'POST', headers: { authorization: `Bearer ${gmToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Acceptance Player Two' }) });
  assert.equal(secondEnrollment.status, 201, 'GM enrolls a second individual player');
  ({ credential: secondPlayerToken, memberId: secondPlayerMemberId } = await secondEnrollment.json());
  assert.notEqual(secondPlayerMemberId, playerMemberId, 'each enrolled player receives a distinct member identity');
  // The clean-host contract is asserted above. Install scenario fixtures explicitly
  // through host APIs, and keep every actor on the campaign's pinned module so
  // client startup does not try to bootstrap a cross-system legacy fixture.
  for (const encounter of [
    { id: 'encounter-a', name: 'The Glass Bridge', summary: 'A narrow crossing over a deep ravine.' },
    { id: 'encounter-b', name: 'The Sunken Archive', summary: 'A flooded chamber of forgotten records.' },
  ]) {
    const response = await request('/api/encounters', gmToken, { method: 'POST', body: jsonBody(encounter) });
    assert.equal(response.status, 201, `acceptance fixture encounter ${encounter.id} is created explicitly`);
  }
  for (const actor of [
    { id: 'actor-emberfall-01', data: { name: 'Mira Vell', epithet: 'Ashbound arcanist', attributes: { strength: 14, intelligence: 12 }, resources: { hp: { current: 24, maximum: 32 }, mana: { current: 5, maximum: 8 } }, derived: { meleeBonus: 4 }, secretNote: 'The magistrate recognizes Mira.' }, visibility: { gmOnly: ['secretNote'] } },
    { id: 'actor-tidebound-01', data: { name: 'Tarin Vale', epithet: 'Second acceptance character', attributes: { strength: 12, intelligence: 10 }, resources: { hp: { current: 20, maximum: 24 }, mana: { current: 3, maximum: 4 } } } },
  ]) {
    const response = await request('/api/actors', gmToken, { method: 'POST', body: jsonBody({ ...actor, moduleId: 'example.system-a', moduleVersion: '0.1.0' }) });
    assert.equal(response.status, 201, `acceptance fixture actor ${actor.id} is created with the pinned module`);
  }
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
  start(process.execPath, [join(root, 'clients/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(secondPlayerWebPort), '--strictPort'], {
    cwd: join(root, 'clients/web'),
    env: { ...process.env, VITE_POTOMAC_HOST: baseUrl, VITE_POTOMAC_GM_TOKEN: 'no-gm-access-in-second-player-client', VITE_POTOMAC_PLAYER_TOKEN: secondPlayerToken },
  });
  await waitFor(secondPlayerWebUrl, 'isolated second player Vite client');
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
  const secondPlayerCtx = await cdp('Target.createBrowserContext');
  const gm = await openContext(gmCtx.browserContextId, 'gm', `workspace-acceptance-gm-${process.pid}`, webUrl);

  // Exercise configuration through the GM Workspace, not only the host API.
  await waitForExpression(gm.sessionId, "Boolean(document.querySelector('.campaign-setup input'))", 'GM campaign configuration form');
  await evaluate(gm.sessionId, "(() => { const field=document.querySelector('.campaign-setup input'); field.focus(); field.select(); })()");
  await cdp('Input.insertText', { text: 'The Ashen Road' }, gm.sessionId);
  await clickText(gm.sessionId, 'Save campaign', '.campaign-setup button');
  await waitForExpression(gm.sessionId, "document.querySelector('.campaign-select strong')?.textContent === 'The Ashen Road'", 'GM campaign name update');
  const uiCampaign = await (await request('/api/campaign', gmToken)).json();
  assert.equal(uiCampaign.name, 'The Ashen Road', 'campaign settings UI persists host configuration');
  assert.equal(uiCampaign.systemModuleId, 'example.system-a', 'campaign UI retains the pinned rules module');
  assert.equal(uiCampaign.revision, 3, 'campaign UI uses revision-checked writes');

  const gmProjectionResponse = await fetch(`${baseUrl}/api/state`, { headers: { authorization: `Bearer ${gmToken}` } });
  const gmProjection = await gmProjectionResponse.json();
  assert.equal(gmProjectionResponse.status, 200);
  assert.ok(gmProjection.actors.length >= 2, `GM reads the explicitly-created compatible acceptance actors: ${JSON.stringify(gmProjection.actors.map(actor => ({ id: actor.id, moduleId: actor.moduleId, moduleVersion: actor.moduleVersion })))}`);
  const createdActorResponse = await request('/api/actors', gmToken, { method: 'POST', body: jsonBody({
    id: 'acceptance-created-actor', moduleId: 'example.system-a', moduleVersion: '0.1.0',
    data: { name: 'Acceptance Created Character', epithet: 'API acceptance fixture', attributes: { strength: 10, intelligence: 11 }, resources: { hp: { current: 7, maximum: 7 }, mana: { current: 2, maximum: 3 } } },
  }) });
  assert.equal(createdActorResponse.status, 201, 'GM creates a schema-valid character using the host API');
  createdActor = await createdActorResponse.json();
  assert.equal(createdActor.data.name, 'Acceptance Created Character');
  assert.equal(createdActor.revision, 1);
  const createdActorEditResponse = await request('/api/actions', gmToken, { method: 'POST', body: jsonBody({
    operationId: `acceptance-edit-${process.pid}`, entityId: createdActor.id, baseRevision: createdActor.revision, actionId: 'spend-mana', parameters: {},
  }) });
  assert.equal(createdActorEditResponse.status, 200, 'GM edits character state through a declared module action');
  const editedActorResponse = await request(`/api/actors/${encodeURIComponent(createdActor.id)}`, gmToken);
  const editedActor = await editedActorResponse.json();
  assert.equal(editedActor.revision, 2, 'accepted character edit advances the entity revision');
  assert.equal(editedActor.data.resources.mana.current, 1, 'accepted character edit changes only the declared resource');
  assert.equal((await request(`/api/actors/${encodeURIComponent(createdActor.id)}`, playerToken)).status, 404, 'ungranted participant cannot read a newly created character');
  const deniedUnsharedEdit = await request('/api/actions', playerToken, { method: 'POST', body: jsonBody({
    operationId: `acceptance-denied-edit-${process.pid}`, campaignId: freshSetup.campaignId, memberId: playerMemberId,
    moduleId: createdActor.moduleId, moduleVersion: createdActor.moduleVersion, schemaVersion: createdActor.data.schemaVersion,
    entityId: createdActor.id, baseRevision: 2, actionId: 'spend-mana', parameters: {}, dependencies: [],
  }) });
  assert.equal(deniedUnsharedEdit.status, 404, 'ungranted participant cannot edit a newly created character');
  assert.equal((await request('/api/actors/acceptance-created-actor/grants', playerToken, { method: 'POST', body: jsonBody({ memberId: playerMemberId, permissions: ['read', 'act'] }) })).status, 403, 'participant cannot grant character access');
  assert.equal((await request('/api/members/enroll', playerToken, { method: 'POST', body: jsonBody({ displayName: 'Unauthorized enrollment' }) })).status, 403, 'participant cannot enroll another campaign member');
  assert.equal((await request('/api/context', playerToken, { method: 'POST', body: jsonBody({ context: { activeEncounter: 'encounter-a' } }) })).status, 403, 'participant cannot activate an encounter');
  const createGrant = await request(`/api/actors/${encodeURIComponent(createdActor.id)}/grants`, gmToken, { method: 'POST', body: jsonBody({ memberId: playerMemberId, permissions: ['read', 'act'] }) });
  assert.equal(createGrant.status, 201, 'GM grants the new character to an enrolled participant');
  assert.equal((await request(`/api/actors/${encodeURIComponent(createdActor.id)}`, playerToken)).status, 200, 'granted participant can read the character');
  for (const actor of gmProjection.actors.filter(actor => actor.id !== createdActor.id)) {
    const grant = await fetch(`${baseUrl}/api/actors/${encodeURIComponent(actor.id)}/grants`, { method: 'POST', headers: { authorization: `Bearer ${gmToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ memberId: playerMemberId, permissions: ['read', 'act'] }) });
    assert.equal(grant.status, 201, `GM grants player access to ${actor.id}`);
  }
  const participantSetResponse = await request(`/api/encounters/${encodeURIComponent(createdEncounter.id)}/participants`, gmToken, { method: 'PUT', body: jsonBody({
    baseRevision: editedEncounter.revision,
    participants: [
      { actorId: 'actor-emberfall-01', initiative: 14, status: 'active', activationOrder: 0 },
      { actorId: 'actor-tidebound-01', initiative: 9, status: 'active', activationOrder: 1 },
    ],
  }) });
  const participantSet = await participantSetResponse.json();
  assert.equal(participantSetResponse.status, 200, 'GM assigns participants, initiative, and activation order to an encounter');
  assert.equal(participantSet.revision, editedEncounter.revision + 1, 'participant assignment advances encounter revision');
  if (participantSet.participants?.length !== 2) knownAcceptanceGaps.push('Encounter participant PUT is accepted, but its response does not project the assigned participant records.');
  assert.equal((await request(`/api/encounters/${encodeURIComponent(createdEncounter.id)}/participants`, legacyPlayerToken, { method: 'PUT', body: jsonBody({ baseRevision: participantSet.revision, participants: [] }) })).status, 403, 'participant cannot edit an encounter roster');
  assert.equal((await request(`/api/encounters/${encodeURIComponent(createdEncounter.id)}/participants`, gmToken, { method: 'PUT', body: jsonBody({ baseRevision: editedEncounter.revision, participants: [] }) })).status, 409, 'stale encounter roster edits are rejected');
  const activateCreatedEncounter = await request('/api/context', gmToken, { method: 'POST', body: jsonBody({ context: { activeEncounter: createdEncounter.id } }) });
  assert.equal(activateCreatedEncounter.status, 200, 'GM activates the newly created encounter as shared campaign context');
  const afterActivation = await (await request('/api/state', gmToken)).json();
  assert.equal(afterActivation.context.activeEncounter, createdEncounter.id, 'campaign snapshot reflects the selected active encounter');
  assert.ok(afterActivation.events.some(event => event.kind === 'encounter.participants.changed'), 'participant assignment is recorded in campaign event history');
  const player = await openContext(playerCtx.browserContextId, 'player', `workspace-acceptance-player-${process.pid}`, playerWebUrl);
  const secondPlayer = await openContext(secondPlayerCtx.browserContextId, 'player', `workspace-acceptance-player-two-${process.pid}`, secondPlayerWebUrl);
  const secondPlayerProjectionResponse = await fetch(`${baseUrl}/api/state`, { headers: { authorization: `Bearer ${secondPlayerToken}` } });
  const secondPlayerProjection = await secondPlayerProjectionResponse.json();
  assert.equal(secondPlayerProjectionResponse.status, 200, 'second enrolled player can read an authorized snapshot');
  assert.equal(secondPlayerProjection.memberId, secondPlayerMemberId, 'host snapshot is scoped to the second member identity');
  assert.equal(secondPlayerProjection.actors.length, 0, 'second player receives no character grants issued only to the first player');
  assert.ok(secondPlayerProjection.events.every(event => event.visibility === 'public'
    && (!event.actorId || secondPlayerProjection.actors.some(actor => actor.id === event.actorId))), 'second player event replay contains only public events for readable actors');
  assert.ok(secondPlayer.secrets.every(item => !item.body.includes(playerMemberId)), 'second player browser network payloads do not disclose the first member identity');

  // Exercise the registered Table bricks in three isolated browser profiles.
  // The GM and Player A have authorized roster entries; Player B has no grants.
  await waitForExpression(gm.sessionId, "document.querySelector('.session-strip:not([aria-label=\\\"Table workflow\\\"]) strong')?.textContent === 'Edited Acceptance Encounter'", 'GM Table encounter context');
  await waitForExpression(player.sessionId, "document.querySelector('.session-strip:not([aria-label=\\\"Table workflow\\\"]) strong')?.textContent === 'Edited Acceptance Encounter'", 'Player A Table encounter context');
  await waitForExpression(secondPlayer.sessionId, "[...document.querySelectorAll('.brick')].some(brick=>brick.querySelector('.brick-head strong')?.textContent==='Participants' && brick.textContent.includes('No participants'))", 'Player B empty authorized Table roster');
  const tableRoster = await evaluate(player.sessionId, "[...document.querySelectorAll('.table-participants article strong')].map(item=>item.textContent)");
  assert.deepEqual(tableRoster.sort(), ['Mira Vell', 'Tarin Vale'], 'Player A Table shows only its two granted participants from the active encounter');
  await waitForExpression(gm.sessionId, "document.querySelector('.session-strip[aria-label=\"Table workflow\"] button')?.textContent === 'Start Table session' && !document.querySelector('.session-strip[aria-label=\"Table workflow\"] button').disabled", 'GM Table workflow start control enabled for active encounter');
  assert.equal(await evaluate(player.sessionId, "document.querySelector('.session-strip[aria-label=\"Table workflow\"] button')?.textContent || ''"), '', 'player Table workflow has no GM start control');
  await clickText(gm.sessionId, 'Start Table session', '.session-strip[aria-label="Table workflow"] button');
  const startedSession = await (await request('/api/session', gmToken)).json();
  assert.equal(startedSession.current.status, 'active', 'workflow banner creates an authoritative active session');
  assert.equal(startedSession.current.encounterId, createdEncounter.id, 'workflow banner starts the selected encounter');
  await waitForExpression(gm.sessionId, "document.querySelector('.table-session-panel strong')?.textContent === 'Active'", 'GM starts the live Table session against the committed active encounter');
  for (const [label, client] of [['GM', gm], ['Player A', player], ['Player B', secondPlayer]]) {
    await waitForExpression(client.sessionId, "document.querySelector('.table-session-panel strong')?.textContent === 'Active'", `${label} sees committed active Table session`);
  }
  await clickText(gm.sessionId, 'Pause session', '.table-session-panel button');
  for (const [label, client] of [['GM', gm], ['Player A', player], ['Player B', secondPlayer]]) {
    await waitForExpression(client.sessionId, "document.querySelector('.table-session-panel strong')?.textContent === 'Paused'", `${label} sees committed paused Table session`);
  }
  await clickText(gm.sessionId, 'Resume session', '.table-session-panel button');
  for (const [label, client] of [['GM', gm], ['Player A', player], ['Player B', secondPlayer]]) {
    await waitForExpression(client.sessionId, "document.querySelector('.table-session-panel strong')?.textContent === 'Active'", `${label} sees committed resumed Table session`);
  }
  assert.equal(await evaluate(player.sessionId, "document.querySelector('.table-session-panel')?.textContent.includes('Session controls are managed by the GM.')"), true, 'player Table view has no GM session controls');
  await clickText(gm.sessionId, 'Return to preparation');
  await waitForExpression(gm.sessionId, "document.querySelector('.encounters-page .active-encounter h2')?.textContent === 'Edited Acceptance Encounter'", 'GM returns to the active encounter preparation while session remains active');
  await waitForExpression(gm.sessionId, "[...document.querySelectorAll('.encounter-card')].find(card=>card.textContent.includes('Edited Acceptance Encounter'))?.querySelectorAll('button').length === 2", 'active encounter offers non-mutating Open Table re-entry');
  await clickText(gm.sessionId, 'Open Table', '.encounter-card button');
  await waitForExpression(gm.sessionId, "document.querySelector('.session-strip[aria-label=\\\"Table workflow\\\"] small')?.textContent.includes('Edited Acceptance Encounter')", 'GM reopens Table without reactivating the encounter');

  const gmState = await evaluate(gm.sessionId, `(() => { const e = document.querySelector('.gm-note'); return {note:e?.textContent || '', actor:document.querySelector('.character-view h3')?.textContent || '', key:Object.keys(localStorage).find(k=>k.startsWith('potomac:workspace:')), body:document.body.innerText.slice(0,900)} })()`);
  assert.match(gmState.note, /The magistrate recognizes Mira\./, `GM sees the fixture secret note: ${JSON.stringify(gmState)}`);
  const playerState = await evaluate(player.sessionId, `(() => ({ note:document.querySelector('.gm-note')?.textContent || '', text:document.body.innerText }))()`);
  assert.equal(playerState.note, '', 'player UI has no GM-only note');
  await delay(450);
  assert.ok(player.secrets.some(item => item.url.includes('/api/state') && !item.body.includes('The magistrate recognizes Mira.')), 'player /api/state network response excludes the GM-only fixture note');
  assert.ok(player.secrets.every(item => !item.body.includes('The magistrate recognizes Mira.')), 'no captured player API payload contains the forbidden note');

  // Exercise the member enrollment and character grant controls through the actual GM UI.
  await evaluate(gm.sessionId, "document.querySelector('.gm-admin').open = true");
  await evaluate(gm.sessionId, "window.prompt = (_message, fallback) => fallback || 'Acceptance UI Participant'");
  await clickText(gm.sessionId, 'Enroll player');
  await waitForExpression(gm.sessionId, "document.querySelector('.gm-admin')?.textContent.includes('One-time credential')", 'UI-enrolled participant credential');
  const uiParticipantCodes = await evaluate(gm.sessionId, "[...document.querySelectorAll('.gm-admin code')].map(element => element.textContent)");
  assert.equal(uiParticipantCodes.length, 2, 'GM enrollment UI displays member identity and one-time credential');
  const [uiParticipantMemberId, uiParticipantToken] = uiParticipantCodes;
  assert.equal((await request('/api/state', uiParticipantToken)).status, 200, 'credential issued by the GM UI authenticates its participant');
  const uiUnsharedState = await (await request('/api/state', uiParticipantToken)).json();
  assert.equal(uiUnsharedState.actors.length, 0, 'new UI-enrolled participant initially sees no characters');
  await clickText(gm.sessionId, 'Characters', 'nav[aria-label="Applications"] button');
  await waitForExpression(gm.sessionId, "Boolean(document.querySelector('.character-list button'))", 'character app participant grant selection');
  await clickText(gm.sessionId, 'Mira Vell', '.character-list button');
  await evaluate(gm.sessionId, "document.querySelector('.gm-admin').open = true");
  await evaluate(gm.sessionId, "window.prompt = (_message, fallback) => fallback || ''");
  await clickText(gm.sessionId, 'Grant selected character');
  await waitForExpression(gm.sessionId, "document.querySelector('.action-status')?.textContent.includes('granted to member')", 'character grant confirmation in GM UI');
  const uiGrantedStateResponse = await request('/api/state', uiParticipantToken);
  const uiGrantedState = await uiGrantedStateResponse.json();
  assert.equal(uiGrantedStateResponse.status, 200);
  assert.ok(uiGrantedState.actors.some(actor => actor.id === 'actor-emberfall-01'), 'UI-granted participant can read the selected character');
  assert.equal(uiGrantedState.actors.some(actor => actor.id === 'actor-tidebound-01'), false, 'UI grant is scoped to the selected character');
  assert.equal((await request('/api/actors/actor-tidebound-01', uiParticipantToken)).status, 404, 'UI-granted participant cannot directly read a different character');

  await clickText(gm.sessionId, 'Create character');
  await waitForExpression(gm.sessionId, "Boolean(document.querySelector('.schema-form input'))", 'schema-driven character creation form');
  const creationInputs = await evaluate(gm.sessionId, "[...document.querySelectorAll('.schema-form input')].map(input=>input.type)");
  for (let index = 0; index < creationInputs.length; index++) {
    await evaluate(gm.sessionId, `document.querySelectorAll('.schema-form input')[${index}].focus()`);
    await cdp('Input.insertText', { text: index === 0 ? 'UI Created Character' : creationInputs[index] === 'number' ? '1' : 'Acceptance UI fixture' }, gm.sessionId);
  }
  const uiCharacterFormState = await evaluate(gm.sessionId, "(() => { const form=document.querySelector('.schema-form'); const input=[...form.querySelectorAll('label')].find(label=>label.textContent.trim().startsWith('Name'))?.querySelector('input'); return {name:input?.value,valid:form?.checkValidity(),invalid:[...form.querySelectorAll(':invalid')].map(item=>({name:item.name,value:item.value,required:item.required,min:item.min,label:item.closest('label')?.textContent})),buttonDisabled:form?.querySelector('button.primary')?.disabled} })()");
  assert.equal(uiCharacterFormState.name, 'UI Created Character', `character name field is populated: ${JSON.stringify(uiCharacterFormState)}`);
  await clickText(gm.sessionId, 'Create on host', '.schema-form button');
  await waitForExpression(gm.sessionId, "document.querySelector('.error-banner')?.textContent.includes('must be object') || document.querySelector('.action-status')?.textContent.includes('Character created and accepted by host')", 'UI character create result');
  const uiCreateResult = await evaluate(gm.sessionId, "({error:document.querySelector('.error-banner')?.textContent || '',status:document.querySelector('.action-status')?.textContent || ''})");
  if (uiCreateResult.error) {
    knownAcceptanceGaps.push(`Character creation form was exercised, but host rejected its resource fields: ${uiCreateResult.error}`);
    await click(gm.sessionId, '.error-banner button');
    await clickText(gm.sessionId, 'Cancel', '.schema-form button');
  }
  if (uiCreateResult.status.includes('Character created and accepted by host')) {
    const uiCreatedState = await (await request('/api/state', gmToken)).json();
    const uiCreatedActor = uiCreatedState.actors.find(actor => actor.data.name === 'UI Created Character');
    assert.ok(uiCreatedActor, 'character created in the schema-driven UI is committed to the host');
    assert.equal(uiCreatedActor.data.moduleId, 'example.system-a', 'UI character creation uses the selected versioned module');
    // Editing must use the same authoritative record as a brick, not a local-only form.
    await clickText(gm.sessionId, 'Edit character fields');
    await waitForExpression(gm.sessionId, "document.querySelector('.schema-form h2')?.textContent === 'Edit character'", 'GM character edit form');
    await evaluate(gm.sessionId, "(() => { const input=[...document.querySelectorAll('.schema-form label')].find(label=>label.textContent.includes('Description / epithet'))?.querySelector('input'); if (!input) throw new Error('Epithet edit field missing'); input.focus(); input.select(); })()");
    await cdp('Input.insertText', { text: 'Edited through Characters' }, gm.sessionId);
    await clickText(gm.sessionId, 'Save changes', '.schema-form button');
    await waitForExpression(gm.sessionId, "document.querySelector('.action-status')?.textContent.includes('Character fields updated on host.')", 'GM character update result');
    const updatedUiActor = await (await request('/api/actors/' + encodeURIComponent(uiCreatedActor.id), gmToken)).json();
    assert.equal(updatedUiActor.data.epithet, 'Edited through Characters', 'character field edit persisted on host');
    assert.equal(updatedUiActor.revision, uiCreatedActor.revision + 1, 'character field edit advanced authoritative revision');
  }

  await clickText(gm.sessionId, 'Encounters', 'nav[aria-label="Applications"] button');
  await waitForExpression(gm.sessionId, "[...document.querySelectorAll('.encounter-card h2')].some(heading=>heading.textContent==='Edited Acceptance Encounter')", 'created encounter in the Encounters application');
  await evaluate(gm.sessionId, "[...document.querySelectorAll('.encounter-card')].find(card=>card.textContent.includes('Edited Acceptance Encounter'))?.querySelectorAll('button').forEach(button=>{ if(button.textContent==='Prepare / edit') button.click() })");
  await waitForExpression(gm.sessionId, "document.querySelector('.encounters-page .schema-form h2')?.textContent.includes('Prepare Edited Acceptance Encounter')", 'encounter preparation controls');
  await evaluate(gm.sessionId, "(() => { const field=document.querySelector('.encounters-page .schema-form textarea'); field.focus(); field.select(); })()");
  await evaluate(gm.sessionId, "(() => { const field=document.querySelector('.encounters-page .schema-form textarea'); const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(field, 'Prepared in the Encounters app'); field.dispatchEvent(new Event('input', { bubbles:true })); })()");
  await waitForExpression(gm.sessionId, "document.querySelector('.encounters-page .schema-form textarea')?.value === 'Prepared in the Encounters app'", 'encounter preparation summary input updated');
  await evaluate(gm.sessionId, "(() => { const item=[...document.querySelectorAll('.encounters-page .schema-form fieldset label')].find(label=>label.textContent.includes('UI Created Character')); if (!item) throw new Error('Created actor missing from participant selector'); const input=item.querySelector('input'); if (!input.checked) input.click(); })()");
  await clickText(gm.sessionId, 'Save encounter and participants', '.encounters-page .schema-form button');
  await waitForExpression(gm.sessionId, "document.querySelector('.action-status')?.textContent.includes('Encounter and participants saved on host.')", 'encounter update result');
  let preparedEncounter;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    preparedEncounter = await (await request('/api/encounters/' + encodeURIComponent(createdEncounter.id), gmToken)).json();
    if (preparedEncounter.summary === 'Prepared in the Encounters app') break;
    await delay(100);
  }
  assert.equal(preparedEncounter.summary, 'Prepared in the Encounters app', 'GM encounter editing persisted to the host');
  assert.equal(preparedEncounter.participants.length, 3, 'GM UI added the created character to the encounter roster');
  await clickText(gm.sessionId, 'Create encounter');
  await waitForExpression(gm.sessionId, "document.querySelector('.encounters-page .schema-form h2')?.textContent === 'New encounter'", 'new encounter UI');
  await evaluate(gm.sessionId, "document.querySelector('.encounters-page .schema-form input').focus()");
  await cdp('Input.insertText', { text: 'The Orchard Ruins' }, gm.sessionId);
  await clickText(gm.sessionId, 'Create on host', '.encounters-page .schema-form button');
  await waitForExpression(gm.sessionId, "[...document.querySelectorAll('.encounter-card h2')].some(heading=>heading.textContent==='The Orchard Ruins')", 'encounter created through app');
  assert.ok((await (await request('/api/encounters', gmToken)).json()).encounters.some(e=>e.name==='The Orchard Ruins'), 'encounter creation via GM app persisted to host');
  await waitForExpression(gm.sessionId, "(() => { const card=[...document.querySelectorAll('.encounter-card')].find(item=>item.textContent.includes('The Glass Bridge')); const button=[...(card?.querySelectorAll('button') || [])].find(item=>item.textContent==='Activate and open Table'); return Boolean(button && !button.disabled); })()", 'The Glass Bridge activation and Table handoff enabled');
  await evaluate(gm.sessionId, "[...document.querySelectorAll('.encounter-card')].find(card=>card.textContent.includes('The Glass Bridge'))?.querySelectorAll('button').forEach(button=>{ if(button.textContent==='Activate and open Table') button.click() })");
  await waitForExpression(gm.sessionId, "document.querySelector('.session-strip[aria-label=\\\"Table workflow\\\"] small')?.textContent.includes('The Glass Bridge')", 'Encounters application hands off to Table with shared context');
  await clickText(gm.sessionId, 'Return to preparation');
  await waitForExpression(gm.sessionId, "document.querySelector('.active-encounter h2')?.textContent === 'The Glass Bridge'", 'Table returns to encounter preparation without changing context');
  await waitForExpression(gm.sessionId, "(() => { const card=[...document.querySelectorAll('.encounter-card')].find(item=>item.textContent.includes('Edited Acceptance Encounter')); const button=[...(card?.querySelectorAll('button') || [])].find(item=>item.textContent==='Activate and open Table'); return Boolean(button && !button.disabled); })()", 'selected encounter activation control enabled');
  await evaluate(gm.sessionId, "[...document.querySelectorAll('.encounter-card')].find(card=>card.textContent.includes('Edited Acceptance Encounter'))?.querySelectorAll('button').forEach(button=>{ if(button.textContent==='Activate and open Table') button.click() })");
  await waitForExpression(gm.sessionId, "document.querySelector('.session-strip[aria-label=\\\"Table workflow\\\"] small')?.textContent.includes('Edited Acceptance Encounter')", 'Encounters application activates the selected encounter and opens Table');
  const uiEncounterActivation = await (await request('/api/state', gmToken)).json();
  assert.equal(uiEncounterActivation.context.activeEncounter, createdEncounter.id, 'Encounters application activation commits shared campaign context');
  await clickText(gm.sessionId, 'Dashboard', 'nav[aria-label="Applications"] button');
  await waitForExpression(gm.sessionId, "Boolean(document.querySelector('.session-strip'))", 'dashboard after encounter app activation');

  // Separate browser contexts must retain separate profile-specific layouts.
  assert.notEqual(gmState.key, undefined);
  const initialPlayerKey = await evaluate(player.sessionId, `Object.keys(localStorage).find(k=>k.startsWith('potomac:workspace:'))`);
  assert.notEqual(gmState.key, initialPlayerKey, 'GM and player browser contexts have distinct layout storage');

  await evaluate(gm.sessionId, "(() => { const select=document.querySelector('#encounter-select'); select.value='encounter-a'; select.dispatchEvent(new Event('change',{bubbles:true})); })()");
  await clickText(gm.sessionId, 'Set active');
  await waitForExpression(gm.sessionId, "document.querySelector('.session-strip:not([aria-label=\\\"Table workflow\\\"]) strong')?.textContent === 'The Glass Bridge'", 'active encounter A');

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
  await waitForExpression(gm.sessionId, "document.querySelectorAll('.character-view h3').length > 0", 'pinned character brick');
  await waitForExpression(gm.sessionId, `JSON.parse(localStorage.getItem(${JSON.stringify(gmState.key)}))?.groups.some(group => group.name === 'Acceptance Group')`, 'GM group persisted in local profile');
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
  await waitForExpression(gm.sessionId, "document.querySelector('.character-view h3')?.textContent", 'pinned character after context update');
  assert.ok((await evaluate(gm.sessionId, "document.querySelector('.character-view h3')?.textContent || ''")).trim().length > 0, 'pinned character brick remains bound to an authorized character');
  await click(gm.sessionId, '.character-view .action-grid button');
  await waitForExpression(gm.sessionId, "['accepted by host', 'accepted at revision'].some(text=>document.querySelector('.action-status')?.textContent.includes(text))", 'host-accepted action');
  const acceptedActionState = await (await request('/api/state', gmToken)).json();
  assert.ok(acceptedActionState.events.some(event => event.kind === 'action.applied' && event.payload.actionId === 'spend-mana'), 'GM character action is committed to authoritative event history');
  await waitForExpression(player.sessionId, "document.querySelector('.activity-item strong')?.textContent", 'player activity refresh after authorized action');
  assert.ok(player.secrets.every(item => !item.body.includes('The magistrate recognizes Mira.')), 'player payloads stay redacted after activity refresh');

  // Restart the host against the same database and verify committed campaign, character, and grant state.
  const oldHost = hostProcess;
  oldHost.child.kill('SIGTERM');
  await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error('Host did not stop for persistence acceptance')), 10000);
    oldHost.child.once('exit', () => { clearTimeout(timeout); resolvePromise(); });
  });
  startHost();
  await waitFor(`${baseUrl}/health`, 'restarted host');
  const restartedGmResponse = await request('/api/state', gmToken);
  const restartedGm = await restartedGmResponse.json();
  assert.equal(restartedGmResponse.status, 200);
  assert.equal(restartedGm.campaignId, freshSetup.campaignId, 'campaign identity persists across host restart');
  assert.equal(restartedGm.context.activeEncounter, 'encounter-b', 'active encounter persists across host restart');
  assert.ok(restartedGm.actors.some(actor => actor.id === createdActor.id && actor.revision >= 2 && actor.data.resources.mana.current <= 1), `created and edited character persists across host restart: ${JSON.stringify(restartedGm.actors.find(actor => actor.id === createdActor.id))}`);
  const restartedPlayerResponse = await request('/api/state', playerToken);
  const restartedPlayer = await restartedPlayerResponse.json();
  assert.ok(restartedPlayer.actors.some(actor => actor.id === createdActor.id), 'character grant persists across host restart');
  assert.equal((await request('/api/actors/actor-tidebound-01', uiParticipantToken)).status, 404, 'UI participant grant scope remains limited after host restart');
  assert.equal((await request('/api/actors/actor-emberfall-01', uiParticipantToken)).status, 200, 'UI participant grant remains valid after host restart');

  // Host-side authorization and client recovery are checked independently.
  const denied = await request('/api/context', playerToken, { method: 'POST', body: jsonBody({ context: { activeEncounter: 'encounter-a' } }) });
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

  // The campaign acceptance gate must preserve every host-owned collection, not
  // merely exercise the backup API's existence. Export from the live WAL-backed
  // host and restore to an entirely separate database.
  const backupPath = join(scratch, 'campaign-backup.json');
  const restoredPath = join(scratch, 'campaign-restored.sqlite');
  const exportManifest = exportCampaignBackup(dbPath, backupPath);
  assert.equal(exportManifest.potomacDataVersion, 5, 'campaign export format includes persistent encounters, Lore and Maps');
  assert.ok(exportManifest.includedCollections.includes('encounters'));
  assert.ok(exportManifest.includedCollections.includes('encounter_participants'));
  assert.ok(exportManifest.includedCollections.includes('map_scenes'));
  const restoredManifest = restoreCampaignBackup(backupPath, restoredPath);
  assert.equal(restoredManifest.campaignId, 'foundation-demo');
  const sourceDb = new DatabaseSync(dbPath, { readOnly: true });
  const restoredDb = new DatabaseSync(restoredPath, { readOnly: true });
  try {
    const tables = ['campaign', 'actors', 'encounters', 'encounter_participants', 'members', 'actor_grants', 'events', 'operations', 'offline_receipts', 'offline_proposals', 'offline_decisions'];
    const hasTable = table => Boolean(sourceDb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
    for (const table of ['lore_entries', 'lore_links', 'lore_operations']) if (hasTable(table)) tables.push(table);
    for (const table of tables) {
      assert.equal(restoredDb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
        sourceDb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, `restored ${table} row count matches source`);
    }
    const originalCampaign = sourceDb.prepare('SELECT name,system_module_id,system_module_version,revision,context FROM campaign WHERE id=?').get('foundation-demo');
    const recoveredCampaign = restoredDb.prepare('SELECT name,system_module_id,system_module_version,revision,context FROM campaign WHERE id=?').get('foundation-demo');
    assert.deepEqual({ ...recoveredCampaign }, { ...originalCampaign }, 'campaign configuration and selected active encounter round-trip');
    assert.equal(restoredDb.prepare('SELECT name FROM encounters WHERE id=?').get(createdEncounter.id).name, 'Edited Acceptance Encounter');
    assert.equal(restoredDb.prepare('SELECT summary FROM encounters WHERE id=?').get(createdEncounter.id).summary, 'Prepared in the Encounters app');
    assert.equal(restoredDb.prepare('SELECT COUNT(*) AS n FROM encounter_participants WHERE encounter_id=?').get(createdEncounter.id).n, 3);
    assert.equal(restoredDb.prepare('SELECT COUNT(*) AS n FROM actor_grants WHERE member_id=?').get(playerMemberId).n > 0, true);
  } finally { restoredDb.close(); sourceDb.close(); }
  const tamperedPath = join(scratch, 'campaign-tampered.json');
  const tamperedDestination = join(scratch, 'tampered-destination.sqlite');
  const tampered = JSON.parse(readFileSync(backupPath, 'utf8'));
  tampered.data.encounters[0].name = 'Corrupted without digest update';
  writeFileSync(tamperedPath, JSON.stringify(tampered));
  assert.throws(() => restoreCampaignBackup(tamperedPath, tamperedDestination), /integrity check failed/, 'tampered backup must fail integrity verification');
  assert.equal(existsSync(tamperedDestination), false, 'unsafe restore does not create target database');

  // Do not mark acceptance as successful while a requirement has only been
  // logged as a gap. Every gap is now a hard failure in pnpm check / CI.
  assert.deepEqual(knownAcceptanceGaps, [], 'all required campaign acceptance steps must pass');

  console.log('PASS: fresh campaign setup/configuration; schema-valid character creation by API and UI; action-based character edits; participant enrollment and character grants by API and UI; encounter create/edit, participant assignment and encounter-app activation; three isolated browsers exercise Table roster projections and session start/pause/resume; player permission denials; two-player/member visibility isolation; host restart persistence for campaign, encounter context, characters and grants; dashboard layout, browser reload, action activity and secret redaction.');
  console.log('PASS: versioned backup/restore, campaign pin, encounter participants and corruption rejection.');
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
