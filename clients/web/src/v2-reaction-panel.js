const form = document.querySelector('#connect');
const tokenInput = document.querySelector('#credential');
const entityInput = document.querySelector('#entity-id');
const message = document.querySelector('#message');
const reactionList = document.querySelector('#reactions');
const params = new URLSearchParams(location.search);
const apiBase = params.get('host') || location.origin;
let lockDigest = '';
let busy = false;
let latestEntity;
const headers = () => ({ authorization: 'Bearer ' + tokenInput.value, ...(lockDigest ? { 'x-v2-lock-digest': lockDigest } : {}) });
async function request(path, options = {}) {
  const response = await fetch(apiBase + path, { ...options, headers: { ...headers(), ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Host request failed (' + response.status + ')');
  return body;
}
function button(label, action) {
  const control = document.createElement('button'); control.type = 'button'; control.textContent = label; control.disabled = busy;
  control.addEventListener('click', () => void action()); return control;
}
function renderReaction(item) {
  const card = document.createElement('article'); card.setAttribute('aria-label', 'Reaction ' + item.windowId);
  const heading = document.createElement('h3'); heading.textContent = 'Pending decision'; card.append(heading);
  const expiry = document.createElement('p'); expiry.textContent = 'Expires ' + new Date(item.expiresAt).toLocaleString(); card.append(expiry);
  if (item.permissions.submit) {
    const label = document.createElement('label'); label.htmlFor = 'choice-' + item.windowId; label.textContent = 'Decision input'; card.append(label);
    const select = document.createElement('select'); select.id = 'choice-' + item.windowId;
    for (const choice of ['accept', 'decline']) { const option = document.createElement('option'); option.value = choice; option.textContent = choice === 'accept' ? 'Accept' : 'Decline'; select.append(option); }
    card.append(select);
    const actions = document.createElement('div'); actions.className = 'actions';
    actions.append(button('Accept', () => respond(item, 'accept')), button('Decline', () => respond(item, 'decline'))); card.append(actions);
  }
  if (item.permissions.adjudicate) {
    const actions = document.createElement('div'); actions.className = 'actions';
    actions.append(button('GM adjudicate: accept', () => gmAction(item, 'accept')), button('GM adjudicate: decline', () => gmAction(item, 'decline'))); card.append(actions);
  }
  if (item.permissions.expire) card.append(button('Expire if due', () => gmAction(item, 'expire')));
  return card;
}
function operation(key) { let id = sessionStorage.getItem(key); if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(key, id); } return id; }
async function load() {
  if (!tokenInput.value) return;
  try {
    const lock = await request('/api/v2/campaign/lock'); lockDigest = lock.digest;
    const entity = await request('/api/v2/entities/' + encodeURIComponent(entityInput.value));
    latestEntity = entity; document.querySelector('#record').hidden = false;
    document.querySelector('#record-title').textContent = entity.data.title || 'Record';
    document.querySelector('#committed-state').textContent = entity.data.status + ' · revision ' + entity.revision;
    document.querySelector('#last-choice').textContent = entity.data.lastChoice || 'none';
    const note = document.querySelector('#gm-note'); note.hidden = !entity.data.gmNote; note.textContent = entity.data.gmNote ? 'GM note: ' + entity.data.gmNote : '';
    document.querySelector('#initiate').disabled = busy || entity.data.status !== 'ready';
    const reactions = await request('/api/v2/reactions'); reactionList.replaceChildren();
    if (!reactions.length) { const empty = document.createElement('p'); empty.textContent = 'No visible pending reactions.'; reactionList.append(empty); }
    else reactions.forEach(item => reactionList.append(renderReaction(item)));
    const events = await request('/api/v2/events');
    const visible = events.filter(item => item.kind.startsWith('interruption.') || item.kind.startsWith('command.resumed'));
    document.querySelector('#combat-log').textContent = visible.map(item => item.kind + ': ' + JSON.stringify(item.payload)).join('\n') || 'No visible interruption events yet.';
    message.textContent = 'Connected to the authenticated V2 host.';
  } catch (error) { message.textContent = error instanceof Error ? error.message : 'Host request failed.'; }
}
async function respond(item, decision) {
  if (busy) return; busy = true; message.textContent = 'Submitting ' + decision + ' to the host…';
  try {
    const action = item.availableActions[0]; if (!action) throw new Error('No authorized reaction action is available.');
    const route = decision === 'decline' ? 'decline' : 'decisions';
    const body = { operationId: operation('v2-reaction-operation:' + item.windowId + ':' + decision), actionId: action.actionId, input: { choice: decision }, ...(decision === 'accept' ? { decision } : {}) };
    const result = await request('/api/v2/reactions/' + encodeURIComponent(item.windowId) + '/' + route, { method: 'POST', body: JSON.stringify(body) });
    message.textContent = 'Host reaction status: ' + result.status + '.';
  } catch (error) { message.textContent = error instanceof Error ? error.message : 'Reaction failed.'; }
  finally { busy = false; await load(); }
}
async function gmAction(item, decision) {
  if (busy) return; busy = true; message.textContent = 'Submitting GM ' + decision + '…';
  try { const route = decision === 'expire' ? 'expire' : 'adjudicate'; const result = await request('/api/v2/reactions/' + encodeURIComponent(item.windowId) + '/' + route, { method: 'POST', body: JSON.stringify(decision === 'expire' ? {} : { decision }) }); message.textContent = 'Host reaction status: ' + result.status + '.'; }
  catch (error) { message.textContent = error instanceof Error ? error.message : 'GM reaction operation failed.'; }
  finally { busy = false; await load(); }
}
form.addEventListener('submit', event => { event.preventDefault(); void load(); });
entityInput.value = params.get('entity') || entityInput.value;
document.querySelector('#initiate').addEventListener('click', async () => {
  window.__v2ActionClicks = (window.__v2ActionClicks || 0) + 1;
  if (busy || !latestEntity) return; busy = true; message.textContent = 'Submitting the interruptible action…';
  try { const result = await request('/api/v2/commands', { method: 'POST', body: JSON.stringify({ operationId: operation('v2-interruption-operation'), commandId: 'example.interruption.request', entityId: entityInput.value, expectedRevision: latestEntity.revision, input: {} }) }); window.__v2ActionResult = result; message.textContent = 'Host response: ' + result.status + '.'; }
  catch (error) { window.__v2ActionError = error instanceof Error ? error.message : 'Command failed.'; message.textContent = window.__v2ActionError; }
  finally { busy = false; await load(); }
});
window.setInterval(() => void load(), 1200);
