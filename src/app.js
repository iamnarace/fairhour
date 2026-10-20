import { BAND_LABELS, bandAt } from "./cost.js";
import { h } from "./dom.js";
import { buildCalendar } from "./ics.js";
import { planSeries } from "./plan.js";
import { DEFAULT_HOURS, encodeState, exampleState, newId, StateError, stateFromHash, validateState } from "./state.js";
import {
  formatClock,
  formatDateISO,
  isValidTimeZone,
  listTimeZones,
  localTimeZone,
  parseClock,
  parseDate,
  wallTime,
  zoneLabel,
  zonedToUtc,
} from "./tz.js";

const STORAGE_KEY = "fairhour:plan";
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

// ---------------------------------------------------------------- state
function nextTuesday() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== 2);
  return formatDateISO({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
}

function freshState() {
  const zone = localTimeZone();
  return {
    title: "Team sync",
    anchorZone: zone,
    firstDate: nextTuesday(),
    everyDays: 7,
    count: 12,
    durationMin: 45,
    rotation: 2,
    people: [{ id: newId(), name: "", timeZone: zone, ...DEFAULT_HOURS }],
  };
}

function loadInitial() {
  try {
    const fromLink = stateFromHash(location.hash);
    if (fromLink) {
      history.replaceState(null, "", location.pathname + location.search);
      return { state: fromLink, notice: "Opened a shared plan. Changes stay on this device until you share again." };
    }
  } catch (error) {
    return { state: readSaved() ?? freshState(), notice: error instanceof StateError ? error.message : "That link couldn't be opened.", error: true };
  }
  return { state: readSaved() ?? exampleState(nextTuesday()), notice: null };
}

function readSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? validateState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode or full storage: the planner still works for this visit.
  }
}

const initial = loadInitial();
/** @type {import("./state.js").State} */
let state = initial.state;
let lastPlan = null;

// ---------------------------------------------------------------- toast
let toastTimer = 0;
function toast(text, { error = false } = {}) {
  const region = document.querySelector(".toast-region");
  region.replaceChildren(
    h(
      "div",
      { class: `toast${error ? " error" : ""}` },
      h("span", null, text),
      h("button", { type: "button", class: "icon-button", "aria-label": "Dismiss", onclick: () => region.replaceChildren() }, "×"),
    ),
  );
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => region.replaceChildren(), 4500);
}

// ---------------------------------------------------------------- settings form
function zoneInput(value, label, onValid) {
  const errorId = `err-${Math.random().toString(36).slice(2, 8)}`;
  const error = h("small", { class: "field-error", id: errorId, hidden: true });
  const input = h("input", {
    list: "zones",
    value,
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": label,
    "aria-describedby": errorId,
  });
  input.addEventListener("input", () => {
    const v = input.value.trim();
    const ok = isValidTimeZone(v);
    input.toggleAttribute("aria-invalid", !ok && v !== "");
    error.hidden = ok || v === "";
    error.textContent = "Pick a time zone from the list, e.g. Europe/London";
    if (ok) onValid(v);
  });
  return { input, error };
}

function timeField(labelText, minutes, onValid) {
  const input = h("input", { type: "time", value: formatClock(minutes), step: 900, required: true });
  input.addEventListener("input", () => {
    const m = parseClock(input.value);
    if (m != null) onValid(m);
  });
  return h("label", { class: "field" }, h("span", null, labelText), input);
}

function renderTeam() {
  const team = $("team");
  team.replaceChildren(
    ...state.people.map((person, index) => {
      const zone = zoneInput(person.timeZone, `Time zone for ${person.name || `person ${index + 1}`}`, (v) => {
        person.timeZone = v;
        changed();
      });
      const name = h("input", { value: person.name, placeholder: `Person ${index + 1}`, autocomplete: "off", maxlength: 60 });
      const removeButton = h(
        "button",
        {
          type: "button",
          class: "icon-button",
          "aria-label": `Remove ${person.name || `person ${index + 1}`}`,
          disabled: state.people.length === 1,
          onclick: () => {
            state.people = state.people.filter((p) => p.id !== person.id);
            renderTeam();
            changed();
          },
        },
        "×",
      );
      name.addEventListener("input", () => {
        person.name = name.value;
        // Keep the accessible names of this row's controls in step with the person's name.
        const who = person.name.trim() || `person ${index + 1}`;
        zone.input.setAttribute("aria-label", `Time zone for ${who}`);
        removeButton.setAttribute("aria-label", `Remove ${who}`);
        changed();
      });
      return h(
        "fieldset",
        { class: "person" },
        h("legend", { class: "visually-hidden" }, person.name || `Person ${index + 1}`),
        h(
          "div",
          { class: "person-row" },
          h("label", { class: "field name" }, h("span", null, "Name"), name),
          h("label", { class: "field zone" }, h("span", null, "Time zone"), zone.input, zone.error),
          removeButton,
        ),
        h(
          "details",
          { class: "hours" },
          h(
            "summary",
            null,
            `Works ${formatClock(person.workStart)}–${formatClock(person.workEnd)}, asleep ${formatClock(person.sleepStart)}–${formatClock(person.sleepEnd)}`,
          ),
          h(
            "div",
            { class: "hours-grid" },
            timeField("Work starts", person.workStart, (m) => setHours(person, "workStart", m)),
            timeField("Work ends", person.workEnd, (m) => setHours(person, "workEnd", m)),
            timeField("Bedtime", person.sleepStart, (m) => setHours(person, "sleepStart", m)),
            timeField("Wakes up", person.sleepEnd, (m) => setHours(person, "sleepEnd", m)),
          ),
        ),
      );
    }),
  );
}

function setHours(person, key, minutes) {
  person[key] = minutes;
  const summary = document.activeElement?.closest("details")?.querySelector("summary");
  if (summary) {
    summary.textContent = `Works ${formatClock(person.workStart)}–${formatClock(person.workEnd)}, asleep ${formatClock(person.sleepStart)}–${formatClock(person.sleepEnd)}`;
  }
  changed();
}

function renderSeriesFields() {
  /** @type {HTMLInputElement} */ ($("title")).value = state.title;
  /** @type {HTMLInputElement} */ ($("anchor-zone")).value = state.anchorZone;
  /** @type {HTMLInputElement} */ ($("first-date")).value = state.firstDate;
  /** @type {HTMLSelectElement} */ ($("every-days")).value = String(state.everyDays);
  /** @type {HTMLInputElement} */ ($("count")).value = String(state.count);
  /** @type {HTMLSelectElement} */ ($("duration")).value = String(state.durationMin);
  for (const radio of document.querySelectorAll('input[name="rotation"]')) {
    /** @type {HTMLInputElement} */ (radio).checked = Number(/** @type {HTMLInputElement} */ (radio).value) === state.rotation;
  }
}

function wireSeriesFields() {
  $("title").addEventListener("input", (e) => {
    state.title = /** @type {HTMLInputElement} */ (e.target).value;
    changed();
  });
  const anchor = /** @type {HTMLInputElement} */ ($("anchor-zone"));
  const anchorError = $("anchor-zone-error");
  anchor.addEventListener("input", () => {
    const v = anchor.value.trim();
    const ok = isValidTimeZone(v);
    anchor.toggleAttribute("aria-invalid", !ok);
    anchorError.hidden = ok;
    anchorError.textContent = "Pick a time zone from the list, e.g. Australia/Sydney";
    if (ok) {
      state.anchorZone = v;
      changed();
    }
  });
  $("first-date").addEventListener("input", (e) => {
    const v = /** @type {HTMLInputElement} */ (e.target).value;
    if (parseDate(v)) {
      state.firstDate = v;
      changed();
    }
  });
  $("every-days").addEventListener("change", (e) => {
    state.everyDays = Number(/** @type {HTMLSelectElement} */ (e.target).value);
    changed();
  });
  $("count").addEventListener("input", (e) => {
    const n = Math.round(Number(/** @type {HTMLInputElement} */ (e.target).value));
    if (n >= 1 && n <= 52) {
      state.count = n;
      changed();
    }
  });
  $("duration").addEventListener("change", (e) => {
    state.durationMin = Number(/** @type {HTMLSelectElement} */ (e.target).value);
    changed();
  });
  for (const radio of document.querySelectorAll('input[name="rotation"]')) {
    radio.addEventListener("change", (e) => {
      state.rotation = Number(/** @type {HTMLInputElement} */ (e.target).value);
      changed();
    });
  }
  $("add-person").addEventListener("click", () => {
    state.people.push({ id: newId(), name: "", timeZone: state.anchorZone, ...DEFAULT_HOURS });
    renderTeam();
    changed();
    const names = $("team").querySelectorAll(".name input");
    /** @type {HTMLInputElement} */ (names[names.length - 1])?.focus();
  });
  $("load-example").addEventListener("click", () => {
    state = exampleState(state.firstDate);
    renderAll();
    toast("Loaded the example team: Sydney, London, New York and Bengaluru.");
  });
}

// ---------------------------------------------------------------- plan rendering
let pending = 0;
function changed() {
  save();
  clearTimeout(pending);
  pending = window.setTimeout(renderPlan, 120);
}

const nameOf = (p, i) => p.name.trim() || `Person ${i + 1}`;
const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const plainDate = (d) => dateFmt.format(new Date(Date.UTC(d.year, d.month - 1, d.day, 12)));

function localLabel(ms, zone, anchorDate) {
  const w = wallTime(ms, zone);
  const shift = Date.UTC(w.year, w.month - 1, w.day) - Date.UTC(anchorDate.year, anchorDate.month - 1, anchorDate.day);
  const dayNote = shift > 0 ? "next day" : shift < 0 ? "day before" : "";
  return { clock: formatClock(w.hour * 60 + w.minute), dayNote, weekday: w.weekday };
}

function renderPlan() {
  const body = $("plan-body");
  let result;
  try {
    result = planSeries(state.people, {
      anchorZone: state.anchorZone,
      firstDate: /** @type {any} */ (parseDate(state.firstDate)),
      everyDays: state.everyDays,
      count: state.count,
      durationMin: state.durationMin,
      rotation: state.rotation,
    });
  } catch (error) {
    body.replaceChildren(h("p", { class: "empty" }, error instanceof Error ? error.message : "Something went wrong."));
    return;
  }
  lastPlan = result;
  const { fixed, rotated, dstChanges } = result;
  const anchorCity = state.anchorZone.split("/").pop().replace(/_/g, " ");
  const slots = rotated.slots.map(formatClock);
  const slotList = slots.length === 1 ? slots[0] : `${slots.slice(0, -1).join(", ")} and ${slots[slots.length - 1]}`;
  const nights = rotated.occurrences.reduce((n, o) => n + o.costs.filter((c) => c.band === "night").length, 0);

  const headline =
    rotated.slots.length === 1
      ? `Meet at ${slotList} ${anchorCity} time.`
      : `Rotate between ${slotList} ${anchorCity} time.`;
  let explain;
  if (rotated.worst === 0) explain = "Everyone stays inside their working hours.";
  else if (rotated.slots.length > 1 && rotated.worst < fixed.worst) {
    explain = `The worst-off person carries ${fmtPoints(rotated.worst)} points over ${state.count} meetings, down from ${fmtPoints(fixed.worst)} with the best fixed time (${formatClock(fixed.slots[0])}).`;
  } else if (rotated.slots.length > 1) {
    explain = "Rotating doesn't beat the best fixed time for this team, so one time is used throughout.";
  } else {
    explain = `The worst-off person carries ${fmtPoints(rotated.worst)} points over ${state.count} meetings.`;
  }

  const maxTotal = Math.max(1, ...fixed.totals, ...rotated.totals);
  const ledger = h(
    "div",
    { class: "ledger" },
    h("h3", null, "Who carries the inconvenience"),
    h(
      "ul",
      { class: "bars", "aria-label": "Inconvenience points per person" },
      state.people.map((p, i) =>
        h(
          "li",
          null,
          h("span", { class: "bar-name" }, nameOf(p, i)),
          h(
            "span",
            { class: "bar-track", "aria-hidden": "true" },
            h("span", { class: "bar fixed", style: { width: `${(fixed.totals[i] / maxTotal) * 100}%` } }),
            h("span", { class: "bar rotated", style: { width: `${(rotated.totals[i] / maxTotal) * 100}%` } }),
          ),
          h(
            "span",
            { class: "bar-value" },
            `${fmtPoints(rotated.totals[i])}`,
            rotated.slots.length > 1 ? h("span", { class: "was" }, ` fixed: ${fmtPoints(fixed.totals[i])}`) : null,
          ),
        ),
      ),
    ),
    h(
      "p",
      { class: "legend" },
      h("span", { class: "key-item" }, h("span", { class: "key rotated" }), rotated.slots.length > 1 ? "With this rotation" : "With this time"),
      rotated.slots.length > 1 ? h("span", { class: "key-item" }, h("span", { class: "key fixed" }), "With the best fixed time") : null,
    ),
  );

  const notices = [];
  if (nights > 0) {
    notices.push(
      h(
        "p",
        { class: "notice" },
        `No time keeps everyone out of their night. Across the series someone joins at night ${nights} time${nights === 1 ? "" : "s"}, and the rotation shares those turns. For a team this spread out, consider an async update in place of some meetings.`,
      ),
    );
  }
  const city = (zone) => zone.split("/").pop().replace(/_/g, " ");
  for (const note of dstChanges) {
    const p = state.people[note.person];
    const occ = rotated.occurrences[note.occurrence];
    const hours = Math.abs(note.minutes) / 60;
    const amount = `${hours} hour${hours === 1 ? "" : "s"} ${note.minutes < 0 ? "earlier" : "later"}`;
    const moved = (zone, delta) => `${city(zone)}'s clocks go ${delta < 0 ? "back" : "forward"}`;
    const why =
      note.changed === "person"
        ? moved(p.timeZone, note.personShift)
        : note.changed === "anchor"
          ? moved(state.anchorZone, note.anchorShift)
          : `${moved(p.timeZone, note.personShift)} and ${moved(state.anchorZone, note.anchorShift)}`;
    notices.push(
      h("p", { class: "notice dst" }, `From ${plainDate(occ.date)} the meeting is ${amount} for ${nameOf(p, note.person)}: ${why} before then.`),
    );
  }

  const actions = h(
    "div",
    { class: "actions" },
    h("button", { type: "button", class: "button primary", onclick: downloadIcs }, "Download calendar (.ics)"),
    h("button", { type: "button", class: "button", onclick: shareLink }, "Share link"),
    h("button", { type: "button", class: "button", onclick: copySchedule }, "Copy schedule"),
  );

  body.replaceChildren(
    h("div", { class: "verdict" }, h("p", { class: "headline" }, headline), h("p", { class: "explain" }, explain), actions),
    ledger,
    ...notices,
    overlapChart(rotated),
    scheduleTable(rotated),
  );
}

function fmtPoints(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}

/** Each person's first-meeting-day as 48 half-hours aligned to the organiser's clock. */
function overlapChart(plan) {
  const date = /** @type {any} */ (parseDate(state.firstDate));
  const chosen = new Set(plan.slots);
  const cells = (person) => {
    const out = [];
    for (let m = 0; m < 1440; m += 30) {
      const { ms } = zonedToUtc(state.anchorZone, { ...date, hour: Math.floor(m / 60), minute: m % 60 });
      const w = wallTime(ms, person.timeZone);
      const band = bandAt(person, w.hour * 60 + w.minute, w.weekday);
      out.push(
        h("span", {
          class: `cell ${band}${chosen.has(m) ? " chosen" : ""}`,
          title: `${formatClock(m)} ${state.anchorZone.split("/").pop()} = ${formatClock(w.hour * 60 + w.minute)} for ${person.name || "them"} (${BAND_LABELS[band]})`,
        }),
      );
    }
    return out;
  };
  const anchorCity = state.anchorZone.split("/").pop().replace(/_/g, " ");
  return h(
    "figure",
    { class: "overlap" },
    h("figcaption", null, h("h3", null, "How the day lines up"), h("p", null, `${plainDate(date)}, by ${anchorCity} time. Marked columns are the chosen times.`)),
    h(
      "div",
      { class: "overlap-scroll" },
      h(
        "div",
        { class: "overlap-grid", role: "img", "aria-label": `Working hours, evenings, weekends and nights for each person across the ${anchorCity} day` },
        h("span", { class: "row-label" }),
        h(
          "span",
          { class: "hours-axis" },
          [0, 6, 12, 18].map((hr) => h("span", { style: { gridColumn: `${hr * 2 + 1} / span 12` } }, formatClock(hr * 60))),
        ),
        state.people.map((p, i) => [
          h("span", { class: "row-label" }, nameOf(p, i), h("small", null, zoneLabel(zonedToUtc(state.anchorZone, { ...date, hour: 12, minute: 0 }).ms, p.timeZone))),
          h("span", { class: "row-cells" }, cells(p)),
        ]),
      ),
    ),
    h(
      "p",
      { class: "band-key" },
      ["work", "edge", "weekend", "night"].map((band) => h("span", null, h("span", { class: `swatch ${band}` }), BAND_LABELS[band])),
    ),
  );
}

function scheduleTable(plan) {
  const anchorCity = state.anchorZone.split("/").pop().replace(/_/g, " ");
  return h(
    "div",
    { class: "schedule" },
    h("h3", null, "Every meeting"),
    h(
      "div",
      { class: "table-scroll" },
      h(
        "table",
        null,
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            h("th", { scope: "col" }, `Date (${anchorCity})`),
            state.people.map((p, i) => h("th", { scope: "col" }, nameOf(p, i))),
          ),
        ),
        h(
          "tbody",
          null,
          plan.occurrences.map((o) =>
            h(
              "tr",
              null,
              h("th", { scope: "row" }, plainDate(o.date), h("small", null, `${formatClock(o.slot)}${o.status === "skipped" ? " (clocks jump; shown at the new time)" : ""}`)),
              state.people.map((p, i) => {
                const c = o.costs[i];
                const local = localLabel(o.startMs, p.timeZone, o.date);
                return h(
                  "td",
                  { class: `band-${c.band}` },
                  h("span", { class: "clock" }, local.clock),
                  h("small", null, local.dayNote ? `${BAND_LABELS[c.band]}, ${local.dayNote}` : BAND_LABELS[c.band]),
                );
              }),
            ),
          ),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------- actions
function scheduleLines() {
  if (!lastPlan) return [];
  return lastPlan.rotated.occurrences.map((o) => {
    const parts = state.people.map((p, i) => {
      const l = localLabel(o.startMs, p.timeZone, o.date);
      return `${nameOf(p, i)} ${l.clock}${l.dayNote ? ` (${l.dayNote})` : ""}`;
    });
    return `${plainDate(o.date)}: ${parts.join(", ")}`;
  });
}

function downloadIcs() {
  if (!lastPlan) return;
  const events = lastPlan.rotated.occurrences.map((o) => ({ startMs: o.startMs, endMs: o.startMs + state.durationMin * 60_000 }));
  const lines = scheduleLines();
  const ics = buildCalendar({
    title: state.title.trim() || "Meeting",
    events,
    uidPrefix: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    description: (i) => `Local times: ${lines[i].split(": ").slice(1).join(": ")}\nPlanned with fairhour.`,
  });
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const a = h("a", { href: url, download: `${(state.title.trim() || "meeting").replace(/[^\w-]+/g, "-").toLowerCase()}.ics` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Downloaded ${events.length} meetings. Open the file to add them to your calendar.`);
}

async function copyText(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    window.prompt("Copy this:", text);
  }
}

function shareLink() {
  const url = `${location.origin}${location.pathname}#plan=${encodeState(state)}`;
  copyText(url, "Link copied. It contains the whole plan; nothing is stored anywhere else.");
}

function copySchedule() {
  const title = state.title.trim() || "Meeting";
  copyText([`${title}, local times:`, ...scheduleLines()].join("\n"), "Schedule copied.");
}

// ---------------------------------------------------------------- start
function renderAll() {
  renderTeam();
  renderSeriesFields();
  save();
  renderPlan();
}

$("zones").replaceChildren(...listTimeZones().map((z) => h("option", { value: z })));
wireSeriesFields();
renderAll();
if (initial.notice) toast(initial.notice, { error: Boolean(initial.error) });

// A shared link opened in a tab that already shows fairhour only changes the fragment.
window.addEventListener("hashchange", () => {
  try {
    const shared = stateFromHash(location.hash);
    if (!shared) return;
    state = shared;
    history.replaceState(null, "", location.pathname + location.search);
    renderAll();
    toast("Opened a shared plan. Changes stay on this device until you share again.");
  } catch (error) {
    toast(error instanceof StateError ? error.message : "That link couldn't be opened.", { error: true });
  }
});
