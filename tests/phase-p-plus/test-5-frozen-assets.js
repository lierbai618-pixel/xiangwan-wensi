// ============================================================
// 测试 5：冻结资产哈希保护
// ------------------------------------------------------------
// 这是 Phase P+ 最硬的一道闸：四项冻结资产的 SHA256 必须等于
// O-0.6 冻结基线。任何一字节改动都会让本测试红灯。
//
// 双重锁定：
//   ① 断言实际文件哈希 == 本文件内的基线常量
//   ② 断言基线常量 == docs/67 审计报告表格中记录的哈希
//   —— 只改测试常量而不改文档（或反之）会立刻暴露，无法悄悄"洗白"。
//
// 另加静态扫描：Phase P+ 新增代码不得对冻结资产执行写操作。
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WEAPP = path.resolve(__dirname, '..', '..');
const CHAT = path.join(WEAPP, 'cloudfunctions', 'chat');
const AUDIT_DOC = path.join(WEAPP, 'docs', '67-PhaseP+审计报告.md');

// O-0.6 冻结基线（与 docs/67 §表格一致）
const FROZEN_BASELINE = {
  'corpus.json': '068fa1fa052ec7b93a9d60008c26b29c425c40f0ab724ab33483dbd1001459ae',
  'intent.js': '765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38',
  'rag.js': '5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286',
  'knowledgeRouter.js': '848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935',
};

// Phase P+ 新增/改动的非冻结文件（需静态扫描其写操作）
const PHASE_P_PLUS_FILES = [
  'registry/registryProvider.js',
  'registry/jsonRegistryProvider.js',
  'observability/observabilityLogger.js',
  'observability/jsonObservabilityStore.js',
  'observability/cloudObservabilityStore.js',
  'knowledgeHealthScore.js',
  'dashboard/dashboard.js',
  'dashboard/printDashboard.js',
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

module.exports = {
  name: '冻结资产哈希保护',
  run(t) {
    // --- 1. 四项冻结资产哈希 == 基线 ---
    Object.keys(FROZEN_BASELINE).forEach((name) => {
      const p = path.join(CHAT, name);
      t.ok(fs.existsSync(p), '冻结资产存在：' + name);
      if (!fs.existsSync(p)) return;
      const actual = sha256(p);
      t.equal(actual, FROZEN_BASELINE[name], name + ' SHA256 == O-0.6 冻结基线');
    });

    // --- 2. 基线常量 == docs/67 审计报告记录（防止只改测试不改文档） ---
    if (t.ok(fs.existsSync(AUDIT_DOC), 'docs/67 审计报告存在（哈希基线的文档来源）')) {
      const doc = fs.readFileSync(AUDIT_DOC, 'utf-8');
      Object.keys(FROZEN_BASELINE).forEach((name) => {
        const hash = FROZEN_BASELINE[name];
        t.ok(
          doc.indexOf(hash) >= 0,
          name + ' 的基线哈希在 docs/67 中有据可查（测试常量与审计文档互锁）'
        );
      });
    }

    // --- 3. 静态扫描：Phase P+ 代码不得写冻结资产 ---
    const writeApis = /(writeFileSync|appendFileSync|createWriteStream|promises\.writeFile|unlinkSync|rmSync|renameSync|copyFileSync)/;
    const frozenNames = /(corpus\.json|rag\.js|intent\.js|knowledgeRouter\.js)/;

    PHASE_P_PLUS_FILES.forEach((rel) => {
      const p = path.join(CHAT, rel);
      if (!fs.existsSync(p)) {
        t.ok(false, 'Phase P+ 文件缺失：' + rel);
        return;
      }
      const src = fs.readFileSync(p, 'utf-8');
      const codeOnly = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const lines = codeOnly.split('\n');
      // 同一行同时出现"写 API"和"冻结文件名" → 高危
      const risky = lines.filter((l) => writeApis.test(l) && frozenNames.test(l));
      t.equal(risky.length, 0, rel + ' 无「写操作 + 冻结资产」同现（未写回冻结资产）');
    });

    // --- 4. Dashboard / Registry 对 corpus 的引用必须是只读读取 ---
    const providerSrc = fs.readFileSync(path.join(CHAT, 'registry', 'jsonRegistryProvider.js'), 'utf-8') +
      fs.readFileSync(path.join(CHAT, 'registry', 'registryProvider.js'), 'utf-8');
    t.ok(/readFileSync/.test(providerSrc), 'Registry Provider 使用 readFileSync 读取（只读语义）');
    t.ok(!writeApis.test(providerSrc.replace(/^\s*\/\/.*$/gm, '')), 'Registry Provider 完全不含任何写 API');

    // --- 5. 实测：跑一遍全链路后哈希仍不变（运行时防护，不只是静态检查） ---
    const beforeAll = Object.keys(FROZEN_BASELINE).map((n) => sha256(path.join(CHAT, n)));
    const { buildDashboard } = require(path.join(CHAT, 'dashboard', 'dashboard.js'));
    const { buildObservationRecord } = require(path.join(CHAT, 'observability', 'observabilityLogger.js'));
    t.noThrow(() => {
      buildDashboard({ store: { readAll: () => [], write: () => Promise.resolve({ ok: true }) } });
      buildObservationRecord({ query: 'hash-probe', intent: { domain: '通用' }, result: { citations: [] } });
    }, '执行 Dashboard + Observability 全链路不抛错');
    const afterAll = Object.keys(FROZEN_BASELINE).map((n) => sha256(path.join(CHAT, n)));
    t.deepEqual(afterAll, beforeAll, '运行 Phase P+ 全链路后，四项冻结资产哈希依然不变');

    t.info('冻结基线：corpus/intent/rag/knowledgeRouter 四项，全部锁定于 O-0.6');
  },
};
