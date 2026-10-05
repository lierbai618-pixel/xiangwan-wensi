// 向晚问思 · 经典阅读
const { books } = require("../../data/books.js");

Page({
  data: {
    books,
    activeId: "",
  },

  toggleDetail(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ activeId: this.data.activeId === id ? "" : id });
  },

  onShareAppMessage() {
    return {
      title: "向晚问思 · 经典阅读：10 本公版哲学经典",
      path: "/pages/books/books",
      imageUrl: "/assets/share-card.png",
    };
  },
});
