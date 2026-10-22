/**
 * 新功能验收：错词特训 + 学习热力图（Node DOM 桩）
 * 运行：node js/test-new-features.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ck = (c, label, detail = "") => {
  if (c) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}  ${detail}`); }
};

// ---------------- DOM 桩 ----------------
function mkEl(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(),
    _h: "",
    style: {},
    dataset: {},
    value: "",
    checked: false,
    textContent: "",
    hidden: false,
    files: [],
    scrollTop: 0,
    clientHeight: 600,
    onclick: null,
    classList: {
      _s: new Set(),
      add(...a) { a.forEach(x => this._s.add(x)); },
      remove(...a) { a.forEach(x => this._s.delete(x)); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (f) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    addEventListener() {},
    appendChild() {},
    click() {},
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 })
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return this._h; },
    set(v) { this._h = String(v); }
  });
  Object.defineProperty(el, "offsetWidth", { get() { return 100; } });
  return el;
}

const registry = new Map();
function getEl(sel) {
  if (!registry.has(sel)) {
    const el = mkEl(sel.includes("input") ? "input" : sel.includes("select") ? "select" : sel.includes("button") ? "button" : "div");
    if (sel === "#v-study") el.classList.add("on");
    registry.set(sel, el);
  }
  return registry.get(sel);
}

globalThis.document = {
  querySelector: (s) => getEl(s),
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: (t) => mkEl(t),
  documentElement: { dataset: {} },
  visibilityState: "visible"
};
globalThis.window = {
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  WORDS_RAW: null
};
let store = {};
globalThis.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
globalThis.setInterval = () => 0;
globalThis.setTimeout = (fn) => 0;
globalThis.clearTimeout = () => {};
globalThis.confirm = () => false;
globalThis.Blob = class {};
globalThis.URL = { createObjectURL: () => "", revokeObjectURL() {} };
globalThis.FileReader = class {};
globalThis.SpeechSynthesisUtterance = class {};
globalThis.speechSynthesis = { cancel() {}, speak() {} };

// ---------------- 加载数据与脚本 ----------------
const wordsJs = fs.readFileSync(path.join(HERE, "words-data.js"), "utf8");
// 执行真实数据脚本，同时载入 WORD_BOOK_META 的数据版本与迁移信息。
new Function(wordsJs)();
globalThis.WORDS_RAW = globalThis.window.WORDS_RAW;

const appJs = fs.readFileSync(path.join(HERE, "app.js"), "utf8");
try {
  new Function(appJs)();
} catch (e) {
  console.error("app.js 执行失败:", e.stack || e.message);
  process.exit(1);
}
const T = globalThis.window.__vocab;
if (!T) { console.error("未找到 window.__vocab 调试钩子"); process.exit(1); }

const W = T.getW();

function resetFilter() {
  const S = T.getS();
  S.settings.fmin = 1; S.settings.fmax = 0; S.settings.pmin = 0;
  S.settings.kyOnly = false; S.settings.pos = [];
}
function clearRecords() {
  const S = T.getS();
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {};
  delete store.kaoyan_vocab_proficient_v1;
}
function todayStr(d) {
  d = d || new Date();
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

// 取两个稳定词条
const iA = W.findIndex(x => x.w === "people");
const iB = W.findIndex(x => x.w === "answer");
const iC = W.findIndex(x => x.w === "time");
ck(iA >= 0 && iB >= 0 && iC >= 0, "测试词条存在", `A=${iA} B=${iB} C=${iC}`);

console.log("== 1. 错词队列生成 ==");
{
  resetFilter(); clearRecords();
  const S = T.getS();
  const now = Date.now();
  // A 错 3 次、B 错 1 次、C 未学；再加一个熟练的错词
  S.progress[iA] = [2, now + 1e9, 4, 3, now];
  S.progress[iB] = [1, now + 1e9, 2, 1, now];
  S.proficient[W[iC].w] = now;
  S.progress[iC] = [2, now + 1e9, 1, 5, now];

  const list = T.wrongWordIndices();
  ck(list.length === 2, "只收 wrong>0 且未熟练的词", `len=${list.length}`);
  ck(list.includes(iA) && list.includes(iB), "错词 A/B 入选");
  ck(!list.includes(iC), "熟练词不入错词队列");
  ck(list[0] === iA && list[1] === iB, "按错次降序排列", `order=${list.join(",")}`);

  // 错次相同则按词频
  S.progress[iB][3] = 3;
  const list2 = T.wrongWordIndices();
  const firstRank = Math.min(W[list2[0]].r, W[list2[1]].r);
  ck(W[list2[0]].r === firstRank, "错次相同时按词频升序", `ranks=${list2.map(i => W[i].r).join(",")}`);

  // 错次为 0 的不出现在队列
  S.progress[iB][3] = 0;
  const list3 = T.wrongWordIndices();
  ck(!list3.includes(iB), "错次清零后离开错词本");
  ck(list3.length === 1 && list3[0] === iA, "队列只剩仍错的词");
}

console.log("== 2. 特训判定对错次的影响 ==");
{
  resetFilter(); clearRecords();
  const S = T.getS();
  const now = Date.now();
  S.progress[iA] = [2, now + 1e9, 4, 3, now];
  const stageBefore = S.progress[iA][0], dueBefore = S.progress[iA][1], rightBefore = S.progress[iA][2];

  ck(T.startDrill() === true, "错词非空可进入特训");
  ck(T.drillMode === true, "drillMode 打开");
  ck(T.Q.length === 1 && T.Q[0] === iA, "特训队列只含错词", `Q=${T.Q.join(",")}`);
  ck(T.phase === "recall", "特训开局 phase=recall");

  // 门控：未判定不能翻页
  const qi0 = T.qi;
  T.tryNext(true);
  ck(T.qi === qi0 && T.phase === "recall", "特训同样受 recall 门控");

  // 会：错次 -1，不动学习调度
  T.judge(true);
  ck(S.progress[iA][3] === 2, "「会」错次 3→2", String(S.progress[iA][3]));
  ck(S.progress[iA][0] === stageBefore, "「会」不改学习档位", String(S.progress[iA][0]));
  ck(S.progress[iA][1] === dueBefore, "「会」不改到期时间");
  ck(S.progress[iA][2] === rightBefore, "「会」不计入原 right 计数");

  // 改判为不会：回滚到判定前的原始错次 3，再按「不会」+1 → 4
  T.judge(false);
  ck(S.progress[iA][3] === 4, "改判「不会」= 原始 3 + 1", String(S.progress[iA][3]));
  ck(S.progress[iA][0] === stageBefore, "改判仍不动学习档位");

  // 撤销改判 → 回到「会」
  T.undo();
  ck(T.verdict === true, "撤销改判回到「会」");
  ck(S.progress[iA][3] === 2, "撤销改判后错次=2", String(S.progress[iA][3]));

  // 撤销判定 → 回到 recall
  T.undo();
  ck(T.phase === "recall" && T.verdict === null, "撤销判定回到 recall");
  ck(S.progress[iA][3] === 3, "撤销判定后错次回滚到 3", String(S.progress[iA][3]));

  // 不会：错次 +1，词留在错词本
  T.judge(false);
  ck(S.progress[iA][3] === 4, "「不会」错次 3→4", String(S.progress[iA][3]));
  ck(S.progress[iA][0] === stageBefore, "「不会」不改学习档位");
  ck(S.progress[iA][1] === dueBefore, "「不会」不改到期时间");
  ck(T.wrongWordIndices().includes(iA), "「不会」后仍在错词本");
}

console.log("== 3. 会了减到 0 后退出错词本 ==");
{
  resetFilter(); clearRecords();
  const S = T.getS();
  const now = Date.now();
  S.progress[iA] = [3, now + 1e9, 5, 1, now];
  T.startDrill();
  T.judge(true);
  ck(S.progress[iA][3] === 0, "错次 1→0", String(S.progress[iA][3]));
  ck(S.progress[iA][0] === 3, "档位保持 3");
  ck(!T.wrongWordIndices().includes(iA), "错次 0 后离开错词本");
}

console.log("== 4. 主队列不受损 ==");
{
  resetFilter(); clearRecords();
  const S = T.getS();
  S.settings.dailyNew = 20;
  S.settings.order = "freq";
  const now = Date.now();
  // 主队列：造 3 个新词；错词：iA（不在本次主队列新词前排）
  // 用两个到期复习词作为主队列内容，避免和每日新词额度耦合
  const m1 = iA, m2 = iB, m3 = iC;
  S.progress[m1] = [1, now - 1000, 2, 2, now]; // 到期 + 错词
  S.progress[m2] = [1, now - 500, 1, 0, now];  // 到期
  S.progress[m3] = [2, now - 2000, 3, 0, now]; // 到期
  T.startSession();
  const mainQ = T.Q.slice();
  const mainQi = T.qi;
  const mainAnswered = T.answered;
  ck(mainQ.length >= 2, "主会话有队列", `len=${mainQ.length}`);
  ck(T.drillMode === false, "主会话不在特训");

  const progBefore = JSON.stringify(S.progress);
  const daysBefore = JSON.stringify(S.days);
  const dayNBefore = (S.days[todayStr()] || { n: 0 }).n;

  T.startDrill();
  ck(T.drillMode === true, "进入特训");
  ck(JSON.stringify(T.Q) === JSON.stringify(T.wrongWordIndices()), "特训队列独立于主队列");
  T.judge(true);  // m1 错次 2→1
  T.tryNext(true);
  if (T.cur != null) { T.judge(false); T.tryNext(true); }

  T.exitDrill();
  ck(T.drillMode === false, "exitDrill 关闭特训");
  ck(JSON.stringify(T.Q) === JSON.stringify(mainQ), "退出后主队列还原", `got=${T.Q.join(",")} want=${mainQ.join(",")}`);
  ck(T.qi === mainQi, "退出后 qi 还原", `${T.qi} vs ${mainQi}`);
  ck(T.answered === mainAnswered, "退出后 answered 还原", `${T.answered} vs ${mainAnswered}`);

  // 今日新词额度不受特训影响
  const dayNAfter = (S.days[todayStr()] || { n: 0 }).n;
  ck(dayNAfter === dayNBefore, "特训不占今日新词额度", `${dayNBefore} -> ${dayNAfter}`);

  // 学习调度（档位/到期）不被特训判定改写
  for (const i of [m1, m2, m3]) {
    const a = JSON.parse(progBefore)[i], b = S.progress[i];
    ck(a[0] === b[0] && a[1] === b[1], `词 ${W[i].w} 的档位与到期时间不变`, `stage ${a[0]}->${b[0]} due ${a[1]}->${b[1]}`);
  }
  // 错次确实被特训调整（m1「会」过一次）
  ck(S.progress[m1][3] === 1, "特训「会」使 m1 错次 2→1", String(S.progress[m1][3]));
  // 每日记录仍满足 n<=r 且 ok+no==r
  const dayRec = S.days[todayStr()] || { n: 0, r: 0, ok: 0, no: 0 };
  ck(dayRec.n <= dayRec.r && dayRec.ok + dayRec.no === dayRec.r,
    "特训后每日记录自洽", JSON.stringify(dayRec));
}

console.log("== 5. 空错词本 / 退出后可再进 ==");
{
  resetFilter(); clearRecords();
  ck(T.wrongWordIndices().length === 0, "空错词本");
  ck(T.startDrill() === false, "空错词本不能进入特训");
  ck(T.drillMode === false, "进入失败则不在特训");

  const S = T.getS();
  const now = Date.now();
  S.progress[iA] = [1, now + 1e9, 0, 2, now];
  ck(T.startDrill() === true, "有错词可进入特训");
  T.exitDrill();
  ck(T.drillMode === false, "可退出特训");
  ck(T.startDrill() === true, "退出后可再次进入特训");
  T.exitDrill();
}

console.log("== 6. 热力图：heatLevel 分级 ==");
{
  ck(T.heatLevel(0) === 0, "0 次 → 0 级");
  ck(T.heatLevel(-1) === 0, "负数按 0 级");
  ck(T.heatLevel(1) === 1 && T.heatLevel(4) === 1, "1–4 次 → 1 级");
  ck(T.heatLevel(5) === 2 && T.heatLevel(9) === 2, "5–9 次 → 2 级");
  ck(T.heatLevel(10) === 3 && T.heatLevel(19) === 3, "10–19 次 → 3 级");
  ck(T.heatLevel(20) === 4 && T.heatLevel(999) === 4, "≥20 次 → 4 级");
}

console.log("== 7. 热力图：heatmapData 聚合 ==");
{
  const today = todayStr();
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  const keyOff = (delta) => {
    const x = new Date(d);
    x.setDate(x.getDate() + delta);
    return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
  };

  const days = {
    [keyOff(-1)]: { n: 2, r: 10, ok: 8, no: 2 },   // 学习 10 次
    [keyOff(-3)]: { n: 0, r: 5, ok: 5, no: 0 },    // 学习 5 次
    [keyOff(-8)]: { n: 1, r: 1, ok: 1, no: 0 },    // 学习 1 次
    [keyOff(-40)]: { n: 3, r: 25, ok: 20, no: 5 }  // 学习 25 次
  };

  const cells = T.heatmapData(days, today, 12);
  ck(cells.length === 84, "12 周 × 7 天 = 84 格", String(cells.length));
  ck(cells[0].date <= cells[83].date, "格子按日期升序");
  ck(cells[83].date === today || cells.some(c => c.date === today), "包含今天", `last=${cells[83].date}`);
  ck(cells.every(c => !c.future || c.date > today), "future 标记只用于今天之后");
  ck(cells.filter(c => c.future).length < 7, "未来格子仅出现在本周", String(cells.filter(c => c.future).length));

  const byDate = Object.fromEntries(cells.map(c => [c.date, c]));
  ck(byDate[keyOff(-1)] && byDate[keyOff(-1)].vol === 10, "聚合 vol=r（新词+复习）", JSON.stringify(byDate[keyOff(-1)]));
  ck(byDate[keyOff(-1)].level === 3, "10 次 → level 3", String(byDate[keyOff(-1)].level));
  ck(byDate[keyOff(-3)].vol === 5 && byDate[keyOff(-3)].level === 2, "5 次 → level 2");
  ck(byDate[keyOff(-8)].vol === 1 && byDate[keyOff(-8)].level === 1, "1 次 → level 1");
  ck(byDate[keyOff(-40)].vol === 25 && byDate[keyOff(-40)].level === 4, "25 次 → level 4");
  ck(byDate[keyOff(-1)].n === 2 && byDate[keyOff(-1)].ok === 8, "格子保留 n/ok 明细");
  ck(byDate[keyOff(-2)].vol === 0 && byDate[keyOff(-2)].level === 0, "无记录日 vol=0 / level 0");

  // weekday：起点是周日，cells[k].weekday === k % 7
  ck(cells.every((c, k) => c.weekday === k % 7), "weekday 与列位置一致（周日起）");
  ck(cells[0].weekday === 0 && cells[6].weekday === 6, "首列覆盖周日到周六");

  // 边界：非法日期 / 周数钳制
  let threw = false;
  try { T.heatmapData({}, "not-a-date", 12); } catch (e) { threw = true; }
  ck(threw, "非法日期抛错");
  ck(T.heatmapData({}, today, 0).length === 84, "weeks=0 回退 12 周");
  ck(T.heatmapData({}, today, 99).length === 26 * 7, "weeks 上限 26 周");
  ck(T.heatmapData(null, today, 12).every(c => c.vol === 0), "days=null 全 0");
}

console.log("== 8. 热力图：renderStats 产出格子 HTML ==");
{
  resetFilter(); clearRecords();
  const S = T.getS();
  const now = Date.now();
  S.days[todayStr()] = { n: 3, r: 12, ok: 10, no: 2 };
  T.show("stats");
  const html = getEl("#heatmap").innerHTML || "";
  ck(html.includes("hm-cell"), "热力图渲染出格子", html.slice(0, 80));
  ck(html.includes('data-level="3"'), "当日 12 次对应 level 3", html.match(/data-level="\d"/g)?.join(","));
  ck(html.includes("今天") || html.includes(todayStr()), "格子含可读标签（日期/学习次数）");
  ck(html.includes("aria-label"), "格子带 aria-label");
  const tip = getEl("#heatmapTip").textContent;
  ck(typeof tip === "string" && tip.length > 0, "热力图提示文案已写入", tip);
}

console.log("== 9. 特训后改判与撤销保留特训成果 ==");
{
  resetFilter(); clearRecords();
  const S = T.getS(), now = Date.now();
  S.settings.dailyNew = 1;
  S.progress[iA] = [2, now - 1, 4, 3, now - 1000];
  T.startSession();
  ck(T.cur === iA, "到期错词成为主会话当前词");
  T.judge(false);
  // 多次改判产生共享的 originalSnap，退出时不能重复叠加特训增量。
  T.judge(true); T.judge(false);
  T.startDrill(); T.judge(true); T.exitDrill();
  ck(S.progress[iA][3] === 3, "特训将主判定后的错次 4→3");
  T.judge(true);
  ck(S.progress[iA][3] === 2, "主会话改判只撤回自身错次，保留特训 -1");
  ck(JSON.stringify(S.days[todayStr()]) === JSON.stringify({n:0, r:2, ok:2, no:0}),
    "主会话改判保留特训作答统计", JSON.stringify(S.days[todayStr()]));
  T.undo();
  ck(T.verdict === false && S.progress[iA][3] === 3, "撤销改判保留特训后的原判定");
  T.undo();
  ck(T.verdict === true && S.progress[iA][3] === 2, "较早的改判快照也已补入特训增量");
  T.undo();
  ck(T.verdict === false && S.progress[iA][3] === 3, "共享快照只补入一次特训增量");
  T.undo();
  ck(T.phase === "recall" && S.progress[iA][0] === 2 && S.progress[iA][3] === 2,
    "撤销原始判定保留原档位与特训错次");
  ck(JSON.stringify(S.days[todayStr()]) === JSON.stringify({n:0, r:1, ok:1, no:0}),
    "撤销全部主判定后仍保留特训统计", JSON.stringify(S.days[todayStr()]));
}

console.log("== 10. 特训后撤销新词不丢新增错次或产生负数 ==");
{
  resetFilter(); clearRecords();
  const S = T.getS();
  S.settings.dailyNew = 1;
  T.startSession();
  const i = T.cur;
  T.judge(false); T.startDrill(); T.judge(false); T.exitDrill(); T.undo();
  ck(S.progress[i] && S.progress[i][0] === 0 && S.progress[i][3] === 1,
    "撤销首次学习后仍保留特训新增错次");
  ck(JSON.stringify(S.days[todayStr()]) === JSON.stringify({n:0, r:1, ok:0, no:1}),
    "撤销首次学习返还新词配额并保留特训次数");

  clearRecords(); T.startSession();
  const j = T.cur;
  T.judge(false); T.startDrill(); T.judge(true); T.exitDrill(); T.undo();
  ck(!S.progress[j], "特训减至零后撤销首次判定，不制造负错次或空进度");
  ck(JSON.stringify(S.days[todayStr()]) === JSON.stringify({n:0, r:1, ok:1, no:0}),
    "原进度删除后仍保留特训正确记录");
}

console.log("== 11. 特训期间熟练后，主会话撤销不会重新展示熟练词 ==");
{
  resetFilter(); clearRecords();
  const S = T.getS();
  S.settings.dailyNew = 1;
  T.startSession();
  const i = T.cur;
  T.judge(false); T.startDrill(); T.setProficient(i, true); T.exitDrill(); T.undo();
  ck(T.isProficient(i), "特训期间标记的熟练状态保留");
  ck(T.cur !== i && !T.Q.slice(T.qi).includes(i), "退出特训再撤销也不让熟练词返回当前队列");
}

console.log("== 12. 跨日特训后的主会话改判保留两天记录 ==");
{
  const RealDate = globalThis.Date;
  let now = new RealDate(2026, 9, 21, 23, 59, 0).getTime();
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  try {
    resetFilter(); clearRecords();
    const S = T.getS();
    S.settings.dailyNew = 1;
    S.progress[iA] = [2, now - 2, 3, 3, now - 1000];
    S.progress[iB] = [2, now + 1e9, 3, 2, now - 1000];
    T.startSession();
    T.judge(false);
    const firstDate = todayStr();
    T.startDrill(); T.judge(true); T.tryNext(true);
    now += 2 * 60 * 1000;
    const secondDate = todayStr();
    T.judge(false); T.exitDrill(); T.judge(true);
    ck(JSON.stringify(S.days[firstDate]) === JSON.stringify({n:0, r:1, ok:1, no:0}),
      "跨日改判保留前一天特训记录", JSON.stringify(S.days[firstDate]));
    ck(JSON.stringify(S.days[secondDate]) === JSON.stringify({n:0, r:2, ok:1, no:1}),
      "跨日改判保留第二天特训并记录新的主判定", JSON.stringify(S.days[secondDate]));
    T.undo();
    ck(JSON.stringify(S.days[firstDate]) === JSON.stringify({n:0, r:2, ok:1, no:1}),
      "撤销跨日改判还原前一天主判定与特训");
    ck(JSON.stringify(S.days[secondDate]) === JSON.stringify({n:0, r:1, ok:0, no:1}),
      "撤销跨日改判保留第二天特训");
  } finally {
    globalThis.Date = RealDate;
  }
}

console.log("== 13. 特训清零后多次改判不复活错次，存储始终非负 ==");
{
  resetFilter(); clearRecords();
  const S = T.getS();
  S.settings.dailyNew = 1;
  T.startSession();
  const i = T.cur;
  T.judge(false); T.startDrill(); T.judge(true); T.exitDrill();
  for (let k = 0; k < 6; k++) T.judge(k % 2 === 0);
  ck(S.progress[i][3] === 0 && !T.wrongWordIndices().includes(i),
    "全新词的特训清零经过多次会/不会改判后仍为零");
  ck(JSON.stringify(S.days[todayStr()]) === JSON.stringify({n:1, r:2, ok:1, no:1}),
    "零下界多次改判不叠加每日统计");
  const persisted = JSON.parse(store.kaoyan_vocab_v1);
  ck(persisted.progress[i][3] === 0 && T.normalizeState(persisted).progress[i][3] === 0,
    "负抵消量只在快照中保留，持久化与校验记录均非负");
  for (let k = 0; k < 6; k++) T.undo();
  ck(T.verdict === false && S.progress[i][3] === 0,
    "撤销全部改判后仍保留特训清零");
  T.undo();
  ck(!S.progress[i] && S.days[todayStr()].r === 1 && S.days[todayStr()].n === 0,
    "继续撤销首次判定可恢复未学，并保留特训作答");
}

console.log("== 14. 多次特训的负抵消量累计跨过零下界 ==");
{
  resetFilter(); clearRecords();
  const S = T.getS(), now = Date.now();
  S.settings.dailyNew = 1;
  S.progress[iA] = [2, now - 1, 3, 1, now - 1000];
  T.startSession();
  T.judge(false); T.startDrill(); T.judge(true); T.exitDrill();
  T.judge(true); T.judge(false);
  ck(S.progress[iA][3] === 1, "第一轮特训抵消一条错次");
  T.startDrill(); T.judge(true); T.exitDrill();
  for (let k = 0; k < 6; k++) T.judge(k % 2 === 0);
  ck(S.progress[iA][3] === 0 && !T.wrongWordIndices().includes(iA),
    "第二轮特训的负增量累计保留，反复改判仍不复活错次");
  ck(JSON.stringify(S.days[todayStr()]) === JSON.stringify({n:0, r:3, ok:2, no:1}),
    "多轮特训后仍只统计一次主判定和两次特训");
  for (let k = 0; k < 9; k++) T.undo();
  ck(T.phase === "recall" && S.progress[iA][0] === 2 && S.progress[iA][3] === 0,
    "多轮特训后撤销完整主会话仍保留两轮减错成果");
  ck(JSON.stringify(S.days[todayStr()]) === JSON.stringify({n:0, r:2, ok:2, no:0}),
    "撤销完整主会话后两轮特训统计仍在");
}

console.log("== 15. 特训增错后再清零，不污染原本为空的主快照 ==");
{
  resetFilter(); clearRecords();
  const S = T.getS();
  S.settings.dailyNew = 1;
  T.startSession();
  const i = T.cur;
  T.judge(false); T.startDrill(); T.judge(false); T.exitDrill();
  T.judge(true); T.judge(false);
  ck(JSON.stringify(S.days[todayStr()]) === JSON.stringify({n:1, r:2, ok:0, no:2}),
    "新词在特训增错后改判仍只占一次新词配额");
  T.startDrill(); T.judge(true); T.exitDrill();
  T.judge(true); T.judge(false);
  T.startDrill(); T.judge(true); T.exitDrill();
  T.judge(true); T.judge(false);
  ck(S.progress[i][3] === 0, "增错与多次减错的 signed 增量正确相抵");
  for (let k = 0; k < 7; k++) T.undo();
  ck(!S.progress[i], "累计负增量不会把原本为空的进度快照变成伪已学词");
  ck(JSON.stringify(S.days[todayStr()]) === JSON.stringify({n:0, r:3, ok:2, no:1}),
    "完整撤销后保留三轮特训统计");
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
