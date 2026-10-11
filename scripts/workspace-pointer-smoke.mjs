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
async function key(type, key) {
  await command('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: key === 'Escape' ? 27 : undefined });
}
async function click(x, y) {
  await mouse('mousePressed', x, y);
  await mouse('mouseReleased', x, y);
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 120));
const settle = () => new Promise((resolve) => setTimeout(resolve, 260));
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
  const initialBricks = await evaluate(savedBricksExpression);
  const initialLayout = initialBricks[0].layout;
  const start = center(initial.h);
  await mouse('mouseMoved', start.x, start.y);
  await mouse('mousePressed', start.x, start.y);
  await mouse('mouseMoved', start.x + 37, start.y + 23);
  await pause();
  const dragging = await evaluate("(() => { const b = document.querySelector('.brick'); const r = b.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,targets:document.querySelectorAll('.brick-drop-target').length} })()");
  assert.ok(dragging.x !== initial.r.x || dragging.y !== initial.r.y, 'partial-cell drag visibly moves the brick before release');
  assert.ok(dragging.targets > 0, 'snap drop targets are visible during drag');
  assert.deepEqual((await evaluate(savedBricksExpression))[0].layout, initialLayout, 'drag does not persist layout before release');
  await mouse('mouseMoved', start.x + 200, start.y + 100);
  await mouse('mouseReleased', start.x + 200, start.y + 100);
  await settle();
  const moved = await evaluate("(() => { const b = document.querySelector('.brick'); const r = b.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height} })()");
  assert.ok(moved.x !== initial.r.x || moved.y !== initial.r.y, 'drag changed brick position');
  const movedBricks = await evaluate(savedBricksExpression);
  const movedLayout = movedBricks[0].layout;
  assert.notDeepEqual(movedLayout, initialLayout, 'released drag snaps and persists the new layout');
  assert.ok(Number.isInteger(movedLayout.x) && Number.isInteger(movedLayout.y), 'released drag is aligned to grid coordinates');

  const cancelStart = center(await evaluate("(() => { const r = document.querySelector('.brick-drag-handle').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height} })()"));
  await mouse('mouseMoved', cancelStart.x, cancelStart.y);
  await mouse('mousePressed', cancelStart.x, cancelStart.y);
  await mouse('mouseMoved', cancelStart.x + 31, cancelStart.y + 19);
  await pause();
  const beforeCancel = await evaluate("(() => { const r = document.querySelector('.brick').getBoundingClientRect(); return {x:r.x,y:r.y} })()");
  assert.ok(beforeCancel.x !== moved.x || beforeCancel.y !== moved.y, 'cancel scenario visibly moves before Escape');
  assert.deepEqual((await evaluate(savedBricksExpression))[0].layout, movedLayout, 'cancel scenario remains unpersisted before Escape');
  await key('keyDown', 'Escape');
  await key('keyUp', 'Escape');
  await mouse('mouseReleased', cancelStart.x + 31, cancelStart.y + 19);
  await settle();
  const afterCancel = await evaluate("(() => { const r = document.querySelector('.brick').getBoundingClientRect(); return {x:r.x,y:r.y} })()");
  assert.deepEqual(afterCancel, { x: moved.x, y: moved.y }, 'Escape restores the brick to its last saved position');
  assert.deepEqual((await evaluate(savedBricksExpression))[0].layout, movedLayout, 'Escape cancellation does not persist layout');

  const resize = await evaluate("(() => { const h = document.querySelector('.brick-resize-handle').getBoundingClientRect(); return {x:h.x,y:h.y,width:h.width,height:h.height} })()");
  const resizeStart = center(resize);
  await mouse('mouseMoved', resizeStart.x, resizeStart.y);
  await mouse('mousePressed', resizeStart.x, resizeStart.y);
  await mouse('mouseMoved', resizeStart.x + 29, resizeStart.y + 19);
  await pause();
  const resizing = await evaluate("(() => { const r = document.querySelector('.brick').getBoundingClientRect(); return {width:r.width,height:r.height} })()");
  assert.ok(resizing.width !== moved.width || resizing.height !== moved.height, 'partial-cell resize visibly changes size before release');
  assert.deepEqual((await evaluate(savedBricksExpression))[0].layout, movedLayout, 'resize does not persist layout before release');
  await mouse('mouseMoved', resizeStart.x + 105, resizeStart.y + 95);
  await mouse('mouseReleased', resizeStart.x + 105, resizeStart.y + 95);
  await pause();
  const resized = await evaluate("(() => { const r = document.querySelector('.brick').getBoundingClientRect(); return {width:r.width,height:r.height} })()");
  assert.ok(resized.width !== moved.width || resized.height !== moved.height, 'resize changed brick dimensions');
  const resizedBricks = await evaluate(savedBricksExpression);
  const resizedLayout = resizedBricks[0].layout;
  assert.notDeepEqual(resizedLayout, movedLayout, 'released resize snaps and persists the new layout');
  assert.ok(Number.isInteger(resizedLayout.w) && Number.isInteger(resizedLayout.h), 'released resize is aligned to grid dimensions');

  const resizeCancelHandle = await evaluate("(() => { const r = document.querySelector('.brick-resize-handle').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height} })()");
  const resizeCancelStart = center(resizeCancelHandle);
  await mouse('mouseMoved', resizeCancelStart.x, resizeCancelStart.y);
  await mouse('mousePressed', resizeCancelStart.x, resizeCancelStart.y);
  await mouse('mouseMoved', resizeCancelStart.x + 23, resizeCancelStart.y + 17);
  await pause();
  const beforeResizeCancel = await evaluate("(() => { const r = document.querySelector('.brick').getBoundingClientRect(); return {width:r.width,height:r.height} })()");
  assert.ok(beforeResizeCancel.width !== resized.width || beforeResizeCancel.height !== resized.height, 'resize cancel scenario visibly changes size before Escape');
  assert.deepEqual((await evaluate(savedBricksExpression))[0].layout, resizedLayout, 'resize cancel scenario remains unpersisted before Escape');
  await key('keyDown', 'Escape');
  await key('keyUp', 'Escape');
  await mouse('mouseReleased', resizeCancelStart.x + 23, resizeCancelStart.y + 17);
  await pause();
  const afterResizeCancel = await evaluate("(() => { const r = document.querySelector('.brick').getBoundingClientRect(); return {width:r.width,height:r.height} })()");
  assert.deepEqual(afterResizeCancel, { width: resized.width, height: resized.height }, 'Escape restores the brick to its last saved size');
  assert.deepEqual((await evaluate(savedBricksExpression))[0].layout, resizedLayout, 'Escape resize cancellation does not persist layout');

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
  console.log('Smooth pointer drag/resize, snap-on-release, Escape cancellation, and reload persistence passed.');
} finally {
  socket.close();
}
