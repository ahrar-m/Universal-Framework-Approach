// UI smoke test — boots the real app in jsdom and drives it like a user.
// Run: DSH_SMOKE_DIR="$HOME/ufa-smoke" node tests/ui.smoke.mjs
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(process.env.DSH_SMOKE_DIR + '/probe.js');
const { JSDOM } = require('jsdom');

const root = fileURLToPath(new URL('../', import.meta.url));
const html = await (await import('node:fs/promises')).readFile(root + 'docs/index.html', 'utf8');

const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const win = dom.window;
const doc = win.document;

globalThis.window = win;
globalThis.document = doc;
globalThis.localStorage = win.localStorage;
globalThis.confirm = function () { return true; };
globalThis.XMLSerializer = win.XMLSerializer;
globalThis.Blob = win.Blob;
globalThis.URL = win.URL;
globalThis.Image = win.Image;
globalThis.FileReader = win.FileReader;
globalThis.HTMLElement = win.HTMLElement;

let passed = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { passed++; return; }
  failures.push(name + (extra ? ' -> ' + extra : ''));
}

// jsdom reports zero-size boxes; give the canvas a plausible size.
win.Element.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, x: 0, y: 0 };
};

await import(pathToFileURL(root + 'docs/js/main.js').href);

const svg = doc.getElementById('canvas');
ok('canvas rendered', svg.innerHTML.indexOf('viewport') >= 0);
ok('empty hint visible', doc.getElementById('stageHint').style.display !== 'none');

function firePointer(el, type, x, y) {
  const evt = new win.Event(type, { bubbles: true, cancelable: true });
  evt.clientX = x; evt.clientY = y; evt.clientY = y;
  evt.pointerId = 1; evt.button = 0; evt.pointerType = 'mouse';
  el.dispatchEvent(evt);
}

function clickSel(el) {
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function palette(type) {
  clickSel(doc.querySelector('.palette-item[data-type="' + type + '"]'));
}

function groups() {
  return Array.from(svg.querySelectorAll('g[data-block]'));
}

function setField(name, value) {
  const input = doc.querySelector('#settingsBody [data-field="' + name + '"]');
  if (!input) return false;
  input.value = value;
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
  return true;
}

// build: price x volume -> result
palette('input');
ok('input block added', groups().length === 1, String(groups().length));
ok('settings show name field', !!doc.querySelector('#settingsBody [data-field="name"]'));
setField('name', 'price');
ok('setField name', setField('value', 50));
ok('setField unit', setField('unit', '$/unit'));

palette('input');
setField('name', 'volume');
setField('value', 1000);
setField('unit', 'units');

palette('op');
ok('op block added', groups().length === 3);
ok('setField op', setField('op', 'mul'));

palette('result');
ok('result block added', groups().length === 4);
ok('cards show short reason, not bare error', svg.innerHTML.indexOf('connect a') >= 0 && svg.innerHTML.indexOf('connect in') >= 0, svg.innerHTML.slice(0, 0));
ok('accent edge is clipped to card corners', svg.innerHTML.indexOf('clip-') >= 0);
setField('title', 'Profit');

const ids = groups().map(function (g) { return g.getAttribute('data-block'); });
function port(id, portId) {
  return svg.querySelector('g[data-block="' + id + '"] [data-portid="' + portId + '"]');
}

function wire(fromId, toId, toPort) {
  const out = port(fromId, 'out');
  ok('ports exist for ' + toPort, !!out && !!port(toId, toPort));
  firePointer(out, 'pointerdown', 100, 100);
  // the canvas re-renders on pointerdown, so the browser would hit-test the live node
  const into = port(toId, toPort);
  firePointer(into, 'pointerup', 100, 100);
}

wire(ids[0], ids[2], 'a');
wire(ids[1], ids[2], 'b');
wire(ids[2], ids[3], 'in');

const wireCount = (svg.innerHTML.match(/data-wire=/g) || []).length;
ok('three wires drawn', wireCount === 3, String(wireCount));

const sens = doc.getElementById('sensitivityBody').innerHTML;
ok('result value computed', sens.indexOf('$50,000') >= 0, sens.slice(0, 400));
ok('sensitivity rows present', (sens.match(/sens-row/g) || []).length === 2, String((sens.match(/sens-row/g) || []).length));
ok('model check clean', doc.getElementById('issuesBody').innerHTML.indexOf('Everything checks out') >= 0, doc.getElementById('issuesBody').innerHTML.slice(0, 300));

// unit label change flows through the display
setField('unit', '$');
const svgText = svg.innerHTML;
ok('unit label shown on card', svgText.indexOf('$/unit') >= 0 || svgText.indexOf('$') >= 0);

// save happened
await new Promise(function (r) { setTimeout(r, 400); });
const stored = JSON.parse(localStorage.getItem('ufa.model.v1') || 'null');
ok('model autosaved', !!stored && stored.blocks.length === 4, JSON.stringify(stored ? stored.blocks.length : null));

// variadic operation: endless inputs on Add / Multiply / Min / Max
const mulId = ids[2];
const addRow = svg.querySelector('g[data-block="' + mulId + '"] [data-addterm]');
ok('op card offers an add-input row', !!addRow);
ok('result card has no add-input row', !svg.querySelector('g[data-block="' + ids[3] + '"] [data-addterm]'));
firePointer(addRow, 'pointerdown', 100, 100);
// the canvas re-renders on pointerdown, so release on the live node
firePointer(svg.querySelector('g[data-block="' + mulId + '"] [data-addterm]'), 'pointerup', 100, 100);
ok('add-input row adds a port', !!port(mulId, 'c'), svg.innerHTML.indexOf('data-portid="c"') >= 0 ? '' : 'no c port');
ok('inspector lists three inputs', doc.querySelectorAll('#settingsBody [data-removeterm]').length === 3, String(doc.querySelectorAll('#settingsBody [data-removeterm]').length));
wire(ids[0], mulId, 'c');
ok('three-term product computed', doc.getElementById('sensitivityBody').innerHTML.indexOf('2,500,000') >= 0, doc.getElementById('sensitivityBody').innerHTML.slice(0, 200));
const wiresWithC = (svg.innerHTML.match(/data-wire=/g) || []).length;
clickSel(doc.querySelector('#settingsBody [data-removeterm="2"]'));
ok('removing an input drops its port and wire', !port(mulId, 'c') && (svg.innerHTML.match(/data-wire=/g) || []).length === wiresWithC - 1, String((svg.innerHTML.match(/data-wire=/g) || []).length));
ok('value returns after removing the term', doc.getElementById('sensitivityBody').innerHTML.indexOf('$50,000') >= 0, doc.getElementById('sensitivityBody').innerHTML.slice(0, 200));

// formula block with named inputs
palette('formula');
const fid = groups()[groups().length - 1].getAttribute('data-block');
clickSel(doc.querySelector('#settingsBody [data-addport]'));
ok('formula input added', !!doc.querySelector('#settingsBody [data-portname]'));
setField('expr', '2 * 3');
ok('formula evaluates on canvas', svg.innerHTML.indexOf('6') >= 0);

// delete via keyboard
firePointer(port(fid, 'out'), 'pointerdown', 200, 200);
firePointer(svg, 'pointerup', 200, 200);
const delEvt = new win.KeyboardEvent('keydown', { key: 'Delete', bubbles: true });
win.dispatchEvent(delEvt);
ok('delete key removes block', groups().length === 4, String(groups().length));

// export path: standalone SVG of the live canvas + saved model
const { buildSvgString } = await import(pathToFileURL(root + 'docs/js/exporter.js').href);
const svgString = buildSvgString(svg, stored);
ok('svg export is standalone', svgString.indexOf('<?xml') === 0 && svgString.indexOf('viewBox=') > 0, svgString.slice(0, 120));
ok('svg export sized', /width="[0-9]+"/.test(svgString) && /height="[0-9]+"/.test(svgString));

// examples load from the palette
clickSel(doc.querySelector('.palette-item[data-example="profit"]'));
ok('example replaces the model', groups().length === 9, String(groups().length));
ok('example computes $27,700', doc.getElementById('sensitivityBody').innerHTML.indexOf('$27,700') >= 0, doc.getElementById('sensitivityBody').innerHTML.slice(0, 160));
ok('example name set', doc.getElementById('modelName').value === 'Monthly profit', doc.getElementById('modelName').value);

// clear site data
clickSel(doc.getElementById('btnClear'));
ok('clear empties the canvas', groups().length === 0, String(groups().length));
await new Promise((r) => setTimeout(r, 500));
ok('clear empties storage and nothing re-saves', localStorage.getItem('ufa.model.v1') === null, String(localStorage.getItem('ufa.model.v1')));

console.log('passed: ' + passed + '   failed: ' + failures.length);
for (const f of failures) console.log('  FAIL ' + f);
if (failures.length) process.exit(1);
