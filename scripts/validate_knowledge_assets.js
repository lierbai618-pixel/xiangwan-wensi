// Phase C-1 知识资产结构校验（纯 Node，无云依赖）
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "knowledge");
let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name); }
}

// 1. manifest 合法
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "index.json"), "utf8"));
ok("index.json 可解析且为数组", Array.isArray(idx.books));
ok("首批规模 10~15 本内（含 pending）", idx.books.length >= 10 && idx.books.length <= 15);

// 2. 每本 pending/ready 的资料包路径存在
const statuses = {};
idx.books.forEach((b) => { statuses[b.status] = (statuses[b.status] || 0) + 1; });
console.log("  状态分布:", JSON.stringify(statuses));

// 3. ready 的资料包：metadata.json + source 含 # 章节
idx.books.filter((b) => b.status === "ready").forEach((b) => {
  const dir = path.join(ROOT, b.path);
  const metaPath = path.join(dir, "metadata.json");
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  ok(`[${b.id}] metadata.json 含 legalConfirm=true`, meta.legalConfirm === true);
  ok(`[${b.id}] metadata.json 含 perspective/themes`, !!meta.perspective && Array.isArray(meta.themes));
  const srcFile = fs.readdirSync(dir).find((f) => /^source\.(txt|md)$/.test(f));
  ok(`[${b.id}] 存在 source 文件`, !!srcFile);
  if (srcFile) {
    const src = fs.readFileSync(path.join(dir, srcFile), "utf8");
    const hashes = (src.match(/^# /gm) || []).length;
    ok(`[${b.id}] source 用 # 分章 (>=1)`, hashes >= 1);
  }
});

// 4. pending 若为 public-domain 但 status=pending，仅提示
const warnPending = idx.books.filter((b) => b.status === "pending" && b.copyright === "public-domain");
if (warnPending.length) console.log("  · 提示: 以下 public-domain 资料待补 source 后可标 ready:", warnPending.map((b) => b.id).join(", "));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
