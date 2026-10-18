import assert from 'node:assert/strict';
import test from 'node:test';
import { dicepoolCommands, dicepoolReactionPrincipal, dicepoolResolvers, dicepoolScene } from './extensions.mjs';

const state = { entityId: 'scene-1', data: { title: 'The Bell Beneath Lowwater', status: 'ready', obstacle: 'Flooded bell tower', gmNote: 'private clue', characters: [{ id: 'player-a', name: 'Mira Vale', ownerPrincipalId: 'player-a', pool: 3, stress: 0, push: 1, role: 'scout' }, { id: 'player-b', name: 'Oren Pike', ownerPrincipalId: 'player-b', pool: 2, stress: 0, push: 1, role: 'keeper' }], log: [] } };
const input = (operationId, principalId, value, randomness) => ({ operationId, campaignId: 'campaign-1', principalId, logicalTime: '2026-10-18T12:00:00.000Z', state, input: value, randomness });

test('declares two generic resolution procedures and host-owned d6 pools', () => {
  assert.equal(dicepoolScene.typeId, 'example.dicepool.scene');
  assert.deepEqual(dicepoolCommands.map(command => command.commandId), ['example.dicepool.skill-challenge', 'example.dicepool.contested-action']);
  const resolver = dicepoolResolvers[0];
  assert.deepEqual(resolver.randomRequests({ state, input: { actorId: 'player-a', difficulty: 2, push: true }, randomness: [], principalId: 'player-a' }), [{ requestId: 'skill', kind: 'pool', count: 4, sides: 6, visibility: 'public' }]);
  const result = resolver.resolve(input('skill-1', 'player-a', { actorId: 'player-a', difficulty: 2, push: true }, [{ requestId: 'skill', kind: 'pool', count: 4, sides: 6, values: [6, 2, 5, 1], visibility: 'public' }]));
  assert.equal(result.outcomes[0].kind, 'dicepool.skill.success');
  assert.equal(result.effects[0].payload.state.characters[0].push, 0);
});

test('contested resolver suspends for a durable brace reaction and resumes once', () => {
  const resolver = dicepoolResolvers[1];
  const pending = resolver.resolve(input('contest-1', 'player-a', { actorId: 'player-a', defenderId: 'player-b', push: false }, []));
  assert.equal(pending.continuation.resumeOn, 'reaction');
  assert.equal(pending.continuation.reaction.audiences[0].actions[0].actionId, 'example.dicepool.brace');
  const result = resolver.resume({ ...input('contest-1', 'player-a', { actorId: 'player-a', defenderId: 'player-b', push: false }, [{ requestId: 'contest', kind: 'pool', count: 5, sides: 6, values: [6, 2, 5, 1, 2], visibility: 'public' }]), continuation: pending.continuation, reaction: { status: 'resolved', decisions: [{ principalId: 'player-b', actionId: 'example.dicepool.brace', input: {}, decision: 'accept' }] } });
  assert.equal(result.outcomes[0].kind, 'dicepool.contest.resolved');
  assert.equal(result.effects[0].payload.state.log.at(-1).accepted, true);
});

test('module audience policy resolves the defender controller from trusted scene state, not scene owner', () => {
  assert.equal(dicepoolReactionPrincipal({ audience: { audience: 'entity-owner' }, entity: state, input: { defenderId: 'player-b' } }), 'player-b');
  assert.equal(dicepoolReactionPrincipal({ audience: { audience: 'entity-owner' }, entity: state, input: { defenderId: 'missing' } }), undefined);
  assert.equal(dicepoolReactionPrincipal({ audience: { audience: 'campaign-gm' }, entity: state, input: { defenderId: 'player-b' } }), undefined);
});
