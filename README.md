# Universal Framework Approach

A visual, block-based modelling tool. Any calculation — profit, process efficiency, a
product-design score — is assembled from **small blocks that plug into one main
equation**, and any Compute block can be marked as a **green outcome card** &mdash; as many
as you need. It replaces the spreadsheet with a canvas: every intermediate value is
visible, units are dimensionally checked, and the tool tells you **which input actually
drives the result**.

**Live site:** <https://ahrar-m.github.io/Universal-Framework-Approach/>
**Methodology + walkthrough:** <https://ahrar-m.github.io/Universal-Framework-Approach/methodology.html>

## What it does

| Capability | Detail |
| --- | --- |
| Forgiving wiring | Blocks are cards with ports and wires carry values. Wires <strong>magnetise to the nearest legal port</strong> as you drag, dropping a wire anywhere on a card uses that card's first free input (growing a new one on Add/Multiply when needed), and touch works by tap-a-port-then-tap-the-card. <strong>Press and hold a port</strong> (or right-click it) to add a new block that is already wired to it &mdash; <em>Add Value input here</em> or <em>Add Compute here</em> on an input port, <em>Add Compute here</em> on an output &mdash; plus <em>Start a wire</em> and <em>Disconnect</em>. Compatible ports glow while a link is being made; tap a wire to select it and press <em>Delete wire</em> to remove it &mdash; works on a phone, where there is no Delete key |
| Named as you add it | Adding a block asks for its essentials first &mdash; Value input: <strong>name, unit, value</strong>; Compute: <strong>name and how it should compute</strong> (a ready operation and which one, or a typed expression whose names become the block's inputs) &mdash; so the card that lands on the canvas is already named. Enter adds it, Esc cancels and leaves nothing behind |
| Auto-arrange | <code>Arrange</code> glides the blocks into flow order instead of snapping &mdash; every value input lands beside the block it is wired into (lined up with the port it feeds, never parked in a far-left column), results on the right, columns ordered to keep wires short and crossings few, and each unrelated branch in its own horizontal band so wires never intertwine |
| Compact cards and focus view | <code>Compact</code> (or the card's <code>&#8722;</code> button) shrinks cards to a mini name-and-value overview so a whole model fits on one screen; the target button on a card &mdash; or <code>Focus this branch</code> in Block settings &mdash; opens one block with everything it is built from, on its own. Entering and leaving Focus <strong>never moves the camera</strong>, so a large graph stays where you left it &mdash; switch on <em>Auto-fit camera</em> in the View menu if you would rather it re-frames the branch |
| Roomy toolbars | The canvas cluster at the bottom left keeps just <code>&#8722;</code> and <code>+</code>; one <em>View</em> button pops out <code>1:1</code>, <code>Fit</code>, <code>Arrange</code>, <code>Compact</code> and the <em>Auto-fit camera</em> switch. Every model action &mdash; New, Import, Export JSON/SVG/PNG, Clear data &mdash; sits behind the <em>Settings</em> gear at the top right |
| Two block types | **Value input** (named number, unit, optional min/likely/max) and **Compute** &mdash; one combination block with <strong>two faces</strong>, chosen in the add dialog (<em>How should it compute?</em>) and switchable in Block settings: a **ready operation** (Add, Subtract, Multiply, Divide, Power, Minimum, Maximum, Round, Percent of) or a **typed expression** over named inputs (safe parser, no <code>eval</code>; functions like min/max/round/floor/ceil/abs/sqrt/pow/exp/ln/log/sign) |
| Marked outcomes | Outcomes are not a block of their own &mdash; any Compute block can be **marked as an outcome** with <em>Mark as a result</em> in Block settings. Marking gives the card green RESULT styling, an optional **Display unit**, a place in the <em>Results and what moves them</em> panel, and per-outcome sensitivity ranking. Marking <strong>never changes the wiring</strong> &mdash; a marked block still feeds wires onward, so it can be both an outcome and an intermediate step. Mark as many as you need |
| Endless operation inputs | **Add, Multiply, Min and Max take any number of inputs** &mdash; grow or shrink the list with the block's <code>+ add input</code> row or the <code>Add input</code> button in Block settings. Empty ports are ignored, one connected input passes straight through, and every term is unit-checked. Subtract, Divide, Power, Round and Percent of keep their two ports |
| Dimensional unit checking | Add/subtract require the same kind of quantity; multiply/divide combine units (`$/unit × units → $`); percentages scale without changing the unit; compatible units convert automatically (`30 min + 1 hr → 90 min`); incompatible mixes are refused in plain language &mdash; and labels cancel and simplify along the way (<code>&#8377;/tower</code> &times; <code>tower</code> &rarr; <code>&#8377;</code>) |
| Domain-agnostic units | Knows `$`, `k$`, `M$`, `%`, `x`, `units`, `users`, `customers`, `hrs`, `min`, `days`, `$/unit`, `units/hrs`, `$/hrs` — and any other word you type becomes its own unit — the unit picker suggests only the units your model already uses, never defaults |
| Live values | Every block and wire shows its current value while you edit |
| Sensitivity ranking | "What moves them": every marked outcome gets its own ranking of inputs by their effect (min→max swing when a range is given, otherwise a +1% change) |
| Export | Crisp vector **SVG**, high-resolution **PNG** (3x), and **JSON** model files in/out. Every export is suffixed with a date-timestamp &mdash; e.g. `monthly-profit-20250929-142530.svg` &mdash; so repeated exports never overwrite each other |
| Clear data | One button (in the Settings menu) deletes everything the site saved in your browser |
| Persistence | Autosaves to the browser (localStorage); JSON export/import moves models between devices. Model files are version 2 &mdash; exports and saves from older versions are not migrated, so the app opens a fresh model and says so |

Everything runs client-side: no build step, no dependencies, no network calls.

## Repository layout

| Path | Purpose |
| --- | --- |
| `docs/index.html` | The tool — the site's home page |
| `docs/app.css` | Dark technical / blueprint theme |
| `docs/js/units.js` | Unit parsing, dimensional algebra, formatting |
| `docs/js/expr.js` | Safe expression parser for typed expressions (no `eval`) |
| `docs/js/engine.js` | Model evaluation, unit propagation, sensitivity analysis |
| `docs/js/canvas.js` | SVG node-graph rendering and pointer interaction |
| `docs/js/exporter.js` | SVG / PNG / JSON export and import |
| `docs/js/main.js` | Application controller: palette, inspector, persistence |
| `docs/methodology.html` | The approach + a from-scratch walkthrough |
| `tests/engine.test.mjs` | Engine unit tests (units, expressions, evaluation, sensitivity) |
| `tests/ui.smoke.mjs` | Boots the real app in jsdom and drives it like a user |
| `tests/render-sample.mjs` | Renders a realistic model through the app and writes SVG/PNG for visual review |
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

To render a sample model for a visual check (writes `sample.svg`; convert it to a PNG
with rsvg-convert or any SVG renderer):

```bash
OUT_DIR=~ DSH_SMOKE_DIR=~/ufa-smoke node tests/render-sample.mjs
rsvg-convert -w 1500 ~/sample.svg -o ~/sample.png
```

## Deploying

Every push to `main` publishes `docs/` through GitHub Pages:

```bash
git add -A
git commit -m "Update site"
git push
```

### Keep commits attributed to your account

GitHub links a commit to your account only when the commit's author email is one the
account owns - a verified email address or your GitHub noreply address
(`<id>+<username>@users.noreply.github.com`, listed under *Settings -> Emails*).
A commit pushed with any other address, such as `noreply@users.noreply.github.com`,
is not linked to anyone and shows up as a separate contributor named **"noreply"**.
Check the identity before committing:

```bash
git config user.name     # your display name, e.g. Ahrar Muhammad
git config user.email    # e.g. 114912814+ahrar-m@users.noreply.github.com
```
