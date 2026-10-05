// 向晚问思 · 人格测试
//
// 2026-09-21 CR（第六轮，修正第五轮方案）：自建测试（思辨人格 / MBTI / 九型 / 大五）已下架，
//   改为聚合外部成熟测试站点。
//
// 2026-09-22 改版：链接**直接显示在页面上**，用户长按选中后自行复制粘贴。
//
// ── 为什么不再用 wx.setClipboardData（本次改动的原因） ──────────────
//   wx.setClipboardData 属微信**隐私接口**。提审时会出现告警：
//   「代码中检测到隐私接口调用（Clipboard）…相关隐私接口权限将被回收」；
//   要在后台「用户隐私保护指引」额外声明剪切板才能保住该权限。
//   改为「页面展示网址 + <text user-select="true"> 长按选中复制」后：
//     ① 不再调用任何隐私接口 → 提审告警项消失，后台无需声明剪切板；
//     ② 网址对用户可见，可自行复制或手抄，不依赖系统剪贴板权限；
//     ③ privacy 页原第五条（剪贴板写入披露）同步删除，避免声明与实际不一致。
//
// ── 为什么不是二维码长按识别（第五轮方案，已废弃） ──────────────────
//   微信官方口径：长按识别的二维码只支持微信体系内的码（小程序码 / 个人码 /
//   企业微信码 / 群码 / 公众号码），**第三方生成的普通 URL 二维码不支持长按识别**。
//   这是码类型的硬限制，换 <image> 或 previewImage 都一样。真机已验证。
//
// ── 为什么不用 web-view ──────────────────────────────────────────
//   web-view 需配置「业务域名」，且要求域名归属验证 → 第三方站点无法通过。

const linkGroups = [
  {
    group: "荣格八维",
    desc: "认知功能偏好",
    items: [
      { name: "荣格八维测试（荣格斯）", note: "第二代认知功能测试", url: "https://www.jungus.cn/zh-hans/test/" },
      { name: "荣格八维测试（Totypes）", note: "", url: "http://www.totypes.com" },
      { name: "荣格八维测试（SoulStation）", note: "打开较慢（约 10 秒）", url: "https://soulstation.club/8function" },
    ],
  },
  {
    group: "MBTI",
    desc: "十六型人格",
    items: [
      { name: "MBTI 十六型人格", note: "16Personalities 官方中文版", url: "https://www.16personalities.com/ch" },
    ],
  },
  {
    group: "九型人格",
    desc: "核心动机与恐惧",
    items: [
      { name: "九型人格测试（人格九道）", note: "", url: "https://enneatao.com/test" },
      { name: "九型人格测试（144 题）", note: "题量较大", url: "https://types.yuzeli.com/survey/nine144" },
      { name: "九型人格测试（简明版）", note: "", url: "http://www.enneagram.cc/jxcs.php" },
    ],
  },
  {
    group: "卡特尔 16PF",
    desc: "十六项人格因素",
    items: [
      { name: "卡特尔 16PF 人格测试", note: "认知功能倾向", url: "http://types.yuzeli.com/survey/cognitive/" },
    ],
  },
  {
    group: "心理年龄",
    desc: "趣味自测",
    items: [
      { name: "心理年龄测试（Arealme）", note: "", url: "https://www.arealme.com/mental-age-test/cn/" },
      { name: "心理年龄测试（记录页）", note: "", url: "https://types.yuzeli.com/record/02e3cf736ec23e" },
    ],
  },
];

Page({
  data: { linkGroups },

  onShareAppMessage() {
    return {
      title: "向晚问思 · 人格测试",
      path: "/pages/quiz/quiz",
    };
  },
});
