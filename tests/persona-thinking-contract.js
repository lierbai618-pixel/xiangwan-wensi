#!/usr/bin/env node
'use strict';

/**
 * personaGen 思考链开关契约测试
 *
 * 背景（2026-09-21 CR-模型三层配置）：
 *   deepseek 系为思考型模型，不传 enable_thinking:false 会先吐 reasoning_content，
 *   把 max_tokens 吃光 → content 为空 → 该模型被静默跳过、降级到下一个。
 *   而当前链路把 deepseek-v4.1-flash 放在主模型位，所以这个参数是「主模型能不能生效」的前提。
 *
 * 本测试用本地 HTTP 服务器截获真实请求体，断言：
 *   [1] model 为 deepseek-v4* → 必须注入 enable_thinking:false（非流式 & 流式）
 *   [2] model 不为 deepseek-v4* → 必须【不】注入（避免影响 qwen / agnes 通道）
 *   [3] GEN_DISABLE_THINKING=true 时对任意模型都注入（逃生开关）
 *
 * 运行：node tests/persona-thinking-contract.js
 */

const http = require('http');
const path = require('path');

const personaGen = require(path.join(__dirname, '..', 'cloudfunctions', 'chat', 'personaGen.js'));

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log('  \u2713 ' + name);
  } else {
    fail += 1;
    failures.push(name);
    console.log('  \u2717 ' + name + (extra ? '  → ' + extra : ''));
  }
}

// 截获请求体的本地服务器
function startServer() {
  return new Promise(function (resolve) {
    const captured = [];
    const server = http.createServer(function (req, res) {
      let raw = '';
      req.on('data', function (c) { raw += c; });
      req.on('end', function () {
        let body = null;
        try { body = JSON.parse(raw); } catch (e) {}
        captured.push(body);

        if (body && body.stream) {
          // SSE 形态：至少推一个 delta，否则 generateStream 视为失败
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }) + '\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
        }
      });
    });
    server.listen(0, '127.0.0.1', function () {
      const port = server.address().port;
      resolve({
        port: port,
        captured: captured,
        close: function () { return new Promise(function (r) { server.close(r); }); },
      });
    });
  });
}

(async function main() {
  const srv = await startServer();
  const BASE = 'http://127.0.0.1:' + srv.port;
  const cfg = function (model) { return [{ name: 'test', baseURL: BASE, apiKey: 'sk-test', model: model }]; };

  console.log('[1] deepseek-v4 系 → 必须注入 enable_thinking:false');

  await personaGen.generate(cfg('deepseek-v4.1-flash'), 'sys', 'user');
  let b = srv.captured[srv.captured.length - 1];
  ok('非流式 · deepseek-v4.1-flash 注入 enable_thinking', b && b.enable_thinking === false,
    b ? '实际 = ' + JSON.stringify(b.enable_thinking) : '未捕获请求体');

  await personaGen.generate(cfg('deepseek-v4-pro-0813'), 'sys', 'user');
  b = srv.captured[srv.captured.length - 1];
  ok('非流式 · deepseek-v4-pro-0813 注入 enable_thinking', b && b.enable_thinking === false,
    b ? '实际 = ' + JSON.stringify(b.enable_thinking) : '未捕获请求体');

  await personaGen.generateStream(cfg('deepseek-v4.1-flash'), 'sys', 'user', function () {});
  b = srv.captured[srv.captured.length - 1];
  ok('流式 · deepseek-v4.1-flash 注入 enable_thinking', b && b.enable_thinking === false,
    b ? '实际 = ' + JSON.stringify(b.enable_thinking) : '未捕获请求体');
  ok('流式 · deepseek 仍保留 stream:true / max_tokens', !!b && b.stream === true && b.max_tokens === 1536,
    b ? 'stream=' + b.stream + ' max_tokens=' + b.max_tokens : '');

  console.log('\n[2] 非 deepseek 模型 → 必须【不】注入（保护 qwen / agnes 通道）');

  await personaGen.generate(cfg('qwen-plus'), 'sys', 'user');
  b = srv.captured[srv.captured.length - 1];
  ok('非流式 · qwen-plus 不含 enable_thinking', b && !('enable_thinking' in b),
    b ? '实际 keys = ' + Object.keys(b).join(',') : '');

  await personaGen.generate(cfg('agnes-2.5-flash'), 'sys', 'user');
  b = srv.captured[srv.captured.length - 1];
  ok('非流式 · agnes-2.5-flash 不含 enable_thinking', b && !('enable_thinking' in b),
    b ? '实际 keys = ' + Object.keys(b).join(',') : '');

  await personaGen.generateStream(cfg('agnes-2.5-flash'), 'sys', 'user', function () {});
  b = srv.captured[srv.captured.length - 1];
  ok('流式 · agnes-2.5-flash 不含 enable_thinking', b && !('enable_thinking' in b),
    b ? '实际 keys = ' + Object.keys(b).join(',') : '');

  console.log('\n[3] GEN_DISABLE_THINKING=true → 任意模型都注入（逃生开关）');
  process.env.GEN_DISABLE_THINKING = 'true';
  await personaGen.generate(cfg('qwen-plus'), 'sys', 'user');
  b = srv.captured[srv.captured.length - 1];
  ok('逃生开关 · qwen-plus 也被注入', b && b.enable_thinking === false,
    b ? '实际 = ' + JSON.stringify(b.enable_thinking) : '');
  delete process.env.GEN_DISABLE_THINKING;

  console.log('\n[4] 请求体结构完整性（未被改造破坏）');
  await personaGen.generate(cfg('deepseek-v4.1-flash'), 'SYS_PROMPT', 'USER_MSG');
  b = srv.captured[srv.captured.length - 1];
  ok('messages 仍为 [system, user] 两条', !!b && Array.isArray(b.messages) && b.messages.length === 2
    && b.messages[0].role === 'system' && b.messages[1].role === 'user');
  ok('system / user 内容原样透传', !!b && b.messages[0].content === 'SYS_PROMPT' && b.messages[1].content === 'USER_MSG');
  ok('model 字段原样', !!b && b.model === 'deepseek-v4.1-flash');

  await srv.close();

  console.log('\n' + '='.repeat(56));
  console.log('PASS: ' + pass + '    FAIL: ' + fail);
  if (fail) console.log('失败项：\n  - ' + failures.join('\n  - '));
  else console.log('全部通过：deepseek 系必注入、其他模型零影响。');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('测试自身异常：', e && e.stack || e);
  process.exit(1);
});
