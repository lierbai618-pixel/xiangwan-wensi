// ============================================================
// providers/search/mock.js
//   Phase Q2-1：Mock 检索源（仅测试/联调用，永不服务真实用户）。
//   返回确定性、带 [MOCK] 标记的占位结果，用于验证统一接口与引用结构。
//   不发起任何网络请求。零外部依赖。
// ============================================================
'use strict';

function mockSearch(query, opts) {
  var q = (query || '').toString().trim();
  var results = [
    {
      title: '[MOCK] 关于「' + q.slice(0, 20) + '」的公开信息摘要',
      url: 'https://mock.local/result?q=' + encodeURIComponent(q.slice(0, 40)),
      snippet: '[MOCK] 这是用于联调的占位事实摘要，仅验证引用结构可用，不代表任何真实事件。',
      source: 'mock.local',
      time: new Date().toISOString().slice(0, 10),
    },
    {
      title: '[MOCK] 背景与多方视角',
      url: 'https://mock.local/context?q=' + encodeURIComponent(q.slice(0, 40)),
      snippet: '[MOCK] 提供第二条占位来源，用于验证多来源引用与冲突检测逻辑。',
      source: 'mock.local',
      time: new Date().toISOString().slice(0, 10),
    },
  ];
  return Promise.resolve({ ok: true, provider: 'mock', results: results, reason: '' });
}

module.exports = { search: mockSearch };
