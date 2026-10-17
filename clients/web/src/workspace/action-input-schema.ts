import type { ActionInputProperty } from '../modules.ts';

export function isSupportedActionEnum(schema: ActionInputProperty): boolean {
  if (!Array.isArray(schema.enum)) return false;
  return schema.enum.every(value => {
    if (typeof value === 'string') return schema.type === undefined || schema.type === 'string';
    if (typeof value === 'boolean') return schema.type === undefined || schema.type === 'boolean';
    if (typeof value === 'number' && Number.isFinite(value)) {
      return schema.type === undefined || schema.type === 'number' || schema.type === 'integer' && Number.isInteger(value);
    }
    return false;
  });
}

export function getActionEnumValue(schema: ActionInputProperty, selectedIndex: string): unknown {
  if (!isSupportedActionEnum(schema) || !/^\d+$/.test(selectedIndex)) return undefined;
  const index = Number(selectedIndex);
  return Number.isSafeInteger(index) && index < (schema.enum?.length || 0) ? schema.enum?.[index] : undefined;
}

export function getActionEnumIndex(schema: ActionInputProperty, value: unknown): string {
  if (!isSupportedActionEnum(schema) || value === undefined) return '';
  const index = schema.enum?.findIndex(option => Object.is(option, value)) ?? -1;
  return index < 0 ? '' : String(index);
}
