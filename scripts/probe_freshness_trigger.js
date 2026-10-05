#!/usr/bin/env node
'use strict';

/**
 * 验证：哪些问题会走联网（Freshness），哪些不会
 *
 * 直接调用生产代码里的 classifyCategory（纯本地规则，不联网、不调模型），
 * 对典型问题分类，判断「取消联网」对各题型是否有提速价值。
 *
 * 运行：node scripts/probe_freshness_trigger.js
 */

const path = require('path');
const CHAT = path.join(__dirname, '..', 'cloudfunctions', 'chat');
const classifier = require(path.join(CHAT, 'freshness', 'eventClassifier'));

const CASES = [
  ['我今年30岁，工作稳定但总觉得没什么意义，想改变又怕失去现在的一切', '人生困惑'],
  ['什么是存在主义？', '哲学概念'],
  ['我总是很焦虑，怎么办', '情绪支持'],
  ['孔子说的"仁"到底是什么意思', '经典解读'],
  ['如何用 Python 读一个 CSV 文件', '技术问题'],
  ['今天天气怎么样', '实时天气'],
  ['最近有什么重要的新闻', '新闻热点'],
  ['房主任最近怎么样', '人物动态'],
  ['怎么看最近出台的 AI 监管政策', '政策事件'],
  ['2026年诺贝尔文学奖得主是谁', '时效事实'],
  ['最近网上传的那个事故是真的吗', '敏感话题'],
];

console.log('题目'.padEnd(46) + ' 类型'.padEnd(12) + ' Category  走联网?   判定依据');
console.log('─'.repeat(118));
let netCount = 0;
for (const [q, label] of CASES) {
  let r;
  try { r = classifier.classifyCategory(q, null); } catch (e) { console.log(q + '  ✗ ' + e.message); continue; }
  const cat = r.category;
  const isNet = cat !== 'A';
  if (isNet) netCount++;
  console.log(
    q.slice(0, 44).padEnd(46) + ' ' + label.padEnd(12) + ' ' +
    String(cat).padEnd(11) + ' ' + (isNet ? '✅ 会     ' : '❌ 不会   ') + ' ' + (r.reason || '')
  );
}
console.log('─'.repeat(118));
console.log('样本 ' + CASES.length + ' 条，其中会触发联网的 ' + netCount + ' 条');
