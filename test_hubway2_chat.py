# -*- coding: utf-8 -*-
import urllib.request
import json
import ssl

BASE = "https://hubway.cc/v1"
KEY = "sk-YOUR_API_KEY_HERE"

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def req(method, path, body=None):
    url = BASE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Authorization", "Bearer " + KEY)
    r.add_header("Content-Type", "application/json; charset=utf-8")
    try:
        with urllib.request.urlopen(r, timeout=30, context=ctx) as resp:
            raw = resp.read().decode("utf-8", "replace")
            return resp.status, raw
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return -1, str(e)

# chat 接口
print("=== /v1/chat/completions ===")
s, b = req("POST", "/chat/completions", {
    "model": "gpt-5.4-mini",
    "messages": [{"role": "user", "content": "一句话介绍你自己"}],
    "max_tokens": 200,
})
print("STATUS", s)
print(b[:1500])

# 根路径
print("\n=== GET / ===")
s2, b2 = req("GET", "/")
print("STATUS", s2)
print(b2[:500])
