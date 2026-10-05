// ============================================================
// verify-observability.js — Stage 5 Dashboard 真实数据验证
// ------------------------------------------------------------
// 用法：
//   node scripts/verify-observability.js <records.json>
//     <records.json> = 从云库 observability_logs 拉取的记录数组
//     （拉取示例见 docs/70-PhaseP+Deployment报告.md §3）
//
// 作用：用真实 dashboard.js + 真实云库记录做只读聚合，确认以下指标
//       开始有真实数据；无数据的指标显式 N/A（绝不伪造）。
// 不修改任何文件、不触碰冻结资产。
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');

const RECORDS_PATH = process.argv[2];
if (!RECORDS_PATH) {
  console.error('用法: node scripts/verify-observability.js <records.json>');
  process.exit(2);
}

let records;
try {
  records = JSON.parse(fs.readFileSync(RECORDS_PATH, 'utf-8'));
  if (!Array.isArray(records)) records = [records];
} catch (e) {
  console.error('读取记录文件失败:', e.message);
  process.exit(2);
}

// 真实 Dashboard 聚合（与线上一致，只读）
const { buildDashboard } = require('../cloudfunctions/chat/dashboard/dashboard.js');
const dash = buildDashboard({ store: { readAll: () => records } });
const m = dash.metrics;

// Fallback Rate = 未引用任何知识（citation_count===0）的请求占比
const total = records.length;
const fallbackCount = records.filter((r) => (r.citation_count || 0) === 0).length;
const fallbackRate = total > 0 ? Math.round((fallbackCount / total) * 1000) / 1000 : null;

function line(name, obj) {
  if (!obj || obj.available === false) {
    console.log(`  · ${name}: N/A (${obj ? obj.reason || 'no data' : 'missing'})`);
    return;
  }
  console.log(`  · ${name}: ${JSON.stringify(obj.value)}` + (obj.sample_size ? `  (n=${obj.sample_size})` : ''));
}

console.log('');
console.log('══════════════════════════════════════════════════════');
console.log('  Phase P+ Deployment — Stage 5 Dashboard 真实数据验证');
console.log('══════════════════════════════════════════════════════');
console.log(`  记录总数: ${total}`);
console.log('');
console.log('  五项目标指标（应开始有真实数据）：');
line('Query Count', m.queryCount);
line('Knowledge Usage', m.knowledgeUsage);
line('Citation Rate (citation_count>0 占比)', m.citationAccuracy && m.citationAccuracy.runtime_citation_present_rate);
line('Latency (ms 均值)', m.latency);
console.log(`  · Fallback Rate (citation_count===0 占比): ${fallbackRate === null ? 'N/A' : fallbackRate}  (n=${total})`);
console.log('');
console.log('  全部指标 N/A 清单（诚实声明，未伪造）：');
if (dash.degraded && dash.degraded.length) {
  dash.degraded.forEach((k) => console.log(`    - ${k}`));
} else {
  console.log('    （无）');
}
console.log('');
console.log(`  readonly=${dash.readonly}  recomputes_retrieval=${dash.recomputes_retrieval}`);
console.log('══════════════════════════════════════════════════════');
