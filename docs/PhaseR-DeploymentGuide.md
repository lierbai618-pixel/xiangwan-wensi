# Phase R Deployment Guide
### Capability Layer 部署操作与回滚手册

| 项 | 值 |
|---|---|
| 目标云函数 | `cloudfunctions/chat` |
| 云环境 | `YOUR_CLOUD_ENV_ID` |
| 运行时 | Nodejs16.13（**不得变更**） |
| 新增依赖 | 无（无需 `npm install`，`package.json` 未改动） |
| 数据库变更 | 无（不新建集合、不改索引） |
| 前端变更 | 无（`miniprogram/` 零改动） |

> **前置**：执行本手册前，请先确认已就 `PhaseR-DeploymentReadinessReport.md` §8 的 R-001 作出决策（路径 A 先修 / 路径 B 带缺陷上线）。

---

## 1. 为什么必须手动部署

沙箱环境到腾讯云 SCF 代码上传端点（`scf.tencentcloudapi.com`）网络不可达，`tcb` CLI 只能完成读类操作。**代码部署必须由你在微信开发者工具中手动完成**，这是环境限制，非流程偏好。

---

## 2. 部署清单（Pre-flight Checklist）

部署前逐项确认：

- [ ] 冻结四资产 SHA256 与 `PhaseR-FreezeIntegrityReport.md` §1 一致
- [ ] `weapp/scripts/baseline-o0.6/` 内两份 `.bak` 存在（L2 回滚前提）
- [ ] `node weapp/scripts/test_capabilities.js` 输出 60/60
- [ ] `cloudfunctions/chat/capabilities/` 下 7 个文件齐全
- [ ] 微信开发者工具已选中云环境 `YOUR_CLOUD_ENV_ID`（**IDE GUI 操作，不是文件配置**）
- [ ] 已确认 R-001 决策路径

---

## 3. 部署步骤

### Step 1 — 打开项目

微信开发者工具打开 `weapp/`，确认右上角云环境为 `YOUR_CLOUD_ENV_ID`。

### Step 2 — 上传并部署 chat 云函数

在 `cloudfunctions/chat` 目录上右键 → **「上传并部署：云端安装依赖」**。

> 虽然本次无新依赖，仍建议选"云端安装依赖"以保证 `node_modules` 与云端运行时一致。

等待控制台提示上传成功。

### Step 3 — 配置环境变量

云开发控制台 → 云函数 → `chat` → 配置 → 环境变量：

| 变量名 | 建议值 | 缺省行为 | 说明 |
|---|---|---|---|
| `CAPABILITY_ENABLED` | **不设置**（或 `true`） | 默认 **启用** | 能力层总开关。这是缺陷修复而非实验特性，故默认开。设为 `false` 即为 L1 熔断 |
| `CAPABILITY_INVITE_ENABLED` | **不设置**（或 `true`） | 默认 **启用** | 事实之后是否追加"如果你愿意，我们也可以聊聊……"的思辨邀请。设 `false` 则只给纯事实。**仅影响文案风格，不影响事实正确性** |
| `WEATHER_PROVIDER` | **不设置** | 默认 `none` | 天气数据源。当前无合规数据源，保持 `none` → 天气问题走诚实边界声明（绝不编造温度）。数据源选型属 Phase R2，**本阶段不得设置** |

补充（既有变量，本次不变更）：

| 变量名 | 当前值 | 说明 |
|---|---|---|
| `FRESHNESS_ENABLED` | 未设置（关闭） | Phase Q 热点思辨层，仍处关闭态 |
| `KNOWLEDGE_OBSERVABILITY_STORE` | `cloud` | 观测落库，保持不变 |
| `ADMIN_OPENID` | 保留 | 保持不变 |

> 修改环境变量后云函数会重新加载，**无需重新上传代码**。

### Step 4 — 冒烟验证（真机或模拟器）

依次发送，逐条核对：

| # | 输入 | 期望 |
|---|---|---|
| 1 | `现在几点` | 返回具体北京时间，**不得**出现"无法联网""无法获取时间" |
| 2 | `今天几号` | 返回具体日期 |
| 3 | `现在是星期几` | 返回星期 |
| 4 | `23+45等于多少` | 返回 `68` |
| 5 | `10除以0` | 诚实拒答，**不得**给出数字 |
| 6 | `今天天气怎么样` | 声明能力边界，**不得**编造温度 |
| 7 | `我在哪` | 声明需授权定位，**不得**猜测地名 |
| 8 | `时间的意义是什么` | 五段式哲学回答（走 RAG），**不得**返回时间数字 |
| 9 | `如何面对失败` | 五段式哲学回答，行为与部署前完全一致 |

**任意一条不符 → 立即执行 L1 回滚，不要现场调试。**

### Step 5 — 观测链路确认

云开发控制台 → 数据库 → `observability_logs`，查看最新记录：

- 能力路径记录应含 `capability.name` / `bypass_rag: true` / `tool_ok`
- 非能力路径 `capability` 应为 `null`
- **任何记录都不得出现坐标或地址明文**

---

## 4. 回滚方案（三级）

> 原则：**先止血，再定位。** 任何异常优先 L1，不要在生产上尝试修复。

### L1 — 关闭环境变量（秒级，首选）

```
云开发控制台 → 云函数 chat → 配置 → 环境变量
CAPABILITY_ENABLED = false
```

- **生效时间**：函数重新加载后立即生效，无需上传代码。
- **效果**：`capabilities` 模块**根本不被 require**，链路完全退回 Capability 接入前的状态。
- **适用**：能力层行为异常、误判、回答质量下降、运行时报错。
- **副作用**：`现在几点`类问题回到原缺陷状态（这是可接受的止血代价）。

如果只是"邀请文案"不合适而事实正确，可先尝试更轻的处置：`CAPABILITY_INVITE_ENABLED = false`。

### L2 — 恢复 baseline 文件（分钟级）

适用：L1 无法解决（如 `index.js` 接入点或观测层本身异常）。

```bash
cd weapp/cloudfunctions/chat
cp ../../scripts/baseline-o0.6/chat-index.js.o06.bak            index.js
cp ../../scripts/baseline-o0.6/observabilityLogger.js.o06.bak   observability/observabilityLogger.js
sha256sum index.js observability/observabilityLogger.js
# 与 scripts/baseline-o0.6/SHA256SUMS.txt 比对，必须一致
```

然后在微信开发者工具重新「上传并部署：云端安装依赖」。

- **效果**：接入点与观测层回到 Phase R 之前（含 Phase Q Freshness 接入亦一并回退，注意评估）。
- **注意**：`capabilities/` 目录仍在磁盘上，但已无人引用，不产生任何运行时影响。

### L3 — 删除 capabilities 目录（彻底摘除）

适用：确认能力层方案整体废弃。

```bash
# 建议先归档而非直接删除
mv weapp/cloudfunctions/chat/capabilities weapp/archive/capabilities-phaseR-$(date +%Y%m%d)
```

执行 L3 前**必须先完成 L2**（否则 `index.js` 的 `require('./capabilities')` 会走 catch 分支——虽不致命，但留下无意义的错误日志）。

删除后重新上传部署。

### 回滚后必做

1. 复核冻结四资产 SHA256 —— 应始终一致（它们从未被改动，**任何回滚都不需要动它们**）。
2. 重跑 `test_freshness.js` / `test_phasee2.js` 确认原链路完好。
3. 在 `docs/` 记录回滚原因与现场证据，供后续定位。

---

## 5. 不要做的事

| 禁止动作 | 原因 |
|---|---|
| 为修 bug 而改 `corpus.json` 补时间知识 | 实时事实写入知识库即刻过期，是污染 |
| 为修 bug 而改 Prompt 让模型"学会"答时间 | Prompt 产生不了事实，只会诱导编造 |
| 变更云函数运行时版本 | 生产锁定 Nodejs16.13，变更会引入不可控风险 |
| 本阶段设置 `WEATHER_PROVIDER` | 数据源选型属 R2，未经评审接入外部 API 属扩大范围 |
| 前端接入 `wx.getLocation` 上报 | 触发 R-003 潜伏隐私风险，须先解决回答文本落库问题 |
| 生产环境热改代码调试 | 一切异常先 L1 止血 |
