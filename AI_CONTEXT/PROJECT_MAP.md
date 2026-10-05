# PROJECT_MAP.md · 一张图看懂整个项目

> **刷新于 2026-08-07（终校至 Q2-15）**：增加 Freshness/`providers/search/` 护栏链、Think 模式、四模式派发、`security`/`observability` 节点。

```mermaid
graph TD
    subgraph Frontend [前端 miniprogram/]
        H[home + 四模式选择]
        C[chat + 隐私浮层 + 引用卡]
        A[about]
        B[books 书库]
        AD[admin 后台]
        P[privacy 协议]
        S[sessions 列表]
    end

    subgraph Dispatch [chat/index.js 派发]
        MODE[Fast🌐/Deep📚/Think🌅]
        TRACK[Capability/Freshness/Knowledge]
    end

    subgraph Fresh [Freshness 轨道]
        EC[eventClassifier 四分类]
        FD[freshness/* + freshnessRuntimeGuard]
    end

    subgraph Search [providers/search/ 护栏链]
        SL[searchLayer index]
        PG[privacyGate]
        CG[canaryGate]
        QT[quota]
        PR[qwen/tencent/domestic/mock]
        AU[audit data_route=domestic]
    end

    subgraph Cloud [云函数 cloudfunctions/]
        CA[chat: index/rag/intent/knowledgeRouter/answerMode]
        CAP[capabilities: 时间/天气]
        TH[think: Search+RAG+Reasoning]
        FB[feedback]
        HI[history: conversations]
        IN[ingest: documents/chunks/metadata]
        LO[login]
        ADM[admin: model_config/日志]
        SEC[security: msgSecCheck]
        OBS[observability]
    end

    subgraph DB [数据库集合]
        L[logs]
        MC[model_config]
        QL[question_logs]
        AF[answer_feedback]
        AQL[answer_quality_log]
        CONV[conversations]
        CH[chunks]
        DOC[documents]
        OBSL[observability_logs]
    end

    subgraph Knowledge [知识 corpus.json 冻结]
        KN[37 经典 / tags / question_bridge]
    end

    C --> CA
    CA --> Dispatch
    Dispatch --> MODE
    Dispatch --> TRACK
    TRACK --> CAP
    TRACK --> Fresh
    TRACK --> KNW[(Knowledge=rag/corpus)]
    MODE --> Search
    Fresh --> Search
    Search --> SL --> PG --> CG --> QT --> PR --> AU
    PR --> FD
    FD --> KNW
    KNW --> CA
    CAP --> CA
    CA --> DB
    HI --> CONV
    IN --> CH
    IN --> DOC
    FB --> AF
    FB --> AQL
    ADM --> MC
    ADM --> QL
    ADM --> L
    CA --> OBSL
    SEC --> CA
```

## 模块速查

| 想改什么 | 去哪 |
|---------|------|
| 前端聊天 UI / 四模式 | `miniprogram/pages/chat/chat.js` |
| 对话派发 / 路由 | `cloudfunctions/chat/index.js`（**非冻结**） |
| 实时能力（时间/天气） | `cloudfunctions/capabilities/router.js`（`CAPABILITY_ENABLED`） |
| 事件分类 / 降级 / 输出守卫 | `cloudfunctions/chat/freshness/{eventClassifier,downgrade,responder}.js` |
| 在线搜索护栏链 | `cloudfunctions/chat/providers/search/{index,canaryGate,privacyGate}.js` |
| 搜索 provider（百炼/腾讯/国内） | `cloudfunctions/chat/providers/search/{qwenSearch,tencentWsaSearch,domesticApiSearch}.js` |
| 隔离守卫 | `cloudfunctions/chat/freshnessRuntimeGuard.js` |
| 经典召回源（冻结） | `cloudfunctions/chat/corpus.json`（SHA256 守门） |
| RAG / 意图 / 路由（冻结） | `cloudfunctions/chat/{rag,intent,knowledgeRouter}.js` |
| 会话历史 | `cloudfunctions/history/index.js`（COLLECTION="conversations"） |
| 知识入库 | `cloudfunctions/ingest/index.js`（documents/chunks/metadata） |
| 模型/日志管理 | `cloudfunctions/admin/index.js`（model_config/logs/question_logs） |
| 部署配置（必读） | `cloudbaserc.json`（envVariables/runtime/timeout/memorySize） |
```
