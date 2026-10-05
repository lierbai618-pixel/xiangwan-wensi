# -*- coding: utf-8 -*-
"""
api.hcnsec.cn 模型响应速度测试（流式：TTFT + 总耗时）
贴合「向晚问思」场景：用一道哲学题 + 一道简单题。
"""
import json, os, ssl, time, sys, urllib.request, datetime

API_BASE = "https://api.hcnsec.cn/v1/chat/completions"
API_KEY = os.environ.get("HCNSEC_KEY", "sk-YOUR_API_KEY_HERE")

# 复测：上一轮因解析 bug（choices:[] 收尾包）误判的模型
MODELS = [
    "kat-coder-pro-v2.5", "MiniMax-M3", "sensenova-6.7-flash-lite",
    "step-3.5-flash", "step-3.5-flash-2603",
]

# 测试题：极简一句话，纯压速度（分诊用）
QUESTIONS = [
    ("simple", "用一句话回答：今天适合思考吗？"),
]

TRIALS = 1
TIMEOUT = 30

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


def call(model, q, timeout=TIMEOUT):
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": q}],
        "stream": True,
        "temperature": 0.35,
        "max_tokens": 800,
    }).encode("utf-8")
    req = urllib.request.Request(API_BASE, data=body, method="POST")
    req.add_header("Authorization", "Bearer " + API_KEY)
    req.add_header("Content-Type", "application/json; charset=utf-8")

    t0 = time.time()
    ttft = None
    chunks = 0
    text = []
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except Exception:
                    continue
                if ttft is None:
                    ttft = time.time() - t0
                choices = obj.get("choices") or [{}]
                ch0 = choices[0] if choices else {}
                delta = ch0.get("delta", {}).get("content")
                if delta:
                    text.append(delta)
                    chunks += 1
    except Exception as e:
        return {
            "ok": False, "ttft": None, "total": time.time() - t0,
            "chars": 0, "error": str(e)[:200], "sample": "",
        }
    total = time.time() - t0
    full = "".join(text)
    return {
        "ok": True, "ttft": ttft, "total": total,
        "chars": len(full), "error": "", "sample": full[:120],
    }


def main():
    results = {}
    for model in MODELS:
        results[model] = {}
        print("[MODEL] %s" % model, flush=True)
        for tag, q in QUESTIONS:
            rec = {"ttfts": [], "totals": [], "chars": [], "ok": 0, "samples": [], "errors": []}
            for t in range(TRIALS):
                r = call(model, q)
                if r["ok"]:
                    rec["ok"] += 1
                    if r["ttft"] is not None:
                        rec["ttfts"].append(round(r["ttft"], 2))
                    rec["totals"].append(round(r["total"], 2))
                    rec["chars"].append(r["chars"])
                    if t == 0:
                        rec["samples"].append(r["sample"])
                else:
                    rec["errors"].append(r["error"])
                st = "OK %.2fs(ttft %.2fs)" % (r["total"], r["ttft"] or 0) if r["ok"] else "ERR %s" % r["error"][:60]
                print("   [%s] trial%d: %s" % (tag, t + 1, st), flush=True)
            results[model][tag] = rec

    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    out = "D:/不知道是啥/教员/weapp/scripts/hcnsec_bench_%s.json" % ts
    with open(out, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    # 汇总表（按哲学题平均总耗时排序）
    print("\n===== 汇总（极简题，总耗时升序）=====", flush=True)
    rows = []
    for model in MODELS:
        rec = results[model].get("simple", {})
        if rec.get("totals"):
            avg = sum(rec["totals"]) / len(rec["totals"])
            ttavg = sum(rec["ttfts"]) / len(rec["ttfts"]) if rec["ttfts"] else 0
            rows.append((avg, model, rec["ok"], ttavg, rec["chars"]))
    rows.sort()
    print("%-24s %8s %5s %8s %8s" % ("model", "avg总耗时", "成功", "首字延迟", "字数"), flush=True)
    for avg, model, ok, ttavg, ch in rows:
        print("%-24s %7.2fs %4d/2 %7.2fs %7d" % (model, avg, ok, ttavg, (sum(ch)//len(ch)) if ch else 0), flush=True)
    print("\nJSON -> %s" % out, flush=True)


if __name__ == "__main__":
    main()
