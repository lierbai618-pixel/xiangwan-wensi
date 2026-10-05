# 向晚问思 SearXNG 国内检索实例 —— 部署 Runbook

> 目标：在**中国大陆服务器**上自建 SearXNG，仅启用国内搜索引擎（百度/搜狗/360），
> 为云函数 `domesticFreeSearch.js` 提供**免费、零跨境**的联网检索能力。
> 对应检索层 `data_route=domestic`，满足 PIPL 数据出境合规。

---

## 0. 前置条件

| 项 | 要求 |
|---|---|
| 服务器 | 中国大陆地域 CVM（腾讯云/阿里云），**离用户近、延迟低** |
| 系统 | Ubuntu 22.04+ / 等，已装 `docker` + `docker-compose` |
| 域名 | 一个**已 ICP 备案**的域名（如 `search.example.com`） |
| 证书 | 由 Caddy 自动申请 Let's Encrypt（需 80/443 可入站） |
| 费用 | 仅 CVM 实例费，**无按量检索费、无第三方 API Key** |

> ⚠️ 域名**必须已完成备案**，否则微信公众平台不会接受该域名为 request 合法域名（见执行计划 Part B）。

---

## 1. 生成密钥

```bash
# (1) SearXNG 实例密钥
openssl rand -hex 32
# 复制输出，替换 settings.yml 中的 REPLACE_WITH_GENERATED_KEY

# (2) 公网 Bearer Token（与云函数 SEARXNG_API_KEY 保持一致）
openssl rand -hex 24
# 复制输出，替换 Caddyfile 中的 REPLACE_WITH_YOUR_KEY，并作为云函数 SEARXNG_API_KEY
```

---

## 2. 配置三件套

已随仓库提供（本目录）：
- `settings.yml` —— 仅国内引擎，监听 `127.0.0.1:8080`
- `docker-compose.yml` —— searxng + caddy
- `Caddyfile` —— HTTPS 自动证书 + Bearer 鉴权

按需修改：
- `settings.yml` → `secret_key`
- `Caddyfile` → `search.example.com` 改为真实域名；`REPLACE_WITH_YOUR_KEY` 改为步骤 1(2) 的 Token；`email`
- `docker-compose.yml` → `SEARXNG_BASE_URL` 改为真实域名

---

## 3. 启动

```bash
cd infra/searxng
docker compose up -d
docker compose ps
```

验证实例本机可达：

```bash
curl -s -H "Authorization: Bearer <你的Token>" \
  "http://127.0.0.1:8080/search?q=向晚问思&format=json" | head -c 300
```

应返回 JSON，且 `results[].engine` 仅含 `baidu` / `sogou` / `360`（或 `so`）。

---

## 4. 验证零跨境（合规关键点）

运行云函数侧冒烟脚本（见 `weapp/scripts/smoke_searxng.js`）：

```bash
SEARXNG_BASE_URL=https://search.example.com \
SEARXNG_API_KEY=<你的Token> \
node scripts/smoke_searxng.js
```

脚本会：
1. 请求 JSON API，确认 HTTP 200 + 有结果；
2. 收集返回结果中的 `engine` 字段，逐一比对**国内白名单**
   （`baidu`/`sogou`/`so`/`360` 为严格国内；`wikidata`/`wikipedia` 为可选需评估）；
3. 若出现任何跨境引擎（bing/google/ddg/tavily…）→ **FAIL**，说明实例误配，需回查 `settings.yml`。

---

## 5. 运维要点

- **引擎锁定**：`settings.yml` 的 `engines` 是唯一可信来源。新增/误配跨境引擎会立刻被冒烟脚本捕获。
- **升级**：`docker compose pull && docker compose up -d`；升级后重跑冒烟脚本。
- **限额**：实例侧 `limiter: false`，真实调用限额由云函数 `SEARCH_DAILY_QUOTA` 控制。
- **回滚**：若实例异常，将 `SEARXNG_BASE_URL` 从云函数环境变量移除（置空）→ `domesticFreeSearch` 立即 `no_endpoint` 降级，不影响 RAG 回答。
- **不写知识库**：检索结果仅作 runtime context，本实例与知识资产零耦合。

---

## 6. 安全

- SearXNG 仅监听 `127.0.0.1`，公网不可直连。
- Caddy 强制 `Authorization: Bearer` 校验，未带 Token 返回 401。
- 建议 CVM 安全组仅放通 80/443；22 仅限运维 IP。
- `secret_key` 与 Bearer Token 属敏感信息，**不要提交进 git**（本目录三文件均不含真实密钥，仅占位）。
