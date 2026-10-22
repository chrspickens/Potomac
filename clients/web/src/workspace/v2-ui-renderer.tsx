import { useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import './v2-ui.css';
import type { JsonValue, UiContribution, UiEntityProjection, UiHostContext, UiNode } from '@potomac/contracts';
import { readUiPath, requirePinnedUiCapability, uiNodeIsVisible } from './v2-ui-registry.ts';
import type { UiContributionRegistry } from './v2-ui-registry.ts';
import { describeHistoryEntry, friendlyCommandError, initiativeParticipants, summarizeCommandOutcomes } from './v2-ui-presentation.ts';

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

type CommandAttempt = { operationId: string; expectedRevision: number; input: Record<string, JsonValue>; workflow?: NonNullable<Parameters<UiHostContext['submitCommand']>[0]['workflow']> };

function operationAttemptKey(entity: UiEntityProjection, host: UiHostContext, commandId: string): string {
  return `potomac.v2.ui.attempt.${entity.campaignId}:${host.principalId}:${entity.entityId}:${commandId}`;
}

function readCommandAttempt(key: string): CommandAttempt | undefined {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return undefined;
    const attempt = JSON.parse(raw) as CommandAttempt;
    return typeof attempt.operationId === 'string' && Number.isInteger(attempt.expectedRevision) && attempt.input && typeof attempt.input === 'object' ? attempt : undefined;
  } catch { return undefined; }
}

function clearCommandAttempt(key: string): void { sessionStorage.removeItem(key); }

export function commandResultFeedback(result: unknown, data?: JsonValue): { status: 'applied' | 'pending' | 'conflicted' | 'unknown'; message: string } {
  const status = result && typeof result === 'object' && 'status' in result ? String(result.status) : '';
  if (status === 'applied') {
    const summaries = data === undefined ? [] : summarizeCommandOutcomes(result, data);
    return { status, message: summaries.length ? `Committed: ${summaries.join(' ')}` : 'Command committed by the host.' };
  }
  if (status === 'pending') return { status, message: 'Command is waiting for its authorized reaction; its effects are not committed yet.' };
  if (status === 'conflicted') return { status, message: 'The host recorded a terminal conflict; no command effects were committed.' };
  return { status: 'unknown', message: 'The host response did not confirm a committed result. Refresh and review state before trying again.' };
}

function defaultFieldValue(field: SchemaProperty, value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (field.type === 'array') return JSON.stringify(value);
  if (field.enum) return String(field.enum.findIndex(option => JSON.stringify(option) === JSON.stringify(value)));
  return String(value);
}

function arrayExample(field: SchemaProperty): string {
  if (field.items?.type === 'object') {
    const item = Object.fromEntries(Object.entries(field.items.properties).map(([name, child]) => [name, child.type === 'string' ? 'value' : child.type === 'boolean' ? true : 1]));
    return JSON.stringify([item]);
  }
  return '[]';
}

function commandAttempt(entity: UiEntityProjection, host: UiHostContext, commandId: string, input: Record<string, JsonValue>, workflow?: CommandAttempt['workflow']): { key: string; attempt?: CommandAttempt; mismatch: boolean } {
  const key = operationAttemptKey(entity, host, commandId);
  const existing = readCommandAttempt(key);
  if (existing) {
    const sameIntent = JSON.stringify(existing.input) === JSON.stringify(input) && JSON.stringify(existing.workflow ?? null) === JSON.stringify(workflow ?? null);
    return { key, attempt: existing, mismatch: !sameIntent };
  }
  const attempt: CommandAttempt = { operationId: `v2-ui-${crypto.randomUUID()}`, expectedRevision: entity.revision, input, ...(workflow ? { workflow } : {}) };
  sessionStorage.setItem(key, JSON.stringify(attempt));
  return { key, attempt, mismatch: false };
}

export function V2UiContributionView(props: Props) {
  if (!props.experimentalEnabled) return <p role="status">Experimental V2 extension views are disabled; production host integration is not available.</p>;
  if (props.status === 'loading') return <p role="status" aria-live="polite">Loading extension view…</p>;
  if (props.status === 'unavailable' || !props.entity) return <p role="status">This extension content is unavailable to your current host authorization.</p>;
  if (props.status === 'error') return <p role="alert">{props.errorMessage || 'The extension view could not be loaded.'}</p>;

  let contribution: UiContribution;
  try {
    const candidate = props.composition ? props.registry.compose(props.contributionId, props.composition) : props.registry.get(props.contributionId);
    if (!candidate) return <p role="status">This extension view is unavailable or no longer installed.</p>;
    props.registry.validate(candidate, props.host.lock, props.entity.campaignId);
    if (candidate.entityTypeId !== props.entity.typeId || candidate.entitySchemaVersion !== props.entity.schemaVersion || props.entity.capability.id !== candidate.entityCapability.id || props.entity.capability.apiVersion !== candidate.entityCapability.apiVersion || props.entity.capability.implementationVersion !== candidate.entityCapability.implementationVersion || props.entity.capability.digest !== candidate.entityCapability.digest) return <p role="status">This extension view is incompatible with the current entity version.</p>;
    contribution = candidate;
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
  if ((node.kind === 'command' || node.kind === 'form') && !host.allowedCommandIds.includes(node.commandId)) return null;
  if ((node.kind === 'command' || node.kind === 'form') && node.visibleWhenWorkflowState && currentWorkflow(contribution, entity, host, node.workflowTypeId ?? '')?.state !== node.visibleWhenWorkflowState) return null;
  if (node.kind === 'group') return <div className="v2-ui-group">{node.children.map(child => <NodeView key={child.id} node={child} contribution={contribution} entity={entity} host={host} />)}</div>;
  if (node.kind === 'section') return <section className="v2-ui-section" aria-label={node.label}>{node.label && <h3>{node.label}</h3>}{node.children.map(child => <NodeView key={child.id} node={child} contribution={contribution} entity={entity} host={host} />)}</section>;
  if (node.kind === 'slot') return <div className="v2-ui-slot" data-slot={node.slotId} aria-label={node.slotId} />;
  if (node.kind === 'display') {
    const value = readUiPath(entity.data, node.path);
    const initiative = initiativeParticipants(entity.data, node.path, node.label, entity.viewerOwnedPaths);
    if (initiative) return <div className="v2-ui-display v2-ui-initiative" aria-label="Initiative tracker"><h4>{initiative.round === undefined ? node.label : `Round ${initiative.round}`}</h4><ol>{initiative.participants.map(participant => <li key={participant.id} className={participant.active ? 'is-active' : ''} aria-current={participant.active ? 'step' : undefined}><span>{participant.index}. {participant.label}</span>{participant.kind && <small>{participant.kind === 'enemy' ? 'GM-controlled enemy' : participant.kind === 'player' ? 'Player character' : participant.kind}</small>}{participant.controlledByViewer && <strong className="v2-ui-controlled">Your character</strong>}{participant.active && <strong>Active turn</strong>}</li>)}</ol>{initiative.active && <p role="status">It is {initiative.active}’s turn.</p>}</div>;
    if (Array.isArray(value) && /combat log|movement log/i.test(node.label)) {
      const mode = /movement/i.test(node.label) ? 'movement' : 'combat';
      const entries = value.map(entry => describeHistoryEntry(entry, mode)).filter((entry): entry is string => Boolean(entry));
      return <div className="v2-ui-history"><strong>{node.label}</strong>{entries.length ? <ol>{entries.slice().reverse().map((entry, index) => <li key={index}>{entry}</li>)}</ol> : <p>No committed events yet.</p>}</div>;
    }
    return value === undefined ? null : <dl className="v2-ui-display"><dt>{node.label}</dt><dd>{Array.isArray(value) ? value.map(valueText).join(' · ') : valueText(value)}</dd></dl>;
  }
  if (node.kind === 'resource') {
    const current = readUiPath(entity.data, node.currentPath);
    const maximum = readUiPath(entity.data, node.maximumPath);
    const currents = Array.isArray(current) ? current : [current];
    const maximums = Array.isArray(maximum) ? maximum : [maximum];
    if (currents.length !== maximums.length || currents.some(value => typeof value !== 'number') || maximums.some(value => typeof value !== 'number')) return null;
    return <div className="v2-ui-resource">{currents.map((currentValue, index) => {
      const maximumValue = maximums[index] as number;
      const value = Math.max(0, Math.min(maximumValue, currentValue as number));
      const label = currents.length > 1 ? `${node.label} ${index + 1}` : node.label;
      return <label key={index}>{label}<progress value={value} max={Math.max(1, maximumValue)} aria-label={label} /> <output>{valueText(currentValue)} / {maximumValue}</output></label>;
    })}</div>;
  }
  if (node.kind === 'workflow-status') { const workflow = currentWorkflow(contribution, entity, host, node.workflowTypeId); return workflow ? <p className="v2-ui-workflow-status" role="status" aria-live="polite">{node.label}: {workflow.state.replaceAll('.', ' ')} · {workflow.status}</p> : <p role="status">{node.label}: no active workflow.</p>; }
  if (!host.allowedCommandIds.includes(node.commandId)) return null;
  if (node.kind === 'command') return <CommandButton node={node} contribution={contribution} entity={entity} host={host} />;
  return <CommandForm node={node} contribution={contribution} entity={entity} host={host} />;
}

function CommandButton({ node, contribution, entity, host }: { node: Extract<UiNode, { kind: 'command' }>; contribution: UiContribution; entity: UiEntityProjection; host: UiHostContext }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const workflow = node.workflowTypeId ? currentWorkflow(contribution, entity, host, node.workflowTypeId) : undefined;
  const needsWorkflow = Boolean(node.workflowTypeId);
  const submit = async () => {
    setPending(true); setMessage('');
    try {
      const workflowRequest = workflow ? { workflowId: workflow.workflowId, expectedRevision: workflow.revision, expectedContinuationId: workflow.continuationId, transitionId: node.transitionId! } : undefined;
      const intent = commandAttempt(entity, host, node.commandId, {}, workflowRequest);
      if (intent.mismatch || !intent.attempt) { setMessage('A previous request has an unknown outcome. Retry that exact action or refresh and review the host state first.'); return; }
      const result = await host.submitCommand({ operationId: intent.attempt.operationId, campaignId: entity.campaignId, principalId: host.principalId, commandId: node.commandId, entityId: entity.entityId, expectedRevision: intent.attempt.expectedRevision, input: intent.attempt.input, ...(intent.attempt.workflow ? { workflow: intent.attempt.workflow } : {}) });
      const feedback = commandResultFeedback(result, entity.data);
      if (feedback.status === 'applied' || feedback.status === 'conflicted') clearCommandAttempt(intent.key);
      setMessage(feedback.message);
    } catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
      if (status >= 400 && status < 500) clearCommandAttempt(operationAttemptKey(entity, host, node.commandId));
      setMessage(friendlyCommandError(error, node.commandId));
    } finally { setPending(false); }
  };
  return <div className="v2-ui-command"><button type="button" disabled={pending || needsWorkflow && !workflow} onClick={() => void submit()}>{pending ? 'Working…' : node.label}</button>{needsWorkflow && !workflow && <p role="status">The matching active workflow is unavailable.</p>}{message && <p role={message.startsWith('Committed:') || message.startsWith('Command committed') || message.startsWith('Command is waiting') ? 'status' : 'alert'} aria-live="polite">{message}</p>}</div>;
}

type SchemaProperty = { type: 'string' | 'integer' | 'number' | 'boolean' | 'array'; title?: string; description?: string; enum?: JsonValue[]; required?: never; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; minItems?: number; maxItems?: number; items?: { type: 'object'; properties: Record<string, SchemaProperty>; required?: string[]; additionalProperties?: boolean } };
type InputSchema = { properties: Record<string, SchemaProperty>; required?: string[] };

function inputSchema(contribution: UiContribution, commandId: string): InputSchema {
  return contribution.commands.find(command => command.commandId === commandId)?.inputSchema as unknown as InputSchema;
}

function fieldLabel(name: string, schema: SchemaProperty): string {
  return schema.title || name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/\s+id$/i, '').replace(/^./, value => value.toUpperCase());
}

function projectedReferenceNames(data: JsonValue): Map<string, string> {
  const names = new Map<string, string>();
  let visited = 0;
  const visit = (value: JsonValue, depth: number): void => {
    if (depth > 8 || visited++ > 1000 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const child of value) visit(child, depth + 1); return; }
    const record = value as Record<string, JsonValue>;
    if (typeof record.id === 'string' && typeof record.name === 'string' && record.name.trim()) names.set(record.id, record.name);
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(data, 0);
  return names;
}

function internalReference(fieldName: string, value: JsonValue): boolean {
  return fieldName.toLowerCase().endsWith('id') || typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
}

function parseForm(form: HTMLFormElement, schema: InputSchema, referenceNames?: Map<string, string>): { input?: Record<string, JsonValue>; error?: string } {
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
    } else if ((name === 'actorId' || name === 'targetId') && referenceNames?.has(raw)) {
      value = raw;
    } else if (field.type === 'array') {
      try { value = JSON.parse(raw) as JsonValue; }
      catch { return { error: `Enter valid JSON for ${fieldLabel(name, field).toLowerCase()}.` }; }
      if (!Array.isArray(value)) return { error: `${fieldLabel(name, field)} must be a JSON array.` };
      if (field.minItems !== undefined && value.length < field.minItems || field.maxItems !== undefined && value.length > field.maxItems) return { error: `${fieldLabel(name, field)} has too few or too many entries.` };
      if (field.items?.type === 'object') {
        for (const [index, item] of value.entries()) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return { error: `${fieldLabel(name, field)} waypoint ${index + 1} is incomplete.` };
          const object = item as Record<string, JsonValue>;
          for (const key of field.items.required ?? []) if (object[key] === undefined || object[key] === '') return { error: `Waypoint ${index + 1}: ${fieldLabel(key, field.items.properties[key])} is required.` };
          for (const [key, child] of Object.entries(field.items.properties)) {
            const childValue = object[key];
            if (childValue === undefined) continue;
            if (child.type === 'integer' && (typeof childValue !== 'number' || !Number.isInteger(childValue)) || child.type === 'number' && (typeof childValue !== 'number' || !Number.isFinite(childValue)) || child.type === 'string' && typeof childValue !== 'string' || child.type === 'boolean' && typeof childValue !== 'boolean') return { error: `Waypoint ${index + 1}: enter a valid ${fieldLabel(key, child).toLowerCase()}.` };
            if (typeof childValue === 'number' && (child.minimum !== undefined && childValue < child.minimum || child.maximum !== undefined && childValue > child.maximum) || typeof childValue === 'string' && (child.minLength !== undefined && childValue.length < child.minLength || child.maxLength !== undefined && childValue.length > child.maxLength) || child.enum && !child.enum.some(option => JSON.stringify(option) === JSON.stringify(childValue))) return { error: `Waypoint ${index + 1}: ${fieldLabel(key, child)} is outside the allowed range.` };
          }
        }
      }
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

function ArrayObjectField({ id, name, label, field, initial, disabled }: { id: string; name: string; label: string; field: SchemaProperty; initial: JsonValue | undefined; disabled: boolean }) {
  const initialItems = Array.isArray(initial) ? initial.filter(item => item && typeof item === 'object' && !Array.isArray(item)).slice(0, field.maxItems ?? 20).map(item => Object.fromEntries(Object.entries(field.items?.properties ?? {}).map(([key, child]) => [key, (item as Record<string, JsonValue>)[key] ?? (child.type === 'integer' || child.type === 'number' ? child.minimum ?? 0 : '')]))) as Array<Record<string, JsonValue>> : [];
  const [items, setItems] = useState<Array<Record<string, JsonValue>>>(initialItems);
  const itemSchema = field.items;
  if (!itemSchema) return <textarea id={id} name={name} rows={3} defaultValue={initial ? JSON.stringify(initial) : ''} disabled={disabled} />;
  const minimum = field.minItems ?? 0; const maximum = field.maxItems ?? 20;
  const addItem = () => { if (items.length < maximum) setItems(current => [...current, Object.fromEntries(Object.entries(itemSchema.properties).map(([key, child]) => [key, child.type === 'integer' || child.type === 'number' ? child.minimum ?? 0 : child.type === 'boolean' ? false : '']))]); };
  const update = (index: number, key: string, raw: string, type: string) => setItems(current => current.map((item, at) => at === index ? { ...item, [key]: type === 'integer' || type === 'number' ? raw === '' ? '' : Number(raw) : type === 'boolean' ? raw === 'true' : raw } : item));
  return <fieldset className="v2-ui-array-field"><legend>{label}</legend><input type="hidden" name={name} value={JSON.stringify(items)} />{items.map((item, index) => <div className="v2-ui-array-item" key={index}><h4>Waypoint {index + 1}</h4>{Object.entries(itemSchema.properties).map(([key, child]) => { const controlId = `${id}-${index}-${key}`; return <label key={key} htmlFor={controlId}>{fieldLabel(key, child)}{child.enum ? <select id={controlId} value={String(item[key] ?? '')} disabled={disabled} onChange={event => update(index, key, event.target.value, child.type)}>{child.enum.map(option => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select> : child.type === 'boolean' ? <input id={controlId} type="checkbox" checked={item[key] === true} disabled={disabled} onChange={event => update(index, key, String(event.target.checked), child.type)} /> : <input id={controlId} type={child.type === 'integer' || child.type === 'number' ? 'number' : 'text'} step={child.type === 'integer' ? 1 : child.type === 'number' ? 'any' : undefined} min={'minimum' in child ? child.minimum : undefined} max={'maximum' in child ? child.maximum : undefined} value={String(item[key] ?? '')} disabled={disabled} onChange={event => update(index, key, event.target.value, child.type)} />}</label>; })}<button type="button" disabled={disabled || items.length <= minimum} onClick={() => setItems(current => current.filter((_, at) => at !== index))}>Remove waypoint {index + 1}</button></div>)}<button type="button" disabled={disabled || items.length >= maximum} onClick={addItem}>Add waypoint</button><small>{field.description ?? `Add up to ${maximum} points. The host validates whether the path is legal.`}</small></fieldset>;
}

function CommandForm({ node, contribution, entity, host }: { node: Extract<UiNode, { kind: 'form' }>; contribution: UiContribution; entity: UiEntityProjection; host: UiHostContext }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedActorId, setSelectedActorId] = useState('');
  const schema = inputSchema(contribution, node.commandId);
  const tracker = initiativeParticipants(entity.data, 'initiativeOrder', 'Initiative order', entity.viewerOwnedPaths);
  const encounterStatus = entity.data && typeof entity.data === 'object' && !Array.isArray(entity.data) && 'status' in entity.data ? String(entity.data.status) : '';
  const actorIsOutOfTurn = encounterStatus === 'active' && Boolean(selectedActorId && tracker?.activeId && selectedActorId !== tracker.activeId);
  useEffect(() => { setSelectedActorId(''); }, [entity.revision]);
  const referenceNames = projectedReferenceNames(entity.data);
  const workflow = node.workflowTypeId ? currentWorkflow(contribution, entity, host, node.workflowTypeId) : undefined;
  const needsWorkflow = Boolean(node.workflowTypeId);
  const workflowRequest = workflow ? { workflowId: workflow.workflowId, expectedRevision: workflow.revision, expectedContinuationId: workflow.continuationId, transitionId: node.transitionId! } : undefined;
  const attemptKey = operationAttemptKey(entity, host, node.commandId);
  const savedAttempt = readCommandAttempt(attemptKey);
  const savedIntentMatchesWorkflow = savedAttempt && JSON.stringify(savedAttempt.workflow ?? null) === JSON.stringify(workflowRequest ?? null);
  useEffect(() => { if (!selectedActorId && savedIntentMatchesWorkflow && typeof savedAttempt?.input.actorId === 'string') setSelectedActorId(savedAttempt.input.actorId); }, [savedAttempt?.operationId, savedIntentMatchesWorkflow]);
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const parsed = parseForm(form, schema, referenceNames);
    if (parsed.error) { setMessage(parsed.error); return; }
    setPending(true); setMessage('');
    try {
      const intent = commandAttempt(entity, host, node.commandId, parsed.input!, workflowRequest);
      if (intent.mismatch || !intent.attempt) { setMessage('A previous request has an unknown outcome. Retry its exact inputs or refresh and review the host state before starting another action.'); return; }
      const result = await host.submitCommand({ operationId: intent.attempt.operationId, campaignId: entity.campaignId, principalId: host.principalId, commandId: node.commandId, entityId: entity.entityId, expectedRevision: intent.attempt.expectedRevision, input: intent.attempt.input, ...(intent.attempt.workflow ? { workflow: intent.attempt.workflow } : {}) });
      const feedback = commandResultFeedback(result, entity.data);
      if (feedback.status === 'applied' || feedback.status === 'conflicted') { clearCommandAttempt(intent.key); if (feedback.status === 'applied') { form.reset(); setSelectedActorId(''); } }
      setMessage(feedback.message);
    } catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
      if (status >= 400 && status < 500) clearCommandAttempt(attemptKey);
      setMessage(friendlyCommandError(error, node.commandId));
    } finally { setPending(false); }
  };
  return <form className="v2-ui-form" aria-label={node.label} noValidate onSubmit={onSubmit}>
    {Object.entries(schema.properties).map(([name, field]) => {
      const id = `${node.id}-${name}`;
      const label = fieldLabel(name, field);
      const required = schema.required?.includes(name) ?? false;
      const choices = (field.enum ?? [true, false]).map((item, index) => ({ item, index, label: field.enum && referenceNames.get(String(item)) || (field.enum && internalReference(name, item) ? 'Unavailable option' : String(item)) }));
      const entityReference = !field.enum && field.type === 'string' && (name === 'actorId' || name === 'targetId');
      const referenceChoices = entityReference ? [...referenceNames].map(([value, name]) => ({ value, label: name })) : [];
      return <div className="v2-ui-input" key={name}>{field.type === 'array' && field.items?.type === 'object' ? <ArrayObjectField id={id} name={name} label={`${label}${required ? ' *' : ''}`} field={field} initial={savedIntentMatchesWorkflow ? savedAttempt.input[name] : undefined} disabled={pending} /> : <><label htmlFor={id}>{label}{required ? ' *' : ''}</label>{field.enum || field.type === 'boolean' || entityReference
        ? <select id={id} name={name} {...(name === 'actorId' ? { value: selectedActorId, onChange: (event: ChangeEvent<HTMLSelectElement>) => setSelectedActorId(event.target.value) } : { defaultValue: savedIntentMatchesWorkflow ? defaultFieldValue(field, savedAttempt.input[name]) : '' })} required={required} disabled={pending}><option value="" disabled>Choose {label.toLowerCase()}</option>{entityReference ? referenceChoices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>) : choices.map(choice => <option key={choice.index} value={field.enum ? String(choice.index) : String(choice.item)} disabled={field.enum && internalReference(name, choice.item) && !referenceNames.has(String(choice.item))}>{String(choice.label)}</option>)}</select>
        : field.type === 'array'
          ? <textarea id={id} name={name} rows={3} placeholder={arrayExample(field)} defaultValue={savedIntentMatchesWorkflow ? defaultFieldValue(field, savedAttempt.input[name]) : ''} required={required} disabled={pending} aria-describedby={`${id}-description`} />
        : <input id={id} name={name} type={field.type === 'integer' || field.type === 'number' ? 'number' : 'text'} step={field.type === 'integer' ? 1 : field.type === 'number' ? 'any' : undefined} min={field.minimum} max={field.maximum} minLength={field.minLength} maxLength={field.maxLength} defaultValue={savedIntentMatchesWorkflow ? defaultFieldValue(field, savedAttempt.input[name]) : ''} required={required} disabled={pending} aria-describedby={field.description ? `${id}-description` : undefined} />}{field.type === 'array' && <small id={`${id}-description`}>Enter a JSON array that matches the module schema, for example <code>{arrayExample(field)}</code>.</small>}{field.description && field.type !== 'array' && <small id={`${id}-description`}>{field.description}</small>}</>}</div>;
    })}
    <button type="submit" disabled={pending || needsWorkflow && !workflow || actorIsOutOfTurn}>{pending ? 'Submitting…' : node.label}</button>
    {actorIsOutOfTurn && <p role="status">{tracker?.active ? `This participant cannot act now; it is ${tracker.active}’s turn. The host remains authoritative.` : 'This participant cannot act now; refresh the encounter to check the current turn.'}</p>}
    {needsWorkflow && !workflow && <p role="status">The matching active workflow is unavailable.</p>}
    {message && <p role={message.startsWith('Committed:') || message.startsWith('Command committed') || message.startsWith('Command is waiting') ? 'status' : 'alert'} aria-live="polite">{message}</p>}
  </form>;
}
