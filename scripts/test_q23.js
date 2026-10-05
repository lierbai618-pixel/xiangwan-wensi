// ============================================================
// scripts/test_q23.js
//   Phase Q2-3 问思融合引擎验证套件（离线，零部署、零外网、零 KB 写入）。
//
//   全部依赖注入：generateAnswer / searchFn 均为 fake，
//   不加载 wx-server-sdk、不发起任何网络请求、不触碰知识库。
//
//   覆盖：
//     1. think/factExtractor  事实抽取 + mock 硬拦 + 无 URL 丢弃 + 置信
//     2. think/reasoning      纯派生思想层（零新事实断言）
//     3. think/citation       统一引用 + mock 不可见 + 去重
//     4. thinkEngine.searchGate  三重搜索准入闸
//     5. 三模式真实行为分流    fast=search / deep=RAG / think=search+RAG+reasoning
//     6. 反幻觉闸复用          复用 freshness.detectFabrication，闸不可用则不增强
//     7. 数据隔离              Search Context 不出请求、corpus SHA 不变、出参无 [MOCK]
//     8. 优先级与兼容          Capability→Freshness→think→RAG 派发序、旧 mode 透传
//     9. 冻结四资产 SHA 4/4
// ============================================================
'use strict';

var path = require('path');
var fs = require('fs');
var crypto = require('crypto');

var ROOT = process.cwd();
var CHAT = path.join(ROOT, 'cloudfunctions', 'chat');

var pass = 0, fail = 0;
var failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name + (extra ? ' :: ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' :: ' + extra : '')); }
}
function sha256File(p) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
  catch (e) { return 'READ_ERROR:' + (e && e.message); }
}

// 干净的测试环境：确保不受外部 env 影响
delete process.env.FRESHNESS_FACTUAL_ENABLED;
delete process.env.THINK_ALLOW_MOCK_FACTS;
delete process.env.THINK_REASONING_ENABLED;
process.env.SEARCH_PROVIDER = 'mock';

// ---------- 模块加载 ----------
var factExtractor, reasoning, citation, thinkEngine, answerModeMod;
try {
  factExtractor = require(path.join(CHAT, 'think', 'factExtractor'));
  reasoning = require(path.join(CHAT, 'think', 'reasoning'));
  citation = require(path.join(CHAT, 'think', 'citation'));
  thinkEngine = require(path.join(CHAT, 'think', 'thinkEngine'));
  answerModeMod = require(path.join(CHAT, 'answerMode'));
  console.log('[load] think/ 四模块全部加载成功');
} catch (e) {
  console.error('[load] 模块加载失败：', e && e.stack);
  process.exit(2);
}

// ---------- 测试替身 ----------
var REAL_RESULTS = [
  {
    title: '某市发布新版轨道交通规划',
    url: 'https://news.example.com/a',
    snippet: '该规划文件已在市政府门户网站公开，覆盖未来五年的线路布局与建设时序。',
    source: 'example-news',
    time: '2026-08-01',
  },
  {
    title: '规划文件要点整理',
    url: 'https://gov.example.cn/b',
    snippet: '文件共列出十二条具体条款，包含建设时序与投资安排两大部分。',
    source: 'gov-portal',
    time: '2026-08-02',
  },
];
var MOCK_RESULTS = [
  {
    title: '[MOCK] 关于「测试」的公开信息摘要',
    url: 'https://mock.local/result?q=x',
    snippet: '[MOCK] 这是用于联调的占位事实摘要。',
    source: 'mock.local',
    time: '2026-08-06',
  },
];

function fakeSearch(results, okFlag) {
  return function () {
    return Promise.resolve({
      ok: okFlag !== false,
      provider: 'fake',
      results: results || [],
      reason: okFlag === false ? 'forced_fail' : '',
      cached: false,
    });
  };
}

var RAG_ANSWER = '这是一段足够长的经典解释性回答，用来模拟 RAG 正常产出的五段式内容，'
  + '它先承接情绪，再引一句经典，最后落回你自己的处境，长度明显超过四十个字符。';

function fakeRag(recorder, overrides) {
  return function (query, opts) {
    recorder.calls.push({ query: query, mode: opts && opts.mode, models: (opts && opts.models) || [] });
    var base = {
      mode: 'model',
      answer: RAG_ANSWER,
      citations: [{ title: '论语·学而', summary: '学而时习之' }, { title: '庄子·逍遥游', summary: '北冥有鱼' }],
      route: { dimensions: [], books: [], core: '' },
      retrieval: { queryTerms: [], totalDocuments: 10, minScore: 1 },
      intent: { crisis: false },
      _modelUsed: 'fake-model', _modelStatus: 'ok', _modelError: '',
    };
    return Promise.resolve(Object.assign(base, overrides || {}));
  };
}

// ============================================================
console.log('\n[1] think/factExtractor 事实抽取层');
// ============================================================
var ex1 = factExtractor.extractFacts(REAL_RESULTS, {});
ok('真实结果：抽出 2 条事实', ex1.facts.length === 2, 'len=' + ex1.facts.length);
ok('真实结果：独立来源数=2', ex1.sourceCount === 2, 'n=' + ex1.sourceCount);
ok('真实结果：置信 high（多源无不确定标记）', ex1.facts[0].confidence === 'high', ex1.facts[0].confidence);
ok('输出带 _ephemeral=true（禁入 KB 标记）', ex1._ephemeral === true);

var exMock = factExtractor.extractFacts(MOCK_RESULTS, {});
ok('mock 结果：isMockResult 识别成功', factExtractor.isMockResult(MOCK_RESULTS[0]) === true);
ok('mock 结果：hasMock=true', exMock.hasMock === true);
ok('mock 结果：filterUsable 默认硬拦（可用数=0）',
  factExtractor.filterUsable(exMock.facts, {}).length === 0);
ok('mock 结果：allowMock=true 时才放行',
  factExtractor.filterUsable(exMock.facts, { allowMock: true }).length === 1);

var exNoUrl = factExtractor.extractFacts([{ title: 't', snippet: '一段没有来源链接的描述文字。', source: 's' }], {});
ok('无 URL 条目被丢弃（不可核实即删除）', exNoUrl.facts.length === 0 && exNoUrl.droppedNoUrl === 1);

var exDup = factExtractor.extractFacts([REAL_RESULTS[0], REAL_RESULTS[0]], {});
ok('重复 statement 去重', exDup.facts.length === 1, 'len=' + exDup.facts.length);

var exUnc = factExtractor.extractFacts([
  { title: 'a', url: 'https://x.com/1', snippet: '网传该项目可能会推迟，具体时间尚未公布。', source: 'x' },
  { title: 'b', url: 'https://y.com/2', snippet: '另一份材料给出了不同的时间口径说明文本内容。', source: 'y' },
], {});
ok('含不确定性标记 → 该条置信降为 low', exUnc.facts[0].confidence === 'low', exUnc.facts[0].confidence);
ok('aggregateConfidence 空集 → none', factExtractor.aggregateConfidence([]) === 'none');
var eph = factExtractor.toEphemeralFacts(ex1.facts);
ok('toEphemeralFacts 每条带 _ephemeral', eph.length === 2 && eph[0]._ephemeral === true);

// ============================================================
console.log('\n[2] think/reasoning 思想层（纯派生，零新事实）');
// ============================================================
ok('extractTopic 剥壳：疑问句 → 话题', reasoning.extractTopic('你觉得努力有意义吗？') === '努力有意义',
  'got=' + reasoning.extractTopic('你觉得努力有意义吗？'));
ok('extractTopic 空输入 → 空串', reasoning.extractTopic('') === '');

var r0 = reasoning.buildReasoning({ query: '努力有意义吗？', facts: [], knowledge: [] });
ok('无材料：仍给出至少一个开放问题（不空转）', r0.openQuestions.length >= 1);
ok('无材料：无张力（张力需两类材料同时在场）', r0.tensions.length === 0);
ok('derivedOnly=true 声明', r0.derivedOnly === true);

var rK = reasoning.buildReasoning({
  query: '努力有意义吗？', facts: [],
  knowledge: [{ title: '论语·学而' }, { title: '庄子·逍遥游' }],
});
ok('仅经典：假设引用经典标题', rK.hypotheses.join('').indexOf('论语·学而') >= 0);

var rFK = reasoning.buildReasoning({
  query: '这次规划怎么看？',
  facts: factExtractor.filterUsable(ex1.facts, {}),
  knowledge: [{ title: '论语·学而' }],
});
ok('事实×经典：产生张力条目', rFK.tensions.length === 1, 'n=' + rFK.tensions.length);
ok('事实在场：开放问题追问「事实 vs 解读」',
  rFK.openQuestions.join('').indexOf('可核实的事实') >= 0);

var blockEmpty = reasoning.renderReasoning({ hypotheses: [], tensions: [], openQuestions: [] }, {});
ok('无内容 → renderReasoning 返回空串（调用方不追加）', blockEmpty === '');
var blockFull = reasoning.renderReasoning(rFK, {});
ok('有内容 → 渲染含标题与三类前缀', blockFull.indexOf('🌅 再想一层') >= 0 && blockFull.indexOf('· 张力：') >= 0);
ok('思想层全部为非断言句式（无「已」「于…发布」式事实断言）',
  !/(\d{4})年.{0,14}(发布|出演|上映|官宣)/.test(blockFull));

// ============================================================
console.log('\n[3] think/citation 引用层');
// ============================================================
var usableReal = factExtractor.filterUsable(ex1.facts, {});
var fc = citation.buildFactCitations(usableReal, {});
ok('事实引用：2 条，type=fact', fc.length === 2 && fc[0].type === 'fact');
var fcMock = citation.buildFactCitations(exMock.facts, {});
ok('mock 引用默认不输出（用户永不可见 [MOCK]）', fcMock.length === 0);
ok('mock 引用 allowMock=true 才输出',
  citation.buildFactCitations(exMock.facts, { allowMock: true }).length === 1);
var cc = citation.buildClassicCitations([{ title: '论语·学而' }, { title: '论语·学而' }], {});
ok('经典引用去重', cc.length === 1 && cc[0].type === 'classic');
var uni = citation.buildUnified({ facts: usableReal, ragCitations: [{ title: '论语·学而' }] });
ok('统一引用：事实在前、经典在后', uni.length === 3 && uni[0].type === 'fact' && uni[2].type === 'classic');
ok('renderFactCitations 仅渲染 fact', citation.renderFactCitations(uni, {}).indexOf('论语·学而') < 0);
ok('renderFactCitations 纯经典 → 空串', citation.renderFactCitations(cc, {}) === '');
var cmeta = citation.toSafeMeta(uni);
ok('toSafeMeta 只含计数', cmeta.total === 3 && cmeta.fact === 2 && cmeta.classic === 1);

// ============================================================
console.log('\n[4] thinkEngine.searchGate 三重搜索准入闸');
// ============================================================
var g1 = thinkEngine.searchGate({ factualEnabled: false, searchProvider: 'bing' });
ok('总闸关（factualEnabled=false）→ 拒绝', g1.allowed === false && g1.reason === 'factual_disabled');
var g2 = thinkEngine.searchGate({ factualEnabled: true, searchProvider: 'none' });
ok('provider=none → 拒绝', g2.allowed === false && g2.reason === 'no_provider');
var g3 = thinkEngine.searchGate({ factualEnabled: true, searchProvider: 'mock' });
ok('provider=mock 且未开测试开关 → 拒绝（mock 永不服务真实用户）',
  g3.allowed === false && g3.reason === 'mock_blocked');
var g4 = thinkEngine.searchGate({ factualEnabled: true, searchProvider: 'mock', allowMockFacts: true });
ok('provider=mock + 显式测试开关 → 放行', g4.allowed === true);
var g5 = thinkEngine.searchGate({ factualEnabled: true, searchProvider: 'bing' });
ok('总闸开 + 真实源 → 放行', g5.allowed === true);
var g6 = thinkEngine.searchGate({});
ok('默认（无 opts）→ 拒绝（当前生产配置）', g6.allowed === false && g6.reason === 'factual_disabled');

// ============================================================
console.log('\n[5] 反幻觉闸复用（freshness.detectFabrication）');
// ============================================================
var freshnessMod = null;
try { freshnessMod = require(path.join(CHAT, 'freshness')); } catch (e) { freshnessMod = null; }
ok('freshness.detectFabrication 可复用（同一份真相，无第二份正则）',
  !!(freshnessMod && typeof freshnessMod.detectFabrication === 'function'));
ok('闸能拦下虚构事实签名',
  thinkEngine.passesFabricationGate('他在2026年出演了一部新电影。') === false);
ok('闸放行思想层派生文本', thinkEngine.passesFabricationGate(blockFull) === true);
ok('闸放行空文本', thinkEngine.passesFabricationGate('') === true);

// ============================================================
// [6] 三模式真实行为分流（异步）
// ============================================================
function runModeTests() {
  console.log('\n[6] 三模式真实行为分流');
  var corpusPath = path.join(CHAT, 'corpus.json');
  var corpusBefore = sha256File(corpusPath);
  var rec = { calls: [] };

  // 6.1 deep = RAG：直接 return null，交回原链路（逐字节零改动）
  return thinkEngine.run('努力有意义吗？', {
    answerMode: 'deep', mode: 'plain', generateAnswer: fakeRag(rec),
  }).then(function (res) {
    ok('deep → 返回 null（原 generateAnswer 链路，零改动）', res === null);
    ok('deep → 引擎内未调用 RAG（无二次生成）', rec.calls.length === 0, 'calls=' + rec.calls.length);

    // 6.2 fast 无可用事实（当前生产配置）→ null 回退
    return thinkEngine.run('努力有意义吗？', { answerMode: 'fast', generateAnswer: fakeRag(rec) });
  }).then(function (res) {
    ok('fast + 搜索被闸拦 → 返回 null（回退原链路）', res === null);

    // 6.3 fast 有可用事实 → 事实摘要 + 来源
    return thinkEngine.run('这次规划怎么看？', {
      answerMode: 'fast', factualEnabled: true, searchProvider: 'bing',
      searchFn: fakeSearch(REAL_RESULTS), generateAnswer: fakeRag(rec),
    });
  }).then(function (res) {
    ok('fast + 有事实 → 接管，mode=think-fast', !!res && res.mode === 'think-fast', res && res.mode);
    ok('fast → answer 含来源署名', !!res && res.answer.indexOf('example-news') >= 0);
    ok('fast → 未走 RAG（citations 为空、无经典引用）', !!res && res.citations.length === 0);
    ok('fast → think.pipeline=search', !!res && res.think.pipeline === 'search', res && res.think.pipeline);
    ok('fast → think.citations 全为 fact 类型',
      !!res && res.think.citations.length === 2 && res.think.citations[0].type === 'fact');

    // 6.4 think 默认配置（无事实源）→ RAG 打底 + 思想层
    var rec2 = { calls: [] };
    return thinkEngine.run('努力有意义吗？', {
      answerMode: 'think', mode: 'plain', generateAnswer: fakeRag(rec2),
    }).then(function (r) { return { res: r, rec: rec2 }; });
  }).then(function (o) {
    var res = o.res;
    ok('think → 接管并返回结果', !!res && !!res.answer);
    ok('think → RAG 只调用一次（无重复生成）', o.rec.calls.length === 1, 'calls=' + o.rec.calls.length);
    ok('think → 保留 RAG 原文前缀（只增不改）', !!res && res.answer.indexOf(RAG_ANSWER) === 0);
    // 2026-09-21 CR-删除答案段落：产品决定不再输出「🌅 再想一层」推理块（与【延伸思考】功能重复）。
    //   断言方向由「必须出现」改为「必须不出现」。
    ok('think → 不再追加思想层（CR-20260921 起）', !!res && res.answer.indexOf('🌅 再想一层') < 0);
    ok('think → 无事实源时不出现「参考来源」', !!res && res.answer.indexOf('参考来源') < 0);
    // ⚠️ 行为变化：本用例无事实源，过去靠「再想一层」模板块撑起 augmentation；
    //    该块移除后 addition 为空 → 走 no_material 分支 → augmented=false。
    //    这是移除推理块的必然结果（非缺陷），但 think.augmented / skipReason 属观测字段，故显式断言。
    ok('think → 无可追加内容 → augmented=false 且 skipReason=no_material',
      !!res && res.think.augmented === false && res.think.skipReason === 'no_material');
    ok('think → pipeline=search+rag', !!res && res.think.pipeline === 'search+rag');
    ok('think → searchAllowed=false 且原因为 factual_disabled',
      !!res && res.think.searchAllowed === false && res.think.searchReason === 'factual_disabled');
    ok('think → 经典引用 citations 未被污染（仍是 RAG 的 2 条）',
      !!res && res.citations.length === 2 && res.citations[0].title === '论语·学而');

    // 6.5 think + 事实源 → 参考来源（思想层已于 CR-20260921 移除）
    var rec3 = { calls: [] };
    return thinkEngine.run('这次规划怎么看？', {
      answerMode: 'think', factualEnabled: true, searchProvider: 'bing',
      searchFn: fakeSearch(REAL_RESULTS), generateAnswer: fakeRag(rec3),
    });
  }).then(function (res) {
    ok('think + 事实 → 仅含参考来源，不含思想层（CR-20260921 起）',
      !!res && res.answer.indexOf('🌅 再想一层') < 0 && res.answer.indexOf('参考来源') > 0);
    ok('think + 事实 → 融合引用含 fact 与 classic',
      !!res && res.think.citationMeta.fact === 2 && res.think.citationMeta.classic === 2);
    ok('think + 事实 → context 仅脱敏元信息（无 snippet 内容）',
      !!res && res.think.context && ('facts_count' in res.think.context) && !('facts' in res.think.context));
    ok('think + 事实 → context._ephemeral=true', !!res && res.think.context._ephemeral === true);

    // 6.6 默认 answerMode（未指定）→ think
    var rec4 = { calls: [] };
    return thinkEngine.run('努力有意义吗？', { generateAnswer: fakeRag(rec4) });
  }).then(function (res) {
    ok('未指定 answerMode → 默认走 think', !!res && res.think.answerMode === 'think' && res.think.isDefaultMode === true);
    return runGuardTests(corpusBefore, corpusPath);
  }).catch(function (e) {
    ok('三模式分流流程未抛异常', false, (e && e.stack) || '' + e);
    return runGuardTests(corpusBefore, corpusPath);
  });
}

// ============================================================
// [7] 增强抑制闸 + 旧 mode 兼容 + 数据隔离
// ============================================================
function runGuardTests(corpusBefore, corpusPath) {
  console.log('\n[7] 增强抑制闸 / 旧 mode 兼容 / 数据隔离');

  var recCrisis = { calls: [] };
  return thinkEngine.run('我很难受', {
    answerMode: 'think',
    generateAnswer: fakeRag(recCrisis, { intent: { crisis: true } }),
  }).then(function (res) {
    ok('危机回答 → 不追加思想层（skipReason=crisis）',
      !!res && res.think.skipReason === 'crisis' && res.answer === RAG_ANSWER);

    var recSkip = { calls: [] };
    return thinkEngine.run('你好', {
      answerMode: 'think',
      generateAnswer: fakeRag(recSkip, { retrieval: { skipped: true } }),
    });
  }).then(function (res) {
    ok('意图层判定 skip（寒暄）→ 不追加（skipReason=knowledge_skipped）',
      !!res && res.think.skipReason === 'knowledge_skipped' && res.answer === RAG_ANSWER);

    var recShort = { calls: [] };
    return thinkEngine.run('嗯', {
      answerMode: 'think', generateAnswer: fakeRag(recShort, { answer: '好的。' }),
    });
  }).then(function (res) {
    ok('过短回答 → 不追加（skipReason=short_answer）',
      !!res && res.think.skipReason === 'short_answer' && res.answer === '好的。');

    var recOff = { calls: [] };
    return thinkEngine.run('努力有意义吗？', {
      answerMode: 'think', reasoningEnabled: false, generateAnswer: fakeRag(recOff),
    });
  }).then(function (res) {
    ok('THINK_REASONING_ENABLED=false → 不追加（skipReason=reasoning_disabled）',
      !!res && res.think.skipReason === 'reasoning_disabled' && res.answer === RAG_ANSWER);

    // 旧 mode 字段兼容：classic 必须原样透传给 RAG
    var recLegacy = { calls: [] };
    return thinkEngine.run('努力有意义吗？', {
      answerMode: 'think', mode: 'classic', generateAnswer: fakeRag(recLegacy),
    }).then(function (r) { return { res: r, rec: recLegacy }; });
  }).then(function (o) {
    ok('旧 mode 字段原样透传给 RAG（mode=classic）',
      o.rec.calls.length === 1 && o.rec.calls[0].mode === 'classic', 'got=' + (o.rec.calls[0] || {}).mode);
    ok('旧 mode 在 think 元信息中留痕（legacyMode=classic）', o.res.think.legacyMode === 'classic');

    // mock 事实绝不进入用户可见文本
    var recMock = { calls: [] };
    return thinkEngine.run('测试问题怎么看？', {
      answerMode: 'think', factualEnabled: true, searchProvider: 'bing',
      searchFn: fakeSearch(MOCK_RESULTS), generateAnswer: fakeRag(recMock),
    });
  }).then(function (res) {
    ok('mock 检索结果 → 用户可见文本无 [MOCK]', !!res && res.answer.indexOf('[MOCK]') < 0);
    ok('mock 检索结果 → 无「参考来源」块（可用事实为 0）', !!res && res.answer.indexOf('参考来源') < 0);
    ok('mock 被计入 mockFiltered', !!res && res.think.mockFiltered === 1, 'n=' + (res && res.think.mockFiltered));
    ok('整个结果 JSON 序列化后不含 mock 内容',
      JSON.stringify(res).indexOf('[MOCK]') < 0 && JSON.stringify(res).indexOf('mock.local') < 0);

    // 数据隔离：corpus 未被污染
    var after = sha256File(corpusPath);
    ok('corpus.json SHA 在全部融合流程后不变（Search Context 未入 KB）',
      corpusBefore === after, 'before=' + corpusBefore.slice(0, 12) + ' after=' + after.slice(0, 12));
    return runStaticChecks();
  }).catch(function (e) {
    ok('增强抑制/隔离流程未抛异常', false, (e && e.stack) || '' + e);
    return runStaticChecks();
  });
}

// ============================================================
// [8] 静态检查：派发优先级 + 冻结资产
// ============================================================
function runStaticChecks() {
  console.log('\n[8] 派发优先级与冻结资产');
  var src = '';
  try { src = fs.readFileSync(path.join(CHAT, 'index.js'), 'utf8'); } catch (e) { src = ''; }

  var iCap = src.indexOf('capabilityMaybeHandle(message');
  var iFresh = src.indexOf('freshnessMaybeHandle(message');
  var iThink = src.indexOf('thinkEngineRun(message');
  var iRag = src.indexOf('generateAnswer(message');
  ok('派发序 Capability → Freshness → think → RAG',
    iCap > 0 && iFresh > iCap && iThink > iFresh && iRag > iThink,
    'cap=' + iCap + ' fresh=' + iFresh + ' think=' + iThink + ' rag=' + iRag);
  ok('thinkEngine 有一键熔断开关 THINK_ENGINE_ENABLED', src.indexOf('THINK_ENGINE_ENABLED') > 0);
  ok('thinkEngine 调用被 try/catch 包住（fail-soft）',
    src.indexOf('[think] 执行异常，回退原链路') > 0);
  ok('index.js 向 thinkEngine 注入 generateAnswer（不自行 require 冻结资产）',
    src.indexOf('generateAnswer: generateAnswer') > 0);

  console.log('\n[9] 冻结四资产 SHA 4/4 MATCH');
  var expected = {
    'corpus.json': '068fa1fa052ec7b93a9d60008c26b29c425c40f0ab724ab33483dbd1001459ae',
    'intent.js': '765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38',
    'knowledgeRouter.js': '848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935',
    'rag.js': '90c9cc5fe1d9f30837f63a9a67d512e6d08262ef19e125ddd7bebf8ee0890698',
  };
  var allMatch = true;
  Object.keys(expected).forEach(function (f) {
    var h = sha256File(path.join(CHAT, f));
    var m = h === expected[f];
    if (!m) allMatch = false;
    ok('冻结资产 ' + f + ' SHA 一致', m, 'got=' + h.slice(0, 16));
  });
  ok('冻结四资产全部 MATCH', allMatch);

  finish();
}

function finish() {
  console.log('\n========================================');
  console.log('  PASS: ' + pass + '   FAIL: ' + fail);
  console.log('========================================');
  if (fail > 0) {
    console.log('失败项：\n - ' + failures.join('\n - '));
    process.exit(1);
  } else {
    console.log('全部通过 ✓');
    process.exit(0);
  }
}

runModeTests();
