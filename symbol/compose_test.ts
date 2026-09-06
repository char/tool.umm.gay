import { deepStrictEqual as equal, ok, throws } from "node:assert/strict";
import {
  composeQuery,
  keysymText,
  loadCompose,
  matchCompose,
  parseComposeLine,
  searchCompose,
} from "./compose.ts";

const keysyms = {
  apostrophe: "'",
  quotedbl: '"',
  e: "e",
  E: "E",
  a: "a",
  less: "<",
  greater: ">",
  space: " ",
  ae: "æ",
  eacute: "é",
  Greek_alpha: "α",
};

Deno.test("Compose strings, comments, escaped bytes and keysym-only results", () => {
  equal(parseComposeLine('<Multi_key> <apostrophe> <e> : "é" eacute # comment', keysyms), {
    keys: ["Multi_key", "apostrophe", "e"],
    text: "é",
  });
  equal(parseComposeLine(String.raw`<a> : "\304\207\x20\"#:\\" # outside`, keysyms), {
    keys: ["a"],
    text: 'ć "#:\\',
  });
  equal(parseComposeLine("<a> : eacute", keysyms), { keys: ["a"], text: "é" });
  equal(parseComposeLine("<a> : U1F600", keysyms), { keys: ["a"], text: "😀" });
  equal(parseComposeLine(" # comment", keysyms), undefined);
  equal(parseComposeLine(' include "%L" # base', keysyms), { include: "%L" });
  throws(() => parseComposeLine("<a> : unknown_keysym", keysyms));
  throws(() => parseComposeLine('<a> : "unterminated', keysyms));
  throws(() => parseComposeLine('Shift <a> : "A"', keysyms));
  equal(keysymText("U00110000", keysyms), undefined);
  equal(keysymText("UD800", keysyms), undefined);
  equal(keysymText("constructor", keysyms), undefined);
});

Deno.test(
  "Compose queries accept literal keys, keysyms, prefixes, and optional Compose",
  () => {
    const entry = {
      keys: ["Multi_key", "apostrophe", "e"],
      text: "é",
      source: "Compose",
      line: 1,
    };
    for (const query of [
      "'e",
      "apostrophe e",
      "<apostrophe> <e>",
      "<Multi_key> <apostrophe> <e>",
      "Compose apostrophe e",
      "'",
      "<apostrophe>",
    ]) {
      ok(matchCompose(entry, composeQuery(query, keysyms), keysyms), query);
    }
    ok(!matchCompose(entry, composeQuery("'E", keysyms), keysyms));
    ok(!matchCompose(entry, composeQuery("'ee", keysyms), keysyms));
    equal(composeQuery("ae", keysyms), ["a", "e"]);
    equal(composeQuery("<3", keysyms), ["<", "3"]);
    equal(composeQuery("<>", keysyms), ["<", ">"]);
    equal(composeQuery("Greek_alpha", keysyms), ["Greek_alpha"]);
    throws(() => composeQuery("<Multi_key> garbage", keysyms));
    ok(matchCompose({ ...entry, keys: ["dead_acute", "e"] }, ["dead_acute"], keysyms));
    ok(matchCompose({ ...entry, keys: ["Multi_key", "U03B1"] }, ["Greek_alpha"], keysyms));
    const examples = [
      { ...entry, keys: ["Multi_key", "Multi_key", "c", "c", "c", "p"], text: "☭" },
      { ...entry, keys: ["Multi_key", "less", "3"], text: "♥" },
      { ...entry, keys: ["Multi_key", "minus", "greater"], text: "→" },
      { ...entry, keys: ["Multi_key", "asciitilde", "asciitilde"], text: "≈" },
    ];
    const symbols = { ...keysyms, minus: "-", asciitilde: "~" };
    for (const [query, text] of [
      ["CCCP", "☭"],
      ["<3", "♥"],
      ["->", "→"],
      ["~~", "≈"],
    ]) {
      equal(searchCompose(query, examples, symbols).texts, [text]);
    }
    ok(searchCompose("CCCP", examples, symbols).ignoreCase);
    ok(!searchCompose("cccp", examples, symbols).ignoreCase);
    equal(
      searchCompose("<Multi_key> <Multi_key> <C> <C> <C> <P>", examples, symbols).texts,
      [],
    );
  },
);

Deno.test(
  "Compose includes preserve ordering, line numbers, strings, and report failures",
  async () => {
    const files: Record<string, string> = {
      "/assets/base": '# /* not a block comment\n<Multi_key> <a> : "old"\n<e> : "é"\n# */',
      "/assets/custom/main":
        '/* header */\ninclude "%L"\ninclude "extra"\n<Multi_key> <a> : "new"\n<space> : "/* literal */"\n<a> \\\n: "a"\ninclude "../missing"\ninclude "https://elsewhere.test/Compose"\ninclude "%H/.XCompose"\ninvalid',
      "/assets/custom/extra": 'include "main"\n<quotedbl> : "quoted"',
    };
    const reads: string[] = [];
    const data = await loadCompose(
      { compose: ["base", "custom/main"], locale: "base" },
      new URL("https://example.test/assets/"),
      keysyms,
      url => {
        reads.push(url.pathname);
        if (!(url.pathname in files)) return Promise.reject(new Error("missing file"));
        return Promise.resolve(files[url.pathname]);
      },
    );
    equal(
      data.entries.find(entry => entry.keys.join(" ") === "Multi_key a"),
      {
        keys: ["Multi_key", "a"],
        text: "new",
        source: "custom/main",
        line: 4,
      },
    );
    equal(data.entries.find(entry => entry.keys[0] === "space")?.text, "/* literal */");
    equal(data.entries.find(entry => entry.keys[0] === "e")?.text, "é");
    equal(data.entries.find(entry => entry.keys[0] === "a")?.line, 6);
    equal(reads.filter(path => path === "/assets/base").length, 1);
    equal(data.warnings.length, 5);
    ok(data.warnings.some(warning => warning.includes("cycle")));
    ok(data.warnings.some(warning => warning.includes("missing file")));
    ok(!reads.includes("/Compose"));
  },
);
