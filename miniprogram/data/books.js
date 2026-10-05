// 向晚问思 · 经典阅读清单（10 本已入库公版经典）
// 字段：id / title / author / perspective(学派) / intro(简介) / sample(示例摘录)
// 与 knowledge/index.json 的 ready 书目保持一致；新增书目时两处同步。
const books = [
  {
    id: "lunyu",
    title: "论语",
    author: "孔子及其弟子",
    perspective: "儒家",
    intro: "记录孔子与其弟子言行的语录体经典。谈学习、修身、处世与为政，语言平实却常能照见日常处境。",
    sample: "学而时习之，不亦说乎？",
  },
  {
    id: "mengzi",
    title: "孟子",
    author: "孟轲",
    perspective: "儒家",
    intro: "以雄辩阐述性善、养气与逆境成长。关于「人如何在困顿中长出力量」，至今仍有启发。",
    sample: "天将降大任于是人也，必先苦其心志……",
  },
  {
    id: "daxue",
    title: "大学",
    author: "曾子",
    perspective: "儒家",
    intro: "三纲八目的修身次第：从格物致知到修身齐家。提醒我们，改变外界之前先回到自身可改之处。",
    sample: "自天子以至于庶人，壹是皆以修身为本。",
  },
  {
    id: "zhongyong",
    title: "中庸",
    author: "子思",
    perspective: "儒家",
    intro: "讲「中」与「和」：情绪未起时守中，起了要有分寸地表达。谈平衡与分寸，而非平庸。",
    sample: "喜怒哀乐之未发，谓之中；发而皆中节，谓之和。",
  },
  {
    id: "daodejing",
    title: "道德经",
    author: "老子",
    perspective: "道家",
    intro: "以「道」与「无为」看世界。讲不争、自知与柔韧，常提供一种退一步、换参照系的清醒。",
    sample: "知人者智，自知者明。",
  },
  {
    id: "zhuangzi",
    title: "庄子",
    author: "庄周",
    perspective: "道家",
    intro: "想象奇崛、自在洒脱。用寓言松动人被眼前尺度困住的执念，教你换更大的参照系看自己。",
    sample: "吾生也有涯，而知也无涯。",
  },
  {
    id: "meditations",
    title: "沉思录",
    author: "马可·奥勒留",
    perspective: "斯多葛",
    intro: "罗马皇帝写给自己的人生笔记。核心是：把注意力放回自己能掌控的判断与态度，外界纷扰便少些 foothold。",
    sample: "困扰人的不是事物，而是人对事物的看法。",
  },
  {
    id: "enchiridion",
    title: "爱比克泰德《手册》",
    author: "爱比克泰德",
    perspective: "斯多葛",
    intro: "斯多葛学派的实操手册。起点很朴素：分清「我能做主的」和「我不能做主的」，先把力气用对地方。",
    sample: "有些事在我们能力范围之内，有些事不在。",
  },
  {
    id: "apology",
    title: "柏拉图《申辩篇》",
    author: "柏拉图",
    perspective: "柏拉图 / 苏格拉底",
    intro: "记录苏格拉底在法庭上的自辩。关于自省、诚实面对无知，以及「未经省察的人生不值得过」。",
    sample: "未经省察的人生不值得过。",
  },
  {
    id: "nicomachean_ethics",
    title: "尼各马可伦理学（节选）",
    author: "亚里士多德",
    perspective: "亚里士多德",
    intro: "探讨德性与幸福：我们成为什么样的人，取决于每天重复的小选择；卓越是一种稳定的习惯。",
    sample: "我们是什么，乃是由我们反复的行为所造就的。",
  },
];

module.exports = { books };
