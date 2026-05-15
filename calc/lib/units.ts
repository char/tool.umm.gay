export type DimKey = "len" | "mass" | "time" | "curr" | "temp" | "mol" | "lum" | "byte";

export type Dim = Readonly<Partial<Record<DimKey, number>>>;

const DIM_KEYS: DimKey[] = ["len", "mass", "time", "curr", "temp", "mol", "lum", "byte"];

export const SCALAR: Dim = Object.freeze({});

export const dimMul = (a: Dim, b: Dim): Dim => zip(a, b, (x, y) => x + y);
export const dimDiv = (a: Dim, b: Dim): Dim => zip(a, b, (x, y) => x - y);
export const dimPow = (a: Dim, n: number): Dim => zip(a, {}, x => x * n);

export const dimEq = (a: Dim, b: Dim): boolean => {
  for (const k of DIM_KEYS) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
};

export const dimIsScalar = (d: Dim): boolean => {
  for (const k of DIM_KEYS) if ((d[k] ?? 0) !== 0) return false;
  return true;
};

export function describeDim(d: Dim): string {
  const entries = DIM_KEYS.map(k => [k, d[k] ?? 0] as const).filter(([, e]) => e !== 0);
  if (entries.length === 0) return "scalar";
  const num = entries.filter(([, e]) => e > 0);
  const den = entries.filter(([, e]) => e < 0);
  const fmt = (es: readonly (readonly [DimKey, number])[], abs: boolean) =>
    es
      .map(([k, e]) => {
        const ee = abs ? Math.abs(e) : e;
        return ee === 1 ? k : `${k}^${ee}`;
      })
      .join("·");
  if (num.length === 0) return fmt(den, false);
  if (den.length === 0) return fmt(num, false);
  return `${fmt(num, false)}/${fmt(den, true)}`;
}

function zip(a: Dim, b: Dim, f: (x: number, y: number) => number): Dim {
  const r: Partial<Record<DimKey, number>> = {};
  for (const k of DIM_KEYS) {
    const v = f(a[k] ?? 0, b[k] ?? 0);
    if (v !== 0) r[k] = v;
  }
  return r;
}

// preferred derived-unit symbols, in priority order. used when assembling a
// display from a multi-unit expression whose net dim happens to coincide with
// a named derived quantity (e.g. A·V → W, N·m → J).
export const AUTOCOERCE_UNITS: { sym: string; dim: Dim }[] = [
  { sym: "N", dim: { len: 1, mass: 1, time: -2 } },
  { sym: "J", dim: { len: 2, mass: 1, time: -2 } },
  { sym: "W", dim: { len: 2, mass: 1, time: -3 } },
  { sym: "Pa", dim: { len: -1, mass: 1, time: -2 } },
  { sym: "V", dim: { len: 2, mass: 1, time: -3, curr: -1 } },
  { sym: "C", dim: { time: 1, curr: 1 } },
  { sym: "Hz", dim: { time: -1 } },
  // symmetric to Hz: lets `1 / 10 Hz` collapse to seconds instead of `Hz⁻¹`.
  // guarded against rewriting plain `5 min` → `300 s` by the isUserNamed check
  // in chooseDisplay.
  { sym: "s", dim: { time: 1 } },
];

export const BASE_UNIT: Record<DimKey, string> = {
  len: "m",
  mass: "kg",
  time: "s",
  curr: "A",
  temp: "K",
  mol: "mol",
  lum: "cd",
  byte: "byte",
};

export interface UnitDef {
  dim: Dim;
  factor: number;
}

// im mostly stealing these from numbat
export const UNITS: Record<string, UnitDef> = {
  // lengths
  m: { dim: { len: 1 }, factor: 1 },
  inch: { dim: { len: 1 }, factor: 0.0254 },
  ft: { dim: { len: 1 }, factor: 0.3048 },
  yd: { dim: { len: 1 }, factor: 0.9144 },
  mi: { dim: { len: 1 }, factor: 1609.344 },
  AU: { dim: { len: 1 }, factor: 1.495978707e11 },
  ly: { dim: { len: 1 }, factor: 9.4607304725808e15 },
  pc: { dim: { len: 1 }, factor: 3.0856775814913673e16 },

  // time
  s: { dim: { time: 1 }, factor: 1 },
  min: { dim: { time: 1 }, factor: 60 },
  h: { dim: { time: 1 }, factor: 3600 },
  hr: { dim: { time: 1 }, factor: 3600 },
  day: { dim: { time: 1 }, factor: 86400 },
  week: { dim: { time: 1 }, factor: 86400 * 7 },
  year: { dim: { time: 1 }, factor: 86400 * 365.25 },

  // mass
  kg: { dim: { mass: 1 }, factor: 1 },
  g: { dim: { mass: 1 }, factor: 1e-3 },
  lb: { dim: { mass: 1 }, factor: 0.45359237 },
  oz: { dim: { mass: 1 }, factor: 0.0283495231 },
  t: { dim: { mass: 1 }, factor: 1000 },

  // current
  A: { dim: { curr: 1 }, factor: 1 },
  // temperature
  K: { dim: { temp: 1 }, factor: 1 },
  // amount of substance
  mol: { dim: { mol: 1 }, factor: 1 },
  // luminous intensity
  cd: { dim: { lum: 1 }, factor: 1 },

  // information - base is byte
  byte: { dim: { byte: 1 }, factor: 1 },
  bit: { dim: { byte: 1 }, factor: 0.125 },
  bps: { dim: { byte: 1, time: -1 }, factor: 0.125 },

  // volume
  L: { dim: { len: 3 }, factor: 1e-3 },
  l: { dim: { len: 3 }, factor: 1e-3 },
  gal: { dim: { len: 3 }, factor: 0.003785411784 },

  // pressure
  bar: { dim: { len: -1, mass: 1, time: -2 }, factor: 1e5 },
  atm: { dim: { len: -1, mass: 1, time: -2 }, factor: 101325 },
  psi: { dim: { len: -1, mass: 1, time: -2 }, factor: 6894.757293168361 },

  // energy
  eV: { dim: { len: 2, mass: 1, time: -2 }, factor: 1.602176634e-19 },
  cal: { dim: { len: 2, mass: 1, time: -2 }, factor: 4.184 },

  // common shorthands
  mph: { dim: { len: 1, time: -1 }, factor: 1609.344 / 3600 },
  kph: { dim: { len: 1, time: -1 }, factor: 1000 / 3600 },
  sqft: { dim: { len: 2 }, factor: 0.3048 ** 2 },
  Wh: { dim: { len: 2, mass: 1, time: -2 }, factor: 3600 },
  kWh: { dim: { len: 2, mass: 1, time: -2 }, factor: 3.6e6 },
  Ah: { dim: { time: 1, curr: 1 }, factor: 3600 },
  Nm: { dim: { len: 2, mass: 1, time: -2 }, factor: 1 },

  // derived units
  Hz: { dim: { time: -1 }, factor: 1 },
  N: { dim: { len: 1, mass: 1, time: -2 }, factor: 1 },
  J: { dim: { len: 2, mass: 1, time: -2 }, factor: 1 },
  W: { dim: { len: 2, mass: 1, time: -3 }, factor: 1 },
  Pa: { dim: { len: -1, mass: 1, time: -2 }, factor: 1 },
  V: { dim: { len: 2, mass: 1, time: -3, curr: -1 }, factor: 1 },
  C: { dim: { time: 1, curr: 1 }, factor: 1 },
  nit: { dim: { lum: 1, len: -2 }, factor: 1 },

  // angle (TODO: should this really be scalar?)
  rad: { dim: {}, factor: 1 },
  deg: { dim: {}, factor: Math.PI / 180 },
};

const _aliases: Record<string, string[]> = {
  m: ["meter", "meters", "metre", "metres"],
  inch: ["inches"],
  ft: ["foot", "feet"],
  yd: ["yard", "yards"],
  mi: ["mile", "miles"],

  s: ["second", "seconds", "sec", "secs"],
  min: ["minute", "minutes", "mins"],
  h: ["hour", "hours"],
  day: ["days"],
  week: ["weeks"],
  year: ["years", "yr", "yrs"],

  g: ["gram", "grams"],
  kg: ["kilogram", "kilograms"],
  lb: ["pound", "pounds", "lbs"],
  oz: ["ounce", "ounces"],
  t: ["tonne", "tonnes", "ton"],

  byte: ["bytes", "B", "octet", "octets", "Byte"],
  bit: ["bits", "Bit"],

  A: ["ampere", "amperes", "amp", "amps"],
  K: ["kelvin", "kelvins"],
  mol: ["mole", "moles"],
  cd: ["candela"],

  Hz: ["hertz"],
  N: ["newton", "newtons"],
  J: ["joule", "joules"],
  W: ["watt", "watts"],
  Pa: ["pascal", "pascals"],
  V: ["volt", "volts"],
  C: ["coulomb", "coulombs"],

  L: ["liter", "liters", "litre", "litres"],
  gal: ["gallon", "gallons"],

  // "ah" would otherwise prefix-decompose to atto-hour (rare!) instead of amp-hour
  Ah: ["ah"],

  deg: ["°", "degree", "degrees"],
  rad: ["radian", "radians"],
};

export const ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(_aliases).flatMap(([canonical, names]) =>
    names.map(name => [name, canonical] as const),
  ),
);

export const PREFIXES: Record<string, number> = {
  Y: 1e24,
  Z: 1e21,
  E: 1e18,
  P: 1e15,
  T: 1e12,
  G: 1e9,
  M: 1e6,
  k: 1e3,
  h: 1e2,
  da: 10,
  d: 1e-1,
  c: 1e-2,
  m: 1e-3,
  μ: 1e-6,
  u: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
  a: 1e-18,
  z: 1e-21,
  y: 1e-24,
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  Ei: 1024 ** 6,
  Zi: 1024 ** 7,
  Yi: 1024 ** 8,
};

const PREFIX_KEYS = Object.keys(PREFIXES).sort((a, b) => b.length - a.length);

function lookupExact(name: string): UnitDef | undefined {
  if (name in UNITS) return UNITS[name];
  const aliased = ALIASES[name];
  if (aliased && aliased in UNITS) return UNITS[aliased];
  return undefined;
}

export function resolveUnit(name: string): UnitDef | undefined {
  const exact = lookupExact(name);
  if (exact) return exact;
  for (const p of PREFIX_KEYS) {
    if (!name.startsWith(p) || name.length === p.length) continue;
    const rest = name.slice(p.length);
    const u = lookupExact(rest);
    if (u) return { factor: u.factor * PREFIXES[p], dim: u.dim };
  }
  return undefined;
}
