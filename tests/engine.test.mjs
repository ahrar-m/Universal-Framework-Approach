// Engine tests — run with: node tests/engine.test.mjs
import { parseUnit, formatValue, sameDims, combineMul, combineDiv, isRatio } from '../docs/js/units.js';
import { parseExpr, evalNumber, collectNames } from '../docs/js/expr.js';
import { evaluateModel, sensitivity, validateModel, makeBlock, defaultModel } from '../docs/js/engine.js';
import { computeLayout, blockGeometry, portPoint, outPoint } from '../docs/js/canvas.js';
import { EXAMPLES } from '../docs/js/examples.js';

let passed = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { passed++; return; }
  failures.push(name + (extra ? ' -> ' + extra : ''));
}

function near(a, b) { return Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)); }

// ---- units ----
const dollars = parseUnit('$');
ok('parse $', dollars.l === '$' && dollars.s === 1 && !isRatio(dollars));
const pct = parseUnit('%');
ok('parse %', near(pct.s, 0.01) && isRatio(pct));
const hrs = parseUnit('hrs');
ok('parse hrs', near(hrs.s, 3600));
const perUnit = parseUnit('$/unit');
ok('parse $/unit', sameDims(perUnit, combineDiv(dollars, parseUnit('unit'))));
const custom = parseUnit('widgets');
ok('custom unit becomes own dimension', custom.l === 'widgets' && !isRatio(custom));
const customRate = parseUnit('widgets/hrs');
ok('custom compound', customRate.l === 'widgets/hrs');

ok('format $', formatValue(1250, dollars) === '$1,250', formatValue(1250, dollars));
ok('format %', formatValue(0.2, pct) === '20%', formatValue(0.2, pct));
ok('format hrs', formatValue(5400, hrs) === '1.5 hrs', formatValue(5400, hrs));

// ---- expressions ----
const ast = parseExpr('price * volume * (1 - churn)');
ok('parse expr', collectNames(ast).sort().join(',') === 'churn,price,volume');
ok('eval expr', near(evalNumber(ast, { price: 50, volume: 100, churn: 0.2 }), 4000));
ok('power expr', near(evalNumber(parseExpr('2^10'), {}), 1024));
ok('function expr', near(evalNumber(parseExpr('max(3, 7) + round(2.567, 2)'), {}), 9.57));
let threw = false;
try { parseExpr('2 +* 3'); } catch (e) { threw = true; }
ok('bad expr rejected', threw);

// ---- model helpers ----
function model(build) {
  const m = defaultModel('test');
  build(m);
  return m;
}

// profit: price x volume - fixed cost
{
  const m = model((m) => {
    const price = makeBlock('input', 0, 0); price.name = 'price'; price.value = 50; price.unit = '$/unit';
    const vol = makeBlock('input', 0, 100); vol.name = 'volume'; vol.value = 1000; vol.unit = 'units';
    const fixed = makeBlock('input', 0, 200); fixed.name = 'fixed'; fixed.value = 12000; fixed.unit = '$';
    const mul = makeBlock('op', 200, 50); mul.op = 'mul';
    const sub = makeBlock('op', 400, 50); sub.op = 'sub';
    const res = makeBlock('result', 600, 50);
    m.blocks.push(price, vol, fixed, mul, sub, res);
    m.wires.push({ id: 'w1', from: price.id, to: mul.id, toPort: 'a' });
    m.wires.push({ id: 'w2', from: vol.id, to: mul.id, toPort: 'b' });
    m.wires.push({ id: 'w3', from: mul.id, to: sub.id, toPort: 'a' });
    m.wires.push({ id: 'w4', from: fixed.id, to: sub.id, toPort: 'b' });
    m.wires.push({ id: 'w5', from: sub.id, to: res.id, toPort: 'in' });
  });
  const r = evaluateModel(m);
  ok('profit evaluates', r.ok && near(r.result.value, 38000), JSON.stringify(r.errors));
  ok('profit display', r.result.display === '$38,000', r.result.display);
  const sens = sensitivity(m, r.result);
  ok('sensitivity has one row per input', sens.rows.length === 3, JSON.stringify(sens.rows.map(x => x.name)));
  ok('sensitivity sorted and fixed last', sens.rows[2].name === 'fixed' && sens.rows[0].impact >= sens.rows[1].impact, JSON.stringify(sens.rows.map(x => x.name + ':' + x.impact)));
  ok('sensitivity shares normalised', near(sens.rows[0].share, 1) && sens.rows[2].share < 1);
}

// unit conversion: 30 min + 1 hr = 1.5 hrs
{
  const m = model((m) => {
    const a = makeBlock('input', 0, 0); a.name = 'a'; a.value = 30; a.unit = 'min';
    const b = makeBlock('input', 0, 100); b.name = 'b'; b.value = 1; b.unit = 'hrs';
    const add = makeBlock('op', 200, 50); add.op = 'add';
    const res = makeBlock('result', 400, 50);
    m.blocks.push(a, b, add, res);
    m.wires.push({ id: 'w1', from: a.id, to: add.id, toPort: 'a' });
    m.wires.push({ id: 'w2', from: b.id, to: add.id, toPort: 'b' });
    m.wires.push({ id: 'w3', from: add.id, to: res.id, toPort: 'in' });
  });
  const r = evaluateModel(m);
  ok('time conversion adds', r.ok && r.result.display === '90 min', r.result && r.result.display);
  const resBlock = m.blocks.filter((b) => b.type === 'result')[0];
  resBlock.displayUnit = 'hrs';
  const r2 = evaluateModel(m);
  ok('result display unit override', r2.ok && r2.result.display === '1.5 hrs', r2.result && r2.result.display);
}

// percent-of: $5 x 20% = $1
{
  const m = model((m) => {
    const a = makeBlock('input', 0, 0); a.name = 'amount'; a.value = 5; a.unit = '$';
    const b = makeBlock('input', 0, 100); b.name = 'rate'; b.value = 20; b.unit = '%';
    const op = makeBlock('op', 200, 50); op.op = 'pct';
    const res = makeBlock('result', 400, 50);
    m.blocks.push(a, b, op, res);
    m.wires.push({ id: 'w1', from: a.id, to: op.id, toPort: 'a' });
    m.wires.push({ id: 'w2', from: b.id, to: op.id, toPort: 'b' });
    m.wires.push({ id: 'w3', from: op.id, to: res.id, toPort: 'in' });
  });
  const r = evaluateModel(m);
  ok('percent-of works', r.ok && r.result.display === '$1', r.result && r.result.display + ' ' + JSON.stringify(r.errors));
}

// dimensional mismatch: $ + hrs must fail
{
  const m = model((m) => {
    const a = makeBlock('input', 0, 0); a.name = 'money'; a.value = 5; a.unit = '$';
    const b = makeBlock('input', 0, 100); b.name = 'time'; b.value = 2; b.unit = 'hrs';
    const add = makeBlock('op', 200, 50); add.op = 'add';
    const res = makeBlock('result', 400, 50);
    m.blocks.push(a, b, add, res);
    m.wires.push({ id: 'w1', from: a.id, to: add.id, toPort: 'a' });
    m.wires.push({ id: 'w2', from: b.id, to: add.id, toPort: 'b' });
    m.wires.push({ id: 'w3', from: add.id, to: res.id, toPort: 'in' });
  });
  const r = evaluateModel(m);
  ok('dimensional mismatch rejected', !r.ok && r.errors.some((e) => e.indexOf('different kinds') >= 0), JSON.stringify(r.errors));
}

// formula block with named inputs
{
  const m = model((m) => {
    const price = makeBlock('input', 0, 0); price.name = 'price'; price.value = 50; price.unit = '$/unit';
    const vol = makeBlock('input', 0, 100); vol.name = 'volume'; vol.value = 200; vol.unit = 'units';
    const churn = makeBlock('input', 0, 200); churn.name = 'churn'; churn.value = 10; churn.unit = '%';
    const f = makeBlock('formula', 250, 50); f.expr = 'price * volume * (1 - churn)';
    f.inputs = [{ id: 'p1', name: 'price' }, { id: 'p2', name: 'volume' }, { id: 'p3', name: 'churn' }];
    const res = makeBlock('result', 500, 50);
    m.blocks.push(price, vol, churn, f, res);
    m.wires.push({ id: 'w1', from: price.id, to: f.id, toPort: 'p1' });
    m.wires.push({ id: 'w2', from: vol.id, to: f.id, toPort: 'p2' });
    m.wires.push({ id: 'w3', from: churn.id, to: f.id, toPort: 'p3' });
    m.wires.push({ id: 'w4', from: f.id, to: res.id, toPort: 'in' });
  });
  const r = evaluateModel(m);
  ok('formula evaluates with units', r.ok && r.result.display === '$9,000', (r.result && r.result.display) + ' ' + JSON.stringify(r.errors));
}

// formula referencing a name that is not an input
{
  const m = model((m) => {
    const f = makeBlock('formula', 250, 50); f.expr = 'price * 2';
    f.inputs = [{ id: 'p1', name: 'other' }];
    const src = makeBlock('input', 0, 0); src.name = 'src'; src.value = 3;
    const res = makeBlock('result', 500, 50);
    m.blocks.push(src, f, res);
    m.wires.push({ id: 'w1', from: src.id, to: f.id, toPort: 'p1' });
    m.wires.push({ id: 'w2', from: f.id, to: res.id, toPort: 'in' });
  });
  const r = evaluateModel(m);
  ok('unknown formula name rejected', !r.ok && r.errors.some((e) => e.indexOf('not an input') >= 0), JSON.stringify(r.errors));
}

// cycle detection
{
  const m = model((m) => {
    const f1 = makeBlock('formula', 0, 0); f1.expr = 'x + 1'; f1.inputs = [{ id: 'p1', name: 'x' }];
    const f2 = makeBlock('formula', 200, 0); f2.expr = 'x + 2'; f2.inputs = [{ id: 'p1', name: 'x' }];
    m.blocks.push(f1, f2);
    m.wires.push({ id: 'w1', from: f1.id, to: f2.id, toPort: 'p1' });
    m.wires.push({ id: 'w2', from: f2.id, to: f1.id, toPort: 'p1' });
  });
  const r = evaluateModel(m);
  ok('cycle rejected', r.errors.some((e) => e.indexOf('loop') >= 0), JSON.stringify(r.errors));
}

// unconnected port on a two-input operation
{
  const m = model((m) => {
    const a = makeBlock('input', 0, 0); a.name = 'a'; a.value = 5;
    const sub = makeBlock('op', 200, 0); sub.op = 'sub';
    const res = makeBlock('result', 400, 0);
    m.blocks.push(a, sub, res);
    m.wires.push({ id: 'w1', from: a.id, to: sub.id, toPort: 'a' });
    m.wires.push({ id: 'w2', from: sub.id, to: res.id, toPort: 'in' });
  });
  const r = evaluateModel(m);
  ok('unconnected port reported', !r.ok && r.errors.some((e) => e.indexOf('not connected') >= 0), JSON.stringify(r.errors));
}

// ---- variadic operations: add, mul, min, max fold over any number of inputs ----
function variadicModel(op, terms, inputs) {
  const m = model((m) => {
    const opBlock = makeBlock('op', 200, 50); opBlock.op = op; opBlock.terms = terms.slice();
    const res = makeBlock('result', 400, 50);
    const srcs = inputs.map(function (spec, i) {
      const b = makeBlock('input', 0, i * 100); b.name = spec.name; b.value = spec.value; b.unit = spec.unit || '';
      m.wires.push({ id: 'w' + i, from: b.id, to: opBlock.id, toPort: terms[i] });
      return b;
    });
    m.blocks.push.apply(m.blocks, srcs.concat([opBlock, res]));
    m.wires.push({ id: 'wout', from: opBlock.id, to: res.id, toPort: 'in' });
  });
  return m;
}

{
  const m = variadicModel('add', ['a', 'b', 'c'], [
    { name: 'a', value: 30, unit: 'min' },
    { name: 'b', value: 1, unit: 'hrs' },
    { name: 'c', value: 30, unit: 'min' }
  ]);
  const r = evaluateModel(m);
  ok('three-term add folds', r.ok && r.result.display === '120 min', (r.result && r.result.display) + ' ' + JSON.stringify(r.errors));
}

{
  const m = variadicModel('add', ['a', 'b', 'c'], [{ name: 'only', value: 5, unit: '$' }]);
  m.wires[0].toPort = 'c'; // wired into the last port: empty ports before it are ignored
  const r = evaluateModel(m);
  ok('single input passes through', r.ok && r.result.display === '$5', (r.result && r.result.display) + ' ' + JSON.stringify(r.errors));
}

{
  const m = variadicModel('mul', ['a', 'b', 'c'], [
    { name: 'a', value: 2 }, { name: 'b', value: 3 }, { name: 'c', value: 4 }
  ]);
  const r = evaluateModel(m);
  ok('three-term multiply folds', r.ok && near(r.result.value, 24), (r.result && r.result.display) + ' ' + JSON.stringify(r.errors));
}

{
  const m = variadicModel('min', ['a', 'b', 'c'], [
    { name: 'a', value: 5 }, { name: 'b', value: 2 }, { name: 'c', value: 9 }
  ]);
  const r = evaluateModel(m);
  ok('three-term minimum folds', r.ok && near(r.result.value, 2), (r.result && r.result.display) + ' ' + JSON.stringify(r.errors));
}

{
  const m = variadicModel('max', ['a', 'b', 'c'], [
    { name: 'a', value: 5 }, { name: 'b', value: 2 }, { name: 'c', value: 9 }
  ]);
  const r = evaluateModel(m);
  ok('three-term maximum folds', r.ok && near(r.result.value, 9), (r.result && r.result.display) + ' ' + JSON.stringify(r.errors));
}

{
  const m = variadicModel('add', ['a', 'b', 'c'], [
    { name: 'money1', value: 5, unit: '$' },
    { name: 'money2', value: 7, unit: '$' },
    { name: 'time', value: 2, unit: 'hrs' }
  ]);
  const r = evaluateModel(m);
  ok('variadic mismatch names the input', !r.ok && r.errors.some((e) => e.indexOf('different kinds') >= 0 && e.indexOf('input "c"') >= 0), JSON.stringify(r.errors));
}

{
  const m = variadicModel('add', ['a', 'b'], []);
  const r = evaluateModel(m);
  ok('variadic op with nothing connected reports it', !r.ok && r.errors.some((e) => e.indexOf('not connected') >= 0), JSON.stringify(r.errors));
}

{
  // models saved before variadic operations have no terms array
  const m = model((m) => {
    const a = makeBlock('input', 0, 0); a.name = 'a'; a.value = 3;
    const b = makeBlock('input', 0, 100); b.name = 'b'; b.value = 4;
    const add = makeBlock('op', 200, 50); add.op = 'add'; delete add.terms;
    const res = makeBlock('result', 400, 50);
    m.blocks.push(a, b, add, res);
    m.wires.push({ id: 'w1', from: a.id, to: add.id, toPort: 'a' });
    m.wires.push({ id: 'w2', from: b.id, to: add.id, toPort: 'b' });
    m.wires.push({ id: 'w3', from: add.id, to: res.id, toPort: 'in' });
  });
  const r = evaluateModel(m);
  ok('legacy model without terms works', r.ok && near(r.result.value, 7), (r.result && r.result.display) + ' ' + JSON.stringify(r.errors));
}

// validation
{
  const m = model((m) => {
    const a = makeBlock('input', 0, 0); a.name = 'dup'; a.value = 5; a.min = 10; a.max = 2;
    const b = makeBlock('input', 0, 100); b.name = 'dup'; b.value = 5;
    m.blocks.push(a, b);
  });
  const issues = validateModel(m);
  ok('validate catches duplicate names', issues.some((e) => e.indexOf('share the name') >= 0), JSON.stringify(issues));
  ok('validate catches bad range', issues.some((e) => e.indexOf('not above its min') >= 0), JSON.stringify(issues));
}


// ---- unit labels cancel through multiplication and division ----
{
  const m = model((m) => {
    const per = makeBlock('input', 0, 0); per.name = 'tower cost'; per.value = 6100; per.unit = '₹/tower';
    const qty = makeBlock('input', 0, 100); qty.name = 'quantity'; qty.value = 100; qty.unit = 'tower';
    const mul = makeBlock('op', 200, 50); mul.op = 'mul';
    const res = makeBlock('result', 400, 50);
    m.blocks.push(per, qty, mul, res);
    m.wires.push({ id: 'w1', from: per.id, to: mul.id, toPort: 'a' });
    m.wires.push({ id: 'w2', from: qty.id, to: mul.id, toPort: 'b' });
    m.wires.push({ id: 'w3', from: mul.id, to: res.id, toPort: 'in' });
  });
  const r = evaluateModel(m);
  ok('multiplication cancels the units', r.ok && r.result.unit.l === '₹', (r.result && r.result.unit.l) + ' ' + JSON.stringify(r.errors));
  ok('cancelled unit displays as rupees', r.result && r.result.display === '₹610,000', r.result && r.result.display);
}
{
  const got = combineMul(parseUnit('₹/tower'), parseUnit('tower')).l;
  ok('label cancel: rate x count', got === '₹', got);
  const g2 = combineMul(parseUnit('$/unit'), parseUnit('units/hrs')).l;
  ok('label cancel: compound rate', g2 === '$/hrs', g2);
  const g3 = combineDiv(parseUnit('₹/tower'), parseUnit('₹')).l;
  ok('label cancel: divide out the currency', g3 === '1/tower', g3);
  const g4 = combineMul(parseUnit('₹/tower'), parseUnit('tower^2')).l;
  ok('label cancel: powers', g4 === '₹·tower', g4);
  const g5 = combineDiv(parseUnit('units'), parseUnit('units')).l;
  ok('full cancellation is a plain ratio', g5 === 'x', g5);
  ok('typed labels stay as typed', parseUnit('widgets/hrs').l === 'widgets/hrs', parseUnit('widgets/hrs').l);
}

// ---- several Result blocks: each is its own outcome ----
{
  const m = model((m) => {
    const per = makeBlock('input', 0, 0); per.name = 'per'; per.value = 6100; per.unit = '₹/tower';
    const qty = makeBlock('input', 0, 100); qty.name = 'qty'; qty.value = 100; qty.unit = 'tower';
    const mul = makeBlock('op', 200, 50); mul.op = 'mul'; mul.title = 'initial investment';
    const res1 = makeBlock('result', 400, 0); res1.title = 'Initial Investment';
    const res2 = makeBlock('result', 400, 150); res2.title = 'Towers';
    m.blocks.push(per, qty, mul, res1, res2);
    m.wires.push({ id: 'w1', from: per.id, to: mul.id, toPort: 'a' });
    m.wires.push({ id: 'w2', from: qty.id, to: mul.id, toPort: 'b' });
    m.wires.push({ id: 'w3', from: mul.id, to: res1.id, toPort: 'in' });
    m.wires.push({ id: 'w4', from: qty.id, to: res2.id, toPort: 'in' });
  });
  const r = evaluateModel(m);
  ok('two results both evaluate', r.ok && r.results.length === 2 && r.results[0].display === '₹610,000' && r.results[1].display === '100 tower', JSON.stringify(r.results));
  ok('result stays the first outcome', !!r.result && r.result.id === r.results[0].id && r.result.display === '₹610,000', r.result && r.result.display);
  ok('validate accepts several results', validateModel(m).length === 0, JSON.stringify(validateModel(m)));
  const s1 = sensitivity(m, r.results[0].id);
  const s2 = sensitivity(m, r.results[1].id);
  ok('sensitivity is measured per result', s1.rows.length === 2 && s2.rows.length === 2, JSON.stringify([s1.rows.length, s2.rows.length]));
  ok('per-result ranking differs', s2.rows[0].name === 'qty', JSON.stringify(s2.rows.map((x) => x.name + ':' + x.impact)));
  ok('sensitivity accepts an entry too', sensitivity(m, r.result).rows.length === s1.rows.length);
  const res2 = m.blocks.filter((b) => b.type === 'result')[1];
  res2.displayUnit = '₹';
  const r3 = evaluateModel(m);
  const issues3 = validateModel(m, r3.values);
  ok('mismatched display unit is flagged', issues3.some((e) => e.indexOf('display unit') >= 0), JSON.stringify(issues3));
  ok('mismatched display unit falls back', r3.results[1].display === '100 tower', r3.results[1].display);
}

// ---- layout: unrelated branches get their own bands ----
{
  const m = model((m) => {
    const a1 = makeBlock('input', 0, 0); a1.name = 'a1'; a1.value = 6100; a1.unit = '₹/tower';
    const a2 = makeBlock('input', 0, 200); a2.name = 'a2'; a2.value = 100; a2.unit = 'tower';
    const am = makeBlock('op', 300, 100); am.op = 'mul';
    const ar = makeBlock('result', 600, 100);
    const b1 = makeBlock('input', 0, 500); b1.name = 'b1'; b1.value = 3000; b1.unit = '₹/month';
    const b2 = makeBlock('input', 0, 700); b2.name = 'b2'; b2.value = 1500; b2.unit = '₹/month';
    const ba = makeBlock('op', 300, 600); ba.op = 'add';
    const br = makeBlock('result', 600, 600);
    m.blocks.push(a1, a2, am, ar, b1, b2, ba, br);
    m.wires.push({ id: 'w1', from: a1.id, to: am.id, toPort: 'a' });
    m.wires.push({ id: 'w2', from: a2.id, to: am.id, toPort: 'b' });
    m.wires.push({ id: 'w3', from: am.id, to: ar.id, toPort: 'in' });
    m.wires.push({ id: 'w4', from: b1.id, to: ba.id, toPort: 'a' });
    m.wires.push({ id: 'w5', from: b2.id, to: ba.id, toPort: 'b' });
    m.wires.push({ id: 'w6', from: ba.id, to: br.id, toPort: 'in' });
    m._top = [a1.id, a2.id, am.id, ar.id];
    m._bottom = [b1.id, b2.id, ba.id, br.id];
  });
  const t = computeLayout(m).targets;
  const maxTop = Math.max.apply(null, m._top.map((i) => t[i].y));
  const minBottom = Math.min.apply(null, m._bottom.map((i) => t[i].y));
  ok('unrelated branches get their own bands', maxTop < minBottom, 'top max ' + maxTop + ' vs bottom min ' + minBottom);
  let leftToRight = true;
  for (const w of m.wires) if (!(t[w.from].x < t[w.to].x)) leftToRight = false;
  ok('layout flows left to right', leftToRight, JSON.stringify(t));
}
{
  const one = computeLayout({ blocks: [makeBlock('input', 5, 5)], wires: [] });
  ok('layout handles a single block', Object.keys(one.targets).length === 1);
  const none = computeLayout({ blocks: [], wires: [] });
  ok('layout handles an empty model', Object.keys(none.targets).length === 0);
}

{
  // an input appears exactly where it is linked: beside the block it feeds,
  // whatever depth that block sits at - not parked in a far-left column
  const m = model((m) => {
    const deep = makeBlock('input', 0, 0); deep.name = 'deep'; deep.value = 3;
    const mid = makeBlock('op', 220, 0); mid.op = 'add';
    const top = makeBlock('op', 440, 0); top.op = 'sub';
    const loose = makeBlock('input', 0, 300); loose.name = 'loose'; loose.value = 7;
    const idle = makeBlock('input', 0, 600); idle.name = 'idle'; idle.value = 1;
    m.blocks.push(deep, mid, top, loose, idle);
    m.wires.push({ id: 'w1', from: deep.id, to: mid.id, toPort: 'a' });
    m.wires.push({ id: 'w2', from: mid.id, to: top.id, toPort: 'a' });
    m.wires.push({ id: 'w3', from: loose.id, to: top.id, toPort: 'b' });
    m._ids = { deep: deep.id, mid: mid.id, top: top.id, loose: loose.id, idle: idle.id };
  });
  const t = computeLayout(m).targets;
  const step = 212 + 96;
  const id = m._ids;
  ok('an input sits one slot left of the block it feeds', t[id.deep].x === t[id.mid].x - step, t[id.deep].x + ' vs ' + t[id.mid].x);
  ok('an input follows its block deeper into the flow', t[id.loose].x === t[id.top].x - step && t[id.loose].x > 0, t[id.loose].x + ' vs ' + t[id.top].x);
  ok('an input with nothing to feed stays in the left column', t[id.idle].x === 0, String(t[id.idle].x));
  const at = (b) => Object.assign({}, b, t[b.id]);
  const feed = m.blocks.find((b) => b.id === id.deep);
  const eats = m.blocks.find((b) => b.id === id.mid);
  ok('an input lines up with the port it plugs into', outPoint(at(feed)).y === portPoint(at(eats), 'a').y, outPoint(at(feed)).y + ' vs ' + portPoint(at(eats), 'a').y);
  const overlaps = [];
  for (let i = 0; i < m.blocks.length; i++) {
    for (let j = i + 1; j < m.blocks.length; j++) {
      const p = t[m.blocks[i].id];
      const q = t[m.blocks[j].id];
      const h1 = blockGeometry(m.blocks[i]).h;
      const h2 = blockGeometry(m.blocks[j]).h;
      if (p.x < q.x + 212 && q.x < p.x + 212 && p.y < q.y + h2 && q.y < p.y + h1) overlaps.push(m.blocks[i].id + '/' + m.blocks[j].id);
    }
  }
  ok('hugging inputs never overlap a card', overlaps.length === 0, overlaps.join(','));
}

// ---- ready-made examples ----
for (const ex of EXAMPLES) {
  const r = evaluateModel(ex.model);
  ok('example "' + ex.name + '" evaluates', r.ok, JSON.stringify(r.errors));
  ok('example "' + ex.name + '" ranks its drivers', sensitivity(ex.model, r.result).rows.length >= 3, String(sensitivity(ex.model, r.result).rows.length));
}
const exProfit = evaluateModel(EXAMPLES.find((e) => e.id === 'profit').model);
ok('example profit is $27,700', exProfit.result.display === '$27,700', exProfit.result.display);
const exEff = evaluateModel(EXAMPLES.find((e) => e.id === 'efficiency').model);
ok('example efficiency is 72.6364%', exEff.result.display === '72.6364%', exEff.result.display);
const exDesign = evaluateModel(EXAMPLES.find((e) => e.id === 'design').model);
ok('example design score is 7.3', exDesign.result.display === '7.3', exDesign.result.display);

console.log('passed: ' + passed + '   failed: ' + failures.length);
for (const f of failures) console.log('  FAIL ' + f);
if (failures.length) process.exit(1);
