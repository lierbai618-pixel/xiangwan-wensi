// 资料库盘点（Library Inventory）旁路处理器 —— 非冻结资产，新增模块。
// 动机：用户常问「资料库里有 X 吗 / 有哪些书 / 收录了什么经典」这类
//   **关于资料库自身内容**的元问题。原链路走 rag.js 的语义检索（帧偏置 + 概念桥），
//   会因「书」字触发「学习读书」桥、并把论语/大学/柏拉图《申辩篇》凭 general 帧 +100 偏置
//   顶到最前，导致「资料库里有马克思主义相关的书吗」反而召回不到马克思主义条目。
//   本模块不走语义检索，直接对 corpus.json 的 tags/title/source 做子串精确匹配，
//   绕开帧偏置与概念桥污染，给出准确的「库里有什么」清单。
// 接入点：index.js 在主流程最前调用 maybeHandle，返回非 null 即短路，
//   与 capability/freshness/thinkEngine 旁路语义一致；加载/执行异常均 fail-soft 返回 null。
const corpus = require("./corpus.json");

// 命中「资料库内容盘点」类问法的模式（tight，避免误伤正常内容提问）。
const INVENTORY_PATTERNS = [
  // 资料库/书库/库里 + 有/收录/包含/什么/哪些/吗
  /(资料库|书库|库里).{0,12}(有|收录|包含|存|收|什么|哪些|吗)/u,
  // 开头型：有哪些 / 收录了什么 / 有什么书
  /^(有哪些|收录了(什么|哪些)|有什么(书|经典|著作|资料|文献)|库里(有|收录))/u,
  // 你们/这个助手 + 有/收录 + 书/经典
  /(你们|你们这|这个(助手|应用|小程序|程序)).{0,8}(有|收录|包含|什么|哪些)(书|经典|著作|资料|文献)/u,
];

function detectInventory(message) {
  const m = (message || "").toLowerCase();
  return INVENTORY_PATTERNS.some((p) => p.test(m));
}

function findHits(message) {
  const m = (message || "").toLowerCase();
  return corpus.filter((doc) => {
    const tags = doc.tags || [];
    return (
      tags.some((t) => t && m.includes(String(t).toLowerCase())) ||
      m.includes((doc.title || "").toLowerCase()) ||
      m.includes((doc.source || "").toLowerCase())
    );
  });
}

function maybeHandle(message) {
  if (!detectInventory(message)) return null;
  try {
  const hits = findHits(message);

  // 未识别到具体主题词：返回总览，引导用户点名具体篇目。
  if (hits.length === 0) {
    const answer =
      "本资料库共收录 " + corpus.length + " 部中外经典（均为节选或通行选段，非全文原文），" +
      "涵盖中国先秦诸子、西方哲学与马克思主义经典等。\n" +
      "你可以直接问我某一部的具体内容，例如「资本论讲了什么」「实践论主要讲了什么」「论语说了什么」。";
    return {
      ok: true,
      mode: "model",
      answer: answer,
      citations: [],
      _modelUsed: "library",
      _modelStatus: "ok",
      retrieval: { totalDocuments: corpus.length, inventory: true, matched: 0 },
    };
  }

  const list = hits
    .map((d) => "· 《" + d.title + "》" + (d.year ? "（" + d.year + "）" : ""))
    .join("\n");
  const answer =
    "本资料库收录了以下相关经典（均为节选 / 通行选段，非全文原文）：\n" +
    list +
    "\n\n共 " + hits.length + " 篇。需要哪一篇的具体内容，直接告诉我篇名即可，" +
    "例如「" + hits[0].title + " 讲了什么」。";
  return {
    ok: true,
    mode: "model",
    answer: answer,
    citations: hits,
    _modelUsed: "library",
    _modelStatus: "ok",
      retrieval: { totalDocuments: corpus.length, inventory: true, matched: hits.length },
    };
  } catch (e) {
    console.error("[libraryInventory] maybeHandle unexpected error:", e && e.stack ? e.stack : e);
    return null;
  }
}

module.exports = { maybeHandle, detectInventory, findHits };
