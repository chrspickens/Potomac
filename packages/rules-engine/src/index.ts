import type { ActionDefinition, Expression, JsonValue } from "@potomac/contracts";

const MAX_NODES = 256;
const MAX_DEPTH = 32;

function readPath(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object" || !(key in value)) throw new Error(`Unknown field reference: ${path}`);
    return (value as Record<string, unknown>)[key];
  }, root);
}

export function evaluate(expression: Expression, state: Record<string, JsonValue>): JsonValue {
  let fuel = MAX_NODES;
  const visit = (node: Expression, depth: number): JsonValue => {
    if (--fuel < 0) throw new Error("Rules execution budget exhausted");
    if (depth > MAX_DEPTH) throw new Error("Rules expression depth exceeded");
    if ("literal" in node) return node.literal;
    if ("ref" in node) {
      const value = readPath(state, node.ref);
      if (value === undefined || value === null || typeof value === "object") throw new Error(`Invalid scalar reference: ${node.ref}`);
      return value as JsonValue;
    }
    if (node.op === "not") {
      const value = visit(node.value, depth + 1);
      if (typeof value !== "boolean") throw new Error("not expects a boolean");
      return !value;
    }
    const left = visit(node.left, depth + 1);
    const right = visit(node.right, depth + 1);
    switch (node.op) {
      case "add": case "sub": case "mul": case "div": case "subtract": case "multiply": case "divide": {
        if (typeof left !== "number" || typeof right !== "number") throw new Error(`${node.op} expects numbers`);
        if ((node.op === "div" || node.op === "divide") && right === 0) throw new Error("Division by zero");
        const result = node.op === "add" ? left + right : node.op === "sub" || node.op === "subtract" ? left - right : node.op === "mul" || node.op === "multiply" ? left * right : left / right;
        if (!Number.isFinite(result)) throw new Error("Non-finite arithmetic result");
        return result;
      }
      case "gt": case "gte":
        if (typeof left !== "number" || typeof right !== "number") throw new Error(`${node.op} expects numbers`);
        return node.op === "gt" ? left > right : left >= right;
      case "eq": return typeof left === typeof right && left === right;
      case "and": case "or":
        if (typeof left !== "boolean" || typeof right !== "boolean") throw new Error(`${node.op} expects booleans`);
        return node.op === "and" ? left && right : left || right;
    }
  };
  return visit(expression, 0);
}

export function executeAction(action: ActionDefinition, state: Record<string, JsonValue>, rolls: number[] = []): { state: Record<string, JsonValue>; rolls: number[] } {
  if (action.requires && evaluate(action.requires, state) !== true) throw new Error("Action precondition failed");
  const next = structuredClone(state);
  for (const effect of action.effects) {
    const value = evaluate(effect.amount, state);
    if (typeof value !== "number") throw new Error("Resource effect must be numeric");
    const path = effect.resource.startsWith("resources.") ? effect.resource.split(".") : ["resources", ...effect.resource.split(".")];
    const key = path.pop()!;
    const resource = path.reduce<Record<string, JsonValue> | undefined>((value, part) => value && typeof value[part] === "object" && value[part] !== null && !Array.isArray(value[part]) ? value[part] as Record<string, JsonValue> : undefined, next);
    if (!resource) throw new Error("Missing resource path");
    const current = resource[key];
    if (typeof current !== "number") throw new Error(`Unknown numeric resource: ${effect.resource}`);
    const updated = current + value;
    const maximum = typeof resource.maximum === "number" ? resource.maximum : Infinity;
    if (updated < 0 || updated > maximum) throw new Error(`Resource ${effect.resource} is out of bounds`);
    resource[key] = updated;
  }
  const dice = action.resolution?.dice || (action.roll ? [{ count: action.roll.dice, sides: action.roll.sides }] : []);
  const expected = dice.reduce((total, group) => total + group.count, 0);
  let cursor = 0;
  for (const group of dice) for (let die = 0; die < group.count; die++) {
    const value = rolls[cursor++];
    if (!Number.isInteger(value) || value < 1 || value > group.sides) throw new Error("Host roll results are missing or invalid");
  }
  if (rolls.length !== expected) throw new Error("Host roll results are missing or invalid");
  return { state: next, rolls: [...rolls] };
}
