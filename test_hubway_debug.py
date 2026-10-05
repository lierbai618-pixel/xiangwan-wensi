#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""z.hubway.cc 排查：去 web_search_options + 最简请求"""

import json, time, http.client, ssl

API_KEY = "sk-YOUR_API_KEY_HERE"
BASE_HOST = "z.hubway.cc"
HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
    "Accept": "application/json",
    "Authorization": f"Bearer {API_KEY}",
}

def call(model, question, web_search=False):
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": "你是知识助手。"},
            {"role": "user", "content": question}
        ],
        "stream": False,
        "max_tokens": 500,
    }
    if web_search:
        body["web_search_options"] = {}
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    conn = http.client.HTTPSConnection(BASE_HOST, context=ssl.create_default_context(), timeout=30)
    start = time.time()
    try:
        conn.request("POST", "/v1/chat/completions", body=payload, headers=HEADERS)
        resp = conn.getresponse()
        data = resp.read().decode("utf-8")
        elapsed = int((time.time() - start) * 1000)
        if resp.status != 200:
            return False, elapsed, None, f"HTTP {resp.status}: {data[:400]}"
        obj = json.loads(data)
        content = obj.get("choices", [{}])[0].get("message", {}).get("content", "")
        return True, elapsed, content, None
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return False, elapsed, None, str(e)
    finally:
        conn.close()


print("排查 z.hubway.cc (去 web_search_options)")
print("=" * 60)

# 1. 最简请求，无 web_search
print("\n[测试1] 无 web_search_options，gpt-5.4-mini")
ok, lat, content, err = call("gpt-5.4-mini", "一句话介绍北京")
print(f"  ({'✅' if ok else '❌'}) {lat}ms")
print(f"  {content if content else err}")

# 2. 带 web_search
print("\n[测试2] 带 web_search_options，gpt-5.4-mini")
ok, lat, content, err = call("gpt-5.4-mini", "一句话介绍北京", web_search=True)
print(f"  ({'✅' if ok else '❌'}) {lat}ms")
print(f"  {content if content else err}")

# 3. 换 codex-auto-review
print("\n[测试3] codex-auto-review 模型")
ok, lat, content, err = call("codex-auto-review", "你好")
print(f"  ({'✅' if ok else '❌'}) {lat}ms")
print(f"  {content if content else err}")

# 4. 换 gpt-5.6-sol
print("\n[测试4] gpt-5.6-sol 模型")
ok, lat, content, err = call("gpt-5.6-sol", "一句话介绍上海")
print(f"  ({'✅' if ok else '❌'}) {lat}ms")
print(f"  {content if content else err}")
