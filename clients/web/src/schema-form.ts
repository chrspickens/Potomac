export type FieldSchema = { $ref?: string; type?: string; properties?: Record<string, FieldSchema>; required?: string[]; default?: unknown; minimum?: number; maximum?: number; maxLength?: number }

export function createSchemaDefaults(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties as Record<string, FieldSchema> : {}
  const definitions = schema.$defs && typeof schema.$defs === 'object' ? schema.$defs as Record<string, FieldSchema> : {}
  const fill = (definition: FieldSchema): unknown => {
    if (typeof definition.$ref === 'string' && definition.$ref.startsWith('#/$defs/')) return fill(definitions[definition.$ref.slice('#/$defs/'.length)] || {})
    if (definition.default !== undefined) return definition.default
    if (definition.type === 'object') return Object.fromEntries(Object.entries(definition.properties || {}).map(([key, child]) => [key, fill(child)]))
    if (definition.type === 'integer' || definition.type === 'number') return definition.minimum ?? 0
    if (definition.type === 'string') return ''
    return undefined
  }
  return Object.fromEntries(Object.entries(properties)
    .filter(([key]) => !['moduleId', 'moduleVersion', 'schemaVersion', 'entityId', 'revision', 'derived', 'secretNote'].includes(key))
    .map(([key, definition]) => [key, fill(definition)]))
}
