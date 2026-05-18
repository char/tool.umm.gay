import {
  asNum,
  type Display,
  type EvalResult,
  exprFactor,
  type Quantity,
  type UnitTerm,
} from "./quantity.ts";
import { AUTOCOERCE_UNITS, BASE_UNIT, dimEq, type DimKey, resolveUnit } from "./units.ts";
import { CalcError } from "./errors.ts";

export interface FormatOptions {
  precision?: number;
}

export function format(result: EvalResult, opts?: FormatOptions): string {
  return formatQuantity(result.quantity, result.display, opts);
}

export function formatQuantity(
  q: Quantity,
  display: Display = { kind: "unit", expr: baseExpr(q) },
  opts: FormatOptions = {},
): string {
  const prec = opts.precision ?? 6;

  if (display.kind === "base") return formatInBase(q.value, display.base);

  const v = asNum(q.value);
  if (display.kind === "mixed") return formatMixed(v, display.groups, prec);

  const expr = chooseDisplay(q, display.expr);
  const auto = autoMixed(v, expr);
  if (auto) return formatMixed(v, auto, prec);

  if (expr.length === 0) return formatNumber(q.value, prec);
  return `${formatNumber(v / exprFactor(expr), prec)} ${formatExpr(expr)}`;
}

function baseExpr(q: Quantity): UnitTerm[] {
  return (Object.keys(q.dim) as DimKey[])
    .filter(k => (q.dim[k] ?? 0) !== 0)
    .map(k => ({ sym: BASE_UNIT[k], exp: q.dim[k]! }));
}

/** when nothing was explicitly converted, choose a sensible multi-unit
 *  breakdown for known dimensions. returns null to defer to single-unit
 *  display.
 */
function autoMixed(value: number, expr: UnitTerm[]): UnitTerm[][] | null {
  if (expr.length !== 1 || expr[0].exp !== 1) return null;
  const sym = expr[0].sym;
  const u = resolveUnit(sym);
  if (!u) return null;

  // pure time. value is in seconds (base).
  if (u.dim.time === 1 && Object.keys(u.dim).length === 1) {
    const v = Math.abs(value);
    if (v < 60) return null;
    const YEAR = 86400 * 365.25;
    if (v >= YEAR) return seq("year", "day", "h", "min", "s");
    if (v >= 86400) return seq("day", "h", "min", "s");
    if (v >= 3600) return seq("h", "min", "s");
    return seq("min", "s");
  }

  if (sym === "ft" || sym === "inch") return seq("ft", "inch");

  return null;
}

function seq(...syms: string[]): UnitTerm[][] {
  return syms.map(sym => [{ sym, exp: 1 }]);
}

function formatMixed(valueInBase: number, groups: UnitTerm[][], prec: number): string {
  let remaining = valueInBase;
  const parts: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const factor = exprFactor(group);
    const isLast = i === groups.length - 1;
    const count = isLast ? remaining / factor : Math.trunc(remaining / factor);
    if (!isLast) remaining -= count * factor;
    if (count !== 0) {
      parts.push(`${formatNumber(count, prec)} ${formatExpr(group)}`);
    }
  }
  if (parts.length === 0) {
    const last = groups[groups.length - 1];
    parts.push(`0 ${formatExpr(last)}`);
  }
  return parts.join(", ");
}

function chooseDisplay(q: Quantity, expr: UnitTerm[]): UnitTerm[] {
  const combined = combineLikeTerms(expr);

  // if the net dim coincides with a familiar derived unit, prefer it
  // e.g. (A * V = W, N * m = J, 1/s = Hz).

  // we leave plain unit values alone (1 dim, exp = 1) so that "5 Wh" entered in
  // without arithmetic doesn't become 18000 J.
  const isUserNamed = combined.length === 1 && combined[0].exp === 1;
  if (!isUserNamed) {
    for (const d of AUTOCOERCE_UNITS) {
      if (dimEq(q.dim, d.dim)) return [{ sym: d.sym, exp: 1 }];
    }
  }

  const contributorsPerDim = new Map<DimKey, Set<string>>();
  for (const t of combined) {
    const u = resolveUnit(t.sym);
    if (!u) continue;
    for (const D of Object.keys(u.dim) as DimKey[]) {
      const set = contributorsPerDim.get(D) ?? new Set<string>();
      set.add(t.sym);
      contributorsPerDim.set(D, set);
    }
  }

  const ambiguous = [...contributorsPerDim.values()].some(s => s.size > 1);
  if (!ambiguous) return combined;

  const result: UnitTerm[] = [];
  for (const D of Object.keys(q.dim) as DimKey[]) {
    const exp = q.dim[D] ?? 0;
    if (exp === 0) continue;
    let pure: string | undefined;
    for (const t of combined) {
      const u = resolveUnit(t.sym);
      if (u && Object.keys(u.dim).length === 1 && u.dim[D] === 1) {
        pure = t.sym;
        break;
      }
    }
    result.push({ sym: pure ?? BASE_UNIT[D], exp });
  }
  return result;
}

function combineLikeTerms(expr: UnitTerm[]): UnitTerm[] {
  const m = new Map<string, number>();
  for (const t of expr) m.set(t.sym, (m.get(t.sym) ?? 0) + t.exp);
  return [...m.entries()]
    .filter(([, e]) => e !== 0)
    .map(([sym, exp]) => ({
      sym,
      exp,
    }));
}

function formatExpr(expr: UnitTerm[]): string {
  if (expr.length === 0) return "";
  const num = expr.filter(t => t.exp > 0);
  const den = expr.filter(t => t.exp < 0);

  const fmt = (terms: UnitTerm[], abs: boolean) =>
    terms.map(t => t.sym + formatExp(abs ? Math.abs(t.exp) : t.exp)).join("·");

  if (num.length === 0) return fmt(den, false);
  if (den.length === 0) return fmt(num, false);
  return `${fmt(num, false)}/${fmt(den, true)}`;
}

const SUPER: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "-": "⁻",
};

function formatExp(e: number): string {
  if (e === 1) return "";
  if (Number.isInteger(e)) {
    return [...String(e)].map(c => SUPER[c] ?? c).join("");
  }
  return `^${e}`;
}

function formatInBase(n: number | bigint, base: "hex" | "bin" | "oct"): string {
  if (typeof n === "number" && !Number.isInteger(n)) {
    throw new CalcError("bad-integer", "base formatting requires an integer", { start: 0, end: 0 });
  }
  const radix = base === "hex" ? 16 : base === "bin" ? 2 : 8;
  const prefix = base === "hex" ? "0x" : base === "bin" ? "0b" : "0o";
  const big = typeof n === "bigint" ? n : BigInt(n);
  const sign = big < 0n ? "-" : "";
  const mag = big < 0n ? -big : big;
  const digits = mag.toString(radix);
  return `${sign}${prefix}${base === "hex" ? digits.toUpperCase() : digits}`;
}

function formatNumber(n: number | bigint, prec: number): string {
  if (typeof n === "bigint") return n.toString();
  if (n === 0) return "0";
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n) && Math.abs(n) < Number.MAX_SAFE_INTEGER) {
    return String(n);
  }
  return Number(n.toPrecision(prec)).toString();
}
