// Renders a realistic model through the real app and writes docs-quality SVG + PNG.
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

const model = {
  version: 1,
  name: 'Monthly profit',
  blocks: [
    { id: 'in_price', type: 'input', x: 0, y: 0, name: 'price', value: 49, unit: '$/unit', min: 39, likely: 49, max: 59 },
    { id: 'in_vol', type: 'input', x: 0, y: 170, name: 'volume', value: 1200, unit: 'units', min: 800, likely: 1200, max: 1600 },
    { id: 'in_cost', type: 'input', x: 0, y: 340, name: 'cost', value: 18, unit: '$/unit', min: 15, likely: 18, max: 22 },
    { id: 'in_fixed', type: 'input', x: 0, y: 510, name: 'fixed', value: 9500, unit: '$' },
    { id: 'op_rev', type: 'op', x: 320, y: 60, op: 'mul', title: 'revenue' },
    { id: 'op_var', type: 'op', x: 320, y: 380, op: 'mul', title: 'variable cost' },
    { id: 'op_tot', type: 'op', x: 630, y: 300, op: 'add', title: 'total cost' },
    { id: 'op_profit', type: 'op', x: 630, y: 60, op: 'sub', title: 'profit' },
    { id: 'res', type: 'result', x: 940, y: 130, title: 'Monthly profit', displayUnit: '$' }
  ],
  wires: [
    { id: 'w1', from: 'in_price', to: 'op_rev', toPort: 'a' },
    { id: 'w2', from: 'in_vol', to: 'op_rev', toPort: 'b' },
    { id: 'w3', from: 'in_cost', to: 'op_var', toPort: 'a' },
    { id: 'w4', from: 'in_vol', to: 'op_var', toPort: 'b' },
    { id: 'w5', from: 'op_var', to: 'op_tot', toPort: 'a' },
    { id: 'w6', from: 'in_fixed', to: 'op_tot', toPort: 'b' },
    { id: 'w7', from: 'op_rev', to: 'op_profit', toPort: 'a' },
    { id: 'w8', from: 'op_tot', to: 'op_profit', toPort: 'b' },
    { id: 'w9', from: 'op_profit', to: 'res', toPort: 'in' }
  ]
};
const picked = process.env.EXAMPLE ? (await import(pathToFileURL(root + 'docs/js/examples.js').href)).EXAMPLES.find((e) => e.id === process.env.EXAMPLE) : null;
const useModel = picked ? picked.model : model;
win.localStorage.setItem('ufa.model.v1', JSON.stringify(useModel));

await import(pathToFileURL(root + 'docs/js/main.js').href);
const { buildSvgString } = await import(pathToFileURL(root + 'docs/js/exporter.js').href);
const svg = doc.getElementById('canvas');
const out = buildSvgString(svg, useModel);
await fsP.writeFile(process.env.OUT_DIR + '/sample.svg', out, 'utf8');
const sens = doc.getElementById('sensitivityBody').textContent;
console.log('RESULT_TEXT: ' + sens.slice(0, 120));
console.log('SVG_BYTES: ' + out.length);
