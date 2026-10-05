#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试 z.hubway.cc 的 chat/completions 接口
测试模型：gpt-5.4-mini, gpt-5.5, gpt-5.6
对比速度/质量/联网能力
"""

import json, time, http.client, ssl

API_KEY = "sk-YOUR_API_KEY_HERE"
BASE_HOST = "z.hubway.cc"
HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
    "Accept": "application/json",
    "Authorization": f"Bearer {API_KEY}",
}

MODELS = ["gpt-5.4-mini", "gpt-5.5", "gpt-5.6"]
QUESTIONS = [
    "2026年8月8日，中国今天有什么重大新闻事件？",
    "付航是谁？请详细介绍他的职业和成就。",
]

def call(model, question):
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": "你是知识助手。直给关键事实，不客套，不重复问题。"},
            {"role": "user", "content": question}
        ],
        "stream": False,
        "max_tokens": 1024,
        "web_search_options": {},
    }
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    conn = http.client.HTTPSConnection(BASE_HOST, context=ssl.create_default_context(), timeout=30)
    start = time.time()
    try:
        conn.request("POST", "/v1/chat/completions", body=payload, headers=HEADERS)
        resp = conn.getresponse()
        data = resp.read().decode("utf-8")
        elapsed = int((time.time() - start) * 1000)
        if resp.status != 200:
            return False, elapsed, None, None, f"HTTP {resp.status}: {data[:300]}"
        obj = json.loads(data)
        choices = obj.get("choices", [])
        if not choices:
            return False, elapsed, None, None, "no choices"
        content = choices[0].get("message", {}).get("content", "")
        usage = obj.get("usage", {})
        return True, elapsed, content, usage, None
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return False, elapsed, None, None, str(e)
    finally:
        conn.close()


print("测试 z.hubway.cc chat 接口")
print("=" * 60)
for model in MODELS:
    print(f"\n>>> {model}")
    for i, q in enumerate(QUESTIONS, 1):
        ok, lat, content, usage, err = call(model, q)
        status = "✅" if ok else "❌"
        print(f"  Q{i} ({status}) {lat}ms | len={len(content) if content else 0}")
        if content:
            preview = content[:250] + ("..." if len(content) > 250 else "")
            print(f"     {preview}")
        if err:
            print(f"     ERROR: {err[:150]}")
        if usage:
            print(f"     usage: {usage}")
