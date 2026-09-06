import {
  hex,
  type Page,
  type UnicodeRange,
  type UnicodeRecord,
  words,
  type WordIndex,
} from "./data.ts";

export interface DiscordEmoji {
  names: string[];
  surrogates: string;
}

export type HtmlEntities = Record<string, { characters: string }>;

export function indexData(
  unicode: string,
  names: string,
  aliases: string,
  emoji: DiscordEmoji[],
  emojiTest: string,
  htmlEntities: HtmlEntities,
) {
  const records = new Map<number, UnicodeRecord>();
  const ranges: UnicodeRange[] = [];
  let rangeStart: UnicodeRange | undefined;
  for (const line of unicode.trim().split(/\r?\n/)) {
    const [
      point,
      name,
      category,
      combining,
      bidi,
      decomposition,
      ,
      ,
      ,
      ,
      ,
      ,
      uppercase,
      lowercase,
      titlecase,
    ] = line.split(";");
    const id = parseInt(point, 16);
    if (name.endsWith(", First>")) {
      rangeStart = {
        start: id,
        end: id,
        name: name.replace(", First>", ">"),
        category,
        combining: +combining,
        bidi,
      };
    } else if (name.endsWith(", Last>")) {
      if (!rangeStart) throw new Error(`Range end without start: ${point}`);
      ranges.push({ ...rangeStart, end: id });
      rangeStart = undefined;
    } else {
      records.set(id, {
        id,
        text: String.fromCodePoint(id),
        name,
        category,
        combining: +combining,
        bidi,
        ...(decomposition && { decomposition }),
        ...(uppercase && { uppercase }),
        ...(lowercase && { lowercase }),
        ...(titlecase && { titlecase }),
      });
    }
  }
  for (const line of names.split(/\r?\n/)) {
    const match = /^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*([^#]+)/.exec(line);
    if (!match) continue;
    const start = parseInt(match[1], 16);
    const end = parseInt(match[2] ?? match[1], 16);
    const range = ranges.find(range => start >= range.start && start <= range.end);
    for (let id = start; id <= end; id++) {
      const name = match[3].trim().replace("*", hex(id));
      const existing = records.get(id);
      if (existing) existing.name = name;
      else {
        if (!range) throw new Error(`Missing properties for ${hex(id)}`);
        records.set(id, {
          id,
          text: String.fromCodePoint(id),
          name,
          category: range.category,
          combining: range.combining,
          bidi: range.bidi,
        });
      }
    }
  }
  for (const line of aliases.split(/\r?\n/)) {
    const match = /^([0-9A-F]+);([^;]+);/.exec(line);
    if (!match) continue;
    const record = records.get(parseInt(match[1], 16));
    if (record) (record.aliases ??= []).push(match[2]);
  }

  const emojiNames = new Map<string, string>();
  for (const line of emojiTest.split(/\r?\n/)) {
    const match = /^([0-9A-F ]+)\s*;[^#]+#\s*\S+\s+E[\d.]+\s+(.+)$/.exec(line);
    if (!match) continue;
    const text = String.fromCodePoint(
      ...match[1]
        .trim()
        .split(/\s+/)
        .map(cp => parseInt(cp, 16)),
    );
    emojiNames.set(text, match[2].trim());
  }
  const discordNames = new Map<string, string[]>();
  for (const item of emoji) {
    discordNames.set(item.surrogates, [
      ...new Set([...(discordNames.get(item.surrogates) ?? []), ...item.names]),
    ]);
    if (!emojiNames.has(item.surrogates)) {
      emojiNames.set(item.surrogates, item.names[0].replaceAll("_", " "));
    }
  }

  const sequences: Record<string, number> = Object.create(null);
  const shortcodes: Record<string, number> = Object.create(null);
  let nextId = 0x110000;
  for (const [text, name] of [...emojiNames].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const points = Array.from(text);
    const id = points.length === 1 ? points[0].codePointAt(0)! : nextId++;
    if (points.length > 1) sequences[text] = id;
    let record = records.get(id);
    if (!record) {
      record = { id, text, name };
      records.set(id, record);
    }
    const aliases = discordNames.get(text);
    if (aliases) {
      record.shortcodes = aliases;
      for (const alias of aliases) shortcodes[alias] = id;
    }
  }

  const entities: Record<string, number> = Object.create(null);
  for (const [entity, { characters: text }] of Object.entries(htmlEntities)) {
    if (!entity.endsWith(";")) continue;
    const points = Array.from(text);
    const id = points.length === 1 ? points[0].codePointAt(0)! : (sequences[text] ?? nextId++);
    if (points.length > 1) sequences[text] = id;
    let record = records.get(id);
    if (!record) {
      record = {
        id,
        text,
        name: points
          .map(
            char => records.get(char.codePointAt(0)!)?.name ?? `U+${hex(char.codePointAt(0)!)}`,
          )
          .join(" + "),
      };
      records.set(id, record);
    }
    (record.entities ??= []).push(entity);
    entities[entity.slice(1, -1)] = id;
  }

  const pages = new Map<number, Page>();
  const indexes = new Map<string, WordIndex>();
  for (const [id, record] of [...records].sort(([a], [b]) => a - b)) {
    const pageId = id >> 8;
    let page = pages.get(pageId);
    if (!page) pages.set(pageId, (page = {}));
    page[id] = record;
    for (const word of words(
      [
        record.name,
        emojiNames.get(record.text) ?? "",
        ...(record.aliases ?? []),
        ...(record.shortcodes ?? []),
        ...(record.entities ?? []),
      ].join(" "),
    )) {
      const prefix = word.slice(0, 2);
      let index = indexes.get(prefix);
      if (!index) indexes.set(prefix, (index = Object.create(null) as WordIndex));
      (index[word] ??= []).push(id);
    }
  }
  return { pages, indexes, ranges, sequences, shortcodes, entities, count: records.size };
}
