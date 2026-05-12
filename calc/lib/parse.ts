import { Language, type Node as SyntaxNode, Parser } from "npm:web-tree-sitter@^0.26.8";
import { CalcError, type Span } from "./errors.ts";

export type BinOp = "add" | "sub" | "mul" | "div" | "pow" | "juxt";

export type Expr =
  | { kind: "num"; value: number | bigint; span: Span }
  | { kind: "ident"; name: string; span: Span }
  | { kind: "binop"; op: BinOp; lhs: Expr; rhs: Expr; span: Span }
  | { kind: "neg"; arg: Expr; span: Span }
  | { kind: "convert"; arg: Expr; targets: Expr[]; span: Span }
  | { kind: "call"; fn: string; args: Expr[]; span: Span };

export type Stmt =
  | { kind: "let"; name: string; value: Expr; span: Span }
  | { kind: "expr"; value: Expr; span: Span };

await Parser.init();
const parser = new Parser();
{
  const url = new URL("./parser.wasm", import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load parser.wasm: ${res.statusText}`);
  parser.setLanguage(await Language.load(new Uint8Array(await res.arrayBuffer())));
}

export function parseProgram(src: string): Stmt[] {
  const tree = parser.parse(src);
  if (!tree) throw new CalcError("parse", "parse failed", { start: 0, end: src.length });
  if (tree.rootNode.hasError) {
    const err = findError(tree.rootNode);
    throw new CalcError(
      "parse",
      "syntax error",
      err ? nodeSpan(err) : { start: 0, end: src.length },
    );
  }
  const stmts: Stmt[] = [];
  for (let i = 0; i < tree.rootNode.namedChildCount; i++) {
    stmts.push(toStmt(tree.rootNode.namedChild(i)!));
  }
  return stmts;
}

function findError(node: SyntaxNode): SyntaxNode | null {
  if (node.type === "ERROR" || node.isMissing) return node;
  if (!node.hasError) return null;
  for (let i = 0; i < node.childCount; i++) {
    const e = findError(node.child(i)!);
    if (e) return e;
  }
  return null;
}

function toStmt(node: SyntaxNode): Stmt {
  if (node.type === "let_stmt") {
    return {
      kind: "let",
      name: node.childForFieldName("name")!.text,
      value: toExpr(node.childForFieldName("value")!),
      span: nodeSpan(node),
    };
  }
  return { kind: "expr", value: toExpr(node), span: nodeSpan(node) };
}

function binop(op: BinOp, node: SyntaxNode): Expr {
  return {
    kind: "binop",
    op,
    lhs: toExpr(node.childForFieldName("lhs")!),
    rhs: toExpr(node.childForFieldName("rhs")!),
    span: nodeSpan(node),
  };
}

function toExpr(node: SyntaxNode): Expr {
  switch (node.type) {
    case "number":
      return {
        kind: "num",
        value: parseFloat(node.text.replace(/_/g, "")),
        span: nodeSpan(node),
      };
    case "hex": {
      const digits = node.text.slice(2).replace(/_/g, "");
      const big = BigInt("0x" + digits);
      const value = big > BigInt(Number.MAX_SAFE_INTEGER) ? big : Number(big);
      return { kind: "num", value, span: nodeSpan(node) };
    }
    case "identifier":
      return { kind: "ident", name: node.text, span: nodeSpan(node) };
    case "parens":
      return toExpr(node.namedChild(0)!);
    case "unary":
      return {
        kind: "neg",
        arg: toExpr(node.childForFieldName("arg")!),
        span: nodeSpan(node),
      };
    case "add":
    case "mul":
    case "pow":
      return binop(opFromText(node.childForFieldName("op")!.text), node);
    case "juxt":
      return binop("juxt", node);
    case "convert": {
      const targets = node.childForFieldName("targets")!;
      const ts: Expr[] = [];
      for (let i = 0; i < targets.namedChildCount; i++) {
        ts.push(toExpr(targets.namedChild(i)!));
      }
      return {
        kind: "convert",
        arg: toExpr(node.childForFieldName("arg")!),
        targets: ts,
        span: nodeSpan(node),
      };
    }
    case "call": {
      const fn = node.childForFieldName("fn")!;
      const args: Expr[] = [];
      for (let i = 1; i < node.namedChildCount; i++) {
        args.push(toExpr(node.namedChild(i)!));
      }
      return { kind: "call", fn: fn.text, args, span: nodeSpan(node) };
    }
  }
  throw new CalcError("parse", `unexpected \`${node.type}\``, nodeSpan(node));
}

function opFromText(text: string): BinOp {
  switch (text) {
    case "+":
      return "add";
    case "-":
      return "sub";
    case "*":
    case "·":
    case "×":
      return "mul";
    case "/":
      return "div";
    case "^":
    case "**":
      return "pow";
  }
  throw new Error(`unknown op: ${text}`);
}

function nodeSpan(node: SyntaxNode): Span {
  return { start: node.startIndex, end: node.endIndex };
}

// make sure prec mirrors grammar.js otherwise paren wrapping might be wrong
const BINOP_INFO: Record<BinOp, { sym: string; prec: number; rightAssoc: boolean }> = {
  add: { sym: "+", prec: 10, rightAssoc: false },
  sub: { sym: "-", prec: 10, rightAssoc: false },
  mul: { sym: "×", prec: 20, rightAssoc: false },
  div: { sym: "/", prec: 20, rightAssoc: false },
  juxt: { sym: "", prec: 30, rightAssoc: false },
  pow: { sym: "^", prec: 40, rightAssoc: true },
};
const PREC_CONVERT = 5;
const PREC_UNARY = 35;

export function showProgram(stmts: Stmt[]): string {
  return stmts.map(showStmt).join("\n");
}

function showStmt(s: Stmt): string {
  if (s.kind === "let") return `let ${s.name} = ${showExpr(s.value, 0)}`;
  return showExpr(s.value, 0);
}

function showExpr(e: Expr, ctx: number): string {
  switch (e.kind) {
    case "num":
      return e.value.toString();
    case "ident":
      return e.name;
    case "neg":
      return wrap(`-${showExpr(e.arg, PREC_UNARY)}`, PREC_UNARY, ctx);
    case "binop": {
      const op = BINOP_INFO[e.op];
      const lhs = showExpr(e.lhs, op.rightAssoc ? op.prec + 1 : op.prec);
      const rhs = showExpr(e.rhs, op.rightAssoc ? op.prec : op.prec + 1);
      const sep = e.op === "juxt" ? " " : ` ${op.sym} `;
      return wrap(`${lhs}${sep}${rhs}`, op.prec, ctx);
    }
    case "convert": {
      const targets = e.targets.map(t => showExpr(t, 0)).join(", ");
      return wrap(`${showExpr(e.arg, PREC_CONVERT + 1)} → ${targets}`, PREC_CONVERT, ctx);
    }
    case "call":
      return `${e.fn}(${e.args.map(a => showExpr(a, 0)).join(", ")})`;
  }
}

function wrap(s: string, prec: number, ctx: number): string {
  return prec < ctx ? `(${s})` : s;
}
