import { Signal } from "@char/aftercare";

type JoinLine = { type: "join"; date: string; time: string; raw: string };
type ActionLine = {
  type: "action";
  date: string;
  time: string;
  nick: string;
  text: string;
};
type MessageLine = {
  type: "message";
  date: string;
  time: string;
  nick: string;
  text: string;
};
type Line = JoinLine | ActionLine | MessageLine;

function parseLine(line: string): Line | undefined {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\t(.+)$/);
  if (!match) return undefined;

  const [, date, time, rest] = match;
  const tabIdx = rest.indexOf("\t");
  if (tabIdx === -1) return undefined;

  const nick = rest.slice(0, tabIdx);
  const text = rest.slice(tabIdx + 1);

  if (nick === "-->" || nick === "<--" || nick === "---") {
    return { type: "join", date, time, raw: text };
  }

  if (nick.trim() === "*") {
    // action: "nick text..."
    const spaceIdx = text.indexOf(" ");
    const actionNick = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
    const actionText = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1);
    return { type: "action", date, time, nick: actionNick, text: actionText };
  }

  return { type: "message", date, time, nick, text };
}

function parseLog(raw: string): Line[] {
  return raw
    .split("\n")
    .map((l) => parseLine(l))
    .filter((l): l is Line => l !== undefined);
}

const rawLog = new Signal("");
const lines = rawLog.derive(parseLog);

function renderLine(line: Line) {
  if (line.type === "join") {
    return (
      <div class="log-line log-join">
        <span class="log-time">{line.time}</span>
        <span class="log-nick">--&gt;</span>
        <span class="log-text">{line.raw}</span>
      </div>
    );
  } else if (line.type === "action") {
    return (
      <div class="log-line log-action">
        <span class="log-time">{line.time}</span>
        <span class="log-nick">* {line.nick}</span>
        <span class="log-text">{line.text}</span>
      </div>
    );
  } else {
    return (
      <div class="log-line log-message">
        <span class="log-time">{line.time}</span>
        <span class="log-nick">{line.nick}</span>
        <span class="log-text">{line.text}</span>
      </div>
    );
  }
}

function renderLines(parsed: Line[]) {
  return <div class="log-grid">{parsed.map(renderLine)}</div>;
}

const logContainer = <div />;

lines.subscribe((parsed) => {
  logContainer.replaceChildren(renderLines(parsed));
});

const textarea = (
  <textarea id="log-input" placeholder="paste irc logs here…" value={rawLog} />
) as HTMLTextAreaElement;

document.querySelector("main")!.append(textarea, logContainer);
