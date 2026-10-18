import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import './v2-ui.css';
import type { JsonValue, UiContribution, UiEntityProjection, UiHostContext, UiNode } from '@potomac/contracts';
import { readUiPath, requirePinnedUiCapability, uiNodeIsVisible } from './v2-ui-registry.ts';
import type { UiContributionRegistry } from './v2-ui-registry.ts';

type Props = {
  experimentalEnabled: boolean;
  registry: UiContributionRegistry;
  contributionId: string;
  entity?: UiEntityProjection;
  host: UiHostContext;
  status?: 'ready' | 'loading' | 'unavailable' | 'error';
  errorMessage?: string;
  composition?: Record<string, Record<string, string[]>>;
};

export function V2UiContributionView(props: Props) {
  if (!props.experimentalEnabled) return <p role="status">Experimental V2 extension views are disabled; production host integration is not available.</p>;
  if (props.status === 'loading') return <p role="status" aria-live="polite">Loading extension view…</p>;
  if (props.status === 'unavailable' || !props.entity) return <p role="status">This extension content is unavailable to your current host authorization.</p>;
  if (props.status === 'error') return <p role="alert">{props.errorMessage || 'The extension view could not be loaded.'}</p>;

  let contribution: UiContribution | undefined;
  try {
    contribution = props.composition ? props.registry.compose(props.contributionId, props.composition) : props.registry.get(props.contributionId);
    if (!contribution) return <p role="status">This extension view is unavailable or no longer installed.</p>;
    props.registry.validate(contribution, props.host.lock, props.entity.campaignId);
    if (contribution.entityTypeId !== props.entity.typeId || contribution.entitySchemaVersion !== props.entity.schemaVersion || props.entity.capability.id !== contribution.entityCapability.id || props.entity.capability.apiVersion !== contribution.entityCapability.apiVersion || props.entity.capability.implementationVersion !== contribution.entityCapability.implementationVersion || props.entity.capability.digest !== contribution.entityCapability.digest) return <p role="status">This extension view is incompatible with the current entity version.</p>;
  } catch {
    return <p role="status">This extension view is unavailable because its exact module capability is not pinned.</p>;
  }

  // Keying by the exact capability and entity identity discards stale input and validation state on upgrades/switches.
  const mountKey = `${props.entity.campaignId}:${props.entity.entityId}:${contribution.capability.id}@${contribution.capability.implementationVersion}:${contribution.capability.digest}:${contribution.contributionVersion}`;
  return <ContributionBody key={mountKey} contribution={contribution} entity={props.entity} host={props.host} />;
}

function valueText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function currentWorkflow(contribution: UiContribution, entity: UiEntityProjection, host: UiHostContext, workflowTypeId: string) {
  const current = host.workflow;
  const declared = contribution.workflows.find(item => item.workflowTypeId === workflowTypeId);
  if (!current || !declared || current.status !== 'active' || current.workflowTypeId !== workflowTypeId || current.campaignId !== entity.campaignId || current.entityId !== entity.entityId || !declared.states.includes(current.state)) return undefined;
  if (current.capability.id !== declared.capability.id || current.capability.apiVersion !== declared.capability.apiVersion || current.capability.implementationVersion !== declared.capability.implementationVersion || current.capability.digest !== declared.capability.digest) return undefined;
  try { requirePinnedUiCapability(host.lock, entity.campaignId, declared.capability); } catch { return undefined; }
  return current;
}

function ContributionBody({ contribution, entity, host }: { contribution: UiContribution; entity: UiEntityProjection; host: UiHostContext }) {
  return <section className="v2-ui-contribution" aria-label={contribution.contributionId} data-contribution-version={contribution.contributionVersion}>
    {contribution.nodes.map(node => <NodeView key={node.id} node={node} contribution={contribution} entity={entity} host={host} />)}
  </section>;
}

function NodeView({ node, contribution, entity, host }: { node: UiNode; contribution: UiContribution; entity: UiEntityProjection; host: UiHostContext }): ReactNode {
  if (!uiNodeIsVisible(node, entity.data)) return null;
  if ((node.kind === 'command' || node.kind === 'form') && node.visibleWhenWorkflowState && currentWorkflow(contribution, entity, host, node.workflowTypeId ?? '')?.state !== node.visibleWhenWorkflowState) return null;
  if (node.kind === 'group') return <div className="v2-ui-group">{node.children.map(child => <NodeView key={child.id} node={child} contribution={contribution} entity={entity} host={host} />)}</div>;
  if (node.kind === 'section') return <section className="v2-ui-section" aria-label={node.label}>{node.label && <h3>{node.label}</h3>}{node.children.map(child => <NodeView key={child.id} node={child} contribution={contribution} entity={entity} host={host} />)}</section>;
  if (node.kind === 'slot') return <div className="v2-ui-slot" data-slot={node.slotId} aria-label={node.slotId} />;
  if (node.kind === 'display') {
    const value = readUiPath(entity.data, node.path);
    return value === undefined ? null : <dl className="v2-ui-display"><dt>{node.label}</dt><dd>{valueText(value)}</dd></dl>;
  }
  if (node.kind === 'resource') {
    const current = readUiPath(entity.data, node.currentPath);
    const maximum = readUiPath(entity.data, node.maximumPath);
    if (typeof current !== 'number' || typeof maximum !== 'number') return null;
    const value = Math.max(0, Math.min(maximum, current));
    return <div className="v2-ui-resource"><label>{node.label}<progress value={value} max={Math.max(1, maximum)} aria-label={node.label} /> <output>{current} / {maximum}</output></label></div>;
  }
  if (node.kind === 'workflow-status') { const workflow = currentWorkflow(contribution, entity, host, node.workflowTypeId); return workflow ? <p className="v2-ui-workflow-status" role="status" aria-live="polite">{node.label}: {workflow.state.replaceAll('.', ' ')} · {workflow.status}</p> : <p role="status">{node.label}: no active workflow.</p>; }
  if (!host.allowedCommandIds.includes(node.commandId)) return null;
  if (node.kind === 'command') return <CommandButton node={node} contribution={contribution} entity={entity} host={host} />;
  return <CommandForm node={node} contribution={contribution} entity={entity} host={host} />;
}

function CommandButton({ node, contribution, entity, host }: { node: Extract<UiNode, { kind: 'command' }>; contribution: UiContribution; entity: UiEntityProjection; host: UiHostContext }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const workflow = node.workflowTypeId ? currentWorkflow(contribution, entity, host, node.workflowTypeId) : undefined;
  const needsWorkflow = Boolean(node.workflowTypeId);
  const submit = async () => {
    setPending(true); setError('');
    try {
      await host.submitCommand({ operationId: crypto.randomUUID(), campaignId: entity.campaignId, principalId: host.principalId, commandId: node.commandId, entityId: entity.entityId, expectedRevision: entity.revision, input: {}, ...(workflow ? { workflow: { workflowId: workflow.workflowId, expectedRevision: workflow.revision, expectedContinuationId: workflow.continuationId, transitionId: node.transitionId! } } : {}) });
    } catch {
      setError('The command was not accepted. Check access and connection, then retry.');
    } finally { setPending(false); }
  };
  return <div className="v2-ui-command"><button type="button" disabled={pending || needsWorkflow && !workflow} onClick={() => void submit()}>{pending ? 'Working…' : node.label}</button>{needsWorkflow && !workflow && <p role="status">The matching active workflow is unavailable.</p>}{error && <p role="alert">{error}</p>}</div>;
}

type SchemaProperty = { type: 'string' | 'integer' | 'number' | 'boolean'; title?: string; description?: string; enum?: JsonValue[]; required?: never; minimum?: number; maximum?: number; minLength?: number; maxLength?: number };
type InputSchema = { properties: Record<string, SchemaProperty>; required?: string[] };

function inputSchema(contribution: UiContribution, commandId: string): InputSchema {
  return contribution.commands.find(command => command.commandId === commandId)?.inputSchema as unknown as InputSchema;
}

function fieldLabel(name: string, schema: SchemaProperty): string {
  return schema.title || name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^./, value => value.toUpperCase());
}

function parseForm(form: HTMLFormElement, schema: InputSchema): { input?: Record<string, JsonValue>; error?: string } {
  const input: Record<string, JsonValue> = {};
  const formData = new FormData(form);
  for (const [name, field] of Object.entries(schema.properties)) {
    const raw = String(formData.get(name) ?? '');
    const required = schema.required?.includes(name) ?? false;
    if (!raw) {
      if (required) return { error: `${fieldLabel(name, field)} is required.` };
      continue;
    }
    let value: JsonValue;
    if (field.enum) {
      const index = Number(raw);
      if (!Number.isInteger(index) || index < 0 || index >= field.enum.length) return { error: `Choose a valid ${fieldLabel(name, field).toLowerCase()}.` };
      value = field.enum[index];
    } else if (field.type === 'integer' || field.type === 'number') {
      const number = Number(raw);
      if (!Number.isFinite(number) || field.type === 'integer' && !Number.isInteger(number) || field.minimum !== undefined && number < field.minimum || field.maximum !== undefined && number > field.maximum) return { error: `Enter a valid ${fieldLabel(name, field).toLowerCase()}${field.minimum !== undefined || field.maximum !== undefined ? ` (${field.minimum ?? 'any'}–${field.maximum ?? 'any'}).` : '.'}` };
      value = number;
    } else if (field.type === 'boolean') value = raw === 'true';
    else {
      if (field.minLength !== undefined && raw.length < field.minLength || field.maxLength !== undefined && raw.length > field.maxLength) return { error: `${fieldLabel(name, field)} has an invalid length.` };
      value = raw;
    }
    input[name] = value;
  }
  return { input };
}

function CommandForm({ node, contribution, entity, host }: { node: Extract<UiNode, { kind: 'form' }>; contribution: UiContribution; entity: UiEntityProjection; host: UiHostContext }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const schema = inputSchema(contribution, node.commandId);
  const workflow = node.workflowTypeId ? currentWorkflow(contribution, entity, host, node.workflowTypeId) : undefined;
  const needsWorkflow = Boolean(node.workflowTypeId);
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const parsed = parseForm(form, schema);
    if (parsed.error) { setMessage(parsed.error); return; }
    setPending(true); setMessage('');
    try {
      await host.submitCommand({ operationId: crypto.randomUUID(), campaignId: entity.campaignId, principalId: host.principalId, commandId: node.commandId, entityId: entity.entityId, expectedRevision: entity.revision, input: parsed.input!, ...(workflow ? { workflow: { workflowId: workflow.workflowId, expectedRevision: workflow.revision, expectedContinuationId: workflow.continuationId, transitionId: node.transitionId! } } : {}) });
      form.reset();
      setMessage('Command accepted by the host.');
    } catch {
      setMessage('The command was not accepted. Check access and connection, then retry.');
    } finally { setPending(false); }
  };
  return <form className="v2-ui-form" aria-label={node.label} noValidate onSubmit={onSubmit}>
    {Object.entries(schema.properties).map(([name, field]) => {
      const id = `${node.id}-${name}`;
      const label = fieldLabel(name, field);
      const required = schema.required?.includes(name) ?? false;
      return <div className="v2-ui-input" key={name}><label htmlFor={id}>{label}{required ? ' *' : ''}</label>{field.enum || field.type === 'boolean'
        ? <select id={id} name={name} defaultValue="" required={required} disabled={pending}><option value="" disabled>Choose {label.toLowerCase()}</option>{(field.enum ?? [true, false]).map((item, index) => <option key={index} value={field.enum ? String(index) : String(item)}>{String(item)}</option>)}</select>
        : <input id={id} name={name} type={field.type === 'integer' || field.type === 'number' ? 'number' : 'text'} step={field.type === 'integer' ? 1 : field.type === 'number' ? 'any' : undefined} min={field.minimum} max={field.maximum} minLength={field.minLength} maxLength={field.maxLength} required={required} disabled={pending} aria-describedby={field.description ? `${id}-description` : undefined} />}{field.description && <small id={`${id}-description`}>{field.description}</small>}</div>;
    })}
    <button type="submit" disabled={pending || needsWorkflow && !workflow}>{pending ? 'Submitting…' : node.label}</button>
    {needsWorkflow && !workflow && <p role="status">The matching active workflow is unavailable.</p>}
    {message && <p role={message.startsWith('The command') || message.endsWith('required.') || message.startsWith('Enter ') || message.startsWith('Choose ') ? 'alert' : 'status'} aria-live="polite">{message}</p>}
  </form>;
}
