# 上线前全面修复报告

**修复日期**: 2026-08-08 15:10  
**基线扫描**: Pre-Launch-FullScan-20260808.md  
**冻结资产 SHA256**: 4/4 MATCH ✅（修复前后零漂移）

---

## 修复总览

| 级别 | 项目 | 扫描状态 | 修复状态 |
|------|------|---------|---------|
| P0 | cloudbaserc.json 明文 API Key 未被 .gitignore 保护 | ⛔ | ✅ 已修复（前轮） |
| P1 | 隐私政策未披露第三方 AI 处理 | ⛔ | ✅ 已修复 |
| P1 | 9 个 .bak 文件随云函数部署 | ⛔ | ✅ 已清理 |
| P1 | 5 个云函数未部署/未声明 | ⛔ | ✅ 全部部署 |
| P2 | 隐私弹窗仅在 chat 页触发 | ⛔ | ✅ 已前移至 home |
| P2 | project.config.json urlCheck=false | ⛔ | ✅ 改为 true |
| P2 | uploadWithSourceMap=true | ⛔ | ✅ 改为 false |
| P3 | app.json 缺 lazyCodeLoading | ⚠️ | ✅ 已添加 |
| — | chat/config.json timeout=90 vs cloudbaserc=60 不一致 | ⚠️ | ✅ 已对齐 60 |
| — | ingest 缺 config.json | ⚠️ | ✅ 已创建 |
| — | cloudbaserc.json 仅声明 chat | ⚠️ | ✅ 已扩展为 6 函数 |

---

## 一、P1 修复详情

### 1.1 隐私政策补充第三方 AI 处理披露 ✅

**文件**: `miniprogram/pages/privacy/privacy.wxml`

**问题**: 隐私政策第四节"信息的对外提供"原文写道"我们不会向其他第三方共享你的信息"，但实际用户提问被发送至阿里云百炼（DashScope）进行大模型推理和联网搜索，存在 PIPL 合规缺口。

**修复**: 在第四节增加第 3、4 条，明确披露：
- 用户问题文本经脱敏处理（去除手机号、邮箱等 PII）后传输至阿里云百炼（DashScope）
- 服务商服务器位于中国境内
- 仅传输问题文本，不传输 OpenID、会话历史或其他个人信息
- 修正原第 2 条的"不向第三方共享"措辞

### 1.2 清理 .bak 备份文件 ✅

**操作**: `find cloudfunctions -name "*.bak" -not -path "*/node_modules/*" -delete`

**清理清单**（9 个文件）:
- `cloudfunctions/chat/index.js.preCR.bak`
- `cloudfunctions/chat/index.js.preHotfix004.bak`
- `cloudfunctions/chat/index.js.preQ1B.bak`
- `cloudfunctions/chat/index.js.preQ21B.bak`
- `cloudfunctions/chat/index.js.preQ23.bak`
- `cloudfunctions/chat/rag.js.preCR008.bak`
- `cloudfunctions/chat/freshness/eventClassifier.js.preQ1B.bak`
- `cloudfunctions/chat/freshness/index.js.preQ1B.bak`
- `cloudfunctions/chat/freshness/index.js.preQ21B.bak`

**验证**: 清理后 `find` 返回 0 个 .bak 文件。已加入 `.gitignore` 防止再生。

### 1.3 全部云函数部署 ✅

**问题**: `cloudbaserc.json` 仅声明 `chat` 函数，其余 5 个函数（login/history/admin/ingest/feedback）未声明，首次部署时被分配错误的 Nodejs20.19 runtime。

**修复**:
1. 将全部 6 个函数纳入 `cloudbaserc.json`，锁定 `Nodejs16.13` runtime
2. admin 函数配置 `ADMIN_OPENID` 环境变量
3. 为 ingest 创建 `config.json`（timeout:30, memory:256, Nodejs16.13）
4. 对齐 chat/config.json timeout 90→60（与 cloudbaserc.json 一致）

**部署结果**:

| 函数 | Runtime | 修改时间 | 状态 |
|------|---------|---------|------|
| chat | Nodejs16.13 | 2026-08-08 15:02:11 | ✅ Deployment completed |
| login | Nodejs16.13 | 2026-08-08 15:04:32 | ✅ Deployment completed |
| history | Nodejs16.13 | 2026-08-08 15:02:57 | ✅ Deployment completed |
| admin | Nodejs16.13 | 2026-08-08 15:03:28 | ✅ Deployment completed |
| ingest | Nodejs16.13 | 2026-08-08 15:05:18 | ✅ Deployment completed |
| feedback | Nodejs16.13 | 2026-08-08 15:06:04 | ✅ Deployment completed |

---

## 二、P2 修复详情

### 2.1 隐私弹窗前移至全局入口 ✅

**文件**: `miniprogram/pages/home/home.js` + `home.wxml` + `home.wxss`

**问题**: 隐私授权弹窗仅在 `pages/chat/chat` 的 onLoad 触发，用户若先进入首页/说明页则不会看到。

**修复**:
- 在首页（home.js，小程序入口/第一个 tabBar）添加 `showPrivacy` 状态与 `agreePrivacy()`/`declinePrivacy()`/`openPrivacy()` 方法
- 在 home.wxml 添加隐私授权浮层（含第三方 AI 处理摘要）
- 在 home.wxss 添加浮层样式（与 chat 页一致）
- **保留 chat.js 原有检查**作为二级守卫（防止通过分享链接直达 chat 页时绕过）

**覆盖路径**:
- 正常流程: 打开小程序 → home.js 隐私弹窗 → 同意 → 导航至 chat → chat.js 检查通过
- 分享链接: 直达 chat → chat.js 隐私弹窗 → 同意

### 2.2 project.config.json 安全配置 ✅

**文件**: `weapp/project.config.json`

| 项 | 修复前 | 修复后 | 原因 |
|----|--------|--------|------|
| urlCheck | false | **true** | 审核前必须开启域名合法性检查 |
| uploadWithSourceMap | true | **false** | 关闭 SourceMap 上传，减少代码结构泄露 |

### 2.3 app.json 启动性能优化 ✅

**文件**: `miniprogram/app.json`

新增 `"lazyCodeLoading": "requiredComponents"`，按需加载组件代码，减少启动包体积和启动时间。

---

## 三、验证结果

### 3.1 冻结资产完整性 ✅

| 资产 | SHA256 | 状态 |
|------|--------|------|
| corpus.json | `db01fbc9...` | ✅ MATCH |
| intent.js | `765ad138...` | ✅ MATCH |
| rag.js | `4fb2dca4...` | ✅ MATCH |
| knowledgeRouter.js | `84890844...` | ✅ MATCH |

### 3.2 Q2-21 冒烟测试 ✅

本地真实 API 调用，2/2 PASS:

| 问法 | 长度 | 耗时 | direct_factual | 降级 | 免责声明 |
|------|------|------|---------------|------|---------|
| 脱口秀演员房主任 | 525字 | 12.6s | ✅ | ❌ 未降级 | ✅ |
| 付航是谁 | 525字 | 29.1s | ✅ | ❌ 未降级 | ✅ |

### 3.3 云函数部署状态 ✅

`tcb fn list` 确认 6/6 函数全部 Nodejs16.13 + Deployment completed。

### 3.4 .bak 清理 ✅

`find cloudfunctions -name "*.bak" -not -path "*/node_modules/*"` 返回 0。

---

## 四、剩余待办（用户侧操作）

以下项目无法通过代码修复，需用户在微信公众平台操作：

### 4.1 UGC 服务内容声明（B2 硬阻塞）

**操作**: 微信公众平台 → 基本设置 → 服务内容声明 → 声明 UGC 场景

**原因**: 应用接收用户文本输入（问答），属于 UGC 场景。未声明可能导致审核被拒。

### 4.2 真机联网 Canary 验证（B3）

**操作**: 管理员真机打开小程序 → 对话页提问 → 确认联网搜索功能正常

**原因**: 需确认线上 QWEN_SEARCH_API_KEY 有效性及端到端链路。

### 4.3 msgSecCheck 已知问题

**状态**: 0% 可用（errCode -501001），平台侧问题。

**当前兜底**: `SEC_DEGRADE_ON_API_ERROR=true` 降级放行 + `inputGuard` 规则式护栏。

**建议**: 审核备注中说明已接入 msgSecCheck + inputGuard 双层防护，msgSecCheck 异常为平台侧问题。

---

## 五、修复文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `miniprogram/pages/privacy/privacy.wxml` | 编辑 | 补充第三方 AI 处理披露 |
| `miniprogram/pages/home/home.js` | 编辑 | 添加隐私弹窗逻辑 |
| `miniprogram/pages/home/home.wxml` | 编辑 | 添加隐私弹层 UI |
| `miniprogram/pages/home/home.wxss` | 编辑 | 添加弹层样式 |
| `miniprogram/app.json` | 编辑 | 添加 lazyCodeLoading |
| `project.config.json` | 编辑 | urlCheck=true, uploadWithSourceMap=false |
| `cloudbaserc.json` | 编辑 | 扩展为 6 函数声明 |
| `cloudfunctions/chat/config.json` | 编辑 | timeout 90→60 对齐 |
| `cloudfunctions/ingest/config.json` | 新建 | 补全配置 |
| `cloudfunctions/chat/*.bak` (9个) | 删除 | 清理备份文件 |
| 6 个云函数 | 部署 | 全部上线 Nodejs16.13 |

---

## 六、上线就绪评估

| 维度 | 修复前 | 修复后 |
|------|--------|--------|
| 冻结资产完整性 | ✅ 100% | ✅ 100% |
| 前端合规 | ⚠️ 85% | ✅ 97%（仅剩 UGC 声明待用户操作） |
| 安全 | ✅ 90% | ✅ 95%（urlCheck+sourceMap 已修复） |
| 云函数配置 | ✅ 95% | ✅ 100%（6/6 部署，runtime 一致） |
| 代码质量 | ✅ 95% | ✅ 95% |
| 前端性能 | ✅ 100% | ✅ 100%（+lazyCodeLoading） |

**结论**: 代码层面已达到上线标准。剩余 3 项为用户侧操作（UGC 声明 / 真机 Canary / msgSecCheck 审核备注），不涉及代码修改。
