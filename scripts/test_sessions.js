// 测试 history 云函数多会话逻辑（内存 mock wx-server-sdk 的 db）
// 覆盖：create / list / load / append / 标题自动生成 / openid 越权校验 / remove / 缺参校验
const Module = require("module");
const path = require("path");

// ---- 内存版 mock 数据库 ----
function makeMockDb() {
  const store = { conversations: [] };
  let seq = 0;
  const matchDocs = (arr, query) =>
    arr.filter((d) => Object.keys(query).every((k) => d[k] === query[k]));
  function makeCollection(name) {
    const data = store[name] || (store[name] = []);
    const chain = {
      _wheres: [],
      _orders: [],
      _limit: 100,
      where(q) {
        this._wheres.push(q);
        return this;
      },
      orderBy(f, dir) {
        this._orders.push([f, dir]);
        return this;
      },
      limit(n) {
        this._limit = n;
        return this;
      },
      async get() {
        let arr = data.slice();
        this._wheres.forEach((q) => {
          arr = matchDocs(arr, q);
        });
        this._orders.forEach(([f, dir]) => {
          arr.sort((a, b) => {
            const av = a[f] && a[f].__date ? a[f].__date : a[f] || 0;
            const bv = b[f] && b[f].__date ? b[f].__date : b[f] || 0;
            return dir === "desc" ? bv - av : av - bv;
          });
        });
        return { data: arr.slice(0, this._limit) };
      },
      async add({ data }) {
        const doc = Object.assign({}, data, { _id: "c" + ++seq });
        data._id = doc._id;
        store[name].push(doc);
        return { _id: doc._id };
      },
      doc(id) {
        return {
          async get() {
            const d = store[name].find((x) => x._id === id);
            return { data: d || null };
          },
          async update({ data }) {
            const d = store[name].find((x) => x._id === id);
            if (d) Object.assign(d, data);
            return { ok: true };
          },
          async remove() {
            const i = store[name].findIndex((x) => x._id === id);
            if (i >= 0) store[name].splice(i, 1);
            return { ok: true };
          },
        };
      },
    };
    return chain;
  }
  return {
    collection: (name) => makeCollection(name),
    serverDate: () => ({ __date: Date.now() }),
    command: {},
  };
}

const mockCloud = {
  init() {},
  database() {
    return makeMockDb();
  },
  getWXContext() {
    return { OPENID: "userA" };
  },
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === "wx-server-sdk") return mockCloud;
  return origLoad.apply(this, arguments);
};

const history = require(path.resolve(__dirname, "../cloudfunctions/history/index.js"));

(async () => {
  let pass = 0;
  let fail = 0;
  const assert = (cond, msg) => {
    if (cond) pass++;
    else {
      fail++;
      console.error("  ✗ FAIL:", msg);
    }
  };

  // create
  const c1 = await history.main({ action: "create" });
  assert(c1.ok && c1._id, "create 返回 _id");
  const cid1 = c1._id;

  // list 应包含刚建的会话
  const l1 = await history.main({ action: "list" });
  assert(l1.ok && l1.list.length === 1 && l1.list[0]._id === cid1, "list 含新会话");

  // append
  const a1 = await history.main({
    action: "append",
    conversationId: cid1,
    userMsg: { role: "user", content: "你好我是小明" },
    assistantMsg: { role: "assistant", content: "在的" },
  });
  assert(a1.ok, "append ok");

  // load 取回 2 条消息 + 角色正确
  const ld1 = await history.main({ action: "load", conversationId: cid1 });
  assert(ld1.ok && ld1.messages.length === 2, "load 返回 2 条消息");
  assert(
    ld1.messages[0].role === "user" && ld1.messages[1].role === "assistant",
    "消息角色正确"
  );

  // 标题自动取自首条 user 前 20 字
  const l2 = await history.main({ action: "list" });
  assert(l2.list[0].title === "你好我是小明", "标题自动取首条 user 前20字");

  // 越权：另一用户不能 load / append
  mockCloud.getWXContext = () => ({ OPENID: "userB" });
  const badLoad = await history.main({ action: "load", conversationId: cid1 });
  assert(!badLoad.ok && /无权限/.test(badLoad.error || ""), "越权 load 被拒");
  const badAppend = await history.main({
    action: "append",
    conversationId: cid1,
    userMsg: { role: "user", content: "x" },
    assistantMsg: { role: "assistant", content: "y" },
  });
  assert(!badAppend.ok, "越权 append 被拒");

  // 恢复 userA，再建一个会话，list 应有 2 个
  mockCloud.getWXContext = () => ({ OPENID: "userA" });
  const c2 = await history.main({ action: "create" });
  const l3 = await history.main({ action: "list" });
  assert(l3.list.length === 2, "userA 有 2 个会话");

  // remove
  const rm = await history.main({ action: "remove", conversationId: cid1 });
  assert(rm.ok, "remove ok");
  const l4 = await history.main({ action: "list" });
  assert(l4.list.length === 1 && l4.list[0]._id === c2._id, "remove 后剩 1 个");

  // 缺 conversationId 报错
  const noId = await history.main({ action: "load" });
  assert(!noId.ok && /缺少会话/.test(noId.error || ""), "缺 conversationId 报错");

  console.log(`\n多会话逻辑测试：${pass} 通过, ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})();
