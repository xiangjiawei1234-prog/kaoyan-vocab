#!/usr/bin/env node
/**
 * 真实浏览器验证驱动（无依赖，仅用 Node 内置模块 + 全局 WebSocket/fetch）。
 *
 * 为什么手写 CDP：仓库没有包管理器，禁止引入 Playwright/Puppeteer 等依赖。
 * 本文件直接启动本机 Google Chrome 的 headless 模式，用 WebSocket 讲 DevTools 协议，
 * 驱动真实鼠标/键盘事件、真实布局几何、真实截图与 console 错误采集。
 *
 * 用法（作为库）：
 *   import { startStaticServer, launchChrome, connect, Page, createRecorder } from "./cdp.mjs";
 *
 * 自检（验证本机 Chrome + 驱动可用）：
 *   node tests/browser/cdp.mjs --selftest
 *
 * 产物目录：
 *   tests/reports/qa/shots/    PNG 截图（gitignore 内，不入库）
 *   tests/reports/qa/results/  JSON 结果（gitignore 内，不入库）
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const QA_DIR = path.resolve(SOURCE_DIR, "..", "reports", "browser");
export const REPO_ROOT = path.resolve(SOURCE_DIR, "..", "..");
export const SHOTS_DIR = path.join(QA_DIR, "shots");
export const RESULTS_DIR = path.join(QA_DIR, "results");

const CHROME_PATH =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("超时 " + ms + "ms：" + (label || ""))), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/* ------------------------------------------------------------------ *
 * 最小静态服务器（127.0.0.1 + 随机端口）
 * 用 127.0.0.1 而非 file:// 才能验证 Service Worker 场景；
 * /favicon.ico 返回 204，避免无关 404 污染 console 错误采集。
 * ------------------------------------------------------------------ */
export async function startStaticServer({ root = REPO_ROOT, log = false } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let pathname = "/";
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    } catch {
      res.writeHead(400).end("bad request");
      return;
    }
    if (pathname === "/favicon.ico") {
      requests.push({ path: pathname, status: 204 });
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return;
    }
    let filePath = path.normalize(path.join(root, pathname));
    if (!filePath.startsWith(root)) {
      requests.push({ path: pathname, status: 403 });
      res.writeHead(403).end("forbidden");
      return;
    }
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
    } catch {
      requests.push({ path: pathname, status: 404 });
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
      return;
    }
    fs.readFile(filePath, (err, buf) => {
      if (err) {
        requests.push({ path: pathname, status: 404 });
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
        return;
      }
      requests.push({ path: pathname, status: 200 });
      if (log) console.error("[static]", pathname, buf.length);
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "Content-Length": buf.length,
        // 每次验证都读最新文件；Service Worker 缓存由浏览器侧负责（每轮全新 profile）。
        "Cache-Control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : buf);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  const origin = "http://127.0.0.1:" + port;
  return {
    origin,
    port,
    requests,
    url(p = "/index.html") {
      return origin + (p.startsWith("/") ? p : "/" + p);
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/* ------------------------------------------------------------------ *
 * Chrome 启动与 CDP 连接
 * ------------------------------------------------------------------ */
async function readDevToolsActivePort(profileDir, timeoutMs = 25000) {
  const portFile = path.join(profileDir, "DevToolsActivePort");
  const start = Date.now();
  for (;;) {
    try {
      const text = fs.readFileSync(portFile, "utf8");
      const lines = text.split("\n").filter(Boolean);
      if (lines.length >= 2) {
        const port = Number(lines[0].trim());
        const browserPath = lines[1].trim();
        return { port, wsUrl: "ws://127.0.0.1:" + port + browserPath };
      }
    } catch {
      /* 文件尚未生成 */
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error("等待 Chrome DevToolsActivePort 超时（" + timeoutMs + "ms）");
    }
    await sleep(60);
  }
}

export async function launchChrome({
  profileDir,
  headless = true,
  windowSize = "480,900",
  extraArgs = [],
} = {}) {
  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error("找不到 Chrome：" + CHROME_PATH + "（可用 CHROME_PATH 环境变量指定）");
  }
  const dir = profileDir || path.join(QA_DIR, "tmp-profile-" + process.pid + "-" + Date.now());
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const args = [
    ...(headless ? ["--headless=new"] : []),
    "--remote-debugging-port=0",
    "--user-data-dir=" + dir,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-extensions",
    "--mute-audio",
    "--metrics-recording-only",
    "--window-size=" + windowSize,
    ...extraArgs,
    "about:blank",
  ];
  const child = spawn(CHROME_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (buf) => {
    stderr += buf.toString();
  });
  child.stdout.on("data", () => {});

  let exited = null;
  child.once("exit", (code, signal) => {
    exited = { code, signal };
  });

  const { port, wsUrl } = await (async () => {
    try {
      return await readDevToolsActivePort(dir);
    } catch (err) {
      // 退路：解析 stderr 的 “DevTools listening on ws://…”
      const start = Date.now();
      for (;;) {
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          return { port: Number(new URL(match[1]).port), wsUrl: match[1] };
        }
        if (Date.now() - start > 8000) {
          throw new Error(
            "Chrome 未能启动 CDP。stderr 末尾：" + stderr.slice(-2000) + " / " + err.message
          );
        }
        await sleep(100);
      }
    }
  })();

  const handle = {
    port,
    wsUrl,
    profileDir: dir,
    child,
    get stderr() {
      return stderr;
    },
    get exited() {
      return exited;
    },
    async close({ removeProfile = true } = {}) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      const start = Date.now();
      while (!exited && Date.now() - start < 3000) await sleep(50);
      if (!exited) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        await sleep(150);
      }
      // Chrome's detached crash reporter/updater can inherit these pipe writers.
      // The browser leader has exited, but waiting for EOF would then keep Node
      // alive indefinitely. Close only the readers owned by this launch; do not
      // kill shared background services or force the test process to exit.
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (removeProfile && !process.env.QA_KEEP_PROFILE) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    },
  };
  return handle;
}

class CdpConnection {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
    ws.addEventListener("message", (ev) => this._onMessage(ev.data));
    ws.addEventListener("close", () => {
      this.closed = true;
      for (const { reject, method } of this.pending.values()) {
        reject(new Error("CDP 连接已关闭，未收到响应：" + method));
      }
      this.pending.clear();
    });
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
    } catch {
      return;
    }
    if (msg.id != null) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        const err = new Error(pending.method + " 失败：" + msg.error.message);
        err.code = msg.error.code;
        err.data = msg.error.data;
        pending.reject(err);
      } else {
        pending.resolve(msg.result || {});
      }
      return;
    }
    for (const listener of this.listeners) {
      try {
        listener(msg);
      } catch {
        /* 监听器异常不应打断协议流 */
      }
    }
  }

  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error("CDP 连接已关闭：" + method));
    const id = ++this.nextId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (err) {
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

export async function connect(wsUrl, { timeout = 15000 } = {}) {
  const ws = new WebSocket(wsUrl);
  await withTimeout(
    new Promise((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", (ev) => reject(new Error("WebSocket 连接失败：" + (ev.message || ""))), {
        once: true,
      });
    }),
    timeout,
    "连接 Chrome CDP"
  );
  return new CdpConnection(ws);
}

/* ------------------------------------------------------------------ *
 * 按键定义（Windows 虚拟键码）
 * ------------------------------------------------------------------ */
const KEY_DEFS = {
  Enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
  Escape: { key: "Escape", code: "Escape", vk: 27 },
  Tab: { key: "Tab", code: "Tab", vk: 9 },
  Space: { key: " ", code: "Space", vk: 32, text: " " },
  Backspace: { key: "Backspace", code: "Backspace", vk: 8 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
  Home: { key: "Home", code: "Home", vk: 36 },
  End: { key: "End", code: "End", vk: 35 },
  PageDown: { key: "PageDown", code: "PageDown", vk: 34 },
  PageUp: { key: "PageUp", code: "PageUp", vk: 33 },
  Delete: { key: "Delete", code: "Delete", vk: 46 },
  keyZ: { key: "z", code: "KeyZ", vk: 90, text: "z" },
  keyF: { key: "f", code: "KeyF", vk: 70, text: "f" },
  keyJ: { key: "j", code: "KeyJ", vk: 74, text: "j" },
  keyS: { key: "s", code: "KeyS", vk: 83, text: "s" },
  keyB: { key: "b", code: "KeyB", vk: 66, text: "b" },
  keyM: { key: "m", code: "KeyM", vk: 77, text: "m" },
  value1: { key: "1", code: "Digit1", vk: 49, text: "1" },
  value2: { key: "2", code: "Digit2", vk: 50, text: "2" },
  value3: { key: "3", code: "Digit3", vk: 51, text: "3" },
  value4: { key: "4", code: "Digit4", vk: 52, text: "4" },
};

export class Page {
  static async open(conn, { url = "about:blank", initScripts = [] } = {}) {
    const { targetId } = await conn.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await conn.send("Target.attachToTarget", { targetId, flatten: true });
    const page = new Page(conn, sessionId, targetId);
    await page._init(initScripts);
    if (url && url !== "about:blank") await page.goto(url);
    return page;
  }

  constructor(conn, sessionId, targetId) {
    this.conn = conn;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.console = []; // {type, text, args, at}
    this.exceptions = []; // 页面未捕获异常
    this.logEntries = []; // Log.entryAdded
    this.dialogs = [];
    this.navigations = [];
    this.viewport = null;
    this._unsub = null;
  }

  send(method, params = {}) {
    return this.conn.send(method, params, this.sessionId);
  }

  async _init(initScripts = []) {
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Log.enable");
    this._unsub = this.conn.on((msg) => {
      if (msg.sessionId !== this.sessionId) return;
      this._onEvent(msg.method, msg.params || {});
    });
    for (const source of initScripts) {
      await this.send("Page.addScriptToEvaluateOnNewDocument", { source });
    }
  }

  _onEvent(method, params) {
    if (method === "Runtime.consoleAPICalled") {
      const text = (params.args || [])
        .map((a) => {
          if (a.value !== undefined) return typeof a.value === "string" ? a.value : JSON.stringify(a.value);
          return a.description || a.unserializableValue || String(a.type);
        })
        .join(" ");
      this.console.push({ type: params.type, text, at: Date.now() });
      return;
    }
    if (method === "Runtime.exceptionThrown") {
      const d = params.exceptionDetails || {};
      this.exceptions.push({
        text: d.text || "",
        description: d.exception?.description || "",
        url: d.url || "",
        lineNumber: d.lineNumber,
        at: Date.now(),
      });
      return;
    }
    if (method === "Log.entryAdded") {
      const e = params.entry || {};
      this.logEntries.push({
        level: e.level,
        source: e.source,
        text: e.text,
        url: e.url || "",
        lineNumber: e.lineNumber,
        at: Date.now(),
      });
      return;
    }
    if (method === "Page.javascriptDialogOpening") {
      this.dialogs.push({ type: params.type, message: params.message });
      this.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      return;
    }
    if (method === "Page.frameNavigated" && !params.frame?.parentId) {
      this.navigations.push({ url: params.frame?.url, at: Date.now() });
    }
  }

  /** 真实 console 错误 / 未捕获异常 / Log error（过滤已知无关噪音）。 */
  errors({ ignore = [/favicon\.ico/i] } = {}) {
    const out = [];
    for (const item of this.console) {
      if (!["error", "assert"].includes(item.type)) continue;
      if (ignore.some((re) => re.test(item.text))) continue;
      out.push({ kind: "console." + item.type, text: item.text });
    }
    for (const item of this.exceptions) {
      const text = (item.description || item.text || "").trim();
      if (!text) continue;
      if (ignore.some((re) => re.test(text))) continue;
      out.push({ kind: "exception", text });
    }
    for (const item of this.logEntries) {
      if (item.level !== "error") continue;
      if (ignore.some((re) => re.test(item.text))) continue;
      out.push({ kind: "log", text: item.text + (item.url ? " @" + item.url : "") });
    }
    // 去重（同一条错误可能在 console 与 log 各出现一次）
    const seen = new Set();
    return out.filter((e) => {
      const k = e.kind + "|" + e.text;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  warnings() {
    return [
      ...this.console.filter((c) => c.type === "warning").map((c) => c.text),
      ...this.logEntries.filter((e) => e.level === "warning").map((e) => e.text),
    ];
  }

  clearLogs() {
    this.console = [];
    this.exceptions = [];
    this.logEntries = [];
  }

  async waitEvent(method, { timeout = 20000 } = {}) {
    return withTimeout(
      new Promise((resolve) => {
        const off = this.conn.on((msg) => {
          if (msg.sessionId !== this.sessionId) return;
          if (msg.method === method) {
            off();
            resolve(msg.params || {});
          }
        });
      }),
      timeout,
      "等待事件 " + method
    );
  }

  async goto(url, { timeout = 60000, readyExpr } = {}) {
    const loaded = this.waitEvent("Page.loadEventFired", { timeout });
    const res = await this.send("Page.navigate", { url });
    if (res.errorText) throw new Error("导航失败：" + res.errorText + " → " + url);
    await loaded;
    await this.waitFor("document.readyState === 'complete'", { timeout: 15000 });
    if (readyExpr) await this.waitFor(readyExpr, { timeout, label: "页面就绪 " + readyExpr });
    return this;
  }

  async reload({ timeout = 60000 } = {}) {
    const loaded = this.waitEvent("Page.loadEventFired", { timeout });
    await this.send("Page.reload", { ignoreCache: false });
    await loaded;
    await this.waitFor("document.readyState === 'complete'", { timeout: 15000 });
    return this;
  }

  /** 直接运行页面表达式；异常会抛错（带页面堆栈）。 */
  async eval(expression, { awaitPromise = true, returnByValue = true, timeout = 30000, userGesture = true } = {}) {
    const res = await withTimeout(
      this.send("Runtime.evaluate", { expression, awaitPromise, returnByValue, userGesture }),
      timeout,
      "Runtime.evaluate " + timeout + "ms: " + String(expression).replace(/\s+/g, " ").slice(0, 90)
    );
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error("页面脚本异常：" + (d.exception?.description || d.text || "unknown"));
    }
    return res.result ? res.result.value : undefined;
  }

  /** 等待页面表达式为真。 */
  async waitFor(expression, { timeout = 15000, interval = 60, label } = {}) {
    const start = Date.now();
    for (;;) {
      let ok = false;
      try {
        ok = await this.eval("!!(" + expression + ")", { timeout: 5000 });
      } catch {
        ok = false;
      }
      if (ok) return true;
      if (Date.now() - start > timeout) {
        throw new Error("等待超时（" + timeout + "ms）：" + (label || expression));
      }
      await sleep(interval);
    }
  }

  /**
   * 等两帧，确保布局/动画落定。
   * headless 下偶发 rAF 被节流（页面被判定为不可见时），此时退化为定时器等待，
   * 不让整个验证因此中断（几何断言另有 sleep，不依赖单次 rAF）。
   */
  async nextFrame() {
    try {
      return await this.eval(
        "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
        { awaitPromise: true, timeout: 4000 }
      );
    } catch {
      await sleep(80);
      return this.eval("new Promise((resolve) => setTimeout(() => resolve(true), 50))", {
        awaitPromise: true,
        timeout: 4000,
      });
    }
  }

  /** 元素几何（CSS 像素，相对视口）。返回 null 表示不存在。 */
  async rect(selector) {
    return this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const text = (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120);
      return {
        selector: ${JSON.stringify(selector)},
        x: r.x, y: r.y, w: r.width, h: r.height,
        top: r.top, left: r.left, right: r.right, bottom: r.bottom,
        cx: r.x + r.width / 2, cy: r.y + r.height / 2,
        display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
        hidden: !!el.hidden, disabled: !!el.disabled, text,
        inViewport: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
      };
    })()`);
  }

  async rects(selectors) {
    const map = {};
    for (const sel of selectors) map[sel] = await this.rect(sel);
    return map;
  }

  /** 元素是否真实可点（存在、可见、在视口内、未被禁用）。 */
  async isClickable(selector) {
    return this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
      if (el.disabled || el.hidden) return false;
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (r.width < 2 || r.height < 2) return false;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
      const hit = document.elementFromPoint(x, y);
      return !!(hit && (hit === el || el.contains(hit)));
    })()`);
  }

  async scrollIntoView(selector, { block = "center" } = {}) {
    return this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: ${JSON.stringify(block)}, inline: "nearest" });
      return true;
    })()`);
  }

  /** 视口滚动位置。 */
  async scrollInfo() {
    return this.eval(
      "({x: scrollX, y: scrollY, docH: document.documentElement.scrollHeight, viewH: innerHeight, viewW: innerWidth})"
    );
  }

  async setViewport(width, height, { deviceScaleFactor = 1, mobile = false } = {}) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor,
      mobile,
      screenOrientation:
        height >= width ? { type: "portraitPrimary", angle: 0 } : { type: "landscapePrimary", angle: 90 },
    });
    await this.send("Emulation.setTouchEmulationEnabled", {
      enabled: !!mobile,
      maxTouchPoints: 5,
    }).catch(() => {});
    this.viewport = { width, height, deviceScaleFactor, mobile };
    await this.nextFrame().catch(() => {});
    return this.viewport;
  }

  /** 媒体特性：减少动效 / 深浅主题。 */
  async setMedia({ reducedMotion, colorScheme } = {}) {
    const features = [];
    if (reducedMotion) features.push({ name: "prefers-reduced-motion", value: reducedMotion });
    if (colorScheme) features.push({ name: "prefers-color-scheme", value: colorScheme });
    await this.send("Emulation.setEmulatedMedia", { features });
    await this.nextFrame().catch(() => {});
  }

  /** 页面缩放（浏览器缩放语义）。 */
  async setPageScale(scale) {
    await this.send("Emulation.setPageScaleFactor", { pageScaleFactor: scale });
    await this.nextFrame().catch(() => {});
  }

  /* ---------------- 真实输入 ---------------- */
  async mouseMove(x, y) {
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
      buttons: 0,
    });
  }

  async click(x, y, { button = "left", clickCount = 1, delay = 12 } = {}) {
    await this.mouseMove(x, y);
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button,
      buttons: button === "left" ? 1 : 2,
      clickCount,
    });
    await sleep(delay);
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button,
      buttons: 0,
      clickCount,
    });
  }

  async clickSelector(selector, opts = {}) {
    const r = await this.rect(selector);
    if (!r) throw new Error("元素不存在，无法点击：" + selector);
    await this.click(r.cx, r.cy, opts);
    return r;
  }

  /** 两次真实点击（模拟快速双击/双点），间隔 gap 毫秒。 */
  async doubleClickAt(x, y, { gap = 70, clickCount = 1 } = {}) {
    await this.click(x, y, { clickCount });
    await sleep(gap);
    await this.click(x, y, { clickCount });
  }

  async doubleClickSelector(selector, { gap = 70, clickCount = 1, scroll = false } = {}) {
    if (scroll) await this.scrollIntoView(selector);
    const r = await this.rect(selector);
    if (!r) throw new Error("元素不存在，无法双击：" + selector);
    await this.doubleClickAt(r.cx, r.cy, { gap, clickCount });
    return r;
  }

  /** 触摸事件（模拟手指点按 / 滑动手势）。 */
  async touchTap(x, y, { hold = 40 } = {}) {
    await this.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
    });
    await sleep(hold);
    await this.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  async touchSwipe(x, y, dx, dy, { steps = 8, stepDelay = 16 } = {}) {
    await this.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
    });
    for (let i = 1; i <= steps; i++) {
      await this.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + (dx * i) / steps, y: y + (dy * i) / steps, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
      });
      await sleep(stepDelay);
    }
    await this.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  async key(name, { modifiers = 0, type, key, code, vk, text } = {}) {
    const def = KEY_DEFS[name] || {};
    const k = key ?? def.key ?? name;
    const c = code ?? def.code ?? "";
    const v = vk ?? def.vk ?? 0;
    const t = text ?? def.text;
    const downType = t && !modifiers ? "keyDown" : "rawKeyDown";
    await this.send("Input.dispatchKeyEvent", {
      type: downType,
      key: k,
      code: c,
      windowsVirtualKeyCode: v,
      nativeVirtualKeyCode: v,
      modifiers,
      ...(t ? { text: t, unmodifiedText: t } : {}),
    });
    await sleep(8);
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: k,
      code: c,
      windowsVirtualKeyCode: v,
      nativeVirtualKeyCode: v,
      modifiers,
    });
  }

  async pressEnter() {
    return this.key("Enter");
  }

  async pressEscape() {
    return this.key("Escape");
  }

  /** 输入文本（走 Input.insertText，可测搜索框）。 */
  async insertText(text) {
    await this.send("Input.insertText", { text });
  }

  async screenshot(name, { format = "png", clip } = {}) {
    ensureDir(SHOTS_DIR);
    const file = path.join(SHOTS_DIR, name.endsWith("." + format) ? name : name + "." + format);
    const params = { format, fromSurface: true };
    if (clip) params.clip = clip;
    const { data } = await this.send("Page.captureScreenshot", params);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    return file;
  }

  async close() {
    try {
      if (this._unsub) this._unsub();
      await this.conn.send("Target.closeTarget", { targetId: this.targetId });
    } catch {
      /* ignore */
    }
    try {
      await this.conn.send("Target.detachFromTarget", { sessionId: this.sessionId });
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------------ *
 * 结果记录器：统一「前置条件 / 操作 / 期望 / 实际 / 状态」
 * 状态只允许：通过 / 失败 / 未测 / 设备不支持
 * ------------------------------------------------------------------ */
export function createRecorder(name, meta = {}) {
  const checks = [];
  const startedAt = new Date().toISOString();
  const rec = {
    name,
    meta,
    checks,
    add(entry) {
      const item = {
        id: entry.id,
        title: entry.title || "",
        precondition: entry.precondition || "",
        action: entry.action || "",
        expected: entry.expected || "",
        actual: entry.actual ?? "",
        status: entry.status,
        evidence: entry.evidence || [],
        note: entry.note || "",
        at: new Date().toISOString(),
      };
      checks.push(item);
      return item;
    },
    pass(entry) {
      return rec.add({ ...entry, status: "通过" });
    },
    fail(entry) {
      return rec.add({ ...entry, status: "失败" });
    },
    untested(entry) {
      return rec.add({ ...entry, status: "未测" });
    },
    unsupported(entry) {
      return rec.add({ ...entry, status: "设备不支持" });
    },
    addEvidence(file) {
      if (!rec.evidence) rec.evidence = [];
      rec.evidence.push(file);
      return file;
    },
    evidence: [],
    counts() {
      const out = { 通过: 0, 失败: 0, 未测: 0, 设备不支持: 0 };
      for (const c of checks) out[c.status] = (out[c.status] || 0) + 1;
      return out;
    },
    async save(extra = {}) {
      ensureDir(RESULTS_DIR);
      const file = path.join(RESULTS_DIR, name + ".json");
      const payload = {
        name,
        startedAt,
        finishedAt: new Date().toISOString(),
        meta: { ...meta, ...(extra.meta || {}) },
        counts: rec.counts(),
        evidence: rec.evidence,
        checks,
        ...extra,
      };
      await fsp.writeFile(file, JSON.stringify(payload, null, 2));
      return file;
    },
  };
  return rec;
}

/** 断言同坐标点是否落在矩形内（用于双击几何分析）。 */
export function pointInRect(px, py, rect) {
  if (!rect) return false;
  return px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom;
}

/** 两个矩形的交叠面积比例（相对较小矩形）。 */
export function rectOverlap(a, b) {
  if (!a || !b) return 0;
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const inter = w * h;
  const small = Math.min(a.w * a.h, b.w * b.h);
  return small > 0 ? Math.round((inter / small) * 1000) / 1000 : 0;
}

/** 设置页面隔离：清空 localStorage / sessionStorage / SW，模拟全新用户。 */
export async function clearBrowserState(page) {
  await page.eval(`(async () => {
    try { localStorage.clear(); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch (e) {}
    try { if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); } } catch (e) {}
    return true;
  })()`);
}

/* ------------------------------------------------------------------ *
 * 自检
 * ------------------------------------------------------------------ */
async function selftest() {
  const server = await startStaticServer();
  const chrome = await launchChrome({});
  const conn = await connect(chrome.wsUrl);
  try {
    const page = await Page.open(conn, { url: server.url("/index.html") });
    await page.setViewport(424, 776, { mobile: true, deviceScaleFactor: 2 });
    await page.waitFor("window.__vocab", { timeout: 60000, label: "app.js 初始化" });
    const info = await page.eval(`({
      title: document.title,
      words: (window.WORDS_RAW || []).length,
      book: window.__vocab.getBook(),
      cardWord: (document.querySelector("#card .word") || {}).textContent || "",
      noRect: (() => { const r = document.querySelector("#no").getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })()
    })`);
    const shot = await page.screenshot("selftest-424x776.png");
    console.log(JSON.stringify({ ok: true, info, shot, errors: page.errors() }, null, 2));
    await page.close();
  } finally {
    conn.close();
    await chrome.close();
    await server.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes("--selftest")) {
    selftest().catch((err) => {
      console.error("自检失败：", err);
      process.exit(1);
    });
  } else {
    console.log("用法：node tests/browser/cdp.mjs --selftest");
  }
}
