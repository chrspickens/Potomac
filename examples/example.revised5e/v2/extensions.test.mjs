import assert from 'node:assert/strict';
import test from 'node:test';
import { revised5eResolvers, revised5eRefs } from './extensions.mjs';

const resolver = revised5eResolvers.find(item => item.ref.id === revised5eRefs.attackResolver.id);
const encounter = () => ({ entityId: 'encounter', entityType: 'example.revised5e.encounter', revision: 2, data: {
  status: 'active', initiativeOrder: ['player-a', 'player-b', 'enemy'], currentTurnIndex: 0, round: 1, actionsUsed: [], combatLog: [],
  actors: [
    { id: 'player-a', name: 'Mira Vale', kind: 'player', abilityModifiers: { strength: 3, dexterity: 1 }, proficiencyBonus: 2, armorClass: 14, maximumHitPoints: 12, currentHitPoints: 12, initiativeModifier: 1, weapon: { name: 'Shortsword', damageDie: 6, damageType: 'piercing', attackAbility: 'strength', proficient: true } },
    { id: 'player-b', name: 'Oren Pike', kind: 'player', abilityModifiers: { strength: 1, dexterity: 2 }, proficiencyBonus: 2, armorClass: 15, maximumHitPoints: 10, currentHitPoints: 10, initiativeModifier: 2, weapon: { name: 'Club', damageDie: 4, damageType: 'bludgeoning', attackAbility: 'strength', proficient: true } },
    { id: 'enemy', name: 'Mire Warden', kind: 'enemy', abilityModifiers: { strength: 2, dexterity: 0 }, proficiencyBonus: 2, armorClass: 12, maximumHitPoints: 22, currentHitPoints: 22, initiativeModifier: 0, weapon: { name: 'Club', damageDie: 4, damageType: 'bludgeoning', attackAbility: 'strength', proficient: true } }
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
