'use strict';
// Phase Q2-16：百炼合成底座回归测试
//   验证：百炼 OpenAI 兼容模式仅返回模型综合文字(无结构化 search_results)时，
//   搜索退化为「合成事实底座(UNVERIFIED)」且能正确流入 fact→context→responder，
//   不触发降级、反幻觉与免责声明约束照常生效。
var path = require('path');
var ROOT = path.resolve(__dirname, '../cloudfunctions/chat');
var qwenSearch = require(path.join(ROOT, 'providers/search/qwenSearch'));
var extractor = require(path.join(ROOT, 'freshness/factExtractor'));
var contextBuilder = require(path.join(ROOT, 'freshness/contextBuilder'));
var responder = require(path.join(ROOT, 'freshness/responder'));
var S = require(path.join(ROOT, 'freshness/schema'));

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗ FAIL: ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

// ---- 假 fetch：返回百炼 OpenAI 兼容风格响应（只有 message.content，无 search_results）----
var BAILIAN_SYNTH = {
  choices: [{ message: { content: '付航是中国内地脱口秀演员，大专学历，做过保安、服务员、电话客服。1994年出生于北京，2018年进入脱口秀行业。', role: 'assistant' } }]
};
function fakeFetch(data) {
  return function () {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(data); } });
  };
}
var mc = { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'sk-test', model: 'deepseek-v4-flash-0731' };

console.log('==== Q2-16 单元 ====');
qwenSearch.search('付航是谁', { searchModelConfig: mc }, fakeFetch(BAILIAN_SYNTH)).then(function (res) {
  ok(res.ok === true, '搜索对「仅综合文字」响应 ok=true');
  ok(res.reason === 'synth_content', 'reason=synth_content');
  ok(res.synthesized === true, '返回 synthesized=true 标记');
  ok(res.results && res.results.length === 1, '返回 1 条合成结果');
  ok(res.results[0] && res.results[0].synthesized === true, '结果项带 synthesized 标记');
  ok(res.results[0] && /大专学历/.test(res.results[0].snippet || ''), '合成内容含真实学历线索(大专学历)');

  console.log('==== factExtractor ====');
  var ex = extractor.extractFacts(res.results);
  ok(ex.hasSynthesized === true, 'extractor 识别合成底座 hasSynthesized');
  ok(ex.sourceConfidence === S.SOURCE_CONFIDENCE.LOW, '合成底座置信=LOW');
  ok(ex.factSummary && ex.factSummary.length > 0, '合成内容被抽为事实句(不空)');
  ok(ex.factSummary[0] && /大专学历/.test(ex.factSummary[0].text), '事实句含「大专学历」');
  ok(ex.factSummary[0] && ex.factSummary[0].synthesized === true, '事实句带 synthesized 标记');
  var nonSynth = extractor.extractFacts([{ title: '普通新闻', url: 'https://a.com/1', snippet: '这是一条普通新闻事实。', source: 'a' }]);
  ok(nonSynth.hasSynthesized === false, '普通结果 hasSynthesized=false');

  console.log('==== contextBuilder ====');
  var bc = { level: S.SENSITIVITY.NORMAL };
  var ec = contextBuilder.buildEventContext({ eventMention: '付航', boundary: bc, extraction: ex, results: res.results });
  ok(!!ec, 'eventContext 构建成功(未降级)');
  ok(ec.status === S.EVENT_STATUS.UNVERIFIED, 'status=UNVERIFIED(合成底座不可核实)');
  ok(ec.synthesized === true, 'eventContext 带 synthesized 标记');
  ok(!!ec.synthesized_text && /大专学历/.test(ec.synthesized_text), 'synthesized_text 携带联网综合文本(含大专学历)');
  ok((ec.fact_summary || []).length === 0, 'UNVERIFIED 不破 schema 铁律：fact_summary 为空');

  console.log('==== responder ====');
  var guardrails = responder.buildFreshnessGuardrails(ec, S.USER_INTENT.REFLECTION, 'B');
  ok(/联网综合内容/.test(guardrails), '护栏含「联网综合内容」说明');
  var uc = responder.buildFreshnessUserContent('付航是谁', ec, S.USER_INTENT.REFLECTION, 'B');
  ok(/模型联网综合（未经独立核实/.test(uc), '用户内容事实底座标注「未经独立核实」');
  ok(/大专学历/.test(uc), '用户内容呈现联网综合文本(含大专学历)');

  var okAnswer = '付航是大专学历，做过保安、服务员。（网络综合，未经核实；具体履历目前公开信息还无法完全确认）';
  var g1 = responder.guardOutput(okAnswer, ec);
  ok(g1.ok === true, '含免责声明+未知承认的合成回答通过(guard ok)');
  ok(g1.violations.indexOf('missing-synth-disclaimer') < 0, '含免责声明不报 missing-synth-disclaimer');
  ok(g1.violations.indexOf('missing-unknown-acknowledgement') < 0, '含未知承认不报 missing-unknown-ack');
  ok(g1.violations.filter(function (v) { return v.indexOf('biography-') === 0; }).length === 0, '合成底座不触发 biography-* 硬拒');

  var noDisclaimer = '付航1994年出生于北京，毕业于某院校，是大专学历。';
  var g2 = responder.guardOutput(noDisclaimer, ec);
  ok(g2.ok === false, '无免责声明的合成回答被拦(guard not ok)');
  ok(g2.violations.indexOf('missing-synth-disclaimer') >= 0, '无免责声明报 missing-synth-disclaimer');

  console.log('\n==== Q2-16 结果 ====');
  console.log('PASS=' + pass + '  FAIL=' + fail);
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.error('异常:', e && e.stack || e);
  process.exit(1);
});
