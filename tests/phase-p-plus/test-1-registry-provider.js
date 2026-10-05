// ============================================================
// 测试 1：Registry Provider 一致性 + 可替换性
// ------------------------------------------------------------
// 守护约束（docs/64 §8 Extension Boundary / docs/67）：
//   · getRaw() 与原生 JSON.parse 读取 o1-registry.json **100% 一致**
//   · 派生查询方法语义与原始 records 一致
//   · 抽象层**可替换**：换一个实现（内存 Provider）后，所有调用方
//     拿到的派生结果必须逐字节相同 —— 证明"未来换云数据库零改动"
//   · getUnifiedRecords 对 corpus.json 是**只读**（哈希不变）
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CHAT = path.resolve(__dirname, '..', '..', 'cloudfunctions', 'chat');
const { RegistryProvider, createRegistryProvider } = require(path.join(CHAT, 'registry', 'registryProvider'));

const REGISTRY_PATH = path.resolve(__dirname, '..', 'pilot-o1', 'o1-registry.json');
const CORPUS_PATH = path.join(CHAT, 'corpus.json');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** 第二种实现：纯内存 Provider，只实现 getRaw()。用于验证抽象可替换。 */
class MemoryRegistryProvider extends RegistryProvider {
  constructor(config) {
    super(config);
    this.raw = config.raw;
  }
  getRaw() {
    return JSON.parse(JSON.stringify(this.raw));
  }
}

module.exports = {
  name: 'Registry Provider 一致性与可替换性',
  run(t) {
    // --- 1. getRaw() 与原生读取完全一致 ---
    const native = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
    const provider = createRegistryProvider({
      type: 'json',
      filePath: REGISTRY_PATH,
      corpusPath: CORPUS_PATH,
    });
    const viaProvider = provider.getRaw();

    t.deepEqual(viaProvider, native, 'getRaw() 与原生 JSON.parse 结果 100% 一致');
    t.equal(
      JSON.stringify(viaProvider),
      JSON.stringify(native),
      'getRaw() 序列化后逐字符一致（字段顺序未被改写）'
    );

    // --- 2. 派生方法语义正确 ---
    t.deepEqual(provider.getAll(), native.records, 'getAll() === raw.records');

    const stats = provider.getStats();
    t.equal(stats.total, native.records.length, 'getStats().total 等于 records 长度');
    const statusSum = Object.keys(stats.byStatus).reduce((s, k) => s + stats.byStatus[k], 0);
    t.equal(statusSum, stats.total, 'byStatus 分布求和等于 total（无遗漏/重复计数）');
    const typeSum = Object.keys(stats.byType).reduce((s, k) => s + stats.byType[k], 0);
    t.equal(typeSum, stats.total, 'byType 分布求和等于 total');

    const first = native.records[0];
    t.equal(provider.getById(first.knowledge_id).length, 1, 'getById 命中唯一记录（' + first.knowledge_id + '）');
    t.equal(provider.getById('NOT-EXIST-ID').length, 0, 'getById 未命中返回空数组（不抛错）');
    t.equal(
      provider.getByStatus(first.status).length,
      native.records.filter((r) => r.status === first.status).length,
      'getByStatus 计数与原始数据一致'
    );
    t.equal(
      provider.getByType(first.knowledge_type).length,
      native.records.filter((r) => (r.knowledge_type || 'classic') === first.knowledge_type).length,
      'getByType 计数与原始数据一致'
    );

    // --- 3. 可替换性：换实现，派生结果必须完全相同 ---
    const mem = new MemoryRegistryProvider({ raw: native, corpusPath: CORPUS_PATH });
    t.deepEqual(mem.getAll(), provider.getAll(), '换实现后 getAll() 结果相同');
    t.deepEqual(mem.getStats(), provider.getStats(), '换实现后 getStats() 结果相同');
    t.deepEqual(
      mem.getUnifiedRecords(CORPUS_PATH),
      provider.getUnifiedRecords(CORPUS_PATH),
      '换实现后 getUnifiedRecords() 结果相同 —— 抽象层可替换成立'
    );

    // --- 4. 抽象基类契约：未实现 getRaw() 必须显式报错，不静默返回空 ---
    let threw = false;
    try {
      new RegistryProvider({}).getAll();
    } catch (e) {
      threw = /must be implemented/.test(e.message);
    }
    t.ok(threw, '基类未实现 getRaw() 时显式抛错（不静默降级为空数据）');

    // --- 5. 工厂未知类型必须报错 ---
    let facThrew = false;
    try {
      createRegistryProvider({ type: 'mysql' });
    } catch (e) {
      facThrew = /Unknown registry provider type/.test(e.message);
    }
    t.ok(facThrew, '工厂对未知 provider 类型显式抛错');

    // --- 6. 统一视图：经典只读并入，corpus.json 哈希不变 ---
    const before = sha256(CORPUS_PATH);
    const unified = provider.getUnifiedRecords(CORPUS_PATH);
    const after = sha256(CORPUS_PATH);
    t.equal(after, before, 'getUnifiedRecords 对 corpus.json 只读（SHA256 不变）');

    const fromCorpus = unified.filter((r) => r.source === 'corpus');
    const fromRegistry = unified.filter((r) => r.source === 'registry');
    const corpusRaw = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf-8'));
    t.equal(fromCorpus.length, corpusRaw.length, '统一视图中经典条数 == corpus.json 条目数');
    t.equal(fromRegistry.length, native.records.length, '统一视图中认证对象条数 == registry 记录数');
    t.equal(unified.length, corpusRaw.length + native.records.length, '统一视图总数 = 经典 + 认证（无重复计数）');
    t.ok(
      unified.every((r) => r.knowledge_id && r.knowledge_type && r.status && typeof r.quality_score === 'number'),
      '统一视图每条记录字段规范化完整'
    );
    t.ok(
      fromCorpus.every((r) => r.knowledge_id.indexOf('classic:') === 0),
      '经典记录统一加 classic: 前缀（与认证对象 ID 空间隔离）'
    );

    // --- 7. corpus 路径不可读时优雅降级（不抛错、不伪造经典） ---
    const degraded = provider.getUnifiedRecords(path.join(__dirname, '__no_such_corpus__.json'));
    t.equal(degraded.length, native.records.length, 'corpus 不可读时只返回认证对象（降级不抛错、不伪造）');

    t.info('注册表实际内容：' + native.records.length + ' 条认证对象，schema=' + native.schema);
  },
};
