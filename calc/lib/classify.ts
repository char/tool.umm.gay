// what an identifier resolves to at semantic-analysis time. lives here
// (rather than in eval.ts or parse.ts) so the parser stays purely
// syntactic and the highlighter can depend on the classification
// vocabulary without dragging in the whole evaluator.

export type IdentKind = "var" | "unit" | "const" | "unbound";
export type Classify = (name: string) => IdentKind;
