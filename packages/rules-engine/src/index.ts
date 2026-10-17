import type { ActionDefinition, Expression, JsonValue } from "@potomac/contracts";
export * from "./resolver.js";

const MAX_NODES = 256;
const MAX_DEPTH = 32;

function readPath(root: unknown, path: string): unknown {
  if (!path || path.split(".").some((part) => !part || part === "__proto__" || part === "prototype" || part === "constructor")) {
    throw new Error(`Invalid field reference: ${path}`);
  }
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error(`Unknown field reference: ${path}`);
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
      if (value === null || typeof value === "object" || (typeof value === "number" && !Number.isFinite(value))) {
        throw new Error(`Invalid scalar reference: ${node.ref}`);
      }
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

type ModuleEffect = ActionDefinition["effects"][number] & { target?: string };
export type ActionPolicy = "selfService" | "gmReview";
export type ResolvedActionPolicy = ActionPolicy | "immediate";
export type RuleAction = Omit<ActionDefinition, "effects"> & {
  effects?: ModuleEffect[];
  policy?: ActionPolicy;
  reconciliation?: "commutative";
  resolution?: ActionDefinition["resolution"];
};

/** Resolve the host-facing approval policy; missing metadata preserves legacy immediate behavior. */
export function getActionPolicy(action: RuleAction): ResolvedActionPolicy {
  if (action.policy === undefined) return "immediate";
  if (action.policy === "selfService" || action.policy === "gmReview") return action.policy;
  throw new Error("Unsupported action policy");
}

export function getRequiredRollCount(action: RuleAction): number {
  const dice = action.resolution?.dice || (action.roll ? [{ count: action.roll.dice, sides: action.roll.sides }] : []);
  if (dice.some((group) => !Number.isInteger(group.count) || group.count < 0 || !Number.isInteger(group.sides) || group.sides < 1)) throw new Error("Invalid dice definition");
  const expected = dice.reduce((total, group) => total + group.count, 0);
  if (expected > MAX_NODES) throw new Error("Rules execution budget exhausted");
  return expected;
}

/** Purely evaluate an action against committed state and host-provided random values. */
export function executeAction(
  action: RuleAction,
  state: Record<string, JsonValue>,
  rolls: number[] = [],
): { state: Record<string, JsonValue>; rolls: number[] } {
  if (action.requires && evaluate(action.requires, state) !== true) throw new Error("Action precondition failed");
  const next = structuredClone(state);
  for (const effect of action.effects || []) {
    if (effect.op !== "changeResource" || (effect.target !== undefined && effect.target !== "self")) throw new Error("Unsupported action effect");
    const amount = evaluate(effect.amount, state);
    if (typeof amount !== "number") throw new Error("Resource effect must be numeric");
    const resourcePath = effect.resource.startsWith("resources.") ? effect.resource : `resources.${effect.resource}`;
    const parts = resourcePath.split(".");
    if (parts.some((part) => !part || part === "__proto__" || part === "prototype" || part === "constructor")) throw new Error("Invalid resource path");
    const key = parts.pop()!;
    const parent = parts.reduce<Record<string, JsonValue> | undefined>((value, part) =>
      value && typeof value[part] === "object" && value[part] !== null && !Array.isArray(value[part]) ? value[part] as Record<string, JsonValue> : undefined, next);
    const current = parent?.[key];
    if (typeof current !== "number" || !Number.isFinite(current)) throw new Error(`Unknown numeric resource ${effect.resource}`);
    const updated = current + amount;
    const maximum = typeof parent?.maximum === "number" ? parent.maximum : Infinity;
    if (!Number.isFinite(updated) || updated < 0 || updated > maximum) throw new Error(`Resource ${effect.resource} is out of bounds`);
    parent[key] = updated;
  }
  const dice = action.resolution?.dice || (action.roll ? [{ count: action.roll.dice, sides: action.roll.sides }] : []);
  const expected = getRequiredRollCount(action);
  if (rolls.length !== expected) throw new Error("Host roll results are missing or invalid");
  let cursor = 0;
  for (const group of dice) {
    for (let die = 0; die < group.count; die++) {
      const value = rolls[cursor++];
      if (!Number.isInteger(value) || value < 1 || value > group.sides) throw new Error("Host roll results are missing or invalid");
    }
  }
  return { state: next, rolls: [...rolls] };
}
