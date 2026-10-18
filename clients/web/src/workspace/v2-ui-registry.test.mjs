import assert from 'node:assert/strict';
import test from 'node:test';
import { UiContributionRegistry, readUiPath, validateUiContribution } from './v2-ui-registry.ts';
import { d20ActorSheetProbe, d20UiCatalog, dicePoolStressProbe, dicePoolUiCatalog, probeUiLock, starshipUiCatalog, starshipUiContributions, starshipUiLock } from './v2-ui-fixtures.ts';

test('registers exact-pinned starship sheet, form, engineering panel, and reusable brick descriptors', () => {
  const registry = new UiContributionRegistry(starshipUiLock, starshipUiLock.campaignId, starshipUiCatalog);
  for (const contribution of starshipUiContributions) registry.register(contribution);
  assert.deepEqual(registry.list().map(item => item.kind).sort(), ['brick', 'form', 'panel', 'sheet']);
  assert.equal(registry.get('example.starship.reactor.sheet').nodes[1].kind, 'slot');
  assert.equal(registry.get('example.starship.engineering.panel').workflows[0].transitions.length, 3);
});

test('requires the exact UI, entity, command, and workflow identities in the campaign lock', () => {
  const changedDigest = structuredClone(starshipUiLock);
  changedDigest.entries.find(entry => entry.id === 'example.starship.ui').digest = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => validateUiContribution(starshipUiContributions[0], changedDigest, changedDigest.campaignId, starshipUiCatalog), /not exactly pinned/);
  assert.throws(() => validateUiContribution(starshipUiContributions[0], starshipUiLock, 'different-campaign', starshipUiCatalog), /invalid campaign or capability identity/);

  const removedCommandPin = structuredClone(starshipUiLock);
  removedCommandPin.entries = removedCommandPin.entries.filter(entry => entry.id !== 'example.starship.commands');
  assert.throws(() => validateUiContribution(starshipUiContributions[0], removedCommandPin, removedCommandPin.campaignId, starshipUiCatalog), /not exactly pinned/);
});

test('rejects malformed schemas, unsafe field paths, missing commands, and unpinned workflow contracts', () => {
  const badPath = structuredClone(starshipUiContributions[0]);
  badPath.nodes[0].children[0].path = 'gmNotes.private';
  assert.throws(() => validateUiContribution(badPath, starshipUiLock, starshipUiLock.campaignId, starshipUiCatalog), /undeclared display field/);

  const badCommand = structuredClone(starshipUiContributions[0]);
  badCommand.nodes.push({ kind: 'command', id: 'example.starship.reactor.unknown-command', commandId: 'example.starship.erase-campaign', label: 'Delete' });
  assert.throws(() => validateUiContribution(badCommand, starshipUiLock, starshipUiLock.campaignId, starshipUiCatalog), /undeclared command/);

  const malformedForm = structuredClone(starshipUiContributions[1]);
  malformedForm.commands[0].inputSchema.properties.amount = { type: 'object', properties: {} };
  const malformedCatalog = structuredClone(starshipUiCatalog);
  malformedCatalog.commands.find(item => item.commandId === malformedForm.commands[0].commandId).inputSchema.properties.amount = { type: 'object', properties: {} };
  assert.throws(() => validateUiContribution(malformedForm, starshipUiLock, starshipUiLock.campaignId, malformedCatalog), /form field type the host renderer cannot collect/);

  const mismatch = structuredClone(starshipUiContributions[1]);
  mismatch.commands[0].inputSchema.properties.amount.maximum = 1000;
  assert.throws(() => validateUiContribution(mismatch, starshipUiLock, starshipUiLock.campaignId, starshipUiCatalog), /incompatible with its declared extension contract/);

  const missingWorkflowPin = structuredClone(starshipUiLock);
  missingWorkflowPin.entries = missingWorkflowPin.entries.filter(entry => entry.id !== 'example.starship.engineering');
  assert.throws(() => validateUiContribution(starshipUiContributions[2], missingWorkflowPin, missingWorkflowPin.campaignId, starshipUiCatalog), /not exactly pinned/);
});

test('slot composition requires a registered, same-entity contribution and rejects unknown slots/cycles', () => {
  const registry = new UiContributionRegistry(starshipUiLock, starshipUiLock.campaignId, starshipUiCatalog);
  for (const contribution of starshipUiContributions) registry.register(contribution);
  const composed = registry.compose('example.starship.reactor.sheet', {
    'example.starship.reactor.sheet': { 'example.starship.reactor.controls': ['example.starship.reactor.power-form'] },
  });
  assert.equal(composed.nodes[1].kind, 'form');
  assert.throws(() => registry.compose('example.starship.reactor.sheet', { 'example.starship.reactor.sheet': { 'example.starship.unknown-slot': ['example.starship.reactor.power-form'] } }), /undeclared slot/);
  assert.throws(() => registry.compose('example.starship.reactor.sheet', { 'example.starship.reactor.sheet': { 'example.starship.reactor.controls': ['example.starship.reactor.sheet'] } }), /cycle/);
});

test('d20-shaped sheet and dice-pool stress tracker use the same generic contribution contract', () => {
  const d20Lock = probeUiLock('d20-probe', { ...d20ActorSheetProbe.entityCapability }, d20ActorSheetProbe.capability, d20ActorSheetProbe.commands[0].capability);
  const poolLock = probeUiLock('pool-probe', dicePoolStressProbe.entityCapability, dicePoolStressProbe.capability, dicePoolStressProbe.commands[0].capability);
  const d20 = new UiContributionRegistry(d20Lock, 'd20-probe', d20UiCatalog); d20.register(d20ActorSheetProbe);
  const pool = new UiContributionRegistry(poolLock, 'pool-probe', dicePoolUiCatalog); pool.register(dicePoolStressProbe);
  assert.equal(d20.get('probe.d20.actor-sheet.view').nodes.filter(node => node.kind === 'display').length, 3);
  assert.equal(pool.get('probe.dice-pool.stress.view').nodes.find(node => node.kind === 'resource').kind, 'resource');
});

test('host-projected data reads only supplied fields; missing private fields are not synthesized', () => {
  const visible = { power: 8, allocations: { propulsion: 4 } };
  assert.equal(readUiPath(visible, 'allocations.propulsion'), 4);
  assert.equal(readUiPath(visible, 'gmNotes'), undefined);
  assert.equal(readUiPath(visible, 'gmNotes.private'), undefined);
});
