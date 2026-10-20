import { useState } from 'react';
import type { JsonValue } from '@potomac/contracts';
import { validateEntitySchemaValue, type EntityJsonSchema } from './v2-entity-schema';

export type V2PreparationMember = { memberId: string; displayName: string };
export type V2PreparationField = { path: string; label: string; type: 'text' | 'integer' | 'number' | 'member' };
export type V2PreparationProfile = { entityTypeId: string; title: string; description: string; template: JsonValue; fields: V2PreparationField[]; assignmentPaths: string[] };

const getPath = (value: unknown, path: string): unknown => path.split('.').reduce((current, part) => current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined, value);
const setPath = (value: unknown, path: string, next: unknown): JsonValue => {
  const result = structuredClone(value) as Record<string, unknown>;
  const parts = path.split('.'); let current = result;
  for (const part of parts.slice(0, -1)) current = current[part] as Record<string, unknown>;
  current[parts.at(-1)!] = next;
  return result as JsonValue;
};

export function V2GuidedPreparationForm({ profile, schema, members, formId, disabled, submitLabel, onSubmit }: {
  profile: V2PreparationProfile; schema: EntityJsonSchema; members: V2PreparationMember[]; formId: string; disabled: boolean; submitLabel: string;
  onSubmit: (value: JsonValue, assignedMembers: string[]) => Promise<void>;
}) {
  const [value, setValue] = useState<JsonValue>(() => structuredClone(profile.template));
  const [submitting, setSubmitting] = useState(false);
  const errors = validateEntitySchemaValue(schema, value);
  const update = (path: string, next: unknown) => setValue(current => setPath(current, path, next));
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (errors.length || submitting || disabled) return;
    const assignedMembers = profile.assignmentPaths.map(path => String(getPath(value, path)));
    setSubmitting(true);
    try { await onSubmit(value, assignedMembers); }
    finally { setSubmitting(false); }
  };
  return <form className="v2-entity-create-form v2-guided-preparation-form" aria-label={profile.title} noValidate onSubmit={event => void submit(event)}>
    <h3>{profile.title}</h3><p>{profile.description}</p>
    {profile.fields.map((field, index) => <div className="v2-entity-field" key={field.path}>
      <label htmlFor={`${formId}-field-${index}`}>{field.label}</label>
      {field.type === 'member' ? <select id={`${formId}-field-${index}`} required value={String(getPath(value, field.path) ?? '')} disabled={disabled || submitting} onChange={event => update(field.path, event.target.value)}>
        <option value="">Choose an enrolled player</option>{members.map(member => <option key={member.memberId} value={member.memberId}>{member.displayName}</option>)}
      </select> : <input id={`${formId}-field-${index}`} type={field.type === 'text' ? 'text' : 'number'} step={field.type === 'integer' ? 1 : field.type === 'number' ? 'any' : undefined} value={String(getPath(value, field.path) ?? '')} disabled={disabled || submitting} onChange={event => update(field.path, field.type === 'text' ? event.target.value : event.target.value === '' ? undefined : Number(event.target.value))} />}
    </div>)}
    {errors.length > 0 && <ul className="v2-entity-validation" role="alert">{errors.map(error => <li key={error}>{error}</li>)}</ul>}
    <button type="submit" disabled={disabled || submitting || errors.length > 0 || members.length === 0}>{submitting ? 'Preparing…' : submitLabel}</button>
  </form>;
}
