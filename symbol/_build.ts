import { build } from "@char/aftercare/bundle";
import "./_data.ts";

await build({
  // Keep the JSX runtime in a shared chunk instead of rebundling it with each UI edit.
  in: { main: "./main.tsx", aftercare: "@char/aftercare/jsx-runtime" },
  outDir: "./public/dist",
  overrides: { splitting: true, chunkNames: "chunks/[name]-[hash]" },
  watch: Deno.args.includes("--serve"),
  serve: Deno.args.includes("--serve")
    ? { servedir: "public", host: "127.0.0.1", port: 3000 }
    : undefined,
});
