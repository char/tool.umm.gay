export interface ComposeEntry {
  keys: string[];
  text: string;
  source: string;
  line: number;
}

export interface ComposeSources {
  compose: string[];
  locale: string;
}

export type Keysyms = Record<string, string>;
type ComposeLine = { keys: string[]; text: string } | { include: string };

export function keysymText(key: string, keysyms: Keysyms): string | undefined {
  if (Object.hasOwn(keysyms, key)) return keysyms[key];
  if (/^U[0-9a-f]{4,8}$/i.test(key)) {
    const cp = parseInt(key.slice(1), 16);
    if (cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) return String.fromCodePoint(cp);
  }
  return undefined;
}

const escapes: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  v: "\v",
};

// Escapes are byte-wise, so a string may only be decoded once fully unescaped.
function unquote(value: string): string {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < value.length;) {
    if (value[i] !== "\\") {
      const char = String.fromCodePoint(value.codePointAt(i)!);
      bytes.push(...encoder.encode(char));
      i += char.length;
      continue;
    }
    i++;
    const numeric = /^(?:[0-7]{1,3}|x[0-9a-fA-F]{1,2})/.exec(value.slice(i));
    if (numeric) {
      bytes.push(parseInt(numeric[0].replace(/^x/, ""), numeric[0][0] === "x" ? 16 : 8) & 255);
      i += numeric[0].length;
    } else {
      const char = value[i++];
      if (char === undefined) throw new Error("Unterminated escape");
      bytes.push(...encoder.encode(escapes[char] ?? char));
    }
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
}

export function parseComposeLine(line: string, keysyms: Keysyms): ComposeLine | undefined {
  if (/^\s*(?:#|XCOMM|$)/.test(line)) return undefined;
  const include = /^\s*include\s+"((?:\\.|[^"\\])*)"\s*(?:#.*)?$/.exec(line);
  if (include) return { include: unquote(include[1]) };
  const rule = /^\s*((?:<[^<>\s]+>\s*)+):\s*(.*)$/.exec(line);
  if (!rule) throw new Error("Unsupported Compose syntax (expected <keys> : result)");
  const keys = [...rule[1].matchAll(/<([^<>]+)>/g)].map(match => match[1]);
  const result = /^(?:"((?:\\.|[^"\\])*)"\s*(?:([\w]+)\s*)?|([\w]+)\s*)(?:#.*)?$/.exec(rule[2]);
  if (!result) throw new Error("Invalid Compose result");
  const text = result[1] !== undefined ? unquote(result[1]) : keysymText(result[3], keysyms);
  if (text === undefined) throw new Error(`Unknown result keysym: ${result[3]}`);
  return { keys, text };
}

export async function loadCompose(
  sources: ComposeSources,
  base: URL,
  keysyms: Keysyms,
  read: (url: URL) => Promise<string>,
): Promise<{ entries: ComposeEntry[]; warnings: string[] }> {
  const entries = new Map<string, ComposeEntry>();
  const warnings: string[] = [];
  const files = new Map<string, Promise<string>>();
  const locale = new URL(sources.locale, base);

  async function load(path: string, parent: URL, stack: string[]) {
    try {
      const resolved = path
        .replace(/%L/g, locale.href)
        .replace(/%S/g, new URL(".", locale).href.replace(/\/$/, ""));
      if (/%[A-Z%]/.test(resolved))
        throw new Error("Unsupported include substitution; use a relative asset path");
      const url = new URL(resolved, parent);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
        throw new Error("Compose includes must stay inside /assets/");
      }
      if (stack.includes(url.href)) throw new Error("Compose include cycle");
      if (stack.length >= 32) throw new Error("Compose include nesting exceeds 32 files");
      let file = files.get(url.href);
      if (!file) {
        file = read(url);
        files.set(url.href, file);
      }
      const text = await file;
      // Preserve line numbers while accepting C comments in upstream Compose.pre files.
      const lines = text
        .replace(/#[^\r\n]*|"(?:\\.|[^"\\\r\n])*"|\/\*[\s\S]*?\*\//g, token =>
          token.startsWith("/*") ? token.replace(/[^\n]/g, " ") : token,
        )
        .split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const lineNumber = i + 1;
        let line = lines[i];
        while (line.endsWith("\\") && i + 1 < lines.length)
          line = line.slice(0, -1) + lines[++i];
        try {
          const parsed = parseComposeLine(line, keysyms);
          if (!parsed) continue;
          if ("include" in parsed) {
            await load(parsed.include, url, [...stack, url.href]);
          } else {
            entries.set(parsed.keys.join(" "), {
              ...parsed,
              source: url.pathname.slice(base.pathname.length),
              line: lineNumber,
            });
          }
        } catch (error) {
          warnings.push(
            `${url.pathname}:${lineNumber}: ${error instanceof Error ? error.message : error}`,
          );
        }
      }
    } catch (error) {
      warnings.push(`${path}: ${error instanceof Error ? error.message : error}`);
    }
  }

  for (const path of sources.compose) await load(path, base, []);
  return { entries: [...entries.values()], warnings };
}

function composeQuery(input: string, keysyms: Keysyms): string[] {
  if (/<[^<>\s]+>/.test(input)) {
    if (!/^\s*(?:<[^<>\s]+>\s*)+$/.test(input)) {
      throw new Error("Use complete <keysym> tokens, e.g. <Multi_key> <apostrophe> <e>.");
    }
    return [...input.matchAll(/<([^<>]+)>/g)].map(match => match[1]);
  }
  const tokens = input.trim().split(/\s+/);
  if (
    tokens.length > 1 ||
    /^(?:Multi_key|Compose|dead_\w+|U[0-9a-fA-F]{4,8})$/.test(input.trim()) ||
    (input.includes("_") && Object.hasOwn(keysyms, input.trim()))
  ) {
    return tokens.map(key => (key === "Compose" ? "Multi_key" : key));
  }
  return Array.from(input);
}

function matchCompose(
  entry: ComposeEntry,
  query: string[],
  keysyms: Keysyms,
  ignoreCase = false,
): boolean {
  let start = 0;
  if (query[0] !== "Multi_key") {
    while (entry.keys[start] === "Multi_key") start++;
  }
  const keys = entry.keys.slice(start);
  return (
    query.length <= keys.length &&
    query.every((key, i) => {
      const actual = keysymText(key, keysyms) ?? key;
      const expected = keysymText(keys[i], keysyms) ?? keys[i];
      return (
        actual === expected || (ignoreCase && actual.toLowerCase() === expected.toLowerCase())
      );
    })
  );
}

export function searchCompose(input: string, entries: ComposeEntry[], keysyms: Keysyms) {
  const query = composeQuery(input, keysyms);
  let matches = entries.filter(entry => matchCompose(entry, query, keysyms));
  const ignoreCase = !matches.length && !/<[^<>\s]+>/.test(input);
  if (ignoreCase) matches = entries.filter(entry => matchCompose(entry, query, keysyms, true));
  matches.sort((a, b) => a.keys.length - b.keys.length);
  return { texts: [...new Set(matches.map(entry => entry.text))], ignoreCase };
}
