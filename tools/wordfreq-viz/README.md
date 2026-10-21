# 真题词频交互可视化

考研英语真题词频的单文件交互页：搜词、浏览 Top N、Zipf 曲线与分布图、条件筛选、词条详情。无构建步骤、无外部依赖，双击即可打开。

## 打开方式

```bash
# 方式一：直接双击
open index.html          # macOS
# 或在文件管理器中双击 index.html

# 方式二：本地静态服务（可选）
python3 -m http.server 8765
# 浏览器访问 http://127.0.0.1:8765/
```

## 文件

| 文件 | 说明 |
|:--|:--|
| `index.html` | 唯一交付物。HTML + CSS + JS + 内嵌词频数据 |
| `README.md` | 本说明 |

## 内嵌数据

- **词种**：13,228（全量）
- **字段**：排名、单词、词频（全卷）、词频（正文）、出现试卷数、覆盖年份数、覆盖卷别、词性、词形原形、专有名词、每万词频次
- **附加**：释义 / 音标 / 考研大纲标记（`ky`），共 11,535 词有释义
- **口径**：46 套真题、29 个年份；覆盖卷别 ∈ {旧题型(1998-2009), 英语一, 英语二}

数据以 JSON 内嵌在 `index.html` 的 `WORDFREQ_DATA` 常量中，离线可用。

## 功能

1. **搜索**：全库搜索单词（精确 > 词形还原 > 前缀 > 包含），并打开详情卡片（排名、次数、覆盖卷/年份分布）
2. **浏览**：Top 100 / 500 / 1000 / 5000 / 全部；按频次、字母、覆盖卷数排序
3. **图表**（Canvas，随主题重绘）
   - 词频 Zipf 曲线（log10–log10，含斜率 −1 参考线）
   - 高频词柱状图 Top 30
   - 词长分布、首字母分布
4. **筛选**：次数 ≥ N、仅考研大纲词、排除专有名词
5. **详情卡片**：释义、音标、全卷/正文词频、每万词频次、出现试卷数、覆盖年份数、词形原形、卷别标记
6. **主题**：深浅色跟随系统（`prefers-color-scheme`）；手机可用

## 统计函数（可独立测试）

页面脚本暴露 `window.WordfreqStats`，均为纯函数：

| 函数 | 作用 |
|:--|:--|
| `zipfSeries(rows)` | 按频次排序，返回 `{rank, freq, logRank, logFreq}` |
| `letterDistribution(rows)` | a–z 首字母计数 |
| `lengthDistribution(rows, maxLen)` | 词长分布（含溢出计数） |
| `topByFreq(rows, n)` | 频次 Top N |
| `filterRows(rows, opts)` | `minCount` / `kyOnly` / `hideProp` |
| `searchRows(rows, query, limit)` | 分级搜索 |
| `byAlpha(a, b)` | 字母序比较 |

行对象字段：`w, rank, f, fc, p, y, t, pos, lem, prop, per, ky, m, ph`。

Node 快速自检示例：

```bash
node -e "
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const s=html.indexOf('function zipfSeries');
const e=html.indexOf('window.WordfreqStats');
const stats=eval(html.slice(s,e)+';({zipfSeries,topByFreq,filterRows})');
const rows=[{w:'a',f:10},{w:'b',f:3}];
console.log(stats.topByFreq(rows,1)[0].w); // a
"
```

## 数据来源

- 词频主数据：46 套考研英语真题原卷正文统计（1998–2026，全卷与正文两种口径）。
- 释义、音标与大纲标记：配套词库整理。

若词频数据更新，重新导出 JSON 后替换 `index.html` 中 `WORDFREQ_DATA` 即可，页面逻辑无需改动。
