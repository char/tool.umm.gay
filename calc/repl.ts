import process from "node:process";
import {
  CalcError,
  format,
  highlight,
  parseProgram,
  renderAnsi,
  Session,
  showProgram,
} from "./mod.ts";
import { readLine } from "./_line-editor.ts";

const session = new Session();
const classify = (name: string) => session.classifyIdent(name);
const colorize = process.stdout.isTTY
  ? (line: string) => renderAnsi(highlight(line, classify))
  : (line: string) => line;

const write = (s: string) => process.stdout.write(s);

while (true) {
  const input = await readLine({ prompt: "> ", render: colorize });
  if (input === undefined) break;
  const src = input.trim();
  if (src === "") continue;

  try {
    const stmts = parseProgram(src);
    for (const line of colorize(showProgram(stmts)).split("\n")) write(`  ${line}\n`);
    write(`${format(session.evaluateStmts(stmts))}\n`);
  } catch (e) {
    if (e instanceof CalcError) {
      const { start, end } = e.span;
      write(`  ${src}\n`);
      write(`  ${" ".repeat(start)}${"^".repeat(Math.max(1, end - start))}\n`);
      write(`error: ${e.message}\n`);
    } else {
      write(`internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
}

process.exit(0);
