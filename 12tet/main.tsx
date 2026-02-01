import { Signal } from "@char/aftercare";

const calculateFrequency = (
  root: number,
  noteDescriptor: string,
): number | undefined => {
  const match = noteDescriptor.match(
    /([a-gA-G])\s*(#?)(b?)\s*(-?\d+)([+-]\d+)?/,
  );
  if (match == null) return undefined;

  const [_value, note, sharp, flat, octave, cents] = match;
  const dists: { [key: string]: number | undefined } = {
    C: -9,
    D: -7,
    E: -5,
    F: -4,
    G: -2,
    A: 0,
    B: 2,
  };
  let distanceFromA = dists[note.toUpperCase()];
  if (distanceFromA == null) return undefined;
  if (sharp) distanceFromA += 1;
  if (flat) distanceFromA -= 1;
  if (cents) distanceFromA += parseInt(cents) / 100;

  const octaveDistance = parseInt(octave) - 4;
  return root * Math.pow(2, octaveDistance + distanceFromA / 12);
};

const calculateNote = (root: number, frequency: number): string => {
  const distanceFromA = 12 * Math.log2(frequency / root);
  const semis = Math.round(distanceFromA);
  const cents = Math.round((distanceFromA - semis) * 100);
  let octave = 4 + Math.floor(semis / 12);
  const octaveBoundSemis = ((semis % 12) + 12) % 12;
  if (octaveBoundSemis >= 3) octave += 1;
  // prettier-ignore
  const notes = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];
  const note = notes[octaveBoundSemis];

  let centsStr = "";
  if (cents <= -1) {
    // no need for minus here since -n.toString() includes it already
    centsStr = cents.toString().padStart(2, "0");
  } else if (cents >= 1) {
    centsStr = "+" + cents.toString().padStart(2, "0");
  }

  return `${note}${octave}${centsStr}`;
};

const a4 = new Signal(440);
const note = new Signal("C5");
const freq = new Signal(523.251);

note.subscribe((v) => {
  const f = calculateFrequency(a4.get(), v);
  if (f !== undefined) freq.set(f);
});

freq.subscribe((v) => note.set(calculateNote(a4.get(), v)));

const freqStr = freq.derive((f) => f.toFixed(3), Number);
const period = freq.derive((f) => (1000 / f).toFixed(4));

document.querySelector("main")!.append(
  <section>
    if A4 is
    <input id="a4" type="text" value={a4.str(Number)} placeholder="440" /> Hz,
    then
  </section>,
  <section>
    <input id="note" type="text" value={note} placeholder="C5" /> is{" "}
    <input id="freq" type="text" value={freqStr} placeholder="523.251" /> Hz{" "}
    <aside>
      (period: <span id="period">{period}</span> ms)
    </aside>
  </section>,
);
