// Renders a realistic model through the real app and writes a docs-quality SVG.
// Run: DSH_SMOKE_DIR="$HOME/ufa-smoke" node tests/render-sample.mjs
// The sample model is the v2 block model: Value inputs feeding Compute blocks
// (op mode and expr mode), with outcomes marked on the Compute blocks.
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
const require = createRequire(process.env.DSH_SMOKE_DIR + '/probe.js');
const { JSDOM } = require('jsdom');
const root = fileURLToPath(new URL('../', import.meta.url));
const fsP = await import('node:fs/promises');
const html = await fsP.readFile(root + 'docs/index.html', 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const win = dom.window; const doc = win.document;
globalThis.window = win; globalThis.document = doc; globalThis.localStorage = win.localStorage;
globalThis.confirm = () => true; globalThis.XMLSerializer = win.XMLSerializer;
globalThis.Blob = win.Blob; globalThis.URL = win.URL; globalThis.Image = win.Image;
globalThis.FileReader = win.FileReader; globalThis.HTMLElement = win.HTMLElement;
win.Element.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800, x: 0, y: 0 }; };

function compute(spec) {
  return Object.assign({
    type: 'compute', mode: 'op', op: 'add', title: '', terms: ['a', 'b'], expr: '',
    inputs: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }], outcome: false, displayUnit: ''
  }, spec);
}

const model = {
  version: 2,
  name: 'Monthly profit',
  blocks: [
    { id: 'in_price', type: 'input', x: 0, y: 0, name: 'price', value: 49, unit: '$/unit', min: 39, likely: 49, max: 59 },
    { id: 'in_vol', type: 'input', x: 0, y: 170, name: 'volume', value: 1200, unit: 'units', min: 800, likely: 1200, max: 1600 },
    { id: 'in_cost', type: 'input', x: 0, y: 340, name: 'cost', value: 18, unit: '$/unit', min: 15, likely: 18, max: 22 },
    { id: 'in_fixed', type: 'input', x: 0, y: 510, name: 'fixed', value: 9500, unit: '$' },
    { id: 'in_fees', type: 'input', x: 0, y: 680, name: 'fees', value: 400, unit: '$' },
    compute({ id: 'op_rev', x: 320, y: 60, op: 'mul', title: 'revenue' }),
    compute({ id: 'op_var', x: 320, y: 380, op: 'mul', title: 'variable cost' }),
    compute({ id: 'op_tot', x: 630, y: 300, op: 'add', title: 'total cost', terms: ['a', 'b', 'c'], inputs: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }, { id: 'c', name: 'c' }] }),
    compute({ id: 'op_profit', x: 630, y: 60, op: 'sub', title: 'Monthly profit', outcome: true, displayUnit: '$' }),
    compute({ id: 'op_margin', x: 940, y: 130, mode: 'expr', title: 'profit margin', expr: 'profit / revenue', inputs: [{ id: 'p', name: 'profit' }, { id: 'r', name: 'revenue' }], outcome: true, displayUnit: '%' })
  ],
  wires: [
    { id: 'w1', from: 'in_price', to: 'op_rev', toPort: 'a' },
    { id: 'w2', from: 'in_vol', to: 'op_rev', toPort: 'b' },
    { id: 'w3', from: 'in_cost', to: 'op_var', toPort: 'a' },
    { id: 'w4', from: 'in_vol', to: 'op_var', toPort: 'b' },
    { id: 'w5', from: 'op_var', to: 'op_tot', toPort: 'a' },
    { id: 'w6', from: 'in_fixed', to: 'op_tot', toPort: 'b' },
    { id: 'w10', from: 'in_fees', to: 'op_tot', toPort: 'c' },
    { id: 'w7', from: 'op_rev', to: 'op_profit', toPort: 'a' },
    { id: 'w8', from: 'op_tot', to: 'op_profit', toPort: 'b' },
    { id: 'w11', from: 'op_profit', to: 'op_margin', toPort: 'p' },
    { id: 'w12', from: 'op_rev', to: 'op_margin', toPort: 'r' }
  ]
};

// sanity: the sample must evaluate cleanly and show both outcomes
const problems = [];
const { evaluateModel, validateModel } = await import(pathToFileURL(root + 'docs/js/engine.js').href);
const ev = evaluateModel(model);
if (!ev.ok) problems.push('model does not evaluate: ' + ev.errors.join(' | '));
if (ev.results.length !== 2) problems.push('expected two outcomes, got ' + ev.results.length);
const issues = validateModel(model, ev.values);
if (issues.length) problems.push('validation issues: ' + issues.join(' | '));

win.localStorage.setItem('ufa.model.v2', JSON.stringify(model));

await import(pathToFileURL(root + 'docs/js/main.js').href);
const { buildSvgString } = await import(pathToFileURL(root + 'docs/js/exporter.js').href);
const svg = doc.getElementById('canvas');
const out = buildSvgString(svg, model);
if (out.indexOf('RESULT') < 0) problems.push('rendered SVG shows no RESULT label');
if (out.indexOf('profit margin') < 0) problems.push('rendered SVG misses the expression block');
const outDir = process.env.OUT_DIR || root;
await fsP.writeFile(outDir + 'sample.svg', out, 'utf8');
const sens = doc.getElementById('sensitivityBody').textContent;
console.log('RESULT_TEXT: ' + sens.slice(0, 120));
console.log('OUTCOMES: ' + ev.results.map((x) => x.title + ' = ' + (x.display || x.error)).join(' | '));
console.log('SVG_BYTES: ' + out.length);
console.log('WROTE: ' + outDir + 'sample.svg');
if (problems.length) {
  for (const p of problems) console.error('FAIL ' + p);
  process.exit(1);
}
