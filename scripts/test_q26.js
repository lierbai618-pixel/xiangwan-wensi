// ============================================================
// scripts/test_q26.js
//   Phase Q2-6-MVP：Online Freshness Activation Preparation
//
//   运行：node scripts/test_q26.js
//   要求：零网络（retriever.nodeFetch 注入 fakeFetch，绝不触网）。
//   覆盖（用户要求 5 项 + 隔离检查）：
//     A. searchLayer → thinkEngine 数据流审查（搜索结果不进知识资产）
//     B. Freshness Runtime Context 隔离检查（freshnessRuntimeGuard）
//     C. 测试：
//        1) 网络结果进入回答 ✅
//        2) corpus hash 不变 ✅
//        3) embedding 数量不变 ✅（corpus 条目数 = 派生 embedding 向量数）
//        4) 知识库文件无修改 ✅（4 冻结资产 mtime+SHA 不变）
//        5) 搜索失败自动回退 RAG ✅
//        6) 隔离检查单元（guard 对正常/泄露/审计的判定）
// ============================================================
'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const CHAT = path.join(__dirname, '..', 'cloudfunctions', 'chat');
const thinkEngine = require(path.join(CHAT, 'think', 'thinkEngine'));
const searchLayer = require(path.join(CHAT, 'providers', 'search'));
const retriever = require(path.join(CHAT, 'freshness', 'eventRetriever'));
const guard = require(path.join(CHAT, 'freshnessRuntimeGuard'));

const FROZEN = ['corpus.json', 'intent.js', 'knowledgeRouter.js', 'rag.js'];

// ---------- 轻量断言框架 ----------
let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; fails.push(msg); console.log('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + ')'); }
function includes(hay, needle, msg) { ok(('' + hay).indexOf(needle) >= 0, msg + ' (需包含「' + needle + '」)'); }
function section(name) { console.log('\n=== ' + name + ' ==='); }

function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function mtimeMs(p) { return fs.statSync(p).mtimeMs; }

// 冻结资产快照
function snapshotFrozen() {
  const snap = { corpusLen: 0, items: {} };
  FROZEN.forEach((f) => {
    const p = path.join(CHAT, f);
    snap.items[f] = { sha: sha256File(p), mtime: mtimeMs(p) };
  });
  // corpus 条目数 = 派生 embedding 向量数（每项 → 一个 embedding）
  snap.corpusLen = require(path.join(CHAT, 'corpus.json')).length;
  return snap;
}

// ---------- fakeFetch（绝不触网） ----------
function makeFakeFetch(body) {
  return function (url, request) {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body || { results: [] }); } });
  };
}

// 联网结果（带强标识，便于断言「进入回答」）
const NET_RESULTS = {
  results: [
    { title: '网源甲', url: 'https://news.cn/a', content: '【联网事实标记XYZ】2026年某政策正式落地实施', engine: 'baidu' },
    { title: '网源乙', url: 'https://people.cn/b', content: '【联网事实标记XYZ】行业数据较去年增长12%', engine: 'sogou' },
  ],
};

// fake RAG（generateAnswer 注入）
let ragCallCount = 0;
let ragWasCalledWith = null;
function fakeRag(message, opts) {
  ragCallCount++;
  ragWasCalledWith = message;
  return Promise.resolve({
    answer: '【RAG知识库回答】' + message,
    citations: [{ title: '论语·学而', summary: '学而时习之', knowledge_type: 'classic' }],
    retrieval: { queryTerms: [], totalDocuments: 1, minScore: 0.5, search: false },
  });
}

// searchFn：失败注入（模拟 provider 异常 / 超时 / 无结果）
function failingSearchFn() {
  return Promise.resolve({ ok: false, provider: 'domestic', results: [], reason: 'provider_exception' });
}

// ---------- 环境辅助 ----------
function withEnv(env, fn) {
  const bak = {};
  Object.keys(env).forEach((k) => { bak[k] = process.env[k]; process.env[k] = env[k]; });
  let r;
  return Promise.resolve()
    .then(() => fn())
    .then((res) => { r = res; return res; })
    .finally(() => {
      Object.keys(env).forEach((k) => {
        if (bak[k] === undefined) delete process.env[k];
        else process.env[k] = bak[k];
      });
      return r;
    });
}

// ============================================================
(async function () {
  const realFetch = retriever.nodeFetch;

  // 冻结资产基线快照
  const snapBefore = snapshotFrozen();
  console.log('\n[基线] corpus 条目数(embedding 向量数)=' + snapBefore.corpusLen +
    '，corpus SHA=' + snapBefore.items['corpus.json'].sha.slice(0, 16) + '…');

  // ============================================================
  section('A. searchLayer → thinkEngine 数据流（在线结果不进知识资产）');
  section('C1. 网络结果进入回答');

  await withEnv(
    { SEARCH_PROVIDER: 'domestic', SEARXNG_BASE_URL: 'https://searx.internal/search' },
    async function () {
      searchLayer._setConfig({ timeoutMs: 3000, retries: 2, dailyQuota: 500 });
      searchLayer._resetDaily();
      retriever.nodeFetch = makeFakeFetch(NET_RESULTS);

      // 真实走 searchLayer（含 privacyGate/canaryGate/quota/audit）→ thinkEngine
      const searchFn = (q, o) => searchLayer.search(q, o);
      const query = '某政策落地的影响怎么看';
      const result = await thinkEngine.run(query, {
        answerMode: 'fast',
        factualEnabled: true,
        searchProvider: 'domestic',
        searchFn: searchFn,
        generateAnswer: fakeRag,
        openid: 'u1',
      });

      ok(result !== null, 'fast 模式联网成功 → thinkEngine 接管返回结果');
      ok(result && typeof result.answer === 'string', '返回结构含 answer 字段');
      includes(result && result.answer, '【联网事实标记XYZ】', '回答文本包含联网检索到的事实摘要（搜索结果作为 runtime context 进入回答）');
      ok(result && result.think && result.think.searchAudit, '结果携带 searchAudit（审计元数据）');
      eq(result && result.think && result.think.searchAudit && result.think.searchAudit.data_route, 'domestic', 'data_route=domestic（国内数据路径，零跨境）');
      // 关键：联网事实仅以「引用/摘要」形式出现，绝不以知识库条目形式沉淀
      ok(!(result && result.citations && result.citations.some((c) => (c.title || '').indexOf('联网事实标记XYZ') >= 0)),
        '联网事实未写入经典知识库 citations（仅作 runtime 引用）');

      // ---- B. Freshness Runtime Context 隔离检查（对真实结果执行） ----
      section('B. Freshness Runtime Context 隔离检查');
      const rep = guard.verifyAnswerResult(result);
      ok(rep.ok, 'guard.verifyAnswerResult(真实联网结果) → 通过（无 KB 写入泄露）');
      eq(rep.leaks.length, 0, '泄露扫描：0 处疑似知识沉淀结构');
      eq(rep.auditIssues.length, 0, '审计白名单：searchAudit 仅含安全字段');
      // 链路标记：search→fact→ThinkContext 必须 ephemeral
      const fastCtx = result && result.think && result.think.context;
      ok(guard.isEphemeral(fastCtx), 'think.context 携带 _ephemeral 硬标记（请求级生命周期）');

      // ============================================================
      section('C5. 搜索失败自动回退 RAG');
      // think 模式：搜索失败 → 引擎内部以 RAG 兜底产出
      ragCallCount = 0; ragWasCalledWith = null;
      const failResult = await thinkEngine.run('哲学上如何定义勇气', {
        answerMode: 'think',
        factualEnabled: true,
        searchProvider: 'domestic',
        searchFn: failingSearchFn,
        generateAnswer: fakeRag,
        openid: 'u1',
      });
      ok(failResult !== null, '搜索失败（think 模式）→ 引擎仍返回结果（未崩溃/未空回答）');
      includes(failResult && failResult.answer, '【RAG知识库回答】', '搜索失败时回答来自 RAG 知识库（自动回退）');
      ok(ragCallCount >= 1, 'RAG(generateAnswer) 被调用 ≥1 次（兜底生效）');
      eq(ragWasCalledWith, '哲学上如何定义勇气', 'RAG 收到的 query 与用户提问一致');

      // fast 模式：搜索失败 → 引擎返回 null，由外层派发器回退 RAG
      const fastNull = await thinkEngine.run('今天有什么热点', {
        answerMode: 'fast',
        factualEnabled: true,
        searchProvider: 'domestic',
        searchFn: failingSearchFn,
        generateAnswer: fakeRag,
        openid: 'u1',
      });
      ok(fastNull === null, '搜索失败（fast 模式）→ 引擎返回 null（交还冻结链路）');
      // 模拟 index.js 派发器：result===null → generateAnswer(RAG)
      let dispatched = fastNull;
      if (!dispatched) dispatched = await fakeRag('今天有什么热点', {});
      includes(dispatched && dispatched.answer, '【RAG知识库回答】', '派发器回退：null → RAG 知识库回答（冻结链路永远是兜底）');

      return Promise.resolve();
    }
  );

  // ============================================================
  section('C2. corpus hash 不变（KB 完整性）');
  const afterCorpusSha = sha256File(path.join(CHAT, 'corpus.json'));
  eq(afterCorpusSha, snapBefore.items['corpus.json'].sha, 'corpus.json SHA256 全流程前后完全一致');

  section('C3. embedding 数量不变（corpus 条目数代理）');
  const afterCorpusLen = require(path.join(CHAT, 'corpus.json')).length;
  eq(afterCorpusLen, snapBefore.corpusLen, 'corpus 条目数前后一致（派生的 embedding 向量数不变，无 ingest）');

  section('C4. 知识库文件无修改（4 冻结资产 mtime + SHA 不变）');
  const snapAfter = snapshotFrozen();
  FROZEN.forEach((f) => {
    eq(snapAfter.items[f].sha, snapBefore.items[f].sha, f + ' SHA 不变');
    eq(snapAfter.items[f].mtime, snapBefore.items[f].mtime, f + ' mtime 不变（未被写入）');
  });

  // ============================================================
  section('B-单元. 隔离检查器对正常/泄露/审计的判定');
  // 正常 result（ephemeral context + 安全 audit）
  const goodResult = {
    answer: 'x',
    think: { context: { _ephemeral: true }, searchAudit: { provider: 'domestic', latency_ms: 10, cache_hit: false, downgrade_reason: '', quota_remaining: 499, canary_blocked: false, data_route: 'domestic' } },
  };
  ok(guard.verifyAnswerResult(goodResult).ok, 'guard：正常 result → 通过');

  // 泄露 result（携带 corpus 写入结构且未标 ephemeral）
  const leakResult = { answer: 'x', think: { corpus: [{ id: 1 }] } };
  ok(!guard.verifyAnswerResult(leakResult).ok, 'guard：含 corpus 写入结构 → 判定为泄露（不通过）');
  ok(guard.verifyAnswerResult(leakResult).leaks.length >= 1, 'guard：泄露路径被记录');

  // 审计含 url → 不通过
  const badAudit = { provider: 'domestic', latency_ms: 1, cache_hit: false, downgrade_reason: '', quota_remaining: 1, canary_blocked: false, data_route: 'domestic', leaked: 'https://evil.com/x' };
  ok(!guard.verifyAudit(badAudit).ok, 'guard：审计含 URL → 不通过（违反白名单）');
  // 审计字段超白名单 → 不通过
  const extraAudit = { provider: 'domestic', latency_ms: 1, cache_hit: false, downgrade_reason: '', quota_remaining: 1, canary_blocked: false, data_route: 'domestic', user_text: '原始提问' };
  ok(!guard.verifyAudit(extraAudit).ok, 'guard：审计含未授权字段 → 不通过');

  // 恢复
  retriever.nodeFetch = realFetch;

  // ---------- 汇总 ----------
  console.log('\n========================================');
  console.log('Phase Q2-6-MVP 测试结果: ' + pass + ' PASS / ' + fail + ' FAIL');
  console.log('========================================');
  if (fail > 0) {
    console.log('失败项:');
    fails.forEach((m) => console.log('  - ' + m));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error('测试运行异常:', e);
  process.exit(2);
});
