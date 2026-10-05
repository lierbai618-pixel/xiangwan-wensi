# -*- coding: utf-8 -*-
"""
统一三维 benchmark：速度(TTFT/总耗时) + 输出长度(中文字符) + 质量(qwen-plus 评审 0-10)
同一组 system + 3 个中文 prompt，覆盖 7 个候选模型，同一环境(沙箱直连)公平对比。
纯标准库 urllib 实现，默认直连、不走代理。
"""
import os, sys, json, time, datetime, re, ssl, urllib.request

# 强制直连：清除代理环境变量（urllib 默认不读代理，这里仅防御）
for k in ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']:
    os.environ.pop(k, None)
os.environ['NO_PROXY'] = '*'
os.environ['no_proxy'] = '*'

STEPFUN_KEY = '1a4J8885S8e36iNSX18zAx9Frlqw4lBew7zfcAQ9LouB3ZVtM5ge6cdEdSNuzLpuN'
HCNSEC_KEY = 'sk-YOUR_API_KEY_HERE'
QWEN_KEY   = 'sk-YOUR_API_KEY_HERE'
AGNES_KEY  = 'sk-YOUR_API_KEY_HERE'

CANDIDATES = [
    ('stepfun-step35',       'step-3.5-flash',       'https://api.stepfun.com/v1',           STEPFUN_KEY),
    ('stepfun-step35-2603', 'step-3.5-flash-2603',  'https://api.stepfun.com/v1',           STEPFUN_KEY),
    ('stepfun-step37',      'step-3.7-flash',       'https://api.stepfun.com/v1',           STEPFUN_KEY),
    ('stepfun-1o-vision',   'step-1o-turbo-vision', 'https://api.stepfun.com/v1',           STEPFUN_KEY),
    ('hcnsec-step35',       'step-3.5-flash',       'https://api.hcnsec.cn/v1',             HCNSEC_KEY),
    ('qwen-plus',           'qwen-plus',            'https://dashscope.aliyuncs.com/compatible-mode/v1', QWEN_KEY),
    ('agnes',               'agnes-2.0-flash',      'https://apihub.agnes-ai.com/v1',        AGNES_KEY),
]

PROMPTS = [
    ('P1-哲理',  '如何面对人生的无常？'),
    ('P2-情感',  '我总觉得自己比别人差，很焦虑，该怎么办？'),
    ('P3-知识',  '用三句话说明“祸兮福之所倚”的含义，并点出它出自哪部典籍。'),
]

SYS = ('你是一个有洞察力的中文思辨助手。回答要真诚、有结构、引用恰当，不编造；'
       '对情绪类问题先接住对方感受，再给可执行的视角。直接回答，不重复问题。')

JUDGE_SYS = (
    '你是严谨的中文回答质量评审。针对给定的「用户问题」和「模型回答」，按以下 rubric 打 0-10 分：\n'
    '1) 相关性(0-2)：是否紧扣问题、没有跑题\n'
    '2) 准确性(0-2)：事实/引用是否正确、有无编造（如“祸兮福之所倚”须出自《道德经》）\n'
    '3) 深度(0-2)：是否有思辨层次，而非套话\n'
    '4) 共情/适配(0-2)：对情绪题是否先接住感受；对知识题是否准确且易懂\n'
    '5) 可读性(0-2)：结构清晰、中文流畅、不过短也不过水\n'
    '仅输出一行 JSON：{"score": <0-10 数值>, "reason": "<20字内点评>"}'
)

CTX = ssl.create_default_context()


def _stream(url, headers, payload, timeout):
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers=headers, method='POST')
    resp = urllib.request.urlopen(req, timeout=timeout, context=CTX)
    for raw in resp:
        yield raw


def call_stream(clabel, base_url, api_key, model, prompt, timeout):
    url = base_url.rstrip('/') + '/chat/completions'
    headers = {'Authorization': 'Bearer ' + api_key, 'Content-Type': 'application/json'}
    payload = {
        'model': model,
        'messages': [{'role': 'system', 'content': SYS}, {'role': 'user', 'content': prompt}],
        'stream': True,
        'temperature': 0.7,
    }
    last_err = None
    for attempt in range(2):
        t0 = time.time()
        ttft = None
        text = ''
        try:
            for raw in _stream(url, headers, payload, timeout):
                if not raw:
                    continue
                s = raw.decode('utf-8', 'replace')
                if not s.startswith('data:'):
                    continue
                data = s[5:].strip()
                if data == '[DONE]':
                    break
                try:
                    obj = json.loads(data)
                except Exception:
                    continue
                choices = obj.get('choices') or []
                if not choices:
                    continue  # 跳过空 choices 包(usage/think 分隔包)
                if ttft is None:
                    ttft = (time.time() - t0) * 1000
                delta = choices[0].get('delta', {})
                c = delta.get('content') or ''
                if c:
                    text += c
            total = (time.time() - t0) * 1000
            text = text.strip()
            if not text:
                return {'ok': False, 'err': 'empty_content', 'total_ms': total, 'ttft_ms': ttft}
            return {'ok': True, 'ttft_ms': ttft, 'total_ms': total, 'chars': len(text), 'text': text}
        except Exception as e:
            last_err = str(e)[:200]
            if '429' in last_err:
                time.sleep(3)
                continue
            return {'ok': False, 'err': last_err, 'total_ms': (time.time() - t0) * 1000, 'ttft_ms': ttft}
    return {'ok': False, 'err': last_err or 'retry_exhausted', 'total_ms': (time.time() - t0) * 1000, 'ttft_ms': ttft}


def judge(prompt, text):
    url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
    headers = {'Authorization': 'Bearer ' + QWEN_KEY, 'Content-Type': 'application/json'}
    user = '用户问题：%s\n\n模型回答：%s' % (prompt, text)
    payload = {
        'model': 'qwen-plus',
        'messages': [{'role': 'system', 'content': JUDGE_SYS}, {'role': 'user', 'content': user}],
        'stream': False,
        'temperature': 0,
    }
    try:
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers=headers, method='POST')
        resp = urllib.request.urlopen(req, timeout=30, context=CTX)
        obj = json.loads(resp.read().decode('utf-8'))
        content = obj['choices'][0]['message']['content']
        m = re.search(r'\{[^{}]*"score"\s*:\s*([0-9.]+)[^{}]*\}', content, re.S)
        if not m:
            return {'score': None, 'reason': 'judge parse fail: ' + content[:60]}
        score = float(m.group(1))
        rm = re.search(r'"reason"\s*:\s*"([^"]*)"', content)
        reason = rm.group(1) if rm else ''
        return {'score': score, 'reason': reason}
    except Exception as e:
        return {'score': None, 'reason': 'judge err ' + str(e)[:60]}


def main():
    out = {'meta': {'time': datetime.datetime.now().isoformat(timespec='seconds'),
                    'sys': SYS, 'prompts': [p[0] for p in PROMPTS]},
           'results': []}
    for (clabel, model, base, key) in CANDIDATES:
        row = {'candidate': clabel, 'model': model, 'base': base, 'runs': []}
        gen_timeout = 12 if base.endswith('hcnsec.cn/v1') else 25
        for (plabel, prompt) in PROMPTS:
            print('[%s] %s ...' % (clabel, plabel), flush=True)
            g = call_stream(clabel, base, key, model, prompt, gen_timeout)
            entry = {'prompt': plabel, 'gen': g}
            if g.get('ok'):
                j = judge(prompt, g['text'])
                entry['judge'] = j
                print('   -> %.0fms / %d字 / 质量%s' % (g['total_ms'], g['chars'], j.get('score')), flush=True)
            else:
                entry['judge'] = None
                print('   -> FAIL %s' % g.get('err'), flush=True)
            row['runs'].append(entry)
        out['results'].append(row)
    ts = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    path = os.path.join(os.path.dirname(__file__), 'full_bench_%s.json' % ts)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print('SAVED', path, flush=True)


if __name__ == '__main__':
    main()
