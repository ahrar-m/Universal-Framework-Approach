// Engine tests — run with: node tests/engine.test.mjs
import { parseUnit, formatValue, sameDims, combineMul, combineDiv, isRatio } from '../docs/js/units.js';
import { parseExpr, evalNumber, collectNames } from '../docs/js/expr.js';
import { evaluateModel, sensitivity, validateModel, makeBlock, defaultModel } from '../docs/js/engine.js';

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

// unconnected port
{
  const m = model((m) => {
    const a = makeBlock('input', 0, 0); a.name = 'a'; a.value = 5;
    const add = makeBlock('op', 200, 0); add.op = 'add';
    const res = makeBlock('result', 400, 0);
    m.blocks.push(a, add, res);
    m.wires.push({ id: 'w1', from: a.id, to: add.id, toPort: 'a' });
    m.wires.push({ id: 'w2', from: add.id, to: res.id, toPort: 'in' });
  });
  const r = evaluateModel(m);
  ok('unconnected port reported', !r.ok && r.errors.some((e) => e.indexOf('not connected') >= 0), JSON.stringify(r.errors));
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

console.log('passed: ' + passed + '   failed: ' + failures.length);
for (const f of failures) console.log('  FAIL ' + f);
if (failures.length) process.exit(1);
