// ============================================================
// Phase R — Capability Layer 离线测试
//   覆盖：路由准确性 / 否决护栏 / 时间正确性 / 计算安全性 /
//         诚实性（不编造）/ 格式契约 / 端到端 / RAG 零影响 / 观测字段
//   纯逻辑测试，零云依赖，可在沙箱直接运行。
// ============================================================
'use strict';

var path = require('path');
var BASE = path.join(__dirname, '..', 'cloudfunctions', 'chat');

var router = require(path.join(BASE, 'capabilities', 'router'));
var timeCap = require(path.join(BASE, 'capabilities', 'time'));
var calcCap = require(path.join(BASE, 'capabilities', 'calculator'));
var weatherCap = require(path.join(BASE, 'capabilities', 'weather'));
var locationCap = require(path.join(BASE, 'capabilities', 'location'));
var formatter = require(path.join(BASE, 'capabilities', 'formatter'));
var capabilities = require(path.join(BASE, 'capabilities'));
var obs = require(path.join(BASE, 'observability', 'observabilityLogger'));

var pass = 0;
var fail = 0;
var failures = [];

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✅ ' + name);
  } else {
    fail++;
    failures.push(name + (extra ? '  → ' + extra : ''));
    console.log('  ❌ ' + name + (extra ? '  → ' + extra : ''));
  }
}

function section(t) {
  console.log('\n【' + t + '】');
}

// 静态扫描前先剥离注释：否则"不读 corpus.json""禁止 eval"这类
// 自我声明的注释会被当成真实引用，产生假阳性。
function stripComments(src) {
  var noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock
    .split('\n')
    .map(function (line) {
      var idx = line.indexOf('//');
      // 保留 URL 协议中的 //
      while (idx > 0 && line[idx - 1] === ':') {
        idx = line.indexOf('//', idx + 2);
      }
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
}

// 固定时刻注入：2026-08-05T03:10:00Z = 北京时间 2026-08-05 11:10（星期三）
var FIXED_NOW = new Date('2026-08-05T03:10:00Z');
// 深夜：2026-08-05T18:30:00Z = 北京 2026-08-06 02:30
var LATE_NOW = new Date('2026-08-05T18:30:00Z');

// ============================================================
section('A. 时间能力 —— 本次修复的核心');
// ============================================================
var timeQueries = [
  '现在几点', '现在几点了？', '几点了', '现在是几点', '当前时间', '报个时间',
  '现在几点钟', '北京时间是多少',
];
var timeAllHit = true;
timeQueries.forEach(function (q) {
  var r = router.route(q, {});
  if (!r.hit || r.capability !== 'time_query') {
    timeAllHit = false;
    failures.push('时间未命中: ' + q);
  }
});
ok('8 种"现在几点"问法全部命中 time_query', timeAllHit);

var t1 = timeCap.resolve({ subType: 'time', now: FIXED_NOW });
ok('时间换算为北京时间（UTC+8）: ' + t1.fact,
  t1.fact.indexOf('2026年8月5日') >= 0 && t1.fact.indexOf('11:10') >= 0);
ok('星期计算正确（2026-08-05 = 星期三）', t1.fact.indexOf('星期三') >= 0, t1.fact);
ok('时间能力恒可用（ok 永远为 true）', t1.ok === true);

var t2 = timeCap.resolve({ subType: 'date', now: FIXED_NOW });
ok('日期子类型: ' + t2.fact, t2.fact.indexOf('今天是北京时间 2026年8月5日') >= 0);

var t3 = timeCap.resolve({ subType: 'weekday', now: FIXED_NOW });
ok('星期子类型: ' + t3.fact, t3.fact.indexOf('今天是星期三') >= 0);

var t4 = timeCap.resolve({ subType: 'relative', query: '明天几号', now: FIXED_NOW });
ok('相对日期推算: ' + t4.fact, t4.fact.indexOf('2026年8月6日') >= 0 && t4.fact.indexOf('星期四') >= 0);

var t5 = timeCap.resolve({ subType: 'relative', query: '昨天几号', now: FIXED_NOW });
ok('昨天推算: ' + t5.fact, t5.fact.indexOf('2026年8月4日') >= 0);

// 跨月边界
var t6 = timeCap.resolve({ subType: 'relative', query: '明天几号', now: new Date('2026-08-31T03:00:00Z') });
ok('跨月边界（8/31 → 9/1）: ' + t6.fact, t6.fact.indexOf('2026年9月1日') >= 0);

// 时区无关性：无论服务器时区，结果都应是北京时间
var snap = timeCap.snapshot(FIXED_NOW);
ok('快照时区标注为 Asia/Shanghai', snap.timezone.indexOf('UTC+8') >= 0);
ok('ISO 带 +08:00 偏移: ' + snap.iso, /\+08:00$/.test(snap.iso));

// ============================================================
section('B. 禁止自曝短板 / 禁止编造（回归原缺陷）');
// ============================================================
var FORBIDDEN = ['无法联网', '不知道时间', '无法获取时间', '我没有实时', '获取不到时间', '无法确定现在'];
async function runFixedTime(q, now) {
  return await capabilities.maybeHandle(q, { now: now || FIXED_NOW });
}

(async function () {
  var r1 = await runFixedTime('现在几点');
  ok('"现在几点" 被能力层接管（未落入 RAG）', !!r1 && r1.mode === 'capability');
  ok('绕过 RAG 标记正确', !!r1 && r1.capability.bypass_rag === true);
  ok('无检索引用（不消耗知识库）', !!r1 && r1.citations.length === 0);

  var badPhrase = '';
  FORBIDDEN.forEach(function (p) {
    if (r1 && r1.answer.indexOf(p) >= 0) badPhrase = p;
  });
  ok('回答不含任何"无法获取时间"类自曝话术', badPhrase === '', badPhrase);
  ok('回答首句即事实: ' + (r1 ? r1.answer.split('\n')[0] : ''),
    !!r1 && r1.answer.indexOf('现在是北京时间 2026年8月5日 11:10') === 0);

  // ========================================================
  section('C. 格式契约 —— 事实优先 + 可选邀请');
  // ========================================================
  var lines = r1.answer.split('\n\n');
  ok('结构为「事实\\n\\n邀请」两段', lines.length === 2, JSON.stringify(r1.answer));
  ok('第二段是邀请而非说教（含"如果"/"可以"/"我在"）',
    /(如果|可以|我在|想说)/.test(lines[1]), lines[1]);
  ok('邀请标记落入 meta', r1.capability.has_invite === true);

  // 深夜时段感知
  var rLate = await runFixedTime('现在几点', LATE_NOW);
  ok('深夜（02:30）走时段感知邀请: ' + rLate.answer.split('\n\n')[1],
    /(这个点|夜深)/.test(rLate.answer));

  // 情绪并存：事实照给 + 情绪承接
  var rEmo = await runFixedTime('我好焦虑，现在几点了');
  ok('情绪并存时仍给出时间事实（不因情绪丢失事实）',
    !!rEmo && rEmo.answer.indexOf('11:10') >= 0);
  ok('情绪并存时收尾切换为情绪承接',
    !!rEmo && /(不太好受|心里那件事|我听着|我在)/.test(rEmo.answer), rEmo && rEmo.answer);
  ok('情绪标记落入 meta', !!rEmo && rEmo.capability.emotional === true);

  // ========================================================
  section('D. 否决护栏 —— 哲学问题绝不被工具劫持');
  // ========================================================
  var vetoCases = [
    '时间的意义是什么',
    '时间过得好快，怎么办',
    '如何管理时间',
    '我总觉得时间不够用',
    '你怎么看待时间这件事',
    '光阴都去哪了',
    '要怎么珍惜时间',
    '时间的本质是什么',
  ];
  var vetoOkAll = true;
  var vetoBad = [];
  vetoCases.forEach(function (q) {
    var r = router.route(q, {});
    if (r.hit) { vetoOkAll = false; vetoBad.push(q); }
  });
  ok('8 条哲学化时间问句全部被否决（回 RAG）', vetoOkAll, vetoBad.join(' | '));

  var vetoEnd = await capabilities.maybeHandle('时间的意义是什么', {});
  ok('端到端：哲学问句返回 null（原链路接管）', vetoEnd === null);

  // 危机让位
  var crisisR = router.route('我不想活了，现在几点', {});
  ok('危机信号 → 能力层退出', crisisR.hit === false && crisisR.reason === 'crisis-yield');
  var crisisEnd = await capabilities.maybeHandle('我不想活了，现在几点', {});
  ok('端到端：危机问句返回 null（交危机链路）', crisisEnd === null);

  // ========================================================
  section('E. RAG 零影响 —— 非能力问题一律放行');
  // ========================================================
  var ragCases = [
    '如何面对失败？',
    '人生的意义是什么',
    '《论语》讲了什么',
    '我最近很迷茫，不知道该怎么办',
    '怎么和父母相处',
    '2026年是什么年',
    '8月5日发生了什么',
    '我今年30岁了，该不该换工作',
    '如何理解无为而治',
    '朋友背叛我了，我该原谅吗',
  ];
  var ragPass = true;
  var ragBad = [];
  for (var i = 0; i < ragCases.length; i++) {
    var rr = await capabilities.maybeHandle(ragCases[i], {});
    if (rr !== null) { ragPass = false; ragBad.push(ragCases[i]); }
  }
  ok('10 条常规问题全部放行至原链路（返回 null）', ragPass, ragBad.join(' | '));

  // ========================================================
  section('F. 计算能力 —— 正确性');
  // ========================================================
  var calcCases = [
    { q: '1+1等于几', want: '2' },
    { q: '帮我算一下 25*4', want: '100' },
    { q: '(2+3)*4', want: '20' },
    { q: '3乘以4加5', want: '17' },
    { q: '100减去37', want: '63' },
    { q: '2的平方', want: '4' },
    { q: '根号16等于几', want: '4' },
    { q: '100的百分之20是多少', want: '20' },
    { q: '0.1+0.2', want: '0.3' },
    { q: '1,000+500', want: '1500' },
    { q: '2的10次方', want: '1024' },
    { q: '-5+3', want: '-2' },
  ];
  var calcBad = [];
  calcCases.forEach(function (c) {
    var r = calcCap.resolve({ query: c.q });
    if (!r.ok || r.data.display !== c.want) {
      calcBad.push(c.q + ' 期望' + c.want + ' 实际' + (r.ok ? r.data.display : r.reason));
    }
  });
  ok('12 条算式全部正确（含浮点噪声消除）', calcBad.length === 0, calcBad.join(' | '));

  section('G. 计算能力 —— 安全性与诚实性');
  var evalAttack = calcCap.resolve({ query: "1+1; require('fs')" });
  ok('注入尝试被拒（不执行任意代码）', evalAttack.ok === false, JSON.stringify(evalAttack));
  var srcCalc = stripComments(require('fs').readFileSync(path.join(BASE, 'capabilities', 'calculator.js'), 'utf8'));
  ok('源码零 eval / new Function / vm',
    !/\beval\s*\(/.test(srcCalc) && !/new\s+Function/.test(srcCalc) && !/require\(['"]vm['"]\)/.test(srcCalc));

  var divZero = calcCap.resolve({ query: '10除以0' });
  ok('除以 0 → 诚实说明无定义（不返回 Infinity）',
    divZero.ok === false && divZero.reason === 'divide_by_zero' && divZero.fact.indexOf('没有定义') >= 0);

  var ambiguous = calcCap.resolve({ query: '6除3' });
  ok('中文"除"歧义 → 要求澄清而非猜答案',
    ambiguous.ok === false && ambiguous.reason === 'ambiguous_divide');

  var badParen = calcCap.resolve({ query: '(2+3*4' });
  ok('括号不配对 → 诚实报错', badParen.ok === false && badParen.reason === 'unbalanced_paren');

  var negSqrt = calcCap.resolve({ query: '根号-4' });
  ok('负数开方 → 说明实数无解', negSqrt.ok === false && negSqrt.reason === 'sqrt_negative');

  // ========================================================
  section('H. 天气 / 位置 —— 不编造');
  // ========================================================
  var w = await weatherCap.resolve({ query: '今天天气怎么样' });
  ok('无数据源时不返回具体天气', w.ok === false && w.reason === 'no_provider');
  ok('天气回答不含任何温度数字（零编造）', !/\d+\s*(℃|度)/.test(w.fact), w.fact);
  ok('天气回答不含"我无法联网"类话术',
    w.fact.indexOf('无法联网') < 0 && w.fact.indexOf('我做不到') < 0);
  ok('天气回答给出可行替代路径', /(天气应用|微信搜索)/.test(w.fact));

  ok('城市抽取: 杭州今天天气 → 杭州', weatherCap.extractCity('杭州今天天气怎么样') === '杭州');
  ok('不把时间词误当城市', weatherCap.extractCity('今天天气怎么样') === '');

  var loc1 = locationCap.resolve({ subType: 'self' });
  ok('无授权时不编造位置', loc1.ok === false && loc1.reason === 'no_authorization');
  ok('位置回答说明是授权问题而非能力缺陷', /(授权|定位)/.test(loc1.fact));
  ok('明确拒绝用 IP 猜测位置', loc1.fact.indexOf('猜') >= 0);

  var loc2 = locationCap.resolve({ subType: 'self', location: { city: '杭州市' } });
  ok('已授权时复述事实', loc2.ok === true && loc2.fact.indexOf('杭州市') >= 0);
  ok('位置结果不回传坐标至观测（隐私）', loc2.data.authorized === true && loc2.data.latitude === undefined);

  // 能力边界声明不追加思辨邀请（语气不错位）
  var fw = formatter.buildAnswer({ capability: 'weather_query', ok: false, fact: w.fact, query: '今天天气' });
  ok('边界声明不追加"聊聊意义"式邀请', fw.hasInvite === false);

  // ========================================================
  section('I. 端到端调用链');
  // ========================================================
  var e1 = await capabilities.maybeHandle('今天星期几', { now: FIXED_NOW });
  ok('端到端 时间: ' + e1.answer.split('\n')[0], e1.answer.indexOf('星期三') >= 0);

  var e2 = await capabilities.maybeHandle('帮我算一下 25*4', {});
  ok('端到端 计算: ' + e2.answer.split('\n')[0], e2.answer.indexOf('结果是 100') >= 0);

  var e3 = await capabilities.maybeHandle('今天天气怎么样', {});
  ok('端到端 天气（诚实边界）', e3.mode === 'capability' && e3.capability.tool_ok === false);

  var e4 = await capabilities.maybeHandle('我在哪', {});
  ok('端到端 位置（诚实边界）', e4.mode === 'capability' && e4.capability.name === undefined
    ? e4.capability.capability === 'location_query' : e4.capability.capability === 'location_query');

  ok('所有能力路径 mode 均为 capability',
    e1.mode === 'capability' && e2.mode === 'capability' && e3.mode === 'capability' && e4.mode === 'capability');
  ok('所有能力路径均无 citations（不触碰知识库）',
    e1.citations.length === 0 && e2.citations.length === 0 && e3.citations.length === 0 && e4.citations.length === 0);

  // ========================================================
  section('J. 观测字段');
  // ========================================================
  var rec = obs.buildObservationRecord({
    query: '现在几点',
    answerId: '20260805_test',
    result: e1,
    intent: {},
    latencyMs: 5,
  });
  ok('capability 观测字段已落库', !!rec.capability && rec.capability.name === 'time_query');
  ok('bypass_rag 记录正确', rec.capability.bypass_rag === true);
  ok('freshness 字段在能力路径为 null（互不污染）', rec.freshness === null);

  var recPlain = obs.buildObservationRecord({ query: '如何面对失败', result: {}, intent: {} });
  ok('非能力路径 capability 恒为 null（向后兼容）', recPlain.capability === null);

  var locRec = obs.buildObservationRecord({ query: '我在哪', result: e4, intent: {} });
  ok('位置观测不含坐标明文', JSON.stringify(locRec).indexOf('latitude') < 0);

  // ========================================================
  section('K. 三层边界隔离');
  // ========================================================
  var capDir = path.join(BASE, 'capabilities');
  var files = require('fs').readdirSync(capDir);
  var leak = [];
  files.forEach(function (f) {
    if (!/\.js$/.test(f)) return;
    var src = stripComments(require('fs').readFileSync(path.join(capDir, f), 'utf8'));
    if (/require\(['"].*corpus['"]\)|corpus\.json/.test(src)) leak.push(f + ':corpus');
    if (/require\(['"]\.\.\/rag['"]\)/.test(src)) leak.push(f + ':rag');
    if (/require\(['"]\.\.\/knowledgeRouter['"]\)/.test(src)) leak.push(f + ':knowledgeRouter');
    if (/embedding|向量/.test(src)) leak.push(f + ':embedding');
  });
  ok('capabilities/ 零引用 corpus.json / rag.js / knowledgeRouter.js / embedding',
    leak.length === 0, leak.join(' | '));

  var idxSrc = require('fs').readFileSync(path.join(capDir, 'index.js'), 'utf8');
  ok('仅只读引用 intent.js（允许的唯一冻结依赖）',
    idxSrc.indexOf("require('../intent')") >= 0);

  // ========================================================
  section('L. R-001 回归 —— 实时事实漏判修复（本轮新增，共 15 例）');
  // ========================================================
  // L-1 正向：以下表达此前全部回退 RAG，修复后必须进入 Capability Layer
  var r001Positive = [
    { q: '现在北京时间', cap: 'time_query', sub: 'time' },
    { q: '北京时间', cap: 'time_query', sub: 'time' },
    { q: '北京时间几点', cap: 'time_query', sub: 'time' },
    { q: '北京时间现在几点', cap: 'time_query', sub: 'time' },
    { q: '今天日期', cap: 'time_query', sub: 'date' },
    { q: '今天几号', cap: 'time_query', sub: 'date' },
    { q: '这个月几号', cap: 'time_query', sub: 'date' },
    { q: '外面冷吗', cap: 'weather_query', sub: 'today' },
    { q: '今天冷吗', cap: 'weather_query', sub: 'today' },
  ];
  r001Positive.forEach(function (c) {
    var r = router.route(c.q, {});
    ok('R-001 命中「' + c.q + '」→ ' + c.cap + '/' + c.sub,
      r.hit === true && r.capability === c.cap && r.subType === c.sub,
      r.hit ? (r.capability + '/' + r.subType) : ('回RAG[' + r.reason + ']'));
  });

  // L-2 反向：思辨问句必须继续回 RAG（召回率提升不得以准确性为代价）
  var r001MustRag = [
    '时间的意义是什么',
    '时间过得好快怎么办',
    '如何管理时间',
    '时间的本质是什么',
  ];
  r001MustRag.forEach(function (q) {
    var r = router.route(q, {});
    ok('R-001 护栏「' + q + '」→ 回 RAG', r.hit === false,
      r.hit ? ('被 ' + r.capability + ' 抢占') : r.reason);
  });

  // L-3 过度外扩防护：补丁不得把知识型/隐喻型问句一并吞掉
  var over1 = router.route('北京时间和纽约时间差几小时', {});
  ok('R-001 不外扩：时区差知识问句未被时间能力吞掉', over1.hit === false,
    over1.hit ? (over1.capability + '/' + over1.subType) : over1.reason);

  var over2 = router.route('今天的人心冷吗', {});
  ok('R-001 不外扩：「冷」的隐喻用法未被天气能力吞掉', over2.hit === false,
    over2.hit ? (over2.capability + '/' + over2.subType) : over2.reason);

  // ========================================================
  console.log('\n============================================');
  console.log('通过: ' + pass + ' / ' + (pass + fail));
  if (fail > 0) {
    console.log('失败项:');
    failures.forEach(function (f) { console.log('  - ' + f); });
    process.exitCode = 1;
  } else {
    console.log('全部通过 ✅');
  }
  console.log('============================================');
})();
