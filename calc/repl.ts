import repl from "node:repl";
import process from "node:process";
import { CalcError, format, parseProgram, Session, showProgram } from "./mod.ts";

const session = new Session();

repl.start({
  prompt: "> ",
  ignoreUndefined: true,
  preview: false,
  completer: (line: string) => [[], line],
  eval: (input, _context, _filename, cb) => {
    const src = input.trim();
    if (src === "") return cb(null, undefined);
    try {
      const stmts = parseProgram(src);
      const parsed = showProgram(stmts)
        .split("\n")
        .map(l => `  ${l}`)
        .join("\n");
      process.stdout.write(`${parsed}\n`);
      cb(null, format(session.evaluateStmts(stmts)));
    } catch (e) {
      if (e instanceof CalcError) {
        const { start, end } = e.span;
        process.stdout.write(`  ${src}\n`);
        process.stdout.write(`  ${" ".repeat(start)}${"^".repeat(Math.max(1, end - start))}\n`);
        process.stdout.write(`error: ${e.message}\n`);
        return cb(null, undefined);
      }
      cb(e instanceof Error ? e : new Error(String(e)), undefined);
    }
  },
  writer: x => (typeof x === "string" ? x : ""),
});
