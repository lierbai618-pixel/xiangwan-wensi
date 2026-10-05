#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Agnes AI 模型对比测试脚本
测试模型：agnes-2.0-flash, agnes-1.5-flash, agnes-2.5-flash, agnes-2.5-pro, agnes-2.5-pro-alpha
排除：video/image 类模型（非文本搜索场景）
"""

import json
import time
import http.client
import urllib.parse
import ssl

API_KEY = "sk-YOUR_API_KEY_HERE"
BASE_URL = "apihub.agnes-ai.com"
PATH = "/v1/chat/completions"

MODELS = [
    "agnes-2.0-flash",
    "agnes-1.5-flash",
    "agnes-2.5-flash",
    "agnes-2.5-pro",
    "agnes-2.5-pro-alpha",
]

QUESTIONS = [
    "2026年8月8日，中国今天有什么重大新闻事件？",
    "2024年美国总统大选是谁获胜？",
    "向晚问思是什么？",
]

HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
    "Accept": "application/json",
    "Authorization": f"Bearer {API_KEY}",
}


def call_model(model, question, enable_web_search=True):
    """调用指定模型，返回 (success, latency_ms, content, usage, error)"""
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": "你是知识助手。直给关键事实，不客套，不重复问题。"},
            {"role": "user", "content": question}
        ],
        "stream": False,
        "max_tokens": 1024,
    }
    if enable_web_search:
        body["web_search_options"] = {}

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

        try:
            obj = json.loads(data)
        except json.JSONDecodeError as e:
            return False, elapsed, None, None, f"JSON parse error: {e}"

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


def test_all():
    results = []
    for model in MODELS:
        print(f"\n{'='*60}")
        print(f"模型: {model}")
        print('=' * 60)
        for q_idx, question in enumerate(QUESTIONS, 1):
            # 测试带联网
            ok, lat, content, usage, err = call_model(model, question, enable_web_search=True)
            result = {
                "model": model,
                "question_idx": q_idx,
                "question": question,
                "web_search": True,
                "ok": ok,
                "latency_ms": lat,
                "content_len": len(content) if content else 0,
                "content_preview": (content[:200] + "...") if content and len(content) > 200 else content,
                "usage": usage,
                "error": err,
            }
            results.append(result)

            status = "✅" if ok else "❌"
            print(f"  Q{q_idx} ({status}) {lat}ms | len={result['content_len']}")
            if content:
                print(f"     {result['content_preview']}")
            if err:
                print(f"     ERROR: {err}")
            if usage:
                print(f"     usage: {usage}")

    # 汇总评分
    print(f"\n\n{'='*60}")
    print("汇总对比")
    print('=' * 60)
    for model in MODELS:
        model_results = [r for r in results if r["model"] == model]
        ok_count = sum(1 for r in model_results if r["ok"])
        avg_lat = sum(r["latency_ms"] for r in model_results) / len(model_results) if model_results else 0
        avg_len = sum(r["content_len"] for r in model_results if r["ok"]) / max(1, ok_count)
        errors = [r["error"] for r in model_results if not r["ok"] and r["error"]]
        print(f"{model}: 成功率 {ok_count}/{len(model_results)} | 平均延迟 {avg_lat:.0f}ms | 平均字数 {avg_len:.0f}")
        if errors:
            for e in errors[:2]:
                print(f"  错误: {e[:100]}")

    # 保存完整结果
    with open("agnes_model_benchmark.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print("\n完整结果已保存到 agnes_model_benchmark.json")


if __name__ == "__main__":
    test_all()
