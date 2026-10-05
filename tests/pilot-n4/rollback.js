/**
 * Phase N-4 Rollback Drill —— 真实撤销演练
 * 步骤：inventory → 删除 pilot namespace 产物（registry + vector index + reports）
 *      → 校验生产资产指纹未变 → 校验 namespace 已清空 → 写 rollback-report.json（存于 namespace 之外）
 * 用法：node tests/pilot-n4/rollback.js
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const ART = path.join(__dirname, "artifacts");
const sha = (p) => (fs.existsSync(p) ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") : null);

const guard = {
  corpus: path.join(ROOT, "cloudfunctions", "chat", "corpus.json"),
  rag: path.join(ROOT, "cloudfunctions", "chat", "rag.js"),
  intent: path.join(ROOT, "cloudfunctions", "chat", "intent.js"),
  ingest: path.join(ROOT, "cloudfunctions", "ingest", "index.js"),
  phaseG: path.join(ROOT, "phase-g-regression-test.json"),
};
const before = Object.fromEntries(Object.entries(guard).map(([k, p]) => [k, sha(p)]));

// 1. inventory
const inventory = fs.existsSync(ART)
  ? fs.readdirSync(ART).map((f) => {
      const p = path.join(ART, f);
      return { file: f, bytes: fs.statSync(p).size, sha256: sha(p) };
    })
  : [];
const registryBefore = fs.existsSync(path.join(ART, "registry.json"))
  ? JSON.parse(fs.readFileSync(path.join(ART, "registry.json"), "utf8")).records[0]
  : null;
const vectorsBefore = fs.existsSync(path.join(ART, "vector-index.json"))
  ? JSON.parse(fs.readFileSync(path.join(ART, "vector-index.json"), "utf8")).vector_count_after
  : null;

// 2. 执行删除（Registry 记录 + Vector 索引 + 全部 pilot 产物）
fs.rmSync(ART, { recursive: true, force: true });

// 3. 校验
const after = Object.fromEntries(Object.entries(guard).map(([k, p]) => [k, sha(p)]));
const productionUntouched = Object.keys(guard).every((k) => before[k] === after[k]);
const namespaceCleared = !fs.existsSync(ART);
const corpusStillN = JSON.parse(fs.readFileSync(guard.corpus, "utf8")).length;

const report = {
  drill_time: new Date().toISOString(),
  steps: [
    { step: "inventory", detail: `${inventory.length} 个 pilot 产物`, ok: true },
    { step: "registry_state_revert", detail: registryBefore ? `P-04 status ${registryBefore.status} → removed（namespace 关闭）` : "no registry", ok: true },
    { step: "vector_delete", detail: `删除 pilot 向量索引（after-index 共 ${vectorsBefore} 向量，其中 pilot ${registryBefore ? registryBefore.chunk_count : "?"} 条）`, ok: true },
    { step: "namespace_close", detail: `tests/pilot-n4/artifacts 已移除 = ${namespaceCleared}`, ok: namespaceCleared },
    { step: "version_revert", detail: "P-04 version 0.1.0-pilot 作废，无生产版本需回退", ok: true },
    { step: "production_verify", detail: `corpus/rag/intent/ingest/phaseG 指纹一致 = ${productionUntouched}；corpus 仍为 ${corpusStillN} 条`, ok: productionUntouched },
  ],
  hash_before: before,
  hash_after: after,
  production_untouched: productionUntouched,
  namespace_cleared: namespaceCleared,
  corpus_object_count: corpusStillN,
  deleted_inventory: inventory,
  rollback_pass: productionUntouched && namespaceCleared,
  reproducibility: "产物可由 node tests/pilot-n4/run-pilot.js 幂等重建（源文件 + benchmark 保留）",
};
fs.writeFileSync(path.join(__dirname, "rollback-report.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({ rollback_pass: report.rollback_pass, production_untouched: productionUntouched, namespace_cleared: namespaceCleared, corpus_object_count: corpusStillN, deleted_files: inventory.length }, null, 2));
