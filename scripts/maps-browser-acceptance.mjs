// Disposable real-Chromium Maps acceptance. Incremental stages are intentionally
// asserted in order so a later failure never hides an earlier browser result.
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '..'); const scratch = await mkdtemp(join(tmpdir(), 'potomac-maps-browser-')); const db = join(scratch, 'host.sqlite'); const evidence = join(root, 'docs/evidence/maps-v07-browser'); await mkdir(evidence, { recursive: true })
const hostUrl = 'http://127.0.0.1:4787'; const gmToken = `maps-browser-gm-${process.pid}`; const ports = [5171, 5172, 5173]; const chromePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync); if (!chromePath) throw new Error('Chrome/Edge executable not found')
const children = []; const start = (cmd, args, options = {}) => { const child = spawn(cmd, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options }); children.push(child); return child }; const waitFor = async (url, label) => { const started = Date.now(); while (Date.now() - started < 30000) { try { const response = await fetch(url); if (response.ok) return response } catch {} await delay(100) } throw new Error(`${label} did not become ready`) }
const api = async (path, token, init = {}) => { const response = await fetch(`${hostUrl}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } }); return { response, body: await response.json().catch(() => undefined) } }
let socket; let nextId = 0; const pending = new Map(); const diagnostics = { startedAt: new Date().toISOString(), events: [], requests: {}, statuses: [], probes: {} }; let gmSession; let diagnosticsPath
const cdp = (method, params = {}, sessionId) => new Promise((resolvePromise, reject) => { const id = ++nextId; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)) }, 15000); pending.set(id, message => { clearTimeout(timer); message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolvePromise(message.result) }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })) })
const evaluate = (session, expression) => cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session).then(result => { if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value })
const waitExpr = async (session, expression, label) => { const started = Date.now(); while (Date.now() - started < 15000) { if (await evaluate(session, expression)) return; await delay(100) } throw new Error(`Timed out: ${label}`) }
const clickText = (session, text, selector = 'button') => evaluate(session, `(() => { const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>x.textContent.includes(${JSON.stringify(text)})&&!x.disabled); if(!e) throw new Error('missing enabled ${text}; body='+document.body.innerText.slice(0,900)); e.click(); return true })()`)
const inputText = async (session, selector, value) => { await evaluate(session, `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw new Error('missing input'); e.focus(); e.select(); return true })()`); await cdp('Input.insertText', { text: value }, session) }
const screenshot = async (session, name) => { const result = await cdp('Page.captureScreenshot', { format: 'png' }, session); await writeFile(join(evidence, name), Buffer.from(result.data, 'base64')) }
const record = (type, details = {}) => diagnostics.events.push({ at: new Date().toISOString(), type, ...details })
const safeText = value => String(value).replaceAll(gmToken, '[REDACTED]').replace(/(bearer\s+)[^\s"']+/ig, '$1[REDACTED]').replace(/((?:token|authorization|credential)\s*[:=]\s*)[^\s,;"']+/ig, '$1[REDACTED]')
const saveDiagnostics = async () => { diagnostics.finishedAt = new Date().toISOString(); diagnosticsPath = join(tmpdir(), `potomac-maps-browser-diagnostics-${process.pid}.json`); await writeFile(diagnosticsPath, JSON.stringify(diagnostics, null, 2), 'utf8') }
const shutdown = async () => { for (const child of children) { if (!child.killed) child.kill('SIGTERM') } await Promise.all(children.map(child => new Promise(resolveChild => { if (child.exitCode !== null) return resolveChild(); child.once('exit', resolveChild); setTimeout(resolveChild, 3000) }))); await rm(scratch, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 }) }
try {
  const hostProcess = start(process.execPath, [join(root, 'server/host/index.mjs')], { env: { ...process.env, PORT: '4787', POTOMAC_DB: db, POTOMAC_GM_TOKEN: gmToken, POTOMAC_PLAYER_TOKEN: 'disabled', POTOMAC_SEED_DEMO: '0' } }); diagnostics.hostPid = hostProcess.pid; diagnostics.hostUrl = hostUrl; await waitFor(`${hostUrl}/health`, 'host')
  const campaign = await api('/api/campaign', gmToken, { method: 'PUT', body: JSON.stringify({ name: 'Flooded Observatory Acceptance', systemModuleId: 'example.system-a', systemModuleVersion: '0.1.0', baseRevision: 1 }) }); assert.equal(campaign.response.status, 200)
  const stateProbe = await api('/api/state', gmToken); diagnostics.probes.state = { status: stateProbe.response.status, campaignId: stateProbe.body?.campaignId, role: stateProbe.body?.role }
  const streamController = new AbortController(); const streamProbe = await fetch(`${hostUrl}/api/stream?since=${stateProbe.body?.revision || 0}`, { headers: { authorization: `Bearer ${gmToken}` }, signal: streamController.signal }); diagnostics.probes.stream = { status: streamProbe.status, contentType: streamProbe.headers.get('content-type') }; const probeReader = streamProbe.body.getReader(); diagnostics.probes.streamFirstChunk = (await probeReader.read()).done === false; streamController.abort(); await probeReader.cancel().catch(() => {})
  for (const [index, token] of [gmToken, 'unused-a', 'unused-b'].entries()) { start(process.execPath, [join(root, 'clients/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(ports[index]), '--strictPort'], { cwd: join(root, 'clients/web'), env: { ...process.env, VITE_POTOMAC_HOST: hostUrl, VITE_POTOMAC_GM_TOKEN: index === 0 ? gmToken : 'disabled', VITE_POTOMAC_PLAYER_TOKEN: token, VITE_POTOMAC_SUBSCRIPTION_DIAGNOSTICS: '1' } }); await waitFor(`http://127.0.0.1:${ports[index]}/`, `web ${index}`) }
  const debugPort = 4797; start(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(scratch, 'chrome')}`, 'about:blank']); const version = await (await waitFor(`http://127.0.0.1:${debugPort}/json/version`, 'Chrome')).json(); socket = new WebSocket(version.webSocketDebuggerUrl); await new Promise((ok, fail) => { socket.addEventListener('open', ok, { once: true }); socket.addEventListener('error', fail, { once: true }) }); socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id) } })
  const context = await cdp('Target.createBrowserContext'); const target = await cdp('Target.createTarget', { url: 'about:blank', browserContextId: context.browserContextId }); const attached = await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true }); gmSession = attached.sessionId
  diagnostics.cdp = { attachedSessionId: gmSession, targetId: target.targetId, contextId: context.browserContextId }
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.sessionId !== gmSession || !message.method) return
    const p = message.params || {}
    if (message.method === 'Network.requestWillBeSent') {
      const url = new URL(p.request.url)
      const safeQuery = url.searchParams.has('since') ? `?since=${encodeURIComponent(url.searchParams.get('since'))}` : ''
      const safeUrl = `${url.origin}${url.pathname}${safeQuery}`
      diagnostics.requests[p.requestId] = { id: p.requestId, startedAt: new Date().toISOString(), method: p.request.method, url: safeUrl, events: [] }
      record(message.method, { requestId: p.requestId, method: p.request.method, url: safeUrl })
    } else if (message.method === 'Network.responseReceived') {
      const request = diagnostics.requests[p.requestId]
      if (request) request.events.push({ at: new Date().toISOString(), type: 'response', status: p.response.status, mimeType: p.response.mimeType })
      record(message.method, { requestId: p.requestId, status: p.response.status, url: safeText(p.response.url) })
    } else if (message.method === 'Network.loadingFailed' || message.method === 'Network.loadingFinished') {
      const request = diagnostics.requests[p.requestId]
      if (request) request.events.push({ at: new Date().toISOString(), type: message.method === 'Network.loadingFailed' ? 'failed' : 'finished', error: safeText(p.errorText || ''), canceled: p.canceled })
      record(message.method, { requestId: p.requestId, error: safeText(p.errorText || ''), canceled: p.canceled })
    } else if (message.method === 'Runtime.consoleAPICalled') {
      record(message.method, { level: p.type, args: (p.args || []).map(arg => arg.value ?? arg.description).filter(value => typeof value === 'string' || typeof value === 'number').map(safeText) })
    } else if (message.method === 'Runtime.exceptionThrown') {
      record(message.method, { text: safeText(p.exceptionDetails?.text || ''), description: safeText(p.exceptionDetails?.exception?.description || '') })
    } else if (message.method === 'Page.frameNavigated') {
      record(message.method, { frameId: p.frame?.id, url: safeText(p.frame?.url || '') })
    }
  })
  diagnostics.cdpEventsListenerInstalledAt = new Date().toISOString()
  await cdp('Page.enable', {}, gmSession); await cdp('Runtime.enable', {}, gmSession); await cdp('Network.enable', {}, gmSession); await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, gmSession); await cdp('Page.navigate', { url: `http://127.0.0.1:${ports[0]}/` }, gmSession); const gm = gmSession
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
  await clickText(gm, 'Create scene', 'summary'); await waitExpr(gm, "Boolean(document.querySelector('.map-create-form'))", 'create form'); await inputText(gm, '.map-create-form input:not([type=file])', 'Ashen Coast'); assert.equal(await evaluate(gm, "document.querySelector('.map-create-form input:not([type=file])').value"), 'Ashen Coast'); await clickText(gm, 'Create on host', '.map-create-form button'); await waitExpr(gm, "document.body.innerText.includes('Ashen Coast')", 'Ashen Coast committed'); await waitExpr(gm, "document.querySelector('.status')?.textContent.includes('CONNECTED')", 'still connected after map creation'); await sample('maps-after-create'); const write = Object.values(diagnostics.requests).find(request => request.method === 'POST' && new URL(request.url).pathname === '/api/maps'); assert.ok(write?.events.some(event => event.type === 'response' && event.status === 200), 'Ashen Coast must be accepted by the disposable host'); assert.ok(Object.values(diagnostics.requests).some(request => new URL(request.url).pathname.startsWith('/api/maps/map-') && request.events.some(event => event.type === 'response' && event.status === 200)), 'Ashen Coast must be read back from the disposable host'); await screenshot(gm, 'stage-1-ashen-coast.png'); record('stage1.map-created', { name: 'Ashen Coast', status: await evaluate(gm, "document.querySelector('.status')?.textContent") }); console.log('PASS stage 1: GM created Ashen Coast through React UI, host committed/read it back, and connection stayed live')
} catch (error) { console.error(`FAIL: ${error.stack || error.message}`); try { console.error('health', (await fetch(`${hostUrl}/health`)).status) } catch (healthError) { console.error('health failed', healthError.message) } process.exitCode = 1 } finally { await saveDiagnostics(); console.error(`Sanitized diagnostics: ${diagnosticsPath}`); await shutdown() }
