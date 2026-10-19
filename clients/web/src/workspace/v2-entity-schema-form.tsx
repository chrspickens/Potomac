import { useEffect, useState, type ReactNode } from 'react';
import type { JsonValue } from '@potomac/contracts';
import { entitySchemaDefaults, validateEntitySchemaValue, type EntityJsonSchema } from './v2-entity-schema';

type Props = {
  schema: EntityJsonSchema;
  formId: string;
  disabled?: boolean;
  submitLabel: string;
  onSubmit: (value: JsonValue) => Promise<void> | void;
};

const labelFor = (name: string, schema: EntityJsonSchema) => schema.title || name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^./, value => value.toUpperCase());
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const formIdFor = (formId: string, path: string) => `${formId}-${path.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

function SchemaFields({ schema, value, path, required, disabled, formId, update }: {
  schema: EntityJsonSchema; value: unknown; path: string; required: boolean; disabled: boolean; formId: string; update: (value: unknown) => void;
}): ReactNode {
  const label = labelFor(path.split('.').at(-1) ?? path, schema);
  const id = formIdFor(formId, path);
  if (schema.type === 'object') {
    const record = asRecord(value);
    return <fieldset className="v2-entity-object"><legend>{label}{required ? ' *' : ''}</legend>{schema.description && <small>{schema.description}</small>}{Object.entries(schema.properties ?? {}).map(([key, child]) => {
      const present = Object.hasOwn(record, key);
      const childRequired = schema.required?.includes(key) ?? false;
      return <div className="v2-entity-property" key={key}>{!childRequired && <label className="v2-entity-optional"><input type="checkbox" checked={present} disabled={disabled} onChange={event => { const next = { ...record }; if (event.target.checked) next[key] = entitySchemaDefaults(child); else delete next[key]; update(next); }} /> Set {labelFor(key, child)}</label>}{(childRequired || present) && <SchemaFields schema={child} value={record[key]} path={`${path}.${key}`} formId={formId} required={childRequired} disabled={disabled} update={nextValue => update({ ...record, [key]: nextValue })} />}</div>;
    })}</fieldset>;
  }
  if (schema.type === 'array') {
    const values = asArray(value);
    const minimum = schema.minItems ?? 0;
    const maximum = schema.maxItems ?? 100;
    return <fieldset className="v2-entity-array"><legend>{label}{required ? ' *' : ''}</legend>{schema.description && <small>{schema.description}</small>}{values.map((item, index) => <div className="v2-entity-array-item" key={`${path}-${index}`}><SchemaFields schema={schema.items!} value={item} path={`${path}[${index}]`} formId={formId} required disabled={disabled} update={nextValue => update(values.map((valueAtIndex, itemIndex) => itemIndex === index ? nextValue : valueAtIndex))} /><button type="button" disabled={disabled || values.length <= minimum} aria-label={`Remove ${labelFor(path.split('.').at(-1) ?? path, schema)} item ${index + 1}`} onClick={() => update(values.filter((_, itemIndex) => itemIndex !== index))}>Remove item</button></div>)}<button type="button" disabled={disabled || values.length >= maximum} onClick={() => update([...values, entitySchemaDefaults(schema.items!)])}>Add {label.toLowerCase()} item</button></fieldset>;
  }
  return <div className="v2-entity-field"><label htmlFor={id}>{label}{required ? ' *' : ''}</label>{schema.description && <small>{schema.description}</small>}{schema.enum
    ? <select id={id} value={value === undefined ? '' : String(schema.enum.findIndex(item => Object.is(item, value)))} disabled={disabled} required={required} onChange={event => update(schema.enum![Number(event.target.value)])}><option value="" disabled>Choose {label.toLowerCase()}</option>{schema.enum.map((item, index) => <option key={index} value={index}>{String(item)}</option>)}</select>
    : schema.type === 'boolean'
      ? <input id={id} type="checkbox" checked={value === true} disabled={disabled} onChange={event => update(event.target.checked)} />
      : <input id={id} type={schema.type === 'integer' || schema.type === 'number' ? 'number' : 'text'} step={schema.type === 'integer' ? 1 : schema.type === 'number' ? 'any' : undefined} min={schema.minimum} max={schema.maximum} minLength={schema.minLength} maxLength={schema.maxLength} value={typeof value === 'number' || typeof value === 'string' ? value : ''} disabled={disabled} required={required} onChange={event => update(schema.type === 'integer' || schema.type === 'number' ? event.target.value === '' ? undefined : Number(event.target.value) : event.target.value)} />}</div>;
}

export function V2EntitySchemaForm({ schema, formId, disabled = false, submitLabel, onSubmit }: Props) {
  const [value, setValue] = useState<unknown>(() => entitySchemaDefaults(schema));
  const [errors, setErrors] = useState<string[]>(() => validateEntitySchemaValue(schema, entitySchemaDefaults(schema)));
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { const next = entitySchemaDefaults(schema); setValue(next); setErrors(validateEntitySchemaValue(schema, next)); }, [schema, formId]);
  const updateValue = (next: unknown) => { setValue(next); setErrors(validateEntitySchemaValue(schema, next)); };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateEntitySchemaValue(schema, value); setErrors(nextErrors);
    if (nextErrors.length || submitting || disabled) return;
    setSubmitting(true);
    try { await onSubmit(value as JsonValue); }
    finally { setSubmitting(false); }
  };
  return <form className="v2-entity-create-form" aria-label={`Create ${schema.title || 'entity'}`} noValidate onSubmit={event => void submit(event)}>
    <SchemaFields schema={schema} value={value} path={schema.title || 'Entity'} formId={formId} required disabled={disabled || submitting} update={updateValue} />
    {errors.length > 0 && <ul className="v2-entity-validation" role="alert">{errors.map(error => <li key={error}>{error}</li>)}</ul>}
    <button type="submit" disabled={disabled || submitting || errors.length > 0}>{submitting ? 'Creating…' : submitLabel}</button>
  </form>;
}
