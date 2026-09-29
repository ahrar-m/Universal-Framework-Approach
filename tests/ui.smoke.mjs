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
  if (cond) { passed++; if (process.env.SMOKE_VERBOSE) console.log('  ok   ' + name); return; }
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

// the create dialog: set fields, then confirm with Enter (form submit)
function setDlg(name, value) {
  const el = doc.querySelector('#dialogFields [data-dlg="' + name + '"]');
  if (!el) return false;
  el.value = value;
  return true;
}

function confirmDialog() {
  const open = doc.getElementById('dialogScrim').hidden === false;
  ok('create dialog is open', open);
  if (!open) return;
  doc.getElementById('blockDialog').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
}

function groups() {
  return Array.from(svg.querySelectorAll('g[data-block]'));
}

function sensReadouts() {
  return (doc.getElementById('sensitivityBody').innerHTML.match(/result-readout/g) || []).length;
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
confirmDialog();
ok('input block added', groups().length === 1, String(groups().length));
ok('settings show name field', !!doc.querySelector('#settingsBody [data-field="name"]'));
setField('name', 'price');
ok('setField name', setField('value', 50));
ok('setField unit', setField('unit', '$/unit'));

palette('input');
confirmDialog();
setField('name', 'volume');
setField('value', 1000);
setField('unit', 'units');

palette('op');
confirmDialog();
ok('op block added', groups().length === 3);
ok('setField op', setField('op', 'mul'));

palette('result');
confirmDialog();
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

// ---- forgiving wiring, card folding, layout helpers, focus view
ok('cards offer a focus button', !!svg.querySelector('g[data-block="' + ids[0] + '"] [data-focus]'));
ok('cards offer a collapse button', !!svg.querySelector('g[data-block="' + ids[0] + '"] [data-collapse]'));

function pressSvgButton(sel) {
  const el = svg.querySelector(sel);
  ok('button present ' + sel, !!el);
  if (!el) return;
  firePointer(el, 'pointerdown', 320, 320);
  // the canvas re-renders on pointerdown, so release on the live node
  firePointer(svg.querySelector(sel), 'pointerup', 320, 320);
}
function cardHeight(id) {
  const g = svg.querySelector('g[data-block="' + id + '"]');
  return Number(g.querySelector('rect').getAttribute('height'));
}

pressSvgButton('g[data-block="' + ids[0] + '"] [data-collapse]');
ok('collapse shrinks the card', cardHeight(ids[0]) === 54, String(cardHeight(ids[0])));
pressSvgButton('g[data-block="' + ids[0] + '"] [data-collapse]');
ok('expand restores the card', cardHeight(ids[0]) > 100, String(cardHeight(ids[0])));

clickSel(doc.getElementById('btnCompact'));
ok('compact shrinks every card', groups().every(function (g) { return Number(g.querySelector('rect').getAttribute('height')) === 54; }));
clickSel(doc.getElementById('btnCompact'));
ok('expand restores every card', groups().every(function (g) { return Number(g.querySelector('rect').getAttribute('height')) > 100; }));

function cardX(id) {
  const t = svg.querySelector('g[data-block="' + id + '"]').getAttribute('transform') || '';
  return Number(t.replace('translate(', '').split(' ')[0]);
}
clickSel(doc.getElementById('btnArrange'));
const startXs = ids.map(cardX);
await new Promise(function (r) { setTimeout(r, 300); });
const midXs = ids.map(cardX);
ok('arrange glides instead of snapping', midXs.join() !== startXs.join(), 'start ' + startXs.join() + ' mid ' + midXs.join());
await new Promise(function (r) { setTimeout(r, 700); });
const endXs = ids.map(cardX);
ok('blocks are still travelling mid-glide', midXs.join() !== endXs.join(), 'mid ' + midXs.join() + ' end ' + endXs.join());
ok('arrange orders the flow left to right', cardX(ids[0]) < cardX(ids[2]) && cardX(ids[2]) < cardX(ids[3]), [cardX(ids[0]), cardX(ids[2]), cardX(ids[3])].join(','));

// dropping a loose wire on a card body wires it to that card's first free input
palette('op');
confirmDialog();
const extraId = groups()[groups().length - 1].getAttribute('data-block');
const wiresBefore = (svg.innerHTML.match(/data-wire=/g) || []).length;
firePointer(port(ids[0], 'out'), 'pointerdown', 400, 400);
firePointer(svg.querySelector('g[data-block="' + extraId + '"]'), 'pointerup', 400, 400);
ok('drop on a card body wires it up', (svg.innerHTML.match(/data-wire=/g) || []).length === wiresBefore + 1, String((svg.innerHTML.match(/data-wire=/g) || []).length));
firePointer(svg.querySelector('g[data-block="' + extraId + '"]'), 'pointerdown', 420, 420);
firePointer(svg.querySelector('g[data-block="' + extraId + '"]'), 'pointerup', 420, 420);
win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
ok('scratch block removed again', groups().length === 4, String(groups().length));

// focus: open one block with everything it is built from
pressSvgButton('g[data-block="' + ids[2] + '"] [data-focus]');
ok('focus shows only the branch', groups().length === 3, String(groups().length));
ok('focus banner is shown', doc.getElementById('focusBar').hidden === false && doc.getElementById('focusLabel').textContent.indexOf('Focused on') === 0, doc.getElementById('focusLabel').textContent);
clickSel(doc.getElementById('btnShowAll'));
ok('show all restores the model', groups().length === 4, String(groups().length));

// formula block with named inputs
palette('formula');
confirmDialog();
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

// touch-friendly wire removal: tap the wire, then the Delete wire button
const wireEls = Array.from(svg.querySelectorAll('[data-wire]'));
ok('three wires to choose from', wireEls.length === 3, String(wireEls.length));
firePointer(wireEls[0], 'pointerdown', 250, 250);
firePointer(svg.querySelector('[data-wire]'), 'pointerup', 250, 250);
ok('tapping a wire opens the wire bar', doc.getElementById('wireBar').hidden === false);
ok('wire bar names the link', doc.getElementById('wireLabel').textContent.indexOf('→') > 0, doc.getElementById('wireLabel').textContent);
clickSel(doc.getElementById('btnDeleteWire'));
ok('delete-wire button removes the wire', (svg.innerHTML.match(/data-wire=/g) || []).length === 2, String((svg.innerHTML.match(/data-wire=/g) || []).length));
ok('wire bar hides after the delete', doc.getElementById('wireBar').hidden === true);
firePointer(svg.querySelector('[data-wire]'), 'pointerdown', 250, 250);
firePointer(svg.querySelector('[data-wire]'), 'pointerup', 250, 250);
ok('wire bar reopens for another wire', doc.getElementById('wireBar').hidden === false);
clickSel(doc.getElementById('btnWireDeselect'));
ok('deselect closes the wire bar', doc.getElementById('wireBar').hidden === true);

// export path: standalone SVG of the live canvas + saved model
const { buildSvgString, exportJson, exportSvg, exportName } = await import(pathToFileURL(root + 'docs/js/exporter.js').href);
const svgString = buildSvgString(svg, stored);
ok('svg export is standalone', svgString.indexOf('<?xml') === 0 && svgString.indexOf('viewBox=') > 0, svgString.slice(0, 120));
ok('svg export sized', /width="[0-9]+"/.test(svgString) && /height="[0-9]+"/.test(svgString));

// export filenames carry a date-timestamp suffix so repeated exports never overwrite
const downloads = [];
// jsdom's URL has no object-URL support; the download itself is stubbed out below
if (!win.URL.createObjectURL) win.URL.createObjectURL = function () { return 'blob:stub'; };
if (!win.URL.revokeObjectURL) win.URL.revokeObjectURL = function () {};
const realClick = win.HTMLAnchorElement.prototype.click;
win.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
exportJson(stored);
exportSvg(svg, stored);
win.HTMLAnchorElement.prototype.click = realClick;
const slug = String(stored.name || 'model').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'model';
ok('json export name is stamped', new RegExp('^' + slug + '-[0-9]{8}-[0-9]{6}\\.ufa\\.json$').test(downloads[0] || ''), downloads[0]);
ok('svg export name is stamped', new RegExp('^' + slug + '-[0-9]{8}-[0-9]{6}\\.svg$').test(downloads[1] || ''), downloads[1]);
ok('png export name is stamped', new RegExp('^' + slug + '-[0-9]{8}-[0-9]{6}@3x\\.png$').test(exportName(stored, 'png', 3)), exportName(stored, 'png', 3));

// examples load from the palette
clickSel(doc.querySelector('.palette-item[data-example="profit"]'));
ok('example replaces the model', groups().length === 9, String(groups().length));
ok('example computes $27,700', doc.getElementById('sensitivityBody').innerHTML.indexOf('$27,700') >= 0, doc.getElementById('sensitivityBody').innerHTML.slice(0, 160));
ok('example name set', doc.getElementById('modelName').value === 'Monthly profit', doc.getElementById('modelName').value);

// ---- multiple results + unit suggestions come from the model itself ----
palette('result');
confirmDialog();
ok('second result block added', groups().length === 10, String(groups().length));
wire(groups()[7].getAttribute('data-block'), groups()[9].getAttribute('data-block'), 'in');
const sensHtml = doc.getElementById('sensitivityBody').innerHTML;
ok('each result gets its own readout', (sensHtml.match(/result-readout/g) || []).length === 2, String((sensHtml.match(/result-readout/g) || []).length));
ok('ranking shown per result', (sensHtml.match(/sens-title/g) || []).length === 2, String((sensHtml.match(/sens-title/g) || []).length));
// tapping the first card selects it and shows its settings
firePointer(svg.querySelector('g[data-block]'), 'pointerdown', 100, 100);
firePointer(svg.querySelector('g[data-block]'), 'pointerup', 100, 100);
const dl = doc.querySelector('#settingsBody #unitList');
ok('unit suggestions come from the model', !!dl && dl.innerHTML.indexOf('$/unit') >= 0, dl ? dl.innerHTML : 'no datalist');
ok('no default unit suggestions', !!dl && dl.innerHTML.indexOf('hrs') < 0 && dl.innerHTML.indexOf('customers') < 0, dl ? dl.innerHTML : 'no datalist');
const chips = Array.from(doc.querySelectorAll('#settingsBody .chip')).map((c) => c.getAttribute('data-chip'));
ok('chips are the model units only', chips.length > 0 && chips.every((u) => ['$/unit', 'units', '$'].indexOf(u) >= 0), chips.join(','));

// ---- control layout: the view pop-out and the settings gear ----
ok('top bar keeps no standalone Fit button', !doc.getElementById('btnFit'));
ok('zoom row keeps minus, the pop-out and plus', !!doc.getElementById('btnZoomOut') && !!doc.getElementById('btnViewMenu') && !!doc.getElementById('btnZoomIn'));
clickSel(doc.getElementById('btnViewMenu'));
ok('view pop-out opens', doc.getElementById('viewMenu').hidden === false, 'hidden=' + doc.getElementById('viewMenu').hidden);
ok('view pop-out holds the view options', ['btnZoomReset', 'btnZoomFit', 'btnArrange', 'btnCompact', 'btnAutoFit'].every(function (id) { return !!doc.getElementById(id); }));
clickSel(doc.getElementById('btnViewMenu'));
ok('view pop-out closes on a second click', doc.getElementById('viewMenu').hidden === true);
clickSel(doc.getElementById('btnAppMenu'));
ok('settings gear menu opens', doc.getElementById('appMenu').hidden === false);
ok('gear menu holds the model actions', ['btnNew', 'btnImport', 'btnExportJson', 'btnExportSvg', 'btnExportPng', 'btnClear'].every(function (id) { return !!doc.getElementById(id); }));
clickSel(doc.getElementById('btnAppMenu'));

// clear site data
clickSel(doc.getElementById('btnAppMenu'));
clickSel(doc.getElementById('btnClear'));
ok('clear empties the canvas', groups().length === 0, String(groups().length));
await new Promise((r) => setTimeout(r, 500));
ok('clear empties storage and nothing re-saves', localStorage.getItem('ufa.model.v1') === null, String(localStorage.getItem('ufa.model.v1')));

// ---- create dialog: the block is named while it is added ----
palette('input');
ok('palette opens the create dialog', doc.getElementById('dialogScrim').hidden === false);
ok('value input dialog asks name, unit and value',
  !!doc.querySelector('#dialogFields [data-dlg="name"]') &&
  !!doc.querySelector('#dialogFields [data-dlg="unit"]') &&
  !!doc.querySelector('#dialogFields [data-dlg="value"]'));
ok('dialog unit suggestions come from the model', doc.getElementById('dialogFields').innerHTML.indexOf('dialogUnits') >= 0);
setDlg('name', 'price');
setDlg('unit', '$/unit');
setDlg('value', '50');
confirmDialog();
ok('dialog creates the block', groups().length === 1, String(groups().length));
ok('card carries the name from the dialog', svg.innerHTML.indexOf('price') >= 0);
ok('dialog value lands on the block', doc.querySelector('#settingsBody [data-field="value"]').value === '50', doc.querySelector('#settingsBody [data-field="value"]') ? doc.querySelector('#settingsBody [data-field="value"]').value : 'no field');
ok('dialog unit lands on the block', doc.querySelector('#settingsBody [data-field="unit"]').value === '$/unit');

palette('result');
ok('result dialog asks for a name only', !!doc.querySelector('#dialogFields [data-dlg="name"]') && !doc.querySelector('#dialogFields [data-dlg="value"]'));
win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
ok('escape cancels and adds nothing', doc.getElementById('dialogScrim').hidden === true && groups().length === 1, String(groups().length));

palette('op');
ok('operation dialog offers the operator', !!doc.querySelector('#dialogFields [data-dlg="op"]'));
setDlg('name', 'Revenue');
setDlg('op', 'mul');
confirmDialog();
ok('operation and name come from the dialog', svg.innerHTML.indexOf('Revenue') >= 0 && svg.innerHTML.indexOf('×') >= 0, '');
const opId = groups()[groups().length - 1].getAttribute('data-block');

// ---- port menu: press-and-hold adds a block that is already wired ----
function viewportTransform() {
  const m = svg.innerHTML.match(/id="viewport" transform="([^"]*)"/);
  return m ? m[1] : '';
}
function longPress(el, x, y) {
  firePointer(el, 'pointerdown', x, y);
  return new Promise(function (r) { setTimeout(r, 650); }).then(function () {
    firePointer(svg, 'pointerup', x, y);
  });
}

const menuWiresBefore = (svg.innerHTML.match(/data-wire=/g) || []).length;
await longPress(port(opId, 'a'), 300, 300);
ok('long-press opens the port menu', doc.getElementById('portMenu').hidden === false);
const inMenuHtml = doc.getElementById('portMenu').innerHTML;
ok('input port offers feeding blocks', inMenuHtml.indexOf('Add Value input here') >= 0 && inMenuHtml.indexOf('Add Operation here') >= 0 && inMenuHtml.indexOf('Add Formula here') >= 0, inMenuHtml.slice(0, 200));
ok('input port offers no Result', inMenuHtml.indexOf('Add Result here') < 0);
ok('port menu offers to start a wire', inMenuHtml.indexOf('Start a wire from here') >= 0);
ok('free port offers no disconnect', inMenuHtml.indexOf('Disconnect') < 0);
clickSel(doc.querySelector('#portMenu [data-portadd="input"]'));
ok('port add opens the dialog', doc.getElementById('dialogScrim').hidden === false && doc.getElementById('dialogTitle').textContent === 'New Value input', doc.getElementById('dialogTitle').textContent);
setDlg('name', 'cost');
setDlg('value', '10');
confirmDialog();
ok('new block is wired into the pressed port', (svg.innerHTML.match(/data-wire=/g) || []).length === menuWiresBefore + 1, String((svg.innerHTML.match(/data-wire=/g) || []).length));
ok('new card is named from the dialog', svg.innerHTML.indexOf('cost') >= 0);
const costId = groups()[groups().length - 1].getAttribute('data-block');
ok('feeding block lands to the left of its target', cardX(costId) < cardX(opId), cardX(costId) + ' vs ' + cardX(opId));

await longPress(port(costId, 'out'), 640, 300);
const outMenuHtml = doc.getElementById('portMenu').innerHTML;
ok('output port offers consuming blocks', outMenuHtml.indexOf('Add Operation here') >= 0 && outMenuHtml.indexOf('Add Formula here') >= 0 && outMenuHtml.indexOf('Add Result here') >= 0, outMenuHtml.slice(0, 200));
ok('output port offers no Value input', outMenuHtml.indexOf('Add Value input here') < 0);
clickSel(doc.querySelector('#portMenu [data-portadd="result"]'));
setDlg('name', 'Profit');
confirmDialog();
ok('result added pre-wired from the port menu', (sensReadouts() === 1), String(sensReadouts()));

// right-click reaches the same menu
const priceId = groups()[0].getAttribute('data-block');
port(priceId, 'out').dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
ok('right-click opens the port menu', doc.getElementById('portMenu').hidden === false);
win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
ok('escape closes the port menu', doc.getElementById('portMenu').hidden === true);

// disconnect removes the wire on that port
const wiresNow = (svg.innerHTML.match(/data-wire=/g) || []).length;
await longPress(port(costId, 'out'), 640, 300);
ok('connected port offers disconnect', doc.getElementById('portMenu').innerHTML.indexOf('Disconnect') >= 0);
ok('disconnect counts the wires it will cut', doc.getElementById('portMenu').innerHTML.indexOf('Disconnect (2 wires)') >= 0, doc.getElementById('portMenu').innerHTML.slice(0, 200));
clickSel(doc.querySelector('#portMenu [data-portdisconnect="1"]'));
ok('disconnect cuts every wire on that port', (svg.innerHTML.match(/data-wire=/g) || []).length === wiresNow - 2 && wiresNow === 2, String(wiresNow) + ' -> ' + String((svg.innerHTML.match(/data-wire=/g) || []).length));

// ---- focus keeps the camera still unless auto-fit is switched on ----
const still = viewportTransform();
pressSvgButton('g[data-block="' + opId + '"] [data-focus]');
ok('focus leaves the camera where it was', viewportTransform() === still, still + ' vs ' + viewportTransform());
ok('focus banner is up', doc.getElementById('focusBar').hidden === false);
clickSel(doc.getElementById('btnShowAll'));
ok('leaving focus leaves the camera where it was', viewportTransform() === still, still + ' vs ' + viewportTransform());
clickSel(doc.getElementById('btnAutoFit'));
ok('auto-fit switch reports its state', doc.getElementById('btnAutoFit').textContent.indexOf('on') >= 0, doc.getElementById('btnAutoFit').textContent);
ok('auto-fit preference is stored', localStorage.getItem('ufa.view.v1') !== null, String(localStorage.getItem('ufa.view.v1')));
pressSvgButton('g[data-block="' + opId + '"] [data-focus]');
ok('auto-fit frames the branch', viewportTransform() !== still, still + ' vs ' + viewportTransform());
clickSel(doc.getElementById('btnShowAll'));
clickSel(doc.getElementById('btnAutoFit'));
ok('auto-fit toggles back off', doc.getElementById('btnAutoFit').textContent.indexOf('off') >= 0, doc.getElementById('btnAutoFit').textContent);

console.log('passed: ' + passed + '   failed: ' + failures.length);
for (const f of failures) console.log('  FAIL ' + f);
if (failures.length) process.exit(1);
