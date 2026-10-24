import type { JsonValue, UiEntityProjection } from '@potomac/contracts';
import './v2-table.css';

const text = (value: JsonValue | undefined): string => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);

export function V2EncounterParticipants({ entity, schema }: { entity: UiEntityProjection; schema: JsonValue }) {
  if (!entity.data || typeof entity.data !== 'object' || Array.isArray(entity.data)) return <p>No spatial data is declared for this entity.</p>;
  const data = entity.data as Record<string, JsonValue>;
  const properties = schema && typeof schema === 'object' && !Array.isArray(schema) && 'properties' in schema && schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties) ? schema.properties as Record<string, JsonValue> : {};
  const gridKey = Object.keys(properties).find(key => key === 'grid' && data[key] && typeof data[key] === 'object' && !Array.isArray(data[key]));
  const grid = gridKey ? data[gridKey] as Record<string, JsonValue> : undefined;
  const participantKey = Object.entries(properties).find(([, value]) => value && typeof value === 'object' && !Array.isArray(value) && 'type' in value && value.type === 'array' && 'items' in value && value.items && typeof value.items === 'object' && !Array.isArray(value.items) && 'properties' in value.items && value.items.properties && typeof value.items.properties === 'object' && !Array.isArray(value.items.properties) && 'position' in value.items.properties)?.[0];
  const actors = participantKey && Array.isArray(data[participantKey]) ? data[participantKey] as JsonValue[] : [];
  const positioned = actors.filter((actor): actor is Record<string, JsonValue> => Boolean(actor && typeof actor === 'object' && !Array.isArray(actor) && actor.position && typeof actor.position === 'object' && !Array.isArray(actor.position)));
  if (grid && Number.isInteger(grid.width) && Number.isInteger(grid.height) && (grid.width as number) > 0 && (grid.height as number) > 0 && positioned.length) {
    const width = Math.min(30, grid.width as number), height = Math.min(30, grid.height as number);
    const at = new Map<string, string[]>();
    for (const actor of positioned) { const pos = actor.position as Record<string, JsonValue>; if (!Number.isInteger(pos.x) || !Number.isInteger(pos.y)) continue; const key = `${pos.x},${pos.y}`; at.set(key, [...(at.get(key) ?? []), String(actor.name ?? actor.id ?? 'Participant')]); }
    const blocked = new Set(Array.isArray(grid.blocked) ? grid.blocked.flatMap(item => item && typeof item === 'object' && !Array.isArray(item) && Number.isInteger(item.x) && Number.isInteger(item.y) ? [`${item.x},${item.y}`] : []) : []);
    return <div className="v2-table-map" aria-label="Encounter battle map"><p>Grid · {String(grid.width)} × {String(grid.height)}{typeof grid.squareFeet === 'number' ? ` · ${grid.squareFeet} ft squares` : ''}</p><div className="v2-table-grid" style={{ gridTemplateColumns: `repeat(${width}, minmax(2rem, 1fr))` }}>{Array.from({ length: width * height }, (_, i) => { const x = i % width, y = Math.floor(i / width), labels = at.get(`${x},${y}`) ?? [], isBlocked = blocked.has(`${x},${y}`); return <div className={isBlocked ? 'is-blocked' : ''} key={`${x},${y}`} aria-label={`Square ${x}, ${y}${isBlocked ? ', blocked' : ''}${labels.length ? `: ${labels.join(', ')}` : ''}`} title={`${isBlocked ? 'Blocked · ' : ''}${labels.join(', ')}`}>{labels.map(label => label.slice(0, 2)).join('/') || (isBlocked ? '×' : '')}</div>; })}</div>{positioned.map((actor, index) => { const pos = actor.position as Record<string, JsonValue>; return <p key={String(actor.id ?? index)}>{String(actor.name ?? actor.id ?? 'Participant')} · ({text(pos.x)}, {text(pos.y)})</p>; })}</div>;
  }
  return <div className="v2-table-roster"><p>{grid ? 'Grid is available; participant positions are not declared.' : 'No grid is declared; showing the authorized participant roster.'}</p>{actors.map((actor, index) => actor && typeof actor === 'object' && !Array.isArray(actor) ? <p key={String(actor.id ?? index)}><strong>{String(actor.name ?? actor.id ?? 'Participant')}</strong>{typeof actor.kind === 'string' ? ` · ${actor.kind}` : ''}{actor.resources && typeof actor.resources === 'object' ? ` · ${text(actor.resources)}` : ''}</p> : null)}</div>;
}
