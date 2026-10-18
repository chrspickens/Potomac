import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { CapabilityLock, ExtensionEntityRecord, ExtensionCommandDescriptor, UiContribution, UiDescriptorCatalog, UiEntityProjection, UiHostContext } from '@potomac/contracts';
import { revised5eCommands, revised5eEncounter, revised5eRefs } from '../../../examples/example.revised5e/v2/extensions.mjs';
import contributionSource from '../../../examples/example.revised5e/v2/ui/combat.json';
import { V2UiContributionView, UiContributionRegistry } from './workspace/v2-ui';
import './v2-combat.css';

const MODULE_ID = 'example.revised5e';
const ENCOUNTER_ID = 'revised5e-demo-encounter';
const TOKEN_KEY = 'potomac.v2.revised5e.credential';
const ENROLLMENT_KEY = 'potomac.v2.revised5e.enrollment';
type Enrollment = { playerA?: { memberId: string; credential: string }; playerB?: { memberId: string; credential: string } };
type V2Lock = { lock: CapabilityLock; digest: string };
type V2Event = { eventId: string; operationId: string; entityId: string; kind: string; visibility: string; payload: Record<string, unknown> };
type Position = { x: number; y: number };
type Actor = { id: string; name: string; kind: string; position: Position; speed: number; movementRemaining: number; meleeReach: number; reactionAvailable: boolean; disengaged: boolean; abilityModifiers: Record<string, number>; proficiencyBonus: number; armorClass: number; maximumHitPoints: number; currentHitPoints: number; initiativeModifier: number; weapon: { name: string; damageDie: number; damageType: string; proficient: boolean } };
type V2Reaction = { windowId: string; expiresAt: string; availableActions: Array<{ actionId: string }>; permissions: { submit: boolean; expire: boolean; adjudicate: boolean } };
type Encounter = UiEntityProjection & { revision: number; data: { title: string; status: string; grid: { width: number; height: number; squareFeet: number; blocked: Position[] }; actors: Actor[]; initiativeOrder: string[]; initiativeRolls: number[]; currentTurnIndex: number; round: number; actionsUsed: string[]; combatLog: Array<Record<string, unknown>>; movementLog: Array<Record<string, unknown>> } };
function makeContribution(): UiContribution {
  const source = contributionSource as unknown as { contractVersion: 1; contributionId: string; contributionVersion: '1.0.0'; kind: UiContribution['kind']; slots: string[]; workflows: []; nodes: UiContribution['nodes'] };
  return {
    ...source,
    capability: revised5eRefs.ui,
    entityTypeId: revised5eEncounter.typeId,
    entityCapability: revised5eEncounter.capability,
    entitySchemaVersion: revised5eEncounter.schemaVersion,
    entitySchema: revised5eEncounter.schema,
    commands: revised5eCommands.filter(command => command.commandId !== 'example.revised5e.move').map(command => ({ commandId: command.commandId, capability: revised5eRefs.commands, inputSchema: command.inputSchema })),
  };
}

const contribution = makeContribution();
// Movement's array-of-grid-cells input is collected by the module's tactical-grid control below,
// not by the generic scalar form renderer. Keep every scalar contribution command declarative.
const declarativeCommands = revised5eCommands.filter(command => command.commandId !== 'example.revised5e.move');
const catalog: UiDescriptorCatalog = {
  entities: [{ typeId: revised5eEncounter.typeId, schemaVersion: revised5eEncounter.schemaVersion, capability: revised5eEncounter.capability, schema: revised5eEncounter.schema }],
  commands: declarativeCommands.map((command: ExtensionCommandDescriptor) => ({ commandId: command.commandId, entityTypeId: command.entityTypeId, capability: command.capability, inputSchema: command.inputSchema })),
  workflows: [],
};

export function V2CombatApp() {
  const [credential, setCredential] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? '');
  const [connected, setConnected] = useState(false);
  const [isGm, setIsGm] = useState(false);
  const [lock, setLock] = useState<V2Lock>();
  const [encounter, setEncounter] = useState<Encounter>();
  const [events, setEvents] = useState<V2Event[]>([]);
  const [reactions, setReactions] = useState<V2Reaction[]>([]);
  const [selectedPath, setSelectedPath] = useState<Position[]>([]);
  const [enrollment, setEnrollment] = useState<Enrollment>(() => { try { return JSON.parse(sessionStorage.getItem(ENROLLMENT_KEY) ?? '{}') as Enrollment; } catch { return {}; } });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [lastOperation, setLastOperation] = useState('');
  const registry = useMemo(() => {
    if (!lock) return undefined;
    const value = new UiContributionRegistry(lock.lock, lock.lock.campaignId, catalog);
    value.register(contribution);
    return value;
  }, [lock]);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${credential}`);
    if (init.body) headers.set('content-type', 'application/json');
    if (lock) headers.set('x-v2-lock-digest', lock.digest);
    const response = await fetch(path, { ...init, headers });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw Object.assign(new Error(String(payload.error || `Request failed (${response.status})`)), { status: response.status, payload });
    return payload;
  }, [credential, lock]);

  const refresh = useCallback(async () => {
    if (!connected || !lock || lock.lock.rootModule.id !== MODULE_ID) return;
    try {
      const [entities, eventRows, reactionRows] = await Promise.all([
        request(`/api/v2/entities?typeId=${encodeURIComponent(revised5eEncounter.typeId)}`),
        request('/api/v2/events'),
        request('/api/v2/reactions'),
      ]);
      const found = (entities as unknown as ExtensionEntityRecord[]).find(item => item.entityId === ENCOUNTER_ID);
      setEncounter(found as Encounter | undefined);
      setEvents((eventRows as unknown as V2Event[]).filter(item => item.entityId === ENCOUNTER_ID));
      setReactions(reactionRows as unknown as V2Reaction[]);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not refresh the authorized encounter.'); }
  }, [connected, lock, request]);

  useEffect(() => { if (!connected) return; void refresh(); const timer = window.setInterval(() => void refresh(), 1500); return () => window.clearInterval(timer); }, [connected, refresh]);

  const connect = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/v2/campaign/lock', { headers: { authorization: `Bearer ${credential}` } });
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok) throw Object.assign(new Error(String(payload.error || 'Could not read the V2 campaign lock.')), { status: response.status });
      const next = payload as unknown as V2Lock;
      if (next.lock.rootModule.id !== MODULE_ID) { setLock(next); setConnected(true); setMessage(`This campaign is pinned to ${next.lock.rootModule.id}. Start a fresh demo host to select the Revised 5e example.`); return; }
      sessionStorage.setItem(TOKEN_KEY, credential);
      setLock(next); setIsGm(credential === 'local-gm'); setConnected(true); setMessage('Connected to the authenticated V2 host.');
    } catch (error) {
      if (credential === 'local-gm' && (error as { status?: number }).status === 409) {
        setLock(undefined); setIsGm(true); setConnected(true); sessionStorage.setItem(TOKEN_KEY, credential); setMessage('No V2 module is pinned yet. Select the trusted Revised 5e example to continue.');
      } else { setConnected(false); setMessage(error instanceof Error ? error.message : 'Authentication failed.'); }
    } finally { setBusy(false); }
  };

  const pinModule = async () => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/v2/campaign/lock', { method: 'PUT', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: JSON.stringify({ moduleId: MODULE_ID }) });
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(String(payload.error || 'Could not pin the bundled module.'));
      setLock(payload as unknown as V2Lock); setIsGm(true); setConnected(true); sessionStorage.setItem(TOKEN_KEY, credential); setMessage('Revised 5e is pinned to this campaign.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Module pin failed.'); }
    finally { setBusy(false); }
  };

  const enroll = async (slot: 'playerA' | 'playerB', displayName: string) => {
    setBusy(true); setMessage('');
    try {
      const payload = await request('/api/members/enroll', { method: 'POST', body: JSON.stringify({ displayName }) }) as { memberId: string; credential: string };
      const next = { ...enrollment, [slot]: payload };
      setEnrollment(next); sessionStorage.setItem(ENROLLMENT_KEY, JSON.stringify(next)); setMessage(`${displayName} is enrolled. Copy the one-time credential into that player's separate browser profile.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Enrollment failed.'); }
    finally { setBusy(false); }
  };

  const createEncounter = async () => {
    if (!enrollment.playerA || !enrollment.playerB || !lock) return;
    setBusy(true); setMessage('');
    try {
      const actors = [
        { id: 'player-a', name: 'Mira Vale', kind: 'player', ownerPrincipalId: enrollment.playerA.memberId, position: { x: 2, y: 2 }, speed: 30, movementRemaining: 30, meleeReach: 5, reactionAvailable: true, disengaged: false, abilityModifiers: { strength: 3, dexterity: 1 }, proficiencyBonus: 2, armorClass: 14, maximumHitPoints: 12, currentHitPoints: 12, initiativeModifier: 1, weapon: { name: 'Shortsword', damageDie: 6, damageType: 'piercing', attackAbility: 'strength', proficient: true } },
        { id: 'player-b', name: 'Oren Pike', kind: 'player', ownerPrincipalId: enrollment.playerB.memberId, position: { x: 1, y: 4 }, speed: 30, movementRemaining: 30, meleeReach: 5, reactionAvailable: true, disengaged: false, abilityModifiers: { strength: 1, dexterity: 2 }, proficiencyBonus: 2, armorClass: 15, maximumHitPoints: 10, currentHitPoints: 10, initiativeModifier: 2, weapon: { name: 'Club', damageDie: 4, damageType: 'bludgeoning', attackAbility: 'strength', proficient: true } },
        { id: 'enemy', name: 'Mire Warden', kind: 'enemy', ownerPrincipalId: 'gm', position: { x: 3, y: 2 }, speed: 30, movementRemaining: 30, meleeReach: 5, reactionAvailable: true, disengaged: false, abilityModifiers: { strength: 2, dexterity: 0 }, proficiencyBonus: 2, armorClass: 12, maximumHitPoints: 22, currentHitPoints: 22, initiativeModifier: 0, weapon: { name: 'Club', damageDie: 4, damageType: 'bludgeoning', attackAbility: 'strength', proficient: true } },
      ];
      await request('/api/v2/entities', { method: 'POST', body: JSON.stringify({ operationId: 'revised5e-setup-create-v1', entityId: ENCOUNTER_ID, typeId: revised5eEncounter.typeId, visibility: 'public', data: { title: 'Mire Crossing', status: 'setup', grid: { width: 8, height: 5, squareFeet: 5, blocked: [{ x: 4, y: 1 }, { x: 4, y: 2 }, { x: 4, y: 3 }] }, actors, initiativeOrder: [], initiativeRolls: [], currentTurnIndex: 0, round: 0, actionsUsed: [], combatLog: [], movementLog: [] } }) });
      for (const member of [enrollment.playerA, enrollment.playerB]) await request(`/api/v2/entities/${ENCOUNTER_ID}/grants`, { method: 'POST', body: JSON.stringify({ memberId: member.memberId, permissions: ['act'] }) });
      await refresh(); setMessage('Encounter created and both players received read and act grants. GM: roll initiative from the module contribution below.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Encounter setup failed.'); }
    finally { setBusy(false); }
  };

  const currentActor = encounter ? encounter.data.actors.find(actor => actor.id === encounter.data.initiativeOrder[encounter.data.currentTurnIndex]) : undefined;
  const appendSquare = (square: Position) => {
    if (!currentActor || !encounter || busy) return;
    const from = selectedPath.at(-1) || currentActor.position;
    if (Math.abs(square.x - from.x) + Math.abs(square.y - from.y) !== 1) { setMessage('Choose one orthogonally adjacent square at a time.'); return; }
    setSelectedPath(path => path.length >= 8 ? path : [...path, square]);
  };
  const submitMove = async () => {
    if (!currentActor || !encounter || !selectedPath.length) return;
    setBusy(true); setMessage('Submitting movement path to the host…');
    try {
      const operationId = crypto.randomUUID(); setLastOperation(operationId);
      const result = await request('/api/v2/commands', { method: 'POST', body: JSON.stringify({ operationId, commandId: 'example.revised5e.move', entityId: encounter.entityId, expectedRevision: encounter.revision, input: { actorId: currentActor.id, path: selectedPath } }) });
      setSelectedPath([]); setMessage(result.status === 'pending' ? 'Movement paused at the opportunity-attack trigger; waiting for the authorized reaction.' : 'Movement committed by the host.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The host rejected this path.'); }
    finally { setBusy(false); await refresh(); }
  };
  const react = async (reaction: V2Reaction, decision: 'attack' | 'decline') => {
    if (busy) return;
    const actionId = reaction.availableActions[0]?.actionId;
    if (decision === 'attack' && !actionId) { setMessage('No authorized opportunity attack action is available.'); return; }
    const key = `v2-reaction:${reaction.windowId}:${decision}`;
    let operationId = sessionStorage.getItem(key);
    if (!operationId) { operationId = crypto.randomUUID(); sessionStorage.setItem(key, operationId); }
    setBusy(true); setMessage(decision === 'attack' ? 'Resolving opportunity attack on the host…' : 'Declining opportunity attack…');
    try {
      const route = decision === 'attack' ? 'decisions' : 'decline';
      const body = { operationId, actionId: actionId || 'example.revised5e.opportunity-attack', input: {}, ...(decision === 'attack' ? { decision: 'accept' } : {}) };
      const result = await request(`/api/v2/reactions/${encodeURIComponent(reaction.windowId)}/${route}`, { method: 'POST', body: JSON.stringify(body) });
      sessionStorage.removeItem(key); setMessage(`Host completed the reaction: ${String(result.status)}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The host rejected the reaction.'); }
    finally { setBusy(false); await refresh(); }
  };

  const host: UiHostContext | undefined = lock && encounter ? {
    lock: lock.lock,
    principalId: 'authenticated-browser-session',
    allowedCommandIds: isGm ? revised5eCommands.map(command => command.commandId) : ['example.revised5e.attack', 'example.revised5e.disengage', 'example.revised5e.end-turn'],
    submitCommand: async input => {
      setBusy(true); setMessage(''); setLastOperation(input.operationId);
      try {
        const body = { operationId: input.operationId, commandId: input.commandId, entityId: input.entityId, expectedRevision: input.expectedRevision, input: input.input };
        const response = await request('/api/v2/commands', { method: 'POST', body: JSON.stringify(body) });
        setMessage(`Host committed ${input.commandId}; receipt ${input.operationId}.`);
        return response;
      } catch (error) { setMessage(error instanceof Error ? error.message : 'The host rejected the command.'); throw error; }
      finally { setBusy(false); }
    },
  } : undefined;

  if (!connected) return <main className="v2-combat-page"><section className="v2-login-card"><p className="v2-eyebrow">Potomac · Experimental V2</p><h1>Revised 5e encounter</h1><p>Enter the GM fixture token or an individually enrolled player credential. Credentials are sent only to this loopback host.</p><form onSubmit={event => void connect(event)}><label htmlFor="v2-credential">Host credential</label><input id="v2-credential" type="password" autoComplete="off" value={credential} onChange={event => setCredential(event.target.value)} required /><button disabled={busy}>{busy ? 'Connecting…' : 'Connect to host'}</button></form>{message && <p role="alert">{message}</p>}</section></main>;

  if (lock && lock.lock.rootModule.id !== MODULE_ID) return <main className="v2-combat-page"><section className="v2-login-card"><h1>Campaign module mismatch</h1><p>{message}</p><button onClick={() => { setConnected(false); setLock(undefined); }}>Sign out</button></section></main>;

  return <main className="v2-combat-page">
    <header className="v2-combat-header"><div><p className="v2-eyebrow">Bundled module · Revised 5e 1.0.0</p><h1>Combat · {encounter?.data.title || 'Mire Crossing'}</h1></div><div className="v2-identity">{isGm ? 'GM' : 'Enrolled player'} · authenticated <button onClick={() => void refresh()}>Refresh host state</button><button onClick={() => { sessionStorage.removeItem(TOKEN_KEY); setConnected(false); setLock(undefined); }}>Sign out</button></div></header>
    {message && <p className="v2-message" role="status">{message}</p>}
    {!lock && isGm && <section className="v2-setup-card"><h2>Pin the trusted encounter module</h2><p>This chooses only the bundled Revised 5e proof for this campaign’s immutable exact lock.</p><button disabled={busy} onClick={() => void pinModule()}>Pin Revised 5e V2 module</button></section>}
    {lock && !encounter && isGm && <section className="v2-setup-card"><h2>Set up the GM and two players</h2><p>Enroll each player separately, then create the public encounter. The host stores credential hashes; copy each displayed credential to that player's own browser context.</p>
      <div className="v2-enrollment-grid">{(['playerA', 'playerB'] as const).map((slot, index) => { const enrolled = enrollment[slot]; const displayName = index === 0 ? 'Player A' : 'Player B'; return <article key={slot}><h3>{displayName}</h3>{enrolled ? <><p>Member ID: <code>{enrolled.memberId}</code></p><p>One-time credential</p><output data-player-credential={slot}>{enrolled.credential}</output></> : <button disabled={busy} onClick={() => void enroll(slot, displayName)}>Enroll {displayName}</button>}</article>; })}</div>
      {enrollment.playerA && enrollment.playerB && <button className="v2-primary" disabled={busy} onClick={() => void createEncounter()}>Create encounter and grant player access</button>}
    </section>}
    {encounter && registry && host && <>
      <section className="v2-turn-card"><span className={`v2-status v2-status-${encounter.data.status}`}>{encounter.data.status}</span><div><strong>{encounter.data.status === 'active' ? `Round ${encounter.data.round} · ${encounter.data.actors.find(actor => actor.id === encounter.data.initiativeOrder[encounter.data.currentTurnIndex])?.name ?? 'Turn pending'}` : encounter.data.status === 'setup' ? 'Initiative has not been rolled' : 'Encounter complete'}</strong><small>{encounter.data.initiativeOrder.map((id, index) => `${index + 1}. ${encounter.data.actors.find(actor => actor.id === id)?.name}`).join('  ·  ')}</small></div></section>
      <section className="v2-actor-grid" aria-label="Authorized combatants">{encounter.data.actors.map(actor => <article data-actor-id={actor.id} className={`v2-actor-card ${encounter.data.initiativeOrder[encounter.data.currentTurnIndex] === actor.id && encounter.data.status === 'active' ? 'is-current' : ''}`} key={actor.id}><div><span>{actor.kind === 'enemy' ? 'ENEMY' : 'PLAYER CHARACTER'}</span><h2>{actor.name}</h2></div><p className="v2-hp">{actor.currentHitPoints} <small>/ {actor.maximumHitPoints} HP</small></p><dl><div><dt>AC</dt><dd>{actor.armorClass}</dd></div><div><dt>Initiative</dt><dd>{actor.initiativeModifier >= 0 ? '+' : ''}{actor.initiativeModifier}</dd></div><div><dt>Proficiency</dt><dd>+{actor.proficiencyBonus}</dd></div><div><dt>Weapon</dt><dd>{actor.weapon.name} · 1d{actor.weapon.damageDie} {actor.weapon.damageType}</dd></div><div><dt>Position</dt><dd>{actor.position.x}, {actor.position.y}</dd></div><div><dt>Speed left</dt><dd>{actor.movementRemaining} ft</dd></div></dl>{actor.currentHitPoints === 0 && <strong className="v2-defeated">Defeated</strong>}</article>)}</section>
      <section className="v2-tactical" aria-labelledby="v2-grid-title"><h2 id="v2-grid-title">Tactical grid</h2><p>Each square is 5 feet. Select one orthogonal square at a time; the host validates every segment, occupancy and movement remaining.</p><p>Current mover: <strong>{currentActor?.name || 'None'}</strong> · {currentActor?.movementRemaining ?? 0} feet remaining · {currentActor?.disengaged ? 'Disengaged' : 'Opportunity attacks may apply'}</p>
        <div className="v2-grid" role="group" aria-label="Encounter movement grid" style={{ gridTemplateColumns: `repeat(${encounter.data.grid.width}, minmax(38px, 1fr))` }}>{Array.from({ length: encounter.data.grid.width * encounter.data.grid.height }, (_, index) => { const square = { x: index % encounter.data.grid.width, y: Math.floor(index / encounter.data.grid.width) }; const occupant = encounter.data.actors.find(actor => actor.position.x === square.x && actor.position.y === square.y && actor.currentHitPoints > 0); const blocked = encounter.data.grid.blocked.some(item => item.x === square.x && item.y === square.y); const selected = selectedPath.some(item => item.x === square.x && item.y === square.y); return <button key={`${square.x},${square.y}`} className={`v2-grid-cell${blocked ? ' is-blocked' : ''}${occupant ? ' is-occupied' : ''}${selected ? ' is-selected' : ''}`} type="button" disabled={busy || blocked || Boolean(occupant) || !currentActor || currentActor.movementRemaining < 5 || encounter.data.status !== 'active'} aria-label={`Square ${square.x}, ${square.y}${blocked ? ', blocked' : occupant ? `, occupied by ${occupant.name}` : ''}`} onClick={() => appendSquare(square)}>{blocked ? '■' : occupant ? occupant.name.split(' ').map(word => word[0]).join('') : selected ? '·' : `${square.x},${square.y}`}</button>; })}</div>
        <p>Selected path: <output aria-live="polite">{selectedPath.map(item => `(${item.x},${item.y})`).join(' → ') || 'none'}</output></p><div className="v2-grid-actions"><button type="button" disabled={busy || !selectedPath.length || !currentActor} onClick={() => void submitMove()}>Move along selected path</button><button type="button" disabled={busy || !selectedPath.length} onClick={() => setSelectedPath([])}>Clear path</button></div>
      </section>
      {isGm && reactions.length > 0 && <section className="v2-reactions" aria-labelledby="v2-reactions-title"><h2 id="v2-reactions-title">Pending opportunity attacks</h2>{reactions.map(reaction => <article key={reaction.windowId} aria-label={`Pending reaction ${reaction.windowId}`}><p>Movement is suspended at the reach boundary until this reaction is resolved. Expires {new Date(reaction.expiresAt).toLocaleString()}.</p><div className="v2-grid-actions"><button type="button" disabled={busy || !reaction.permissions.submit && !reaction.permissions.adjudicate} onClick={() => void react(reaction, 'attack')}>Opportunity Attack</button><button type="button" disabled={busy || !reaction.permissions.submit && !reaction.permissions.adjudicate} onClick={() => void react(reaction, 'decline')}>Decline opportunity attack</button></div></article>)}</section>}
      <section className="v2-commands"><h2>Module actions</h2><V2UiContributionView experimentalEnabled registry={registry} contributionId={contribution.contributionId} entity={encounter} host={host} /></section>
      {encounter.data.movementLog.length > 0 && <section className="v2-log"><h2>Movement log</h2><ol>{encounter.data.movementLog.slice().reverse().map((entry, index) => <li key={`${String(entry.actorId)}-${index}`}><strong>{String(entry.actorName)} moved</strong><span>({String((entry.from as Position).x)},{String((entry.from as Position).y)}) → ({String((entry.to as Position).x)},{String((entry.to as Position).y)}) · spent {String(entry.feetSpent)} ft · {String(entry.remaining)} ft remains{entry.stoppedByDefeat ? ' · stopped by defeat' : ''}</span></li>)}</ol></section>}
      <section className="v2-log"><h2>Combat log</h2>{encounter.data.combatLog.length ? <ol>{encounter.data.combatLog.slice().reverse().map((entry, index) => <li key={`${String(entry.actorId)}-${String(entry.round)}-${index}`} data-combat-log-kind={String(entry.kind)}><strong>{String(entry.kind).replaceAll('.', ' ')}</strong><span>Round {String(entry.round)} · {String(entry.actorName)} {entry.kind === 'initiative' ? 'initiative' : 'attacks'}{entry.kind === 'initiative' ? '' : ` ${String(entry.targetName)}`}</span>{entry.kind === 'initiative' ? <small>d20 {String(entry.d20)} + modifier = {String(entry.attackTotal)}</small> : <small>d20 {String(entry.d20)} + attack modifier = {String(entry.attackTotal)} vs AC {String(entry.armorClass)}{Number(entry.damage) > 0 ? ` · damage ${Array.isArray(entry.damageRolls) ? entry.damageRolls.join(' + ') : ''} + ${String(entry.damageModifier)} = ${String(entry.damage)} · ${String(entry.remainingHitPoints)} HP remains` : ` · ${String(entry.damage ?? 0)} damage`}{entry.defeated ? ' · defeated' : ''}</small>}</li>)}</ol> : <p>No committed actions yet.</p>}</section>
      <section className="v2-audit"><h2>Host random audit</h2>{events.filter(event => Array.isArray(event.payload.randomness) && event.payload.randomness.length > 0).map(event => <article key={event.eventId}><small>Operation {event.operationId} · transcript {String(event.payload.transcriptDigest)}</small><div>{(event.payload.randomness as Array<{ requestId: string; sides: number; values: number[] }>).map(item => <span key={item.requestId}>{item.requestId}: d{item.sides} [{item.values.join(', ')}]</span>)}</div></article>)}{!events.some(event => Array.isArray(event.payload.randomness) && event.payload.randomness.length > 0) && <p>Host-supplied rolls will appear here after initiative or an attack.</p>}</section>
      {isGm && <details className="v2-gm-setup"><summary>GM setup credentials</summary><div>{(['playerA', 'playerB'] as const).map(slot => enrollment[slot] && <p key={slot}>{slot}: <output>{enrollment[slot]!.credential}</output></p>)}</div></details>}
      <output className="v2-last-operation" data-last-operation-id={lastOperation} aria-live="polite">{lastOperation ? `Last operation ${lastOperation}` : ''}</output>
    </>}
  </main>;
}
