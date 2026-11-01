// Notification rule expressions, shared by the Worker (validation on save,
// evaluation at dispatch) and the frontend (builder, preview, trace).
//
// The syntax follows Cloudflare's Rules language, cut down to what a
// notification carries:
//
//   event.category eq "security" and not ip.src in {10.0.0.0/8 192.168.0.0/16}
//   (resource.name wildcard "prod-*" or http.user_agent contains "curl")
//   time.hour in {0..6 22..23} and starts_with(event, "connection.")
//
// - Fields are typed (RULE_FIELDS); every comparison is checked against the
//   field's type when parsed, so a saved expression can always be evaluated.
// - Logic: `and` / `&&`, `or` / `||`, `not` / `!`, parentheses.
//   `not` binds tighter than `and`, which binds tighter than `or`.
// - Comparisons: eq ne lt le gt ge (or == != < <= > >=), contains, wildcard,
//   in {…}, and the functions starts_with(field, "x") / ends_with(field, "x").
// - `wildcard` is case-insensitive and supports `*` only. Everything else is
//   case-sensitive.
// - Nothing here compiles user input into a RegExp: wildcard matching is a
//   linear two-pointer walk, so a pattern can't make evaluation blow up.
// - An empty expression matches every event.

export type RuleFieldType = "string" | "ip" | "int" | "array";

export const RULE_FIELDS = {
  event: { type: "string" },
  "event.category": { type: "string" },
  "ip.src": { type: "ip" },
  "ip.src.country": { type: "string" },
  "http.user_agent": { type: "string" },
  "resource.name": { type: "string" },
  "oauth.scopes": { type: "array" },
  "profile.changed_fields": { type: "array" },
  "time.hour": { type: "int" },
  "time.weekday": { type: "int" },
} as const satisfies Record<string, { type: RuleFieldType }>;

export type RuleField = keyof typeof RULE_FIELDS;

export const RULE_FIELD_NAMES = Object.keys(RULE_FIELDS) as RuleField[];

export function fieldType(field: RuleField): RuleFieldType {
  return RULE_FIELDS[field].type;
}

export type CmpOp =
  "eq" | "ne" | "lt" | "le" | "gt" | "ge" | "contains" | "wildcard";

export type RuleFn = "starts_with" | "ends_with";

export type Literal =
  | { t: "string"; v: string }
  | { t: "int"; v: number }
  /** IPv4 or IPv6 address, as written (lowercased). */
  | { t: "ip"; v: string };

export type SetItem =
  | Literal
  | { t: "range"; from: number; to: number }
  /** CIDR block, as written (lowercased), e.g. "10.0.0.0/8". */
  | { t: "cidr"; v: string };

export type RuleExpr =
  | { kind: "and" | "or"; items: RuleExpr[] }
  | { kind: "not"; expr: RuleExpr }
  | { kind: "cmp"; field: RuleField; op: CmpOp; value: Literal }
  | { kind: "in"; field: RuleField; items: SetItem[] }
  | { kind: "fn"; fn: RuleFn; field: RuleField; value: string };

/** Which comparisons each field type accepts. */
export const OPS_BY_TYPE: Record<RuleFieldType, readonly CmpOp[]> = {
  string: ["eq", "ne", "contains", "wildcard"],
  ip: ["eq", "ne"],
  int: ["eq", "ne", "lt", "le", "gt", "ge"],
  array: ["contains"],
};

export const LIMITS = {
  length: 4096,
  depth: 32,
  conditions: 200,
  setItems: 100,
  string: 512,
} as const;

export type ExprErrorCode =
  | "unexpected_end"
  | "unexpected_token"
  | "unterminated_string"
  | "unknown_field"
  | "bad_operator"
  | "bad_value"
  | "too_long"
  | "too_deep"
  | "too_many_items";

export interface ExprError {
  code: ExprErrorCode;
  /** Character offset in the source. */
  at: number;
  /** The offending token, when there is one. */
  token?: string;
}

export type ParseResult =
  | { expr: RuleExpr | null; error?: undefined }
  | { expr?: undefined; error: ExprError };

// ─── IP addresses ────────────────────────────────────────────────────────────

/** 16 bytes; IPv4 is stored IPv4-mapped (::ffff:a.b.c.d). */
type IpBytes = number[];

function parseIpv4(s: string): number[] | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

function parseIpv6(s: string): IpBytes | null {
  if (!/^[0-9a-f:.]+$/i.test(s) || s.length > 45) return null;
  let tail: number[] = [];
  let head = s;
  // Embedded IPv4 in the last 32 bits, e.g. ::ffff:1.2.3.4
  const lastColon = s.lastIndexOf(":");
  if (s.slice(lastColon + 1).includes(".")) {
    const v4 = parseIpv4(s.slice(lastColon + 1));
    if (!v4) return null;
    tail = v4;
    head = s.slice(0, lastColon + 1) + "0:0";
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string) =>
    part === "" ? [] : part.split(":").map((g) => g);
  const left = groups(halves[0]);
  const right = halves.length === 2 ? groups(halves[1]) : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? left.length !== 8 : missing < 1) return null;
  const all = [
    ...left,
    ...Array(halves.length === 2 ? missing : 0).fill("0"),
    ...right,
  ];
  const bytes: number[] = [];
  for (const g of all) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

/** An address as 16 bytes, or null when it isn't one. */
export function parseIp(s: string): IpBytes | null {
  if (s.includes(":")) return parseIpv6(s);
  const v4 = parseIpv4(s);
  return v4 ? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, ...v4] : null;
}

export function parseCidr(s: string): { bytes: IpBytes; bits: number } | null {
  const slash = s.indexOf("/");
  if (slash < 0) return null;
  const bytes = parseIp(s.slice(0, slash));
  const prefix = s.slice(slash + 1);
  if (!bytes || !/^\d{1,3}$/.test(prefix)) return null;
  const v4 = !s.includes(":");
  const n = Number(prefix);
  if (n > (v4 ? 32 : 128)) return null;
  return { bytes, bits: v4 ? n + 96 : n };
}

function inCidr(ip: IpBytes, block: { bytes: IpBytes; bits: number }) {
  for (let i = 0; i < 16; i++) {
    const take = Math.min(8, Math.max(0, block.bits - i * 8));
    if (take === 0) return true;
    const mask = (0xff << (8 - take)) & 0xff;
    if ((ip[i] & mask) !== (block.bytes[i] & mask)) return false;
  }
  return true;
}

function sameIp(a: IpBytes, b: IpBytes) {
  return a.every((x, i) => x === b[i]);
}

// ─── Lexer ───────────────────────────────────────────────────────────────────

type Tok =
  | { k: "punct"; v: "(" | ")" | "{" | "}" | "," | ".."; at: number }
  | { k: "op"; v: string; at: number }
  | { k: "word"; v: string; at: number }
  | { k: "string"; v: string; at: number; raw: string }
  | { k: "int"; v: number; at: number; raw: string }
  | { k: "ip"; v: string; at: number }
  | { k: "cidr"; v: string; at: number };

const SYMBOL_OPS = ["==", "!=", "<=", ">=", "&&", "||", "<", ">", "!"];

class ExprFail extends Error {
  readonly err: ExprError;
  constructor(err: ExprError) {
    super(err.code);
    this.err = err;
  }
}

function fail(code: ExprErrorCode, at: number, token?: string): never {
  throw new ExprFail({ code, at, token });
}

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const at = i;
    if (c === '"') {
      let v = "";
      i++;
      for (;;) {
        if (i >= src.length) fail("unterminated_string", at);
        const ch = src[i];
        if (ch === "\\") {
          if (i + 1 >= src.length) fail("unterminated_string", at);
          v += src[i + 1];
          i += 2;
        } else if (ch === '"') {
          i++;
          break;
        } else {
          v += ch;
          i++;
        }
      }
      if (v.length > LIMITS.string) fail("too_long", at);
      toks.push({ k: "string", v, at, raw: src.slice(at, i) });
      continue;
    }
    if (src.startsWith("..", i)) {
      toks.push({ k: "punct", v: "..", at });
      i += 2;
      continue;
    }
    if ("(){},".includes(c)) {
      toks.push({ k: "punct", v: c as "(" | ")" | "{" | "}" | ",", at });
      i++;
      continue;
    }
    const sym = SYMBOL_OPS.find((s) => src.startsWith(s, i));
    if (sym) {
      toks.push({ k: "op", v: sym, at });
      i += sym.length;
      continue;
    }
    // An address: IPv6 (has a colon) or IPv4 (dotted quad), optional /prefix.
    const addr = /^[0-9a-f:.]+(\/\d+)?/i.exec(src.slice(i))?.[0] ?? "";
    if (addr && (addr.includes(":") || /^\d+\.\d+\.\d+\.\d+/.test(addr))) {
      const lower = addr.toLowerCase();
      if (lower.includes("/")) {
        if (!parseCidr(lower)) fail("bad_value", at, addr);
        toks.push({ k: "cidr", v: lower, at });
      } else {
        if (!parseIp(lower)) fail("bad_value", at, addr);
        toks.push({ k: "ip", v: lower, at });
      }
      i += addr.length;
      continue;
    }
    const num = /^\d+/.exec(src.slice(i))?.[0];
    if (num) {
      if (num.length > 9) fail("bad_value", at, num);
      toks.push({ k: "int", v: Number(num), at, raw: num });
      i += num.length;
      continue;
    }
    const word = /^[a-z_][a-z0-9_.]*/i.exec(src.slice(i))?.[0];
    if (word) {
      toks.push({ k: "word", v: word, at });
      i += word.length;
      continue;
    }
    fail("unexpected_token", at, c);
  }
  return toks;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

const WORD_OPS: Record<string, CmpOp> = {
  eq: "eq",
  ne: "ne",
  lt: "lt",
  le: "le",
  gt: "gt",
  ge: "ge",
  contains: "contains",
  wildcard: "wildcard",
};
const SYMBOL_CMP: Record<string, CmpOp> = {
  "==": "eq",
  "!=": "ne",
  "<": "lt",
  "<=": "le",
  ">": "gt",
  ">=": "ge",
};

function tokText(t: Tok): string {
  if (t.k === "string" || t.k === "int") return t.raw;
  return String(t.v);
}

class Parser {
  private pos = 0;
  private depth = 0;
  private conditions = 0;
  private readonly toks: Tok[];
  private readonly end: number;
  constructor(toks: Tok[], end: number) {
    this.toks = toks;
    this.end = end;
  }

  private peek(): Tok | undefined {
    return this.toks[this.pos];
  }
  private next(): Tok {
    const t = this.toks[this.pos++];
    if (!t) fail("unexpected_end", this.end);
    return t;
  }
  private isWord(v: string) {
    const t = this.peek();
    return t?.k === "word" && t.v === v;
  }
  private isOp(v: string) {
    const t = this.peek();
    return t?.k === "op" && t.v === v;
  }
  private expectPunct(v: string) {
    const t = this.next();
    if (t.k !== "punct" || t.v !== v)
      fail("unexpected_token", t.at, tokText(t));
  }

  parseAll(): RuleExpr {
    const e = this.or();
    const t = this.peek();
    if (t) fail("unexpected_token", t.at, tokText(t));
    return e;
  }

  private enter() {
    if (++this.depth > LIMITS.depth)
      fail("too_deep", this.peek()?.at ?? this.end);
  }

  private or(): RuleExpr {
    this.enter();
    const items = [this.and()];
    while (this.isWord("or") || this.isOp("||")) {
      this.pos++;
      items.push(this.and());
    }
    this.depth--;
    return items.length === 1 ? items[0] : { kind: "or", items };
  }

  private and(): RuleExpr {
    const items = [this.unary()];
    while (this.isWord("and") || this.isOp("&&")) {
      this.pos++;
      items.push(this.unary());
    }
    return items.length === 1 ? items[0] : { kind: "and", items };
  }

  private unary(): RuleExpr {
    if (this.isWord("not") || this.isOp("!")) {
      this.pos++;
      this.enter();
      const expr = this.unary();
      this.depth--;
      return { kind: "not", expr };
    }
    return this.primary();
  }

  private field(): RuleField {
    const t = this.next();
    if (t.k !== "word") fail("unexpected_token", t.at, tokText(t));
    if (!Object.hasOwn(RULE_FIELDS, t.v)) fail("unknown_field", t.at, t.v);
    return t.v as RuleField;
  }

  private count(at: number) {
    if (++this.conditions > LIMITS.conditions) fail("too_many_items", at);
  }

  private primary(): RuleExpr {
    const t = this.peek();
    if (!t) return fail("unexpected_end", this.end);
    if (t.k === "punct" && t.v === "(") {
      this.pos++;
      const e = this.or();
      this.expectPunct(")");
      return e;
    }
    if (t.k === "word" && (t.v === "starts_with" || t.v === "ends_with")) {
      this.pos++;
      this.count(t.at);
      this.expectPunct("(");
      const fieldAt = this.peek()?.at ?? this.end;
      const field = this.field();
      if (fieldType(field) !== "string") fail("bad_operator", fieldAt, field);
      this.expectPunct(",");
      const v = this.next();
      if (v.k !== "string") fail("bad_value", v.at, tokText(v));
      this.expectPunct(")");
      return { kind: "fn", fn: t.v, field, value: (v as { v: string }).v };
    }
    this.count(t.at);
    const field = this.field();
    const type = fieldType(field);
    const opTok = this.next();
    if (opTok.k === "word" && opTok.v === "in") {
      return { kind: "in", field, items: this.set(type) };
    }
    const op =
      opTok.k === "word"
        ? Object.hasOwn(WORD_OPS, opTok.v)
          ? WORD_OPS[opTok.v]
          : undefined
        : opTok.k === "op"
          ? Object.hasOwn(SYMBOL_CMP, opTok.v)
            ? SYMBOL_CMP[opTok.v]
            : undefined
          : undefined;
    if (!op || !OPS_BY_TYPE[type].includes(op))
      fail("bad_operator", opTok.at, tokText(opTok));
    const v = this.next();
    return { kind: "cmp", field, op: op!, value: this.literal(v, type) };
  }

  /** A single value for a comparison against a field of `type`. */
  private literal(v: Tok, type: RuleFieldType): Literal {
    if ((type === "string" || type === "array") && v.k === "string")
      return { t: "string", v: v.v };
    if (type === "int" && v.k === "int") return { t: "int", v: v.v };
    if (type === "ip" && v.k === "ip") return { t: "ip", v: v.v };
    return fail("bad_value", v.at, tokText(v));
  }

  private set(type: RuleFieldType): SetItem[] {
    this.expectPunct("{");
    const items: SetItem[] = [];
    for (;;) {
      const t = this.next();
      if (t.k === "punct" && t.v === "}") break;
      if (items.length >= LIMITS.setItems) fail("too_many_items", t.at);
      if (type === "ip" && t.k === "cidr") {
        items.push({ t: "cidr", v: t.v });
      } else if (
        type === "int" &&
        t.k === "int" &&
        this.peek()?.k === "punct" &&
        (this.peek() as { v: string }).v === ".."
      ) {
        this.pos++;
        const to = this.next();
        if (to.k !== "int" || to.v < t.v) fail("bad_value", to.at, tokText(to));
        items.push({ t: "range", from: t.v, to: (to as { v: number }).v });
      } else {
        items.push(this.literal(t, type));
      }
    }
    if (items.length === 0) fail("bad_value", this.toks[this.pos - 1].at, "{}");
    return items;
  }
}

/** Parse and type-check an expression. Whitespace-only means "every event". */
export function parseRuleExpression(src: string): ParseResult {
  if (src.length > LIMITS.length)
    return { error: { code: "too_long", at: LIMITS.length } };
  try {
    const toks = lex(src);
    if (toks.length === 0) return { expr: null };
    return { expr: new Parser(toks, src.length).parseAll() };
  } catch (e) {
    if (e instanceof ExprFail) return { error: e.err };
    throw e;
  }
}

// ─── Serializer ──────────────────────────────────────────────────────────────

function quote(s: string) {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function printLiteral(l: SetItem): string {
  switch (l.t) {
    case "string":
      return quote(l.v);
    case "int":
      return String(l.v);
    case "range":
      return `${l.from}..${l.to}`;
    default:
      return l.v;
  }
}

const PREC = { or: 1, and: 2, not: 3, atom: 4 } as const;

/** Canonical text for an expression; parsing it gives the same tree. */
export function printRuleExpression(e: RuleExpr | null, parent = 0): string {
  if (!e) return "";
  switch (e.kind) {
    case "or":
    case "and": {
      const text = e.items
        .map((x) => printRuleExpression(x, PREC[e.kind] + 0.5))
        .join(` ${e.kind} `);
      return PREC[e.kind] < parent ? `(${text})` : text;
    }
    case "not": {
      const text = `not ${printRuleExpression(e.expr, PREC.not)}`;
      return PREC.not < parent ? `(${text})` : text;
    }
    case "cmp":
      return `${e.field} ${e.op} ${printLiteral(e.value)}`;
    case "in":
      return `${e.field} in {${e.items.map(printLiteral).join(" ")}}`;
    case "fn":
      return `${e.fn}(${e.field}, ${quote(e.value)})`;
  }
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

export type FieldValue = string | number | string[] | null;

/** What an expression is evaluated against: one event's field values. */
export type RuleContext = Partial<Record<RuleField, FieldValue>>;

/**
 * `*` matches any run of characters; case-insensitive. The literal pieces
 * between stars are found left to right with indexOf; with `*` as the only
 * metacharacter the leftmost match of each piece never needs revisiting, so
 * there is no backtracking.
 */
export function wildcardMatch(pattern: string, text: string): boolean {
  const pieces = pattern.toLowerCase().split("*");
  const s = text.toLowerCase();
  if (pieces.length === 1) return s === pieces[0];
  const first = pieces[0];
  const last = pieces[pieces.length - 1];
  if (s.length < first.length + last.length) return false;
  if (!s.startsWith(first) || !s.endsWith(last)) return false;
  let at = first.length;
  const end = s.length - last.length;
  for (let i = 1; i < pieces.length - 1; i++) {
    const piece = pieces[i];
    if (!piece) continue;
    const found = s.indexOf(piece, at);
    if (found < 0 || found + piece.length > end) return false;
    at = found + piece.length;
  }
  return true;
}

function cmp(op: CmpOp, value: FieldValue, lit: Literal): boolean {
  if (value === null || value === undefined || value === "") return op === "ne";
  if (Array.isArray(value)) {
    return op === "contains" && value.includes(lit.v as string);
  }
  if (lit.t === "ip") {
    const a = parseIp(String(value));
    const b = parseIp(lit.v);
    const same = !!a && !!b && sameIp(a, b);
    return op === "ne" ? !same : op === "eq" && same;
  }
  if (lit.t === "int") {
    const n = Number(value);
    if (!Number.isFinite(n)) return op === "ne";
    switch (op) {
      case "eq":
        return n === lit.v;
      case "ne":
        return n !== lit.v;
      case "lt":
        return n < lit.v;
      case "le":
        return n <= lit.v;
      case "gt":
        return n > lit.v;
      case "ge":
        return n >= lit.v;
      default:
        return false;
    }
  }
  const s = String(value);
  switch (op) {
    case "eq":
      return s === lit.v;
    case "ne":
      return s !== lit.v;
    case "contains":
      return s.includes(lit.v as string);
    case "wildcard":
      return wildcardMatch(lit.v as string, s);
    default:
      return false;
  }
}

function inSet(type: RuleFieldType, value: FieldValue, items: SetItem[]) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) {
    return value.some((v) =>
      items.some((it) => it.t === "string" && it.v === v),
    );
  }
  if (type === "ip") {
    const ip = parseIp(String(value));
    if (!ip) return false;
    return items.some((it) => {
      if (it.t === "cidr") {
        const block = parseCidr(it.v);
        return !!block && inCidr(ip, block);
      }
      const other = it.t === "ip" ? parseIp(it.v) : null;
      return !!other && sameIp(ip, other);
    });
  }
  if (type === "int") {
    const n = Number(value);
    return items.some((it) =>
      it.t === "range"
        ? n >= it.from && n <= it.to
        : it.t === "int" && it.v === n,
    );
  }
  return items.some((it) => it.t === "string" && it.v === String(value));
}

export function evaluateRuleExpression(
  e: RuleExpr | null,
  ctx: RuleContext,
): boolean {
  if (!e) return true;
  switch (e.kind) {
    case "and":
      return e.items.every((x) => evaluateRuleExpression(x, ctx));
    case "or":
      return e.items.some((x) => evaluateRuleExpression(x, ctx));
    case "not":
      return !evaluateRuleExpression(e.expr, ctx);
    case "cmp":
      return cmp(e.op, ctx[e.field] ?? null, e.value);
    case "in":
      return inSet(fieldType(e.field), ctx[e.field] ?? null, e.items);
    case "fn": {
      const v = ctx[e.field];
      if (typeof v !== "string") return false;
      return e.fn === "starts_with"
        ? v.startsWith(e.value)
        : v.endsWith(e.value);
    }
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

/** Longest value a field keeps; longer header values are cut. */
const MAX_VALUE = 1024;

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, MAX_VALUE);
  return t || null;
}

function list(v: unknown): string[] | null {
  if (Array.isArray(v))
    return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") return v.split(/[\s,]+/).filter(Boolean);
  // profile.updated sends { field: newValue }; the names are what matter.
  if (v && typeof v === "object") return Object.keys(v);
  return null;
}

/**
 * The field values for one event. `data` is the payload the route handed to
 * the notifier (see deliverUserEmailNotifications); `now` gives the time
 * fields, in UTC.
 */
export function buildRuleContext(
  event: string,
  data: Record<string, unknown>,
  now: Date,
): RuleContext {
  return {
    event,
    "event.category": event.split(".")[0] ?? "",
    "ip.src": str(data.operator_ip ?? data.ip_address ?? data.ip),
    "ip.src.country": str(data.operator_country),
    "http.user_agent": str(data.operator_user_agent ?? data.user_agent),
    "resource.name": str(
      data.name ??
        data.app_name ??
        data.domain ??
        data.team_name ??
        data.provider_name,
    ),
    "oauth.scopes": list(data.scopes),
    "profile.changed_fields": list(data.changed_fields),
    "time.hour": now.getUTCHours(),
    // ISO weekday: Monday 1 … Sunday 7.
    "time.weekday": ((now.getUTCDay() + 6) % 7) + 1,
  };
}
