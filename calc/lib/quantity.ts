import { type Dim, resolveUnit, SCALAR } from "./units.ts";

export interface UnitTerm {
  sym: string;
  exp: number;
}

export interface Quantity {
  value: number | bigint;
  dim: Dim;
}

export type Base = "hex" | "bin" | "oct";

export type Display =
  | { kind: "unit"; expr: UnitTerm[] }
  | { kind: "mixed"; groups: UnitTerm[][] }
  | { kind: "base"; base: Base };

export interface EvalResult {
  quantity: Quantity;
  display: Display;
}

export const scalar = (v: number | bigint): EvalResult => ({
  quantity: { value: v, dim: SCALAR },
  display: { kind: "unit", expr: [] },
});

export const withDisplay = (quantity: Quantity, display: Display): EvalResult => ({
  quantity,
  display,
});

export const asNum = (v: number | bigint): number => (typeof v === "bigint" ? Number(v) : v);

export function displayExpr(display: Display): UnitTerm[] {
  if (display.kind === "unit") return display.expr;
  if (display.kind === "mixed") return display.groups[0] ?? [];
  return [];
}

export function exprFactor(expr: UnitTerm[]): number {
  let f = 1;
  for (const t of expr) {
    const u = resolveUnit(t.sym);
    if (u) f *= Math.pow(u.factor, t.exp);
  }
  return f;
}
