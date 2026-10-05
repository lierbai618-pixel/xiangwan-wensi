# Release Upload Completion Report

**产品**：向晚问思 WenDao（微信云开发小程序）
**云环境**：YOUR_CLOUD_ENV_ID
**生成时间**：2026-08-06（GMT+8）
**角色**：Release Manager + Release Engineer
**性质**：Release Upload 任务执行记录。**本环境为无头沙箱，无法驱动微信开发者工具 GUI，亦无法触达 SCF 代码上传端点**，故上传与冒烟为人工动作，本报告据实记录可验证项与阻塞项，不伪造任何上传/冒烟结果。

---

## 1. 上传前只读检查（全部 PASS ✅）

| 检查项 | 结果 |
|---|---|
| corpus.json SHA256 | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` ✅ ＝ O-0.6 |
| intent.js SHA256 | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` ✅ ＝ O-0.6 |
| rag.js SHA256 | `5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286` ✅ ＝ O-0.6 |
| knowledgeRouter.js SHA256 | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` ✅ ＝ O-0.6 |
| CR-002 index.js | EXISTS（14091 B）✅ |
| CR-002 security/inputGuard.js | EXISTS（2199 B）✅ |
| CR-002 security/piiScrub.js | EXISTS（1545 B）✅ |
| CR-002 回滚基线 index.js.preCR.bak | EXISTS（10898 B）✅ |
| Phase S-0.3 fixtures.json | EXISTS（22204 B）✅ |
| 临时文件 `.deploy-tmp` | ABSENT ✅ |
| 临时文件 `.release_tmp*` | ABSENT ✅ |
| 临时文件 `chat_dl*` | ABSENT（全盘检索无残留）✅ |

> 冻结资产与 O-0.6 逐字节一致，无漂移；无临时产物遗留；发布前状态干净。

---

## 2. 上传动作执行状态 —— BLOCKED（人工动作，本环境无法执行）

任务要求执行的发布流程：

1. 打开微信开发者工具 — ❌ **无法执行**（无头沙箱，无 GUI）
2. 上传云函数 `cloudfunctions/chat` — ❌ **无法执行**
   - 微信云函数代码上传走 SCF 端点 `scf.tencentcloudapi.com`；
   - 据项目记忆（weapp 沙箱网络约束）：**该端点从沙箱不可达**，代码部署必须由用户在微信开发者工具手动「上传并部署·云端安装依赖」。
3. 上传小程序前端 `miniprogram` — ❌ **无法执行**（需微信开发者工具 GUI 上传）
4. 云端安装依赖 — ❌ 依赖人工上传流程触发，无法独立执行
5. 等待上传完成 / 记录版本 — ❌ 无上传动作则无记录

**结论**：上传步骤全部依赖人工在微信开发者工具中操作，本 Agent 沙箱**既不能驱动 GUI，也无法绕过 SCF 端点限制**，故上传动作在本环境**不可执行**。

> 备注：云端 `chat` 函数当前已为 CR-002 部署版本（FunctionId `lam-8a8p5vsx`，Modification Time `2026-08-05 20:29:21`，已于 Release Closure 阶段代码核验确认）。本次「重新上传」的语义是将其与本地工作树再对齐 + 上传 `miniprogram` 前端，二者均需人工操作。

---

## 3. 上线后冒烟 —— PENDING（人工动作，未执行）

| Case | 输入 | 预期 | 结果 |
|---|---|---|---|
| 1. 普通哲学问题 | 「人为什么会迷茫？」 | 正常五段式回答 | **PENDING**（需真机/工具执行） |
| 2. 违规输入 | 违规/注入文本 | 安全拦截 | **PENDING** |
| 3. PII 测试 | 含手机号/邮箱文本 | 日志脱敏逻辑存在 | **PENDING** |
| 4. 历史问答 | 历史对话 | 无异常 | **PENDING** |
| 5. 冷启动请求 | 首次冷启调用 | 运行正常 | **PENDING** |

> 冒烟需在微信开发者工具/真机中触发，本环境无法伪造，故全部标 PENDING。代码级部署（CR-002）此前已云端核验 PASS。

---

## 4. 冻结资产 SHA256（复核，≡ O-0.6）

```
corpus.json        db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b
intent.js          765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38
rag.js             5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286
knowledgeRouter.js 848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935
```

全部与 O-0.6 baseline 一致 ✅，无漂移。

---

## 5. 当前 Gate 状态

```
RELEASE UPLOAD BLOCKED
```

**阻塞原因**：发布流程中的上传动作（打开微信开发者工具、上传云函数、上传小程序前端、云端装依赖、等待完成）与上线冒烟均属人工 GUI / 真机动作，本无头沙箱无法执行，且 SCF 代码上传端点从沙箱不可达（项目记忆硬约束）。上传前所有只读检查均 PASS，但「上传完成」这一事实无法由本环境产生。

**解除阻塞（人工执行）**：
1. 在微信开发者工具中打开本项目；
2. 右键 `cloudfunctions/chat` → 「上传并部署：云端安装依赖」；
3. 上传 `miniprogram` 前端；
4. 等待上传完成，记录上传时间 / FunctionId / 部署结果；
5. 在真机/工具中执行 §3 五项冒烟并回填结果。

回填后若冒烟全 PASS，可升级为 **RELEASE UPLOAD PASS**。

---

## 6. 约束遵守确认

| 禁止项 | 遵守 |
|---|---|
| 不修改任何代码 / Prompt / rag.js / corpus.json / intent.js / knowledgeRouter.js | ✅ 未改动（仅只读校验） |
| 不接入 Search Provider / 不创建 chat_bakeoff_probe | ✅ |
| 不调用任何外部 API | ✅ 本轮零外部调用 |
| 不修改生产配置 / 不写 SEARCH_PROVIDER | ✅ |
| 不执行 commit/push | ✅ 未提交 |

---

*本报告据实记录，未伪造上传或冒烟结果。停止点：未进入 S0.5 Bake-off / S1 Search / Provider 接入 / 任何新开发阶段。待人工完成上传与冒烟后回填。*
