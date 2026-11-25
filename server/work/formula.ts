// v1.64.0 (D-371, PM phase B, spec PC §8.6 Formula): formula fields. A formula
// is arithmetic (+ − × ÷ and parentheses, numbers) over number, date and other
// formula fields of the same task. Field references are written {f<id>}.
// Parsed into a small tree by our own parser and evaluated by walking it:
// never eval or Function. Pure and unit-tested; the server computes every
// formula value (fields-service.ts) and the browser only shows it.
//
// v1.88.0 (D-418, owner: "use all these as simple formulas", spec
// FORMULA_FIELDS): the same language grows functions (ADD, SUBTRACT,
// MULTIPLY, DIVIDE, DATEADD, DATESUBTRACT, ROLLUP, DAYS, WORKDAYS, IF with
// > < >= <= = <>, ROUND, MIN, MAX, ABS, COALESCE; names in any case), the
// task's own dates as inputs ({start} {due} {created} {completed} and {today},
// typed [Start date] [Due date] [Created on] [Completed on] [Today]), types
// (a formula gives a number or a date; date − date stays days, as before),
// limits (10 inputs, 2 layers of formulas, 500 characters, no loops) and
// one-click presets. Saved v1.64 formulas read and work as before. Written
// from the spec's behaviour; still no eval.
//
// v1.90.0 (D-430, owner: "Add TODAY() and NOW() in the formulas functions"):
// TODAY() is today's India date (the same input as [Today]); NOW() is the
// current India date-time ([Now]), a date whose day number carries the time
// as a fraction, so date − NOW() gives days with decimals (ROUND helps) and a
// date-time result shows as its date. Both read bare too (TODAY, now: any
// case), are worked out when the value is read (never stored) and count as one
// input each, like [Today]. An en or em dash (– —) reads as a minus sign.
import { workingDaysBetween } from "@/server/work/working-days";
import type { WorkCalendar } from "@/server/work/schedule";

// ---- the language ---------------------------------------------------------------------------
export const BUILTINS = ["start", "due", "created", "completed", "today", "now"] as const;
export type Builtin = (typeof BUILTINS)[number];
export const BUILTIN_LABEL: Record<Builtin, string> = { start: "Start date", due: "Due date", created: "Created on", completed: "Completed on", today: "Today", now: "Now" };
// Other ways people write the built-ins in brackets ([Start], [Due], ...).
const BUILTIN_ALIASES: Record<string, Builtin> = { start: "start", "start date": "start", due: "due", "due date": "due", created: "created", "created on": "created", completed: "completed", "completed on": "completed", today: "today", now: "now" };

export type FxType = "number" | "date";
export type CompareOp = ">" | "<" | ">=" | "<=" | "=" | "<>";
export type FunctionName = "ADD" | "SUBTRACT" | "MULTIPLY" | "DIVIDE" | "DATEADD" | "DATESUBTRACT" | "ROLLUP" | "DAYS" | "WORKDAYS" | "IF" | "ROUND" | "MIN" | "MAX" | "ABS" | "COALESCE" | "TODAY" | "NOW";
export type FormulaNode =
  | { kind: "num"; value: number }
  | { kind: "field"; id: number }
  | { kind: "builtin"; name: Builtin }
  | { kind: "neg"; arg: FormulaNode }
  | { kind: "op"; op: "+" | "-" | "*" | "/"; left: FormulaNode; right: FormulaNode }
  | { kind: "cmp"; op: CompareOp; left: FormulaNode; right: FormulaNode }
  | { kind: "call"; fn: FunctionName; args: FormulaNode[] };

export interface FunctionHelp {
  name: FunctionName;
  min: number;
  max: number;
  signature: string;
  help: string;
  example: string;
  group: "Same as Asana" | "Extra";
}
// The Functions list in the editor (and the Help page): plain words, one example each.
export const FORMULA_FUNCTIONS: readonly FunctionHelp[] = [
  { name: "ADD", min: 2, max: 2, signature: "ADD(value 1, value 2)", help: "Adds two values. The same as +.", example: "ADD([Cost], [Freight])", group: "Same as Asana" },
  { name: "SUBTRACT", min: 2, max: 2, signature: "SUBTRACT(value 1, value 2)", help: "Takes the second value from the first. The same as −. Two dates give the days between them.", example: "SUBTRACT([Budget], [Spent])", group: "Same as Asana" },
  { name: "MULTIPLY", min: 2, max: 2, signature: "MULTIPLY(value 1, value 2)", help: "Multiplies two numbers. The same as ×.", example: "MULTIPLY([Rate], [Hours])", group: "Same as Asana" },
  { name: "DIVIDE", min: 2, max: 2, signature: "DIVIDE(value 1, value 2)", help: "Divides the first number by the second. The same as ÷. Dividing by 0 shows “Can't divide by 0”.", example: "DIVIDE([Cost], [Quantity])", group: "Same as Asana" },
  { name: "DATEADD", min: 2, max: 2, signature: "DATEADD(date, days)", help: "The date a number of days later. The result is a date.", example: "DATEADD([Due date], 5)", group: "Same as Asana" },
  { name: "DATESUBTRACT", min: 2, max: 2, signature: "DATESUBTRACT(date, days)", help: "The date a number of days earlier. The result is a date.", example: "DATESUBTRACT([Due date], 2)", group: "Same as Asana" },
  { name: "ROLLUP", min: 1, max: 1, signature: "ROLLUP(field)", help: "Adds up a number field over the task's subtasks (first level only). Add the field again to count the task's own value too.", example: "ROLLUP([Hours]) + [Hours]", group: "Same as Asana" },
  { name: "DAYS", min: 2, max: 2, signature: "DAYS(from, to)", help: "Days from the first date to the second (to minus from). Later is positive, earlier is negative.", example: "DAYS([Start date], [Due date])", group: "Extra" },
  { name: "WORKDAYS", min: 2, max: 2, signature: "WORKDAYS(from, to)", help: "Working days from the first date to the second, both days counted, on the Working calendar (weekly offs and holidays skipped). Negative when “to” is earlier.", example: "WORKDAYS([Start date], [Due date])", group: "Extra" },
  { name: "IF", min: 3, max: 3, signature: "IF(condition, then, otherwise)", help: "One value when the condition is true, another when it isn't. Compare with > < >= <= = (equal) or <> (not equal).", example: "IF([Cost] > 100000, 1, 0)", group: "Extra" },
  { name: "ROUND", min: 1, max: 2, signature: "ROUND(number, decimals)", help: "Rounds to a number of decimal places (0 when left out); halves round away from zero.", example: "ROUND([Cost] / 3, 2)", group: "Extra" },
  { name: "MIN", min: 2, max: 10, signature: "MIN(value 1, value 2, …)", help: "The smallest of the values (numbers, or dates: the earliest).", example: "MIN([Due date], [Revised Target])", group: "Extra" },
  { name: "MAX", min: 2, max: 10, signature: "MAX(value 1, value 2, …)", help: "The largest of the values (numbers, or dates: the latest).", example: "MAX([Actual], [Plan])", group: "Extra" },
  { name: "ABS", min: 1, max: 1, signature: "ABS(number)", help: "The number without its minus sign.", example: "ABS(DAYS([Today], [Due date]))", group: "Extra" },
  { name: "COALESCE", min: 2, max: 10, signature: "COALESCE(value, fallback)", help: "Uses the fallback when the value is empty (otherwise an empty input leaves the result empty).", example: "COALESCE([Hours], 0)", group: "Extra" },
  { name: "TODAY", min: 0, max: 0, signature: "TODAY()", help: "Today's date (India time), worked out fresh each time the value is read. A date minus TODAY() gives whole days. TODAY also works without brackets and is the same as [Today].", example: "[NFD] − TODAY()", group: "Extra" },
  { name: "NOW", min: 0, max: 0, signature: "NOW()", help: "The date and time now (India time). A date minus NOW() gives days with decimals (a date counts from midnight): use ROUND to tidy it, or TODAY() for whole days. A result that is a date and time shows as its date.", example: "ROUND([Due date] − NOW(), 1)", group: "Extra" },
];
const FUNCTION_INFO = new Map<string, Pick<FunctionHelp, "min" | "max" | "signature">>(FORMULA_FUNCTIONS.map((item) => [item.name, item] as const));
// Functions that need no values and also read without brackets (TODAY, NOW).
const BARE_FUNCTIONS: Record<string, Builtin> = { TODAY: "today", NOW: "now" };

// Ready-made formulas (the owner's Asana fields). `needs`: a project date
// field of that name (any case), or one the person picks.
export interface FormulaPreset {
  key: "tat" | "delay" | "nfd" | "delay-days";
  name: string;
  text: string;
  help: string;
  needs?: string;
}
export const FORMULA_PRESETS: readonly FormulaPreset[] = [
  { key: "tat", name: "TAT", text: "DAYS([Start date], [Due date])", help: "Planned turnaround: days from the start date to the due date." },
  { key: "delay", name: "Delay", text: "DAYS([Start date], [Revised Target])", needs: "Revised Target", help: "Days from the start date to the revised target date." },
  { key: "nfd", name: "NFD Delay", text: "DAYS(TODAY(), [NFD])", needs: "NFD", help: "Days left until the NFD date; negative means overdue. Worked out fresh each day." },
  { key: "delay-days", name: "Delay Days", text: "DAYS([Due date], [Completed on]) - 1", help: "Days completed after the due date, less a one-day allowance." },
];
// The preset's text with its needed field swapped for the one chosen.
export function presetText(preset: FormulaPreset, fieldName: string | null): string {
  return preset.needs && fieldName ? preset.text.replace(`[${preset.needs}]`, `[${fieldName}]`) : preset.text;
}

// ---- limits ----------------------------------------------------------------------------------
export const FORMULA_MAX_LENGTH = 500; // as people read it ([Field name] ...)
export const FORMULA_STORED_MAX = 1000; // as stored ({f12} ...)
export const FORMULA_MAX_INPUTS = 10;
export const FORMULA_MAX_LAYERS = 2;
const MAX_NODES = 200;
const MAX_NESTING = 20;

// ---- reading the text ------------------------------------------------------------------------
type Token =
  | { type: "num"; value: number }
  | { type: "field"; id: number }
  | { type: "builtin"; name: Builtin }
  | { type: "name"; name: string }
  | { type: "op"; op: "+" | "-" | "*" | "/" }
  | { type: "cmp"; op: CompareOp }
  | { type: "comma" }
  | { type: "lp" }
  | { type: "rp" };

function tokenize(text: string): Token[] | string {
  const tokens: Token[] = [];
  let at = 0;
  while (at < text.length) {
    const ch = text[at]!;
    const rest = text.slice(at);
    if (/\s/.test(ch)) {
      at += 1;
      continue;
    }
    if (ch === "{") {
      const field = /^\{f(\d{1,10})\}/.exec(rest);
      const builtin = /^\{(start|due|created|completed|today|now)\}/.exec(rest);
      if (field) tokens.push({ type: "field", id: Number(field[1]) });
      else if (builtin) tokens.push({ type: "builtin", name: builtin[1] as Builtin });
      else return "A field in the formula isn't written correctly.";
      at += (field ?? builtin)![0].length;
      continue;
    }
    const number = /^\d+(\.\d+)?/.exec(rest);
    if (number) {
      tokens.push({ type: "num", value: Number(number[0]) });
      at += number[0].length;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (word) {
      // "x" between two values multiplies (v1.64 formulas).
      tokens.push(word[0] === "x" ? { type: "op", op: "*" } : { type: "name", name: word[0] });
      at += word[0].length;
      continue;
    }
    const compare = /^(>=|<=|<>|!=|==|≥|≤|≠|>|<|=)/.exec(rest);
    if (compare) {
      const sign = compare[0];
      const op: CompareOp = sign === ">=" || sign === "≥" ? ">=" : sign === "<=" || sign === "≤" ? "<=" : sign === "<>" || sign === "!=" || sign === "≠" ? "<>" : sign === "==" || sign === "=" ? "=" : (sign as CompareOp);
      tokens.push({ type: "cmp", op });
      at += sign.length;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "−" || ch === "–" || ch === "—") tokens.push({ type: "op", op: ch === "+" ? "+" : "-" });
    else if (ch === "*" || ch === "×") tokens.push({ type: "op", op: "*" });
    else if (ch === "/" || ch === "÷") tokens.push({ type: "op", op: "/" });
    else if (ch === "(") tokens.push({ type: "lp" });
    else if (ch === ")") tokens.push({ type: "rp" });
    else if (ch === ",") tokens.push({ type: "comma" });
    else if (ch === "[") return "A field name in [brackets] wasn't recognised.";
    else return `The formula can't use “${ch}”.`;
    at += 1;
  }
  return tokens;
}

// A parse cache: lists work the same few formulas out for every row.
const parsedCache = new Map<string, { ok: true; node: FormulaNode } | { ok: false; message: string }>();

// Parse a formula; returns the tree or a plain message.
export function parseFormula(text: string): { ok: true; node: FormulaNode } | { ok: false; message: string } {
  if (typeof text !== "string" || !text.trim()) return { ok: false, message: "Write a formula." };
  if (text.length > FORMULA_STORED_MAX) return { ok: false, message: `Use ${FORMULA_MAX_LENGTH} characters or fewer.` };
  const cached = parsedCache.get(text);
  if (cached) return cached;
  const result = parseUncached(text);
  if (parsedCache.size > 500) parsedCache.clear();
  parsedCache.set(text, result);
  return result;
}

function parseUncached(text: string): { ok: true; node: FormulaNode } | { ok: false; message: string } {
  const tokens = tokenize(text);
  if (typeof tokens === "string") return { ok: false, message: tokens };
  let at = 0;
  let nodes = 0;
  let depth = 0;
  const fail = (message: string): never => {
    throw new Error(message);
  };
  const count = <T extends FormulaNode>(node: T): T => {
    nodes += 1;
    if (nodes > MAX_NODES) fail("The formula is too long.");
    return node;
  };
  const nest = <T>(inner: () => T): T => {
    depth += 1;
    if (depth > MAX_NESTING) fail("Too many brackets inside each other.");
    const value = inner();
    depth -= 1;
    return value;
  };
  // expression := sum (compare sum)? ; sum := term (("+"|"-") term)* ;
  // term := factor (("*"|"/") factor)* ;
  // factor := ("-"|"+") factor | number | field | builtin | name "(" args ")" | "(" expression ")"
  const expression = (): FormulaNode => {
    const left = sum();
    const token = tokens[at];
    if (token?.type !== "cmp") return left;
    at += 1;
    const node = count({ kind: "cmp", op: token.op, left, right: sum() } as const);
    if (tokens[at]?.type === "cmp") fail("Compare two values at a time.");
    return node;
  };
  const sum = (): FormulaNode => {
    let left = term();
    for (let token = tokens[at]; token?.type === "op" && (token.op === "+" || token.op === "-"); token = tokens[at]) {
      at += 1;
      left = count({ kind: "op", op: token.op, left, right: term() });
    }
    return left;
  };
  const term = (): FormulaNode => {
    let left = factor();
    for (let token = tokens[at]; token?.type === "op" && (token.op === "*" || token.op === "/"); token = tokens[at]) {
      at += 1;
      left = count({ kind: "op", op: token.op, left, right: factor() });
    }
    return left;
  };
  const factor = (): FormulaNode => {
    const token = tokens[at];
    if (!token) return fail("The formula ends too early.");
    at += 1;
    if (token.type === "op" && token.op === "-") return count({ kind: "neg", arg: nest(factor) });
    if (token.type === "op" && token.op === "+") return nest(factor);
    if (token.type === "num") return count({ kind: "num", value: token.value });
    if (token.type === "field") return count({ kind: "field", id: token.id });
    if (token.type === "builtin") return count({ kind: "builtin", name: token.name });
    if (token.type === "name") return call(token.name);
    if (token.type === "lp") {
      return nest(() => {
        const inner = expression();
        if (tokens[at]?.type !== "rp") fail("A bracket isn't closed.");
        at += 1;
        return inner;
      });
    }
    if (token.type === "comma") return fail("A comma is out of place: commas only go between a function's values.");
    if (token.type === "cmp") return fail("A comparison needs a value on each side.");
    return fail(token.type === "rp" ? "A closing bracket has no opening one." : "Two signs are next to each other.");
  };
  const call = (raw: string): FormulaNode => {
    const name = raw.toUpperCase();
    const info = FUNCTION_INFO.get(name);
    if (!info) return fail(`The formula can't use “${raw}”: there's no function with that name. See the Functions list.`);
    // TODAY and NOW read without brackets too ("[NFD] − TODAY").
    if (tokens[at]?.type !== "lp" && BARE_FUNCTIONS[name]) return count({ kind: "builtin", name: BARE_FUNCTIONS[name] } as const);
    if (tokens[at]?.type !== "lp") return fail(`Write ${name} with brackets: ${info.signature}.`);
    at += 1;
    return nest(() => {
      const args: FormulaNode[] = [];
      if (tokens[at]?.type === "rp") at += 1;
      else
        for (;;) {
          args.push(expression());
          const next = tokens[at];
          at += 1;
          if (next?.type === "comma") continue;
          if (next?.type === "rp") break;
          fail(next ? `Separate ${name}'s values with commas: ${info.signature}.` : `A bracket isn't closed after ${name}.`);
        }
      if (args.length < info.min || args.length > info.max) {
        const want = info.min === info.max ? `${info.min} value${info.min === 1 ? "" : "s"}` : `${info.min} to ${info.max} values`;
        fail(`${name} takes ${want}: ${info.signature}.`);
      }
      if (BARE_FUNCTIONS[name]) return count({ kind: "builtin", name: BARE_FUNCTIONS[name] } as const);
      return count({ kind: "call", fn: name as FunctionName, args });
    });
  };
  try {
    const node = expression();
    if (at < tokens.length) {
      const next = tokens[at]!;
      return { ok: false, message: next.type === "rp" ? "A closing bracket has no opening one." : next.type === "comma" ? "A comma is out of place: commas only go between a function's values." : "Put a sign (+ − × ÷) between two values." };
    }
    return { ok: true, node };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

const children = (node: FormulaNode): FormulaNode[] => (node.kind === "neg" ? [node.arg] : node.kind === "op" || node.kind === "cmp" ? [node.left, node.right] : node.kind === "call" ? node.args : []);
function walk(node: FormulaNode, visit: (item: FormulaNode) => void): void {
  visit(node);
  for (const child of children(node)) walk(child, visit);
}

// The fields a formula uses (a ROLLUP's field too), in order of first use.
export function formulaFields(node: FormulaNode): number[] {
  const out = new Set<number>();
  walk(node, (item) => {
    if (item.kind === "field") out.add(item.id);
  });
  return [...out];
}
export function formulaBuiltins(node: FormulaNode): Builtin[] {
  const out = new Set<Builtin>();
  walk(node, (item) => {
    if (item.kind === "builtin") out.add(item.name);
  });
  return [...out];
}
export function formulaUses(node: FormulaNode, fn: FunctionName): boolean {
  let found = false;
  walk(node, (item) => {
    if (item.kind === "call" && item.fn === fn) found = true;
  });
  return found;
}

// ---- days ------------------------------------------------------------------------------------
// Dates are whole days since 1 Jan 1970 while a formula is worked out.
export const dayNumber = (day: string) => Math.round(new Date(`${day}T00:00:00Z`).getTime() / 86_400_000);
// v1.90.0 (D-430): an India date-time (YYYY-MM-DDTHH:MM:SS, as NOW() reads it)
// as a day number with the time as a fraction; null when it doesn't read.
export function momentNumber(moment: string): number | null {
  const at = Date.parse(`${moment}Z`);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(moment) && Number.isFinite(at) ? at / 86_400_000 : null;
}
// The India date-time NOW() reads at `now`.
export const indiaMoment = (now: Date): string => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 19);
// A day number back to YYYY-MM-DD; null when it is not a sensible date (years 1000 to 9999).
export function dayOf(n: number): string | null {
  if (!Number.isInteger(n) || n < -354_285 || n > 2_932_896) return null;
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

// ---- working it out --------------------------------------------------------------------------
export type FormulaError = "DIV_ZERO" | "LOOP" | "MISSING" | "INVALID";
export type FormulaResult = { ok: true; value: number | null } | { ok: false; error: FormulaError };
// What a formula reads on one task. `field` gives a field's number (dates as
// day numbers) or null when empty; `builtin` the task's own dates; `rollup`
// the sum of a field over the task's first-level subtasks; `calendar` the
// Working calendar for WORKDAYS (every day works when it is left out).
export interface FormulaEnv {
  field: (id: number) => FormulaResult;
  builtin?: (name: Builtin) => number | null;
  rollup?: (id: number) => FormulaResult;
  calendar?: WorkCalendar;
}
const EVERY_DAY: WorkCalendar = { offDays: new Set(), workingWeekdays: new Set() };
const value = (n: number | null): FormulaResult => (n === null || Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: "DIV_ZERO" });
const EMPTY: FormulaResult = { ok: true, value: null };

function roundTo(n: number, places: number): number {
  const factor = 10 ** places;
  const scaled = Math.abs(n) * factor;
  // Nudge for binary fractions (1.005 is stored as 1.00499...).
  const rounded = Math.round(scaled + scaled * Number.EPSILON * 4) / factor;
  return n < 0 ? -rounded : rounded;
}
function workdays(from: number, to: number, calendar: WorkCalendar): number | null {
  // NOW() carries the time as a fraction: working days count whole days.
  const a = dayOf(Math.floor(from));
  const b = dayOf(Math.floor(to));
  if (!a || !b) return null;
  return a <= b ? workingDaysBetween(a, b, calendar) : -(workingDaysBetween(b, a, calendar) ?? 0);
}

// The value of a formula. An empty input makes the result empty (except in
// COALESCE, and in the branch of IF that isn't used).
export function evaluateFormula(node: FormulaNode, source: FormulaEnv | ((id: number) => FormulaResult)): FormulaResult {
  const env: FormulaEnv = typeof source === "function" ? { field: source } : source;
  const run = (item: FormulaNode): FormulaResult => {
    switch (item.kind) {
      case "num":
        return { ok: true, value: item.value };
      case "field":
        return env.field(item.id);
      case "builtin":
        return { ok: true, value: env.builtin?.(item.name) ?? null };
      case "neg": {
        const inner = run(item.arg);
        return inner.ok && inner.value !== null ? { ok: true, value: -inner.value } : inner;
      }
      case "op":
        return arithmetic(item.op, item.left, item.right);
      case "cmp": {
        const both = pair(item.left, item.right);
        if (!both.ok || both.value === null) return both.ok ? EMPTY : both;
        const [a, b] = both.value;
        const holds = item.op === ">" ? a > b : item.op === "<" ? a < b : item.op === ">=" ? a >= b : item.op === "<=" ? a <= b : item.op === "=" ? a === b : a !== b;
        return { ok: true, value: holds ? 1 : 0 };
      }
      case "call":
        return call(item.fn, item.args);
    }
  };
  // Both sides, or the first error, or empty when either is empty.
  const pair = (left: FormulaNode, right: FormulaNode): { ok: true; value: [number, number] | null } | { ok: false; error: FormulaError } => {
    const a = run(left);
    if (!a.ok) return a;
    const b = run(right);
    if (!b.ok) return b;
    return { ok: true, value: a.value === null || b.value === null ? null : [a.value, b.value] };
  };
  const arithmetic = (op: "+" | "-" | "*" | "/", left: FormulaNode, right: FormulaNode): FormulaResult => {
    const both = pair(left, right);
    if (!both.ok || both.value === null) return both.ok ? EMPTY : both;
    const [a, b] = both.value;
    if (op === "/" && b === 0) return { ok: false, error: "DIV_ZERO" };
    return value(op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : a / b);
  };
  const call = (fn: FunctionName, args: FormulaNode[]): FormulaResult => {
    switch (fn) {
      case "ADD":
        return arithmetic("+", args[0]!, args[1]!);
      case "SUBTRACT":
        return arithmetic("-", args[0]!, args[1]!);
      case "MULTIPLY":
        return arithmetic("*", args[0]!, args[1]!);
      case "DIVIDE":
        return arithmetic("/", args[0]!, args[1]!);
      case "DATEADD":
      case "DATESUBTRACT": {
        const both = pair(args[0]!, args[1]!);
        if (!both.ok || both.value === null) return both.ok ? EMPTY : both;
        const shift = Math.round(both.value[1]);
        return value(both.value[0] + (fn === "DATEADD" ? shift : -shift));
      }
      case "DAYS": {
        const both = pair(args[0]!, args[1]!);
        if (!both.ok || both.value === null) return both.ok ? EMPTY : both;
        return value(both.value[1] - both.value[0]);
      }
      case "WORKDAYS": {
        const both = pair(args[0]!, args[1]!);
        if (!both.ok || both.value === null) return both.ok ? EMPTY : both;
        const n = workdays(both.value[0], both.value[1], env.calendar ?? EVERY_DAY);
        return n === null ? { ok: false, error: "INVALID" } : value(n);
      }
      case "ROLLUP": {
        const target = args[0]!;
        if (target.kind !== "field") return { ok: false, error: "INVALID" };
        return env.rollup ? env.rollup(target.id) : EMPTY;
      }
      case "IF": {
        const condition = run(args[0]!);
        if (!condition.ok || condition.value === null) return condition;
        return run(condition.value !== 0 ? args[1]! : args[2]!);
      }
      case "ROUND": {
        const n = run(args[0]!);
        if (!n.ok || n.value === null) return n;
        const places = args[1] ? run(args[1]) : ({ ok: true, value: 0 } as FormulaResult);
        if (!places.ok || places.value === null) return places;
        return value(roundTo(n.value, Math.min(10, Math.max(0, Math.trunc(places.value)))));
      }
      case "ABS": {
        const n = run(args[0]!);
        return n.ok && n.value !== null ? { ok: true, value: Math.abs(n.value) } : n;
      }
      case "MIN":
      case "MAX": {
        let best: number | null = null;
        for (const arg of args) {
          const n = run(arg);
          if (!n.ok || n.value === null) return n;
          best = best === null ? n.value : fn === "MIN" ? Math.min(best, n.value) : Math.max(best, n.value);
        }
        return { ok: true, value: best };
      }
      case "COALESCE": {
        for (const arg of args) {
          const n = run(arg);
          if (!n.ok || n.value !== null) return n;
        }
        return EMPTY;
      }
      case "TODAY":
        return { ok: true, value: env.builtin?.("today") ?? null };
      case "NOW":
        return { ok: true, value: env.builtin?.("now") ?? null };
    }
  };
  return run(node);
}
export const FORMULA_ERROR_TEXT: Record<FormulaError, string> = { DIV_ZERO: "Can't divide by 0", LOOP: "Formula refers to itself", MISSING: "A field it uses was removed", INVALID: "Formula needs fixing" };

// ---- checking a formula against the project's fields ------------------------------------------
// What a check needs about each field (the browser has the same from FieldView).
export interface FxField {
  id: number;
  name: string;
  kind: string; // NUMBER, DATE, TIMER, FORMULA, ...
  formula?: string;
}
export const FORMULA_INPUT_KINDS: readonly string[] = ["NUMBER", "DATE", "TIMER", "FORMULA"];
export type FormulaAnalysis =
  | { ok: true; node: FormulaNode; type: FxType; fields: number[]; builtins: Builtin[]; inputs: number; layers: number; rollup: boolean; workdays: boolean }
  | { ok: false; message: string; code: Exclude<FormulaError, "DIV_ZERO"> };
type Typed = FxType | "bool";
class FxProblem extends Error {
  constructor(
    message: string,
    readonly code: Exclude<FormulaError, "DIV_ZERO"> = "INVALID",
  ) {
    super(message);
  }
}
const TYPE_WORD: Record<Typed, string> = { number: "a number", date: "a date", bool: "a comparison" };

// Check a stored formula: it reads, its fields exist and can be used, the
// types fit, and (with `limits`, when it is saved) at most 10 inputs, at
// most 2 layers of formulas, 500 characters as people read it, no loops.
// `selfId`: the formula field being saved (null for a new one).
export function analyseFormula(expr: string, fields: ReadonlyMap<number, FxField>, selfId: number | null = null, limits = true): FormulaAnalysis {
  const typeMemo = new Map<number, FxType>();
  const layerMemo = new Map<number, number>();
  const rollupMemo = new Map<number, boolean>();
  const visiting = new Set<number>();
  const nameOf = (id: number) => fields.get(id)?.name ?? "a removed field";
  try {
    if (limits && formulaText(expr, new Map([...fields.values()].map((field) => [field.id, field.name]))).length > FORMULA_MAX_LENGTH) throw new FxProblem(`Use ${FORMULA_MAX_LENGTH} characters or fewer.`);
    const parsed = parseFormula(expr);
    if (!parsed.ok) throw new FxProblem(parsed.message);
    const node = parsed.node;
    const used = formulaFields(node);
    const builtins = formulaBuiltins(node);
    const inputs = used.length + builtins.length;
    if (limits && inputs > FORMULA_MAX_INPUTS) throw new FxProblem(`A formula can use at most ${FORMULA_MAX_INPUTS} inputs (fields and dates); this one uses ${inputs}.`);
    if (selfId !== null && used.includes(selfId)) throw new FxProblem("A formula can't use itself.", "LOOP");

    // Another formula field: parsed once, checked for loops on the way.
    const formulaOf = (id: number): FormulaNode => {
      const parsedOther = parseFormula(fields.get(id)?.formula ?? "");
      if (!parsedOther.ok) throw new FxProblem(`The formula “${nameOf(id)}” has a problem; fix it first.`);
      return parsedOther.node;
    };
    const enter = <T>(id: number, work: () => T): T => {
      if (visiting.has(id) || id === selfId) throw new FxProblem(selfId !== null ? "The formula would refer to itself through another formula." : "Formulas refer to each other in a loop.", "LOOP");
      visiting.add(id);
      try {
        return work();
      } finally {
        visiting.delete(id);
      }
    };
    const fieldOf = (id: number): FxField => {
      const field = fields.get(id);
      if (!field) throw new FxProblem("A field it uses isn't in this project any more.", "MISSING");
      if (!FORMULA_INPUT_KINDS.includes(field.kind)) throw new FxProblem(`“${field.name}” can't be used: a formula reads number, date, timer and formula fields.`);
      return field;
    };
    // Layers: a formula reading no formula is 0; one reading formulas is 1 more than the deepest.
    const layersOf = (item: FormulaNode): number => {
      let deepest = -1;
      for (const id of formulaFields(item)) if (fieldOf(id).kind === "FORMULA") deepest = Math.max(deepest, fieldLayers(id));
      return deepest + 1;
    };
    const fieldLayers = (id: number): number => {
      if (!layerMemo.has(id)) layerMemo.set(id, enter(id, () => layersOf(formulaOf(id))));
      return layerMemo.get(id)!;
    };
    const fieldType = (id: number): FxType => {
      const field = fieldOf(id);
      if (field.kind === "DATE") return "date";
      if (field.kind !== "FORMULA") return "number";
      if (!typeMemo.has(id))
        typeMemo.set(
          id,
          enter(id, () => {
            const typed = typeOf(formulaOf(id));
            if (typed === "bool") throw new FxProblem(`The formula “${field.name}” has a problem; fix it first.`);
            return typed;
          }),
        );
      return typeMemo.get(id)!;
    };
    const usesRollup = (id: number): boolean => {
      const field = fieldOf(id);
      if (field.kind !== "FORMULA") return false;
      if (!rollupMemo.has(id))
        rollupMemo.set(
          id,
          enter(id, () => {
            const other = formulaOf(id);
            return formulaUses(other, "ROLLUP") || formulaFields(other).some((ref) => usesRollup(ref));
          }),
        );
      return rollupMemo.get(id)!;
    };
    const want = (typed: Typed, wanted: FxType, what: string): void => {
      if (typed !== wanted) throw new FxProblem(`${what} needs ${TYPE_WORD[wanted]}, not ${TYPE_WORD[typed]}.`);
    };
    const value = (typed: Typed, what: string): FxType => {
      if (typed === "bool") throw new FxProblem(`${what}: a comparison only works as the first part of IF, like IF([Cost] > 100, 1, 0).`);
      return typed;
    };
    const typeOf = (item: FormulaNode): Typed => {
      switch (item.kind) {
        case "num":
          return "number";
        case "builtin":
          return "date";
        case "field":
          return fieldType(item.id);
        case "neg":
          want(value(typeOf(item.arg), "A minus sign"), "number", "A minus sign");
          return "number";
        case "op":
          return operator(item.op, typeOf(item.left), typeOf(item.right));
        case "cmp": {
          const left = value(typeOf(item.left), "A comparison");
          const right = value(typeOf(item.right), "A comparison");
          if (left !== right) throw new FxProblem("A comparison needs two numbers or two dates.");
          return "bool";
        }
        case "call":
          return callType(item.fn, item.args);
      }
    };
    const operator = (op: "+" | "-" | "*" | "/", leftTyped: Typed, rightTyped: Typed): FxType => {
      const sign = op === "+" ? "+" : op === "-" ? "−" : op === "*" ? "×" : "÷";
      const left = value(leftTyped, `“${sign}”`);
      const right = value(rightTyped, `“${sign}”`);
      if (left === "number" && right === "number") return "number";
      if (op === "-" && left === "date" && right === "date") return "number"; // days between, as in v1.64
      if (op === "-" && left === "date") return "date";
      if (op === "+" && left !== right) return "date"; // a date and days: a later date
      if (op === "+") throw new FxProblem("Two dates can't be added. Subtract them for the days between, or use DATEADD(date, days).");
      if (op === "-") throw new FxProblem("Days can't have a date taken away. Use DATESUBTRACT(date, days) or DAYS(from, to).");
      throw new FxProblem(`Dates can't be ${op === "*" ? "multiplied" : "divided"}. Use DAYS(from, to) to turn two dates into days first.`);
    };
    const callType = (fn: FunctionName, args: FormulaNode[]): Typed => {
      const types = () => args.map((arg) => typeOf(arg));
      switch (fn) {
        case "ADD":
        case "SUBTRACT":
        case "MULTIPLY":
        case "DIVIDE": {
          const [a, b] = types();
          return operator(fn === "ADD" ? "+" : fn === "SUBTRACT" ? "-" : fn === "MULTIPLY" ? "*" : "/", a!, b!);
        }
        case "DATEADD":
        case "DATESUBTRACT": {
          const [a, b] = types();
          want(value(a!, fn), "date", `${fn}'s first value`);
          want(value(b!, fn), "number", `${fn}'s second value (the days)`);
          return "date";
        }
        case "DAYS":
        case "WORKDAYS": {
          const [a, b] = types();
          want(value(a!, fn), "date", `${fn}'s first value`);
          want(value(b!, fn), "date", `${fn}'s second value`);
          return "number";
        }
        case "ROLLUP": {
          const target = args[0]!;
          if (target.kind !== "field") throw new FxProblem("ROLLUP takes one number field, like ROLLUP([Hours]).");
          if (fieldType(target.id) !== "number") throw new FxProblem(`ROLLUP adds up numbers; “${nameOf(target.id)}” is a date.`);
          if (usesRollup(target.id)) throw new FxProblem(`ROLLUP can't add up “${nameOf(target.id)}”: that formula uses ROLLUP itself.`);
          return "number";
        }
        case "IF": {
          const [condition, then, otherwise] = types();
          if (condition !== "bool") throw new FxProblem("IF starts with a comparison, like IF([Cost] > 100, 1, 0).");
          const a = value(then!, "IF");
          const b = value(otherwise!, "IF");
          if (a !== b) throw new FxProblem("IF's two results must both be numbers or both be dates.");
          return a;
        }
        case "ROUND":
        case "ABS": {
          types().forEach((typed, index) => want(value(typed, fn), "number", index ? `${fn}'s decimals` : fn));
          return "number";
        }
        case "MIN":
        case "MAX":
        case "COALESCE": {
          const all = types().map((typed) => value(typed, fn));
          if (all.some((typed) => typed !== all[0])) throw new FxProblem(`${fn}'s values must all be numbers or all be dates.`);
          return all[0]!;
        }
        case "TODAY":
        case "NOW":
          return "date";
      }
    };
    const type = value(typeOf(node), "The formula");
    const layers = layersOf(node);
    if (limits && layers > FORMULA_MAX_LAYERS) throw new FxProblem(`Formulas can use other formulas at most ${FORMULA_MAX_LAYERS} layers deep; this one would be ${layers} deep.`);
    const rollup = formulaUses(node, "ROLLUP");
    const days = formulaUses(node, "WORKDAYS") || used.some((id) => fields.get(id)?.kind === "FORMULA" && needsWorkdays(id, fields, new Set()));
    return { ok: true, node, type, fields: used, builtins, inputs, layers, rollup, workdays: days };
  } catch (error) {
    if (error instanceof FxProblem) return { ok: false, message: error.message, code: error.code };
    throw error;
  }
}
function needsWorkdays(id: number, fields: ReadonlyMap<number, FxField>, seen: Set<number>): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  const parsed = parseFormula(fields.get(id)?.formula ?? "");
  if (!parsed.ok) return false;
  return formulaUses(parsed.node, "WORKDAYS") || formulaFields(parsed.node).some((ref) => fields.get(ref)?.kind === "FORMULA" && needsWorkdays(ref, fields, seen));
}

// Would a formula field `id` using `refs` close a loop? `formulas` maps every
// other formula field to the fields it uses.
export function formulaLoop(id: number, refs: readonly number[], formulas: ReadonlyMap<number, readonly number[]>): boolean {
  const seen = new Set<number>();
  const stack = [...refs];
  while (stack.length) {
    const next = stack.pop()!;
    if (next === id) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...(formulas.get(next) ?? []));
  }
  return false;
}

// ---- the text people read and type -----------------------------------------------------------
// The formula as people read it: {f12} becomes the field's name in brackets,
// {due} becomes [Due date]; * and / read × and ÷.
export function formulaText(expr: string, names: ReadonlyMap<number, string>): string {
  return expr
    .replace(/\*/g, "×")
    .replace(/\//g, "÷")
    .replace(/\{f(\d{1,10})\}/g, (_, id: string) => `[${names.get(Number(id)) ?? "removed field"}]`)
    .replace(/\{(start|due|created|completed|today|now)\}/g, (_, name: Builtin) => `[${BUILTIN_LABEL[name]}]`);
}

// The formula as typed ([Field name] − [Due date] + 2) as stored ({f12} − {due} + 2).
// A project field wins over a built-in date of the same name, so formulas
// saved before v1.88 keep meaning the same field.
export function formulaFromText(text: string, fields: readonly { id: number; name: string }[]): { ok: true; expr: string } | { ok: false; message: string } {
  if (text.length > FORMULA_MAX_LENGTH) return { ok: false, message: `Use ${FORMULA_MAX_LENGTH} characters or fewer.` };
  let missing = "";
  const expr = text.replace(/\[([^\]]*)\]/g, (_, label: string) => {
    const wanted = label.trim().replace(/\s+/g, " ").toLowerCase();
    const field = fields.find((item) => item.name.trim().toLowerCase() === wanted);
    if (field) return `{f${field.id}}`;
    const builtin = BUILTIN_ALIASES[wanted];
    if (builtin) return `{${builtin}}`;
    missing ||= label.trim() || "(empty)";
    return "{f0}";
  });
  if (missing) return { ok: false, message: `No number, date or timer field called “${missing}” here. Pick it from Select field, or use [Start date], [Due date], [Created on], [Completed on] [Today] or [Now] (or TODAY() and NOW()).` };
  return { ok: true, expr };
}
