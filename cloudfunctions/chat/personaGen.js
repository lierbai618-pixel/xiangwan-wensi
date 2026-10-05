// personaGen.js —— 先贤视角 / 苏格拉底追问 的「人格纯生成」层。
//   设计原则：
//   · 复用后台 model_config 中 order 最小的「对话模型」（与 rag.js generateAnswer 同模型，
//     实测 ~8s 可达），只把 system prompt 换成人格口吻，不触碰冻结资产 rag.js。
//   · 不联网（networkNeeded=false），纯人格表达，最快且不被联网噪音污染。
//   · Node16 原生 https，无原生 fetch 依赖（与项目其余模块一致）。
//   · fail-soft：任何异常向上抛出，由 index.js 回退常规链路（仍给答案，仅无人格）。

function _postJson(baseURL, apiKey, model, systemContent, userContent, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var url;
    try { url = new (require('url').URL)(baseURL); } catch (e) { reject(new Error('bad baseURL')); return; }
    // 2026-09-21 CR-模型三层配置：deepseek 系为思考型模型，不关思考会先吐 reasoning_content
    //   把 max_tokens 吃光，导致 content 为空（实测默认参数下 0 字、finish_reason=length）。
    //   仅对 deepseek-v4 前缀注入；qwen 系已实测兼容该参数（4/4 无 400），agnes 通道不受影响。
    var payload = {
      model: model,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent }
      ],
      stream: false,
      max_tokens: 1024
    };
    if (/^deepseek-v4/i.test(model) || process.env.GEN_DISABLE_THINKING === 'true') {
      payload.enable_thinking = false;
    }
    var body = JSON.stringify(payload);
    var reqOpts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + (url.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + (apiKey || '')
      },
      timeout: timeoutMs || 20000
    };
    var mod = url.protocol === 'https:' ? require('https') : require('http');
    var req = mod.request(reqOpts, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var buf = Buffer.concat(chunks).toString();
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error('HTTP_' + res.statusCode + ' ' + buf.slice(0, 120)));
          return;
        }
        try {
          var data = JSON.parse(buf);
          // OpenAI 兼容：choices[0].message.content
          var content = data && data.choices && data.choices[0] && data.choices[0].message
            ? data.choices[0].message.content
            : (data && data.output && data.output.text ? data.output.text : '');
          if (!content) { reject(new Error('empty_content')); return; }
          resolve(content.toString().trim());
        } catch (e) {
          reject(new Error('parse_error ' + buf.slice(0, 120)));
        }
      });
    });
    req.on('error', function (e) { reject(e); });
    req.on('timeout', function () { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * 生成人格回答。支持多模型兜底：modelCfg 可为单条配置或配置数组，
 * 按顺序逐模型尝试，成功即返回；全部失败抛出最后的错误（由 index.js 回退常规链路）。
 * 与冻结 rag.js 的 tryModelAnswer 兜底语义保持一致。
 * @param {Object|Array} modelCfg  model_config 条目 { baseURL, apiKey, model, timeout } 或数组
 * @param {string} persona   人格 system prompt（来自 modePersona）
 * @param {string} query     用户问题
 * @param {number} [timeoutMs=20000] 单模型默认超时（可被 cfg.timeout 覆盖）
 * @returns {Promise<string>} 模型文本
 */
async function generate(modelCfg, persona, query, timeoutMs) {
  var cfgs = Array.isArray(modelCfg) ? modelCfg : [modelCfg];
  var systemContent = persona && persona.trim()
    ? persona
    : '你是一个知识问答助手。请提供信息密度高、细节充实的回答，直接给出关键事实，不重复问题、不客套开场。';
  var lastErr = '';
  for (var i = 0; i < cfgs.length; i++) {
    var cfg = cfgs[i];
    if (!cfg || !cfg.baseURL) continue;
    try {
      var baseURL = (cfg.baseURL || '').toString().trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '') + '/chat/completions';
      var t = cfg.timeout || timeoutMs || 20000;
      var text = await _postJson(baseURL, cfg.apiKey, cfg.model, systemContent, query, t);
      if (text) return text;
    } catch (e) {
      lastErr = (e && e.message) ? e.message : '' + e;
      console.warn('[persona] 模型 #' + (i + 1) + ' ' + (cfg.name || cfg.model) + ' 失败：' + lastErr);
    }
  }
  throw new Error(lastErr || 'no_model_cfg');
}

/**
 * 流式生成（SSE）。逐 chunk 调用 onChunk(delta)，任一模型成功推流即提交（不再回退，
 * 避免已推内容重复）。与 generate 共享多模型兜底语义；不改冻结 rag.js。
 * @returns {Promise<string>} 实际采用的模型名（用于 _modelUsed 透传）
 */
async function generateStream(modelCfg, persona, query, onChunk, timeoutMs) {
  var cfgs = Array.isArray(modelCfg) ? modelCfg : [modelCfg];
  var systemContent = persona && persona.trim()
    ? persona
    : '你是一个知识问答助手。请提供信息密度高、细节充实的回答，直接给出关键事实，不重复问题、不客套开场。';
  var lastErr = '';
  for (var i = 0; i < cfgs.length; i++) {
    var cfg = cfgs[i];
    if (!cfg || !cfg.baseURL) continue;
    try {
      var baseURL = (cfg.baseURL || '').toString().trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '') + '/chat/completions';
      var t = cfg.timeout || timeoutMs || 30000;
      var ok = await _postStream(baseURL, cfg.apiKey, cfg.model, systemContent, query, onChunk, t);
      if (ok) return (cfg.model || cfg.name || 'model');
      lastErr = 'no_content_from_' + (cfg.name || cfg.model);
    } catch (e) {
      lastErr = (e && e.message) ? e.message : '' + e;
      console.warn('[persona-stream] 模型 #' + (i + 1) + ' ' + (cfg.name || cfg.model) + ' 失败：' + lastErr);
    }
  }
  throw new Error(lastErr || 'no_model_cfg');
}

function _postStream(baseURL, apiKey, model, systemContent, userContent, onDelta, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var url;
    try { url = new (require('url').URL)(baseURL); } catch (e) { reject(new Error('bad baseURL')); return; }
    // 同 _postJson：deepseek 系必须关思考链，否则 content 恒为空。
    //   流式下思考链还会抢在正文前推送，把首字延迟从 ~1.2s 推到 10s+。
    var payload = {
      model: model,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent }
      ],
      stream: true,
      max_tokens: 1536
    };
    if (/^deepseek-v4/i.test(model) || process.env.GEN_DISABLE_THINKING === 'true') {
      payload.enable_thinking = false;
    }
    var body = JSON.stringify(payload);
    var reqOpts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + (url.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Authorization': 'Bearer ' + (apiKey || '')
      },
      timeout: timeoutMs || 30000
    };
    var mod = url.protocol === 'https:' ? require('https') : require('http');
    var pushed = false;
    var buf = '';
    var req = mod.request(reqOpts, function (res) {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        var errBuf = [];
        res.on('data', function (c) { errBuf.push(c); });
        res.on('end', function () { reject(new Error('HTTP_' + res.statusCode + ' ' + Buffer.concat(errBuf).toString().slice(0, 120))); });
        return;
      }
      res.setEncoding('utf-8');
      res.on('data', function (chunk) {
        buf += chunk;
        var idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          var line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line || line.indexOf('data:') !== 0) continue;
          var data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            var obj = JSON.parse(data);
            // OpenAI 兼容：choices[0].delta.content；忽略 reasoning_content（思考链不推前端）
            var choices = obj.choices || [];
            var delta = (choices[0] && choices[0].delta) ? (choices[0].delta.content || '') : '';
            if (delta) {
              pushed = true;
              try { onDelta(delta); } catch (e) {}
            }
          } catch (e) { /* 跳过非 JSON / 心跳行 */ }
        }
      });
      res.on('end', function () { resolve(pushed); });
    });
    req.on('error', function (e) { reject(e); });
    req.on('timeout', function () { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

module.exports = { generate: generate, generateStream: generateStream };
