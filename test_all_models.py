# -*- coding: utf-8 -*-
"""
model_config 全量 benchmark：7 个模型 × 统一 3 问法。
记录延迟(s) / content 字数 / 成功率 / 是否空答。
"""
import urllib.request
import json
import ssl
import time

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

SYS = "你是一个知识问答助手。请提供信息密度高、细节充实的回答，直接给出关键事实，不重复问题、不客套开场。"

MODELS = [
    {
        "name": "hcnsec/DeepSeek-V4-Flash",
        "url": "https://api.hcnsec.cn/v1/chat/completions",
        "key": "sk-YOUR_API_KEY_HERE",
        "model": "DeepSeek-V4-Flash",
        "enabled": False,
    },
    {
        "name": "hcnsec/DeepSeek-V4-Pro",
        "url": "https://api.hcnsec.cn/v1/chat/completions",
        "key": "sk-YOUR_API_KEY_HERE",
        "model": "DeepSeek-V4-Pro",
        "enabled": False,
    },
    {
        "name": "阿里云MAAS/qwen-plus",
        "url": "https://ws-kkupdspdhy9hjxu7.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
        "key": "sk-YOUR_API_KEY_HERE",
        "model": "qwen-plus",
        "enabled": True,
    },
    {
        "name": "百炼/qwen-plus",
        "url": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        "key": "sk-YOUR_API_KEY_HERE",
        "model": "qwen-plus",
        "enabled": True,
    },
    {
        "name": "百炼/deepseek-v4-flash-0731",
        "url": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        "key": "sk-YOUR_API_KEY_HERE",
        "model": "deepseek-v4-flash-0731",
        "enabled": True,
    },
    {
        "name": "纪元律动/deepseek-v4-flash",
        "url": "https://tokenrhythm.studio/v1/chat/completions",
        "key": "sk_tr_L_816NCsfO1t79-12LWd7mTJAqkOYk6l7CZHtZCb5Mo",
        "model": "deepseek-v4-flash",
        "enabled": True,
    },
    {
        "name": "agnes/agnes-2.0-flash",
        "url": "https://apihub.agnes-ai.com/v1/chat/completions",
        "key": "sk-YOUR_API_KEY_HERE",
        "model": "agnes-2.0-flash",
        "enabled": True,
    },
]

QUESTIONS = [
    ("人物-付航", "付航是谁？简要介绍他的背景和代表作。"),
    ("实时-2024大选", "2024年美国总统大选的结果是什么？谁获胜？"),
    ("实时-科技新闻", "最近一周有什么值得关注的科技新闻？"),
]

def call(url, key, model, q):
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": SYS},
            {"role": "user", "content": q},
        ],
        "stream": False,
        "max_tokens": 1024,
    }).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Authorization", "Bearer " + key)
    req.add_header("Content-Type", "application/json; charset=utf-8")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
            raw = resp.read().decode("utf-8", "replace")
            dt = time.time() - t0
            data = json.loads(raw)
            choices = data.get("choices") or [{}]
            msg = choices[0].get("message", {}) if choices else {}
            content = (msg.get("content") or "").strip()
            return dt, content, None
    except urllib.error.HTTPError as e:
        return time.time() - t0, "", e.read().decode("utf-8", "replace")[:200]
    except Exception as e:
        return time.time() - t0, "", str(e)[:200]

print("=" * 80)
print("model_config 全量 benchmark — %d 个模型 × %d 问" % (len(MODELS), len(QUESTIONS)))
print("=" * 80)

results = {}
for m in MODELS:
    tag = "[%s]" % m["name"]
    en = "ON" if m["enabled"] else "OFF"
    print("\n%s  (enabled=%s)" % (tag, en))
    lats = []
    lens = []
    ok = 0
    for qn, q in QUESTIONS:
        dt, content, err = call(m["url"], m["key"], m["model"], q)
        if err:
            print("  [%s] ERR %.1fs  %s" % (qn, dt, err))
            lats.append(dt)
            lens.append(0)
        else:
            cl = len(content)
            ok += 1
            lats.append(dt)
            lens.append(cl)
            print("  [%s] %.1fs / %d字" % (qn, dt, cl))
    avg_t = sum(lats) / len(lats) if lats else 0
    avg_l = sum(lens) / len(lens) if lens else 0
    results[m["name"]] = {"avg_t": avg_t, "avg_l": avg_l, "ok": ok, "total": len(QUESTIONS)}
    print("  → 平均: %.1fs / %.0f字 | 成功: %d/%d" % (avg_t, avg_l, ok, len(QUESTIONS)))

print("\n" + "=" * 80)
print("排名（按平均延迟升序）")
print("=" * 80)
ranked = sorted(results.items(), key=lambda x: x[1]["avg_t"])
for i, (name, r) in enumerate(ranked):
    print("%d. %-35s  延迟%.1fs  字数%.0f  成功%d/%d"
          % (i+1, name, r["avg_t"], r["avg_l"], r["ok"], r["total"]))
