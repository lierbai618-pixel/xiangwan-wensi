#!/usr/bin/env node
'use strict';

/**
 * 「豆包体感」基准 —— 量化流式回答的流畅度
 *
 * 用户看流式回答时，体感由四个数决定（不是总耗时）：
 *   ① 首字延迟 firstContent   开始出字要等多久       目标 < 1s
 *   ② 字流速   cjkPerSec      每秒出几个汉字          目标 > 15 汉字/s
 *   ③ 卡顿峰值 maxGap         最长"不出字"间隔       目标 < 1.5s（否则像是卡住了）
 *   ④ 首秒出字 burst1s        首字后 1 秒内出了多少字  越大越"顺"
 *
 * 总耗时 total 只影响成本（云函数 GBs），不影响体感。
 *
 * 运行：
 *   DS_KEY=sk-xxx AG_KEY=sk-yyy node scripts/bench_fluency.js
 *   环境变量 ROUNDS 控制轮数（默认 3）；CONCISE=1 追加一题要求短答
 */

const DS_KEY = process.env.DS_KEY;
const AG_KEY = process.env.AG_KEY;
if (!DS_KEY || !AG_KEY) { console.error('缺少 DS_KEY / AG_KEY'); process.exit(1); }

const ROUNDS = Number(process.env.ROUNDS || 3);

const SYS = '你是「向晚问思」，一个以经典哲学、文学与心理学为根基的思辨助手。你不替用户做决定，而是陪他把问题看清、拓展视角，最后把判断留给他自己。请用中文回答。';
const USER = '我今年30岁，工作稳定但总觉得没什么意义，想改变又怕失去现在的一切。我该怎么办？';
const USER_SHORT = USER + '\n（请控制在 250 字以内，直接给核心观点，不要分点罗列。）';

const DASH = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const AGNES = 'https://api.agnes-ai.cn/v1';

// 与生产三层配置一一对应
const MODELS = [
  { tag: '主 deepseek-v4.1-flash', base: DASH, key: DS_KEY, model: 'deepseek-v4.1-flash', thk: false },
  { tag: '次 agnes-2.5-flash', base: AGNES, key: AG_KEY, model: 'agnes-2.5-flash', thk: null },
  { tag: '备 deepseek-v4-pro-0813', base: DASH, key: DS_KEY, model: 'deepseek-v4-pro-0813', thk: false },
];

const cjkLen = (s) => (s.match(/[\u4e00-\u9fa5]/g) || []).length;

async function measure(m, msg, tag) {
  const body = {
    model: m.model,
    messages: [{ role: 'system', content: SYS }, { role: 'user', content: msg }],
    max_tokens: 1536,
    stream: true,
  };
  if (m.thk === false) body.enable_thinking = false;

  const t0 = Date.now();
  let firstContent = null, lastDelta = null, prevAt = null;
  let content = '', reasoning = '', maxGap = 0, burst1s = 0, stalls = 0;

  const res = await fetch(m.base + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + m.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { tag, err: `HTTP ${res.status} ${t.slice(0, 100)}` };
  }

  let buf = '';
  for await (const raw of res.body) {
    buf += Buffer.from(raw).toString('utf8');
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const d = t.slice(5).trim();
      if (d === '[DONE]' || !d) continue;
      let j; try { j = JSON.parse(d); } catch { continue; }
      const ch = j.choices && j.choices[0];
      if (!ch) continue;
      const dl = ch.delta || {};
      if (dl.reasoning_content) reasoning += dl.reasoning_content;
      if (!dl.content) continue;

      const now = Date.now() - t0;
      if (firstContent === null) firstContent = now;
      // 卡顿检测：仅统计"首字之后"的间隔（首字前是 prefill，不算卡顿）
      if (prevAt !== null) {
        const gap = now - prevAt;
        if (gap > maxGap) maxGap = gap;
        if (gap > 1500) stalls++;
      }
      prevAt = now;
      content += dl.content;
      if (now - firstContent <= 1000) burst1s += cjkLen(dl.content);
    }
  }

  const total = Date.now() - t0;
  const decodeMs = (firstContent !== null && lastDelta !== null) ? lastDelta - firstContent : (firstContent !== null ? total - firstContent : null);
  const cjk = cjkLen(content);
  const genSec = firstContent !== null ? (total - firstContent) / 1000 : null;

  return {
    tag, firstContent, total, cjk, rcjk: cjkLen(reasoning),
    cjkPerSec: genSec && genSec > 0 ? cjk / genSec : null,
    maxGap, stalls, burst1s,
    preview: content.slice(0, 50),
  };
}

(async () => {
  const rows = [];
  for (const m of MODELS) {
    for (let r = 1; r <= ROUNDS; r++) {
      process.stdout.write(`${m.tag}  r${r} ... `);
      try {
        const res = await measure(m, USER, m.tag);
        rows.push({ ...res, model: m.model, round: r });
        if (res.err) console.log(`✗ ${res.err}`);
        else console.log(`首字 ${res.firstContent}ms | 总 ${res.total}ms | ${res.cjk}字 | ${res.cjkPerSec?.toFixed(1)}字/s | 卡顿峰 ${res.maxGap}ms`);
      } catch (e) {
        console.log(`✗ ${e.message}`);
        rows.push({ tag: m.tag, model: m.model, round: r, err: e.message });
      }
    }
  }

  const ok = rows.filter((r) => !r.err);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2); };

  console.log('\n' + '='.repeat(92));
  console.log('模型'.padEnd(24) + '首字(中位)'.padStart(11) + '总耗时'.padStart(9) + '汉字'.padStart(7) +
    '字/s'.padStart(8) + '首秒出字'.padStart(9) + '卡顿峰'.padStart(8) + ' 判定');
  console.log('-'.repeat(92));
  for (const m of MODELS) {
    const v = ok.filter((r) => r.model === m.model);
    if (!v.length) { console.log(m.tag.padEnd(24) + '  ✗ 全部失败'); continue; }
    const fc = med(v.map((r) => r.firstContent));
    const tot = med(v.map((r) => r.total));
    const cjk = med(v.map((r) => r.cjk));
    const sp = med(v.map((r) => Math.round(r.cjkPerSec || 0)));
    const b1 = med(v.map((r) => r.burst1s));
    const mg = Math.max(...v.map((r) => r.maxGap));
    const verdict =
      fc < 1000 && mg < 1500 ? '✅ 流畅' :
      fc < 2000 && mg < 3000 ? '⚠️ 可接受' : '🔴 有卡顿感';
    console.log(
      m.tag.padEnd(24) +
      (fc + 'ms').padStart(11) +
      (tot + 'ms').padStart(9) +
      String(cjk).padStart(7) +
      String(sp).padStart(8) +
      String(b1).padStart(9) +
      (mg + 'ms').padStart(8) +
      '  ' + verdict
    );
  }
  console.log('='.repeat(92));

  console.log('\n【参考门槛】（业界通用经验值，非对豆包的实测）');
  console.log('  首字 < 500ms  → 几乎无等待感      ｜ 500–1000ms → 轻微等待，可接受');
  console.log('  字流速 > 20 汉字/s → 顺滑如打字机  ｜ 10–20 → 略有顿挫 ｜ < 10 → 明显卡');
  console.log('  卡顿峰 < 1000ms → 无感             ｜ > 2500ms → 用户以为断了');

  // 短答对照（可选）：证明"要求更短 = 总耗时显著下降，但首字不变"
  if (process.env.CONCISE === '1') {
    console.log('\n【短答对照】同一模型 + 要求 ≤250 字：');
    for (const m of MODELS) {
      try {
        const a = await measure(m, USER, m.tag + '·长');
        const b = await measure(m, USER_SHORT, m.tag + '·短');
        console.log(`  ${m.tag.padEnd(24)} 长答 ${a.cjk}字/${a.total}ms  →  短答 ${b.cjk}字/${b.total}ms  （省 ${a.total - b.total}ms，首字 ${a.firstContent}→${b.firstContent}ms）`);
      } catch (e) { console.log(`  ${m.tag} ✗ ${e.message}`); }
    }
  }
})().catch((e) => { console.error('脚本异常：', e && e.stack || e); process.exit(1); });
