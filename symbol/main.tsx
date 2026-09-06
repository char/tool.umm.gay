import {
  codepoints,
  detectMode,
  type Manifest,
  type Mode,
  modes,
  parseCodepoints,
  type UnicodeRecord,
} from "./data.ts";
import {
  type ComposeEntry,
  type ComposeSources,
  keysymText,
  type Keysyms,
  loadCompose,
  searchCompose,
} from "./compose.ts";
import {
  asset,
  fetchJSON,
  getRecords,
  lookupText,
  searchNames,
} from "./search.ts";

interface ComposeData {
  entries: ComposeEntry[];
  byText: Map<string, ComposeEntry[]>;
  keysyms: Keysyms;
  warnings: string[];
}

interface Group {
  label: string;
  records: UnicodeRecord[];
  total: number;
}

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

const manifest = fetchJSON<Manifest>(`${asset}/manifest.json`);
const compose: Promise<ComposeData> = (async () => {
  try {
    const [sources, keysyms] = await Promise.all([
      fetchJSON<ComposeSources>("/assets/sources.json"),
      fetchJSON<Keysyms>(`${asset}/keysyms.json`),
    ]);
    const loaded = await loadCompose(
      sources,
      new URL("/assets/", location.href),
      keysyms,
      async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      },
    );
    return { ...loaded, keysyms, byText: Map.groupBy(loaded.entries, entry => entry.text) };
  } catch (error) {
    // A broken Compose source must not prevent Unicode lookups.
    return { entries: [], warnings: [String(error)], keysyms: {}, byText: new Map() };
  }
})();

function updateHash(update: (params: URLSearchParams) => void) {
  const url = new URL(location.href);
  const params = new URLSearchParams(url.hash.slice(1));
  update(params);
  url.hash = params.toString();
  history.replaceState(null, "", url);
}

function glyph(text: string): HTMLElement {
  const invisible = /^[\p{C}\p{Z}]*$/u.test(text);
  return (
    <bdi classList={["glyph", invisible ? "invisible" : undefined]} dir="auto">
      {invisible ? "invisible" : /^\p{M}/u.test(text) ? `◌${text}` : text}
    </bdi>
  ) as HTMLElement;
}

function inspect(record: UnicodeRecord, composition: ComposeData) {
  selectedText = record.text;
  updateHash(params => params.set("char", record.text));
  for (const tile of results.querySelectorAll<HTMLButtonElement>(".symbol-tile")) {
    tile.setAttribute("aria-pressed", String(tile.dataset.text === record.text));
  }
  notice.textContent = "";

  const properties = [
    ["category", record.category],
    ["combining class", String(record.combining)],
    ["bidi class", record.bidi],
    ["decomposition", record.decomposition],
    ["uppercase", record.uppercase && `U+${record.uppercase}`],
    ["lowercase", record.lowercase && `U+${record.lowercase}`],
    ["titlecase", record.titlecase && `U+${record.titlecase}`],
  ].filter(([, value]) => value !== undefined);
  const identity = [
    ["codepoint", codepoints(record.text)],
    ["aliases", record.aliases?.join(", ")],
    ["shortcodes", record.shortcodes?.map(name => `:${name}:`).join(", ")],
    ["HTML entities", record.entities?.join(", ")],
  ].filter(([, value]) => value);
  const sequences = composition.byText.get(record.text) ?? [];
  const graphemes = Array.from(new Intl.Segmenter().segment(record.text)).length;

  inspector.replaceChildren(
    <div class="character-panel">
      <div classList={["character", graphemes > 1 ? "sequence" : undefined]}>
        {glyph(record.text)}
        <button
          class="copy"
          type="button"
          aria-label="Copy character"
          title="Copy character"
          _innerHTML={`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="8" y="8" width="12" height="12" rx="2"/>
            <path d="M16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4"/>
          </svg>`}
          _onclick={async () => {
            try {
              await navigator.clipboard.writeText(record.text);
              notice.textContent = `Copied ${codepoints(record.text)}.`;
            } catch {
              notice.textContent =
                "Couldn't access the clipboard. Select the character to copy it.";
            }
          }}
        />
      </div>
      {record.category ? (
        <dl class="properties">
          {properties.map(([label, value]) => (
            <>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </>
          ))}
        </dl>
      ) : undefined}
    </div>,
    <div class="character-data">
      <h1>{record.name}</h1>
      <dl class="identity">
        {identity.map(([label, value]) => (
          <>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </>
        ))}
      </dl>
      {sequences.length ? (
        <section class="compose-sequences" aria-label="XCompose sequences">
          <h2>XCompose sequences ({String(sequences.length)})</h2>
          <ul>
            {sequences.map(entry => (
              <li>
                <span class="keys" title={`${entry.source}:${entry.line}`}>
                  {entry.keys.map(key => {
                    const text = keysymText(key, composition.keysyms);
                    const printable = text && !/^[\p{C}\p{Z}\p{M}]+$/u.test(text);
                    return (
                      <kbd title={key}>
                        {key === "Multi_key" ? "Compose" : printable ? text : key}
                      </kbd>
                    );
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : undefined}
    </div>,
  );
  inspector.hidden = false;
}

async function findGroups(
  query: string,
  mode: Mode,
  limit: number,
  db: Manifest,
  composition: ComposeData,
): Promise<Group[]> {
  const groups: Group[] = [];
  if (mode === "compose" || mode === "text") {
    const { texts, ignoreCase } = searchCompose(
      query,
      composition.entries,
      composition.keysyms,
    );
    groups.push({
      label: ignoreCase ? "Compose (case-insensitive)" : "Compose",
      records: await Promise.all(
        texts.slice(0, limit).map(async text => (await lookupText(text, db))[0]),
      ),
      total: texts.length,
    });
  }
  if (mode === "name" || mode === "text") {
    const ids = await searchNames(query, db);
    groups.push({
      label: "names / shortcodes / entities",
      records: await getRecords(ids.slice(0, limit), db),
      total: ids.length,
    });
  }
  if (mode === "codepoint" || mode === "symbol") {
    const records = await lookupText(mode === "codepoint" ? parseCodepoints(query) : query, db);
    groups.push({ label: "Unicode", records: records.slice(0, limit), total: records.length });
  }
  return groups.filter(group => group.total);
}

async function search(mode: Mode | "auto" = "auto", limit = 40) {
  clearTimeout(timer);
  const current = ++revision;
  const raw = input.value;
  // Whitespace-only input searches for that whitespace rather than nothing.
  const resolved = mode === "auto" ? detectMode(raw.trim() || raw) : mode;
  const query = resolved === "symbol" ? raw : raw.trim();
  updateHash(params => {
    if (raw) params.set("q", raw);
    else params.delete("q");
    if (mode === "auto") params.delete("mode");
    else params.set("mode", mode);
    if (!selectedText) params.delete("char");
  });
  more.hidden = true;
  notice.textContent = "";
  results.ariaBusy = query ? "true" : null;
  if (!query) {
    status.textContent = "";
    results.replaceChildren();
    inspector.hidden = true;
    return;
  }
  status.textContent = "Searching…";
  try {
    const [db, composition] = await Promise.all([manifest, compose]);
    const groups = await findGroups(query, resolved, limit, db, composition);
    const records = groups.flatMap(group => group.records);
    const selection =
      records.find(record => record.text === selectedText) ??
      (selectedText && records.length ? (await lookupText(selectedText, db))[0] : records[0]);
    if (current !== revision) return;
    results.replaceChildren(
      ...groups.map(group => (
        <div class="result-group">
          <h2>
            {group.label}{" "}
            <span>
              {group.records.length < group.total ? `${group.records.length} / ` : ""}
              {group.total.toLocaleString()} results
            </span>
          </h2>
          <div class="symbol-grid">
            {group.records.map(record => (
              <button
                class="symbol-tile"
                type="button"
                title={record.name}
                aria-label={`${record.name}, ${codepoints(record.text)}`}
                aria-pressed="false"
                dataset={{ text: record.text }}
                _onclick={() => {
                  inspect(record, composition);
                  inspector.scrollIntoView({ block: "start" });
                }}
              >
                {glyph(record.text)}
                <code>{codepoints(record.text)}</code>
              </button>
            ))}
          </div>
        </div>
      )),
    );
    results.hidden = records.length <= 1;
    status.textContent = selection ? "" : "No matches.";
    if (selection) inspect(selection, composition);
    else inspector.hidden = true;
    more.hidden = groups.every(group => group.total <= limit);
    more.onclick = () => void search(mode, limit + 40);
  } catch (error) {
    if (current !== revision) return;
    status.textContent = `Could not search: ${error instanceof Error ? error.message : error}`;
  } finally {
    if (current === revision) results.ariaBusy = null;
  }
}

function restoreSearch() {
  const params = new URLSearchParams(location.hash.slice(1));
  input.value = (params.get("q") ?? "🌈").slice(0, 256);
  selectedText = (params.get("char") ?? "").slice(0, 256);
  const mode = params.get("mode") as Mode | null;
  void search(mode && modes.includes(mode) ? mode : "auto");
}

document.querySelector("main")!.append(
  <header>
    <form
      id="search"
      _onsubmit={event => {
        event.preventDefault();
        void search();
      }}
    >
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

for (const type of ["input", "compositionend"]) {
  input.addEventListener(type, event => {
    ++revision;
    selectedText = "";
    clearTimeout(timer);
    if (!(event as InputEvent).isComposing) timer = setTimeout(() => void search(), 180);
  });
}
compose.then(data => {
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
manifest.then(
  data => {
    version.textContent = `Unicode ${data.unicodeVersion}`;
  },
  error => {
    version.textContent = "Unicode data unavailable";
    status.textContent = `Could not load Unicode data: ${error.message}. Run deno task data, then reload.`;
  },
);
addEventListener("hashchange", restoreSearch);
restoreSearch();
input.focus();
