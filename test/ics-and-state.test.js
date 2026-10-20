import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCalendar, escapeText, foldLine, icsDate } from "../src/ics.js";
import { decodeState, encodeState, exampleState, stateFromHash, StateError, validateState } from "../src/state.js";

describe("iCalendar", () => {
  it("formats UTC timestamps", () => {
    assert.equal(icsDate(Date.parse("2026-10-27T22:05:09Z")), "20261027T220509Z");
  });

  it("escapes text values", () => {
    assert.equal(escapeText("Sync; agenda, notes\nline 2 \\ end"), "Sync\\; agenda\\, notes\\nline 2 \\\\ end");
  });

  it("folds long lines at 75 octets without splitting characters", () => {
    const line = "DESCRIPTION:" + "Mia 09:00 · Tom 22:00 · ".repeat(8) + "नमस्ते";
    const folded = foldLine(line);
    for (const part of folded.split("\r\n")) assert.ok(new TextEncoder().encode(part).length <= 75);
    assert.equal(folded.split("\r\n").map((p, i) => (i ? p.slice(1) : p)).join(""), line);
  });

  it("builds one event per meeting with CRLF line endings", () => {
    const events = [
      { startMs: Date.parse("2026-10-20T01:30Z"), endMs: Date.parse("2026-10-20T02:15Z") },
      { startMs: Date.parse("2026-10-27T10:30Z"), endMs: Date.parse("2026-10-27T11:15Z") },
    ];
    const ics = buildCalendar({ title: "Product sync", events, uidPrefix: "abc", now: Date.parse("2026-10-20T00:00Z") });
    assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
    assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
    assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 2);
    assert.ok(ics.includes("DTSTART:20261027T103000Z"));
    assert.ok(ics.includes("SUMMARY:Product sync (2 of 2)"));
    assert.ok(ics.includes("UID:abc-1@fairhour"));
    assert.ok(!/[^\r]\n/.test(ics), "every newline is CRLF");
  });
});

describe("shared plans", () => {
  it("round-trips a plan", () => {
    const s = exampleState("2026-10-20");
    assert.deepEqual(decodeState(encodeState(s)), s);
    assert.deepEqual(stateFromHash(`#plan=${encodeState(s)}`), s);
    assert.equal(stateFromHash("#other"), null);
  });

  it("rejects bad or tampered plans with a clear message", () => {
    const s = exampleState("2026-10-20");
    assert.throws(() => decodeState("1.%%%"), StateError);
    assert.throws(() => decodeState("2.abc"), /different version/);
    assert.throws(() => validateState({ ...s, anchorZone: "Nowhere/Land" }), /organiser time zone/);
    assert.throws(() => validateState({ ...s, firstDate: "2026-13-01" }), /start date/);
    assert.throws(() => validateState({ ...s, count: 500 }), /number of meetings/);
    assert.throws(() => validateState({ ...s, everyDays: 3 }), /repeat interval/);
    assert.throws(
      () => validateState({ ...s, people: [{ ...s.people[0], timeZone: "Bad/Zone" }] }),
      /time zone for Mia/,
    );
    assert.throws(() => validateState({ ...s, people: [s.people[0], s.people[0]] }), /person/);
  });

  it("drops unknown fields instead of carrying them along", () => {
    const s = exampleState("2026-10-20");
    const raw = { ...s, extra: "x", people: s.people.map((p) => ({ ...p, evil: "<script>" })) };
    const clean = validateState(raw);
    assert.equal("extra" in clean, false);
    assert.equal("evil" in clean.people[0], false);
  });
});
