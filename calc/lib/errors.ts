export interface Span {
  start: number;
  end: number;
}

export type ErrorKind =
  | "lex"
  | "parse"
  | "unknown-unit"
  | "unknown-ident"
  | "dim-mismatch"
  | "div-zero"
  | "bad-exponent"
  | "bad-integer"
  | "call";

export class CalcError extends Error {
  constructor(
    public kind: ErrorKind,
    message: string,
    public span: Span,
  ) {
    super(message);
  }
}
