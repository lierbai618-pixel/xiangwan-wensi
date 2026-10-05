#!/usr/bin/env node
'use strict';

/**
 * 输出格式契约测试 —— 锁定 CR-2026-09-21「删除答案段落」的确切范围
 *
 * 为什么需要这个测试：
 *   该 CR 的作用域是「**只删 general 的【建议】**」，emotion 与 philosophy 的
 *   【建议】是**刻意保留**的例外。但当时没有任何断言覆盖这个区分 ——
 *   一旦将来有人顺手把三处一起删掉，测试仍会全绿，产品行为却已被悄悄改变。
 *   本文件就是把「意图」固化成可执行的契约。
 *
 * 运行： node tests/rag-output-format-contract.js
 */

const path = require('path');

const CHAT = path.join(__dirname, '..', 'cloudfunctions', 'chat');
const rag = require(path.join(CHAT, 'rag.js'));
const reasoning = require(path.join(CHAT, 'think', 'reasoning.js'));

let pass = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { failures.push(name); console.log('  ✗ ' + name + (extra ? ' :: ' + extra : '')); }
}

const F = rag.OUTPUT_FORMATS;

console.log('\n[1] general 意图：已移除【建议】，保留其余分段');
{
  const c = F.general.contract;
  ok('general 不含【建议】', c.indexOf('【建议】') < 0);
  ok('general 仍含【回答】', c.indexOf('【回答】') >= 0);
  ok('general 仍含【分析】', c.indexOf('【分析】') >= 0);
  ok('general 仍含【延伸思考】（本 CR 明确保留）', c.indexOf('【延伸思考】') >= 0);
  ok('general 分段数为 3（回答/分析/延伸思考）',
    (c.match(/【[^】]+】/g) || []).length === 3,
    'got=' + JSON.stringify(c.match(/【[^】]+】/g)));
}

console.log('\n[2] emotion 意图：已移除【理解】【建议】，仅保留【分析】【思考】');
{
  const c = F.emotion.contract;
  // 2026-09-21 第二轮 CR：推翻了同日第一轮「emotion 保留【建议】」的决定，断言方向已反转。
  ok('emotion 不含【理解】（第二轮 CR 移除）', c.indexOf('【理解】') < 0);
  ok('emotion 不含【建议】（第二轮 CR 移除）', c.indexOf('【建议】') < 0);
  ok('emotion 仍含【分析】', c.indexOf('【分析】') >= 0);
  ok('emotion 仍含【思考】（按要求保留）', c.indexOf('【思考】') >= 0);
  ok('emotion 唯一分段标题数为 2（分析/思考）',
    [...new Set(c.match(/【[^】]+】/g) || [])].length === 2,
    'got=' + JSON.stringify([...new Set(c.match(/【[^】]+】/g) || [])]));
}

console.log('\n[3] philosophy 意图：【建议】可选段必须保留（本 CR 刻意的例外）');
{
  const c = F.philosophy.contract;
  ok('philosophy **仍含**【建议】可选段', c.indexOf('【建议】') >= 0);
  ok('philosophy 仍含【理解】', c.indexOf('【理解】') >= 0);
  ok('philosophy 仍含【经典观点】', c.indexOf('【经典观点】') >= 0);
  ok('philosophy 仍含【思考】', c.indexOf('【思考】') >= 0);
}

console.log('\n[4] technical 意图：始终无固定分段（不受本 CR 影响）');
{
  const c = F.technical.contract;
  ok('technical 不含【建议】', c.indexOf('【建议】') < 0);
  ok('technical 不含任何【x】分段标题', (c.match(/【[^】]+】/g) || []).length === 0,
    'got=' + JSON.stringify(c.match(/【[^】]+】/g)));
}

console.log('\n[5] outputContract 死代码已移除，生产路径改由 OUTPUT_FORMATS 决定');
{
  // 2026-09-21 第二轮 CR：outputContract 被移除。
  // 移除依据（已实测确认）：buildRolePrompt() 与 freshness/responder.js 均不消费该键。
  ok('ROLE_PROMPT 不再含 outputContract 键', !('outputContract' in rag.ROLE_PROMPT));
  const built = rag.buildRolePrompt();
  ok('buildRolePrompt() 仍正常组装（不因移除而报错）',
    typeof built === 'string' && built.length > 0);
  ok('组装文本含【分析】（证明 fmt.contract 仍接入生产路径）',
    built.indexOf('【分析】') >= 0);
}

console.log('\n[6] resolveFormat 兜底行为未被破坏');
{
  ok('resolveFormat(general) → general', rag.resolveFormat({ format: 'general' }).key === 'general');
  ok('resolveFormat(emotion) → emotion', rag.resolveFormat({ format: 'emotion' }).key === 'emotion');
  ok('未知 format → 回退 general', rag.resolveFormat({ format: '__nonexistent__' }).key === 'general');
  ok('空入参 → 回退 general', rag.resolveFormat({}).key === 'general');
}

console.log('\n[7] 「🌅 再想一层」由模板层移除，但渲染器必须完好（一行回滚的前提）');
{
  const r = reasoning.renderReasoning({
    hypotheses: ['假设A'], tensions: ['张力B'], openQuestions: ['待问C'],
  }, {});
  ok('renderReasoning 仍能正常渲染（回滚开关依赖它）', r.indexOf('🌅 再想一层') >= 0);
  ok('renderReasoning 仍输出三类前缀',
    r.indexOf('· 张力：') >= 0 && r.indexOf('· 假设：') >= 0 && r.indexOf('· 待问：') >= 0);
  ok('无内容时返回空串（原有契约不变）', reasoning.renderReasoning({}, {}) === '');
}

console.log('\n========================================');
console.log('  范围锁定契约测试  PASS: ' + pass + '   FAIL: ' + failures.length);
console.log('========================================');
if (failures.length) {
  console.log('失败项：\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('全部通过 ✓');
