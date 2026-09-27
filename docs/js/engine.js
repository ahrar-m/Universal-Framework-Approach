// engine.js — model evaluation for the Universal Framework Approach.
// A model is a DAG of blocks joined by wires. Values flow from inputs to the result.

import { parseUnit, combineMul, combineDiv, powUnit, sameDims, isRatio, dimensionless, toBase, fromBase, formatValue, describeUnit, formatNumber } from './units.js';
import { parseExpr, collectNames, roundTo, FUNCTIONS } from './expr.js';

export const OPS = {
  add: { label: 'Add', symbol: '+', ports: ['a', 'b'] },
  sub: { label: 'Subtract', symbol: '−', ports: ['a', 'b'] },
  mul: { label: 'Multiply', symbol: '×', ports: ['a', 'b'] },
  div: { label: 'Divide', symbol: '÷', ports: ['a', 'b'] },
  pow: { label: 'Power', symbol: '^', ports: ['a', 'b'] },
  min: { label: 'Minimum', symbol: 'min', ports: ['a', 'b'] },
  max: { label: 'Maximum', symbol: 'max', ports: ['a', 'b'] },
  round: { label: 'Round', symbol: 'rnd', ports: ['a', 'b'] },
  pct: { label: 'Percent of', symbol: '%', ports: ['a', 'b'] }
};

export const BLOCK_TYPES = ['input', 'op', 'formula', 'result'];

export function newId(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 9);
}

export function defaultModel(name) {
  return {
    version: 1,
    name: name || 'Untitled model',
    blocks: [],
    wires: []
  };
}

export function makeBlock(type, x, y) {
  const base = { id: newId('b'), type: type, x: Math.round(x), y: Math.round(y) };
  if (type === 'input') {
    base.name = 'Input';
    base.value = 100;
    base.unit = '';
    base.min = null;
    base.likely = null;
    base.max = null;
  } else if (type === 'op') {
    base.op = 'add';
    base.title = 'Add';
  } else if (type === 'formula') {
    base.title = 'Formula';
    base.expr = '';
    base.inputs = [{ id: newId('p'), name: 'x' }];
  } else if (type === 'result') {
    base.title = 'Result';
  }
  return base;
}

export function blockPorts(block) {
  if (block.type === 'input') return [];
  if (block.type === 'result') return [{ id: 'in', label: 'in' }];
  if (block.type === 'op') return [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }];
  return (block.inputs || []).map(function (p) { return { id: p.id, label: p.name }; });
}

export function blockHasOutput(block) {
  return block.type !== 'result';
}

function wireInto(model, blockId, portId) {
  for (const w of model.wires) {
    if (w.to === blockId && w.toPort === portId) return w;
  }
  return null;
}

function blockById(model, id) {
  for (const b of model.blocks) {
    if (b.id === id) return b;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Unit-aware expression evaluation (base values flowing through unit algebra)
// ---------------------------------------------------------------------------

function evalNode(ast, env) {
  if (ast.t === 'num') return { v: ast.v, u: dimensionless() };
  if (ast.t === 'name') {
    const entry = env[ast.n];
    if (!entry) throw new Error('Input "' + ast.n + '" is not connected');
    return { v: entry.v, u: entry.u };
  }
  if (ast.t === 'neg') {
    const a = evalNode(ast.a, env);
    return { v: -a.v, u: a.u };
  }
  if (ast.t === 'bin') {
    const a = evalNode(ast.a, env);
    const b = evalNode(ast.b, env);
    switch (ast.op) {
      case '+':
      case '-': {
        if (!sameDims(a.u, b.u)) {
          throw new Error('Cannot ' + (ast.op === '+' ? 'add' : 'subtract') + ' ' + describeUnit(a.u) + ' and ' + describeUnit(b.u) + ' — they are different kinds of quantity');
        }
        return { v: ast.op === '+' ? a.v + b.v : a.v - b.v, u: pickUnit(a.u, b.u) };
      }
      case '*': return { v: a.v * b.v, u: combineMul(a.u, b.u) };
      case '/': {
        if (b.v === 0) throw new Error('Division by zero');
        return { v: a.v / b.v, u: combineDiv(a.u, b.u) };
      }
      case '%': {
        if (b.v === 0) throw new Error('Division by zero');
        return { v: a.v / b.v * 100, u: combineDiv(a.u, b.u) };
      }
      case '^': {
        if (!isRatio(b.u)) throw new Error('An exponent must be a plain number, not ' + describeUnit(b.u));
        const n = b.v;
        if (!isRatio(a.u) && Math.abs(n - Math.round(n)) > 1e-9) {
          throw new Error('A fractional power needs a plain number base, not ' + describeUnit(a.u));
        }
        return { v: Math.pow(a.v, n), u: powUnit(a.u, n) };
      }
    }
    throw new Error('Unknown operator');
  }
  if (ast.t === 'call') {
    const args = ast.args.map(function (x) { return evalNode(x, env); });
    const nums = args.map(function (a) { return a.v; });
    switch (ast.fn) {
      case 'min':
      case 'max': {
        for (const a of args) {
          if (!sameDims(args[0].u, a.u)) throw new Error('min/max arguments must share a unit');
        }
        const v = ast.fn === 'min' ? Math.min.apply(null, nums) : Math.max.apply(null, nums);
        return { v: v, u: args[0].u };
      }
      case 'round': {
        const digits = args.length > 1 ? args[1].v : 0;
        const unit = args[0].u;
        const display = fromBase(args[0].v, unit);
        return { v: toBase(roundTo(display, digits), unit), u: unit };
      }
      case 'floor':
      case 'ceil': {
        const unit = args[0].u;
        const display = fromBase(args[0].v, unit);
        const rounded = ast.fn === 'floor' ? Math.floor(display) : Math.ceil(display);
        return { v: toBase(rounded, unit), u: unit };
      }
      case 'abs': return { v: Math.abs(args[0].v), u: args[0].u };
      case 'sign': return { v: Math.sign(args[0].v), u: dimensionless() };
      case 'sqrt':
      case 'exp':
      case 'ln':
      case 'log': {
        if (!isRatio(args[0].u)) throw new Error(ast.fn + '() needs a plain number, not ' + describeUnit(args[0].u));
        const v = ast.fn === 'sqrt' ? Math.sqrt(args[0].v) : ast.fn === 'exp' ? Math.exp(args[0].v) : ast.fn === 'ln' ? Math.log(args[0].v) : Math.log10(args[0].v);
        return { v: v, u: dimensionless() };
      }
      case 'pow': {
        if (!isRatio(args[1].u)) throw new Error('pow() exponent must be a plain number');
        return { v: Math.pow(args[0].v, args[1].v), u: powUnit(args[0].u, args[1].v) };
      }
    }
    throw new Error('Unknown function "' + ast.fn + '"');
  }
  throw new Error('Cannot evaluate expression node');
}

// ---------------------------------------------------------------------------
// Graph evaluation
// ---------------------------------------------------------------------------

export function evaluateModel(model, overrides) {
  const ov = overrides || {};
  const state = {};
  const order = [];
  const errors = [];
  const byId = {};
  for (const b of model.blocks) byId[b.id] = b;

  // children map for topological sort
  const indeg = {};
  const children = {};
  for (const b of model.blocks) {
    indeg[b.id] = 0;
    children[b.id] = [];
  }
  for (const w of model.wires) {
    if (!byId[w.from] || !byId[w.to]) continue;
    children[w.from].push(w.to);
    indeg[w.to] += 1;
  }
  const queue = model.blocks.filter(function (b) { return indeg[b.id] === 0; }).map(function (b) { return b.id; });
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const child of children[id]) {
      indeg[child] -= 1;
      if (indeg[child] === 0) queue.push(child);
    }
  }
  if (order.length !== model.blocks.length) {
    errors.push('The wiring forms a loop; a model must flow one way, from inputs to the result.');
  }

  const evalBlock = function (id) {
    if (state[id]) return state[id];
    const block = byId[id];
    if (!block) {
      const missing = { error: 'Block not found' };
      state[id] = missing;
      return missing;
    }
    let out;
    try {
      out = evalBlockInner(block);
    } catch (err) {
      out = { error: err.message || String(err) };
    }
    state[id] = out;
    return out;
  };

  const portValue = function (block, portId) {
    const wire = wireInto(model, block.id, portId);
    if (!wire) throw new Error('Port "' + portLabel(block, portId) + '" of "' + blockTitle(block) + '" is not connected');
    const up = evalBlock(wire.from);
    if (up.error) throw new Error(up.error);
    return up;
  };

  function evalBlockInner(block) {
    if (block.type === 'input') {
      const raw = Object.prototype.hasOwnProperty.call(ov, block.id) ? ov[block.id] : block.value;
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error('"' + blockTitle(block) + '" needs a number');
      const unit = parseUnitSafe(block.unit);
      return { v: value * unit.s, u: unit, source: block };
    }
    if (block.type === 'result') {
      const up = portValue(block, 'in');
      const override = (block.displayUnit || '').trim();
      if (override) {
        const target = parseUnitSafe(override);
        if (sameDims(up.u, target)) {
          return { v: up.v, u: target, source: block };
        }
      }
      return { v: up.v, u: up.u, source: block };
    }
    if (block.type === 'op') {
      const op = block.op || 'add';
      const a = portValue(block, 'a');
      const needsB = op !== 'pct' || true;
      const b = portValue(block, 'b');
      void needsB;
      switch (op) {
        case 'add': {
          requireSame(a, b, 'add');
          return { v: a.v + b.v, u: pickUnit(a.u, b.u) };
        }
        case 'sub': {
          requireSame(a, b, 'subtract');
          return { v: a.v - b.v, u: pickUnit(a.u, b.u) };
        }
        case 'mul': return { v: a.v * b.v, u: combineMul(a.u, b.u) };
        case 'div': {
          if (b.v === 0) throw new Error('Division by zero in "' + blockTitle(block) + '"');
          return { v: a.v / b.v, u: combineDiv(a.u, b.u) };
        }
        case 'pow': {
          if (!isRatio(b.u)) throw new Error('The exponent must be a plain number, not ' + describeUnit(b.u));
          const n = b.v;
          if (!isRatio(a.u) && Math.abs(n - Math.round(n)) > 1e-9) {
            throw new Error('A fractional power needs a plain-number base');
          }
          return { v: Math.pow(a.v, n), u: powUnit(a.u, n) };
        }
        case 'min': {
          requireSame(a, b, 'compare');
          return { v: Math.min(a.v, b.v), u: a.u };
        }
        case 'max': {
          requireSame(a, b, 'compare');
          return { v: Math.max(a.v, b.v), u: a.u };
        }
        case 'round': {
          const digits = isRatio(b.u) ? b.v : 0;
          const display = fromBase(a.v, a.u);
          return { v: toBase(roundTo(display, digits), a.u), u: a.u };
        }
        case 'pct': {
          if (!isRatio(b.u)) throw new Error('Percent-of needs a plain percentage on the b port, not ' + describeUnit(b.u));
          return { v: a.v * b.v, u: a.u };
        }
      }
      throw new Error('Unknown operation "' + op + '"');
    }
    if (block.type === 'formula') {
      if (!block.expr || !String(block.expr).trim()) {
        throw new Error('Formula "' + blockTitle(block) + '" needs an expression');
      }
      const env = {};
      for (const p of block.inputs || []) {
        const wire = wireInto(model, block.id, p.id);
        if (!wire) continue;
        const up = evalBlock(wire.from);
        if (up.error) throw new Error(up.error);
        env[p.name] = { v: up.v, u: up.u };
      }
      const ast = parseExprSafe(block.expr);
      const referenced = collectNames(ast);
      for (const n of referenced) {
        if (!env[n]) {
          const known = (block.inputs || []).map(function (p) { return p.name; }).join(', ');
          throw new Error('Formula "' + blockTitle(block) + '" uses "' + n + '" which is not an input of this block (inputs: ' + (known || 'none') + ')');
        }
      }
      return evalNode(ast, env);
    }
    throw new Error('Unknown block type "' + block.type + '"');
  }

  function requireSame(a, b, verb) {
    if (!sameDims(a.u, b.u)) {
      throw new Error('Cannot ' + verb + ' ' + describeUnit(a.u) + ' and ' + describeUnit(b.u) + ' — they are different kinds of quantity. Check the unit labels: is one a total and the other a per-unit rate?');
    }
  }

  for (const b of model.blocks) {
    const out = evalBlock(b.id);
    if (out.error) errors.push(out.error);
  }

  const resultBlock = model.blocks.filter(function (b) { return b.type === 'result'; })[0];
  let result = null;
  if (resultBlock) {
    const r = state[resultBlock.id];
    if (r && !r.error) {
      result = { value: r.v, unit: r.u, display: formatValue(r.v, r.u) };
    } else if (r) {
      result = { error: r.error };
    }
  }

  const values = {};
  for (const b of model.blocks) {
    const out = state[b.id] || {};
    values[b.id] = {
      error: out.error || null,
      value: out.v === undefined ? null : out.v,
      unit: out.u || null,
      display: out.error ? 'error' : (out.v === undefined ? '—' : formatValue(out.v, out.u))
    };
  }

  return {
    ok: errors.length === 0 && !!result && !result.error,
    values: values,
    result: result,
    errors: dedupe(errors)
  };
}

function dedupe(list) {
  const out = [];
  for (const item of list) {
    if (out.indexOf(item) < 0) out.push(item);
  }
  return out;
}

function parseUnitSafe(text) {
  try {
    return parseUnit(text);
  } catch (err) {
    const fallback = dimensionless();
    fallback.l = text || '';
    return fallback;
  }
}

function parseExprSafe(text) {
  return parseExpr(text || '');
}

export function blockTitle(block) {
  if (block.type === 'input') return block.name || 'Input';
  if (block.type === 'formula') return block.title || 'Formula';
  if (block.type === 'op') return block.title || (OPS[block.op] ? OPS[block.op].label : 'Operation');
  return block.title || 'Result';
}

export function portLabel(block, portId) {
  if (block.type === 'formula') {
    const p = (block.inputs || []).filter(function (x) { return x.id === portId; })[0];
    return p ? p.name : portId;
  }
  return portId;
}

// ---------------------------------------------------------------------------
// Sensitivity: which input moves the result most?
// ---------------------------------------------------------------------------

export function sensitivity(model, baseResult) {
  const inputs = model.blocks.filter(function (b) { return b.type === 'input'; });
  const base = baseResult && baseResult.value;
  const rows = [];
  for (const block of inputs) {
    const unit = parseUnitSafe(block.unit);
    const v = Number(block.value) * unit.s;
    let lo = null;
    let hi = null;
    let kind = 'range';
    const hasMin = block.min !== null && block.min !== undefined && block.min !== '';
    const hasMax = block.max !== null && block.max !== undefined && block.max !== '';
    const min = Number(block.min);
    const max = Number(block.max);
    if (hasMin && hasMax && Number.isFinite(min) && Number.isFinite(max) && max > min) {
      lo = min * unit.s;
      hi = max * unit.s;
    } else {
      kind = 'percent';
      const step = v === 0 ? 0.01 : Math.abs(v) * 0.01;
      lo = v;
      hi = v + step;
    }
    const rLo = evaluateModel(model, set({}, block.id, lo / unit.s)).result;
    const rHi = evaluateModel(model, set({}, block.id, hi / unit.s)).result;
    if (!rLo || rLo.error || !rHi || rHi.error) continue;
    const swing = rHi.value - rLo.value;
    rows.push({
      id: block.id,
      name: blockTitle(block),
      kind: kind,
      delta: swing,
      impact: Math.abs(swing),
      display: formatValue(Math.abs(swing), rHi.unit || dimensionless()),
      detail: kind === 'range'
        ? (formatValue(lo, unit) + ' to ' + formatValue(hi, unit))
        : ('+1% of ' + formatValue(v, unit))
    });
  }
  rows.sort(function (a, b) { return b.impact - a.impact; });
  const maxImpact = rows.length ? rows[0].impact : 0;
  for (const row of rows) {
    row.share = maxImpact > 0 ? row.impact / maxImpact : 0;
  }
  return { rows: rows, base: base, unit: baseResult && baseResult.unit ? baseResult.unit : dimensionless() };
}

function pickUnit(a, b) {
  return (a && a.l) ? a : ((b && b.l) ? b : (a || b));
}

function set(obj, key, value) {
  obj[key] = value;
  return obj;
}

// ---------------------------------------------------------------------------
// Model health checks used by the UI
// ---------------------------------------------------------------------------

export function validateModel(model) {
  const issues = [];
  const resultBlocks = model.blocks.filter(function (b) { return b.type === 'result'; });
  if (resultBlocks.length === 0) issues.push('Add a Result block to see the final outcome.');
  if (resultBlocks.length > 1) issues.push('Only one Result block is supported; keep the first.');
  const seenName = {};
  for (const b of model.blocks) {
    if (b.type !== 'input') continue;
    const key = (b.name || '').trim().toLowerCase();
    if (key && seenName[key]) issues.push('Two inputs share the name "' + b.name + '" — formulas resolve by name.');
    seenName[key] = true;
    const hasMin = b.min !== null && b.min !== undefined && b.min !== '';
    const hasMax = b.max !== null && b.max !== undefined && b.max !== '';
    if (hasMin && hasMax && Number(b.max) <= Number(b.min)) {
      issues.push('Input "' + blockTitle(b) + '" has a max that is not above its min.');
    }
  }
  for (const b of model.blocks) {
    if (b.type !== 'formula') continue;
    if (!b.expr || !String(b.expr).trim()) {
      issues.push('Formula "' + blockTitle(b) + '" needs an expression.');
      continue;
    }
    try {
      const ast = parseExpr(b.expr || '');
      const names = collectNames(ast);
      const defined = (b.inputs || []).map(function (p) { return p.name; });
      for (const n of names) {
        if (defined.indexOf(n) < 0) {
          issues.push('Formula "' + blockTitle(b) + '" refers to "' + n + '" which is not one of its inputs.');
        }
      }
    } catch (err) {
      issues.push('Formula "' + blockTitle(b) + '": ' + err.message);
    }
  }
  return issues;
}

export { formatValue, formatNumber, describeUnit, FUNCTIONS };
