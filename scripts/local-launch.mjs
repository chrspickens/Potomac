import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { constants as fsConstants } from 'node:fs';
import { access, lstat, mkdir, readFile, realpath, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stateRoot = join(root, '.potomac-local');
const sessionRoot = join(stateRoot, 'sessions');
const playtestRoot = join(stateRoot, 'playtests');
const hostDefault = 4177;
const webDefault = 5173;
const wait = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
const isWindows = process.platform === 'win32';
const log = message => console.log(`[Potomac] ${message}`);

export function viteShimPath(repoRoot, platform = process.platform) {
  return join(repoRoot, 'clients', 'web', 'node_modules', '.bin', platform === 'win32' ? 'vite.CMD' : 'vite');
}

export async function ensureViteShim({ repoRoot = root, platform = process.platform, runInstall = runPackageInstall } = {}) {
  const shim = viteShimPath(repoRoot, platform);
  if (await fileExists(shim)) return shim;
  console.warn(`[Potomac] Vite command shim is missing: ${shim}`);
  console.warn('[Potomac] Attempting one bounded repair: pnpm install --filter @potomac/web...');
  let repair;
  try { repair = await runInstall(repoRoot); }
  catch (error) { repair = { code: 1, detail: error.message }; }
  if (repair.code !== 0 || !(await fileExists(shim))) {
    throw new Error(`Vite is installed incompletely and its executable shim is still missing. The one repair attempt did not fix it${repair.detail ? ` (${repair.detail})` : ''}. From the repository folder, run "pnpm install --filter @potomac/web..." once, then launch again. No dependency folders were deleted.`);
  }
  log('Vite command shim repaired successfully.');
  return shim;
}

async function fileExists(path) {
  try { await access(path, fsConstants.F_OK); return true; } catch { return false; }
}

function runPackageInstall(repoRoot) {
  return new Promise((resolvePromise, reject) => {
    const child = isWindows
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'pnpm install --filter @potomac/web...'], { cwd: repoRoot, stdio: 'inherit', windowsHide: true })
      : spawn('pnpm', ['install', '--filter', '@potomac/web...'], { cwd: repoRoot, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolvePromise({ code: code ?? 1, detail: signal ? `pnpm exited on ${signal}` : '' }));
  });
}

function pnpmCommand() { return 'pnpm'; }

async function assertPortFree(port, label) {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', error => reject(new Error(`${label} port ${port} is unavailable on 127.0.0.1 (${error.code || error.message}). Close the application using that port, then try again.`)));
    server.listen(port, '127.0.0.1', resolvePromise);
  });
  await new Promise((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()));
}

async function health(url, label, children, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'not ready';
  while (Date.now() < deadline) {
    const failedSpawn = children.find(child => child.startError);
    if (failedSpawn) throw new Error(`${label} could not start: ${failedSpawn.startError.message}`);
    if (children.some(child => child.exitCode !== null)) {
      const exited = children.find(child => child.exitCode !== null);
      throw new Error(`${label} stopped during startup (exit ${exited.exitCode}). See service output above.`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) { lastError = error.message; }
    await wait(250);
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError}`);
}

async function makeSession(playtest) {
  await mkdir(playtest ? playtestRoot : join(stateRoot, 'data'), { recursive: true });
  await mkdir(sessionRoot, { recursive: true });
  const id = `${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${randomBytes(4).toString('hex')}`;
  const directory = join(sessionRoot, id);
  await mkdir(directory, { recursive: false });
  let databasePath;
  let profilePath;
  if (playtest) {
    databasePath = join(playtestRoot, `${id}.sqlite`);
    profilePath = join(playtestRoot, `${id}-browser-profile`);
    await mkdir(profilePath, { recursive: false });
  } else {
    databasePath = join(stateRoot, 'data', 'local-host.sqlite');
  }
  return { id, directory, databasePath, profilePath, playtest };
}

function spawnService(command, args, options, label) {
  const windowsArgs = ['-NoProfile', '-NonInteractive', '-Command', `& ${[command, ...args].map(quotePowerShell).join(' ')}`];
  const child = spawn(isWindows ? 'powershell.exe' : command, isWindows ? windowsArgs : args, { ...options, cwd: options.cwd || root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: !isWindows });
  for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
    for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) console.log(`[${label}] ${line}`);
  });
  child.once('error', error => { child.startError = error; console.error(`[${label}] Could not start: ${error.message}`); });
  return child;
}

function quotePowerShell(value) { return `'${String(value).replaceAll("'", "''")}'`; }

async function stopChildren(children) {
  const active = children.filter(child => child.exitCode === null && child.signalCode === null);
  if (isWindows) {
    await Promise.all(active.map(child => taskkill(child, false)));
  } else for (const child of active) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ }
  }
  await Promise.race([Promise.all(active.map(child => once(child, 'exit').catch(() => {}))), wait(6000)]);
  for (const child of active.filter(child => child.exitCode === null && child.signalCode === null)) {
    if (isWindows) await taskkill(child, true);
    else try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
  }
}

function taskkill(child, force) {
  if (!child.pid) return Promise.resolve();
  return new Promise(resolvePromise => {
    const args = ['/PID', String(child.pid), '/T'];
    if (force) args.push('/F');
    const killer = spawn('taskkill.exe', args, { stdio: 'ignore', windowsHide: true });
    killer.once('exit', resolvePromise);
    killer.once('error', resolvePromise);
  });
}

async function supervise({ playtest }) {
  checkRuntime();
  const active = await listActiveSessions();
  if (active.length) {
    for (const session of active) log(`Potomac is already running at http://127.0.0.1:${session.webPort}/ (host http://127.0.0.1:${session.hostPort}). Use stop-potomac before starting another session.`);
    return;
  }
  const hostPort = Number(process.env.POTOMAC_LOCAL_HOST_PORT || hostDefault);
  const webPort = Number(process.env.POTOMAC_LOCAL_WEB_PORT || webDefault);
  if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535 || !Number.isInteger(webPort) || webPort < 1 || webPort > 65535 || hostPort === webPort) {
    throw new Error('Local host and web ports must be different valid TCP ports.');
  }
  await assertPortFree(hostPort, 'Host');
  await assertPortFree(webPort, 'Web');
  await ensureViteShim();
  const session = await makeSession(playtest);
  const manifestPath = join(session.directory, 'session.json');
  const webUrl = `http://127.0.0.1:${webPort}/`;
  const hostUrl = `http://127.0.0.1:${hostPort}`;
  const stopPath = join(session.directory, 'stop.request');
  const envBase = { ...process.env, POTOMAC_ENABLE_EXPERIMENTAL_V2: '1', PORT: String(hostPort), POTOMAC_DB: session.databasePath, POTOMAC_GM_TOKEN: process.env.POTOMAC_GM_TOKEN || process.env.VITE_POTOMAC_GM_TOKEN || 'local-gm', POTOMAC_PLAYER_TOKEN: process.env.POTOMAC_PLAYER_TOKEN || process.env.VITE_POTOMAC_PLAYER_TOKEN || 'local-player', POTOMAC_SEED_DEMO: playtest ? '0' : (process.env.POTOMAC_SEED_DEMO || '0') };
  const children = [];
  const services = [];
  let stopping = false;
  let failure;
  const stop = async reason => {
    if (stopping) return;
    stopping = true;
    log(reason);
    await stopChildren(children);
  };
  const onSignal = () => { void stop('Shutting down Potomac services…'); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    await writeFile(manifestPath, JSON.stringify({ id: session.id, pid: process.pid, startedAt: new Date().toISOString(), playtest, databasePath: session.databasePath, profilePath: session.profilePath, hostPort, webPort }, null, 2), { flag: 'wx' });
    log(`Starting ${playtest ? 'fresh V2 Revised 5e playtest' : 'local host and web application'}.`);
    log(`Host: ${hostUrl}`);
    log(`Web:  ${webUrl}`);
    if (playtest) {
      log(`Disposable database: ${session.databasePath}`);
      log(`Fresh browser profile: ${session.profilePath}`);
      log(`Playtest data is preserved by default. Reset later with: node scripts/local-launch.mjs reset-playtest ${session.id}`);
    } else log(`Local database: ${session.databasePath}`);
    const hostProcess = spawnService(pnpmCommand(), ['--filter', '@potomac/host', 'dev'], { cwd: root, env: envBase }, 'host');
    children.push(hostProcess); services.push(hostProcess);
    const webEnv = { ...envBase, POTOMAC_WEB_HOST: hostUrl, VITE_POTOMAC_HOST: webUrl.replace(/\/$/, ''), VITE_POTOMAC_GM_TOKEN: process.env.VITE_POTOMAC_GM_TOKEN || envBase.POTOMAC_GM_TOKEN, VITE_POTOMAC_PLAYER_TOKEN: process.env.VITE_POTOMAC_PLAYER_TOKEN || envBase.POTOMAC_PLAYER_TOKEN };
    const webProcess = spawnService(pnpmCommand(), ['--filter', '@potomac/web', 'dev', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { cwd: root, env: webEnv }, 'web');
    children.push(webProcess); services.push(webProcess);
    await Promise.all([health(`${hostUrl}/health`, 'Host', services), health(webUrl, 'Web app', services)]);
    log('Both services are ready. Press Ctrl+C here or run stop-potomac to stop them.');
    if (session.profilePath) {
      const browserProcess = await openPlaytestBrowser(session.profilePath, webUrl);
      if (browserProcess) children.push(browserProcess);
    }
    await new Promise(resolvePromise => {
      const timer = setInterval(async () => {
        if (await fileExists(stopPath)) { clearInterval(timer); await stop('Stop requested. Shutting down Potomac services…'); resolvePromise(); }
        else if (services.some(child => child.exitCode !== null || child.signalCode !== null)) { clearInterval(timer); failure = new Error('A Potomac service exited. Stopping the remaining service.'); await stop(failure.message); resolvePromise(); }
      }, 250);
      timer.unref?.();
    });
  } catch (error) {
    failure = error;
    console.error(`[Potomac] Startup failed: ${error.message}`);
    await stop('Stopping any service that started…');
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    try {
      await rm(manifestPath, { force: true });
      await rm(stopPath, { force: true });
      await rmdir(session.directory);
    } catch { /* preserve any unexpected files in the session directory */ }
  }
  if (failure) process.exitCode = 1;
}

function checkRuntime() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    throw new Error(`Potomac's current Vite 8 and host dependencies require Node.js 22.12 or later; found ${process.versions.node}. Install a supported Node.js release and retry.`);
  }
  const version = isWindows
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'pnpm --version'], { cwd: root, encoding: 'utf8', windowsHide: true })
    : spawnSync('pnpm', ['--version'], { cwd: root, encoding: 'utf8' });
  if (version.error || version.status !== 0) throw new Error('pnpm is not available. Install pnpm 11.25.0 and retry.');
  if (version.stdout.trim() !== '11.25.0') throw new Error(`This repository pins pnpm 11.25.0 but found ${version.stdout.trim() || 'an unknown version'}. Run through Corepack or install pnpm 11.25.0, then retry.`);
}

async function openPlaytestBrowser(profilePath, url) {
  const browser = await findBrowser();
  if (!browser) { log(`No supported browser was found; open ${url} in a browser profile stored at ${profilePath}.`); return; }
  const args = [`--user-data-dir=${profilePath}`, '--no-first-run', '--new-window', url];
  const child = spawn(browser, args, { detached: !isWindows, stdio: 'ignore', windowsHide: true });
  child.once('error', error => console.error(`[Potomac] Could not open the playtest browser: ${error.message}`));
  log('Opened the playtest in its fresh browser profile.');
  return child;
}

async function findBrowser() {
  const candidates = [];
  if (process.env.POTOMAC_BROWSER) candidates.push(process.env.POTOMAC_BROWSER);
  if (isWindows) {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]) {
      if (!base) continue;
      candidates.push(join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'), join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable');
  for (const candidate of candidates) if (await fileExists(candidate)) return candidate;
  if (!isWindows) {
    for (const command of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      const result = await new Promise(resolvePromise => {
        const child = spawn('sh', ['-lc', `command -v ${command}`], { stdio: ['ignore', 'pipe', 'ignore'] });
        let output = ''; child.stdout.on('data', chunk => output += chunk); child.once('exit', code => resolvePromise(code === 0 ? output.trim() : ''));
      });
      if (result) return result;
    }
  }
  return undefined;
}

async function isActiveSession(sessionId) {
  const manifestPath = join(sessionRoot, sessionId, 'session.json');
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { return false; }
  if (!Number.isInteger(manifest.pid)) return false;
  try {
    if (isWindows) {
      const script = `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${manifest.pid}"; if ($p -and $p.CommandLine -like '*local-launch.mjs*' -and $p.CommandLine -match '\\s(start|playtest)(\\s|$)') { exit 0 } else { exit 1 }`;
      const check = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', windowsHide: true });
      return await new Promise(resolvePromise => { check.once('exit', code => resolvePromise(code === 0)); check.once('error', () => resolvePromise(false)); });
    }
    process.kill(manifest.pid, 0);
    if (process.platform === 'linux') {
      const args = (await readFile(`/proc/${manifest.pid}/cmdline`, 'utf8').catch(() => '')).split('\0');
      return args.some(argument => argument.includes('local-launch.mjs')) && args.some(argument => argument === 'start' || argument === 'playtest');
    }
    const result = spawnSync('ps', ['-p', String(manifest.pid), '-o', 'command='], { encoding: 'utf8' });
    return result.status === 0 && result.stdout.includes('local-launch.mjs') && /\s(start|playtest)(\s|$)/.test(result.stdout.trim());
  } catch { return false; }
}

async function stopActive() {
  const sessions = await listActiveSessions();
  let stopped = 0;
  for (const manifest of sessions) {
    const directory = join(sessionRoot, manifest.id);
    await writeFile(join(directory, 'stop.request'), new Date().toISOString(), { flag: 'wx' }).catch(() => {});
    log(`Requested stop for tracked Potomac session ${manifest.id}.`);
    stopped++;
  }
  if (!stopped) log('No active Potomac sessions launched by these scripts were found.');
}

async function listActiveSessions() {
  let entries = [];
  try { entries = await (await import('node:fs/promises')).readdir(sessionRoot, { withFileTypes: true }); } catch { return []; }
  const sessions = [];
  for (const entry of entries.filter(item => item.isDirectory())) {
    try {
      const manifest = JSON.parse(await readFile(join(sessionRoot, entry.name, 'session.json'), 'utf8'));
      if (manifest.id === entry.name && await isActiveSession(entry.name)) sessions.push(manifest);
    } catch { /* ignore incomplete session records */ }
  }
  return sessions;
}

function pathIsInside(parent, target) {
  const rel = relative(parent, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function resetPlaytest(id) {
  if (!/^[0-9TZ:-]+-[0-9a-f]{8}$/.test(id)) throw new Error('Provide the playtest ID printed by start-playtest; only that named playtest can be reset.');
  const parent = await realpath(playtestRoot);
  const target = resolve(parent, `${id}.sqlite`);
  if (!pathIsInside(parent, target) || dirname(target) !== parent) throw new Error('Refusing to reset a path outside the playtest data folder.');
  const profile = resolve(parent, `${id}-browser-profile`);
  if (!pathIsInside(parent, profile) || dirname(profile) !== parent) throw new Error('Refusing to reset a path outside the playtest data folder.');
  if (await isPlaytestActive(id) || await isBrowserProfileActive(profile)) throw new Error('That playtest or its browser profile is still running. Stop it before resetting its data.');
  for (const candidate of [target, `${target}-shm`, `${target}-wal`, profile]) {
    try {
      const info = await lstat(candidate);
      if (info.isDirectory() && candidate !== profile) throw new Error(`Refusing unexpected directory at ${candidate}.`);
      if (info.isSymbolicLink()) throw new Error(`Refusing symbolic link at ${candidate}.`);
      await rm(candidate, { recursive: candidate === profile, force: true });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  log(`Reset the named playtest database and browser profile for ${id}.`);
}

async function isPlaytestActive(id) {
  try {
    const entries = await (await import('node:fs/promises')).readdir(sessionRoot, { withFileTypes: true });
    for (const entry of entries.filter(item => item.isDirectory())) {
      try {
        const manifest = JSON.parse(await readFile(join(sessionRoot, entry.name, 'session.json'), 'utf8'));
        if (manifest.id === id && manifest.playtest && await isActiveSession(entry.name)) return true;
      } catch { /* ignore incomplete session records */ }
    }
  } catch { /* no active sessions */ }
  return false;
}

async function isBrowserProfileActive(profilePath) {
  if (isWindows) {
    const escaped = profilePath.replaceAll("'", "''");
    const script = `$p=Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${escaped}*' }; if ($p) { exit 0 } else { exit 1 }`;
    const check = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', windowsHide: true });
    return await new Promise(resolvePromise => { check.once('exit', code => resolvePromise(code === 0)); check.once('error', () => resolvePromise(false)); });
  }
  const processes = spawnSync('ps', ['-A', '-o', 'command='], { encoding: 'utf8' });
  return processes.status === 0 && processes.stdout.includes(profilePath);
}

async function main(args) {
  const command = args[0];
  if (command === 'start') return supervise({ playtest: false });
  if (command === 'playtest') return supervise({ playtest: true });
  if (command === 'stop') return stopActive();
  if (command === 'reset-playtest' && args[1]) return resetPlaytest(args[1]);
  throw new Error('Usage: node scripts/local-launch.mjs start | playtest | stop | reset-playtest <playtest-id>');
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(`[Potomac] ${error.message}`); process.exitCode = 1; });
}
