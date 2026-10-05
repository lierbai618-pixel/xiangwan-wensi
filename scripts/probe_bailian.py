# -*- coding: utf-8 -*-
import json, os, ssl, time, urllib.request
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
url = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
key = os.environ.get("DASHSCOPE_API_KEY", "sk-YOUR_API_KEY_HERE")
body = json.dumps({
    "model": "qwen3.8-max",
    "messages": [{"role": "user", "content": "你好，简短回答"}],
    "stream": False,
    "max_tokens": 50,
}).encode("utf-8")
req = urllib.request.Request(url, data=body, method="POST")
req.add_header("Authorization", "Bearer " + key)
req.add_header("Content-Type", "application/json; charset=utf-8")
t0 = time.time()
try:
    with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
        raw = resp.read().decode("utf-8", "replace")
        print("OK %.1fs %s" % (time.time()-t0, raw[:200]))
except Exception as e:
    print("ERR %.1fs %s" % (time.time()-t0, str(e)[:300]))
