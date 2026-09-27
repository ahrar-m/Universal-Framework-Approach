# Universal Framework Approach

A visual, block-based modelling tool. Any calculation — profit, process efficiency, a
product-design score — is assembled from **small blocks that plug into one main
equation**, and the final block gives the outcome. It replaces the spreadsheet with a
canvas: every intermediate value is visible, units are dimensionally checked, and the
tool tells you **which input actually drives the result**.

**Live site:** <https://ahrar-m.github.io/Universal-Framework-Approach/>
**Methodology + walkthrough:** <https://ahrar-m.github.io/Universal-Framework-Approach/methodology.html>

## What it does

| Capability | Detail |
| --- | --- |
| Drag-and-connect canvas | Blocks are cards with ports; wires carry values; works with mouse and touch (tap a port, then tap the destination) |
| Four block types | **Value input** (named number, unit, optional min/likely/max), **Operation** (add, subtract, multiply, divide, power, min, max, round, percent-of), **Formula** (typed expression over named inputs), **Result** (final outcome, optional display unit) |
| Dimensional unit checking | Add/subtract require the same kind of quantity; multiply/divide combine units (`$/unit × units → $`); percentages scale without changing the unit; compatible units convert automatically (`30 min + 1 hr → 90 min`); incompatible mixes are refused in plain language |
| Domain-agnostic units | Knows `$`, `k$`, `M$`, `%`, `x`, `units`, `users`, `customers`, `hrs`, `min`, `days`, `$/unit`, `units/hrs`, `$/hrs` — and any other word you type becomes its own unit |
| Live values | Every block and wire shows its current value while you edit |
| Sensitivity ranking | "What moves the result": inputs ranked by their effect on the final number (min→max swing when a range is given, otherwise a +1% change) |
| Export | Crisp vector **SVG**, high-resolution **PNG** (3x), and **JSON** model files in/out |
| Persistence | Autosaves to the browser (localStorage); JSON export/import moves models between devices |

Everything runs client-side: no build step, no dependencies, no network calls.

## Repository layout

| Path | Purpose |
| --- | --- |
| `docs/index.html` | The tool — the site's home page |
| `docs/app.css` | Dark technical / blueprint theme |
| `docs/js/units.js` | Unit parsing, dimensional algebra, formatting |
| `docs/js/expr.js` | Safe expression parser for Formula blocks (no `eval`) |
| `docs/js/engine.js` | Model evaluation, unit propagation, sensitivity analysis |
| `docs/js/canvas.js` | SVG node-graph rendering and pointer interaction |
| `docs/js/exporter.js` | SVG / PNG / JSON export and import |
| `docs/js/main.js` | Application controller: palette, inspector, persistence |
| `docs/methodology.html` | The approach + a from-scratch walkthrough |
| `tests/engine.test.mjs` | Engine unit tests (units, expressions, evaluation, sensitivity) |
| `tests/ui.smoke.mjs` | Boots the real app in jsdom and drives it like a user |
| `.github/workflows/pages.yml` | Deploys `docs/` to GitHub Pages on every push to `main` |

## Local development

The site is plain HTML/CSS/JS with no build step. Preview it with any static server:

```bash
python3 -m http.server 8000 --directory docs
```

Then open <http://localhost:8000/>. A server (rather than opening the file directly) is
required because the app uses ES modules.

## Tests

```bash
node tests/engine.test.mjs
```

The UI smoke test drives the actual page in jsdom (install it once, anywhere):

```bash
npm install jsdom          # e.g. in ~/ufa-smoke
DSH_SMOKE_DIR=~/ufa-smoke node tests/ui.smoke.mjs
```

## Deploying

Every push to `main` publishes `docs/` through GitHub Pages:

```bash
git add -A
git commit -m "Update site"
git push
```
