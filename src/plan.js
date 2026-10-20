// Build a recurring series and choose a fair rotation of meeting times.

import { meetingCost } from "./cost.js";
import { addDays, offsetMinutes, zonedToUtc } from "./tz.js";

/**
 * @typedef {import("./cost.js").Person} Person
 * @typedef {object} Series
 * @property {string} anchorZone      the organiser's zone; slot times are wall times here
 * @property {{year:number,month:number,day:number}} firstDate  date of the first meeting, in anchorZone
 * @property {number} everyDays       7 for weekly, 14 for fortnightly
 * @property {number} count           number of meetings
 * @property {number} durationMin
 * @property {number} rotation        how many different slots to rotate through (1 = a fixed time)
 * @property {number} [stepMin]       granularity of candidate start times (default 30)
 */

/** @typedef {{ points: number, band: import("./cost.js").Band, local: import("./tz.js").WallTime }} Cost */

/**
 * @typedef {object} Occurrence
 * @property {number} index
 * @property {{year:number,month:number,day:number}} date   anchor-zone date
 * @property {number} slot       minutes after midnight, anchor-zone wall time
 * @property {number} startMs
 * @property {"ok"|"ambiguous"|"skipped"} status
 * @property {Cost[]} costs       one per person, same order as people
 */

/**
 * @typedef {object} Plan
 * @property {number[]} slots           the rotation, as anchor wall times
 * @property {Occurrence[]} occurrences
 * @property {number[]} totals          inconvenience points per person over the series
 * @property {number} worst             the largest total
 * @property {number} sum
 */

export const MAX_ROTATION = 3;
export const MAX_COUNT = 52;

/** Candidate start times for each meeting date, with every person's cost. */
export function costMatrix(people, series) {
  const step = series.stepMin ?? 30;
  const slots = [];
  for (let m = 0; m < 1440; m += step) slots.push(m);
  const dates = Array.from({ length: series.count }, (_, i) => addDays(series.firstDate, i * series.everyDays));
  const matrix = dates.map((date) =>
    slots.map((slot) => {
      const { ms, status } = zonedToUtc(series.anchorZone, { ...date, hour: Math.floor(slot / 60), minute: slot % 60 });
      return { date, slot, startMs: ms, status, costs: people.map((p) => meetingCost(p, ms, series.durationMin)) };
    }),
  );
  return { slots, dates, matrix };
}

/**
 * Evaluate a rotation: meeting i uses slots[i % slots.length].
 * @returns {Plan}
 */
export function evaluate(people, built, slotIndexes) {
  const totals = people.map(() => 0);
  const occurrences = built.matrix.map((row, index) => {
    const cell = row[slotIndexes[index % slotIndexes.length]];
    cell.costs.forEach((c, p) => (totals[p] += c.points));
    return { index, date: cell.date, slot: cell.slot, startMs: cell.startMs, status: cell.status, costs: cell.costs };
  });
  return {
    slots: slotIndexes.map((i) => built.slots[i]),
    occurrences,
    totals,
    worst: Math.max(0, ...totals),
    sum: totals.reduce((a, b) => a + b, 0),
  };
}

/** Lexicographic comparison: lower worst, then lower sum, then smaller spread. */
function better(a, b) {
  if (a.worst !== b.worst) return a.worst < b.worst;
  if (a.sum !== b.sum) return a.sum < b.sum;
  return spread(a.totals) < spread(b.totals);
}

function spread(totals) {
  return totals.length ? Math.max(...totals) - Math.min(...totals) : 0;
}

/** Fast scoring used during the search: totals only, no objects per meeting. */
function score(points, slotIndexes) {
  const people = points[0][0].length;
  const totals = new Array(people).fill(0);
  for (let i = 0; i < points.length; i++) {
    const row = points[i][slotIndexes[i % slotIndexes.length]];
    for (let p = 0; p < people; p++) totals[p] += row[p];
  }
  let worst = 0;
  let sum = 0;
  for (const t of totals) {
    if (t > worst) worst = t;
    sum += t;
  }
  return { slotIndexes, totals, worst, sum };
}

function* combinations(n, k, start = 0, prefix = []) {
  if (prefix.length === k) {
    yield prefix;
    return;
  }
  for (let i = start; i < n; i++) yield* combinations(n, k, i + 1, [...prefix, i]);
}

/**
 * The fairest fixed time and the fairest rotation of `series.rotation` slots.
 *
 * Fairness here means minimising the inconvenience carried by whoever has it
 * worst over the whole series (then the group total). Each candidate is scored
 * on the real dates, so daylight-saving changes during the series count.
 *
 * Every order and starting point of each candidate rotation is scored, since
 * with a series length that isn't a multiple of the rotation, they differ.
 *
 * @param {Person[]} people
 * @param {Series} series
 */
export function planSeries(people, series) {
  if (people.length === 0) throw new RangeError("Add at least one person.");
  const count = Math.min(MAX_COUNT, Math.max(1, Math.round(series.count)));
  const rotation = Math.min(MAX_ROTATION, Math.max(1, Math.round(series.rotation)), count);
  const built = costMatrix(people, { ...series, count });

  // points[meeting][slot][person], rounded to avoid floating-point ties being broken by noise.
  // points[meeting][slot][person] in hundredths, so floating-point noise can't break ties.
  const points = built.matrix.map((row) => row.map((cell) => cell.costs.map((c) => Math.round(c.points * 100))));

  let fixed = null;
  for (let i = 0; i < built.slots.length; i++) {
    const candidate = score(points, [i]);
    if (!fixed || better(candidate, fixed)) fixed = candidate;
  }

  let rotated = fixed;
  if (rotation > 1) {
    rotated = null;
    for (const combo of combinations(built.slots.length, rotation)) {
      // Try each starting point of the cycle; with uneven series lengths it matters.
      for (let shift = 0; shift < rotation; shift++) {
        const candidate = score(points, [...combo.slice(shift), ...combo.slice(0, shift)]);
        if (!rotated || better(candidate, rotated)) rotated = candidate;
      }
    }
  }

  const fixedPlan = evaluate(people, built, /** @type {any} */ (fixed).slotIndexes);
  const rotatedPlan = evaluate(people, built, /** @type {any} */ (rotated).slotIndexes);
  return { fixed: fixedPlan, rotated: rotatedPlan, dstChanges: dstChanges(people, series.anchorZone, rotatedPlan.occurrences) };
}
/**
 * Where a person's clock moves relative to the organiser's between meetings
 * (one of them changed to or from daylight saving time).
 */
export function dstChanges(people, anchorZone, occurrences) {
  const notes = [];
  for (let i = 1; i < occurrences.length; i++) {
    const prev = occurrences[i - 1].startMs;
    const curr = occurrences[i].startMs;
    const anchorShift = offsetMinutes(curr, anchorZone) - offsetMinutes(prev, anchorZone);
    people.forEach((person, p) => {
      const personShift = offsetMinutes(curr, person.timeZone) - offsetMinutes(prev, person.timeZone);
      const shift = personShift - anchorShift;
      if (shift !== 0) {
        // `changed` says whose clocks moved: the person's, the organiser's, or both.
        const changed = personShift !== 0 && anchorShift !== 0 ? "both" : personShift !== 0 ? "person" : "anchor";
        notes.push({ occurrence: i, person: p, minutes: shift, changed, personShift, anchorShift });
      }
    });
  }
  return notes;
}
