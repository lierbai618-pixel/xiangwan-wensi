// ============================================================
// JsonRegistryProvider — JSON 文件实现的 Registry Provider（Phase P+）
// ------------------------------------------------------------
// 读取既有 o1-registry.json（O-1 认证产物），返回结果与原生
// JSON.parse(fs.readFileSync(filePath)) 100% 一致 —— 不引入任何
// 转换/加工，确保升级存储实现时既有数据零差异。
//
// 不修改 Registry schema；仅做「读取 + 只读视图派生」。
// ============================================================

'use strict';
const fs = require('fs');
const path = require('path');
const { RegistryProvider } = require('./registryProvider');

class JsonRegistryProvider extends RegistryProvider {
  constructor(config) {
    super(config);
    // filePath：注册表 JSON 路径。默认指向 O-1 认证产物（与既有读取位置一致）。
    this.filePath =
      (config && config.filePath) ||
      path.resolve(__dirname, '..', '..', '..', 'tests', 'pilot-o1', 'o1-registry.json');
    // corpusPath：经典语料路径（统一视图只读并入）。默认云函数内的 corpus.json。
    this.corpusPath =
      (config && config.corpusPath) ||
      path.resolve(__dirname, '..', 'corpus.json');
  }

  /**
   * 返回原始注册表对象。与既有「JSON.parse(fs.readFileSync(...))」逐字节等价。
   * 这是 Phase ⑥「旧数据读取结果 100% 一致」测试的判定基准。
   */
  getRaw() {
    return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
  }
}

module.exports = { JsonRegistryProvider };
