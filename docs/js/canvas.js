// canvas.js — SVG node-graph rendering and pointer interaction (mouse + touch).
import { blockPorts, blockTitle, blockHasOutput, OPS, isVariadicOp } from './engine.js';
import { formatValue } from './units.js';

export const TYPE_META = {
  input: { color: '#4fd1c5', label: 'VALUE INPUT' },
  op: { color: '#f6ad55', label: 'OPERATION' },
  formula: { color: '#b794f4', label: 'FORMULA' },
  result: { color: '#68d391', label: 'RESULT' }
};

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const SANS = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
const LINK = '#6ea8fe';

function esc(text) {
  return String(text === undefined || text === null ? '' : text)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;');
}

function shortError(text) {
  const t = String(text || '');
  const quoted = t.split('"').filter(function (s, i) { return i % 2 === 1; });
  if (t.indexOf('not connected') >= 0) return quoted[0] ? 'connect ' + quoted[0] : 'not connected';
  if (t.indexOf('not an input') >= 0) return quoted[1] ? 'no input ' + quoted[1] : 'check inputs';
  if (t.indexOf('needs an expression') >= 0) return 'needs an expression';
  if (t.indexOf('needs a number') >= 0) return 'needs a number';
  if (t.indexOf('Division by zero') >= 0) return 'divide by zero';
  if (t.indexOf('different kinds') >= 0) return 'unit mismatch';
  if (t.indexOf('loop') >= 0) return 'wiring loop';
  return t.length > 20 ? t.slice(0, 19) + '…' : t;
}

function trunc(text, n) {
  const s = String(text === undefined ? '' : text);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function blockGeometry(block) {
  const ports = blockPorts(block);
  const w = 212;
  if (block.collapsed) {
    // mini card: header only, value inline — for overview layouts
    return { w: w, h: 54, headerH: 54, rowH: 0, footerH: 0, rows: 0, ports: ports, addRow: 0, collapsed: true };
  }
  const headerH = 42;
  const rowH = 27;
  const footerH = block.type === 'result' ? 58 : block.type === 'formula' ? 52 : 42;
  const addRow = block.type === 'op' && isVariadicOp(block.op) ? 1 : 0;
  const rows = Math.max(1, ports.length) + addRow;
  const h = headerH + rows * rowH + footerH;
  return { w: w, h: h, headerH: headerH, rowH: rowH, footerH: footerH, rows: rows, ports: ports, addRow: addRow, collapsed: false };
}

// Vertical position (inside the card) of the i-th input port.
function portLocalY(g, index) {
  if (g.collapsed) {
    const n = Math.max(1, g.ports.length);
    return 9 + (Math.max(0, index) + 0.5) * (g.h - 18) / n;
  }
  return g.headerH + index * g.rowH + g.rowH / 2;
}

export function portPoint(block, portId) {
  const g = blockGeometry(block);
  const idx = g.ports.findIndex(function (p) { return p.id === portId; });
  if (idx < 0 && !g.collapsed) return { x: block.x + g.w / 2, y: block.y + g.h / 2, dir: 'in' };
  return { x: block.x, y: block.y + portLocalY(g, idx < 0 ? 0 : idx), dir: 'in' };
}

export function outPoint(block) {
  const g = blockGeometry(block);
  return { x: block.x + g.w, y: block.y + g.h / 2, dir: 'out' };
}

export function blockRect(block) {
  const g = blockGeometry(block);
  return { x: block.x, y: block.y, w: g.w, h: g.h };
}

// Every anchor a wire can start or end on, in world coordinates.
export function portAnchors(block) {
  const g = blockGeometry(block);
  const list = [];
  for (let i = 0; i < g.ports.length; i++) {
    list.push({ blockId: block.id, portId: g.ports[i].id, dir: 'in', x: block.x, y: block.y + portLocalY(g, i) });
  }
  if (blockHasOutput(block)) {
    list.push({ blockId: block.id, portId: 'out', dir: 'out', x: block.x + g.w, y: block.y + g.h / 2 });
  }
  return list;
}

function wirePath(a, b) {
  const dx = Math.max(48, Math.min(180, Math.abs(b.x - a.x) * 0.55 + Math.abs(b.y - a.y) * 0.12));
  return 'M ' + a.x + ' ' + a.y + ' C ' + (a.x + dx) + ' ' + a.y + ', ' + (b.x - dx) + ' ' + b.y + ', ' + b.x + ' ' + b.y;
}

export function createCanvas(opts) {
  const svg = opts.svg;
  const view = { x: 0, y: 0, k: 1 };
  const pointers = new Map();
  let gesture = null;
  let pinch = null;
  let pending = null;      // { blockId, portId, dir } awaiting a second tap or a drop
  let tempWire = null;     // { from, to: {x, y} }
  let snapTarget = null;   // { blockId, portId, dir, x, y } the wire is magnetised to
  let selection = null;    // { kind: 'block' | 'wire', id }

  function model() { return opts.getModel(); }
  function values() { return opts.getValues() || {}; }

  function visibleIds() { return opts.getVisibleIds ? opts.getVisibleIds() : null; }
  function visibleBlocks() {
    const m = model();
    const vis = visibleIds();
    return vis ? m.blocks.filter(function (b) { return vis.has(b.id); }) : m.blocks;
  }
  function visibleWires() {
    const m = model();
    const vis = visibleIds();
    return vis ? m.wires.filter(function (w) { return vis.has(w.from) && vis.has(w.to); }) : m.wires;
  }

  function svgSize() {
    const r = svg.getBoundingClientRect();
    return { w: r.width || 800, h: r.height || 600 };
  }

  function clientToCanvas(cx, cy) {
    const r = svg.getBoundingClientRect();
    return {
      x: (cx - r.left - view.x) / view.k,
      y: (cy - r.top - view.y) / view.k
    };
  }

  // ---------------------------------------------------------------- rendering
  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    const run = function () { renderQueued = false; render(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function render() {
    const m = model();
    const vals = values();
    const parts = [];
    parts.push('<rect x="-20000" y="-20000" width="40000" height="40000" fill="url(#grid)" />');
    parts.push('<g id="viewport" transform="translate(' + view.x + ' ' + view.y + ') scale(' + view.k + ')">');

    // wires first
    for (const w of visibleWires()) {
      const from = m.blocks.find(function (b) { return b.id === w.from; });
      const to = m.blocks.find(function (b) { return b.id === w.to; });
      if (!from || !to) continue;
      const a = outPoint(from);
      const b = portPoint(to, w.toPort);
      const meta = TYPE_META[from.type] || TYPE_META.input;
      const d = wirePath(a, b);
      const selected = selection && selection.kind === 'wire' && selection.id === w.id;
      const upValue = vals[from.id];
      const label = upValue && !upValue.error ? upValue.display : '';
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 10 };
      parts.push('<path d="' + d + '" fill="none" stroke="' + meta.color + '" stroke-opacity="0.16" stroke-width="8" stroke-linecap="round" />');
      parts.push('<path d="' + d + '" fill="none" stroke="' + meta.color + '" stroke-opacity="' + (selected ? 1 : 0.85) + '" stroke-width="' + (selected ? 3.4 : 2.2) + '" stroke-linecap="round" />');
      parts.push('<path d="' + d + '" fill="none" stroke="transparent" stroke-width="16" data-wire="' + esc(w.id) + '" style="cursor:pointer" />');
      if (label) {
        const tw = label.length * 6.6 + 12;
        parts.push('<g pointer-events="none"><rect x="' + (mid.x - tw / 2) + '" y="' + (mid.y - 11) + '" width="' + tw + '" height="18" rx="9" fill="#0b1226" stroke="rgba(110,168,254,0.28)" />');
        parts.push('<text x="' + mid.x + '" y="' + (mid.y + 2) + '" text-anchor="middle" font-family="' + MONO + '" font-size="10.5" fill="#cfe0ff">' + esc(label) + '</text></g>');
      }
    }

    // blocks
    for (const block of visibleBlocks()) {
      parts.push(renderBlock(block, vals[block.id]));
    }

    // temp wire
    if (tempWire && pending) {
      const from = m.blocks.find(function (b) { return b.id === pending.blockId; });
      if (from) {
        const a = pending.dir === 'out' ? outPoint(from) : portPoint(from, pending.portId);
        const to = snapTarget ? { x: snapTarget.x, y: snapTarget.y } : tempWire.to;
        const d = wirePath(a, to);
        parts.push('<path d="' + d + '" fill="none" stroke="' + LINK + '" stroke-width="2.4" stroke-dasharray="7 6" stroke-linecap="round" />');
        if (snapTarget) {
          parts.push('<circle cx="' + to.x + '" cy="' + to.y + '" r="12" fill="rgba(110,168,254,0.16)" stroke="' + LINK + '" stroke-width="2.2" />');
          parts.push('<circle cx="' + to.x + '" cy="' + to.y + '" r="4" fill="' + LINK + '" />');
        } else {
          parts.push('<circle cx="' + to.x + '" cy="' + to.y + '" r="7" fill="none" stroke="' + LINK + '" stroke-width="2" />');
        }
      }
    }

    parts.push('</g>');
    svg.innerHTML = defs() + parts.join('');
  }

  function defs() {
    return '<defs>' +
      '<pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse">' +
      '<rect width="26" height="26" fill="none" />' +
      '<path d="M 26 0 L 0 0 0 26" fill="none" stroke="rgba(110,168,254,0.07)" stroke-width="1" />' +
      '</pattern>' +
      '<linearGradient id="resultGrad" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#12263a" /><stop offset="100%" stop-color="#123028" />' +
      '</linearGradient>' +
      '</defs>';
  }

  // While a link is being made, ports that can accept it glow.
  function portLinkable(blockId, dir) {
    if (!pending) return false;
    if (pending.blockId === blockId) return false;
    return pending.dir !== dir;
  }

  function headerButtons(block, g) {
    const out = [];
    const cy = 16;
    const focusX = g.collapsed ? g.w - 38 : g.w - 64;
    const foldX = g.collapsed ? g.w - 14 : g.w - 38;
    out.push('<g data-focus="1" data-btnblock="' + esc(block.id) + '" style="cursor:pointer"><title>Open this block and everything it is built from</title>' +
      '<circle cx="' + focusX + '" cy="' + cy + '" r="11" fill="rgba(110,168,254,0.14)" stroke="rgba(110,168,254,0.38)" />' +
      '<circle cx="' + focusX + '" cy="' + cy + '" r="4.2" fill="none" stroke="' + LINK + '" stroke-width="1.6" pointer-events="none" />' +
      '<circle cx="' + focusX + '" cy="' + cy + '" r="1.6" fill="' + LINK + '" pointer-events="none" /></g>');
    out.push('<g data-collapse="1" data-btnblock="' + esc(block.id) + '" style="cursor:pointer"><title>' + (block.collapsed ? 'Expand this card' : 'Shrink this card') + '</title>' +
      '<circle cx="' + foldX + '" cy="' + cy + '" r="11" fill="rgba(110,168,254,0.14)" stroke="rgba(110,168,254,0.38)" />' +
      '<rect x="' + (foldX - 4.5) + '" y="' + (cy - 1) + '" width="9" height="2" rx="1" fill="' + LINK + '" pointer-events="none" />' +
      (block.collapsed ? '<rect x="' + (foldX - 1) + '" y="' + (cy - 4.5) + '" width="2" height="9" rx="1" fill="' + LINK + '" pointer-events="none" />' : '') +
      '</g>');
    return out;
  }

  function renderBlock(block, val) {
    const meta = TYPE_META[block.type] || TYPE_META.input;
    const g = blockGeometry(block);
    const selected = selection && selection.kind === 'block' && selection.id === block.id;
    const hasError = val && val.error;
    const stroke = hasError ? '#fc8181' : meta.color;
    const out = [];
    out.push('<g data-block="' + esc(block.id) + '" transform="translate(' + block.x + ' ' + block.y + ')" style="cursor:grab">');

    // card
    const fill = block.type === 'result' ? 'url(#resultGrad)' : '#111c33';
    out.push('<rect x="0" y="0" width="' + g.w + '" height="' + g.h + '" rx="14" fill="' + fill + '" stroke="' + stroke + '" stroke-opacity="' + (selected ? 0.95 : 0.42) + '" stroke-width="' + (selected ? 2.4 : 1.4) + '" />');
    if (selected) {
      out.push('<rect x="-5" y="-5" width="' + (g.w + 10) + '" height="' + (g.h + 10) + '" rx="18" fill="none" stroke="' + stroke + '" stroke-opacity="0.28" stroke-width="1.4" />');
    }
    // header accent edge — clipped to the card's rounded corners so it hugs the top
    out.push('<clipPath id="clip-' + esc(block.id) + '"><rect x="0" y="0" width="' + g.w + '" height="' + g.h + '" rx="14" /></clipPath>');
    out.push('<rect x="1" y="1" width="' + (g.w - 2) + '" height="5" fill="' + meta.color + '" opacity="0.9" clip-path="url(#clip-' + esc(block.id) + ')" />');

    // header text
    out.push('<text x="14" y="22" font-family="' + MONO + '" font-size="9.5" letter-spacing="1.6" fill="' + meta.color + '" opacity="0.95">' + meta.label + '</text>');
    const title = blockTitle(block);
    out.push('<text x="14" y="' + (g.collapsed ? 42 : 38) + '" font-family="' + SANS + '" font-size="' + (g.collapsed ? 13.5 : 14.5) + '" font-weight="600" fill="#eef3ff">' + esc(trunc(title, g.collapsed ? 18 : 24)) + '</text>');

    if (g.collapsed) {
      // mini card: value inline, ports as small edge dots, fold + focus buttons
      const display = val ? (val.error ? shortError(val.error) : val.display) : '—';
      const valueColor = hasError ? '#fc8181' : (block.type === 'result' ? '#68d391' : '#eaf1ff');
      out.push('<text x="' + (g.w - 12) + '" y="42" text-anchor="end" font-family="' + MONO + '" font-size="12.5" font-weight="600" fill="' + valueColor + '">' + esc(trunc(display, 13)) + '</text>');
      for (let i = 0; i < g.ports.length; i++) {
        const py = portLocalY(g, i);
        out.push('<circle cx="0" cy="' + py + '" r="15" fill="transparent" data-port="1" data-block="' + esc(block.id) + '" data-portid="' + esc(g.ports[i].id) + '" data-dir="in" style="cursor:crosshair" />');
        out.push('<circle cx="0" cy="' + py + '" r="4" fill="#0b1226" stroke="' + meta.color + '" stroke-width="1.8" pointer-events="none" />');
        if (portLinkable(block.id, 'in')) out.push('<circle cx="0" cy="' + py + '" r="9" fill="none" stroke="' + LINK + '" stroke-opacity="0.55" stroke-width="1.6" pointer-events="none" />');
      }
      if (blockHasOutput(block)) {
        const oy = g.h / 2;
        out.push('<circle cx="' + g.w + '" cy="' + oy + '" r="15" fill="transparent" data-port="1" data-block="' + esc(block.id) + '" data-portid="out" data-dir="out" style="cursor:crosshair" />');
        out.push('<circle cx="' + g.w + '" cy="' + oy + '" r="4" fill="#0b1226" stroke="' + meta.color + '" stroke-width="1.8" pointer-events="none" />');
        if (portLinkable(block.id, 'out')) out.push('<circle cx="' + g.w + '" cy="' + oy + '" r="9" fill="none" stroke="' + LINK + '" stroke-opacity="0.55" stroke-width="1.6" pointer-events="none" />');
      }
      if (hasError) out.push('<title>' + esc(val.error) + '</title>');
      out.push(headerButtons(block, g).join(''));
      out.push('</g>');
      return out.join('');
    }

    // port rows
    for (let i = 0; i < g.ports.length; i++) {
      const p = g.ports[i];
      const py = g.headerH + i * g.rowH + g.rowH / 2;
      out.push('<text x="18" y="' + (py + 4) + '" font-family="' + MONO + '" font-size="11.5" fill="#9db1d8">' + esc(trunc(p.label, 16)) + '</text>');
      out.push('<circle cx="0" cy="' + py + '" r="21" fill="transparent" data-port="1" data-block="' + esc(block.id) + '" data-portid="' + esc(p.id) + '" data-dir="in" style="cursor:crosshair" />');
      out.push('<circle cx="0" cy="' + py + '" r="5.5" fill="#0b1226" stroke="' + meta.color + '" stroke-width="2" pointer-events="none" />');
      out.push('<circle cx="0" cy="' + py + '" r="2" fill="' + meta.color + '" pointer-events="none" />');
      if (portLinkable(block.id, 'in')) out.push('<circle cx="0" cy="' + py + '" r="12" fill="none" stroke="' + LINK + '" stroke-opacity="0.55" stroke-width="2" pointer-events="none" />');
    }

    // add-input affordance for operations that take any number of inputs
    if (g.addRow) {
      const ay = g.headerH + g.ports.length * g.rowH + g.rowH / 2;
      out.push('<rect x="12" y="' + (ay - 11) + '" width="' + (g.w - 24) + '" height="22" rx="8" fill="rgba(246,173,85,0.08)" stroke="rgba(246,173,85,0.3)" stroke-dasharray="4 4" data-addterm="1" data-block="' + esc(block.id) + '" style="cursor:pointer"><title>Add another input</title></rect>');
      out.push('<text x="' + (g.w / 2) + '" y="' + (ay + 4) + '" text-anchor="middle" font-family="' + MONO + '" font-size="10.5" fill="#f6ad55" opacity="0.9" pointer-events="none">+ add input</text>');
    }

    // output port
    if (blockHasOutput(block)) {
      const oy = g.h / 2;
      out.push('<circle cx="' + g.w + '" cy="' + oy + '" r="21" fill="transparent" data-port="1" data-block="' + esc(block.id) + '" data-portid="out" data-dir="out" style="cursor:crosshair" />');
      out.push('<circle cx="' + g.w + '" cy="' + oy + '" r="5.5" fill="#0b1226" stroke="' + meta.color + '" stroke-width="2" pointer-events="none" />');
      out.push('<circle cx="' + g.w + '" cy="' + oy + '" r="2" fill="' + meta.color + '" pointer-events="none" />');
      if (portLinkable(block.id, 'out')) out.push('<circle cx="' + g.w + '" cy="' + oy + '" r="12" fill="none" stroke="' + LINK + '" stroke-opacity="0.55" stroke-width="2" pointer-events="none" />');
    }

    // footer value
    const fy = g.headerH + g.rows * g.rowH;
    out.push('<line x1="10" y1="' + fy + '" x2="' + (g.w - 10) + '" y2="' + fy + '" stroke="rgba(110,168,254,0.16)" />');
    const display = val ? (val.error ? shortError(val.error) : val.display) : '—';
    const valueColor = hasError ? '#fc8181' : '#eaf1ff';
    if (block.type === 'result') {
      out.push('<text x="14" y="' + (fy + 15) + '" font-family="' + MONO + '" font-size="9.5" letter-spacing="1.4" fill="#8fa0c4">FINAL RESULT</text>');
      out.push('<text x="14" y="' + (fy + 42) + '" font-family="' + MONO + '" font-size="21" font-weight="700" fill="#68d391">' + esc(trunc(display, 20)) + '</text>');
    } else if (block.type === 'formula') {
      out.push('<text x="14" y="' + (fy + 18) + '" font-family="' + MONO + '" font-size="10.5" fill="#8fa0c4">' + esc(trunc(block.expr || 'empty expression', 28)) + '</text>');
      out.push('<text x="14" y="' + (fy + 38) + '" font-family="' + MONO + '" font-size="15" font-weight="600" fill="' + valueColor + '">' + esc(trunc(display, 18)) + '</text>');
    } else if (block.type === 'op') {
      const op = OPS[block.op] || OPS.add;
      out.push('<text x="14" y="' + (fy + 27) + '" font-family="' + MONO + '" font-size="17" fill="' + meta.color + '">' + esc(op.symbol) + '</text>');
      out.push('<text x="46" y="' + (fy + 27) + '" font-family="' + MONO + '" font-size="15" font-weight="600" fill="' + valueColor + '">' + esc(trunc(display, 16)) + '</text>');
    } else {
      const unit = val && val.unit ? (val.unit.l || '') : (block.unit || '');
      out.push('<text x="14" y="' + (fy + 27) + '" font-family="' + MONO + '" font-size="16" font-weight="600" fill="' + valueColor + '">' + esc(trunc(display, 16)) + '</text>');
      if (unit) {
        out.push('<rect x="' + (g.w - 16 - unit.length * 7.2) + '" y="' + (fy + 13) + '" width="' + (unit.length * 7.2 + 12) + '" height="20" rx="10" fill="rgba(79,209,197,0.14)" stroke="rgba(79,209,197,0.35)" />');
        out.push('<text x="' + (g.w - 10 - unit.length * 7.2) + '" y="' + (fy + 27) + '" font-family="' + MONO + '" font-size="11" fill="#7fe6da">' + esc(unit) + '</text>');
      }
    }

    if (hasError) {
      out.push('<g><circle cx="' + (g.w - 14) + '" cy="16" r="9" fill="#fc8181" />');
      out.push('<text x="' + (g.w - 14) + '" y="20" text-anchor="middle" font-family="' + SANS + '" font-size="12" font-weight="700" fill="#2a0b0b">!</text></g>');
      out.push('<title>' + esc(val.error) + '</title>');
    }
    out.push(headerButtons(block, g).join(''));
    out.push('</g>');
    return out.join('');
  }

  // ------------------------------------------------------------- interaction
  function hitTarget(e) {
    // With pointer capture, e.target is the svg root; hit-test the real element.
    let el = null;
    try {
      if (document.elementFromPoint && e.clientX !== undefined) {
        el = document.elementFromPoint(e.clientX, e.clientY);
      }
    } catch (err) {
      el = null;
    }
    if (!el || el === svg || !el.closest) el = e.target;
    if (el && el.closest) {
      const port = el.closest('[data-port]');
      if (port) return { kind: 'port', blockId: port.getAttribute('data-block'), portId: port.getAttribute('data-portid'), dir: port.getAttribute('data-dir') };
      const wire = el.closest('[data-wire]');
      if (wire) return { kind: 'wire', id: wire.getAttribute('data-wire') };
      const add = el.closest('[data-addterm]');
      if (add) return { kind: 'addterm', id: add.getAttribute('data-block') };
      const focus = el.closest('[data-focus]');
      if (focus) return { kind: 'focus', id: focus.getAttribute('data-btnblock') };
      const fold = el.closest('[data-collapse]');
      if (fold) return { kind: 'collapse', id: fold.getAttribute('data-btnblock') };
      const block = el.closest('[data-block]');
      if (block) return { kind: 'block', id: block.getAttribute('data-block') };
    }
    return { kind: 'empty' };
  }

  // Magnetise the loose wire end to the nearest port it can legally land on,
  // so a connection never needs pixel precision.
  function updateSnap(pt, e) {
    snapTarget = null;
    const from = pending;
    if (!from) return;
    const radius = 52 / view.k;
    let best = null;
    let bestD = radius;
    for (const b of visibleBlocks()) {
      for (const a of portAnchors(b)) {
        if (a.blockId === from.blockId || a.dir === from.dir) continue;
        const d = Math.hypot(a.x - pt.x, a.y - pt.y);
        if (d < bestD) { bestD = d; best = a; }
      }
    }
    if (best) {
      snapTarget = { blockId: best.blockId, portId: best.portId, dir: best.dir, x: best.x, y: best.y };
      return;
    }
    // nothing close: preview a drop straight onto a card, which uses its first free input
    if (e && opts.previewTarget) {
      const hit = hitTarget(e);
      if (hit.kind === 'block' && hit.id !== from.blockId) {
        const target = model().blocks.find(function (b) { return b.id === hit.id; });
        const portId = opts.previewTarget(from.blockId, from.portId, from.dir, hit.id);
        if (target && portId) {
          const p = portId === 'out' ? outPoint(target) : portPoint(target, portId);
          snapTarget = { blockId: target.id, portId: portId, dir: portId === 'out' ? 'out' : 'in', x: p.x, y: p.y };
        }
      }
    }
  }

  function finishLink(hit) {
    const from = pending;
    if (!from) return false;
    if (hit && hit.kind === 'port' && hit.blockId !== from.blockId) {
      opts.connect(from.blockId, from.portId, from.dir, hit.blockId, hit.portId, hit.dir);
    } else if (snapTarget && snapTarget.blockId !== from.blockId) {
      opts.connect(from.blockId, from.portId, from.dir, snapTarget.blockId, snapTarget.portId, snapTarget.dir);
    } else if (hit && hit.kind === 'block' && hit.id !== from.blockId && opts.connectAuto) {
      opts.connectAuto(from.blockId, from.portId, from.dir, hit.id);
    } else {
      return false;
    }
    pending = null;
    tempWire = null;
    snapTarget = null;
    return true;
  }

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    svg.setPointerCapture && svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, t: Date.now() });
    if (pointers.size === 2) {
      const pts = Array.from(pointers.values());
      pinch = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2
      };
      gesture = { kind: 'pinch' };
      tempWire = null;
      return;
    }
    const hit = hitTarget(e);
    const pt = clientToCanvas(e.clientX, e.clientY);
    if (hit.kind === 'port') {
      if (pending && pending.blockId !== hit.blockId) {
        opts.connect(pending.blockId, pending.portId, pending.dir, hit.blockId, hit.portId, hit.dir);
        pending = null;
        tempWire = null;
        snapTarget = null;
        gesture = null;
        render();
        return;
      }
      if (pending && pending.blockId === hit.blockId && pending.portId === hit.portId) {
        // tapping the very same port again abandons the link
        pending = null;
        tempWire = null;
        snapTarget = null;
        gesture = null;
        render();
        return;
      }
      pending = { blockId: hit.blockId, portId: hit.portId, dir: hit.dir };
      tempWire = { from: pending, to: pt };
      snapTarget = null;
      gesture = { kind: 'wire' };
      render();
      return;
    }
    if (pending && hit.kind === 'block' && hit.id !== pending.blockId && opts.connectAuto) {
      // the loose end drops onto a card: it takes that card's first free input
      opts.connectAuto(pending.blockId, pending.portId, pending.dir, hit.id);
      pending = null;
      tempWire = null;
      snapTarget = null;
      gesture = null;
      render();
      return;
    }
    if (hit.kind === 'focus' || hit.kind === 'collapse') {
      selection = { kind: 'block', id: hit.id };
      gesture = { kind: 'button', id: hit.id, action: hit.kind };
      opts.onSelect(hit.id);
      render();
      return;
    }
    if (hit.kind === 'block' || hit.kind === 'addterm') {
      const block = model().blocks.find(function (b) { return b.id === hit.id; });
      if (!block) return;
      selection = { kind: 'block', id: hit.id };
      gesture = { kind: 'block', id: hit.id, dx: pt.x - block.x, dy: pt.y - block.y, moved: false, addTerm: hit.kind === 'addterm' };
      opts.onSelect(hit.id);
      render();
      return;
    }
    if (hit.kind === 'wire') {
      selection = { kind: 'wire', id: hit.id };
      opts.onSelect(null);
      render();
      return;
    }
    // empty canvas: pan, and clear selection on tap
    gesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    pending = null;
    tempWire = null;
    snapTarget = null;
  }

  function onMove(e) {
    const p = pointers.get(e.pointerId);
    if (p) { p.x = e.clientX; p.y = e.clientY; }
    if (gesture && gesture.kind === 'pinch' && pointers.size >= 2) {
      const pts = Array.from(pointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      const rect = svg.getBoundingClientRect();
      if (pinch && pinch.dist > 0) {
        const factor = dist / pinch.dist;
        zoomAt(cx - rect.left, cy - rect.top, factor);
      }
      view.x += cx - (pinch ? pinch.cx : cx);
      view.y += cy - (pinch ? pinch.cy : cy);
      pinch = { dist: dist, cx: cx, cy: cy };
      render();
      return;
    }
    if (!gesture) return;
    if (gesture.kind === 'block') {
      const pt = clientToCanvas(e.clientX, e.clientY);
      const block = model().blocks.find(function (b) { return b.id === gesture.id; });
      if (!block) return;
      block.x = Math.round(pt.x - gesture.dx);
      block.y = Math.round(pt.y - gesture.dy);
      gesture.moved = true;
      scheduleRender();
      opts.onDrag();
    } else if (gesture.kind === 'wire') {
      tempWire.to = clientToCanvas(e.clientX, e.clientY);
      updateSnap(tempWire.to, e);
      scheduleRender();
    } else if (gesture.kind === 'pan') {
      const dx = e.clientX - gesture.sx;
      const dy = e.clientY - gesture.sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) gesture.moved = true;
      view.x = gesture.vx + dx;
      view.y = gesture.vy + dy;
      scheduleRender();
    }
  }

  function onUp(e) {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!gesture) return;
    const isTap = p ? (Math.abs(e.clientX - p.startX) + Math.abs(e.clientY - p.startY) < 9 && Date.now() - p.t < 700) : false;
    const kind = gesture.kind;
    if (kind === 'wire') {
      const hit = hitTarget(e);
      const linked = finishLink(hit);
      if (!linked && !isTap) {
        pending = null;
        tempWire = null;
      } else if (!linked) {
        // keep pending so the next tap can complete the connection
        tempWire = null;
      }
      snapTarget = null;
    } else if (kind === 'button' && isTap) {
      if (gesture.action === 'collapse' && opts.toggleCollapse) opts.toggleCollapse(gesture.id);
      else if (gesture.action === 'focus' && opts.setFocus) opts.setFocus(gesture.id);
    } else if (kind === 'pan' && isTap) {
      selection = null;
      opts.onSelect(null);
    } else if (kind === 'block' && isTap) {
      if (gesture.addTerm && opts.addInput) opts.addInput(gesture.id);
      opts.onSelect(gesture.id);
    }
    gesture = null;
    render();
  }

  function onWheel(e) {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * 0.0016);
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    render();
    opts.onView();
  }

  function zoomAt(sx, sy, factor) {
    const k2 = Math.max(0.2, Math.min(3.2, view.k * factor));
    const real = k2 / view.k;
    view.x = sx - (sx - view.x) * real;
    view.y = sy - (sy - view.y) * real;
    view.k = k2;
    opts.onView();
  }

  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onUp);
  svg.addEventListener('wheel', onWheel, { passive: false });

  // ------------------------------------------------------------------- api
  function fit() {
    const m = model();
    const blocks = visibleBlocks();
    const size = svgSize();
    if (!blocks.length) {
      view.k = 1;
      view.x = size.w / 2 - 106;
      view.y = size.h / 2 - 60;
      render();
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of blocks) {
      const r = blockRect(b);
      minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
    }
    const pad = 60;
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const k = Math.max(0.2, Math.min(1.4, Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh)));
    view.k = k;
    view.x = (size.w - bw * k) / 2 - minX * k;
    view.y = (size.h - bh * k) / 2 - minY * k;
    render();
    opts.onView();
  }

  function centerPoint() {
    const size = svgSize();
    return clientToCanvas(size.w / 2 + svg.getBoundingClientRect().left, size.h / 2 + svg.getBoundingClientRect().top);
  }

  return {
    render: render,
    fit: fit,
    centerPoint: centerPoint,
    clientToCanvas: clientToCanvas,
    zoomBy: function (f) {
      const size = svgSize();
      zoomAt(size.w / 2, size.h / 2, f);
      render();
    },
    resetZoom: function () {
      const size = svgSize();
      const c = { x: size.w / 2, y: size.h / 2 };
      view.x = c.x - (c.x - view.x) * (1 / view.k);
      view.y = c.y - (c.y - view.y) * (1 / view.k);
      view.k = 1;
      render();
      opts.onView();
    },
    getSelection: function () { return selection; },
    setSelection: function (s) { selection = s; render(); },
    clearSelection: function () { selection = null; pending = null; tempWire = null; snapTarget = null; render(); },
    deleteSelection: function () {
      if (!selection) return false;
      if (selection.kind === 'block') opts.deleteBlock(selection.id);
      else if (selection.kind === 'wire') opts.deleteWire(selection.id);
      selection = null;
      render();
      return true;
    },
    isPending: function () { return !!pending; },
    getView: function () { return Object.assign({}, view); },
    setView: function (v) { view.x = v.x; view.y = v.y; view.k = v.k; render(); }
  };
}
