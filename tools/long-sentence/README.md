# 考研长难句拆解练习

从考研英语真题原卷中精选 **28** 句长难句（约 22–50 词），逐句手写标注：

- **主干**（主谓宾 / 强调句核心）
- **从句**（定语、宾语、状语、表语等）
- **修饰成分**（插入语、同位语、非谓语、介词短语等）
- **中文译文**
- **难点提示**（that 指什么从句、倒装、省略、插入隔断主干等）
- **出处**（英语一 / 英语二 / 旧题型 · 年份 · Text）

语料取自公开考研英语真题原卷正文，未使用解析 PDF。

## 如何打开

无需构建、无外部依赖，数据内嵌，支持 `file://` 直接打开：

```bash
# 方式一：双击
open tools/long-sentence/index.html

# 方式二：任意静态服务
python3 -m http.server 8000
# 浏览器访问 http://127.0.0.1:8000/tools/long-sentence/
```

## 文件

| 文件 | 说明 |
|:--|:--|
| `index.html` | 页面 + 内联 CSS/JS |
| `data.js` | 28 句标注数据（`window.LONG_SENTENCE_DATA`） |
| `README.md` | 本说明 |

## 模式

1. **练习模式**  
   只看英文 → 点击单词划出主干 → 「揭晓结构」对照分层高亮、译文与难点提示，并给出主干匹配度（F1）。
2. **学习模式**  
   直接分层高亮（主干 / 从句 / 修饰），同步展示结构表、译文、难点提示。
3. **我的收藏**  
   只浏览手动收藏的难句。

## 其它

- **乱序 / 重排**：打乱句序；「重排」换 seed 再洗牌。
- **进度**：写入 `localStorage["long_sentence_v1"]`（当前句索引、已掌握、收藏、匹配分、乱序状态）。
- **快捷键**：`空格` 揭晓 · `N` 下一句 · `P` 上一句 · `F` 收藏。
- **手机**：响应式布局，可点选单词。
- **标注约定**：`data.js` 中 `segments` 按序拼接必须等于 `text`；`r` 取值 `sk`（主干）/ `cl`（从句）/ `mod`（修饰）。

## 数据结构（`data.js`）

```js
window.LONG_SENTENCE_DATA = [{
  id: "en1-2010-circuit",
  source: "英语一 · 2010 · Text 2",
  text: "The Federal Circuit issued ...",
  segments: [{ r: "sk", text: "The Federal Circuit issued an unusual order" }, ...],
  structure: [{ k: "主干", t: "..." }, ...],
  translation: "……",
  tips: ["……"]
}]
```
