// 知识库入库云函数（P0 MVP）
// action: ingest
//   入参：{ content, title, author?, category?, source?, year?, chapter?, legalConfirm? }
//   流程：创建 documents 记录 → 切分 chunk（Parent/Child）→ 批量写入 chunks 集合
// 暂不实现：PDF/EPUB 解析、embedding、AI metadata、审核流（P1+）
// 依赖：微信云开发（wx-server-sdk）。集合 documents/chunks 需在云开发控制台手动创建。
let cloud = null;
try {
  cloud = require("wx-server-sdk");
} catch (e) {
  cloud = null;
}

// 按长度切分，尽量在句末/换行/空格处断，带 overlap 重叠
function splitByLength(text, max, overlap) {
  const res = [];
  const n = text.length;
  let start = 0;
  while (start < n) {
    let end = Math.min(start + max, n);
    if (end < n) {
      let cut = end;
      while (cut > start + Math.floor(max * 0.5)) {
        const ch = text[cut];
        if (ch && /[。！？\.\!\?\n ]/.test(ch)) {
          end = cut + 1;
          break;
        }
        cut -= 1;
      }
    }
    res.push({ text: text.slice(start, end), start, end });
    if (end >= n) break;
    start = Math.max(end - overlap, start + 1);
  }
  return res;
}

// 纯函数：把文档内容切成 Parent/Child chunk（可在 Node 中直接单元测试）
// 返回数组，每项含 _localId / parent_local / level / content / section / sourcePosition 等
function splitChunks(content, meta) {
  meta = meta || {};
  const lines = String(content || "").split(/\r?\n/);
  const sections = [];
  let cur = { name: "", paras: [] };
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      if (cur.paras.length || cur.name) sections.push(cur);
      cur = { name: h[2].trim(), paras: [] };
    } else {
      cur.paras.push(line);
    }
  }
  if (cur.paras.length || cur.name) sections.push(cur);

  const CHILD_MAX = 500;
  const OVERLAP = 80;
  const base = {
    title: meta.title || "未命名文档",
    year: meta.year || "",
    source: meta.source || "",
    author: meta.author || "",
    category: meta.category || "",
    chapter: meta.chapter || "",
    keywords: [],
    summary: "",
    perspective: meta.perspective || "",
    themes: meta.themes || [],
    problem_tags: meta.problem_tags || [],
  };

  const out = [];
  let si = 0;
  for (const sec of sections) {
    const secText = sec.paras.join("\n").trim();
    if (!secText) continue;
    const parentId = "p" + si;
    out.push(
      Object.assign({}, base, {
        _localId: parentId,
        level: "parent",
        section: sec.name || base.title || "正文",
        content: secText,
        sourcePosition: "0-" + secText.length,
        token_count: Math.ceil(secText.length / 2),
      })
    );
    const pieces = splitByLength(secText, CHILD_MAX, OVERLAP);
    pieces.forEach((piece, ci) => {
      out.push(
        Object.assign({}, base, {
          _localId: parentId + "-c" + ci,
          parent_local: parentId,
          level: "child",
          section: sec.name || base.title || "正文",
          content: piece.text,
          sourcePosition: piece.start + "-" + piece.end,
          token_count: Math.ceil(piece.text.length / 2),
        })
      );
    });
    si += 1;
  }
  return out;
}

// 版权/合法性闸门（纯函数，可单测）
function checkIngestGate(meta) {
  if (!meta.legalConfirm) {
    return { ok: false, error: "来源合法性未确认（legalConfirm=false），拒绝入库。" };
  }
  if (meta.copyrightStatus === "pending") {
    return { ok: false, error: "版权状态为 pending，拒绝入库。" };
  }
  return { ok: true };
}

// 写 documents + 切分 chunks 入库（共享逻辑）
async function writeDocAndChunks(meta, content) {
  if (!cloud) return { ok: false, error: "wx-server-sdk 不可用（请部署到云函数环境）。" };
  const gate = checkIngestGate(meta);
  if (!gate.ok) return gate;

  if (!content.trim()) return { ok: false, error: "content 为空。" };
  if (content.length > 300000) {
    return { ok: false, error: "文档过大（>300k 字符），请拆分后上传。" };
  }

  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  const db = cloud.database();

  try {
    const docRes = await db.collection("documents").add({
      data: {
        title: meta.title,
        author: meta.author,
        category: meta.category,
        source: meta.source,
        year: meta.year,
        chapter: meta.chapter,
        perspective: meta.perspective || "",
        themes: meta.themes || [],
        problem_tags: meta.problem_tags || [],
        translator: meta.translator || "",
        copyright_status: meta.copyrightStatus || "",
        license_note: meta.licenseNote || "",
        verification_date: meta.verificationDate || "",
        user_questions: meta.user_questions || [],
        scenarios: meta.scenarios || [],
        authority_level: meta.authority_level || 5,
        citation_template: meta.citation ? (meta.citation.template || "") : "",
        citation_example: meta.citation ? (meta.citation.example || "") : "",
        sourceFileId: "",
        version: 1,
        status: "indexed",
        legalConfirm: meta.legalConfirm,
        uploadedBy: (cloud.getWXContext() && cloud.getWXContext().OPENID) || "",
        created_time: db.serverDate(),
        chunkCount: 0,
      },
    });
    const docId = docRes._id;

    const raw = splitChunks(content, meta);
    const chunks = raw.map((c) => ({
      _id: docId + "-" + c._localId,
      document_id: docId,
      parent_id: c.parent_local ? docId + "-" + c.parent_local : docId + "-" + c._localId,
      content: c.content,
      chapter: c.chapter,
      section: c.section,
      level: c.level,
      keywords: c.keywords,
      summary: c.summary,
      token_count: c.token_count,
      perspective: c.perspective,
      themes: c.themes,
      problem_tags: c.problem_tags,
      embedding: null,
      retrievable: true,
      sourcePosition: c.sourcePosition,
      title: c.title,
      year: c.year,
      source: c.source,
      author: c.author,
      category: c.category,
    }));

    const BATCH = 20;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      await db.collection("chunks").add({ data: batch });
    }
    await db.collection("documents").doc(docId).update({ data: { chunkCount: chunks.length } });

    return { ok: true, document_id: docId, chunkCount: chunks.length };
  } catch (e) {
    return {
      ok: false,
      error:
        "入库失败：" +
        (e && e.message ? e.message : e) +
        "（请确认已在云开发控制台创建 documents / chunks 集合）",
    };
  }
}

// 读取 knowledge/<pkg> 资料包（本地/测试用；部署后应由调用方内联传入 content+meta）
function buildPackageChunks(pkg) {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "..", "..", "knowledge", pkg);
  const metaPath = path.join(dir, "metadata.json");
  if (!fs.existsSync(metaPath)) throw new Error("找不到 metadata.json: " + dir);
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const srcFile = fs.readdirSync(dir).find((f) => /^source\.(txt|md)$/.test(f));
  if (!srcFile) throw new Error("找不到 source 文件: " + dir);
  const content = fs.readFileSync(path.join(dir, srcFile), "utf8");
  const outMeta = {
    title: meta.title,
    author: meta.author,
    category: meta.category,
    source: meta.source || "",
    year: meta.year || "",
    chapter: "",
    perspective: meta.perspective || "",
    themes: meta.themes || [],
    problem_tags: meta.problem_tags || [],
    user_questions: meta.user_questions || [],
    scenarios: meta.scenarios || [],
    authority_level: meta.authority_level || 5,
    citation: meta.citation || {},
    translator: meta.translator || "",
    copyrightStatus: meta.copyright_status || "",
    licenseNote: meta.license_note || "",
    verificationDate: meta.verification_date || "",
    legalConfirm: !!meta.legalConfirm,
  };
  const chunks = splitChunks(content, outMeta);
  return { meta: outMeta, content, chunks, pkg };
}

async function main(event) {
  const action = (event && event.action) || "ingest";
  if (action === "ingest") {
    const meta = {
      title: ((event && event.title) || "").toString().trim() || "未命名文档",
      author: ((event && event.author) || "").toString().trim(),
      category: ((event && event.category) || "").toString().trim(),
      source: ((event && event.source) || "").toString().trim(),
      year: ((event && event.year) || "").toString().trim(),
      chapter: ((event && event.chapter) || "").toString().trim(),
      perspective: event && event.perspective,
      themes: Array.isArray(event && event.themes) ? event.themes : [],
      problem_tags: Array.isArray(event && event.problem_tags) ? event.problem_tags : [],
      translator: ((event && event.translator) || "").toString().trim(),
      copyrightStatus: ((event && event.copyrightStatus) || "").toString().trim(),
      licenseNote: ((event && event.licenseNote) || "").toString().trim(),
      verificationDate: ((event && event.verificationDate) || "").toString().trim(),
      legalConfirm: !!(event && event.legalConfirm),
    };
    const content = (event && event.content ? event.content : "").toString();
    return writeDocAndChunks(meta, content);
  }

  if (action === "ingest_package") {
    // 优先内联 content+meta（生产：调用方读取 knowledge/ 后传入）；否则尝试本地读取（开发/测试）
    if (event && event.content) {
      const meta = {
        title: (event.title || "").toString().trim() || "未命名文档",
        author: (event.author || "").toString().trim(),
        category: (event.category || "").toString().trim(),
        source: (event.source || "").toString().trim(),
        year: (event.year || "").toString().trim(),
        perspective: event.perspective,
        themes: Array.isArray(event.themes) ? event.themes : [],
        problem_tags: Array.isArray(event.problem_tags) ? event.problem_tags : [],
        translator: (event.translator || "").toString().trim(),
        copyrightStatus: (event.copyrightStatus || "").toString().trim(),
        licenseNote: (event.licenseNote || "").toString().trim(),
        verificationDate: (event.verificationDate || "").toString().trim(),
        legalConfirm: !!(event && event.legalConfirm),
      };
      return writeDocAndChunks(meta, event.content.toString());
    }
    const pkg = (event && event.package ? event.package : "").toString().trim();
    if (!pkg) return { ok: false, error: "ingest_package 需要 package 路径或内联 content+meta。" };
    try {
      const built = buildPackageChunks(pkg);
      return writeDocAndChunks(built.meta, built.content);
    } catch (e) {
      return { ok: false, error: "读取资料包失败：" + (e && e.message ? e.message : e) };
    }
  }

  return { ok: false, error: "未知操作：" + action };
}

module.exports = { main, splitChunks, buildPackageChunks, checkIngestGate };
