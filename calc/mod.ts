export type { Quantity, UnitTerm } from "./lib/quantity.ts";
export type { Dim, DimKey } from "./lib/units.ts";
export type { Span, ErrorKind } from "./lib/errors.ts";
export type { Stmt } from "./lib/eval.ts";
export { CalcError } from "./lib/errors.ts";
export { Session } from "./lib/eval.ts";
export { format, type FormatOptions } from "./lib/format.ts";
export { parseProgram, parseTree, showProgram } from "./lib/parse.ts";
export type { Classify, IdentKind } from "./lib/classify.ts";
export {
  ansiPalette,
  highlight,
  noColor,
  type Palette,
  renderAnsi,
  type HighlightSpan,
  type SpanKind,
} from "./lib/highlight.ts";

import { Session } from "./lib/eval.ts";
import type { Quantity } from "./lib/quantity.ts";

export function evaluate(input: string): Quantity {
  return new Session().evaluate(input);
}

export function run(input: string): string {
  return new Session().run(input);
}
