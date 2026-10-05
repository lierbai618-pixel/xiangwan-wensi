// ============================================================
// think/reasoning.js
//   Phase Q2-3：问思融合引擎 — 思想层（Reasoning）。
//
//   这一层是「向晚问思」区别于普通问答的地方：不给更多答案，给更好的问题。
//
//   最高铁律（与 D-a 反幻觉硬闸同源）：
//     ★ 本模块 **只能重述、对照、追问已经存在的材料**，
//       严禁生成任何新的事实断言（人物、时间、事件、数字、因果结论）。
//     ★ 所有输出必须是「假设 / 张力 / 开放问题」三种非断言句式之一。
//     ★ 没有材料时返回空结构，渲染为空串 —— 宁可不说，不可编造。
//
//   输入材料仅两类，且都来自本次请求：
//     facts[]     请求级检索事实（think/factExtractor 产出，已过滤 mock）
//     knowledge[] RAG 只读返回的经典引用（不修改知识库）
//
//   纯函数、零模型调用、零网络、零云依赖、Node 16.13 兼容。
// ============================================================
'use strict';

var MAX_ITEMS_PER_KIND = 2;
var MAX_TOPIC_LEN = 20;

// 提问外壳词：抽取「话题」时剥掉，避免把疑问句原样塞回文案
var SHELL_RE = /^(请问|我想问一下|我想问|我想知道|想请教|你觉得|你认为|大家觉得|帮我看看|能不能说说|说说)/u;
var TAIL_RE = /(是什么|为什么|怎么看|如何看待|怎么办|该怎么做|好不好|对不对|吗|呢|啊|吧)?[?？。！!\s]*$/u;

// 抽取话题：仅做字符串裁剪，不做任何语义推断（不引入新信息）
function extractTopic(query) {
  var q = (query || '').toString().trim();
  if (!q) return '';
  q = q.replace(SHELL_RE, '').trim();
  q = q.replace(TAIL_RE, '').trim();
  q = q.replace(/^[，,、:：\s]+/, '').trim();
  if (!q) return '';
  if (q.length > MAX_TOPIC_LEN) q = q.slice(0, MAX_TOPIC_LEN) + '…';
  return q;
}

// 经典引用标题（RAG citations 形状：{ title, ... }）
function knowledgeTitles(knowledge) {
  var list = Array.isArray(knowledge) ? knowledge : [];
  var out = [];
  for (var i = 0; i < list.length && out.length < 3; i++) {
    var k = list[i];
    if (!k) continue;
    var t = (k.title || k.book || '').toString().trim();
    if (t && out.indexOf(t) < 0) out.push(t);
  }
  return out;
}

// 事实来源名（去重）
function factSources(facts) {
  var list = Array.isArray(facts) ? facts : [];
  var out = [];
  for (var i = 0; i < list.length && out.length < 3; i++) {
    var f = list[i];
    if (!f) continue;
    var s = (f.source || '').toString().trim();
    if (s && out.indexOf(s) < 0) out.push(s);
  }
  return out;
}

// ============================================================
// buildReasoning({ query, facts, knowledge, baseAnswer })
//   → {
//       topic, hypotheses[], tensions[], openQuestions[],
//       derivedOnly: true,          // 声明：全部由既有材料派生
//       sources: { factCount, knowledgeCount },
//       _ephemeral: true
//     }
// ============================================================
function buildReasoning(input) {
  input = input || {};
  var query = (input.query || '').toString();
  var facts = Array.isArray(input.facts) ? input.facts : [];
  var knowledge = Array.isArray(input.knowledge) ? input.knowledge : [];
  var topic = extractTopic(query);

  var books = knowledgeTitles(knowledge);
  var srcs = factSources(facts);

  var hypotheses = [];
  var tensions = [];
  var openQuestions = [];

  // ---------- 张力：只有「事实 × 经典」同时在场时才成立 ----------
  if (facts.length > 0 && books.length > 0) {
    tensions.push(
      '眼前的信息回答的是「发生了什么」，而《' + books[0] + '》回答的是「该怎么理解」——两者不在同一层，别用前者替后者下结论。'
    );
  } else if (facts.length > 1 && srcs.length > 1) {
    tensions.push(
      '同一件事有来自 ' + srcs.length + ' 个不同来源的说法，先确认它们是互相印证，还是只是彼此转述。'
    );
  }

  // ---------- 假设：一律用「也许 / 如果 / 假设」句式，非断言 ----------
  if (topic) {
    hypotheses.push('你真正在意的也许不是「' + topic + '」本身，而是它落到你身上时意味着什么。');
  }
  if (books.length > 0) {
    hypotheses.push('如果换《' + books[0] + '》的框架来看，重点可能会从「怎么办」移到「你正处在什么位置」。');
  } else if (facts.length > 0) {
    hypotheses.push('已知信息只覆盖了表层，判断之前，先问一句：这些话是谁在说、为什么这样说。');
  }

  // ---------- 开放问题：追问，不回答 ----------
  openQuestions.push('这个判断建立在哪些你还没验证过的前提上？');
  if (facts.length > 0) {
    openQuestions.push('以上信息里，哪些是可核实的事实，哪些只是叙述者的解读？');
  } else if (topic) {
    openQuestions.push('如果「' + topic + '」的答案和你预期相反，你会改变什么？');
  }

  return {
    topic: topic,
    hypotheses: hypotheses.slice(0, MAX_ITEMS_PER_KIND),
    tensions: tensions.slice(0, MAX_ITEMS_PER_KIND),
    openQuestions: openQuestions.slice(0, MAX_ITEMS_PER_KIND),
    derivedOnly: true,
    sources: { factCount: facts.length, knowledgeCount: knowledge.length },
    _ephemeral: true,
  };
}

// 是否有可渲染内容
function hasContent(reasoning) {
  if (!reasoning) return false;
  var n = (reasoning.hypotheses || []).length
    + (reasoning.tensions || []).length
    + (reasoning.openQuestions || []).length;
  return n > 0;
}

// ============================================================
// renderReasoning(reasoning, opts) → string
//   无内容返回空串（调用方据此决定「不追加」→ 回答与原链路完全一致）。
//   opts: { title }
// ============================================================
function renderReasoning(reasoning, opts) {
  opts = opts || {};
  if (!hasContent(reasoning)) return '';
  var title = opts.title || '🌅 再想一层';
  var lines = ['', '', title];

  var i;
  for (i = 0; i < (reasoning.tensions || []).length; i++) {
    lines.push('· 张力：' + reasoning.tensions[i]);
  }
  for (i = 0; i < (reasoning.hypotheses || []).length; i++) {
    lines.push('· 假设：' + reasoning.hypotheses[i]);
  }
  for (i = 0; i < (reasoning.openQuestions || []).length; i++) {
    lines.push('· 待问：' + reasoning.openQuestions[i]);
  }
  return lines.join('\n');
}

module.exports = {
  buildReasoning: buildReasoning,
  renderReasoning: renderReasoning,
  hasContent: hasContent,
  extractTopic: extractTopic,
  knowledgeTitles: knowledgeTitles,
  factSources: factSources,
};
