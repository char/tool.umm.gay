export type { Base, Display, EvalResult, Quantity, UnitTerm } from "./lib/quantity.ts";
export type { Dim, DimKey } from "./lib/units.ts";
export type { ErrorKind, Span } from "./lib/errors.ts";
export type { Stmt } from "./lib/eval.ts";
export { CalcError } from "./lib/errors.ts";
export { Session } from "./lib/eval.ts";
export { format, type FormatOptions } from "./lib/format.ts";
export { parseProgram, parseTree, showProgram } from "./lib/parse.ts";
export type { Classify, IdentKind } from "./lib/classify.ts";
export {
  ansiPalette,
  highlight,
  type HighlightSpan,
  noColor,
  type Palette,
  renderAnsi,
  type SpanKind,
} from "./lib/highlight.ts";

import { Session } from "./lib/eval.ts";
import type { EvalResult } from "./lib/quantity.ts";

export function evaluate(input: string): EvalResult {
  return new Session().evaluate(input);
}

export function run(input: string): string {
  return new Session().run(input);
}
