# 11 · 下一阶段任务（TODO）

> **刷新于 2026-08-07（终校至 Q2-15）**：联网搜索已部署，当前真实阻塞转为"用户侧配置 + 扩量 + 收尾"。
> 基于 `.workbuddy/memory/2026-08-07.md` 与磁盘代码自动生成，不凭空猜测。

## P0（用户侧操作 / 真实阻塞）

1. **云库 `model_config` 配置百炼模型** — 联网搜索当前 `no_endpoint` 的根因：须在云开发控制台→数据库→`model_config` 新增 `{enabled:true, order:1, baseURL:"https://dashscope.aliyuncs.com/compatible-mode/v1", apiKey:"sk-...", model:"qwen-plus"}`（模型须支持 `enable_search`）。配好即生效（每请求实时读，无需 redeploy）。
2. **真机验证（管理员账号）** — 用 openid=`YOUR_ADMIN_OPENID` 测"今天有什么科技新闻""付航是谁"类问题，确认联网进回答、传记不编造。沙箱 `tcb fn invoke` 超时（网络限制），须真机。
3. **备案审核通过** — 等管局放批；备案一过提交代码审核（非商用-办公）。

## P1（可靠性 / 合规 / 扩量）

4. **canary 扩量准备** — 当前仅管理员走真实搜索；后续扩量须 `SEARCH_CANARY_OPENIDS` 增加白名单 + 监控埋点（Q2-4-C 预留 `SEARCH_CANARY_OPENIDS` per-user 开关）。
5. **跨境数据合规闭环** — 当前 `data_route=domestic`（零跨境），但仍建议补 PIPL 隐私政策告知（国内检索）；禁用任何 tavily/bing/serp。
6. **R2 天气数据源** — BLOCKED（位置隐私前置），Q2-14 后仍未解。
7. **msgSecCheck 真根因修复（OPEN）** — `-501001/-40003` 仍 0% 可用，`SEC_DEGRADE_ON_API_ERROR` 仅降级放行，需微信侧资质/配置。
8. **R 观测样本积累** — observability_logs 真实样本 <50，观察期停滞。

## P2（知识库 / 测试补完）

9. Phase G `question_bridge` 真读取（G-2 给 lexicalScore 加 ~6 行）。
10. 大学预测占比 23.3% 调优（G-2）。
11. Phase H-2 真实 100 题回填（你机器跑 harness）。
12. 传记防护泛化：当前 `PERSON_IDENTITY_RE` 覆盖常见问法，可补边界用例回归 `test_q33.js`。

## 当前开发任务（接手 AI 视角）

- 读 `README_AI.md` → `00` → … → `PROJECT_MAP.md`（已刷新至 Q2-15）
- 输出：项目理解 / 当前四模式+三层能力架构 / 当前阶段（Q2-15，联网已上线）/ 主要模块 / 风险 / 开发任务
- 理解完成后可在用户授权下继续开发；冻结资产改动须 SHA256 比对 + 显式评审；护栏链与 `data_route=domestic` 不可破坏。
