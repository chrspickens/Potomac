import type { CapabilityLock, JsonValue, UiCapabilityRef, UiContribution, UiDescriptorCatalog, UiWorkflowProjection } from '@potomac/contracts';

const ref = (id: string, digest: string): UiCapabilityRef => ({ id, apiVersion: '1.0.0', implementationVersion: '1.0.0', digest: `sha256:${digest}` });
export const uiFixtureRefs = {
  reactorEntity: ref('example.starship.reactor', '9199e4842eb30afbaa418f94ff3adfb13927381a558aa6fc8623ccf8fa277c2b'),
  starshipCommands: ref('example.starship.commands', '17120ea454fc2de17954f2ef126e9a49e5aff0aca2e7933ce4c0684cce73e482'),
  engineering: ref('example.starship.engineering', 'c2f0b9042d8e07fabf569121e00aeb8b00a2c433e29af62e205222bcb7c410c6'),
  starshipUi: ref('example.starship.ui', '7ba47fe829352be1c556516e8aceeada20849f59d1edda374d5a0de9fcc6aaf1'),
  d20Entity: ref('probe.d20.actor', 'f788e8e2f2d2e350276ecb5d3ecb0e9c84d263dabb6380e3dd5d2ff35c5677ba'),
  d20Ui: ref('probe.d20.actor-sheet', '347724f4ae4913e6dcfac261141a9cae0d21482cc60330b92f0b75264235ded4'),
  poolEntity: ref('probe.dice-pool.actor', 'ce52a9d1c1086d716fb706a0a51b85dd3b1548e40e58a587a3643c3e3e8b494c'),
  poolUi: ref('probe.dice-pool.stress-tracker', '08f561f722c5d5b7441fbbf0b4f2bd7f30a8101e00b4be4347051d34e196ce8a'),
  d20Commands: ref('probe.d20.commands', '4f3c0d4a26a41bdbd392ada8a5025dd16895795214ee1133fb10353cf75b639e'),
  poolCommands: ref('probe.dice-pool.commands', 'c0f6e3c6e27af5e5a9b597229e2919b8c22da8c03f2f2561ce6e5c45f5b9ceda'),
};

const number = { type: 'integer' as const, minimum: 0, maximum: 100 };
const reactorSchema: JsonValue = {
  type: 'object',
  properties: {
    power: number,
    safe: { type: 'boolean' },
    allocations: { type: 'object', properties: { propulsion: number, lifeSupport: number }, required: ['propulsion', 'lifeSupport'], additionalProperties: false },
    engineeringLog: { type: 'array', items: { type: 'string', maxLength: 160 }, maxItems: 20 },
  },
  required: ['power', 'safe', 'allocations', 'engineeringLog'],
  additionalProperties: false,
};
const allocationSchema: JsonValue = { type: 'object', properties: { subsystem: { type: 'string', enum: ['propulsion', 'lifeSupport'] }, amount: { type: 'integer', minimum: 0, maximum: 100 } }, required: ['subsystem', 'amount'], additionalProperties: false };
const findingSchema: JsonValue = { type: 'object', properties: { finding: { type: 'string', title: 'Engineering finding', minLength: 1, maxLength: 120 } }, required: ['finding'], additionalProperties: false };
const toolSchema: JsonValue = { type: 'object', properties: { tool: { type: 'string', title: 'Stabilization tool', minLength: 1, maxLength: 80 } }, required: ['tool'], additionalProperties: false };
const emptySchema: JsonValue = { type: 'object', properties: {}, required: [], additionalProperties: false };
const reactorWorkflows = [{
  workflowTypeId: 'example.starship.engineering.reactor-recovery', capability: uiFixtureRefs.engineering,
  states: ['example.starship.engineering.unassessed', 'example.starship.engineering.isolated', 'example.starship.engineering.safe', 'example.starship.engineering.aborted'],
  transitions: [
    { transitionId: 'example.starship.engineering.inspect-step', commandId: 'example.starship.engineering.inspect', from: ['example.starship.engineering.unassessed'], to: 'example.starship.engineering.isolated', kind: 'transition' as const, participantPolicy: 'owner-or-participant' as const },
    { transitionId: 'example.starship.engineering.stabilize-step', commandId: 'example.starship.engineering.stabilize', from: ['example.starship.engineering.isolated'], to: 'example.starship.engineering.safe', kind: 'transition' as const, participantPolicy: 'owner-or-participant' as const },
    { transitionId: 'example.starship.engineering.cancel-step', commandId: 'example.starship.engineering.cancel', from: ['example.starship.engineering.unassessed', 'example.starship.engineering.isolated'], to: 'example.starship.engineering.aborted', kind: 'cancel' as const, participantPolicy: 'owner-or-participant' as const },
  ],
}];

const contribution = (value: Omit<UiContribution, 'contractVersion' | 'contributionVersion' | 'capability'>): UiContribution => ({ contractVersion: 1, contributionVersion: '1.0.0', capability: uiFixtureRefs.starshipUi, ...value });

/** Demonstrates the UI contract against the matching starship extension descriptors from examples/example.starship/v2/extensions.mjs. */
export const starshipUiContributions: UiContribution[] = [
  contribution({
    contributionId: 'example.starship.reactor.sheet', kind: 'sheet', entityTypeId: 'example.starship.reactor', entityCapability: uiFixtureRefs.reactorEntity, entitySchemaVersion: 1, entitySchema: reactorSchema,
    commands: [{ commandId: 'example.starship.reactor.allocate-power', capability: uiFixtureRefs.starshipCommands, inputSchema: allocationSchema }], workflows: [], slots: ['example.starship.reactor.controls'],
    nodes: [
      { kind: 'section', id: 'example.starship.reactor.status-section', label: 'Reactor status', children: [
        { kind: 'display', id: 'example.starship.reactor.power-display', path: 'power', label: 'Available power' },
        { kind: 'display', id: 'example.starship.reactor.safety-display', path: 'safe', label: 'Safety interlock' },
        { kind: 'resource', id: 'example.starship.reactor.propulsion-meter', label: 'Propulsion allocation', currentPath: 'allocations.propulsion', maximumPath: 'power' },
      ] },
      { kind: 'slot', id: 'example.starship.reactor.controls-slot', slotId: 'example.starship.reactor.controls' },
    ],
  }),
  contribution({
    contributionId: 'example.starship.reactor.power-form', kind: 'form', entityTypeId: 'example.starship.reactor', entityCapability: uiFixtureRefs.reactorEntity, entitySchemaVersion: 1, entitySchema: reactorSchema,
    commands: [{ commandId: 'example.starship.reactor.allocate-power', capability: uiFixtureRefs.starshipCommands, inputSchema: allocationSchema }], workflows: [], slots: [],
    nodes: [{ kind: 'form', id: 'example.starship.reactor.allocate-form', commandId: 'example.starship.reactor.allocate-power', label: 'Allocate power' }],
  }),
  contribution({
    contributionId: 'example.starship.engineering.panel', kind: 'panel', entityTypeId: 'example.starship.reactor', entityCapability: uiFixtureRefs.reactorEntity, entitySchemaVersion: 1, entitySchema: reactorSchema,
    commands: [
      { commandId: 'example.starship.engineering.inspect', capability: uiFixtureRefs.starshipCommands, inputSchema: findingSchema },
      { commandId: 'example.starship.engineering.stabilize', capability: uiFixtureRefs.starshipCommands, inputSchema: toolSchema },
      { commandId: 'example.starship.engineering.cancel', capability: uiFixtureRefs.starshipCommands, inputSchema: emptySchema },
    ], workflows: reactorWorkflows, slots: [],
    nodes: [
      { kind: 'workflow-status', id: 'example.starship.engineering.status', workflowTypeId: reactorWorkflows[0].workflowTypeId, label: 'Engineering workflow' },
      { kind: 'form', id: 'example.starship.engineering.inspect-form', commandId: 'example.starship.engineering.inspect', label: 'Record inspection', workflowTypeId: reactorWorkflows[0].workflowTypeId, transitionId: 'example.starship.engineering.inspect-step', visibleWhenWorkflowState: 'example.starship.engineering.unassessed' },
      { kind: 'form', id: 'example.starship.engineering.stabilize-form', commandId: 'example.starship.engineering.stabilize', label: 'Stabilize reactor', workflowTypeId: reactorWorkflows[0].workflowTypeId, transitionId: 'example.starship.engineering.stabilize-step', visibleWhenWorkflowState: 'example.starship.engineering.isolated' },
      { kind: 'command', id: 'example.starship.engineering.cancel-action', commandId: 'example.starship.engineering.cancel', label: 'Cancel recovery', workflowTypeId: reactorWorkflows[0].workflowTypeId, transitionId: 'example.starship.engineering.cancel-step', visibleWhenWorkflowState: 'example.starship.engineering.unassessed' },
    ],
  }),
  contribution({
    contributionId: 'example.starship.reactor.brick', kind: 'brick', entityTypeId: 'example.starship.reactor', entityCapability: uiFixtureRefs.reactorEntity, entitySchemaVersion: 1, entitySchema: reactorSchema,
    commands: [{ commandId: 'example.starship.reactor.allocate-power', capability: uiFixtureRefs.starshipCommands, inputSchema: allocationSchema }], workflows: [], slots: ['example.starship.reactor.brick-tools'],
    nodes: [
      { kind: 'display', id: 'example.starship.reactor.brick-power', path: 'power', label: 'Reactor power' },
      { kind: 'resource', id: 'example.starship.reactor.brick-propulsion', label: 'Propulsion', currentPath: 'allocations.propulsion', maximumPath: 'power' },
      { kind: 'slot', id: 'example.starship.reactor.brick-slot', slotId: 'example.starship.reactor.brick-tools' },
    ],
  }),
];

export const starshipUiCatalog: UiDescriptorCatalog = {
  entities: [{ typeId: 'example.starship.reactor', schemaVersion: 1, capability: uiFixtureRefs.reactorEntity, schema: reactorSchema }],
  commands: [
    { commandId: 'example.starship.reactor.allocate-power', entityTypeId: 'example.starship.reactor', capability: uiFixtureRefs.starshipCommands, inputSchema: allocationSchema },
    { commandId: 'example.starship.engineering.inspect', entityTypeId: 'example.starship.reactor', capability: uiFixtureRefs.starshipCommands, inputSchema: findingSchema },
    { commandId: 'example.starship.engineering.stabilize', entityTypeId: 'example.starship.reactor', capability: uiFixtureRefs.starshipCommands, inputSchema: toolSchema },
    { commandId: 'example.starship.engineering.cancel', entityTypeId: 'example.starship.reactor', capability: uiFixtureRefs.starshipCommands, inputSchema: emptySchema },
  ],
  workflows: [{ workflowType: reactorWorkflows[0].workflowTypeId, entityTypeId: 'example.starship.reactor', capability: uiFixtureRefs.engineering,
    states: reactorWorkflows[0].states.map(stateId => ({ stateId, schema: { type: 'object', properties: {}, additionalProperties: false } })),
    transitions: reactorWorkflows[0].transitions,
  }],
};

const d20Schema: JsonValue = { type: 'object', properties: { name: { type: 'string' }, attributes: { type: 'object', properties: { grit: { type: 'integer' }, wit: { type: 'integer' } }, required: ['grit', 'wit'] } }, required: ['name', 'attributes'] };
const d20Input: JsonValue = { type: 'object', properties: { attribute: { type: 'string', enum: ['grit', 'wit'] }, difficulty: { type: 'integer', minimum: 1, maximum: 30 } }, required: ['attribute', 'difficulty'] };
export const d20ActorSheetProbe: UiContribution = {
  contractVersion: 1, contributionId: 'probe.d20.actor-sheet.view', contributionVersion: '1.0.0', kind: 'sheet', capability: uiFixtureRefs.d20Ui,
  entityTypeId: 'probe.d20.actor', entityCapability: uiFixtureRefs.d20Entity, entitySchemaVersion: 1, entitySchema: d20Schema,
  commands: [{ commandId: 'probe.d20.check', capability: uiFixtureRefs.d20Commands, inputSchema: d20Input }], workflows: [], slots: [],
  nodes: [
    { kind: 'display', id: 'probe.d20.name', path: 'name', label: 'Character' },
    { kind: 'display', id: 'probe.d20.grit', path: 'attributes.grit', label: 'Grit' },
    { kind: 'display', id: 'probe.d20.wit', path: 'attributes.wit', label: 'Wit' },
    { kind: 'form', id: 'probe.d20.check-form', commandId: 'probe.d20.check', label: 'Roll check' },
  ],
};
export const d20UiCatalog: UiDescriptorCatalog = {
  entities: [{ typeId: 'probe.d20.actor', schemaVersion: 1, capability: uiFixtureRefs.d20Entity, schema: d20Schema }],
  commands: [{ commandId: 'probe.d20.check', entityTypeId: 'probe.d20.actor', capability: uiFixtureRefs.d20Commands, inputSchema: d20Input }], workflows: [],
};

const poolSchema: JsonValue = { type: 'object', properties: { name: { type: 'string' }, pool: { type: 'integer', minimum: 0 }, stress: { type: 'object', properties: { current: { type: 'integer', minimum: 0 }, maximum: { type: 'integer', minimum: 1 } }, required: ['current', 'maximum'] } }, required: ['name', 'pool', 'stress'] };
export const dicePoolStressProbe: UiContribution = {
  contractVersion: 1, contributionId: 'probe.dice-pool.stress.view', contributionVersion: '1.0.0', kind: 'resource', capability: uiFixtureRefs.poolUi,
  entityTypeId: 'probe.dice-pool.actor', entityCapability: uiFixtureRefs.poolEntity, entitySchemaVersion: 1, entitySchema: poolSchema,
  commands: [{ commandId: 'probe.dice-pool.test', capability: uiFixtureRefs.poolCommands, inputSchema: { type: 'object', properties: { intent: { type: 'string', minLength: 1 } }, required: ['intent'] } }], workflows: [], slots: [],
  nodes: [
    { kind: 'display', id: 'probe.dice-pool.name', path: 'name', label: 'Character' },
    { kind: 'display', id: 'probe.dice-pool.pool', path: 'pool', label: 'Current dice pool' },
    { kind: 'resource', id: 'probe.dice-pool.stress', label: 'Stress', currentPath: 'stress.current', maximumPath: 'stress.maximum' },
    { kind: 'form', id: 'probe.dice-pool.test-form', commandId: 'probe.dice-pool.test', label: 'Make a test' },
  ],
};
export const dicePoolUiCatalog: UiDescriptorCatalog = {
  entities: [{ typeId: 'probe.dice-pool.actor', schemaVersion: 1, capability: uiFixtureRefs.poolEntity, schema: poolSchema }],
  commands: [{ commandId: 'probe.dice-pool.test', entityTypeId: 'probe.dice-pool.actor', capability: uiFixtureRefs.poolCommands, inputSchema: { type: 'object', properties: { intent: { type: 'string', minLength: 1 } }, required: ['intent'] } }], workflows: [],
};

const locked = (identity: UiCapabilityRef) => ({ id: identity.id, apiVersion: identity.apiVersion, implementationVersion: identity.implementationVersion, digest: identity.digest, source: 'bundled' as const, optional: false });
export const starshipUiLock: CapabilityLock = {
  lockVersion: 1, campaignId: 'ui-example-campaign', rootModule: { id: uiFixtureRefs.reactorEntity.id, version: uiFixtureRefs.reactorEntity.implementationVersion, digest: uiFixtureRefs.reactorEntity.digest },
  entries: [uiFixtureRefs.reactorEntity, uiFixtureRefs.starshipCommands, uiFixtureRefs.engineering, uiFixtureRefs.starshipUi].map(locked),
};
export const probeUiLock = (campaignId: string, entity: UiCapabilityRef, ui: UiCapabilityRef, command: UiCapabilityRef): CapabilityLock => ({
  lockVersion: 1, campaignId, rootModule: { id: entity.id, version: entity.implementationVersion, digest: entity.digest }, entries: [entity, ui, command].map(locked),
});
export const engineeringWorkflowView: UiWorkflowProjection = { workflowId: 'workflow-demo', campaignId: 'ui-example-campaign', entityId: 'reactor-demo', workflowTypeId: reactorWorkflows[0].workflowTypeId, capability: uiFixtureRefs.engineering, revision: 1, continuationId: 'continuation-demo', state: reactorWorkflows[0].states[0], status: 'active' };
