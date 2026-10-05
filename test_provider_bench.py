# -*- coding: utf-8 -*-
"""
双 Provider 同基准 benchmark：
  - qwen  slot  -> 阿里云百炼中转 deepseek-v4-flash-0731 (enable_search)
  - agnes slot  -> apihub.agnes-ai.com agnes-2.0-flash (web_search_options + reasoning_effort:low)
统一 3 问法，记录：延迟(s) / 是否结构化 search_results / content 字数 / 成功率。
"""
import urllib.request
import json
import ssl
import time

QWEN_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
QWEN_KEY = "sk-YOUR_API_KEY_HERE"
QWEN_MODEL = "deepseek-v4-flash-0731"

AGNES_URL = "https://apihub.agnes-ai.com/v1/chat/completions"
AGNES_KEY = "sk-YOUR_API_KEY_HERE"
AGNES_MODEL = "agnes-2.0-flash"

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

SYS = "你是一个知识问答助手。请提供信息密度高、细节充实的回答，直接给出关键事实，不重复问题、不客套开场。"

def call(url, key, model, q, extra, max_tokens):
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYS},
            {"role": "user", "content": q},
        ],
        "stream": False,
        "max_tokens": max_tokens,
    }
    body.update(extra)
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Authorization", "Bearer " + key)
    req.add_header("Content-Type", "application/json; charset=utf-8")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=45, context=ctx) as resp:
            raw = resp.read().decode("utf-8", "replace")
            dt = time.time() - t0
            return dt, json.loads(raw), None
    except urllib.error.HTTPError as e:
        return time.time() - t0, None, e.read().decode("utf-8", "replace")
    except Exception as e:
        return time.time() - t0, None, str(e)

def extract(data):
    if not data:
        return "", None
    choices = data.get("choices") or [{}]
    msg = choices[0].get("message", {}) if choices else {}
    content = (msg.get("content") or "").strip()
    # 结构化搜索结果探测
    sr = None
    ext = msg.get("extended")
    if isinstance(ext, dict):
        si = ext.get("search_info")
        if isinstance(si, dict):
            sr = si.get("search_results")
    if not isinstance(sr, list):
        sr = None
    return content, sr

QUESTIONS = [
    ("人物-付航", "付航是谁？简要介绍他的背景和代表作。"),
    ("实时-2024大选", "2024年美国总统大选的结果是什么？谁获胜？"),
    ("实时-科技新闻", "最近一周有什么值得关注的科技新闻？"),
]

qwen_extra = {"enable_search": True}
agnes_extra = {"web_search_options": {}, "reasoning_effort": "low"}

print("=== QWEN / %s (百炼中转, enable_search) ===" % QWEN_MODEL)
q_lat = []
for name, q in QUESTIONS:
    dt, data, err = call(QWEN_URL, QWEN_KEY, QWEN_MODEL, q, qwen_extra, 1024)
    if err:
        print("  [%s] ERR %.1fs  %s" % (name, dt, err[:160]))
        continue
    content, sr = extract(data)
    q_lat.append(dt)
    print("  [%s] %.1fs | content %d字 | search_results=%s"
          % (name, dt, len(content), ("有(%d条)" % len(sr) if sr else "无")))

print("\n=== AGNES / %s (web_search_options + reasoning_low) ===" % AGNES_MODEL)
a_lat = []
for name, q in QUESTIONS:
    dt, data, err = call(AGNES_URL, AGNES_KEY, AGNES_MODEL, q, agnes_extra, 2048)
    if err:
        print("  [%s] ERR %.1fs  %s" % (name, dt, err[:160]))
        continue
    content, sr = extract(data)
    a_lat.append(dt)
    print("  [%s] %.1fs | content %d字 | search_results=%s"
          % (name, dt, len(content), ("有(%d条)" % len(sr) if sr else "无")))

print("\n=== 汇总 ===")
if q_lat:
    print("QWEN  平均延迟: %.2fs (n=%d)" % (sum(q_lat)/len(q_lat), len(q_lat)))
if a_lat:
    print("AGNES 平均延迟: %.2fs (n=%d)" % (sum(a_lat)/len(a_lat), len(a_lat)))
