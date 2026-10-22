import type { JsonValue } from "./index.js";

export type V2GridPositionConstraint = {
  type: "unique-grid-positions";
  participantsPath: string;
  gridPath: string;
  positionPath: string;
  blockedPath: string;
  namePath: string;
};

export type V2PreparationConstraint = V2GridPositionConstraint;

function atPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (current === null || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, value);
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Validates module-declared starting positions for both UI feedback and host entity creation. */
export function validateV2PreparationConstraints(
  value: JsonValue,
  constraints: V2PreparationConstraint[] = [],
): string[] {
  const errors: string[] = [];
  for (const constraint of constraints) {
    if (constraint.type !== "unique-grid-positions") continue;
    const participants = atPath(value, constraint.participantsPath);
    const grid = object(atPath(value, constraint.gridPath));
    const blocked = atPath(value, constraint.blockedPath);
    if (!Array.isArray(participants) || !grid || !Number.isInteger(grid.width) || !Number.isInteger(grid.height) || !Array.isArray(blocked)) continue;
    const occupied = new Map<string, string>();
    const blockedSquares = new Set(blocked.flatMap(square => {
      const point = object(square);
      return point && Number.isInteger(point.x) && Number.isInteger(point.y) ? [`${point.x},${point.y}`] : [];
    }));
    for (const participant of participants) {
      const actor = object(participant);
      if (!actor) continue;
      const name = String(atPath(actor, constraint.namePath) ?? "Participant").trim() || "Participant";
      const position = object(atPath(actor, constraint.positionPath));
      if (!position || !Number.isInteger(position.x) || !Number.isInteger(position.y)) {
        errors.push(`${name} needs a starting square on the grid.`);
        continue;
      }
      const x = position.x as number, y = position.y as number, key = `${x},${y}`;
      if (x < 0 || y < 0 || x >= (grid.width as number) || y >= (grid.height as number)) {
        errors.push(`${name} must start inside the ${grid.width} × ${grid.height} grid.`);
        continue;
      }
      if (blockedSquares.has(key)) {
        errors.push(`${name} cannot start on blocked square (${x}, ${y}).`);
        continue;
      }
      const previous = occupied.get(key);
      if (previous) errors.push(`${name} shares square (${x}, ${y}) with ${previous}; choose a different square.`);
      else occupied.set(key, name);
    }
  }
  return errors;
}
