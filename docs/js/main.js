// main.js — application controller: palette, inspector, sensitivity, persistence.
import { evaluateModel, sensitivity, validateModel, makeBlock, defaultModel, blockTitle, OPS, blockPorts, blockHasOutput, newId, isVariadicOp, opTerms, termLabel } from './engine.js';
import { COMMON_UNITS, formatValue, formatNumber } from './units.js';
import { createCanvas, blockRect } from './canvas.js';
import { exportSvg, exportPng, exportJson, importJson } from './exporter.js';
import { EXAMPLES } from './examples.js';

const STORE_KEY = 'ufa.model.v1';

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
    if (!parsed || !Array.isArray(parsed.blocks)) return null;
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
  onDrag: function () { saveSoon(); },
  onView: function () {},
  connect: function (fromId, fromPort, fromDir, toId, toPort, toDir) {
    connectPorts(fromId, fromPort, fromDir, toId, toPort, toDir);
  },
  deleteBlock: function (id) { deleteBlock(id); },
  addInput: function (id) {
    const block = findBlock(id);
    if (block && block.type === 'op' && isVariadicOp(block.op)) addOpInput(block);
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
  getVisibleIds: function () { return visibleIds(); }
});

function connectPorts(fromId, fromPort, fromDir, toId, toPort, toDir) {
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
    if (!portId && target.type === 'op' && isVariadicOp(target.op)) {
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
    toast('The Result block has no output port.');
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
  if (!options || !options.keepView) canvasView.fit();
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
  btn.textContent = anyExpanded ? 'Compact' : 'Expand';
  btn.title = anyExpanded ? 'Shrink every card to a mini overview' : 'Restore every card to full size';
}

// Lay the model out in flow order: inputs on the left, the result on the right,
// columns ordered to keep wires short and crossings few.
function autoArrange() {
  const blocks = model.blocks;
  if (!blocks.length) {
    toast('Add some blocks first.');
    return;
  }
  // column = length of the longest chain of wires feeding the block
  const depth = {};
  for (const b of blocks) depth[b.id] = 0;
  for (let pass = 0; pass <= blocks.length; pass++) {
    let changed = false;
    for (const w of model.wires) {
      if (depth[w.to] <= depth[w.from]) { depth[w.to] = depth[w.from] + 1; changed = true; }
    }
    if (!changed) break;
  }
  const byDepth = {};
  for (const b of blocks) {
    const d = depth[b.id];
    if (!byDepth[d]) byDepth[d] = [];
    byDepth[d].push(b);
  }
  const columns = Object.keys(byDepth).map(Number).sort(function (a, b) { return a - b; })
    .map(function (k) { return byDepth[k]; });

  // order each column by the average position of its neighbours (a few sweeps)
  const pos = {};
  columns.forEach(function (col) { col.forEach(function (b, i) { pos[b.id] = i; }); });
  function barycenter(b) {
    const near = [];
    for (const w of model.wires) {
      if (w.to === b.id && pos[w.from] !== undefined) near.push(pos[w.from]);
      if (w.from === b.id && pos[w.to] !== undefined) near.push(pos[w.to]);
    }
    if (!near.length) return null;
    return near.reduce(function (sum, v) { return sum + v; }, 0) / near.length;
  }
  for (let sweep = 0; sweep < 6; sweep++) {
    const order = sweep % 2 === 0 ? columns : columns.slice().reverse();
    for (const col of order) {
      const decorated = col.map(function (b, i) { return { b: b, key: barycenter(b), i: i }; });
      decorated.sort(function (m, n) {
        if (m.key === null && n.key === null) return m.i - n.i;
        if (m.key === null) return 1;
        if (n.key === null) return -1;
        return (m.key - n.key) || (m.i - n.i);
      });
      decorated.forEach(function (d, i) { col[i] = d.b; pos[d.b.id] = i; });
    }
  }

  // place the columns left to right, stacking cards with a gap
  const colGap = 96;
  const rowGap = 34;
  const cardW = 212;
  const heights = columns.map(function (col) {
    return col.reduce(function (sum, b) { return sum + blockRect(b).h; }, 0) + rowGap * Math.max(0, col.length - 1);
  });
  const tallest = Math.max.apply(null, heights);
  let x = 0;
  columns.forEach(function (col, ci) {
    let y = (tallest - heights[ci]) / 2;
    for (const b of col) {
      b.x = Math.round(x);
      b.y = Math.round(y);
      y += blockRect(b).h + rowGap;
    }
    x += cardW + colGap;
  });
  saveSoon();
  recompute();
  canvasView.fit();
  toast('Blocks arranged in flow order.');
}

function deleteBlock(id) {
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

function loadExample(id) {
  const ex = EXAMPLES.find(function (e) { return e.id === id; });
  if (!ex) return;
  if (model.blocks.length && !confirm('Load the "' + ex.name + '" example? It replaces the model on screen. Export yours as JSON first if you want to keep it.')) return;
  model = JSON.parse(JSON.stringify(ex.model));
  model.name = ex.name;
  els.modelName.value = model.name;
  canvasView.clearSelection();
  renderSettings(null);
  saveSoon();
  recompute();
  canvasView.fit();
  closeSheets();
  toast('Loaded the ' + ex.name + ' example.');
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

function addBlock(type) {
  if (type === 'result' && model.blocks.some(function (b) { return b.type === 'result'; })) {
    const existing = model.blocks.find(function (b) { return b.type === 'result'; });
    canvasView.setSelection({ kind: 'block', id: existing.id });
    renderSettings(existing.id);
    toast('This model already has a Result block — it is selected.');
    return;
  }
  const c = canvasView.centerPoint();
  const spot = findFreeSpot(c.x - 106, c.y - 60);
  const block = makeBlock(type, spot.x, spot.y);
  if (type === 'result') block.title = 'Result';
  model.blocks.push(block);
  saveSoon();
  recompute();
  canvasView.setSelection({ kind: 'block', id: block.id });
  renderSettings(block.id);
  if (window.innerWidth <= 860) closeSheets();
}

// -------------------------------------------------------------- recompute
function recompute() {
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
  const issues = validateModel(model).slice();
  for (const err of evalResult.errors) {
    if (issues.indexOf(err) < 0) issues.push(err);
  }
  if (!model.blocks.some(function (b) { return b.type === 'result'; })) {
    // already covered by validateModel
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
  if (result && !result.error) {
    parts.push('<div class="result-readout"><div class="rr-label">Final result</div><div class="rr-value">' + escapeHtml(result.display) + '</div></div>');
  } else if (result && result.error) {
    parts.push('<div class="result-readout"><div class="rr-label">Final result</div><div class="rr-value err">' + escapeHtml(result.error) + '</div></div>');
  } else {
    parts.push('<div class="result-readout"><div class="rr-label">Final result</div><div class="rr-value err">Wire something into the Result block</div></div>');
  }

  const sens = sensitivity(model, result);
  if (!sens.rows.length) {
    parts.push('<p class="panel-sub">Add Value inputs to see which one drives the outcome.</p>');
    els.sensitivityBody.innerHTML = parts.join('');
    return;
  }
  parts.push('<p class="panel-sub">Ranked by how much the final result moves when the input changes. Inputs with a min and a max are measured across that range; otherwise a +1% change is used.</p>');
  for (const row of sens.rows) {
    const width = Math.max(3, Math.round(row.share * 100));
    parts.push('<div class="sens-row">' +
      '<div class="sens-head"><span class="sens-name">' + escapeHtml(row.name) + '</span>' +
      '<span class="sens-impact">' + escapeHtml(row.display) + '</span></div>' +
      '<div class="sens-bar"><div class="sens-fill" style="width:' + width + '%"></div></div>' +
      '<div class="sens-detail">' + escapeHtml(row.detail) + '</div></div>');
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

function settingsHtml(block) {
  const unitChips = COMMON_UNITS.map(function (u) {
    return '<button type="button" class="chip" data-chip="' + escapeHtml(u) + '">' + escapeHtml(u) + '</button>';
  }).join('');
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
      '</div><datalist id="unitList">' + COMMON_UNITS.map(function (u) { return '<option value="' + escapeHtml(u) + '">'; }).join('') + '</datalist>';
    html += '<div class="chip-row">' + unitChips + '</div>';
    html += '<div class="field-hint">Units are checked everywhere: <code>$/unit</code> times <code>units</code> becomes <code>$</code>. Unknown words like <code>tickets</code> become their own unit.</div>';
    html += '<div class="field-row">' +
      field('Min', '<input type="number" step="any" data-field="min" value="' + escapeHtml(block.min === null || block.min === undefined ? '' : block.min) + '" placeholder="optional">') +
      field('Likely', '<input type="number" step="any" data-field="likely" value="' + escapeHtml(block.likely === null || block.likely === undefined ? '' : block.likely) + '" placeholder="optional">') +
      field('Max', '<input type="number" step="any" data-field="max" value="' + escapeHtml(block.max === null || block.max === undefined ? '' : block.max) + '" placeholder="optional">') +
      '</div>';
    html += '<div class="field-hint">Give a min and a max to measure this input across its real range in the sensitivity ranking.</div>';
  } else if (block.type === 'op') {
    html += field('Title', '<input type="text" data-field="title" value="' + escapeHtml(block.title || '') + '" spellcheck="false">');
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
  } else if (block.type === 'formula') {
    html += field('Title', '<input type="text" data-field="title" value="' + escapeHtml(block.title || '') + '" spellcheck="false">');
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
  } else if (block.type === 'result') {
    html += field('Title', '<input type="text" data-field="title" value="' + escapeHtml(block.title || '') + '" spellcheck="false">');
    html += field('Display unit', '<input type="text" list="unitList" data-field="displayUnit" value="' + escapeHtml(block.displayUnit || '') + '" placeholder="leave empty to infer" spellcheck="false"><datalist id="unitList">' + COMMON_UNITS.map(function (u) { return '<option value="' + escapeHtml(u) + '">'; }).join('') + '</datalist>');
    html += '<div class="field-hint">Optional. Show the result in a unit of the same kind, for example <code>hrs</code> instead of <code>min</code>.</div>';
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
      block.unit = chip.getAttribute('data-chip');
      renderSettings(block.id);
      saveSoon();
      recompute();
    });
  });
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
  if (field) {
    if (field === 'value' || field === 'min' || field === 'likely' || field === 'max') {
      const raw = el.value.trim();
      block[field] = raw === '' ? null : Number(raw);
    } else {
      block[field] = el.value;
    }
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

document.querySelectorAll('.palette-item[data-example]').forEach(function (item) {
  item.addEventListener('click', function () {
    loadExample(item.getAttribute('data-example'));
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

document.getElementById('btnFit').addEventListener('click', function () { canvasView.fit(); });
document.getElementById('btnZoomFit').addEventListener('click', function () { canvasView.fit(); });
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
  if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) {
    if (canvasView.deleteSelection()) {
      renderSettings(null);
      saveSoon();
      recompute();
      e.preventDefault();
    }
  }
  if (e.key === 'Escape') {
    if (focusId) {
      setFocus(null);
      return;
    }
    canvasView.clearSelection();
    renderSettings(null);
    closeSheets();
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
setTimeout(function () {
  if (model.blocks.length) canvasView.fit();
  else canvasView.render();
}, 30);

// keep the canvas laid out when the window resizes
window.addEventListener('resize', function () {
  canvasView.render();
});
