// main.js — application controller: palette, inspector, sensitivity, persistence.
import { evaluateModel, sensitivity, validateModel, makeBlock, defaultModel, blockTitle, OPS, blockPorts, newId } from './engine.js';
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
  scrim: document.getElementById('sheetScrim')
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
  onDrag: function () { saveSoon(); },
  onView: function () {},
  connect: function (fromId, fromPort, fromDir, toId, toPort, toDir) {
    connectPorts(fromId, fromPort, fromDir, toId, toPort, toDir);
  },
  deleteBlock: function (id) { deleteBlock(id); },
  deleteWire: function (id) {
    model.wires = model.wires.filter(function (w) { return w.id !== id; });
    saveSoon();
    recompute();
  }
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

function deleteBlock(id) {
  model.blocks = model.blocks.filter(function (b) { return b.id !== id; });
  model.wires = model.wires.filter(function (w) { return w.from !== id && w.to !== id; });
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
    html += '<div class="field-hint">The left port is <code>a</code>, the right port is <code>b</code>. Add and subtract require the same kind of quantity; multiply and divide combine units.</div>';
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
  const del = body.querySelector('[data-delete]');
  if (del) {
    del.addEventListener('click', function () {
      deleteBlock(block.id);
    });
  }
  body.addEventListener('input', onSettingsInput);
  body.addEventListener('change', onSettingsInput);
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
