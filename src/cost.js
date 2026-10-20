// How inconvenient a meeting is for one person, given their own hours.

import { wallTime } from "./tz.js";

/**
 * @typedef {object} Person
 * @property {string} id
 * @property {string} name
 * @property {string} timeZone   IANA zone, e.g. "Europe/London"
 * @property {number} workStart  minutes after midnight, local
 * @property {number} workEnd
 * @property {number} sleepStart minutes after midnight, local (may be before or after midnight)
 * @property {number} sleepEnd
 */

/** Points per hour spent in each kind of time. Night hours are deliberately expensive. */
export const POINTS_PER_HOUR = Object.freeze({ work: 0, edge: 1, weekend: 2, night: 5 });

/** @typedef {"work" | "edge" | "weekend" | "night"} Band */

export const BAND_LABELS = Object.freeze({
  work: "Working hours",
  edge: "Before or after work",
  weekend: "Weekend",
  night: "Night",
});

const STEP = 15; // minutes

/** Is `minute` (0–1439) inside the wrapped range [start, end)? */
export function inRange(minute, start, end) {
  if (start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/**
 * The band a single local moment falls in.
 * @param {Person} person
 * @param {number} minuteOfDay
 * @param {number} weekday 0 = Sunday
 * @returns {Band}
 */
export function bandAt(person, minuteOfDay, weekday) {
  if (inRange(minuteOfDay, person.sleepStart, person.sleepEnd)) return "night";
  if (weekday === 0 || weekday === 6) return "weekend";
  if (inRange(minuteOfDay, person.workStart, person.workEnd)) return "work";
  return "edge";
}

/**
 * Inconvenience points for a meeting from `startMs` lasting `durationMin`,
 * measured in 15-minute steps of the person's local time, plus the band of
 * the worst part of the meeting (used for the colour in the schedule).
 * @param {Person} person
 * @param {number} startMs
 * @param {number} durationMin
 * @returns {{ points: number, band: Band, local: import("./tz.js").WallTime }}
 */
export function meetingCost(person, startMs, durationMin) {
  const order = ["work", "edge", "weekend", "night"];
  let points = 0;
  let worst = 0;
  const steps = Math.max(1, Math.ceil(durationMin / STEP));
  for (let i = 0; i < steps; i++) {
    const w = wallTime(startMs + i * STEP * 60_000, person.timeZone);
    const band = bandAt(person, w.hour * 60 + w.minute, w.weekday);
    points += (POINTS_PER_HOUR[band] * STEP) / 60;
    worst = Math.max(worst, order.indexOf(band));
  }
  return { points, band: /** @type {Band} */ (order[worst]), local: wallTime(startMs, person.timeZone) };
}
