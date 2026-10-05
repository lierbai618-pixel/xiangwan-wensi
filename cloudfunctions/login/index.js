// 向晚问思 - 轻登录云函数
// 仅返回当前调用者的 OPENID（取自云上下文，客户端无法伪造）。
// 不做日志、不做内容检测，纯粹用于前端获取匿名用户标识。
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  const ctx = cloud.getWXContext();
  const openid = (ctx && ctx.OPENID) || "";
  return { openid };
};
