// The expression builder's model: OR-ed groups of AND-ed conditions, each a
// field, an operator and the value as typed. Converts to and from the
// expression tree in src/shared/ruleExpression.ts. Expressions that don't fit
// this shape (e.g. `not (a or b)`) can only be edited as text.

import {
  OPS_BY_TYPE,
  parseRuleExpression,
  printRuleExpression,
  type ExprError,
  fieldType,
  parseCidr,
  parseIp,
  type CmpOp,
  type Literal,
  type RuleExpr,
  type RuleField,
  type RuleFieldType,
  type SetItem,
} from "../../../shared/ruleExpression";

export type BuilderOp =
  CmpOp | "not_contains" | "starts_with" | "ends_with" | "in" | "not_in";

export const BUILDER_OPS: Record<RuleFieldType, readonly BuilderOp[]> = {
  string: [
    "eq",
    "ne",
    "contains",
    "not_contains",
    "wildcard",
    "starts_with",
    "ends_with",
    "in",
    "not_in",
  ],
  ip: ["eq", "ne", "in", "not_in"],
  int: ["eq", "ne", "lt", "le", "gt", "ge", "in", "not_in"],
  array: ["contains", "not_contains", "in", "not_in"],
};

export const isSetOp = (op: BuilderOp) => op === "in" || op === "not_in";

export interface Condition {
  /** Stable React key. */
  key: string;
  field: RuleField;
  op: BuilderOp;
  /** As typed; sets are comma-separated. */
  value: string;
}

/** OR of AND groups. Empty means every event. */
export type Groups = Condition[][];

let seq = 0;
const newKey = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

export function newCondition(field: RuleField = "event"): Condition {
  return {
    key: newKey(),
    field,
    op: BUILDER_OPS[fieldType(field)][0],
    value: "",
  };
}

// ─── Builder → expression ────────────────────────────────────────────────────

function literal(type: RuleFieldType, raw: string): Literal | null {
  const v = type === "int" || type === "ip" ? raw.trim() : raw;
  if (!v) return null;
  if (type === "int")
    return /^\d{1,9}$/.test(v) ? { t: "int", v: Number(v) } : null;
  if (type === "ip")
    return parseIp(v.toLowerCase()) ? { t: "ip", v: v.toLowerCase() } : null;
  return { t: "string", v };
}

function setItems(type: RuleFieldType, raw: string): SetItem[] | null {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const items: SetItem[] = [];
  for (const p of parts) {
    if (type === "int") {
      const range = /^(\d{1,9})\s*\.\.\s*(\d{1,9})$/.exec(p);
      if (range) {
        const from = Number(range[1]);
        const to = Number(range[2]);
        if (to < from) return null;
        items.push({ t: "range", from, to });
        continue;
      }
    }
    if (type === "ip" && p.includes("/")) {
      if (!parseCidr(p.toLowerCase())) return null;
      items.push({ t: "cidr", v: p.toLowerCase() });
      continue;
    }
    const lit = literal(type, p);
    if (!lit) return null;
    items.push(lit);
  }
  return items;
}

/** One condition as an expression node, or null when its value is invalid. */
function conditionToExpr(c: Condition): RuleExpr | null {
  const type = fieldType(c.field);
  if (!BUILDER_OPS[type].includes(c.op)) return null;
  switch (c.op) {
    case "in":
    case "not_in": {
      const items = setItems(type, c.value);
      if (!items) return null;
      const node: RuleExpr = { kind: "in", field: c.field, items };
      return c.op === "in" ? node : { kind: "not", expr: node };
    }
    case "starts_with":
    case "ends_with":
      return c.value
        ? { kind: "fn", fn: c.op, field: c.field, value: c.value }
        : null;
    case "not_contains": {
      const value = literal(type, c.value);
      if (!value) return null;
      return {
        kind: "not",
        expr: { kind: "cmp", field: c.field, op: "contains", value },
      };
    }
    default: {
      const value = literal(type, c.value);
      return value ? { kind: "cmp", field: c.field, op: c.op, value } : null;
    }
  }
}

/**
 * The expression for the builder's groups. `invalid` lists the conditions
 * whose value can't be used; the expression leaves them out.
 */
export function groupsToExpr(groups: Groups): {
  expr: RuleExpr | null;
  invalid: Set<string>;
} {
  const invalid = new Set<string>();
  const ors: RuleExpr[] = [];
  for (const group of groups) {
    const ands: RuleExpr[] = [];
    for (const c of group) {
      const e = conditionToExpr(c);
      if (e) ands.push(e);
      else invalid.add(c.key);
    }
    if (ands.length)
      ors.push(ands.length === 1 ? ands[0] : { kind: "and", items: ands });
  }
  const expr =
    ors.length === 0
      ? null
      : ors.length === 1
        ? ors[0]
        : { kind: "or" as const, items: ors };
  return { expr, invalid };
}

// ─── Expression → builder ────────────────────────────────────────────────────

function itemText(it: SetItem): string | null {
  if (it.t === "range") return `${it.from}..${it.to}`;
  if (it.t === "string") return it.v.includes(",") ? null : it.v;
  return String(it.v);
}

function nodeToCondition(e: RuleExpr): Condition | null {
  const make = (field: RuleField, op: BuilderOp, value: string): Condition => ({
    key: newKey(),
    field,
    op,
    value,
  });
  if (e.kind === "cmp") {
    if (!OPS_BY_TYPE[fieldType(e.field)].includes(e.op)) return null;
    return make(e.field, e.op, String(e.value.v));
  }
  if (e.kind === "fn") return make(e.field, e.fn, e.value);
  const set = (node: RuleExpr, op: "in" | "not_in") => {
    if (node.kind !== "in") return null;
    const texts = node.items.map(itemText);
    if (texts.some((x) => x === null)) return null;
    return make(node.field, op, texts.join(", "));
  };
  if (e.kind === "in") return set(e, "in");
  if (e.kind === "not") {
    const inner = e.expr;
    if (inner.kind === "in") return set(inner, "not_in");
    if (inner.kind === "cmp" && inner.op === "contains")
      return make(inner.field, "not_contains", String(inner.value.v));
  }
  return null;
}

/** The builder's groups for an expression, or null when it can't show it. */
export function exprToGroups(expr: RuleExpr | null): Groups | null {
  if (!expr) return [];
  const ors = expr.kind === "or" ? expr.items : [expr];
  const groups: Groups = [];
  for (const g of ors) {
    const ands = g.kind === "and" ? g.items : [g];
    const group: Condition[] = [];
    for (const node of ands) {
      const c = nodeToCondition(node);
      if (!c) return null;
      group.push(c);
    }
    groups.push(group);
  }
  return groups;
}

// ─── The "When events match…" card's state ─────────────────────────────────

export type MatchMode = "all" | "builder" | "text";

export interface MatchState {
  mode: MatchMode;
  groups: Groups;
  text: string;
}

/** The expression a match state saves, or the reason it can't be saved. */
export function matchExpression(
  m: MatchState,
):
  | { expression: string; error?: undefined; invalidRows?: Set<string> }
  | { expression?: undefined; error: ExprError | "invalid_rows" | "empty" } {
  if (m.mode === "all") return { expression: "" };
  if (m.mode === "builder") {
    const { expr, invalid } = groupsToExpr(m.groups);
    if (invalid.size) return { error: "invalid_rows" };
    if (!expr) return { error: "empty" };
    return { expression: printRuleExpression(expr) };
  }
  const r = parseRuleExpression(m.text);
  if (r.error) return { error: r.error };
  if (!r.expr) return { error: "empty" };
  return { expression: printRuleExpression(r.expr) };
}

/** The editing state for a saved expression. */
export function matchStateFor(expression: string): MatchState {
  const r = parseRuleExpression(expression);
  if (r.error) return { mode: "text", groups: [], text: expression };
  if (!r.expr) return { mode: "all", groups: [[newCondition()]], text: "" };
  const groups = exprToGroups(r.expr);
  return groups
    ? { mode: "builder", groups, text: expression }
    : { mode: "text", groups: [], text: expression };
}
