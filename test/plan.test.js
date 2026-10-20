import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bandAt, inRange, meetingCost } from "../src/cost.js";
import { dstChanges, planSeries } from "../src/plan.js";
import { DEFAULT_HOURS, exampleState } from "../src/state.js";
import { formatClock, wallTime } from "../src/tz.js";

const person = (id, timeZone, hours = {}) => ({ id, name: id, timeZone, ...DEFAULT_HOURS, ...hours });
const series = (overrides = {}) => ({
  anchorZone: "Australia/Sydney",
  firstDate: { year: 2026, month: 10, day: 20 },
  everyDays: 7,
  count: 12,
  durationMin: 45,
  rotation: 3,
  ...overrides,
});

describe("cost model", () => {
  it("handles ranges that wrap past midnight", () => {
    assert.equal(inRange(23 * 60, 22 * 60, 7 * 60), true);
    assert.equal(inRange(6 * 60, 22 * 60, 7 * 60), true);
    assert.equal(inRange(12 * 60, 22 * 60, 7 * 60), false);
    assert.equal(inRange(5, 5, 5), false);
  });

  it("puts each moment in the right band", () => {
    const p = person("a", "UTC");
    assert.equal(bandAt(p, 10 * 60, 2), "work");
    assert.equal(bandAt(p, 8 * 60, 2), "edge");
    assert.equal(bandAt(p, 10 * 60, 6), "weekend");
    assert.equal(bandAt(p, 3 * 60, 6), "night");
  });

  it("charges per 15 minutes in the person's own time zone", () => {
    const p = person("a", "Europe/London");
    // 16:30–17:30 London on a Tuesday: half in work hours (0), half after (1/h) => 0.5 points.
    const cost = meetingCost(p, Date.parse("2026-11-03T16:30Z"), 60);
    assert.equal(cost.points, 0.5);
    assert.equal(cost.band, "edge");
    // A 1-hour meeting at 02:00 London is 5 points.
    assert.equal(meetingCost(p, Date.parse("2026-11-03T02:00Z"), 60).points, 5);
  });

  it("counts a Friday afternoon elsewhere as Saturday for Sydney", () => {
    const sydney = person("a", "Australia/Sydney");
    const cost = meetingCost(sydney, Date.parse("2026-11-06T23:00Z"), 60); // Sat 10:00 AEDT
    assert.equal(cost.band, "weekend");
  });
});

describe("planSeries", () => {
  it("finds a time with no inconvenience when one exists", () => {
    const people = [person("a", "Australia/Sydney"), person("b", "Australia/Brisbane")];
    const { fixed, rotated } = planSeries(people, series());
    assert.equal(fixed.worst, 0);
    assert.equal(rotated.worst, 0);
  });

  it("shares the burden more fairly than any fixed time for the example team", () => {
    const s = exampleState("2026-10-20");
    const { fixed, rotated } = planSeries(s.people, series());
    assert.ok(rotated.worst < fixed.worst, `rotation worst ${rotated.worst} should beat fixed ${fixed.worst}`);
    assert.equal(rotated.slots.length, 3);
    assert.equal(rotated.occurrences.length, 12);
    // Totals add up from the per-meeting costs.
    const recomputed = s.people.map((_, p) => rotated.occurrences.reduce((a, o) => a + o.costs[p].points, 0));
    assert.deepEqual(recomputed, rotated.totals);
  });

  it("never does worse than the best fixed time", () => {
    const zones = ["Europe/Berlin", "America/Los_Angeles", "Asia/Tokyo", "America/Sao_Paulo", "Asia/Kathmandu"];
    for (let i = 0; i < zones.length; i++) {
      const people = [person("x", "Australia/Sydney"), person("y", zones[i]), person("z", zones[(i + 2) % zones.length])];
      for (const rotation of [2, 3]) {
        const { fixed, rotated } = planSeries(people, series({ rotation, count: 8 }));
        assert.ok(rotated.worst <= fixed.worst);
      }
    }
  });

  it("keeps meetings at the organiser's wall time across their DST change", () => {
    const people = [person("a", "Australia/Sydney"), person("b", "Europe/London")];
    const { rotated } = planSeries(people, series({ firstDate: { year: 2026, month: 9, day: 22 }, rotation: 1, count: 4 }));
    // Sydney moves to AEDT on 4 Oct; the Sydney wall time must not move.
    const times = rotated.occurrences.map((o) => {
      const w = wallTime(o.startMs, "Australia/Sydney");
      return formatClock(w.hour * 60 + w.minute);
    });
    assert.equal(new Set(times).size, 1);
  });

  it("reports when someone's clock changes relative to the organiser", () => {
    const people = [person("syd", "Australia/Sydney"), person("lon", "Europe/London"), person("ny", "America/New_York")];
    const { rotated } = planSeries(people, series({ rotation: 1, count: 4 }));
    const notes = dstChanges(people, "Australia/Sydney", rotated.occurrences);
    // London leaves BST on 25 Oct (between meetings 0 and 1), New York leaves EDT on 1 Nov (1 and 2).
    assert.deepEqual(
      notes.map((n) => [n.occurrence, people[n.person].id, n.minutes]),
      [
        [1, "lon", -60],
        [2, "ny", -60],
      ],
    );
  });

  it("validates its inputs", () => {
    assert.throws(() => planSeries([], series()), /at least one person/);
    const { rotated } = planSeries([person("a", "UTC")], series({ rotation: 9, count: 2 }));
    assert.ok(rotated.slots.length <= 2);
  });
});
