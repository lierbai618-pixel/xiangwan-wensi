# 知识库数据集合字段设计（P0）

> 微信云开发为文档型数据库。以下 4 个集合需在**云开发控制台 → 数据库**手动创建
> （与 `model_config` 同理，SDK 无法建集合）。创建后把集合权限设为「仅创建者可读写」或自定义安全规则。

---

## 1. documents（文档表）
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| _id | string | 自动 | 文档主键 |
| title | string | 是 | 文档标题 |
| author | string | 否 | 作者 |
| category | string | 否 | 分类/领域 |
| source | string | 否 | 来源说明（出版/授权） |
| year | string | 否 | 年份/时期 |
| chapter | string | 否 | 顶层章节（如总论） |
| sourceFileId | string | 否 | 云存储 fileID（P0 文本直传，留空） |
| version | int | 是 | 版本号（重新解析 +1） |
| status | string | 是 | uploaded/parsed/indexed/published/rejected |
| legalConfirm | bool | 是 | **来源合法性/版权授权确认**（入库前置闸门） |
| uploadedBy | string | 否 | 管理员 openid |
| created_time | date | 是 | 创建时间 |
| chunkCount | int | 是 | 切块数（冗余统计） |

---

## 2. chunks（分块表）
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| _id | string | 是 | 块主键（P0 用 文档ID-段落 确定性生成） |
| document_id | string | 是 | 所属文档 |
| parent_id | string | 是 | 父块 id（顶层块指向自身） |
| content | string | 是 | 块正文 |
| chapter | string | 否 | 章 |
| section | string | 否 | 节/标题 |
| level | string | 是 | parent / child |
| keywords | string[] | 否 | 关键词（P0 留空，P1 AI 生成） |
| summary | string | 否 | 块摘要（P0 留空，P1 AI 生成） |
| token_count | int | 否 | 估算 token 数 |
| embedding | float[] / null | 否 | 向量（P0 为 null，P1 填充） |
| retrievable | bool | 是 | 是否可被检索（P0 直接 true） |
| sourcePosition | string | 否 | 原文位置区间（如 "0-480"），供引用追踪 |
| title | string | 否 | 冗余文档标题，便于检索直接携带 |
| year | string | 否 | 冗余年份 |
| source | string | 否 | 冗余来源 |
| author | string | 否 | 冗余作者 |
| category | string | 否 | 冗余分类 |

---

## 3. citations（引用表，P1 填充）
| 字段 | 类型 | 说明 |
|---|---|---|
| _id | string | 引用主键 |
| chunk_id | string | 关联 chunk |
| display_text | string | 展示引用文本（如「《示例文献·第三章》[0-480]」） |
| source_position | string | 精确位置 |
| verified | bool | 是否经人工核验 |

> P0 阶段：chunk 已自带 citation 信息（display_text / source_position），
> citations 集合先建好留空，待 P1 审核流写入「已核验引用」。

---

## 4. audit_log（审核表，P1 填充）
| 字段 | 类型 | 说明 |
|---|---|---|
| _id | string | 记录主键 |
| document_id | string | 关联文档 |
| status | string | pending / passed / rejected / needs_fix |
| auditor | string | 审核人 openid |
| issues | string[] | 问题记录 |
| edited_fields | object | 审核中修改过的字段 |
| time | date | 审核时间 |

> P0 阶段：集合先建好留空；审核流在 P1 实现。
