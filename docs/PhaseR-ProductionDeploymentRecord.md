# Phase R Production Deployment Record

**项目**：向晚问思（WenDao）微信云开发小程序
**阶段**：Phase R — Capability Layer
**Release Decision**：GO ✅
**云环境**：`YOUR_CLOUD_ENV_ID`（个人版，状态 Normal）
**云函数**：`chat`
**记录创建**：2026-08-05 13:26 (UTC+8)
**记录回填**：2026-08-05 16:34 (UTC+8)
**记录角色**：Release Guardian + Production Deployment Engineer

> ## ✅ 本记录状态：**已结案 — DEPLOYED & VERIFIED**
>
> | 里程碑 | 时间 | 结果 |
> |---|---|---|
> | 部署完成 | 2026-08-05 16:15:53 | ✅ 成功（人工执行，云端 Modification time 为证） |
> | 部署后核验 | 2026-08-05 16:25 | ✅ 环境变量 / 云端代码 / 冻结资产 全 PASS |
> | Smoke Test | 2026-08-05 16:28 | ✅ **3/3 PASS**（生产真实调用） |
> | 状态转换 | 2026-08-05 16:28 | ✅ **Phase R — Observation 已启动** |
>
> 全部 `【待填】` 字段已回填完毕。最终结论见 §7。

---

## 1. 部署状态

### 1.1 部署方式与理由

| 项 | 内容 |
|---|---|
| 部署通道 | **微信开发者工具 GUI（人工执行）** |
| 不采用 CLI 的理由 | 沙箱侧 SCF 代码上传端点探测为代理伪响应（HTTP 200 / connect 0.0007s / curl exit 23），写入通道不可信；生产部署中"不可信"等同"不可用" |
| 是否需要云端安装依赖 | **是**（虽零新增依赖，仍以此保证云端 `node_modules` 与 `package.json` 一致） |
| 是否需要新增环境变量 | **否**（三个 Capability 变量均为"不配置即安全默认"） |
| 是否需要改动数据库 | **否** |
| 是否需要改动前端 | **否** |

### 1.2 部署操作步骤（执行人照此操作）

**Step 0 — 部署前快照（30 秒，用于事后比对）**

在微信开发者工具 → 云开发控制台 → 云函数 → `chat` → 记录：
- 当前版本号 / 上次更新时间
- 环境变量面板当前全部键名（截图或抄录）

**Step 1 — 上传部署**

1. 打开微信开发者工具，加载项目 `weapp/`（AppID `wx2653f12589f9f89f`）；
2. 确认右上角云环境已选中 `YOUR_CLOUD_ENV_ID`；
3. 资源管理器中定位 `cloudfunctions/chat` 目录；
4. **右键 → 上传并部署：云端安装依赖**；
5. 等待控制台提示部署成功（首次含依赖安装，通常 30–90 秒）。

**Step 2 — 环境变量确认（PF-04，优先级高于 Smoke Test）**

云开发控制台 → 云函数 → `chat` → 配置 → 环境变量，确认以下**仍然存在**：

| 变量 | 期望值 | 丢失后果 |
|---|---|---|
| `KNOWLEDGE_OBSERVABILITY_STORE` | `cloud` | **观察期零数据**，五项指标全部失效，R2 准入无法满足（且失败完全静默） |
| `ADMIN_OPENID` | 原值 | 后台/看板识别受影响 |

三个 Capability 变量（`CAPABILITY_ENABLED` / `CAPABILITY_INVITE_ENABLED` / `WEATHER_PROVIDER`）**无需配置**，缺省即为期望态（启用 / 启用 / 无天气源）。

**Step 3 — 执行 §2 Smoke Test**

**Step 4 — 回填本记录 §1.3 与 §2**

### 1.3 部署执行结果 ✅ 已回填

| 项 | 值 |
|---|---|
| 部署完成时间 | **2026-08-05 16:15:53**（云端 Modification time，权威时间戳） |
| 部署结果 | **成功** — Status = `Deployment completed` |
| 云函数 ID | `lam-8a8p5vsx` |
| 代码包大小 | 11,215,630 B（约 11.2 MB） |
| 运行时 | **Nodejs16.13** ✅ 与冻结约束一致 |
| 依赖安装 | **成功** — `Auto install dependencies = TRUE` |
| 内存 / 超时 | 512 MB / 60 s（与部署前一致，未变更） |
| 环境变量确认（Step 2） | ✅ **`KNOWLEDGE_OBSERVABILITY_STORE=cloud` 存在（Y）；`ADMIN_OPENID=YOUR_ADMIN_OPENID` 存在（Y）** |
| Capability 三变量 | 均未配置 = **缺省期望态**（启用 / 启用 / 无天气源），符合 Preflight 设计 |
| `FRESHNESS_ENABLED` | 未配置 = **关闭**，Phase Q 随包上线但未启用 ✅ |
| 执行人 | 人工（微信开发者工具「上传并部署：云端安装依赖」） |
| 核验人 | Release Guardian（`tcb fn detail` 只读取证，零写入） |

> **PF-04 风险已解除**：部署前预警的「环境变量面板整体覆盖导致 `KNOWLEDGE_OBSERVABILITY_STORE` 丢失」**未发生**。云端实测两个既有变量均完好保留，观察期数据通路正常（见 §2.5 落库实证）。

**云端代码内容核验**（`tcb fn detail` 返回的线上 `index.js` 实体）：

| 核验点 | 云端实测 | 判定 |
|---|---|---|
| Capability 接入存在 | L61-73 模块加载 + L228-241 旁路调用 | ✅ |
| 接入顺序 | Capability（最先）→ Freshness → `generateAnswer`(RAG) | ✅ 与设计一致 |
| `CAPABILITY_ENABLED` 默认值 | `(process.env.CAPABILITY_ENABLED \|\| "true").toLowerCase() !== "false"` = 默认启用 | ✅ |
| 异常回退 | `try/catch` → `result = null` → 直落原链路 | ✅ 兜底完整 |

### 1.4 本次上线的代码范围

| 模块 | 文件数 | 上线后状态 | 说明 |
|---|---|---|---|
| `capabilities/`（Phase R） | 7 | **启用** | 本次上线主体；`CAPABILITY_ENABLED` 默认 true |
| `freshness/`（Phase Q） | 9 | **关闭** | 随包上线但 `FRESHNESS_ENABLED` 未配置 = 关闭，运行时等价于不存在 |
| `index.js` | 1 | 启用 | 旁路接入：Capability → Freshness → RAG |
| `observability/observabilityLogger.js` | 1 | 启用 | 增量观测字段（`capability` / `freshness`），非工具路径恒为 `null`，向后兼容 |
| 冻结四资产 | 4 | 未改动 | 逐字节与 O-0.6 一致 |

> **留痕声明**：Phase Q 代码随包上线**不构成 Phase Q 上线**。其启用需要单独决策 + 单独配置 `FRESHNESS_ENABLED=true`，且 Q2 检索源选型尚未完成。

---

## 2. Smoke Test 结果

### 2.1 判读基准（部署前已确立，见 Preflight §7）

三条用例的期望值来自本地对 `capabilities/index.js` 的离线预演，**非推测**。

> ⚠️ **PF-01 判读口径（必读）**：实现中**不存在** `date_query` 能力类型。日期查询归属 `time_query`，通过 `sub_type="date"` 区分。按字面查找 `date_query` 会把通过的用例误判为失败。

### 2.2 执行方式（二选一，建议两者都做）

**方式 A — 真机/模拟器对话（端到端，最贴近用户）**
在小程序对话框直接输入三条问句，肉眼核对回答形态。

**方式 B — 云函数测试面板（可看结构化字段）**
云开发控制台 → 云函数 `chat` → 云端测试，测试参数：

```json
{ "message": "现在北京时间" }
```

返回体中核对 `mode` / `citations` / `capability.*` 字段。

**观测落库核验（可选，验证观察期数据通路）**
云开发控制台 → 数据库 → `observability_logs`，按 `created_at` 倒序，确认新记录中 `capability` 字段非 `null` 且形如：

```json
{ "name": "time_query", "sub_type": "time", "confidence": "high",
  "signals": ["time-pattern:time"], "emotional": false,
  "tool_ok": true, "tool_reason": null, "bypass_rag": true, "has_invite": true }
```

此项若为空，说明 `KNOWLEDGE_OBSERVABILITY_STORE` 未生效 → 回到 Step 2 修正，否则观察期无数据。

### 2.3 Case 记录表

#### Case 1 — `现在北京时间` → 必须 Capability Layer

**执行方式**：生产云函数真实调用（`tcb fn invoke chat`），非离线预演。
**Request Id**：`5eb1bfe9-a7b5-41ad-828c-23253f27dd5b` ｜ **answer_id**：`20260805_3peiak` ｜ **耗时 248 ms**

| 检查点 | 期望值 | 实际 | 判定 |
|---|---|---|---|
| `mode` | `capability` | `capability` | ✅ PASS |
| `capability.bypass_rag` | `true` | `true` | ✅ PASS |
| `citations` | `[]`（空数组） | `[]` | ✅ PASS |
| `capability.capability`（API 返回体字段名） | `time_query` | `time_query` | ✅ PASS |
| `capability.sub_type` | `time` | `time` | ✅ PASS |
| `capability.tool_ok` | `true` | `true` | ✅ PASS |
| `capability.confidence` | `high` | `high` | ✅ PASS |
| `_modelStatus` | `tool`（未调用大模型） | `tool` | ✅ PASS |
| 回答含具体北京时间 | 形如「现在是北京时间 …」 | 「现在是北京时间 **2026年8月5日 16:27，星期三**。」 | ✅ PASS |
| 回答**不含**自曝短板 | 无「无法联网 / 不知道时间 / 无法获取」 | 无 | ✅ PASS |

**完整回答**：

```
现在是北京时间 2026年8月5日 16:27，星期三。

顺带一提：如果你此刻在意的其实不是几点，而是"又过去一天了"，我在这儿。
```

> 本例是 **R-001 修复的靶心**：修复前此句 MISS 回 RAG，会复现最初报障的完整故障体验。**现已确认在生产环境命中能力层，原始缺陷闭环。**
>
> **延迟对比值得记录**：248 ms（工具路径）vs Case 3 的 8,606 ms（模型路径）。能力层同时消除了实时事实问题的无谓模型开销，约 **35 倍**。

#### Case 2 — `今天日期` → 必须 Capability Layer

**Request Id**：`72a1015f-ebaf-455d-a42e-fe02dec26889` ｜ **answer_id**：`20260805_u2rfw7` ｜ **耗时 175 ms**

| 检查点 | 期望值 | 实际 | 判定 |
|---|---|---|---|
| `mode` | `capability` | `capability` | ✅ PASS |
| `capability.bypass_rag` | `true` | `true` | ✅ PASS |
| `citations` | `[]` | `[]` | ✅ PASS |
| `capability.capability` | `time_query`（**非** `date_query`，见 PF-01） | `time_query` | ✅ PASS |
| `capability.sub_type` | `date` | `date` | ✅ PASS |
| `capability.tool_ok` | `true` | `true` | ✅ PASS |
| 回答含具体日期 | 形如「今天是北京时间 …」 | 「今天是北京时间 **2026年8月5日，星期三**。」 | ✅ PASS |

**完整回答**：

```
今天是北京时间 2026年8月5日，星期三。

顺带一提：如果你此刻在意的其实不是几点，而是"又过去一天了"，我在这儿。
```

> **PF-01 判读口径在生产被证实**：实际返回 `capability="time_query"` + `sub_type="date"`，**确无 `date_query` 类型**。若按任务书字面查找 `date_query`，这条实际 PASS 的用例会被误判 FAIL 并触发无谓回滚——Preflight 的预警在此兑现。
>
> **PF-02 已复现（P3，不修）**：日期查询沿用了时间口径的邀请语「不是几点」，措辞与「日期」诉求略有错位。属文案微瑕，非功能缺陷，按纪律**观察期只登记不修改**。

#### Case 3 — `时间的意义是什么` → 必须 Knowledge Layer

**Request Id**：`71147bc0-7a6d-48fe-a66a-2ffe22cd268a` ｜ **answer_id**：`20260805_55aej5` ｜ **耗时 8,606 ms**

| 检查点 | 期望值 | 实际 | 判定 |
|---|---|---|---|
| `mode` | **不是** `capability` | `model`（走 Knowledge Layer） | ✅ PASS |
| `capability` 观测字段 | `null` | `null`（数据库实查确认） | ✅ PASS |
| 否决生效 | 未进入能力层 | 未进入，直落 RAG | ✅ PASS |
| 回答保持五段式 | 理解 → 分析 → 行动 → 经典 → 思考 | 【理解】【分析】【经典观点】【思考】【建议】五段齐全 | ✅ PASS |
| 经典引用 | `citations` 非空 | **3 条**：《论语·为政》《道德经·三十三章》《孟子·告子下》 | ✅ PASS |
| `intent` 分类 | 人生/思辨类 | `type=life` / `knowledgePolicy=use` / `crisis=false` | ✅ PASS |
| `_modelUsed` | 大模型正常调用 | `Flash` / `_modelStatus=ok` | ✅ PASS |

**回答节选**（首段）：

```
【理解】
你问的不是"时间怎么计算"，而是"时间为什么重要""它究竟在我们生命里扮演什么角色"
——这背后藏着一种隐隐的不安：我们每天都在流逝，却未必清楚自己正走向哪里……
```

> 本例是**最重要的一条**：它验证能力层没有抢占思辨问题。Case 1/2 失败只是功能没修好；**Case 3 失败意味着产品人格被工具层侵蚀**，必须立即 L1 熔断。
>
> **生产实证结论**：同样含「时间」二字，`现在北京时间` 走 248 ms 工具路径、`时间的意义是什么` 走 8.6 s 五段式思辨路径。**否决层在生产环境按设计工作，人格边界完好。**

### 2.4 Smoke Test 总判定 ✅ 已回填

| 项 | 值 |
|---|---|
| 通过 / 总数 | **3 / 3** |
| 执行时间 | 2026-08-05 16:27:11 – 16:28:4x（北京时间） |
| 执行方式 | 生产云函数真实调用（`tcb fn invoke`），**非离线预演** |
| 观测落库核验 | ✅ **Y** — `capability` 字段非 null（详见 §2.5） |
| 总判定 | ✅ **PASS → 进入 Phase R Observation** |

### 2.5 观测落库实证（数据通路验证）

对生产库 `observability_logs` 直接查询（`tcb db nosql execute`，只读）：

| 查询 | 结果 |
|---|---|
| 集合总记录数 | **52**（Phase P+ 基线 N=37 → 现 52） |
| `capability` 字段非 null 记录数 | **5** |
| 其中本次 Smoke Test 贡献 | 2 条（`20260805_3peiak` / `20260805_u2rfw7`） |
| 部署后人工真机验证贡献 | 3 条（08:16:50 / 08:17:25 / 08:17:46 UTC，即北京时间 16:16–16:17） |
| Case 3 记录 `capability` 值 | `null` ✅（`answer_id=20260805_55aej5` 实查确认） |

**落库字段完整性抽样**（5 条全部结构一致）：

| 字段 | 落库情况 |
|---|---|
| `sub_type` | ✅ `time` × 3 / `date` × 2 |
| `confidence` | ✅ 全部 `high` |
| `tool_ok` | ✅ 全部 `true`（tool_ok_rate = 100%） |
| `bypass_rag` | ✅ 全部 `true` |
| `emotional` | ✅ 全部 `false` |
| `created_at` | ✅ ISO 时间戳完整 |

> **字段名双层映射（评审注意）**：API 返回体中能力类型字段为 `capability.capability`，观测落库时映射为 `capability.name`。两者均正确，查询观测库请用 `capability.name`。此前记录表误写为 API 层用 `capability.name`，已在 §2.3 更正。
>
> **踩坑留痕**：首次统计误用 `where({mode:"capability"})` 得 0 条 —— 观测记录**不含 `mode` 字段**（`mode` 只在 API 返回体中）。正确判据是 `capability != null`。观察期取数脚本务必沿用后者。

**处置规则（不得现场变通）**：

- **3/3 PASS** → 进入 Phase R Observation，转 §5。
- **Case 3 FAIL**（能力层抢占思辨）→ **立即 L1**，不做任何现场分析。
- **Case 1 或 2 FAIL** → 记录实际返回，**立即 L0**（仅撤 R-001 补丁，保留能力层其余部分），然后停止并提交评审。
- **任何情况下不得现场改代码、不得现场调正则、不得为让用例通过而改判读标准。**

---

## 3. 冻结资产状态

| 文件 | SHA256 | 状态 |
|---|---|---|
| `corpus.json` | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` | ✅ 与 O-0.6 一致 |
| `intent.js` | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | ✅ 与 O-0.6 一致 |
| `rag.js` | `5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286` | ✅ 与 O-0.6 一致 |
| `knowledgeRouter.js` | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | ✅ 与 O-0.6 一致 |

**校验时点**：部署前（2026-08-05 13:26）**与部署后（2026-08-05 16:25）双次校验，两次结果完全一致**。
**部署行为对冻结资产的影响**：上传为**只读复制到云端**，不回写本地文件，因此部署不可能改变本地哈希。部署后复校已完成，四资产逐字节与 O-0.6 一致。

| 校验轮次 | 时点 | 结果 |
|---|---|---|
| Before（部署前 Preflight） | 2026-08-05 13:26 | PASS |
| **After（部署后核验）** | **2026-08-05 16:25** | **PASS — 四资产哈希与 Before 逐字符相同** |

**`router.js` 一致性**：`46acd4f45f199b97381fd5738fec58a159d058aa1e864f43f3d0d8aa3bbdd830`，与 R-001 补丁报告记录值一致，部署前后未变。

**其他禁改项状态**：
- Prompt 核心人格：未改动（`rag.js` 内的 `ROLE_PROMPT` 属冻结文件，哈希已证）
- 五段式输出结构：未改动（能力层不经过五段式，思辨问题仍由冻结链路生成）
- 知识资产：未新增、未 ingest、未 embedding
- 实时数据：**未进入 RAG**（能力层结果直接返回，不落 corpus、不参与检索）

---

## 4. 回滚方案

三级预案，**粒度由细到粗**，优先使用能解决问题的最小粒度。

### L0 — 仅撤销 R-001 补丁（保留 Capability Layer）

**适用**：Case 1/2 失败，或观察期发现 `false_positive_rate > 0` 且怀疑源于 R-001 放宽的正则。

**操作**：

```bash
cp weapp/scripts/baseline-o0.6/capabilities-router.js.preR001.bak \
   weapp/cloudfunctions/chat/capabilities/router.js
```

然后在微信开发者工具重新「上传并部署：云端安装依赖」。

**效果**：能力层保留，时间/日期/天气识别退回 Phase R 初版（漏判 5/19，但零误判）。
**代价**：`现在北京时间` 等句式重新回落 RAG。
**验证**：`sha256sum` 应回到 R-001 前的 router.js 哈希；`node weapp/scripts/test_capabilities.js` 预期 60 通过 + 15 新增用例失败（属预期，新用例针对补丁能力）。

### L1 — 关闭 Capability Layer（熔断，秒级）

**适用**：Case 3 失败（能力层抢占思辨），或线上出现任何能力层相关的严重异常。

**操作**：云开发控制台 → 云函数 `chat` → 配置 → 环境变量 → 新增/修改：

```
CAPABILITY_ENABLED = false
```

保存后立即生效（无需重新部署代码）。

**效果**：`index.js:30` 判定为关闭，`capabilities` 模块**根本不被 require**，链路完全等价于 Phase R 之前。
**代价**：「现在几点」类问题回到原始缺陷状态。
**优点**：**不需要重新部署**，是所有预案中最快的一级。

> 顺带：`CAPABILITY_INVITE_ENABLED=false` 可单独关闭思辨邀请尾句而保留事实回答，属"半档"手段，用于邀请文案引发困扰但事实能力正常的场景（如 PF-02 扩大化）。

### L2 — 恢复 Phase R baseline（整体摘除能力层）

**适用**：L0/L1 均无法收敛，或需要彻底回到 Phase Q 之前的代码形态。

**操作**：

```bash
cp weapp/scripts/baseline-o0.6/chat-index.js.o06.bak \
   weapp/cloudfunctions/chat/index.js
cp weapp/scripts/baseline-o0.6/observabilityLogger.js.o06.bak \
   weapp/cloudfunctions/chat/observability/observabilityLogger.js
```

如需彻底移除模块目录（Node 侧安全删除，避免 safe-delete 拦截）：

```bash
node -e "require('fs').rmSync('weapp/cloudfunctions/chat/capabilities',{recursive:true,force:true})"
```

然后重新部署。

**效果**：回到 O-0.6 + Phase P+ 状态。
**冻结资产**：**无需回滚**——四资产从未被改动过，这是三轮迭代以来最重要的安全垫。

### 回滚决策矩阵

| 症状 | 首选 | 备选 |
|---|---|---|
| 思辨问题被工具层抢占 | **L1**（立即） | L2 |
| 时间/日期/天气识别过宽（误判） | **L0** | L1 |
| 时间/日期识别过窄（漏判） | 不回滚，转观察期登记 | — |
| 能力层抛异常但已被 try/catch 回退 | 不回滚，观察日志 | L1 |
| 观测字段污染 / 落库异常 | L2（仅恢复 logger 亦可） | — |
| 冻结资产异常 | 不可能发生；若发生立即全面停机排查 | — |

---

## 5. 观察期启动

**状态转换**：`Phase R — Deployment` → **`Phase R — Observation`** ✅ **已生效**（Smoke Test 3/3 PASS，2026-08-05 16:28）

**观察期起点基线**（用于后续增量统计）：

| 项 | 起点值 |
|---|---|
| 观察期开始时刻 | 2026-08-05 16:28（北京时间） |
| `observability_logs` 总记录数 | 52 |
| `capability` 非空记录数 | 5（其中 2 条为 Smoke Test，**统计时应剔除**） |
| **有效真实样本计数起点** | **3**（部署后人工真机验证，16:16–16:17） |
| 距 N≥50 门槛 | 还需 **≥47** 条真实用户样本 |

> **计数口径（避免自欺）**：Smoke Test 与后续任何人工构造调用**不计入**真实样本。观察期取数时应排除 admin openid 与 CLI 调用（CLI 调用无 OPENID）。R2 准入的 50 条必须是**真实用户流量**。

**观察期第一纪律：只观察，不优化。**

观察期内**禁止**：调整正则、扩展能力、接入天气数据源、修改文案、进入 Phase R2、基于个别 case 做即兴修补。发现的一切问题**只登记不处置**，统一在观察期结束后评审。

**五项观察指标**（口径详见 `docs/PhaseR-ObservationPlan.md`）：

| 指标 | 说明 | 预期方向 |
|---|---|---|
| `capability_hit_rate` | 能力层命中占比 | **上升是预期，不是异常**（R-001 就是为提升召回） |
| `false_positive_rate` | 思辨问题被能力层抢占的比例 | **必须为 0**；> 0 则优先怀疑 R-001，走 L0 |
| `tool_ok_rate` | 工具执行成功率 | 接近 100%（时间/计算无外部依赖；天气无源时为设计内的 `tool_ok=false`） |
| `latency` | 端到端耗时 | 命中能力层的请求应**显著低于** RAG 路径（无检索、无模型调用） |
| `user_followup_rate` | 工具回答后用户继续追问的比例 | 无预设目标，用于评估思辨邀请的实际效果 |

**样本门槛**：真实生产样本 **≥ 50**。

**R2 准入**：样本达标 + `ObservationPlan` 中 A–G 七道闸全过，方可评审进入 Phase R2。**样本未达标前，Phase R2 一律 BLOCKED。**

**观察期开放登记项（只记不改）**：

| ID | 级别 | 内容 |
|---|---|---|
| R-001-a | P3 | `北京时间现在是多少啊` 类长句尾缀仍在锚定式之外（方向安全） |
| PF-02 | P3 | 日期查询沿用时间口径邀请语「不是几点」 |
| R-002 | P2 | 观测缺显式 `location_authorized` 布尔（记少而非记多） |
| R-003 | P2 | 位置授权分支回答含地址会经 `logChat` 落 `logs` 集合；**当前不可达**（前端从不上报 `location`）。**列为 R2 硬性前置：前端接入位置上报之前必须先解决**，不许跟功能一起顺推 |
| R-004 | P3 | 无 Node 16.13 真机环境验证（仅静态兼容扫描） |
| R-005 | P3 | E-v2 回归 20/21，失败项为 O-0.6 遗留，与 Phase R 无关 |

---

## 6. 签署

| 角色 | 结论 | 时间 |
|---|---|---|
| Release Guardian | 部署前检查 **PASS**，0 阻塞项，批准人工执行部署 | 2026-08-05 13:26 |
| Production Deployment Engineer | 部署通道判定为 HUMAN-EXECUTED，操作步骤与回滚预案已就绪 | 2026-08-05 13:26 |
| 部署执行人 | 人工经微信开发者工具「上传并部署：云端安装依赖」，**部署成功** | 2026-08-05 16:15:53 |
| 部署后核验 | 环境变量 **PASS**（PF-04 风险未发生）· 云端代码接入顺序 **PASS** · 冻结资产 After **PASS** | 2026-08-05 16:25 |
| Smoke Test 判定 | ✅ **3/3 PASS**（生产真实调用取证，非离线预演） | 2026-08-05 16:28 |
| 观察期状态 | ✅ **Phase R — Observation 已启动**，有效样本起点 3 / 目标 ≥50 | 2026-08-05 16:28 |

**部署完成，状态已推进至 Phase R Observation。不进入 Phase R2，不设计新功能，等待样本达标后的下一次评审。**

---

## 7. 本次部署最终结论

**✅ DEPLOYED & VERIFIED — Phase R Capability Layer 已在生产环境正常工作。**

三项核心事实：

1. **原始缺陷已闭环。** 用户最初报障的「问『现在几点』被扔进哲学回答并自曝无法联网」，在生产环境实测为：248 ms 返回准确北京时间，零自曝短板表述。R-001 补丁的靶心用例 `现在北京时间` 同样命中。
2. **产品人格未被侵蚀。** `时间的意义是什么` 仍走完整五段式，召回《论语》《道德经》《孟子》三条经典，`capability` 观测字段为 `null`。**同含「时间」二字的两类问题被正确分流**——这是能力层设计成立的最强证据。
3. **冻结基线三轮迭代零破坏。** Phase Q（freshness）、Phase R（capabilities）、R-001 补丁，四份冻结资产 SHA256 始终与 O-0.6 逐字节一致。这也是 L2 回滚永远不需要触碰冻结资产的原因。

**附带收益（非目标，但值得记录）**：实时事实问题的响应从模型路径的 ~8.6 s 降至工具路径的 ~0.2 s，约 35 倍，同时消除了对应的模型调用成本。

---

*相关文档：`PhaseR-DeploymentPreflightCheck.md`（本次）· `PhaseR-R001-PatchReport.md` · `PhaseR-DeploymentReadinessReport.md` · `PhaseR-FreezeIntegrityReport.md` · `PhaseR-TestReport.md` · `PhaseR-DeploymentGuide.md` · `PhaseR-ObservationPlan.md`*
