// units.js — dimensional unit algebra for the Universal Framework Approach engine.
// A unit is a spec: { d: { DIM: exponent }, s: scaleToBase, l: displayLabel }.
// Values are carried internally in BASE units (display value x spec.s).

const REG = {
  '$': { d: { M: 1 }, s: 1, l: '$' },
  'usd': { d: { M: 1 }, s: 1, l: '$' },
  'dollar': { d: { M: 1 }, s: 1, l: '$' },
  'dollars': { d: { M: 1 }, s: 1, l: '$' },
  'k$': { d: { M: 1 }, s: 1000, l: 'k$' },
  '$k': { d: { M: 1 }, s: 1000, l: 'k$' },
  'm$': { d: { M: 1 }, s: 1000000, l: 'M$' },
  '$m': { d: { M: 1 }, s: 1000000, l: 'M$' },
  '%': { d: {}, s: 0.01, l: '%' },
  'percent': { d: {}, s: 0.01, l: '%' },
  'x': { d: {}, s: 1, l: 'x' },
  'ratio': { d: {}, s: 1, l: 'x' },
  'factor': { d: {}, s: 1, l: 'x' },
  'num': { d: {}, s: 1, l: '' },
  'number': { d: {}, s: 1, l: '' },
  'count': { d: { N: 1 }, s: 1, l: 'count' },
  'units': { d: { N: 1 }, s: 1, l: 'units' },
  'unit': { d: { N: 1 }, s: 1, l: 'units' },
  'items': { d: { N: 1 }, s: 1, l: 'items' },
  'item': { d: { N: 1 }, s: 1, l: 'items' },
  'ea': { d: { N: 1 }, s: 1, l: 'ea' },
  'each': { d: { N: 1 }, s: 1, l: 'ea' },
  'users': { d: { N: 1 }, s: 1, l: 'users' },
  'customers': { d: { N: 1 }, s: 1, l: 'customers' },
  'people': { d: { N: 1 }, s: 1, l: 'people' },
  'fte': { d: { N: 1 }, s: 1, l: 'FTE' },
  'hrs': { d: { T: 1 }, s: 3600, l: 'hrs' },
  'hours': { d: { T: 1 }, s: 3600, l: 'hrs' },
  'hour': { d: { T: 1 }, s: 3600, l: 'hrs' },
  'h': { d: { T: 1 }, s: 3600, l: 'hrs' },
  'min': { d: { T: 1 }, s: 60, l: 'min' },
  'mins': { d: { T: 1 }, s: 60, l: 'min' },
  'minute': { d: { T: 1 }, s: 60, l: 'min' },
  'minutes': { d: { T: 1 }, s: 60, l: 'min' },
  's': { d: { T: 1 }, s: 1, l: 's' },
  'sec': { d: { T: 1 }, s: 1, l: 's' },
  'secs': { d: { T: 1 }, s: 1, l: 's' },
  'second': { d: { T: 1 }, s: 1, l: 's' },
  'seconds': { d: { T: 1 }, s: 1, l: 's' },
  'days': { d: { T: 1 }, s: 86400, l: 'days' },
  'day': { d: { T: 1 }, s: 86400, l: 'days' },
  'd': { d: { T: 1 }, s: 86400, l: 'days' },
  'weeks': { d: { T: 1 }, s: 604800, l: 'weeks' },
  'week': { d: { T: 1 }, s: 604800, l: 'weeks' },
  'wk': { d: { T: 1 }, s: 604800, l: 'weeks' }
};

// Units shown in the unit picker (the rest still parse).
export const COMMON_UNITS = ['$', 'k$', 'M$', '%', 'x', 'num', 'units', 'users', 'customers', 'hrs', 'min', 'days', '$/unit', 'units/hrs', '$/hrs'];

export function normalizeDims(d) {
  const out = {};
  for (const k of Object.keys(d)) {
    if (d[k]) out[k] = d[k];
  }
  return out;
}

export function dimensionless() {
  return { d: {}, s: 1, l: '' };
}

export function isRatio(u) {
  return Object.keys(u.d).length === 0;
}

export function sameDims(a, b) {
  const ka = Object.keys(normalizeDims(a.d));
  const kb = Object.keys(normalizeDims(b.d));
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if ((a.d[k] || 0) !== (b.d[k] || 0)) return false;
  }
  return true;
}

export function dimsKey(u) {
  const d = normalizeDims(u.d);
  return Object.keys(d).sort().map(function (k) { return k + ':' + d[k]; }).join(' ');
}

function lookup(token, original) {
  const key = token.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(REG, key)) {
    const e = REG[key];
    return { d: Object.assign({}, e.d), s: e.s, l: e.l };
  }
  // Unknown tokens become custom dimensions so the tool stays domain-agnostic.
  const dim = {};
  dim[original] = 1;
  return { d: dim, s: 1, l: original };
}

function tokenSpec(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Empty unit token');
  let power = 1;
  let base = trimmed;
  const caret = trimmed.indexOf('^');
  if (caret >= 0) {
    base = trimmed.slice(0, caret);
    const p = trimmed.slice(caret + 1).trim();
    power = Number(p);
    if (!Number.isFinite(power)) throw new Error('Bad unit power in "' + trimmed + '"');
  }
  const spec = lookup(base.trim(), base.trim());
  return powUnit(spec, power);
}

// Parse a unit string such as "$", "units/hrs", "$/unit", "k$".
export function parseUnit(text) {
  const raw = (text === undefined || text === null) ? '' : String(text).trim();
  if (raw === '' || raw === '1' || raw === 'num') return dimensionless();
  const parts = [];
  let current = '';
  let op = '*';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '*' || ch === '/' || ch === '·' || ch === ':') {
      if (!current.trim()) throw new Error('Unit "' + raw + '" has an empty part');
      parts.push({ op: op, tok: current });
      current = '';
      op = (ch === '/') ? '/' : '*';
    } else {
      current = current + ch;
    }
  }
  if (!current.trim()) throw new Error('Unit "' + raw + '" has an empty part');
  parts.push({ op: op, tok: current });
  let acc = dimensionless();
  for (const p of parts) {
    const spec = tokenSpec(p.tok);
    acc = rawCombine(acc, spec, p.op);
  }
  acc.l = raw;
  return acc;

function rawCombine(a, b, op) {
  const d = Object.assign({}, a.d);
  for (const k of Object.keys(b.d)) {
    d[k] = (d[k] || 0) + (op === '/' ? -b.d[k] : b.d[k]);
  }
  return { d: normalizeDims(d), s: op === '/' ? a.s / b.s : a.s * b.s, l: '' };
}
}

// A combined unit gets the cleanest known label when it lands on one.
function canonicalize(u) {
  for (const key of Object.keys(REG)) {
    const e = REG[key];
    const spec = { d: e.d, s: e.s, l: e.l };
    if (sameDims(u, spec) && Math.abs(u.s - spec.s) <= 1e-9 * Math.max(1, Math.abs(spec.s))) {
      return { d: normalizeDims(u.d), s: u.s, l: spec.l };
    }
  }
  return u;
}

export function mulUnit(a, b) {
  return combineMul(a, b);
}

export function divUnit(a, b) {
  return combineDiv(a, b);
}

// Multiplying by a pure ratio (%, x) simply scales the other operand.
export function combineMul(a, b) {
  if (isRatio(a) && isRatio(b)) return { d: {}, s: 1, l: 'x' };
  if (isRatio(a)) return { d: Object.assign({}, b.d), s: b.s, l: b.l };
  if (isRatio(b)) return { d: Object.assign({}, a.d), s: a.s, l: a.l };
  const d = Object.assign({}, a.d);
  for (const k of Object.keys(b.d)) {
    d[k] = (d[k] || 0) + b.d[k];
  }
  return canonicalize({ d: normalizeDims(d), s: a.s * b.s, l: joinLabel(a.l, b.l, '·') });
}

export function combineDiv(a, b) {
  if (isRatio(a) && isRatio(b)) return { d: {}, s: 1, l: 'x' };
  if (isRatio(b)) return { d: Object.assign({}, a.d), s: a.s, l: a.l };
  const d = Object.assign({}, a.d);
  for (const k of Object.keys(b.d)) {
    d[k] = (d[k] || 0) - b.d[k];
  }
  const label = isRatio(a) ? ('1/' + b.l) : joinLabel(a.l, b.l, '/');
  return canonicalize({ d: normalizeDims(d), s: a.s / b.s, l: label });
}

export function powUnit(a, n) {
  const d = {};
  for (const k of Object.keys(a.d)) {
    d[k] = a.d[k] * n;
  }
  const l = (n === 1) ? a.l : (a.l ? a.l + '^' + n : '');
  return canonicalize({ d: normalizeDims(d), s: Math.pow(a.s, n), l: l });
}

function joinLabel(a, b, op) {
  const left = a || '';
  const right = b || '';
  if (!left && !right) return '';
  if (!left) return (op === '/') ? ('1/' + right) : right;
  if (!right) return left;
  return left + op + right;
}

export function toBase(displayValue, unit) {
  return displayValue * unit.s;
}

export function fromBase(baseValue, unit) {
  return baseValue / unit.s;
}

export function convert(baseValue, fromUnit, toUnit) {
  if (!sameDims(fromUnit, toUnit)) {
    throw new Error('Cannot convert ' + (fromUnit.l || 'number') + ' to ' + (toUnit.l || 'number'));
  }
  return baseValue / toUnit.s;
}

export function formatNumber(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞';
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1e12 || abs < 1e-6)) {
    return v.toExponential(3).replace('e+', 'e');
  }
  let digits = 4;
  if (abs >= 1000) digits = 2;
  else if (abs >= 100) digits = 2;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v);
}

export function formatValue(baseValue, unit) {
  if (baseValue === null || baseValue === undefined || Number.isNaN(baseValue)) return '—';
  const u = unit || dimensionless();
  const disp = fromBase(baseValue, u);
  const label = u.l || '';
  const num = formatNumber(disp);
  if (!label) return num;
  if (label === '%') return num + '%';
  if (label === '$' || label === 'k$' || label === 'M$') return label + num;
  return num + ' ' + label;
}

export function describeUnit(unit) {
  return (unit && unit.l) ? unit.l : 'number';
}
