// ============================================================
// Capability Layer — calculator.js（计算能力）
//   Phase R：算术求值。
//
//   安全铁律：
//     · 禁止 eval / new Function / vm —— 用户输入永不进入 JS 执行器。
//       实现方式：自建 tokenizer + 调度场算法(shunting-yard) + RPN 求值。
//     · 只认识数字与运算符，任何无法识别的字符直接判非法并诚实告知。
//     · 语义歧义宁可拒答：中文"甲除乙"与"甲除以乙"含义相反，
//       裸"除"一律要求用户澄清，绝不猜一个答案给用户。
//
//   本模块不进入知识库、不进入 embedding、不影响 RAG。
//   纯函数，可离线单测。
// ============================================================
'use strict';

// ---------- ① 中文/全角 归一化 ----------
function normalize(raw) {
  var s = (raw || '').toString();

  // 千分位分隔符必须最先处理：晚于标点清洗会把 "1,000" 拆成两个数字
  var prev;
  do {
    prev = s;
    s = s.replace(/(\d)[,，](\d{3})(?!\d)/gu, '$1$2');
  } while (s !== prev);

  // 去掉与算式无关的提问壳
  s = s.replace(/(帮我|请|麻烦|你能|能不能|快)?(算一下|算一算|计算一下|计算|求|帮我算)/gu, ' ');
  s = s.replace(/(等于多少|等于几|得多少|是多少|结果是|答案是|等于|=)\s*[?？]?\s*$/u, ' ');
  s = s.replace(/[?？。!！,，、]/gu, ' ');

  // 全角 → 半角
  s = s.replace(/[０-９]/gu, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); });
  s = s.replace(/[（]/gu, '(').replace(/[）]/gu, ')');
  s = s.replace(/[＋]/gu, '+').replace(/[－—–]/gu, '-').replace(/[＊]/gu, '*').replace(/[／]/gu, '/');

  // 运算符号
  s = s.replace(/[×✕✖]/gu, '*').replace(/[÷]/gu, '/');

  // 百分比：先处理"A的百分之B"（= A*B/100），再处理独立"百分之B"
  s = s.replace(/的百分之\s*([\d.]+)/gu, ' * ( $1 / 100 )');
  s = s.replace(/百分之\s*([\d.]+)/gu, ' ( $1 / 100 ) ');
  s = s.replace(/([\d.]+)\s*%/gu, ' ( $1 / 100 ) ');

  // 幂与根
  s = s.replace(/的平方根/gu, ' __SQRT__ ');
  s = s.replace(/的平方/gu, ' ^ 2 ');
  s = s.replace(/的立方/gu, ' ^ 3 ');
  s = s.replace(/的\s*([\d.]+)\s*次方/gu, ' ^ $1 ');
  s = s.replace(/(开方|平方根|根号)/gu, ' __SQRT__ ');

  // 中文运算词（"除以"必须在裸"除"之前替换）
  s = s.replace(/乘以|乘上|乘/gu, ' * ');
  s = s.replace(/除以/gu, ' / ');
  s = s.replace(/加上|加/gu, ' + ');
  s = s.replace(/减去|减/gu, ' - ');

  // 千分位逗号（1,000 → 1000）
  s = s.replace(/(\d),(\d{3})/gu, '$1$2');

  return s.trim();
}

// 裸"除"歧义检测（在归一化之前判断）
function hasAmbiguousDivide(raw) {
  var s = (raw || '').toString();
  return /\d\s*除(?!以)\s*\d/u.test(s);
}

// ---------- ② Tokenizer ----------
var OPS = {
  '+': { prec: 1, assoc: 'L', arity: 2 },
  '-': { prec: 1, assoc: 'L', arity: 2 },
  '*': { prec: 2, assoc: 'L', arity: 2 },
  '/': { prec: 2, assoc: 'L', arity: 2 },
  '^': { prec: 3, assoc: 'R', arity: 2 },
  // 前缀一元运算符：优先级必须与 u- 相同。
  // 若 sqrt 高于 u-，"根号-4" 会被拆成 sqrt 先于取负求值 → 表达式畸形。
  // 同级右结合可保证 √(-4) 正确进入负数开方的诚实报错分支。
  'u-': { prec: 4, assoc: 'R', arity: 1 },
  'sqrt': { prec: 4, assoc: 'R', arity: 1 },
};

function tokenize(s) {
  var tokens = [];
  var i = 0;
  var prevType = 'start'; // start | number | op | lparen | rparen
  while (i < s.length) {
    var c = s[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }

    if (s.substr(i, 8) === '__SQRT__') {
      tokens.push({ t: 'op', v: 'sqrt' });
      prevType = 'op';
      i += 8;
      continue;
    }

    if (/[0-9.]/.test(c)) {
      var num = '';
      while (i < s.length && /[0-9.]/.test(s[i])) { num += s[i]; i++; }
      if ((num.match(/\./gu) || []).length > 1) {
        return { ok: false, reason: 'bad_number', detail: num };
      }
      var val = parseFloat(num);
      if (isNaN(val)) return { ok: false, reason: 'bad_number', detail: num };
      tokens.push({ t: 'num', v: val });
      prevType = 'number';
      continue;
    }

    if (c === '(') { tokens.push({ t: 'lp' }); prevType = 'lparen'; i++; continue; }
    if (c === ')') { tokens.push({ t: 'rp' }); prevType = 'rparen'; i++; continue; }

    if (OPS[c]) {
      // 一元负号：出现在开头 / 运算符后 / 左括号后
      if (c === '-' && (prevType === 'start' || prevType === 'op' || prevType === 'lparen')) {
        tokens.push({ t: 'op', v: 'u-' });
      } else {
        tokens.push({ t: 'op', v: c });
      }
      prevType = 'op';
      i++;
      continue;
    }

    // 任何无法识别的字符 → 诚实失败，绝不猜
    return { ok: false, reason: 'unsupported_char', detail: c };
  }
  if (tokens.length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, tokens: tokens };
}

// ---------- ③ 调度场算法 → RPN ----------
function toRPN(tokens) {
  var out = [];
  var stack = [];
  for (var i = 0; i < tokens.length; i++) {
    var tk = tokens[i];
    if (tk.t === 'num') { out.push(tk); continue; }
    if (tk.t === 'op') {
      var o1 = OPS[tk.v];
      while (stack.length > 0) {
        var top = stack[stack.length - 1];
        if (top.t !== 'op') break;
        var o2 = OPS[top.v];
        if ((o1.assoc === 'L' && o1.prec <= o2.prec) || (o1.assoc === 'R' && o1.prec < o2.prec)) {
          out.push(stack.pop());
        } else break;
      }
      stack.push(tk);
      continue;
    }
    if (tk.t === 'lp') { stack.push(tk); continue; }
    if (tk.t === 'rp') {
      var found = false;
      while (stack.length > 0) {
        var s2 = stack.pop();
        if (s2.t === 'lp') { found = true; break; }
        out.push(s2);
      }
      if (!found) return { ok: false, reason: 'unbalanced_paren' };
      continue;
    }
  }
  while (stack.length > 0) {
    var s3 = stack.pop();
    if (s3.t === 'lp') return { ok: false, reason: 'unbalanced_paren' };
    out.push(s3);
  }
  return { ok: true, rpn: out };
}

// ---------- ④ RPN 求值 ----------
function evalRPN(rpn) {
  var st = [];
  for (var i = 0; i < rpn.length; i++) {
    var tk = rpn[i];
    if (tk.t === 'num') { st.push(tk.v); continue; }
    var op = OPS[tk.v];
    if (!op) return { ok: false, reason: 'bad_op' };
    if (op.arity === 1) {
      if (st.length < 1) return { ok: false, reason: 'malformed_expression' };
      var a = st.pop();
      if (tk.v === 'u-') st.push(-a);
      else if (tk.v === 'sqrt') {
        if (a < 0) return { ok: false, reason: 'sqrt_negative' };
        st.push(Math.sqrt(a));
      }
      continue;
    }
    if (st.length < 2) return { ok: false, reason: 'malformed_expression' };
    var y = st.pop();
    var x = st.pop();
    var r;
    if (tk.v === '+') r = x + y;
    else if (tk.v === '-') r = x - y;
    else if (tk.v === '*') r = x * y;
    else if (tk.v === '/') {
      if (y === 0) return { ok: false, reason: 'divide_by_zero' };
      r = x / y;
    } else if (tk.v === '^') r = Math.pow(x, y);
    else return { ok: false, reason: 'bad_op' };
    if (!isFinite(r)) return { ok: false, reason: 'not_finite' };
    st.push(r);
  }
  if (st.length !== 1) return { ok: false, reason: 'malformed_expression' };
  return { ok: true, value: st[0] };
}

// ---------- ⑤ 结果格式化（消除浮点噪声）----------
function formatNumber(n) {
  if (Number.isInteger(n)) return '' + n;
  // 12 位有效数字足以覆盖日常计算，同时消除 0.1+0.2 类噪声
  var fixed = parseFloat(n.toPrecision(12));
  if (Number.isInteger(fixed)) return '' + fixed;
  var s = '' + fixed;
  // 超长小数截断到 6 位并标注约等于
  if (s.replace(/^-?\d*\./u, '').length > 6) {
    return '≈' + fixed.toFixed(6).replace(/0+$/u, '').replace(/\.$/u, '');
  }
  return s;
}

var ERROR_TEXT = {
  ambiguous_divide: '你写的"除"在中文里有两种相反的读法（"6 除 3" 与 "6 除以 3" 结果不同）。我不想猜错给你一个错的数——你是想算哪一个？可以直接写成 6÷3 或 3÷6。',
  unsupported_char: '这个式子里有我识别不了的符号，我不会硬算一个数糊弄你。你可以用 + - × ÷ ( ) 重新写一遍。',
  bad_number: '式子里的数字格式我没看懂（比如出现了多个小数点）。你重新写一下，我立刻算。',
  unbalanced_paren: '括号没有配对，我算不了。补齐括号再发我一次。',
  malformed_expression: '这个式子不完整，我没法得到一个确定的结果。你补全后我马上算。',
  divide_by_zero: '除数是 0，这个式子在数学上没有定义——不是我算不出来，是它本身没有答案。',
  sqrt_negative: '负数在实数范围内开平方没有结果。如果你要的是复数，那超出我这里的处理范围了。',
  not_finite: '这个数超出了可精确表示的范围，给你一个数字反而会误导你。',
  empty: '我没有从你的话里读到可以计算的式子。',
};

// ------------------------------------------------------------
// resolve({ query })
//   返回 { ok, capability, fact, data } 或 { ok:false, reason, fact }
// ------------------------------------------------------------
function resolve(input) {
  input = input || {};
  var raw = (input.query || '').toString();

  if (hasAmbiguousDivide(raw)) {
    return {
      ok: false,
      capability: 'calculation_query',
      reason: 'ambiguous_divide',
      fact: ERROR_TEXT.ambiguous_divide,
    };
  }

  var normalized = normalize(raw);
  var tk = tokenize(normalized);
  if (!tk.ok) {
    return {
      ok: false,
      capability: 'calculation_query',
      reason: tk.reason,
      fact: ERROR_TEXT[tk.reason] || ERROR_TEXT.malformed_expression,
    };
  }

  var rpn = toRPN(tk.tokens);
  if (!rpn.ok) {
    return {
      ok: false,
      capability: 'calculation_query',
      reason: rpn.reason,
      fact: ERROR_TEXT[rpn.reason] || ERROR_TEXT.malformed_expression,
    };
  }

  var ev = evalRPN(rpn.rpn);
  if (!ev.ok) {
    return {
      ok: false,
      capability: 'calculation_query',
      reason: ev.reason,
      fact: ERROR_TEXT[ev.reason] || ERROR_TEXT.malformed_expression,
    };
  }

  var pretty = formatNumber(ev.value);
  return {
    ok: true,
    capability: 'calculation_query',
    subType: 'arithmetic',
    fact: '结果是 ' + pretty + '。',
    data: { expression: normalized.replace(/\s+/gu, ' ').trim(), value: ev.value, display: pretty },
  };
}

module.exports = {
  resolve: resolve,
  normalize: normalize,
  tokenize: tokenize,
  formatNumber: formatNumber,
  hasAmbiguousDivide: hasAmbiguousDivide,
};
