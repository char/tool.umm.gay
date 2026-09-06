import {
  type Manifest,
  type NameIndex,
  nameShard,
  type Page,
  type SearchRanking,
  type UnicodeRecord,
  unnamedRecord,
  words,
  type WordIndex,
} from "./data.ts";

const cache = new Map<string, Promise<unknown>>();
let ranking: Record<keyof SearchRanking, Set<number>> | undefined;

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
  let ids: number[];
  let matches: { exact: Set<number>; prefix: Set<number> }[] = [];
  if (input.startsWith(":") || input.startsWith("&")) {
    const entity = input.startsWith("&");
    const aliases = await fetchJSON<Record<string, number>>(
      `${asset}/${entity ? "entities" : "shortcodes"}.json`,
    );
    const exact = input.endsWith(entity ? ";" : ":") && input.length > 1;
    let query = input.slice(1, exact ? -1 : undefined);
    if (!entity) query = query.toLowerCase();
    ids = [
      ...new Set(
        Object.entries(aliases)
          .filter(([name]) => (exact ? name === query : name.startsWith(query)))
          .map(([, id]) => id),
      ),
    ];
  } else {
    const terms = words(input);
    if (!terms.length) return [];
    matches = await Promise.all(
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
    ids = [...matches[0].prefix].filter(id => matches.every(match => match.prefix.has(id)));
  }
  if (ids.length < 2) return ids;
  const name = input.trim().toUpperCase();
  const [ranges, names] = await Promise.all([
    fetchJSON<SearchRanking>(`${asset}/ranking.json`),
    fetchJSON<NameIndex>(`${asset}/names/${nameShard(name)}.json`),
  ]);
  if (!ranking) {
    const sets = { marks: new Set<number>(), syllables: new Set<number>() };
    for (const key of ["marks", "syllables"] as const) {
      for (const [start, end] of ranges[key]) {
        for (let id = start; id <= end; id++) sets[key].add(id);
      }
    }
    ranking = sets;
  }
  const exact = new Set(names[name] ?? []);
  const { marks, syllables } = ranking;
  return ids
    .map(id => ({
      id,
      exact: Number(exact.has(id)),
      mark: Number(marks.has(id)),
      syllable: Number(syllables.has(id)),
      score: matches.filter(match => match.exact.has(id)).length,
    }))
    .sort(
      (a, b) =>
        b.exact - a.exact ||
        a.mark - b.mark ||
        a.syllable - b.syllable ||
        b.score - a.score ||
        a.id - b.id,
    )
    .map(match => match.id);
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

/** the record for `text` itself, followed by those of its component codepoints */
export async function lookupText(text: string, manifest: Manifest): Promise<UnicodeRecord[]> {
  const points = Array.from(text, char => char.codePointAt(0)!);
  const ids = [...new Set(points)];
  if (points.length > 1) {
    const sequences = await fetchJSON<Record<string, number>>(`${asset}/sequences.json`);
    if (Object.hasOwn(sequences, text)) ids.unshift(sequences[text]);
  }
  const records = await getRecords(ids, manifest);
  return records[0]?.text === text
    ? records
    : [{ id: -1, text, name: "symbol sequence" }, ...records];
}
