// ============================================================
// scripts/test_q21b.js
//   Phase Q2-1-B 工程化骨架验证套件（离线，零部署、零外网、零 KB 写入）。
//
//   覆盖：
//     1. Search Provider 抽象层（统一形状 / mock / 真实源无密钥降级 / 缓存 / normalize）
//     2. answerMode 路由（fast/deep/think/默认/非法）
//     3. ThinkContext 生命周期与 ephemeral 标记（请求级，禁入 KB）
//     4. 数据隔离：corpus.json SHA 在跑完检索管线前后不变
//     5. 冻结四资产 SHA 4/4 MATCH
//     6. 默认行为零回归：factualEnabled=false 时 B 类仍走反思、不联网
//     7. 激活布线证明：factualEnabled=true + mock 时事实分支确实调用 searchLayer
// ============================================================
'use strict';

var path = require('path');
var fs = require('fs');
var crypto = require('crypto');

var CHAT = path.join(process.cwd(), 'cloudfunctions', 'chat');

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

// ---------- 模块加载（语法/依赖冒烟） ----------
var searchLayer, answerMode, thinkContext, freshness;
try {
  searchLayer = require(path.join(CHAT, 'providers', 'search'));
  answerMode = require(path.join(CHAT, 'answerMode'));
  thinkContext = require(path.join(CHAT, 'thinkContext'));
  freshness = require(path.join(CHAT, 'freshness'));
  console.log('[load] 新模块全部加载成功');
} catch (e) {
  console.error('[load] 模块加载失败：', e && e.stack);
  process.exit(2);
}

// ---------- 1. Search Provider 抽象层 ----------
console.log('\n[1] Search Provider 抽象层');

// 1.1 mock 默认返回统一形状
process.env.SEARCH_PROVIDER = 'mock';
searchLayer._resetCache();
var r1 = null;
searchLayer.search('付航最近怎么样', {}).then(function (res) {
  r1 = res;
  ok('mock: ok=true', res.ok === true, JSON.stringify(res).slice(0, 80));
  ok('mock: results.length=2', res.results.length === 2, 'len=' + res.results.length);
  ok('mock: 单条含 title/url/snippet/source/time', res.results.every(function (x) {
    return x.title && x.url && x.snippet && x.source && ('time' in x);
  }));
  ok('mock: url 可解析', res.results.every(function (x) {
    try { new URL(x.url); return true; } catch (e) { return false; }
  }));
  ok('mock: 标记 [MOCK] 非真实源', res.results.every(function (x) { return /\[MOCK\]/.test(x.title + x.snippet); }));

  // 1.2 缓存：第二次命中 cached=true
  return searchLayer.search('付航最近怎么样', {});
}).then(function (res2) {
  ok('cache: 第二次命中 cached=true', res2.cached === true, 'cached=' + res2.cached);

  // 1.3 normalizeResult
  var n = searchLayer.normalizeResult({ title: 't', snippet: 's', url: 'u', source: 'src', time: '2026' });
  ok('normalizeResult: 有效条目归一化', n && n.title === 't' && n.snippet === 's');
  ok('normalizeResult: 无 snippet → null', searchLayer.normalizeResult({ title: 't' }) === null);

  // 1.4 真实源无密钥 → ok:false
  process.env.SEARCH_PROVIDER = 'bing';
  return searchLayer.search('OpenAI 最近', {});
}).then(function (resB) {
  ok('bing(无密钥): ok=false reason=no_api_key', resB.ok === false && resB.reason === 'no_api_key', JSON.stringify(resB).slice(0, 60));

  process.env.SEARCH_PROVIDER = 'tavily';
  return searchLayer.search('OpenAI 最近', {});
}).then(function (resT) {
  ok('tavily(无密钥): ok=false reason=no_api_key', resT.ok === false && resT.reason === 'no_api_key', JSON.stringify(resT).slice(0, 60));

  process.env.SEARCH_PROVIDER = 'serp';
  return searchLayer.search('OpenAI 最近', {});
}).then(function (resS) {
  ok('serp(无密钥): ok=false reason=no_api_key', resS.ok === false && resS.reason === 'no_api_key', JSON.stringify(resS).slice(0, 60));

  // 1.5 none → no_provider
  process.env.SEARCH_PROVIDER = 'none';
  return searchLayer.search('任何', {});
}).then(function (resN) {
  ok('none: ok=false reason=no_provider', resN.ok === false && resN.reason === 'no_provider', JSON.stringify(resN).slice(0, 60));
  return runAnswerModeAndThink();
}).catch(function (e) {
  ok('Search Provider 流程未抛异常', false, (e && e.stack) || '' + e);
  return runAnswerModeAndThink();
});

function runAnswerModeAndThink() {
  // ---------- 2. answerMode 路由 ----------
  console.log('\n[2] answerMode 路由');
  var aFast = answerMode.resolve('fast');
  ok('fast → useSearch=true,useRAG=false,pipeline=search', aFast.useSearch === true && aFast.useRAG === false && aFast.pipeline === 'search');
  var aDeep = answerMode.resolve('deep');
  ok('deep → useSearch=false,useRAG=true,pipeline=rag', aDeep.useSearch === false && aDeep.useRAG === true && aDeep.pipeline === 'rag');
  var aThink = answerMode.resolve('think');
  ok('think → useSearch=true,useRAG=true,pipeline=search+rag', aThink.useSearch === true && aThink.useRAG === true && aThink.pipeline === 'search+rag');
  var aDef = answerMode.resolve(undefined);
  ok('默认(未指定) → think, isDefault=true', aDef.effectiveMode === 'think' && aDef.isDefault === true);
  var aBogus = answerMode.resolve('bogus-mode');
  ok('非法值 → 回退 think', aBogus.effectiveMode === 'think' && aBogus.isDefault === true);
  ok('normalize: 大小写容错', answerMode.normalize('FAST') === 'fast');

  // ---------- 3. ThinkContext 生命周期 + ephemeral ----------
  console.log('\n[3] ThinkContext 生命周期与 ephemeral');
  var tc = thinkContext.makeThinkContext({
    mode: 'think', query: 'AI 会不会取代程序员？',
    facts: [{ title: 'f1', snippet: 's1' }, null, { title: '', snippet: '' }],
    knowledge: [{ title: 'k1', text: 't1' }],
  });
  ok('makeThinkContext: _ephemeral=true（禁入 KB 标记）', tc._ephemeral === true);
  ok('makeThinkContext: facts 过滤有效条目', tc.facts.length === 1, 'len=' + tc.facts.length);
  ok('makeThinkContext: knowledge 过滤有效条目', tc.knowledge.length === 1, 'len=' + tc.knowledge.length);
  ok('makeThinkContext: 默认 mode=think', tc.mode === 'think');
  ok('isFresh: 初始有效', thinkContext.isFresh(tc) === true);
  // 注：makeThinkContext 对非法 ttlMs（如 -1）有防御性回退到默认 30min（正确行为），
  // 故过期测试改为确定性地把 expires_at 置为过去，验证 isFresh 判断逻辑本身。
  var tcShort = thinkContext.makeThinkContext({ mode: 'think', query: 'q' });
  tcShort.expires_at = new Date(Date.now() - 1000).toISOString();
  ok('isFresh: 过期后 false', thinkContext.isFresh(tcShort) === false);
  var meta = thinkContext.toSafeMeta(tc);
  ok('toSafeMeta: 仅含计数,无事实内容', meta && typeof meta === 'object' && ('facts_count' in meta) && !('snippet' in (meta || {})));
  ok('toSafeMeta: 保留 _ephemeral 标记', meta && meta._ephemeral === true);

  return runIsolationAndRegression();
}

function runIsolationAndRegression() {
  // ---------- 4. 数据隔离：corpus SHA 前后一致 ----------
  console.log('\n[4] 数据隔离（corpus.json 不被搜索污染）');
  var corpusPath = path.join(CHAT, 'corpus.json');
  var before = sha256File(corpusPath);

  // 跑一遍完整检索骨架（mock + answerMode + thinkContext）
  process.env.SEARCH_PROVIDER = 'mock';
  searchLayer._resetCache();
  return searchLayer.search('某演员最近有什么作品', {}).then(function (res) {
    var am = answerMode.resolve('think');
    var ctx = thinkContext.makeThinkContext({ mode: am.effectiveMode, query: '某演员最近有什么作品', facts: res.results });
    // 即便把 facts 灌进 ThinkContext，也不应触碰 corpus 文件
    void ctx;
    var after = sha256File(corpusPath);
    ok('corpus.json SHA 检索前后一致', before === after, 'before=' + before.slice(0, 12) + ' after=' + after.slice(0, 12));
    return runFrozenCheck(before);
  }).catch(function (e) {
    ok('数据隔离流程未抛异常', false, (e && e.stack) || '' + e);
    return runFrozenCheck(before);
  });
}

function runFrozenCheck(corpusBefore) {
  // ---------- 5. 冻结四资产 SHA ----------
  console.log('\n[5] 冻结资产 SHA 4/4 MATCH');
  var expected = {
    'corpus.json': '068fa1fa052ec7b93a9d60008c26b29c425c40f0ab724ab33483dbd1001459ae',
    'intent.js': '765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38',
    'knowledgeRouter.js': '848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935',
    'rag.js': '90c9cc5fe1d9f30837f63a9a67d512e6d08262ef19e125ddd7bebf8ee0890698',
  };
  var allMatch = true;
  Object.keys(expected).forEach(function (f) {
    var p = path.join(CHAT, f);
    var h = sha256File(p);
    var m = h === expected[f];
    if (!m) allMatch = false;
    ok('冻结资产 ' + f + ' SHA 一致', m, 'got=' + h.slice(0, 16) + ' exp=' + expected[f].slice(0, 16));
  });
  ok('冻结四资产全部 MATCH', allMatch);
  return runRegressionAndActivation(corpusBefore);
}

function runRegressionAndActivation(corpusBefore) {
  // ---------- 6. 默认行为零回归 ----------
  console.log('\n[6] 默认行为零回归（factualEnabled=false 不联网）');
  // 默认 env：SEARCH_PROVIDER=mock, FRESHNESS_FACTUAL_ENABLED 未设(false)
  delete process.env.FRESHNESS_SEARCH_PROVIDER;
  return freshness.maybeHandle('付航最近怎么样？', { models: [], history: [] }).then(function (res) {
    ok('B 类默认仍进入 freshness 管线（不返 null）', res !== null);
    ok('B 类默认不联网：citations 为空', res && res.citations && res.citations.length === 0, 'cites=' + (res && res.citations ? res.citations.length : 'n/a'));
    ok('B 类默认未触发事实检索（无 search_provider 标记）', !(res && res.freshness && res.freshness.search_provider), 'sp=' + (res && res.freshness && res.freshness.search_provider));

    // ---------- 7. 激活布线证明 ----------
    console.log('\n[7] 激活布线证明（factualEnabled=true + mock）');
    process.env.FRESHNESS_SEARCH_PROVIDER = 'http'; // 绕过 B 反思分支，进入事实分支
    process.env.SEARCH_PROVIDER = 'mock';
    searchLayer._resetCache();
    return freshness.maybeHandle('付航最近怎么样？', { models: [], history: [], factualEnabled: true }).then(function (res2) {
      ok('事实分支确实调用 searchLayer（search_provider=mock）', res2 && res2.freshness && res2.freshness.search_provider === 'mock',
        'sp=' + (res2 && res2.freshness && res2.freshness.search_provider));
      // 清理 env
      delete process.env.FRESHNESS_SEARCH_PROVIDER;
      // 再次确认 corpus 未因激活流程被改
      var after2 = sha256File(path.join(CHAT, 'corpus.json'));
      ok('激活流程后 corpus.json SHA 仍一致', corpusBefore === after2, 'before=' + corpusBefore.slice(0, 12) + ' after=' + after2.slice(0, 12));

      finish();
    });
  }).catch(function (e) {
    ok('回归/激活流程未抛异常', false, (e && e.stack) || '' + e);
    finish();
  });
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
