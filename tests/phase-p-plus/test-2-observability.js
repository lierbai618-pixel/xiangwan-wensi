// ============================================================
// 测试 2：Observability 非阻塞 + 失败安全 + 字段契约覆盖度
// ------------------------------------------------------------
// 守护约束（docs/68）：
//   · logObservation 永不抛错到主链路（同步抛/异步 reject 都要吞掉）
//   · 不 await 落库：慢 store 不得拖慢主流程
//   · JsonObservabilityStore.write 永不抛出，失败返回 {ok:false}
//   · 记录 schema 稳定；对 docs/62 §9 十二字段契约的覆盖度被**锁定**，
//     缺口必须显式暴露而非假装完整
// ============================================================

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CHAT = path.resolve(__dirname, '..', '..', 'cloudfunctions', 'chat');
const {
  logObservation,
  buildObservationRecord,
  createDefaultStore,
} = require(path.join(CHAT, 'observability', 'observabilityLogger'));
const { JsonObservabilityStore } = require(path.join(CHAT, 'observability', 'jsonObservabilityStore'));

// docs/62 §9 十二字段契约
const CONTRACT_12 = [
  'knowledge_type', 'domain', 'intent', 'retrieval_mode', 'router_enabled',
  'router_adjustment', 'rerank_score', 'citation_source', 'chunk_id',
  'vector_score', 'policy_name', 'fallback_reason',
];
// 当前实现的诚实覆盖状态（Phase ⑥ 锁定；任何增减都会让本测试失败，强制更新披露）
const COVERED = ['knowledge_type', 'domain', 'intent', 'router_enabled', 'policy_name', 'fallback_reason'];
const EQUIVALENT = { citation_source: 'retrieval_result' };
const UNCOVERED = ['retrieval_mode', 'router_adjustment', 'rerank_score', 'chunk_id', 'vector_score'];

const SAMPLE = {
  query: '朋友犯错要不要指出',
  answerId: 'ans-test-001',
  conversationId: 'conv-test-001',
  openid: 'test-openid',
  latencyMs: 1234,
  intent: { type: 'advice', domain: '人际', knowledgePolicy: 'use' },
  result: {
    citations: [
      { title: '论语·为政', knowledge_type: 'classic' },
      { title: '确认偏差', knowledge_type: 'psychology' },
    ],
  },
};

module.exports = {
  name: 'Observability 非阻塞与失败安全',
  run(t) {
    // --- 1. 记录构建：字段与取值正确 ---
    const rec = buildObservationRecord(SAMPLE);
    t.equal(rec.query, SAMPLE.query, 'record.query 正确');
    t.equal(rec.answer_id, 'ans-test-001', 'record.answer_id 正确');
    t.equal(rec.conversation_id, 'conv-test-001', 'record.conversation_id 正确');
    t.equal(rec.openid, 'test-openid', 'record.openid 正确');
    t.equal(rec.citation_count, 2, 'citation_count 等于引用数');
    t.deepEqual(rec.knowledge_type, ['classic', 'psychology'], 'knowledge_type 去重聚合正确');
    t.deepEqual(rec.retrieval_result, ['论语·为政', '确认偏差'], 'retrieval_result 记录命中标题');
    t.equal(rec.latency_ms, 1234, 'latency_ms 透传');
    t.equal(rec.domain, '人际', 'domain 落库（docs/62 §9 契约字段）');
    t.equal(rec.intent, 'advice', 'intent 落库（docs/62 §9 契约字段）');
    t.equal(rec.policy_name, 'use', 'policy_name 落库（docs/62 §9 契约字段）');
    t.equal(typeof rec.router_enabled, 'boolean', 'router_enabled 落库为布尔值');
    t.ok(!isNaN(Date.parse(rec.created_at)), 'created_at 为合法 ISO 时间戳');
    t.ok(rec.router_decision !== undefined, 'router_decision 字段存在（只读复算冻结 routeQuestion）');
    t.ok('fallback_reason' in rec, 'fallback_reason 字段存在');

    // --- 2. 缺参数不崩：空 opts 也要产出结构完整的记录 ---
    const empty = t.noThrow(() => buildObservationRecord(), 'buildObservationRecord() 无参不抛错');
    if (empty) {
      t.equal(empty.citation_count, 0, '无引用时 citation_count=0（不为 undefined）');
      t.deepEqual(empty.knowledge_type, [], '无引用时 knowledge_type=[]');
      t.equal(empty.openid, 'unknown', '缺 openid 时降级为 unknown（不伪造真实 openid）');
    }

    // --- 3. docs/62 §9 契约覆盖度：锁定当前诚实状态 ---
    const actualCovered = CONTRACT_12.filter((f) => f in rec);
    t.deepEqual(
      actualCovered.slice().sort(),
      COVERED.slice().sort(),
      '§9 十二字段直接覆盖集合 == 已披露的 ' + COVERED.length + ' 项（缺口不得被悄悄改变）'
    );
    Object.keys(EQUIVALENT).forEach((k) => {
      t.ok(EQUIVALENT[k] in rec, '§9 ' + k + ' 由 ' + EQUIVALENT[k] + ' 等价覆盖');
    });
    t.ok(
      UNCOVERED.every((f) => !(f in rec)),
      '未覆盖的 ' + UNCOVERED.length + ' 项确实缺席（' + UNCOVERED.join('/') + '）—— 均需在冻结 rag.js 内部埋点，推迟 Phase Q'
    );
    t.info(
      'Observability 契约覆盖度：直接 ' + COVERED.length + '/12，等价 1/12，未覆盖 ' + UNCOVERED.length + '/12'
    );

    // --- 4. store.write 同步抛错 → logObservation 不得抛 ---
    const throwingStore = {
      write() {
        throw new Error('boom-sync');
      },
    };
    const r1 = t.noThrow(
      () => logObservation(Object.assign({}, SAMPLE, { store: throwingStore })),
      'store.write 同步抛错时 logObservation 不抛到主链路'
    );
    t.ok(r1 && r1.answer_id === 'ans-test-001', '同步抛错场景仍返回完整记录');

    // --- 5. store.write 返回 rejected Promise → 不得产生未捕获拒绝 ---
    let unhandled = null;
    const onUnhandled = (reason) => {
      unhandled = reason;
    };
    process.on('unhandledRejection', onUnhandled);
    const rejectStore = {
      write() {
        return Promise.reject(new Error('boom-async'));
      },
    };
    t.noThrow(
      () => logObservation(Object.assign({}, SAMPLE, { store: rejectStore })),
      'store.write 异步 reject 时 logObservation 不抛'
    );

    // --- 6. 非阻塞：慢 store 不得拖慢返回 ---
    const slowStore = {
      write() {
        return new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 300));
      },
    };
    const t0 = Date.now();
    logObservation(Object.assign({}, SAMPLE, { store: slowStore }));
    const elapsed = Date.now() - t0;
    t.ok(elapsed < 50, 'store 耗时 300ms 时 logObservation 仍在 50ms 内返回（实测 ' + elapsed + 'ms，未 await）');

    // --- 7. JsonObservabilityStore 读写往返 ---
    const tmp = path.join(os.tmpdir(), 'phase-p-plus-obs-' + Date.now() + '.json');
    const store = new JsonObservabilityStore({ filePath: tmp });
    t.deepEqual(store.readAll(), [], '文件不存在时 readAll() 返回空数组（不抛错）');
    return Promise.resolve(store.write(rec))
      .then((w1) => {
        t.ok(w1 && w1.ok === true, 'write() 成功返回 {ok:true}');
        return store.write(Object.assign({}, rec, { answer_id: 'ans-test-002' }));
      })
      .then(() => {
        const all = store.readAll();
        t.equal(all.length, 2, '两次写入后 readAll() 返回 2 条（追加而非覆盖）');
        t.equal(all[0].answer_id, 'ans-test-001', '第 1 条顺序正确');
        t.equal(all[1].answer_id, 'ans-test-002', '第 2 条顺序正确');

        // 文件被写坏 → readAll 降级为空数组，不抛错
        fs.writeFileSync(tmp, '{ this is not json', 'utf-8');
        t.deepEqual(store.readAll(), [], '存储文件损坏时 readAll() 降级空数组（不抛错）');

        // 写入非法路径 → 返回 {ok:false}，不抛错
        const badStore = new JsonObservabilityStore({
          filePath: path.join(tmp, 'sub', 'dir', 'x.json'),
        });
        return Promise.resolve(badStore.write(rec));
      })
      .then((w2) => {
        t.ok(w2 && w2.ok === false, '写入非法路径返回 {ok:false} 而非抛错');
        try {
          fs.unlinkSync(tmp);
        } catch (e) {
          /* ignore */
        }

        // --- 8. 默认 store 工厂可用 ---
        const def = t.noThrow(() => createDefaultStore(), 'createDefaultStore() 不抛错');
        t.ok(def && typeof def.write === 'function' && typeof def.readAll === 'function',
          '默认 store 实现 write/readAll 接口');

        // 收尾：确认无未捕获拒绝
        return new Promise((resolve) => setTimeout(resolve, 60));
      })
      .then(() => {
        process.removeListener('unhandledRejection', onUnhandled);
        t.ok(unhandled === null, '全过程无 unhandledRejection（异步失败被正确吞掉）');
      });
  },
};
