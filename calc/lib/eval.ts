import { type BinOp, type Expr, parseProgram, type Stmt } from "./parse.ts";
import type { IdentKind } from "./classify.ts";
export type { Stmt };
import { CalcError, type Span } from "./errors.ts";
import {
  describeDim,
  dimDiv,
  dimEq,
  dimIsScalar,
  type DimKey,
  dimMul,
  dimPow,
  resolveUnit,
} from "./units.ts";
import {
  asNum,
  type Base,
  displayExpr,
  type EvalResult,
  exprFactor,
  type Quantity,
  scalar,
  type UnitTerm,
  withDisplay,
} from "./quantity.ts";
import { format } from "./format.ts";

export type { Base, Display, EvalResult, Quantity, UnitTerm } from "./quantity.ts";

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  π: Math.PI,
  tau: 2 * Math.PI,
  τ: 2 * Math.PI,
  e: Math.E,

  thousand: 1e3,
  myriad: 1e4,
  million: 1e6,
  billion: 1e9,
  trillion: 1e12,
  quadrillion: 1e15,
};

const scalarFn =
  (f: (x: number) => number) =>
  (q: EvalResult): EvalResult =>
    scalar(f(asNum(q.quantity.value)));

function bswap(v: number | bigint, bits: 16 | 32 | 64): number | bigint {
  const mask = (1n << BigInt(bits)) - 1n;
  let x = (typeof v === "bigint" ? v : BigInt(Math.trunc(v))) & mask;
  let r = 0n;
  for (let i = 0; i < bits / 8; i++) {
    r = (r << 8n) | (x & 0xffn);
    x >>= 8n;
  }
  return bits === 64 ? r : Number(r);
}

const FNS_1: Record<string, (q: EvalResult) => EvalResult> = {
  sin: scalarFn(Math.sin),
  cos: scalarFn(Math.cos),
  tan: scalarFn(Math.tan),
  asin: scalarFn(Math.asin),
  acos: scalarFn(Math.acos),
  atan: scalarFn(Math.atan),
  sinh: scalarFn(Math.sinh),
  cosh: scalarFn(Math.cosh),
  tanh: scalarFn(Math.tanh),
  ln: scalarFn(Math.log),
  log: scalarFn(Math.log10),
  log10: scalarFn(Math.log10),
  log2: scalarFn(Math.log2),
  exp: scalarFn(Math.exp),
  abs: scalarFn(Math.abs),
  floor: scalarFn(Math.floor),
  ceil: scalarFn(Math.ceil),
  round: scalarFn(Math.round),
  bswap16: q => scalar(bswap(q.quantity.value, 16)),
  bswap32: q => scalar(bswap(q.quantity.value, 32)),
  bswap64: q => scalar(bswap(q.quantity.value, 64)),
};

const BASES = ["hex", "bin", "oct"] as const;
const isBase = (s: string): s is Base => (BASES as readonly string[]).includes(s);

export class Session {
  private bindings = new Map<string, EvalResult>();

  evaluate(input: string): EvalResult {
    return this.evaluateStmts(parseProgram(input));
  }

  evaluateStmts(stmts: Stmt[]): EvalResult {
    if (stmts.length === 0) {
      throw new CalcError("parse", "empty input", { start: 0, end: 0 });
    }
    let last!: EvalResult;
    for (const s of stmts) last = this.execStmt(s);
    return last;
  }

  run(input: string): string {
    return format(this.evaluate(input));
  }

  bindingsView(): ReadonlyMap<string, Quantity> {
    return new Map([...this.bindings].map(([name, result]) => [name, result.quantity]));
  }

  resultBindingsView(): ReadonlyMap<string, EvalResult> {
    return this.bindings;
  }

  classifyIdent(name: string): IdentKind {
    if (this.bindings.has(name)) return "var";
    if (resolveUnit(name)) return "unit";
    if (name in CONSTANTS) return "const";
    return "unbound";
  }

  private execStmt(s: Stmt): EvalResult {
    if (s.kind === "let") {
      const r = this.evalExpr(s.value);
      this.bindings.set(s.name, r);
      return r;
    }
    const r = this.evalExpr(s.value);
    this.bindings.set("ans", r);
    this.bindings.set("_", r);
    return r;
  }

  private evalExpr(e: Expr): EvalResult {
    switch (e.kind) {
      case "num":
        return scalar(e.value);
      case "ident":
        return this.evalIdent(e.name, e.span);
      case "neg": {
        const a = this.evalExpr(e.arg);
        return withDisplay({ value: -a.quantity.value, dim: a.quantity.dim }, a.display);
      }
      case "binop":
        return doBinop(e.op, this.evalExpr(e.lhs), this.evalExpr(e.rhs), e.span);
      case "convert": {
        if (
          e.targets.length === 1 &&
          e.targets[0].kind === "ident" &&
          isBase(e.targets[0].name)
        ) {
          const a = this.evalExpr(e.arg);
          if (!dimIsScalar(a.quantity.dim)) {
            throw new CalcError("dim-mismatch", "hex/bin/oct require a scalar", e.span);
          }
          return withDisplay(a.quantity, {
            kind: "base",
            base: e.targets[0].name,
          });
        }
        const a = this.evalExpr(e.arg);
        const ts = e.targets.map(t => this.evalExpr(t));
        for (const t of ts) {
          if (!dimEq(a.quantity.dim, t.quantity.dim)) {
            throw new CalcError(
              "dim-mismatch",
              `cannot convert ${describeDim(a.quantity.dim)} to ${describeDim(t.quantity.dim)}`,
              e.span,
            );
          }
        }
        const groups = ts.map(t => displayExpr(t.display));
        return withDisplay(a.quantity, { kind: "mixed", groups });
      }
      case "call":
        return doCall(
          e.fn,
          e.args.map(a => this.evalExpr(a)),
          e.span,
        );
    }
  }

  private evalIdent(name: string, sp: Span): EvalResult {
    const bound = this.bindings.get(name);
    if (bound) return bound;
    const u = resolveUnit(name);
    if (u) {
      return withDisplay(
        { value: u.factor, dim: u.dim },
        { kind: "unit", expr: [{ sym: name, exp: 1 }] },
      );
    }
    if (name in CONSTANTS) return scalar(CONSTANTS[name]);
    throw new CalcError("unknown-ident", `unknown identifier \`${name}\``, sp);
  }
}

function doBinop(op: BinOp, a: EvalResult, b: EvalResult, sp: Span): EvalResult {
  // TODO: preserve bignumbers through arithmetic if we can
  const aq = a.quantity;
  const bq = b.quantity;
  const av = asNum(aq.value);
  const bv = asNum(bq.value);
  const ae = displayExpr(a.display);
  const be = displayExpr(b.display);

  switch (op) {
    case "add":
    case "sub": {
      if (!dimEq(aq.dim, bq.dim)) {
        throw new CalcError(
          "dim-mismatch",
          `${op === "add" ? "+" : "-"}: ${describeDim(aq.dim)} vs ${describeDim(bq.dim)}`,
          sp,
        );
      }
      const value = op === "add" ? av + bv : av - bv;
      return withDisplay(
        { value, dim: aq.dim },
        {
          kind: "unit",
          expr: pickDisplay(ae, be),
        },
      );
    }
    case "juxt":
      if (dimIsScalar(bq.dim) && !dimIsScalar(aq.dim)) {
        throw new CalcError(
          "dim-mismatch",
          "tried to juxtapose non-trivial value with scalar",
          sp,
        );
      }
    /* falls through */
    case "mul":
      return withDisplay(
        { value: av * bv, dim: dimMul(aq.dim, bq.dim) },
        { kind: "unit", expr: [...ae, ...be] },
      );
    case "div": {
      if (bv === 0) throw new CalcError("div-zero", "division by zero", sp);
      return withDisplay(
        { value: av / bv, dim: dimDiv(aq.dim, bq.dim) },
        {
          kind: "unit",
          expr: [...ae, ...be.map(t => ({ sym: t.sym, exp: -t.exp }))],
        },
      );
    }
    case "pow": {
      if (!dimIsScalar(bq.dim)) {
        throw new CalcError("bad-exponent", "exponent must be dimensionless", sp);
      }
      if (!Number.isFinite(bv)) {
        throw new CalcError("bad-exponent", "non-finite exponent", sp);
      }
      if (!dimIsScalar(aq.dim) && !Number.isInteger(bv)) {
        throw new CalcError("bad-exponent", "non-integer exponent on dimensional value", sp);
      }
      return withDisplay(
        { value: Math.pow(av, bv), dim: dimPow(aq.dim, bv) },
        {
          kind: "unit",
          expr: ae.map(t => ({ sym: t.sym, exp: t.exp * bv })),
        },
      );
    }
  }
}

function pickDisplay(a: UnitTerm[], b: UnitTerm[]): UnitTerm[] {
  const fa = Math.abs(exprFactor(a));
  const fb = Math.abs(exprFactor(b));
  return fa <= fb ? a : b;
}

function doCall(name: string, args: EvalResult[], sp: Span): EvalResult {
  if (name === "sqrt") {
    if (args.length !== 1) {
      throw new CalcError("call", "sqrt: expects 1 arg", sp);
    }
    const a = args[0];
    for (const k of Object.keys(a.quantity.dim) as DimKey[]) {
      if ((a.quantity.dim[k] ?? 0) % 2 !== 0) {
        throw new CalcError("bad-exponent", "sqrt requires even dim exponents", sp);
      }
    }
    return withDisplay(
      {
        value: Math.sqrt(asNum(a.quantity.value)),
        dim: dimPow(a.quantity.dim, 0.5),
      },
      {
        kind: "unit",
        expr: displayExpr(a.display).map(t => ({
          sym: t.sym,
          exp: t.exp * 0.5,
        })),
      },
    );
  }
  const f = FNS_1[name];
  if (!f) {
    throw new CalcError("unknown-ident", `unknown function \`${name}\``, sp);
  }
  if (args.length !== 1) {
    throw new CalcError("call", `${name}: expects 1 arg`, sp);
  }
  if (!dimIsScalar(args[0].quantity.dim)) {
    throw new CalcError("dim-mismatch", `${name}: expects dimensionless`, sp);
  }
  return f(args[0]);
}
