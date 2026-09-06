import {
  codepoints,
  detectMode,
  type Manifest,
  parseCodepoints,
  type UnicodeRecord,
} from "./data.ts";
import type { ComposeEntry, ComposeSources, Keysyms } from "./compose.ts";

type SearchMode = "auto" | "compose" | "name" | "codepoint" | "symbol";

const input = (
  <input
    id="query"
    type="text"
    aria-label="Search symbols"
    autocomplete="off"
    spellcheck={false}
    maxLength={256}
    placeholder="Search symbols…"
  />
) as HTMLInputElement;
const status = (<p class="status" role="status" aria-live="polite" />) as HTMLParagraphElement;
const notice = (<p class="notice" role="status" aria-live="polite" />) as HTMLParagraphElement;
const inspector = (
  <section id="inspector" aria-label="Selected character" hidden />
) as HTMLElement;
const results = (<section id="results" aria-label="Search results" />) as HTMLElement;
const warnings = (<details class="warnings" hidden />) as HTMLDetailsElement;
const version = (<span />) as HTMLSpanElement;
const more = (
  <button type="button" hidden>
    show more
  </button>
) as HTMLButtonElement;
let revision = 0;
let timer: ReturnType<typeof setTimeout>;
let selectedText = "";

const unicode = import("./search.ts");
const manifest = unicode.then(({ asset, fetchJSON }) =>
  fetchJSON<Manifest>(`${asset}/manifest.json`),
);
const compose = Promise.all([import("./compose.ts"), unicode]).then(
  async ([parser, { asset, fetchJSON }]) => {
    const [sources, keysyms] = await Promise.all([
      fetchJSON<ComposeSources>("/assets/sources.json"),
      fetchJSON<Keysyms>(`${asset}/keysyms.json`),
    ]);
    const data = await parser.loadCompose(
      sources,
      new URL("/assets/", location.href),
      keysyms,
      async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      },
    );
    const reverse = new Map<string, ComposeEntry[]>();
    for (const entry of data.entries) {
      const entries = reverse.get(entry.text) ?? [];
      entries.push(entry);
      reverse.set(entry.text, entries);
    }
    return { ...data, keysyms, reverse, parser };
  },
);
// A broken Compose source must not prevent Unicode lookups.
const composeReady = compose.catch(error => ({
  entries: [] as ComposeEntry[],
  reverse: new Map<string, ComposeEntry[]>(),
  keysyms: {} as Keysyms,
  warnings: [String(error)],
  parser: undefined,
}));

function glyph(text: string): HTMLElement {
  const invisible = /^[\p{C}\p{Z}]*$/u.test(text);
  return (
    <bdi class={invisible ? "glyph invisible" : "glyph"} dir="auto">
      {invisible ? "invisible" : /^\p{M}/u.test(text) ? `◌${text}` : text}
    </bdi>
  ) as HTMLElement;
}

function inspect(record: UnicodeRecord, data: Awaited<typeof composeReady>) {
  selectedText = record.text;
  const url = new URL(location.href);
  const params = new URLSearchParams(location.hash.slice(1));
  params.set("char", selectedText);
  url.search = "";
  url.hash = params.toString();
  history.replaceState(null, "", url);
  for (const button of results.querySelectorAll<HTMLButtonElement>(".symbol-tile")) {
    button.setAttribute("aria-pressed", String(button.dataset.text === selectedText));
  }
  notice.textContent = "";
  const entries = data.reverse.get(record.text) ?? [];
  const copy = (
    <button class="copy" type="button" aria-label="Copy character" title="Copy character" />
  ) as HTMLButtonElement;
  copy.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="8" y="8" width="12" height="12" rx="2"/>
    <path d="M16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4"/>
  </svg>`;
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(record.text);
      notice.textContent = `Copied ${codepoints(record.text)}.`;
    } catch {
      notice.textContent = "Couldn't access the clipboard. Select the character to copy it.";
    }
  });

  inspector.replaceChildren(
    (
      <div class="character-panel">
        <div
          class={
            Array.from(new Intl.Segmenter().segment(record.text)).length > 1
              ? "character sequence"
              : "character"
          }
        >
          {glyph(record.text)}
          {copy}
        </div>
        {record.category ? (
          <dl class="properties">
            {[
              ["category", record.category],
              ["combining class", String(record.combining)],
              ["bidi class", record.bidi],
              ["decomposition", record.decomposition],
              ["uppercase", record.uppercase && `U+${record.uppercase}`],
              ["lowercase", record.lowercase && `U+${record.lowercase}`],
              ["titlecase", record.titlecase && `U+${record.titlecase}`],
            ]
              .filter(([, value]) => value !== undefined)
              .map(([label, value]) => (
                <>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </>
              ))}
          </dl>
        ) : (
          ""
        )}
      </div>
    ) as HTMLElement,
    (
      <div class="character-data">
        <h1>{record.name}</h1>
        <dl class="identity">
          <dt>codepoint</dt>
          <dd>{codepoints(record.text)}</dd>
          {record.aliases?.length ? (
            <>
              <dt>aliases</dt>
              <dd>{record.aliases.join(", ")}</dd>
            </>
          ) : (
            ""
          )}
          {record.shortcodes?.length ? (
            <>
              <dt>shortcodes</dt>
              <dd>{record.shortcodes.map(name => `:${name}:`).join(", ")}</dd>
            </>
          ) : (
            ""
          )}
          {record.entities?.length ? (
            <>
              <dt>HTML entities</dt>
              <dd>{record.entities.join(", ")}</dd>
            </>
          ) : (
            ""
          )}
        </dl>
        {entries.length ? (
          <section class="compose-sequences" aria-label="XCompose sequences">
            <h2>XCompose sequences ({String(entries.length)})</h2>
            <ul>
              {entries.map(entry => (
                <li>
                  <span class="keys" title={`${entry.source}:${entry.line}`}>
                    {entry.keys.map(key => {
                      const text = data.parser?.keysymText(key, data.keysyms);
                      return (
                        <kbd title={key}>
                          {key === "Multi_key"
                            ? "Compose"
                            : text && !/^[\p{C}\p{Z}\p{M}]+$/u.test(text)
                              ? text
                              : key}
                        </kbd>
                      );
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          ""
        )}
      </div>
    ) as HTMLElement,
  );
  inspector.hidden = false;
}

async function search(mode: SearchMode = "auto", limit = 40) {
  clearTimeout(timer);
  const current = ++revision;
  const raw = input.value;
  const selectedMode = mode === "auto" ? detectMode(raw.trim() || raw) : mode;
  const query = selectedMode === "symbol" ? raw : raw.trim();
  const url = new URL(location.href);
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get("q") !== raw || (params.get("mode") ?? "auto") !== mode) {
    selectedText = "";
    params.delete("char");
  }
  if (raw) params.set("q", raw);
  else params.delete("q");
  if (mode !== "auto") params.set("mode", mode);
  else params.delete("mode");
  url.search = "";
  url.hash = params.toString();
  history.replaceState(null, "", url);
  more.hidden = true;
  notice.textContent = "";
  if (!query) {
    status.textContent = "";
    results.replaceChildren();
    inspector.hidden = true;
    results.removeAttribute("aria-busy");
    return;
  }
  status.textContent = "Searching…";
  results.setAttribute("aria-busy", "true");
  try {
    const [{ getRecords, lookupText, rankRecords, searchNames }, db, composition] =
      await Promise.all([unicode, manifest, composeReady]);
    if (current !== revision) return;
    const groups: { label: string; records: UnicodeRecord[]; total: number }[] = [];
    if (selectedMode === "compose" || selectedMode === "text") {
      const { texts, ignoreCase } = composition.parser?.searchCompose(
        query,
        composition.entries,
        composition.keysyms,
      ) ?? { texts: [], ignoreCase: false };
      const records = await Promise.all(
        texts.slice(0, limit).map(async text => {
          const found = await lookupText(text, db);
          return (
            found.find(record => record.text === text) ?? {
              id: -1,
              text,
              name: "composed sequence",
            }
          );
        }),
      );
      groups.push({
        label: ignoreCase ? "Compose (case-insensitive)" : "Compose",
        records,
        total: texts.length,
      });
    }
    if (selectedMode === "name" || selectedMode === "text") {
      const ids = await searchNames(query, db);
      if (current !== revision) return;
      groups.push({
        label: "names / shortcodes / entities",
        records: rankRecords(query, await getRecords(ids.slice(0, limit), db)),
        total: ids.length,
      });
    }
    if (selectedMode === "codepoint" || selectedMode === "symbol") {
      const text = selectedMode === "codepoint" ? parseCodepoints(query) : query;
      const records = await lookupText(text, db);
      if (Array.from(text).length > 1 && !records.some(record => record.text === text)) {
        records.unshift({ id: -1, text, name: "symbol sequence" });
      }
      groups.push({
        label: "Unicode",
        records: records.slice(0, limit),
        total: records.length,
      });
    }
    if (current !== revision) return;
    const found = groups.filter(group => group.total);
    const records = found.flatMap(group => group.records);
    let selection = records.find(record => record.text === selectedText);
    if (!selection && selectedText && records.length) {
      const selected = await lookupText(selectedText, db);
      selection = selected.find(record => record.text === selectedText) ?? {
        id: -1,
        text: selectedText,
        name: "symbol sequence",
      };
    }
    if (current !== revision) return;
    results.replaceChildren(
      ...found.map(
        group =>
          (
            <div class="result-group">
              <h2>
                {group.label}{" "}
                <span>
                  {group.records.length < group.total ? `${group.records.length} / ` : ""}
                  {group.total.toLocaleString()} results
                </span>
              </h2>
              <div class="symbol-grid">
                {group.records.map(record => {
                  const tile = (
                    <button
                      class="symbol-tile"
                      type="button"
                      title={record.name}
                      aria-label={`${record.name}, ${codepoints(record.text)}`}
                      aria-pressed="false"
                      _onclick={() => {
                        inspect(record, composition);
                        inspector.scrollIntoView({ block: "start" });
                      }}
                    >
                      {glyph(record.text)}
                      <code>{codepoints(record.text)}</code>
                    </button>
                  ) as HTMLButtonElement;
                  tile.dataset.text = record.text;
                  return tile;
                })}
              </div>
            </div>
          ) as HTMLElement,
      ),
    );
    if (records.length) inspect(selection ?? records[0], composition);
    else inspector.hidden = true;
    status.textContent = records.length ? "" : "No matches.";
    results.hidden = records.length <= 1;
    more.hidden = groups.every(group => group.total <= limit);
    more.onclick = () => {
      void search(mode, limit + 40);
    };
  } catch (error) {
    if (current !== revision) return;
    status.textContent = `Could not search: ${error instanceof Error ? error.message : error}`;
  } finally {
    if (current === revision) results.removeAttribute("aria-busy");
  }
}

document.querySelector("main")!.append(
  <header>
    <form id="search">
      {input}
      <button type="submit">search</button>
    </form>
  </header>,
  status,
  notice,
  warnings,
  inspector,
  results,
  more,
  <footer>
    <div class="data-links">
      {version}
      <a href="/assets/sources.json">Compose sources</a>
    </div>
  </footer>,
);

input.addEventListener("input", event => {
  ++revision;
  clearTimeout(timer);
  if (!(event as InputEvent).isComposing) timer = setTimeout(() => void search(), 180);
});
input.addEventListener("compositionend", () => {
  clearTimeout(timer);
  timer = setTimeout(() => void search(), 180);
});
document.querySelector("#search")!.addEventListener("submit", event => {
  event.preventDefault();
  void search();
});
composeReady.then(data => {
  if (!data.warnings.length) return;
  warnings.hidden = false;
  warnings.append(
    <summary>
      {String(data.warnings.length)} Compose source{" "}
      {data.warnings.length === 1 ? "warning" : "warnings"}
    </summary>,
    <pre>{data.warnings.join("\n")}</pre>,
  );
});
manifest
  .then(data => {
    version.textContent = `Unicode ${data.unicodeVersion}`;
  })
  .catch(error => {
    version.textContent = "Unicode data unavailable";
    status.textContent = `Could not load Unicode data: ${error.message}. Run deno task data, then reload.`;
  });
function restoreSearch() {
  const params = new URLSearchParams(location.hash.slice(1));
  input.value = (params.get("q") ?? "🌈").slice(0, 256);
  selectedText = (params.get("char") ?? "").slice(0, 256);
  const mode = params.get("mode");
  void search(
    mode === "compose" || mode === "name" || mode === "codepoint" || mode === "symbol"
      ? mode
      : "auto",
  );
}
addEventListener("hashchange", restoreSearch);
restoreSearch();
input.focus();
