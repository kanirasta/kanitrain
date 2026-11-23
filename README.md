# kanitrain (PWA)

Static site, no build step. Serve this folder over HTTPS and open it in Safari, then Share > Add to Home Screen.

- `data/` copies of /mnt/project-files/content JSON (plan, exercises, taxonomy). Re-copy when content changes.
- `js/app.js` screens and workout engine, `js/plan.js` step building, muscle freshness, history.
- `js/store.js` localStorage persistence, export/import. `js/i18n.js` EN/ES UI strings.
- `sw.js` offline cache. Bump VERSION on every change so phones update.

Local test: `python3 -m http.server 8765` in this folder.
