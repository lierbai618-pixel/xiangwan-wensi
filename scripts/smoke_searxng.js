// ============================================================
// scripts/smoke_searxng.js
//   Phase Q2-9：SearXNG 国内实例部署后的合规冒烟测试。
//
//   用途：B1（国内部署）完成后，对 SEARXNG_BASE_URL 做 JSON API 冒烟，
//         并校验返回结果的 engine 是否属于【国内白名单】——
//         一旦检出跨境引擎（bing/google/ddg/tavily...）即 FAIL，
//         证明实例误配，必须回查 settings.yml。
//
//   用法：
//     SEARXNG_BASE_URL=https://search.example.com \
//     SEARXNG_API_KEY=<token> \
//     node scripts/smoke_searxng.js
//   或：node scripts/smoke_searxng.js <baseUrl> <apiKey>
//
//   依赖：Node 18+ 全局 fetch（云函数运行时 Node16.13 不跑本脚本，
//         本脚本仅在本地/CI 运维侧执行）。绝不修改任何冻结资产。
// ============================================================
'use strict';

// 严格国内引擎（默认启用，零跨境）
var STRICT_DOMESTIC = { baidu: true, sogou: true, so: true, '360': true };
// 可选、需 PIPL 评估（维基系服务器位于境外）
var BORDERLINE = { wikidata: true, wikipedia: true };

function parseArgs() {
  var base = process.env.SEARXNG_BASE_URL || (process.argv[2] || '');
  var key = process.env.SEARXNG_API_KEY || (process.argv[3] || '');
  return { base: (base || '').trim(), key: (key || '').trim() };
}

async function main() {
  var args = parseArgs();
  if (!args.base) {
    console.error('[FAIL] 未提供 SEARXNG_BASE_URL（env 或 argv[2]）');
    process.exit(2);
  }
  var url = args.base.replace(/\/+$/, '') + '/search?q=' +
    encodeURIComponent('向晚问思 联网测试') + '&format=json';

  var headers = { Accept: 'application/json' };
  if (args.key) headers['Authorization'] = 'Bearer ' + args.key;

  var res, data;
  try {
    res = await fetch(url, { headers: headers });
  } catch (e) {
    console.error('[FAIL] 请求异常：' + (e && e.message ? e.message : e));
    process.exit(3);
  }

  if (res.status !== 200) {
    console.error('[FAIL] HTTP ' + res.status + '（期望 200）');
    process.exit(4);
  }
  try {
    data = await res.json();
  } catch (e) {
    console.error('[FAIL] 响应非 JSON：' + (e && e.message ? e.message : e));
    process.exit(5);
  }

  var results = (data && Array.isArray(data.results)) ? data.results : [];
  if (!results.length) {
    console.error('[WARN] HTTP 200 但无结果（实例可能未返回，或查询被过滤）');
    // 不致命失败，但提示
  }

  // 收集 engine 分布
  var dist = {};
  results.forEach(function (r) {
    var e = r && r.engine ? r.engine : 'unknown';
    dist[e] = (dist[e] || 0) + 1;
  });

  var crossBorder = [];
  var borderline = [];
  Object.keys(dist).forEach(function (e) {
    if (STRICT_DOMESTIC[e]) return;
    if (BORDERLINE[e]) { borderline.push(e + '(' + dist[e] + ')'); return; }
    crossBorder.push(e + '(' + dist[e] + ')');
  });

  console.log('=== SearXNG 冒烟结果 ===');
  console.log('endpoint : ' + args.base);
  console.log('http     : ' + res.status);
  console.log('results  : ' + results.length);
  console.log('engine分布: ' + JSON.stringify(dist));

  if (crossBorder.length) {
    console.error('[FAIL] 检出跨境引擎：' + crossBorder.join(', ') + ' —— 实例误配，回查 settings.yml');
    process.exit(6);
  }
  if (borderline.length) {
    console.log('[WARN] 含需评估的维基系引擎：' + borderline.join(', ') +
      ' —— 若要求严格零跨境，请在 settings.yml 注释掉 wikidata/wikipedia');
  }
  console.log('[PASS] 未检出跨境引擎；data_route 可保持 domestic');
  process.exit(0);
}

main();
