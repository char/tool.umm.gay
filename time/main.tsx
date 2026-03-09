import { Signal } from "@char/aftercare";
import * as chrono from "chrono-node";

const inputSignal = new Signal("");
const parsedTimeSignal = new Signal<Date | undefined>(undefined);
const errorSignal = new Signal("");
const knownTimezoneSignal = new Signal<string | undefined>(undefined);

// since we're deriving to two signals we might as well do the work only once
inputSignal.subscribe(input => {
  if (!input.trim()) {
    parsedTimeSignal.set(undefined);
    errorSignal.set("");
    return;
  }

  try {
    const results = chrono.parse(input, new Date(), { forwardDate: true });
    if (results.length > 0) {
      console.log(results); // TODO: remove this after we figure out what we want to show as extra info

      parsedTimeSignal.set(results[0].start.date());
      errorSignal.set("");

      const timezoneOffset = results[0].start.get("timezoneOffset");
      knownTimezoneSignal.set(
        timezoneOffset
          ? `UTC${timezoneOffset >= 0 ? "+" : ""}${timezoneOffset / 60}`
          : undefined,
      );
    } else {
      parsedTimeSignal.set(undefined);
      errorSignal.set("could not parse time");
      knownTimezoneSignal.set(undefined);
    }
  } catch (e) {
    parsedTimeSignal.set(undefined);
    errorSignal.set(`parse error: ${e}`);
    knownTimezoneSignal.set(undefined);
  }
});

const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const timeResultsDiv = (
  <div id="time-results">
    <p>
      local time ({userTimezone}):
      <strong>
        {parsedTimeSignal.derive(
          d =>
            d?.toLocaleDateString(undefined, {
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit",
              day: "numeric",
              month: "numeric",
              year: "numeric",
              weekday: "short",
            }) ?? "[no time]",
        )}
      </strong>
      {/* TODO: need some kinda composite signal dealio in aftercare to derive from two guys at once */}
      {knownTimezoneSignal.derive(x =>
        x ? `from: ${x}` : parsedTimeSignal.get() ? "from unknown timezone" : "",
      )}
    </p>
  </div>
);

const inputField = (
  <input
    type="text"
    id="time-input"
    placeholder="e.g., tomorrow 3pm GMT, next friday at 9am PST, ..."
    value={inputSignal}
  />
) as HTMLInputElement;

// focus on load ^-^
inputField.focus();

document.querySelector("main")!.append(
  <h1>time conversion</h1>,
  <p>
    enter a loose time expression see it in your local time - powered by{" "}
    <a href="https://github.com/wanasit/chrono">chrono-node</a>
  </p>,
  <div id="input-container">{inputField}</div>,
  timeResultsDiv,
  <p class="error">{errorSignal}</p>,
);
