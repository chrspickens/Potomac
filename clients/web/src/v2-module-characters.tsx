import type { JsonValue, UiEntityProjection } from '@potomac/contracts';

type CharacterSource = { entity: UiEntityProjection; schema: JsonValue };
type CharacterRow = { key: string; name: string; source: UiEntityProjection };
type SchemaObject = Record<string, JsonValue>;

function object(value: JsonValue | undefined): SchemaObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as SchemaObject : undefined;
}

function atPath(data: JsonValue, path: string): JsonValue | undefined {
  let value: JsonValue | undefined = data;
  for (const part of path.split('.')) {
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined;
    if (Array.isArray(value) && /^\d+$/.test(part)) value = value[Number(part)];
    else value = object(value)?.[part];
  }
  return value;
}

function nestedOwners(data: JsonValue, schema: JsonValue, path = '', depth = 0): string[] {
  if (depth > 8) return [];
  const descriptor = object(schema);
  if (!descriptor) return [];
  const properties = object(descriptor.properties);
  if (descriptor.type === 'array' && Array.isArray(data)) {
    const itemSchema = object(descriptor.items);
    const itemProperties = itemSchema && object(itemSchema.properties);
    if (itemProperties && Object.hasOwn(itemProperties, 'ownerPrincipalId')) {
      return data.flatMap((item, index) => {
        const itemData = object(item);
        return itemData && typeof itemData.ownerPrincipalId === 'string' ? [`${path}.${index}`] : [];
      });
    }
    return [];
  }
  if (!properties) return [];
  return Object.entries(properties).flatMap(([key, childSchema]) => {
    const childData = object(data)?.[key];
    return childData === undefined ? [] : nestedOwners(childData, childSchema, path ? `${path}.${key}` : key, depth + 1);
  });
}

function characterRows(source: CharacterSource, isGm: boolean, principalId: string): CharacterRow[] {
  const { entity, schema } = source;
  if (!entity.data || typeof entity.data !== 'object' || Array.isArray(entity.data)) return [];
  const data = entity.data;
  const paths = (isGm ? nestedOwners(data, schema) : entity.viewerOwnedPaths ?? []).filter(path => {
    const character = object(atPath(data, path));
    if (!character) return false;
    const owner = character.ownerPrincipalId;
    return isGm ? typeof owner === 'string' && owner !== principalId : true;
  });
  return paths.flatMap(path => {
    const value = atPath(entity.data, path);
    const character = object(value);
    if (!character) return [];
    const name = [character.name, character.label, character.title].find(item => typeof item === 'string' && item.trim());
    return [{ key: `${entity.entityId}:${path}`, name: typeof name === 'string' ? name : 'Character', source: entity }];
  });
}

export function V2ModuleCharacters({ sources, isGm, principalId, onOpenInTable }: { sources: CharacterSource[]; isGm: boolean; principalId: string; onOpenInTable?: (entityId: string) => void }) {
  const rows = sources.flatMap(source => characterRows(source, isGm, principalId));
  if (!rows.length) return null;
  return <section className="v2-setup-card" aria-label="Authorized module characters"><h2>Authorized module characters</h2><ul>{rows.map(row => {
    const data = object(row.source.data);
    const encounter = data && [data.title, data.name, data.label].find(value => typeof value === 'string' && value.trim());
    return <li key={row.key}><strong>{row.name}</strong>{typeof encounter === 'string' && <span> · {encounter}</span>}{onOpenInTable && <button type="button" onClick={() => onOpenInTable(row.source.entityId)}>Open in Table</button>}</li>;
  })}</ul></section>;
}
