# Phase Q2-18：分类器路由 + 合成底座护栏修复（真机级端到端）

**日期**: 2026-08-07 21:25–22:10
**状态**: ✅ COMPLETED / 已部署
**触发**: 用户"直接修复"——Q2-17 超时修复部署后，真机仍走「person_identity_boundary」降级模板。

## 问题现象
Q2-17 修了搜索层超时/URL，但「付航是谁」仍降级。本次写了一条**贯穿 maybeHandle 的全链路 e2e**（真实调百炼 API），发现根因不在搜索层，而在**上层分类与护栏**：

| 问法 | 现象 | 根因 |
|------|------|------|
| 付航是谁 | 6ms 落 `category-C-guidance` 降级，未调搜索 | 分类器把人物身份判成 C |
| 付航是谁(修分类后) | 落 `conflicting_info` 降级 | 合成单源含"澄清/反转"措辞被误判多源冲突 |
| 付航是谁(修冲突后) | 落 `guard_rejected:missing-unknown-ack` | 合成底座 unknown_points 非空，强制"无法确认"措辞 |
| 今天有什么科技新闻 | 偶发 `guard_rejected:missing-synth-disclaimer` | 免责声明寄托模型随机输出，temperature 下时灵时不灵 |
| 付航的学历是什么 | 返回 null（走原 RAG，不检索） | PERSON_IDENTITY_RE 只认"X是谁"，漏了"X的学历" |

## 根因分析（4 个 bug）

### Bug 1：人物身份规则被 intent 层抢先截胡（主因）
**文件**: `freshness/eventClassifier.js`
`classifyCategory` 中：
- 第 ⑤ 步 `intentFactual → C`（约 212 行）排在
- 第 ⑥ 步 `isPersonIdentity → B`（约 240 行）**之前**

冻结 `intent.js` 把「付航是谁」判成 `type:'knowledge'` → `intentFactual` 命中 → 先返回 C。
Q2-15 加的"人物身份强制归 B"规则形同虚设（永远到不了）。

**修复**: 把 `isPersonIdentity → B` 提前到第 ②-c 之后、③ factOnly 与 ⑤ intentFactual **之前**（新增 ②-d 块），并删除末尾重复的 ⑥ 块。

### Bug 2：PERSON_IDENTITY_RE 覆盖过窄
只匹配 `X是谁 / X是什么人 / X是何许人` 等，漏了 `X的学历是什么` 这类属性问法 → 被 intent.js 判 knowledge → 落 A → 走原 RAG 不检索。
**修复**: 正则追加 `.{2,10}的(学历|经历|履历|生平|背景|简介|资料|近况)(是|有|如何|怎样|怎么样|咋样|是什么)`。

### Bug 3：合成底座被冲突/未知硬检误杀
- `freshness/index.js:250` `conflicting_info` 降级：对**单源合成**(LOW 置信) 误触发——百炼综合文字含"澄清/反转"叙述措辞，非真实多源冲突。
- `responder.guardOutput` `missing-unknown-acknowledgement`：合成底座 unknown_points 非空，强制要求"无法确认"措辞，但合成模式已由"联网免责声明"覆盖不确定性。
**修复**:
- `freshness/index.js`：`!extraction.hasSynthesized &&` 守护冲突降级。
- `responder.guardOutput`：`!synthesized &&` 守护未知承认硬检。

### Bug 4：合成免责声明依赖模型随机输出（flaky）
`responder.generateFreshnessAnswer` 对 `missing-synth-disclaimer` 直接硬拒 → 偶发降级。
**修复**: 合成底座仅缺免责声明时，**程序化追加**标准免责尾注（确定性满足诚实要求，不丢内容、不降级）：
`\n\n（以上为网络综合内容，未经独立核实，仅供参考）`。其他违规（空答/归因断定/传记幻觉等）仍硬拒。

## 验证结果

```
=== Q2-18 e2e（3 问法 × 2 轮，真实调百炼 API）===
付航是谁            ✅ B类接管 + 含免责声明 + 大专学历信息
今天有什么科技新闻  ✅ B类接管 + 含免责声明 + 真实新闻条目
付航的学历是什么    ✅ B类接管 + 含免责声明 + 大专学历核实
两轮回合均 3 PASS / 0 FAIL

=== Q2-18 分类器回归（8 问法）===
付航是谁→B / 付航的学历→B / 新闻→B / 新电影→B
人生意义→A / 论语仁→A / 这件事你怎么看→B(low→澄清) / 明星出轨→D
8 PASS / 0 FAIL
```

## 修改文件清单（均非冻结资产）
| 文件 | 改动 |
|------|------|
| `freshness/eventClassifier.js` | 人物身份归 B 前置(②-d) + PERSON_IDENTITY_RE 扩属性问法 |
| `freshness/responder.js` | 合成底座免 unknown-ack 硬检；缺免责声明程序化追加 |
| `freshness/index.js` | 合成单源豁免 conflicting_info 降级 |

**冻结资产 SHA 4/4 不变**: corpus.json `db01fbc9…` / intent.js `765ad138…` / rag.js `4fb2dca4…` / knowledgeRouter.js `84890844…`

## 生产入口确认
`chat/index.js:335` 已将 `models/openid/answerMode/searchProvider/factualEnabled` 传入 `maybeHandle`，真机走与本地 e2e 同一链路（线上用 model_config 的 qwen-plus 生成回答，程序化免责追加兜底消除随机性）。

## 现状
- ✅ 部署成功（`tcb fn deploy chat --force`）
- ✅ 人物身份/新闻热点/属性问法 三类均稳定联网
- ⛔ 未 commit（按惯例留用户）
- 诚实边界：合成模式无独立来源 URL、置信降级，理论仍有模型综合误差；需"带来源零幻觉"严谨联网可切腾讯云 WSA（Q2-12 适配器 tencentWsaSearch.js 就绪，改 SEARCH_PROVIDER=tencent 即可）
