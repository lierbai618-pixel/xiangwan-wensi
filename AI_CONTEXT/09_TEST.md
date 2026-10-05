# 09 · 测试（Tests）

> **刷新于 2026-08-07（终校至 Q2-15）**：测试已推进到 `test_q33.js`，累计约 **526 断言 0 失败**（q29=225 / q30=104 / q31=132 / q32=29 / q33=36）。

## 测试资产清单（节选近期）

| 测试 | 文件 | 断言 | 状态 |
|------|------|------|------|
| Phase F 百问 | `tests/general-ai-test.*` | 100/100 | ✅ |
| Phase H 意图 | `online-quality-test.json` | 100 通过 | ✅ |
| Phase H 不变量 | `online-quality-run.js` | 8/8 | ✅ |
| Phase R 首验 | capabilities 时间/天气 | 3/3 | ✅ 已上线 |
| Phase Q1-B 反幻觉 | `tests/test_freshness_q1.js` | 31/31 | ✅ |
| Phase Q1-B 存量回归 | 存量用例 | 32/32 | ✅ |
| Q2-4-C canary | `scripts/test_q24c.js` | 37 | ✅ |
| Q2-4-D privacy | `scripts/test_q24d.js` | 39 | ✅ |
| Q2-5-B 国内源 | `scripts/test_q25b.js` | 41 | ✅ |
| Q2-6-MVP 隔离 | `scripts/test_q26.js` | 31 | ✅（corpus SHA 不变） |
| Q2-7 L2 金丝雀 | `scripts/test_q27.js` | 126 | ✅（data_route=domestic） |
| Q2-8-MVP 激活 | `scripts/test_q28.js` | 217 | ✅（audit 零泄露） |
| Q2-10 适配器 | `scripts/test_q29.js` | 225 | ✅ |
| Q2-12 WSA | `scripts/test_q30.js` | 104 | ✅ |
| Q2-13 Qwen | `scripts/test_q31.js` | 132 | ✅（事实隔离：弃 message.content） |
| Q2-14-b 路由 | `scripts/test_q32.js` | 29 | ✅（锁死 freshness 短路修复） |
| **Q2-15 传记防护** | `scripts/test_q33.js` | **36** | ✅（含传记检测 7 + 护栏 1） |

## 覆盖率

- **意图分类**：100/100（真实 classifyIntent）
- **RAG 不变量**：8/8
- **Capability 分流**：3/3
- **反幻觉硬闸**：Q1-B 31/31 + 存量 32/32；Q2-15 传记 36/36
- **联网搜索**：q29+q30+q31+q32+q33 累计 ~626 子断言（含事实隔离、data_route=domestic、审计零泄露、失败回退 RAG）
- **前端体验**：隐私浮层 / 引用卡 / 动态格式（代码侧就位）

## 遗留问题

1. Phase G `question_bridge` 未被代码读取（真实映射需 G-2 加 ~6 行）
2. Phase H-2 沙箱无 `@cloudbase/node-sdk`，真实 100 题需你机器跑
3. 大学预测占比 23.3% 偏高，G-2 待调
4. msgSecCheck 真根因 `-501001/-40003` 仍 0% 可用（OPEN，见 CR-002）
5. **联网搜索需用户在云库 `model_config` 配好百炼模型（支持 enable_search）才有端点**；否则 `no_endpoint`→诚实降级

## 运行方式（你环境）

```bash
node weapp/tests/online-quality-run.js        # Phase H 离线 100/100
node weapp/cloudfunctions/chat/scripts/test_q33.js   # Q2-15 传记防护 36 PASS
node weapp/cloudfunctions/chat/scripts/test_q31.js   # Q2-13 Qwen 事实隔离 132 PASS
```
