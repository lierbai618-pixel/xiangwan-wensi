# -*- coding: utf-8 -*-
"""阶跃星辰(StepFun)官方 API 对话模型流式测速。
逐模型发极简题，记录 TTFT(首字延迟) 与总耗时；超时 30s 判失败。
仅测能跑 chat 的文本/对话模型；TTS/ASR/音频/图像/搜索类跳过。
"""
import urllib.request, json, time, datetime, sys

BASE = "https://api.stepfun.com/v1"
KEY = "1a4J8885S8e36iNSX18zAx9Frlqw4lBew7zfcAQ9LouB3ZVtM5ge6cdEdSNuzLpuN"
# 仅对话类模型（文本生成）。多模态视觉/音频模型纯文本可能不适用，先列出尝试。
MODELS = [
    "step-3.5-flash",
    "step-3.5-flash-2603",
    "step-3.7-flash",
    "step-2x-large",
    "step-router-v1",
    "step-overture-preview",
    "step-1o-turbo-vision",
]
PROMPT = "用一句话介绍孔子"
TIMEOUT = 30

def bench(m):
    payload = json.dumps({
        "model": m,
        "messages": [{"role": "user", "content": PROMPT}],
        "stream": True,
    }).encode("utf-8")
    req = urllib.request.Request(
        BASE + "/chat/completions",
        data=payload,
        headers={
            "Authorization": "Bearer " + KEY,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    t0 = time.time()
    ttft = None
    chunks = 0
    first_text = ""
    err = None
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except Exception:
                    continue
                choices = obj.get("choices") or [{}]
                delta = choices[0].get("delta") or {}
                c = delta.get("content")
                if c:
                    if ttft is None:
                        ttft = time.time() - t0
                        first_text = c
                    chunks += 1
        total = time.time() - t0
        ok = chunks > 0
        if not ok:
            err = "no_content_returned"
    except Exception as e:
        total = time.time() - t0
        ok = False
        err = str(e)
    return {
        "model": m,
        "ok": ok,
        "ttft_s": round(ttft, 3) if ttft is not None else None,
        "total_s": round(total, 3),
        "chunks": chunks,
        "first_text": first_text[:40],
        "error": err,
    }

if __name__ == "__main__":
    results = []
    print("=== StepFun 对话模型测速 (极简题, 流式) ===")
    for m in MODELS:
        r = bench(m)
        results.append(r)
        status = "OK " if r["ok"] else "FAIL"
        print(f"[{status}] {m:24s} TTFT={r['ttft_s']}s  total={r['total_s']}s  chunks={r['chunks']}  {r['error'] or ''}")
    # 排序（成功的按 TTFT 升序）
    ok_res = sorted([r for r in results if r["ok"]], key=lambda x: x["ttft_s"])
    print("\n=== 速度排名(成功模型, 按 TTFT) ===")
    for i, r in enumerate(ok_res, 1):
        print(f"{i}. {r['model']:24s} TTFT={r['ttft_s']}s  total={r['total_s']}s")
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    out = f"scripts/stepfun_bench_{ts}.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"models": MODELS, "prompt": PROMPT, "results": results,
                   "ranking": [r["model"] for r in ok_res]}, f, ensure_ascii=False, indent=2)
    print(f"\n原始数据: {out}")
