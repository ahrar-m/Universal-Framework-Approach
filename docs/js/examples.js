// examples.js — ready-made models the user can load and take apart.
function input(id, x, y, name, value, unit, min, likely, max) {
  return { id: id, type: 'input', x: x, y: y, name: name, value: value, unit: unit, min: min === undefined ? null : min, likely: likely === undefined ? null : likely, max: max === undefined ? null : max };
}
function op(id, x, y, kind, title) {
  return { id: id, type: 'op', x: x, y: y, op: kind, title: title };
}
function result(id, x, y, title, displayUnit) {
  return { id: id, type: 'result', x: x, y: y, title: title, displayUnit: displayUnit || '' };
}
function wire(id, from, to, toPort) {
  return { id: id, from: from, to: to, toPort: toPort };
}

const profit = {
  version: 1,
  name: 'Monthly profit',
  blocks: [
    input('p_price', 0, 0, 'price', 49, '$/unit', 39, 49, 59),
    input('p_vol', 0, 180, 'volume', 1200, 'units', 800, 1200, 1600),
    input('p_cost', 0, 360, 'cost', 18, '$/unit', 15, 18, 22),
    input('p_fixed', 0, 540, 'fixed', 9500, '$'),
    op('p_rev', 330, 40, 'mul', 'revenue'),
    op('p_var', 330, 380, 'mul', 'variable cost'),
    op('p_tot', 660, 380, 'add', 'total cost'),
    op('p_profit', 990, 180, 'sub', 'profit'),
    result('p_res', 1320, 180, 'Monthly profit', '$')
  ],
  wires: [
    wire('pw1', 'p_price', 'p_rev', 'a'),
    wire('pw2', 'p_vol', 'p_rev', 'b'),
    wire('pw3', 'p_cost', 'p_var', 'a'),
    wire('pw4', 'p_vol', 'p_var', 'b'),
    wire('pw5', 'p_var', 'p_tot', 'a'),
    wire('pw6', 'p_fixed', 'p_tot', 'b'),
    wire('pw7', 'p_rev', 'p_profit', 'a'),
    wire('pw8', 'p_tot', 'p_profit', 'b'),
    wire('pw9', 'p_profit', 'p_res', 'in')
  ]
};

const efficiency = {
  version: 1,
  name: 'Line efficiency',
  blocks: [
    input('e_avail', 0, 0, 'available', 480, 'min', 440, 480, 500),
    input('e_up', 0, 180, 'uptime', 85, '%', 75, 85, 95),
    input('e_cycle', 0, 360, 'cycle time', 2.4, 'min/unit', 2, 2.4, 3),
    input('e_yield', 0, 540, 'yield', 94, '%', 88, 94, 99),
    input('e_target', 0, 720, 'target', 220, 'units', 200, 220, 240),
    op('e_run', 330, 40, 'mul', 'run time'),
    op('e_start', 660, 40, 'div', 'units started'),
    op('e_good', 990, 40, 'mul', 'good units'),
    op('e_attain', 1320, 40, 'div', 'attainment'),
    result('e_res', 1650, 40, 'Line efficiency', '%')
  ],
  wires: [
    wire('ew1', 'e_avail', 'e_run', 'a'),
    wire('ew2', 'e_up', 'e_run', 'b'),
    wire('ew3', 'e_run', 'e_start', 'a'),
    wire('ew4', 'e_cycle', 'e_start', 'b'),
    wire('ew5', 'e_start', 'e_good', 'a'),
    wire('ew6', 'e_yield', 'e_good', 'b'),
    wire('ew7', 'e_good', 'e_attain', 'a'),
    wire('ew8', 'e_target', 'e_attain', 'b'),
    wire('ew9', 'e_attain', 'e_res', 'in')
  ]
};

const design = {
  version: 1,
  name: 'Design score',
  blocks: [
    input('d_use', 0, 0, 'usability', 8, 'x', 5, 8, 10),
    input('d_val', 0, 180, 'user value', 7, 'x', 5, 7, 9),
    input('d_fit', 0, 360, 'strategic fit', 9, 'x', 6, 9, 10),
    input('d_eff', 0, 540, 'build effort', 6, 'x', 3, 6, 9),
    {
      id: 'd_score',
      type: 'formula',
      x: 330,
      y: 180,
      title: 'weighted score',
      expr: '0.35*usability + 0.3*user_value + 0.2*strategic_fit + 0.15*(10 - build_effort)',
      inputs: [
        { id: 'dp1', name: 'usability' },
        { id: 'dp2', name: 'user_value' },
        { id: 'dp3', name: 'strategic_fit' },
        { id: 'dp4', name: 'build_effort' }
      ]
    },
    result('d_res', 700, 180, 'Design score', 'num')
  ],
  wires: [
    wire('dw1', 'd_use', 'd_score', 'dp1'),
    wire('dw2', 'd_val', 'd_score', 'dp2'),
    wire('dw3', 'd_fit', 'd_score', 'dp3'),
    wire('dw4', 'd_eff', 'd_score', 'dp4'),
    wire('dw5', 'd_score', 'd_res', 'in')
  ]
};

export const EXAMPLES = [
  { id: 'profit', name: 'Monthly profit', blurb: 'Price x volume minus costs - the classic business KPI, with ranges for the sensitivity ranking.', model: profit },
  { id: 'efficiency', name: 'Line efficiency', blurb: 'Shift minutes to good units to attainment - process efficiency with unit conversion throughout.', model: efficiency },
  { id: 'design', name: 'Design score', blurb: 'A weighted product-design score in one Formula block - tradeoffs made visible.', model: design }
];
