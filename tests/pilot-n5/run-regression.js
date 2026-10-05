/**
 * Phase N-5.1 — Knowledge Router Regression (隔离沙箱，不碰生产)
 * =============================================================
 * 目标：复现 N-4 的「回归失败」(Classic Hit@3 0.82→0.74, 4 题挤出, #48 全占)，
 *       再用【生产知识路由模块 knowledgeRouter.js 的 routerAdj】验证修复：
 *         Classic Hit@3 ≥ 0.82  且  Concept Intrusion = 0
 *
 * 方法（与 N-4 ablation 字节级对齐，确保基线可复现）：
 *   · 候选池 = 14 经典 (classicIdx) + 7 P-04 子块 (pilotIdx)，扁平同池余弦。
 *   · 向量 = 真实 DashScope text-embedding-v3 / 1024 维 / float（同 N-4 参数）。
 *   · 首跑联网算 embedding 并缓存到 artifacts/embeddings.json，之后离线复跑。
 *   · flat : 仅 cos(q, vec) 排序（= N-4 V0 扁平全局向量检索）。
 *   · routed: cos(q, vec) + routerAdj(docType, route)（= 生产路由重排）。
 *   · routerAdj 直接 require 生产 cloudfunctions/chat/knowledgeRouter.js —— 单一事实来源。
 *
 * 同时做【生产 TF 语义】二级校验：用生产 rankChunks 在「注入 P-04 的 chunk 池」上跑，
 *   验证 routerAdj 在 rag.js 真实代码路径（TF 余弦）下同样降低侵入。
 * =============================================================
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const CHAT = path.join(ROOT, "cloudfunctions", "chat");
const ART = path.join(__dirname, "artifacts");

const { splitChunks } = require(path.join(ROOT, "cloudfunctions", "ingest", "index.js"));
const { classifyIntent } = require(path.join(CHAT, "intent.js"));
const { routeQuestion, routerAdj } = require(path.join(CHAT, "knowledgeRouter.js"));
const rag = require(path.join(CHAT, "rag.js")); // 仅用于二级 TF 校验（rankChunks）

const corpus = JSON.parse(fs.readFileSync(path.join(CHAT, "corpus.json"), "utf8"));
const regRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "phase-g-regression-test.json"), "utf8"));
const regSet = (regRaw.records || []).filter((r) => r && r.question);
const bench = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "pilot-n4", "benchmark.json"), "utf8"));
const src = fs.readFileSync(path.join(ROOT, "tests", "pilot-n4", "source", "P-04-confirmation-bias.md"), "utf8");

const MODEL = "text-embedding-v3", DIM = 1024;
const KEY = process.env.DASHSCOPE_API_KEY || "";
const EP = "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings";
const EMB_FILE = path.join(ART, "embeddings.json");
const K = 3;

// ---------- embedding（与 N-4 完全一致） ----------
const cos = (a, b) => {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return d / (Math.sqrt(x) * Math.sqrt(y) || 1);
};
async function embed(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 10) {
    const r = await fetch(EP, {
      method: "POST",
      headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, input: texts.slice(i, i + 10), dimensions: DIM, encoding_format: "float" }),
    });
    if (!r.ok) throw new Error("embed " + r.status + " " + (await r.text()).slice(0, 200));
    const d = await r.json();
    out.push(...d.data.sort((a, b) => a.index - b.index).map((x) => x.embedding));
  }
  return out;
}

function loadOrComputeEmbeddings() {
  if (fs.existsSync(EMB_FILE)) {
    try {
      const c = JSON.parse(fs.readFileSync(EMB_FILE, "utf8"));
      if (c.classicVecs && c.pilotVecs && c.regVecs && c.benchVecs) {
        console.log("[embed] 命中缓存，离线复跑（不联网）");
        return c;
      }
    } catch (e) { /* fallthrough */ }
  }
  if (!KEY) throw new Error("DASHSCOPE_API_KEY 缺失且无可复用缓存");
  console.log("[embed] 联网计算真实 embedding（同 N-4 参数）…");
  return null; // 调用方负责填充并写盘
}

function topK(qvec, pool, k, route) {
  // 不按 title 去重：忠实复现 N-4「多块同名挤占 Top-3」的失败模式
  return pool
    .map((it) => ({ ...it, s: cos(qvec, it.vec) + routerAdj(it.docType, route) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k);
}

function hitExpected(t, expectedBooks) {
  return t.some((x) => (expectedBooks || []).some((b) => x.book && (x.book === b || x.book.includes(b) || b.includes(x.book))));
}

(async () => {
  const cached = loadOrComputeEmbeddings();

  // ===== 候选池构建（同 N-4） =====
  const classicText = corpus.map((c) =>
    [c.title, c.source, c.section, c.text, c.summary, (c.tags || []).join(" "), c.modernUsage].filter(Boolean).join(" "));
  const pilotChunks = splitChunks(src, { title: "确认偏差概念卡" }).filter((c) => c.level === "child");
  const pilotText = pilotChunks.map((c) => c.content);
  const regText = regSet.map((r) => r.question);
  const benchText = bench.questions.map((q) => q.question);

  let classicVecs, pilotVecs, regVecs, benchVecs;
  if (cached) {
    ({ classicVecs, pilotVecs, regVecs, benchVecs } = cached);
  } else {
    classicVecs = await embed(classicText);
    pilotVecs = await embed(pilotText);
    regVecs = await embed(regText);
    benchVecs = await embed(benchText);
    fs.writeFileSync(EMB_FILE, JSON.stringify({ classicVecs, pilotVecs, regVecs, benchVecs }, null, 2), "utf8");
    console.log("[embed] 已写缓存 ->", EMB_FILE);
  }

  const classicIdx = corpus.map((c, i) => ({ book: c.title, kind: "classic", docType: "classic", vec: classicVecs[i] }));
  const pilotIdx = pilotChunks.map((c, i) => ({
    book: "确认偏差概念卡",
    kind: "pilot",
    docType: "psychology",
    title: "确认偏差概念卡·" + (c.section || i),
    vec: pilotVecs[i],
  }));
  const pool = classicIdx.concat(pilotIdx);

  // ===== 一级：embedding 世界复现 + 路由修复 =====
  let bHit = 0, aHit = 0, rHit = 0, flatIntr = 0, rIntr = 0, disp = 0;
  const dispList = [];
  regSet.forEach((r, i) => {
    const q = regVecs[i];
    const intent = classifyIntent(r.question);
    const route = routeQuestion({ intentInfo: intent, domain: intent.domain, question: r.question });
    const before = classicIdx.map((it) => ({ ...it, s: cos(q, it.vec) })).sort((a, b) => b.s - a.s).slice(0, K);
    const flat = topK(q, pool, K, null);
    const routed = topK(q, pool, K, route);
    const hB = hitExpected(before, r.expected_books);
    const hA = hitExpected(flat, r.expected_books);
    const hR = hitExpected(routed, r.expected_books);
    if (hB) bHit++; if (hA) aHit++; if (hR) rHit++;
    if (flat.some((x) => x.kind === "pilot")) flatIntr++;
    if (routed.some((x) => x.kind === "pilot")) rIntr++;
    if (hB && !hA) {
      disp++;
      dispList.push({ id: r.id, q: r.question, flat_top3: flat.map((x) => x.book), routed_top3: routed.map((x) => x.book) });
    }
  });

  // ===== 基准（20 题，全为认知偏差域） =====
  let bh3 = 0, rh3 = 0, bh1 = 0, rh1 = 0;
  bench.questions.forEach((qq, i) => {
    const q = benchVecs[i];
    const intent = classifyIntent(qq.question);
    const route = routeQuestion({ intentInfo: intent, domain: intent.domain, question: qq.question });
    const flat = topK(q, pool, K, null);
    const routed = topK(q, pool, K, route);
    const isPilot = (t) => t.some((x) => x.kind === "pilot");
    if (isPilot(flat)) { bh3++; if (flat[0] && flat[0].kind === "pilot") bh1++; }
    if (isPilot(routed)) { rh3++; if (routed[0] && routed[0].kind === "pilot") rh1++; }
  });

  // ===== 二级：生产 TF 语义校验（rag.rankChunks + 注入 P-04 的 chunk 池） =====
  const classicChunks = corpus.map((c) => ({
    title: c.title, section: c.section || "", content: c.text || "", summary: c.summary || "",
    keywords: c.tags || [], themes: [], problem_tags: [], knowledge_type: "classic",
  }));
  const pilotChunkPool = pilotChunks.map((c, i) => ({
    title: "确认偏差概念卡·" + (c.section || i), section: c.section || "", content: c.content,
    summary: "", keywords: [], themes: [], problem_tags: [], knowledge_type: "psychology",
  }));
  const tfPool = classicChunks.concat(pilotChunkPool);
  let tfFlatIntr = 0, tfRoutedIntr = 0;
  regSet.forEach((r) => {
    const intent = classifyIntent(r.question);
    const route = routeQuestion({ intentInfo: intent, domain: intent.domain, question: r.question });
    const flat = rag.rankChunks(r.question, tfPool, K, null);
    const routed = rag.rankChunks(r.question, tfPool, K, route);
    if ((flat.citations || []).some((c) => c.knowledge_type === "psychology")) tfFlatIntr++;
    if ((routed.citations || []).some((c) => c.knowledge_type === "psychology")) tfRoutedIntr++;
  });

  const m = regSet.length, n = bench.questions.length;
  const out = {
    baseline: {
      before_hit3: +(bHit / m).toFixed(4),
      flat_after_hit3: +(aHit / m).toFixed(4),
      routed_hit3: +(rHit / m).toFixed(4),
      flat_intrusion_rate: +(flatIntr / m).toFixed(4),
      routed_intrusion_rate: +(rIntr / m).toFixed(4),
      displaced: disp,
      displaced_ids: dispList.map((d) => d.id),
    },
    benchmark: {
      flat_hit_at_3: +(bh3 / n).toFixed(4),
      routed_hit_at_3: +(rh3 / n).toFixed(4),
      flat_hit_at_1: +(bh1 / n).toFixed(4),
      routed_hit_at_1: +(rh1 / n).toFixed(4),
    },
    production_tf_check: {
      flat_intrusion: tfFlatIntr,
      routed_intrusion: tfRoutedIntr,
      total: m,
    },
    displaced_detail: dispList,
    acceptance: {
      classic_hit3_ge_082: rHit / m >= 0.82,
      concept_intrusion_eq_0: rIntr === 0,
      benchmark_hit3_ge_095: rh3 / n >= 0.95,
    },
  };
  fs.writeFileSync(path.join(ART, "regression-report.json"), JSON.stringify(out, null, 2), "utf8");

  console.log("\n================ Phase N-5.1 Regression ================");
  console.log("回归集 n=" + m + " | 基准集 n=" + n);
  console.log("① Classic Hit@3  before(flat-classic only) =" + out.baseline.before_hit3);
  console.log("   Classic Hit@3  flat(含P-04,无路由)      =" + out.baseline.flat_after_hit3 + "  ← N-4 失败基线(应≈0.74)");
  console.log("   Classic Hit@3  routed(知识路由)         =" + out.baseline.routed_hit3 + "  ← 目标 ≥0.82");
  console.log("② Concept Intrusion  flat =" + out.baseline.flat_intrusion_rate + " | routed =" + out.baseline.routed_intrusion_rate + " (目标 0)");
  console.log("③ 挤出题数 displaced =" + out.baseline.displaced + " | ids=" + JSON.stringify(out.baseline.displaced_ids));
  console.log("④ 基准 Hit@3  flat=" + out.benchmark.flat_hit_at_3 + " | routed=" + out.benchmark.routed_hit_at_3 + " (目标 ≥0.95)");
  console.log("⑤ 生产 TF 语义校验: 侵入 flat=" + out.production_tf_check.flat_intrusion + " → routed=" + out.production_tf_check.routed_intrusion + " / " + m);
  console.log("\n--- 挤出题 Before/After 路由 ---");
  dispList.forEach((d) => {
    console.log("#" + d.id + " " + d.q);
    console.log("   flat  Top3: " + JSON.stringify(d.flat_top3));
    console.log("   routed Top3: " + JSON.stringify(d.routed_top3));
  });
  const pass = out.acceptance.classic_hit3_ge_082 && out.acceptance.concept_intrusion_eq_0 && out.acceptance.benchmark_hit3_ge_095;
  console.log("\n>>> PASS=" + pass + "  " + JSON.stringify(out.acceptance));
  console.log(">>> report -> " + path.join(ART, "regression-report.json"));
  process.exit(pass ? 0 : 2);
})().catch((e) => { console.error("FAIL:", e.stack || e.message); process.exit(1); });
