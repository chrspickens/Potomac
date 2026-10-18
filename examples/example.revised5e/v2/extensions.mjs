const ref = (id, digest) => ({ id, apiVersion: '1.0.0', implementationVersion: '1.0.0', digest: `sha256:${digest}` });
export const revised5eRefs = {
  entity: ref('example.revised5e.encounter', '9c96a631d26441e3968cae778679283d4e9ec65f31a115b10164a0acf771263e'),
  commands: ref('example.revised5e.commands', 'dd4020117252dfd94bdaef57fe1771a5d0110e9a742219da1261c91701168a65'),
  ui: ref('example.revised5e.combat-ui', '55c898ea717a254a12802826c1b18ff0350420bbf884ddc109c62b8083da15a9'),
  initiativeResolver: ref('example.revised5e.initiative-resolver', '1bb7a6a6491b93c62ab3ece968d6b97b0dcd4382a4dcc3bd807bad5c18cad3a4'),
  attackResolver: ref('example.revised5e.attack-resolver', '55a284c32088fb77f4a3d342534a0e59f3177a6eaa4b16c41339f72a2ced24f6'),
  encounterEffect: ref('example.revised5e.encounter-state', 'be939a00e5f080b573b149a00a889747d0d887c565ba75a1d4599ba7f1cc7b11')
};

const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const stringId = { type: 'string', minLength: 1, maxLength: 80 };
const actorSchema = object({
  id: stringId, name: { type: 'string', minLength: 1, maxLength: 80 }, kind: { type: 'string', enum: ['player', 'enemy'] },
  ownerPrincipalId: { type: 'string', minLength: 1, maxLength: 128 },
  abilityModifiers: object({ strength: { type: 'integer', minimum: -5, maximum: 10 }, dexterity: { type: 'integer', minimum: -5, maximum: 10 } }),
  proficiencyBonus: { type: 'integer', minimum: 2, maximum: 6 }, armorClass: { type: 'integer', minimum: 1, maximum: 30 },
  maximumHitPoints: { type: 'integer', minimum: 1, maximum: 500 }, currentHitPoints: { type: 'integer', minimum: 0, maximum: 500 },
  initiativeModifier: { type: 'integer', minimum: -5, maximum: 10 },
  weapon: object({ name: { type: 'string', minLength: 1, maxLength: 40 }, damageDie: { type: 'integer', enum: [4, 6, 8, 10, 12] }, damageType: { type: 'string', enum: ['bludgeoning', 'piercing', 'slashing'] }, attackAbility: { type: 'string', enum: ['strength', 'dexterity'] }, proficient: { type: 'boolean' } })
});
const combatLogItem = object({ round: { type: 'integer', minimum: 0 }, actorId: stringId, actorName: stringId, targetId: stringId, targetName: stringId, kind: { type: 'string', enum: ['initiative', 'miss', 'hit', 'critical', 'defeat'] }, d20: { type: 'integer', minimum: 1, maximum: 20 }, attackTotal: { type: 'integer', minimum: -10, maximum: 100 }, armorClass: { type: 'integer', minimum: 1, maximum: 30 }, damageRolls: { type: 'array', maxItems: 2, items: { type: 'integer', minimum: 1, maximum: 12 } }, damageModifier: { type: 'integer', minimum: -5, maximum: 10 }, damage: { type: 'integer', minimum: 0, maximum: 100 }, remainingHitPoints: { type: 'integer', minimum: 0, maximum: 500 }, defeated: { type: 'boolean' } });

export const revised5eEncounter = {
  descriptorVersion: 1, typeId: 'example.revised5e.encounter', schemaVersion: 1, capability: revised5eRefs.entity,
  schema: object({
    title: { type: 'string', minLength: 1, maxLength: 100 }, status: { type: 'string', enum: ['setup', 'active', 'complete'] },
    actors: { type: 'array', minItems: 3, maxItems: 3, items: actorSchema },
    initiativeOrder: { type: 'array', maxItems: 3, items: stringId }, initiativeRolls: { type: 'array', maxItems: 3, items: { type: 'integer', minimum: 1, maximum: 20 } },
    currentTurnIndex: { type: 'integer', minimum: 0, maximum: 2 }, round: { type: 'integer', minimum: 0, maximum: 10000 },
    actionsUsed: { type: 'array', maxItems: 3, items: stringId },
    combatLog: { type: 'array', maxItems: 100, items: combatLogItem }
  }),
  ownership: { kind: 'campaign' }, visibility: ['public'], creationRoles: ['gm'],
  fieldVisibility: [
    { path: 'actors.*.ownerPrincipalId', roles: ['gm'] }
  ],
  migration: { migrationId: 'example.revised5e.encounter.v1-initial', fromSchemaVersion: 0, toSchemaVersion: 1 }
};

const empty = object({});
const outcomeSchema = { type: 'array', minItems: 0, maxItems: 4, items: object({ kind: { type: 'string', minLength: 1, maxLength: 80 }, data: { type: 'object', properties: {}, additionalProperties: true }, visibility: { type: 'string', enum: ['public', 'gm', 'private'] } }) };
const initiativeInput = empty;
const attackInput = object({
  actorId: { type: 'string', enum: ['player-a', 'player-b', 'enemy'] },
  targetId: { type: 'string', enum: ['player-a', 'player-b', 'enemy'] }
});
const gmOnly = { roles: ['gm'], ownership: 'any' };
const enrolledPlayers = { roles: ['gm', 'player'], ownership: 'owner-or-participant' };
const command = (commandId, resolver, inputSchema, permission, effects, effectTargetPolicy = 'source-entity') => ({ descriptorVersion: 1, commandId, capability: revised5eRefs.commands, entityTypeId: revised5eEncounter.typeId, inputSchema, resultSchema: outcomeSchema, permission: { ...permission, effectTargetPolicy }, resolver, effects });
export const revised5eCommands = [
  command('example.revised5e.initialize', revised5eRefs.initiativeResolver, initiativeInput, gmOnly, [revised5eRefs.encounterEffect]),
  command('example.revised5e.attack', revised5eRefs.attackResolver, attackInput, enrolledPlayers, [revised5eRefs.encounterEffect], 'source-entity')
];

const actorById = (state, id) => state.data.actors.find(actor => actor.id === id);
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
    const updated = { ...data, status: 'active', initiativeOrder: order, initiativeRolls: rolls, currentTurnIndex: 0, round: 1, actionsUsed: [], combatLog: [...data.combatLog, ...combatLog].slice(-100) };
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
    const updatedActors = data.actors.map(item => item.id === target.id ? { ...item, currentHitPoints: remainingHitPoints } : item);
    const logEntry = { round: data.round, actorId: actor.id, actorName: actor.name, targetId: target.id, targetName: target.name, kind, d20, attackTotal, armorClass: target.armorClass, damageRolls, damageModifier: hit ? damageModifier : 0, damage, remainingHitPoints, defeated };
    const updated = { ...data, actors: updatedActors, actionsUsed, currentTurnIndex, round, status: defeated ? 'complete' : data.status, combatLog: [...data.combatLog, logEntry].slice(-100) };
    return { outcomes: [outcome(`revised5e.attack.${kind}`, logEntry)], decisions: [{ id: `${input.operationId}.attack`, data: { naturalD20: d20, attackModifier: modifier, attackTotal, armorClass: target.armorClass, hit, critical, damageRolls, damageModifier, damage, defeated }, visibility: 'public' }], effects: [
      patch(input.operationId, 'example.revised5e.encounter-state', input.state.entityId, updated)
    ] };
  }
};

export const revised5eResolvers = [initResolver, attackResolver];
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
