/**
 * 13 离线/更新状态与备份状态回归。
 * 执行真实 js/app.js（vm 沙箱 + DOM 桩 + 假 navigator.serviceWorker 事件流），
 * 不启动真实浏览器：真实安装/断网/更新等待的浏览器行为由 QA 记录（本文件不伪造）。
 * 覆盖：file:// 说明且不注册、不支持 SW、准备中→首装缓存就绪（未受控）、受控=已可离线、
 * 更新等待（含 updatefound/statechange/focus 重查）、注册失败+重试、无自动刷新/无强制升级；
 * 备份状态：未导出/上次导出时间戳/只读导出/损坏时间戳容错/超过 30 天提醒/不显示「已安全备份」。
 * 运行：node --max-old-space-size=512 js/test-pwa-status.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appSource = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const words = fs.readFileSync(path.join(ROOT, "js/words-data.js"), "utf8");
const LAST_EXPORT_KEY = "vocab_last_export_v1";
const STATE_KEY = "kaoyan_vocab_v1";
const nowMs = () => Date.now();

/* ---------------- DOM 桩（事件冒泡到 document/window，节点按选择器自动创建） ---------------- */
function mkEl(tag = "div") {
  const events = new Map();
  const classes = new Set();
  const el = {
    tagName: tag.toUpperCase(), _h: "", style: {}, dataset: {}, value: "", checked: false,
    textContent: "", hidden: false, disabled: false, files: [], scrollTop: 0, clientHeight: 600,
    clientWidth: 300, offsetWidth: 240, offsetHeight: 120, onclick: null, onchange: null, onerror: null,
    parentNode: null, children: [], _attrs: {}, _events: events,
    classList: {
      add(...a) { a.forEach(x => classes.add(x)); },
      remove(...a) { a.forEach(x => classes.delete(x)); },
      toggle(c, f) { if (f === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (f) classes.add(c); else classes.delete(c); },
      contains(c) { return classes.has(c); }
    },
    addEventListener(type, fn) { if (!events.has(type)) events.set(type, []); events.get(type).push(fn); },
    removeEventListener() {},
    appendChild(child) { el.children.push(child); if (child) child.parentNode = el; return child; },
    remove() { if (el.parentNode) el.parentNode.children = el.parentNode.children.filter(x => x !== el); },
    setAttribute(k, v) { el._attrs[k] = String(v); if (k.startsWith("data-")) el.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v); },
    removeAttribute(k) { delete el._attrs[k]; },
    getAttribute(k) {
      if (Object.prototype.hasOwnProperty.call(el._attrs, k)) return el._attrs[k];
      const dk = k.startsWith("data-") ? k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : null;
      return dk && el.dataset[dk] !== undefined ? String(el.dataset[dk]) : null;
    },
    closest() { return null; },
    contains(node) { let n = node; while (n) { if (n === el) return true; n = n.parentNode; } return false; },
    querySelector() { return mkEl(); },
    querySelectorAll() { return []; },
    focus() { if (doc) doc.activeElement = el; },
    blur() {},
    click() { fireClick(el); },
    getBoundingClientRect() { return { left: 10, top: 10, right: 250, bottom: 130, width: 240, height: 120 }; },
    getClientRects() { return [{ width: 240, height: 120 }]; }
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return el._h; },
    set(v) { el._h = String(v); }
  });
  return el;
}

/** 让 el 的 click 冒泡到父节点（document 桩只在这里挂 click 监听）。 */
function fireClick(target) {
  const ev = { type: "click", target, detail: 1, preventDefault() {}, stopPropagation() {} };
  let node = target;
  while (node) {
    if (typeof node.onclick === "function") node.onclick(ev);
    for (const fn of node._events?.get?.("click") || []) fn(ev);
    node = node.parentNode;
  }
  return ev;
}

function browser({ storage = new Map(), protocol = "https:", serviceWorker = null } = {}) {
  const registry = new Map();
  const docHandlers = new Map();
  const winHandlers = new Map();
  let doc;
  const bodyEl = mkEl("body");
  /** 真实 index.html 里初始 hidden 的节点（DOM 桩未解析 HTML，这里按 id 还原初始态）。 */
  const HIDDEN_BY_DEFAULT = /^(#appAlert|#helpSheet|#guideSheet|#bookSheet|#wordSheet|#printSheet|#txtSplitSheet|#importSheet|#guideBanner|#offlineRetry|#capPause|#groupFooter|#backlogNotice|#extraNewRow|#profFeedback|#autoResume|#planPendingNotice|#listEmpty|#exPop)$/;
  const document = {
    querySelector(sel) {
      if (!registry.has(sel)) {
        const el = mkEl(/input|Range|rate/.test(sel) ? "input" : sel.includes("button") ? "button" : "div");
        if (HIDDEN_BY_DEFAULT.test(sel)) el.hidden = true;
        registry.set(sel, el);
      }
      return registry.get(sel);
    },
    querySelectorAll: () => [],
    addEventListener(type, fn) { if (!docHandlers.has(type)) docHandlers.set(type, []); docHandlers.get(type).push(fn); },
    removeEventListener() {},
    createElement: t => mkEl(t),
    documentElement: { dataset: {}, style: {} },
    visibilityState: "visible",
    activeElement: bodyEl,
    body: bodyEl
  };
  doc = document;
  const intervals = [];
  const windowObj = {
    document,
    addEventListener(type, fn) { if (!winHandlers.has(type)) winHandlers.set(type, []); winHandlers.get(type).push(fn); },
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    innerWidth: 1200, innerHeight: 800,
    getComputedStyle: () => ({ fontSize: "32px" }),
    requestAnimationFrame: fn => { fn(); return 0; }, cancelAnimationFrame() {},
    speechSynthesis: { getVoices: () => [], cancel() {}, speak() {}, addEventListener() {} }
  };
  const location = { protocol, href: "https://vocab.test/" };
  let reloadCount = 0;
  let registerCalls = 0;
  const navigator = {};
  if (serviceWorker) {
    navigator.serviceWorker = serviceWorker;
    serviceWorker.register = (...args) => { registerCalls++; return serviceWorker._register ? serviceWorker._register(...args) : Promise.resolve(null); };
  }
  const localStorage = {
    getItem: k => storage.has(k) ? storage.get(k) : null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k)
  };
  location.reload = () => { reloadCount++; };
  const context = vm.createContext({
    window: windowObj, document, location, navigator, localStorage, console, Date,
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; }, clearInterval() {},
    setTimeout() { return 0; }, clearTimeout() {},
    requestAnimationFrame(fn) { fn(); }, cancelAnimationFrame() {},
    confirm: () => true, Blob: class {}, URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    FileReader: class {}, performance: { now: () => Date.now() }
  });
  vm.runInContext(words, context, { filename: "words-data.js" });
  vm.runInContext(appSource, context, { filename: "app.js" });
  const T = windowObj.__vocab;
  assert.ok(T, "app.js 应提供 window.__vocab 测试入口");
  return {
    T, document, window: windowObj, storage, intervals, location, navigator,
    get query() { return s => document.querySelector(s); },
    getOffline: () => T.getOfflineStatus(),
    getBackup: () => T.getBackupStatus(),
    get reloadCount() { return reloadCount; },
    get registerCalls() { return registerCalls; },
    fireWindow(type) { for (const fn of winHandlers.get(type) || []) fn({ type }); },
    fireDoc(type) { for (const fn of docHandlers.get(type) || []) fn({ type, target: bodyEl, preventDefault() {}, stopPropagation() {} }); },
    text(sel) { const el = document.querySelector(sel); return el ? el.textContent : null; },
    visible(sel) { const el = document.querySelector(sel); return el ? el.hidden === false : false; }
  };
}

/* ---------------- 假 Service Worker / 注册 / worker ---------------- */
function makeWorker(state = "installing") {
  const listeners = new Map();
  const worker = {
    state,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    setState(next) { worker.state = next; for (const fn of listeners.get("statechange") || []) fn({ type: "statechange", target: worker }); }
  };
  return worker;
}
function makeRegistration({ installing = null, waiting = null, active = null } = {}) {
  const listeners = new Map();
  return {
    installing, waiting, active,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    fireUpdateFound() { for (const fn of listeners.get("updatefound") || []) fn({ type: "updatefound" }); }
  };
}
/** 假 navigator.serviceWorker：ready 由测试显式 resolve；controller 可读写。 */
function makeServiceWorker({ controller = null, ready = "pending" } = {}) {
  const sw = {
    controller,
    registerImpl: null,
    initCalls: [],
    ready: null,
    resolveReady: null,
    addEventListener() {},
    postMessage() { throw new Error("测试期内不应主动给 SW 发消息（尤其 SKIP_WAITING）"); }
  };
  sw._register = () => (sw.registerImpl ? sw.registerImpl() : Promise.resolve(makeRegistration()));
  if (ready === "pending") {
    sw.ready = new Promise(resolve => { sw.resolveReady = resolve; });
  } else {
    sw.ready = Promise.resolve();
  }
  return sw;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("PASS  " + name); }
  catch (e) { failed++; console.error("FAIL  " + name + ": " + (e && e.stack || e)); }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
async function settle(n = 3) { for (let i = 0; i < n; i++) await flush(); }

// ===========================================================================
// A. 状态机
// ===========================================================================
await test("file:// 模式：不注册 SW，显示适合双击打开方式的说明", async () => {
  const sw = makeServiceWorker();
  let registerResolve = null;
  sw.registerImpl = () => new Promise(resolve => { registerResolve = resolve; });
  const b = browser({ protocol: "file:", serviceWorker: sw });
  await settle();
  const st = b.getOffline();
  assert.equal(st.file, true, "识别 file:// 模式");
  assert.equal(st.status, "file");
  assert.equal(b.registerCalls, 0, "file:// 不得注册 Service Worker");
  assert.ok(st.text.includes("双击") || st.text.includes("本地文件"), "说明直接双击打开的限制：" + st.text);
  assert.ok(st.text.includes("本地静态服务"), "给出可行的替代方式");
  assert.ok(!st.text.includes("已可离线"), "file:// 不得声称已可离线");
  assert.equal(b.query("#offlineRetry").hidden, true, "file:// 不显示重试");
  assert.equal(b.query("#offlineStatus").dataset.state, "file");
});

await test("浏览器不支持 Service Worker：说明能力边界，不注册、不报错", async () => {
  const b = browser();   // navigator 无 serviceWorker
  await settle();
  const st = b.getOffline();
  assert.equal(st.supported, false);
  assert.equal(st.status, "unsupported");
  assert.ok(st.text.includes("不支持离线缓存"));
  assert.equal(b.registerCalls, 0);
  assert.equal(b.query("#offlineRetry").hidden, true);
});

await test("注册中：显示「资源准备中」，注册成功本身不等于已离线", async () => {
  const sw = makeServiceWorker();
  let resolveReg = null;
  sw.registerImpl = () => new Promise(resolve => { resolveReg = resolve; });
  const b = browser({ serviceWorker: sw });
  await settle();
  let st = b.getOffline();
  assert.equal(st.status, "registering", "注册 promise 未完成前是准备中");
  assert.ok(st.text.includes("资源准备中"), st.text);
  assert.equal(b.registerCalls, 1);
  // 注册成功、安装中：仍未就绪
  const worker = makeWorker("installing");
  const reg = makeRegistration({ installing: worker });
  resolveReg(reg);
  await settle();
  st = b.getOffline();
  assert.equal(st.status, "installing", "安装未完成不得称已离线");
  assert.ok(st.text.includes("正在缓存"), st.text);
  assert.ok(!st.text.includes("已可离线"));
});

await test("首次安装完成但页面未受缓存控制：文案区分「缓存已就绪、重开页面由缓存提供」", async () => {
  const sw = makeServiceWorker();
  const worker = makeWorker("installing");
  const reg = makeRegistration({ installing: worker });
  sw.registerImpl = () => Promise.resolve(reg);
  const b = browser({ serviceWorker: sw });
  await settle();
  assert.equal(b.getOffline().status, "installing");
  worker.setState("installed");
  await settle();
  const st = b.getOffline();
  assert.equal(st.controlled, false, "首装后当前页面尚未受控制");
  assert.equal(st.status, "ready-uncontrolled");
  assert.ok(st.text.includes("重新打开"), "提示重开页面后由缓存提供：" + st.text);
  assert.ok(st.text.includes("尚未受缓存控制"), "不把缓存就绪说成已可离线");
  assert.ok(!st.text.includes("已可离线："), "不得显示「已可离线：当前页面已由缓存提供」");
  assert.equal(b.query("#offlineBadge").textContent, "缓存已就绪");
});

await test("当前页面已受缓存控制：显示已可离线（断网可打开）", async () => {
  const sw = makeServiceWorker({ controller: {} });
  const worker = makeWorker("activated");
  const reg = makeRegistration({ active: worker });
  sw.registerImpl = () => Promise.resolve(reg);
  const b = browser({ serviceWorker: sw });
  sw.resolveReady();
  await settle();
  const st = b.getOffline();
  assert.equal(st.controlled, true);
  assert.equal(st.status, "ready");
  assert.ok(st.text.includes("已可离线"), st.text);
  assert.ok(st.text.includes("断网"), st.text);
  assert.equal(b.query("#offlineBadge").textContent, "已可离线");
  assert.equal(b.query("#offlineRetry").hidden, true);
});

await test("更新已下载等待旧页面关闭：显示等待启用，不自动刷新、不发 SKIP_WAITING", async () => {
  const sw = makeServiceWorker({ controller: {} });
  const worker = makeWorker("activated");
  const waiting = makeWorker("installed");
  const reg = makeRegistration({ active: worker, waiting });
  sw.registerImpl = () => Promise.resolve(reg);
  const b = browser({ serviceWorker: sw });
  sw.resolveReady();
  await settle();
  const st = b.getOffline();
  assert.equal(st.waiting, true);
  assert.equal(st.status, "update-waiting");
  assert.ok(st.text.includes("等待所有旧页面关闭"), st.text);
  assert.ok(st.text.includes("不会自动刷新"), "明确不会自动刷新：" + st.text);
  assert.equal(b.query("#offlineBadge").textContent, "更新等待启用");
  assert.equal(b.reloadCount, 0, "不得 location.reload");
  assert.equal(b.visible("#helpSheet"), false, "不得弹强制升级浮层");
});

await test("updatefound / statechange：新版本安装完成进入等待；下载中当前版本仍可离线", async () => {
  const sw = makeServiceWorker({ controller: {} });
  const activeWorker = makeWorker("activated");
  const reg = makeRegistration({ active: activeWorker });
  sw.registerImpl = () => Promise.resolve(reg);
  const b = browser({ serviceWorker: sw });
  sw.resolveReady();
  await settle();
  assert.equal(b.getOffline().status, "ready");
  // 新版本开始安装：当前版本仍可离线，不把正在下载的更新说成已启用
  const next = makeWorker("installing");
  reg.installing = next;
  reg.fireUpdateFound();
  await settle();
  let st = b.getOffline();
  assert.equal(st.status, "ready", "安装新版本期间当前版本仍可离线");
  assert.ok(st.text.includes("已可离线"), st.text);
  assert.ok(!st.text.includes("更新已下载"), "下载中不得说更新已下载");
  // 安装完成 → 进入 waiting：这时才提示更新等待旧页面关闭
  reg.installing = null;
  reg.waiting = next;
  next.setState("installed");
  await settle();
  st = b.getOffline();
  assert.equal(st.status, "update-waiting", "安装完成后等待旧页面关闭");
  assert.ok(st.text.includes("等待所有旧页面关闭"), st.text);
});

await test("页面重新聚焦时按真实注册对象重查（旧页面关闭后状态会变化）", async () => {
  const sw = makeServiceWorker({ controller: {} });
  const reg = makeRegistration({ active: makeWorker("activated") });
  sw.registerImpl = () => Promise.resolve(reg);
  const b = browser({ serviceWorker: sw });
  sw.resolveReady();
  await settle();
  assert.equal(b.getOffline().status, "ready");
  reg.waiting = makeWorker("installed");
  b.fireWindow("focus");
  await settle();
  assert.equal(b.getOffline().status, "update-waiting", "focus 后重新读取 waiting");
  b.fireDoc("visibilitychange");
  await settle();
  assert.equal(b.getOffline().status, "update-waiting", "可见性恢复同样重查");
});

await test("注册失败：显示失败原因与重试；重试成功后恢复就绪", async () => {
  const sw = makeServiceWorker({ controller: {} });
  let attempt = 0;
  sw.registerImpl = () => {
    attempt++;
    if (attempt === 1) return Promise.reject(new Error("install failed"));
    return Promise.resolve(makeRegistration({ active: makeWorker("activated") }));
  };
  const b = browser({ serviceWorker: sw });
  await settle();
  let st = b.getOffline();
  assert.equal(st.status, "failed", "注册失败状态");
  assert.ok(st.text.includes("离线准备失败"), st.text);
  assert.ok(st.text.includes("install failed"), "如实展示失败原因：" + st.text);
  assert.equal(b.query("#offlineRetry").hidden, false, "失败时显示重试");
  assert.equal(b.query("#offlineStatus").dataset.state, "failed");
  b.query("#offlineRetry").click();
  await settle();
  sw.resolveReady();
  await settle();
  st = b.getOffline();
  assert.equal(b.registerCalls, 2, "重试重新注册一次");
  assert.equal(st.status, "ready", "重试成功后恢复就绪");
  assert.equal(b.query("#offlineRetry").hidden, true);
  assert.equal(b.reloadCount, 0, "重试不刷新页面");
});

await test("离线状态不打断学习：不重建当前卡、不弹持久错误提示", async () => {
  const sw = makeServiceWorker();
  let resolveReg;
  sw.registerImpl = () => new Promise(resolve => { resolveReg = resolve; });
  const b = browser({ serviceWorker: sw });
  const S = b.T.getS();
  Object.assign(S.settings, { order: "freq", dailyNew: 20, fmin: 1, fmax: 0, pmin: 0 });
  b.T.startSession();
  const cur = b.T.cur, qi = b.T.qi;
  resolveReg(makeRegistration({ installing: makeWorker("installing") }));
  await settle();
  assert.equal(b.T.cur, cur, "离线状态变化不影响当前卡");
  assert.equal(b.T.qi, qi);
  assert.equal(b.query("#appAlert").hidden, true, "离线状态不是持久错误提示");
});

// ===========================================================================
// B. 备份状态
// ===========================================================================
await test("备份状态初始：只保存在当前浏览器、尚未导出，不显示「已安全备份」", async () => {
  const b = browser();
  b.T.show("stats");
  const status = b.getBackup();
  assert.equal(status.key, LAST_EXPORT_KEY, "上次导出使用独立键");
  assert.equal(status.exists, false);
  const text = b.text("#backupStatus");
  assert.ok(text.includes("只保存在当前浏览器"), text);
  assert.ok(text.includes("尚未导出"), text);
  assert.ok(!text.includes("已安全备份"), "下载/保存不等于已安全备份");
});

await test("有学习记录但从未导出：低打扰提醒建议导出，不打断操作", async () => {
  const b = browser();
  b.T.judge(true);
  b.T.show("stats");
  const text = b.text("#backupStatus");
  assert.ok(text.includes("尚未导出"), text);
  assert.ok(text.includes("建议") && text.includes("备份"), "提示建议导出：" + text);
  assert.equal(b.query("#appAlert").hidden, true, "统计页提醒不是持续错误提示");
  assert.equal(b.query("#toast").textContent.includes("备份"), false, "不额外弹 toast 打扰");
});

await test("导出进度：记录上次导出时间、展示下载不代表妥善保管、学习记录只读不变", async () => {
  const b = browser();
  b.T.judge(true);
  b.T.show("stats");
  const before = JSON.stringify(b.T.getS());
  b.query("#exp").click();
  const backup = b.getBackup();
  assert.equal(backup.exists, true, "导出后记录时间");
  assert.ok(backup.at && !Number.isNaN(Date.parse(backup.at)), "记录 ISO 时间：" + backup.at);
  assert.equal(backup.version, 3, "记录备份版本 v3");
  const text = b.text("#backupStatus");
  assert.ok(text.includes("上次导出"), text);
  assert.ok(text.includes("下载已发起") && text.includes("请确认文件已妥善保存"), "如实说明下载触发不等于已保管：" + text);
  assert.ok(!text.includes("已安全备份"), "不得显示已安全备份");
  assert.equal(JSON.stringify(b.T.getS()), before, "导出只读：内存学习记录不变");
  const stateRaw = b.storage.get(STATE_KEY) || "";
  assert.ok(!stateRaw.includes(LAST_EXPORT_KEY), "上次导出键不进每书学习记录");
  assert.ok(!JSON.stringify(b.T.buildExport()).includes(LAST_EXPORT_KEY), "上次导出键不进备份 v3");
  assert.equal(JSON.parse(b.storage.get(LAST_EXPORT_KEY)).version, 3);
});

await test("损坏的上次导出时间戳：安全降级为「尚未导出」，不抛错", () => {
  const storage = new Map([[LAST_EXPORT_KEY, "{not-json"]]);
  const b = browser({ storage });
  assert.doesNotThrow(() => b.T.show("stats"));
  const status = b.getBackup();
  assert.equal(status.exists, false, "损坏时间戳视为无记录");
  assert.ok(b.text("#backupStatus").includes("尚未导出"));
});

await test("超过 30 天未导出：提醒再次导出（下载触发仍不代表已妥善保管）", () => {
  const b = browser();
  b.T.judge(true);
  b.storage.set(LAST_EXPORT_KEY, JSON.stringify({ at: new Date(nowMs() - 31 * 86400000).toISOString(), version: 3 }));
  b.T.renderBackupStatus();
  const text = b.text("#backupStatus");
  assert.ok(text.includes("上次导出"), text);
  assert.ok(text.includes("超过 30 天"), "超过 30 天给出提醒：" + text);
  assert.ok(text.includes("建议") && text.includes("备份"));
  assert.ok(!text.includes("已安全备份"));
});

await test("静态契约：只有正常导出记录时间，救援导出不冒充备份完成；无自动刷新/强制升级", () => {
  const exportFn = appSource.match(/function exportBackupFile\(\)\{[\s\S]*?\n  \}/)?.[0] || "";
  const rescueFn = appSource.match(/function exportRescueBackup\(\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(exportFn, /recordLastExport\(data\)/, "常规导出成功后才记录时间");
  assert.doesNotMatch(rescueFn, /recordLastExport/, "救援导出不写「上次导出备份」时间");
  assert.doesNotMatch(appSource, /location\.reload\s*\(/, "不得自动刷新页面");
  assert.doesNotMatch(appSource, /postMessage\s*\([\s\S]{0,80}SKIP_WAITING/, "不得自动跳过等待");
});

// ===========================================================================
// C. 设置页与静态结构
// ===========================================================================
await test("设置页新增「离线与帮助」分区：状态文本、重试、引导重开入口齐全", () => {
  assert.match(html, /id="settings-offline"/, "index.html 含离线与帮助分区");
  assert.match(html, /href="#settings-offline"/, "设置导航含对应入口");
  assert.match(html, /id="offlineStatus"[^>]*role="status"/, "离线状态是 role=status（可播报）");
  assert.match(html, /id="offlineRetry"[^>]*hidden/, "重试默认隐藏");
  assert.match(html, /id="btnReplayGuide"/, "设置页可再次打开使用说明");
  assert.match(html, /id="backupStatus"/, "统计页备份状态节点");
  assert.doesNotMatch(appSource, /current = "settings-rhythm"/, "设置导航不再写死最后一个分区");
});

await test("调试钩子：离线状态只读副本，重试是显式入口", async () => {
  const sw = makeServiceWorker({ controller: {} });
  sw.registerImpl = () => Promise.resolve(makeRegistration({ active: makeWorker("activated") }));
  const b = browser({ serviceWorker: sw });
  sw.resolveReady();
  await settle();
  const a = b.getOffline(), c = b.getOffline();
  assert.notEqual(a, c, "返回副本而非内部状态");
  a.status = "hacked";
  assert.notEqual(b.getOffline().status, "hacked", "外部修改不影响内部状态");
  assert.equal(typeof b.T.retryOffline, "function");
});

console.log(`\n13 离线/更新/备份状态：${passed} 通过，${failed} 失败`);
process.exitCode = failed ? 1 : 0;
