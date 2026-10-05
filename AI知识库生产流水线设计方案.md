# AI 知识库生产流水线（Knowledge Pipeline）设计方案

> 角色：高级 RAG 架构师 + 知识工程负责人 + AI 产品架构师
> 范围：第一阶段——**仅架构分析与设计，不修改任何代码**。
> 目标：让管理员可上传合法拥有的 txt / pdf / markdown / epub 文档，系统自动完成「解析 → 清洗 → 结构识别 → 章节提取 → 智能切分 → metadata → 关键词 → 向量 → 人工审核 → 入库 → RAG 检索」。
> 合规边界：本方案为**内容无关的通用知识生产引擎**。文档入库前必须经过**来源合法性 + 版权授权**校验；管理员上传的文档须为其合法拥有或获授权的资料。所有示例均使用中性占位（如《示例文献》/某古籍/科普文章），不针对任何特定敏感内容。

---

## 第一部分：当前系统评估

### 1.1 当前知识库存储方式
- 文件：`cloudfunctions/chat/corpus.json`（随 chat 云函数代码一起打包部署）。
- 形态：**静态 JSON 数组**，194 条扁平条目；无数据库表、无向量、无 embedding。
- 检索时由 `rag.js` 在**云函数内存**里 `require` 进来，预建词频索引（`_docIndex`），模块级缓存，冷启动算一次。

### 1.2 当前 rag.js 结构
- **检索方式**：纯词法。
  - `tokenize()`：中文 2~4 元语法（n-gram）+ 英文词 + 硬编码主题词典（`topicLexicon`）+ 停用词（`stopWords`）。
  - 相似度：TF 词频向量 → `cosine()` 余弦。
  - `inferQueryFrame()`：正则判断 7 类意图（emotion/longTerm/investigation/learning/contradiction/practice/general），用 `frameTitles` 对偏好篇目加权 +100。
  - 综合分 = 词法分 + 向量分×24 + 来源优先级 + 意图偏好加权。
- **无 embedding、无语义向量、无外部向量库**。
- **生成**：`tryModelAnswer()` 用 `nodeFetch` 调 `model_config` 里已启用模型（多模型顺序切换），失败回退 `composeLocalAnswer()`（本地模板拼接）。
- 输出：`citations`（含 title/year/source/section/text/summary/tags/score）。

### 1.3 当前 corpus.json 格式
每条约 11~13 个字段：

| 字段 | 说明 | 出现 |
|---|---|---|
| id | 主键 | 194 |
| title | 篇目名 | 194 |
| year | 年份 | 194 |
| source | 出处 | 194 |
| section | 小节名 | 194 |
| text | 正文片段 | 194（平均 615 字，11~801） |
| summary | 摘要 | 194 |
| tags | 关键词数组 | 194 |
| modernUsage | 现代用法提示 | 194 |
| caution | 注意事项 | 194 |
| sourceUrl / imported / checksum | 导入来源/标记/校验 | 180 |

**缺失**：无 embedding、无 chapter 层级、无 parent_id、无 difficulty、无 domain、无审核状态、无向量检索。

### 1.4 当前云函数架构
| 云函数 | 职责 | 数据库集合 |
|---|---|---|
| chat | 检索 + 模型增强 + 安全检测(msgSecCheck) + 日志 | model_config / logs |
| admin | 模型配置 CRUD + 用户统计 + 权限(ADMIN_OPENID) | model_config / logs |
| history | 会话历史 load/append/clear | conversations |
| login | 获取 openid | — |
| feedback | 用户反馈 | feedback |

全部基于 `wx-server-sdk`（微信云开发，文档型数据库 + 云存储）。

### 1.5 当前数据库能力
- 已用集合：`model_config`、`logs`、`conversations`、`feedback`。
- 能力：文档增删改查、`where/orderBy/limit`、聚合 `aggregate(group/count/sort)`、`command`（gte 等比较）。
- **关键限制**：单文档 16MB；普通查询 `limit` 上限 20、聚合 1000；**无原生向量索引**；云函数冷启动 + 内存有限（不适合在内存里长期缓存超大索引）。
- 云存储（storage）：可存上传的原始文档与解析中间产物。

### 1.6 评估结论
**优势**
- 架构简单、零外部依赖、部署成本低，本地回退保证「永远有回答」。
- 词法检索对小语料够用，且有意图框架加权，体验不差。
- 已具备内容安全双闸（入参/出参 msgSecCheck）与管理权限模型。

**问题**
- 知识库是「手写死文件」，扩一条要改 JSON 并重传云函数，无法运营。
- 无章节层级、无 parent/child 关系，长文本切分粗糙。
- 无 embedding，纯词频对同义/改写/跨章语义召回弱。
- 无审核流，入库即生效，质量不可控。
- 检索与生成耦合在 `rag.js`，难以独立演进。

**扩展瓶颈**
- corpus.json 打包进云函数：语料越大，包越重、冷启动越慢、内存压力越大。
- 云函数内存索引无法支撑万级条目；无向量索引导致语义检索缺位。
- 单文档 16MB / 聚合 1000 条上限，长文档与大规模入库需分批与分页策略。

**改造建议**
- 把知识库从「静态文件」迁到「云数据库集合 + 云存储文件」，检索改为读库。
- 引入 embedding + 向量检索（外部向量库或云函数内存索引，按规模分级）。
- 新增「文档生命周期」与「审核」集合，把入库变成可运营的多阶段流水线。
- 检索接口独立成 `retrieve()`，与生成解耦，复用现有 chat 主流程。

---

## 第二部分：知识库生命周期（Knowledge Pipeline）

```
管理员上传文档
   ↓
Document Upload（云存储落盘 + 元信息登记）
   ↓
Parser 解析（按格式路由）
   ↓
Text Cleaning（去噪/归一化）
   ↓
Structure Extraction（章节树识别）
   ↓
Chunk Generation（Parent/Child 切分）
   ↓
Metadata Generation（AI 辅助打标）
   ↓
Quality Check（自动质检）
   ↓
Embedding（向量化）
   ↓
Index Storage（写库）
   ↓
Human Audit（人工审核）
   ↓
Publish（置为可检索）
   ↓
RAG Retrieval（对外服务）
```

### 阶段明细

**① Document Upload**
- 输入：小程序选择/拖入的文件（txt/pdf/md/epub）、管理员 openid。
- 处理：校验格式与大小 → 上传云存储（带 `_id` 前缀）→ 在 `documents` 集合插入草稿记录（status=`uploaded`）。
- 输出：`document_id`、存储 fileID、初始元信息。
- 异常：格式不支持→拒绝并提示；超大→分片或拒绝（单文件建议 ≤ 50MB）。

**② Parser 解析**
- 输入：fileID + 格式类型。
- 处理：按扩展名路由到对应解析器（见第四部分）→ 提取纯文本 + 原始结构（标题/层级/页码）。
- 输出：`rawText`、`structure`（层级节点数组）、`pageMap`（页码映射）。
- 异常：解析失败→记录 `parse_error` 并通知管理员；乱码→尝试编码探测（GBK/UTF-8/BOM）。

**③ Text Cleaning**
- 输入：`rawText`、`structure`。
- 处理：去页眉页脚/页码/脚注噪声、合并断行、全半角归一、去除多余空白、Unicode 归一（NFC）。
- 输出：`cleanText`。
- 异常：清洗后文本过短（< 50 字）→ 标记并人工确认。

**④ Structure Extraction**
- 输入：`cleanText`、`structure`。
- 处理：用标题层级（# / 一、/ 第N章 / 1.1）构建**章节树**（chapter → section → 段落）；记录每个节点在原文的偏移与（PDF）页码。
- 输出：章节树 `tree[]`：`{chapter, section, startOffset, endOffset, page}`。
- 异常：无标题结构（纯 txt）→ 退化为按空行/字数分章。

**⑤ Chunk Generation**
- 输入：`cleanText`、章节树。
- 处理：生成 Parent Chunk（章节级）与 Child Chunk（观点/段落级），继承章节 metadata（见第五部分）。
- 输出：`chunks[]`：`{id, document_id, parent_id, content, chapter, section, ...}`。
- 异常：超长无标点段落→强制按长度兜底切分并打标。

**⑥ Metadata Generation**
- 输入：每个 chunk 的 `content` + 章节上下文。
- 处理：LLM 分析生成 author/work/chapter/theme/keywords/summary/difficulty（见第六部分）→ 暂存待确认。
- 输出：`metadata` 草稿。
- 异常：模型不可用→跳过 AI 打标，仅保留规则提取的 keywords，留待人工补。

**⑦ Quality Check（自动质检）**
- 输入：chunks + metadata。
- 处理：检测文本完整性、重复（指纹去重）、来源缺失、切分质量（过短/过长）、引用位置可追踪性（见第七部分）。
- 输出：`qualityReport`：`{warnings[], dupChunks[], missingSource[]}`。
- 异常：命中严重项→文档进入 `needs_review` 而非直接待审。

**⑧ Embedding**
- 输入：chunk `content`（可拼接章节前缀以携带上下文）。
- 处理：调用 embedding 接口生成向量（建议中文模型，如 bge/科中文嵌入）。
- 输出：`embedding`（float 数组）。
- 异常：接口失败→记录缺失，检索时退化为词法召回。

**⑨ Index Storage**
- 输入：chunks（含 embedding、metadata）。
- 处理：批量写入 `chunks` 集合；`documents` 状态置 `indexed`。
- 输出：入库完成计数。
- 异常：批量超限→分批 `add`（每批 ≤ 20，符合 limit 上限）。

**⑩ Human Audit（人工审核）**
- 输入：待审文档 + qualityReport。
- 处理：管理员在后台逐文档/逐块查看，确认或驳回；可编辑 metadata、删除块、补来源（见第七、九部分）。
- 输出：审核结论（通过/驳回/需修改）+ `audit_log`。
- 异常：驳回→文档回退 `rejected`，不进入检索。

**⑪ Publish**
- 输入：审核通过的文档。
- 处理：`documents.status = published`，标记其 chunks `retrievable=true`。
- 输出：知识库可用文档数 +1。
- 异常：发布后召回异常→支持一键「取消发布」回退。

**⑫ RAG Retrieval**
- 输入：用户问题。
- 处理：`retrieve(question)` = 词法召回 ∪ 向量召回 → 融合重排 → Top-K（见第八部分）。
- 输出：带来源/评分/引用的 chunks。
- 异常：向量缺失→纯词法；无命中→走现有本地回退。

---

## 第三部分：数据模型

采用微信云开发文档数据库（集合 = 表）。新建 4 个集合，复用现有 `model_config/logs/conversations`。

### 3.1 documents（文档表）
| 字段 | 类型 | 说明 |
|---|---|---|
| _id | string | 文档主键 |
| title | string | 文档标题 |
| author | string | 作者（AI 提取/人工确认） |
| category | string | 分类/领域 |
| source | string | 来源说明（出版/授权） |
| sourceFileId | string | 云存储 fileID |
| version | int | 版本号（重新解析 +1） |
| status | enum | uploaded/parsed/indexed/needs_review/auditing/published/rejected |
| legalConfirm | bool | **来源合法性/版权授权确认**（入库前置） |
| uploadedBy | string | 管理员 openid |
| created_time | date | 创建时间 |
| chunkCount | int | 切块数（冗余统计） |

### 3.2 chunks（分块表）
| 字段 | 类型 | 说明 |
|---|---|---|
| _id | string | 块主键 |
| document_id | string | 所属文档 |
| parent_id | string | 父块 id（Parent↔Child 关联，顶层为自身） |
| content | string | 块正文 |
| chapter | string | 章 |
| section | string | 节 |
| level | enum | parent / child |
| keywords | string[] | 关键词 |
| summary | string | 块摘要 |
| token_count | int | token 数 |
| embedding | float[] | 向量（可空） |
| retrievable | bool | 是否可被检索（审核通过后 true） |
| sourcePosition | string | 原文位置（页码/偏移，供引用追踪） |

### 3.3 citations（引用表）
| 字段 | 类型 | 说明 |
|---|---|---|
| _id | string | 引用主键 |
| chunk_id | string | 关联块 |
| display_text | string | 展示用引用文本（如「《示例文献·第三章》P.42」） |
| source_position | string | 精确位置 |
| verified | bool | 引用是否经人工核验 |

### 3.4 audit_log（审核表）
| 字段 | 类型 | 说明 |
|---|---|---|
| _id | string | 记录主键 |
| document_id | string | 关联文档 |
| status | enum | pending/passed/rejected/needs_fix |
| auditor | string | 审核人 openid |
| issues | string[] | 问题记录（质量项） |
| edited_fields | object | 审核中修改过的字段 |
| time | date | 审核时间 |

### 3.5 设计理由
- **文档与块分离**：一套文档可重新解析出新块版本，旧版本可追溯；块级粒度支撑精准检索与引用。
- **Parent/Child 双表关系**：检索命中 Child 但返回 Parent 上下文，兼顾「精准」与「完整观点」（见第五部分）。
- **embedding 入块**：检索时按 `document_id + retrievable` 过滤后算余弦；海量时再迁移外部向量库（见第八部分）。
- **audit_log 独立**：审核过程可审计、可回放，满足合规与质量追溯。
- **legalConfirm 前置**：把版权/来源合法性作为入库硬闸门，从架构上拦截不合规资料。

---

## 第四部分：文档解析系统

### 4.1 TXT
- 方案：直接读取，按编码探测（UTF-8/BOM/GBK）解码；以空行与标题行推断结构。
- 依赖：无第三方库（Node `fs` + `iconv-lite` 处理 GBK）。
- 问题：常无标题层级、段落粘连、人工换行。
- 处理：正则识别「第X章/一、/1.1」构造章节；断行合并；长度兜底分章。

### 4.2 PDF
- 方案：`pdfjs-dist`（纯 JS，云函数可装）提取文本 + 页码；或 `pdf-parse`（轻量）。
- 依赖：`pdfjs-dist`（推荐，可拿文本层与页码映射）。
- 问题：扫描版 PDF 无文本层（需 OCR，云函数难跑）；多栏版式错乱；页眉页脚噪声。
- 处理：文本层缺失→提示「需 OCR，建议先转文本」；按页码切段；清洗页眉/页码正则；多栏用阅读顺序启发式。

### 4.3 EPUB
- 方案：`epubjs` 或 `jsdom` 解析 OPF/NCX → 遍历 `<spine>` 各 xhtml → 取正文（去标签）。
- 依赖：`epubjs` / `jsdom`。
- 问题：标签噪声、注释/脚注混入、章节分割在多个文件。
- 处理：按 `nav` 目录构建章节树；正文用白名单标签提取；脚注单独剥离或并入尾注块。

### 4.4 Markdown
- 方案：解析 `#`~`######` 标题层级 + 列表/引用 → 直接得章节树（最干净）。
- 依赖：`marked`（仅用其 AST/lexer）或自写标题扫描。
- 问题：表格/代码块误切、内嵌 HTML。
- 处理：代码块整体保留为一个 chunk；HTML 标签剥离；标题层级即章节层级。

### 4.5 结构不丢失 & 引用可追踪（重点）
- 每个解析器都输出 **`structure` 树**（章节层级）+ **`pageMap`**（PDF 页码 / EPUB 文件偏移 / MD 行号）。
- 切分时把 `chapter/section/sourcePosition` 写入 chunk，检索命中即可回写「章·节·页码」引用，做到**引用位置可追踪**。

---

## 第五部分：智能 Chunk 策略

不按固定字数硬切，采用 **Parent–Child 分层**。

### 5.1 Parent Chunk（父块）
- 粒度：**章节/小节级**，约 **800–1500 字**（一个完整论点或一节）。
- 作用：作为「上下文容器」，检索命中时整体喂给 LLM，保证观点完整、上下文不碎。
- 切分依据：优先按 Structure Extraction 的 `section` 边界；超长小节再按语义段落折半。

### 5.2 Child Chunk（子块）
- 粒度：**段落/观点级**，约 **200–400 字**。
- 作用：用于**精准检索**（向量/词法命中具体句子）。
- overlap：**50–80 字**前后重叠，避免句子在边界被切断导致语义丢失。

### 5.3 关联与检索
- 每个 Child 记录 `parent_id` 指向所属 Parent。
- **检索在 Child 上算分，返回时带上 Parent 全文**（或 Parent 摘要 + Child 片段）。
- 示例返回：`「依据《示例文献·第三章·实践》」+ Parent 上下文 + 命中句高亮`。

### 5.4 metadata 继承规则
- Child 自动继承 Parent 的：`document_id / chapter / section / source / sourcePosition（区间合并）`。
- Child 自有的：`content / keywords / summary / token_count / embedding`。
- 重新解析新版本时，旧 `parent_id` 链整体失效，由 `document_id + version` 隔离。

### 5.5 长文本适配
- 经典/长文献往往「一章多论点」：Parent 取「节」，Child 取「自然段」最稳。
- 避免把「论点 A 的结尾 + 论点 B 的开头」拼成一个 chunk（破坏完整观点）——以标点/换行+语义断点为切分锚。

---

## 第六部分：Metadata 自动生成

### 6.1 生成字段
author（作者）、work（作品）、chapter（章）、theme（主题）、keywords（关键词 5–8）、summary（≤60 字摘要）、difficulty（难度：入门/进阶/专业）。

### 6.2 流程
原文片段 → LLM 分析 → 生成 metadata 草稿 → **人工确认/微调** → 落库。
（模型不可用则降级为规则关键词提取，留待人工补。）

### 6.3 Prompt 模板（中性示例）
```
你是一名知识库标注助手。请基于【原文片段】与【章节上下文】抽取结构化元数据。
只输出 JSON，不要解释。

【章节上下文】{chapter} / {section}
【原文片段】{content}

要求：
- author：片段的作者（无法确定填""）
- work：所属作品名
- theme：1–3 个主题标签（如：实践方法 / 调查研究 / 矛盾分析）
- keywords：5–8 个检索关键词（名词短语，便于用户搜索）
- summary：≤60 字，概括该片段核心观点
- difficulty：入门 | 进阶 | 专业

输出格式：
{"author":"","work":"","theme":[],"keywords":[],"summary":"","difficulty":""}
```

### 6.4 防幻觉
- 模板约束「无法确定填""」，避免编造作者/出处。
- 生成后做**字段校验**（JSON 合法、difficulty 取值、keywords 数量），不合法则重抽或转人工。
- 最终以人工审核为权威来源（见第七部分）。

---

## 第七部分：知识质量审核

### 7.1 自动质检项（Quality Check 阶段）
1. **文本完整性**：清洗后长度、是否含大量 `□`/乱码、是否截断。
2. **来源信息**：`source` / `legalConfirm` 是否缺失（缺失→阻断发布）。
3. **重复内容**：对 chunk 计算内容指纹（simhash/前 N 字符 hash），重复率超阈值标记去重。
4. **切分质量**：过短（< 30 字）或过长的块、overlap 异常。
5. **引用准确性**：`sourcePosition` 是否可追溯；`display_text` 与 chunk 是否一致（抽样比对）。

### 7.2 审核流程（人工）
```
文档进入 auditing
   ↓
后台展示：文档元信息 + 章节树 + 逐块预览（含 metadata/来源/位置）
   ↓
管理员操作：
   - 通过整篇（status=published）
   - 驳回（status=rejected，附原因）
   - 需修改：编辑 metadata / 删除问题块 / 补 sourcePosition → 再提交
   ↓
写 audit_log（auditor / issues / edited_fields / time）
   ↓
发布后可在「已发布」列表撤回（retrievable=false）
```

### 7.3 审核原则
- **来源合法性一票否决**：`legalConfirm=false` 或来源不明，禁止发布。
- 抽检 + 全检结合：小语料全检，大体量按章节抽检 + 自动告警块必检。
- 所有修改留痕（`edited_fields`），保证可追溯。

---

## 第八部分：RAG 接入方案

### 8.1 设计目标
- 复用现有 `chat` 云函数主流程与 `generateAnswer` 结构；**只替换 `retrieve` 数据源**。
- 兼容无 embedding 场景（向量缺失自动退化为词法，沿用现有能力）。

### 8.2 retrieve 接口（新）
```
retrieve(question, { topK=5, useVector=true })
  → 词法召回：复用 tokenize + lexicalScore，扫 chunks（where retrievable=true，分页聚合）
  → 向量召回：question embedding → 对候选 chunk 算 cosine（内存或外部向量库）
  → 融合重排：score = α·lexical + β·vector + 意图偏好加权（沿用 frameTitles 思路）
  → 返回 Top-K
```

### 8.3 输出结构
```
{
  citations: [
    {
      chunk_id,
      document_id,
      title,            // 来自 documents.title
      chapter, section,
      content,          // Child 命中内容
      parentContent,    // Parent 上下文（可选，喂 LLM）
      score,
      lexicalScore, vectorScore,
      citation: { display_text, source_position, verified }
    }
  ],
  queryTerms,
  totalDocuments,
  minScore
}
```
- `generateAnswer` 把 `citations` 原样传给 `tryModelAnswer`（构造 context）或 `composeLocalAnswer`，**前端与调用协议不变**。

### 8.4 向量检索的两种落地（按规模）
- **小规模（< 1 万块）**：embedding 存 `chunks` 集合，检索时在云函数内拉取候选算余弦（沿用内存索引思路，但数据在库不在包）。
- **大规模 / 低延迟**：接入外部向量库（腾讯云 VectorDB / 自建 Milvus），`retrieve` 改为先查向量库拿 `chunk_id` 列表，再回 `chunks` 取正文。P0 不强制，P1/P2 演进。

---

## 第九部分：管理后台设计

在现有 `pages/admin` 扩展，新增「知识库」模块。

### 9.1 页面流
```
知识库首页（统计：文档数/已发布/待审/块数）
   ↓
文档管理列表（状态筛选：上传/解析/待审/已发布/驳回）
   ↓
上传文档（选文件 → 显示解析进度）
   ↓
解析状态页（解析中/成功/失败+原因）
   ↓
审核页面（章节树 + 逐块预览 + 编辑 metadata + 通过/驳回/修改）
   ↓
已发布管理（撤回/重新索引/查看块）
```

### 9.2 功能清单
| 功能 | 说明 |
|---|---|
| 上传 | 选 txt/pdf/md/epub，触发 Upload→Parse 流水线 |
| 删除 | 删文档 + 级联删其 chunks（软删/硬删可选） |
| 审核 | 逐块查看、编辑 metadata、确认来源、通过/驳回 |
| 查看 chunk | 树状展开文档的全部 chunk 与 metadata |
| 重新索引 | 重新解析/重新 embedding/重建索引（version+1） |
| 撤回发布 | `retrievable=false`，立即退出检索 |

### 9.3 新增云函数建议
- `ingest`：编排 Upload→Parse→Clean→Structure→Chunk→Metadata→Quality→Embedding→Index（长任务，可拆子步骤）。
- `kb`：文档/块/审核的 CRUD 与查询（替代在 admin 里堆 action）。
- `embed`：调用 embedding 接口（独立便于限流与重试）。

---

## 第十部分：实施路线

### P0 — 最低成本可上线（内容-无关骨架）
- 文件：`cloudfunctions/ingest`、`cloudfunctions/kb`、新增集合 `documents/chunks/audit_log`、`pages/admin` 知识库模块（上传+列表+审核）。
- 模块：TXT/MD 解析（纯 JS）、基础清洗、按标题分章、固定窗口切分（带 overlap）、规则关键词、入库（retrievable 默认 false 需审核）、`retrieve` 读库（词法，无向量）。
- 开发量：中（约 3–5 天）。
- 风险：低。与现有 chat 解耦，失败不影响原检索。

### P1 — 增强自动化
- 文件：PDF/EPUB 解析器、`embed` 云函数、Metadata 生成（LLM）、自动质检（去重/完整性）、融合重排（词法+向量）。
- 模块：外部/内置 embedding、Parent/Child 切分、intent 偏好加权复用、`audit_log` 落审计。
- 开发量：中高（约 1–2 周）。
- 风险：中。PDF/EPUB 解析质量、embedding 接口限流、向量在库内检索的性能。

### P2 — 高级能力
- 文件：外部向量库接入、增量索引、多版本对比、引用核验 UI、检索可解释（命中高亮+评分来源）。
- 模块：向量库（腾讯云 VectorDB / Milvus）、批量重索引任务队列、引用 `verified` 工作流。
- 开发量：高（约 2–4 周）。
- 风险：中高。向量库成本与运维、大体量并发检索延迟。

### 风险总览
| 风险 | 等级 | 缓解 |
|---|---|---|
| 解析质量（PDF 扫描版/OCR） | 中 | P0 仅支持 TXT/MD；PDF 文本层缺失明确提示 |
| embedding 接口限流/费用 | 中 | `embed` 独立 + 重试退避；缺失退化为词法 |
| 云数据库查询上限（20/1000） | 中 | 分批 add、聚合分页、向量库分流 |
| 版权/来源合规 | 高 | `legalConfirm` 硬闸门 + 人工审核一票否决 |
| 检索性能随语料增长下降 | 中 | P1 引入向量；P2 外部向量库 |

---

## 附录：与现有代码的关系
- **保留**：`chat` 主流程、`msgSecCheck` 双闸、`model_config` 多模型切换、本地回退 `composeLocalAnswer`、安全与权限模型。
- **替换**：`corpus.json`（静态）→ `chunks`/`documents` 集合；`rag.js` 内 `retrieve()` 数据源由 require 文件改为读库。
- **新增**：`ingest`/`kb`/`embed` 云函数、`documents/chunks/citations/audit_log` 集合、管理后台知识库模块。
- **不变契约**：`chat` 云函数对前端的返回结构（`ok/answer/citations/retrieval/_modelUsed`）保持不变，前端无感升级。

> 本方案为第一阶段设计稿，**未改动任何代码**。确认后进入实现阶段，按 P0→P1→P2 推进。
