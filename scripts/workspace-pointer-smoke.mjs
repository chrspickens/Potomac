// Optional desktop pointer smoke: run pnpm dev, then open http://localhost:5173/
// in an isolated Chrome instance launched with --remote-debugging-port=9229.
// The script edits a fresh local layout profile; normal GM fixture setup may run.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

const port = process.env.POTOMAC_CDP_PORT || '9229';
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = pages.find((entry) => entry.type === 'page' && entry.url.startsWith('http://localhost:5173/'));
if (!page) throw new Error('Open the local Vite client in a Chrome debugging tab first.');

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const callback = pending.get(message.id);
  pending.delete(message.id);
  callback?.(message);
});
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, (message) => message.error ? reject(new Error(message.error.message)) : resolve(message.result));
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function mouse(type, x, y) {
  await command('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
}
async function click(x, y) {
  await mouse('mousePressed', x, y);
  await mouse('mouseReleased', x, y);
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 120));
const center = (rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

try {
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const profile = `pointer-smoke-${Date.now()}`;
  const savedBricksExpression = `(() => { const key = Object.keys(localStorage).find(k => k.startsWith('potomac:workspace:') && k.endsWith(encodeURIComponent(${JSON.stringify(profile)}))); const state = JSON.parse(localStorage.getItem(key)); return state.dashboards.find(d => d.id === state.activeDashboardId).bricks })()`;
  await evaluate(`localStorage.setItem('potomac.workspace.demo-profile', ${JSON.stringify(profile)})`);
  await command('Page.reload', { ignoreCache: true });
  await new Promise((resolve) => setTimeout(resolve, 650));
  await evaluate('window.scrollTo(0, 0)');
  await pause();
  const edit = await evaluate("(() => { const r = document.querySelector('.intro-actions button').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height} })()");
  await click(...Object.values(center(edit)));
  await pause();
  const initial = await evaluate("(() => { const b = document.querySelector('.brick'); if (!b) return {missing:document.body.innerText.slice(0,500)}; const h = b.querySelector('.brick-drag-handle').getBoundingClientRect(); const r = b.getBoundingClientRect(); return {h:{x:h.x,y:h.y,width:h.width,height:h.height},r:{x:r.x,y:r.y,width:r.width,height:r.height},id:b.querySelector('.brick-head strong').textContent} })()");
  if (initial.missing) throw new Error(initial.missing);
  assert.ok(initial.h.width > 0, 'drag handle is visible in edit mode');
  const start = center(initial.h);
  await mouse('mouseMoved', start.x, start.y);
  await mouse('mousePressed', start.x, start.y);
  await mouse('mouseMoved', start.x + 200, start.y + 100);
  await mouse('mouseReleased', start.x + 200, start.y + 100);
  await pause();
  const moved = await evaluate("(() => { const b = document.querySelector('.brick'); const r = b.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height} })()");
  assert.ok(moved.x !== initial.r.x || moved.y !== initial.r.y, 'drag changed brick position');
  const resize = await evaluate("(() => { const h = document.querySelector('.brick-resize-handle').getBoundingClientRect(); return {x:h.x,y:h.y,width:h.width,height:h.height} })()");
  const resizeStart = center(resize);
  await mouse('mouseMoved', resizeStart.x, resizeStart.y);
  await mouse('mousePressed', resizeStart.x, resizeStart.y);
  await mouse('mouseMoved', resizeStart.x + 105, resizeStart.y + 95);
  await mouse('mouseReleased', resizeStart.x + 105, resizeStart.y + 95);
  await pause();
  const resized = await evaluate("(() => { const r = document.querySelector('.brick').getBoundingClientRect(); return {width:r.width,height:r.height} })()");
  assert.ok(resized.width !== moved.width || resized.height !== moved.height, 'resize changed brick dimensions');
  const savedBricks = await evaluate(savedBricksExpression);
  const savedLayout = savedBricks[0].layout;
  if (process.env.POTOMAC_SMOKE_SCREENSHOT) {
    const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(process.env.POTOMAC_SMOKE_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  }
  for (let i = 0; i < savedBricks.length; i += 1) {
    for (let j = i + 1; j < savedBricks.length; j += 1) {
      const a = savedBricks[i].layout;
      const b = savedBricks[j].layout;
      assert.equal(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y, false, 'bricks do not overlap');
    }
  }
  await command('Page.reload', { ignoreCache: true });
  await new Promise((resolve) => setTimeout(resolve, 600));
  const restoredLayout = (await evaluate(savedBricksExpression))[0].layout;
  assert.deepEqual(restoredLayout, savedLayout, 'brick grid layout persisted after reload');
  console.log('Pointer drag, resize, and reload persistence passed.');
} finally {
  socket.close();
}
