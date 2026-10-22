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
js/senses-data.js             语境义试点数据 window.WORD_SENSES（内容层，96 条目/98 义项）
js/app.js                     状态机、SRS、存储、渲染、快捷键、导入导出
js/txt-zip.js                 TXT 分片 ZIP（无依赖）
assets/icons/                 PWA 图标
manifest.webmanifest / sw.js  PWA 清单与离线缓存
docs/                         用户指南、速查表、本文件、性能测量、内容修订记录
tests/fixtures/               测试夹具
js/test-*.mjs                 应用回归测试
js/validate-*.mjs             词库静态校验
scripts/verify.mjs            一键验收
scripts/build-combined.mjs    由三书重建综合词书
scripts/wordbook-*.json       数据清理 / 修复证据
```

加载顺序固定：`words-data.js` → `cet-words-data.js` → `combined-words-data.js` → `senses-data.js` → `txt-zip.js` → `app.js`。各词库脚本用 `Object.assign` 合并 `WORD_BOOK_META`，不得覆盖先加载的书；`senses-data.js` 可直接 `<script>` 加载、无模块语法/无网络请求，并列入 `sw.js` 的 `ASSETS`。

## 状态与存储

- 四本书的进度/熟练/收藏/统计/设置独立：
  - 考研 `kaoyan_vocab_v1` / `kaoyan_vocab_proficient_v1`
  - 四级 `cet4_vocab_v1` / `cet4_vocab_proficient_v1`
  - 六级 `cet6_vocab_v1` / `cet6_vocab_proficient_v1`
  - 综合 `combined_vocab_v1` / `combined_vocab_proficient_v1`
- 当前词书 `vocab_active_book_v1`；乱序抽样 `*_survey_v1`（按单词文本，抗数据版本迁移）。
- **硬约束**：每本书的数组顺序是进度主键。新增词只能追加到末尾；删除中间词条必须 bump `WORD_BOOK_META[id].dataVersion`，并在 `migrations` 记录 `removed/removedWords/previousWordCount`（有新增时同时记录 `added/addedWords`）。不得省略迁移链。
- 备份 v3 包含全部可用词书；导出只读（当前书熟练名单 = 最新独立存储 + 待写入增删）。导入先整份校验并展示备份时间/记录量/替换范围；空备份、未知词书、高于当前 `dataVersion`、异常记录一律拒绝且不改当前记录；写入失败整份回滚，恢复日志键 `vocab_import_journal_v1`。主记录损坏时常规导出停止，救援导出保留原文且不可直接导入。**不进备份 v3 的独立键**：刷新会话快照 `vocab_session_snapshot_*`、自动续背租约/暂停键、引导键、上次导出时间、语境义数据层、`*_survey_v1`；换浏览器/清站点数据后自然丢失，主学习记录仍由备份 v3 保障。
- 特训可为未学词留下 `[0,0,0,错次,0]` 占位；`p[4] > 0` 才是主学习过。新词额度、队列、统计、筛选统一用 `hasMainProgress`。本组进度分母固定为初始词数，重考只显示「待巩固」。
- 跨天/从后台恢复统一走 `refreshForResume()`：只刷新额度、到期与统计，保留当前卡、判定、特训与撤销历史；下一组才补新词。
- 累计时长按「实际经过时间 + 最近有效活动」计量：有效操作/阅读滚动后开始累计，闲置约 1 分钟暂停；隐藏、休眠、跨页恢复不补记整段间隔，多标签取较新记录。沿用 `timeSec` 主记录字段与备份 v3；旧版按页面停留累计的历史值原样保留。
- 词性筛选统一走单一入口 `posMatches(x)`，口径由 `settings.posMode` 控制：`"primary"`（默认，按每词主词性 `p`，行为与旧版一致）或 `"all"`（按释义中出现的全部词性）。队列/可背范围、范围计数、词频直方图、词表与 TXT 导出必须共用该入口，不得各算各的；只影响筛选口径，不改 `p` 字段、`r/f/c` 与已有学习进度，旧记录缺 `posMode` 按 `primary` 解释。
- 复习曲线：每书 `settings.stages`（恰好 10 个**分钟**整数，1–525600 = 1 分钟–365 天，严格递增）、`settings.relearn`（「不会」后跨组重学间隔，分钟，同范围）、`settings.stagePreset`（`balanced`/`light`/`intense`/`legacy`/`custom`，仅展示）。新用户默认 `balanced` + relearn 1440；**旧记录缺字段**按 `legacy`（5/30/720/1440/… 分钟 + relearn 5）解释，不是新用户默认。非法配置（长度≠10、非整数、越界、不递增）整组拒绝并定位到具体档位，不部分生效；单位只做 m/h/d ↔ 分钟换算，落库统一为分钟整数。
- 曲线冻结与不追溯：`startSession()` 生成 `sessionPlan.stagesMs/relearnMs` 快照，本组判定、改判、撤销与组内重考一律用快照；设置改动默认只影响**下一组**。已有 progress 的 `p[1]` 到期时间不重排，不制造新的立即到期词。阶段标签、十档时间轴、完整周期、已掌握判定全部由当前计划动态计算，禁止硬编码「5 分钟」「约 120 天」。
- 设置与当前组生命周期（08）：`sessionPlan` 另冻结 `scopeSig`（只含计划/范围类字段：dailyNew/order/fmin/fmax/pmin/kyOnly/pos/posMode/groupSize/backlogGuard）、`scopeCount`（开组时匹配词数）、`dailyNewTarget`；`buildSessionScopeSet()` 在开组时冻结本组词下标，`nextCard()` 用 `sessionScopeHas()` 判断，**组内改范围不逐张剔卡、进度分母固定**。计划/范围设置统一经 `settingsChangedSurfaces()` 保存并刷新预览，不调用 `startSession()`；`hasPendingScopeSettings()` 判断当前组是否偏离，`applySettingsRestart()` 是唯一显式重建入口；`resetSettingsClass("plan"|"scope"|"appearance")` 按类恢复默认。`settings.dailyReviewCap`、外观/显示/键盘/语音偏好立即生效，不参与「待应用」判断。
- 完成页挂机自动续背（22）：每书 `settings.autoResume = {enabled, threshold, idleMs, countdownMs}`（新用户默认开 5 张/2 分钟/15 秒；旧记录缺字段关闭）。运行时状态机 `idle → waiting（连续 idleMs 无有效交互）→ countdown（候选 ≥ threshold）→ 启动`，有效交互/隐藏/离开完成页/今天暂停/候选不足会回到 idle 或 waiting。启动前 `candidateStatsNow()` 复核：`plannedDue = min(groupSize, 到期数)`，`dueActive` 受今日剩余复习预算约束；剩余槽位按有效新词余额补，积压保护生效则不补；额度暂停时 `available = 0`。到点抢 `localStorage` 租约 `vocab_autoresume_lease_v1 = {ts,tab,book,day}`（TTL 60 秒）→ `captureSessionSnapshot()` → `refreshForResume()` → `startSession("main")`（禁止整页 reload）；不判定、不消费额度、不增加学习时长。`autoResumeReturnSnap` 仅内存保存上一组完成页与撤销栈，新组首个有效判定前可 `returnToPreviousResults()`；「今天暂停」写独立键 `vocab_autoresume_pause_v1 = {bookId:"YYYY-MM-DD"}`（**跨刷新持久、同日保持、跨天失效并在 `refreshForResume` 清理、四书独立、设置改动解除**；不进 state/备份 v3），存储不可用时退化为本页内存态并 toast 提示；租约/暂停键都不进学习记录/备份 v3。
- 首次引导状态（11）：全局独立键 `vocab_guide_v1 = {version:1,dismissedAt}`；不进每书 state/settings、备份 v3、学习进度与配额。显示/隐藏只由 `#guideBanner`（在 `#main` 之外、非模态）与 `#guideSheet` 控制；老用户升级只提示一次，可从帮助浮层与设置页 06 重开。词表结果摘要由 `listSummaryText()` 生成「当前范围/全库 · 状态 · 共 N 词（全库 M 词）」，重置列表筛选只清 q/fst/fsc。
- 阅读字号、语言标记与语音（12）：每书 `settings.fontSize`（standard/large）、`settings.voiceURI`（默认 ""）、`settings.speechRate`（0.5–1.5，默认 0.92）都属于界面偏好并加入 `CARRY_SETTINGS`（切书携带），随备份 v3 的 settings 整份导出/导入。字号只写 `<html data-font-size>` 与 CSS 变量 `--fs-read`/`--fs-example`（16→18.5 / 16→18px），不调用 `startSession`；长词 `fitWord()` 到最小字号（30/34px）后 `.word.word-wrap` 换行。`lang="en"` 只标英文（词头/词表单词/详情标题/`.ex`/例句浮层/`.sense-quote`），中文来源用 `lang="zh-CN"`。发音统一 `speak()`：cancel → voiceURI/en-US/首个英语语音 → speechRate → 错误提示；voices 延迟由 `voiceschanged` 刷新，无英语语音时明确拒绝。
- 离线/更新与备份状态键（13）：Service Worker 注册在 `app.js` 启动时一次（`index.html` 不得有第二处注册）；状态只来自 `register()` 与 installing/waiting/active、updatefound、statechange、controllerchange、ready、controller，**注册成功≠已离线**。上次导出时间用全局独立键 `vocab_last_export_v1 = {at,version}`，只在 `exportBackupFile()` 下载触发后写入（救援导出不写），不进学习记录/备份 v3。
- 语境义数据层（10）：`js/senses-data.js` 暴露 `window.WORD_SENSES = {schemaVersion:1, books:{kaoyan,cet4,cet6,combined}}`（96 条目 / 98 义项 / 98 例句，四书键控）；每义项含 `meaning` 与 `examples[{source,quote,surface,label?}]`，`additional` 字符串；综合书 `apply`（涂抹、敷）/`content`（含量）补充义标注四级真题来源。`wordSenseEntry(x)` 按「当前书 + 单词文本」只读；`meaningHtml()` 有效时渲染 `.sense-block`/`.sense-label`/`.sense-item` + `details.sense-evidence`（原句 `.sense-quote` lang=en、经 `exHtml` 可点词）+ `details.sense-additional`「尚未逐义核验」，紧凑模式 `.sense-popup`；非法/缺失数据完整回退 `x.m` + 中性说明，不冒充核对义项。只读，不改队列/进度/判定/熟练；打印/TXT 用 11 元组；不进备份 v3。
- 刷新会话快照（15，试点）：每书独立键 `vocab_session_snapshot_<book>_v1`，值为单词文本映射的队列/当前卡/qi/分母/answered/待巩固/已揭示态 + 冻结 `plan`（stagesMs/relearnMs/groupSize/startedAt/scopeSig/scopeCount/dailyNewTarget）+ `curBaseline` + `progressSig`（FNV-1a：队列内主进度 + 当日日统计 + 当日复习台账）；只在判定/改判/翻页/撤销/开组/退出特训或子组/`pagehide`/`visibilitychange(hidden)` 等低频点写；不写每书 state、不进 `savedStateSignature`、不进备份 v3。恢复不重复提交判定/额度，撤销栈不持久化。
- 拼写专项记录（16）：每书 `state.spelling = {sessions, attempts, correct, skipped, lastDay, lastSession}`，`lastSession = {day,total,attempts,correct,skipped,mixed,at}`（只存累计与最近一组汇总、不存逐词明细）；`DEF.spelling` 默认、`freshState` 深拷贝、`normalizeSpellingState()` 单字段容错、`exportStateSnapshot` 随备份 v3 导出（备份版本不升、旧备份缺字段空白兼容）、`stateHasRecoverableContent` 让「只有专项记录」的备份可导入；**不进 `savedStateSignature`**，`save()`/`storage` 按「sessions 多者胜、同组数比 attempts」合并（不累加）。
- 单日复习上限：每书 `settings.dailyReviewCap`（0 = 不限，1–1000；新用户默认 100，旧记录缺字段按 0 不限解释）与台账 `state.reviewDay = {d:"YYYY-MM-DD", used}`（按书、按本地日期；跨天或 `refreshForResume()` 时归为 `{今日,0}`）。计入「主流程复习判定次数」：判定前 `hasMainProgress` 为真的到期复习与组内重考；不计新词首次学习、错词特训与改判，撤销回滚对应次数。剩余预算 = `cap === 0 ? Infinity : max(0, cap - used)`；降低上限只把剩余预算置零，不回滚已学，也不重排 `p[1]`。
- 复习暂停态是**派生状态**（`settings.dailyReviewCap` + `state.reviewDay` + 当前到期量实时计算，不持久化；刷新/切书/跨天后重算）：`used >= cap` 且仍有到期时显示背诵页 `#capPause`，保留未答位置、待巩固与改判/撤销，不截断队列、不把未答卡标完成、不批量改到期时间。背诵统计条 `#s-rev` / `#s-revmax` 显示今日复习已用 / 上限（不限显示「不限」），统计页 `#reviewCapLine` 显示今日已用 / 上限、可继续复习与仍待复习；`#capPauseExtra` 承载 23 批临时加量入口。
- 临时加量（23）：每书 `state.extraDay = {d:"YYYY-MM-DD", extra}`（按本地日期；跨天或 `refreshForResume()` 归零，同日刷新、切书返回、同日重开组不丢），`effectiveNewTarget() = settings.dailyNew + extraDay.extra`（总目标 ≤ 500；`settings.dailyNew` 本身不变）。完成页 `#extraNewRow` 与复习暂停页 `#capPauseExtra` 内的加量入口（再学 10 / 20 / 自定义 1–100，默认 10）只写 `extraDay.extra`，不写 progress、不直接加 `n`；随后以 `kind:"extra"` 纯新词子组进入（复用特训 `mainSnap` 模式保留主组现场，退出后回原组；子组产生的进度与日统计不因返回或撤销原组而丢失）。候选不足时如实显示「仅剩 N 词」并按实际数量加量；同一加量动作重复提交只生效一次；不提高复习上限，新词后续重考仍受当日预算约束；撤销首次判定回退已学数但不撤回已授予额度。UI 上 `#s-newmax` 显示有效目标、`#todayGoal` 摘要显示「计划 N + 临时 M」。
- 分组与积压保护（07）：每书 `settings.groupSize`（1–100，默认 30；旧记录缺字段=30）只表示一次 `startSession()` 的主卡数量，**不是**每日上限；`settings.backlogGuard`（默认 true）控制积压保护。`buildQueue()` 拆成完整池 `{duePool, freshPool}`（不切片），`startSession()` 按「到期优先 + 剩余新词额度」取 `groupSize` 条；未取走的 `duePool` 仍保持到期。组尾/完成页显示「本组完成 X/Y · 剩余到期 Z」：`#groupFooter`（role=status，内含 `#groupFooterText` + 隐藏按钮 `#nextGroupBtn`「继续下一组」/`#returnMainGroup`「返回原组」），外层 `#groupStatus` 由 CSS `:has(> :not([hidden]))` 自动显隐，app.js 只切内部 hidden。积压保护条件 = `backlogGuard && cap > 0 && countDue() > reviewCapLeft()`：不自动补新词，显示 `#backlogNotice`（`#backlogNoticeText` 说明超出量）+ `#learnNewAnyway`「仍学今日计划内新词」→ `kind:"newOnly"` 纯新词子组（只消耗 `dailyNew` 剩余额度、不提高复习上限，复用 `mainSnap` 保留主组现场，退出回原组；子组内不出现暂停/加量嵌套入口）。`kind:"extra"` 临时加量是另一条路径，不要求计划完成、不受积压保护影响；重考仍受「最多 2 轮」与当日复习预算约束，熟练词排除，错词特训独立。应用内 `groupInfo` 暴露本组完成 X/Y、剩余到期 Z、是否有下一组。

## 学习状态机

```
recall --(会|不会)--> revealed --(next)--> 下一卡
              ↑            │
              └──(改判/撤销)─┘
```

- 「会」升一档；「不会」归零、按本组冻结的 `relearn` 安排跨组重学，并在本组队尾重考（最多 2 轮，组内即时巩固与跨组间隔是两套机制）。
- 熟练词移出背诵与复习队列，但词表可取消；撤销、导入旧备份、换顺序都不得复活它们。
- 乱序模式记录首次作答的新词，展示「历史首次自评」比例与 Wilson 95% 区间；样本范围随历史筛选变化，不代表当前范围或全书掌握率；复习/特训/其它顺序不计入。
- 词表使用 roving tabindex：列表内只有一个 Tab 停靠点，方向键换行、Home/End 定位，Tab 经本行熟练操作后离开，并向 `#listAnnouncement` 播报位置/总数。**C-07b 防回归**：`focusListRow()` 用 `renderRows(false)` 渲染后按目标词/操作常量聚焦并再写回活动行（旧行 focusin 不得把 `listActiveWord` 改回旧词），方向键/Tab **第一次按键即生效**；改动先跑 `js/test-list-arrow.mjs`。例句整句一个键盘入口，浮层打开后接管焦点，Esc 回到触发词。
- 背诵动作区 `#acts` 每次判定由 `renderCard` 整体重绘；CSS 对「有当前词」的 `#acts` 固定 min-height 并让内容自顶部排，保证揭示答案后「会/不会」原位不被「下一个」接管。熟练反馈条 `#profFeedback`（含 `#btnUnMaster`）与词表特训入口 `#btnDrillList` 都是 `#acts` 之外的静态节点，只由 app.js 切换 hidden/文案；`#btnDrillList` 训练的始终是当前词书整个错词本，与词表搜索/筛选无关。
- 单字符快捷键可关闭（`settings.singleCharKeys`）；保存/导入/导出错误进入全局 `#appAlert` 持续提示。PWA 采用版本化整组缓存：安装完整预缓存后等待，不在 `fetch` 中逐文件覆盖；SW 注册入口只在 `app.js`（index.html 不得重复注册），离线状态只来自真实 SW 事件（见下节）。

## 首屏与统计页结构（09）

```text
背诵页首屏
#statLine（4 chips：今日新词含环形进度 / 今日复习 / 本次进度 / 正确率；乱序时 + 首次自评紧凑 chip，内含 #surveyDetail 可展开说明）
#studyScope 范围摘要（.drill-bar 左侧，常驻）→ jumpToScopeSettings() → 设置 #settings-scope（tabindex=-1 可聚焦）
#btnDrill / #drillHint（无错词时只隐藏这两个，上下文条不动）
#card → #acts（revealed 时词形变化放 .answer-extra details，默认折叠）
```

- 范围摘要复用 08 快照：`parseScopeSig()` → `shortScopeText()` 读 `sessionPlan.scopeSig/scopeCount`；有 pending 时显示「本组 …」并在 title 说明「将在下一组生效」；`#scopeLabel` 与 `#studyScope` 共用 `jumpToScopeSettings()` 入口；统计条 `#surveyDetail`/`#s-survey-n` 只展示，不改自评口径。
- 统计页：`#statsForecastPanel` / `#surveyPanel` / `#statsFreqPanel` / `#statsStagesPanel` / `#statsDaysPanel` / `#statsHeatmapPanel` 为原生 `<details class="panel stats-details">` 默认收起；`markStatsDetailEmpty()` 标 `data-empty` 空态；summary 可键盘展开，展开后才重算移动端滑动提示。总览/今日计划/备份与导出常显；口径标注：掌握类＝当前背诵范围，其他＝当前词书。
- 动效：viewIn/cardIn 0.16s、answerIn 0.15s、sheetIn 0.18s、位移 6px；`prefers-reduced-motion` 全禁用；不延迟可操作时间、不自动翻页。
- 几何契约（不得动）：`#card:has(.word-face) + #acts` 窄屏 151px / 桌面 156px / 矮屏 146px，窄屏 `#v-study > #hint` 40px；A-40 修复只改布局高度与 `:has`，未改这些常量。
- CSS 可维护性与 A-40：**禁止嵌套 `:has`**（Chrome 155 实测 `.a:has(.b:has(.c))` 不支持）；行补偿用扁平 `:has(#groupStatus > :not([hidden]))`；「完成页 + 状态区」用自然高度 + `#main` 滚动、卡片保底 240px（窄屏）/320px（桌面），不得用 `z-index` 掩盖重叠。回归：`test-app` 第 19 节 + QA `tests/reports/qa/results/batch-c-a40-selfcheck.json`。
- 性能：测量方法/口径/数字/复测命令见 [性能测量-2026-10-22.md](性能测量-2026-10-22.md)；本批未新增数据缓存、未改调度/渲染逻辑，只删除 `#curveInfo` legacy 与静态可证无引用的 CSS（明细见 CHANGELOG 批次 C）。

## 语境义数据层（10）

- `js/senses-data.js`：`window.WORD_SENSES = {schemaVersion:1, books:{kaoyan,cet4,cet6,combined}}`，96 条目 / 98 义项 / 98 例句，四书键控；每条 `{preferred:[{meaning, examples:[{source,quote,surface,label?}]}], additional}`。数据来自三本词库的真实真题例句（`source/quote/surface` 可核对），综合书 `apply`「涂抹、敷」与 `content`「含量」补充义来自四级真题并带来源标签。
- 加载与缓存：`<script>` 直接加载（无模块/无网络请求），在词库数据之后、`app.js` 之前；`sw.js` 的 `ASSETS` 含该文件，随整组缓存离线可用；只改数据后必须 bump `CACHE`。
- 渲染：`wordSenseEntry(x)` 只读查询 → `meaningHtml()` 有效时输出 `.sense-block`（`.sense-label`「本书真题已核对义项」、`.sense-item`、`details.sense-evidence` 原句/出处、`lang="en"` 的 `.sense-quote` 经 `exHtml` 可点词、`details.sense-additional`「尚未逐义核验」）；紧凑模式 `.sense-popup`。非法/缺失数据（schemaVersion、books/词书/单词键、preferred、必填字段、`surface` 不在 `quote`、additional 非字符串等）完整回退 `x.m` 扁平释义 + 中性说明，不冒充核对义项。
- 只读：不改队列/进度/判定/台账/熟练，打印/TXT 仍用 11 元组扁平释义，内容层不进备份 v3。校验：`scripts/validate-senses.mjs` + `js/test-senses-data.mjs`；渲染/回退/四书隔离/只读性：`js/test-senses.mjs`。

## 刷新后继续未完成组（15）

```
判定/改判/翻页/撤销/开组/退出特训或子组/pagehide/visibilitychange(hidden)
        │ captureSessionPersistData()（只读当前组现场）
        ▼
localStorage["vocab_session_snapshot_<book>_v1"] = {v,book,dv,day,writer,updatedAt,scopeSig,plan,queue,qi,cur,phase,verdict,answered,rightN,groupTotal,stageBefore,rounds,curBaseline,progressSig}
        ▼ 启动 bootstrapSession()
load()（主记录/熟练键权威） → tryRestoreSessionSnapshot()
        ├─ 版本/词书/日期/dv/内部 scopeSig/plan/队列/进度/熟练/progressSig 全部通过
        │     → applySessionPersistData()：恢复当前卡/队列/分母/待巩固/已揭示态/冻结 plan（不重复记账）
        │     → #resumeNotice「已恢复上次未完成的一组…刷新前撤销记录不可再用」（0 判定恢复显示「尚未作答」）
        └─ 无快照 / 任一校验失败 / 异常 → 清临时快照 → startSession("main") 安全开组
```

- `progressSig` 由 FNV-1a 计算（队列内单词主进度 + 快照当日日统计 + 当日复习台账）；当日统计必须走 `sessionDaySignature(day)`——**当日记录缺失与全 0 记录签名等价**（非 0 字段仍逐字段参与），这是 D-15-01（真实 F5 开组即刷新丢失现场）的修复点，否则全新 profile 首卡渲染惰性创建 `days[today]` 全 0 而主记录未写盘时会被误判 `progress-changed`。主记录被其他标签/导入/重置推进后旧快照安全失效；主记录/熟练键永远权威，快照不做原子锁。
- **08 裁决**：刷新恢复不因「当前设置 `scopeSig` ≠ 快照 `scopeSig`」失效（08 优先），只校验快照内部 `snapshot.scopeSig === plan.scopeSig`；恢复后沿用快照 `plan`，并照常显示「设置已更改，将在下一组生效」。
- 恢复提示口径：**只要恢复了现场就显示 `#resumeNotice`**（0 判定开组即刷新也显示「尚未作答，当前第 1 张」）；`noAction` 仅用于文案区分，不参与校验。
- 撤销栈不持久化（恢复后仅保留当前卡与判定前基线 `curBaseline`）；快照不进备份 v3，`#resumeNotice` 放在 `#groupStatus` 内、沿用扁平 `:has` 行补偿。`simulateReload()` 仅调试/测试模拟整页刷新，**顺序必须对齐真实 boot**（`load()` → `applyTheme()/bindSet()` → 先 `bootstrapSession()` → 再 `applyFilter()/renderStats()`），真实刷新走同一 `bootstrapSession()` 路径；D-15-01 回归见 `js/test-resume-session.mjs`（143 断言）与 `tests/reports/qa/results/repro-d15-01-fixed.json`。
- 注意区分：自动续背「返回上一组结果」用的是**内存**快照 `captureSessionSnapshot()/restoreSessionSnapshot()`（刷新后不可用）；15 的 localStorage 会话快照是另一套持久化机制。

## 拼写专项（16）

```
完成页 #startSpellingBtn「拼写专项（N 词）」→ #spellingSheet（模态，主组现场完全不改）
  ├─ 候选：当前书 + inScope + 排除熟练；优先 hasMainProgress(已学)，不足 10 补未学（组头说明）
  ├─ 题目：中文释义/词性/音标（showPh），不显示英文单词；#spellInput 自动聚焦
  ├─ 判定：spellClean 规范化 → 精确（说明大小写/空白）→ SPELLING_VARIANT_PAIRS(51 对双向英美变体)
  │        → 分隔符宽松（空格/连字符/撇号，说明词库拼写）→ 判错（你的答案/正确拼写/首个不同字符位置）
  ├─ 结果页：仅「本组专项表现」正确/作答/跳过/本组正确率 + 本组错词；不代表主自评/全书掌握率
  └─ 完成一组：state.spelling 累加（sessions/attempts/correct/skipped/lastDay/lastSession）→ save()
```

- 入口守卫：学习卡进行中/特训/子组/已有浮层不可进入；关闭 sheet 回原完成页（`closeSheet` 的拼写清理钩子）。题目**不泄漏英文单词**；空输入不判定不计数，「跳过」单独统计。
- 隔离：只写 `S.spelling`，不写 progress/days/stars/proficient/reviewDay/extraDay/timeSec/settings、不判定、不消费新词/复习额度、不推进 SRS、不改 `p[1]`、不改熟练/收藏、不增加学习时长；打开 sheet 时 `autoResumeEligiblePage` 因 `activeSheet` 为 false 不触发自动续背，与自动续背状态区/临时加量入口共存。
- 存储/备份/多标签：`state.spelling` 随每书 state 进备份 v3（版本不升、旧备份缺字段空白兼容）；未完成退出不记账；当前组现场不持久化；`save()` 与 `storage` 事件按「sessions 多者胜、同组数比 attempts」合并、不累加；`spelling` 不进 `savedStateSignature`（其他标签只记拼写不会重建当前组）。
- 回归：`js/test-spelling-drill.mjs`（47 项）覆盖判定/变体/候选/入口/隔离/存储/备份/跨标签；C-07b 由 `js/test-list-arrow.mjs`（7 项）覆盖。

## 设置生命周期与自动续背

```
设置保存（settingsChangedSurfaces）
  ├─ 外观 / 显示 / 发音 / 快捷键 / 单日复习上限 → 立即生效
  └─ 计划 / 范围（dailyNew、order、fmin/fmax/pmin/kyOnly/pos/posMode、groupSize、backlogGuard）
        ├─ 当前组进行中 → 继续用 sessionPlan（scopeSig/scopeCount/dailyNewTarget，分母固定）
        │      └─ hasPendingScopeSettings() = true → 设置页提示「将在下一组生效」
        └─ 用户点 applySettingsRestart() → startSession("main") 显式重建

完成页自动续背（settings.autoResume.enabled）
idle --(可见完成页 + 连续 idleMs 无有效交互)--> waiting --(candidateStatsNow ≥ threshold)--> countdown
  ↑                                              │                                         │
  └──── 有效交互 / 隐藏 / 离开完成页 / 今天暂停 ◀─┘       到点：抢租约 → 快照 → refreshForResume → startSession("main")
                                                         失败 / 候选不足 → waiting（显示原因，不空开组）
```

## 离线、更新与备份状态

```
启动：file:// → file（不注册并说明）        无 navigator.serviceWorker → unsupported
     其他 → ensureOfflineState() → registering → installing
安装完成：installed/activated → assetsReady
受控判断：controller / controllerchange → ready（已可离线）
首装未受控：ready-uncontrolled（缓存已就绪，重开本页后由缓存提供）
新版本：updatefound + waiting → update-waiting（整组等待旧页面关闭，不自动刷新、不弹升级）
失败：failed + #offlineRetry（只重新注册，不 skipWaiting、不刷新页面、不重建当前卡）
页面 focus/pageshow/可见时：refreshOfflineFromRegistration() 按真实注册对象重查
```

- 状态与文案由 `OFFLINE_TEXT`/`offlineStateText()`/`renderOfflineStatus()` 统一生成，设置页 06 `#settings-offline`（`#offlineStatus`/`#offlineBadge`/`#offlineRetry`）展示；不把「注册成功」当「已离线」。
- 备份状态：`backupStatusText()` 用 `vocab_last_export_v1` 生成「上次导出 YYYY-MM-DD HH:MM（今天/N 天前；下载已发起，请确认文件已妥善保存）」与从未导出/超 30 天提醒，渲染到统计页 `#backupStatus`；文案不出现「已安全备份」，导出只读契约不变。

## 测试与验收

```bash
node --max-old-space-size=512 scripts/verify.mjs   # 汇总（当前 37 项）
node js/test-app.mjs                               # 门控与核心逻辑（162 断言，含第 19 节首屏/统计结构）
node js/test-lifecycle.mjs                         # 08 设置与当前组生命周期
node js/test-defaults.mjs                          # 21 统一默认值与旧记录兼容
node js/test-autoresume.mjs                        # 22 完成页挂机自动续背（141 断言，含今天暂停持久化）
node js/test-senses.mjs                            # 10 语境义接线/渲染/回退/四书隔离（117 断言）
node js/test-senses-data.mjs                       # 10 WORD_SENSES 数据契约（11 断言）
node js/test-resume-session.mjs                    # 15 刷新恢复/签名/失效/08 裁决/D-15-01（143 断言）
node js/test-spelling-drill.mjs                    # 16 拼写专项判定/候选/隔离/备份/跨标签（47 断言）
node js/test-list-arrow.mjs                        # C-07b 词表首次方向键即换行（7 断言）
node js/test-pwa-status.mjs                        # 13 SW 注册/离线状态机/上次导出时间
node js/test-guide.mjs                             # 11 非模态引导/独立键/词表范围摘要
node js/test-a11y.mjs                              # 12 大字/lang=en/设备语音偏好
node scripts/validate-senses.mjs                   # 语境义数据校验（96 条目/98 义项）
node js/validate-words.mjs                         # 考研词库体检
node js/validate-cet-data.mjs                      # 四级/六级词库体检
```

- 测试不启动浏览器，用 Node DOM 桩 / vm 执行真实 `app.js`；批次 D 的「刷新」用 `simulateReload()` 模拟（真实浏览器刷新/关闭重开由 QA 验证）。
- 批次 C 未新增测试文件（没有值得长期守护的性能逻辑）：等价性由 `test-app` 第 19 节（25 条）与既有 `test-rhythm`/`test-lifecycle` 覆盖，性能数字以 `docs/性能测量-2026-10-22.md` 的脚本/口径复测为准。
- 校验报告写入 `tests/reports/`（已 gitignore）。
- 四六级校验的词频交叉核对依赖 `tests/fixtures/cet-wordfreq.json`；该文件未随仓库分发时会跳过交叉核对并给出 warning，其余结构/释义/例句/迁移检查照常执行。

## 仓库策略

- 仓库只保留网页、词库、文档与轻量测试；真题 PDF/语料、生成流水线、独立小工具和一次性交付表不随仓库分发。
- 修改 `js/`、`css/` 或 `index.html` 后，必须同步 bump `sw.js` 的 `CACHE` 与资源 `?v=`。
- 提交粒度：一特性一提交，信息用中文祈使句 + 动机。
