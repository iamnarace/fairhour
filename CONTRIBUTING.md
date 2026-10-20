# Contributing to fairhour

Thanks for helping. fairhour deliberately has **no runtime or build dependencies**; please keep it that way. If a change seems to need a library, open an issue first to discuss it.

## Run and test

```bash
python3 -m http.server 8000   # then open http://localhost:8000
npm test                      # unit tests (Node 20+), no install step
npm run check                 # syntax check of every module
npm run test:e2e              # browser tests: pip install playwright && playwright install chromium
```

## Guidelines

- Time-zone changes need tests in `test/tz.test.js` that use real transition dates; say which zone and date in the test name.
- Changes to scoring (`src/cost.js`) or the search (`src/plan.js`) should explain the effect on the example team in the pull request, and update the "How fairness is scored" section of the README.
- Build DOM with the `h()` helper in `src/dom.js`; never insert user-provided text as HTML.
- Keep text in the interface plain and specific: say what happens and what to do.
- Add an entry under "Unreleased" in `CHANGELOG.md`.

## Reporting bugs

Please include the share link for the plan (it contains no data beyond what you entered), your browser and version, and what you expected to see.
