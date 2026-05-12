import process from "node:process";
import readline from "node:readline";

export interface ReadLineOpts {
  prompt: string;
  render?: (line: string) => string;
}

interface Key {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

let keypressInitialized = false;
function initKeypress() {
  if (keypressInitialized) return;
  readline.emitKeypressEvents(process.stdin);
  keypressInitialized = true;
}

const history: string[] = [];

export function readLine(opts: ReadLineOpts): Promise<string | undefined> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return readLineFromPipe(opts.prompt);

  initKeypress();
  const stdout = process.stdout;
  const render = opts.render ?? (s => s);
  const promptW = opts.prompt.length;

  return new Promise(resolve => {
    let buf = "";
    let cur = 0;
    let histIdx = history.length;
    let draft = "";

    let cursorRow = 0;
    const lastRow = (width: number, cols: number) =>
      width === 0 ? 0 : Math.floor((width - 1) / cols);

    const onResize = () => draw();

    const draw = () => {
      const cols = stdout.columns || 80;
      const totalW = promptW + buf.length;
      const cursorW = promptW + cur;
      const endRow = lastRow(totalW, cols);
      const targetRow = Math.floor(cursorW / cols);
      const targetCol = cursorW % cols;

      let out = "\r";
      if (cursorRow > 0) out += `\x1b[${cursorRow}A`;
      out += `\x1b[J${opts.prompt}${render(buf)}\r`;
      if (endRow > 0) out += `\x1b[${endRow}A`;
      if (targetRow > 0) out += `\x1b[${targetRow}B`;
      if (targetCol > 0) out += `\x1b[${targetCol}C`;
      stdout.write(out);
      cursorRow = targetRow;
    };

    const exitContent = () => {
      const cols = stdout.columns || 80;
      const endRow = lastRow(promptW + buf.length, cols);
      const down = endRow - cursorRow;
      return (down > 0 ? `\x1b[${down}B` : "") + "\r\n";
    };

    const finish = (line: string | undefined) => {
      stdin.off("keypress", onKey);
      stdin.off("end", onEnd);
      stdout.off("resize", onResize);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write(exitContent());
      resolve(line);
    };

    const onEnd = () => finish(undefined);

    const insert = (s: string) => {
      buf = buf.slice(0, cur) + s + buf.slice(cur);
      cur += s.length;
      draw();
    };

    const setBuf = (s: string, newCur?: number) => {
      buf = s;
      cur = newCur ?? Math.min(cur, s.length);
      draw();
    };

    const onKey = (str: string | undefined, key: Key | undefined) => {
      if (!key) {
        if (str) insert(str);
        return;
      }

      if (key.ctrl && !key.meta) {
        switch (key.name) {
          case "c":
            stdout.write(`${exitContent()}^C\r\n`);
            buf = "";
            cur = 0;
            histIdx = history.length;
            draft = "";
            cursorRow = 0;
            draw();
            return;
          case "d":
            if (buf.length === 0) return finish(undefined);
            if (cur < buf.length) setBuf(buf.slice(0, cur) + buf.slice(cur + 1));
            return;
          case "l":
            stdout.write("\x1b[2J\x1b[H");
            cursorRow = 0;
            draw();
            return;
          case "a":
            cur = 0;
            draw();
            return;
          case "e":
            cur = buf.length;
            draw();
            return;
          case "u":
            setBuf(buf.slice(cur), 0);
            return;
          case "k":
            setBuf(buf.slice(0, cur));
            return;
          case "w": {
            let i = cur;
            while (i > 0 && /\s/.test(buf[i - 1])) i--;
            while (i > 0 && /\S/.test(buf[i - 1])) i--;
            setBuf(buf.slice(0, i) + buf.slice(cur), i);
            return;
          }
          case "b":
            if (cur > 0) {
              cur--;
              draw();
            }
            return;
          case "f":
            if (cur < buf.length) {
              cur++;
              draw();
            }
            return;
        }
        return;
      }

      switch (key.name) {
        case "return":
        case "enter": {
          const line = buf;
          if (line.trim() !== "" && history[history.length - 1] !== line) {
            history.push(line);
          }
          return finish(line);
        }
        case "backspace":
          if (cur > 0) setBuf(buf.slice(0, cur - 1) + buf.slice(cur), cur - 1);
          return;
        case "delete":
          if (cur < buf.length) setBuf(buf.slice(0, cur) + buf.slice(cur + 1));
          return;
        case "left":
          if (cur > 0) {
            cur--;
            draw();
          }
          return;
        case "right":
          if (cur < buf.length) {
            cur++;
            draw();
          }
          return;
        case "home":
          cur = 0;
          draw();
          return;
        case "end":
          cur = buf.length;
          draw();
          return;
        case "up":
          if (histIdx === history.length) draft = buf;
          if (histIdx > 0) {
            histIdx--;
            setBuf(history[histIdx], history[histIdx].length);
          }
          return;
        case "down":
          if (histIdx < history.length) {
            histIdx++;
            const line = histIdx === history.length ? draft : history[histIdx];
            setBuf(line, line.length);
          }
          return;
        case "escape":
          return;
      }

      if (str && !key.meta && str >= " ") insert(str);
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKey);
    stdin.once("end", onEnd);
    stdout.on("resize", onResize);
    draw();
  });
}

let pipeQueue: string[] | undefined;
let pipeEnded = false;
let pipeWaiter: ((v: string | undefined) => void) | undefined;

function initPipe() {
  if (pipeQueue) return;
  pipeQueue = [];
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", line => {
    if (pipeWaiter) {
      const w = pipeWaiter;
      pipeWaiter = undefined;
      w(line);
    } else {
      pipeQueue!.push(line);
    }
  });
  rl.on("close", () => {
    pipeEnded = true;
    if (pipeWaiter) {
      const w = pipeWaiter;
      pipeWaiter = undefined;
      w(undefined);
    }
  });
}

function readLineFromPipe(prompt: string): Promise<string | undefined> {
  initPipe();
  process.stdout.write(prompt);
  if (pipeQueue!.length > 0) return Promise.resolve(pipeQueue!.shift()!);
  if (pipeEnded) return Promise.resolve(undefined);
  return new Promise(resolve => {
    pipeWaiter = resolve;
  });
}
