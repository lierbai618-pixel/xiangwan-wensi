// 向晚问思 · 通用结果分享图
// 使用 canvas 2d 绘制一张竖版卡片，返回临时文件路径，供保存到相册。
// 所有人格测试结果页复用本工具，避免重复实现。

function getDpr() {
  try {
    if (wx.getWindowInfo) return wx.getWindowInfo().pixelRatio || 2;
    return wx.getSystemInfoSync().pixelRatio || 2;
  } catch (e) {
    return 2;
  }
}

// 绘制并返回临时文件路径（失败返回 null）
function drawShareCard(page, selector, opts) {
  return new Promise((resolve) => {
    const query = wx.createSelectorQuery().in(page);
    query.select(selector).fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) {
        resolve(null);
        return;
      }
      const canvas = res[0].node;
      const dpr = getDpr();
      const W = 600;
      const H = 800;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);

      // 背景渐变
      const grad = ctx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, opts.bgFrom || "#3a2f25");
      grad.addColorStop(1, opts.bgTo || "#6b5544");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // 顶部柔光
      const glow = ctx.createRadialGradient(W / 2, 120, 20, W / 2, 120, 360);
      glow.addColorStop(0, "rgba(255,255,255,0.18)");
      glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      // 顶部小标签
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.font = "26px sans-serif";
      ctx.fillText(opts.kicker || "向晚问思 · 人格测试", W / 2, 78);

      // 主标题（结果名/代码）
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 76px sans-serif";
      ctx.fillText(opts.title || "", W / 2, 210);

      // 副标题
      if (opts.subtitle) {
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = "30px sans-serif";
        ctx.fillText(opts.subtitle, W / 2, 268);
      }

      // 分隔线
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(120, 312);
      ctx.lineTo(480, 312);
      ctx.stroke();

      // 要点列表
      const lines = opts.lines || [];
      let y = 372;
      const lineH = 52;
      ctx.textAlign = "left";
      lines.slice(0, 6).forEach((ln) => {
        // 圆点
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.beginPath();
        ctx.arc(118, y - 10, 6, 0, Math.PI * 2);
        ctx.fill();
        // 文本（自动截断避免溢出）
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.font = "28px sans-serif";
        const maxW = 420;
        let text = ln;
        if (ctx.measureText(text).width > maxW) {
          while (text.length > 4 && ctx.measureText(text + "…").width > maxW) {
            text = text.slice(0, -1);
          }
          text = text + "…";
        }
        ctx.fillText(text, 140, y);
        y += lineH;
      });

      // 底部卡片
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(0, H - 120, W, 120);
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "26px sans-serif";
      ctx.fillText(opts.footer || "向晚问思 · 测测你是谁", W / 2, H - 70);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "22px sans-serif";
      ctx.fillText("长按识别 / 截图分享给朋友", W / 2, H - 36);

      wx.canvasToTempFilePath({
        canvas,
        x: 0,
        y: 0,
        width: canvas.width,
        height: canvas.height,
        destWidth: canvas.width,
        destHeight: canvas.height,
        success: (r) => resolve(r.tempFilePath),
        fail: () => resolve(null),
      });
    });
  });
}

// 绘制并预览分享图（避免调用相册写入隐私接口，长按图片即可保存）
function saveShareImage(page, selector, opts) {
  return drawShareCard(page, selector, opts).then((path) => {
    if (!path) {
      wx.showToast({ title: "生成失败，请重试", icon: "none" });
      return;
    }
    wx.previewImage({
      current: path,
      urls: [path],
      success: () => wx.showToast({ title: "长按图片可保存", icon: "none" }),
      fail: () => wx.showToast({ title: "预览失败", icon: "none" }),
    });
  });
}

module.exports = { drawShareCard, saveShareImage };
