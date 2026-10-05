#!/usr/bin/env node
'use strict';

/**
 * hcnsec 网关全模型 · 多轮测试（带并发）
 * key 从 cloudbaserc.json 读
 * 每模型 3 轮：默认 / 关思考 / 默认
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cloudbaserc.json'), 'utf8'));
const EV = cfg.functions.find((f) => f.name === 'chat').envVariables;
const BASE = EV.HCNSEC_BASE_URL;
const KEY = EV.HCNSEC_API_KEY;
const CONC = Number(process.env.CONC || 4);
const TMO = Number(process.env.TMO || 90000);
const OUT = path.join(os.tmpdir(), 'wdws-bench', 'hcnsec.json');

const SYS = '你是「向晚问思」，一个以经典哲学、文学与心理学为根基的思辨助手。你不替用户做决定，而是陪他把问题看清、拓展视角，最后把判断留给他自己。请用中文回答。';
const USER = '我今年30岁，工作稳定但总觉得没什么意义，想改变又怕失去现在的一切。我该怎么办？';
const cjk = (s) => (s.match(/[\u4e00-\u9fa5]/g) || []).length;

async function one(model, round, noThink) {
  const body = { model, messages: [{ role: 'system', content: SYS }, { role: 'user', content: USER }], max_tokens: 1200, stream: false };
  if (noThink) body.enable_thinking = false;
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TMO);
  try {
    const res = await fetch(BASE + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctl.signal,
    });
    const total = Date.now() - t0;
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      clearTimeout(timer);
      let msg = txt.slice(0, 130);
      try { const j = JSON.parse(txt); msg = (j.error && (j.error.message || j.error.code)) || j.message || msg; } catch (e) {}
      return { model, round, noThink, ok: false, http: res.status, err: String(msg).replace(/\s+/g, ' ').slice(0, 90), total };
    }
    const j = await res.json();
    clearTimeout(timer);
    const m = (j.choices && j.choices[0] && j.choices[0].message) || {};
    const c = m.content || '', r = m.reasoning_content || '';
    return { model, round, noThink, ok: true, total, cjk: cjk(c), rcjk: cjk(r), empty: c.trim().length === 0 };
  } catch (e) {
    clearTimeout(timer);
    return { model, round, noThink, ok: false, http: 0, err: e.name === 'AbortError' ? 'TIMEOUT' : e.message.slice(0, 90), total: Date.now() - t0 };
  }
}

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) break;
      const r = await worker(items[idx]);
      out[idx] = r; done++;
      process.stdout.write('  [' + String(done).padStart(2) + '/' + items.length + '] r' + r.round + (r.noThink ? '关' : '默') + ' ' +
        r.model.padEnd(24) + (r.ok ? String(r.total).padStart(6) + 'ms ' + String(r.cjk).padStart(4) + '字 思考' + String(r.rcjk).padStart(4) + (r.empty ? ' ⚠空' : '') : 'HTTP' + r.http + ' ' + r.err) + '\n');
    }
  }));
  return out;
}

(async () => {
  const lr = await fetch(BASE + '/models', { headers: { Authorization: 'Bearer ' + KEY } });
  const lj = await lr.json();
  const ids = (lj.data || lj.models || []).map((m) => m.id || m.model || m.name).filter(Boolean);
  const models = ids.filter((m) => !/embedding|image|asr|tts|realtime|speech/i.test(m)).sort();
  console.log('hcnsec 文本模型 ' + models.length + ' 个 × 3 轮，并发 ' + CONC + '\n');

  const all = [];
  for (const [round, noThink] of [[1, false], [2, true], [3, false]]) {
    console.log('=== round ' + round + (noThink ? ' 关思考' : ' 默认') + ' ===');
    const res = await pool(models.map((m) => ({ model: m, round })), CONC, (x) => one(x.model, x.round, noThink));
    all.push(...res);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), models, runs: all }, null, 2), 'utf8');
  }
  console.log('\n完成: ' + OUT);
})();
