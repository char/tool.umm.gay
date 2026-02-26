import { build } from "@char/aftercare/bundle";

await build({
  in: ["./main.tsx"],
  outDir: "./public/dist",
  overrides: {
    external: ["@char/aftercare", "@char/aftercare/jsx-runtime"],
  },
  watch: Deno.args.includes("--serve"),
  serve: Deno.args.includes("--serve")
    ? { servedir: "public", host: "127.0.0.1", port: 3000 }
    : undefined,
});
