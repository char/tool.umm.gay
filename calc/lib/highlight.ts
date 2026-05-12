import type { Node as SyntaxNode } from "npm:web-tree-sitter@^0.26.8";
import { parseTree, type TokenKind, tokenKind } from "./parse.ts";
import type { Classify, IdentKind } from "./classify.ts";

export type SpanKind = IdentKind | TokenKind | "num" | "fn" | "comment" | "plain";

export interface HighlightSpan {
  kind: SpanKind;
  text: string;
}

export function highlight(src: string, classify: Classify): HighlightSpan[] {
  const tree = parseTree(src);
  if (!tree) return src.length > 0 ? [{ kind: "plain", text: src }] : [];

  const out: HighlightSpan[] = [];
  let pos = 0;

  const push = (kind: SpanKind, text: string) => {
    if (text.length === 0) return;
    out.push({ kind, text });
  };

  const emit = (node: SyntaxNode) => {
    const { startIndex: s, endIndex: e } = node;
    if (s >= e) return;
    if (s > pos) push("plain", src.slice(pos, s));
    push(leafKind(node, src.slice(s, e), classify), src.slice(s, e));
    pos = e;
  };

  const walk = (node: SyntaxNode) => {
    if (node.childCount === 0) {
      emit(node);
      return;
    }
    for (let i = 0; i < node.childCount; i++) walk(node.child(i)!);
  };
  walk(tree.rootNode);

  if (pos < src.length) push("plain", src.slice(pos));
  return out;
}

function leafKind(node: SyntaxNode, text: string, classify: Classify): SpanKind {
  if (node.isNamed) {
    switch (node.type) {
      case "number":
      case "hex":
        return "num";
      case "comment":
        return "comment";
      case "identifier": {
        const parent = node.parent;
        // the name being declared in `let x = ...` is always a var, even
        // before the binding takes effect (otherwise live highlighting
        // would mis-color names that happen to shadow a unit/constant).
        if (parent?.type === "let_stmt") {
          const nameField = parent.childForFieldName("name");
          if (nameField && nameField.startIndex === node.startIndex) return "var";
        }
        if (parent?.type === "call") {
          const fn = parent.childForFieldName("fn");
          if (fn && fn.startIndex === node.startIndex) return "fn";
        }
        return classify(text);
      }
    }
    return "plain";
  }
  return tokenKind(text) ?? "plain";
}

// --- rendering ---

type Style = (s: string) => string;
type StyledKind = Exclude<SpanKind, "plain">;
export type Palette = Record<StyledKind, Style>;

const identity: Style = s => s;
export const noColor: Palette = {
  num: identity,
  var: identity,
  unit: identity,
  const: identity,
  unbound: identity,
  fn: identity,
  kw: identity,
  op: identity,
  punct: identity,
  comment: identity,
};

const ansi = (code: string): Style => s => `\x1b[${code}m${s}\x1b[0m`;
export const ansiPalette: Palette = {
  num: ansi("92"),
  var: ansi("93"),
  unit: ansi("97"),
  const: ansi("33"),
  unbound: ansi("91"),
  fn: ansi("33"),
  kw: ansi("38;5;218"),
  op: ansi("36"),
  punct: ansi("2"),
  comment: ansi("2;3"),
};

export function renderAnsi(spans: HighlightSpan[], palette: Palette = ansiPalette): string {
  return spans.map(s => (s.kind === "plain" ? s.text : palette[s.kind](s.text))).join("");
}
