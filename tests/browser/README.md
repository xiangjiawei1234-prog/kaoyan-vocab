# 独立浏览器验收

默认Node汇总不启动浏览器。此目录是可交付的检查源代码，结果写入ignored的 `tests/reports/browser/`。

要求：支持全局WebSocket/fetch的Node与本机Chrome；可用 `CHROME_PATH` 指定Chrome可执行文件。无npm依赖。

```bash
node --max-old-space-size=512 tests/browser/cdp.mjs --selftest
node --max-old-space-size=512 tests/browser/check-optimization.mjs
node --max-old-space-size=512 tests/browser/check-surfaces.mjs
node --max-old-space-size=512 tests/browser/check-empty-wait.mjs
node --max-old-space-size=512 tests/browser/check-platform.mjs
```

检查使用独立临时profile和本地随机端口，结束清理，不修改日常浏览器记录。覆盖双标签冻结组、范围摘要、焦点、统计布局/主题/大字/缩放、真实make拼写题、完成页唯一入口、真实30秒+3秒自动续背、今日暂停后手动继续。统计页在 320/375/424/720/721/768/1000/1001/1280/1440 宽 × 深浅主题下显式断言：`#v-stats` 直接 `.panel` 子节点 class 顺序必须是「今日计划 → 学习总览 → 6 个原生 `details.panel.stats-details` → 备份与导出」、各 panel `top` 单调不减、首尾 panel 左右边线一致；补 720/721 断点用于防 `:has` 行补偿/断点样式回归（720 等价平台原生 200% 布局宽，721 为下一边界）。

`check-surfaces.mjs` 另测四页和主要浮层：深浅主题375/768/1440宽、学习四种状态、真实连击/指针命中、151/156/146px动作区与窄屏40px提示、完成卡保底自然高度；另含大字、词表搜索/详情、设置/帮助/词书/例句浮层、统计展开和空样本。浮层关闭后断言真实 `document.activeElement`（对齐 `closeSheet()` 实现）：例句浮层 Esc 回触发词、从例句浮层进入的词条详情关闭回 `#card`、词表打开的详情关闭回触发行、帮助/词书浮层先聚焦触发按钮再 Enter 打开、关闭后焦点回 `#btnHelp`/`#btnBooks`。注意：macOS 上鼠标点击原生 `<button>` 不转移焦点，若浮层是纯鼠标点开且触发前焦点在 `body`，`closeSheet()` 本就没有可归还的触发元素（平台输入语义，非回归），这类路径不计入通过项，键盘路径才是可断言的焦点归还契约。报告为 `results/surfaces.json`，截图以 `surfaces-` 开头。

`check-empty-wait.mjs` 从真实0张空页开始：先不选择等待观察到期，再明确启用与选择，实际刷新清除资格，真实30秒闲置/滚轮取消/再30秒+3秒自动开始、返回等待页、今日暂停和手动继续。使用真实时间，运行约两分钟；不会伪造完成组。

窄屏和触摸仿真不代表真机。真实读屏、系统语音、软键盘、Safari/Firefox、系统级后台休眠和PWA安装为系统应用仍需独立记录。前两个布局脚本的200%使用CSS zoom；平台脚本另有原生200%实测，不混淆两者。

`check-platform.mjs` 使用临时应用副本模拟A/B整组发布和单资源缺失，验证真实Service Worker离线刷新、更新等待、关闭旧页后的整组启用；另测file://、Chrome原生200%页面缩放与已安装浏览器能力。报告为 `results/platform.json`。它通过临时Chrome设置页原生Page zoom控件设置200%，并核对CSS zoom=1、visualViewport.scale=1、DPR翻倍和布局宽度减半，不使用CSS zoom或捏合替代。Safari自动化未开启时只记录限制；不修改系统设置，不安装新浏览器，也不使用日常profile。
