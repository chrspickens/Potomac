// Disposable real-Chromium Maps acceptance. Incremental stages are intentionally
// asserted in order so a later failure never hides an earlier browser result.
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { deflateSync } from 'node:zlib'
import { exportCampaignBackup, restoreCampaignBackup } from '../server/host/backup.mjs'

const root = resolve(import.meta.dirname, '..'); const scratch = await mkdtemp(join(tmpdir(), 'potomac-maps-browser-')); const db = join(scratch, 'host.sqlite'); const evidence = join(root, 'docs/evidence/maps-v07-browser'); await mkdir(evidence, { recursive: true })
const chromePath = [process.env.POTOMAC_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(existsSync); if (!chromePath) throw new Error('Chrome/Edge not found. Set POTOMAC_CHROME to its executable path.')
const reservePorts = async count => { const servers = []; try { for (let index = 0; index < count; index += 1) { const server = createServer(); await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok)); servers.push(server) } return servers.map(server => server.address().port) } finally { await Promise.all(servers.map(server => new Promise((ok, fail) => server.close(error => error ? fail(error) : ok())))) } }
const [hostPort, webPort, debugPort] = await reservePorts(3); const hostUrl = `http://127.0.0.1:${hostPort}`; const webUrl = `http://127.0.0.1:${webPort}/`; const gmToken = `maps-browser-gm-${process.pid}`; const redactionTokens = new Set([gmToken])
const children = []; const start = (cmd, args, options = {}) => { const child = spawn(cmd, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options }); let output = ''; child.stdout.on('data', chunk => { output = safeText(output + chunk.toString()).slice(-30000) }); child.stderr.on('data', chunk => { output = safeText(output + chunk.toString()).slice(-30000) }); children.push({ child, getOutput: () => output }); return child }; let hostProcess; const launchHost = (databasePath, port = hostPort, token = gmToken) => start(process.execPath, [join(root, 'server/host/index.mjs')], { env: { ...process.env, PORT: String(port), POTOMAC_DB: databasePath, POTOMAC_GM_TOKEN: token, POTOMAC_PLAYER_TOKEN: `disabled-${process.pid}`, POTOMAC_SEED_DEMO: '0' } }); const stopHost = async () => { const previous = hostProcess; previous.kill('SIGTERM'); await waitChildExit(previous, 10000); if (previous.exitCode === null && previous.signalCode === null) throw new Error('Disposable host did not exit after SIGTERM') }; const waitFor = async (url, label) => { const started = Date.now(); let last; while (Date.now() - started < 30000) { try { const response = await fetch(url); if (response.ok) return response; last = new Error(`HTTP ${response.status}`) } catch (error) { last = error } await delay(120) } throw new Error(`${label} did not become ready: ${last?.message || 'timeout'}\n${children.map(item => item.getOutput()).join('\n')}`) }
const api = async (path, token, init = {}) => { const response = await fetch(`${hostUrl}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } }); return { response, body: await response.json().catch(() => undefined) } }
let socket; let nextId = 0; const pending = new Map(); const diagnostics = { startedAt: new Date().toISOString(), events: [], requests: {}, statuses: [], probes: {}, stages: [] }; let gmSession; let diagnosticsPath; const clients = {}; const traceWaiters = new Map(); const acceptanceLoreIds = new Set(); const acceptancePinIds = new Set()
const cdp = (method, params = {}, sessionId) => new Promise((resolvePromise, reject) => { const id = ++nextId; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)) }, 15000); pending.set(id, message => { clearTimeout(timer); message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolvePromise(message.result) }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })) })
const evaluate = (session, expression) => cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session).then(result => { if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value })
const waitExpr = async (session, expression, label) => { const started = Date.now(); while (Date.now() - started < 15000) { if (await evaluate(session, expression)) return; await delay(100) } throw new Error(`Timed out: ${label}`) }
const clickText = (session, text, selector = 'button') => evaluate(session, `(() => { const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>x.textContent.includes(${JSON.stringify(text)})&&!x.disabled); if(!e) throw new Error('missing enabled ${text}; body='+document.body.innerText.slice(0,900)); e.click(); return true })()`)
const inputText = async (session, selector, value) => { await evaluate(session, `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw new Error('missing input'); e.focus(); e.select(); return true })()`); await cdp('Input.insertText', { text: value }, session) }
const pressKey = async (session, key) => { await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: key === 'Tab' ? 9 : undefined }, session); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: key === 'Tab' ? 9 : undefined }, session) }
const selectValue = async (session, selector, value) => evaluate(session, `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw new Error('missing select'); const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('change',{bubbles:true})); return e.value })()`)
const uploadFile = async (session, selector, filePath) => { await cdp('DOM.enable', {}, session); const { root: document } = await cdp('DOM.getDocument', { depth: -1 }, session); const { nodeId } = await cdp('DOM.querySelector', { nodeId: document.nodeId, selector }, session); assert.ok(nodeId, `file control exists: ${selector}`); await cdp('DOM.setFileInputFiles', { nodeId, files: [filePath] }, session) }
const screenshot = async (session, name) => { const result = await cdp('Page.captureScreenshot', { format: 'png' }, session); await writeFile(join(evidence, name), Buffer.from(result.data, 'base64')) }
const saveClientTrace = async client => { const trace = { label: client.label, contextId: client.contextId, targetId: client.targetId, sessionId: client.sessionId, capturedAt: new Date().toISOString(), events: diagnostics.events.filter(event => event.label === client.label || client.label === 'GM' && ['browser.identity', 'browser.action', 'stage1.map-created'].includes(event.type)), requests: client.requestIds.map(id => diagnostics.requests[id]).filter(Boolean) }; await writeFile(join(evidence, `${client.label.toLowerCase().replaceAll(' ', '-')}-chromium-trace.json`), JSON.stringify(trace, null, 2), 'utf8') }
const record = (type, details = {}) => diagnostics.events.push({ at: new Date().toISOString(), type, ...details })
const mark = (name, result, details = {}) => { diagnostics.stages.push({ at: new Date().toISOString(), name, result, ...details }); console.log(`${result}: ${name}`) }
const safeText = value => [...redactionTokens].reduce((textValue, secret) => textValue.replaceAll(secret, '[REDACTED]'), String(value)).replace(/(bearer\s+)[^\s"']+/ig, '$1[REDACTED]').replace(/((?:token|authorization|credential)\s*[:=]\s*)[^\s,;"']+/ig, '$1[REDACTED]')
const pngCrc32 = buffer => { let crc = 0xffffffff; for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) } return (crc ^ 0xffffffff) >>> 0 }
const pngChunk = (type, data) => { const name = Buffer.from(type); const checksum = Buffer.alloc(4); checksum.writeUInt32BE(pngCrc32(Buffer.concat([name, data]))); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); return Buffer.concat([length, name, data, checksum]) }
const mapImage = variant => { const width = 128; const height = 96; const raw = Buffer.alloc(height * (1 + width * 4)); for (let y = 0; y < height; y += 1) { const row = y * (1 + width * 4); raw[row] = 0; for (let x = 0; x < width; x += 1) { const observatory = x > 43 && x < 88 && y > 24 && y < 70; const land = variant === 'world' ? (x < 50 + Math.sin(y / 8) * 18 && y > 18) : observatory; const color = land ? observatory ? [153, 157, 146, 255] : [67, 104, 74, 255] : [34, 107, 128, 255]; const offset = row + 1 + x * 4; color.forEach((channel, index) => { raw[offset + index] = channel }) } } const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6; return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]) }
async function openClient(label, width = 1440, height = 900, clientUrl = webUrl, clientHostUrl = hostUrl) {
  const context = await cdp('Target.createBrowserContext')
  const target = await cdp('Target.createTarget', { url: 'about:blank', browserContextId: context.browserContextId })
  const { sessionId } = await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true })
  const client = { label, contextId: context.browserContextId, targetId: target.targetId, sessionId, requestIds: [] }
  clients[label] = client
  diagnostics.sessions ||= {}
  diagnostics.sessions[label] = { contextId: context.browserContextId, targetId: target.targetId, sessionId }
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.sessionId !== sessionId || !message.method) return
    const p = message.params || {}
    if (message.method === 'Fetch.requestPaused') {
      const parsed = new URL(p.request.url)
      diagnostics.events.push({ at: new Date().toISOString(), type: 'Fetch.requestFailed', label, method: p.request.method, path: parsed.pathname, reason: 'InternetDisconnected' })
      void cdp('Fetch.failRequest', { requestId: p.requestId, errorReason: 'InternetDisconnected' }, sessionId).catch(error => diagnostics.events.push({ at: new Date().toISOString(), type: 'Fetch.failureCommandError', label, message: safeText(error.message) }))
      return
    }
    if (message.method === 'Network.requestWillBeSent') {
      const requestId = `${label}:${p.requestId}`
      const url = new URL(p.request.url)
      const safeQuery = url.searchParams.has('since') ? `?since=${encodeURIComponent(url.searchParams.get('since'))}` : ''
      diagnostics.requests[requestId] = { id: p.requestId, label, startedAt: new Date().toISOString(), method: p.request.method, url: `${url.origin}${url.pathname}${safeQuery}`, events: [] }
      if (p.request.method === 'POST' && url.pathname.endsWith('/commands')) {
        try {
          const body = JSON.parse(p.request.postData || '{}')
          diagnostics.requests[requestId].command = { name: safeText(body.command || ''), baseRevision: Number.isInteger(body.baseRevision) ? body.baseRevision : undefined, hasLoreTarget: typeof body.targetLoreEntryId === 'string', loreTargetMatchesAcceptanceFixture: acceptanceLoreIds.has(body.targetLoreEntryId), hasPieceId: typeof body.pieceId === 'string', pieceMatchesAcceptanceFixture: acceptancePinIds.has(body.pieceId), hasLabel: typeof body.label === 'string' }
        } catch { diagnostics.requests[requestId].command = { parseFailed: true } }
      }
      client.requestIds.push(requestId)
      record(message.method, { label, requestId: p.requestId, method: p.request.method, url: diagnostics.requests[requestId].url })
    } else if (message.method === 'Network.responseReceived' || message.method === 'Network.loadingFailed' || message.method === 'Network.loadingFinished') {
      const requestId = `${label}:${p.requestId}`
      const request = diagnostics.requests[requestId]
      const event = { at: new Date().toISOString(), type: message.method === 'Network.responseReceived' ? 'response' : message.method === 'Network.loadingFailed' ? 'failed' : 'finished', ...(message.method === 'Network.responseReceived' ? { status: p.response.status, mimeType: p.response.mimeType } : { error: safeText(p.errorText || ''), canceled: p.canceled }) }
      if (request) request.events.push(event)
      record(message.method, { label, requestId: p.requestId, ...(event.status ? { status: event.status } : {}), ...(event.error ? { error: event.error, canceled: event.canceled } : {}), ...(p.response?.url ? { url: safeText(p.response.url) } : {}) })
      if (message.method === 'Network.responseReceived' && p.response.status >= 400 && new URL(p.response.url).pathname.startsWith('/api/')) {
        void cdp('Network.getResponseBody', { requestId: p.requestId }, sessionId).then(result => {
          try { const body = JSON.parse(result.body); const request = diagnostics.requests[`${label}:${p.requestId}`]; if (request) request.error = { status: p.response.status, reasonCode: safeText(body.reasonCode || ''), message: safeText(body.error || '') } } catch {}
        }).catch(() => {})
      }
    } else if (message.method === 'Runtime.consoleAPICalled') {
      record(message.method, { label, level: p.type, args: (p.args || []).map(arg => arg.value ?? arg.description).filter(value => typeof value === 'string' || typeof value === 'number').map(safeText) })
    } else if (message.method === 'Runtime.exceptionThrown') {
      record(message.method, { label, text: safeText(p.exceptionDetails?.text || ''), description: safeText(p.exceptionDetails?.exception?.description || '') })
    } else if (message.method === 'Page.frameNavigated') {
      record(message.method, { label, frameId: p.frame?.id, url: safeText(p.frame?.url || '') })
    }
  })
  await cdp('Page.enable', {}, sessionId)
  await cdp('Runtime.enable', {}, sessionId)
  await cdp('Network.enable', {}, sessionId)
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId)
  await cdp('Page.navigate', { url: clientUrl }, sessionId)
  await waitExpr(sessionId, "Boolean(document.querySelector('.topbar-right select'))", `${label} role selector`)
  await waitExpr(sessionId, "document.querySelector('.status')?.textContent.includes('CONNECTED')", `${label} initial connection`)
  record('browser.ready', { label, role: await evaluate(sessionId, "document.querySelector('.topbar-right select')?.value"), hostUrl: clientHostUrl, webUrl: clientUrl, sessionId, targetId: target.targetId })
  return client
}
const openDetails = async (session, selector, text) => { if (!await evaluate(session, `document.querySelector(${JSON.stringify(selector)})?.open`)) await clickText(session, text, 'summary') }
const waitMap = async (id, token, predicate, label, timeout = 15000) => { const started = Date.now(); while (Date.now() - started < timeout) { const result = await api(`/api/maps/${encodeURIComponent(id)}`, token); if (result.response.ok && predicate(result.body)) return result.body; await delay(120) } throw new Error(`Timed out waiting for host map state: ${label}`) }
const saveDiagnostics = async () => { diagnostics.finishedAt = new Date().toISOString(); diagnostics.processOutput = children.map(({ child, getOutput }) => ({ pid: child.pid, exitCode: child.exitCode, output: safeText(getOutput()) })); diagnosticsPath = join(tmpdir(), `potomac-maps-browser-diagnostics-${process.pid}.json`); await writeFile(diagnosticsPath, JSON.stringify(diagnostics, null, 2), 'utf8') }
const waitChildExit = async (child, timeoutMs = 8000) => { if (child.exitCode !== null || child.signalCode !== null) return; let exitHandler; const exited = new Promise(resolveExit => { exitHandler = () => resolveExit(true); child.once('exit', exitHandler) }); const completed = await Promise.race([exited, delay(timeoutMs).then(() => false)]); if (!completed && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await Promise.race([exited, delay(5000)]) } if (exitHandler) child.removeListener('exit', exitHandler) }
const shutdown = async () => { try { if (socket?.readyState === WebSocket.OPEN) await cdp('Browser.close').catch(() => {}) } catch {} for (const item of [...children].reverse()) if (!item.child.killed && item.child.exitCode === null) item.child.kill('SIGTERM'); await Promise.all(children.map(item => waitChildExit(item.child))); for (const suffix of ['', '-wal', '-shm']) { const target = `${db}${suffix}`; for (let attempt = 0; attempt < 12; attempt += 1) { try { await rm(target, { force: true }); break } catch { await delay(250) } } } await rm(scratch, { recursive: true, force: true, maxRetries: 16, retryDelay: 250 }) }
try {
  hostProcess = launchHost(db); diagnostics.hostPid = hostProcess.pid; diagnostics.hostUrl = hostUrl; await waitFor(`${hostUrl}/health`, 'host')
  const campaign = await api('/api/campaign', gmToken, { method: 'PUT', body: JSON.stringify({ name: 'Flooded Observatory Acceptance', systemModuleId: 'example.system-a', systemModuleVersion: '0.1.0', baseRevision: 1 }) }); assert.equal(campaign.response.status, 200)
  const stateProbe = await api('/api/state', gmToken); diagnostics.probes.state = { status: stateProbe.response.status, campaignId: stateProbe.body?.campaignId, role: stateProbe.body?.role }
  const streamController = new AbortController(); const streamProbe = await fetch(`${hostUrl}/api/stream?since=${stateProbe.body?.revision || 0}`, { headers: { authorization: `Bearer ${gmToken}` }, signal: streamController.signal }); diagnostics.probes.stream = { status: streamProbe.status, contentType: streamProbe.headers.get('content-type') }; const probeReader = streamProbe.body.getReader(); diagnostics.probes.streamFirstChunk = (await probeReader.read()).done === false; streamController.abort(); await probeReader.cancel().catch(() => {})
  start(process.execPath, [join(root, 'clients/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { cwd: join(root, 'clients/web'), env: { ...process.env, VITE_POTOMAC_HOST: hostUrl, VITE_POTOMAC_GM_TOKEN: gmToken, VITE_POTOMAC_PLAYER_TOKEN: `disabled-${process.pid}`, VITE_POTOMAC_SUBSCRIPTION_DIAGNOSTICS: '1' } }); await waitFor(webUrl, 'web client')
  start(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-dev-shm-usage', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(scratch, 'chrome')}`, 'about:blank']); const version = await (await waitFor(`http://127.0.0.1:${debugPort}/json/version`, 'Chrome')).json(); socket = new WebSocket(version.webSocketDebuggerUrl); await new Promise((ok, fail) => { socket.addEventListener('open', ok, { once: true }); socket.addEventListener('error', fail, { once: true }) }); socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id) } })
  const gmClient = await openClient('GM'); gmSession = gmClient.sessionId; const gm = gmSession; const target = { targetId: gmClient.targetId }
  const sample = async page => {
    const state = await evaluate(gm, "({status:document.querySelector('.status')?.textContent,role:document.querySelector('.topbar-right select')?.value,url:location.href})")
    diagnostics.statuses.push({ at: new Date().toISOString(), page, ...state })
    assert.match(state.status || '', /CONNECTED/, `GM connection dropped during ${page}`)
    assert.equal(state.role, 'gm', `GM role changed during ${page}`)
  }
  await waitExpr(gm, "Boolean(document.querySelector('.topbar-right select'))", 'GM role selector')
  await waitExpr(gm, "document.querySelector('.status')?.textContent.includes('CONNECTED')", 'GM connected')
  record('browser.identity', { hostUrl, pageUrl: await evaluate(gm, 'location.href'), role: await evaluate(gm, "document.querySelector('.topbar-right select')?.value"), targetId: target.targetId, sessionId: gmSession, hostPid: hostProcess.pid })
  const healthBefore = await fetch(`${hostUrl}/health`).then(response => response.status)
  for (let second = 0; second < 15; second += 1) { await sample('table'); await delay(1000) }
  diagnostics.hostContinuity = { pid: hostProcess.pid, exitCode: hostProcess.exitCode, healthBefore, healthAfterTable: await fetch(`${hostUrl}/health`).then(response => response.status) }
  await screenshot(gm, 'connection-table-15s.png')
  record('browser.action', { action: 'open-maps', at: new Date().toISOString() })
  await clickText(gm, 'Maps')
  await waitExpr(gm, "document.body.innerText.includes('APPLICATION / MAPS')", 'Maps app')
  for (let second = 0; second < 5; second += 1) { await sample('maps'); await delay(1000) }
  await waitExpr(gm, "document.querySelector('.status')?.textContent.includes('CONNECTED')", 'Maps connected')
  await clickText(gm, 'Create scene', 'summary'); await waitExpr(gm, "Boolean(document.querySelector('.map-create-form'))", 'create form'); await inputText(gm, '.map-create-form input:not([type=file])', 'Ashen Coast'); assert.equal(await evaluate(gm, "document.querySelector('.map-create-form input:not([type=file])').value"), 'Ashen Coast'); await clickText(gm, 'Create on host', '.map-create-form button'); await waitExpr(gm, "document.body.innerText.includes('Ashen Coast')", 'Ashen Coast committed'); await waitExpr(gm, "document.querySelector('.status')?.textContent.includes('CONNECTED')", 'still connected after map creation'); await sample('maps-after-create'); const write = Object.values(diagnostics.requests).find(request => request.method === 'POST' && new URL(request.url).pathname === '/api/maps'); assert.ok(write?.events.some(event => event.type === 'response' && event.status === 200), 'Ashen Coast must be accepted by the disposable host'); assert.ok(Object.values(diagnostics.requests).some(request => new URL(request.url).pathname.startsWith('/api/maps/map-') && request.events.some(event => event.type === 'response' && event.status === 200)), 'Ashen Coast must be read back from the disposable host'); await screenshot(gm, 'stage-1-ashen-coast.png'); record('stage1.map-created', { name: 'Ashen Coast', status: await evaluate(gm, "document.querySelector('.status')?.textContent") }); mark('Stage 1: GM creates Ashen Coast through the React UI and stays connected', 'PASS')
  const enrollPlayer = async displayName => {
    await evaluate(gm, `window.prompt = () => ${JSON.stringify(displayName)}`)
    await clickText(gm, 'Enroll player', '.gm-admin button')
    await waitExpr(gm, "document.querySelector('.gm-admin')?.textContent.includes('One-time credential')", `${displayName} UI enrollment`)
    const codes = await evaluate(gm, "[...document.querySelectorAll('.gm-admin code')].map(item=>item.textContent)")
    assert.equal(codes.length, 2, `${displayName} enrollment shows its member ID and one-time credential`)
    await clickText(gm, 'Hide credential', '.gm-admin button')
    return { memberId: codes[0], credential: codes[1] }
  }
  await clickText(gm, 'GM administration', '.gm-admin summary')
  const playerAIdentity = await enrollPlayer('Flooded Observatory Player A')
  const playerBIdentity = await enrollPlayer('Flooded Observatory Player B')
  assert.notEqual(playerAIdentity.memberId, playerBIdentity.memberId, 'players are independently enrolled')
  const playerA = await openClient('Player A', 1440, 900); const playerB = await openClient('Player B', 1440, 900)
  for (const [client, identity] of [[playerA, playerAIdentity], [playerB, playerBIdentity]]) {
    const session = client.sessionId
    await evaluate(session, `window.prompt = () => ${JSON.stringify(identity.credential)}`)
    await clickText(session, 'Use player credential')
    await waitExpr(session, "document.querySelector('.topbar-right select')?.value === 'player'", `${client.label} independently authenticates`)
    await waitExpr(session, "document.querySelector('.status')?.textContent.includes('CONNECTED')", `${client.label} live connection`)
    record('browser.enrolled-player', { label: client.label, memberId: identity.memberId, role: await evaluate(session, "document.querySelector('.topbar-right select')?.value") })
  }
  const playerAState = await api('/api/state', playerAIdentity.credential); const playerBState = await api('/api/state', playerBIdentity.credential)
  assert.equal(playerAState.response.status, 200); assert.equal(playerBState.response.status, 200)
  assert.notEqual(playerAState.body.memberId, playerBState.body.memberId)
  await screenshot(playerA.sessionId, 'player-a-initial.png'); await screenshot(playerB.sessionId, 'player-b-initial.png')
  mark('Stage 2: two independent player contexts enroll and authenticate through the UI', 'PASS')
  const worldImage = join(scratch, 'ashen-coast.png'); const battleImage = join(scratch, 'flooded-observatory.png')
  await writeFile(worldImage, mapImage('world')); await writeFile(battleImage, mapImage('battle'))
  await waitExpr(gm, "[...document.querySelectorAll('.map-browser button')].some(button=>button.textContent.includes('Ashen Coast'))", 'Ashen Coast map browser entry')
  await clickText(gm, 'Ashen Coast', '.map-browser button')
  await uploadFile(gm, '.map-controls input[type=file]', worldImage)
  await waitExpr(gm, "document.querySelector('.map-notice')?.textContent.includes('Background saved on host')", 'Ashen Coast background upload')
  if (!await evaluate(gm, "document.querySelector('.map-browser details')?.open")) await clickText(gm, 'Create scene', 'summary')
  await waitExpr(gm, "Boolean(document.querySelector('.map-create-form'))", 'Flooded Observatory create form')
  await inputText(gm, '.map-create-form input:not([type=file])', 'Flooded Observatory')
  await selectValue(gm, '.map-create-form select', 'battle')
  assert.equal(await evaluate(gm, "document.querySelector('.map-create-form select')?.value"), 'battle')
  const gridInputSelector = '.map-create-form input[type=number]'
  const gridInputCount = await evaluate(gm, `document.querySelectorAll(${JSON.stringify(gridInputSelector)}).length`)
  assert.equal(gridInputCount, 3, 'Battle Map creation exposes width, height and grid size numeric fields')
  await uploadFile(gm, '.map-create-form input[type=file]', battleImage)
  await clickText(gm, 'Create on host', '.map-create-form button')
  await waitExpr(gm, "[...document.querySelectorAll('.map-browser button strong')].some(item=>item.textContent==='Flooded Observatory')", 'Flooded Observatory committed with UI image upload')
  const createdMaps = (await api('/api/maps', gmToken)).body.maps
  const world = createdMaps.find(scene => scene.name === 'Ashen Coast'); const battle = createdMaps.find(scene => scene.name === 'Flooded Observatory')
  assert.ok(world && battle, 'GM UI-created World and Battle Maps persist on the disposable host')
  assert.equal(world.grid.type, 'none', 'Ashen Coast uses the disabled grid default')
  assert.equal(battle.grid.type, 'square', 'Flooded Observatory uses square grid')
  assert.equal(battle.grid.size, 100, 'Battle Map default cell size is retained')
  assert.ok(world.background && battle.background, 'both UI-created maps reference an uploaded background')
  const worldBytes = await fetch(`${hostUrl}/api/maps/${world.id}/background/content`, { headers: { authorization: `Bearer ${gmToken}` } }).then(response => response.arrayBuffer()).then(bytes => Buffer.from(bytes))
  const battleBytes = await fetch(`${hostUrl}/api/maps/${battle.id}/background/content`, { headers: { authorization: `Bearer ${gmToken}` } }).then(response => response.arrayBuffer()).then(bytes => Buffer.from(bytes))
  assert.deepEqual(worldBytes, await readFile(worldImage), 'World Map image bytes persist exactly after UI upload')
  assert.deepEqual(battleBytes, await readFile(battleImage), 'Battle Map image bytes persist exactly after UI upload')
  assert.equal(diagnostics.events.some(event => event.label === 'GM' && event.type === 'Runtime.consoleAPICalled' && event.args.join(' ').includes('Cannot update a component')), false, 'Maps state updates do not emit React cross-component update warnings')
  await screenshot(gm, 'gm-flooded-observatory-created.png')
  mark('Stage 3: create Ashen Coast and Flooded Observatory in Maps UI, upload both images, verify grid configuration', 'PASS', { worldId: world.id, battleId: battle.id })
  const createLoreViaUi = async (title, visibility) => {
    await clickText(gm, 'Lore', 'nav button')
    await waitExpr(gm, "document.body.innerText.includes('APPLICATION / LORE')", `${title} Lore UI`)
    await clickText(gm, 'New article')
    await waitExpr(gm, "Boolean(document.querySelector('.lore-page .schema-form'))", `${title} editor`)
    await inputText(gm, '.schema-form input[maxlength="160"]', title)
    await selectValue(gm, 'label:has(option[value="shared"]) select', visibility)
    await inputText(gm, '.lore-body textarea', `${title} acceptance text. The map route must not alter the active encounter.`)
    await clickText(gm, 'Save on host', '.schema-form button')
    await waitExpr(gm, `document.body.innerText.includes(${JSON.stringify(title)})`, `${title} article saved by UI`)
    const articles = await api('/api/lore', gmToken)
    const article = articles.body.articles.find(item => item.title === title)
    assert.ok(article, `${title} persisted from the Lore UI`)
    assert.equal(article.visibility, visibility)
    await screenshot(gm, title === 'Sunken Archive' ? 'gm-sunken-archive-lore.png' : 'gm-private-lore.png')
    await clickText(gm, 'Maps', 'nav button')
    await waitExpr(gm, "document.body.innerText.includes('APPLICATION / MAPS')", `${title} returns to Maps`)
    return article
  }
  const sunkenArchive = await createLoreViaUi('Sunken Archive', 'shared')
  const privateLore = await createLoreViaUi('GM-only Tide Ledger', 'gm')
  acceptanceLoreIds.add(sunkenArchive.id); acceptanceLoreIds.add(privateLore.id)
  mark('Stage 3b: GM creates public Sunken Archive and private Lore through the Lore UI', 'PASS', { publicLoreId: sunkenArchive.id })
  const gmActorState = (await api('/api/state', gmToken)).body
  const actorA = gmActorState.actors.find(actor => actor.id === 'actor-emberfall-01')
  assert.ok(actorA, 'System A campaign bootstrap created only its compatible fixture')
  const actorBCreate = await api('/api/actors', gmToken, { method: 'POST', body: JSON.stringify({ id: 'acceptance-observatory-actor', moduleId: 'example.system-a', moduleVersion: '0.1.0', data: { name: 'Tarin Vale', epithet: 'Observatory scout', attributes: { strength: 11, intelligence: 13 }, resources: { hp: { current: 18, maximum: 18 }, mana: { current: 2, maximum: 2 } } } }) })
  assert.equal(actorBCreate.response.status, 201, 'second compatible System A token fixture is committed')
  const actorB = actorBCreate.body
  for (const identity of [playerAIdentity, playerBIdentity]) for (const actorId of [actorA.id, actorB.id]) {
    const grant = await api(`/api/actors/${encodeURIComponent(actorId)}/grants`, gmToken, { method: 'POST', body: JSON.stringify({ memberId: identity.memberId, permissions: ['read', 'act'] }) })
    assert.equal(grant.response.status, 201, 'GM grants each player their own actor read permission')
  }
  const coastEncounter = await api('/api/encounters', gmToken, { method: 'POST', body: JSON.stringify({ id: 'acceptance-coast-encounter', name: 'Coast Watch', summary: 'The coast road above the observatory.' }) })
  const observatoryEncounter = await api('/api/encounters', gmToken, { method: 'POST', body: JSON.stringify({ id: 'acceptance-observatory-encounter', name: 'Flooded Observatory', summary: 'The lower chamber is filling with seawater.' }) })
  assert.equal(coastEncounter.response.status, 201); assert.equal(observatoryEncounter.response.status, 201)
  const addPiece = async ({ scene, kind, actorId, label, visible }) => {
    await openDetails(gm, '.map-piece-list details', 'Add actor token')
    if (actorId) await waitExpr(gm, `[...document.querySelectorAll('.map-add-piece select[name=actorId] option')].some(option=>option.value===${JSON.stringify(actorId)})`, `${actorId} actor option loaded for UI token placement`)
    await selectValue(gm, '.map-add-piece select[name=actorId]', actorId || '')
    if (label) await inputText(gm, '.map-add-piece input[name=label]', label)
    await clickText(gm, 'Add at center', '.map-add-piece button')
    const predicate = map => map.pieces?.some(piece => piece.kind === kind && (kind === 'actor' ? piece.actorId === actorId : piece.label === label))
    const current = await waitMap(scene.id, gmToken, predicate, `${label || actorId} scene piece`)
    const piece = current.pieces.find(item => kind === 'actor' ? item.actorId === actorId : item.label === label)
    await waitExpr(gm, `document.querySelector('.map-revision')?.textContent===${JSON.stringify(`Host revision ${current.revision}`)} && document.querySelector('.map-notice')?.textContent.includes('Saved on host.')`, `${label || actorId} UI refresh catches up to committed revision ${current.revision}`)
    if (visible) {
      const displayLabel = label || (actorId === actorA.id ? 'Mira Vell' : 'Tarin Vale')
      await waitExpr(gm, `[...document.querySelectorAll('.map-piece-row')].some(row=>row.textContent.includes(${JSON.stringify(displayLabel)}))`, `${displayLabel} piece row rendered after host commit`)
      const changed = await evaluate(gm, `(() => { const row=[...document.querySelectorAll('.map-piece-row')].find(item=>item.textContent.includes(${JSON.stringify(displayLabel)})); const check=row?.querySelector('input[type=checkbox]'); if(!check) throw new Error('shared checkbox not rendered for map piece'); if(!check.checked) check.click(); return true })()`)
      assert.equal(changed, true)
      const shared = await waitMap(scene.id, gmToken, map => map.pieces?.some(item => item.id === piece.id && item.visible), `${label || actorId} shared visibility`)
      await waitExpr(gm, `document.querySelector('.map-revision')?.textContent===${JSON.stringify(`Host revision ${shared.revision}`)} && document.querySelector('.map-notice')?.textContent.includes('Saved on host.')`, `${label || actorId} sharing UI refresh catches up to revision ${shared.revision}`)
    }
    return piece.id
  }
  await clickText(gm, 'Flooded Observatory', '.map-browser button')
  const tokenA = await addPiece({ scene: battle, kind: 'actor', actorId: actorA.id, visible: true })
  const tokenB = await addPiece({ scene: battle, kind: 'actor', actorId: actorB.id, visible: true })
  const privatePin = await addPiece({ scene: battle, kind: 'pin', label: 'GM-private pressure valve', visible: false })
  await clickText(gm, 'Ashen Coast', '.map-browser button')
  const linkPin = await addPiece({ scene: world, kind: 'pin', label: 'Observatory trail marker', visible: true })
  await selectValue(gm, `select[aria-label="Destination for Observatory trail marker"]`, battle.id)
  await inputText(gm, '.map-links input[aria-label="Link label"]', 'Go to Flooded Observatory')
  await clickText(gm, 'Save link', '.map-links button')
  const linkedWorld = await waitMap(world.id, gmToken, map => map.pieces?.some(piece => piece.id === linkPin && piece.destination?.sceneId === battle.id && piece.destination?.label === 'Go to Flooded Observatory'), 'World-to-Battle link')
  await waitExpr(gm, `document.querySelector('.map-revision')?.textContent===${JSON.stringify(`Host revision ${linkedWorld.revision}`)} && document.querySelector('.map-notice')?.textContent.includes('Saved on host.')`, 'World map link UI refresh')
  const lorePin = await addPiece({ scene: world, kind: 'pin', label: 'Western cove marker', visible: true })
  acceptancePinIds.add(lorePin)
  await waitExpr(gm, "Boolean([...document.querySelectorAll('.map-lore-link button')].find(button=>button.textContent.includes('Save Lore link')&&!button.disabled))", 'Lore destination control ready after the location pin commit')
  await selectValue(gm, 'select[aria-label="Lore destination for Western cove marker"]', sunkenArchive.id)
  await inputText(gm, 'input[aria-label="Lore link label for Western cove marker"]', 'Read the recovered journal')
  assert.equal(await evaluate(gm, `document.querySelector('.map-lore-link select[aria-label="Lore destination for Western cove marker"]')?.value`), sunkenArchive.id, 'Maps UI has the intended authorized Lore target selected')
  assert.equal((await api(`/api/lore/${sunkenArchive.id}`, gmToken)).response.status, 200, 'GM can currently read the Lore target selected in Maps UI')
  assert.ok((await api(`/api/maps/${world.id}`, gmToken)).body.pieces.some(piece => piece.id === lorePin && piece.kind === 'pin'), 'Lore target pin exists on the current World Map revision')
  await clickText(gm, 'Save Lore link', 'form.map-lore-link:has(select[aria-label="Lore destination for Western cove marker"]) button')
  await waitExpr(gm, "Boolean(document.querySelector('.map-error')) || document.querySelector('.map-notice')?.textContent.includes('Saved on host.')", 'Lore pin destination command result')
  const loreLinkUiError = await evaluate(gm, "document.querySelector('.map-error')?.textContent || ''")
  if (loreLinkUiError) throw new Error(`Maps UI rejected Lore destination: ${loreLinkUiError}`)
  const linkedLoreWorld = await waitMap(world.id, gmToken, map => map.pieces?.some(piece => piece.id === lorePin && piece.destination?.kind === 'lore_entry' && piece.destination.entryId === sunkenArchive.id && piece.destination.title === 'Sunken Archive'), 'authorized World-to-Lore pin')
  assert.equal(linkedLoreWorld.pieces.find(piece => piece.id === lorePin).destination.label, 'Read the recovered journal')
  const privateLorePin = await addPiece({ scene: world, kind: 'pin', label: 'Unshared ledger marker', visible: true })
  acceptancePinIds.add(privateLorePin)
  await selectValue(gm, 'select[aria-label="Lore destination for Unshared ledger marker"]', privateLore.id)
  await waitExpr(gm, "Boolean([...document.querySelectorAll('.map-lore-link button')].find(button=>button.textContent.includes('Save Lore link')&&!button.disabled))", 'Lore destination control ready for private target')
  await clickText(gm, 'Save Lore link', 'form.map-lore-link:has(select[aria-label="Lore destination for Unshared ledger marker"]) button')
  const linkedPrivateLore = await waitMap(world.id, gmToken, map => map.pieces?.some(piece => piece.id === privateLorePin && piece.destination?.kind === 'lore_entry' && piece.destination.entryId === privateLore.id), 'GM-only Lore pin')
  assert.ok(linkedPrivateLore.pieces.find(piece => piece.id === privateLorePin).destination)
  const associate = async (scene, encounterId, expectedName) => {
    // Re-enter Maps through the UI so the revision used by the command comes from a fresh host read.
    await clickText(gm, 'Table', 'nav[aria-label="Applications"] button')
    await clickText(gm, 'Maps', 'nav[aria-label="Applications"] button')
    await clickText(gm, scene.name, '.map-browser button')
    const latest = await api(`/api/maps/${scene.id}`, gmToken)
    assert.equal(latest.response.status, 200)
    await waitExpr(gm, `document.querySelector('.map-toolbar strong')?.textContent===${JSON.stringify(scene.name)} && document.querySelector('.map-revision')?.textContent===${JSON.stringify(`Host revision ${latest.body.revision}`)}`, `${scene.name} fresh UI revision before encounter association`)
    await selectValue(gm, 'select[aria-label="Associated encounter"]', encounterId)
    await waitMap(scene.id, gmToken, map => map.encounterId === encounterId, `${scene.name} encounter association`)
    assert.equal((await api('/api/maps', gmToken)).body.maps.find(map => map.id === scene.id).name, expectedName)
  }
  await associate(world, 'acceptance-coast-encounter', 'Ashen Coast')
  await associate(battle, 'acceptance-observatory-encounter', 'Flooded Observatory')
  await clickText(gm, 'Table', 'nav[aria-label="Applications"] button')
  await selectValue(gm, '#encounter-select', 'acceptance-observatory-encounter')
  await clickText(gm, 'Set active', '.context-control button')
  await waitExpr(gm, "document.querySelector('.session-strip:not([aria-label=\\\"Table workflow\\\"]) strong')?.textContent==='Flooded Observatory'", 'active Observatory encounter set through the Table UI')
  const activeEncounterBeforeNavigation = (await api('/api/state', gmToken)).body.context.activeEncounter
  assert.equal(activeEncounterBeforeNavigation, 'acceptance-observatory-encounter')
  const putGmNote = async scene => {
    const current = await api(`/api/maps/${scene.id}`, gmToken)
    const result = await api(`/api/maps/${scene.id}/commands`, gmToken, { method: 'POST', body: JSON.stringify({ operationId: `private-note-${scene.id}`, baseRevision: current.body.revision, command: 'update', gmNotes: `PRIVATE GM NOTES ${scene.name}` }) })
    assert.equal(result.response.status, 200)
  }
  await putGmNote(world); await putGmNote(battle)
  const prePublishA = await api('/api/maps', playerAIdentity.credential); const prePublishB = await api('/api/maps', playerBIdentity.credential)
  assert.equal(prePublishA.body.maps.length, 0); assert.equal(prePublishB.body.maps.length, 0)
  for (const identity of [playerAIdentity, playerBIdentity]) for (const scene of [world, battle]) {
    assert.equal((await api(`/api/maps/${scene.id}`, identity.credential)).response.status, 404, 'unpublished map IDs are not enumerable')
    assert.equal((await api(`/api/maps/${scene.id}/background/content`, identity.credential)).response.status, 404, 'unpublished image bytes are inaccessible')
  }
  for (const identity of [playerAIdentity, playerBIdentity]) {
    const state = await api('/api/state?since=0', identity.credential)
    assert.equal(state.response.status, 200)
    assert.ok(!JSON.stringify(state.body).includes('PRIVATE GM NOTES'), 'SSE replay/snapshot omits GM-only map metadata')
  }
  for (const identity of [playerAIdentity, playerBIdentity]) {
    const controller = new AbortController()
    const response = await fetch(`${hostUrl}/api/stream?since=0`, { headers: { authorization: `Bearer ${identity.credential}` }, signal: controller.signal })
    assert.equal(response.status, 200, 'independently enrolled player receives the SSE replay transport')
    assert.match(response.headers.get('content-type') || '', /text\/event-stream/)
    const reader = response.body.getReader()
    const result = await Promise.race([reader.read(), delay(2000).then(() => ({ timedOut: true }))])
    assert.ok(!result.timedOut && !result.done, 'SSE replay emits a first authorized event chunk')
    const replayChunk = new TextDecoder().decode(result.value)
    controller.abort(); await reader.cancel().catch(() => {})
    assert.ok(!replayChunk.includes('PRIVATE GM NOTES') && !replayChunk.includes('GM-private pressure valve') && !replayChunk.includes(privatePin) && !replayChunk.includes(privateLore.id) && !replayChunk.includes('GM-only Tide Ledger'), 'player SSE replay chunk excludes private pins and inaccessible Lore destination IDs/titles')
  }
  const selectFreshMapForMutation = async scene => {
    await clickText(gm, 'Table', 'nav[aria-label="Applications"] button')
    await clickText(gm, 'Maps', 'nav[aria-label="Applications"] button')
    await clickText(gm, scene.name, '.map-browser button')
    const latest = await api(`/api/maps/${scene.id}`, gmToken)
    assert.equal(latest.response.status, 200)
    await waitExpr(gm, `document.querySelector('.map-toolbar strong')?.textContent===${JSON.stringify(scene.name)} && document.querySelector('.map-revision')?.textContent===${JSON.stringify(`Host revision ${latest.body.revision}`)}`, `${scene.name} fresh UI revision before publication`)
  }
  await selectFreshMapForMutation(world)
  await clickText(gm, 'Ashen Coast', '.map-browser button')
  // A scene button click schedules React state work: wait for the chosen scene
  // and its enabled mutation control before clicking Publish.
  await waitExpr(gm, "document.querySelector('.map-toolbar strong')?.textContent==='Ashen Coast' && [...document.querySelectorAll('.map-toolbar button')].some(button=>button.textContent==='Publish to players'&&!button.disabled)", 'Ashen Coast selected and publish control ready')
  await clickText(gm, 'Publish to players', '.map-toolbar button')
  const publishedWorldByHost = await waitMap(world.id, gmToken, map => map.visibility === 'shared', 'Ashen Coast publication')
  await waitExpr(gm, `document.querySelector('.map-toolbar strong')?.textContent==='Ashen Coast' && document.querySelector('.map-toolbar button')?.textContent==='Revoke from players' && document.querySelector('.map-revision')?.textContent===${JSON.stringify(`Host revision ${publishedWorldByHost.revision}`)}`, 'Ashen Coast publication reflected in GM UI')
  await selectFreshMapForMutation(battle)
  await waitExpr(gm, "document.querySelector('.map-toolbar strong')?.textContent==='Flooded Observatory' && [...document.querySelectorAll('.map-toolbar button')].some(button=>button.textContent==='Publish to players'&&!button.disabled)", 'Flooded Observatory selected and publish control ready')
  await clickText(gm, 'Publish to players', '.map-toolbar button')
  const publishedBattleByHost = await waitMap(battle.id, gmToken, map => map.visibility === 'shared', 'Flooded Observatory publication')
  await waitExpr(gm, `document.querySelector('.map-toolbar strong')?.textContent==='Flooded Observatory' && document.querySelector('.map-toolbar button')?.textContent==='Revoke from players' && document.querySelector('.map-revision')?.textContent===${JSON.stringify(`Host revision ${publishedBattleByHost.revision}`)}`, 'Flooded Observatory publication reflected in GM UI')
  for (const [client, identity] of [[playerA, playerAIdentity], [playerB, playerBIdentity]]) {
    await clickText(client.sessionId, 'Maps', 'nav[aria-label="Applications"] button')
    await waitExpr(client.sessionId, "[...document.querySelectorAll('.map-browser button strong')].some(item=>item.textContent==='Ashen Coast') && [...document.querySelectorAll('.map-browser button strong')].some(item=>item.textContent==='Flooded Observatory')", `${client.label} sees the two published maps`)
    const publishedWorld = await api(`/api/maps/${world.id}`, identity.credential)
    const publishedBattle = await api(`/api/maps/${battle.id}`, identity.credential)
    assert.equal(publishedWorld.response.status, 200); assert.equal(publishedBattle.response.status, 200)
    assert.ok(!JSON.stringify(publishedWorld.body).includes('PRIVATE GM NOTES'))
    assert.ok(!JSON.stringify(publishedBattle.body).includes('PRIVATE GM NOTES'))
    assert.ok(!publishedBattle.body.pieces.some(piece => piece.id === privatePin), 'player map projection omits private pins by ID')
    const publicLoreDestination = publishedWorld.body.pieces.find(piece => piece.id === lorePin)?.destination
    assert.deepEqual(publicLoreDestination && { kind: publicLoreDestination.kind, entryId: publicLoreDestination.entryId, title: publicLoreDestination.title }, { kind: 'lore_entry', entryId: sunkenArchive.id, title: 'Sunken Archive' }, 'authorized Lore destination is resolved on the host')
    const privateDestinationPiece = publishedWorld.body.pieces.find(piece => piece.id === privateLorePin)
    assert.ok(privateDestinationPiece && !privateDestinationPiece.destination, 'shared location pin omits a private Lore destination rather than exposing a placeholder')
    assert.ok(!JSON.stringify(publishedWorld.body).includes(privateLore.id) && !JSON.stringify(publishedWorld.body).includes('GM-only Tide Ledger'), 'player HTTP map projection excludes inaccessible Lore ID and title')
    assert.equal((await api(`/api/lore/${privateLore.id}`, identity.credential)).response.status, 404, 'direct private Lore IDs are unavailable to players')
    assert.deepEqual(publishedBattle.body.pieces.filter(piece => piece.kind === 'actor').map(piece => piece.id).sort(), [tokenA, tokenB].sort(), 'both granted actor tokens are visible to players')
    const replay = await api('/api/state?since=0', identity.credential)
    assert.ok(!JSON.stringify(replay.body).includes('PRIVATE GM NOTES') && !JSON.stringify(replay.body).includes(privateLore.id) && !JSON.stringify(replay.body).includes('GM-only Tide Ledger'), 'player replay omits GM-only metadata and private Lore destination details')
    assert.equal((await fetch(`${hostUrl}/api/maps/${world.id}/background/content`, { headers: { authorization: `Bearer ${identity.credential}` } })).status, 200, 'published image is authorized')
    assert.ok(publishedWorld.body.pieces.some(piece => piece.id === linkPin && piece.visible), 'public map projection includes the shared navigation pin')
  }
  for (const client of [playerA, playerB]) assert.ok(!await evaluate(client.sessionId, "document.body.innerText.includes('GM-private pressure valve') || document.body.innerText.includes('PRIVATE GM NOTES') || document.body.innerText.includes('GM-only Tide Ledger')"), `${client.label} rendered DOM omits private pin, GM notes and private Lore metadata`)
  // Exercise change and remove only after both player projections proved that
  // a visible pin does not disclose its private Lore target.
  await clickText(gm, 'Maps', 'nav[aria-label="Applications"] button')
  await clickText(gm, 'Ashen Coast', '.map-browser button')
  await waitExpr(gm, "document.querySelector('.map-toolbar strong')?.textContent==='Ashen Coast'", 'GM returns to Ashen Coast to edit Lore target')
  await selectValue(gm, 'select[aria-label="Lore destination for Unshared ledger marker"]', sunkenArchive.id)
  await waitExpr(gm, "Boolean([...document.querySelectorAll('.map-lore-link button')].find(button=>button.textContent.includes('Save Lore link')&&!button.disabled))", 'Lore destination control ready for change')
  await clickText(gm, 'Save Lore link', 'form.map-lore-link:has(select[aria-label="Lore destination for Unshared ledger marker"]) button')
  await waitMap(world.id, gmToken, map => map.pieces?.some(piece => piece.id === privateLorePin && piece.destination?.kind === 'lore_entry' && piece.destination.entryId === sunkenArchive.id), 'GM changes pin Lore destination')
  await waitExpr(gm, "Boolean([...document.querySelectorAll('form.map-lore-link:has(select[aria-label=\"Lore destination for Unshared ledger marker\"]) button')].find(button=>button.textContent.includes('Remove Lore link')&&!button.disabled))", 'changed Lore destination is visible in Maps UI')
  await clickText(gm, 'Remove Lore link', 'form.map-lore-link:has(select[aria-label="Lore destination for Unshared ledger marker"]) button')
  const editedPrivateLink = await waitMap(world.id, gmToken, map => map.pieces?.some(piece => piece.id === privateLorePin && !piece.destination), 'GM removes Lore destination')
  assert.ok(editedPrivateLink.pieces.some(piece => piece.id === privateLorePin), 'removing a link preserves the location pin')
  for (const client of [playerA, playerB]) {
    const session = client.sessionId
    await clickText(session, 'Ashen Coast', '.map-browser button')
    await waitExpr(session, "document.querySelector('.map-toolbar strong')?.textContent==='Ashen Coast'", `${client.label} Ashen Coast becomes the active Maps view`)
    const mapPieceLabels = await evaluate(session, "[...document.querySelectorAll('.map-piece-row')].map(row=>row.querySelector('strong')?.textContent || '')")
    diagnostics.probes[`${client.label}-world-piece-labels`] = mapPieceLabels
    await waitExpr(session, "[...document.querySelectorAll('.map-piece-row')].some(row=>row.textContent.includes('Observatory trail marker'))", `${client.label} visible World pin`)
    await clickText(session, 'Go to Flooded Observatory', '.map-piece-row button')
    await waitExpr(session, "document.querySelector('.map-toolbar strong')?.textContent==='Flooded Observatory'", `${client.label} World-to-Battle navigation`)
    await clickText(session, 'Back to previous map', '.map-toolbar button')
    await waitExpr(session, "document.querySelector('.map-toolbar strong')?.textContent==='Ashen Coast'", `${client.label} Battle-to-World back navigation`)
    await waitExpr(session, "[...document.querySelectorAll('.map-piece-row button')].some(button=>button.textContent.includes('Open Sunken Archive'))", `${client.label} authorized Lore destination is rendered on the location pin`)
    await clickText(session, 'Open Sunken Archive', '.map-piece-row button')
    await waitExpr(session, "document.querySelector('.lore-page h2')?.textContent==='Sunken Archive' && document.body.innerText.includes('map route must not alter')", `${client.label} Map-to-Lore navigation opens authorized article`)
    assert.equal((await api('/api/state', gmToken)).body.context.activeEncounter, activeEncounterBeforeNavigation, 'Map → Lore navigation leaves session.activeEncounter unchanged')
    await clickText(session, 'Back to map', '.lore-page .page-intro button')
    await waitExpr(session, "document.querySelector('.map-toolbar strong')?.textContent==='Ashen Coast'", `${client.label} Lore-to-origin-Map back navigation`)
    assert.equal((await api('/api/state', gmToken)).body.context.activeEncounter, activeEncounterBeforeNavigation, 'Lore → Map back navigation leaves session.activeEncounter unchanged')
    assert.equal((await api('/api/state', gmToken)).body.context.activeEncounter, activeEncounterBeforeNavigation, 'map navigation does not change the active encounter')
  }
  await screenshot(playerA.sessionId, 'player-a-ashen-coast-published.png'); await screenshot(playerB.sessionId, 'player-b-ashen-coast-published.png'); await screenshot(gm, 'gm-battle-private-pin.png')
  mark('Stage 4: tokens, private pin, encounter relations, publication, player privacy and cross-map navigation', 'PASS', { linkPin, privatePin, tokenA, tokenB })
  await clickText(gm, 'Dashboard', 'nav[aria-label="Applications"] button')
  await clickText(gm, 'Edit layout')
  await clickText(gm, '+ Add brick', '.toolbar-actions button')
  await clickText(gm, 'Map Scene', '.brick-picker button')
  await waitExpr(gm, "[...document.querySelectorAll('.brick-head strong')].filter(item=>item.textContent==='Map Scene').length===1", 'first Workspace Map Scene brick')
  await clickText(gm, '+ Add brick', '.toolbar-actions button')
  await clickText(gm, 'Map Scene', '.brick-picker button')
  await waitExpr(gm, "[...document.querySelectorAll('.brick-head strong')].filter(item=>item.textContent==='Map Scene').length===2", 'second Workspace Map Scene brick')
  await evaluate(gm, `(() => { const brick=[...document.querySelectorAll('.brick')].find(item=>item.querySelector('.brick-head strong')?.textContent==='Map Scene'); const select=brick?.querySelector('.brick-edit select'); if(!select) throw new Error('Map Scene binding editor is absent'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'pinned'); select.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
  await waitExpr(gm, "[...document.querySelectorAll('.brick-head')].some(item=>item.textContent.includes('Map Scene')&&item.textContent.includes('Pinned'))", 'Workspace pinned binding editor')
  await evaluate(gm, `(() => { const brick=[...document.querySelectorAll('.brick')].find(item=>item.querySelector('.brick-head strong')?.textContent==='Map Scene'&&item.querySelector('.brick-head')?.textContent.includes('Pinned')); const entity=brick?.querySelectorAll('.brick-edit select')[1]; if(!entity) throw new Error('pinned map entity selector is absent'); const option=[...entity.options].find(item=>item.textContent==='Ashen Coast'); if(entity.value!==${JSON.stringify(world.id)}) { if(!option) throw new Error('Ashen Coast is missing from pinned map choices'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(entity,option.value); entity.dispatchEvent(new Event('change',{bubbles:true})) } return true })()`)
  await waitExpr(gm, "[...document.querySelectorAll('.map-brick button')].some(item=>item.textContent==='Open Maps app · Ashen Coast') && [...document.querySelectorAll('.map-brick button')].some(item=>item.textContent==='Open Maps app · Flooded Observatory')", 'Workspace pinned Ashen Coast and follows active Observatory map')
  await clickText(gm, 'Table', 'nav[aria-label="Applications"] button')
  await selectValue(gm, '#encounter-select', 'acceptance-coast-encounter')
  await clickText(gm, 'Set active', '.context-control button')
  await waitExpr(gm, "document.querySelector('.session-strip:not([aria-label=\\\"Table workflow\\\"]) strong')?.textContent==='Coast Watch'", 'switch active encounter to Coast Watch')
  await clickText(gm, 'Dashboard', 'nav[aria-label="Applications"] button')
  await waitExpr(gm, "[...document.querySelectorAll('.map-brick button')].filter(item=>item.textContent==='Open Maps app · Ashen Coast').length===2", 'pinned stays Ashen Coast while following brick changes to Ashen Coast')
  await screenshot(gm, 'gm-workspace-pinned-following-maps.png')
  await clickText(gm, 'Table', 'nav[aria-label="Applications"] button')
  await selectValue(gm, '#encounter-select', 'acceptance-observatory-encounter')
  await clickText(gm, 'Set active', '.context-control button')
  await waitExpr(gm, "document.querySelector('.session-strip:not([aria-label=\\\"Table workflow\\\"]) strong')?.textContent==='Flooded Observatory'", 'restore Observatory active encounter')
  mark('Stage 5: Workspace pinned and encounter-following Map Scene bricks update independently', 'PASS')
  for (const client of [playerA, playerB]) {
    await clickText(client.sessionId, 'Maps', 'nav[aria-label="Applications"] button')
    await clickText(client.sessionId, 'Ashen Coast', '.map-browser button')
    await waitExpr(client.sessionId, "document.querySelector('.map-canvas image.map-background')?.href.baseVal.startsWith('blob:')", `${client.label} authorized World image rendered as cached object URL`)
  }
  await screenshot(playerA.sessionId, 'player-a-before-offline-cache.png')
  await cdp('Fetch.enable', { patterns: [{ urlPattern: `${hostUrl}/*`, requestStage: 'Request' }] }, playerA.sessionId)
  await cdp('Page.reload', { ignoreCache: false }, playerA.sessionId)
  await waitExpr(playerA.sessionId, "document.readyState==='complete' && Boolean(document.querySelector('nav[aria-label=\\\"Applications\\\"]'))", 'Player A browser reload succeeds offline')
  await waitExpr(playerA.sessionId, "document.querySelector('.status')?.textContent.includes('OFFLINE') || document.querySelector('.status')?.textContent.includes('DISCONNECTED')", 'Player A loses host connection and remains explicitly offline after reload')
  await clickText(playerA.sessionId, 'Maps', 'nav[aria-label="Applications"] button')
  await waitExpr(playerA.sessionId, "document.querySelector('.map-cache-state') && [...document.querySelectorAll('.map-browser button strong')].some(item=>item.textContent==='Flooded Observatory')", 'cached authorized maps available offline after reload')
  await clickText(playerA.sessionId, 'Ashen Coast', '.map-browser button')
  await waitExpr(playerA.sessionId, "document.querySelector('.map-canvas image.map-background')?.href.baseVal.startsWith('blob:')", 'cached World image rendered offline after reload')
  assert.ok(!await evaluate(playerA.sessionId, "document.body.innerText.includes('GM-only Tide Ledger')"), 'offline map cache contains no private Lore title')
  assert.ok(await evaluate(playerA.sessionId, "[...document.querySelectorAll('.map-piece-row button')].some(button=>button.textContent.includes('Open Sunken Archive'))"), 'previously authorized Lore destination survives in scoped offline map cache')
  await clickText(playerA.sessionId, 'Open Sunken Archive', '.map-piece-row button')
  await waitExpr(playerA.sessionId, "document.querySelector('.lore-page h2')?.textContent==='Sunken Archive' && document.body.innerText.includes('Host disconnected')", 'previously authorized Lore article opens from scoped offline cache as stale read-only content')
  await clickText(playerA.sessionId, 'Back to map', '.lore-page .page-intro button')
  await waitExpr(playerA.sessionId, "document.querySelector('.map-toolbar strong')?.textContent==='Ashen Coast'", 'offline Lore returns to originating World Map')
  await clickText(playerA.sessionId, 'Go to Flooded Observatory', '.map-piece-row button')
  await waitExpr(playerA.sessionId, "document.querySelector('.map-toolbar strong')?.textContent==='Flooded Observatory' && document.querySelector('.map-canvas image.map-background')?.href.baseVal.startsWith('blob:')", 'offline cached cross-map navigation and image')
  await screenshot(playerA.sessionId, 'player-a-offline-cached-observatory.png')
  await clickText(gm, 'Maps', 'nav[aria-label="Applications"] button')
  await clickText(gm, 'Flooded Observatory', '.map-browser button')
  await clickText(gm, 'Revoke from players', '.map-toolbar button')
  const revokedBattle = await waitMap(battle.id, gmToken, map => map.visibility === 'gm', 'Flooded Observatory revocation')
  await waitExpr(gm, `document.querySelector('.map-toolbar button')?.textContent==='Publish to players' && document.querySelector('.map-revision')?.textContent===${JSON.stringify(`Host revision ${revokedBattle.revision}`)}`, 'GM UI reflects battle map revocation')
  await waitExpr(playerB.sessionId, "![...document.querySelectorAll('.map-browser button strong')].some(item=>item.textContent==='Flooded Observatory')", 'connected Player B loses revoked map from rendered list')
  assert.equal((await api(`/api/maps/${battle.id}`, playerBIdentity.credential)).response.status, 404, 'Player B direct map ID access is revoked')
  assert.equal((await fetch(`${hostUrl}/api/maps/${battle.id}/background/content`, { headers: { authorization: `Bearer ${playerBIdentity.credential}` } })).status, 404, 'Player B image authorization is revoked')
  await clickText(playerA.sessionId, 'Ashen Coast', '.map-browser button')
  await clickText(playerA.sessionId, 'Go to Flooded Observatory', '.map-piece-row button')
  await waitExpr(playerA.sessionId, "document.querySelector('.map-toolbar strong')?.textContent==='Flooded Observatory' && document.querySelector('.map-canvas image.map-background')?.href.baseVal.startsWith('blob:')", 'previously downloaded image remains in Player A offline cache after revocation')
  await cdp('Fetch.disable', {}, playerA.sessionId)
  await waitExpr(playerA.sessionId, "document.querySelector('.status')?.textContent.includes('CONNECTED')", 'Player A reconnects and authorization refresh completes')
  await waitExpr(playerA.sessionId, "![...document.querySelectorAll('.map-browser button strong')].some(item=>item.textContent==='Flooded Observatory')", 'Player A loses revoked map after reconnection refresh')
  assert.equal((await api(`/api/maps/${battle.id}`, playerAIdentity.credential)).response.status, 404, 'reconnected Player A direct map ID access is revoked')
  assert.equal((await fetch(`${hostUrl}/api/maps/${battle.id}/background/content`, { headers: { authorization: `Bearer ${playerAIdentity.credential}` } })).status, 404, 'reconnected Player A image authorization is revoked')
  await screenshot(playerA.sessionId, 'player-a-after-revocation-reconnect.png')
  mark('Stage 6: real browser offline reload, authorized image cache, reconnection, revocation and refreshed access', 'PASS')
  await stopHost()
  diagnostics.hostRestarts = [{ at: new Date().toISOString(), pid: hostProcess.pid, exitCode: hostProcess.exitCode, database: 'disposable System A database' }]
  hostProcess = launchHost(db)
  await waitFor(`${hostUrl}/health`, 'restarted original host')
  await waitExpr(gm, "document.querySelector('.status')?.textContent.includes('CONNECTED')", 'GM stream reconnects after graceful host restart')
  const persistedMaps = (await api('/api/maps', gmToken)).body.maps
  assert.equal(persistedMaps.find(map => map.id === world.id)?.visibility, 'shared', 'World Map publication persists after host restart')
  assert.equal(persistedMaps.find(map => map.id === battle.id)?.visibility, 'gm', 'Battle Map revocation persists after host restart')
  const persistedWorld = await api(`/api/maps/${world.id}`, gmToken); const persistedBattle = await api(`/api/maps/${battle.id}`, gmToken)
  assert.ok(persistedWorld.body.pieces.some(piece => piece.id === linkPin && piece.destination?.sceneId === battle.id), 'World pin and cross-map link persist after host restart')
  assert.deepEqual(persistedWorld.body.pieces.find(piece => piece.id === lorePin)?.destination, { kind: 'lore_entry', entryId: sunkenArchive.id, title: 'Sunken Archive', label: 'Read the recovered journal' }, 'authorized Lore destination persists after host restart')
  assert.ok(persistedWorld.body.pieces.some(piece => piece.id === privateLorePin && !piece.destination), 'removed private-pin destination remains removed after host restart')
  assert.ok(persistedBattle.body.pieces.some(piece => piece.id === tokenA && piece.visible) && persistedBattle.body.pieces.some(piece => piece.id === tokenB && piece.visible), 'Battle actor tokens and sharing persist after host restart')
  assert.ok(persistedBattle.body.pieces.some(piece => piece.id === privatePin && !piece.visible), 'GM-private Battle pin persists after host restart')
  assert.equal(persistedWorld.body.encounterId, 'acceptance-coast-encounter'); assert.equal(persistedBattle.body.encounterId, 'acceptance-observatory-encounter')
  const persistedWorldBytes = await fetch(`${hostUrl}/api/maps/${world.id}/background/content`, { headers: { authorization: `Bearer ${gmToken}` } }).then(response => response.arrayBuffer()).then(bytes => Buffer.from(bytes))
  const persistedBattleBytes = await fetch(`${hostUrl}/api/maps/${battle.id}/background/content`, { headers: { authorization: `Bearer ${gmToken}` } }).then(response => response.arrayBuffer()).then(bytes => Buffer.from(bytes))
  assert.deepEqual(persistedWorldBytes, await readFile(worldImage)); assert.deepEqual(persistedBattleBytes, await readFile(battleImage))
  for (const identity of [playerAIdentity, playerBIdentity]) {
    assert.equal((await api(`/api/maps/${world.id}`, identity.credential)).response.status, 200, 'World authorization survives restart')
    assert.equal((await api(`/api/maps/${battle.id}`, identity.credential)).response.status, 404, 'revoked Battle authorization survives restart')
  }
  mark('Stage 7: graceful host restart preserves map content, links, tokens, encounters, images and grants', 'PASS')
  await stopHost()
  const backupPath = join(scratch, 'flooded-observatory-v5.json'); const restoredDb = join(scratch, 'restored-host.sqlite')
  const backupManifest = exportCampaignBackup(db, backupPath)
  assert.equal(backupManifest.potomacDataVersion, 5, 'exported archive is v5')
  restoreCampaignBackup(backupPath, restoredDb)
  const restoredSql = new DatabaseSync(restoredDb, { readOnly: true })
  const restoredCounts = Object.fromEntries(['map_scenes', 'map_pieces', 'map_links', 'map_lore_links', 'map_encounter_scenes', 'map_assets'].map(table => [table, restoredSql.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]))
  assert.equal(restoredCounts.map_scenes, 2); assert.equal(restoredCounts.map_pieces, 6); assert.equal(restoredCounts.map_links, 1); assert.equal(restoredCounts.map_lore_links, 1); assert.equal(restoredCounts.map_encounter_scenes, 2); assert.equal(restoredCounts.map_assets, 2)
  const assetRows = restoredSql.prepare('SELECT sha256 FROM map_assets ORDER BY sha256').all(); restoredSql.close()
  const restoredAssetBytes = await Promise.all(assetRows.map(asset => readFile(join(`${restoredDb}.assets`, asset.sha256))))
  const expectedWorldBytes = await readFile(worldImage); const expectedBattleBytes = await readFile(battleImage)
  assert.ok(restoredAssetBytes.some(bytes => bytes.equals(expectedWorldBytes)) && restoredAssetBytes.some(bytes => bytes.equals(expectedBattleBytes)), 'restored v5 managed image bytes exactly match both UI uploads')
  hostProcess = launchHost(restoredDb); await waitFor(`${hostUrl}/health`, 'v5-restored host')
  const restoredMaps = (await api('/api/maps', gmToken)).body.maps
  assert.equal(restoredMaps.length, 2); assert.equal((await api(`/api/maps/${world.id}`, gmToken)).body.pieces.find(piece => piece.id === linkPin).destination.sceneId, battle.id)
  assert.deepEqual((await api(`/api/maps/${world.id}`, gmToken)).body.pieces.find(piece => piece.id === lorePin).destination, { kind: 'lore_entry', entryId: sunkenArchive.id, title: 'Sunken Archive', label: 'Read the recovered journal' }, 'v5 restore preserves the authorized Map pin → Lore relation')
  assert.equal((await api(`/api/lore/${sunkenArchive.id}`, playerAIdentity.credential)).response.status, 200, 'restored Lore authorization and stable target ID remain valid for enrolled player')
  assert.ok(!JSON.stringify((await api(`/api/maps/${world.id}`, playerAIdentity.credential)).body).includes(privateLore.id), 'v5-restored player projection contains no removed or private Lore target ID')
  assert.equal((await api(`/api/maps/${battle.id}`, playerAIdentity.credential)).response.status, 404, 'restored host preserves revoked-player authorization')
  await waitExpr(gm, "document.querySelector('.status')?.textContent.includes('CONNECTED')", 'GM reconnects to v5-restored host')
  await screenshot(gm, 'gm-after-v5-restored-host.png')
  diagnostics.backup = { schemaVersion: backupManifest.potomacDataVersion, restoredCounts, mapIds: [world.id, battle.id], imageBytes: restoredAssetBytes.map(bytes => bytes.length) }
  mark('Stage 8: v5 backup restores separate empty database and exact map image assets', 'PASS', diagnostics.backup)
  const loreRevokeCursor = (await api('/api/state', playerAIdentity.credential)).body.revision
  const loreRevokeController = new AbortController()
  const loreRevokeStream = await fetch(`${hostUrl}/api/stream?since=${loreRevokeCursor}`, { headers: { authorization: `Bearer ${playerAIdentity.credential}` }, signal: loreRevokeController.signal })
  assert.equal(loreRevokeStream.status, 200, 'Player A can observe the authorized live stream before Lore revocation')
  const loreRevokeReader = loreRevokeStream.body.getReader()
  await clickText(gm, 'Lore', 'nav[aria-label="Applications"] button')
  await waitExpr(gm, "[...document.querySelectorAll('.lore-list button strong')].some(item=>item.textContent==='Sunken Archive')", 'restored Lore list is ready before selecting its article')
  await clickText(gm, 'Sunken Archive', '.lore-list button')
  await waitExpr(gm, "document.querySelector('.lore-article h2')?.textContent==='Sunken Archive' && [...document.querySelectorAll('.lore-article .action-grid button')].some(button=>button.textContent==='Revoke from players')", 'GM opens the restored Lore target for revocation')
  await clickText(gm, 'Revoke from players', '.lore-article .action-grid button')
  await waitExpr(gm, "[...document.querySelectorAll('.lore-article .action-grid button')].some(button=>button.textContent==='Publish to players')", 'GM UI confirms Lore revocation')
  let loreRevokeEvent = ''
  while (!loreRevokeEvent.includes('permissions.refresh')) {
    const { done, value } = await loreRevokeReader.read()
    assert.equal(done, false, 'Player SSE remains open while Lore authorization refreshes')
    loreRevokeEvent += new TextDecoder().decode(value)
  }
  loreRevokeController.abort(); await loreRevokeReader.cancel().catch(() => {})
  assert.ok(!loreRevokeEvent.includes(sunkenArchive.id) && !loreRevokeEvent.includes('Sunken Archive') && !loreRevokeEvent.includes(world.id), 'Lore revocation SSE refresh contains no target, title or source-map metadata')
  assert.equal((await api(`/api/lore/${sunkenArchive.id}`, playerAIdentity.credential)).response.status, 404, 'revoked Lore ID is no longer directly readable after v5 restore')
  for (const identity of [playerAIdentity, playerBIdentity]) {
    const projected = await api(`/api/maps/${world.id}`, identity.credential)
    assert.equal(projected.response.status, 200)
    const pin = projected.body.pieces.find(piece => piece.id === lorePin)
    assert.ok(pin && !pin.destination, 'revoked Lore target is omitted while the independently shared location pin remains visible')
    assert.ok(!JSON.stringify(projected.body).includes(sunkenArchive.id) && !JSON.stringify(projected.body).includes('Sunken Archive'), 'revoked Lore ID and title are absent from current map projection')
    const replay = await api('/api/state?since=0', identity.credential)
    assert.ok(!JSON.stringify(replay.body).includes(sunkenArchive.id) && !JSON.stringify(replay.body).includes('Sunken Archive'), 'revoked Lore metadata is absent from authorized state replay')
    await clickText(identity === playerAIdentity ? playerA.sessionId : playerB.sessionId, 'Table', 'nav[aria-label="Applications"] button')
    const client = identity === playerAIdentity ? playerA : playerB
    await clickText(client.sessionId, 'Maps', 'nav[aria-label="Applications"] button')
    await clickText(client.sessionId, 'Ashen Coast', '.map-browser button')
    await waitExpr(client.sessionId, "document.querySelector('.map-toolbar strong')?.textContent==='Ashen Coast' && [...document.querySelectorAll('.map-piece-row')].some(row=>row.textContent.includes('Western cove marker'))", `${client.label} refreshed map retains the public pin after target revocation`)
    assert.ok(!await evaluate(client.sessionId, "document.querySelector('.lore-article h2')?.textContent==='Sunken Archive' || [...document.querySelectorAll('.map-piece-row button')].some(button=>button.textContent.includes('Open Sunken Archive'))"), `${client.label} rendered UI does not expose revoked Lore metadata or navigation`)
  }
  await clickText(playerA.sessionId, 'Lore', 'nav[aria-label="Applications"] button')
  await waitExpr(playerA.sessionId, "![...document.querySelectorAll('.lore-list button strong')].some(item=>item.textContent==='Sunken Archive')", 'Player A refreshed Lore list excludes revoked article')
  await cdp('Fetch.enable', { patterns: [{ urlPattern: `${hostUrl}/*`, requestStage: 'Request' }] }, playerA.sessionId)
  await cdp('Page.reload', { ignoreCache: false }, playerA.sessionId)
  await waitExpr(playerA.sessionId, "document.readyState==='complete' && document.querySelector('.status')?.textContent.match(/OFFLINE|DISCONNECTED/)", 'Player A reloads after authorization refresh without host access')
  await clickText(playerA.sessionId, 'Lore', 'nav[aria-label="Applications"] button')
  await waitExpr(playerA.sessionId, "![...document.querySelectorAll('.lore-list button strong')].some(item=>item.textContent==='Sunken Archive') && !document.body.innerText.includes('Sunken Archive')", 'refreshed offline Lore cache excludes the revoked article')
  await cdp('Fetch.disable', {}, playerA.sessionId)
  await waitExpr(playerA.sessionId, "document.querySelector('.status')?.textContent.includes('CONNECTED')", 'Player A reconnects after revoked-Lore offline-cache check')
  await screenshot(playerA.sessionId, 'player-a-revoked-lore-cache-refreshed.png')
  mark('Stage 8b: restored Lore revocation refreshes both players, raw stream, map projection and offline cache', 'PASS')
  await clickText(gm, 'Maps', 'nav[aria-label="Applications"] button')
  await waitExpr(gm, "Boolean(document.querySelector('.maps-page'))", 'GM Maps UI after backup restore')
  await clickText(gm, 'Flooded Observatory', '.map-browser button')
  const coordinateSelector = `input[aria-label="X coordinate for ${tokenA}"]`
  await inputText(gm, coordinateSelector, '5.5')
  await pressKey(gm, 'Tab')
  const movedToken = await waitMap(battle.id, gmToken, map => map.pieces?.some(piece => piece.id === tokenA && piece.x === 5.5), 'keyboard-edited token numeric X coordinate')
  await waitExpr(gm, `document.querySelector('.map-revision')?.textContent===${JSON.stringify(`Host revision ${movedToken.revision}`)}`, 'keyboard-edited map position refreshes from host')
  const focusedControl = await evaluate(gm, "({tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label'),focusVisible:document.activeElement?.matches(':focus-visible')})")
  assert.equal(focusedControl.label, `Y coordinate for ${tokenA}`, 'Tab advances to the next labeled numeric position control')
  assert.equal(focusedControl.focusVisible, true, 'keyboard navigation exposes a visible focus indicator')
  const mapRect = await evaluate(gm, "(() => { const r=document.querySelector('.map-canvas').getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height} })()")
  const revisionBeforeClick = movedToken.revision
  const clickPoint = { x: mapRect.left + 5.5 / 100 * mapRect.width, y: mapRect.top + 35 / 70 * mapRect.height }
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...clickPoint }, gm)
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...clickPoint, button: 'left', buttons: 1, clickCount: 1 }, gm)
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...clickPoint, button: 'left', buttons: 0, clickCount: 1 }, gm)
  await delay(200)
  const afterClick = await api(`/api/maps/${battle.id}`, gmToken)
  assert.equal(afterClick.body.revision, revisionBeforeClick, 'stationary piece click only selects and does not commit or snap')
  await evaluate(gm, `document.querySelector('.map-piece')?.focus()`)
  await pressKey(gm, 'ArrowRight'); await pressKey(gm, 'ArrowRight'); await pressKey(gm, 'ArrowRight')
  const keyboardMoved = await waitMap(battle.id, gmToken, map => map.pieces?.some(piece => piece.id === tokenA && piece.x === 100), 'three rapid keyboard moves serialize without stale revisions')
  assert.ok(keyboardMoved.revision > movedToken.revision, 'rapid keyboard movement commits with refreshed host revisions')
  const dragStart = { x: mapRect.left + keyboardMoved.pieces.find(piece => piece.id === tokenA).x / 100 * mapRect.width, y: mapRect.top + 35 / 70 * mapRect.height }
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...dragStart }, gm)
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...dragStart, button: 'left', buttons: 1, clickCount: 1 }, gm)
  await delay(120)
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragStart.x + 45, y: dragStart.y + 18, button: 'left', buttons: 1 }, gm)
  await delay(120)
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragStart.x + 45, y: dragStart.y + 18, button: 'left', buttons: 0, clickCount: 1 }, gm)
  const draggedToken = await waitMap(battle.id, gmToken, map => map.pieces?.some(piece => piece.id === tokenA && (piece.x !== 37.5 || piece.y !== 35)), 'pointer-dragged Battle Map token')
  await waitExpr(gm, `document.querySelector('.map-revision')?.textContent===${JSON.stringify(`Host revision ${draggedToken.revision}`)}`, 'pointer drag coordinate update is committed')
  await screenshot(gm, 'gm-keyboard-and-pointer-token-edit.png')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, playerB.sessionId)
  await clickText(playerB.sessionId, 'Maps', 'nav[aria-label="Applications"] button')
  await waitExpr(playerB.sessionId, "Boolean(document.querySelector('.maps-page'))", 'Player B maps layout at narrow viewport')
  await clickText(playerB.sessionId, 'Ashen Coast', '.map-browser button')
  await waitExpr(playerB.sessionId, "document.querySelector('.map-toolbar strong')?.textContent==='Ashen Coast'", 'Player B opens authorized World scene')
  assert.equal(await evaluate(playerB.sessionId, "document.querySelectorAll('.map-piece-row input[aria-label^=\\\"X coordinate\\\"]').length"), 0, 'player World scene exposes no coordinate editor')
  assert.ok(await evaluate(playerB.sessionId, "document.querySelector('.map-canvas')?.getAttribute('role')==='group'"), 'World scene selection remains available as a read-only map interaction')
  await clickText(playerB.sessionId, 'Flooded Observatory', '.map-browser button')
  await waitExpr(playerB.sessionId, "document.querySelector('.map-toolbar strong')?.textContent==='Flooded Observatory'", 'Player B opens authorized Battle scene')
  assert.equal(await evaluate(playerB.sessionId, "document.querySelectorAll('.map-piece-row input[aria-label^=\\\"X coordinate\\\"]').length"), 0, 'player Battle scene exposes no coordinate editor')
  const narrowLayout = await evaluate(playerB.sessionId, "({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,viewport:document.querySelector('.maps-layout')?.getBoundingClientRect().width,columns:getComputedStyle(document.querySelector('.maps-layout')).gridTemplateColumns})")
  assert.equal(narrowLayout.width, 390); assert.ok(narrowLayout.scrollWidth <= 391, `narrow Maps viewport has no horizontal overflow (${narrowLayout.scrollWidth}px)`)
  await screenshot(playerB.sessionId, 'player-b-narrow-viewport.png')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, playerB.sessionId)
  record('accessibility', { keyboard: focusedControl, numericPosition: movedToken.pieces.find(piece => piece.id === tokenA)?.x, pointerPosition: draggedToken.pieces.find(piece => piece.id === tokenA)?.x, narrowViewport: narrowLayout })
  mark('Stage 9: keyboard focus, numeric token positioning, pointer drag and narrow Maps layout', 'PASS', { keyboard: focusedControl, narrowViewport: narrowLayout })
  const [systemBHostPort, systemBWebPort] = await reservePorts(2)
  const systemBHostUrl = `http://127.0.0.1:${systemBHostPort}`; const systemBWebUrl = `http://127.0.0.1:${systemBWebPort}/`; const systemBToken = `maps-browser-system-b-gm-${process.pid}`; redactionTokens.add(systemBToken)
  const systemBDb = join(scratch, 'system-b.sqlite'); const systemBHost = launchHost(systemBDb, systemBHostPort, systemBToken)
  await waitFor(`${systemBHostUrl}/health`, 'System B disposable host')
  start(process.execPath, [join(root, 'clients/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(systemBWebPort), '--strictPort'], { cwd: join(root, 'clients/web'), env: { ...process.env, VITE_POTOMAC_HOST: systemBHostUrl, VITE_POTOMAC_GM_TOKEN: systemBToken, VITE_POTOMAC_PLAYER_TOKEN: `disabled-system-b-${process.pid}`, VITE_POTOMAC_SUBSCRIPTION_DIAGNOSTICS: '1' } })
  await waitFor(systemBWebUrl, 'System B web client')
  const systemB = await openClient('System B GM', 1280, 800, systemBWebUrl, systemBHostUrl)
  const bApi = async (path, init = {}) => { const response = await fetch(`${systemBHostUrl}${path}`, { ...init, headers: { authorization: `Bearer ${systemBToken}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } }); return { response, body: await response.json().catch(() => undefined) } }
  await waitExpr(systemB.sessionId, "Boolean(document.querySelector('.campaign-setup select'))", 'System B campaign setup form')
  await inputText(systemB.sessionId, '.campaign-setup input', 'Hollow Stars Maps Acceptance')
  await selectValue(systemB.sessionId, '.campaign-setup select', 'example.system-b@0.1.0')
  await clickText(systemB.sessionId, 'Save campaign', '.campaign-setup button')
  await waitExpr(systemB.sessionId, "document.querySelector('.campaign-select')?.textContent.includes('example.system-b@0.1.0')", 'System B system pin committed through the UI')
  const systemBCampaign = (await bApi('/api/campaign')).body
  assert.equal(systemBCampaign.systemModuleId, 'example.system-b'); assert.equal(systemBCampaign.systemModuleVersion, '0.1.0')
  // Campaign save is synchronous; fixture bootstrap runs from the client's
  // subsequent snapshot subscription. Wait for the real async result instead
  // of racing it on slower CI runners.
  const systemBFixtureStarted = Date.now()
  let systemBState
  while (Date.now() - systemBFixtureStarted < 15000) {
    const result = await bApi('/api/state')
    assert.equal(result.response.status, 200, 'System B state stays readable during fixture bootstrap')
    systemBState = result.body
    assert.ok(!systemBState.actors.some(actor => actor.id === 'actor-emberfall-01'), 'System B bootstrap excludes the System A fixture')
    if (systemBState.actors.some(actor => actor.id === 'actor-tidebound-01')) break
    await delay(120)
  }
  assert.ok(systemBState?.actors.some(actor => actor.id === 'actor-tidebound-01'), 'System B bootstrap eventually seeds its compatible actor fixture')
  const systemBWorldImage = join(scratch, 'sable-reach.png'); const systemBBattleImage = join(scratch, 'starboard-deck.png')
  await writeFile(systemBWorldImage, mapImage('world')); await writeFile(systemBBattleImage, mapImage('battle'))
  await clickText(systemB.sessionId, 'Maps', 'nav[aria-label="Applications"] button')
  await clickText(systemB.sessionId, 'Create scene', 'summary')
  await waitExpr(systemB.sessionId, "Boolean(document.querySelector('.map-create-form'))", 'System B World Map creation form')
  await inputText(systemB.sessionId, '.map-create-form input:not([type=file])', 'Sable Reach')
  await uploadFile(systemB.sessionId, '.map-create-form input[type=file]', systemBWorldImage)
  await clickText(systemB.sessionId, 'Create on host', '.map-create-form button')
  await waitExpr(systemB.sessionId, "[...document.querySelectorAll('.map-browser button strong')].some(item=>item.textContent==='Sable Reach')", 'System B World Map created with image through the UI')
  if (!await evaluate(systemB.sessionId, "document.querySelector('.map-browser details')?.open")) await clickText(systemB.sessionId, 'Create scene', 'summary')
  await waitExpr(systemB.sessionId, "Boolean(document.querySelector('.map-create-form'))", 'System B Battle Map creation form')
  await inputText(systemB.sessionId, '.map-create-form input:not([type=file])', 'Starboard Deck')
  await selectValue(systemB.sessionId, '.map-create-form select', 'battle')
  await uploadFile(systemB.sessionId, '.map-create-form input[type=file]', systemBBattleImage)
  await clickText(systemB.sessionId, 'Create on host', '.map-create-form button')
  await waitExpr(systemB.sessionId, "[...document.querySelectorAll('.map-browser button strong')].some(item=>item.textContent==='Starboard Deck')", 'System B Battle Map created with image through the UI')
  const systemBMaps = (await bApi('/api/maps')).body.maps; const systemBWorld = systemBMaps.find(map => map.name === 'Sable Reach'); const systemBBattle = systemBMaps.find(map => map.name === 'Starboard Deck')
  assert.ok(systemBWorld && systemBBattle); assert.equal(systemBWorld.kind, 'world'); assert.equal(systemBWorld.grid.type, 'none'); assert.equal(systemBBattle.kind, 'battle'); assert.equal(systemBBattle.grid.type, 'square')
  await clickText(systemB.sessionId, 'Starboard Deck', '.map-browser button')
  await openDetails(systemB.sessionId, '.map-piece-list details', 'Add actor token')
  await waitExpr(systemB.sessionId, "[...document.querySelectorAll('.map-add-piece select[name=actorId] option')].some(option=>option.value==='actor-tidebound-01')", 'System B token actor option')
  await selectValue(systemB.sessionId, '.map-add-piece select[name=actorId]', 'actor-tidebound-01')
  await clickText(systemB.sessionId, 'Add at center', '.map-add-piece button')
  const bWaitMap = async (id, predicate, label) => { const started = Date.now(); while (Date.now() - started < 15000) { const result = await bApi(`/api/maps/${id}`); if (result.response.ok && predicate(result.body)) return result.body; await delay(120) } throw new Error(`Timed out waiting for System B map state: ${label}`) }
  const systemBBattleWithToken = await bWaitMap(systemBBattle.id, map => map.pieces?.some(piece => piece.kind === 'actor' && piece.actorId === 'actor-tidebound-01'), 'System B UI token placement')
  const systemBTokenPiece = systemBBattleWithToken.pieces.find(piece => piece.kind === 'actor' && piece.actorId === 'actor-tidebound-01')
  await waitExpr(systemB.sessionId, "document.querySelector('.map-piece-row')?.textContent.includes('Tarin Vale')", 'System B actor token rendered through Maps UI')
  await clickText(systemB.sessionId, 'Publish to players', '.map-toolbar button')
  await bWaitMap(systemBBattle.id, map => map.visibility === 'shared', 'System B Battle Map publication')
  const systemBWorldBytes = await fetch(`${systemBHostUrl}/api/maps/${systemBWorld.id}/background/content`, { headers: { authorization: `Bearer ${systemBToken}` } }).then(response => response.arrayBuffer()).then(bytes => Buffer.from(bytes))
  const systemBBattleBytes = await fetch(`${systemBHostUrl}/api/maps/${systemBBattle.id}/background/content`, { headers: { authorization: `Bearer ${systemBToken}` } }).then(response => response.arrayBuffer()).then(bytes => Buffer.from(bytes))
  assert.deepEqual(systemBWorldBytes, await readFile(systemBWorldImage)); assert.deepEqual(systemBBattleBytes, await readFile(systemBBattleImage))
  await screenshot(systemB.sessionId, 'system-b-starboard-deck-ui.png')
  diagnostics.systemB = { hostPid: systemBHost.pid, moduleId: systemBCampaign.systemModuleId, actorId: 'actor-tidebound-01', mapIds: [systemBWorld.id, systemBBattle.id], tokenPieceId: systemBTokenPiece.id, imageBytes: [systemBWorldBytes.length, systemBBattleBytes.length] }
  mark('Stage 10: System B campaign bootstrap, World/Battle UI, images, grid, actor token and publication', 'PASS', diagnostics.systemB)
} catch (error) { console.error(`FAIL: ${error.stack || error.message}`); try { console.error('health', (await fetch(`${hostUrl}/health`)).status) } catch (healthError) { console.error('health failed', healthError.message) } process.exitCode = 1 } finally { await saveDiagnostics(); for (const client of Object.values(clients)) await saveClientTrace(client).catch(error => console.error(`Could not save ${client.label} trace: ${error.message}`)); console.error(`Sanitized diagnostics: ${diagnosticsPath}`); await shutdown() }
