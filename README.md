# kanitrain (PWA)

Static site, no build step. Serve this folder over HTTPS and open it in Safari, then Share > Add to Home Screen.

- `data/` copies of /mnt/project-files/content JSON (plan, exercises, taxonomy). Re-copy when content changes.
- `js/app.js` screens and workout engine, `js/plan.js` step building, muscle freshness, history.
- `js/store.js` localStorage persistence, export/import. `js/i18n.js` EN/ES UI strings.
- `sw.js` offline cache. Bump VERSION on every change so phones update.

Local test: `python3 -m http.server 8765` in this folder.

## Tests
`npm test` runs tap-through tests on an emulated iPhone 15 Pro (33 checks: popups, day switch, full workout, timers, skip, back, resume, summary, history, settings, backup). Run before every push.
`BROWSER=webkit npm test` uses WebKit if installed (`npx playwright install webkit`).
