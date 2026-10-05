// ============================================================
// CloudObservabilityStore — 观测数据云数据库存储（Phase P+，可选）
// ------------------------------------------------------------
// 生产环境存储实现：把观测记录写入云数据库 observability_logs 集合。
//   · 仅在云端 env 显式开启（KNOWLEDGE_OBSERVABILITY_STORE=cloud）时由
//     observabilityLogger 选择，不强制依赖。
//   · wx-server-sdk 延迟 require，本地/测试不加载，避免无云环境报错。
//   · write() 永不抛出：失败仅 console.error。
//
// 接口与 JsonObservabilityStore 一致，可互换。
// ============================================================

'use strict';

class CloudObservabilityStore {
  constructor(config) {
    config = config || {};
    this.collection = config.collection || 'observability_logs';
    this._db = null;
  }

  _getDb() {
    if (this._db) return this._db;
    // 延迟加载，避免非云端环境 require 失败
    const cloud = require('wx-server-sdk');
    if (cloud && cloud.init && !this._initialized) {
      try {
        cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
      } catch (e) {
        /* 已在入口初始化时忽略 */
      }
      this._initialized = true;
    }
    this._db = cloud.database();
    return this._db;
  }

  async write(record) {
    try {
      const db = this._getDb();
      await db.collection(this.collection).add({ data: Object.assign({}, record, { createTime: db.serverDate() }) });
      return { ok: true };
    } catch (e) {
      console.error('[CloudObservabilityStore] write failed:', e && e.message);
      return { ok: false, error: (e && e.message) || '' + e };
    }
  }

  async readAll(limit) {
    try {
      const db = this._getDb();
      const res = await db
        .collection(this.collection)
        .orderBy('createTime', 'desc')
        .limit(limit || 1000)
        .get();
      return (res && res.data) || [];
    } catch (e) {
      return [];
    }
  }
}

module.exports = { CloudObservabilityStore };
