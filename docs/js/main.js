// main.js — application controller: palette, inspector, sensitivity, persistence.
import { evaluateModel, sensitivity, validateModel, makeBlock, defaultModel, blockTitle, OPS, blockPorts, blockHasOutput, newId, isVariadicOp, opTerms, termLabel, switchComputeMode, isOutcome } from './engine.js';
import { formatValue, formatNumber } from './units.js';
import { createCanvas, blockRect, computeLayout, portPoint, outPoint } from './canvas.js';
import { exportSvg, exportPng, exportJson, importJson } from './exporter.js';
import { parseExpr, collectNames } from './expr.js';

// The block model changed (one Compute block, outcomes marked on it), and old
// models are deliberately not migrated: v2 is the only source of truth.
const STORE_KEY = 'ufa.model.v2';
const OLD_STORE_KEY = 'ufa.model.v1';

const els = {
  svg: document.getElementById('canvas'),
  stage: document.getElementById('stage'),
  hint: document.getElementById('stageHint'),
  modelName: document.getElementById('modelName'),
  settingsBody: document.getElementById('settingsBody'),
  sensitivityBody: document.getElementById('sensitivityBody'),
  issuesBody: document.getElementById('issuesBody'),
  saveState: document.getElementById('saveState'),
  toast: document.getElementById('toast'),
  fileInput: document.getElementById('fileInput'),
  palette: document.getElementById('palette'),
  side: document.getElementById('side'),
  scrim: document.getElementById('sheetScrim'),
  wireBar: document.getElementById('wireBar'),
  wireLabel: document.getElementById('wireLabel'),
  btnDeleteWire: document.getElementById('btnDeleteWire'),
  btnWireDeselect: document.getElementById('btnWireDeselect')
};

let model = loadModel() || starterModel();
try {
  if (!localStorage.getItem(STORE_KEY) && localStorage.getItem(OLD_STORE_KEY)) {
    setTimeout(function () {
      toast('A model saved by an earlier version was found. Models are not migrated, so a fresh model is open. Export from the old version first if you still need it.');
    }, 800);
  }
} catch (err) {
  // storage may be unavailable
}
let values = {};
let result = null;
let saveTimer = null;
let toastTimer = null;

// ---------------------------------------------------------------- utilities
function starterModel() {
  const m = defaultModel('Monthly profit');
  return m;
}

function loadModel() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 2 || !Array.isArray(parsed.blocks)) return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

function saveSoon() {
  els.saveState.textContent = 'saving';
  els.saveState.classList.add('dirty');
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(model));
      els.saveState.textContent = 'saved';
      els.saveState.classList.remove('dirty');
    } catch (err) {
      els.saveState.textContent = 'not saved';
    }
  }, 250);
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { els.toast.classList.remove('show'); }, 3200);
}

function selectedId() {
  const s = canvasView.getSelection();
  return s && s.kind === 'block' ? s.id : null;
}

function findBlock(id) {
  return model.blocks.find(function (b) { return b.id === id; }) || null;
}

// ------------------------------------------------------------------ canvas
const canvasView = createCanvas({
  svg: els.svg,
  getModel: function () { return model; },
  getValues: function () { return values; },
  onSelect: function (id) {
    renderSettings(id);
    if (id && window.innerWidth <= 860) {
      // keep the canvas visible; the settings sheet opens on demand
    }
  },
  onWireSelect: function (id) { renderWireBar(id); },
  onDrag: function () { cancelArrangeAnim(); saveSoon(); },
  onView: function () { cancelArrangeAnim(); },
  connect: function (fromId, fromPort, fromDir, toId, toPort, toDir) {
    connectPorts(fromId, fromPort, fromDir, toId, toPort, toDir);
  },
  deleteBlock: function (id) { deleteBlock(id); },
  addInput: function (id) {
    const block = findBlock(id);
    if (block && block.type === 'compute' && block.mode !== 'expr' && isVariadicOp(block.op)) addOpInput(block);
  },
  deleteWire: function (id) {
    model.wires = model.wires.filter(function (w) { return w.id !== id; });
    saveSoon();
    recompute();
  },
  connectAuto: function (fromId, fromPort, fromDir, toId) { connectAuto(fromId, fromPort, fromDir, toId); },
  previewTarget: function (fromId, fromPort, fromDir, toId) { return autoTargetPort(fromDir, toId); },
  toggleCollapse: function (id) { toggleCollapse(id); },
  setFocus: function (id) { setFocus(id); },
  onPortMenu: function (hit, x, y) { openPortMenu(hit, x, y); },
  getVisibleIds: function () { return visibleIds(); }
});

function connectPorts(fromId, fromPort, fromDir, toId, toPort, toDir) {
  // a wire can outlive the tap that started it (the source may have been
  // deleted meanwhile) — never wire blocks that are no longer there
  if (!findBlock(fromId) || !findBlock(toId)) return;
  if (fromId === toId) {
    toast('A block cannot be wired to itself.');
    return;
  }
  let source = { id: fromId, port: fromPort };
  let target = { id: toId, port: toPort };
  if (fromDir === 'in' && toDir === 'out') {
    source = { id: toId, port: toPort };
    target = { id: fromId, port: fromPort };
  } else if (fromDir === toDir) {
    toast('Connect an output port (right) to an input port (left).');
    return;
  }
  // cycle check: if source already depends on target, refuse
  if (reaches(target.id, source.id)) {
    toast('That wire would create a loop. Values must flow one way.');
    return;
  }
  model.wires = model.wires.filter(function (w) {
    return !(w.to === target.id && w.toPort === target.port);
  });
  model.wires.push({ id: newId('w'), from: source.id, to: target.id, toPort: target.port });
  saveSoon();
  recompute();
  toast('Blocks connected.');
}

function reaches(startId, targetId) {
  const stack = [startId];
  const seen = {};
  while (stack.length) {
    const id = stack.pop();
    if (id === targetId) return true;
    if (seen[id]) continue;
    seen[id] = true;
    for (const w of model.wires) {
      if (w.from === id) stack.push(w.to);
    }
  }
  return false;
}

// ------------------------------------------------------- connect shortcuts
// Where a loose wire end should land when it is dropped on a card itself:
// the first input that is still free, or the output when dragging from an input.
function autoTargetPort(fromDir, toId) {
  const target = findBlock(toId);
  if (!target) return null;
  if (fromDir === 'in') return blockHasOutput(target) ? 'out' : null;
  const used = {};
  for (const w of model.wires) if (w.to === target.id) used[w.toPort] = true;
  const ports = blockPorts(target);
  for (const i = 0; i < ports.length; i++) if (!used[ports[i].id]) return ports[i].id;
  return null;
}

function connectAuto(fromId, fromPort, fromDir, toId) {
  const target = findBlock(toId);
  if (!target) return;
  if (fromDir === 'out') {
    let portId = autoTargetPort('out', toId);
    if (!portId && target.type === 'compute' && target.mode !== 'expr' && isVariadicOp(target.op)) {
      // endless inputs: grow one more term and land the wire on it
      const terms = opTerms(target).slice();
      terms.push(freeTermId(terms));
      target.terms = terms;
      portId = terms[terms.length - 1];
    }
    if (!portId) {
      toast('Every input on "' + blockTitle(target) + '" is already connected.');
      return;
    }
    connectPorts(fromId, fromPort, 'out', target.id, portId, 'in');
    return;
  }
  const outPort = autoTargetPort('in', toId);
  if (!outPort) {
    toast('That block cannot take this wire.');
    return;
  }
  connectPorts(target.id, 'out', 'out', fromId, fromPort, 'in');
}

// --------------------------------------------------------------- focus view
// Focus opens one block with everything it is built from, on its own.
let focusId = null;

function visibleIds() {
  if (!focusId) return null;
  const start = findBlock(focusId);
  if (!start) return null;
  const set = new Set();
  const stack = [start.id];
  while (stack.length) {
    const id = stack.pop();
    if (set.has(id)) continue;
    set.add(id);
    for (const w of model.wires) if (w.to === id) stack.push(w.from);
  }
  return set;
}

function setFocus(id, options) {
  focusId = id && findBlock(id) ? id : null;
  renderFocusBar();
  recompute();
  // Entering or leaving Focus never moves the camera unless "Auto-fit camera"
  // is switched on: on a big graph the zoom jump costs more than it helps.
  if (autoFit && (!options || !options.keepView)) canvasView.fit();
}

// ------------------------------------------------- camera follow preference
const VIEW_KEY = 'ufa.view.v1';
let autoFit = loadViewPrefs();

function loadViewPrefs() {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw) return !!JSON.parse(raw).autoFit;
  } catch (err) {
    // storage may be unavailable
  }
  return false;
}

function saveViewPrefs() {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ autoFit: autoFit }));
  } catch (err) {
    // ignore
  }
}

function setAutoFit(on) {
  autoFit = !!on;
  saveViewPrefs();
  refreshViewMenu();
  toast(autoFit
    ? 'Auto-fit camera on: entering or leaving Focus frames the branch.'
    : 'Auto-fit camera off: the view stays where you put it.');
}

function updateAutoFitButton() {
  const btn = document.getElementById('btnAutoFit');
  if (!btn) return;
  btn.textContent = 'Auto-fit camera: ' + (autoFit ? 'on' : 'off');
  btn.setAttribute('aria-pressed', String(autoFit));
}

function renderFocusBar() {
  const bar = document.getElementById('focusBar');
  const label = document.getElementById('focusLabel');
  if (!bar || !label) return;
  const block = focusId ? findBlock(focusId) : null;
  if (!block) {
    bar.hidden = true;
    return;
  }
  const vis = visibleIds();
  label.textContent = 'Focused on "' + blockTitle(block) + '" — ' + (vis ? vis.size : 1) + ' blocks, with everything they are built from';
  bar.hidden = false;
}

// ------------------------------------------------------ collapse and layout
function toggleCollapse(id) {
  const block = findBlock(id);
  if (!block) return;
  block.collapsed = !block.collapsed;
  saveSoon();
  recompute();
}

function setAllCollapsed(collapsed) {
  for (const b of model.blocks) b.collapsed = collapsed;
  saveSoon();
  recompute();
  canvasView.fit();
}

function updateCompactButton() {
  const btn = document.getElementById('btnCompact');
  if (!btn) return;
  const anyExpanded = model.blocks.some(function (b) { return !b.collapsed; });
  btn.textContent = anyExpanded ? 'Compact every card' : 'Expand every card';
  btn.title = anyExpanded ? 'Shrink every card to a mini overview' : 'Restore every card to full size';
}

// Lay the model out in flow order (see computeLayout in canvas.js): every
// input beside the block it is wired into, results on the right, and every
// unrelated branch in its own band so wires never intertwine.
function autoArrange() {
  const blocks = model.blocks;
  if (!blocks.length) {
    toast('Add some blocks first.');
    return;
  }
  const targets = computeLayout(model).targets;
  // glide the cards (and the camera) to the new layout instead of snapping
  animateToTargets(targets, function () {
    saveSoon();
    recompute();
    toast('Blocks arranged in flow order.');
  });
}

// ------------------------------------------------------------- animation
// Arrange moves blocks by animating them: every card and the camera travel to
// the new layout together, so nothing jumps. A drag, a zoom, or any model
// change stops the glide where it is, and `prefers-reduced-motion` skips it.
let arrangeAnim = null;
const ARRANGE_MS = 600;

function prefersReducedMotion() {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (err) {
    return false;
  }
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function cancelArrangeAnim() {
  if (!arrangeAnim) return;
  const caf = window.cancelAnimationFrame;
  if (arrangeAnim.raf && typeof caf === 'function') caf.call(window, arrangeAnim.raf);
  arrangeAnim = null;
}

function animateToTargets(targets, done) {
  cancelArrangeAnim();
  const moves = [];
  for (const b of model.blocks) {
    const t = targets[b.id];
    if (!t) continue;
    moves.push({ block: b, fromX: b.x, fromY: b.y, toX: t.x, toY: t.y });
  }
  const viewFrom = canvasView.getView();
  const viewTo = canvasView.fitView(targets);
  const settle = function () {
    for (const m of moves) {
      m.block.x = m.toX;
      m.block.y = m.toY;
    }
    canvasView.setView(viewTo);
    arrangeAnim = null;
    if (done) done();
  };
  const raf = window.requestAnimationFrame;
  if (prefersReducedMotion() || typeof raf !== 'function') {
    settle();
    return;
  }
  // start from the first frame's own clock, so no two time origins mix
  let start = null;
  const step = function (now) {
    if (start === null) start = now;
    const t = Math.min(1, Math.max(0, (now - start) / ARRANGE_MS));
    const e = easeInOutCubic(t);
    for (const m of moves) {
      m.block.x = Math.round(m.fromX + (m.toX - m.fromX) * e);
      m.block.y = Math.round(m.fromY + (m.toY - m.fromY) * e);
    }
    canvasView.setView({
      x: viewFrom.x + (viewTo.x - viewFrom.x) * e,
      y: viewFrom.y + (viewTo.y - viewFrom.y) * e,
      k: viewFrom.k + (viewTo.k - viewFrom.k) * e
    });
    if (t < 1) {
      arrangeAnim.raf = raf.call(window, step);
    } else {
      settle();
    }
  };
  arrangeAnim = { raf: raf.call(window, step) };
}

function deleteBlock(id) {
  // drop any half-made wire too, so the next tap cannot resurrect it
  canvasView.clearSelection();
  model.blocks = model.blocks.filter(function (b) { return b.id !== id; });
  model.wires = model.wires.filter(function (w) { return w.from !== id && w.to !== id; });
  if (focusId === id) {
    focusId = null;
    renderFocusBar();
  }
  saveSoon();
  recompute();
  renderSettings(null);
  toast('Block deleted.');
}

function findFreeSpot(x, y) {
  const w = 240;
  const h = 165;
  const rects = model.blocks.map(blockRect);
  let px = x;
  let py = y;
  for (let i = 0; i < 80; i++) {
    const clashing = rects.some(function (r) {
      return px < r.x + r.w + 18 && px + w > r.x - 18 && py < r.y + r.h + 18 && py + h > r.y - 18;
    });
    if (!clashing) return { x: Math.round(px), y: Math.round(py) };
    px += 46;
    py += 38;
    if (i % 6 === 5) { px = x - Math.floor(i / 6) * 70; py = y + Math.floor(i / 6) * 52; }
  }
  return { x: Math.round(x), y: Math.round(y) };
}

function clearSiteData() {
  if (!confirm('Clear the data this site saved in your browser? The model on screen is removed from this device. Anything you exported as JSON is unaffected.')) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    localStorage.removeItem(STORE_KEY);
  } catch (err) {
    // ignore: storage may be unavailable
  }
  model = defaultModel('Untitled model');
  els.modelName.value = model.name;
  canvasView.clearSelection();
  renderSettings(null);
  recompute();
  canvasView.fit();
  toast('Saved data cleared.');
}

const BLOCK_LABELS = { input: 'Value input', compute: 'Compute' };

function addBlock(type) {
  openCreateDialog(type, function (fields) {
    const c = canvasView.centerPoint();
    const spot = findFreeSpot(c.x - 106, c.y - 60);
    const block = commitBlock(type, fields, spot);
    saveSoon();
    recompute();
    canvasView.setSelection({ kind: 'block', id: block.id });
    renderSettings(block.id);
    if (window.innerWidth <= 860) closeSheets();
    toast(BLOCK_LABELS[type] + ' added.');
  });
}

// A block created from the port menu lands on the side the value flows from
// and is wired to the port that was pressed, before the card is drawn.
function addBlockFromPort(hit, type) {
  openCreateDialog(type, function (fields) {
    const src = findBlock(hit.blockId);
    if (!src) return;
    const feedsIn = hit.dir === 'in';
    const anchor = feedsIn ? portPoint(src, hit.portId) : outPoint(src);
    const x = feedsIn ? src.x - 212 - 72 : src.x + 212 + 72;
    const spot = findFreeSpot(x, anchor.y - 72);
    const block = commitBlock(type, fields, spot);
    if (feedsIn) {
      connectPorts(block.id, 'out', 'out', src.id, hit.portId, 'in');
    } else {
      connectAuto(src.id, hit.portId, 'out', block.id);
    }
    canvasView.setSelection({ kind: 'block', id: block.id });
    renderSettings(block.id);
    toast(BLOCK_LABELS[type] + ' added and connected.');
  });
}

function commitBlock(type, fields, spot) {
  const block = makeBlock(type, spot.x, spot.y);
  applyDialogFields(block, type, fields);
  model.blocks.push(block);
  return block;
}

// ------------------------------------------------------------- create dialog
// Adding a block asks for its essentials up front, so the card that lands on
// the canvas is already named. Enter creates; Esc or a click outside cancels
// and leaves no block and no wire behind.
let dialogState = null;

function dialogOpen() { return !!dialogState; }

function dialogFieldsHtml(type) {
  const unitList = usedUnits().map(function (u) {
    return '<option value="' + escapeHtml(u) + '">';
  }).join('');
  let html = '';
  if (type === 'input') {
    html += field('Name', '<input type="text" data-dlg="name" placeholder="e.g. price" spellcheck="false">');
    html += '<div class="field-row">' +
      field('Unit', '<input type="text" data-dlg="unit" list="dialogUnits" placeholder="e.g. $/unit" spellcheck="false">') +
      field('Value', '<input type="number" step="any" data-dlg="value" placeholder="0">') +
      '</div><datalist id="dialogUnits">' + unitList + '</datalist>';
    html += '<div class="field-hint">Units are checked everywhere and labels cancel. An unknown word like <code>tickets</code> becomes its own unit.</div>';
  } else if (type === 'compute') {
    html += field('Name', '<input type="text" data-dlg="name" placeholder="e.g. Gross margin" spellcheck="false">');
    html += field('How should it compute?', '<select data-dlg="mode">' +
      '<option value="op">Ready operation</option>' +
      '<option value="expr">Typed expression</option></select>');
    const options = Object.keys(OPS).map(function (key) {
      return '<option value="' + key + '">' + OPS[key].label + '</option>';
    }).join('');
    html += '<div data-dlgshow="op">' +
      field('Operation', '<select data-dlg="op">' + options + '</select>') +
      '<div class="field-hint">Add, Multiply, Min and Max take any number of inputs; the rest take two.</div></div>';
    html += '<div data-dlgshow="expr" hidden>' +
      field('Expression', '<input type="text" data-dlg="expr" placeholder="price * volume - cost" spellcheck="false">') +
      '<div class="field-hint">The names in the expression become this block\u2019s inputs. Edit them in Block settings. Functions: <code>min</code> <code>max</code> <code>round</code> <code>abs</code> <code>sqrt</code> <code>pow</code> and more.</div></div>';
    html += '<div class="field-hint">A Compute block can be marked as one of the model\u2019s results in Block settings.</div>';
  }
  return html;
}

function openCreateDialog(type, onConfirm) {
  const scrim = document.getElementById('dialogScrim');
  const body = document.getElementById('dialogFields');
  const title = document.getElementById('dialogTitle');
  if (!scrim || !body || !title) return;
  closePortMenu();
  if (canvasView.isPending()) canvasView.clearSelection();
  title.textContent = 'New ' + (BLOCK_LABELS[type] || 'block');
  body.innerHTML = dialogFieldsHtml(type);
  dialogState = { type: type, onConfirm: onConfirm };
  const modeSel = body.querySelector('[data-dlg="mode"]');
  if (modeSel) {
    modeSel.addEventListener('change', function () {
      const exprMode = modeSel.value === 'expr';
      const opBox = body.querySelector('[data-dlgshow="op"]');
      const exprBox = body.querySelector('[data-dlgshow="expr"]');
      if (opBox) opBox.hidden = exprMode;
      if (exprBox) exprBox.hidden = !exprMode;
      const next = body.querySelector(exprMode ? '[data-dlg="expr"]' : '[data-dlg="op"]');
      if (next && next.focus) next.focus();
    });
  }
  scrim.hidden = false;
  const first = body.querySelector('input, select');
  if (first && first.focus) first.focus();
}

function closeCreateDialog() {
  dialogState = null;
  const scrim = document.getElementById('dialogScrim');
  if (scrim) scrim.hidden = true;
}

function confirmCreateDialog() {
  if (!dialogState) return;
  const state = dialogState;
  const body = document.getElementById('dialogFields');
  const get = function (key) {
    const el = body ? body.querySelector('[data-dlg="' + key + '"]') : null;
    return el ? String(el.value).trim() : '';
  };
  const fields = { name: get('name'), unit: get('unit'), value: get('value'), op: get('op'), mode: get('mode'), expr: get('expr') };
  closeCreateDialog();
  if (state.onConfirm) state.onConfirm(fields);
}

function applyDialogFields(block, type, fields) {
  if (fields.name) {
    if (type === 'input') block.name = fields.name;
    else block.title = fields.name;
  }
  if (type === 'input') {
    block.unit = fields.unit;
    block.value = fields.value === '' ? 0 : Number(fields.value);
  }
  if (type === 'compute') {
    block.mode = fields.mode === 'expr' ? 'expr' : 'op';
    if (block.mode === 'expr') {
      block.expr = fields.expr || '';
      block.inputs = exprInputs(block.expr);
    } else {
      if (fields.op && OPS[fields.op]) block.op = fields.op;
      if (!isVariadicOp(block.op)) block.terms = ['a', 'b'];
      if (!fields.name) block.title = (OPS[block.op] || OPS.add).label;
    }
  }
}

// The names a typed expression uses become the block's input ports, so the
// card that lands on the canvas is already wired to what the expression wants.
function exprInputs(expr) {
  try {
    const names = collectNames(parseExpr(expr || ''));
    if (names.length) return names.map(function (n) { return { id: n, name: n }; });
  } catch (err) {
    // unfinished expressions can be completed in Block settings
  }
  return [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }];
}

// ---------------------------------------------------------------- port menu
// Press-and-hold on a port, or a right-click, offers the blocks that can be
// added there already wired up. A quick tap still starts a wire.
let portMenuPort = null;

function openPortMenu(hit, cx, cy) {
  const menu = document.getElementById('portMenu');
  const block = findBlock(hit.blockId);
  if (!menu || !block) return;
  closePopouts();
  const addable = hit.dir === 'in'
    ? ['input', 'compute']
    : ['compute'];
  const parts = [];
  for (const type of addable) {
    parts.push('<button type="button" class="menu-item" data-portadd="' + type + '">Add ' + BLOCK_LABELS[type] + ' here</button>');
  }
  const wires = hit.dir === 'in'
    ? model.wires.filter(function (w) { return w.to === hit.blockId && w.toPort === hit.portId; })
    : model.wires.filter(function (w) { return w.from === hit.blockId; });
  parts.push('<button type="button" class="menu-item" data-portwire="1">Start a wire from here</button>');
  if (wires.length) {
    parts.push('<button type="button" class="menu-item menu-danger" data-portdisconnect="1">Disconnect' + (wires.length > 1 ? ' (' + wires.length + ' wires)' : '') + '</button>');
  }
  parts.push('<div class="menu-note">' + (hit.dir === 'in' ? 'this input is fed' : 'this output feeds on') + '</div>');
  menu.innerHTML = parts.join('');
  portMenuPort = hit;
  menu.style.left = Math.round(Math.max(8, Math.min(cx, window.innerWidth - 250))) + 'px';
  menu.style.top = Math.round(Math.max(8, Math.min(cy, window.innerHeight - 300))) + 'px';
  menu.hidden = false;
}

function closePortMenu() {
  portMenuPort = null;
  const menu = document.getElementById('portMenu');
  if (menu) menu.hidden = true;
}

function disconnectPort(hit) {
  model.wires = hit.dir === 'in'
    ? model.wires.filter(function (w) { return !(w.to === hit.blockId && w.toPort === hit.portId); })
    : model.wires.filter(function (w) { return w.from !== hit.blockId; });
  saveSoon();
  recompute();
  toast('Wire removed.');
}

// ------------------------------------------------------------- pop-out menus
// The zoom row keeps only minus, plus and one View button; 1:1, Fit, Arrange,
// Compact and Auto-fit live in its pop-out. The gear in the top bar holds the
// model actions. Both close on an outside click or Escape.
function closePopouts() {
  document.querySelectorAll('.popout-menu').forEach(function (menu) {
    menu.hidden = true;
    menu.style.transform = '';
  });
  document.querySelectorAll('.popout > button').forEach(function (btn) {
    btn.setAttribute('aria-expanded', 'false');
    btn.classList.remove('active');
  });
}

function refreshViewMenu() {
  updateCompactButton();
  updateAutoFitButton();
}

// A pop-out is anchored to its button, so on a narrow screen it can hang off
// the edge and lose its labels. Shift it back inside the viewport instead.
function clampPopout(menu) {
  if (!menu || menu.hidden || !menu.offsetWidth) return;
  menu.style.transform = '';
  const rect = menu.getBoundingClientRect();
  const margin = 8;
  let dx = 0;
  let dy = 0;
  if (rect.left < margin) dx = margin - rect.left;
  else if (rect.right > window.innerWidth - margin) dx = window.innerWidth - margin - rect.right;
  if (rect.bottom > window.innerHeight - margin) dy = window.innerHeight - margin - rect.bottom;
  if (dy < 0 && rect.top + dy < margin) dy = margin - rect.top;
  if (dx || dy) menu.style.transform = 'translate(' + Math.round(dx) + 'px, ' + Math.round(dy) + 'px)';
}

function clampOpenPopouts() {
  document.querySelectorAll('.popout-menu').forEach(clampPopout);
}

function setupPopout(btnId, menuId) {
  const btn = document.getElementById(btnId);
  const menu = document.getElementById(menuId);
  if (!btn || !menu) return;
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    const open = !menu.hidden;
    closePopouts();
    if (!open) {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      btn.classList.add('active');
      refreshViewMenu();
      clampPopout(menu);
    }
  });
  menu.addEventListener('click', function (e) {
    const item = e.target.closest ? e.target.closest('.menu-item') : null;
    if (!item) return;
    // the auto-fit switch flips in place so its state stays visible
    if (item.id === 'btnAutoFit') refreshViewMenu();
    else closePopouts();
  });
}

setupPopout('btnViewMenu', 'viewMenu');
setupPopout('btnAppMenu', 'appMenu');
window.addEventListener('resize', clampOpenPopouts);

document.addEventListener('click', function (e) {
  const inside = e.target && e.target.closest ? e.target.closest('.popout, .port-menu') : null;
  if (!inside) {
    closePopouts();
    closePortMenu();
  }
});

const portMenuEl = document.getElementById('portMenu');
if (portMenuEl) {
  portMenuEl.addEventListener('click', function (e) {
    const btn = e.target.closest ? e.target.closest('button') : null;
    if (!btn || !portMenuPort) return;
    const hit = portMenuPort;
    const addType = btn.getAttribute('data-portadd');
    closePortMenu();
    if (addType) {
      addBlockFromPort(hit, addType);
      return;
    }
    if (btn.getAttribute('data-portwire')) {
      canvasView.startLink(hit);
      return;
    }
    if (btn.getAttribute('data-portdisconnect')) disconnectPort(hit);
  });
}

const dialogScrim = document.getElementById('dialogScrim');
const dialogForm = document.getElementById('blockDialog');
if (dialogForm) {
  dialogForm.addEventListener('submit', function (e) {
    e.preventDefault();
    confirmCreateDialog();
  });
}
if (dialogScrim) {
  dialogScrim.addEventListener('click', function (e) {
    if (e.target === dialogScrim) closeCreateDialog();
  });
}
const dialogCancel = document.getElementById('dialogCancel');
if (dialogCancel) dialogCancel.addEventListener('click', closeCreateDialog);

// -------------------------------------------------------------- recompute
function recompute() {
  cancelArrangeAnim();
  const evalResult = evaluateModel(model);
  values = evalResult.values;
  result = evalResult.result;
  canvasView.render();
  renderSensitivity(evalResult);
  renderIssues(evalResult);
  renderFocusBar();
  updateCompactButton();
  els.hint.style.display = model.blocks.length ? 'none' : '';
}

function renderIssues(evalResult) {
  const issues = validateModel(model, evalResult.values).slice();
  for (const err of evalResult.errors) {
    if (issues.indexOf(err) < 0) issues.push(err);
  }
  if (!issues.length) {
    els.issuesBody.innerHTML = '<div class="issue ok">Everything checks out. Units are consistent and every required port is connected.</div>';
    return;
  }
  els.issuesBody.innerHTML = issues.map(function (text) {
    return '<div class="issue">' + escapeHtml(text) + '</div>';
  }).join('');
}

function renderSensitivity(evalResult) {
  const parts = [];
  const results = evalResult.results || [];
  if (!results.length) {
    parts.push('<p class="panel-sub">Mark a Compute block as an outcome to see a result.</p>');
    els.sensitivityBody.innerHTML = parts.join('');
    return;
  }
  // one readout per marked outcome: a model may carry several
  for (const r of results) {
    parts.push('<div class="result-readout"><div class="rr-label">' + escapeHtml(r.title) + '</div>' +
      '<div class="rr-value' + (r.error ? ' err' : '') + '">' + escapeHtml(r.error ? r.error : r.display) + '</div></div>');
  }
  let anyRows = false;
  for (const r of results) {
    if (r.error) continue;
    const sens = sensitivity(model, r.id);
    if (!sens.rows.length) continue;
    anyRows = true;
    parts.push('<div class="sens-section"><div class="sens-title">What moves ' + escapeHtml(r.title) + '</div>');
    for (const row of sens.rows) {
      const width = Math.max(3, Math.round(row.share * 100));
      parts.push('<div class="sens-row">' +
        '<div class="sens-head"><span class="sens-name">' + escapeHtml(row.name) + '</span>' +
        '<span class="sens-impact">' + escapeHtml(row.display) + '</span></div>' +
        '<div class="sens-bar"><div class="sens-fill" style="width:' + width + '%"></div></div>' +
        '<div class="sens-detail">' + escapeHtml(row.detail) + '</div></div>');
    }
    parts.push('</div>');
  }
  if (!anyRows) {
    parts.push('<p class="panel-sub">Add Value inputs to see which one drives the outcome.</p>');
  } else {
    parts.push('<p class="panel-sub">Ranked by how much each outcome moves when the input changes. Inputs with a min and a max are measured across that range; otherwise a +1% change is used.</p>');
  }
  els.sensitivityBody.innerHTML = parts.join('');
}

// ------------------------------------------------------------- inspector
function renderSettings(id) {
  const block = id ? findBlock(id) : null;
  if (!block) {
    els.settingsBody.innerHTML = '<p class="panel-sub">Select a block on the canvas to edit it. Tap a port, then another port, to wire blocks together.</p>';
    return;
  }
  els.settingsBody.innerHTML = settingsHtml(block);
  bindSettings(block);
}

// The unit picker suggests only the units this model already uses — no defaults.
function usedUnits() {
  const list = [];
  const add = function (u) {
    const t = String(u === undefined || u === null ? '' : u).trim();
    if (t && list.indexOf(t) < 0) list.push(t);
  };
  for (const b of model.blocks) {
    if (b.type === 'input') add(b.unit);
    else if (isOutcome(b)) add(b.displayUnit);
  }
  return list;
}

// Keep the suggestions current as the user types a new unit.
function refreshUnitList() {
  const dl = document.getElementById('unitList');
  if (!dl) return;
  dl.innerHTML = usedUnits().map(function (u) {
    return '<option value="' + escapeHtml(u) + '">';
  }).join('');
}

function settingsHtml(block) {
  const projectUnits = usedUnits();
  const unitOptions = projectUnits.map(function (u) {
    return '<option value="' + escapeHtml(u) + '">';
  }).join('');
  const unitChips = projectUnits.map(function (u) {
    return '<button type="button" class="chip" data-chip="' + escapeHtml(u) + '">' + escapeHtml(u) + '</button>';
  }).join('');
  const chipsOrHint = projectUnits.length
    ? '<div class="chip-row">' + unitChips + '</div>'
    : '<div class="field-hint">No units in this model yet &mdash; type one and it will be suggested here.</div>';
  let html = '';
  const status = values[block.id];
  if (status && status.error) {
    html += '<div class="issue">' + escapeHtml(status.error) + '</div>';
  }
  if (block.type === 'input') {
    html += field('Name', '<input type="text" data-field="name" value="' + escapeHtml(block.name || '') + '" spellcheck="false">');
    html += '<div class="field-row">' +
      field('Value', '<input type="number" step="any" data-field="value" value="' + escapeHtml(block.value) + '">') +
      field('Unit', '<input type="text" list="unitList" data-field="unit" value="' + escapeHtml(block.unit || '') + '" spellcheck="false">') +
      '</div><datalist id="unitList">' + unitOptions + '</datalist>';
    html += chipsOrHint;
    html += '<div class="field-hint">Units are checked everywhere and labels cancel: <code>$/unit</code> times <code>units</code> becomes <code>$</code>. Unknown words like <code>tickets</code> become their own unit. Suggestions come from the units already used in this model.</div>';
    html += '<div class="field-row">' +
      field('Min', '<input type="number" step="any" data-field="min" value="' + escapeHtml(block.min === null || block.min === undefined ? '' : block.min) + '" placeholder="optional">') +
      field('Likely', '<input type="number" step="any" data-field="likely" value="' + escapeHtml(block.likely === null || block.likely === undefined ? '' : block.likely) + '" placeholder="optional">') +
      field('Max', '<input type="number" step="any" data-field="max" value="' + escapeHtml(block.max === null || block.max === undefined ? '' : block.max) + '" placeholder="optional">') +
      '</div>';
    html += '<div class="field-hint">Give a min and a max to measure this input across its real range in the sensitivity ranking.</div>';
  } else if (block.type === 'compute') {
    html += field('Title', '<input type="text" data-field="title" value="' + escapeHtml(block.title || '') + '" spellcheck="false">');
    html += field('How it computes', '<select data-field="mode">' +
      '<option value="op"' + (block.mode !== 'expr' ? ' selected' : '') + '>Ready operation</option>' +
      '<option value="expr"' + (block.mode === 'expr' ? ' selected' : '') + '>Typed expression</option></select>');
    if (block.mode === 'expr') {
      html += '<div class="field"><label>Inputs</label>';
      const inputs = block.inputs || [];
      inputs.forEach(function (p, index) {
        html += '<div class="formula-input-row"><input type="text" data-portname="' + index + '" value="' + escapeHtml(p.name) + '" spellcheck="false" aria-label="Input name">' +
          '<button type="button" class="icon-btn" data-removeport="' + index + '" title="Remove input">×</button></div>';
      });
      html += '<button type="button" class="btn" data-addport="1">Add input</button></div>';
      html += field('Expression', '<textarea data-field="expr" spellcheck="false" placeholder="price * volume * (1 - churn)">' + escapeHtml(block.expr || '') + '</textarea>');
      const names = (block.inputs || []).map(function (p) { return '<code>' + escapeHtml(p.name) + '</code>'; }).join(' ');
      html += '<div class="field-hint">Use the input names in the expression: ' + (names || 'add an input first') + '. Functions: <code>min</code> <code>max</code> <code>round</code> <code>floor</code> <code>ceil</code> <code>abs</code> <code>sqrt</code> <code>pow</code> <code>exp</code> <code>ln</code> <code>log</code> <code>sign</code>.</div>';
    } else {
      const options = Object.keys(OPS).map(function (key) {
        return '<option value="' + key + '"' + (block.op === key ? ' selected' : '') + '>' + OPS[key].label + '</option>';
      }).join('');
      html += field('Operation', '<select data-field="op">' + options + '</select>');
      if (isVariadicOp(block.op)) {
        const terms = opTerms(block);
        html += '<div class="field"><label>Inputs</label>';
        terms.forEach(function (id, index) {
          html += '<div class="formula-input-row"><span class="port-tag">' + escapeHtml(termLabel(index)) + '</span>' +
            (terms.length > 1 ? '<button type="button" class="icon-btn" data-removeterm="' + index + '" title="Remove input">×</button>' : '') +
            '</div>';
        });
        html += '<button type="button" class="btn" data-addterm="1">Add input</button></div>';
        html += '<div class="field-hint">' + OPS[block.op].label + ' takes as many inputs as you like &mdash; use <code>Add input</code> here or the <code>+ add input</code> row on the block. Empty ports are ignored, and one connected input passes straight through. Every input must be the same kind of quantity.</div>';
      } else {
        html += '<div class="field-hint">This operation takes two inputs: the left port is <code>a</code>, the right port is <code>b</code>. Add, subtract, min and max need the same kind of quantity; multiply and divide combine units.</div>';
      }
    }
    html += '<div class="field"><label>Outcome</label>' +
      '<button type="button" class="btn' + (block.outcome ? ' btn-primary' : '') + '" data-outcome="1">' +
      (block.outcome ? 'Marked as a result' : 'Mark as a result') + '</button>' +
      '<div class="field-hint">A marked Compute block is one of the model\u2019s outcomes: it appears in the results panel and drives the sensitivity ranking. Marking never changes the wiring &mdash; the block still feeds whatever is connected to it.</div></div>';
    if (block.outcome) {
      html += field('Display unit', '<input type="text" list="unitList" data-field="displayUnit" value="' + escapeHtml(block.displayUnit || '') + '" placeholder="leave empty to infer" spellcheck="false"><datalist id="unitList">' + unitOptions + '</datalist>');
      html += chipsOrHint;
      html += '<div class="field-hint">Optional. Show the outcome in a unit of the same kind, for example <code>hrs</code> instead of <code>min</code>. Mark as many Compute blocks as you need &mdash; each is its own outcome.</div>';
    }
  }
  html += '<div class="field-row">' +
    '<button type="button" class="btn" data-focusbranch="1" title="Show only this block and everything it is built from">Focus this branch</button>' +
    '<button type="button" class="btn" data-collapsecard="1" title="Shrink this card to a mini overview, or expand it again">' + (block.collapsed ? 'Expand card' : 'Collapse card') + '</button>' +
    '</div>';
  html += '<button type="button" class="btn btn-danger" data-delete="1">Delete block</button>';
  return html;
}

function field(label, control) {
  return '<div class="field"><label>' + label + '</label>' + control + '</div>';
}

function bindSettings(block) {
  const body = els.settingsBody;
  body.querySelectorAll('[data-chip]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      const u = chip.getAttribute('data-chip');
      if (block.type === 'input') block.unit = u;
      else block.displayUnit = u;
      renderSettings(block.id);
      saveSoon();
      recompute();
    });
  });
  const outcomeBtn = body.querySelector('[data-outcome]');
  if (outcomeBtn) {
    outcomeBtn.addEventListener('click', function () {
      block.outcome = !block.outcome;
      renderSettings(block.id);
      saveSoon();
      recompute();
    });
  }
  const addPort = body.querySelector('[data-addport]');
  if (addPort) {
    addPort.addEventListener('click', function () {
      block.inputs = block.inputs || [];
      block.inputs.push({ id: newId('p'), name: uniqueName(block, 'input' + (block.inputs.length + 1)) });
      renderSettings(block.id);
      saveSoon();
      recompute();
    });
  }
  body.querySelectorAll('[data-removeport]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const index = Number(btn.getAttribute('data-removeport'));
      const removed = block.inputs[index];
      block.inputs.splice(index, 1);
      model.wires = model.wires.filter(function (w) { return !(w.to === block.id && w.toPort === removed.id); });
      renderSettings(block.id);
      saveSoon();
      recompute();
    });
  });
  const addTerm = body.querySelector('[data-addterm]');
  if (addTerm) {
    addTerm.addEventListener('click', function () {
      addOpInput(block);
    });
  }
  body.querySelectorAll('[data-removeterm]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      removeOpInput(block, Number(btn.getAttribute('data-removeterm')));
    });
  });
  const focusBranch = body.querySelector('[data-focusbranch]');
  if (focusBranch) {
    focusBranch.addEventListener('click', function () {
      setFocus(block.id);
    });
  }
  const collapseCard = body.querySelector('[data-collapsecard]');
  if (collapseCard) {
    collapseCard.addEventListener('click', function () {
      toggleCollapse(block.id);
      renderSettings(block.id);
    });
  }
  const del = body.querySelector('[data-delete]');
  if (del) {
    del.addEventListener('click', function () {
      deleteBlock(block.id);
    });
  }
  body.addEventListener('input', onSettingsInput);
  body.addEventListener('change', onSettingsInput);
}

function freeTermId(terms) {
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(97 + i);
    if (terms.indexOf(letter) < 0) return letter;
  }
  return newId('t');
}

function addOpInput(block) {
  const terms = opTerms(block).slice();
  terms.push(freeTermId(terms));
  block.terms = terms;
  renderSettings(block.id);
  saveSoon();
  recompute();
}

function removeOpInput(block, index) {
  const terms = opTerms(block).slice();
  if (terms.length <= 1) return;
  const removed = terms.splice(index, 1)[0];
  block.terms = terms;
  model.wires = model.wires.filter(function (w) { return !(w.to === block.id && w.toPort === removed); });
  renderSettings(block.id);
  saveSoon();
  recompute();
}

function uniqueName(block, base) {
  const names = (block.inputs || []).map(function (p) { return p.name; });
  let name = base;
  let i = 2;
  while (names.indexOf(name) >= 0) { name = base + i; i++; }
  return name;
}

function onSettingsInput(e) {
  const el = e.target;
  const block = findBlock(selectedId());
  if (!block) return;
  const field = el.getAttribute('data-field');
  if (field === 'mode') {
    const dropped = switchComputeMode(block, el.value);
    if (dropped.length) {
      model.wires = model.wires.filter(function (w) { return !(w.to === block.id && dropped.indexOf(w.toPort) >= 0); });
      toast('Some wires were removed with the inputs that carried them.');
    }
    renderSettings(block.id);
    saveSoon();
    recompute();
    return;
  }
  if (field) {
    if (field === 'value' || field === 'min' || field === 'likely' || field === 'max') {
      const raw = el.value.trim();
      block[field] = raw === '' ? null : Number(raw);
    } else {
      block[field] = el.value;
    }
    if (field === 'unit' || field === 'displayUnit') refreshUnitList();
    if (field === 'op') {
      // a two-input operation keeps only its first two inputs
      if (!isVariadicOp(block.op)) {
        const terms = opTerms(block).slice(0, 2);
        const kept = {};
        for (const t of terms) kept[t] = true;
        block.terms = terms;
        model.wires = model.wires.filter(function (w) { return !(w.to === block.id && !kept[w.toPort]); });
      }
      renderSettings(block.id);
    }
    saveSoon();
    recompute();
    return;
  }
  const portIndex = el.getAttribute('data-portname');
  if (portIndex !== null && portIndex !== undefined && block.inputs) {
    const p = block.inputs[Number(portIndex)];
    if (p) {
      p.name = el.value;
      saveSoon();
      recompute();
    }
  }
}

function escapeHtml(text) {
  return String(text === undefined || text === null ? '' : text)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;');
}

// ---------------------------------------------------------------- toolbar
els.modelName.value = model.name || 'Untitled model';
els.modelName.addEventListener('input', function () {
  model.name = els.modelName.value;
  saveSoon();
});

document.querySelectorAll('.palette-item[data-type]').forEach(function (item) {
  item.addEventListener('click', function () {
    addBlock(item.getAttribute('data-type'));
  });
});

document.getElementById('btnClear').addEventListener('click', clearSiteData);

document.getElementById('btnNew').addEventListener('click', function () {
  if (model.blocks.length && !confirm('Start a new model? The current one stays only in this browser until you export it.')) return;
  model = defaultModel('Untitled model');
  els.modelName.value = model.name;
  canvasView.clearSelection();
  renderSettings(null);
  saveSoon();
  recompute();
  canvasView.fit();
});

document.getElementById('btnZoomFit').addEventListener('click', function () { canvasView.fit(); });
document.getElementById('btnAutoFit').addEventListener('click', function () { setAutoFit(!autoFit); });
document.getElementById('btnZoomIn').addEventListener('click', function () { canvasView.zoomBy(1.22); });
document.getElementById('btnZoomOut').addEventListener('click', function () { canvasView.zoomBy(1 / 1.22); });
document.getElementById('btnZoomReset').addEventListener('click', function () { canvasView.resetZoom(); });
document.getElementById('btnArrange').addEventListener('click', function () { autoArrange(); });
document.getElementById('btnCompact').addEventListener('click', function () {
  const anyExpanded = model.blocks.some(function (b) { return !b.collapsed; });
  setAllCollapsed(anyExpanded);
});
document.getElementById('btnShowAll').addEventListener('click', function () { setFocus(null); });

document.getElementById('btnExportJson').addEventListener('click', function () {
  exportJson(model);
  toast('Model exported as JSON.');
});
document.getElementById('btnExportSvg').addEventListener('click', function () {
  exportSvg(els.svg, model);
  toast('Vector SVG exported — it stays crisp at any zoom.');
});
document.getElementById('btnExportPng').addEventListener('click', function () {
  exportPng(els.svg, model, 3);
  toast('High-resolution PNG exported (3x).');
});

document.getElementById('btnImport').addEventListener('click', function () {
  els.fileInput.click();
});
els.fileInput.addEventListener('change', function () {
  const file = els.fileInput.files && els.fileInput.files[0];
  if (!file) return;
  importJson(file, function (parsed) {
    if (!parsed || !Array.isArray(parsed.blocks) || !Array.isArray(parsed.wires)) {
      toast('That file does not look like a model export.');
      return;
    }
    if (parsed.version !== 2) {
      toast('That file was exported by an earlier version of the tool and cannot be imported. This version uses the new block model (Compute blocks with marked outcomes).');
      return;
    }
    model = parsed;
    model.name = model.name || 'Imported model';
    els.modelName.value = model.name;
    canvasView.clearSelection();
    renderSettings(null);
    saveSoon();
    recompute();
    canvasView.fit();
    toast('Model imported.');
  }, function (message) {
    toast(message);
  });
  els.fileInput.value = '';
});

// ---------------------------------------------------- selected-wire bar
// Touch-friendly wire removal: tapping a wire selects it and this bar offers
// the delete, since a phone has no Delete key to press.
function renderWireBar(id) {
  const wire = id ? model.wires.find(function (w) { return w.id === id; }) : null;
  const from = wire ? findBlock(wire.from) : null;
  const to = wire ? findBlock(wire.to) : null;
  if (!wire || !from || !to) {
    els.wireBar.hidden = true;
    return;
  }
  els.wireLabel.textContent = blockTitle(from) + ' → ' + blockTitle(to);
  els.wireBar.hidden = false;
}

els.btnDeleteWire.addEventListener('click', function () {
  const sel = canvasView.getSelection();
  if (!sel || sel.kind !== 'wire') return;
  canvasView.deleteSelection();
  renderSettings(null);
  toast('Wire removed.');
});

els.btnWireDeselect.addEventListener('click', function () {
  canvasView.clearSelection();
  renderSettings(null);
});

// keyboard
window.addEventListener('keydown', function (e) {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
  if (e.key === 'Escape') {
    // Escape backs out one layer at a time: dialog, then port menu, then pop-out
    if (dialogOpen()) {
      closeCreateDialog();
      return;
    }
    const portMenu = document.getElementById('portMenu');
    if (portMenu && !portMenu.hidden) {
      closePortMenu();
      return;
    }
    closePopouts();
    if (focusId) {
      setFocus(null);
      return;
    }
    canvasView.clearSelection();
    renderSettings(null);
    closeSheets();
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && !dialogOpen()) {
    if (canvasView.deleteSelection()) {
      renderSettings(null);
      saveSoon();
      recompute();
      e.preventDefault();
    }
  }
});

// mobile sheets
function closeSheets() {
  els.palette.classList.remove('open');
  els.side.classList.remove('open');
  els.scrim.hidden = true;
}
document.getElementById('btnPalette').addEventListener('click', function () {
  const open = els.palette.classList.contains('open');
  closeSheets();
  if (!open) {
    els.palette.classList.add('open');
    els.scrim.hidden = false;
  }
});
document.getElementById('btnSettings').addEventListener('click', function () {
  const open = els.side.classList.contains('open');
  closeSheets();
  if (!open) {
    els.side.classList.add('open');
    els.scrim.hidden = false;
  }
});
els.scrim.addEventListener('click', closeSheets);

// ------------------------------------------------------------------- boot
recompute();
renderSettings(null);
refreshViewMenu();
setTimeout(function () {
  if (model.blocks.length) canvasView.fit();
  else canvasView.render();
}, 30);

// keep the canvas laid out when the window resizes
window.addEventListener('resize', function () {
  canvasView.render();
});
