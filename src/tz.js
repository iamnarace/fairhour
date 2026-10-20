// Time-zone arithmetic on top of the IANA data that ships with every modern
// browser (and Node) through Intl. No time-zone database is bundled.

/** @typedef {{ year: number, month: number, day: number, hour: number, minute: number, weekday: number }} WallTime */

const MINUTE = 60_000;
const DAY = 86_400_000;
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** @type {Map<string, Intl.DateTimeFormat>} */
const partFormatters = new Map();

function partsFormatter(timeZone) {
  let f = partFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    partFormatters.set(timeZone, f);
  }
  return f;
}

/** True if `timeZone` is an IANA zone this runtime knows. */
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone) return false;
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/**
 * The wall-clock time in `timeZone` at instant `ms`.
 * @param {number} ms
 * @param {string} timeZone
 * @returns {WallTime}
 */
export function wallTime(ms, timeZone) {
  /** @type {Record<string, string>} */
  const p = {};
  for (const part of partsFormatter(timeZone).formatToParts(ms)) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    weekday: WEEKDAYS[/** @type {keyof typeof WEEKDAYS} */ (p.weekday)],
  };
}

/** UTC offset of `timeZone` at instant `ms`, in minutes (Sydney in summer: +660). */
export function offsetMinutes(ms, timeZone) {
  const w = wallTime(ms, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  return Math.round((asUtc - Math.floor(ms / MINUTE) * MINUTE) / MINUTE);
}

/**
 * The instant at which clocks in `timeZone` show the given wall time.
 *
 * * `status: "ok"` — the time exists once.
 * * `status: "ambiguous"` — clocks went back and the time happened twice; the
 *   earlier instant is returned (what calendar apps do).
 * * `status: "skipped"` — clocks went forward and the time never happened; the
 *   instant returned shows the time just after the jump (02:30 becomes 03:30).
 *
 * @param {string} timeZone
 * @param {{ year: number, month: number, day: number, hour: number, minute: number }} wall
 * @returns {{ ms: number, status: "ok" | "ambiguous" | "skipped" }}
 */
export function zonedToUtc(timeZone, { year, month, day, hour, minute }) {
  const local = Date.UTC(year, month - 1, day, hour, minute);
  const before = offsetMinutes(local - DAY / 2, timeZone);
  const after = offsetMinutes(local + DAY / 2, timeZone);
  const candidates = [...new Set([local - before * MINUTE, local - after * MINUTE])].filter((ms) => {
    const w = wallTime(ms, timeZone);
    return w.year === year && w.month === month && w.day === day && w.hour === hour && w.minute === minute;
  });
  if (candidates.length > 0) {
    return { ms: Math.min(...candidates), status: candidates.length > 1 ? "ambiguous" : "ok" };
  }
  return { ms: local - before * MINUTE, status: "skipped" };
}

/** Add whole days to a calendar date (no time zone involved). */
export function addDays({ year, month, day }, days) {
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Parse "2026-10-27" into a calendar date, or null. */
export function parseDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? "");
  if (!m) return null;
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const check = addDays(date, 0);
  return check.year === date.year && check.month === date.month && check.day === date.day ? date : null;
}

export function formatDateISO({ year, month, day }) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "07:30" from minutes after midnight. */
export function formatClock(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Minutes after midnight from "07:30", or null. */
export function parseClock(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

/** A short label like "GMT+11" for the zone at that instant. */
export function zoneLabel(ms, timeZone) {
  const offset = offsetMinutes(ms, timeZone);
  const sign = offset < 0 ? "−" : "+";
  const abs = Math.abs(offset);
  const minutes = abs % 60 ? `:${String(abs % 60).padStart(2, "0")}` : "";
  return `UTC${sign}${Math.floor(abs / 60)}${minutes}`;
}

/** All IANA zones the runtime knows, falling back to a small list on old browsers. */
export function listTimeZones() {
  if (typeof Intl.supportedValuesOf === "function") return Intl.supportedValuesOf("timeZone");
  return [
    "UTC", "Europe/London", "Europe/Berlin", "America/New_York", "America/Chicago", "America/Los_Angeles",
    "America/Sao_Paulo", "Asia/Kolkata", "Asia/Kathmandu", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
    "Australia/Perth", "Pacific/Auckland",
  ];
}

/** The time zone this device is set to. */
export function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
