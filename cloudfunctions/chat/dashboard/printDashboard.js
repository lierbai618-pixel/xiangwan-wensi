// ============================================================
// printDashboard — Dashboard MVP 的 CLI 呈现层（Phase P+）
// ------------------------------------------------------------
// 只读打印。不做任何计算，全部数值来自 dashboard.buildDashboard()。
// N/A 指标以「N/A（原因）」显式呈现，绝不填充默认值。
//
// 用法：
//   node cloudfunctions/chat/dashboard/printDashboard.js
//   node cloudfunctions/chat/dashboard/printDashboard.js --json
//   node cloudfunctions/chat/dashboard/printDashboard.js --obs <观测存储路径>
// ============================================================

'use strict';

const { buildDashboard } = require('./dashboard');

function fmt(metric, formatter) {
  if (!metric) return 'N/A（指标未定义）';
  if (metric.available === false) return 'N/A（' + (metric.reason || 'unavailable') + '）';
  return formatter ? formatter(metric) : String(metric.value);
}

function line(label, value, width) {
  const w = width || 24;
  let l = String(label);
  if (l.length < w) l = l + new Array(w - l.length + 1).join(' ');
  else l = l + '  ';
  return '  ' + l + value;
}

function render(snapshot) {
  const m = snapshot.metrics;
  const out = [];

  out.push('');
  out.push('═══════════════════════════════════════════════════════════════');
  out.push('  向晚问思 · Knowledge Platform Dashboard (MVP v1.0.1)');
  out.push('  生成时间：' + snapshot.generated_at);
  out.push('  只读模式：' + (snapshot.readonly ? '是' : '否') + '   ｜   重算检索：' + (snapshot.recomputes_retrieval ? '是' : '否（禁止）'));
  out.push('═══════════════════════════════════════════════════════════════');

  // ① Knowledge Count
  out.push('');
  out.push('【① Knowledge Count】知识对象总量');
  out.push(
    line(
      '总量',
      fmt(m.knowledgeCount, (x) => String(x.value))
    )
  );
  if (m.knowledgeCount.available) {
    const b = m.knowledgeCount.breakdown;
    out.push(line('  经典(grandfathered)', String(b.classic_grandfathered)));
    out.push(line('  认证对象', String(b.certified_objects)));
    out.push(
      line(
        '  类型分布',
        Object.keys(b.byType)
          .map((k) => k + '=' + b.byType[k])
          .join(', ')
      )
    );
  }

  // ② Registry Status
  out.push('');
  out.push('【② Registry Status】注册表状态');
  if (m.registryStatus.available) {
    out.push(line('schema', String(m.registryStatus.schema)));
    out.push(line('namespace', String(m.registryStatus.namespace)));
    out.push(line('登记条目', String(m.registryStatus.value)));
    out.push(
      line(
        '状态分布',
        Object.keys(m.registryStatus.byStatus)
          .map((k) => k + '=' + m.registryStatus.byStatus[k])
          .join(', ') || '（空）'
      )
    );
  } else {
    out.push(line('状态', fmt(m.registryStatus)));
  }

  // ③ Citation Accuracy
  out.push('');
  out.push('【③ Citation Accuracy】引用准确率');
  out.push(
    line(
      '静态(C5 门禁)',
      fmt(m.citationAccuracy, (x) => x.value + '  [' + x.gate_id + ' pass=' + x.gate_pass + ']')
    )
  );
  out.push(
    line(
      '运行时引用率',
      fmt(m.citationAccuracy.runtime_citation_present_rate, (x) => x.value + '（n=' + x.sample_size + '）')
    )
  );

  // ④ Regression Status
  out.push('');
  out.push('【④ Regression Status】回归门禁');
  out.push(
    line(
      '结论',
      fmt(m.regressionStatus, (x) => x.value)
    )
  );
  if (m.regressionStatus.available) {
    out.push(line('  Classic Hit@3', String(m.regressionStatus.baseline.classic_hit3_routed)));
    out.push(line('  概念卡侵入率', String(m.regressionStatus.baseline.intrusion_rate_routed)));
    out.push(line('  Benchmark Hit@3', String(m.regressionStatus.benchmark)));
    if (m.regressionStatus.o0_go_no_go !== undefined) {
      out.push(line('  O-0 Go/No-Go', String(m.regressionStatus.o0_go_no_go)));
    }
  }

  // ⑤ KQS
  out.push('');
  out.push('【⑤ KQS】知识质量分');
  out.push(
    line(
      '平均分',
      fmt(m.kqs, (x) => x.value + '（n=' + x.sample_size + '，min=' + x.min + '，max=' + x.max + '）')
    )
  );

  // ⑥ Health Score
  out.push('');
  out.push('【⑥ Health Score】健康分（七维，缺失维 N/A 重归一化）');
  out.push(
    line(
      '平均健康分',
      fmt(m.healthScore, (x) => String(x.value))
    )
  );
  if (m.healthScore.available) {
    out.push(line('N/A 维度', m.healthScore.naDimensions.join(' / ') || '无'));
    m.healthScore.perRecord.slice(0, 8).forEach((r) => {
      out.push(line('  ' + r.knowledge_id, String(r.score)));
    });
    if (m.healthScore.perRecord.length > 8) {
      out.push(line('  ...', '共 ' + m.healthScore.perRecord.length + ' 个对象'));
    }
  }

  // ⑦ Query Count
  out.push('');
  out.push('【⑦ Query Count】查询量（观测）');
  out.push(
    line(
      '记录条数',
      fmt(m.queryCount, (x) => String(x.value))
    )
  );
  if (m.latency) {
    out.push(
      line(
        '平均延迟',
        fmt(m.latency, (x) => x.value + 'ms（p95=' + x.p95 + 'ms，n=' + x.sample_size + '）')
      )
    );
  }

  // ⑧ Knowledge Usage
  out.push('');
  out.push('【⑧ Knowledge Usage】知识使用分布');
  out.push(
    line(
      '类型频次',
      fmt(m.knowledgeUsage, (x) =>
        Object.keys(x.value)
          .map((k) => k + '=' + x.value[k])
          .join(', ')
      )
    )
  );

  // 降级提示
  out.push('');
  out.push('───────────────────────────────────────────────────────────────');
  if (snapshot.degraded.length > 0) {
    out.push('  ⚠ 不可用指标（诚实标注 N/A，未伪造）：' + snapshot.degraded.join(', '));
  } else {
    out.push('  ✔ 全部指标可用');
  }
  out.push('  数据来源：Registry / Observability / Regression（无检索重算）');
  out.push('═══════════════════════════════════════════════════════════════');
  out.push('');

  return out.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.indexOf('--json') >= 0;
  const obsIdx = args.indexOf('--obs');
  const config = {};
  if (obsIdx >= 0 && args[obsIdx + 1]) config.observabilityPath = args[obsIdx + 1];

  const snapshot = buildDashboard(config);
  if (asJson) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    console.log(render(snapshot));
  }
}

if (require.main === module) main();

module.exports = { render };
