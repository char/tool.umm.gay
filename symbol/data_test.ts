import { deepStrictEqual as equal, ok, throws } from "node:assert/strict";
import {
  codepoints,
  detectMode,
  type Manifest,
  parseCodepoints,
  unnamedRecord,
  words,
} from "./data.ts";
import { indexData } from "./index-data.ts";
import {
  asset,
  fetchJSON,
  getRecords,
  lookupText,
  rankRecords,
  searchNames,
} from "./search.ts";

Deno.test("codepoints preserve sequences and reject malformed/non-scalar values", () => {
  equal(parseCodepoints("U+1F469 0x200d, 1f4bb"), "👩‍💻");
  equal(parseCodepoints("0000"), "\0");
  equal(codepoints("♥😀"), "U+2665 U+1F600");
  for (const input of [
    "",
    "U+",
    "U+110000",
    "D800",
    "dfff",
    "-1",
    "1F600x",
    "U+12G4",
    "0x0x41",
  ]) {
    throws(() => parseCodepoints(input), input);
  }
  equal(unnamedRecord(0x10ffff, []).name, "<noncharacter>");
  equal(unnamedRecord(0xfdd0, []).name, "<noncharacter>");
  equal(unnamedRecord(0x378, []).category, "Cn");
  equal(words("LATIN CAPITAL letter-A :heart_eyes:"), [
    "latin",
    "capital",
    "letter",
    "a",
    "heart",
    "eyes",
  ]);
});

Deno.test("auto mode keeps ambiguous ASCII names separate from explicit codepoints", () => {
  for (const query of ["U+2665", "0x1F600", "2665", "1f600", "U+oops"])
    equal(detectMode(query), "codepoint");
  for (const query of ["face", "ae", "CCCP", "black heart", "NBSP"])
    equal(detectMode(query), "text");
  for (const query of [":heart:", "&angzarr;", "&angzarr", "&Aacute;"])
    equal(detectMode(query), "name");
  equal(detectMode("angzarr"), "text");
  for (const query of ["'e", "<3", "<Multi_key> <a>", "dead_acute e"])
    equal(detectMode(query), "compose");
  for (const query of ["♥", "👩‍💻", "a", "\u200d", "\u00a0", "  "])
    equal(detectMode(query), "symbol");
});

const data = indexData({
  unicodeData: [
    "0000;<control>;Cc;0;BN;;;;;N;NULL;;;;",
    "0041;LATIN CAPITAL LETTER A;Lu;0;L;;;;;N;;;;0061;",
    "0061;LATIN SMALL LETTER A;Ll;0;L;;;;;N;;;0041;;0041",
    "00A0;NO-BREAK SPACE;Zs;0;CS;<noBreak> 0020;;;;N;;;;;",
    "00E9;LATIN SMALL LETTER E WITH ACUTE;Ll;0;L;0065 0301;;;;N;;;00C9;;00C9",
    "0338;COMBINING LONG SOLIDUS OVERLAY;Mn;1;NSM;;;;;N;;;;;",
    "0ECB;LAO TONE MAI CATAWA;Mn;122;NSM;;;;;N;;;;;",
    "2242;MINUS TILDE;Sm;0;ON;;;;;N;;;;;",
    "237C;RIGHT ANGLE WITH DOWNWARDS ZIGZAG ARROW;So;0;ON;;;;;N;;;;;",
    "2764;HEAVY BLACK HEART;So;0;ON;;;;;N;;;;;",
    "1F408;CAT;So;0;ON;;;;;N;;;;;",
    "1F431;CAT FACE;So;0;ON;;;;;N;;;;;",
    "4E00;<CJK Ideograph, First>;Lo;0;L;;;;;N;;;;;",
    "4E02;<CJK Ideograph, Last>;Lo;0;L;;;;;N;;;;;",
    "A2B6;YI SYLLABLE CAT;Lo;0;L;;;;;N;;;;;",
    "AC00;<Hangul Syllable, First>;Lo;0;L;;;;;N;;;;;",
    "AC01;<Hangul Syllable, Last>;Lo;0;L;;;;;N;;;;;",
    "E000;<Private Use, First>;Co;0;L;;;;;N;;;;;",
    "F8FF;<Private Use, Last>;Co;0;L;;;;;N;;;;;",
  ].join("\n"),
  derivedName:
    "4E00..4E02 ; CJK UNIFIED IDEOGRAPH-*\nAC00 ; HANGUL SYLLABLE GA\nAC01 ; HANGUL SYLLABLE GAG",
  nameAliases: "0000;NULL;control\n0000;NUL;abbreviation\n00A0;NBSP;abbreviation",
  emojiTest: [
    "2764 FE0F ; fully-qualified # ❤️ E0.6 red heart",
    "2764 ; unqualified # ❤ E0.6 red heart",
    "1F1EB 1F1F7 ; fully-qualified # 🇫🇷 E0.6 flag: France",
    "1F1FA 1F1F8 ; fully-qualified # 🇺🇸 E0.6 flag: United States",
    "1F469 1F3FB 200D 1F4BB ; fully-qualified # 👩🏻‍💻 E4.0 woman technologist: light skin tone",
    "1F642 200D 2195 FE0F ; fully-qualified # 🙂‍↕️ E15.1 head shaking vertically",
    "1F642 200D 2195 ; minimally-qualified # 🙂‍↕ E15.1 head shaking vertically",
    "0023 20E3 ; unqualified # #⃣ E0.6 keycap: #",
  ].join("\n"),
  discordEmoji: [
    { surrogates: "❤️", names: ["heart"] },
    { surrogates: "👍", names: ["thumbsup", "+1", "thumbup", "thumbs_up"] },
    { surrogates: "👎", names: ["thumbsdown", "-1", "thumbdown", "thumbs_down"] },
    { surrogates: "🙂", names: ["slight_smile", "slightly_smiling_face"] },
    {
      surrogates: "👩🏻‍💻",
      names: ["woman_technologist_tone1", "woman_technologist_light_skin_tone"],
    },
    { surrogates: "🇺🇸", names: ["flag_us"] },
    { surrogates: "🇫🇷", names: ["flag_fr"] },
    { surrogates: "🐈", names: ["cat2"] },
    { surrogates: "🐱", names: ["cat"] },
  ],
  htmlEntities: {
    "&angzarr;": { characters: "⍼" },
    "&NotEqualTilde;": { characters: "≂̸" },
    "&nesim;": { characters: "≂̸" },
    "&Aacute;": { characters: "Á" },
    "&aacute;": { characters: "á" },
    "&amp": { characters: "&" },
    "&amp;": { characters: "&" },
  },
});
const record = (id: number) => data.pages.get(id >> 8)?.[id];
const manifest: Manifest = {
  unicodeVersion: "test",
  emojiRevision: "test",
  count: data.count,
  ranges: data.ranges,
  pages: [...data.pages.keys()],
  prefixes: [...data.indexes.keys()],
};

Deno.test("index contains algorithmic names, aliases, and properties", () => {
  equal(record(0x4e02)?.name, "CJK UNIFIED IDEOGRAPH-4E02");
  equal(record(0xac01)?.name, "HANGUL SYLLABLE GAG");
  equal(record(0)?.aliases, ["NULL", "NUL"]);
  equal(record(0x41)?.lowercase, "0061");
  equal(record(0xe9)?.decomposition, "0065 0301");
});

Deno.test("Unicode names describe emoji sequences independently of Discord shortcodes", () => {
  for (const [text, name] of [
    ["🇫🇷", "flag: France"],
    ["👩🏻‍💻", "woman technologist: light skin tone"],
    ["🙂‍↕️", "head shaking vertically"],
    ["🙂‍↕", "head shaking vertically"],
    ["#⃣", "keycap: #"],
  ]) {
    equal(record(data.sequences[text])?.name, name);
  }
  equal(data.shortcodes.flag_fr, data.sequences["🇫🇷"]);
  equal(record(0x2764)?.name, "HEAVY BLACK HEART");
  equal(record(data.sequences["🙂‍↕️"])?.shortcodes, undefined);
});

Deno.test("HTML entities share records and preserve multi-codepoint outputs", () => {
  equal(data.entities.angzarr, 0x237c);
  equal(record(0x237c)?.entities, ["&angzarr;"]);
  equal(record(0x26)?.entities, ["&amp;"]);
  const id = data.sequences["≂̸"];
  equal(data.entities.NotEqualTilde, id);
  equal(data.entities.nesim, id);
  equal(record(id)?.name, "MINUS TILDE + COMBINING LONG SOLIDUS OVERLAY");
});

Deno.test(
  "search fetches only relevant shards; reverse lookup preserves sequence components",
  async () => {
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    const fixtures = new Map<string, unknown>([
      ...[...data.pages].map(
        ([id, page]) => [`${asset}/pages/${id.toString(16)}.json`, page] as const,
      ),
      ...[...data.indexes].map(
        ([prefix, index]) => [`${asset}/words/${prefix}.json`, index] as const,
      ),
      [`${asset}/sequences.json`, data.sequences],
      [`${asset}/shortcodes.json`, data.shortcodes],
      [`${asset}/entities.json`, data.entities],
    ]);
    globalThis.fetch = ((path: string) => {
      requests.push(path);
      return Promise.resolve(
        fixtures.has(path)
          ? Response.json(fixtures.get(path))
          : new Response("missing", { status: 404 }),
      );
    }) as typeof fetch;
    try {
      equal(await searchNames("latin cap a", manifest), [0x41]);
      equal(requests, [
        `${asset}/words/la.json`,
        `${asset}/words/ca.json`,
        `${asset}/words/a.json`,
      ]);
      equal(await searchNames("NBSP", manifest), [0xa0]);
      equal(await searchNames("angzarr", manifest), [0x237c]);
      equal(await searchNames("&angzarr;", manifest), [0x237c]);
      equal(await searchNames("&ang", manifest), [0x237c]);
      equal(await searchNames("&Aacute;", manifest), [0xc1]);
      equal(await searchNames("&aacute;", manifest), [0xe1]);
      equal(await searchNames("&doesNotExist;", manifest), []);
      equal(await searchNames("&NotEqualTilde;", manifest), [data.sequences["≂̸"]]);
      equal((await lookupText("≂̸", manifest))[0].entities, ["&NotEqualTilde;", "&nesim;"]);
      const cats = await searchNames("cat", manifest);
      equal(cats, [0xa2b6, 0x1f408, 0x1f431, 0x0ecb]);
      equal(
        rankRecords("cat", await getRecords(cats, manifest)).map(record => record.id),
        [0x1f408, 0x1f431, 0xa2b6, 0x0ecb],
      );
      equal(rankRecords("yi syllable cat", await getRecords(cats, manifest))[0].id, 0xa2b6);
      equal(await searchNames(":cat:", manifest), [0x1f431]);
      equal(await searchNames("lao tone mai cat", manifest), [0x0ecb]);
      equal(await searchNames("latin small", manifest), [0x61, 0xe9]);
      equal(await searchNames("missing term", manifest), []);
      equal(await searchNames(":heart:", manifest), [data.sequences["❤️"]]);
      equal(await searchNames(":+1:", manifest), [0x1f44d]);
      equal(await searchNames(":thumb", manifest), [0x1f44d, 0x1f44e]);
      equal(await searchNames(":slight_smile:", manifest), [0x1f642]);
      equal(await searchNames(":woman_technologist_tone1:", manifest), [data.sequences["👩🏻‍💻"]]);
      equal(await searchNames(":flag_fr:", manifest), [data.sequences["🇫🇷"]]);
      equal(await searchNames("flag France", manifest), [data.sequences["🇫🇷"]]);
      equal((await lookupText("🇫🇷", manifest))[0].name, "flag: France");
      equal(await searchNames(":us:", manifest), []);
      equal((await lookupText("👩🏻‍💻", manifest))[0].shortcodes, [
        "woman_technologist_tone1",
        "woman_technologist_light_skin_tone",
      ]);
      const records = await lookupText("❤️", manifest);
      equal(
        records.map(record => record.text),
        ["❤️", "❤", "️"],
      );
      equal(records[0].shortcodes, ["heart"]);
      equal(
        (await lookupText("ab", manifest)).map(record => record.name),
        ["symbol sequence", "LATIN SMALL LETTER A", "<unassigned>"],
      );
      equal(
        (await getRecords([0xe000, 0x10ffff], manifest)).map(record => record.name),
        ["<Private Use>", "<noncharacter>"],
      );
      const count = requests.length;
      await lookupText("❤️", manifest);
      equal(requests.length, count);
      await fetchJSON("/retry").then(
        () => {
          throw new Error("expected HTTP error");
        },
        error => ok(error.message.includes("404")),
      );
      fixtures.set("/retry", { ok: true });
      equal(await fetchJSON("/retry"), { ok: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);
