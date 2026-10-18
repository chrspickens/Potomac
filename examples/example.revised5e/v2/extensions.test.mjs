import assert from 'node:assert/strict';
import test from 'node:test';
import { revised5eResolvers, revised5eRefs } from './extensions.mjs';

const resolver = revised5eResolvers.find(item => item.ref.id === revised5eRefs.attackResolver.id);
const movementResolver = revised5eResolvers.find(item => item.ref.id === revised5eRefs.movementResolver.id);
const secondWindResolver = revised5eResolvers.find(item => item.ref.id === revised5eRefs.secondWindResolver.id);
const shortRestResolver = revised5eResolvers.find(item => item.ref.id === revised5eRefs.shortRestResolver.id);
const encounter = () => ({ entityId: 'encounter', entityType: 'example.revised5e.encounter', revision: 2, data: {
  status: 'active', initiativeOrder: ['player-a', 'player-b', 'enemy'], currentTurnIndex: 0, round: 1, actionsUsed: [], shortRestCount: 0, combatLog: [],
  actors: [
    { id: 'player-a', name: 'Mira Vale', kind: 'player', ownerPrincipalId: 'player-a', position: { x: 2, y: 2 }, speed: 30, movementRemaining: 30, meleeReach: 5, reactionAvailable: true, disengaged: false, bonusActionAvailable: true, classId: 'fighter', classLevel: 1, secondWindMaximum: 2, secondWindUses: 2, abilityModifiers: { strength: 3, dexterity: 1 }, proficiencyBonus: 2, armorClass: 14, maximumHitPoints: 12, currentHitPoints: 12, initiativeModifier: 1, weapon: { name: 'Shortsword', damageDie: 6, damageType: 'piercing', attackAbility: 'strength', proficient: true } },
    { id: 'player-b', name: 'Oren Pike', kind: 'player', position: { x: 1, y: 4 }, speed: 30, movementRemaining: 30, meleeReach: 5, reactionAvailable: true, disengaged: false, bonusActionAvailable: true, classId: 'not-modeled', classLevel: 0, secondWindMaximum: 0, secondWindUses: 0, abilityModifiers: { strength: 1, dexterity: 2 }, proficiencyBonus: 2, armorClass: 15, maximumHitPoints: 10, currentHitPoints: 10, initiativeModifier: 2, weapon: { name: 'Club', damageDie: 4, damageType: 'bludgeoning', attackAbility: 'strength', proficient: true } },
    { id: 'enemy', name: 'Mire Warden', kind: 'enemy', position: { x: 3, y: 2 }, speed: 30, movementRemaining: 30, meleeReach: 5, reactionAvailable: true, disengaged: false, bonusActionAvailable: true, classId: 'not-modeled', classLevel: 0, secondWindMaximum: 0, secondWindUses: 0, abilityModifiers: { strength: 2, dexterity: 0 }, proficiencyBonus: 2, armorClass: 12, maximumHitPoints: 22, currentHitPoints: 22, initiativeModifier: 0, weapon: { name: 'Club', damageDie: 4, damageType: 'bludgeoning', attackAbility: 'strength', proficient: true } }
  ]
} });
const resolve = (d20, damageRolls = []) => resolver.resolve({
  operationId: 'attack-test', campaignId: 'test', principalId: 'player-a', logicalTime: '2026-10-17T12:00:00.000Z',
  state: encounter(), input: { actorId: 'player-a', targetId: 'enemy' },
  randomness: [{ requestId: 'attack', kind: 'die', count: 1, sides: 20, values: [d20], visibility: 'public' }, ...(damageRolls.length ? [{ requestId: 'damage', kind: 'pool', count: damageRolls.length, sides: 6, values: damageRolls, visibility: 'public' }] : [])]
});

test('Revised 5e attack outcomes apply natural 1, AC, proficiency, critical dice, modifiers and defeat rules', () => {
  const miss = resolve(1);
  assert.equal(miss.outcomes[0].kind, 'revised5e.attack.miss');
  assert.equal(miss.effects[0].payload.state.actors[2].currentHitPoints, 22);

  const normalHit = resolve(8, [2]); // 8 + Strength 3 + proficiency 2 = 13 vs AC 12; damage 2 + 3.
  assert.equal(normalHit.outcomes[0].kind, 'revised5e.attack.hit');
  assert.equal(normalHit.outcomes[0].data.damage, 5);
  assert.equal(normalHit.effects[0].payload.state.actors[2].currentHitPoints, 17);

  const critical = resolve(20, [6, 6]); // Doubled weapon die, ability modifier once.
  assert.equal(critical.outcomes[0].kind, 'revised5e.attack.critical');
  assert.equal(critical.outcomes[0].data.damage, 15);
  assert.equal(critical.effects[0].payload.state.actors[2].currentHitPoints, 7);
  // The resolver derives defeat from the committed pre-action HP.
  const nearDefeatInput = { operationId: 'attack-defeat', campaignId: 'test', principalId: 'player-a', logicalTime: '2026-10-17T12:00:00.000Z', state: encounter(), input: { actorId: 'player-a', targetId: 'enemy' }, randomness: [{ requestId: 'attack', kind: 'die', count: 1, sides: 20, values: [20], visibility: 'public' }, { requestId: 'damage', kind: 'pool', count: 2, sides: 6, values: [6, 6], visibility: 'public' }] };
  nearDefeatInput.state.data.actors[2].currentHitPoints = 10;
  const defeated = resolver.resolve(nearDefeatInput);
  assert.equal(defeated.outcomes[0].kind, 'revised5e.attack.defeat');
  assert.equal(defeated.effects[0].payload.state.actors[2].currentHitPoints, 0);
  assert.equal(defeated.effects[0].payload.state.status, 'complete');
});

const movementInput = (state = encounter(), path = [{ x: 2, y: 3 }], principalId = 'player-a') => ({
  operationId: 'move-test', campaignId: 'test', principalId, logicalTime: '2026-10-17T12:00:00.000Z',
  state: { ...state, data: { ...state.data, grid: state.data.grid || { width: 8, height: 5, squareFeet: 5, blocked: [] }, movementLog: state.data.movementLog || [] } },
  input: { actorId: 'player-a', path }, randomness: []
});

test('Revised 5e movement enforces turn, orthogonal 5-foot segments, occupancy, obstacles and remaining speed', () => {
  const moved = movementResolver.resolve(movementInput());
  assert.equal(moved.effects[0].payload.state.actors[0].position.y, 3);
  assert.equal(moved.effects[0].payload.state.actors[0].movementRemaining, 25);
  assert.throws(() => movementResolver.resolve(movementInput(encounter(), [{ x: 3, y: 3 }])), error => error.code === 'unsupported');
  const occupied = encounter(); occupied.data.actors[1].position = { x: 2, y: 3 };
  assert.throws(() => movementResolver.resolve(movementInput(occupied, [{ x: 2, y: 3 }])), error => error.code === 'conflict');
  const blocked = movementInput(); blocked.state.data.grid.blocked = [{ x: 2, y: 3 }];
  assert.throws(() => movementResolver.resolve(blocked), error => error.code === 'invalid');
  const tooFar = movementInput(encounter(), Array.from({ length: 7 }, (_, index) => ({ x: 2, y: index % 2 ? 2 : 3 })));
  tooFar.state.data.actors[0].movementRemaining = 5;
  assert.throws(() => movementResolver.resolve(tooFar), error => error.code === 'conflict');
  const wrongTurn = movementInput(); wrongTurn.state.data.currentTurnIndex = 1;
  assert.throws(() => movementResolver.resolve(wrongTurn), error => error.code === 'conflict');
});

test('leaving melee reach suspends at its pre-exit square and Disengage or unavailable reaction suppresses the window', () => {
  const request = movementInput(encounter(), [{ x: 1, y: 2 }]);
  let pending = movementResolver.resolve(request);
  assert.equal(pending.effects.length, 0, 'no movement effect commits while the reaction is pending');
  assert.equal(pending.continuation.state.preExit.x, 2);
  assert.equal(pending.continuation.state.preExit.y, 2);
  request.state.data.actors[2].reactionAvailable = false;
  pending = movementResolver.resolve(request);
  assert.equal(pending.continuation, undefined);
  request.state.data.actors[2].reactionAvailable = true;
  request.state.data.actors[0].disengaged = true;
  assert.equal(movementResolver.resolve(request).continuation, undefined);
});

test('Disengage consumes the action and End Turn advances and restores the next actor resources', () => {
  const disengage = revised5eResolvers.find(item => item.ref.id === revised5eRefs.disengageResolver.id);
  const endTurn = revised5eResolvers.find(item => item.ref.id === revised5eRefs.endTurnResolver.id);
  const request = movementInput(encounter(), [{ x: 1, y: 2 }]);
  const action = disengage.resolve(request);
  assert.deepEqual(action.effects[0].payload.state.actionsUsed, ['player-a']);
  assert.equal(action.effects[0].payload.state.actors[0].disengaged, true);
  request.state.data = action.effects[0].payload.state;
  assert.equal(movementResolver.resolve(request).continuation, undefined);
  assert.throws(() => resolver.randomRequests({ state: request.state, input: { actorId: 'player-a', targetId: 'enemy' }, randomness: [], principalId: 'player-a' }), error => error.code === 'conflict');
  const ended = endTurn.resolve(request);
  assert.equal(ended.effects[0].payload.state.initiativeOrder[ended.effects[0].payload.state.currentTurnIndex], 'player-b');
  assert.equal(ended.effects[0].payload.state.actors[1].reactionAvailable, true);
  assert.equal(ended.effects[0].payload.state.actors[1].movementRemaining, 30);
});

test('Attack preserves the existing initiative-advance behavior after movement has been taken', () => {
  const attacked = resolve(8, [2]);
  const state = attacked.effects[0].payload.state;
  assert.equal(state.initiativeOrder[state.currentTurnIndex], 'player-b');
  assert.deepEqual(state.actionsUsed, ['player-a']);
});

test('resumed opportunity attacks use host transcript, consume only a used reaction, and stop a defeated mover at the trigger', () => {
  const request = movementInput(encounter(), [{ x: 1, y: 2 }]);
  const continuation = movementResolver.resolve(request).continuation;
  const resume = (d20, damage, hp = 12) => {
    const state = movementInput(encounter(), [{ x: 1, y: 2 }]).state;
    state.data.actors[0].currentHitPoints = hp;
    return movementResolver.resume({ ...request, state, continuation, reaction: { status: 'resolved', decisions: [{ actionId: 'example.revised5e.opportunity-attack', decision: 'accept' }] }, randomness: [{ requestId: 'opportunity-d20', kind: 'die', count: 1, sides: 20, values: [d20], visibility: 'public' }, ...(damage ? [{ requestId: 'opportunity-damage', kind: 'pool', count: damage.length, sides: 4, values: damage, visibility: 'public' }] : [])] });
  };
  const naturalOne = resume(1);
  assert.equal(naturalOne.effects[0].payload.state.actors[2].reactionAvailable, false);
  assert.equal(naturalOne.effects[0].payload.state.actors[0].position.x, 1);
  assert.equal(naturalOne.effects[0].payload.state.actors[0].currentHitPoints, 12);
  const critical = resume(20, [4, 4]);
  assert.equal(critical.outcomes[0].data.result.kind, 'opportunity-critical');
  assert.equal(critical.effects[0].payload.state.actors[0].currentHitPoints, 2);
  const defeated = resume(20, [4, 4], 5);
  assert.equal(defeated.effects[0].payload.state.actors[0].currentHitPoints, 0);
  assert.equal(defeated.effects[0].payload.state.actors[0].position.x, 2);
  assert.equal(defeated.effects[0].payload.state.actors[0].movementRemaining, 30);
  const declined = movementResolver.resume({ ...request, continuation, reaction: { status: 'resolved', decisions: [{ actionId: 'example.revised5e.opportunity-attack', decision: 'decline' }] }, randomness: [] });
  assert.equal(declined.effects[0].payload.state.actors[2].reactionAvailable, true);
  assert.equal(declined.effects[0].payload.state.actors[0].position.x, 1);
});

test('Second Wind spends one use and one Bonus Action, rolls host d10 plus Fighter level, and caps healing at maximum HP', () => {
  const request = { operationId: 'second-wind-test', campaignId: 'test', principalId: 'player-a', logicalTime: '2026-10-17T12:00:00.000Z', state: encounter(), input: { actorId: 'player-a' }, randomness: [{ requestId: 'second-wind-healing', kind: 'die', count: 1, sides: 10, values: [8], visibility: 'public' }] };
  request.state.data.actors[0].currentHitPoints = 2;
  const result = secondWindResolver.resolve(request);
  const next = result.effects[0].payload.state.actors[0];
  assert.equal(next.currentHitPoints, 11, 'd10 8 + Fighter level 1 heals 9 HP');
  assert.equal(next.secondWindUses, 1);
  assert.equal(next.bonusActionAvailable, false);
  assert.equal(result.decisions[0].data.healingDie, 8);
  assert.equal(result.outcomes[0].data.kind, 'second-wind');

  request.state.data.actors[0].currentHitPoints = 10;
  const capped = secondWindResolver.resolve(request);
  assert.equal(capped.effects[0].payload.state.actors[0].currentHitPoints, 12);
  assert.equal(capped.effects[0].payload.state.combatLog.at(-1).healing, 2);
});

test('Second Wind rejects depleted uses, a second Bonus Action, wrong actor ownership and out-of-turn use without dice', () => {
  const input = { actorId: 'player-a' }, request = { state: encounter(), input, randomness: [] };
  request.state.data.actors[0].secondWindUses = 0;
  assert.throws(() => secondWindResolver.randomRequests({ ...request, principalId: 'player-a' }), error => error.code === 'conflict');
  request.state.data.actors[0].secondWindUses = 2; request.state.data.actors[0].bonusActionAvailable = false;
  assert.throws(() => secondWindResolver.randomRequests({ ...request, principalId: 'player-a' }), error => error.code === 'conflict');
  request.state.data.actors[0].bonusActionAvailable = true;
  assert.throws(() => secondWindResolver.randomRequests({ ...request, principalId: 'player-b' }), error => error.code === 'unauthorized');
  request.state.data.currentTurnIndex = 1;
  assert.throws(() => secondWindResolver.randomRequests({ ...request, principalId: 'player-a' }), error => error.code === 'conflict');
});

test('Short Rest after a GM-confirmed completed encounter restores exactly one use and never heals HP', () => {
  const state = encounter(); state.data.status = 'complete';
  const request = { operationId: 'short-rest-test', principalId: 'gm', state, input: {}, randomness: [] };
  state.data.actors[0].currentHitPoints = 4;
  state.data.actors[0].secondWindUses = 0;
  const restoredFromZero = shortRestResolver.resolve(request).effects[0].payload.state;
  assert.equal(restoredFromZero.actors[0].secondWindUses, 1);
  assert.equal(restoredFromZero.actors[0].currentHitPoints, 4);
  state.data.actors[0].secondWindUses = 1;
  const restoredOne = shortRestResolver.resolve(request).effects[0].payload.state;
  assert.equal(restoredOne.actors[0].secondWindUses, 2);
  const alreadyFull = shortRestResolver.resolve(request).effects[0].payload.state;
  assert.equal(alreadyFull.actors[0].secondWindUses, 2);
  assert.throws(() => shortRestResolver.randomRequests({ state: encounter(), principalId: 'gm' }), error => error.code === 'conflict');
  assert.throws(() => shortRestResolver.randomRequests({ state, principalId: 'player-a' }), error => error.code === 'conflict');
  state.data.actors[0].currentHitPoints = 0;
  state.data.actors[0].secondWindUses = 0;
  assert.equal(shortRestResolver.resolve(request).effects[0].payload.state.actors[0].secondWindUses, 0, '0 HP creature cannot begin this example rest');
});
