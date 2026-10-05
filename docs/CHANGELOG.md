# CHANGELOG

## v0.1.0 — 2026-07-26

- 建立「产品宪法」文档体系（`docs/`）：项目愿景、产品定义、AI 回答规范、知识库规范、技术架构、开发路线图、决策原则。
- 项目定位从原敏感主题**正式 reposition** 为：以经典哲学、文学与心理学为知识基础的 AI 思辨助手（帮人思考，不替其做决定）。
- 确立分阶段执行纪律（Phase A–F，逐阶段评审）。
- 确立"归档冻结而非删除"的旧内容处理原则。
- MVP 知识库明确排除需时政类目资质的内容，优先公有领域经典。
- 确立"需求五问过滤器"与开发纪律，写入 `决策原则.md`。

## v0.2.0 — 2026-07-26（Phase A 评审通过 + Phase B 实施）

- **Phase A 评审 P0 修正**：
  - `01-产品定义.md` 产品边界新增「AI 不承担的责任」（提供思考框架/视角/引用/建议；不提供最终答案/诊断/裁决/唯一价值观）。
  - `02-AI回答规范.md` 心理危机兜底升级为「系统最高优先级」，明确触发范围（自伤/自杀/伤害他人/重大危机）与处理流程。
  - `01-产品定义.md` 验收标准量化（≥1 引用、≥2 视角、原文/解读分离、≥1 开放问题、无唯一答案、引用可追溯 Top5）。
- **Phase A 评审 P1 采纳**：
  - 新增 `06-术语规范.md`，统一 Citation / Chunk / Knowledge / Perspective / Reflection / Interpretation 等术语。
  - `决策原则.md` 第 5 条升级为「项目第一原则」（先改 docs 再改代码）。
  - `03-知识库规范.md` MVP 清单收紧至约 13 本（≤20），明确版权与授权注意。
  - `02-AI回答规范.md` 新增「输出契约」与「回答遥测（P1）」两节。
- **Phase B 实施**：重构 `rag.js` 的 `rolePrompt` 为结构化 `ROLE_PROMPT`（System / Identity / Mission / Workflow / Safety / Output Contract），由 `buildRolePrompt()` 组装；`tryModelAnswer` 改用新 Prompt 并强化输出契约与引用纪律。旧人设（同志你好 / 毛泽东著作）已移除。代码已通过加载与结构校验。
- **Phase B 评审通过**（用户批准 ✅）：核心理念（理解而非说教、多元而非唯一答案）守住；六样例符合「思考伙伴」而非「名言生成器」；前端可渲染性/安全边界/自动校验均通过。

## v0.3.0 — 2026-07-26（Phase C-1 知识资产结构设计）

- 新增 `knowledge/` 原始资料仓（与运行时 `documents/chunks` 分离）：四类目录 + `_TEMPLATE` + `README.md` + `index.json` manifest。
- 新增 `docs/07-知识资产结构.md`：metadata.json 规范（含 `perspective`/`themes` 供 C-2 注入 chunks）、首批 12 本清单（含 1 本受版权保护 pending）、7 条入库验收标准、章节保留与引用回溯规范、Phase C-2 接口约定。
- 建立 2 个 `ready` 示例资料包：`chinese_philosophy/lunyu`（论语·学而/为政）、`western_philosophy/meditations`（沉思录·公版英译片段），均用 `#` 分章、含完整 metadata。
- 首批清单控制 10~15 本（实际 13 登记：12 ready/pending + 1 受版权 pending），目标验证 RAG 非建百科。
- 新增 `scripts/validate_knowledge_assets.js`：结构自洽校验 10/10 通过。
- **未执行批量 ingest**（遵守「先设计后入库」）；未改 `corpus.json`、未改 `retrieve()`。
- 待评审通过后进入 **Phase C-2**：扩展 `ingest` 支持 `ingest_package`，把 `status: ready` 资料包真实写入 `documents`/`chunks`（chunks 新增 `perspective`/`themes`），并跑通引用回溯。

## v0.4.0 — 2026-07-26（Phase C-2 首批真实资料入库联调）

- **Phase C-1 评审通过（用户批准 ✅）**：知识资产层方向正确；`perspective`/`themes` 设计支撑未来 RAG；版权 pending 标记机制获肯定。
- **`ingest` 扩展**：新增 `ingest_package`（读 knowledge 包 / 内联 content+meta）、纯函数 `buildPackageChunks(pkg)`、`checkIngestGate(meta)`（拒绝 `legalConfirm=false` 或 `copyright_status=pending`）。`chunks` 写入新增 `perspective`/`themes`/`problem_tags` 字段；`documents` 写入对应字段 + `translator`/`copyright_status`/`license_note`/`verification_date`。现有 `ingest` 路径向后兼容。
- **KB 检索桥梁（评审核心设计点）**：`rag.js` 的 `chunkSearchText`/`kbLexicalScore` 把 `themes`+`problem_tags` 并入词法打分（纯词法增强，未引入 embedding/rerank）。实现「用户问题 → 人生主题 → 思想视角 → 召回经典」而非仅关键词匹配。
- **metadata 固化字段**（按评审）：新增 `translator`/`source`/`copyright_status`/`license_note`/`verification_date`/`problem_tags`，旧 `copyright`/`license` 改名；`_TEMPLATE`、两个 ready 包、index.json 同步更新。
- **C-2 联调脚本 `scripts/test_c2_ingest.js`**：22/22 通过——论语+沉思录真实解析→5 个人生问题正确召回（迷茫→论语+沉思录；失败/价值→沉思录；自我成长→论语；焦虑→沉思录；行动力→沉思录）；引用 `display_text`/`source_position` 可定位；引用内容逐字来自原文（不幻觉/不截断）；版权闸门拒绝 pending。
- **未做（遵守评审"不要急着做"）**：embedding / rerank / 多 Agent 均未引入。
- **回归**：P0 `test_pipeline.js` 16/16、P0 收尾 `kb_integration_test.js` 31/31 均通过，legacy 模式与既有逻辑未破坏。
- 待评审通过后：扩大至 13 本完整知识库（第二/三梯队），并把 `corpus.json` 移 `archive/`、重构 `localResponse` 为哲学 fallback。

## v0.5.0 — 2026-07-26（Phase C-3 知识资产扩容与冻结）

- **Phase C-2 评审通过（用户批准 ✅）**：确认验证的是"用户问题→意图→主题→原典→可引用内容"链，是 RAG 稳定核心。
- **严格执行非敏感清单**：C-3 知识源严格落在产品宪法批准的非敏感公共领域经典（论语/孟子/大学/中庸/道德经/庄子/沉思录/爱比克泰德手册/申辩篇/尼各马可伦理学），**未**纳入任何需时政资质的内容（评审中一度出现的敏感著作示例被红线拦截，已记入项目记忆）。
- **metadata 字段升级（C-3 评审建议）**：`metadata.json` 新增 `user_questions`（真实用户问法语料库）、`scenarios`（适用场景）、`authority_level`（权威等级 1~5）、`citation`（引用模板）；`_TEMPLATE`、`docs/07`、10 个 ready 包同步。
- **`ingest` 补全字段流转**：`buildPackageChunks` 与 `writeDocAndChunks` 现把 `user_questions`/`scenarios`/`authority_level`/`citation_template`/`citation_example` 持久化进 `documents`，使资产层字段真正入库存档（修复 C-3 测试发现的丢字段问题）。
- **第二/三梯队资料包**：新增 8 本 ready 公版哲学经典（孟子/大学/中庸/道德经/庄子/爱比克泰德手册/申辩篇/尼各马可伦理学），均含真实公版 `source.txt` + 富 metadata；文学 2 本（小王子/悉达多，须公版译本）+ 心理学 1 本（活出生命的意义，受版权）保持 `pending`、`legalConfirm=false`，版权闸门必拒。
- **`knowledge/index.json`**：10 本标 ready、3 本标 pending。
- **`corpus.json` 冻结**：原旧语料（约 559KB）归档至 `archive/corpus.legacy.v1.json`；运行时 `corpus.json` 替换为非敏感哲学语料替身（同 schema：id/title/year/source/section/text/summary/tags/modernUsage/caution），使 legacy / 本地回退不再服务旧内容。
- **C-3 召回测试 `scripts/test_c3_knowledge_graph.js`**：34/34 通过——10 包共 58 chunks 载入；9 个人生问题（迷茫/焦虑/失败/成长/知行/他人评价/长期主义/自我认识/内耗）正确召回期望经典；引用 `display_text`/`source_position` 可定位、文本逐字来自原典（无幻觉）；`user_questions` 桥梁命中；版权闸门拒绝 pending。
- **回归无破坏**：C-2 `test_c2_ingest.js` 22/22、P0 `test_pipeline.js` 16/16、P0 收尾 `kb_integration_test.js` 31/31 全过，legacy 模式在 corpus 替换后依旧可用。
- **未做（遵守评审"不要急着做"）**：embedding / rerank / 多 Agent 未引入；文学/心理学 pending 未擅自入库。
- 待云端部署实测：建集合 → 部署 chat + ingest → `KB_MODE=kb` → `ingest_package` 入库 10 本 → 跑通引用回溯。

## v0.6.0 — 2026-07-26（Phase D 计划与交付：MVP 闭环）

- **Phase C-3 评审通过（A 级，用户批准进入 Phase D ✅）**。品牌名经评审定为 **「问道」**。
- **D-1 全面 rebrand（关键前置）**：发现 Phase B/C 仅改后端 prompt 与知识库，**前端界面从未重新品牌化**，残留「同志你好 / 《毛泽东著作》学习助手 / 主要矛盾 / 持久战」等旧敏感文案；本阶段彻底清理：
  - 前端：`app.json` 标题与 tabBar（首页/对话/说明）、`chat.js` 话题与问候、`chat.wxml` 品牌与「查看思想来源」、`about.*` 去毛选化、「每日一句」→「每日思考」、`privacy.*` 协议正文去毛选化。
  - 后端：`rag.js` 清理 `frameTitles`/`sourcePriority`/`methodSummary`/`chooseAddress` 的旧敏感标题与「同志」称呼。
  - 旧脚本 `build-corpus.js` + `seed.json`（含旧敏感语料）归档至 `archive/`，防止误跑覆盖当前哲学语料；4 份旧敏感主题规划文档一并归档。
- **D-1 新页面**：`pages/home`（今日思考卡 + 人生问题/经典阅读入口）、`pages/books`（10 本 ready 公版经典清单与详情）。
- **D-1 数据资产**：`miniprogram/data/dailyThoughts.js`（30 条取自 10 本经典的今日思考）、`miniprogram/data/books.js`（10 本书目）。
- **D-2 回答模式**：前端 `chat.js` 新增 `modes`/`setMode` 与模式分段控件；后端 `rag.js` 新增 `MODE_PROMPTS` + `buildRolePrompt(mode)`，按 普通/深度/经典 三种模式拼装 system 与 user 指令；本地回退亦按模式追加尾注；`chat/index.js` 透传 `event.mode`。
- **D-3 数据闭环**：`chat/index.js` 每次回答后 fire-and-forget 写 `question_logs` 集合（问题/模式/意图/命中来源/聚合标签）；`admin` 云函数新增 `insights` action 聚合高频主题与高频提问；管理页 `pages/admin` 新增「问题洞察」区块。
- **验证**：10 个改动 JS 通过 `node --check`；3 个 JSON 通过解析；`rag.js` 在 Node 下跑通三模式本地路径，引用均来自 10 本经典、无敏感泄漏；全局 grep 确认活动代码无旧敏感字符串。
- **schema 冻结**：进入 Phase D 后 `knowledge/` 与 `corpus.json` 字段维持 C-3 终版，不再频繁增加。
- **部署差异**：新增 `question_logs` 集合；须重新部署 `chat` + `admin`；`corpus.json` 已直接提交，勿用旧脚本重生成。

## v0.7.0 — 2026-07-26（Phase D 评审通过 A 级 + Phase E-1/E-2 + 回答参数化）

- **Phase D 评审通过（A 级，MVP 内测标准达成 ✅）**：七模块全绿（品牌/首页/经典阅读/多模式/引用/数据闭环/版权边界）。评审确认「问道」已从「知识库问答 Demo」进入「可持续迭代的思想陪伴型 AI 产品」。
- **回答参数化（评审 P：不要继续加模式）**：`rag.js` 把 plain/deep/classic 三模式底层重构为「回答参数」——`ANSWER_PRESETS`（depth 1~3 / classic_weight 0~1 / example_level）+ `resolveAnswerParams(modeOrParams)`（字符串或参数对象，越界 clamp、非法回退 plain）+ `renderModeInstruction(params)`（由参数动态渲染回答方式指令）。前端仍只暴露三预设，复杂度收在内部参数；未来调风格改参数即可，不新增模式。
- **E-1 对话质量（上下文记忆 + 追问理解 + 问题重写）**：
  - `rewriteQuery(query, history)`：短追问（如「那如果我是学生呢？」）用上一轮用户问题补全为自足的检索问题，`followUp`/`contextRef` 贯通到 prompt 与本地回答。
  - `callOneModel` 支持传入最近 6 条历史 messages（system → 历史多轮 → 本轮），让模型「记得」聊过什么、不重复发问。
  - `chat/index.js` 透传 `event.history` 给 `generateAnswer`；`generateAnswer` 先剥离与本轮重复的末尾用户消息，再重写与检索。
- **E-2 思想路线推荐**：`buildRoute(query, citations)` 由问题与命中经典派生「你的问题可能涉及 ①…②…③… → 推荐阅读《…》→ 一句话核心」，形成「用户问题→思想主题→经典→现实解释」引用链；随回答返回 `route`，`chat.wxml` 新增思想路线卡渲染，`chat.wxss` 新增 `.route*` 样式。
- **D-3 数据闭环增强**：`question_logs` 新增 `routeThemes` / `books` / `followUp` 字段，供问题洞察更细粒度地反哺 `problem_tags`。
- **归档规范**：新增 `archive/README_ARCHIVE.md`，明确「历史资产，仅供追溯，不参与运行」，严禁运行 `build-corpus.legacy.js`。
- **验证**：`scripts/test_phasee.js` 27/27 通过（参数化/追问重写/思想路线/端到端无敏感泄漏）；回归 Phase B 22/22、C-2 22/22、C-3 34/34 全过；改动 JS 均通过 `node --check`。
- **部署差异**：`question_logs` 若已建集合无需变更（新增字段自动兼容）；须重新部署 `chat` + `admin`。
- **下一步（Phase E 真实用户验证）**：目标不是加功能，而是收集首批 100 个真实问题 / 高频人生主题 / 召回失败案例 / 用户偏好的回答形式。

## v0.8.0 — 2026-07-26（Phase E 修正评审：用户价值层 E-1~E-5）

> 修正评审核心：首版 Phase E 做到了「像老师一样回答」「有阅读依据」，但缺第三条件——**真正解决用户问题**。
> 确立产品第一原则：**经典不是答案，经典应该帮助用户找到答案**；回答顺序固定为「理解→分析→行动→经典→思考」。

- **E-1 问题理解层（最高优先级）**：`rag.js` 新增 `analyzeQuery(query, history)`，识别 **意图**（找方向/求安慰/寻意义/做决策/求方法）、**情绪**（迷茫/失败/焦虑/孤独/委屈/疲惫/害怕/失望）、**主题**（8 主题）、**策略**（带情绪→comfort-first 经典后置先共情；决策/方法→action-first）。分析贯穿模型 prompt、本地回答、引用卡、`question_logs` 落库（新增 emotion/theme/strategy 字段）。
- **E-2 回答生成策略层**：输出契约重排为固定五段 **理解→分析→行动→经典→思考**；模型与本地拼装统一遵循，经典明确为「启发不是答案」、永不置首。三模式底层仍为回答参数（depth/classic_weight/example_level），用户只见三预设。
- **E-3 行动建议知识层**：新增 `cloudfunctions/chat/actionLibrary.js`，8 主题各映射 `{主题说明, 思想来源(经典), 核心原则, 现实启发, 行动[3]}`，原则取自 10 本公版经典真实思想、不编造出处；本地「行动」段与模型提示均引用，让用户感到"有帮助"。
- **E-4 引用解释层**：引用对象升级为 `{title, section, text, why, principle, inspiration}`；前端引用卡展开显示**为什么引用/核心思想/现实启发**（`enrichCitations()` 由主题派生），把"书的问题"翻译成"人的问题"。
- **E-5 用户反馈优化**：新增 `cloudfunctions/feedback` 云函数写 `answer_feedback` 集合；聊天页每条助手回答加 👍有用/👎没帮助 + 负向原因 chips（解决了我的问题/只是讲道理/引用太多/其他）；管理页「问题洞察」聚合 **有帮助率** 与 **没帮助原因 TOP**，对齐"真正要优化的是用户是否觉得被帮助"。
- **验证**：`scripts/test_phasee2.js` 21/21（理解层/结构顺序/引用卡/反馈链路/无敏感泄漏）；回归 Phase B 22/22、C-2 22/22、C-3 34/34、旧 Phase E 27/27 全过；改动 JS 均 `node --check` 通过。
- **部署差异**：须重新部署 `chat`+`admin`+`feedback`；**新增 `answer_feedback` 集合**（必须手动建）；`question_logs` 新字段云库自动兼容；`archive/` 旧脚本仍禁止运行。
- **新版 MVP 验收标准**：用户问"我很迷茫怎么办"后觉得——①它理解我的处境 ②它分析了我的问题 ③它给了方向 ④它引用经典让我更深理解。

## v0.9.0 — 2026-07-26（Phase F 评审通过：百问验证阶段）

> Phase E 修正评审 **A+ 通过**。下一阶段不是 Phase F 功能堆叠，而是 **Phase F：百问验证（100 User Questions）**——核心是收数据、不堆功能。唯一 sanctioned 的新增代码：`answer_quality_log`（记录"为什么有效/无效"）。

- **F-1 百问分类进度**：`rag.js` `analyzeQuery` 新增 `category`，将 8 主题映射到 5 类桶（人生方向 / 学习成长 / 情绪压力 / 关系问题 / 长期选择，**不新增分类维度**，只是聚合视图避免标签膨胀）；完全无关键词命中的问题归入「未分类」而非悄悄堆进人生方向，保证进度统计可信。`chat/index.js` `logQuestion` 落库 `category`；`admin` insights 输出 `categoryBreakdown`（含 `count/20` 进度条），支撑 20/20/20/20/20 跟踪。
- **F-2 三指标脚手架**：理解准确率（反馈 👍）、行动有效率（反馈 👎+原因）、引用接受度（👎"引用太多"原因）三者全部可由现有 `question_logs`+`answer_feedback` 聚合得出，管理页已呈现。
- **answer_quality_log（F 阶段唯一新代码）**：扩展 `cloudfunctions/feedback` 云函数支持 `type=quality` 分支，写 `answer_quality_log{openid, question, answer_id, failureReason, goodPoint, createTime}`；聊天页在量化评分后提供**可选**自由文本补充「哪里没帮到你 / 哪里帮到你」（不打断主流程）；`admin` insights 聚合 `quality.failures`/`quality.goods` 高频定性原因，用于反哺理解层/行动库/引用策略。与 `answer_feedback`（量化）形成"是否帮 / 为什么帮"双层数据。
- **验证**：`scripts/test_phasef.js` 19/19（五分类映射含未分类、quality 写库分支、rate 默认分支、insights 聚合 categoryBreakdown+quality）；回归 Phase B 22/22、C-2 22/22、C-3 34/34、E 27/27、E-v2 21/21 全过；改动 JS 均 `node --check` 通过。
- **部署差异**：须重新部署 `chat`+`admin`+`feedback`；**新增 `answer_quality_log` 集合**（必须手动建）；`question_logs`/`answer_feedback` 新字段云库自动兼容。
- **Phase F 主线（数据驱动，非功能开发）**：投放内测收首批 100 个真实问题（5 类各 20）；用 `question_logs`+`answer_feedback`+`answer_quality_log` 三集合驱动优化——召回失败标注反哺 metadata 的 user_questions/problem_tags，定性原因反哺理解层与 actionLibrary。E-3 收藏（个人空间）仍留作可选。

## v0.9.1 — 2026-07-26（Phase F 评审补充：answer_id 贯通 + 快捷原因规范）

> Phase F v0.9.0 评审 **A+ 通过**。落地评审明确建议：answer_id 三层贯通（当前唯一硬建议）+ 点踩快捷原因规范化（推荐项，低风险、提升数据质量）。

- **answer_id 三层贯通（评审"当前唯一建议"）**：`chat/index.js` 新增 `makeAnswerId()` 生成规范 ID `YYYYMMDD_xxxx`；所有回答路径（model/local/localOnly-fallback）经 `generateAnswer` 出口后由 `main` 注入 `result.answerId`，写入 `question_logs.answer_id` 并随返回下发前端；前端 `chat.js` 改用后端下发的 id（不再本地生成），`feedback`/`quality` 提交携带同一 `answer_id`。三层（question_logs / answer_feedback / answer_quality_log）由此可关联，未来可分析"哪种回答模板满意度最高"。
- **点踩快捷原因规范化（评审推荐）**：聊天页点踩后的原因 chips 对齐评审建议 5 项语义——太抽象 / 没解决我的问题 / 引用太多 / 缺少行动建议 / 理解错了；自由文本补充保持可选（不强迫填写）。`admin` insights 聚合 `failureReason` 时规范值自然聚合成高频栈。
- **验证**：`scripts/test_phasef.js` 增至 **23/23**（新增 [4] answer_id 格式 + 落库 + 三层一致断言）；全回归绿（B 22 / C-2 22 / C-3 34 / E 27 / E-v2 21）。
- **部署差异**：无新增集合；重部署 `chat`（含 answer_id 注入）+`admin`+`feedback`；`question_logs` 新增 `answer_id` 字段云库自动兼容。
- **Phase G 路线图（记入 docs/10 §9，不提前写代码）**：G-1 查询理解优化（百问反哺口语→标准问题→思想主题）、G-2 回答策略优化（按反馈调五段比例）、G-3 小规模真实用户测试（20~50 人观察留存/二次提问）。100 问真实验收标准：数据层 100 问题+五类稳定+Top20；回答层 👍比例/点踩原因Top10/引用接受率；知识层 新增 user_questions 50+。

## v0.9.3-hotfix — 2026-07-28（回答截断修复 · 工程归档）

> P0 体验 Bug：用户反馈 AI 五段式回答中【思考】段缺失，行动段中途结束。诊断与修复已 commit `8bdfa6e` + tag `v0.9.3-hotfix`，**不影响 Phase F 冻结纪律**（仅改工程参数，未改 prompt / 模式 / 知识库 / 前端）。

### 1. 问题

- **现象**：AI 回答五段结构中【思考】部分缺失；【经典】段的最后一条 AI 解读被截断。
- **截图表现**：回答在【行动】中途结束，例如"比如一起安静泡茶五分钟，不聊未来、不..."。
- **影响**：100 问数据中"回答完整性"维度无法准确评估，用户感知"AI 没说完"。

### 2. 根因

- `weapp/cloudfunctions/chat/rag.js` 的 `callOneModel` 函数（行 963）硬编码 `max_tokens: 400`。
- 400 tokens ≈ 280 中文字符，五段完整回答需 800-1500 tokens（600-1000 字）。
- 模型生成到 400 tokens 触发 `finish_reason: "length"`，回答被服务端截断。

### 3. 修复

```diff
// rag.js:963 (callOneModel)
-        max_tokens: 400,
+        max_tokens: 2000,
```

- **1 文件 1 行修改**（`node --check` 通过）。
- **未触碰**：ROLE_PROMPT、MODE_PROMPTS、RAG 检索逻辑、corpus.json、problem_tags、metadata、chat.js、前端页面、feedback 逻辑。

### 4. 验证

**部署前**（旧版 max_tokens: 400），三模式均丢【思考】段：

| 模式 | answer 长度 | 五段完整 | endsTrunc |
|---|---|---|---|
| plain | 605 | ❌ 缺【思考】 | true |
| deep | 625 | ❌ 缺【思考】 | true |
| classic | 611 | ❌ 缺【思考】 | true |

**部署后**（新版 max_tokens: 2000），三模式全五段完整：

| 模式 | answer 长度 | 五段完整 | endsTrunc | citations |
|---|---|---|---|---|
| plain | 790 | ✅ | false | 3 |
| deep | 883 | ✅ | false | 3 |
| classic | 959 | ✅ | false | 3 |

### 5. 验证项

- ✅ 五段结构完整（理解→分析→行动→经典→思考）
- ✅ endsTrunc=false（不以"问号/句号"以外字符结尾）
- ✅ citations 保持 3 条（RAG 检索未变）
- ✅ RAG 召回未变化（庄子/沉思录/手册均命中）
- ✅ prompt 未变化（plain/d1/c0.3 仍是原配比）
- ✅ 标签体系未变化（emotion="迷茫"、category="人生方向"）

### 6. 影响范围

- 仅提升生成长度（≈ 280 字 → ≈ 600-1000 字），不改变回答逻辑。
- 100 问数据可比性：保持不变（结构/标签/prompt/citations 一致，仅长度充分）。

### 7. 工程记录归档

- **测试数据**：`.workbuddy/chat_test_result_1785225728.json`（部署前）、`.workbuddy/chat_test_result_post_deploy_1785229098976.json`（部署后）。
- **百问模板**：`weapp/phase-f-100-test.json` 每条记录新增 `answer_complete`（是否五段完整）+ `finish_reason`（stop/length）。
- **测试规范**：`weapp/docs/14-百问验证测试记录规范.md` 新增"回答完整性检查"段。

### 8. 部署差异

- 仅需重传 `chat` 云函数（1 行配置变更）。
- **未新增**任何集合、未改任何字段 schema。
- 标签 `v0.9.3-hotfix`（与 `v0.6.1-mvp` / `v0.9.2-prelaunch` 并存）。

### 9. 经验教训

- **token 上限与五段结构的隐性耦合**：从「含截断的 short answer」到「完整五段」需要 5-7 倍 token 余量；以后设定上限时按"完整结构峰值"留 2x buffer。
- **max_tokens 400 是历史遗留值**：v0.6 时期结构更短（理解+分析+经典三段），E 阶段扩展为五段后未同步调整上限——"参数漂移"型 bug 典型。
- **下次相关改动**：Phase G 调五段比例（如加【练习】段）时，同步检查 max_tokens 是否仍够。
