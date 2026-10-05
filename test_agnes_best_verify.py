#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
验证最优配置：agnes-2.0-flash + 2048 + reasoning_low
测试全部3个问题，确认稳定性与质量
"""

import json, time, http.client, ssl

API_KEY = "sk-YOUR_API_KEY_HERE"
HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
    "Accept": "application/json",
    "Authorization": f"Bearer {API_KEY}",
}

QUESTIONS = [
    "2026年8月8日，中国今天有什么重大新闻事件？",
    "2024年美国总统大选是谁获胜？",
    "向晚问思是什么？",
]

BODY_TEMPLATE = {
    "model": "agnes-2.0-flash",
    "messages": [
        {"role": "system", "content": "你是知识助手。直给关键事实，不客套，不重复问题。"},
    ],
    "stream": False,
    "max_tokens": 2048,
    "web_search_options": {},
    "reasoning_effort": "low",
}


def call(question):
    body = dict(BODY_TEMPLATE)
    body["messages"] = [
        {"role": "system", "content": "你是知识助手。直给关键事实，不客套，不重复问题。"},
        {"role": "user", "content": question}
    ]
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    conn = http.client.HTTPSConnection("apihub.agnes-ai.com", context=ssl.create_default_context(), timeout=25)
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


print("验证最优配置: agnes-2.0-flash + 2048 + reasoning_low")
print("=" * 60)
results = []
for i, q in enumerate(QUESTIONS, 1):
    ok, lat, content, usage, err = call(q)
    results.append({"q": i, "ok": ok, "lat": lat, "content": content, "usage": usage, "err": err})
    status = "✅" if ok else "❌"
    print(f"\nQ{i} ({status}) {lat}ms")
    if content:
        print(content[:400] + ("..." if len(content) > 400 else ""))
    if err:
        print(f"ERROR: {err}")
    if usage:
        comp = usage.get("completion_tokens", 0)
        rd = usage.get("completion_tokens_details", {}).get("reasoning_tokens", 0)
        txt = usage.get("completion_tokens_details", {}).get("text_tokens", 0)
        print(f"usage: comp={comp} reasoning={rd} text={txt}")

print(f"\n{'='*60}")
ok_count = sum(1 for r in results if r["ok"])
avg_lat = sum(r["lat"] for r in results) / len(results)
avg_len = sum(len(r["content"] or "") for r in results if r["ok"]) / max(1, ok_count)
print(f"结果: {ok_count}/{len(results)} 成功 | 平均延迟 {avg_lat:.0f}ms | 平均字数 {avg_len:.0f}")

with open("agnes_best_config_verify.json", "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)
