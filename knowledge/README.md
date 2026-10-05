# knowledge/ — 原始资料仓库

本目录是「哲学思辨助手」的**原始资料仓**，与运行时数据库（`documents` / `chunks`）分离。

- **这里放什么**：每本书一个文件夹，含 `metadata.json`（来源登记）+ `source.txt/md`（原文/校勘本）。
- **这里不放什么**：不存放运行时数据、不存放 `corpus.json` 旧语料（旧语料在 `weapp/archive/`）。
- **谁消费**：Phase C-2 的 `ingest` 云函数读取本仓 `status: ready` 的资料包，写入云端 `documents` / `chunks`。
- **规范**：详见 `docs/07-知识资产结构.md`。

## 目录

```
knowledge/
├── README.md
├── index.json          # 资料清单 manifest（每本状态/分类/版权）
├── _TEMPLATE/          # 新建资料包请复制此模板
├── chinese_philosophy/ # 中国哲学
├── western_philosophy/ # 西方哲学
├── psychology/         # 心理学（受版权保护为主）
└── literature/         # 文学（需公版译本）
```

## 新增一本资料

1. 复制 `_TEMPLATE/` 到对应分类目录，文件夹名用稳定 slug（英文小写+下划线）。
2. 填 `metadata.json`：来源/作者/分类/视角/主题/版权，**`legalConfirm: true`**。
3. 放 `source.txt/md`：用 `# 篇名` 分章。
4. 在 `index.json` 登记，`status` 设为 `ready`（版权 `pending` 不得标 ready）。
5. 提交评审，进入 Phase C-2 由 `ingest` 入库。

## 原则

- 只归档，不删除。下架 = `status: archived`。
- 版权第一闸门：`pending` / `legalConfirm:false` 不得入库。
