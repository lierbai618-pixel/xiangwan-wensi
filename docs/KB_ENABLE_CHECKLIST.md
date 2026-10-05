# KB / 上线前检查清单（KB_ENABLE_CHECKLIST.md）

> 目的：在「问道」小程序每次部署 / 内测前逐项勾选，避免再漏掉云函数、集合或合法域名。
> 维护人：开发侧。更新时机：部署流程有变化或新增集合时。

---

## A. 云函数部署（顺序重要，每个都要右键→上传并部署·云端装依赖）

- [ ] `login` —— 提供 openid，是历史 / 会话功能的前置
- [ ] `history` —— 多会话读写（依赖 `conversations` 集合）
- [ ] `chat` —— 主对话 + 写 `question_logs`（含 `conversationId`）
- [ ] `admin` —— 模型配置 CRUD + `insights` 聚合（百问看板数据源）
- [ ] `feedback` —— 写 `answer_feedback` / `answer_quality_log`

> 漏传任何一个都会静默失效：`login`/`history` 没传 → 历史永不见；`chat`/`admin`/`feedback` 没传 → 对应能力回退或为空。

## B. 云数据库集合（云控制台手动建，权限默认即可）

**MVP 必需：**
- [ ] `question_logs`
- [ ] `answer_feedback`
- [ ] `answer_quality_log`
- [ ] `conversations`
- [ ] `model_config`

**KB 模式（暂不启用，启用向量/全文召回时才建）：**
- [ ] `documents`
- [ ] `chunks`

> 云数据库不会自动建表。首次写入不存在的集合会报 `DATABASE_COLLECTION_NOT_EXIST`，需先手动建。

## C. 运行环境硬约束（已纠正，务必遵守）

- [ ] `chat` 云函数运行时 = **Nodejs16.13（锁定，无法升级）**
- [ ] 所有云函数代码兼容 Node 16，**禁止原生 `fetch`**，必须走 `rag.js` 内置 `nodeFetch`
- [ ] `chat/config.json` 里的 `runtime:Nodejs18.15` 不生效（环境仍是 16），仅为旧声明；代码已用 `nodeFetch` 兼容 16

> ⚠️ 之前文档写的「确认 chat 运行时 Node 18+」是**错误指令，已作废**。不要再据此去调一个改不了的设置。

## D. 微信公众平台合法域名（真机 / 正式版必需）

- [ ] request 合法域名加入 `api.hcnsec.cn`

> 开发者工具勾选「不校验合法域名」可临时绕过；但**正式版小程序会被微信网关静默拦截**（表现为一直回退本地回答），所以上线前必须加。

## E. 部署后真机验证清单

- [ ] 进聊天页自动建第一个会话（顶栏「会话」可见历史列表）
- [ ] 发消息正常返回（不再出现「点不了发送」）
- [ ] 关于页「意见反馈」提交成功（字段已改为 `question`）
- [ ] 管理页 `insights` 正常渲染：百问分类进度 / 有帮助率 / 定性原因（admin.js 已补 `categoryBreakdown`/`feedback`/`quality` 绑定）
- [ ] 顶栏「新对话」开空白会话，旧会话保留在列表，删除会话从列表移除

## F. 冻结纪律（百问验证期，v0.9.x）

- [ ] **冻结期只收数据、不堆功能**；仅允许修阻断性 bug
- [ ] 不得改：回答结构 / 标签体系 / feedback 文案 / prompt 比例（保 100 问横向可比）
- [ ] `rag.js` 与回答模板不在微调范围
- [ ] Phase G 开启门槛（**全满足**才启动，不按时间）：
  - 100 真实问题
  - 50 有效反馈
  - 20 个明确失败案例
  - 10 个高价值用户问法

## G. 已知遗留（非阻断，跟踪用）

- [ ] **P2 隐私政策**：承诺「清空全部对话」但无入口 → 待加「清空全部对话」按钮（删 `conversations` + 二次确认）或改文案为「可删除已有对话」
- [ ] **未埋点指标**（Phase G 补）：二次追问率、引用展开率、用户语言变化（定性读时间序）
- [ ] **网页版已归档**：原 `app/` `components/` `lib/` `data/` 等已移至 `archive/maoxuan-assistant-legacy/`，与「问道」主线隔离，不再并入、不再维护
- [ ] 根目录遗留（不影响小程序）：`node_modules/`、`.next/`、`output/`（网页版构建产物，可重装）、`_deploy_*.zip`（云函数部署包）、根 `scripts/`（网页版语料导入脚本）
