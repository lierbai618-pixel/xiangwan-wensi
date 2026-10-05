// ============================================================
// JsonObservabilityStore — 观测数据 JSON 文件存储（Phase P+）
// ------------------------------------------------------------
// 默认存储实现：把观测记录以 JSON 数组追加写入本地文件。
//   · 零外部依赖，可离线测试（Phase ⑥ 测试基线）。
//   · write() 永不抛出：失败仅 console.error，主流程不受影响。
//   · 生产环境应改用 cloudObservabilityStore（写云数据库集合），
//     本实现作为本地/测试/降级兜底。
//
// 接口（与 cloudObservabilityStore 一致，可互换）：
//   async write(record) -> { ok: boolean, error?: string }
//   readAll() -> Array<record>
// ============================================================

'use strict';
const fs = require('fs');
const path = require('path');

class JsonObservabilityStore {
  constructor(config) {
    config = config || {};
    // 默认与模块同目录的 observability-store.json（自包含、可测）
    this.filePath =
      config.filePath ||
      path.join(__dirname, 'observability-store.json');
  }

  /** 追加一条观测记录。失败安全：绝不抛出。 */
  async write(record) {
    try {
      let arr = [];
      try {
        if (fs.existsSync(this.filePath)) {
          arr = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
          if (!Array.isArray(arr)) arr = [];
        }
      } catch (e) {
        arr = [];
      }
      arr.push(record);
      fs.writeFileSync(this.filePath, JSON.stringify(arr, null, 2), 'utf-8');
      return { ok: true };
    } catch (e) {
      console.error('[JsonObservabilityStore] write failed:', e && e.message);
      return { ok: false, error: (e && e.message) || '' + e };
    }
  }

  /** 读取全部记录（供 Dashboard Query Count / Knowledge Usage） */
  readAll() {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const arr = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }
}

module.exports = { JsonObservabilityStore };
