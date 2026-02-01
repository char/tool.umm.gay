import { build } from "@char/aftercare/bundle";

await build({
  in: [
    { in: "./src/aftercare.ts", out: "aftercare/mod" },
    { in: "./src/aftercare-jsx.ts", out: "aftercare/jsx-runtime" },
  ],
  outDir: "./public/js/",
  overrides: { minify: false, minifySyntax: true, minifyWhitespace: true },
});
