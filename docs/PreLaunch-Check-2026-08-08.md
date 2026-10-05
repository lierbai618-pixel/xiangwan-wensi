# 向晚问思 · 上线前全面检查报告

> 检查日期：2026-08-08｜基准状态：Phase Q2-21（联网搜索多轮修复 + 部署收尾，已于 2026-08-07 夜 `tcb fn deploy chat` 上线）
> 检查人：Release Manager 视角（自动核对磁盘代码 + 当日日志 + 本地离线测试）

---

## 0. 基准校准（重要：别信过期快照）

| 来源 | 宣称状态 | 真实状态 |
|------|---------|---------|
| 注入工作记忆 `MEMORY.md` | 停在 Phase R / Q2-0 | 已到 **Q2-21**（过期 ~21 个阶段） |
| `AI_CONTEXT/*.md`（上一轮我写的） | 写到 Q2-15 | 真实 **Q2-21**（又落后 6 个阶段） |
| 当日日志 `2026-08-07.md` | — | **Q2-21 部署收尾**（权威基准） |
| git HEAD | Phase F（`0e932c3`） | 此后全部 Q2-x 工作**未提交** |

**结论**：本次检查以「当日日志 + 磁盘代码」为唯一真相，不采信注入记忆与 AI_CONTEXT 文档。

---

## 1. ✅ PASS（上线闸门已通过）

| # | 检查项 | 证据 | 结论 |
|---|--------|------|------|
| 1 | **四冻结资产 SHA256 守门** | corpus `db01fbc9…` / intent `765ad138…` / rag `4fb2dca4…` / knowledgeRouter `848908445…` —— 四者逐字节 == 基线 | **4/4 通过，零漂移** |
| 2 | corpus 条目数 | 数组长度 = **14**（与"embedding 向量数=14"代理断言一致） | ✅ |
| 3 | 6 云函数齐全 | chat / feedback / history / ingest / login / admin 目录均存在 | ✅ |
| 4 | 前端 7 页齐全 | app.json 列出 home/chat/about/books/admin/privacy/sessions，7 个目录均存在 | ✅ |
| 5 | 云初始化 | `miniprogram/app.js:14` 正确 `wx.cloud.init({...})` | ✅ |
| 6 | msgSecCheck 权限声明 | `cloudfunctions/chat/config.json` 含 `"permissions":{"openapi":["security.msgSecCheck"]}` | ✅ 声明就位 |
| 7 | 离线回归（部分） | `test_q33.js`=**36 PASS/0 FAIL**；`test_q29.js`=**225 PASS/0 FAIL**（且断言 rag.js/corpus 全程未被改写） | ✅ |

---

## 2. ⚠️ WARN（需要处理，但非致命）

| # | 检查项 | 发现 | 建议 |
|---|--------|------|------|
| W1 | **history 云函数有未部署改动（实为功能修复）** | `git diff` 显示 +50/−3 行：①`appendSession` 新增**空回答守卫**（`normAssistant.content` 为空拒绝写入，修复"打字机改写原对象导致空串入历史"Bug）；②`normalizeMessage` 消息规范化；③`loadSession` 诊断日志。**所有 Q2-x 仅部署过 `chat`，history 未重部署** | 建议**部署而非回退**（守卫修复有实质价值）：`tcb fn deploy history`；部署前确认 cloudbaserc 无 history 配置项，沿用 history/config.json(timeout=20) 不被覆盖 |
| W2 | **msgSecCheck 生产降级放行** | `chat/index.js:266` 代码默认 `SEC_DEGRADE_ON_API_ERROR=true`；工作记忆确认 `-501001/-40003` 仍 **0% 可用**。即扫描失败时**放行而非拦截** | UGC 合规风险：内容审核在线上实质未生效。若严格上线需推进 **CR-005**（ContentSecurityAvailabilityRestoration，草案已存在 `docs/CR-005-Draft-…`）或确认降级策略获微信侧豁免 |
| W3 | **明文 API Key 在工作树** | `cloudbaserc.json` 内 `QWEN_SEARCH_API_KEY=sk-f9df7047…` 明文（当前 `??` 未跟踪，未进 git） | 务必让 `cloudbaserc.json` 走 `.gitignore`（或改用 `cloudbaserc.local.json`），避免后续 `git add -A` 把密钥提交；密钥经密钥管理注入更稳妥 |
| W4 | **chat config.json 与 cloudbaserc 超时不一致** | `cloudfunctions/chat/config.json` timeout=**90** vs `cloudbaserc.json` timeout=**60`（cloudbaserc 仅定义 chat 一函数；history 自有 config.json timeout=**20** 合理，不在此列）。*深度扫描修正*：原报告误写"history 无 config.json" | 统一 chat 为 60，消除歧义 |
| W5 | **测试夹具漂移（Q2-21 引入）** | Q2-21 把 `qwenSearch` 改为内部 `_nodeFetch`、解耦外部注入的 `nodeFetch` 参数。原离线测试 `test_q34.js`（及同类 qwenSearch 夹具）注入的 `fakeFetch` 失效 → 退化为真实外呼，实测 `HTTP_401`（用的是测试自带假 key `sk-test`，**非生产 key，故不证明生产 key 失效**） | 为 `qwenSearch` 增加可注入 fetch 的测试缝（如保留 `nodeFetch` 覆盖项）后，重跑 `test_q31/q34` 等全套离线回归，恢复"绿"信心 |
| W6 | **文档再次过期** | `AI_CONTEXT/*.md` 仍写 Q2-15；`MEMORY.md` 仍写 R/Q2-0 | 非阻塞，但建议上线后再统一刷新（或现在刷新，避免后续接手者误判） |

---

## 3. 🔴 BLOCK（上线硬阻塞 / 必须确认）

| # | 阻塞项 | 状态 | 放行条件 |
|---|--------|------|---------|
| B1 | ~~小程序 ICP 备案审核中~~ **✅ 已通过** | 2026-08-08 用户确认备案审核通过（外部阻塞解除） | ~~公网发布前置硬阻塞~~ → 前置条件已满足 |
| B2 | **UGC 服务内容声明 + 隐私授权接入** | 未确认；且代码侧 `miniprogram/app.json` **无 `__usePrivacyCheck__: true`**、`grep` 全仓无"服务内容声明/UGC/userPrivacy"字样（privacy 页存在但仅前端协议）。"服务内容声明"是公众平台后台必填；新版小程序 UGC 还需处理隐私授权弹窗 | ① 公众平台→基本设置→服务内容声明 填妥；② 确认隐私授权弹窗是否需接入（`__usePrivacyCheck__`） |
| B3 | **线上联网能力真机验证** | 未验证 | `cloudbaserc.json` 的 `QWEN_SEARCH_API_KEY` 当前有效性**未知**（测试 401 来自测试假 key，不证明生产 key 失效）。须用 **admin 微信（openid=YOUR_ADMIN_OPENID…）** 真机问「付航是谁」「今天有什么科技新闻」确认：联网综合内容 + "未经独立核实"免责声明正常呈现、无降级模板 |
| B4 | **核心代码完全未纳入版本控制（非仅缺 tag）** | `git ls-files` 对 `capabilities/ freshness/ think/ providers/ security/` 跟踪条数=**0**；`chat/index.js`、`chat/rag.js`、`chat/corpus.json`、`history/index.js` 及前端 chat 三件套均 `M` 未提交。*深度扫描修正*：原"全量未提交无 tag"严重低估——整个 Q2 架构层未跟踪，工作树丢失即消失 | 上线前 `git add` 核心模块+提交+建 launch tag；`cloudbaserc.json` 提交前先 gitignore |

---

## 3.1 深度扫描修正记录（2026-08-08 14:3x，翻开文件实测）

> 本节更正原 14:30 版报告的两处事实错误/遗漏，基于 `git ls-files` / `git diff` / 读 `cloudbaserc.json` / 读 `index.js` / 实跑测试得出，**非凭记忆复述**。

- **W4 误述修正**：原写"history 无 config.json"。实测 `cloudfunctions/history/config.json` 存在且 `timeout=20`（合理）。不一致**仅限 chat**：`chat/config.json=90` vs `cloudbaserc.json=60`。
- **B4 严重低估修正**：原写"全量代码未提交无 launch tag"。实测 `git ls-files capabilities/ freshness/ think/ providers/ security/` **跟踪条数=0**——整个 Q2 架构层未纳入 git，风险是"工作树丢失即永久消失"，而非仅缺 tag。
- **W1 定性升级**：history 的 +50/−3 行不只是"诊断"，含 `appendSession` **空回答守卫**（修复空串入历史 Bug），属功能性修复，**应部署而非回退**。
- **W5 实跑验证**：`test_q24c`=37 PASS/0 FAIL（绿，证明 W5 仅影响直接调 `qwenSearch` 的测试）；`test_q31` 因 Q2-21 解耦退化真实外呼（`dashscope-relay.example.com` ECONNRESET）红。W5 根因坐实。
- **W3 具体证据**：`cloudbaserc.json:23` 明文 `QWEN_SEARCH_API_KEY=sk-f9df7047…`，`.gitignore` 无 cloudbaserc 规则（文件当前未跟踪，但 `git add -A` 会泄露）。env 显示 `FRESHNESS_FACTUAL_ENABLED=true` / `SEARCH_PROVIDER=qwen` / `PRIVACY_GATE_ENABLED=true` / `SEARCH_CANARY_ENABLED=true` / `SYNTH_MODE=true` 全开——联网/合成/隐私门/金丝雀均激活，与 Q2-21 部署一致。

---

## 4. 放行闸门（GO 清单）

- [x] **B1** 备案审核通过 ✅（2026-08-08 用户确认）
- [ ] **B2** UGC 服务内容声明填妥
- [ ] **W1** history 改动：部署 `tcb fn deploy history` 或回退
- [ ] **W2** msgSecCheck 降级策略获确认（或推进 CR-005）
- [ ] **B3** 真机 canary 验证联网/合成底座/传记防护通过
- [ ] **W3** `cloudbaserc.json` 密钥不外泄（gitignore / 密钥管理）
- [ ] **W5** 测试夹具修复后全套离线回归绿
- [ ] **B4** 提交当前代码并建立 launch tag（先 gitignore 密钥）

> 全部 ✅ 后，即可提交微信审核 / 公网发布。

---

## 5. 立即 Action Items（按优先级）

1. ~~**【用户·外部】** 跟踪 ICP 备案审核 + 填 UGC 声明（B1/B2，外部阻塞，无法由代码解决）。~~ → **B1 已完成**：备案审核通过（2026-08-08 确认）。仅剩 **B2 UGC 服务内容声明** 需用户在公众平台填写。
2. **【用户·真机】** 用 admin 微信做联网 canary 验证（B3）。
3. **【决策 W1】** 是否部署 history 规范化改动？若部署：`tcb fn deploy history`（注意 cloudbaserc 仅含 chat，history 沿用现有 runtime/timeout/memory，部署前确认未静默覆盖）。
4. **【收尾 W3/W4/B4】** `cloudbaserc.json` 加 `.gitignore` → 统一 timeout → 提交代码建 tag。
5. **【质量 W5】** 给 `qwenSearch` 补 fetch 测试缝，重跑离线全套，恢复绿。
6. **【可选 W6】** 刷新 `AI_CONTEXT` 与 `MEMORY.md` 到 Q2-21（避免后续接手误判）。

---

## 附：本次检查执行记录

- 冻结资产 SHA256：`sha256sum` 四文件 == MEMORY.md 基线（4/4）。
- 离线测试：托管 Node `22.22.2` 实跑 `test_q33`（36✅）、`test_q29`（225✅）；`test_q34` 因 Q2-21 夹具解耦退化真实外呼报 401（属测试漂移，非生产缺陷）。
- 未对上述任何文件做改动、未部署、未改生产 env、未提交（遵循项目冻结/部署纪律）。
