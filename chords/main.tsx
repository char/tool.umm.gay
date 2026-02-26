import { Signal } from "@char/aftercare";

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const transposeRoot = (root: string, n: number): string => {
  const scale = root.includes("b") ? FLATS : SHARPS;
  const idx = scale.indexOf(root);
  if (idx === -1) return root;
  return scale[(((idx + n) % 12) + 12) % 12];
};

const transposeChord = (chord: string, n: number): string => {
  if (n === 0) return chord;
  const match = chord.match(/^([A-G][b#]?)(.*)/);
  if (!match) return chord;
  return transposeRoot(match[1], n) + match[2];
};

const isChord = (token: string): boolean => /^[A-G][b#]?/.test(token);

const text = new Signal("");
const semitones = new Signal(0);

const renderChordLine = (line: string): Node[] => {
  const tokens = line.split(/(\s+)/);
  const st = semitones.get();
  return tokens.map((tok) =>
    isChord(tok) ? (
      <span class="chord-wrap">
        <span class="chord">
          {tok
            .split("/")
            .map((r) => transposeChord(r, st))
            .join("/")}
        </span>
        {tok}
      </span>
    ) : (
      document.createTextNode(tok)
    ),
  );
};

const backdrop = (<div class="editor-backdrop" aria-hidden="true" />) as HTMLElement;

const updateBackdrop = () => {
  const lines = text.get().split("\n");
  const nodes: Node[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) nodes.push(document.createTextNode("\n"));

    if (i % 2 === 0) {
      nodes.push(...renderChordLine(lines[i]));
    } else {
      nodes.push(document.createTextNode(lines[i]));
    }
  }

  // force the browser to render any trailing newlines. lol
  nodes.push(document.createTextNode("\u200b"));

  backdrop.replaceChildren(...nodes);
};

text.subscribe(updateBackdrop);
semitones.subscribe(updateBackdrop);

const textarea = (
  <textarea id="input" spellcheck={false} autocomplete="off" autocorrect={false} value={text} />
) as HTMLTextAreaElement;

textarea.addEventListener("scroll", () => {
  backdrop.scrollTop = textarea.scrollTop;
});

const semitonesInput = (
  <input
    id="semitones"
    type="number"
    min="-11"
    max="11"
    value={semitones.str(Number)}
    placeholder="0"
  />
);

document.querySelector("main")!.append(
  <section>transpose by {semitonesInput} semitones:</section>,
  <div class="editor">
    {backdrop}
    {textarea}
  </div>,
);

updateBackdrop();
