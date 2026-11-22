// v1.64.0 (D-371, PM phase B, spec PC §8.6 Formula): formula fields. A formula
// is arithmetic (+ − × ÷ and parentheses, numbers) over number, date and other
// formula fields of the same task. Field references are written {f<id>}.
// Parsed into a small tree by our own parser and evaluated by walking it:
// never eval or Function. Pure and unit-tested; the server computes every
// formula value (fields-service.ts) and the browser only shows it.

export type FormulaNode = { kind: "num"; value: number } | { kind: "field"; id: number } | { kind: "neg"; arg: FormulaNode } | { kind: "op"; op: "+" | "-" | "*" | "/"; left: FormulaNode; right: FormulaNode };

export const FORMULA_MAX_LENGTH = 500;
const MAX_NODES = 200;

type Token = { type: "num"; value: number } | { type: "field"; id: number } | { type: "op"; op: "+" | "-" | "*" | "/" } | { type: "lp" } | { type: "rp" };

function tokenize(text: string): Token[] | string {
  const tokens: Token[] = [];
  let at = 0;
  while (at < text.length) {
    const ch = text[at]!;
    if (/\s/.test(ch)) {
      at += 1;
      continue;
    }
    if (ch === "{") {
      const match = /^\{f(\d{1,10})\}/.exec(text.slice(at));
      if (!match) return "A field in the formula isn't written correctly.";
      tokens.push({ type: "field", id: Number(match[1]) });
      at += match[0].length;
      continue;
    }
    const number = /^\d+(\.\d+)?/.exec(text.slice(at));
    if (number) {
      tokens.push({ type: "num", value: Number(number[0]) });
      at += number[0].length;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "−") tokens.push({ type: "op", op: ch === "+" ? "+" : "-" });
    else if (ch === "*" || ch === "×" || ch === "x") tokens.push({ type: "op", op: "*" });
    else if (ch === "/" || ch === "÷") tokens.push({ type: "op", op: "/" });
    else if (ch === "(") tokens.push({ type: "lp" });
    else if (ch === ")") tokens.push({ type: "rp" });
    else return `The formula can't use “${ch}”.`;
    at += 1;
  }
  return tokens;
}

// Parse a formula; returns the tree or a plain message.
export function parseFormula(text: string): { ok: true; node: FormulaNode } | { ok: false; message: string } {
  if (typeof text !== "string" || !text.trim()) return { ok: false, message: "Write a formula." };
  if (text.length > FORMULA_MAX_LENGTH) return { ok: false, message: `Use ${FORMULA_MAX_LENGTH} characters or fewer.` };
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
  // expression := term (("+"|"-") term)* ; term := factor (("*"|"/") factor)* ; factor := "-" factor | number | field | "(" expression ")"
  const expression = (): FormulaNode => {
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
    if (token.type === "op" && token.op === "-") return count({ kind: "neg", arg: factor() });
    if (token.type === "op" && token.op === "+") return factor();
    if (token.type === "num") return count({ kind: "num", value: token.value });
    if (token.type === "field") return count({ kind: "field", id: token.id });
    if (token.type === "lp") {
      depth += 1;
      if (depth > 20) fail("Too many brackets inside each other.");
      const inner = expression();
      if (tokens[at]?.type !== "rp") fail("A bracket isn't closed.");
      at += 1;
      depth -= 1;
      return inner;
    }
    return fail(token.type === "rp" ? "A closing bracket has no opening one." : "Two signs are next to each other.");
  };
  try {
    const node = expression();
    if (at < tokens.length) return { ok: false, message: tokens[at]!.type === "rp" ? "A closing bracket has no opening one." : "Put a sign (+ − × ÷) between two values." };
    return { ok: true, node };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

export function formulaFields(node: FormulaNode): number[] {
  const out = new Set<number>();
  const walk = (item: FormulaNode) => {
    if (item.kind === "field") out.add(item.id);
    else if (item.kind === "neg") walk(item.arg);
    else if (item.kind === "op") {
      walk(item.left);
      walk(item.right);
    }
  };
  walk(node);
  return [...out];
}

// The value of a formula. `value(id)` gives a field's number (dates as day
// numbers) or null when empty; an empty field makes the result empty.
export type FormulaResult = { ok: true; value: number | null } | { ok: false; error: "DIV_ZERO" | "LOOP" | "MISSING" };
export function evaluateFormula(node: FormulaNode, value: (id: number) => FormulaResult): FormulaResult {
  switch (node.kind) {
    case "num":
      return { ok: true, value: node.value };
    case "field":
      return value(node.id);
    case "neg": {
      const inner = evaluateFormula(node.arg, value);
      return inner.ok && inner.value !== null ? { ok: true, value: -inner.value } : inner;
    }
    case "op": {
      const left = evaluateFormula(node.left, value);
      if (!left.ok) return left;
      const right = evaluateFormula(node.right, value);
      if (!right.ok) return right;
      if (left.value === null || right.value === null) return { ok: true, value: null };
      if (node.op === "/" && right.value === 0) return { ok: false, error: "DIV_ZERO" };
      const result = node.op === "+" ? left.value + right.value : node.op === "-" ? left.value - right.value : node.op === "*" ? left.value * right.value : left.value / right.value;
      return Number.isFinite(result) ? { ok: true, value: result } : { ok: false, error: "DIV_ZERO" };
    }
  }
}
export const FORMULA_ERROR_TEXT: Record<"DIV_ZERO" | "LOOP" | "MISSING", string> = { DIV_ZERO: "Can't divide by 0", LOOP: "Formula refers to itself", MISSING: "A field it uses was removed" };

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

// The formula as people read it: {f12} becomes the field's name in brackets.
export function formulaText(expr: string, names: ReadonlyMap<number, string>): string {
  return expr.replace(/\{f(\d{1,10})\}/g, (_, id: string) => `[${names.get(Number(id)) ?? "removed field"}]`).replace(/\*/g, "×").replace(/\//g, "÷");
}
