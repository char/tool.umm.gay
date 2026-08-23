import { Signal } from "@char/aftercare";

type Side = "A" | "B";
type Monitor = Side | "delta";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

const formatTime = (s: number) => {
  s = Math.max(0, s);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s * 100) % 100);
  return `${m}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
};

const describe = (b: AudioBuffer) => {
  const ch =
    b.numberOfChannels === 1
      ? "mono"
      : b.numberOfChannels === 2
        ? "stereo"
        : `${b.numberOfChannels}ch`;
  const khz = Math.round((b.sampleRate / 1000) * 10) / 10;
  return `${formatTime(b.duration)} · ${ch} · ${khz} kHz · ${b.length} frames`;
};

const isAudioFile = (f: File) =>
  f.type.startsWith("audio/") ||
  /\.(wav|mp3|flac|ogg|oga|opus|m4a|mp4|aac|webm|aiff?|caf)$/i.test(f.name);

// one shared clock: both versions decode to and play through this context, so
// they cannot drift relative to each other. a single worklet mixes them
// (out = gainA·A + gainB·B) so the delta is a true sample-accurate A − B
// rather than relying on the destination to sum oppositely-signed gains.
const ctx = new AudioContext();

let mixer: AudioWorkletNode | null = null;
let gainParam: Record<Side, AudioParam> | null = null;
const workletReady = new Signal(false);

ctx.audioWorklet
  .addModule("/mixer.js")
  .then(() => {
    mixer = new AudioWorkletNode(ctx, "ab-mixer", {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    mixer.connect(ctx.destination);
    gainParam = {
      A: mixer.parameters.get("gainA")!,
      B: mixer.parameters.get("gainB")!,
    };
    workletReady.set(true);
    applyGains();
    validate();
  })
  .catch(() => status.set("could not initialize the audio mixer worklet"));

const buffer: Record<Side, Signal<AudioBuffer | null>> = {
  A: new Signal<AudioBuffer | null>(null),
  B: new Signal<AudioBuffer | null>(null),
};
const name: Record<Side, Signal<string>> = {
  A: new Signal(""),
  B: new Signal(""),
};

const selected = new Signal<Monitor>("A");
const volume = new Signal(1);
const trimDb: Record<Side, Signal<number>> = {
  A: new Signal(0),
  B: new Signal(0),
};
const playing = new Signal(false);
const ready = new Signal(false);
const status = new Signal("");
const position = new Signal(0);
const durationSig = new Signal(0);

// ── playback engine (mutable audio-graph state, deliberately outside signals) ──

const source: Record<Side, AudioBufferSourceNode | null> = { A: null, B: null };
let startTime = 0; // ctx.currentTime at which the running sources were scheduled
let startOffset = 0; // buffer offset the sources started from
let pausedAt = 0; // authoritative position while not playing
let generation = 0; // invalidates async work and handlers from superseded sources
let animationFrame = 0;

// comparison length is the shorter of the two; the longer file is truncated
const duration = () => {
  const a = buffer.A.get();
  const b = buffer.B.get();
  if (!a || !b) return 0;
  return Math.min(a.duration, b.duration);
};

const currentPosition = () => {
  if (playing.get() && source.A) {
    return clamp(
      Math.max(startOffset, startOffset + ctx.currentTime - startTime),
      0,
      duration(),
    );
  }
  return pausedAt;
};

const stopSources = () => {
  generation++;
  for (const side of ["A", "B"] as Side[]) {
    const s = source[side];
    if (s) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // already stopped / never started
      }
      s.disconnect();
      source[side] = null;
    }
  }
};

const stopAnimation = () => {
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
};

const onNaturalEnd = () => {
  stopSources();
  stopAnimation();
  pausedAt = 0;
  playing.set(false);
  position.set(0);
};

const startSources = (offset: number) => {
  const a = buffer.A.get();
  const b = buffer.B.get();
  if (!a || !b || !mixer) return;
  stopSources();
  const g = generation;
  const when = ctx.currentTime + 0.02; // tiny shared lead so both begin on the same tick
  for (const [side, buf] of [
    ["A", a],
    ["B", b],
  ] as [Side, AudioBuffer][]) {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.connect(mixer!, 0, side === "A" ? 0 : 1);
    s.start(when, offset, duration() - offset); // stop both at the shorter length
    source[side] = s;
  }
  source.A!.onended = () => {
    if (generation === g) onNaturalEnd();
  };
  startTime = when;
  startOffset = offset;
};

const tick = () => {
  if (!playing.get()) return;
  position.set(currentPosition());
  animationFrame = requestAnimationFrame(tick);
};

const play = async () => {
  if (!ready.get()) return;
  const g = generation;
  try {
    await ctx.resume();
  } catch {
    status.set("could not start audio playback");
    return;
  }
  if (!ready.get() || playing.get() || generation !== g) return;
  status.set("");
  pausedAt = pausedAt >= duration() ? 0 : pausedAt;
  startSources(pausedAt);
  playing.set(true);
  stopAnimation();
  tick();
};

const pause = () => {
  pausedAt = currentPosition();
  stopSources();
  stopAnimation();
  playing.set(false);
  position.set(pausedAt);
};

const toggle = () => (playing.get() ? pause() : void play());

const seek = (pos: number) => {
  const clamped = clamp(pos, 0, duration());
  pausedAt = clamped;
  position.set(clamped);
  if (playing.get()) {
    if (clamped >= duration()) onNaturalEnd();
    else startSources(clamped);
  }
};

const applyGains = () => {
  if (!gainParam) return;
  const monitor = selected.get();
  const master = volume.get();
  const t = ctx.currentTime;
  const ramp = 0.005; // short enough not to read as a crossfade, long enough to avoid clicks
  for (const side of ["A", "B"] as Side[]) {
    const polarity =
      monitor === "delta" ? (side === "A" ? 1 : -1) : monitor === side ? 1 : 0;
    const target = polarity * master * 10 ** (trimDb[side].get() / 20);
    const p = gainParam[side];
    const current = p.value;
    p.cancelScheduledValues(t);
    p.setValueAtTime(current, t);
    p.linearRampToValueAtTime(target, t + ramp);
  }
};

const select = (monitor: Monitor) => {
  selected.set(monitor);
  applyGains();
};

const resetTransport = () => {
  stopSources();
  stopAnimation();
  pausedAt = 0;
  playing.set(false);
  position.set(0);
};

const loadState: Record<Side, { loading: boolean; error: string }> = {
  A: { loading: false, error: "" },
  B: { loading: false, error: "" },
};

const validate = () => {
  const a = buffer.A.get();
  const b = buffer.B.get();
  durationSig.set(duration());
  ready.set(false);

  const loadingSide = (["A", "B"] as Side[]).find(side => loadState[side].loading);
  if (loadingSide) {
    status.set(`decoding "${name[loadingSide].get()}"…`);
    return;
  }
  const failedSide = (["A", "B"] as Side[]).find(side => loadState[side].error);
  if (failedSide) {
    status.set(loadState[failedSide].error);
    return;
  }
  if (!a || !b) {
    status.set(a || b ? "load both files to compare" : "");
    return;
  }
  if (!workletReady.get()) {
    status.set("initializing audio…");
    return;
  }
  ready.set(true);
  status.set(
    a.length === b.length
      ? ""
      : `different lengths — comparing the first ${formatTime(duration())}`,
  );
};

// guards against a slow decode landing after a newer selection on the same side
const decodeSeq: Record<Side, number> = { A: 0, B: 0 };

const loadFile = async (side: Side, file: File) => {
  const seq = ++decodeSeq[side];
  resetTransport();
  buffer[side].set(null);
  name[side].set(file.name);
  loadState[side] = { loading: true, error: "" };
  validate();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    if (seq !== decodeSeq[side]) return;
    loadState[side].loading = false;
    buffer[side].set(decoded);
    validate();
  } catch {
    if (seq !== decodeSeq[side]) return;
    loadState[side] = {
      loading: false,
      error: `could not decode "${file.name}" — is it an audio file this browser supports?`,
    };
    validate();
  }
};

// ── ui ──

const ioCard = (side: Side) => {
  const input = (<input type="file" accept="audio/*" />) as HTMLInputElement;
  input.addEventListener("change", () => {
    const f = input.files?.[0];
    if (f) loadFile(side, f);
  });

  const trim = (
    <input
      type="range"
      min="-12"
      max="12"
      step="0.1"
      value="0"
      aria-label={`${side} gain trim`}
    />
  ) as HTMLInputElement;
  trim.addEventListener("input", () => {
    trimDb[side].set(trim.valueAsNumber);
    applyGains();
  });

  const card = (
    <div class="io-card">
      <div class="io-head">
        <span class="side-badge">{side}</span>
        <span class="io-name">{name[side].derive(n => n || "no file")}</span>
      </div>
      {input}
      <span class="io-meta">{buffer[side].derive(b => (b ? describe(b) : ""))}</span>
      <label class="level-control">
        <span>trim</span>
        {trim}
        <output>
          {trimDb[side].derive(db => `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`)}
        </output>
      </label>
    </div>
  ) as HTMLElement;

  card.addEventListener("dragenter", e => {
    e.preventDefault();
    card.classList.add("drag-over");
  });
  card.addEventListener("dragover", e => e.preventDefault());
  card.addEventListener("dragleave", e => {
    if (!card.contains(e.relatedTarget as Node)) {
      card.classList.remove("drag-over");
    }
  });
  card.addEventListener("drop", e => {
    e.preventDefault();
    e.stopPropagation();
    card.classList.remove("drag-over");
    document.body.classList.remove("drag-over");
    const files = Array.from(e.dataTransfer?.files ?? []);
    const file = files.find(isAudioFile) ?? files[0];
    if (file) loadFile(side, file);
  });

  return card;
};

const selBtn = (monitor: Monitor, label: string, title?: string) =>
  (
    <button type="button" class="sel-btn" title={title} _onclick={() => select(monitor)}>
      {label}
    </button>
  ) as HTMLButtonElement;

const selA = selBtn("A", "A");
const selB = selBtn("B", "B");
const selDelta = selBtn("delta", "Δ", "delta: A − B");

const playBtn = (
  <button type="button" class="play-btn" _onclick={toggle}>
    {playing.derive(p => (p ? "❚❚ pause" : "▶ play"))}
  </button>
) as HTMLButtonElement;

const slider = (
  <input type="range" min="0" max="1" step="0.0001" value="0" class="scrub" />
) as HTMLInputElement;

let seeking = false;
slider.addEventListener("input", () => {
  seeking = true;
  seek(parseFloat(slider.value) * duration());
});
slider.addEventListener("change", () => {
  seeking = false;
});

// keep the slider following playback, but yield to the user while they drag
position.subscribe(p => {
  if (!seeking) {
    const d = duration();
    slider.value = String(d > 0 ? p / d : 0);
  }
});

ready.subscribe(r => {
  playBtn.disabled = !r;
  selA.disabled = !r;
  selB.disabled = !r;
  selDelta.disabled = !r;
  slider.disabled = !r;
});
selA.disabled = selB.disabled = selDelta.disabled = playBtn.disabled = slider.disabled = true;

selected.subscribe(s => {
  for (const [monitor, button] of [
    ["A", selA],
    ["B", selB],
    ["delta", selDelta],
  ] as [Monitor, HTMLButtonElement][]) {
    button.classList.toggle("active", s === monitor);
    button.setAttribute("aria-pressed", String(s === monitor));
  }
});
selA.classList.add("active");
selA.setAttribute("aria-pressed", "true");
selB.setAttribute("aria-pressed", "false");
selDelta.setAttribute("aria-pressed", "false");

const volumeSlider = (
  <input
    type="range"
    min="0"
    max="1"
    step="0.01"
    value="1"
    aria-label="global volume"
  />
) as HTMLInputElement;
volumeSlider.addEventListener("input", () => {
  volume.set(volumeSlider.valueAsNumber);
  applyGains();
});

const transport = (
  <section id="transport">
    <label class="level-control global-volume">
      <span>volume</span>
      {volumeSlider}
      <output>{volume.derive(v => `${Math.round(v * 100)}%`)}</output>
    </label>
    <div class="ab-switch">
      <span class="ab-label">monitoring</span>
      {selA}
      {selB}
      {selDelta}
    </div>
    <div class="scrub-row">
      {playBtn}
      {slider}
      <span class="time">
        {position.derive(formatTime)} / {durationSig.derive(formatTime)}
      </span>
    </div>
    <p class="status">{status}</p>
  </section>
);

// ── whole-page drop: fill empty sides first, else replace from A ──

const assignDropped = (files: ArrayLike<File>) => {
  const dropped = Array.from(files);
  const recognized = dropped.filter(isAudioFile);
  const audio = recognized.length ? recognized : dropped;
  if (!audio.length) return;
  const order: Side[] = [];
  if (!buffer.A.get()) order.push("A");
  if (!buffer.B.get()) order.push("B");
  if (!order.length) order.push("A", "B");
  order.forEach((side, i) => {
    if (audio[i]) loadFile(side, audio[i]);
  });
};

document.body.dataset.dropLabel = "drop audio files here";
document.addEventListener("dragenter", e => {
  e.preventDefault();
  document.body.classList.add("drag-over");
});
document.addEventListener("dragleave", e => {
  if (!e.relatedTarget) document.body.classList.remove("drag-over");
});
document.addEventListener("dragover", e => e.preventDefault());
document.addEventListener("drop", e => {
  e.preventDefault();
  document.body.classList.remove("drag-over");
  assignDropped(e.dataTransfer?.files ?? []);
});

document.addEventListener("keydown", e => {
  if (
    (e.key === " " && e.target instanceof HTMLButtonElement) ||
    (e.target instanceof HTMLInputElement && e.target !== slider)
  ) {
    return;
  }
  if (e.key === " ") {
    e.preventDefault();
    toggle();
  } else if (e.key === "ArrowLeft" && e.target !== slider) {
    e.preventDefault();
    seek(currentPosition() - 5);
  } else if (e.key === "ArrowRight" && e.target !== slider) {
    e.preventDefault();
    seek(currentPosition() + 5);
  } else if ((e.key === "a" || e.key === "A") && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (ready.get()) select("A");
  } else if ((e.key === "b" || e.key === "B") && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (ready.get()) select("B");
  } else if ((e.key === "d" || e.key === "D") && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (ready.get()) select("delta");
  }
});

document.querySelector("main")!.append(
  <h1>audio A/B compare</h1>,
  <section id="io">
    {ioCard("A")}
    {ioCard("B")}
  </section>,
  transport,
);
