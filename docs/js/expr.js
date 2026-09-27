// expr.js — safe expression parser for formula blocks. No eval, no regex.
// Grammar:
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/' | '%') unary)*
//   unary   := ('-' | '+') unary | power
//   power   := primary ('^' unary)?
//   primary := number | name | name '(' args ')' | '(' expr ')'

export const FUNCTIONS = {
  min: 2, max: 2, round: 2, floor: 1, ceil: 1, abs: 1, sqrt: 1,
  pow: 2, exp: 1, ln: 1, log: 1, sign: 1
};

const isDigit = function (ch) { return ch >= '0' && ch <= '9'; };
const isAlpha = function (ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
};
const isAlnum = function (ch) { return isAlpha(ch) || isDigit(ch); };

export function tokenize(text) {
  const src = String(text || '');
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1]))) {
      let j = i;
      let seenDot = false;
      while (j < src.length) {
        const c = src[j];
        if (isDigit(c)) { j++; continue; }
        if (c === '.' && !seenDot) { seenDot = true; j++; continue; }
        break;
      }
      if (src[j] === 'e' || src[j] === 'E') {
        let k = j + 1;
        if (src[k] === '+' || src[k] === '-') k++;
        if (isDigit(src[k])) {
          k++;
          while (isDigit(src[k])) k++;
          j = k;
        }
      }
      out.push({ t: 'num', v: Number(src.slice(i, j)), pos: i });
      i = j;
      continue;
    }
    if (isAlpha(ch)) {
      let j = i;
      while (j < src.length && isAlnum(src[j])) j++;
      out.push({ t: 'name', v: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^' || ch === '(' || ch === ')' || ch === ',' || ch === '%') {
      out.push({ t: ch, pos: i });
      i++;
      continue;
    }
    if (ch === '×') { out.push({ t: '*', pos: i }); i++; continue; }
    if (ch === '÷') { out.push({ t: '/', pos: i }); i++; continue; }
    if (ch === '−' || ch === '–') { out.push({ t: '-', pos: i }); i++; continue; }
    if (ch === ';') { i++; continue; }
    throw new Error('Unexpected character "' + ch + '" at position ' + (i + 1));
  }
  out.push({ t: 'end', pos: src.length });
  return out;
}

export function parseExpr(text) {
  const tokens = tokenize(text);
  let i = 0;
  const peek = function () { return tokens[i]; };
  const eat = function (type) {
    const tok = tokens[i];
    if (tok.t !== type) {
      throw new Error('Expected "' + type + '" but found "' + (tok.t === 'end' ? 'end of expression' : tok.t) + '" at position ' + (tok.pos + 1));
    }
    i++;
    return tok;
  };
  const at = function (type) { return tokens[i].t === type; };

  function parseExprNode() {
    let left = parseTerm();
    while (at('+') || at('-')) {
      const op = tokens[i].t;
      i++;
      left = { t: 'bin', op: op, a: left, b: parseTerm() };
    }
    return left;
  }

  function parseTerm() {
    let left = parseUnary();
    while (at('*') || at('/') || at('%')) {
      const op = tokens[i].t;
      i++;
      left = { t: 'bin', op: op, a: left, b: parseUnary() };
    }
    return left;
  }

  function parseUnary() {
    if (at('-')) { i++; return { t: 'neg', a: parseUnary() }; }
    if (at('+')) { i++; return parseUnary(); }
    return parsePower();
  }

  function parsePower() {
    const base = parsePrimary();
    if (at('^')) {
      i++;
      return { t: 'bin', op: '^', a: base, b: parseUnary() };
    }
    return base;
  }

  function parsePrimary() {
    const tok = peek();
    if (tok.t === 'num') { i++; return { t: 'num', v: tok.v }; }
    if (tok.t === 'name') {
      i++;
      if (at('(')) {
        const name = tok.v.toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, name)) {
          throw new Error('Unknown function "' + tok.v + '" at position ' + (tok.pos + 1) + '". Available: ' + Object.keys(FUNCTIONS).join(', '));
        }
        eat('(');
        const args = [];
        if (!at(')')) {
          args.push(parseExprNode());
          while (at(',')) { i++; args.push(parseExprNode()); }
        }
        eat(')');
        const arity = FUNCTIONS[name];
        if (arity === 1 && args.length !== 1) {
          throw new Error('Function "' + name + '" takes 1 argument, got ' + args.length);
        }
        if (arity === 2 && args.length === 0) {
          throw new Error('Function "' + name + '" needs at least 1 argument');
        }
        return { t: 'call', fn: name, args: args };
      }
      return { t: 'name', n: tok.v };
    }
    if (tok.t === '(') {
      i++;
      const node = parseExprNode();
      eat(')');
      return node;
    }
    throw new Error('Unexpected "' + (tok.t === 'end' ? 'end of expression' : tok.t) + '" at position ' + (tok.pos + 1));
  }

  const ast = parseExprNode();
  if (!at('end')) {
    throw new Error('Unexpected "' + tokens[i].t + '" at position ' + (tokens[i].pos + 1));
  }
  return ast;
}

export function collectNames(ast, acc) {
  const out = acc || [];
  if (!ast) return out;
  if (ast.t === 'name') {
    if (out.indexOf(ast.n) < 0) out.push(ast.n);
    return out;
  }
  if (ast.t === 'neg') return collectNames(ast.a, out);
  if (ast.t === 'bin') {
    collectNames(ast.a, out);
    collectNames(ast.b, out);
    return out;
  }
  if (ast.t === 'call') {
    for (const arg of ast.args) collectNames(arg, out);
    return out;
  }
  return out;
}

// Plain numeric evaluation (used by tests and by the unit-aware walker).
export function evalNumber(ast, env) {
  if (ast.t === 'num') return ast.v;
  if (ast.t === 'name') {
    const v = env[ast.n];
    if (v === undefined) throw new Error('Unknown input "' + ast.n + '" in formula');
    return v;
  }
  if (ast.t === 'neg') return -evalNumber(ast.a, env);
  if (ast.t === 'bin') {
    const a = evalNumber(ast.a, env);
    const b = evalNumber(ast.b, env);
    switch (ast.op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/':
        if (b === 0) throw new Error('Division by zero');
        return a / b;
      case '%':
        if (b === 0) throw new Error('Division by zero');
        return a / b * 100;
      case '^': return Math.pow(a, b);
    }
  }
  if (ast.t === 'call') {
    const args = ast.args.map(function (x) { return evalNumber(x, env); });
    switch (ast.fn) {
      case 'min': return Math.min.apply(null, args);
      case 'max': return Math.max.apply(null, args);
      case 'round': return roundTo(args[0], args.length > 1 ? args[1] : 0);
      case 'floor': return Math.floor(args[0]);
      case 'ceil': return Math.ceil(args[0]);
      case 'abs': return Math.abs(args[0]);
      case 'sqrt': return Math.sqrt(args[0]);
      case 'pow': return Math.pow(args[0], args[1]);
      case 'exp': return Math.exp(args[0]);
      case 'ln': return Math.log(args[0]);
      case 'log': return Math.log10(args[0]);
      case 'sign': return Math.sign(args[0]);
    }
    throw new Error('Unknown function "' + ast.fn + '"');
  }
  throw new Error('Cannot evaluate expression node');
}

export function roundTo(value, digits) {
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}
