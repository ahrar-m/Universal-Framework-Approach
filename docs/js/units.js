// units.js — dimensional unit algebra for the Universal Framework Approach engine.
// A unit is a spec: { d: { DIM: exponent }, s: scaleToBase, l: displayLabel, f: factors }.
// Values are carried internally in BASE units (display value x spec.s).
// The factors f are the label algebra: [{ l: '₹', e: 1 }, { l: 'tower', e: -1 }].
// Combining units cancels factors, so '₹/tower' x 'tower' resolves to '₹'
// instead of the meaningless '₹/tower·tower'.

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
  'units': { d: { N: 1 }, s: 1, l: 'units' },
  'count': { d: { N: 1 }, s: 1, l: 'count' },
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

export function normalizeDims(d) {
  const out = {};
  for (const k of Object.keys(d)) {
    if (d[k]) out[k] = d[k];
  }
  return out;
}

export function dimensionless() {
  return { d: {}, s: 1, l: '', f: [] };
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

// ---------------------------------------------------------------------------
// Factor algebra: the label side of a unit. Combining units merges factors and
// drops the ones whose exponents cancel, which is what makes '₹/tower' x 'tower'
// come out as '₹'.
// ---------------------------------------------------------------------------

function factorsOf(spec) {
  return Array.isArray(spec.f) ? spec.f : [];
}

function combineFactors(a, b, op) {
  const out = [];
  const at = {};
  const put = function (l, e) {
    if (at[l] === undefined) { at[l] = out.length; out.push({ l: l, e: e }); }
    else out[at[l]].e += e;
  };
  for (const x of factorsOf(a)) put(x.l, x.e);
  for (const x of factorsOf(b)) put(x.l, op === '/' ? -x.e : x.e);
  return out.filter(function (x) { return x.e !== 0; });
}

function scaleFactors(a, n) {
  return factorsOf(a).map(function (x) { return { l: x.l, e: x.e * n }; })
    .filter(function (x) { return x.e !== 0; });
}

function fmtFactor(x) {
  return x.e === 1 ? x.l : x.l + '^' + String(x.e);
}

// '₹·tower^2/month' style labels: positives on top, negatives underneath.
function labelFromFactors(f) {
  const pos = f.filter(function (x) { return x.e > 0 && x.l; });
  const neg = f.filter(function (x) { return x.e < 0 && x.l; });
  const num = pos.map(fmtFactor).join('·');
  const den = neg.map(function (x) { return fmtFactor({ l: x.l, e: -x.e }); }).join('·');
  if (!num && !den) return '';
  if (!den) return num;
  if (!num) return '1/' + (neg.length > 1 ? '(' + den + ')' : den);
  return num + '/' + (neg.length > 1 ? '(' + den + ')' : den);
}

// A combined unit gets the cleanest known label when it lands on one.
function canonicalLabel(d, s) {
  for (const key of Object.keys(REG)) {
    const e = REG[key];
    if (sameDims({ d: d }, { d: e.d }) && Math.abs(s - e.s) <= 1e-9 * Math.max(1, Math.abs(e.s))) {
      return e.l;
    }
  }
  return null;
}

// Finish a derived unit: snap to a known label when possible, otherwise render
// the cancelled factors.
function finished(d, s, f) {
  const dims = normalizeDims(d);
  const factors = f.filter(function (x) { return x.e !== 0; });
  const snapped = canonicalLabel(dims, s);
  if (snapped !== null) {
    // a snapped ratio (x, %, plain number) carries no factor of its own
    return { d: dims, s: s, l: snapped, f: Object.keys(dims).length ? [{ l: snapped, e: 1 }] : [] };
  }
  return { d: dims, s: s, l: labelFromFactors(factors), f: factors };
}

function copyOf(spec) {
  return { d: normalizeDims(spec.d), s: spec.s, l: spec.l, f: factorsOf(spec).slice() };
}

function lookup(token, original) {
  const key = token.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(REG, key)) {
    const e = REG[key];
    return { d: Object.assign({}, e.d), s: e.s, l: e.l, f: e.l ? [{ l: e.l, e: 1 }] : [] };
  }
  // Unknown tokens become custom dimensions so the tool stays domain-agnostic.
  const dim = {};
  dim[original] = 1;
  return { d: dim, s: 1, l: original, f: [{ l: original, e: 1 }] };
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

function rawCombine(a, b, op) {
  const d = Object.assign({}, a.d);
  for (const k of Object.keys(b.d)) {
    d[k] = (d[k] || 0) + (op === '/' ? -b.d[k] : b.d[k]);
  }
  return { d: normalizeDims(d), s: op === '/' ? a.s / b.s : a.s * b.s, l: '', f: combineFactors(a, b, op) };
}

// Parse a unit string such as "$", "units/hrs", "$/unit", "k$".
// The label stays exactly as typed; the factors carry the algebra.
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
  return { d: acc.d, s: acc.s, l: raw, f: acc.f };
}

export function mulUnit(a, b) {
  return combineMul(a, b);
}

export function divUnit(a, b) {
  return combineDiv(a, b);
}

// Multiplying by a pure ratio (%, x) simply scales the other operand.
export function combineMul(a, b) {
  if (isRatio(a) && isRatio(b)) return { d: {}, s: 1, l: 'x', f: [] };
  if (isRatio(a)) return copyOf(b);
  if (isRatio(b)) return copyOf(a);
  const d = Object.assign({}, a.d);
  for (const k of Object.keys(b.d)) {
    d[k] = (d[k] || 0) + b.d[k];
  }
  return finished(d, a.s * b.s, combineFactors(a, b, '*'));
}

export function combineDiv(a, b) {
  if (isRatio(a) && isRatio(b)) return { d: {}, s: 1, l: 'x', f: [] };
  if (isRatio(b)) return copyOf(a);
  const d = Object.assign({}, a.d);
  for (const k of Object.keys(b.d)) {
    d[k] = (d[k] || 0) - b.d[k];
  }
  return finished(d, a.s / b.s, combineFactors(a, b, '/'));
}

export function powUnit(a, n) {
  const d = {};
  for (const k of Object.keys(a.d)) {
    d[k] = a.d[k] * n;
  }
  return finished(d, Math.pow(a.s, n), scaleFactors(a, n));
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

// Currency-style labels (just a symbol, optionally k/M scaled) read as a prefix:
// '₹610,000', 'k$12'. Everything else stays a suffix: '90 min', '3,000 ₹/month'.
const CURRENCY_SYMBOLS = ['$', '₹', '€', '£', '¥'];

function isCurrencyLabel(label) {
  if (CURRENCY_SYMBOLS.indexOf(label) >= 0) return true;
  return label.length === 2 && (label[0] === 'k' || label[0] === 'M') && CURRENCY_SYMBOLS.indexOf(label[1]) >= 0;
}

export function formatValue(baseValue, unit) {
  if (baseValue === null || baseValue === undefined || Number.isNaN(baseValue)) return '—';
  const u = unit || dimensionless();
  const disp = fromBase(baseValue, u);
  const label = u.l || '';
  const num = formatNumber(disp);
  if (!label) return num;
  if (label === '%') return num + '%';
  if (isCurrencyLabel(label)) return label + num;
  return num + ' ' + label;
}

export function describeUnit(unit) {
  return (unit && unit.l) ? unit.l : 'number';
}
