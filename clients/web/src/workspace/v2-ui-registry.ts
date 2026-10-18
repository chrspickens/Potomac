import type { CapabilityLock, JsonValue, UiContribution, UiNode, UiCapabilityRef, UiDescriptorCatalog } from '@potomac/contracts';

const NAMESPACED = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const safeRef = (ref: UiCapabilityRef): boolean => Boolean(ref && NAMESPACED.test(ref.id) && SEMVER.test(ref.apiVersion) && SEMVER.test(ref.implementationVersion) && DIGEST.test(ref.digest));
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value) ?? 'undefined';
const sameRef = (left: UiCapabilityRef, right: UiCapabilityRef): boolean => left.id === right.id && left.apiVersion === right.apiVersion && left.implementationVersion === right.implementationVersion && left.digest === right.digest;
function fail(message: string): never { throw new Error(`invalid_ui_contribution: ${message}`); }
type JsonObject = { [key: string]: JsonValue };
const isJsonObject = (value: JsonValue): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

export function requirePinnedUiCapability(lock: CapabilityLock, campaignId: string, ref: UiCapabilityRef): void {
  if (!safeRef(ref) || lock.campaignId !== campaignId) fail('invalid campaign or capability identity');
  const pinned = lock.entries.some(entry => entry.id === ref.id && entry.apiVersion === ref.apiVersion && entry.implementationVersion === ref.implementationVersion && entry.digest === ref.digest);
  if (!pinned) fail(`capability ${ref.id} is not exactly pinned`);
}

function pathSchema(schema: JsonValue, path: string): JsonValue | undefined {
  const parts = path.split('.');
  let current: JsonValue | undefined = schema;
  for (const part of parts) {
    if (!part || !current || !isJsonObject(current)) return undefined;
    const properties: JsonValue | undefined = current.properties;
    if (!properties || !isJsonObject(properties) || !Object.hasOwn(properties, part)) return undefined;
    current = properties[part];
  }
  return current;
}

function validateSchema(schema: JsonValue, path: string): void {
  if (!schema || !isJsonObject(schema) || schema.type !== 'object' || !schema.properties || !isJsonObject(schema.properties)) fail(`${path} must be an object schema`);
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'title', 'description', 'minLength', 'maxLength', 'minimum', 'maximum', 'enum', 'default']);
  const walk = (value: JsonValue, at: string): void => {
    if (!isJsonObject(value)) fail(`${at} is not a schema`);
    for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${at} uses unsupported schema keyword ${key}`);
    if (value.type === 'object') {
      if (!value.properties || !isJsonObject(value.properties)) fail(`${at}.properties is required`);
      const properties: JsonObject = value.properties;
      if (value.additionalProperties !== undefined && typeof value.additionalProperties !== 'boolean') fail(`${at}.additionalProperties must be boolean`);
      if (Object.keys(properties).some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) fail(`${at} contains an unsafe field name`);
      const required = value.required ?? [];
      if (!Array.isArray(required) || new Set(required).size !== required.length || required.some(key => typeof key !== 'string' || !Object.hasOwn(properties, key))) fail(`${at}.required is invalid`);
      for (const [key, child] of Object.entries(properties)) walk(child, `${at}.${key}`);
      return;
    }
    if (value.type === 'array') {
      if (!value.items) fail(`${at}.items is required`);
      walk(value.items, `${at}[]`);
      return;
    }
    if (!['string', 'integer', 'number', 'boolean'].includes(String(value.type))) fail(`${at}.type is unsupported`);
    if (value.enum !== undefined && (!Array.isArray(value.enum) || value.enum.length === 0 || value.enum.some(item => value.type === 'string' ? typeof item !== 'string' : value.type === 'boolean' ? typeof item !== 'boolean' : typeof item !== 'number' || value.type === 'integer' && !Number.isInteger(item)))) fail(`${at}.enum is invalid`);
    if (value.type === 'string' && (value.minimum !== undefined || value.maximum !== undefined) || (value.type === 'integer' || value.type === 'number') && (value.minLength !== undefined || value.maxLength !== undefined)) fail(`${at} has constraints for the wrong field type`);
    if (value.minLength !== undefined && (typeof value.minLength !== 'number' || !Number.isInteger(value.minLength) || value.minLength < 0) || value.maxLength !== undefined && (typeof value.maxLength !== 'number' || !Number.isInteger(value.maxLength) || value.maxLength < 0) || value.minimum !== undefined && value.maximum !== undefined && (value.minimum as number) > (value.maximum as number)) fail(`${at} has invalid bounds`);
    if (value.type === 'integer' || value.type === 'number') {
      if (value.minimum !== undefined && typeof value.minimum !== 'number' || value.maximum !== undefined && typeof value.maximum !== 'number') fail(`${at} numeric bounds are invalid`);
    }
  };
  walk(schema, path);
}

function validateNodes(nodes: UiNode[], contribution: UiContribution, commandIds: Set<string>, path = 'nodes'): void {
  if (!Array.isArray(nodes)) fail(`${path} must be an array`);
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (!node || typeof node !== 'object' || !NAMESPACED.test(node.id) || nodeIds.has(node.id)) fail(`${path} contains an invalid or duplicate node id`);
    nodeIds.add(node.id);
    if ('visibleWhen' in node && node.visibleWhen && (!node.visibleWhen.path || !pathSchema(contribution.entitySchema, node.visibleWhen.path))) fail(`${node.id} visibility references an undeclared field`);
    if (node.kind === 'group' || node.kind === 'section') validateNodes(node.children, contribution, commandIds, `${path}.${node.id}`);
    else if (node.kind === 'slot') {
      if (!NAMESPACED.test(node.slotId) || !contribution.slots.includes(node.slotId)) fail(`${node.id} references an undeclared slot`);
    } else if (node.kind === 'display') {
      if (!pathSchema(contribution.entitySchema, node.path)) fail(`${node.id} references an undeclared display field`);
    } else if (node.kind === 'resource') {
      const current = pathSchema(contribution.entitySchema, node.currentPath);
      const maximum = pathSchema(contribution.entitySchema, node.maximumPath);
      if (!current || !maximum || !isJsonObject(current) || !isJsonObject(maximum) || current.type !== 'integer' && current.type !== 'number' || maximum.type !== 'integer' && maximum.type !== 'number') fail(`${node.id} references invalid resource fields`);
    } else if (node.kind === 'workflow-status') {
      if (!contribution.workflows.some(workflow => workflow.workflowTypeId === node.workflowTypeId)) fail(`${node.id} references an undeclared workflow`);
    } else if (node.kind === 'command' || node.kind === 'form') {
      if (!commandIds.has(node.commandId)) fail(`${node.id} references an undeclared command`);
      const command = contribution.commands.find(item => item.commandId === node.commandId)!;
      if (Boolean(node.workflowTypeId) !== Boolean(node.transitionId)) fail(`${node.id} must declare both workflow type and transition identity`);
      if (node.workflowTypeId && !contribution.workflows.some(workflow => workflow.workflowTypeId === node.workflowTypeId && workflow.transitions.some(transition => transition.transitionId === node.transitionId && transition.commandId === node.commandId))) fail(`${node.id} references an undeclared workflow transition`);
      if (node.visibleWhenWorkflowState && (!node.workflowTypeId || !contribution.workflows.some(workflow => workflow.workflowTypeId === node.workflowTypeId && workflow.states.includes(node.visibleWhenWorkflowState!)))) fail(`${node.id} references an undeclared workflow state`);
      const schema = command.inputSchema as { properties?: unknown; required?: unknown };
      if (node.kind === 'command' && schema.properties && Object.keys(schema.properties as object).length || node.kind === 'command' && Array.isArray(schema.required) && schema.required.length) fail(`${node.id} command controls must not hide required inputs; use a form`);
    } else fail(`${path} contains an unsupported node kind`);
  }
}

export function validateUiContribution(contribution: UiContribution, lock: CapabilityLock, campaignId: string, catalog: UiDescriptorCatalog): UiContribution {
  if (!contribution || contribution.contractVersion !== 1 || !NAMESPACED.test(contribution.contributionId) || !SEMVER.test(contribution.contributionVersion) || !['sheet', 'panel', 'action-control', 'form', 'display', 'resource', 'brick'].includes(contribution.kind) || !NAMESPACED.test(contribution.entityTypeId) || !Number.isInteger(contribution.entitySchemaVersion) || contribution.entitySchemaVersion < 1) fail('invalid contribution header');
  requirePinnedUiCapability(lock, campaignId, contribution.capability);
  requirePinnedUiCapability(lock, campaignId, contribution.entityCapability);
  validateSchema(contribution.entitySchema, 'entitySchema');
  const entity = catalog.entities.find(item => item.typeId === contribution.entityTypeId);
  if (!entity || entity.schemaVersion !== contribution.entitySchemaVersion || !sameRef(entity.capability, contribution.entityCapability) || canonical(entity.schema) !== canonical(contribution.entitySchema)) fail('entity descriptor does not match the exact contribution reference');
  if (!Array.isArray(contribution.commands) || !Array.isArray(contribution.workflows) || !Array.isArray(contribution.slots) || new Set(contribution.slots).size !== contribution.slots.length || contribution.slots.some(slot => !NAMESPACED.test(slot))) fail('invalid command, workflow or slot declarations');
  const workflowIds = new Set<string>();
  for (const workflow of contribution.workflows) {
    if (!NAMESPACED.test(workflow.workflowTypeId) || workflowIds.has(workflow.workflowTypeId) || !Array.isArray(workflow.transitions) || !Array.isArray(workflow.states) || workflow.states.length === 0 || workflow.states.some(state => !NAMESPACED.test(state))) fail('invalid or duplicate workflow declaration');
    workflowIds.add(workflow.workflowTypeId);
    requirePinnedUiCapability(lock, campaignId, workflow.capability);
    const declaredWorkflow = catalog.workflows.find(item => item.workflowType === workflow.workflowTypeId);
    if (!declaredWorkflow || declaredWorkflow.entityTypeId !== contribution.entityTypeId || !sameRef(declaredWorkflow.capability, workflow.capability) || canonical(workflow.states.slice().sort()) !== canonical(declaredWorkflow.states.map(state => state.stateId).sort()) || workflow.transitions.length !== declaredWorkflow.transitions.length || workflow.transitions.some(item => !declaredWorkflow.transitions.some(declared => declared.transitionId === item.transitionId && declared.commandId === item.commandId))) fail(`workflow ${workflow.workflowTypeId} is missing or incompatible with its declared extension contract`);
    for (const transition of workflow.transitions) if (!NAMESPACED.test(transition.transitionId) || !NAMESPACED.test(transition.commandId)) fail('invalid workflow transition declaration');
  }
  const commandIds = new Set<string>();
  for (const command of contribution.commands) {
    if (!NAMESPACED.test(command.commandId) || commandIds.has(command.commandId)) fail('invalid or duplicate command');
    commandIds.add(command.commandId);
    requirePinnedUiCapability(lock, campaignId, command.capability);
    const declaredCommand = catalog.commands.find(item => item.commandId === command.commandId);
    if (!declaredCommand || declaredCommand.entityTypeId !== contribution.entityTypeId || !sameRef(declaredCommand.capability, command.capability) || canonical(declaredCommand.inputSchema) !== canonical(command.inputSchema)) fail(`command ${command.commandId} is missing or incompatible with its declared extension contract`);
    validateSchema(command.inputSchema, `commands.${command.commandId}.inputSchema`);
    const fields = (command.inputSchema as { properties: Record<string, JsonValue> }).properties;
    if (Object.values(fields).some(field => !field || typeof field !== 'object' || Array.isArray(field) || !['string', 'integer', 'number', 'boolean'].includes(String(field.type)))) fail(`commands.${command.commandId} has a form field type the host renderer cannot collect`);
  }
  validateNodes(contribution.nodes, contribution, commandIds);
  return structuredClone(contribution);
}

/** Registry stores data descriptors only; module code never supplies React components. */
export class UiContributionRegistry {
  private readonly contributions = new Map<string, UiContribution>();
  private readonly lock: CapabilityLock;
  private readonly campaignId: string;
  private readonly catalog: UiDescriptorCatalog;
  constructor(lock: CapabilityLock, campaignId: string, catalog: UiDescriptorCatalog) { this.lock = structuredClone(lock); this.campaignId = campaignId; this.catalog = structuredClone(catalog); }

  register(value: UiContribution): void {
    const contribution = this.validate(value);
    if (this.contributions.has(contribution.contributionId)) fail(`duplicate contribution ${contribution.contributionId}`);
    this.contributions.set(contribution.contributionId, contribution);
  }

  get(contributionId: string): UiContribution | undefined {
    const value = this.contributions.get(contributionId);
    if (!value) return undefined;
    return this.validate(value);
  }

  validate(value: UiContribution, lock = this.lock, campaignId = this.campaignId): UiContribution { return validateUiContribution(value, lock, campaignId, this.catalog); }

  list(kind?: UiContribution['kind']): UiContribution[] {
    return [...this.contributions.values()].filter(value => !kind || value.kind === kind).map(value => this.get(value.contributionId)!);
  }

  compose(contributionId: string, assignments: Record<string, Record<string, string[]>> = {}): UiContribution {
    const expand = (id: string, ancestry: Set<string>, depth: number): UiContribution => {
      if (depth > 16 || ancestry.has(id)) fail('slot composition contains a cycle or exceeds its depth limit');
      const found = this.get(id);
      if (!found) fail(`missing composed contribution ${id}`);
      const contribution: UiContribution = found;
      const nextAncestry = new Set(ancestry).add(id);
      const placement = assignments[id] ?? {};
      if (Object.keys(placement).some(slot => !contribution.slots.includes(slot))) fail(`${id} assigns an undeclared slot`);
      const commands = [...contribution.commands];
      const workflows = [...contribution.workflows];
      const expandNodes = (nodes: UiNode[]): UiNode[] => nodes.flatMap(node => {
        if (node.kind === 'group' || node.kind === 'section') return [{ ...node, children: expandNodes(node.children) }];
        if (node.kind !== 'slot') return [node];
        return (placement[node.slotId] ?? []).flatMap(childId => {
          const child = expand(childId, nextAncestry, depth + 1);
          if (child.entityTypeId !== contribution.entityTypeId || child.entitySchemaVersion !== contribution.entitySchemaVersion || JSON.stringify(child.entityCapability) !== JSON.stringify(contribution.entityCapability) || JSON.stringify(child.entitySchema) !== JSON.stringify(contribution.entitySchema)) fail('composed contribution entity contract does not match its slot owner');
          for (const command of child.commands) {
            const existing = commands.find(item => item.commandId === command.commandId);
            if (existing && JSON.stringify(existing) !== JSON.stringify(command)) fail(`composed command ${command.commandId} has conflicting declarations`);
            if (!existing) commands.push(command);
          }
          for (const workflow of child.workflows) if (!workflows.some(item => item.workflowTypeId === workflow.workflowTypeId)) workflows.push(workflow);
          return expandNodes(child.nodes);
        });
      });
      return { ...contribution, nodes: expandNodes(contribution.nodes), commands, workflows, slots: [] };
    };
    const composed = expand(contributionId, new Set(), 0);
    return this.validate(composed);
  }
}

export function readUiPath(data: JsonValue, path: string): JsonValue | undefined {
  return path.split('.').filter(Boolean).reduce<JsonValue | undefined>((value, part) => value && typeof value === 'object' && !Array.isArray(value) ? value[part] : undefined, data);
}

export function uiNodeIsVisible(node: UiNode, data: JsonValue): boolean {
  if (!('visibleWhen' in node) || !node.visibleWhen) return true;
  return JSON.stringify(readUiPath(data, node.visibleWhen.path)) === JSON.stringify(node.visibleWhen.equals);
}
