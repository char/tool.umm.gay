import { type Dim, SCALAR, resolveUnit } from "./units.ts";

export interface UnitTerm {
  sym: string;
  exp: number;
}

export interface Quantity {
  value: number | bigint;
  dim: Dim;
  expr: UnitTerm[];
  // render as comma list split greedily (e.g. feet, inch) - dim of group must match this.dim
  mixed?: UnitTerm[][];
  // base override (must be scalar to be set)
  base?: "hex" | "bin" | "oct";
}

export const scalar = (v: number | bigint): Quantity => ({ value: v, dim: SCALAR, expr: [] });

export const asNum = (v: number | bigint): number => (typeof v === "bigint" ? Number(v) : v);

export function exprFactor(expr: UnitTerm[]): number {
  let f = 1;
  for (const t of expr) {
    const u = resolveUnit(t.sym);
    if (u) f *= Math.pow(u.factor, t.exp);
  }
  return f;
}
