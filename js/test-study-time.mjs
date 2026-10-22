/**
 * 04 累计学习时长口径（回归）
 * 受控时钟 + vm 沙箱执行真实 js/app.js：按实际经过时间计量，活动后闲置暂停，
 * 隐藏/休眠/恢复不补记，跨天只累计总量，多标签重叠不重复累计，保存失败不清零。
 * 运行：node --max-old-space-size=512 js/test-study-time.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const KEY = "kaoyan_vocab_v1";
const PROF_KEY = "kaoyan_vocab_proficient_v1";
const appSource = () => fs.readFileSync(path.join(HERE, "app.js"), "utf8");
const wordsSource = fs.readFileSync(path.join(HERE, "words-data.js"), "utf8");
const indexSource = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const appText = appSource();

// 常量从真实实现读取，测试不写死采样/闲置/休眠阈值。
function numConst(name) {
  const m = appText.match(new RegExp("const " + name + "\\s*=\\s*(\\d+)"));
  assert.ok(m, `app.js 应声明 ${name}`);
  return Number(m[1]);
}
const TICK_MS = numConst("STUDY_TICK_MS");
const IDLE_MS = numConst("STUDY_IDLE_MS");
const SUSPEND_GAP_MS = numConst("STUDY_SUSPEND_GAP_MS");
const PERSIST_MS = numConst("STUDY_PERSIST_MS");

const clone = value => JSON.parse(JSON.stringify(value));
const today = now => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** 浏览器桩：受控 Date/performance、可捕获 setInterval、可切换可见性与写失败。 */
function browser({ initial = null, sharedStorage = null } = {}) {
  let now = new Date(2026, 9, 10, 12, 0, 0).getTime();
  const T0 = now;
  let failWrites = false;
  const writeLog = [];
  const registry = new Map();
  const documentEvents = new Map(); // type → [{fn, capture}]
  const windowEvents = new Map();
  const intervals = [];
  const storage = sharedStorage || new Map(initial === null ? [] : [[KEY, typeof initial === "string" ? initial : JSON.stringify(initial)]]);

  function element(tag = "div") {
    const events = new Map();
    const classes = new Set();
    const el = {
      tagName: String(tag).toUpperCase(), id: "", style: {}, dataset: {}, value: "",
      checked: false, disabled: false, hidden: false, files: [], scrollTop: 0,
      clientHeight: 600, textContent: "", onclick: null, onchange: null, oninput: null,
      offsetWidth: 100, offsetHeight: 40, children: [], parentNode: null,
      classList: {
        add(...names) { names.forEach(n => classes.add(n)); },
        remove(...names) { names.forEach(n => classes.delete(n)); },
        contains(name) { return classes.has(name); },
        toggle(name, force) { const on = force === undefined ? !classes.has(name) : force; if (on) classes.add(name); else classes.delete(name); return on; }
      },
      addEventListener(type, fn, options) {
        if (!events.has(type)) events.set(type, []);
        const capture = typeof options === "boolean" ? options : !!(options && options.capture);
        events.get(type).push({ fn, capture });
      },
      removeEventListener() {},
      appendChild(child) { el.children.push(child); child.parentNode = el; return child; },
      click() { if (el.onclick) el.onclick({ target: el, preventDefault() {}, stopPropagation() {} }); },
      focus() { if (document) document.activeElement = el; },
      blur() { if (document && document.activeElement === el) document.activeElement = null; },
      closest() { return null; },
      contains(node) { return node === el; },
      getAttribute() { return null; },
      setAttribute() {}, removeAttribute() {},
      querySelector() { return element("div"); },
      querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
    };
    Object.defineProperty(el, "innerHTML", {
      get() { return el._html || ""; },
      set(v) { el._html = String(v); }
    });
    return el;
  }
  function query(selector) {
    if (selector === ".view.on") return views.find(x => x.classList.contains("on")) || null;
    if (!registry.has(selector)) registry.set(selector, element(selector.startsWith("input#") || /^#(dailyNew|pmin|fmin|fmax)$/.test(selector) ? "input" : "div"));
    return registry.get(selector);
  }
  const views = ["study", "list", "stats", "set"].map(v => query(`#v-${v}`));
  views[0].classList.add("on");
  const nav = ["study", "list", "stats", "set"].map(v => { const b = element("button"); b.dataset.v = v; return b; });
  const keyButtons = ["know", "dont", "next", "speak", "star", "proficient"].map(k => { const b = element("button"); b.dataset.k = k; return b; });
  const closeButton = element("button");
  function queryAll(selector) {
    if (selector === ".view") return views;
    if (selector === ".nav button") return nav;
    if (selector === ".keybtn") return keyButtons;
    if (selector === "#helpSheet [data-close]" || selector === "#helpSheet button") return [closeButton];
    return [];
  }
  query("#fst").value = "all";
  query("#fsc").value = "scope";
  query("#helpSheet").hidden = true;

  const document = {
    querySelector: query, querySelectorAll: queryAll,
    documentElement: { dataset: {}, style: {} }, body: element("body"),
    visibilityState: "visible", activeElement: null,
    addEventListener(type, fn, options) {
      if (!documentEvents.has(type)) documentEvents.set(type, []);
      const capture = typeof options === "boolean" ? options : !!(options && options.capture);
      documentEvents.get(type).push({ fn, capture });
    },
    removeEventListener() {},
    createElement(tag) { return element(tag); }
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const window = {
    document,
    addEventListener(type, fn) { if (!windowEvents.has(type)) windowEvents.set(type, []); windowEvents.get(type).push(fn); },
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame(fn) { fn(); return 0; }, cancelAnimationFrame() {},
    innerWidth: 1200, innerHeight: 800
  };
  const localStorage = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem(k, v) {
      if (failWrites) throw new Error("QuotaExceededError: storage disabled");
      writeLog.push(k);
      storage.set(k, String(v));
    },
    removeItem: k => storage.delete(k)
  };
  const context = vm.createContext({
    window, document, Date: ClockDate, console, localStorage,
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval() {},
    setTimeout() { return 0; },
    clearTimeout() {},
    requestAnimationFrame(fn) { fn(); return 0; }, cancelAnimationFrame() {},
    confirm: () => true,
    Blob: class {}, URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    FileReader: class {}, SpeechSynthesisUtterance: class {},
    speechSynthesis: { cancel() {}, speak() {} },
    performance: { now: () => now - T0 }, structuredClone: clone
  });
  vm.runInContext(wordsSource, context, { filename: "words-data.js" });
  vm.runInContext(appSource(), context, { filename: "app.js" });
  const T = window.__vocab;
  assert.ok(T, "app.js 应提供 window.__vocab 测试入口");
  const study = window.__vocabStudy;
  assert.ok(study, "app.js 应提供 window.__vocabStudy 只读计时钩子");

  const fireDocument = (type, ev = {}) => {
    const event = Object.assign({ type, target: document.body, preventDefault() {}, stopPropagation() {} }, ev);
    for (const rec of documentEvents.get(type) || []) if (rec.capture) rec.fn(event);
    for (const rec of documentEvents.get(type) || []) if (!rec.capture) rec.fn(event);
    return event;
  };
  return {
    T, study, window, document, context, storage, intervals, writeLog, query, views,
    get now() { return now; },
    advance(ms) { now += ms; },
    tick() { study.tick(); },
    act() { study.act(); },
    flush() { return study.flush(); },
    debug() { return study.getDebug(); },
    timer() {
      const ms = study.getDebug().tickMs;
      const timer = intervals.find(t => t.ms === ms);
      assert.ok(timer, `应注册 ${ms}ms 学习时长采样定时器`);
      return timer.fn;
    },
    fireDocument,
    setHidden() {
      document.visibilityState = "hidden";
      fireDocument("visibilitychange");
    },
    setVisible() {
      document.visibilityState = "visible";
      fireDocument("visibilitychange");
    },
    key(data) {
      return fireDocument("keydown", {
        key: "", code: "", ctrlKey: false, metaKey: false, altKey: false,
        shiftKey: false, repeat: false, isComposing: false, ...data
      });
    },
    documentClick() { return fireDocument("click"); },
    storageEvent() {
      const e = { key: KEY, newValue: storage.has(KEY) ? storage.get(KEY) : null };
      for (const fn of windowEvents.get("storage") || []) fn(e);
    },
    pageShow() { for (const fn of windowEvents.get("pageshow") || []) fn({ type: "pageshow" }); },
    windowFocus() { for (const fn of windowEvents.get("focus") || []) fn({ type: "focus" }); },
    setFailWrites(value) { failWrites = !!value; },
    timeSec() { return T.getS().timeSec || 0; },
    rawState() { return storage.has(KEY) ? JSON.parse(storage.get(KEY)) : null; }
  };
}

function bootWithActivity(options = {}) {
  const b = browser(options);
  b.act();   // 明确的有效学习活动（真实页面可由点击/按键触发）
  return b;
}
/** 走 n 次采样回调，每次经过 stepMs；返回累计的待记毫秒（debug）。 */
function runTicks(b, n, stepMs = TICK_MS) {
  const tick = b.timer();
  for (let i = 0; i < n; i++) { b.advance(stepMs); tick(); }
  return b.debug().pendingMs;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (error) { failed++; console.log(`FAIL  ${name}: ${error.message}`); }
}

console.log(`== 0. 计时常量（取自真实实现）：tick=${TICK_MS}ms idle=${IDLE_MS}ms suspendGap=${SUSPEND_GAP_MS}ms persist=${PERSIST_MS}ms ==`);

await test("采样/闲置/休眠/落盘常量满足验收口径", () => {
  assert.ok(TICK_MS > 0 && TICK_MS <= 5000, `采样间隔应可接受，实际 ${TICK_MS}`);
  assert.ok(IDLE_MS >= 30000, `活动后有合理宽限，实际 ${IDLE_MS}`);
  assert.ok(SUSPEND_GAP_MS > IDLE_MS,
    `休眠判定阈值必须大于闲置宽限，否则 60s 单次采样会被误当休眠：${SUSPEND_GAP_MS} > ${IDLE_MS}`);
  assert.ok(PERSIST_MS >= 1000, `落盘阈值应大于 0，实际 ${PERSIST_MS}`);
  const b = browser();
  const dbg = b.debug();
  assert.equal(dbg.timeSec, 0);
  assert.equal(dbg.lastActivityAt, 0, "打开页面本身不是有效学习活动");
  assert.equal(dbg.studyActive, true, "默认停在背诵页且有当前词");
});

console.log("== 1. 无活动不累计（旧口径挂机也涨） ==");

await test("打开页面后 5 分钟不操作：累计保持 0", () => {
  const b = browser();
  runTicks(b, 300);
  assert.equal(b.timeSec(), 0, "无有效活动不得累计");
  assert.equal(b.debug().pendingMs, 0);
  assert.equal(b.storage.has(KEY), false, "没有学习变化时不应产生高频落盘");
});

await test("没有任何活动事件时 2 分钟不累计", () => {
  const b = browser();
  runTicks(b, 120);
  assert.equal(b.timeSec(), 0);
  assert.equal(b.debug().lastActivityAt, 0, "未收到活动事件前不计时");
});

console.log("== 2. 按实际经过时间计量，而不是回调次数 ==");

await test("推进 60 秒只跑 1 次采样回调：累计约 60 秒（不是固定 15 秒）", () => {
  const b = bootWithActivity();
  b.advance(60000);
  b.tick();                     // 全程只调用 1 次计时回调
  assert.equal(b.timeSec(), 60, "应按实际经过的 60 秒计量；旧口径按回调次数只会 +15");
  assert.equal(b.debug().pendingMs, 0, "满 30 秒后已落盘");
  assert.equal(b.rawState().timeSec, 60, "落盘值同样是实际经过时间");
});

await test("推进 60 秒跑 10 次回调（每次 6 秒）：累计仍是 60 秒", () => {
  const b = bootWithActivity();
  runTicks(b, 10, 6000);        // 10 次回调 × 实际 6 秒
  assert.equal(b.timeSec(), 60, "累计只取决于实际经过时间，不随回调次数变化");
});

await test("2 秒内 2 次回调与 2 秒内 1 次回调的累计一致", () => {
  const a = bootWithActivity();
  a.advance(2000); a.tick();
  const b = bootWithActivity();
  b.advance(1000); b.tick(); b.advance(1000); b.tick();
  assert.equal(a.debug().pendingMs, b.debug().pendingMs, "待记时长与实际经过时间一致");
  assert.equal(a.debug().pendingMs, 2000, "2 秒实际时长记为 2000ms");
});

await test("阅读宽限：活动后不操作也会继续累计，直到闲置阈值", () => {
  const b = bootWithActivity();
  runTicks(b, 30);
  assert.equal(b.timeSec(), 30, "活动后 30 秒阅读/回忆应计入");
  runTicks(b, 30);
  assert.equal(b.timeSec(), 60, "宽限内（共 60 秒）继续计入");
});

console.log("== 3. 连续回忆/作答/阅读累计 ==");

await test("连续作答/翻页持续累计，不因判定重置", () => {
  const b = bootWithActivity();
  b.T.judge(false);           // 作答（程序化调用也算有效活动）
  runTicks(b, 30);
  b.flush();
  assert.equal(b.timeSec(), 30);
  b.T.tryNext(true);          // 翻页
  runTicks(b, 30);
  b.flush();
  assert.equal(b.timeSec(), 60);
  b.T.judge(true);            // 继续作答
  runTicks(b, 10);
  b.flush();
  assert.equal(b.timeSec(), 70, "连续学习应持续累计，不因每次判定清零");
});

await test("真实 DOM 键盘/点击事件也会刷新活动时间", () => {
  const b = browser();
  b.key({ key: "j" });        // 键盘判定：document 捕获阶段记录活动
  assert.ok(b.debug().lastActivityAt > 0, "键盘操作应记录有效活动");
  runTicks(b, 10);
  b.flush();
  assert.equal(b.timeSec(), 10, "键盘操作后的实际时长应累计");
  b.documentClick();
  runTicks(b, 20);
  b.flush();
  assert.equal(b.timeSec(), 30, "点击活动后继续累计");
});

console.log("== 4. 闲置后暂停累计 ==");

await test("活动后闲置超过宽限：只计到宽限为止，不再增长", () => {
  const b = bootWithActivity();
  runTicks(b, 60);
  assert.equal(b.timeSec(), 60, "前 60 秒有活动宽限，应计入");
  runTicks(b, 120);            // 之后再无活动，2 分钟挂机
  assert.equal(b.timeSec(), 60, "闲置后不得继续累计（旧口径会一直涨）");
});

await test("无意义鼠标移动不能延长活动宽限；阅读滚动算活动", () => {
  const b = bootWithActivity();
  runTicks(b, 30);
  const activityBefore = b.debug().lastActivityAt;
  // 闲置耗尽的 40 秒里持续制造鼠标移动事件。
  for (let k = 0; k < 40; k++) {
    b.advance(1000);
    b.fireDocument("pointermove", { pointerType: "mouse", clientX: 10, clientY: 20 });
    b.fireDocument("mousemove", { clientX: 12, clientY: 22 });
    b.tick();
  }
  assert.equal(b.debug().lastActivityAt, activityBefore, "鼠标移动不得刷新有效活动时间");
  b.flush();
  assert.equal(b.timeSec(), 60, "鼠标移动不能延长宽限（活动 60 秒封顶）");
  // 阅读滚动是真实阅读活动：可以重新开始计时。
  b.advance(1000);
  b.fireDocument("scroll", {});
  b.tick();
  runTicks(b, 9);
  b.flush();
  assert.equal(b.timeSec(), 70, "滚动阅读活动应续时");
});

await test("重新活动后从新起点继续累计", () => {
  const b = bootWithActivity();
  runTicks(b, 60);
  runTicks(b, 60);             // 闲置耗尽宽限
  assert.equal(b.timeSec(), 60);
  b.act();                     // 用户重新操作
  runTicks(b, 20);
  b.flush();
  assert.equal(b.timeSec(), 80, "重新活动后继续累计");
});

console.log("== 5. 隐藏 / 恢复不补记 ==");

await test("切后台立即落盘，隐藏期间不累计", () => {
  const b = bootWithActivity();
  runTicks(b, 10);
  assert.equal(b.timeSec(), 0, "未满落盘阈值前留在 pending");
  assert.equal(b.debug().pendingMs, 10000);
  b.setHidden();
  assert.equal(b.timeSec(), 10, "隐藏时立即落盘已满整秒");
  assert.equal(b.rawState().timeSec, 10);
  b.advance(60000); b.tick();  // 后台 60 秒
  assert.equal(b.timeSec(), 10, "隐藏期间不累计");
  assert.equal(b.debug().pendingMs, 0);
});

await test("恢复后从恢复时刻重新开始计，不补记后台间隔", () => {
  const b = bootWithActivity();
  runTicks(b, 10);
  b.setHidden();
  b.advance(5 * 60000);
  for (let i = 0; i < 300; i++) b.tick();   // 后台回调被节流/迟到
  b.setVisible();
  assert.equal(b.timeSec(), 10, "恢复不得补记后台 5 分钟");
  b.advance(5000); b.tick();
  assert.equal(b.debug().pendingMs, 5000, "恢复后从新起点计，5 秒即 5 秒");
  assert.equal(b.timeSec(), 10, "未满落盘阈值仍留在 pending");
  runTicks(b, 25);              // 再 25 秒，待记满 30 秒自动落盘
  assert.equal(b.timeSec(), 40, "恢复后的累计按实际经过时间写入");
});

await test("pageshow / focus 恢复同样不补记整段间隔", () => {
  const b = bootWithActivity();
  runTicks(b, 10);
  b.setHidden();
  b.advance(3600000);
  b.setVisible();               // 真实顺序：先 visibilitychange(visible) 再 pageshow
  b.pageShow();
  assert.equal(b.timeSec(), 10, "pageshow 不补记休眠整段");
  b.advance(3000); b.tick();
  assert.equal(b.debug().pendingMs, 3000, "恢复后只计新经过的 3 秒");
  b.flush();
  assert.equal(b.timeSec(), 13);
  b.windowFocus();
  b.advance(2000); b.tick();
  assert.equal(b.debug().pendingMs, 2000, "focus 重置基线后只计新经过的 2 秒");
});

console.log("== 6. 长时间休眠 / 长跳变不补记整段 ==");

await test("2 小时休眠后单次回调：0 秒，不补记整段", () => {
  const b = bootWithActivity();
  b.advance(2 * 3600000);
  b.tick();                     // 单次采样间隔超过休眠阈值
  assert.equal(b.timeSec(), 0);
  assert.equal(b.debug().pendingMs, 0, "休眠跳变整段不补记");
  b.advance(1000); b.tick();
  assert.equal(b.debug().pendingMs, 0, "旧活动已过期，后续空转也不累计");
  b.act();                      // 用户回来操作
  b.advance(5000); b.tick();
  assert.equal(b.debug().pendingMs, 5000, "重新活动后正常计量");
});

await test("休眠期间即使多次回调也不补记", () => {
  const b = bootWithActivity();
  for (let i = 0; i < 40; i++) { b.advance(SUSPEND_GAP_MS + 60000); b.tick(); }  // 每次间隔都超过休眠阈值
  assert.equal(b.timeSec(), 0, "活动过期后的空转不累计");
});

console.log("== 7. 跨天只累计总量，不清零 ==");

await test("跨午夜继续累计，不重置已有总时长", () => {
  const b = bootWithActivity();
  b.advance(12 * 3600000 - 30000);      // 从 12:00 推进到 23:59:30
  b.tick();                             // 先结算这次长跳变（按休眠不补记）
  const beforeDay = today(b.now);
  b.act();
  runTicks(b, 60);                       // 跨过午夜 60 秒
  assert.notEqual(today(b.now), beforeDay, "时钟确实跨天");
  b.flush();
  assert.equal(b.timeSec(), 60, "跨天累计总量继续增长，不清零");
  // 跨天轮询只刷新额度，不得重置学习时长。
  const poll = b.intervals.find(t => t.ms === 60000);
  if (poll) poll.fn();
  assert.equal(b.timeSec(), 60, "跨天恢复入口不重置累计时长");
  b.act();
  runTicks(b, 10);
  b.flush();
  assert.equal(b.timeSec(), 70, "跨天后新一天继续累计到同一总量");
});

console.log("== 8. 多标签重叠不重复累计 ==");

await test("两个前台标签重叠 60 秒：总时长约 60 秒而不是 120 秒", () => {
  const shared = new Map();
  const a = bootWithActivity({ sharedStorage: shared });
  const b = bootWithActivity({ sharedStorage: shared });
  const tickA = a.timer(), tickB = b.timer();
  for (let i = 0; i < 60; i++) {
    a.advance(TICK_MS); tickA();
    b.advance(TICK_MS); tickB();
  }
  const raw = a.rawState();
  assert.ok(raw && Number.isInteger(raw.timeSec), "应落盘总时长");
  assert.ok(raw.timeSec >= 59 && raw.timeSec <= 61,
    `重叠时段只应计一次，实际落盘 ${raw.timeSec} 秒（若重复累计会接近 120）`);
  assert.equal(a.timeSec(), raw.timeSec, "标签 A 内存与存储一致");
  assert.equal(b.timeSec(), raw.timeSec, "标签 B 以存储为准，不重复累计");
});

await test("另一标签的计时保存不覆盖新判定", () => {
  const shared = new Map();
  const a = browser({ sharedStorage: shared });
  const b = browser({ sharedStorage: shared });
  const i = a.T.cur;
  a.T.judge(true);                       // A 写入新判定
  const judgedProgress = clone(a.T.getS().progress[i]);
  b.act();
  const tickB = b.timer();
  for (let k = 0; k < 40; k++) { b.advance(TICK_MS); tickB(); }  // B 累计并尝试落盘
  const raw = b.rawState();
  assert.equal(JSON.stringify(raw.progress[i]), JSON.stringify(judgedProgress),
    "B 的计时落盘不得覆盖 A 的新判定");
  assert.equal(raw.timeSec || 0, 0, "内容不一致时 B 宁可不写时长");
  b.storageEvent();                      // 模拟 storage 事件送达
  // vm 上下文的数组跨 realm，用序列化比较（AGENTS.md 同款做法）。
  assert.equal(JSON.stringify(b.T.getS().progress[i]), JSON.stringify(judgedProgress),
    "B 收到事件后同步 A 的判定");
});

console.log("== 9. 保存失败不清零已有累计 ==");

await test("落盘失败：内存保留新增时长，已保存值不被清零，恢复后补写", () => {
  const b = browser({ initial: {
    settings: { dailyNew: 20 }, progress: {}, days: {}, stars: {}, proficient: {},
    timeSec: 120, dv: 1
  }});
  assert.equal(b.timeSec(), 120, "读取已有累计值");
  b.setFailWrites(true);
  b.act();
  runTicks(b, 30);                       // 触发自动落盘并失败
  assert.equal(b.timeSec(), 150, "保存失败后内存中的累计仍保留本次 30 秒");
  assert.equal(b.rawState().timeSec, 120, "已有落盘值不得被清零或写坏");
  assert.match(b.T.getStorageAlert(), /保存失败|存储/, "应持续提示保存失败");
  b.setFailWrites(false);
  b.act();
  runTicks(b, 30);                       // 恢复后再次落盘
  assert.equal(b.rawState().timeSec, 180, "存储恢复后把新时长写回");
  assert.equal(b.timeSec(), 180);
});

console.log("== 10. 旧记录兼容：缺字段不清零累计 ==");

await test("旧记录只有 timeSec 字段：累计值保留并继续累加", () => {
  const b = browser({ initial: { progress: {}, days: {}, timeSec: 120 } });
  assert.equal(b.timeSec(), 120, "旧记录累计值必须保留");
  b.act();
  runTicks(b, 10);
  b.flush();
  assert.equal(b.timeSec(), 130, "旧记录继续累计，不清零");
  assert.equal(b.rawState().timeSec, 130);
});

await test("normalizeState 对缺 timeSec / 旧结构的记录不清零、不报错", () => {
  const b = browser();
  assert.equal(b.T.normalizeState({ progress: {}, days: {}, timeSec: 120 }).timeSec, 120);
  assert.equal(b.T.normalizeState({ progress: {}, days: {} }).timeSec, 0, "确实缺失时才从 0 开始");
  assert.equal(b.T.normalizeState({ progress: {}, days: {}, timeSec: "bad" }).timeSec, 0);
  const legacy = { settings: { dailyNew: 20 }, progress: {}, days: {}, stars: {}, proficient: {}, timeSec: 345 };
  assert.equal(b.T.normalizeState(legacy).timeSec, 345);
});

await test("60 秒学习只落盘 2 次（满 30 秒阈值），不逐秒写存储", () => {
  const b = bootWithActivity();
  runTicks(b, 60);
  const writes = b.writeLog.filter(k => k === KEY).length;
  assert.ok(writes >= 2 && writes <= 3,
    `60 秒内应只在累计满 30 秒时落盘（2 次左右），实际 ${writes} 次`);
});

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
