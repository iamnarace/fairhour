import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDays,
  formatClock,
  isValidTimeZone,
  offsetMinutes,
  parseClock,
  parseDate,
  wallTime,
  zonedToUtc,
  zoneLabel,
} from "../src/tz.js";

const iso = (ms) => new Date(ms).toISOString();

describe("offsets", () => {
  it("knows each zone's offset on a given day", () => {
    assert.equal(offsetMinutes(Date.parse("2026-01-15T00:00Z"), "Australia/Sydney"), 660);
    assert.equal(offsetMinutes(Date.parse("2026-07-15T00:00Z"), "Australia/Sydney"), 600);
    assert.equal(offsetMinutes(Date.parse("2026-07-15T00:00Z"), "Asia/Kolkata"), 330);
    assert.equal(offsetMinutes(Date.parse("2026-07-15T00:00Z"), "Asia/Kathmandu"), 345);
    assert.equal(offsetMinutes(Date.parse("2026-01-15T00:00Z"), "America/New_York"), -300);
  });

  it("labels offsets, including non-hour ones", () => {
    assert.equal(zoneLabel(Date.parse("2026-07-15T00:00Z"), "Asia/Kathmandu"), "UTC+5:45");
    assert.equal(zoneLabel(Date.parse("2026-01-15T00:00Z"), "America/New_York"), "UTC−5");
  });
});

describe("zonedToUtc", () => {
  it("converts ordinary wall times", () => {
    const r = zonedToUtc("Australia/Sydney", { year: 2026, month: 10, day: 20, hour: 9, minute: 0 });
    assert.equal(r.status, "ok");
    assert.equal(iso(r.ms), "2026-10-19T22:00:00.000Z");
  });

  it("handles the spring-forward gap (Sydney, 4 Oct 2026, 02:00 -> 03:00)", () => {
    const r = zonedToUtc("Australia/Sydney", { year: 2026, month: 10, day: 4, hour: 2, minute: 30 });
    assert.equal(r.status, "skipped");
    const w = wallTime(r.ms, "Australia/Sydney");
    assert.deepEqual([w.hour, w.minute], [3, 30]);
  });

  it("picks the earlier instant in the fall-back overlap (London, 25 Oct 2026, 01:30 happens twice)", () => {
    const r = zonedToUtc("Europe/London", { year: 2026, month: 10, day: 25, hour: 1, minute: 30 });
    assert.equal(r.status, "ambiguous");
    assert.equal(iso(r.ms), "2026-10-25T00:30:00.000Z");
  });

  it("round-trips every half hour of a DST-change week", () => {
    for (const zone of ["Australia/Sydney", "Europe/London", "America/New_York", "Asia/Kolkata", "Pacific/Chatham"]) {
      for (let day = 0; day < 7; day++) {
        const date = addDays({ year: 2026, month: 10, day: 22 }, day);
        for (let m = 0; m < 1440; m += 30) {
          const r = zonedToUtc(zone, { ...date, hour: Math.floor(m / 60), minute: m % 60 });
          if (r.status === "skipped") continue;
          const w = wallTime(r.ms, zone);
          assert.deepEqual([w.year, w.month, w.day, w.hour, w.minute], [date.year, date.month, date.day, Math.floor(m / 60), m % 60]);
        }
      }
    }
  });
});

describe("dates and clocks", () => {
  it("adds days across month and year ends", () => {
    assert.deepEqual(addDays({ year: 2026, month: 12, day: 29 }, 7), { year: 2027, month: 1, day: 5 });
    assert.deepEqual(addDays({ year: 2028, month: 2, day: 28 }, 1), { year: 2028, month: 2, day: 29 });
  });

  it("parses and rejects dates", () => {
    assert.deepEqual(parseDate("2026-10-27"), { year: 2026, month: 10, day: 27 });
    assert.equal(parseDate("2026-02-30"), null);
    assert.equal(parseDate("27/10/2026"), null);
  });

  it("parses and formats clock times", () => {
    assert.equal(parseClock("07:30"), 450);
    assert.equal(parseClock("24:00"), 1440);
    assert.equal(parseClock("24:30"), null);
    assert.equal(parseClock("7:5"), null);
    assert.equal(formatClock(450), "07:30");
    assert.equal(formatClock(1440), "00:00");
  });

  it("validates zone names", () => {
    assert.equal(isValidTimeZone("Asia/Kathmandu"), true);
    assert.equal(isValidTimeZone("Mars/Olympus_Mons"), false);
    assert.equal(isValidTimeZone(""), false);
  });
});
