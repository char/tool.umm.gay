import { indexData, type DiscordEmoji, type HtmlEntities } from "./index-data.ts";

const unicodeVersion = "17.0.0";
const emojiRevision = "d73afea1d61f0af2126ed5badbc0a8af1eaec896";
const xcomposeRevision = "3fb0a8ce54087bddf3d266c7de59d5e524750a6a";
const wincomposeRevision = "0ad0cc51d0a727966ab5b90b6234db02538b43b4";
const cache = ".cache";
const out = "public/assets/generated";
await Deno.mkdir(cache, { recursive: true });
await Deno.mkdir(`${out}/pages`, { recursive: true });
await Deno.mkdir(`${out}/words`, { recursive: true });
await Deno.mkdir(`${out}/licenses`, { recursive: true });

async function download(url: string, path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const text = await response.text();
  await Deno.writeTextFile(path, text);
  return text;
}

async function archiveFile(project: string, version: string, file: string): Promise<string> {
  const archive = `${cache}/${project}-${version}.tar.xz`;
  try {
    await Deno.stat(archive);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    const section = project === "libX11" ? "lib" : "proto";
    const url = `https://www.x.org/releases/individual/${section}/${project}-${version}.tar.xz`;
    console.log(`Downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    await Deno.writeFile(archive, new Uint8Array(await response.arrayBuffer()));
  }
  const result = await new Deno.Command("tar", {
    args: ["-xJOf", archive, `${project}-${version}/${file}`],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
  return new TextDecoder().decode(result.stdout);
}

const [
  unicode,
  names,
  aliases,
  emoji,
  compose,
  keysymsHeader,
  xcompose,
  wincompose,
  emojiTest,
  htmlEntities,
] = await Promise.all([
  download(
    `https://www.unicode.org/Public/${unicodeVersion}/ucd/UnicodeData.txt`,
    `${cache}/UnicodeData-${unicodeVersion}.txt`,
  ),
  download(
    `https://www.unicode.org/Public/${unicodeVersion}/ucd/extracted/DerivedName.txt`,
    `${cache}/DerivedName-${unicodeVersion}.txt`,
  ),
  download(
    `https://www.unicode.org/Public/${unicodeVersion}/ucd/NameAliases.txt`,
    `${cache}/NameAliases-${unicodeVersion}.txt`,
  ),
  download(
    `https://raw.githubusercontent.com/anyascii/discord-emojis/${emojiRevision}/discord-emojis.json`,
    `${cache}/discord-emojis-${emojiRevision}.json`,
  ),
  archiveFile("libX11", "1.8.12", "nls/en_US.UTF-8/Compose.pre"),
  archiveFile("xorgproto", "2024.1", "include/X11/keysymdef.h"),
  download(
    `https://raw.githubusercontent.com/samhocevar-forks/xcompose/${xcomposeRevision}/dotXCompose`,
    `${cache}/XCompose-${xcomposeRevision}`,
  ),
  download(
    `https://raw.githubusercontent.com/samhocevar/wincompose/${wincomposeRevision}/src/wincompose/rules/WinCompose.txt`,
    `${cache}/WinCompose-${wincomposeRevision}`,
  ),
  download(
    `https://www.unicode.org/Public/${unicodeVersion}/emoji/emoji-test.txt`,
    `${cache}/EmojiTest-${unicodeVersion}.txt`,
  ),
  download("https://html.spec.whatwg.org/entities.json", `${cache}/entities.json`),
]);

const discord = JSON.parse(emoji) as { emojis: DiscordEmoji[] };
const data = indexData(
  unicode,
  names,
  aliases,
  discord.emojis,
  emojiTest,
  JSON.parse(htmlEntities) as HtmlEntities,
);
const keysyms: Record<string, string> = {};
for (const match of keysymsHeader.matchAll(
  /^#define XK_(\w+)\s+0x[0-9a-fA-F]+\s+\/\*\s*\(?U\+([0-9A-Fa-f]+)/gm,
)) {
  keysyms[match[1]] = String.fromCodePoint(parseInt(match[2], 16));
}

for (const [id, page] of data.pages) {
  await Deno.writeTextFile(`${out}/pages/${id.toString(16)}.json`, JSON.stringify(page));
}
for (const [prefix, index] of data.indexes) {
  await Deno.writeTextFile(`${out}/words/${prefix}.json`, JSON.stringify(index));
}
await Deno.writeTextFile(`${out}/sequences.json`, JSON.stringify(data.sequences));
await Deno.writeTextFile(`${out}/shortcodes.json`, JSON.stringify(data.shortcodes));
await Deno.writeTextFile(`${out}/entities.json`, JSON.stringify(data.entities));
await Deno.writeTextFile(`${out}/keysyms.json`, JSON.stringify(keysyms));
await Deno.writeTextFile(`${out}/Compose`, compose.replace(/^XCOMM/gm, "#"));
await Deno.writeTextFile(`${out}/XCompose`, xcompose);
await Deno.writeTextFile(`${out}/WinCompose`, wincompose);
await Promise.all([
  download("https://www.unicode.org/license.txt", `${cache}/LICENSE-unicode.txt`).then(text =>
    Deno.writeTextFile(`${out}/licenses/unicode.txt`, text),
  ),
  archiveFile("libX11", "1.8.12", "COPYING").then(text =>
    Deno.writeTextFile(`${out}/licenses/libX11.txt`, text),
  ),
  archiveFile("xorgproto", "2024.1", "COPYING-x11proto").then(text =>
    Deno.writeTextFile(`${out}/licenses/xorgproto.txt`, text),
  ),
  download(
    `https://raw.githubusercontent.com/samhocevar/wincompose/${wincomposeRevision}/COPYING`,
    `${cache}/LICENSE-wincompose.txt`,
  ).then(text => Deno.writeTextFile(`${out}/licenses/wincompose.txt`, text)),
]);
await Deno.writeTextFile(
  `${out}/manifest.json`,
  JSON.stringify({
    unicodeVersion,
    emojiRevision,
    count: data.count,
    prefixes: [...data.indexes.keys()],
    pages: [...data.pages.keys()],
    ranges: data.ranges,
  }),
);
console.log(
  `Indexed ${data.count} records in ${data.pages.size} pages and ${data.indexes.size} word shards.`,
);
