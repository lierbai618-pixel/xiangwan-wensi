/**
 * Phase N-4 Ablation — 定位回归下降根因并验证缓解方案
 * 变体：
 *  V0 baseline        : 全部 child chunk 入索引
 *  V1 no-crossref     : 移除含经典书名的「与经典思想的关系」chunk
 *  V2 core-only       : 仅保留概念内核（定义/来源/表现/应对/边界），移除生活场景 + 交叉引用
 *  V3 core+domain-gate: V2 + 词面域闸（查询无认知偏差信号则 pilot 不参与候选）
 * 只读生产资产，产物写 artifacts/ablation.json
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const ART = path.join(__dirname, "artifacts");
const MODEL = "text-embedding-v3", DIM = 1024;
const KEY = process.env.DASHSCOPE_API_KEY || "";
const EP = "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings";

const { splitChunks } = require(path.join(ROOT, "cloudfunctions", "ingest", "index.js"));
const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "cloudfunctions", "chat", "corpus.json"), "utf8"));
const regRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "phase-g-regression-test.json"), "utf8"));
const regSet = (regRaw.records || []).filter((r) => r && r.question);
const bench = JSON.parse(fs.readFileSync(path.join(__dirname, "benchmark.json"), "utf8"));
const src = fs.readFileSync(path.join(__dirname, "source", "P-04-confirmation-bias.md"), "utf8");

const all = splitChunks(src, { title: "确认偏差概念卡" }).filter((c) => c.level === "child");
const CROSSREF = /申辩篇|论语|庄子|苏格拉底|井蛙/;
const LIFESCENE = /生活场景/;
const sec = (c) => c.section || "";

const variants = {
  V0_baseline: all,
  V1_no_crossref: all.filter((c) => !CROSSREF.test(c.content)),
  V2_core_only: all.filter((c) => !CROSSREF.test(c.content) && !LIFESCENE.test(sec(c)) && !/在决定是否辞职|第一印象形成后|持仓之后/.test(c.content)),
};
variants.V3_core_domain_gate = variants.V2_core_only;

const GATE = /偏差|证据|反证|印证|客观|先入为主|第一印象|确认|验尸|异见|只看|选择性/;

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
const cos = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x) * Math.sqrt(y) || 1); };
const ndcg = (f, nRel, k) => { let dcg = 0; for (let i = 0; i < f.length && i < k; i++) if (f[i]) dcg += 1 / Math.log2(i + 2); let idcg = 0; for (let i = 0; i < Math.min(k, nRel); i++) idcg += 1 / Math.log2(i + 2); return idcg ? dcg / idcg : 0; };

(async () => {
  const classicText = corpus.map((c) => [c.title, c.source, c.section, c.text, c.summary, (c.tags || []).join(" "), c.modernUsage].filter(Boolean).join(" "));
  const classicVecs = await embed(classicText);
  const classicIdx = corpus.map((c, i) => ({ book: c.title, kind: "classic", vec: classicVecs[i] }));

  const uniq = [...new Set(Object.values(variants).flat().map((c) => c.content))];
  const uniqVecs = await embed(uniq);
  const vecOf = new Map(uniq.map((t, i) => [t, uniqVecs[i]]));

  const regVecs = await embed(regSet.map((r) => r.question));
  const benchVecs = await embed(bench.questions.map((q) => q.question));

  const K = 3;
  const result = {};
  for (const [name, chunks] of Object.entries(variants)) {
    const gate = name === "V3_core_domain_gate";
    const pilotIdx = chunks.map((c, i) => ({ book: "确认偏差概念卡", kind: "pilot", vec: vecOf.get(c.content), cid: i }));

    // regression
    let bHit = 0, aHit = 0, intr = 0, disp = 0, aMrr = 0, bMrr = 0;
    const dispList = [];
    regSet.forEach((r, i) => {
      const q = regVecs[i];
      const allowPilot = !gate || GATE.test(r.question);
      const before = classicIdx.map((it) => ({ ...it, s: cos(q, it.vec) })).sort((a, b) => b.s - a.s).slice(0, K);
      const pool = allowPilot ? classicIdx.concat(pilotIdx) : classicIdx;
      const after = pool.map((it) => ({ ...it, s: cos(q, it.vec) })).sort((a, b) => b.s - a.s).slice(0, K);
      const hit = (t) => t.some((x) => (r.expected_books || []).some((b) => x.book && (x.book === b || x.book.includes(b) || b.includes(x.book))));
      const mrr = (t) => { for (let j = 0; j < t.length; j++) if ((r.expected_books || []).some((b) => t[j].book && (t[j].book === b || t[j].book.includes(b) || b.includes(t[j].book)))) return 1 / (j + 1); return 0; };
      const hB = hit(before), hA = hit(after);
      if (hB) bHit++; if (hA) aHit++;
      bMrr += mrr(before); aMrr += mrr(after);
      if (after.some((x) => x.kind === "pilot")) intr++;
      if (hB && !hA) { disp++; dispList.push(r.id); }
    });

    // benchmark
    let h1 = 0, h3 = 0, mrrS = 0, ndcgS = 0;
    bench.questions.forEach((qq, i) => {
      const q = benchVecs[i];
      const allowPilot = !gate || GATE.test(qq.question);
      const pool = allowPilot ? classicIdx.concat(pilotIdx) : classicIdx;
      const top = pool.map((it) => ({ ...it, s: cos(q, it.vec) })).sort((a, b) => b.s - a.s).slice(0, K);
      const f = top.map((t) => t.kind === "pilot");
      if (f[0]) h1++;
      if (f.some(Boolean)) h3++;
      const fr = f.indexOf(true);
      mrrS += fr >= 0 ? 1 / (fr + 1) : 0;
      ndcgS += ndcg(f, pilotIdx.length, K);
    });

    const m = regSet.length, n = bench.questions.length;
    result[name] = {
      chunks_indexed: chunks.length,
      regression: {
        before_hit3: +(bHit / m).toFixed(4), after_hit3: +(aHit / m).toFixed(4),
        delta_hit: +((aHit - bHit) / m).toFixed(4),
        before_mrr: +(bMrr / m).toFixed(4), after_mrr: +(aMrr / m).toFixed(4),
        delta_mrr: +((aMrr - bMrr) / m).toFixed(4),
        intrusion_rate: +(intr / m).toFixed(4), displaced: disp, displaced_ids: dispList,
        pass: disp === 0 && aHit >= bHit,
      },
      benchmark: {
        hit_at_1: +(h1 / n).toFixed(4), hit_at_3: +(h3 / n).toFixed(4),
        mrr: +(mrrS / n).toFixed(4), ndcg_at_3: +(ndcgS / n).toFixed(4),
        pass: h3 / n >= 0.9,
      },
    };
    result[name].gate_overall = result[name].regression.pass && result[name].benchmark.pass;
    console.log(name, "chunks=" + chunks.length,
      "| REG after=" + result[name].regression.after_hit3, "Δ=" + result[name].regression.delta_hit,
      "disp=" + result[name].regression.displaced, "intr=" + result[name].regression.intrusion_rate,
      "| BENCH hit@3=" + result[name].benchmark.hit_at_3, "mrr=" + result[name].benchmark.mrr,
      "| PASS=" + result[name].gate_overall);
  }
  fs.writeFileSync(path.join(ART, "ablation.json"), JSON.stringify({ note: "Phase N-4 根因消融实验", variants: result }, null, 2), "utf8");
  console.log("\nartifacts/ablation.json written");
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
