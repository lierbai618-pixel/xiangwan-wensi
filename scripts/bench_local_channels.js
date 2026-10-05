#!/usr/bin/env node
'use strict';

/**
 * 本地渠道模型 · 多轮测试
 * 覆盖 cloudbaserc.json 中配置的全部非百炼渠道：agnes / hcnsec
 * key 一律从 cloudbaserc.json 读取（避免手抄出错 —— 上次 hcnsec 因手打 key 误报 401）
 *
 * 每模型 3 轮：默认 / 关思考 / 默认
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CFG = path.join(__dirname, '..', 'cloudbaserc.json');
const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
const chatFn = cfg.functions.find((f) => f.name === 'chat');
const EV = chatFn.envVariables;

const CHANNELS = [
  { name: 'agnes', base: EV.AGNES_SEARCH_BASE_URL, key: EV.AGNES_SEARCH_API_KEY },
  { name: 'hcnsec', base: EV.HCNSEC_BASE_URL, key: EV.HCNSEC_API_KEY },
];

const SYS = '你是「向晚问思」，一个以经典哲学、文学与心理学为根基的思辨助手。你不替用户做决定，而是陪他把问题看清、拓展视角，最后把判断留给他自己。请用中文回答。';
const USER = '我今年30岁，工作稳定但总觉得没什么意义，想改变又怕失去现在的一切。我该怎么办？';
const cjk = (s) => (s.match(/[\u4e00-\u9fa5]/g) || []).length;

async function listModels(base, key) {
  try {
    const r = await fetch(base + '/models', { headers: { Authorization: 'Bearer ' + key } });
    if (!r.ok) return { http: r.status, ids: [] };
    const j = await r.json();
    const arr = j.data || j.models || [];
    return { http: 200, ids: arr.map((m) => m.id || m.model || m.name).filter(Boolean).sort() };
  } catch (e) { return { http: 0, ids: [], err: e.message }; }
}

async function one(base, key, model, noThink, timeoutMs) {
  const body = {
    model,
    messages: [{ role: 'system', content: SYS }, { role: 'user', content: USER }],
    max_tokens: 1200,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (noThink) body.enable_thinking = false;

  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let content = '', reasoning = '', usage = null, ttfb = null, firstContent = null;
  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      clearTimeout(timer);
      let msg = txt.slice(0, 140);
      try { const j = JSON.parse(txt); msg = (j.error && (j.error.message || j.error.code)) || msg; } catch (e) {}
      return { model, noThink, ok: false, http: res.status, err: String(msg).replace(/\s+/g, ' ').slice(0, 100), total: Date.now() - t0 };
    }
    let buf = '';
    for await (const raw of res.body) {
      if (ttfb === null) ttfb = Date.now() - t0;
      buf += Buffer.from(raw).toString('utf8');
      const lines = buf.split('\n'); buf = lines.pop();
      for (const l of lines) {
        const d = l.trim();
        if (!d.startsWith('data:')) continue;
        const p = d.slice(5).trim();
        if (p === '[DONE]' || !p) continue;
        let j; try { j = JSON.parse(p); } catch (e) { continue; }
        if (j.usage) usage = j.usage;
        const ch = j.choices && j.choices[0];
        if (!ch) continue;
        const dl = ch.delta || {};
        if (dl.content) { if (firstContent === null) firstContent = Date.now() - t0; content += dl.content; }
        if (dl.reasoning_content) reasoning += dl.reasoning_content;
      }
    }
    clearTimeout(timer);
    return { model, noThink, ok: true, ttfb, firstContent, total: Date.now() - t0, cjk: cjk(content), rcjk: cjk(reasoning), outTok: usage ? usage.completion_tokens : null, empty: content.trim().length === 0 };
  } catch (e) {
    clearTimeout(timer);
    return { model, noThink, ok: false, http: 0, err: e.name === 'AbortError' ? 'TIMEOUT' : e.message.slice(0, 100), total: Date.now() - t0 };
  }
}

(async () => {
  const report = { generatedAt: new Date().toISOString(), channels: [], runs: [] };

  for (const ch of CHANNELS) {
    console.log('════ ' + ch.name + '  ' + ch.base + ' ════');
    const lm = await listModels(ch.base, ch.key);
    console.log('  /models → HTTP ' + lm.http + '，共 ' + lm.ids.length + ' 个');
    if (lm.ids.length) console.log('  ' + lm.ids.join(', '));
    report.channels.push({ name: ch.name, base: ch.base, listHttp: lm.http, models: lm.ids });

    const textIds = lm.ids.filter((m) => !/video|image|speech|tts|asr|embed|rerank|omni/i.test(m));
    if (!textIds.length) { console.log('  （无可用文本模型）\n'); continue; }

    for (const m of textIds) {
      for (const [i, noThink] of [[1, false], [2, true], [3, false]]) {
        const r = await one(ch.base, ch.key, m, noThink, 60000);
        report.runs.push(Object.assign({ channel: ch.name }, r));
        console.log('  r' + i + (noThink ? ' 关思考' : ' 默认  ') + ' ' + m.padEnd(26) +
          (r.ok ? String(r.total).padStart(6) + 'ms ' + String(r.cjk).padStart(4) + '字 思考' + String(r.rcjk).padStart(4) + (r.empty ? '  ⚠空回答' : '')
                : 'HTTP' + r.http + ' ' + r.err));
      }
    }
    console.log('');
  }

  const out = path.join(os.tmpdir(), 'wdws-bench', 'local.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log('已写出: ' + out);
})();
