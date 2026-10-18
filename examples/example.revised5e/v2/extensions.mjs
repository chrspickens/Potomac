const ref = (id, digest) => ({ id, apiVersion: '1.0.0', implementationVersion: '1.0.0', digest: `sha256:${digest}` });
export const revised5eRefs = {
  entity: ref('example.revised5e.encounter', '4dbfc9e1bf26568d9a5d31ca4ee80c2e79ad2763210f1c21dd2fcb95da76f583'),
  commands: ref('example.revised5e.commands', 'fb0755fcd4da6a662d151c97a37745a28e5120b80c4c2f18eb26930f4da73d52'),
  ui: ref('example.revised5e.combat-ui', '278838eb75ffef4c3ed442eb6135ac58c2b4fac17f5d199c0372b9f355a6abca'),
  initiativeResolver: ref('example.revised5e.initiative-resolver', '1bb7a6a6491b93c62ab3ece968d6b97b0dcd4382a4dcc3bd807bad5c18cad3a4'),
  attackResolver: ref('example.revised5e.attack-resolver', '7a52f081b97c843573830f0ab41c810b3f56a93d4438c33d2508c4eaf82aa3b1'),
  movementResolver: ref('example.revised5e.movement-resolver', 'eaf765e4a74995d52e4e51a652a3105e14d14f897343b3c6b38f288ec5da9f6c'),
  disengageResolver: ref('example.revised5e.disengage-resolver', '843e1773e4d83758e7b94ad73949c15f2cdde8b25fe085b32c928b5d1eb8a3d9'),
  endTurnResolver: ref('example.revised5e.end-turn-resolver', '4dc866df96e074893baab0401eb2a37c2781dd402e090cc7eac7a8d431ebc88f'),
  secondWindResolver: ref('example.revised5e.second-wind-resolver', '8f84f9f6b984b02b51c7067dce6a632a9da26373130429cd9d8ad6be06c34e3d'),
  shortRestResolver: ref('example.revised5e.short-rest-resolver', '0eaf4ff91d8fce2f4189eadd05c166b33691ae54d93db41e62423ba84e53cd76'),
  encounterEffect: ref('example.revised5e.encounter-state', 'be939a00e5f080b573b149a00a889747d0d887c565ba75a1d4599ba7f1cc7b11')
};

const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const stringId = { type: 'string', minLength: 1, maxLength: 80 };
const actorSchema = object({
  id: stringId, name: { type: 'string', minLength: 1, maxLength: 80 }, kind: { type: 'string', enum: ['player', 'enemy'] },
  position: object({ x: { type: 'integer', minimum: 0, maximum: 19 }, y: { type: 'integer', minimum: 0, maximum: 19 } }),
  speed: { type: 'integer', enum: [25, 30, 35, 40] }, movementRemaining: { type: 'integer', minimum: 0, maximum: 40 },
  meleeReach: { type: 'integer', enum: [5, 10] }, reactionAvailable: { type: 'boolean' }, disengaged: { type: 'boolean' },
  bonusActionAvailable: { type: 'boolean' }, classId: { type: 'string', enum: ['fighter', 'not-modeled'] }, classLevel: { type: 'integer', minimum: 0, maximum: 20 },
  secondWindMaximum: { type: 'integer', minimum: 0, maximum: 4 }, secondWindUses: { type: 'integer', minimum: 0, maximum: 4 },
  ownerPrincipalId: { type: 'string', minLength: 1, maxLength: 128 },
  abilityModifiers: object({ strength: { type: 'integer', minimum: -5, maximum: 10 }, dexterity: { type: 'integer', minimum: -5, maximum: 10 } }),
  proficiencyBonus: { type: 'integer', minimum: 2, maximum: 6 }, armorClass: { type: 'integer', minimum: 1, maximum: 30 },
  maximumHitPoints: { type: 'integer', minimum: 1, maximum: 500 }, currentHitPoints: { type: 'integer', minimum: 0, maximum: 500 },
  initiativeModifier: { type: 'integer', minimum: -5, maximum: 10 },
  weapon: object({ name: { type: 'string', minLength: 1, maxLength: 40 }, damageDie: { type: 'integer', enum: [4, 6, 8, 10, 12] }, damageType: { type: 'string', enum: ['bludgeoning', 'piercing', 'slashing'] }, attackAbility: { type: 'string', enum: ['strength', 'dexterity'] }, proficient: { type: 'boolean' } })
});
const combatLogItem = object({ round: { type: 'integer', minimum: 0 }, actorId: stringId, actorName: stringId, targetId: stringId, targetName: stringId, kind: { type: 'string', enum: ['initiative', 'miss', 'hit', 'critical', 'defeat', 'opportunity-miss', 'opportunity-hit', 'opportunity-critical', 'opportunity-defeat', 'second-wind', 'short-rest'] }, d20: { type: 'integer', minimum: 1, maximum: 20 }, attackTotal: { type: 'integer', minimum: -10, maximum: 100 }, armorClass: { type: 'integer', minimum: 1, maximum: 30 }, damageRolls: { type: 'array', maxItems: 2, items: { type: 'integer', minimum: 1, maximum: 12 } }, damageModifier: { type: 'integer', minimum: -5, maximum: 10 }, damage: { type: 'integer', minimum: 0, maximum: 100 }, healingRoll: { type: 'integer', minimum: 1, maximum: 10 }, healingBonus: { type: 'integer', minimum: 0, maximum: 20 }, healing: { type: 'integer', minimum: 0, maximum: 100 }, remainingHitPoints: { type: 'integer', minimum: 0, maximum: 500 }, resourceUsesRemaining: { type: 'integer', minimum: 0, maximum: 4 }, defeated: { type: 'boolean' } }, ['round', 'actorId', 'actorName', 'kind']);
const movementLogItem = object({ round: { type: 'integer', minimum: 0 }, actorId: stringId, actorName: stringId, from: object({ x: { type: 'integer', minimum: 0, maximum: 19 }, y: { type: 'integer', minimum: 0, maximum: 19 } }), to: object({ x: { type: 'integer', minimum: 0, maximum: 19 }, y: { type: 'integer', minimum: 0, maximum: 19 } }), feetSpent: { type: 'integer', minimum: 0, maximum: 40 }, remaining: { type: 'integer', minimum: 0, maximum: 40 }, stoppedByDefeat: { type: 'boolean' } });

export const revised5eEncounter = {
  descriptorVersion: 1, typeId: 'example.revised5e.encounter', schemaVersion: 2, capability: revised5eRefs.entity,
  schema: object({
    title: { type: 'string', minLength: 1, maxLength: 100 }, status: { type: 'string', enum: ['setup', 'active', 'complete'] },
    actors: { type: 'array', minItems: 3, maxItems: 3, items: actorSchema },
    grid: object({ width: { type: 'integer', minimum: 1, maximum: 20 }, height: { type: 'integer', minimum: 1, maximum: 20 }, squareFeet: { type: 'integer', enum: [5] }, blocked: { type: 'array', maxItems: 20, items: object({ x: { type: 'integer', minimum: 0, maximum: 19 }, y: { type: 'integer', minimum: 0, maximum: 19 } }) } }),
    initiativeOrder: { type: 'array', maxItems: 3, items: stringId }, initiativeRolls: { type: 'array', maxItems: 3, items: { type: 'integer', minimum: 1, maximum: 20 } },
    currentTurnIndex: { type: 'integer', minimum: 0, maximum: 2 }, round: { type: 'integer', minimum: 0, maximum: 10000 },
    actionsUsed: { type: 'array', maxItems: 3, items: stringId }, shortRestCount: { type: 'integer', minimum: 0, maximum: 10000 },
    combatLog: { type: 'array', maxItems: 100, items: combatLogItem }, movementLog: { type: 'array', maxItems: 100, items: movementLogItem }
  }),
  ownership: { kind: 'campaign' }, visibility: ['public'], creationRoles: ['gm'],
  fieldVisibility: [
    { path: 'actors.*.ownerPrincipalId', roles: ['gm'] }
  ],
  migration: { migrationId: 'example.revised5e.encounter.v2-resources', fromSchemaVersion: 1, toSchemaVersion: 2 }
};

const empty = object({});
const outcomeSchema = { type: 'array', minItems: 0, maxItems: 4, items: object({ kind: { type: 'string', minLength: 1, maxLength: 80 }, data: { type: 'object', properties: {}, additionalProperties: true }, visibility: { type: 'string', enum: ['public', 'gm', 'private'] } }) };
const initiativeInput = empty;
const attackInput = object({
  actorId: { type: 'string', enum: ['player-a', 'player-b', 'enemy'] },
  targetId: { type: 'string', enum: ['player-a', 'player-b', 'enemy'] }
});
const movementInput = object({ actorId: { type: 'string', enum: ['player-a', 'player-b', 'enemy'] }, path: { type: 'array', minItems: 1, maxItems: 8, items: object({ x: { type: 'integer', minimum: 0, maximum: 19 }, y: { type: 'integer', minimum: 0, maximum: 19 } }) } });
const actorActionInput = object({ actorId: { type: 'string', enum: ['player-a', 'player-b', 'enemy'] } });
const shortRestInput = empty;
const gmOnly = { roles: ['gm'], ownership: 'any' };
const enrolledPlayers = { roles: ['gm', 'player'], ownership: 'owner-or-participant' };
const command = (commandId, resolver, inputSchema, permission, effects, effectTargetPolicy = 'source-entity') => ({ descriptorVersion: 1, commandId, capability: revised5eRefs.commands, entityTypeId: revised5eEncounter.typeId, inputSchema, resultSchema: outcomeSchema, permission: { ...permission, effectTargetPolicy }, resolver, effects });
export const revised5eCommands = [
  command('example.revised5e.initialize', revised5eRefs.initiativeResolver, initiativeInput, gmOnly, [revised5eRefs.encounterEffect]),
  command('example.revised5e.attack', revised5eRefs.attackResolver, attackInput, enrolledPlayers, [revised5eRefs.encounterEffect], 'source-entity'),
  command('example.revised5e.move', revised5eRefs.movementResolver, movementInput, enrolledPlayers, [revised5eRefs.encounterEffect], 'source-entity'),
  command('example.revised5e.disengage', revised5eRefs.disengageResolver, actorActionInput, enrolledPlayers, [revised5eRefs.encounterEffect], 'source-entity'),
  command('example.revised5e.end-turn', revised5eRefs.endTurnResolver, actorActionInput, enrolledPlayers, [revised5eRefs.encounterEffect], 'source-entity'),
  command('example.revised5e.second-wind', revised5eRefs.secondWindResolver, actorActionInput, enrolledPlayers, [revised5eRefs.encounterEffect]),
  { ...command('example.revised5e.short-rest', revised5eRefs.shortRestResolver, shortRestInput, gmOnly, [revised5eRefs.encounterEffect]), permission: { ...gmOnly, effectTargetPolicy: 'source-entity', noPendingContinuations: true } }
];

const actorById = (state, id) => state.data.actors.find(actor => actor.id === id);
const authorizeActor = (actor, principalId) => {
  if (actor.kind === 'enemy' && principalId !== 'gm' || actor.kind === 'player' && actor.ownerPrincipalId !== principalId && principalId !== 'gm') throw Object.assign(new Error('actor controller authorization failed'), { code: 'unauthorized' });
};
const randomValues = (randomness, requestId) => randomness.find(item => item.requestId === requestId)?.values ?? [];
const outcome = (kind, data) => ({ kind, data, visibility: 'public' });
const patch = (operationId, handler, targetId, state) => ({ effectId: `${operationId}.${handler}`, handler, targetId, payload: { state }, visibility: 'public' });
const initResolver = {
  ref: revised5eRefs.initiativeResolver,
  randomRequests: ({ state, randomness }) => state.data.status === 'setup' && randomness.length === 0 ? [{ requestId: 'initiative', kind: 'pool', count: 3, sides: 20 }] : [],
  resolve(input) {
    const data = input.state.data;
    if (data.status !== 'setup') throw Object.assign(new Error('encounter initiative has already been rolled'), { code: 'conflict' });
    const rolls = randomValues(input.randomness, 'initiative');
    if (rolls.length !== data.actors.length) throw Object.assign(new Error('host initiative transcript is incomplete'), { code: 'invalid' });
    const ranked = data.actors.map((actor, index) => ({ actor, roll: rolls[index], total: rolls[index] + actor.initiativeModifier, index }))
      .sort((a, b) => b.total - a.total || a.index - b.index);
    const order = ranked.map(item => item.actor.id);
    const combatLog = ranked.map(item => ({ round: 1, actorId: item.actor.id, actorName: item.actor.name, targetId: item.actor.id, targetName: item.actor.name, kind: 'initiative', d20: item.roll, attackTotal: item.total, armorClass: item.actor.armorClass, damageRolls: [], damageModifier: 0, damage: 0, remainingHitPoints: item.actor.currentHitPoints, defeated: false }));
    const updated = { ...data, status: 'active', initiativeOrder: order, initiativeRolls: rolls, currentTurnIndex: 0, round: 1, actionsUsed: [], actors: data.actors.map(actor => ({ ...actor, movementRemaining: actor.speed, reactionAvailable: true, bonusActionAvailable: true, disengaged: false })), combatLog: [...data.combatLog, ...combatLog].slice(-100) };
    return { outcomes: [outcome('revised5e.initiative-rolled', { order, rolls, totals: ranked.map(item => item.total) })], decisions: ranked.map((item, rank) => ({ id: `initiative.${item.actor.id}`, data: { actorId: item.actor.id, d20: item.roll, modifier: item.actor.initiativeModifier, total: item.total, rank: rank + 1 }, visibility: 'public' })), effects: [patch(input.operationId, 'example.revised5e.encounter-state', input.state.entityId, updated)] };
  }
};

const attackResolver = {
  ref: revised5eRefs.attackResolver,
  randomRequests({ state, input, randomness, principalId }) {
    const actor = actorById(state, input.actorId), target = actorById(state, input.targetId);
    const opposingTeams = actor && target && actor.kind !== target.kind;
    if (!actor || !target || !opposingTeams || state.data.status !== 'active' || state.data.initiativeOrder[state.data.currentTurnIndex] !== actor.id || state.data.actionsUsed.includes(actor.id) || actor.currentHitPoints <= 0 || target.currentHitPoints <= 0 || actor.kind === 'enemy' && principalId !== 'gm') throw Object.assign(new Error('attack is not legal in the current encounter state'), { code: 'conflict' });
    const d20 = randomValues(randomness, 'attack');
    if (!d20.length) return [{ requestId: 'attack', kind: 'die', count: 1, sides: 20 }];
    const attackTotal = d20[0] + actor.abilityModifiers[actor.weapon.attackAbility] + (actor.weapon.proficient ? actor.proficiencyBonus : 0);
    if (d20[0] === 1 || d20[0] !== 20 && attackTotal < target.armorClass) return [];
    const damage = randomValues(randomness, 'damage');
    if (!damage.length) return [{ requestId: 'damage', kind: 'pool', count: d20[0] === 20 ? 2 : 1, sides: actor.weapon.damageDie }];
    return [];
  },
  resolve(input) {
    const data = input.state.data, actor = actorById(input.state, input.input.actorId), target = actorById(input.state, input.input.targetId);
    const d20 = randomValues(input.randomness, 'attack')[0];
    const modifier = actor.abilityModifiers[actor.weapon.attackAbility] + (actor.weapon.proficient ? actor.proficiencyBonus : 0);
    const attackTotal = d20 + modifier;
    const critical = d20 === 20;
    const hit = critical || d20 !== 1 && attackTotal >= target.armorClass;
    const damageRolls = hit ? randomValues(input.randomness, 'damage') : [];
    const damageModifier = actor.abilityModifiers[actor.weapon.attackAbility];
    const damage = hit ? Math.max(0, damageRolls.reduce((sum, value) => sum + value, 0) + damageModifier) : 0;
    const remainingHitPoints = Math.max(0, target.currentHitPoints - damage);
    const defeated = remainingHitPoints === 0;
    const kind = !hit ? 'miss' : defeated ? 'defeat' : critical ? 'critical' : 'hit';
    const actorIndex = data.initiativeOrder.indexOf(actor.id), wraps = actorIndex === data.initiativeOrder.length - 1;
    const actionsUsed = wraps ? [] : [...data.actionsUsed, actor.id];
    const currentTurnIndex = wraps ? 0 : (actorIndex + 1) % data.initiativeOrder.length;
    const round = wraps ? data.round + 1 : data.round;
    const nextActorId = data.initiativeOrder[(actorIndex + 1) % data.initiativeOrder.length];
    const updatedActors = data.actors.map(item => item.id === target.id ? { ...item, currentHitPoints: remainingHitPoints } : item.id === nextActorId ? { ...item, movementRemaining: item.speed, reactionAvailable: true, bonusActionAvailable: true, disengaged: false } : item);
    const logEntry = { round: data.round, actorId: actor.id, actorName: actor.name, targetId: target.id, targetName: target.name, kind, d20, attackTotal, armorClass: target.armorClass, damageRolls, damageModifier: hit ? damageModifier : 0, damage, remainingHitPoints, defeated };
    const updated = { ...data, actors: updatedActors, actionsUsed, currentTurnIndex, round, status: defeated ? 'complete' : data.status, combatLog: [...data.combatLog, logEntry].slice(-100) };
    return { outcomes: [outcome(`revised5e.attack.${kind}`, logEntry)], decisions: [{ id: `${input.operationId}.attack`, data: { naturalD20: d20, attackModifier: modifier, attackTotal, armorClass: target.armorClass, hit, critical, damageRolls, damageModifier, damage, defeated }, visibility: 'public' }], effects: [
      patch(input.operationId, 'example.revised5e.encounter-state', input.state.entityId, updated)
    ] };
  }
};

const gridDistance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
function movementPlan(data, actor, path) {
  if (data.status !== 'active' || data.initiativeOrder[data.currentTurnIndex] !== actor.id || actor.currentHitPoints <= 0 || actor.movementRemaining <= 0) throw Object.assign(new Error('movement is not legal for the current turn'), { code: 'conflict' });
  if (!Array.isArray(path) || path.length < 1 || path.length > 8) throw Object.assign(new Error('movement path must contain one to eight grid squares'), { code: 'invalid' });
  const origin = { ...actor.position }, occupied = new Set(data.actors.filter(item => item.id !== actor.id && item.currentHitPoints > 0).map(item => `${item.position.x},${item.position.y}`));
  const blocked = new Set(data.grid.blocked.map(item => `${item.x},${item.y}`));
  let current = origin, spent = 0, preExit = origin, trigger;
  const exitsByActor = new Map();
  for (let index = 0; index < path.length; index++) {
    const next = path[index];
    if (Math.abs(next.x - current.x) + Math.abs(next.y - current.y) !== 1) throw Object.assign(new Error('this example accepts only adjacent orthogonal steps'), { code: 'unsupported' });
    if (next.x < 0 || next.y < 0 || next.x >= data.grid.width || next.y >= data.grid.height || blocked.has(`${next.x},${next.y}`)) throw Object.assign(new Error('movement path enters a blocked or out-of-bounds square'), { code: 'invalid' });
    if (occupied.has(`${next.x},${next.y}`)) throw Object.assign(new Error('movement path enters an occupied square'), { code: 'conflict' });
    spent += data.grid.squareFeet;
    if (spent > actor.movementRemaining) throw Object.assign(new Error('movement path exceeds remaining Speed'), { code: 'conflict' });
    const exiting = data.actors.filter(opponent => opponent.id !== actor.id && opponent.currentHitPoints > 0 && opponent.kind !== actor.kind && opponent.reactionAvailable && !actor.disengaged && gridDistance(current, opponent.position) * data.grid.squareFeet <= opponent.meleeReach && gridDistance(next, opponent.position) * data.grid.squareFeet > opponent.meleeReach);
    for (const opponent of exiting) exitsByActor.set(opponent.id, (exitsByActor.get(opponent.id) || 0) + 1);
    if (exiting.length) {
      if (trigger || exiting.length > 1) throw Object.assign(new Error('this example supports one opportunity-attack trigger per movement command'), { code: 'unsupported' });
      const opponent = exiting[0];
      trigger = { attackerId: opponent.id, from: { ...current }, to: { ...next }, prefixFeet: spent - data.grid.squareFeet, prefixPosition: { ...current }, pathIndex: index };
    }
    current = { ...next };
    if (!trigger) preExit = current;
  }
  if ([...exitsByActor.values()].some(count => count > 1)) throw Object.assign(new Error('repeated opportunity-attack crossings in one path are unsupported'), { code: 'unsupported' });
  return { origin, destination: { ...current }, preExit: trigger?.prefixPosition || preExit, spentFeet: spent, trigger };
}
const revised5eOutcome = (kind, data) => ({ kind, data, visibility: 'public' });

const movementResolver = {
  ref: revised5eRefs.movementResolver,
  randomRequests({ state, input, randomness, resume, principalId }) {
    const data = state.data;
    const actor = actorById(state, input.actorId);
    if (!actor) throw Object.assign(new Error('movement actor is unavailable'), { code: 'unavailable' });
    authorizeActor(actor, principalId);
    const plan = movementPlan(data, actor, input.path);
    if (!resume || !plan.trigger) return [];
    const decisions = resume.reaction.decisions;
    const chosen = decisions.find(item => item.decision === 'accept' && item.actionId === 'example.revised5e.opportunity-attack');
    if (!chosen || resume.reaction.status !== 'resolved') return [];
    const attacker = actorById(state, plan.trigger.attackerId), targetAtTrigger = { ...actor, position: plan.trigger.preExit || plan.trigger.prefixPosition };
    const attack = randomness.find(item => item.requestId === 'opportunity-d20');
    if (!attack) return [{ requestId: 'opportunity-d20', kind: 'die', count: 1, sides: 20, visibility: 'public' }];
    const total = attack.values[0] + attacker.abilityModifiers[attacker.weapon.attackAbility] + (attacker.weapon.proficient ? attacker.proficiencyBonus : 0);
    if (attack.values[0] === 1 || attack.values[0] !== 20 && total < targetAtTrigger.armorClass) return [];
    const damage = randomness.find(item => item.requestId === 'opportunity-damage');
    return damage ? [] : [{ requestId: 'opportunity-damage', kind: 'pool', count: attack.values[0] === 20 ? 2 : 1, sides: attacker.weapon.damageDie, visibility: 'public' }];
  },
  resolve(input) {
    const data = input.state.data;
    const actor = actorById(input.state, input.input.actorId), plan = movementPlan(data, actor, input.input.path);
    if (plan.trigger) {
      const attacker = actorById(input.state, plan.trigger.attackerId);
      return { outcomes: [], decisions: [], effects: [], continuation: { continuationId: `opportunity:${input.operationId}`, state: { actorId: actor.id, attackerId: attacker.id, path: input.input.path, origin: plan.origin, preExit: plan.preExit, destination: plan.destination, spentFeet: plan.spentFeet, prefixFeet: plan.trigger.prefixFeet, provokingStep: plan.trigger }, resumeOn: 'reaction', expiresAt: new Date(Date.parse(input.logicalTime) + 300000).toISOString(), step: 1, reaction: { ordering: 'priorityThenSubmission', visibility: 'public', audiences: [{ audience: 'campaign-gm', priority: 100, actions: [{ actionId: 'example.revised5e.opportunity-attack', inputSchema: empty, visibility: 'public' }] }] } } };
    }
    const updated = finishMove(data, actor.id, plan.destination, plan.spentFeet, false, plan.origin, input.state.data.round);
    return { outcomes: [revised5eOutcome('revised5e.moved', { actorId: actor.id, from: plan.origin, to: plan.destination, feetSpent: plan.spentFeet, movementRemaining: updated.actors.find(item => item.id === actor.id).movementRemaining })], decisions: [], effects: [patch(input.operationId, 'example.revised5e.encounter-state', input.state.entityId, updated)] };
  },
  resume(input) {
    const data = input.state.data, continuation = input.continuation.state, mover = actorById(input.state, continuation.actorId), attacker = actorById(input.state, continuation.attackerId);
    if (!mover || !attacker || mover.id !== input.input.actorId || attacker.reactionAvailable !== true) throw Object.assign(new Error('opportunity-attack continuation is no longer eligible'), { code: 'conflict' });
    const verifiedPlan = movementPlan(data, mover, continuation.path);
    if (!verifiedPlan.trigger || verifiedPlan.trigger.attackerId !== attacker.id || JSON.stringify(verifiedPlan.origin) !== JSON.stringify(continuation.origin) || JSON.stringify(verifiedPlan.destination) !== JSON.stringify(continuation.destination) || verifiedPlan.spentFeet !== continuation.spentFeet || JSON.stringify(verifiedPlan.preExit) !== JSON.stringify(continuation.preExit)) throw Object.assign(new Error('suspended movement no longer matches its validated path'), { code: 'conflict' });
    const decision = input.reaction.decisions.find(item => item.actionId === 'example.revised5e.opportunity-attack');
    const used = input.reaction.status === 'resolved' && decision?.decision === 'accept';
    let actors = data.actors.map(item => item.id === attacker.id && used ? { ...item, reactionAvailable: false } : item);
    let movementBlocked = false, oaLog;
    if (used) {
      const d20 = randomValues(input.randomness, 'opportunity-d20')[0], modifier = attacker.abilityModifiers[attacker.weapon.attackAbility] + (attacker.weapon.proficient ? attacker.proficiencyBonus : 0), attackTotal = d20 + modifier;
      const hit = d20 === 20 || d20 !== 1 && attackTotal >= mover.armorClass;
      const damageRolls = hit ? randomValues(input.randomness, 'opportunity-damage') : [], damageModifier = attacker.abilityModifiers[attacker.weapon.attackAbility];
      const damage = hit ? Math.max(0, damageRolls.reduce((sum, value) => sum + value, 0) + damageModifier) : 0;
      const remainingHitPoints = Math.max(0, mover.currentHitPoints - damage); movementBlocked = remainingHitPoints === 0;
      actors = actors.map(item => item.id === mover.id ? { ...item, currentHitPoints: remainingHitPoints } : item);
      oaLog = { round: data.round, actorId: attacker.id, actorName: attacker.name, targetId: mover.id, targetName: mover.name, kind: !hit ? 'opportunity-miss' : movementBlocked ? 'opportunity-defeat' : d20 === 20 ? 'opportunity-critical' : 'opportunity-hit', d20, attackTotal, armorClass: mover.armorClass, damageRolls, damageModifier: hit ? damageModifier : 0, damage, remainingHitPoints, defeated: movementBlocked };
    }
    const destination = movementBlocked ? continuation.preExit : continuation.destination;
    const spent = movementBlocked ? continuation.prefixFeet : continuation.spentFeet;
    const moved = finishMove({ ...data, actors }, mover.id, destination, spent, movementBlocked, continuation.origin, data.round);
    const outcomes = [revised5eOutcome(used ? 'revised5e.opportunity-attack' : 'revised5e.opportunity-declined', { attackerId: attacker.id, moverId: mover.id, result: oaLog || null, resumed: !movementBlocked, finalPosition: destination, feetSpent: spent })];
    return { outcomes, decisions: oaLog ? [{ id: `${input.operationId}.opportunity-attack`, data: oaLog, visibility: 'public' }] : [], effects: [patch(input.operationId, 'example.revised5e.encounter-state', input.state.entityId, { ...moved, combatLog: oaLog ? [...moved.combatLog, oaLog].slice(-100) : moved.combatLog })] };
  }
};

const secondWindResolver = {
  ref: revised5eRefs.secondWindResolver,
  randomRequests({ state, input, randomness, principalId }) {
    const actor = actorById(state, input.actorId);
    if (!actor || state.data.status !== 'active' || state.data.initiativeOrder[state.data.currentTurnIndex] !== actor.id || actor.currentHitPoints <= 0 || actor.classId !== 'fighter' || actor.classLevel < 1 || actor.secondWindUses <= 0 || !actor.bonusActionAvailable) throw Object.assign(new Error('Second Wind is not legal for this actor or turn'), { code: 'conflict' });
    authorizeActor(actor, principalId);
    return randomValues(randomness, 'second-wind-healing').length ? [] : [{ requestId: 'second-wind-healing', kind: 'die', count: 1, sides: 10, visibility: 'public' }];
  },
  resolve(input) {
    const data = input.state.data, actor = actorById(input.state, input.input.actorId), roll = randomValues(input.randomness, 'second-wind-healing')[0];
    if (!actor || data.status !== 'active' || data.initiativeOrder[data.currentTurnIndex] !== actor.id || actor.currentHitPoints <= 0 || actor.classId !== 'fighter' || actor.classLevel < 1 || actor.secondWindUses <= 0 || !actor.bonusActionAvailable || !Number.isInteger(roll) || roll < 1 || roll > 10) throw Object.assign(new Error('Second Wind is not legal or its host healing die is missing'), { code: 'conflict' });
    authorizeActor(actor, input.principalId);
    const healedTo = Math.min(actor.maximumHitPoints, actor.currentHitPoints + roll + actor.classLevel), healing = healedTo - actor.currentHitPoints;
    const uses = actor.secondWindUses - 1;
    const log = { round: data.round, actorId: actor.id, actorName: actor.name, targetId: actor.id, targetName: actor.name, kind: 'second-wind', healingRoll: roll, healingBonus: actor.classLevel, healing, remainingHitPoints: healedTo, resourceUsesRemaining: uses, defeated: false };
    const updated = { ...data, actors: data.actors.map(item => item.id === actor.id ? { ...item, currentHitPoints: healedTo, secondWindUses: uses, bonusActionAvailable: false } : item), combatLog: [...data.combatLog, log].slice(-100) };
    return { outcomes: [outcome('revised5e.second-wind', log)], decisions: [{ id: `${input.operationId}.second-wind`, data: { actorId: actor.id, healingDie: roll, fighterLevel: actor.classLevel, healing, currentHitPoints: healedTo, maximumHitPoints: actor.maximumHitPoints, usesRemaining: uses }, visibility: 'public' }], effects: [patch(input.operationId, 'example.revised5e.encounter-state', input.state.entityId, updated)] };
  }
};

const shortRestResolver = {
  ref: revised5eRefs.shortRestResolver,
  randomRequests({ state, principalId }) {
    if (principalId !== 'gm' || state.data.status !== 'complete') throw Object.assign(new Error('GM must confirm a completed one-hour Short Rest after combat'), { code: 'conflict' });
    return [];
  },
  resolve(input) {
    const data = input.state.data;
    if (input.principalId !== 'gm' || data.status !== 'complete') throw Object.assign(new Error('GM must confirm a completed one-hour Short Rest after combat'), { code: 'conflict' });
    const eligible = data.actors.filter(actor => actor.classId === 'fighter' && actor.classLevel > 0 && actor.currentHitPoints > 0);
    const recovered = eligible.map(actor => ({ actorId: actor.id, usesRestored: Math.min(1, actor.secondWindMaximum - actor.secondWindUses), usesRemaining: Math.min(actor.secondWindMaximum, actor.secondWindUses + 1) }));
    const actors = data.actors.map(actor => { const result = recovered.find(item => item.actorId === actor.id); return result ? { ...actor, secondWindUses: result.usesRemaining } : actor; });
    const logs = recovered.map(result => { const actor = actorById(input.state, result.actorId); return { round: data.round, actorId: actor.id, actorName: actor.name, targetId: actor.id, targetName: actor.name, kind: 'short-rest', healing: 0, remainingHitPoints: actor.currentHitPoints, resourceUsesRemaining: result.usesRemaining, defeated: false }; });
    const updated = { ...data, actors, shortRestCount: (data.shortRestCount || 0) + 1, combatLog: [...data.combatLog, ...logs].slice(-100) };
    return { outcomes: [outcome('revised5e.short-rest-completed', { shortRestCount: updated.shortRestCount, recovered })], decisions: [], effects: [patch(input.operationId, 'example.revised5e.encounter-state', input.state.entityId, updated)] };
  }
};

const disengageResolver = {
  ref: revised5eRefs.disengageResolver,
  randomRequests({ state, input, principalId }) {
    const actor = actorById(state, input.actorId);
    if (!actor || state.data.status !== 'active' || state.data.initiativeOrder[state.data.currentTurnIndex] !== actor.id || actor.currentHitPoints <= 0 || state.data.actionsUsed.includes(actor.id)) throw Object.assign(new Error('Disengage is not legal in the current turn'), { code: 'conflict' });
    authorizeActor(actor, principalId);
    return [];
  },
  resolve(input) {
    const data = input.state.data, actor = actorById(input.state, input.input.actorId);
    if (!actor) throw Object.assign(new Error('Disengage actor is unavailable'), { code: 'unavailable' });
    if (data.status !== 'active' || data.initiativeOrder[data.currentTurnIndex] !== actor.id || actor.currentHitPoints <= 0 || data.actionsUsed.includes(actor.id)) throw Object.assign(new Error('Disengage is not legal in the current turn'), { code: 'conflict' });
    const updated = { ...data, actors: data.actors.map(item => item.id === actor.id ? { ...item, disengaged: true } : item), actionsUsed: [...data.actionsUsed, actor.id] };
    return { outcomes: [revised5eOutcome('revised5e.disengaged', { actorId: actor.id })], decisions: [], effects: [patch(input.operationId, 'example.revised5e.encounter-state', input.state.entityId, updated)] };
  }
};

const endTurnResolver = {
  ref: revised5eRefs.endTurnResolver,
  randomRequests({ state, input, principalId }) {
    const actor = actorById(state, input.actorId);
    if (!actor || state.data.status !== 'active' || state.data.initiativeOrder[state.data.currentTurnIndex] !== actor.id || actor.currentHitPoints <= 0) throw Object.assign(new Error('turn cannot be ended from this encounter state'), { code: 'conflict' });
    authorizeActor(actor, principalId);
    return [];
  },
  resolve(input) {
    const data = input.state.data, actor = actorById(input.state, input.input.actorId), currentIndex = data.currentTurnIndex;
    if (!actor || data.status !== 'active' || data.initiativeOrder[currentIndex] !== actor.id || actor.currentHitPoints <= 0) throw Object.assign(new Error('turn cannot be ended from this encounter state'), { code: 'conflict' });
    const wraps = currentIndex === data.initiativeOrder.length - 1, nextIndex = (currentIndex + 1) % data.initiativeOrder.length, nextId = data.initiativeOrder[nextIndex];
    const actors = data.actors.map(item => item.id === nextId ? { ...item, movementRemaining: item.speed, reactionAvailable: true, bonusActionAvailable: true, disengaged: false } : item);
    const updated = { ...data, actors, actionsUsed: wraps ? [] : [...new Set([...data.actionsUsed, actor.id])], currentTurnIndex: nextIndex, round: wraps ? data.round + 1 : data.round };
    return { outcomes: [revised5eOutcome('revised5e.turn-ended', { actorId: actor.id, nextActorId: nextId, round: updated.round })], decisions: [], effects: [patch(input.operationId, 'example.revised5e.encounter-state', input.state.entityId, updated)] };
  }
};

function finishMove(data, actorId, destination, feetSpent, stoppedByDefeat, origin, round) {
  const actors = data.actors.map(actor => actor.id === actorId ? { ...actor, position: { ...destination }, movementRemaining: Math.max(0, actor.movementRemaining - feetSpent) } : actor);
  const moved = actors.find(actor => actor.id === actorId);
  return { ...data, actors, movementLog: [...(data.movementLog || []), { round, actorId, actorName: moved.name, from: { ...origin }, to: { ...destination }, feetSpent, remaining: moved.movementRemaining, stoppedByDefeat }].slice(-100) };
}

export const revised5eResolvers = [initResolver, attackResolver, movementResolver, disengageResolver, endTurnResolver, secondWindResolver, shortRestResolver];
const mergeEffect = {
  ...revised5eRefs.encounterEffect, atomic: true, conflict: 'reject-overlap', targetType: revised5eEncounter.typeId, targetVisibility: 'public',
  payloadSchema: object({ state: { type: 'object', properties: {}, additionalProperties: true } }),
  eventKind: 'revised5e.encounter-updated', eventVisibility: 'public',
  eventSchema: object({ effectId: stringId, revision: { type: 'integer', minimum: 1, maximum: 1000000 } }),
  apply: ({ entity, effect }) => {
    const next = effect.payload.state;
    return { data: next, revision: entity.revision + 1, event: { kind: 'revised5e.encounter-updated', visibility: 'public', payload: { effectId: effect.effectId, revision: entity.revision + 1 } } };
  }
};
export const revised5eEffectHandlers = [mergeEffect];

export const revised5eAuthorizeIntent = ({ member, entity, command, request }) => {
  if (command.commandId !== 'example.revised5e.attack' || member.role === 'gm') return true;
  const actor = entity.data.actors.find(item => item.id === request.input?.actorId);
  return actor?.kind === 'player' && actor.ownerPrincipalId === member.principalId;
};
