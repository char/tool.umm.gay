export type { Quantity, UnitTerm } from "./lib/quantity.ts";
export type { Dim, DimKey } from "./lib/units.ts";
export type { Span, ErrorKind } from "./lib/errors.ts";
export type { Stmt } from "./lib/eval.ts";
export { CalcError } from "./lib/errors.ts";
export { Session } from "./lib/eval.ts";
export { format, type FormatOptions } from "./lib/format.ts";
export { parseProgram, showProgram } from "./lib/parse.ts";

import { Session } from "./lib/eval.ts";
import type { Quantity } from "./lib/quantity.ts";

export function evaluate(input: string): Quantity {
  return new Session().evaluate(input);
}

export function run(input: string): string {
  return new Session().run(input);
}
