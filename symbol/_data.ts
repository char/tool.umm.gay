import { indexData, type DiscordEmoji, type HtmlEntities } from "./index-data.ts";

const unicodeVersion = "17.0.0";
const emojiRevision = "d73afea1d61f0af2126ed5badbc0a8af1eaec896";
const xcomposeRevision = "3fb0a8ce54087bddf3d266c7de59d5e524750a6a";
const wincomposeRevision = "0ad0cc51d0a727966ab5b90b6234db02538b43b4";
const libX11 = "https://www.x.org/releases/individual/lib/libX11-1.8.12.tar.xz";
const xorgproto = "https://www.x.org/releases/individual/proto/xorgproto-2024.1.tar.xz";
const ucd = `https://www.unicode.org/Public/${unicodeVersion}`;
const cache = ".cache";
const out = "public/assets/generated";
await Deno.mkdir(cache, { recursive: true });
await Deno.mkdir(`${out}/pages`, { recursive: true });
await Deno.mkdir(`${out}/words`, { recursive: true });
await Deno.mkdir(`${out}/names`, { recursive: true });
await Deno.mkdir(`${out}/licenses`, { recursive: true });

async function download(url: string, name = url.slice(url.lastIndexOf("/") + 1)) {
  const path = `${cache}/${name}`;
  try {
    return await Deno.readFile(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await Deno.writeFile(path, bytes);
  return bytes;
}

const downloadText = async (url: string, name?: string) =>
  new TextDecoder().decode(await download(url, name));

async function archiveFile(url: string, file: string): Promise<string> {
  await download(url);
  const name = url.slice(url.lastIndexOf("/") + 1);
  const result = await new Deno.Command("tar", {
    args: ["-xJOf", `${cache}/${name}`, `${name.replace(/\.tar\.xz$/, "")}/${file}`],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
  return new TextDecoder().decode(result.stdout);
}

const [
  unicodeData,
  derivedName,
  nameAliases,
  emojiTest,
  discordEmoji,
  htmlEntities,
  compose,
  keysymsHeader,
  xcompose,
  wincompose,
] = await Promise.all([
  downloadText(`${ucd}/ucd/UnicodeData.txt`, `UnicodeData-${unicodeVersion}.txt`),
  downloadText(`${ucd}/ucd/extracted/DerivedName.txt`, `DerivedName-${unicodeVersion}.txt`),
  downloadText(`${ucd}/ucd/NameAliases.txt`, `NameAliases-${unicodeVersion}.txt`),
  downloadText(`${ucd}/emoji/emoji-test.txt`, `EmojiTest-${unicodeVersion}.txt`),
  downloadText(
    `https://raw.githubusercontent.com/anyascii/discord-emojis/${emojiRevision}/discord-emojis.json`,
    `discord-emojis-${emojiRevision}.json`,
  ),
  downloadText("https://html.spec.whatwg.org/entities.json"),
  archiveFile(libX11, "nls/en_US.UTF-8/Compose.pre"),
  archiveFile(xorgproto, "include/X11/keysymdef.h"),
  downloadText(
    `https://raw.githubusercontent.com/samhocevar-forks/xcompose/${xcomposeRevision}/dotXCompose`,
    `XCompose-${xcomposeRevision}`,
  ),
  downloadText(
    `https://raw.githubusercontent.com/samhocevar/wincompose/${wincomposeRevision}/src/wincompose/rules/WinCompose.txt`,
    `WinCompose-${wincomposeRevision}`,
  ),
]);

const data = indexData({
  unicodeData,
  derivedName,
  nameAliases,
  emojiTest,
  discordEmoji: (JSON.parse(discordEmoji) as { emojis: DiscordEmoji[] }).emojis,
  htmlEntities: JSON.parse(htmlEntities) as HtmlEntities,
});
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
for (const [shard, index] of data.names) {
  await Deno.writeTextFile(`${out}/names/${shard}.json`, JSON.stringify(index));
}
await Deno.writeTextFile(`${out}/ranking.json`, JSON.stringify(data.ranking));
await Deno.writeTextFile(`${out}/sequences.json`, JSON.stringify(data.sequences));
await Deno.writeTextFile(`${out}/shortcodes.json`, JSON.stringify(data.shortcodes));
await Deno.writeTextFile(`${out}/entities.json`, JSON.stringify(data.entities));
await Deno.writeTextFile(`${out}/keysyms.json`, JSON.stringify(keysyms));
await Deno.writeTextFile(`${out}/Compose.txt`, compose.replace(/^XCOMM/gm, "#"));
await Deno.writeTextFile(`${out}/XCompose.txt`, xcompose);
await Deno.writeTextFile(`${out}/WinCompose.txt`, wincompose);
await Promise.all([
  downloadText("https://www.unicode.org/license.txt", "LICENSE-unicode.txt").then(text =>
    Deno.writeTextFile(`${out}/licenses/unicode.txt`, text),
  ),
  archiveFile(libX11, "COPYING").then(text =>
    Deno.writeTextFile(`${out}/licenses/libX11.txt`, text),
  ),
  archiveFile(xorgproto, "COPYING-x11proto").then(text =>
    Deno.writeTextFile(`${out}/licenses/xorgproto.txt`, text),
  ),
  downloadText(
    `https://raw.githubusercontent.com/samhocevar/wincompose/${wincomposeRevision}/COPYING`,
    "LICENSE-wincompose.txt",
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
