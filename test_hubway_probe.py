#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试 z.hubway.cc API
1. 探测 /v1/models 看有哪些模型
2. 测试 chat/completions 连通性
"""

import json, time, http.client, ssl

API_KEY = "sk-YOUR_API_KEY_HERE"
BASE_HOST = "z.hubway.cc"
HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
    "Accept": "application/json",
    "Authorization": f"Bearer {API_KEY}",
}


def probe(path):
    """GET 探测"""
    conn = http.client.HTTPSConnection(BASE_HOST, context=ssl.create_default_context(), timeout=20)
    start = time.time()
    try:
        conn.request("GET", path, headers=HEADERS)
        resp = conn.getresponse()
        data = resp.read().decode("utf-8")
        elapsed = int((time.time() - start) * 1000)
        return resp.status, elapsed, data[:2000]
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return None, elapsed, str(e)
    finally:
        conn.close()


print("探测 z.hubway.cc 可用路径...")
print("=" * 60)

# 尝试常见路径
paths = [
    "/v1/models",
    "/models",
    "/v1/chat/completions",
]

for p in paths:
    status, lat, body = probe(p)
    print(f"\nGET {p} | status={status} | {lat}ms")
    if status == 200:
        print(body[:1500])
    else:
        print(f"  {body[:500]}")
