import {
  type Manifest,
  type Page,
  type UnicodeRecord,
  unnamedRecord,
  words,
  type WordIndex,
} from "./data.ts";

const cache = new Map<string, Promise<unknown>>();

export function fetchJSON<T>(path: string): Promise<T> {
  let pending = cache.get(path);
  if (!pending) {
    pending = fetch(path)
      .then(response => {
        if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
        return response.json();
      })
      .catch(error => {
        cache.delete(path);
        throw error;
      });
    cache.set(path, pending);
  }
  return pending as Promise<T>;
}

export const asset = "/assets/generated";

export async function searchNames(input: string, manifest: Manifest): Promise<number[]> {
  if (input.startsWith(":") || input.startsWith("&")) {
    const entity = input.startsWith("&");
    const aliases = await fetchJSON<Record<string, number>>(
      `${asset}/${entity ? "entities" : "shortcodes"}.json`,
    );
    const exact = input.endsWith(entity ? ";" : ":") && input.length > 1;
    let query = input.slice(1, exact ? -1 : undefined);
    if (!entity) query = query.toLowerCase();
    return [
      ...new Set(
        Object.entries(aliases)
          .filter(([name]) => (exact ? name === query : name.startsWith(query)))
          .map(([, id]) => id),
      ),
    ].sort((a, b) => a - b);
  }
  const terms = words(input);
  if (!terms.length) return [];
  const matches = await Promise.all(
    terms.map(async term => {
      const prefix = term.slice(0, 2);
      const index = manifest.prefixes.includes(prefix)
        ? await fetchJSON<WordIndex>(`${asset}/words/${prefix}.json`)
        : {};
      return {
        exact: new Set(index[term] ?? []),
        prefix: new Set(
          Object.entries(index)
            .filter(([word]) => (term.length === 1 ? word === term : word.startsWith(term)))
            .flatMap(([, ids]) => ids),
        ),
      };
    }),
  );
  matches.sort((a, b) => a.prefix.size - b.prefix.size);
  return [...matches[0].prefix]
    .filter(id => matches.every(match => match.prefix.has(id)))
    .map(id => ({ id, score: matches.filter(match => match.exact.has(id)).length }))
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .map(match => match.id);
}

export function rankRecords(query: string, records: UnicodeRecord[]): UnicodeRecord[] {
  const name = query.trim().toUpperCase();
  return [...records].sort(
    (a, b) =>
      Number(b.name.toUpperCase() === name) - Number(a.name.toUpperCase() === name) ||
      Number(a.category?.startsWith("M") ?? false) -
        Number(b.category?.startsWith("M") ?? false) ||
      Number(/\bsyllable\b/i.test(a.name)) - Number(/\bsyllable\b/i.test(b.name)),
  );
}

export async function getRecords(ids: number[], manifest: Manifest): Promise<UnicodeRecord[]> {
  const pageIds = [...new Set(ids.map(id => id >> 8))].filter(id =>
    manifest.pages.includes(id),
  );
  const pages = new Map(
    await Promise.all(
      pageIds.map(
        async id =>
          [id, await fetchJSON<Page>(`${asset}/pages/${id.toString(16)}.json`)] as const,
      ),
    ),
  );
  return ids.map(id => {
    const record = pages.get(id >> 8)?.[id];
    if (record) return record;
    if (id > 0x10ffff)
      throw new Error("Missing sequence record; reload to update the data index.");
    return unnamedRecord(id, manifest.ranges);
  });
}

export async function lookupText(text: string, manifest: Manifest): Promise<UnicodeRecord[]> {
  const points = Array.from(text, char => char.codePointAt(0)!);
  const ids = [...new Set(points)];
  if (points.length > 1) {
    const sequences = await fetchJSON<Record<string, number>>(`${asset}/sequences.json`);
    if (Object.hasOwn(sequences, text)) ids.unshift(sequences[text]);
  }
  return getRecords(ids, manifest);
}
