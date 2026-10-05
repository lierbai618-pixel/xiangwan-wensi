/**
 * Phase N-4 Real Controlled Pilot Execution — Runner
 *
 * 隔离原则：
 *  - 只读 cloudfunctions/chat/corpus.json 与 phase-g-regression-test.json（不写、不改）
 *  - 复用生产 chunk 函数 cloudfunctions/ingest/index.js#splitChunks（require 只读，不修改）
 *  - 所有产物写入 tests/pilot-n4/artifacts/（namespace = pilot），可整目录删除回滚
 *  - 不连接云数据库、不写生产集合、不触碰 Prompt/Intent/RAG
 *
 * 用法：node tests/pilot-n4/run-pilot.js
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const ART = path.join(__dirname, "artifacts");
const NS = "pilot";
const MODEL = "text-embedding-v3";
const DIM = 1024;
const PROVIDER = "dashscope";
const ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings";
const API_KEY = process.env.DASHSCOPE_API_KEY || "";

if (!fs.existsSync(ART)) fs.mkdirSync(ART, { recursive: true });

const log = [];
function step(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  log.push(line);
}
function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeArtifact(name, obj) {
  fs.writeFileSync(path.join(ART, name), JSON.stringify(obj, null, 2), "utf8");
}

/* ---------------- 0. 生产资产指纹（前） ---------------- */
const CORPUS_PATH = path.join(ROOT, "cloudfunctions", "chat", "corpus.json");
const RAG_PATH = path.join(ROOT, "cloudfunctions", "chat", "rag.js");
const INTENT_PATH = path.join(ROOT, "cloudfunctions", "chat", "intent.js");
const guardPaths = { corpus: CORPUS_PATH, rag: RAG_PATH, intent: INTENT_PATH };
const hashBefore = {};
for (const [k, p] of Object.entries(guardPaths)) {
  hashBefore[k] = fs.existsSync(p) ? sha256(fs.readFileSync(p)) : null;
}
step(`生产资产指纹(before) corpus=${(hashBefore.corpus || "").slice(0, 16)}`);

/* ---------------- 1. Chunk：复用生产 splitChunks ---------------- */
let splitChunks = null;
let chunkFnSource = "production:cloudfunctions/ingest/index.js#splitChunks";
try {
  ({ splitChunks } = require(path.join(ROOT, "cloudfunctions", "ingest", "index.js")));
  if (typeof splitChunks !== "function") throw new Error("not a function");
} catch (e) {
  step(`!! 无法加载生产 splitChunks: ${e.message}`);
  process.exit(2);
}
step(`chunk 函数来源：${chunkFnSource}`);

const SRC_PATH = path.join(__dirname, "source", "P-04-confirmation-bias.md");
const srcRaw = fs.readFileSync(SRC_PATH, "utf8");
const srcHash = sha256(Buffer.from(srcRaw, "utf8"));

const pilotMeta = {
  title: "确认偏差概念卡",
  author: "向晚问思知识团队（原创撰写）",
  category: "心理学/认知概念",
  source: "原创概念卡；引用 Wason(1960) 2-4-6 task；Nickerson(1998) Review of General Psychology",
  year: "2026",
  perspective: "认知心理学",
  themes: ["认知偏差", "判断与决策", "自我觉察"],
  problem_tags: ["决策困难", "自我怀疑", "人际误解"],
  copyrightStatus: "original-content",
};

const t0chunk = Date.now();
const rawChunks = splitChunks(srcRaw, pilotMeta);
const chunkMs = Date.now() - t0chunk;
const levels = [...new Set(rawChunks.map((c) => c.level))];
const childChunks = rawChunks.filter((c) => (levels.includes("child") ? c.level === "child" : true));
step(`chunk 完成：total=${rawChunks.length} levels=${JSON.stringify(levels)} child=${childChunks.length} in ${chunkMs}ms`);

const pilotChunks = childChunks.map((c, i) => ({
  chunk_id: `${NS}::P-04::c${String(i + 1).padStart(3, "0")}`,
  knowledge_id: "P-04",
  namespace: NS,
  level: c.level || "child",
  section: c.section || "",
  position: i,
  content: c.content,
  content_length: (c.content || "").length,
  source_position: c.sourcePosition || null,
  metadata_complete: !!(c.content && (c.section !== undefined)),
}));

/* ---------------- 2. 生产经典（只读） ---------------- */
const corpus = readJSON(CORPUS_PATH);
step(`corpus.json 只读载入：${corpus.length} 条 Knowledge Objects`);
const classicDocs = corpus.map((c, i) => ({
  chunk_id: `prod::${c.id}`,
  knowledge_id: c.id,
  namespace: "production-mirror",
  book: c.title,
  section: c.section || "",
  content: [c.title, c.source, c.section, c.text, c.summary, (c.tags || []).join(" "), c.modernUsage]
    .filter(Boolean)
    .join(" "),
}));

/* ---------------- 3. Embedding（真实调用） ---------------- */
const embedStats = { requests: 0, tokens: 0, latencies: [], failures: 0 };
async function embedBatch(texts) {
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: "Bearer " + API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: texts, dimensions: DIM, encoding_format: "float" }),
  });
  const ms = Date.now() - t0;
  if (!res.ok) {
    embedStats.failures += 1;
    throw new Error(`embedding HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  embedStats.requests += 1;
  embedStats.latencies.push(ms);
  embedStats.tokens += (data.usage && data.usage.total_tokens) || 0;
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
async function embedAll(texts, label) {
  const out = [];
  for (let i = 0; i < texts.length; i += 10) {
    const batch = texts.slice(i, i + 10);
    const vecs = await embedBatch(batch);
    out.push(...vecs);
    step(`  embed ${label} ${Math.min(i + 10, texts.length)}/${texts.length}`);
  }
  return out;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/* ---------------- 4. 检索指标 ---------------- */
function search(index, qvec, k) {
  return index
    .map((it) => ({ ...it, score: cosine(qvec, it.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
function ndcgAtK(hits, nRelevant, k) {
  let dcg = 0;
  for (let i = 0; i < hits.length && i < k; i++) if (hits[i]) dcg += 1 / Math.log2(i + 2);
  let idcg = 0;
  const ideal = Math.min(k, nRelevant);
  for (let i = 0; i < ideal; i++) idcg += 1 / Math.log2(i + 2);
  return idcg ? dcg / idcg : 0;
}

(async () => {
  if (!API_KEY) { step("!! DASHSCOPE_API_KEY 缺失，终止"); process.exit(3); }

  step("=== Embedding: pilot chunks ===");
  const pilotVecs = await embedAll(pilotChunks.map((c) => c.content), "pilot-chunk");
  pilotChunks.forEach((c, i) => { c.vec_dim = pilotVecs[i].length; });

  step("=== Embedding: production-mirror classics ===");
  const classicVecs = await embedAll(classicDocs.map((c) => c.content), "classic");

  const bench = readJSON(path.join(__dirname, "benchmark.json"));
  step("=== Embedding: benchmark queries ===");
  const benchVecs = await embedAll(bench.questions.map((q) => q.question), "bench-q");
  step("=== Embedding: citation probes ===");
  const probeVecs = await embedAll(bench.citation_probes.map((q) => q.question), "probe-q");

  const regAll = readJSON(path.join(ROOT, "phase-g-regression-test.json"));
  const regArr = Array.isArray(regAll)
    ? regAll
    : (regAll.records || regAll.cases || Object.values(regAll).find(Array.isArray) || []);
  const regSet = regArr.filter((r) => r && r.question);
  step(`回归集载入：${regSet.length} 题（只读 phase-g-regression-test.json）`);
  step("=== Embedding: regression queries ===");
  const regVecs = await embedAll(regSet.map((r) => r.question), "reg-q");

  /* ---- Vector Index：BEFORE / AFTER ---- */
  const indexBefore = classicDocs.map((c, i) => ({ ...c, vec: classicVecs[i] }));
  const indexAfter = indexBefore.concat(pilotChunks.map((c, i) => ({ ...c, book: "确认偏差概念卡", vec: pilotVecs[i] })));
  step(`Vector Index: before=${indexBefore.length} after=${indexAfter.length} dim=${DIM}`);

  const metaBindingOk = indexAfter.every((it) => it.chunk_id && it.namespace && Array.isArray(it.vec) && it.vec.length === DIM);

  /* ---- Retrieval Benchmark（AFTER 索引） ---- */
  const K = 3;
  const nRelevant = pilotChunks.length;
  const benchRows = [];
  let sumRecall = 0, sumPrec = 0, sumMrr = 0, sumNdcg = 0, sumTop1 = 0, hit1 = 0, hit3 = 0;
  bench.questions.forEach((q, i) => {
    const top = search(indexAfter, benchVecs[i], K);
    const flags = top.map((t) => t.knowledge_id === "P-04");
    const nHit = flags.filter(Boolean).length;
    const recall = nHit / Math.min(K, nRelevant);
    const prec = nHit / K;
    const firstRank = flags.indexOf(true);
    const mrr = firstRank >= 0 ? 1 / (firstRank + 1) : 0;
    const ndcg = ndcgAtK(flags, nRelevant, K);
    sumRecall += recall; sumPrec += prec; sumMrr += mrr; sumNdcg += ndcg; sumTop1 += top[0].score;
    if (flags[0]) hit1 += 1;
    if (nHit > 0) hit3 += 1;
    benchRows.push({
      qid: q.qid, type: q.type, question: q.question,
      top1_id: top[0].chunk_id, top1_score: +top[0].score.toFixed(4),
      pilot_in_top3: nHit, first_rank: firstRank >= 0 ? firstRank + 1 : null,
      recall_at3: +recall.toFixed(4), precision_at3: +prec.toFixed(4),
      mrr: +mrr.toFixed(4), ndcg_at3: +ndcg.toFixed(4),
    });
  });
  const n = bench.questions.length;
  const benchSummary = {
    questions: n, k: K, relevant_pool: nRelevant,
    hit_at_1: +(hit1 / n).toFixed(4), hit_at_3: +(hit3 / n).toFixed(4),
    recall_at_3: +(sumRecall / n).toFixed(4), precision_at_3: +(sumPrec / n).toFixed(4),
    mrr: +(sumMrr / n).toFixed(4), ndcg_at_3: +(sumNdcg / n).toFixed(4),
    context_relevance_top1_cosine: +(sumTop1 / n).toFixed(4),
  };
  step(`Benchmark: hit@1=${benchSummary.hit_at_1} hit@3=${benchSummary.hit_at_3} MRR=${benchSummary.mrr} NDCG@3=${benchSummary.ndcg_at_3}`);

  /* ---- Regression：BEFORE vs AFTER ---- */
  function bookHit(top, expected) {
    return top.some((t) => (expected || []).some((b) => t.book && (t.book === b || t.book.includes(b) || b.includes(t.book))));
  }
  function bookMrr(top, expected) {
    for (let i = 0; i < top.length; i++) {
      if ((expected || []).some((b) => top[i].book && (top[i].book === b || top[i].book.includes(b) || b.includes(top[i].book)))) return 1 / (i + 1);
    }
    return 0;
  }
  const regRows = [];
  let bHit = 0, aHit = 0, bMrrS = 0, aMrrS = 0, intrusion = 0, displaced = 0, improved = 0;
  regSet.forEach((r, i) => {
    const tB = search(indexBefore, regVecs[i], K);
    const tA = search(indexAfter, regVecs[i], K);
    const hB = bookHit(tB, r.expected_books);
    const hA = bookHit(tA, r.expected_books);
    const mB = bookMrr(tB, r.expected_books);
    const mA = bookMrr(tA, r.expected_books);
    const intr = tA.filter((t) => t.knowledge_id === "P-04").length;
    if (hB) bHit += 1;
    if (hA) aHit += 1;
    bMrrS += mB; aMrrS += mA;
    if (intr > 0) intrusion += 1;
    if (hB && !hA) displaced += 1;
    if (!hB && hA) improved += 1;
    regRows.push({
      id: r.id, question: r.question, expected: r.expected_books,
      before_top3: tB.map((t) => t.book), after_top3: tA.map((t) => t.book),
      before_hit: hB, after_hit: hA, before_mrr: +mB.toFixed(4), after_mrr: +mA.toFixed(4),
      pilot_intrusion: intr,
    });
  });
  const m = regSet.length;
  const regSummary = {
    questions: m, k: K,
    before_book_hit_at_3: +(bHit / m).toFixed(4), after_book_hit_at_3: +(aHit / m).toFixed(4),
    delta_hit: +((aHit - bHit) / m).toFixed(4),
    before_mrr: +(bMrrS / m).toFixed(4), after_mrr: +(aMrrS / m).toFixed(4),
    delta_mrr: +((aMrrS - bMrrS) / m).toFixed(4),
    pilot_intrusion_rate: +(intrusion / m).toFixed(4),
    displaced_questions: displaced, improved_questions: improved,
    regression_pass: displaced === 0 && aHit >= bHit,
  };
  step(`Regression: before=${regSummary.before_book_hit_at_3} after=${regSummary.after_book_hit_at_3} displaced=${displaced} intrusion=${regSummary.pilot_intrusion_rate} pass=${regSummary.regression_pass}`);

  /* ---- Citation Audit ---- */
  const citRows = bench.citation_probes.map((p, i) => {
    const top = search(indexAfter, probeVecs[i], K);
    const joined = top.map((t) => t.content).join("\n");
    const hits = (p.must_contain || []).map((tok) => ({ token: tok, found: joined.includes(tok) }));
    const fab = (p.must_not_fabricate || []).map((tok) => ({ token: tok, present_in_evidence: joined.includes(tok) }));
    const grounded = hits.every((h) => h.found);
    return {
      qid: p.qid, question: p.question, top1_id: top[0].chunk_id,
      top1_from_pilot: top[0].knowledge_id === "P-04",
      must_contain: hits, fabrication_bait: fab, grounded,
    };
  });
  const citPass = citRows.filter((c) => c.grounded).length;
  const citSummary = {
    probes: citRows.length, grounded: citPass,
    citation_groundedness: +(citPass / citRows.length).toFixed(4),
    fabrication_bait_present_in_evidence: citRows.some((c) => c.fabrication_bait.some((f) => f.present_in_evidence)),
  };
  step(`Citation: grounded=${citSummary.grounded}/${citSummary.probes}`);

  /* ---- Runtime KQS（无数据项标 N/A，不伪造） ---- */
  const retrievalScore = +(100 * (0.5 * benchSummary.hit_at_3 + 0.3 * benchSummary.mrr + 0.2 * benchSummary.ndcg_at_3)).toFixed(2);
  const evidenceScore = 78; // 概念卡原创撰写 + 二手引用经典实证研究，evidence_level=secondary-review
  const citationScore = +(100 * citSummary.citation_groundedness).toFixed(2);
  const kqs = {
    components: {
      retrieval: { weight: 0.30, score: retrievalScore, source: "runtime benchmark (20Q)" },
      evidence: { weight: 0.25, score: evidenceScore, source: "registry evidence_level=secondary-review（Wason1960/Nickerson1998 二手引用）" },
      citation: { weight: 0.20, score: citationScore, source: "runtime citation audit (4 probes)" },
      usage: { weight: 0.15, score: null, source: "N/A — Pilot 未上线，无真实用户使用数据" },
      feedback: { weight: 0.10, score: null, source: "N/A — Pilot 未上线，无用户反馈" },
    },
  };
  const availW = 0.30 + 0.25 + 0.20;
  kqs.partial_weighted_sum = +(0.30 * retrievalScore + 0.25 * evidenceScore + 0.20 * citationScore).toFixed(2);
  kqs.normalized_available_kqs = +(kqs.partial_weighted_sum / availW).toFixed(2);
  kqs.coverage = `${Math.round(availW * 100)}% of weight measured, 25% N/A`;
  kqs.note = "Usage/Feedback 无数据，标记 N/A 未参与计算；禁止以预测值填充。";
  step(`Runtime KQS(partial, 75% coverage)=${kqs.normalized_available_kqs}`);

  /* ---- Registry Record（namespace=pilot，本地文件，非生产库） ---- */
  const registry = {
    schema: "knowledge-registry/pilot-v1",
    namespace: NS,
    storage: "local-file (tests/pilot-n4/artifacts/registry.json) — NOT production cloud DB",
    records: [{
      knowledge_id: "P-04",
      object_type: "concept-card",
      title: pilotMeta.title,
      domain: "psychology/cognitive-bias",
      source: pilotMeta.source,
      source_sha256: srcHash,
      authority: "medium-high",
      evidence_level: "secondary-review",
      copyright_status: "original-content",
      version: "0.1.0-pilot",
      status: "pilot-testing",
      created_time: new Date().toISOString(),
      embedding_status: "embedded",
      embedding_provider: PROVIDER,
      embedding_model: MODEL,
      embedding_dim: DIM,
      chunk_count: pilotChunks.length,
      quality_score: kqs.normalized_available_kqs,
      review_status: "approved-candidate",
    }],
  };

  /* ---- 产物落盘 ---- */
  writeArtifact("registry.json", registry);
  writeArtifact("chunks.json", { namespace: NS, chunk_fn: chunkFnSource, chunk_ms: chunkMs, levels, total_raw: rawChunks.length, indexed: pilotChunks.length, chunks: pilotChunks.map(({ vec, ...r }) => r) });
  writeArtifact("embedding-report.json", {
    provider: PROVIDER, model: MODEL, dimension: DIM, endpoint: ENDPOINT,
    requests: embedStats.requests, total_tokens: embedStats.tokens, failures: embedStats.failures,
    latency_ms: { min: Math.min(...embedStats.latencies), max: Math.max(...embedStats.latencies), avg: Math.round(embedStats.latencies.reduce((a, b) => a + b, 0) / embedStats.latencies.length) },
    vectors: { pilot: pilotVecs.length, classic_mirror: classicVecs.length, queries: benchVecs.length + probeVecs.length + regVecs.length },
    est_cost_cny: +((embedStats.tokens / 1000) * 0.0005).toFixed(6),
  });
  writeArtifact("vector-index.json", {
    namespace: NS, isolation: "pilot namespace separate from production; production has NO vector index (embedding:null in ingest SCHEMA)",
    vector_count_before: indexBefore.length, vector_count_after: indexAfter.length,
    dimension: DIM, metadata_binding_ok: metaBindingOk, search_available: true,
  });
  writeArtifact("retrieval-report.json", { summary: benchSummary, rows: benchRows });
  writeArtifact("regression-report.json", { summary: regSummary, rows: regRows });
  writeArtifact("citation-audit.json", { summary: citSummary, rows: citRows });
  writeArtifact("kqs.json", kqs);

  /* ---- 生产资产指纹（后）---- */
  const hashAfter = {};
  for (const [k, p] of Object.entries(guardPaths)) hashAfter[k] = fs.existsSync(p) ? sha256(fs.readFileSync(p)) : null;
  const untouched = Object.keys(guardPaths).every((k) => hashBefore[k] === hashAfter[k]);
  writeArtifact("isolation-proof.json", { hash_before: hashBefore, hash_after: hashAfter, production_untouched: untouched });
  step(`生产零扰动校验：${untouched ? "PASS（corpus/rag/intent 指纹一致）" : "FAIL"}`);

  fs.writeFileSync(path.join(ART, "run.log"), log.join("\n"), "utf8");
  step("Pilot 执行完成，产物写入 tests/pilot-n4/artifacts/");
})().catch((e) => {
  step("!! 执行失败：" + e.message);
  fs.writeFileSync(path.join(ART, "run.log"), log.join("\n"), "utf8");
  process.exit(1);
});
