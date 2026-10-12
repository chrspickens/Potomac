// Browser IndexedDB acceptance for offline storage and process-restart persistence.
// Run directly with: node scripts/offline-storage-acceptance.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const webRequire = createRequire(join(root, 'clients/web/package.json'));
const viteCli = join(dirname(dirname(dirname(webRequire.resolve('vite')))), 'bin', 'vite.js');
const browserPath = [
  process.env.POTOMAC_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find(existsSync);
if (!browserPath) throw new Error('Chrome/Edge not found. Set POTOMAC_CHROME to its executable path.');

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  await new Promise((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()));
  return port;
}

const scratch = await mkdtemp(join(tmpdir(), 'potomac-offline-storage-'));
const profile = join(scratch, 'browser-profile');
const webPort = await freePort();
const debugPort = await freePort();
const webUrl = `http://127.0.0.1:${webPort}/`;
const processes = [];
let socket;
let sequence = 0;
let pending = new Map();

function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: 'ignore', ...options });
  processes.push(child);
  return child;
}

function startWeb() {
  return start(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], {
    cwd: join(root, 'clients/web'),
  });
}

function startBrowser() {
  return start(browserPath, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, webUrl,
  ]);
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolvePromise => child.once('exit', resolvePromise));
  child.kill('SIGTERM');
  if (await Promise.race([exited.then(() => true), delay(3000).then(() => false)])) return;
  child.kill('SIGKILL');
  await Promise.race([exited, delay(2000)]);
  if (child.exitCode === null && child.signalCode === null) throw new Error(`Could not stop process ${child.pid}`);
}

async function waitFor(url, label) {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    try { const response = await fetch(url); if (response.ok) return response; } catch {}
    await delay(100);
  }
  throw new Error(`${label} did not become ready`);
}

async function connectBrowser() {
  const response = await waitFor(`http://127.0.0.1:${debugPort}/json/version`, 'browser debug endpoint');
  const version = await response.json();
  const socketUrl = new URL(version.webSocketDebuggerUrl);
  socketUrl.hostname = '127.0.0.1';
  socket = new WebSocket(socketUrl);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener('open', resolvePromise, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const resolvePromise = pending.get(message.id);
      pending.delete(message.id);
      resolvePromise(message);
    }
  });
  const pages = await command('Target.getTargets');
  const page = pages.targetInfos.find(target => target.type === 'page');
  assert.ok(page, 'browser page exists');
  const attached = await command('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  await command('Page.enable', {}, attached.sessionId);
  await command('Runtime.enable', {}, attached.sessionId);
  await command('Page.navigate', { url: webUrl }, attached.sessionId);
  const started = Date.now();
  while (Date.now() - started < 15000) {
    const state = await command('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, attached.sessionId);
    if (state.result.value === 'complete') return attached.sessionId;
    await delay(100);
  }
  throw new Error('Browser page did not finish loading');
}

function command(method, params = {}, sessionId) {
  return new Promise((resolvePromise, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 12000);
    pending.set(id, message => {
      clearTimeout(timer);
      if (message.error) reject(new Error(`CDP ${method} failed: ${message.error.message}`));
      else resolvePromise(message.result);
    });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

async function evaluate(sessionId, expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed');
  return result.result.value;
}

const playerScope = { host: `http://127.0.0.1:${webPort}`, campaignId: 'campaign-alpha', memberId: 'member-a' };
const operation = {
  operationId: 'operation-restart-1', campaignId: playerScope.campaignId, memberId: playerScope.memberId,
  entityId: 'actor-a', baseRevision: 4, moduleId: 'fictional.core', moduleVersion: '1.0.0', schemaVersion: 1,
  actionId: 'set-resource', parameters: { resourceId: 'focus', delta: -1 },
};
const secondOperation = {
  ...operation,
  operationId: 'operation-restart-2',
  parameters: { resourceId: 'stress', delta: -1 },
};

try {
  const web = startWeb();
  await waitFor(webUrl, 'Vite client');
  let browser = startBrowser();
  let sessionId = await connectBrowser();
  await command('Runtime.enable', {}, sessionId);
  const setup = await evaluate(sessionId, `(async () => {
    const storageModule = await import('/src/offline/storage.ts');
    const snapshotsModule = await import('/src/offline/snapshots.ts');
    const scope = ${JSON.stringify(playerScope)};
    const legacyOperation = {...${JSON.stringify(operation)},operationId:'operation-before-createdAt'};
    await new Promise((resolve,reject) => {
      const open = indexedDB.open('potomac-offline', 2);
      open.onerror = () => reject(open.error);
      open.onupgradeneeded = () => {
        const db = open.result;
        for (const name of ['authorizedSnapshots','queuedOperations','privateDrafts','sessionMetadata']) {
          const store = db.createObjectStore(name,{keyPath:'key'}); store.createIndex('scopeKey','scopeKey');
        }
        const key = JSON.stringify([storageModule.offlineScopeKey(scope),legacyOperation.operationId]);
        open.transaction.objectStore('queuedOperations').put({key,scopeKey:storageModule.offlineScopeKey(scope),host:scope.host,campaignId:scope.campaignId,memberId:scope.memberId,operation:legacyOperation,state:'queued',updatedAt:123});
      };
      open.onsuccess = () => {open.result.close();resolve();};
    });
    const actor = {entityId:'actor-a',revision:4,module:{manifest:{id:'fictional.core',version:'1.0.0'},view:{layout:[],brick:[]}},data:{schemaVersion:1,visible:'player'},name:'A'};
    await snapshotsModule.cachePlayerSnapshot(scope.host,{role:'player',memberId:scope.memberId,actors:[actor],encounters:[],context:{campaignId:scope.campaignId,activeEncounter:null,cursor:23},activity:[],session:{revision:0,current:null,history:[]}});
    const activeSession={id:'session-a',status:'active',revision:1,startedAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:01.000Z',finishedAt:null};
    await snapshotsModule.cachePlayerSnapshot(scope.host,{role:'player',memberId:scope.memberId,actors:[],encounters:[],context:{campaignId:scope.campaignId,activeEncounter:null,cursor:24},activity:[],session:{revision:1,current:activeSession,history:[activeSession]}});
    const storage = await storageModule.openOfflineStorage(scope);
    const queued = await storage.enqueueOperation(${JSON.stringify(operation)});
    const secondQueued = await storage.enqueueOperation(${JSON.stringify(secondOperation)});
    await storage.savePrivateDraft({draftId:'private-draft-a',entityId:'actor-a',payload:{text:'not submitted'}});
    const raw = await new Promise((resolve,reject) => {
      const open = indexedDB.open('potomac-offline');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(['authorizedSnapshots','queuedOperations','privateDrafts','sessionMetadata'],'readonly');
        const all = {};
        for (const name of ['authorizedSnapshots','queuedOperations','privateDrafts','sessionMetadata']) {
          const req = tx.objectStore(name).getAll(); req.onsuccess = () => all[name] = req.result;
        }
        tx.oncomplete = () => { db.close(); resolve(all); };
      };
    });
    const migrated = (await storage.listOperations()).find(row => row.operation.operationId === 'operation-before-createdAt')?.createdAt;
    storage.close();
    return {createdAt:queued.createdAt, secondCreatedAt:secondQueued.createdAt, raw, migrated};
  })()`);
  assert.ok(setup.createdAt > 0, 'enqueue assigns durable creation time');
  assert.equal(setup.raw.authorizedSnapshots.length, 1);
  assert.equal(setup.raw.queuedOperations[0].operation.memberId, 'member-a');
  assert.equal(setup.migrated, 123, 'version 2 queue records migrate createdAt from their original timestamp');
  assert.equal(JSON.stringify(setup.raw).includes('gm-secret'), false, 'raw cached payload contains no GM secret sentinel');
  await command('Browser.close').catch(() => {});
  socket.close();
  socket = undefined;
  await stop(browser);

  browser = startBrowser();
  sessionId = await connectBrowser();
  await command('Runtime.enable', {}, sessionId);
  const persisted = await evaluate(sessionId, `(async () => {
    const storageModule = await import('/src/offline/storage.ts');
    const snapshotsModule = await import('/src/offline/snapshots.ts');
    const storage = await storageModule.openOfflineStorage(${JSON.stringify(playerScope)});
    const operations = await storage.listOperations();
    const snapshots = await storage.listAuthorizedSnapshots();
    const metadata = await storage.getSessionMetadata();
    const drafts = await storage.listPrivateDrafts();
    const cached = await snapshotsModule.loadCachedPlayerSnapshot({version:1,...${JSON.stringify(playerScope)},credential:'test-credential'});
    const otherMember = await storageModule.openOfflineStorage({...${JSON.stringify(playerScope)},memberId:'member-b'});
    const otherCampaign = await storageModule.openOfflineStorage({...${JSON.stringify(playerScope)},campaignId:'campaign-beta'});
    const isolated = {memberOperations:await otherMember.listOperations(),campaignOperations:await otherCampaign.listOperations(),memberSnapshots:await otherMember.listAuthorizedSnapshots()};
    otherMember.close(); otherCampaign.close(); storage.close();
    return {operations,snapshots,metadata,drafts,cached,isolated};
  })()`);
  assert.equal(persisted.operations.length, 3, 'two queued edits plus the migrated operation survive browser process restart');
  const persistedFirst = persisted.operations.find(row => row.operation.operationId === operation.operationId);
  const persistedSecond = persisted.operations.find(row => row.operation.operationId === secondOperation.operationId);
  assert.equal(persistedFirst.createdAt, setup.createdAt, 'first createdAt is stable across restart');
  assert.equal(persistedFirst.operation.baseRevision, operation.baseRevision);
  assert.equal(persistedSecond.createdAt, setup.secondCreatedAt, 'second createdAt is stable across restart');
  assert.equal(persistedSecond.operation.baseRevision, secondOperation.baseRevision);
  assert.equal(persistedSecond.operation.parameters.resourceId, 'stress');
  assert.equal(persisted.metadata.cursor, 24);
  assert.equal(persisted.metadata.session.revision, 1, 'cached Table session revision survives restart');
  assert.equal(persisted.cached.snapshot.session.current.id, 'session-a', 'cached Table session status survives restart');
  assert.equal(persisted.snapshots.length, 1);
  assert.equal(persisted.drafts[0].draftId, 'private-draft-a');
  assert.equal(persisted.cached.snapshot.actors[0].entityId, 'actor-a', 'authorized character snapshot reopens offline after process restart');
  assert.equal(persisted.cached.snapshot.context.cursor, 24);
  assert.equal(persisted.operations.find(row => row.operation.operationId === 'operation-before-createdAt').createdAt, 123);
  assert.deepEqual(persisted.isolated, { memberOperations: [], campaignOperations: [], memberSnapshots: [] });

  const semantics = await evaluate(sessionId, `(async () => {
    const {openOfflineStorage} = await import('/src/offline/storage.ts');
    const storage = await openOfflineStorage(${JSON.stringify(playerScope)});
    const queued = {...${JSON.stringify(operation)},operationId:'cancel-queued'};
    const submitting = {...${JSON.stringify(operation)},operationId:'cancel-submitting'};
    const applied = {...${JSON.stringify(operation)},operationId:'cancel-applied'};
    const proposed = {...${JSON.stringify(operation)},operationId:'cancel-proposed'};
    await storage.enqueueOperation(queued);
    await storage.cancelUnsentOperation('cancel-queued');
    await storage.enqueueOperation(submitting); await storage.markSubmitting('cancel-submitting');
    await storage.enqueueOperation(applied); await storage.recordReceipt({operationId:'cancel-applied',entityId:'actor-a',status:'applied'});
    await storage.enqueueOperation(proposed); await storage.recordReceipt({operationId:'cancel-proposed',entityId:'actor-a',status:'awaitingReview'});
    const rejected = [];
    for (const id of ['cancel-queued','cancel-submitting','cancel-applied','cancel-proposed']) {
      try { await storage.cancelUnsentOperation(id); rejected.push(false); }
      catch { rejected.push(true); }
    }
    const states = Object.fromEntries((await storage.listOperations()).map(row => [row.operation.operationId,row.state]));
    storage.close(); return {rejected,states};
  })()`);
  assert.deepEqual(semantics.rejected, [true, true, true, true]);
  assert.equal(semantics.states['cancel-submitting'], 'submitting');
  assert.equal(semantics.states['cancel-applied'], 'applied');
  assert.equal(semantics.states['cancel-proposed'], 'awaitingReview');

  const retryStatus = await evaluate(sessionId, `(async () => {
    const {openOfflineStorage} = await import('/src/offline/storage.ts');
    const {flushOfflineQueue} = await import('/src/offline/reconcile.ts');
    const storage = await openOfflineStorage(${JSON.stringify(playerScope)});
    for (const id of ['operation-restart-1','operation-restart-2','operation-before-createdAt']) await storage.recordReceipt({operationId:id,entityId:'actor-a',status:'applied'});
    await storage.recordReceipt({operationId:'cancel-submitting',entityId:'actor-a',status:'conflicted'});
    const retryOperation = {...${JSON.stringify(operation)},operationId:'retry-status-operation'};
    const before = await storage.enqueueOperation(retryOperation);
    const first = await flushOfflineQueue(storage, async () => {throw new Error('simulated lost acknowledgement');});
    const failed = (await storage.listOperations()).find(row => row.operation.operationId === retryOperation.operationId);
    let retryCancellationRejected = false;
    try { await storage.cancelUnsentOperation(retryOperation.operationId); }
    catch { retryCancellationRejected = true; }
    const secondIds = [];
    const second = await flushOfflineQueue(storage, async item => {secondIds.push(item.operationId);return {operationId:item.operationId,entityId:item.entityId,status:'applied'};});
    const applied = (await storage.listOperations()).find(row => row.operation.operationId === retryOperation.operationId);
    storage.close();
    return {first,failed,second,secondIds,createdAtBefore:before.createdAt,createdAtAfter:applied.createdAt,firstSubmittedAt:failed.firstSubmittedAt,firstSubmittedAtAfter:applied.firstSubmittedAt,retryCancellationRejected,finalState:applied.state};
  })()`);
  assert.deepEqual(retryStatus.first, { processed: 0, transportFailed: true });
  assert.equal(retryStatus.failed.state, 'queued');
  assert.equal(retryStatus.failed.lastError, 'transport');
  assert.ok(retryStatus.firstSubmittedAt > 0, 'first submission attempt persists');
  assert.equal(retryStatus.retryCancellationRejected, true, 'an uncertain delivery cannot be canceled');
  assert.equal(retryStatus.second.processed, 1);
  assert.deepEqual(retryStatus.secondIds, ['retry-status-operation']);
  assert.equal(retryStatus.createdAtAfter, retryStatus.createdAtBefore);
  assert.equal(retryStatus.firstSubmittedAtAfter, retryStatus.firstSubmittedAt);
  assert.equal(retryStatus.finalState, 'applied');

  const recovery = await evaluate(sessionId, `(async () => {
    const {openOfflineStorage,OfflineStorageCorruptionError,offlineScopeKey} = await import('/src/offline/storage.ts');
    const scope = ${JSON.stringify(playerScope)};
    const storage = await openOfflineStorage(scope);
    await new Promise((resolve,reject) => {
      const open = indexedDB.open('potomac-offline');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result; const tx = db.transaction('queuedOperations','readwrite');
        const key = JSON.stringify([offlineScopeKey(scope),'corrupt-record']);
        tx.objectStore('queuedOperations').put({key,scopeKey:offlineScopeKey(scope),host:scope.host,campaignId:scope.campaignId,memberId:scope.memberId,operation:{operationId:'bad'},state:'queued',createdAt:1,updatedAt:1});
        tx.oncomplete = () => {db.close();resolve();}; tx.onerror = () => reject(tx.error);
      };
    });
    let caught = false;
    try { await storage.listOperations(); }
    catch (error) { caught = error instanceof OfflineStorageCorruptionError && error.storeName === 'queuedOperations'; }
    const rawCount = await new Promise((resolve,reject) => {
      const open = indexedDB.open('potomac-offline'); open.onerror = () => reject(open.error);
      open.onsuccess = () => {const db=open.result;const req=db.transaction('queuedOperations').objectStore('queuedOperations').count();req.onsuccess=()=>{db.close();resolve(req.result)};};
    });
    await new Promise((resolve,reject) => {
      const open = indexedDB.open('potomac-offline'); open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db=open.result; const tx=db.transaction('authorizedSnapshots','readwrite');
        const key=JSON.stringify([offlineScopeKey(scope),'corrupt-snapshot']);
        tx.objectStore('authorizedSnapshots').put({key,scopeKey:offlineScopeKey(scope),host:scope.host,campaignId:scope.campaignId,memberId:scope.memberId,snapshot:{entityId:'corrupt-snapshot'}});
        tx.oncomplete=()=>{db.close();resolve();}; tx.onerror=()=>reject(tx.error);
      };
    });
    let snapshotCaught = false;
    try { await storage.listAuthorizedSnapshots(); }
    catch (error) { snapshotCaught = error instanceof OfflineStorageCorruptionError && error.storeName === 'authorizedSnapshots'; }
    let replacementCaught = false;
    try { await storage.replaceAuthorizedSnapshots([{entityId:'actor-a',revision:5,moduleId:'fictional.core',moduleVersion:'1.0.0',schemaVersion:1,data:{authorized:true}}]); }
    catch (error) { replacementCaught = error instanceof OfflineStorageCorruptionError; }
    const snapshotCount = await new Promise((resolve,reject) => {
      const open=indexedDB.open('potomac-offline'); open.onerror=()=>reject(open.error);
      open.onsuccess=()=>{const db=open.result;const req=db.transaction('authorizedSnapshots').objectStore('authorizedSnapshots').count();req.onsuccess=()=>{db.close();resolve(req.result)};};
    });
    storage.close(); return {caught,rawCount,snapshotCaught,replacementCaught,snapshotCount};
  })()`);
  assert.equal(recovery.caught, true, 'corrupt queue raises a recoverable error');
  assert.ok(recovery.rawCount >= 2, 'corrupt row is preserved for recovery');
  assert.equal(recovery.snapshotCaught, true, 'corrupt cached snapshot raises a recoverable error');
  assert.equal(recovery.replacementCaught, true, 'refresh does not silently overwrite corrupt cache');
  assert.equal(recovery.snapshotCount, 2, 'corrupt cached snapshot remains in IndexedDB for recovery');

  console.log('Offline storage browser acceptance passed: process restart, cached session recovery, local-copy retention, raw scope isolation, durable createdAt, cancel semantics, and corruption preservation.');
} finally {
  if (socket) { try { socket.close(); } catch {} }
  for (const child of processes.reverse()) await stop(child).catch(() => {});
  await rm(scratch, { recursive: true, force: true });
}
