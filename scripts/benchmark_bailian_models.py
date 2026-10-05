# -*- coding: utf-8 -*-
"""
百炼模型统一 benchmark（向晚问思生成模型选型）
- 测试截图中列出的全部 modelCode
- 统一 system prompt + 2 类核心问题（思辨 / 苏格拉底追问）
- 并发按模型跑、每批 4 个，避免串行等待过久
- 输出：延迟 / 字数 / 成功率 / 错误 / 内容摘要

用法：
  python benchmark_bailian_models.py
  DASHSCOPE_API_KEY=sk-xxx python benchmark_bailian_models.py
"""
import json
import os
import ssl
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
API_KEY = os.environ.get("DASHSCOPE_API_KEY", "sk-YOUR_API_KEY_HERE")

# 截图中的 modelCode（按截图出现顺序）
MODELS = [
    "qwen3.8-max",
    "deepseek-v4-flash-0731",
    "qwen3.7-flash-2026-07-15",
    "qwen3.7-flash",
    "glm-5.2",
    "qwen3.5-ocr",
    "kimi-k2.7-code",
    "qwen3.7-max-2026-06-08",
    "qwen3.7-plus",
    "qwen3.7-plus-2026-05-26",
    "qwen3.7-max-2026-05-17",
    "qwen3.7-max-preview",
    "qwen3.7-max",
    "qwen3.7-max-2026-05-20",
]

SYSTEM_PROMPT = (
    "你是『向晚问思』的 AI 思辨助手，回答遵循五段式："
    "①先做人（从生命体验切入）；②再引经（援引中外经典，注明出处）；"
    "③做辨析（比较不同观点）；④给启发（留下可思考的问题）；⑤留余地（承认边界）。"
    "直接输出正文，不要重复问题，不要多余客套。"
)

QUESTIONS = [
    ("philosophy", "人应该如何面对死亡？"),
    ("socratic", "用苏格拉底式追问，帮我问清楚'我到底想不想辞职'。"),
]


def call(model, q, max_tokens=256, timeout=90):
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": q},
        ],
        "stream": False,
        "max_tokens": max_tokens,
    }, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(BASE_URL, data=body, method="POST")
    req.add_header("Authorization", "Bearer " + API_KEY)
    req.add_header("Content-Type", "application/json; charset=utf-8")

    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            raw = resp.read().decode("utf-8", "replace")
            dt = time.time() - t0
            data = json.loads(raw)
            choices = data.get("choices") or [{}]
            msg = choices[0].get("message", {}) if choices else {}
            content = (msg.get("content") or "").strip()
            reasoning = (msg.get("reasoning_content") or "").strip()
            usage = data.get("usage", {})
            return {
                "dt": dt,
                "content": content,
                "reasoning": reasoning,
                "err": None,
                "status": resp.status,
                "prompt_tokens": usage.get("prompt_tokens", 0),
                "completion_tokens": usage.get("completion_tokens", 0),
            }
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", "replace")[:500]
        return {"dt": time.time() - t0, "content": "", "reasoning": "", "err": f"HTTP {e.code}: {err_body}", "status": e.code, "prompt_tokens": 0, "completion_tokens": 0}
    except Exception as e:
        return {"dt": time.time() - t0, "content": "", "reasoning": "", "err": str(e)[:300], "status": 0, "prompt_tokens": 0, "completion_tokens": 0}


def test_model(model):
    row = {"model": model, "ok": 0, "lats": [], "lens": [], "tokens": [], "errors": [], "samples": {}}
    for tag, q in QUESTIONS:
        r = call(model, q)
        if r["err"]:
            row["errors"].append("%s: %s" % (tag, r["err"]))
            print("  [%s] %s ERR %.1fs  %s" % (model, tag, r["dt"], r["err"][:120]))
        else:
            row["ok"] += 1
            row["lats"].append(r["dt"])
            row["lens"].append(len(r["content"]))
            row["tokens"].append(r["completion_tokens"])
            row["samples"][tag] = r["content"][:200].replace("\n", " ")
            print("  [%s] %s %.1fs / %d字 / tok=%d" % (model, tag, r["dt"], len(r["content"]), r["completion_tokens"]))
    return row


def batched(iterable, n):
    for i in range(0, len(iterable), n):
        yield iterable[i:i + n]


def main():
    print("=" * 90)
    print("百炼模型 benchmark — %d 模型 × %d 问题 | %s" % (len(MODELS), len(QUESTIONS), datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
    print("BASE_URL:", BASE_URL)
    print("API_KEY :", API_KEY[:12] + "..." + API_KEY[-4:])
    print("=" * 90)

    results = []
    batch_size = 4
    for batch in batched(MODELS, batch_size):
        print("\n[批次] " + ", ".join(batch))
        with ThreadPoolExecutor(max_workers=batch_size) as ex:
            futures = {ex.submit(test_model, model): model for model in batch}
            for future in as_completed(futures):
                model = futures[future]
                try:
                    row = future.result()
                    avg_t = sum(row["lats"]) / len(row["lats"]) if row["lats"] else 999
                    avg_l = sum(row["lens"]) / len(row["lens"]) if row["lens"] else 0
                    avg_tok = sum(row["tokens"]) / len(row["tokens"]) if row["tokens"] else 0
                    row["avg_t"] = avg_t
                    row["avg_l"] = avg_l
                    row["avg_tok"] = avg_tok
                    results.append(row)
                    print("  → %s 平均 %.1fs / %.0f字 / %.0ftok | 成功 %d/%d" % (
                        model, avg_t, avg_l, avg_tok, row["ok"], len(QUESTIONS)
                    ))
                except Exception as e:
                    print("  → %s 批次异常: %s" % (model, str(e)[:200]))

    # 排名：优先成功率，其次延迟
    ranked = sorted(results, key=lambda x: (-x["ok"], x["avg_t"]))

    print("\n" + "=" * 90)
    print("排名（成功率降序，同成功率按延迟升序）")
    print("=" * 90)
    print("%-30s %8s %10s %10s %10s %s" % ("model", "success", "avg_t(s)", "avg_len", "avg_tok", "errors"))
    for i, r in enumerate(ranked):
        err_summary = "; ".join(r["errors"])[:60] if r["errors"] else "-"
        print("%2d. %-28s %5d/%-2d %8.1f %10.0f %10.0f  %s" % (
            i + 1, r["model"], r["ok"], len(QUESTIONS), r["avg_t"], r["avg_l"], r["avg_tok"], err_summary
        ))

    out_path = "benchmark_bailian_models_%s.json" % datetime.now().strftime("%Y%m%d_%H%M%S")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({
            "base_url": BASE_URL,
            "api_key_tail": API_KEY[-4:],
            "timestamp": datetime.now().isoformat(),
            "models": MODELS,
            "questions": QUESTIONS,
            "results": results,
            "ranking": [{"rank": i+1, "model": r["model"], "ok": r["ok"], "avg_t": r["avg_t"], "avg_l": r["avg_l"]} for i, r in enumerate(ranked)],
        }, f, ensure_ascii=False, indent=2)
    print("\n详细报告已写入:", out_path)


if __name__ == "__main__":
    main()
