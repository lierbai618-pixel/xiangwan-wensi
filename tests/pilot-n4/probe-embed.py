import os, json, time, urllib.request, urllib.error
key = os.environ.get("DASHSCOPE_API_KEY", "")
print("key_present:", bool(key), "len:", len(key))
url = "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings"
body = json.dumps({"model":"text-embedding-v3","input":["确认偏差是一种认知偏差"],"dimensions":1024,"encoding_format":"float"}).encode("utf-8")
req = urllib.request.Request(url, data=body, headers={"Authorization":"Bearer "+key,"Content-Type":"application/json"})
t0=time.time()
try:
    with urllib.request.urlopen(req, timeout=25) as r:
        d = json.loads(r.read().decode("utf-8"))
        vec = d["data"][0]["embedding"]
        print("STATUS: OK")
        print("dim:", len(vec))
        print("latency_ms:", round((time.time()-t0)*1000))
        print("usage:", d.get("usage"))
        print("head5:", [round(x,6) for x in vec[:5]])
except urllib.error.HTTPError as e:
    print("STATUS: HTTP_ERROR", e.code)
    print(e.read().decode("utf-8", "ignore")[:400])
except Exception as e:
    print("STATUS: FAIL", type(e).__name__, str(e)[:300])
