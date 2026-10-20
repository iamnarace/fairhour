// The planner's inputs, their validation, and the shareable-link format.

import { formatDateISO, isValidTimeZone, parseDate } from "./tz.js";
import { MAX_COUNT, MAX_ROTATION } from "./plan.js";

/**
 * @typedef {object} State
 * @property {string} title
 * @property {import("./cost.js").Person[]} people
 * @property {string} anchorZone
 * @property {string} firstDate   "YYYY-MM-DD"
 * @property {number} everyDays
 * @property {number} count
 * @property {number} durationMin
 * @property {number} rotation
 */

export const DEFAULT_HOURS = Object.freeze({ workStart: 9 * 60, workEnd: 17 * 60, sleepStart: 22 * 60 + 30, sleepEnd: 7 * 60 });

let counter = 0;
export function newId() {
  counter += 1;
  return `p${Date.now().toString(36).slice(-4)}${counter}`;
}

/** The example team: four cities, three different daylight-saving rules, one with none. */
export function exampleState(firstDate) {
  return {
    title: "Product sync",
    anchorZone: "Australia/Sydney",
    firstDate,
    everyDays: 7,
    count: 12,
    durationMin: 45,
    rotation: 3,
    people: [
      { id: "mia", name: "Mia", timeZone: "Australia/Sydney", ...DEFAULT_HOURS },
      { id: "tom", name: "Tom", timeZone: "Europe/London", ...DEFAULT_HOURS },
      { id: "rosa", name: "Rosa", timeZone: "America/New_York", ...DEFAULT_HOURS },
      { id: "arjun", name: "Arjun", timeZone: "Asia/Kolkata", ...DEFAULT_HOURS },
    ],
  };
}

export class StateError extends Error {}

const minute = (v) => Number.isInteger(v) && v >= 0 && v <= 1440;

/** Validate anything that came from a link or storage before using it. */
export function validateState(raw) {
  const fail = (what) => {
    throw new StateError(`This link contains an invalid ${what}.`);
  };
  if (!raw || typeof raw !== "object") fail("plan");
  const s = /** @type {Record<string, any>} */ (raw);
  if (typeof s.title !== "string" || s.title.length > 120) fail("title");
  if (!isValidTimeZone(s.anchorZone)) fail("organiser time zone");
  if (!parseDate(s.firstDate)) fail("start date");
  if (![7, 14, 28].includes(s.everyDays)) fail("repeat interval");
  if (!Number.isInteger(s.count) || s.count < 1 || s.count > MAX_COUNT) fail("number of meetings");
  if (!Number.isInteger(s.durationMin) || s.durationMin < 15 || s.durationMin > 240) fail("duration");
  if (!Number.isInteger(s.rotation) || s.rotation < 1 || s.rotation > MAX_ROTATION) fail("rotation size");
  if (!Array.isArray(s.people) || s.people.length > 20) fail("list of people");
  const ids = new Set();
  const people = s.people.map((p) => {
    if (!p || typeof p !== "object") fail("person");
    if (typeof p.id !== "string" || !p.id || p.id.length > 40 || ids.has(p.id)) fail("person");
    ids.add(p.id);
    if (typeof p.name !== "string" || p.name.length > 60) fail("person's name");
    if (!isValidTimeZone(p.timeZone)) fail(`time zone for ${p.name || "a person"}`);
    for (const key of ["workStart", "workEnd", "sleepStart", "sleepEnd"]) if (!minute(p[key])) fail(`hours for ${p.name}`);
    return {
      id: p.id,
      name: p.name,
      timeZone: p.timeZone,
      workStart: p.workStart,
      workEnd: p.workEnd,
      sleepStart: p.sleepStart,
      sleepEnd: p.sleepEnd,
    };
  });
  return {
    title: s.title,
    anchorZone: s.anchorZone,
    firstDate: formatDateISO(/** @type {any} */ (parseDate(s.firstDate))),
    everyDays: s.everyDays,
    count: s.count,
    durationMin: s.durationMin,
    rotation: s.rotation,
    people,
  };
}

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(data) {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** Plans travel in the URL fragment, which browsers never send to a server. */
export function encodeState(state) {
  return `1.${toBase64Url(JSON.stringify(state))}`;
}

export function decodeState(token) {
  if (!token.startsWith("1.")) throw new StateError("This link was made by a different version of fairhour.");
  let raw;
  try {
    raw = JSON.parse(fromBase64Url(token.slice(2)));
  } catch {
    throw new StateError("This link looks incomplete. Ask for it to be shared again.");
  }
  return validateState(raw);
}

export function stateFromHash(hash) {
  const m = /^#?plan=(.+)$/.exec(hash);
  return m ? decodeState(decodeURIComponent(m[1])) : null;
}
