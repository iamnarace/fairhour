# Changelog

All notable changes are documented here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-20

### Added

- Rotation planner: exhaustive search over 1–3 half-hour slots, min-max fairness across a series of up to 52 meetings.
- Per-person work and sleep hours, local weekends, and a documented 0/1/2/5 points-per-hour model.
- DST-correct conversion between wall time and UTC using the browser's IANA data, including gaps and overlaps.
- Notices when someone's local time shifts mid-series, and when no time avoids someone's night.
- Overlap chart, meeting-by-meeting schedule, `.ics` export, share links and copy-as-text.
- Unit tests on Node's test runner and Playwright browser tests.
