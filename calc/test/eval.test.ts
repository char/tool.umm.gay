// i vibecoded most of these test cases fwiw

import { assertEquals, assertThrows } from "@std/assert";
import { CalcError, evaluate, format, formatQuantity, run, Session } from "../mod.ts";

Deno.test("scalar arithmetic", () => {
  assertEquals(run("1 + 2"), "3");
  assertEquals(run("2 * 3"), "6");
  assertEquals(run("10 / 4"), "2.5");
  assertEquals(run("2 ^ 10"), "1024");
  assertEquals(run("-5 + 3"), "-2");
  assertEquals(run("2 + 3 * 4"), "14");
  assertEquals(run("(2 + 3) * 4"), "20");
});

Deno.test("simple units", () => {
  assertEquals(run("5 m"), "5 m");
  assertEquals(run("5 km"), "5 km");
  assertEquals(run("5 m + 3 m"), "8 m");
  assertEquals(run("5 km - 2 km"), "3 km");
  assertEquals(run("3 m * 4"), "12 m");
});

Deno.test("juxtaposition vs explicit", () => {
  assertEquals(run("5 m / 10 s"), "0.5 m/s");
  assertEquals(run("5 m * 10 s"), "50 m·s");
  assertEquals(run("60 mph"), "60 mph");
});

Deno.test("cross-unit cancellation: the headline cases", () => {
  assertEquals(run("20 GB / 10 Mbps"), "4 h, 26 min, 40 s");
  assertEquals(run("20 GB / 10 Mbps → s"), "16000 s");
  assertEquals(run("1 GB / 1 MB"), "1000");
  assertEquals(run("1 GiB / 1 MiB"), "1024");
  assertEquals(run("5 km/h * 2 h"), "10 km");
});

Deno.test("conversion via →", () => {
  assertEquals(run("1 km → m"), "1000 m");
  assertEquals(run("1 day → s"), "86400 s");
  assertEquals(run("1 day → h"), "24 h");
  assertEquals(run("60 mph → m/s"), "26.8224 m/s");
});

Deno.test("conversion via `to` and `in`", () => {
  assertEquals(run("1 km to m"), "1000 m");
  assertEquals(run("1 km in m"), "1000 m");
});

Deno.test("inch is spelled `inch`, not `in`", () => {
  assertEquals(run("5 inch → cm"), "12.7 cm");
});

Deno.test("smaller-unit display on +/-", () => {
  assertEquals(run("1 km + 1 m"), "1001 m");
  assertEquals(run("1 day - 5 h"), "19 h");
  assertEquals(run("1 year + 3 day + 7 h"), "1 year, 3 day, 7 h");
});

Deno.test("dim mismatch errors", () => {
  assertThrows(() => run("1 m + 1 s"), CalcError);
  assertThrows(() => run("1 m → s"), CalcError);
  assertThrows(() => run("1 + 1 m"), CalcError);
});

Deno.test("unknown identifiers", () => {
  assertThrows(() => run("nonsense"), CalcError);
});

Deno.test("powers (with superscript exponents)", () => {
  assertEquals(run("(3 m) ^ 2"), "9 m²");
  assertEquals(run("2 m * 3 m"), "6 m²");
  assertEquals(run("1 / 1 m"), "1 m⁻\u00b9");
  assertEquals(run("3 m^-2"), "3 m⁻\u00b2");
  assertThrows(() => run("(1 m) ^ 0.5"), CalcError);
});

Deno.test("explicit mixed-unit conversions", () => {
  assertEquals(run("7201 s → h, min, s"), "2 h, 1 s");
  assertEquals(run("7260 s → h, min, s"), "2 h, 1 min");
  assertEquals(run("3661 s → h, min, s"), "1 h, 1 min, 1 s");
  assertEquals(run("0 s → h, min, s"), "0 s");
  assertEquals(run("90 s → min, s"), "1 min, 30 s");
  assertEquals(run("90.5 s → min, s"), "1 min, 30.5 s");
});

Deno.test("auto-mixed for time when result is in seconds", () => {
  assertEquals(run("7201 s"), "2 h, 1 s");
  assertEquals(run("3661 s"), "1 h, 1 min, 1 s");
  assertEquals(run("90 s"), "1 min, 30 s");
  assertEquals(run("59 s"), "59 s");
  assertEquals(run("0.5 s"), "0.5 s");
  assertEquals(run("90061 s"), "1 day, 1 h, 1 min, 1 s");
});

Deno.test("auto-mixed off when user explicitly converted", () => {
  assertEquals(run("1 day → s"), "86400 s");
  assertEquals(run("1 h → s"), "3600 s");
});

Deno.test("sqft", () => {
  assertEquals(run("5 sqft"), "5 sqft");
  assertEquals(run("100 sqft + 50 ft^2"), "150 sqft");
  assertEquals(run("1 m^2 → sqft"), "10.7639 sqft");
});

Deno.test("auto-mixed for ft/inch", () => {
  assertEquals(run("5.5 ft"), "5 ft, 6 inch");
  assertEquals(run("13 inch"), "1 ft, 1 inch");
  assertEquals(run("7 inch"), "7 inch");
  assertEquals(run("0.5 ft"), "6 inch");
});

Deno.test("constants and math fns", () => {
  assertEquals(run("pi"), Math.PI.toPrecision(6).replace(/0+$/, ""));
  assertEquals(run("sin(0)"), "0");
  assertEquals(run("cos(0)"), "1");
  assertEquals(run("sqrt(4 m^2)"), "2 m");
});

Deno.test("session bindings", () => {
  const s = new Session();
  s.evaluate("let bw = 100 Mbps");
  assertEquals(s.run("1 TB / bw"), "22 h, 13 min, 20 s");
  assertEquals(s.run("1 TB / bw → s"), "80000 s");
});

Deno.test("quantity and display are separate", () => {
  const result = evaluate("1 day → h");
  assertEquals(result.quantity, { value: 86400, dim: { time: 1 } });
  assertEquals(format(result), "24 h");
  assertEquals(formatQuantity(result.quantity), "1 day");
});

Deno.test("ans", () => {
  const s = new Session();
  s.evaluate("3 + 4");
  assertEquals(s.run("ans * 2"), "14");
});

Deno.test("hex literals and hex display", () => {
  assertEquals(run("0xff"), "255");
  assertEquals(run("0xDEADBEEF"), "3735928559");
  assertEquals(run("0x10 * 0x10"), "256");
  assertEquals(run("255 → hex"), "0xFF");
  assertEquals(run("0xDEADBEEF → hex"), "0xDEADBEEF");
  assertEquals(run("-1 → hex"), "-0x1");
});

Deno.test("bswap", () => {
  assertEquals(run("bswap32(0x12345678) → hex"), "0x78563412");
  assertEquals(run("bswap16(0xABCD) → hex"), "0xCDAB");
  assertEquals(run("bswap32(bswap32(0xCAFEBABE)) → hex"), "0xCAFEBABE");
  assertEquals(run("bswap64(0x0102030405060708) → hex"), "0x807060504030201");
  assertEquals(run("bswap64(0xDEADBEEFCAFEBABE) → hex"), "0xBEBAFECAEFBEADDE");
  assertEquals(run("bswap64(bswap64(0xDEADBEEFCAFEBABE)) → hex"), "0xDEADBEEFCAFEBABE");
});

Deno.test("large-number scalar constants", () => {
  assertEquals(run("5 million"), "5000000");
  assertEquals(run("1.5 trillion"), "1500000000000");
  assertEquals(run("3 myriad"), "30000");
  assertEquals(run("2 billion bytes → GB"), "2 GB");
});

Deno.test("derived units emerge from arithmetic", () => {
  assertEquals(run("3 A * 3 V"), "9 W");
  assertEquals(run("3 V * 3 A"), "9 W");
  assertEquals(run("5 W * 2 s"), "10 J");
  assertEquals(run("5 N * 3 m"), "15 J");
  assertEquals(run("10 N / 2 m^2"), "5 Pa");
  assertEquals(run("2 A * 3 s"), "6 C");
  // user explicitly named the derived unit → keep it
  assertEquals(run("5 W + 3 W"), "8 W");
  assertEquals(run("5 Wh"), "5 Wh");
  // no derived match → leave as base composition
  assertEquals(run("5 m * 10 s"), "50 m·s");
  // inverse-time collapses to Hz
  assertEquals(run("1 / 10 sec"), "0.1 Hz");
  assertEquals(run("1 / 1 s"), "1 Hz");
  // and inverse-Hz collapses back to seconds
  assertEquals(run("1 / 10 Hz"), "0.1 s");
  assertEquals(run("1 / 0.1 Hz"), "10 s");
  // but inverse-length has no derived counterpart
  assertEquals(run("1 / 1 m"), "1 m\u207b\u00b9");
});

Deno.test("angles", () => {
  assertEquals(run("sin(90°)"), "1");
  assertEquals(run("sin(pi/2)"), "1");
});
