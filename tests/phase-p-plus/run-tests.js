// ============================================================
// Phase P+ 测试总入口
// ------------------------------------------------------------
// 用法：
//   node tests/phase-p-plus/run-tests.js            # 跑全部
//   node tests/phase-p-plus/run-tests.js --json     # 输出 JSON 结果
//   node tests/phase-p-plus/run-tests.js 5          # 只跑第 5 组
//
// 退出码：全部通过 = 0，任一失败 = 1（可直接接入 CI）
// ============================================================

'use strict';

const path = require('path');
const fs = require('fs');
const { T } = require('./harness');

const SUITES = [
  './test-1-registry-provider',
  './test-2-observability',
  './test-3-dashboard',
  './test-4-health-score',
  './test-5-frozen-assets',
];

const args = process.argv.slice(2);
const asJson = args.indexOf('--json') >= 0;
const only = args.filter((a) => /^\d+$/.test(a)).map(Number);

function log() {
  if (!asJson) console.log.apply(console, arguments);
}

async function main() {
  const started = Date.now();
  const report = [];
  let totalPass = 0;
  let totalFail = 0;

  log('');
  log('╔══════════════════════════════════════════════════════════════╗');
  log('║  Phase P+ 测试套件 — Knowledge Platform v1.0.1 Hardening     ║');
  log('╚══════════════════════════════════════════════════════════════╝');

  for (let i = 0; i < SUITES.length; i++) {
    const idx = i + 1;
    if (only.length > 0 && only.indexOf(idx) < 0) continue;

    const suite = require(SUITES[i]);
    const t = new T(suite.name);
    let fatal = null;
    try {
      await suite.run(t);
    } catch (e) {
      fatal = (e && e.stack) || String(e);
      t.ok(false, '套件执行异常终止', fatal);
    }

    log('');
    log('── [' + idx + '/' + SUITES.length + '] ' + suite.name + ' ' + '─'.repeat(Math.max(0, 44 - suite.name.length * 2)));
    t.results.forEach((r) => {
      if (r.info) {
        log('   ·  ' + r.msg);
      } else if (r.ok) {
        log('   ✓  ' + r.msg);
      } else {
        log('   ✗  ' + r.msg);
        if (r.detail) log('        ↳ ' + String(r.detail).split('\n').join('\n        '));
      }
    });
    log('   ── ' + t.passed + ' passed, ' + t.failed + ' failed');

    totalPass += t.passed;
    totalFail += t.failed;
    report.push({
      suite: suite.name,
      passed: t.passed,
      failed: t.failed,
      fatal: fatal,
      failures: t.results.filter((r) => !r.info && !r.ok).map((r) => ({ msg: r.msg, detail: r.detail })),
      info: t.results.filter((r) => r.info).map((r) => r.msg),
    });
  }

  const elapsed = Date.now() - started;
  const summary = {
    generated_at: new Date().toISOString(),
    phase: 'Phase P+ / 第六阶段',
    total_passed: totalPass,
    total_failed: totalFail,
    all_pass: totalFail === 0,
    elapsed_ms: elapsed,
    suites: report,
  };

  log('');
  log('══════════════════════════════════════════════════════════════');
  log('  合计：' + totalPass + ' passed, ' + totalFail + ' failed  (' + elapsed + 'ms)');
  log('  结论：' + (totalFail === 0 ? '✅ 全部通过' : '❌ 存在失败项，禁止放行'));
  log('══════════════════════════════════════════════════════════════');
  log('');

  // 写结果产物，供 docs/69 引用
  try {
    fs.writeFileSync(
      path.join(__dirname, 'results.json'),
      JSON.stringify(summary, null, 2),
      'utf-8'
    );
  } catch (e) {
    /* 写产物失败不影响测试结论 */
  }

  if (asJson) console.log(JSON.stringify(summary, null, 2));
  process.exitCode = totalFail === 0 ? 0 : 1;
}

main();
