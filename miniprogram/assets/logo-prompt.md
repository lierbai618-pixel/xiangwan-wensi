# 向晚问思 Logo 生图提示词

## 用途
生成「向晚问思」小程序的图标（头像）高清位图。当前矢量稿 `logo-xiangwan.svg` 已就绪，
本提示词用于生成更精致的 PNG（适用于微信头像上传、官网 favicon、启动页）。

设计语义：
- **向晚** = 黄昏落日，半沉远山（呼应李商隐《乐游原》"向晚意不适"）
- **问思** = 落日中一道开口圆环（未完成的思索 / 一个还没想透的问）
- 配色：米色底 `#efe4cf`、落日暖橙 `#e89a5c` → 深绯 `#9b2f25`、开口环浅米 `#fbeede`

---

## 中文提示词（适配即梦 / 通义万相 / 豆包 / 醒图）
```
极简风格的小程序 logo 图标，正方形 1:1 构图。背景是温暖的米色（#efe4cf）。
画面中央是一轮夕阳，颜色从暖橙（#e89a5c）平滑渐变到深绯红（#9b2f25），
夕阳下半部分半沉入两道平缓层叠的远山剪影之中。
夕阳正中央有一个浅米色（#fbeede）的开口圆环，像一个不完整的思考圈。
整体安静、内省、有书卷气，大量留白，扁平矢量风格，柔和的暖色光晕，
高级哑光质感，轻微柔和阴影。无文字、无字母、无符号、无 watermark。
```

## 英文提示词（适配 Midjourney / DALL·E / ImageGen）
```
Minimalist square app logo icon, 1:1 composition, warm parchment background (#efe4cf).
Centered a setting sun gradient from warm amber (#e89a5c) to deep crimson (#9b2f25),
half sunk behind two calm layered hill silhouettes.
Inside the sun a thin broken ring (open circle, like an unfinished thought) in light cream (#fbeede).
Quiet, introspective, literary mood, lots of negative space, flat vector style,
soft warm glow, premium matte finish, subtle soft shadow.
No text, no letters, no symbols, no watermark.
```

## 负向提示（Negative Prompt）
```
no text, no letters, no words, no numbers, no watermark, no signature,
no realistic photo, no 3d render, no claymation, no clutter, no characters, no face,
no gradient mesh noise, no extra decorations
```

## 参数建议
- 比例：`--ar 1:1`（Midjourney）/ `size 1024x1024` 或 `1536x1536`（更清晰）
- 风格：flat / minimalist / vector（不要用 realistic / 3d）
- 微信头像最终需裁成 **144×144 圆角**，生图后请保留中心落日区域不被裁掉
- 扁平色块在 144px 小尺寸下最清晰；避免细腻纹理（小图会糊）

---

## 备选：意境插画版（用于启动页 / 官网 banner，非头像）
```
A serene dusk landscape illustration: a large low sun in amber-to-crimson gradient
sinking behind soft layered hills, warm parchment sky with gentle cloud streaks,
a faint broken ring of light hovering near the sun suggesting a thoughtful question.
Quiet literary atmosphere, muted warm palette, minimalist flat art,
plenty of negative space, no text, no watermark.
```

## 注意事项
1. 微信头像强制 144×144 且圆角裁切，生图请保证主体（落日）居中。
2. 若用于头像，强烈建议用上面的「扁平版」，纹理版仅适合大图场景。
3. 生图后需转 PNG；当前腾讯云图像任务达 150 上限时 ImageGen 不可用，
   配额恢复后可由 Senior Developer 直接调用 ImageGen 直出。
4. Logo 不加文字（144px 加字必糊），小程序名称走公众平台「小程序名称」字段。
