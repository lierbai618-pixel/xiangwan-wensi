// ============================================================
// Phase P+ 测试微框架（零依赖）
// ------------------------------------------------------------
// 不引入 jest/mocha：云函数目录需保持零外部依赖，测试必须能用
// 裸 node 直接跑（`node tests/phase-p-plus/run-tests.js`）。
// ============================================================

'use strict';

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (kb.indexOf(ka[i]) < 0) return false;
    if (!deepEqual(a[ka[i]], b[ka[i]])) return false;
  }
  return true;
}

class T {
  constructor(suiteName) {
    this.suiteName = suiteName;
    this.results = [];
  }

  _push(ok, msg, detail) {
    this.results.push({ ok, msg, detail: detail || null });
  }

  ok(cond, msg, detail) {
    this._push(!!cond, msg, cond ? null : detail || '(condition false)');
    return !!cond;
  }

  equal(actual, expected, msg) {
    const ok = actual === expected;
    this._push(ok, msg, ok ? null : 'expected=' + JSON.stringify(expected) + ' actual=' + JSON.stringify(actual));
    return ok;
  }

  deepEqual(actual, expected, msg) {
    const ok = deepEqual(actual, expected);
    this._push(
      ok,
      msg,
      ok ? null : 'expected=' + JSON.stringify(expected) + '\n            actual  =' + JSON.stringify(actual)
    );
    return ok;
  }

  close(actual, expected, tol, msg) {
    const ok = typeof actual === 'number' && Math.abs(actual - expected) <= tol;
    this._push(ok, msg, ok ? null : 'expected≈' + expected + '±' + tol + ' actual=' + actual);
    return ok;
  }

  /** 断言函数不抛出，并返回其结果 */
  noThrow(fn, msg) {
    try {
      const r = fn();
      this._push(true, msg);
      return r;
    } catch (e) {
      this._push(false, msg, 'threw: ' + (e && e.message));
      return undefined;
    }
  }

  /** 信息行：不参与通过/失败判定，仅用于诚实披露事实 */
  info(msg) {
    this.results.push({ info: true, msg });
  }

  get passed() {
    return this.results.filter((r) => !r.info && r.ok).length;
  }
  get failed() {
    return this.results.filter((r) => !r.info && !r.ok).length;
  }
}

module.exports = { T, deepEqual };
