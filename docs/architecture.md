# 架构说明（维护者向）

## 产品形态

纯静态多文件页面，可直接双击 `index.html`，也可用本地静态服务或部署后作为 PWA 安装。无 npm、无构建步骤；词库以 JS 数组随页面加载。

## 文件结构

```
index.html                    四视图：背诵 / 词表 / 统计 / 设置
css/app.css                   设计令牌、组件、响应式、深浅主题、打印
js/words-data.js              考研词库  window.WORDS_RAW
js/cet-words-data.js          四级/六级词库 window.WORDS_CET4 / WORDS_CET6
js/combined-words-data.js     综合词库 window.WORDS_COMBINED
js/app.js                     状态机、SRS、存储、渲染、快捷键、导入导出
js/txt-zip.js                 TXT 分片 ZIP（无依赖）
assets/icons/                 PWA 图标
manifest.webmanifest / sw.js  PWA 清单与离线缓存
docs/                         用户指南、速查表、本文件
tests/fixtures/               测试夹具
js/test-*.mjs                 应用回归测试
js/validate-*.mjs             词库静态校验
scripts/verify.mjs            一键验收
scripts/build-combined.mjs    由三书重建综合词书
scripts/wordbook-*.json       数据清理 / 修复证据
```

加载顺序固定：`words-data.js` → `cet-words-data.js` → `combined-words-data.js` → `txt-zip.js` → `app.js`。各词库脚本用 `Object.assign` 合并 `WORD_BOOK_META`，不得覆盖先加载的书。

## 状态与存储

- 四本书的进度/熟练/收藏/统计/设置独立：
  - 考研 `kaoyan_vocab_v1` / `kaoyan_vocab_proficient_v1`
  - 四级 `cet4_vocab_v1` / `cet4_vocab_proficient_v1`
  - 六级 `cet6_vocab_v1` / `cet6_vocab_proficient_v1`
  - 综合 `combined_vocab_v1` / `combined_vocab_proficient_v1`
- 当前词书 `vocab_active_book_v1`；乱序抽样 `*_survey_v1`（按单词文本，抗数据版本迁移）。
- **硬约束**：每本书的数组顺序是进度主键。新增词只能追加到末尾；删除中间词条必须 bump `WORD_BOOK_META[id].dataVersion`，并在 `migrations` 记录 `removed/removedWords/previousWordCount`（有新增时同时记录 `added/addedWords`）。不得省略迁移链。
- 备份 v3 包含全部可用词书；导出只读（当前书熟练名单 = 最新独立存储 + 待写入增删）。导入先整份校验并展示备份时间/记录量/替换范围；空备份、未知词书、高于当前 `dataVersion`、异常记录一律拒绝且不改当前记录；写入失败整份回滚，恢复日志键 `vocab_import_journal_v1`。主记录损坏时常规导出停止，救援导出保留原文且不可直接导入。
- 特训可为未学词留下 `[0,0,0,错次,0]` 占位；`p[4] > 0` 才是主学习过。新词额度、队列、统计、筛选统一用 `hasMainProgress`。本组进度分母固定为初始词数，重考只显示「待巩固」。
- 跨天/从后台恢复统一走 `refreshForResume()`：只刷新额度、到期与统计，保留当前卡、判定、特训与撤销历史；下一组才补新词。

## 学习状态机

```
recall --(会|不会)--> revealed --(next)--> 下一卡
              ↑            │
              └──(改判/撤销)─┘
```

- 「会」升艾宾浩斯档；「不会」归零并在本组队尾重考（最多 2 轮）。
- 熟练词移出背诵与复习队列，但词表可取消；撤销、导入旧备份、换顺序都不得复活它们。
- 乱序模式记录首次作答的新词，展示「历史首次自评」比例与 Wilson 95% 区间；样本范围随历史筛选变化，不代表当前范围或全书掌握率；复习/特训/其它顺序不计入。
- 词表使用 roving tabindex：列表内只有一个 Tab 停靠点，方向键换行、Home/End 定位，Tab 经本行熟练操作后离开，并向 `#listAnnouncement` 播报位置/总数。例句整句一个键盘入口，浮层打开后接管焦点，Esc 回到触发词。
- 单字符快捷键可关闭（`settings.singleCharKeys`）；保存/导入/导出错误进入全局 `#appAlert` 持续提示。PWA 采用版本化整组缓存：安装完整预缓存后等待，不在 `fetch` 中逐文件覆盖。

## 测试与验收

```bash
node --max-old-space-size=512 scripts/verify.mjs   # 汇总
node js/test-app.mjs                               # 门控与核心逻辑
node js/validate-words.mjs                         # 考研词库体检
node js/validate-cet-data.mjs                      # 四级/六级词库体检
```

- 测试不启动浏览器，用 Node DOM 桩 / vm 执行真实 `app.js`。
- 校验报告写入 `tests/reports/`（已 gitignore）。
- 四六级校验的词频交叉核对依赖 `tests/fixtures/cet-wordfreq.json`；该文件未随仓库分发时会跳过交叉核对并给出 warning，其余结构/释义/例句/迁移检查照常执行。

## 仓库策略

- 仓库只保留网页、词库、文档与轻量测试；真题 PDF/语料、生成流水线、独立小工具和一次性交付表不随仓库分发。
- 修改 `js/`、`css/` 或 `index.html` 后，必须同步 bump `sw.js` 的 `CACHE` 与资源 `?v=`。
- 提交粒度：一特性一提交，信息用中文祈使句 + 动机。
