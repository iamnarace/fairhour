# Research notes

Research carried out on 2026-10-20.

## Problem and users

Teams spread across many time zones hold recurring meetings (stand-ups, syncs, retros). A fixed time usually lands on the same people outside their working hours every week. Daylight-saving changes, which happen on different dates in Australia, Europe and North America, move local times during a series, often unnoticed until someone misses a meeting.

**Intended users:** team leads and organisers of distributed teams, open-source maintainers with global contributors, and anyone scheduling a recurring call across continents.

## Comparable tools

| Tool | What it does well | What fairhour adds |
|---|---|---|
| timedate.org meeting planner | Scores each candidate slot per participant and recommends the slot that minimises the worst individual sacrifice | Rotation across a series is left to the user (with advice and a history view); fairhour plans the rotation itself |
| Universal Time Date (remote teams planner) | Penalty scoring per UTC hour, top five slots, DST warnings in the scheduling window, saved teams | Scores a single meeting time; fairhour scores each date of the series and searches rotations |
| World Time Buddy, Every Time Zone and similar converters | Fast visual comparison of local times | Comparison only; no scoring, rotation or export of a series |
| Calendar apps' scheduling assistants | Real free/busy data | Optimise for availability on one occurrence, not fairness across a series |

The specific gaps fairhour targets: **automatic rotation**, **scoring on the real dates of a series** (so DST changes count), and **exporting a rotation** as calendar events, since a rotation cannot be one `RRULE`.

## Technical decisions

- **No dependencies, no build.** The core problem needs only `Intl.DateTimeFormat` with the `timeZone` option, which exposes the browser's IANA database. Shipping no time-zone library keeps the app tiny, fully offline after load, and easy to audit. It also contrasts deliberately with the bundler-based stack of a typical React app.
- **Wall time to UTC by offset probing.** `zonedToUtc` tries the zone's offsets 12 hours either side of the target and keeps the candidates that map back to the same wall time: one means normal, two means a fall-back overlap (the earlier instant is used, like most calendar apps), none means a spring-forward gap (the time is moved past the jump). Tested on every half hour of a transition week in five zones.
- **Exhaustive search.** 48 half-hour candidates give at most 17,296 three-slot combinations; each is scored with every rotation order over up to 52 meetings. That runs in about 0.1 seconds, so no heuristic is needed and the result is the true optimum under the model.
- **Min-max fairness.** Minimising the worst-off person's total, rather than the group sum, is what stops one person absorbing every early call.
- **One VEVENT per meeting in UTC**, following RFC 5545 escaping and 75-octet line folding.

## Sources

- timedate.org meeting planner: https://timedate.org/meeting
- Universal Time Date, planner for remote teams: https://www.universaltimedate.com/for-remote-teams
- RFC 5545, iCalendar: https://datatracker.ietf.org/doc/html/rfc5545
- MDN, `Intl.DateTimeFormat` (timeZone option): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat
- MDN, `Intl.supportedValuesOf`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/supportedValuesOf
- IANA Time Zone Database: https://www.iana.org/time-zones
