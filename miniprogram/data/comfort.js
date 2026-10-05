// 公版经典抚慰知识包（情绪出口模式用）
// 仅收录过版权期的公版内容：先秦诸子、斯多葛派、尼采、叔本华、威廉·詹姆斯等。
// 注意：加缪(1960)、荣格(1961) 仍受版权保护，未收录。
// 用途：倾诉模式识别情绪后，末尾附「先贤说」卡片；仅作陪伴疏解，非心理/医疗建议。

const COMFORT_PACK = {
  // 受了委屈 / 被不公对待
  委屈: [
    {
      quote: "举世而誉之而不加劝，举世而非之而不加沮。",
      author: "庄子",
      source: "《逍遥游》",
      interpretation: "别人的褒贬定义不了你。外界的评价再响，也盖不住你本来的分量。",
    },
    {
      quote: "莫听穿林打叶声，何妨吟啸且徐行。",
      author: "苏轼",
      source: "《定风波》",
      interpretation: "外界的风雨再急，也挡不住你从容的脚步。先稳住自己，再看清方向。",
    },
    {
      quote: "凡杀不死我的，必使我更强大。",
      author: "尼采",
      source: "《偶像的黄昏》",
      interpretation: "被冤枉、被碾压过的伤口，愈合之后会变成你的筋骨。",
    },
    {
      quote: "命运加诸我们的，往往也是淬炼我们的。",
      author: "塞涅卡",
      source: "《书信集》",
      interpretation: "不公像一块磨刀石。它磨你，却也让你比从前更利。",
    },
  ],

  // 愤怒 / 憋屈想发作
  愤怒: [
    {
      quote: "愤怒是短暂的疯狂。",
      author: "塞涅卡",
      source: "《论愤怒》",
      interpretation: "人在盛怒时，判断会暂时失灵。先给自己一口气的停顿，再决定怎么说。",
    },
    {
      quote: "你之所以觉得受冒犯，是因为你先认定那是对你的冒犯。",
      author: "马可·奥勒留",
      source: "《沉思录》",
      interpretation: "情绪的开关，常常握在自己手里。拉开一点距离，火气会小一圈。",
    },
    {
      quote: "大怒邪？其谁能定之。",
      author: "庄子",
      source: "《齐物论》",
      interpretation: "气头上很难有定见。先让心静下来，答案才会浮出来。",
    },
  ],

  // 孤独 / 没人懂
  孤独: [
    {
      quote: "人要么孤独，要么庸俗。",
      author: "叔本华",
      source: "《附录与补遗》",
      interpretation: "独处不必是惩罚。它也能是清醒生长的养分。",
    },
    {
      quote: "退入你自身的内在居所。",
      author: "马可·奥勒留",
      source: "《沉思录》",
      interpretation: "最安静的陪伴，往往来自和自己做朋友。",
    },
    {
      quote: "拣尽寒枝不肯栖，寂寞沙洲冷。",
      author: "苏轼",
      source: "《卜算子》",
      interpretation: "宁可孤独也不委屈自己——这本身，就是一种尊严。",
    },
  ],

  // 无力 / 使不上劲
  无力: [
    {
      quote: "行动与感觉并行，且能互相牵引。",
      author: "威廉·詹姆斯",
      source: "《心理学原理》",
      interpretation: "哪怕心里没劲，先动一个最小的步子，状态会跟着松动一点。",
    },
    {
      quote: "破山中贼易，破心中贼难。",
      author: "王阳明",
      source: "《与杨仕德薛尚谦书》",
      interpretation: "最难的是和自己和解。但每一次你没放弃，都算数。",
    },
    {
      quote: "财富如海水，越饮越渴；内心的安宁无法外求。",
      author: "叔本华",
      source: "《作为意志和表象的世界》",
      interpretation: "把掌控感放回自己能做的事上，比盯着够不到的更有用。",
    },
  ],

  // 焦虑 / 慌
  焦虑: [
    {
      quote: "我们操心的大多，是尚未发生、也未必发生的事。",
      author: "马可·奥勒留",
      source: "《沉思录》",
      interpretation: "把念头拉回此刻，能省下大半没必要的慌张。",
    },
    {
      quote: "鹪鹩巢于深林，不过一枝；偃鼠饮河，不过满腹。",
      author: "庄子",
      source: "《逍遥游》",
      interpretation: "人真正需要的，其实很少。先把今天的一件小事做完。",
    },
    {
      quote: "把每一天都当作最后一天，你便不会慌张。",
      author: "塞涅卡",
      source: "《书信集》",
      interpretation: "不是要你悲观，而是提醒你：聚焦今天，就够用了。",
    },
  ],

  // 悲伤 / 失落
  悲伤: [
    {
      quote: "人有悲欢离合，月有阴晴圆缺，此事古难全。",
      author: "苏轼",
      source: "《水调歌头》",
      interpretation: "聚散起落是人间常态，不必独独责怪自己。",
    },
    {
      quote: "每一个不曾起舞的日子，都是对生命的辜负。",
      author: "尼采",
      source: "《查拉图斯特拉如是说》",
      interpretation: "允许自己低落，也为微光留一扇窗。你不需要立刻好起来。",
    },
    {
      quote: "哀莫过于心死，而人死亦次之。",
      author: "庄子",
      source: "《田子方》",
      interpretation: "心若凉了最伤身。先照顾这颗心，别的慢慢来。",
    },
  ],
};

// 情绪关键词 → 分类（供倾诉模式做简单情绪识别）
const EMOTION_KEYWORDS = {
  委屈: ["委屈", "冤枉", "不公平", "被针对", "被误解", "受气", "背锅"],
  愤怒: ["愤怒", "生气", "火大", "气死", "恼火", "憋屈想发", "恨"],
  孤独: ["孤独", "没人懂", "一个人", "孤单", "没人陪", "寂寞", "被孤立"],
  无力: ["无力", "没劲", "使不上劲", "撑不住", "累", "迷茫", "没方向", "想放弃"],
  焦虑: ["焦虑", "慌", "担心", "害怕", "紧张", "睡不着", "压力大", "不安"],
  悲伤: ["悲伤", "难过", "伤心", "失落", "哭", "想哭", "空虚", "绝望"],
};

function detectEmotion(text) {
  if (!text) return null;
  let best = null;
  let bestScore = 0;
  for (const cat of Object.keys(EMOTION_KEYWORDS)) {
    let score = 0;
    for (const kw of EMOTION_KEYWORDS[cat]) {
      if (text.indexOf(kw) !== -1) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }
  return bestScore > 0 ? best : null;
}

function pickComfort(emotion) {
  const list = COMFORT_PACK[emotion];
  if (!list || !list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

// ---------------- 危机护栏（写死，不依赖模型临场发挥） ----------------
const CRISIS_KEYWORDS = [
  "不想活", "活不下去", "不想活了", "活不下去了", "自杀", "轻生", "结束生命",
  "一了百了", "寻死", "自尽", "不如死", "去死", "了断", "解脱", "活着没意思",
  "活着没意义", "没脸活", "恨不得死",
];

function detectCrisis(text) {
  if (!text) return false;
  for (let i = 0; i < CRISIS_KEYWORDS.length; i++) {
    if (text.indexOf(CRISIS_KEYWORDS[i]) !== -1) return true;
  }
  return false;
}

const CRISIS_CARD = {
  title: "你很重要，先别独自扛",
  lines: [
    "我听到你了，也在乎你。此刻的痛苦是真实的，但它不会是永远。",
    "请别一个人撑着——专业的帮助能陪你走过这段最难的路。",
  ],
  hotlines: [
    { name: "北京心理危机干预中心", tel: "010-82951332" },
    { name: "全国希望 24 热线", tel: "400-161-9995" },
  ],
  note: "如果你已经身处危险，请立刻联系身边可信的人，或拨打 120 / 110。",
};

const COMFORT_DISCLAIMER =
  "本卡片为 AI 陪伴与经典阅读疏解，非专业心理诊疗。如情绪持续困扰，请拨打心理援助热线：北京心理危机干预中心 010-82951332，全国希望 24 热线 400-161-9995。";

module.exports = {
  COMFORT_PACK,
  EMOTION_KEYWORDS,
  detectEmotion,
  pickComfort,
  CRISIS_KEYWORDS,
  detectCrisis,
  CRISIS_CARD,
  COMFORT_DISCLAIMER,
};
