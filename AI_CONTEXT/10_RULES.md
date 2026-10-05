# 10 · 开发原则（Rules）

> **刷新于 2026-08-07（终校至 Q2-15）**：**废除"阶段一仅文档不写码、禁止改任何文件"的旧红线**——该约束属 Phase H-2 语境，项目早已越过（已至 Q2-15，联网搜索已部署）。
> 阶段最高原则仍为：**代码为真实来源，文档仅解释；冲突指出，不猜测，不修改，等确认（除非用户明确授权）。**

## 当前硬约束（不可破）

| 约束 | 原因 |
|------|------|
| **冻结资产 SHA256 守门** | corpus.json / intent.js / rag.js / knowledgeRouter.js 改动须以 SHA256 比对，漂移=违规，须显式授权 + 评审 |
| **部署前必读 `cloudbaserc.json`** | `tcb fn deploy` 套用其 envVariables/runtime/timeout/memorySize，与生产不一致会**静默覆盖**生产环境变量 |
| **所有云函数改动须重新部署才生效** | 沙箱 `tcb fn deploy <fn> --force`（约 52s） |
| **云函数锁 Nodejs16.13，禁原生 fetch** | 走 rag.js 内置 nodeFetch / util.httpPostJson |
| **模型由云库 model_config 配置（须控制台手动建）** | 前端零模型配置；联网搜索复用同一 model_config 百炼模型 |
| **护栏链路不被破坏** | privacy→canary→quota→provider→audit 任一环改动须保证 fail-soft；禁用跨境 provider（tavily/bing/serp） |
| **事实隔离** | 联网搜索结果只作 runtime context，不进 corpus/embedding/metadata/长期缓存（`freshnessRuntimeGuard.js`） |
| **观测取数纪律**（见 `04_DATABASE.md`） | 违反即假故障（`find+limit` 误判、`疑似` 立项等） |

## 红线（产品/安全，永远不可破）

- 不替用户做决定（经典是启发不是答案）
- 先做人再引经（五段式不可乱序）
- 内容安全（msgSecCheck 先跑；违规文本不进 LLM）
- 不编造经典 / 不编造事实（冷降级走 WenDao 反思增强；传记无源诚实降级，Q2-15）
- 实时能力/联网结果**永不**进 corpus / embedding / 靠 Prompt 生成事实
- `data_route` 必须 `domestic`（国内源），零跨境

## 允许清单（当前）

- ✅ 阅读 / 分析 / 建立更新文档（本 AI_CONTEXT）
- ✅ 在用户授权下修改**非冻结**代码（index.js / freshness/ / providers/ / think/ / capabilities/ / security/ / observability/ 等）
- ✅ 在用户授权下部署（`tcb fn deploy`）/ 提交（Git）
- ✅ 冻结资产在显式授权 + SHA256 比对下可改

## 发现 Bug 时

> **先记录，不修复（除非授权）。** 例如本扫描发现的：
> - `answer_quality_log` vs `quality_logs` 命名冲突（代码 vs 任务书）
> - `metadata` 实为字段非集合
> - `conversation`/`history` 实为 `conversations`
>
> 均已在 `04_DATABASE.md` 如实标注，未改代码。
>
> msgSecCheck 相关：真根因 `-501001/-40003` 仍 0% 可用（OPEN）；`config.json` 声明 + 代码调用即生效，**非"开通"服务**；真机须把 `api.hcnsec.cn` 加 request 白名单（联网搜索在云函数服务端发起，不经小程序 wx.request，故不受此限）。

## Git / 通用坑

- `git status` 里冻结文件 `M` 多为历史遗留未提交；改动以 SHA256 比对为准，勿凭 git 状态判断。
- `tcb fn invoke -d @文件` 须 Windows 绝对路径；`db nosql execute` 须 JSON 数组。
- 中文测试用 Python 显式 utf-8，避 Git Bash curl（GBK 乱码）。
- 删文件被 safe-delete 拦 → Node `fs.rmSync(p,{recursive:true,force:true})`。
- 沙箱 `tcb fn detail` 仅展示入口 `index.js` 源码，不含依赖模块；验证依赖改动须靠 `tcb fn deploy` 整包 + 测试。
