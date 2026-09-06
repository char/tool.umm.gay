export interface UnicodeRecord {
  id: number;
  text: string;
  name: string;
  aliases?: string[];
  shortcodes?: string[];
  entities?: string[];
  category?: string;
  combining?: number;
  bidi?: string;
  decomposition?: string;
  uppercase?: string;
  lowercase?: string;
  titlecase?: string;
}

export interface UnicodeRange {
  start: number;
  end: number;
  name: string;
  category: string;
  combining: number;
  bidi: string;
}

export interface Manifest {
  unicodeVersion: string;
  emojiRevision: string;
  count: number;
  prefixes: string[];
  pages: number[];
  ranges: UnicodeRange[];
}

export type Page = Record<number, UnicodeRecord>;
export type WordIndex = Record<string, number[]>;
export type Mode = "text" | "name" | "compose" | "codepoint" | "symbol";
export const modes: Mode[] = ["text", "name", "compose", "codepoint", "symbol"];

export function hex(cp: number): string {
  return cp.toString(16).toUpperCase().padStart(4, "0");
}

export function codepoints(text: string): string {
  return Array.from(text, char => `U+${hex(char.codePointAt(0)!)}`).join(" ");
}

export function words(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])];
}

export function parseCodepoints(input: string): string {
  const parts = input.trim().split(/[\s,]+/);
  if (!parts.length || parts.some(part => !/^(?:U\+|0x)?[0-9a-f]{1,6}$/i.test(part))) {
    throw new Error("Use hexadecimal codepoints, e.g. U+2665, 0x1F600, or 2764 FE0F.");
  }
  const points = parts.map(part => parseInt(part.replace(/^(?:U\+|0x)/i, ""), 16));
  if (points.some(cp => cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))) {
    throw new Error(
      "Codepoints must be Unicode scalar values (0000–10FFFF, excluding D800–DFFF).",
    );
  }
  return String.fromCodePoint(...points);
}

export function detectMode(input: string): Mode {
  if (
    /^(?:U\+|0x)/i.test(input) ||
    /^(?=[0-9a-f\s]*\d)[0-9a-f]{4,6}(?:\s+[0-9a-f]{4,6})*$/i.test(input)
  )
    return "codepoint";
  if (input.startsWith(":") || /^&[a-z][a-z0-9]*;?$/i.test(input)) return "name";
  if (input.startsWith("<") || /^(?:Multi_key|Compose|dead_)/.test(input)) return "compose";
  if (/[^\x20-\x7e]/.test(input) || /^\s+$/.test(input) || Array.from(input).length === 1)
    return "symbol";
  if (/[^a-z0-9\s:_-]/i.test(input)) return "compose";
  return "text";
}

export function unnamedRecord(cp: number, ranges: UnicodeRange[]): UnicodeRecord {
  const range = ranges.find(range => cp >= range.start && cp <= range.end);
  const noncharacter = (cp >= 0xfdd0 && cp <= 0xfdef) || (cp & 0xfffe) === 0xfffe;
  return {
    id: cp,
    text: String.fromCodePoint(cp),
    name: range?.name ?? (noncharacter ? "<noncharacter>" : "<unassigned>"),
    category: range?.category ?? "Cn",
    combining: range?.combining ?? 0,
    bidi: range?.bidi,
  };
}
