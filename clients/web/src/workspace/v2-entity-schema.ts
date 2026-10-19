import type { JsonValue } from '@potomac/contracts';

export type EntityJsonSchema = {
  type: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
  title?: string;
  description?: string;
  properties?: Record<string, EntityJsonSchema>;
  required?: string[];
  items?: EntityJsonSchema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: JsonValue[];
  default?: JsonValue;
  additionalProperties?: boolean;
};

export function entitySchemaDefaults(schema: EntityJsonSchema): JsonValue {
  if (schema.default !== undefined) return structuredClone(schema.default);
  if (schema.enum?.length) return structuredClone(schema.enum[0]);
  if (schema.type === 'object') {
    const required = new Set(schema.required ?? []);
    return Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([key]) => required.has(key)).map(([key, child]) => [key, entitySchemaDefaults(child)]));
  }
  if (schema.type === 'array') return Array.from({ length: schema.minItems ?? 0 }, () => entitySchemaDefaults(schema.items!));
  if (schema.type === 'boolean') return false;
  if (schema.type === 'string') return 'x'.repeat(Math.min(schema.minLength ?? 0, schema.maxLength ?? 256));
  const minimum = schema.minimum ?? 0;
  const maximum = schema.maximum ?? Math.max(0, minimum);
  const candidate = schema.type === 'integer' ? Math.ceil(minimum) : minimum;
  return Math.min(maximum, Math.max(candidate, 0));
}

export function validateEntitySchemaValue(schema: EntityJsonSchema, value: unknown, path = 'entity'): string[] {
  const errors: string[] = [];
  const at = path;
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${at} must be an object.`];
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!Object.hasOwn(record, key)) errors.push(`${at}.${key} is required.`);
    for (const key of Object.keys(record)) {
      const child = schema.properties?.[key];
      if (!child) { if (schema.additionalProperties === false) errors.push(`${at}.${key} is not allowed.`); continue; }
      errors.push(...validateEntitySchemaValue(child, record[key], `${at}.${key}`));
    }
    return errors;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${at} must be an array.`];
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at} must contain at least ${schema.minItems} item(s).`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at} must contain at most ${schema.maxItems} item(s).`);
    value.forEach((item, index) => errors.push(...validateEntitySchemaValue(schema.items!, item, `${at}[${index}]`)));
    return errors;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return [`${at} must be text.`];
    if (schema.enum && !schema.enum.some(item => item === value)) errors.push(`${at} must be one of the listed values.`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at} is shorter than ${schema.minLength} characters.`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at} is longer than ${schema.maxLength} characters.`);
    return errors;
  }
  if (schema.type === 'boolean') return typeof value === 'boolean' ? errors : [`${at} must be true or false.`];
  if (typeof value !== 'number' || !Number.isFinite(value) || schema.type === 'integer' && !Number.isInteger(value)) return [`${at} must be a valid ${schema.type}.`];
  if (schema.enum && !schema.enum.some(item => item === value)) errors.push(`${at} must be one of the listed values.`);
  if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at} must be at least ${schema.minimum}.`);
  if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at} must be at most ${schema.maximum}.`);
  return errors;
}
