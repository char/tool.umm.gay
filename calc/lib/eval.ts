import { type BinOp, type Expr, type Stmt, parseProgram } from "./parse.ts";
import type { IdentKind } from "./classify.ts";
export type { Stmt };
import { CalcError, type Span } from "./errors.ts";
import {
  type DimKey,
  describeDim,
  dimDiv,
  dimEq,
  dimIsScalar,
  dimMul,
  dimPow,
  resolveUnit,
} from "./units.ts";
import { type Quantity, type UnitTerm, asNum, exprFactor, scalar } from "./quantity.ts";
import { format } from "./format.ts";

export type { Quantity, UnitTerm };

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

const FNS_1: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  ln: Math.log,
  log: Math.log10,
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
};

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

const BASES = ["hex", "bin", "oct"] as const;
type Base = (typeof BASES)[number];
const isBase = (s: string): s is Base => (BASES as readonly string[]).includes(s);

export class Session {
  private bindings = new Map<string, Quantity>();

  evaluate(input: string): Quantity {
    return this.evaluateStmts(parseProgram(input));
  }

  evaluateStmts(stmts: Stmt[]): Quantity {
    if (stmts.length === 0) {
      throw new CalcError("parse", "empty input", { start: 0, end: 0 });
    }
    let last!: Quantity;
    for (const s of stmts) last = this.execStmt(s);
    return last;
  }

  run(input: string): string {
    return format(this.evaluate(input));
  }

  bindingsView(): ReadonlyMap<string, Quantity> {
    return this.bindings;
  }

  classifyIdent(name: string): IdentKind {
    if (this.bindings.has(name)) return "var";
    if (resolveUnit(name)) return "unit";
    if (name in CONSTANTS) return "const";
    return "unbound";
  }

  private execStmt(s: Stmt): Quantity {
    if (s.kind === "let") {
      const q = this.evalExpr(s.value);
      this.bindings.set(s.name, q);
      return q;
    }
    const q = this.evalExpr(s.value);
    this.bindings.set("ans", q);
    this.bindings.set("_", q);
    return q;
  }

  private evalExpr(e: Expr): Quantity {
    switch (e.kind) {
      case "num":
        return scalar(e.value);
      case "ident":
        return this.evalIdent(e.name, e.span);
      case "neg": {
        const a = this.evalExpr(e.arg);
        return { value: -a.value, dim: a.dim, expr: a.expr };
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
          if (!dimIsScalar(a.dim)) {
            throw new CalcError("dim-mismatch", "hex/bin/oct require a scalar", e.span);
          }
          return { ...a, base: e.targets[0].name };
        }
        const a = this.evalExpr(e.arg);
        const ts = e.targets.map(t => this.evalExpr(t));
        for (const t of ts) {
          if (!dimEq(a.dim, t.dim)) {
            throw new CalcError(
              "dim-mismatch",
              `cannot convert ${describeDim(a.dim)} to ${describeDim(t.dim)}`,
              e.span,
            );
          }
        }
        return {
          value: a.value,
          dim: a.dim,
          expr: ts[0].expr,
          mixed: ts.map(t => t.expr),
        };
      }
      case "call":
        return doCall(
          e.fn,
          e.args.map(a => this.evalExpr(a)),
          e.span,
        );
    }
  }

  private evalIdent(name: string, sp: Span): Quantity {
    const bound = this.bindings.get(name);
    if (bound) return bound;
    const u = resolveUnit(name);
    if (u) return { value: u.factor, dim: u.dim, expr: [{ sym: name, exp: 1 }] };
    if (name in CONSTANTS) return scalar(CONSTANTS[name]);
    throw new CalcError("unknown-ident", `unknown identifier \`${name}\``, sp);
  }
}

function doBinop(op: BinOp, a: Quantity, b: Quantity, sp: Span): Quantity {
  // TODO: preserve bignumbers through arithmetic if we can
  const av = asNum(a.value);
  const bv = asNum(b.value);
  switch (op) {
    case "add":
    case "sub": {
      if (!dimEq(a.dim, b.dim)) {
        throw new CalcError(
          "dim-mismatch",
          `${op === "add" ? "+" : "-"}: ${describeDim(a.dim)} vs ${describeDim(b.dim)}`,
          sp,
        );
      }
      const value = op === "add" ? av + bv : av - bv;
      return { value, dim: a.dim, expr: pickDisplay(a, b) };
    }
    case "mul":
    case "juxt":
      return {
        value: av * bv,
        dim: dimMul(a.dim, b.dim),
        expr: [...a.expr, ...b.expr],
      };
    case "div": {
      if (bv === 0) throw new CalcError("div-zero", "division by zero", sp);
      return {
        value: av / bv,
        dim: dimDiv(a.dim, b.dim),
        expr: [...a.expr, ...b.expr.map(t => ({ sym: t.sym, exp: -t.exp }))],
      };
    }
    case "pow": {
      if (!dimIsScalar(b.dim)) {
        throw new CalcError("bad-exponent", "exponent must be dimensionless", sp);
      }
      if (!Number.isFinite(bv)) {
        throw new CalcError("bad-exponent", "non-finite exponent", sp);
      }
      if (!dimIsScalar(a.dim) && !Number.isInteger(bv)) {
        throw new CalcError("bad-exponent", "non-integer exponent on dimensional value", sp);
      }
      return {
        value: Math.pow(av, bv),
        dim: dimPow(a.dim, bv),
        expr: a.expr.map(t => ({ sym: t.sym, exp: t.exp * bv })),
      };
    }
  }
}

function pickDisplay(a: Quantity, b: Quantity): UnitTerm[] {
  const fa = Math.abs(exprFactor(a.expr));
  const fb = Math.abs(exprFactor(b.expr));
  return fa <= fb ? a.expr : b.expr;
}

function doCall(name: string, args: Quantity[], sp: Span): Quantity {
  if (name === "sqrt") {
    if (args.length !== 1) throw new CalcError("call", "sqrt: expects 1 arg", sp);
    const a = args[0];
    for (const k of Object.keys(a.dim) as DimKey[]) {
      if ((a.dim[k] ?? 0) % 2 !== 0) {
        throw new CalcError("bad-exponent", "sqrt requires even dim exponents", sp);
      }
    }
    return {
      value: Math.sqrt(asNum(a.value)),
      dim: dimPow(a.dim, 0.5),
      expr: a.expr.map(t => ({ sym: t.sym, exp: t.exp * 0.5 })),
    };
  }
  if (name === "bswap16" || name === "bswap32" || name === "bswap64") {
    if (args.length !== 1) throw new CalcError("call", `${name}: expects 1 arg`, sp);
    if (!dimIsScalar(args[0].dim)) {
      throw new CalcError("dim-mismatch", `${name}: expects scalar`, sp);
    }
    const bits = Number(name.slice(5)) as 16 | 32 | 64;
    return scalar(bswap(args[0].value, bits));
  }
  const f = FNS_1[name];
  if (!f) throw new CalcError("unknown-ident", `unknown function \`${name}\``, sp);
  if (args.length !== 1) throw new CalcError("call", `${name}: expects 1 arg`, sp);
  if (!dimIsScalar(args[0].dim)) {
    throw new CalcError("dim-mismatch", `${name}: expects dimensionless`, sp);
  }
  return scalar(f(asNum(args[0].value)));
}
