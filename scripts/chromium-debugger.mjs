import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const outputTail = (output) => output.split(/\r?\n/).filter(Boolean).slice(-12).join('\n');

/** Wait for Chromium's port-zero DevTools endpoint and return its validated browser WebSocket URL. */
export async function waitForChromiumDebugger({ process, profileDir, timeoutMs = 20000 }) {
  const activePortFile = `${profileDir}/DevToolsActivePort`;
  const deadline = Date.now() + timeoutMs;
  let lastIssue = 'DevToolsActivePort has not been written';

  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Chromium exited before DevTools was ready (code ${process.exitCode}). ${outputTail(process.output ?? '')}`);
    }

    try {
      const [portText, pathText] = (await readFile(activePortFile, 'utf8')).trim().split(/\r?\n/);
      const port = Number(portText);
      if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^\/devtools\/browser\/[\w-]+$/.test(pathText ?? '')) {
        lastIssue = 'DevToolsActivePort contains an invalid port or browser path';
      } else {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
        if (!response.ok) lastIssue = `DevTools version endpoint returned HTTP ${response.status}`;
        else {
          const info = await response.json();
          const socketUrl = new URL(info?.webSocketDebuggerUrl ?? '');
          if (socketUrl.protocol === 'ws:' && ['127.0.0.1', 'localhost', '::1'].includes(socketUrl.hostname) && Number(socketUrl.port) === port && socketUrl.pathname === pathText) {
            return socketUrl.href;
          }
          lastIssue = 'DevTools version endpoint returned an invalid browser WebSocket URL';
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.name !== 'TypeError' && !(error instanceof SyntaxError)) lastIssue = `${error.name}: ${error.message}`;
    }
    await delay(100);
  }

  const stillRunning = process.exitCode === null;
  throw new Error(`Chromium DevTools did not become ready within ${timeoutMs}ms (${lastIssue}; process ${stillRunning ? 'running' : `exited ${process.exitCode}`}). ${outputTail(process.output ?? '')}`);
}
