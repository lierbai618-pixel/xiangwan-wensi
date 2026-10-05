// ============================================================
// RegistryProvider — 知识注册表抽象层（Phase P+）
// ------------------------------------------------------------
// 目的：把「注册表存储实现」与「业务/观测逻辑」解耦。
//   当前实现 = JSON 文件（o1-registry.json）；未来升级到云数据库，
//   只需新增一个实现相同接口的 Provider（如 DbRegistryProvider），
//   调用方（Dashboard / Health Score / 准入流程）零改动。
//
// 设计约束（对齐 docs/64 §8 Extension Boundary）：
//   · 抽象接口稳定（Frozen 风格），具体实现可替换。
//   · getRaw() 返回原始注册表对象，与既有 o1-registry.json 的原生
//     JSON.parse 读取结果 100% 一致（Phase ⑥ 测试守护）。
//   · 不修改 Registry schema（见 docs/62 §4 / §5）。
//   · 经典（corpus.json）以只读方式并入「统一视图」，绝不写回 corpus。
// ============================================================

'use strict';

/**
 * 抽象基类：所有 Registry Provider 必须实现 getRaw()，返回
 * { schema, namespace, storage, records } 结构的原始对象。
 * 其余查询方法均基于 getRaw() 派生，保证语义一致、便于替换实现。
 */
class RegistryProvider {
  constructor(config) {
    this.config = config || {};
  }

  /** 子类实现：返回与 o1-registry.json 顶层结构一致的原始对象 */
  getRaw() {
    throw new Error('RegistryProvider.getRaw() must be implemented by subclass');
  }

  /** 返回 records 数组（100% 兼容既有读取——Phase ⑥ 测试基准） */
  getAll() {
    const raw = this.getRaw();
    return (raw && raw.records) || [];
  }

  getById(knowledgeId) {
    return this.getAll().filter((r) => r.knowledge_id === knowledgeId);
  }

  getByStatus(status) {
    return this.getAll().filter((r) => (r.status || '') === status);
  }

  getByType(knowledgeType) {
    return this.getAll().filter((r) => (r.knowledge_type || 'classic') === knowledgeType);
  }

  /** 状态分布统计（供 Dashboard Registry Status 使用） */
  getStats() {
    const all = this.getAll();
    const byStatus = {};
    const byType = {};
    all.forEach((r) => {
      const s = r.status || 'unknown';
      const t = r.knowledge_type || 'classic';
      byStatus[s] = (byStatus[s] || 0) + 1;
      byType[t] = (byType[t] || 0) + 1;
    });
    return { total: all.length, byStatus, byType };
  }

  /**
   * 统一视图：把 grandfathered 经典（corpus.json，只读）与认证对象（registry）
   * 合并为同一种规范化记录形态。用于 Dashboard Knowledge Count / KQS / Health Score。
   * @param {string} corpusPath 经典语料 JSON 路径（只读，不修改）
   */
  getUnifiedRecords(corpusPath) {
    const certified = this.getAll().map((r) => ({
      knowledge_id: r.knowledge_id,
      title: r.title || r.knowledge_id,
      knowledge_type: r.knowledge_type || 'classic',
      status: r.status || 'candidate',
      quality_score: typeof r.quality_score === 'number' ? r.quality_score : 1.0,
      source: 'registry',
    }));
    let classics = [];
    try {
      const fs = require('fs');
      const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf-8'));
      classics = (Array.isArray(corpus) ? corpus : []).map((c) => ({
        knowledge_id: 'classic:' + (c.id || c.title || 'unknown'),
        title: c.title || (c.id || 'unknown'),
        knowledge_type: 'classic',
        status: 'published',
        quality_score: 1.0,
        source: 'corpus',
      }));
    } catch (e) {
      // 只读失败不影响主流程：经典视图为空，仅丢失计数
    }
    return classics.concat(certified);
  }
}

/**
 * 工厂：根据 config.type 选择具体 Provider。
 * 未来新增存储实现（db / cloud）只需在此分支注册，调用方不变。
 * @param {{type: string, filePath?: string, corpusPath?: string}} config
 */
function createRegistryProvider(config) {
  config = config || {};
  if (config.type === 'json') {
    const { JsonRegistryProvider } = require('./jsonRegistryProvider');
    return new JsonRegistryProvider(config);
  }
  throw new Error('Unknown registry provider type: ' + config.type);
}

module.exports = { RegistryProvider, createRegistryProvider };
