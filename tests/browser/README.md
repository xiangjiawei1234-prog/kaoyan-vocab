# 独立浏览器验收

M03–M06内容与M07词表切书专项：`node --max-old-space-size=512 tests/browser/check-content-maintenance.mjs`。沿用隔离profile与无依赖CDP，保持真实词表切书路径，检查综合高索引切较短词书后的目标列表/焦点和console；不通过先跳学习页绕开。它不进入默认Node汇总。详细覆盖与测试夹具边界见 `docs/大版本内容维护浏览器记录-2026-10-23.md`。

默认Node汇总不启动浏览器。此目录是可交付的检查源代码，结果写入ignored的 `tests/reports/browser/`。

要求：支持全局WebSocket/fetch的Node与本机Chrome；可用 `CHROME_PATH` 指定Chrome可执行文件。无npm依赖。

```bash
node --max-old-space-size=512 tests/browser/cdp.mjs --selftest
node --max-old-space-size=512 tests/browser/check-optimization.mjs
node --max-old-space-size=512 tests/browser/check-surfaces.mjs
node --max-old-space-size=512 tests/browser/check-empty-wait.mjs
node --max-old-space-size=512 tests/browser/check-platform.mjs
node --max-old-space-size=512 tests/browser/check-content-maintenance.mjs
node --max-old-space-size=512 tests/browser/check-settings-workspace.mjs
node --max-old-space-size=512 tests/browser/check-workspace-management.mjs
node --max-old-space-size=512 tests/browser/check-input-preferences.mjs
node --max-old-space-size=512 tests/browser/check-new-optimizations.mjs
node --max-old-space-size=512 tests/browser/check-user-feedback.mjs
node --max-old-space-size=512 tests/browser/check-workspace-close.mjs
node --max-old-space-size=512 tests/browser/check-book-entry.mjs
node --max-old-space-size=512 tests/browser/check-completion-keyboard.mjs
node --max-old-space-size=512 tests/browser/check-preference-concurrency.mjs
node --max-old-space-size=512 tests/browser/check-profile-scope.mjs
node --max-old-space-size=512 tests/browser/check-first-use.mjs
```

最终收尾新增：`check-profile-scope`验证真实UI个人方案只应用本书、同值冻结、未选类别不变、其他书保留设备值以及中性/错误提示区分；`check-first-use`验证320×568等短屏首次首词完整可见、非模态引导和键盘可用；`check-preference-concurrency`用真实双页验证延迟通知下的合并/冲突拒绝及跨书有效按键预检；`check-completion-keyboard`验证字符快捷键关闭时固定Enter仍可续组且不穿透其他控件。所有报告按脚本名写入`results/`，仿真不等于真机。

`check-platform`另有真实旧v3备份文件（缺新增偏好字段）导入确认→四级深色/大字→离线冷刷新→键盘学习路径，核对有效偏好与非默认本页词书保持；与原A/B整组更新、失败安装、file://和原生200%一起验证，不把缓存注册成功当作离线已就绪。

`check-book-entry.mjs` 验证设置页“词库范围”的新切书入口和同一词书浮层：320/375/1440×深浅主题、等宽模式按钮/44px点击高度、叉号/Esc返回入口、切书后仍在设置页并更新词书/词数/筛选上限、local不广播或改默认、旧顶部入口可用。报告`results/book-entry.json`，截图前缀`book-entry-`；真实点击与键盘路径，不通过业务写hook切书。

`check-workspace-close.mjs` 实际点击两个首页入口弹窗的叉号、遮罩并按Esc，验证真正关闭、背景解锁、焦点/学习现场保持和关闭后键盘翻页；包含迟到文件读取不能污染重开的窗口。覆盖1440桌面与375手机仿真，报告`results/workspace-close.json`。它补充旧工作台检查只验证叉号命中、使用Esc关闭的缺口。

`check-user-feedback.mjs` 对应 2026-10-24 六项使用反馈：自然完成组后的空格/自定义键续组、长按键松开边界、熟练浮动确认与取消/自动收起、五种屏幕尺寸的词卡自然高度与统一主区滚动、核心词频默认展开、两项控件紧凑宽度、统计默认展开/折叠与顺序刷新记忆、真实鼠标/触摸长按拖动及边缘连续滚动。可用 `--only=study,card,settings,stats` 分段；报告 `results/user-feedback.json`，截图前缀 `user-feedback-`。全程隔离profile，学习/排序走真实控件，不以业务写hook伪造完成组或排序。自然布局下先滚到动作再检验命中，保留原动作区高度与连击检查；真机/读屏仍不因此视为通过。

`check-input-preferences.mjs` 是 D1 输入定制专项（214 项）：触摸关闭/反转/分阶段映射、Shift 组合键与冲突拒绝、四额外动作、左右手布局、151/156/146px 与窄屏 40px、同坐标双击、阅读现场保持；Chrome 仿真/合成事件不等于真机、输入法或读屏通过。

`check-new-optimizations.mjs` 是 2026-10-24 O1/F1/E/G/H 新能力旅程（96 项，可用 `--only=H|F1|EG|O1|D1` 分段）：H 详情问题记录/真实剪贴板与下载、F1 阅读布局与 320 首屏/统计展开刷新、E 保存视图与全筛选批量、G 统计下钻返回现场、O1 三同源页面的设备通用/本书覆盖/本页-默认-follow 词书，以及 D1 触摸兜底抽测。报告 `results/new-optimizations.json`，截图前缀 `new-opt-`。

检查使用独立临时profile和本地随机端口，结束清理，不修改日常浏览器记录。覆盖双标签冻结组、范围摘要、焦点、统计布局/主题/大字/缩放、真实make拼写题、完成页唯一入口、真实30秒+3秒自动续背、今日暂停后手动继续。统计页在 320/375/424/720/721/768/1000/1001/1280/1440 宽 × 深浅主题下显式断言：`#v-stats` 直接 `.panel` 子节点 class 顺序必须是「今日计划 → 学习总览 → 6 个原生 `details.panel.stats-details` → 备份与导出」、各 panel `top` 单调不减、首尾 panel 左右边线一致；补 720/721 断点用于防 `:has` 行补偿/断点样式回归（720 等价平台原生 200% 布局宽，721 为下一边界）。

`check-optimization.mjs` 另含 M01/M02 维护路径，分别在 375×812 与 1440×1000 执行：M01 自定义自动续背 1 张／90 秒／7 秒，真实点击今日暂停后用 `#autoResumeRestore` 恢复原方案，只清当前书暂停、保留另一书暂停，不判定、不消费额度、不立即跳过等待；M02 仅把均衡曲线改成轻负荷，当前已揭示组和已写到期时间保持冻结，设置页与学习页均显示下一组生效，并分别从两处实际点击显式重开，确认采用新曲线并清除待生效。报告仍为 `results/optimization.json`，新增截图以 `optimization-m01-`／`optimization-m02-` 开头；这些步骤使用真实指针和页面控件，夹具初始化与只读状态采样使用现有调试钩子。

`check-surfaces.mjs` 另测四页和主要浮层：深浅主题375/768/1440宽、学习四种状态、真实连击/指针命中、151/156/146px动作区与窄屏40px提示、完成卡保底自然高度；另含大字、词表搜索/详情、设置/帮助/词书/例句浮层、统计展开和空样本。浮层关闭后断言真实 `document.activeElement`（对齐 `closeSheet()` 实现）：例句浮层 Esc 回触发词、从例句浮层进入的词条详情关闭回 `#card`、词表打开的详情关闭回触发行、帮助/词书浮层先聚焦触发按钮再 Enter 打开、关闭后焦点回 `#btnHelp`/`#btnBooks`。注意：macOS 上鼠标点击原生 `<button>` 不转移焦点，若浮层是纯鼠标点开且触发前焦点在 `body`，`closeSheet()` 本就没有可归还的触发元素（平台输入语义，非回归），这类路径不计入通过项，键盘路径才是可断言的焦点归还契约。报告为 `results/surfaces.json`，截图以 `surfaces-` 开头。

`check-empty-wait.mjs` 从真实0张空页开始：先不选择等待观察到期，再明确启用与选择，实际刷新清除资格，真实30秒闲置/滚轮取消/再30秒+3秒自动开始、返回等待页、今日暂停和手动继续。使用真实时间，运行约两分钟；不会伪造完成组。

`check-content-maintenance.mjs` 验证 M03–M06 内容在 375×812／1440×1000 的真实主学习卡与词表详情：四级／综合 `resit` 的单一动词音标及 `resitting/resat` 词形、六级／综合 `shifty` 的躲闪／不诚实义、考研／综合 `wad` 与 `firefight` 新自编例句及主名词、独立 `firefighting` 原真题消防句。为自然配出指定低频词，每例只在独立临时 profile 将除目标词外的词写入熟练夹具，清空该例学习记录，由真实 `startSession("main")` 启动流程自然配词，再用真实 F 揭示；不直接改队列／当前词／作答数、不伪造已完成组、不从不允许入口进入特训或子组。大量熟练仅为测试夹具，不是用户操作或生产数据。详情走真实词书选择、搜索与点击，并检查不改变当前组或学习记录。报告为 `results/content-maintenance.json`，截图以 `content-maintenance-` 开头；不代替词典证据、全库语义审校、真机或实际发音验证。

`check-settings-workspace.mjs` 覆盖设置工作台与本批高频学习动作：已揭示组快速调计划、即时字号与上限、真实撤销／刷新恢复、常用项自选及跨标签可见同步、十档／语速检索的展开聚焦、方案保存与按类应用、实际下载配置文件及真实文件输入、合法＋非法混合文件整份拒绝、有效导入确认前不落库。另用自然 1 词主组验证「加10词并继续」的同坐标50ms连击不误判新卡、「仅增加额度」不启动、已有收藏时词表打印仍默认完整当前筛选且不丢组。代表组合为1440×1000浅色标准、375×812深色大字。原生select在本机macOS CDP的独立空白页中也不能经方向键提交，因此仅该类选项用DOM控件value＋change事件进入真实表单路径；其他输入／按钮／文件选择沿真实CDP操作，不用业务写hook绕过UI。报告为 `results/settings-workspace.json`，截图以 `settings-workspace-` 开头，产物不进入默认Node汇总。

`check-workspace-management.mjs` 补个人方案管理链，覆盖375／1440 × 深浅四种组合（375大字、1440标准）：真实保存、管理输入不穿透、未改名直接复制自动产生「副本／副本 2」、改名、用当前配置更新、删除后撤销、焦点与真实命中、Esc返回学习卡。明确检查撤销入口没有被固定标题遮住，管理全过程不改变原学习队列、冻结计划、进度、今日加量与暂停。另以375深色一组检查快速将组长改为小于自动阈值后能看到冲突、明确改用便捷续背只改配置且保留本组与今日暂停。只用临时fixture初始化和只读状态hook；业务操作全部走真实控件。报告为 `results/workspace-management.json`，截图以 `workspace-management-` 开头。

窄屏和触摸仿真不代表真机。真实读屏、系统语音、软键盘、Safari/Firefox、系统级后台休眠和PWA安装为系统应用仍需独立记录。前两个布局脚本的200%使用CSS zoom；平台脚本另有原生200%实测，不混淆两者。

`check-platform.mjs` 使用临时应用副本模拟A/B整组发布和单资源缺失，验证真实Service Worker离线刷新、更新等待、关闭旧页后的整组启用；另测file://、Chrome原生200%页面缩放与已安装浏览器能力。报告为 `results/platform.json`。它通过临时Chrome设置页原生Page zoom控件设置200%，并核对CSS zoom=1、visualViewport.scale=1、DPR翻倍和布局宽度减半，不使用CSS zoom或捏合替代。Safari自动化未开启时只记录限制；不修改系统设置，不安装新浏览器，也不使用日常profile。2026-10-24 修订：D1 统一动作守卫会拒绝 `document.visibilityState==="hidden"` 的后台页；打开 chrome://settings 后学习页变为后台标签，平台脚本在像素/指针断言前先 `Page.bringToFront()` 并在采样记录 visibility，不修改产品守卫。
