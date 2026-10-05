#!/usr/bin/env node
'use strict';

/**
 * 生成「人格测试」外链的二维码 PNG（离线，零运行时依赖）
 *
 * ══════════════════════════════════════════════════════════════
 * ⚠️ 方案已废弃（2026-09-21）—— 本脚本当前**不参与产品流程**
 * ══════════════════════════════════════════════════════════════
 * 原用途：小程序无法打开外部浏览器，改用「二维码长按识别」
 *         （长按二维码 → 识别图中二维码 → 打开网页）。
 *
 * 废弃原因（真机已验证 + 微信官方口径）：
 *   「目前支持的长按识别的二维码**都是微信体系下的**
 *    （小程序码 / 微信个人码 / 企业微信个人码 / 群码 / 公众号二维码），
 *    **对于第三方生成的二维码不支持长按识别**」。
 *   我们生成的是普通 URL 二维码 → 长按菜单仅有 转发/保存/收藏/翻译，
 *   无「识别图中二维码」入口。这是**码类型硬限制**，与
 *   show-menu-by-longpress 属性、或页面内 image vs previewImage 无关。
 *
 * 现行方案：`pages/quiz` 改用 `wx.setClipboardData`「一键复制链接」。
 *
 * 保留本脚本的理由：二维码生成能力在**分享图 / 小程序码**等场景仍可复用，
 *                  且本文件记录了这条已排除的技术路线，避免后人重走。
 * 如确需彻底清理，可连同 `scripts/qr-manifest.json` 一并删除。
 * ══════════════════════════════════════════════════════════════
 *
 * 运行：
 *   NODE_PATH=<isolated-workspace>/node_modules node scripts/gen-quiz-qr.js
 *
 * 输出：miniprogram/images/qr/<slug>.png  +  scripts/qr-manifest.json
 *
 * ⚠️ 链接清单已排除本日实测不可用的两条：
 *      · https://www.advanced-personality.com/... （DNS 层阻断：阿里公共 DNS 返回 0.0.0.0）
 *      · http://t.cn/A602fYsD                     （短链已失效，无 Location 跳转）
 */

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const OUT_DIR = path.join(__dirname, '..', 'miniprogram', 'images', 'qr');

// 分组 + slug 即输出文件名
const GROUPS = [
  {
    group: '荣格八维',
    items: [
      { slug: 'jungus-8function', name: '荣格八维测试（荣格斯）', note: '第二代认知功能测试', url: 'https://www.jungus.cn/zh-hans/test/' },
      { slug: 'totypes-8function', name: '荣格八维测试（Totypes）', note: '', url: 'http://www.totypes.com' },
      { slug: 'soulstation-8function', name: '荣格八维测试（SoulStation）', note: '加载较慢（约 10s）', url: 'https://soulstation.club/8function' },
    ],
  },
  {
    group: 'MBTI',
    items: [
      { slug: '16personalities', name: 'MBTI 十六型人格', note: '16Personalities 官方中文版', url: 'https://www.16personalities.com/ch' },
    ],
  },
  {
    group: '九型人格',
    items: [
      { slug: 'enneatao', name: '九型人格测试（人格九道）', note: '', url: 'https://enneatao.com/test' },
      { slug: 'yuzeli-nine144', name: '九型人格测试（144 题）', note: '', url: 'https://types.yuzeli.com/survey/nine144' },
      { slug: 'enneagram-cc', name: '九型人格测试（简明版）', note: '', url: 'http://www.enneagram.cc/jxcs.php' },
    ],
  },
  {
    group: '卡特尔 16PF',
    items: [
      { slug: 'yuzeli-16pf', name: '卡特尔 16PF 人格测试', note: '认知功能倾向', url: 'http://types.yuzeli.com/survey/cognitive/' },
    ],
  },
  {
    group: '心理年龄',
    items: [
      { slug: 'arealme-mental-age', name: '心理年龄测试（Arealme）', note: '', url: 'https://www.arealme.com/mental-age-test/cn/' },
      { slug: 'yuzeli-mental-age', name: '心理年龄测试（记录页）', note: '', url: 'https://types.yuzeli.com/record/02e3cf736ec23e' },
    ],
  },
];

const OPTS = {
  type: 'png',
  errorCorrectionLevel: 'M',
  margin: 1,
  width: 320,
  color: { dark: '#2c2c2aff', light: '#ffffffff' },
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifest = [];
  let count = 0;

  for (const g of GROUPS) {
    for (const it of g.items) {
      const out = path.join(OUT_DIR, it.slug + '.png');
      await QRCode.toFile(out, it.url, OPTS);
      const size = fs.statSync(out).size;
      manifest.push({ group: g.group, ...it, file: 'images/qr/' + it.slug + '.png', bytes: size });
      count++;
      console.log(`✓ ${it.slug.padEnd(26)} ${String(size).padStart(6)} B   ${it.url}`);
    }
  }

  // 清单写到 scripts/（**不放 miniprogram/**，避免被打包进小程序）
  const manifestPath = path.join(__dirname, 'qr-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  const total = manifest.reduce((s, m) => s + m.bytes, 0);
  console.log(`\n共生成 ${count} 张二维码，合计 ${(total / 1024).toFixed(1)} KB`);
  console.log(`清单已写入: scripts/qr-manifest.json`);
}

main().catch((e) => {
  console.error('生成失败:', e && e.message ? e.message : e);
  process.exit(1);
});
