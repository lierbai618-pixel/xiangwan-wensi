#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Agnes 模型深度测试：
1. 关闭/降低 reasoning 对 flash 模型的影响
2. 用已知可搜索问题（付航）测试所有模型实际搜索能力
3. 对比 max_tokens 2048 vs 1024
"""

import json, time, http.client, ssl

API_KEY = "sk-YOUR_API_KEY_HERE"
BASE_URL = "apihub.agnes-ai.com"
PATH = "/v1/chat/completions"

HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
    "Accept": "application/json",
    "Authorization": f"Bearer {API_KEY}",
}

MODELS = ["agnes-2.0-flash", "agnes-2.5-flash", "agnes-2.5-pro"]

TESTS = [
    {"name": "标准1024+web_search", "max_tokens": 1024, "web_search": True, "extra": {}},
    {"name": "标准2048+web_search", "max_tokens": 2048, "web_search": True, "extra": {}},
    {"name": "2048+reasoning_low", "max_tokens": 2048, "web_search": True, "extra": {"reasoning_effort": "low"}},
    {"name": "2048+no_reasoning", "max_tokens": 2048, "web_search": True, "extra": {"reasoning": False}},
]

QUESTION = "付航是谁？请详细介绍他的职业和成就。"


def call_model(model, question, max_tokens, web_search, extra):
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": "你是知识助手。直给关键事实，不客套，不重复问题。"},
            {"role": "user", "content": question}
        ],
        "stream": False,
        "max_tokens": max_tokens,
    }
    if web_search:
        body["web_search_options"] = {}
    if extra:
        body.update(extra)

    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    conn = http.client.HTTPSConnection(BASE_URL, context=ssl.create_default_context(), timeout=25)
    start = time.time()
    try:
        conn.request("POST", PATH, body=payload, headers=HEADERS)
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


print(f"问题: {QUESTION}")
print(f"{'='*70}")

results = []
for model in MODELS:
    print(f"\n>>> 模型: {model}")
    for test in TESTS:
        ok, lat, content, usage, err = call_model(
            model, QUESTION, test["max_tokens"], test["web_search"], test["extra"]
        )
        result = {
            "model": model,
            "test": test["name"],
            "ok": ok,
            "latency_ms": lat,
            "content_len": len(content) if content else 0,
            "content_preview": (content[:300] + "...") if content and len(content) > 300 else content,
            "usage": usage,
            "error": err,
        }
        results.append(result)

        status = "✅" if ok else "❌"
        print(f"  [{status}] {test['name']:24s} {lat:5d}ms | len={result['content_len']:4d}", end="")
        if usage:
            comp = usage.get("completion_tokens", 0)
            rd = usage.get("completion_tokens_details", {}).get("reasoning_tokens", 0)
            txt = usage.get("completion_tokens_details", {}).get("text_tokens", 0)
            if rd:
                print(f" | comp={comp} reasoning={rd} text={txt}")
            else:
                print(f" | comp={comp}")
        else:
            print()
        if content and ok:
            print(f"       -> {result['content_preview']}")
        if err:
            print(f"       ERROR: {err[:120]}")

print(f"\n{'='*70}")
print("汇总（仅成功且content>0的）:")
for model in MODELS:
    ok_results = [r for r in results if r["model"] == model and r["ok"] and r["content_len"] > 0]
    if ok_results:
        avg_lat = sum(r["latency_ms"] for r in ok_results) / len(ok_results)
        avg_len = sum(r["content_len"] for r in ok_results) / len(ok_results)
        print(f"  {model}: {len(ok_results)}次成功 | 平均延迟 {avg_lat:.0f}ms | 平均字数 {avg_len:.0f}")
    else:
        print(f"  {model}: 无成功记录")

with open("agnes_model_deep_test.json", "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)
print("\n结果已保存到 agnes_model_deep_test.json")
