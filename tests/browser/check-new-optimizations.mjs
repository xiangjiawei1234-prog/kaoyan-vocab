#!/usr/bin/env node
/**
 * V 新能力真实浏览器验收：H 本词问题 / F1 阅读布局 / E 词表整理 / G 统计下钻 / O1 偏好归属 / D1 抽测。
 *
 * 运行（默认跑全部已实现段落）：
 *   node --max-old-space-size=512 tests/browser/check-new-optimizations.mjs
 * 开发期按段运行（只跑 H）：
 *   node --max-old-space-size=512 tests/browser/check-new-optimizations.mjs --only=H
 *   node --max-old-space-size=512 tests/browser/check-new-optimizations.mjs --only=H,F1
 *
 * 产物：
 *   tests/reports/browser/results/new-optimizations.json
 *   tests/reports/browser/shots/new-opt-*.png
 *
 * 约束：无 npm 依赖，复用 ./cdp.mjs；不改运行时代码；不进入默认 Node 汇总。
 * 夹具只经 localStorage/sessionStorage 初始化书状态与开关，业务操作全部走真实控件/指针/键盘/触摸；
 * 不直接伪造 Q/cur/answered。确认框的「取消」路径用页面级 window.confirm 替身控制返回值，
 * 「确认」路径走真实原生对话框（由 cdp.mjs 自动接受并记录）。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer, launchChrome, connect, Page, sleep, RESULTS_DIR, createRecorder } from "./cdp.mjs";

const ARGV = process.argv.slice(2);
const onlyArg = ARGV.find((a) => a.startsWith("--only="));
const ONLY = onlyArg
  ? new Set(onlyArg.split("=")[1].split(",").map((x) => x.trim().toUpperCase()).filter(Boolean))
  : null;
const wants = (id) => !ONLY || ONLY.has(id);

const SECTION_IDS = ["H", "F1", "EG", "O1", "D1"];
const SECTION_TITLES = {
  H: "H 本词问题本地记录（375×812 深色）",
  F1: "F1 阅读与布局定制（375 大字 / 320×568 大字）",
  EG: "E 词表整理 + G 统计下钻（375×812 / 1440×1000）",
  O1: "O1 偏好归属与词书（双页面同源）",
  D1: "D1 抽测：375 触摸默认判定 + 320 布局按钮可点",
};

const server = await startStaticServer();
const chrome = await launchChrome({ windowSize: "1440,1000" });
const conn = await connect(chrome.wsUrl);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "vocab-new-opt-"));
const downloads = path.join(temporary, "downloads");
fs.mkdirSync(downloads, { recursive: true });

/** 记录本次运行实际加载的源码字节（并发工作区里用于对齐截图/结论）。 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
function sourceFingerprint(rel) {
  const file = path.join(REPO_ROOT, rel);
  const buf = fs.readFileSync(file);
  return { file: rel, md5: crypto.createHash("md5").update(buf).digest("hex"), bytes: buf.length, mtime: fs.statSync(file).mtime.toISOString() };
}

const rec = createRecorder("new-optimizations", {
  title: "V 新能力真实浏览器验收",
  source: ["js/app.js", "index.html", "css/app.css"].map(sourceFingerprint),
  browser: await conn.send("Browser.getVersion"),
  sections: SECTION_IDS.filter(wants).map((id) => ({ id, title: SECTION_TITLES[id] })),
  limits: [
    "Chrome headless（headless=new）；375×812 与 320×568 为仿真移动视口，不是真机",
    "真实剪贴板读取受 headless 权限限制时记录未测，并以页面级拒绝夹具验证 execCommand 回退路径与内容",
    "删除确认的取消路径用页面级 confirm 替身；确认路径为真实原生 confirm（CDP 自动接受并记录消息）",
    "用户旅程全部走真实控件/指针/键盘/触摸；仅 localStorage/sessionStorage 夹具用于初始化书状态与开关",
    "未覆盖真机软键盘、输入法、读屏、Safari/Firefox、系统语音与实际文件保存目录策略",
  ],
});

const counters = new Map();
function sectionCheck(section, ok, title, detail = {}) {
  const n = (counters.get(section) || 0) + 1;
  counters.set(section, n);
  const id = section + "-" + String(n).padStart(2, "0");
  const entry = { id, title, actual: detail, evidence: [] };
  if (ok === null) { rec.untested(entry); console.log("UNTESTED [" + id + "] " + title); }
  else if (ok) { rec.pass(entry); console.log("PASS [" + id + "] " + title); }
  else { rec.fail(entry); console.log("FAIL [" + id + "] " + title); }
  return entry;
}

const shots = [];
async function shot(p, section, name) {
  await sleep(260);
  const file = await p.screenshot("new-opt-" + section.toLowerCase() + "-" + name + ".png");
  rec.addEvidence(file);
  shots.push(file);
  return file;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const LEARNING = `(() => {const v=window.__vocab,s=v.getS();return {book:v.getBook(),cur:v.cur,phase:v.phase,verdict:v.verdict,qi:v.qi,answered:v.answered,Q:v.Q,
  progress:s.progress,days:s.days,stars:s.stars,proficient:s.proficient,reviewDay:s.reviewDay,extraDay:s.extraDay,timeSec:s.timeSec};})()`;
const GROUP = `(() => {const v=window.__vocab,p=v.getPlan();return {cur:v.cur,phase:v.phase,verdict:v.verdict,qi:v.qi,answered:v.answered,
  total:v.getGroupTotal(),Q:v.Q,startedAt:p&&p.startedAt,sig:p&&p.scopeSig};})()`;
const SETTINGS = `JSON.parse(JSON.stringify(window.__vocab.getS().settings))`;
const ISSUE_KEY = "vocab_word_issues_v1";

async function openPage() {
  const p = await Page.open(conn, { url: server.url() });
  await p.waitFor('window.__vocab && document.querySelector("#card")', { timeout: 60000, label: "app.js 初始化" });
  return p;
}
async function click(p, selector) {
  await p.scrollIntoView(selector);
  // 浮层/菜单有 0.18s 入场动画：等一帧落定后重试一次，避免动画中途误判不可点。
  if (!(await p.isClickable(selector))) {
    await sleep(260);
    await p.scrollIntoView(selector);
    if (!(await p.isClickable(selector))) throw new Error("控件不能真实命中：" + selector);
  }
  await p.clickSelector(selector);
}
async function fill(p, selector, value) {
  await click(p, selector);
  await p.eval(`document.querySelector(${JSON.stringify(selector)}).select()`);
  if (String(value)) await p.insertText(String(value));
  else await p.key("Backspace");
  await p.key("Tab");
}
/** 只经存储初始化当前书 state（明确标注是夹具）；随后真实 reload 走应用自身初始化。 */
async function seed(p, { theme = "dark", fontSize = "standard", book = "kaoyan", makeOnly = null, settings = {}, extraJs = "" } = {}) {
  const { identifier } = await p.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));}catch(e){}`,
  });
  try {
    await p.eval(`(() => {
      const v=window.__vocab,s=JSON.parse(JSON.stringify(v.getS()));
      s.progress={};s.days={};s.stars={};s.proficient={};s.spelling={};s.timeSec=0;s.reviewDay={};s.extraDay={};
      Object.assign(s.settings,{
        theme:${JSON.stringify(theme)},fontSize:${JSON.stringify(fontSize)},
        dailyNew:20,groupSize:30,dailyReviewCap:100,order:'freq',fmin:1,fmax:0,pmin:0,pos:[],posMode:'primary',kyOnly:false,
        autoSpk:false,singleCharKeys:true,autoResume:{enabled:false,threshold:5,idleMs:120000,countdownMs:15000},
        cardDensity:'comfortable',readingOrder:['meaning','example','forms'],
        showCardMeta:true,showCardStage:true,showCardPos:true,secondaryActions:['undo','proficient']
      },${JSON.stringify(settings)});
      ${makeOnly ? `const target=v.getW().find(x=>x.w===${JSON.stringify(makeOnly)});if(target){s.settings.fmin=target.f;s.settings.fmax=target.f;s.settings.dailyNew=2;s.settings.groupSize=1;s.settings.order='freq';}` : ""}
      ${extraJs}
      try{localStorage.clear();}catch(e){}
      try{sessionStorage.clear();}catch(e){}
      localStorage.setItem(${JSON.stringify(book + "_vocab_v1")},JSON.stringify(s));
      localStorage.setItem(${JSON.stringify(book + "_vocab_proficient_v1")},'{}');
      localStorage.setItem('vocab_active_book_v1',${JSON.stringify(book)});
      localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));
    })()`);
    await p.reload();
    await p.waitFor('window.__vocab && document.querySelector("#card")', { timeout: 60000, label: "夹具后初始化" });
  } finally {
    await p.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  }
}
/**
 * 原生 <select> 在本机 macOS CDP 独立空白页也不能用方向键提交（既有浏览器记录已确认）；
 * 这里用真实 focus + DOM value + 原生 change 事件进入同一表单路径，不调用业务写 hook。
 */
async function setSelect(p, selector, value) {
  await p.scrollIntoView(selector);
  await p.eval(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(140);
}
async function openStatsPanel(p, id) {
  const open = await p.eval(`!!(document.querySelector(${JSON.stringify("#" + id)}) || {}).open`);
  if (!open) {
    await click(p, "#" + id + " > summary");
    await p.waitFor(`document.querySelector(${JSON.stringify("#" + id)}).open`);
  }
  // 默认展开后不再依赖“点击 summary”顺带滚到面板；后续图表坐标必须来自可见区域。
  await p.scrollIntoView("#" + id);
  await sleep(100);
}

async function waitDownload(timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const files = fs.readdirSync(downloads).filter((f) => f.endsWith(".json"));
    if (files.length) return files[0];
    await sleep(90);
  }
  throw new Error("下载目录没有生成 JSON：" + downloads);
}
/** 确保主学习卡已揭示：先真实按 F（等同用户判定「会」），再等 revealed。 */
async function revealStudy(p) {
  if (await p.eval('window.__vocab.phase==="recall"')) await p.key("keyF");
  await p.waitFor('window.__vocab.phase==="revealed"', { timeout: 6000, label: "学习卡揭示" });
}

function pickLearning(v) {
  return {
    progress: v.progress, days: v.days, stars: v.stars, proficient: v.proficient,
    reviewDay: v.reviewDay, extraDay: v.extraDay, timeSec: v.timeSec,
  };
}

/* ===========================================================================
 * H：本词问题本地记录（详情页）
 * ========================================================================= */
async function sectionH() {
  const S = "H";
  const p = await openPage();
  const netRequests = [];
  const offNet = conn.on((msg) => {
    if (msg.sessionId === p.sessionId && msg.method === "Network.requestWillBeSent") {
      netRequests.push(msg.params.request.url);
    }
  });
  try {
    await p.setViewport(375, 812, { mobile: true });
    await p.setMedia({ colorScheme: "dark" });
    await seed(p, { theme: "dark", fontSize: "standard" });
    await p.send("Network.enable");
    p.clearLogs();
    const learningBefore = await p.eval(LEARNING);
    const profRawBefore = await p.eval(`localStorage.getItem('kaoyan_vocab_proficient_v1')`);

    // 1) 词表搜索 → 打开详情
    await click(p, '[data-v="list"]');
    await fill(p, "#q", "answer");
    const answerIdx = await p.eval(`window.__vocab.getW().findIndex(x=>x.w==='answer')`);
    if (answerIdx < 0) throw new Error("夹具词 answer 不在当前词书");
    const row = '[data-open-word="' + answerIdx + '"]';
    await p.waitFor(`document.querySelector(${JSON.stringify(row)})`, { label: "词表出现 answer 行" });
    await click(p, row);
    await p.waitFor("!document.querySelector('#wordSheet').hidden", { label: "详情浮层打开" });

    const structure = await p.eval(`(() => {const b=document.querySelector('#wordIssueBlock'),n=document.querySelector('#wordIssueNote'),st=document.querySelector('#wordIssueStatus');
      return {insideSheet:!!(b&&b.closest('#wordSheet')),hasNote:!!n,noteMax:n&&n.getAttribute('maxlength'),noteMaxProp:n&&n.maxLength,knownHidden:document.querySelector('#wordIssueKnown').hidden,
        deleteHidden:document.querySelector('#wordIssueDelete').hidden,copyHidden:document.querySelector('#wordIssueCopy').hidden,
        statusRole:st&&st.getAttribute('role'),statusLive:st&&st.getAttribute('aria-live'),statusText:st&&st.textContent,
        panelScrolls:document.querySelector('#wordSheet .sheet-panel').scrollHeight>0};})()`);
    sectionCheck(S, structure.insideSheet && structure.hasNote && structure.noteMax === '500' && structure.noteMaxProp === 500 && structure.knownHidden
      && structure.deleteHidden && structure.copyHidden && structure.statusRole === "status" && structure.statusLive === "polite",
      "详情浮层内新增本词问题区（空状态：无删除/复制、状态 role=status、500 字限制）", structure);
    const ctx = await p.eval("window.__vocab.getWordIssueState().context");
    sectionCheck(S, !!ctx && ctx.bookId === "kaoyan" && ctx.bookName === "考研英语" && ctx.word === "answer"
      && /真题例句|自编例句|例句/.test(ctx.source) && /词频 #\d+/.test(ctx.source) && /套卷/.test(ctx.source),
      "打开详情自动带词书/词头/可读来源（11 元组 src + 词频 + 卷次）", ctx);

    // 键盘可达：输入框之后一个 Tab 到保存
    await click(p, "#wordIssueNote");
    await p.key("Tab");
    const tabTo = await p.eval(`({id:document.activeElement.id,tag:document.activeElement.tagName})`);
    sectionCheck(S, tabTo.id === "wordIssueSave", "Tab 从问题输入框到达保存按钮（键盘可达）", tabTo);

    // 2) 保存
    await click(p, "#wordIssueNote");
    await p.insertText("浏览器验收：这个义项和例句对不上。");
    await click(p, "#wordIssueSave");
    await p.waitFor(`document.querySelector('#wordIssueStatus').textContent.includes('已保存')`, { label: "保存状态提示" });
    const saved = await p.eval(`(() => {const raw=localStorage.getItem(${JSON.stringify(ISSUE_KEY)});const d=raw?JSON.parse(raw):null;const e=d&&d.entries&&d.entries[0];
      return {hasRaw:!!raw,kind:d&&d.kind,version:d&&d.version,count:d&&d.entries?d.entries.length:null,fields:e?Object.keys(e).sort():null,
        bookId:e&&e.bookId,bookName:e&&e.bookName,word:e&&e.word,note:e&&e.note,source:e&&e.source,
        createdAt:e&&e.createdAt,updatedAt:e&&e.updatedAt,createdOk:!!(e&&!Number.isNaN(Date.parse(e.createdAt)))};})()`);
    sectionCheck(S, saved.hasRaw && saved.kind === "vocab-word-issues" && saved.version === 1 && saved.count === 1,
      "保存写入独立键 vocab_word_issues_v1（kind/version/entries）", saved);
    sectionCheck(S, same(saved.fields, ["bookId", "bookName", "createdAt", "note", "source", "updatedAt", "word"])
      && saved.bookId === "kaoyan" && saved.bookName === "考研英语" && saved.word === "answer"
      && saved.note === "浏览器验收：这个义项和例句对不上。" && /词频 #\d+/.test(saved.source) && saved.createdOk,
      "条目自动带书/词/来源/备注/创建更新时间且仅 7 个必要字段", saved);
    const statusSaved = await p.eval(`(() => {const e=document.querySelector('#wordIssueStatus');return {role:e.getAttribute('role'),live:e.getAttribute('aria-live'),error:e.getAttribute('data-error'),text:e.textContent};})()`);
    sectionCheck(S, statusSaved.role === "status" && statusSaved.live === "polite" && statusSaved.error === null && /已保存/.test(statusSaved.text),
      "保存状态经 role=status/aria-live 提示（无错误标记）", statusSaved);
    const knownSaved = await p.eval(`({hidden:document.querySelector('#wordIssueKnown').hidden,text:document.querySelector('#wordIssueKnown').textContent,
      deleteHidden:document.querySelector('#wordIssueDelete').hidden,copyHidden:document.querySelector('#wordIssueCopy').hidden,total:document.querySelector('#wordIssueTotal').textContent})`);
    sectionCheck(S, !knownSaved.hidden && /来源/.test(knownSaved.text) && /创建/.test(knownSaved.text) && /更新/.test(knownSaved.text)
      && !knownSaved.deleteHidden && !knownSaved.copyHidden && /本书 1 条/.test(knownSaved.total),
      "已有记录区显示来源与创建/更新时间并开放删除/复制", knownSaved);
    await shot(p, S, "detail-saved-375-dark");

    // 3) 关闭重开仍在；关闭焦点归还触发行
    await p.key("Escape");
    await p.waitFor("document.querySelector('#wordSheet').hidden", { label: "Esc 关闭详情" });
    const focusBack = await p.eval(`({tag:document.activeElement&&document.activeElement.tagName,openWord:document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.openWord})`);
    sectionCheck(S, focusBack.openWord === String(answerIdx), "Esc 关闭详情后焦点归还词表触发行", focusBack);
    await click(p, row);
    await p.waitFor("!document.querySelector('#wordSheet').hidden");
    const reopened = await p.eval(`({value:document.querySelector('#wordIssueNote').value,knownHidden:document.querySelector('#wordIssueKnown').hidden,
      known:document.querySelector('#wordIssueKnown').textContent,deleteHidden:document.querySelector('#wordIssueDelete').hidden,copyHidden:document.querySelector('#wordIssueCopy').hidden})`);
    sectionCheck(S, reopened.value === "浏览器验收：这个义项和例句对不上。" && !reopened.knownHidden
      && /来源/.test(reopened.known) && /创建/.test(reopened.known) && /更新/.test(reopened.known) && !reopened.deleteHidden && !reopened.copyHidden,
      "关闭重开后记录仍在并回填备注/来源/时间", reopened);

    // 4) 编辑更新同一条
    await click(p, "#wordIssueNote");
    await p.eval(`document.querySelector('#wordIssueNote').select()`);
    await p.insertText("浏览器验收（更新）：音标疑似错误。");
    await click(p, "#wordIssueSave");
    await p.waitFor(`document.querySelector('#wordIssueStatus').textContent.includes('已更新')`, { label: "更新状态提示" });
    const updated = await p.eval(`(() => {const d=JSON.parse(localStorage.getItem(${JSON.stringify(ISSUE_KEY)}));const e=d.entries[0];
      return {count:d.entries.length,note:e.note,createdAt:e.createdAt,updatedAt:e.updatedAt,status:document.querySelector('#wordIssueStatus').textContent};})()`);
    sectionCheck(S, updated.count === 1 && updated.note === "浏览器验收（更新）：音标疑似错误。"
      && updated.createdAt === saved.createdAt && Date.parse(updated.updatedAt) >= Date.parse(saved.updatedAt) && /已更新/.test(updated.status),
      "再次保存＝更新同一条：条目不增加、createdAt 不变、updatedAt 推进", updated);

    // 5) 复制：真实剪贴板读取（可用时）+ 权限拒绝回退路径
    let realClipboard = null;
    let clipboardError = "";
    try {
      await conn.send("Browser.grantPermissions", {
        origin: server.origin,
        permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
      });
      await p.send("Page.bringToFront");
      await click(p, "#wordIssueCopy");
      await p.waitFor(`document.querySelector('#wordIssueStatus').textContent.includes('已复制')`, { timeout: 6000, label: "复制状态提示" });
      realClipboard = await p.eval("navigator.clipboard.readText()");
    } catch (e) {
      clipboardError = String((e && e.message) || e);
    }
    if (realClipboard) {
      sectionCheck(S, realClipboard.includes("考研英语") && realClipboard.includes("answer")
        && realClipboard.includes("音标疑似错误") && realClipboard.includes("来源"),
        "真实系统剪贴板复制内容含书/词/来源/备注/时间", { clipboard: realClipboard.slice(0, 240) });
    } else {
      sectionCheck(S, null, "真实系统剪贴板读取未测（headless 权限限制）；改由回退路径验证状态与内容", { error: clipboardError });
    }
    // 回退路径：把 navigator.clipboard 替身为权限拒绝，记录 execCommand 选中的临时文本
    await p.eval(`(() => {
      try { window.__origWriteText = navigator.clipboard && navigator.clipboard.writeText; } catch(e) {}
      try { Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('NotAllowedError'))}}); } catch(e) { window.__clipboardPatchError=String(e); }
      window.__execCopies=[]; window.__origExecCommand=document.execCommand;
      document.execCommand=(cmd)=>{const a=document.activeElement;window.__execCopies.push({cmd:cmd,value:a&&typeof a.value==='string'?a.value:''});return window.__origExecCommand.call(document,cmd);};
    })()`);
    await click(p, "#wordIssueCopy");
    await sleep(260);
    const fallback = await p.eval(`({status:document.querySelector('#wordIssueStatus').textContent,exec:window.__execCopies,patchError:window.__clipboardPatchError||null,
      textareas:[...document.querySelectorAll('#wordSheet .sheet-panel textarea')].map(t=>({value:t.value,id:t.id}))})`);
    sectionCheck(S, fallback.exec.length === 1 && fallback.exec[0].cmd === "copy"
      && fallback.exec[0].value.includes("考研英语") && fallback.exec[0].value.includes("answer")
      && fallback.exec[0].value.includes("音标疑似错误") && (/已复制/.test(fallback.status) || /Ctrl\/Cmd\+C/.test(fallback.status)),
      "clipboard 失败时回退隐藏 textarea+execCommand，选中内容与提示正确", fallback);
    await p.eval(`(() => {try{if(window.__origWriteText)Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:window.__origWriteText}});}catch(e){}
      if(window.__origExecCommand)document.execCommand=window.__origExecCommand;})()`);

    // 6) 导出本书 JSON（真实下载）
    await conn.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true }).catch(async () => {
      await p.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
    });
    await click(p, "#wordIssueExportBook");
    const downloadFile = await waitDownload();
    const exported = JSON.parse(fs.readFileSync(path.join(downloads, downloadFile), "utf8"));
    fs.rmSync(path.join(downloads, downloadFile));
    const exportStatus = await p.eval(`document.querySelector('#wordIssueStatus').textContent`);
    sectionCheck(S, /背词问题/.test(downloadFile) && /考研英语/.test(downloadFile)
      && exported.kind === "vocab-word-issues" && exported.version === 1
      && !Number.isNaN(Date.parse(exported.exportedAt)) && exported.entries.length === 1
      && same(Object.keys(exported).sort(), ["entries", "exportedAt", "kind", "version"])
      && same(Object.keys(exported.entries[0]).sort(), ["bookId", "bookName", "createdAt", "note", "source", "updatedAt", "word"]),
      "真实下载「导出本书 JSON」：文件名带本书、只含问题记录必要字段", { downloadFile, kind: exported.kind, version: exported.version, entries: exported.entries.length });
    const exportJson = JSON.stringify(exported);
    sectionCheck(S, !/progress|proficient|timeSec|settings|reviewDay|kaoyan_vocab|vocab_word_issues/.test(exportJson)
      && /不含学习进度/.test(exportStatus), "导出内容不含 progress/熟练/设置等学习记录并在状态中说明", { status: exportStatus });

    // 7) 删除：取消路径（页面级 confirm 替身）与确认路径（真实原生对话框）
    await p.eval(`window.__origConfirm=window.confirm;window.confirm=()=>false;`);
    await click(p, "#wordIssueDelete");
    const cancelDelete = await p.eval(`(() => {const d=JSON.parse(localStorage.getItem(${JSON.stringify(ISSUE_KEY)}));
      return {count:d.entries.length,knownHidden:document.querySelector('#wordIssueKnown').hidden,value:document.querySelector('#wordIssueNote').value};})()`);
    await p.eval(`window.confirm=window.__origConfirm;`);
    sectionCheck(S, cancelDelete.count === 1 && !cancelDelete.knownHidden && cancelDelete.value.includes("音标疑似错误"),
      "删除确认「取消」路径不删除并保留输入", cancelDelete);
    await click(p, "#wordIssueDelete");
    await p.waitFor(`JSON.parse(localStorage.getItem(${JSON.stringify(ISSUE_KEY)})).entries.length===0`, { label: "确认删除记录" });
    const deleteDialog = p.dialogs.filter((d) => d.type === "confirm").pop();
    const deleted = await p.eval(`(() => {const d=JSON.parse(localStorage.getItem(${JSON.stringify(ISSUE_KEY)}));
      return {count:d.entries.length,knownHidden:document.querySelector('#wordIssueKnown').hidden,value:document.querySelector('#wordIssueNote').value,
        deleteHidden:document.querySelector('#wordIssueDelete').hidden,copyHidden:document.querySelector('#wordIssueCopy').hidden,status:document.querySelector('#wordIssueStatus').textContent};})()`);
    sectionCheck(S, !!deleteDialog && /本词问题记录/.test(deleteDialog.message) && /不可撤销/.test(deleteDialog.message),
      "删除前出现真实原生确认对话框（含记录与不可撤销说明）", { dialog: deleteDialog || null });
    sectionCheck(S, deleted.count === 0 && deleted.knownHidden && deleted.value === "" && deleted.deleteHidden && deleted.copyHidden,
      "删除「确认」路径移除记录并清空/隐藏删除复制", deleted);
    await p.key("Escape");
    await p.waitFor("document.querySelector('#wordSheet').hidden");
    await click(p, row);
    await p.waitFor("!document.querySelector('#wordSheet').hidden");
    const gone = await p.eval(`({value:document.querySelector('#wordIssueNote').value,knownHidden:document.querySelector('#wordIssueKnown').hidden,
      deleteHidden:document.querySelector('#wordIssueDelete').hidden,copyHidden:document.querySelector('#wordIssueCopy').hidden})`);
    sectionCheck(S, gone.value === "" && gone.knownHidden && gone.deleteHidden && gone.copyHidden, "删除后重开详情不再显示本词问题", gone);
    await p.key("Escape");

    // 8) 全程不写学习记录/备份/熟练；不联网
    const learningAfter = await p.eval(LEARNING);
    const profRawAfter = await p.eval(`localStorage.getItem('kaoyan_vocab_proficient_v1')`);
    const stateRawAfter = await p.eval(`localStorage.getItem('kaoyan_vocab_v1')||''`);
    const issueRaw = await p.eval(`localStorage.getItem(${JSON.stringify(ISSUE_KEY)})`);
    const backupJson = await p.eval("JSON.stringify(window.__vocab.buildExport())");
    sectionCheck(S, same(pickLearning(learningBefore), pickLearning(learningAfter)) && profRawAfter === profRawBefore,
      "H 全程不写 progress/熟练/学习统计（主学习现场不变）", { before: pickLearning(learningBefore), after: pickLearning(learningAfter) });
    sectionCheck(S, !stateRawAfter.includes(ISSUE_KEY) && !stateRawAfter.includes("音标疑似错误")
      && !backupJson.includes(ISSUE_KEY) && !backupJson.includes("音标疑似错误")
      && !!issueRaw && JSON.parse(issueRaw).kind === "vocab-word-issues" && JSON.parse(issueRaw).entries.length === 0,
      "问题记录只存在独立键：不进主记录、不进备份 v3（空记录仍保留 kind/version/entries）", { hasIssueKey: !!issueRaw });
    const external = netRequests.filter((u) => !u.startsWith(server.origin) && !u.startsWith("blob:") && !u.startsWith("data:"));
    sectionCheck(S, external.length === 0, "H 交互不自动联网发送（无站外请求）", { external, requestCount: netRequests.length });
    sectionCheck(S, p.errors().length === 0, "H 段无 console 错误/未捕获异常", p.errors());
    p.clearLogs();
  } finally {
    offNet();
    await p.close();
  }
}

/* ===========================================================================
 * D1：抽测定格（不重复 check-input-preferences.mjs 的 214 项）
 * ========================================================================= */
async function sectionD1() {
  const S = "D1";
  const p = await openPage();
  try {
    await p.setViewport(375, 812, { mobile: true });
    await p.setMedia({ colorScheme: "dark" });
    await seed(p, { theme: "dark", settings: { dailyNew: 3, groupSize: 3 } });
    p.clearLogs();
    // 触摸默认：右滑＝会
    const card = await p.rect("#card");
    await p.touchSwipe(card.cx, card.cy, 90, 0);
    await p.waitFor('window.__vocab.phase==="revealed"', { timeout: 5000, label: "右滑判定" });
    sectionCheck(S, (await p.eval("window.__vocab.verdict===true")), "375 触摸默认右滑＝会（判定一次）", await p.eval("({phase:window.__vocab.phase,verdict:window.__vocab.verdict,answered:window.__vocab.answered})"));
    // 下一个，再左滑＝不会
    await p.key("Enter");
    await p.waitFor('window.__vocab.phase==="recall"');
    const card2 = await p.rect("#card");
    await p.touchSwipe(card2.cx, card2.cy, -90, 0);
    await p.waitFor('window.__vocab.phase==="revealed"', { timeout: 5000, label: "左滑判定" });
    sectionCheck(S, (await p.eval("window.__vocab.verdict===false")), "375 触摸默认左滑＝不会", await p.eval("({phase:window.__vocab.phase,verdict:window.__vocab.verdict})"));
    // 320 大字：布局按钮可点、无横向溢出、动作区高度
    await p.setViewport(320, 568, { mobile: true });
    await p.eval(`document.documentElement.dataset.fontSize='large'`);
    await sleep(220);
    await p.scrollIntoView("#acts");
    const geo = await p.eval(`(() => {const a=document.querySelector('#acts').getBoundingClientRect(),h=document.querySelector('#v-study > #hint').getBoundingClientRect();
      return {actsH:a.height,hintH:h.height,doc:document.documentElement.scrollWidth,width:innerWidth,
        okClickable:(()=>{const b=document.querySelector('#ok')||document.querySelector('#nx');if(!b)return false;const r=b.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!(hit&&(hit===b||b.contains(hit)));})()};})()`);
    sectionCheck(S, Math.abs(geo.actsH - 151) <= 1 && Math.abs(geo.hintH - 40) <= 1 && geo.doc <= geo.width + 1 && geo.okClickable,
      "320 大字：动作区 151px/提示 40px、无横向溢出、主按钮可真实命中", geo);
    await shot(p, S, "320-large-actions");
    sectionCheck(S, p.errors().length === 0, "D1 抽测无 console 错误/未捕获异常", p.errors());
    p.clearLogs();
  } finally {
    await p.close();
  }
}

/* ===========================================================================
 * F1 / E+G / O1：结构先留好，等 Lead 通知相关成员完成后补齐并运行
 * ========================================================================= */
async function sectionF1() {
  const S = "F1";
  const p = await openPage();
  const readOrder = () => p.eval("window.__vocab.getS().settings.readingOrder.slice()");
  const domOrder = () => p.eval(`[...document.querySelectorAll('#card .answer > *')]
    .filter(x=>!x.classList.contains('answer-label')&&!x.classList.contains('audio-controls'))
    .map(x=>x.classList.contains('mean')?'meaning':x.classList.contains('ex')?'example':x.classList.contains('answer-extra')?'forms':'other')`);
  // R05的普通例句控制组随例句一起移动；只排除这个已知附件，并核对其位置/文本，不能吞掉任意未知块。
  const audioOrder = () => p.eval(`(() => {const groups=[...document.querySelectorAll('#card .answer > .audio-controls')];
    return {count:groups.length,attached:groups.every(g=>g.previousElementSibling?.classList.contains('ex')
      &&g.dataset.audioSource===''&&g.dataset.audioText===window.__vocab.getW()[window.__vocab.cur].ex)};})()`);
  const moveOrder = async (key, dir) => {
    await click(p, '#readingOrderList [data-order-key="' + key + '"][data-order-dir="' + dir + '"]');
    await sleep(120);
  };
  async function setFixedActions(ids) {
    await p.scrollIntoView("#secondaryActionChoices");
    for (const id of ["undo", "proficient", "speak", "star"]) {
      const want = ids.includes(id);
      if ((await p.eval(`window.__vocab.getS().settings.secondaryActions.includes(${JSON.stringify(id)})`)) !== want) {
        await p.eval(`document.querySelector('#secondaryActionChoices [data-secondary-action="${id}"]').focus()`);
        await p.key("Space");
        await p.waitFor(`window.__vocab.getS().settings.secondaryActions.includes(${JSON.stringify(id)})===${want}`,
          { label: "固定次级动作 " + id + "=" + want });
      }
    }
  }
  try {
    for (const config of [{ width: 375, height: 812 }, { width: 320, height: 568 }]) {
      const label = config.width + "×" + config.height + " 大字深色";
      await p.setViewport(config.width, config.height, { mobile: true });
      await p.setMedia({ colorScheme: "dark" });
      await seed(p, { theme: "dark", fontSize: "large", makeOnly: "make" });
      p.clearLogs();
      await revealStudy(p);
      const group0 = await p.eval(GROUP);
      const order0 = await readOrder();
      const blocks0 = await p.eval(`({mean:!!document.querySelector('#card .answer .mean'),ex:!!document.querySelector('#card .answer .ex'),forms:!!document.querySelector('#card .answer .answer-extra')})`);
      const dom0 = await domOrder();
      const audio0 = await audioOrder();
      sectionCheck(S, same(order0, ["meaning", "example", "forms"]) && blocks0.mean && blocks0.ex && blocks0.forms
        && same(dom0, order0) && audio0.count === 1 && audio0.attached,
        label + "：揭示态三块齐全且默认 DOM 顺序＝设置顺序，朗读控件跟随例句", { order0, blocks0, dom0, audio0 });

      // 改阅读呈现：展开词形 + 卡内滚动参照；密度/顺序改变不重建当前组、不丢展开与滚动
      await click(p, "#card .answer-extra > summary");
      await p.eval(`(() => {const c=document.querySelector('#card');c.scrollTop=Math.min(24, Math.max(0, c.scrollHeight-c.clientHeight));})()`);
      const viewBefore = await p.eval(`(() => {const c=document.querySelector('#card');return {detailsOpen:!!c.querySelector('.answer-extra')&&c.querySelector('.answer-extra').open,scrollTop:c.scrollTop,maxScroll:c.scrollHeight-c.clientHeight};})()`);
      await click(p, '[data-v="set"]');
      await p.scrollIntoView("#cardDensitySeg");
      await click(p, '#cardDensitySeg [data-card-density="compact"]');
      await p.waitFor(`window.__vocab.getS().settings.cardDensity==='compact'`, { label: "密度保存" });
      const compact = await p.eval(`({setting:window.__vocab.getS().settings.cardDensity,pending:window.__vocab.hasPendingScopeSettings(),group:${GROUP}})`);
      sectionCheck(S, compact.setting === "compact" && !compact.pending && same(group0, compact.group),
        label + "：密度「紧凑」真实点击立即生效且不重建当前组/不产生待生效", compact);
      await shot(p, S, "settings-compact-" + config.width);

      // 阅读顺序：把词形移到最前（真实按钮两次上移）
      const orderBefore = await readOrder();
      await moveOrder("forms", -1);
      await moveOrder("forms", -1);
      const orderMoved = await readOrder();
      const summaryMoved = await p.eval(`document.querySelector('#readingOrderSummary').textContent`);
      sectionCheck(S, !same(orderBefore, orderMoved) && same(orderMoved, ["forms", "meaning", "example"])
        && /→/.test(summaryMoved) && /词形变化/.test(summaryMoved),
        label + "：阅读顺序按钮真实上移词形并更新摘要", { before: orderBefore, after: orderMoved, summary: summaryMoved });
      await click(p, '[data-v="study"]');
      await sleep(160);
      const domMoved = await domOrder();
      const audioMoved = await audioOrder();
      const viewAfter = await p.eval(`(() => {const c=document.querySelector('#card');return {detailsOpen:!!c.querySelector('.answer-extra')&&c.querySelector('.answer-extra').open,scrollTop:c.scrollTop,phase:window.__vocab.phase,verdict:window.__vocab.verdict};})()`);
      const groupMoved = await p.eval(GROUP);
      sectionCheck(S, same(domMoved, ["forms", "meaning", "example"]) && audioMoved.count === 1 && audioMoved.attached
        && viewAfter.phase === "revealed" && same(group0, groupMoved),
        label + "：改阅读顺序后卡片主体与例句控件顺序变化且当前组/已揭示态不变", { domMoved, viewAfter, audioMoved });
      sectionCheck(S, viewAfter.detailsOpen === viewBefore.detailsOpen && viewAfter.scrollTop === viewBefore.scrollTop,
        label + "：切页改呈现不丢已展开词形与卡内滚动", { before: viewBefore, after: viewAfter });

      // 恢复默认顺序（词形下移两次）
      await click(p, '[data-v="set"]');
      await p.scrollIntoView("#readingOrderControls");
      await moveOrder("forms", 1);
      await moveOrder("forms", 1);
      sectionCheck(S, same(await readOrder(), ["meaning", "example", "forms"]), label + "：阅读顺序可恢复默认全排列",
        { order: await readOrder() });

      // 三个卡片信息开关
      const toggleIds = ["showCardMeta", "showCardStage", "showCardPos"];
      for (const id of toggleIds) {
        const before = await p.eval(`window.__vocab.getS().settings.${id}`);
        await click(p, 'label[for="' + id + '"]');
        await p.waitFor(`window.__vocab.getS().settings.${id}===${!before}`, { label: "开关 " + id });
        const off = await p.eval(`window.__vocab.getS().settings.${id}`);
        sectionCheck(S, off === !before, label + "：显示开关 " + id + " 真实点击立即生效", { before, after: off });
      }
      await click(p, '[data-v="study"]');
      await sleep(160);
      const hiddenInfo = await p.eval(`({meta:!!document.querySelector('#card .word-face .tagrow'),stage:!!document.querySelector('#card .word-face .dots'),pos:!!document.querySelector('#card .word-face .posline'),group:${GROUP}})`);
      sectionCheck(S, !hiddenInfo.meta && !hiddenInfo.stage && !hiddenInfo.pos && same(group0, hiddenInfo.group),
        label + "：关闭三个显示开关后卡片对应信息消失且当前组不变", hiddenInfo);
      await click(p, '[data-v="set"]');
      for (const id of toggleIds) await click(p, 'label[for="' + id + '"]');
      await click(p, '[data-v="study"]');
      await sleep(160);
      const shownInfo = await p.eval(`({meta:!!document.querySelector('#card .word-face .tagrow'),stage:!!document.querySelector('#card .word-face .dots'),pos:!!document.querySelector('#card .word-face .posline')})`);
      sectionCheck(S, shownInfo.meta && shownInfo.stage && shownInfo.pos, label + "：三个显示开关可重新打开并恢复卡片信息", shownInfo);

      // 固定次级动作 0 / 1 / 2：槽位与「更多操作」可达性；不重建当前组
      await click(p, '[data-v="set"]');
      await p.scrollIntoView("#secondaryActionsControls");
      for (const fixed of [[], ["undo"], ["undo", "proficient"]]) {
        await click(p, '[data-v="set"]');
        await setFixedActions(fixed);
        await click(p, '[data-v="study"]');
        await sleep(160);
        const row = await p.eval(`(() => {const r=document.querySelector('#actsSecondary');
          const more=document.querySelector('#actsMore');
          const direct=r?[...r.querySelectorAll(':scope > [data-secondary]')]:[];
          return {count:direct.length,ids:direct.map(x=>x.dataset.secondary),
            countAttr:r?r.getAttribute('data-secondary-count'):null,more:!!more,
            moreIds:more?[...more.querySelectorAll('[data-secondary]')].map(x=>x.dataset.secondary):[],
            moreReachable:more?[...more.querySelectorAll('[data-secondary]')].length>0:false,
            group:${GROUP}};})()`);
        const okRow = same(row.ids, fixed) && row.count === fixed.length && row.countAttr === String(fixed.length);
        const unfixed = ["undo", "proficient"].filter((id) => !fixed.includes(id));
        const okMore = unfixed.length ? row.more && unfixed.every((id) => row.moreIds.includes(id)) : !row.more;
        sectionCheck(S, okRow && okMore && same(group0, row.group),
          label + "：固定次级动作 " + JSON.stringify(fixed) + " 槽位正确、未固定撤销/熟练仍可从更多操作到达且不改当前组",
          { row, expectedMore: unfixed });
      }
      await click(p, '[data-v="set"]');
      await setFixedActions(["undo", "proficient"]);

      // 320 大字首屏层级与动作区几何
      if (config.width === 320) {
        await click(p, '[data-v="study"]');
        await revealStudy(p);
        await p.eval("document.querySelector('#main').scrollTop=0");
        await sleep(180);
        const geo = await p.eval(`(() => {const acts=document.querySelector('#acts'),hint=document.querySelector('#v-study > #hint'),
          mean=document.querySelector('#card .answer .mean'),card=document.querySelector('#card');const ar=acts.getBoundingClientRect(),hr=hint.getBoundingClientRect(),mr=mean&&mean.getBoundingClientRect(),cr=card.getBoundingClientRect();
          return {actsH:ar.height,hintH:hr.height,doc:document.documentElement.scrollWidth,width:innerWidth,
            meanVisible:!!mr&&mr.bottom>0&&mr.top<innerHeight-40,meanTop:mr&&mr.top,cardVisible:cr.top<innerHeight&&cr.bottom>0,
            mainScrollable:(()=>{const m=document.querySelector('#main');return m.scrollHeight>m.clientHeight+1;})(),
            cardOverflow:getComputedStyle(card).overflowY,verdict:window.__vocab.verdict};})()`);
        await p.scrollIntoView("#acts");
        await sleep(220);
        const hit = await p.eval(`(() => {const btn=document.querySelector('#nx')||document.querySelector('#ok');const r=btn.getBoundingClientRect();
          const h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {btnId:btn.id,clickable:!!(h&&(h===btn||btn.contains(h))),top:r.top,bottom:r.bottom,vh:innerHeight};})()`);
        sectionCheck(S, Math.abs(geo.actsH - 151) <= 1 && Math.abs(geo.hintH - 40) <= 1 && geo.doc <= geo.width + 1
          && geo.meanVisible && geo.cardVisible && geo.verdict === true && hit.clickable,
          "320×568 大字揭示态：中文释义首屏可见、动作区 151/提示 40、滚动后主按钮可真实命中", { geo, hit });
        await shot(p, S, "320-large-revealed");
      }
      sectionCheck(S, p.errors().length === 0, label + "：F1 旅程无 console 错误/未捕获异常", p.errors());
      p.clearLogs();
    }

    // 统计页 6 个 details 展开偏好：独立键、默认展开、用户收起后刷新记住
    await p.setViewport(375, 812, { mobile: true });
    await seed(p, { theme: "dark", fontSize: "large" });
    p.clearLogs();
    await click(p, '[data-v="stats"]');
    await p.waitFor("document.querySelectorAll('#v-stats details.stats-details').length===6");
    const freshPanels = await p.eval(`({open:[...document.querySelectorAll('#v-stats details.stats-details')].filter(x=>x.open).map(x=>x.id),key:localStorage.getItem('vocab_stats_panels_v1')})`);
    sectionCheck(S, freshPanels.open.length === 6, "统计 6 个 details 默认全部展开", freshPanels);
    for (const id of ["statsForecastPanel", "surveyPanel"]) {
      await click(p, "#" + id + " > summary");
      await p.waitFor(`!document.querySelector('#${id}').open`);
    }
    await p.waitFor(`(()=>{try{const p=JSON.parse(localStorage.getItem('vocab_stats_panels_v1')||'{}');return Array.isArray(p.open)&&!p.open.includes('statsForecastPanel')&&!p.open.includes('surveyPanel');}catch(e){return false;}})()`,
      { label: "统计展开偏好落盘" });
    const opened = await p.eval(`({open:[...document.querySelectorAll('#v-stats details.stats-details')].filter(x=>x.open).map(x=>x.id),
      raw:localStorage.getItem('vocab_stats_panels_v1')})`);
    await p.reload();
    await p.waitFor("window.__vocab && document.querySelector('#card')");
    await click(p, '[data-v="stats"]');
    await p.waitFor("document.querySelectorAll('#v-stats details.stats-details').length===6");
    const restored = await p.eval(`({open:[...document.querySelectorAll('#v-stats details.stats-details')].filter(x=>x.open).map(x=>x.id),
      backup:JSON.stringify(window.__vocab.buildExport()),settings:JSON.stringify(window.__vocab.getS().settings)})`);
    sectionCheck(S, same(restored.open.sort(), ["statsFreqPanel", "statsStagesPanel", "statsDaysPanel", "statsHeatmapPanel"].sort()) && !!opened.raw
      && same(JSON.parse(opened.raw).open.sort(), restored.open.sort()) && !/stats_panels/.test(restored.backup)
      && !/stats_panels/.test(restored.settings),
      "统计展开偏好写入独立键、刷新恢复且不进备份 v3/设置", { opened, restored: restored.open });
    sectionCheck(S, p.errors().length === 0, "统计展开记忆旅程无 console 错误/未捕获异常", p.errors());
    p.clearLogs();
  } finally {
    await p.close();
  }
}
async function sectionEG() {
  const S = "EG";
  const p = await openPage();
  const openViewsMenu = async () => {
    if (!(await p.eval("document.querySelector('#listViewsMenu').open"))) {
      await click(p, "#listViewsMenu > summary");
      await p.waitFor("document.querySelector('#listViewsMenu').open");
    }
    await sleep(320);   // 菜单入场动画落定后再操作内部控件
  };
  const closeViewsMenu = async () => { await p.eval("document.querySelector('#listViewsMenu').open=false"); };
  try {
    /* ---------------- E1 保存 / 应用 / 重命名 / 删除视图（375×812 深色） ---------------- */
    await p.setViewport(375, 812, { mobile: true });
    await p.setMedia({ colorScheme: "dark" });
    await seed(p, { theme: "dark", settings: { dailyNew: 20, groupSize: 30 } });
    p.clearLogs();
    await click(p, '[data-v="list"]');
    await fill(p, "#q", "an");
    await setSelect(p, "#fst", "all");
    await p.waitFor("document.querySelector('#listCount').textContent.includes('共')");
    const base = await p.eval(`({count:window.__vocab.getFilterIndices().length,settings:${SETTINGS},learning:${LEARNING}})`);
    await openViewsMenu();
    await fill(p, "#listViewName", "浏览器视图 A");
    await click(p, "#btnSaveListView");
    await p.waitFor(`window.__vocab.getListViewState().views.some(v=>v.name==='浏览器视图 A')`);
    const view = await p.eval(`(() => {const st=window.__vocab.getListViewState();
      const v=st.views.find(x=>x.name==='浏览器视图 A');
      const raw=JSON.parse(localStorage.getItem('vocab_list_views_v1'));
      return {key:st.key,kind:raw.kind,version:raw.version,count:raw.views.length,book:v.book,name:v.name,
        q:v.q,fst:v.fst,fsc:v.fsc,id:v.id,settings:${SETTINGS},learning:${LEARNING}};})()`);
    sectionCheck(S, view.key === "vocab_list_views_v1" && view.kind === "vocab-list-views" && view.version === 1
      && view.count === 1 && view.book === "kaoyan" && view.q === "an" && view.fst === "all" && view.fsc === "scope",
      "E：保存当前筛选视图写入独立键（kind/version/本词书归属/q+fst+fsc）", view);
    sectionCheck(S, same(base.settings, view.settings) && same(pickLearning(base.learning), pickLearning(view.learning)),
      "E：保存视图不改学习设置、队列现场或学习记录", { settingsSame: same(base.settings, view.settings) });
    await shot(p, S, "list-views-375-dark");

    await closeViewsMenu();
    await fill(p, "#q", "zzz-no-match");
    await setSelect(p, "#fst", "wrong");
    await p.waitFor("document.querySelector('#listCount').textContent.includes('共 0 词')");
    await openViewsMenu();
    await click(p, `[data-view-apply="${view.id}"]`);
    await p.waitFor(`document.querySelector('#q').value==='an' && document.querySelector('#fst').value==='all'`);
    const applied = await p.eval(`({count:window.__vocab.getFilterIndices().length,q:document.querySelector('#q').value,
      fst:document.querySelector('#fst').value,fsc:document.querySelector('#fsc').value,settings:${SETTINGS},learning:${LEARNING}})`);
    sectionCheck(S, applied.count === base.count && applied.q === "an" && applied.fst === "all" && applied.fsc === "scope"
      && same(applied.settings, base.settings) && same(pickLearning(applied.learning), pickLearning(base.learning)),
      "E：应用视图恢复搜索/状态/范围且不改学习设置或队列现场", applied);

    await openViewsMenu();
    const renameInput = `[data-view-rename-input="${view.id}"]`;
    await click(p, renameInput);
    await p.eval(`document.querySelector(${JSON.stringify(renameInput)}).select()`);
    await p.insertText("浏览器视图 B");
    await click(p, `[data-view-rename="${view.id}"]`);
    await p.waitFor(`window.__vocab.getListViewState().views.some(v=>v.name==='浏览器视图 B')`);
    const renamed = await p.eval(`JSON.parse(localStorage.getItem('vocab_list_views_v1')).views[0].name`);
    sectionCheck(S, renamed === "浏览器视图 B", "E：视图重命名真实落盘", { renamed });

    const dialogsBefore = p.dialogs.length;
    await click(p, `[data-view-delete="${view.id}"]`);
    await p.waitFor("window.__vocab.getListViewState().views.length===0");
    const deleteDialog = p.dialogs.slice(dialogsBefore).filter((d) => d.type === "confirm").pop();
    sectionCheck(S, !!deleteDialog && /删除保存的筛选视图/.test(deleteDialog.message)
      && (await p.eval("JSON.parse(localStorage.getItem('vocab_list_views_v1')).views.length")) === 0,
      "E：删除视图经真实确认且只删该视图", { dialog: deleteDialog || null });

    // 损坏视图存储：保留原文、禁写、显式重置
    await p.eval(`localStorage.setItem('vocab_list_views_v1','{broken')`);
    await p.reload();
    await p.waitFor('window.__vocab && document.querySelector("#card")');
    await click(p, '[data-v="list"]');
    await openViewsMenu();
    const corrupt = await p.eval(`(() => {const st=window.__vocab.getListViewState();
      return {corrupt:st.corrupt,ready:st.ready,raw:st.raw,status:document.querySelector('#listViewsStatus').textContent,
        saveDisabled:document.querySelector('#btnSaveListView').disabled,resetHidden:document.querySelector('#btnResetListViews').hidden};})()`);
    sectionCheck(S, corrupt.corrupt && corrupt.raw === "{broken" && /损坏/.test(corrupt.status) && /保留原文/.test(corrupt.status)
      && corrupt.saveDisabled && !corrupt.resetHidden,
      "E：视图存储损坏时保留原文、禁用保存并提示可显式重置", corrupt);
    // 损坏状态下输入框与保存按钮都应禁用；即使程序化触发点击也不能覆写原文。
    const blocked = await p.eval(`({inputDisabled:document.querySelector('#listViewName').disabled,
      saveDisabled:document.querySelector('#btnSaveListView').disabled,raw:localStorage.getItem('vocab_list_views_v1')})`);
    await p.eval("document.querySelector('#btnSaveListView').click()");
    sectionCheck(S, blocked.inputDisabled && blocked.saveDisabled && blocked.raw === "{broken"
      && (await p.eval("localStorage.getItem('vocab_list_views_v1')")) === "{broken",
      "E：损坏时输入/保存被禁用且点击不覆写原文", blocked);
    await click(p, "#btnResetListViews");
    await p.waitFor("window.__vocab.getListViewState().corrupt===false");
    sectionCheck(S, (await p.eval("localStorage.getItem('vocab_list_views_v1')")) === null,
      "E：显式重置损坏视图存储后恢复为空视图列表");
    await shot(p, S, "list-views-corrupt-375-dark");

    /* ---------------- E2 整理模式：全筛选批量收藏 / 熟练预览确认（375×812） ---------------- */
    await seed(p, { theme: "dark", settings: { dailyNew: 20, groupSize: 30 } });
    p.clearLogs();
    await click(p, '[data-v="list"]');
    await click(p, "#btnToggleOrganize");
    await p.waitFor("!document.querySelector('#listOrganizeBar').hidden");
    await click(p, "#btnSelectAllFiltered");
    const selection = await p.eval(`({n:window.__vocab.getListSelection().length,filt:window.__vocab.getFilterIndices().length,
      summary:document.querySelector('#listSelectionSummary').textContent,rendered:document.querySelectorAll('#listInner [data-row-check]').length})`);
    sectionCheck(S, selection.n === selection.filt && selection.rendered < selection.filt && /全部/.test(selection.summary),
      "E：整理模式「选择当前筛选全部 N 词」覆盖未渲染虚拟行", selection);
    await click(p, "#btnBatchStar");
    await p.waitFor(`Object.keys(window.__vocab.getS().stars||{}).length>=${selection.n}`);
    const starState = await p.eval(`(() => {const v=window.__vocab,ids=v.getFilterIndices(),stars=v.getS().stars||{},last=ids[ids.length-1];
      return {stars:Object.keys(stars).length,last:last,lastStarred:!!stars[last],
        lastRendered:!!document.querySelector('#listInner [data-row-check="'+last+'"]')};})()`);
    sectionCheck(S, starState.lastStarred && !starState.lastRendered && starState.stars === selection.n,
      "E：批量收藏真实作用于未渲染虚拟行（不是只改已渲染行）", starState);
    await click(p, "#btnBatchProficient");
    await p.waitFor("!document.querySelector('#listBatchPreview').hidden");
    const preview = await p.eval(`({text:document.querySelector('#listBatchPreviewText').textContent,
      confirmEnabled:!document.querySelector('#btnBatchConfirm').disabled})`);
    sectionCheck(S, /将把所选/.test(preview.text) && /标为熟练/.test(preview.text) && /不改学习进度/.test(preview.text) && preview.confirmEnabled,
      "E：批量熟练先展示影响预览（数量/移出队列/不改学习记录）再要求确认", preview);
    const sample = await p.eval("window.__vocab.getFilterIndices()[0]");
    await click(p, "#btnBatchConfirm");
    await p.waitFor(`window.__vocab.isProficient(${sample})===true`);
    sectionCheck(S, (await p.eval(`window.__vocab.isProficient(${sample})`)) === true
      && (await p.eval("Object.keys(window.__vocab.getS().proficient||{}).length")) >= 1,
      "E：确认后批量熟练走正式语义写入熟练名单");
    await setSelect(p, "#fst", "proficient");
    await p.waitFor("document.querySelector('#listCount').textContent.includes('共')");
    const profView = await p.eval(`({count:window.__vocab.getFilterIndices().length,text:document.querySelector('#listCount').textContent})`);
    sectionCheck(S, profView.count >= 1 && /熟练/.test(profView.text), "E：熟练筛选可查看刚批量标记的词", profView);
    await shot(p, S, "organize-batch-375-dark");
    sectionCheck(S, p.errors().length === 0, "E：词表整理旅程无 console 错误/未捕获异常", p.errors());
    p.clearLogs();

    /* ---------------- G 统计下钻（1440×1000 浅色） ---------------- */
    await p.setViewport(1440, 1000);
    await p.setMedia({ colorScheme: "light" });
    // 夹具：只经存储写入若干到期/阶段进度（不伪造 Q/cur/answered）。
    await seed(p, {
      theme: "light", settings: { dailyNew: 5, groupSize: 5 },
      extraJs: `const now=Date.now();let made=[];
        for(let i=0;i<v.getW().length&&made.length<14;i++){ if(!v.inScope(i))continue; made.push(i); }
        s.progress={};
        made.forEach((i,k)=>{ s.progress[i]=[3, k<10 ? now-3600000*(k+1) : now+86400000*3, 1, 0, now-1000]; });`,
    });
    p.clearLogs();
    await click(p, '[data-v="list"]');
    await fill(p, "#q", "an");
    const listFilterBefore = await p.eval(`({q:document.querySelector('#q').value,fst:document.querySelector('#fst').value,
      fsc:document.querySelector('#fsc').value,count:window.__vocab.getFilterIndices().length})`);
    await click(p, '[data-v="stats"]');
    await p.waitFor("document.querySelectorAll('#v-stats details.stats-details').length===6");
    const scopeSettings = await p.eval(`(() => {const s=window.__vocab.getS().settings;return {fmin:s.fmin,fmax:s.fmax,pmin:s.pmin,kyOnly:s.kyOnly,pos:s.pos,posMode:s.posMode};})()`);
    const groupBefore = await p.eval(GROUP);

    // G1 复习负荷日期柱 → 下钻
    await openStatsPanel(p, "statsForecastPanel");
    await click(p, "#forecast [data-fc-label]");
    await p.waitFor("!document.querySelector('#btnDrillDueDay').disabled");
    const dueBtnText = await p.eval("document.querySelector('#btnDrillDueDay').textContent");
    await click(p, "#btnDrillDueDay");
    await p.waitFor("!document.querySelector('#listDrillChip').hidden && document.querySelector('#v-list').classList.contains('on')");
    const dueDrill = await p.eval(`(() => {const v=window.__vocab,s=v.getS().settings;
      return {drill:v.getStatsDrill(),indices:v.getStatsDrillIndices().length,
        chip:document.querySelector('#listDrillSource').textContent,count:document.querySelector('#listDrillCount').textContent,
        listCount:document.querySelector('#listCount').textContent,filterVals:{q:document.querySelector('#q').value,fst:document.querySelector('#fst').value,fsc:document.querySelector('#fsc').value},
        settings:{fmin:s.fmin,fmax:s.fmax,pmin:s.pmin,kyOnly:s.kyOnly,pos:s.pos,posMode:s.posMode},group:${GROUP}};})()`);
    sectionCheck(S, dueDrill.drill && dueDrill.drill.kind === "due" && dueDrill.indices > 0
      && dueDrill.count.includes(String(dueDrill.indices)) && /统计下钻/.test(dueDrill.chip) && /共 \d+ 词/.test(dueDrill.listCount),
      "G：复习负荷日期柱下钻词集与统计 N 一致并显示来源 chip", { dueBtnText, drill: dueDrill.drill, indices: dueDrill.indices, chip: dueDrill.chip, count: dueDrill.count });
    sectionCheck(S, same(scopeSettings, dueDrill.settings) && same(groupBefore, dueDrill.group),
      "G：下钻不改学习范围设置（fmin/fmax/pmin/kyOnly/pos）与当前组", { settings: dueDrill.settings });
    await shot(p, S, "drill-due-list-1440");
    await click(p, "#btnBackToStats");
    await p.waitFor("document.querySelector('#v-stats').classList.contains('on')");
    const dueReturn = await p.eval(`({panel:document.querySelector('#statsForecastPanel').open,
      selected:window.__vocab.getStatsSelection().forecast,chipHidden:document.querySelector('#listDrillChip').hidden,
      q:document.querySelector('#q').value,count:window.__vocab.getFilterIndices().length})`);
    sectionCheck(S, dueReturn.panel === true && dueReturn.selected >= 0 && dueReturn.chipHidden,
      "G：返回统计保留展开面板与选中柱", dueReturn);
    await click(p, '[data-v="list"]');
    await p.waitFor("document.querySelector('#v-list').classList.contains('on')");
    const restoredFilter = await p.eval(`({q:document.querySelector('#q').value,fst:document.querySelector('#fst').value,
      fsc:document.querySelector('#fsc').value,count:window.__vocab.getFilterIndices().length})`);
    sectionCheck(S, restoredFilter.q === listFilterBefore.q && restoredFilter.fst === listFilterBefore.fst
      && restoredFilter.fsc === listFilterBefore.fsc && restoredFilter.count === listFilterBefore.count,
      "G：返回后进入词表恢复进入前的搜索/状态/范围与词数", { restoredFilter, listFilterBefore });
    await click(p, '[data-v="stats"]');
    await p.waitFor("document.querySelector('#v-stats').classList.contains('on')");

    // G2 词频分层 → 下钻
    await openStatsPanel(p, "statsFreqPanel");
    await click(p, "#freqMastery .fm-drill:not([disabled])");
    await p.waitFor("!document.querySelector('#listDrillChip').hidden && document.querySelector('#v-list').classList.contains('on')");
    const freqDrill = await p.eval(`({kind:(window.__vocab.getStatsDrill()||{}).kind,indices:window.__vocab.getStatsDrillIndices().length,
      chip:document.querySelector('#listDrillSource').textContent,count:document.querySelector('#listDrillCount').textContent,group:${GROUP}})`);
    sectionCheck(S, freqDrill.kind === "freq" && freqDrill.indices > 0 && /词频层/.test(freqDrill.chip)
      && freqDrill.count.includes(String(freqDrill.indices)) && same(groupBefore, freqDrill.group),
      "G：词频分层下钻词集与统计口径一致、不改当前组", freqDrill);
    await click(p, "#btnBackToStats");
    await p.waitFor("document.querySelector('#v-stats').classList.contains('on')");
    sectionCheck(S, (await p.eval("document.querySelector('#statsFreqPanel').open")) === true,
      "G：词频下钻返回后该统计面板仍展开");

    // G3 掌握阶段档位 → 下钻（真实指针选择有词的档位）
    await openStatsPanel(p, "statsStagesPanel");
    const stagePts = await p.eval(`[...document.querySelectorAll('#stages [data-stage-label]')].map(x=>{const r=x.getBoundingClientRect();return {cx:r.x+r.width/2,cy:r.y+r.height/2};})`);
    let stageReady = null;
    for (let i = 0; i < stagePts.length; i++) {
      await p.click(stagePts[i].cx, stagePts[i].cy);
      await sleep(110);
      stageReady = await p.eval(`({disabled:document.querySelector('#btnDrillStage').disabled,text:document.querySelector('#btnDrillStage').textContent,selected:window.__vocab.getStatsSelection().stage})`);
      if (!stageReady.disabled) break;
    }
    sectionCheck(S, !!stageReady && !stageReady.disabled && /查看/.test(stageReady.text) && stageReady.selected >= 0,
      "G：统计阶段档位选择后「查看该档词」可用", stageReady);
    await click(p, "#btnDrillStage");
    await p.waitFor("!document.querySelector('#listDrillChip').hidden");
    const stageDrill = await p.eval(`({kind:(window.__vocab.getStatsDrill()||{}).kind,indices:window.__vocab.getStatsDrillIndices().length,
      chip:document.querySelector('#listDrillSource').textContent,count:document.querySelector('#listDrillCount').textContent,
      stage:window.__vocab.getStatsDrill()&&window.__vocab.getStatsDrill().stage,group:${GROUP}})`);
    sectionCheck(S, stageDrill.kind === "stage" && stageDrill.indices > 0 && /阶段/.test(stageDrill.chip)
      && stageDrill.count.includes(String(stageDrill.indices)) && same(groupBefore, stageDrill.group),
      "G：掌握阶段下钻词集与统计口径一致、不改当前组", stageDrill);
    await shot(p, S, "drill-stage-list-1440");
    await click(p, "#btnBackToStats");
    await p.waitFor("document.querySelector('#v-stats').classList.contains('on')");
    sectionCheck(S, (await p.eval("document.querySelector('#statsStagesPanel').open")) === true,
      "G：阶段下钻返回后该统计面板仍展开并保留选中档");

    // G4 无可还原词集的日期柱：禁用并说明
    await openStatsPanel(p, "statsForecastPanel");
    const fcCount = await p.eval("document.querySelectorAll('#forecast [data-fc-label]').length");
    let emptyState = null;
    for (let i = fcCount - 1; i >= 0; i--) {
      const point = await p.eval(`(() => {const e=[...document.querySelectorAll('#forecast [data-fc-label]')][${i}];
        if(!e)return null;e.scrollIntoView({block:'nearest',inline:'center'});const r=e.getBoundingClientRect();
        return {cx:r.x+r.width/2,cy:r.y+r.height/2};})()`);
      if (!point) continue;
      await sleep(90);
      await p.click(point.cx, point.cy);
      await sleep(110);
      const st = await p.eval(`({disabled:document.querySelector('#btnDrillDueDay').disabled,
        note:document.querySelector('#forecastDrillNote').textContent,selected:window.__vocab.getStatsSelection().forecast})`);
      if (st.disabled) { emptyState = st; break; }
    }
    sectionCheck(S, !!emptyState && /没有|先选择/.test(emptyState.note || ""),
      "G：该日期无可还原词集时下钻按钮禁用并说明原因", emptyState);
    sectionCheck(S, p.errors().length === 0, "G：统计下钻旅程无 console 错误/未捕获异常", p.errors());
    p.clearLogs();
  } finally {
    await p.close();
  }
}
async function sectionO1() {
  const S = "O1";
  const A = await openPage();
  const B = await openPage();
  const extra = [];
  try {
    for (const page of [A, B]) {
      await page.setViewport(1440, 1000);
      await page.setMedia({ colorScheme: "light" });
    }
    await seed(A, { theme: "light", settings: { dailyNew: 5, groupSize: 5 } });
    // 夹具：seed 模拟的是「已有旧主记录」的老用户，启动会迁移为 follow + 每书覆盖；
    // 这里把两页固定为「迁移完成后已显式仅本页、设备偏好无本书覆盖」的现代状态，再真实刷新。
    // 这是存储夹具初始化，不是业务写 hook；后续归属/词书切换全部走真实控件。
    const PREF_FIELDS = ["theme","keys","showPh","showEx","showFm","autoSpk","singleCharKeys","fontSize",
      "voiceURI","speechRate","actionKeys","gestures","actionLayout","cardDensity","readingOrder",
      "showCardMeta","showCardStage","showCardPos","secondaryActions"];
    await A.eval(`(() => {
      const s=window.__vocab.getS().settings, fields=${JSON.stringify(PREF_FIELDS)};
      const shared={}; for (const k of fields) shared[k]=JSON.parse(JSON.stringify(s[k]));
      shared.fontSize='standard'; shared.theme='light';
      try { sessionStorage.setItem('vocab_page_book_mode_v1','local'); sessionStorage.setItem('vocab_page_book_v1','kaoyan'); } catch(e){}
      localStorage.setItem('vocab_default_book_v1','kaoyan');
      localStorage.setItem('vocab_device_preferences_v1', JSON.stringify({kind:'vocab-device-preferences',version:1,
        shared:shared, overrides:{kaoyan:[],cet4:[],cet6:[],combined:[]}}));
    })()`);
    await A.reload();
    await A.waitFor('window.__vocab && document.querySelector("#card")');
    await B.reload();
    await B.waitFor('window.__vocab && document.querySelector("#card")');
    await sleep(250);
    A.clearLogs(); B.clearLogs();

    // 1) 新页默认「仅本页」，两页同书
    const start = await A.eval(`Object.assign({},window.__vocab.getPageBookState(),{book:window.__vocab.getBook(),group:${GROUP},
      pref:window.__vocab.getPreferenceOwnership()})`);
    sectionCheck(S, start.mode === "local" && start.book === "kaoyan" && start.activeSignal === "kaoyan"
      && start.migratedFollow === false && start.pref.currentOverrides.length === 0,
      "O1：迁移后新页默认「仅本页」、无本书覆盖并沿用上次词书", start);

    // 2) B 仅本页切四级 → A 不跟随、现场不变
    await click(B, "#btnBooks");
    await B.waitFor("!document.querySelector('#bookSheet').hidden");
    await click(B, '[data-book="cet4"]');
    await B.waitFor("window.__vocab.getBook()==='cet4'");
    await sleep(450);
    const afterB = await A.eval(`({book:window.__vocab.getBook(),group:${GROUP},activeSignal:localStorage.getItem('vocab_active_book_v1')})`);
    sectionCheck(S, afterB.book === "kaoyan" && same(start.group, afterB.group),
      "O1：B 仅本页切四级，A 不跟随且当前组/站点现场不变", { afterB, startGroup: start.group });

    // 3) B 本页切综合并设为下次默认；A 不切；C 新页开综合
    await click(B, "#btnBooks");
    await B.waitFor("!document.querySelector('#bookSheet').hidden");
    await click(B, '[data-book="combined"]');
    await B.waitFor("window.__vocab.getBook()==='combined'");
    await click(B, "#btnBooks");
    await B.waitFor("!document.querySelector('#bookSheet').hidden");
    await click(B, "#bookSetDefault");
    const bState = await B.eval(`Object.assign({},window.__vocab.getPageBookState(),{book:window.__vocab.getBook()})`);
    sectionCheck(S, bState.defaultBook === "combined" && bState.book === "combined",
      "O1：B「设为下次默认」保存综合词书且不切换本页以外页面", bState);
    await B.key("Escape");
    await B.waitFor("document.querySelector('#bookSheet').hidden");
    await sleep(400);
    sectionCheck(S, (await A.eval("window.__vocab.getBook()")) === "kaoyan",
      "O1：B 设下次默认不切换已打开的 A");
    const C = await openPage();
    extra.push(C);
    await C.setViewport(1440, 1000);
    const cBook = await C.eval(`({book:window.__vocab.getBook(),state:window.__vocab.getPageBookState()})`);
    sectionCheck(S, cBook.book === "combined", "O1：新开页面 C 按默认词书打开综合", cBook);
    await shot(A, S, "page-defaults-1440");

    // 4) 偏好归属：设备通用继承 → 本书覆盖 → 改设备通用
    await click(A, '[data-v="set"]');
    await A.scrollIntoView("#fontSizeSeg");
    await click(A, '#fontSizeSeg [data-font-size="large"]');
    await A.waitFor("document.documentElement.dataset.fontSize==='large'");
    await B.waitFor("document.documentElement.dataset.fontSize==='large' && window.__vocab.getS().settings.fontSize==='large'",
      { timeout: 10000, label: "B 继承设备字号" });
    const inherited = await A.eval(`(() => {const o=window.__vocab.getPreferenceOwnership();
      return {overrides:o.currentOverrides,shared:o.shared&&o.shared.fontSize,owns:window.__vocab.getPreferenceOwnership().overrides};})()`);
    sectionCheck(S, inherited.shared === "large" && !inherited.overrides.includes("fontSize"),
      "O1：未覆盖的字号改设备通用值，B 页面继承", inherited);

    await click(A, "#prefOwnBtn_fontSize");
    const overridden = await A.eval(`(() => {const o=window.__vocab.getPreferenceOwnership();
      return {overrides:o.currentOverrides,line:document.querySelector('#prefOwnState_fontSize').textContent,
        deviceBtnHidden:document.querySelector('#prefOwnDeviceBtn_fontSize').hidden,
        status:document.querySelector('#preferenceOwnershipStatus').textContent};})()`);
    sectionCheck(S, overridden.overrides.includes("fontSize") && /本书单独/.test(overridden.line)
      && overridden.deviceBtnHidden === false && /本书单独/.test(overridden.status),
      "O1：逐项归属控件把字号标记为「本书单独」并更新状态说明", overridden);
    await shot(A, S, "ownership-override-1440");

    await click(B, '[data-v="set"]');
    await B.scrollIntoView("#fontSizeSeg");
    await click(B, '#fontSizeSeg [data-font-size="standard"]');
    await B.waitFor("document.documentElement.dataset.fontSize==='standard'");
    await sleep(500);
    const afterDevice = await A.eval(`({font:document.documentElement.dataset.fontSize,own:window.__vocab.getPreferenceOwnership()})`);
    const bAfter = await B.eval(`({font:document.documentElement.dataset.fontSize,own:window.__vocab.getPreferenceOwnership()})`);
    sectionCheck(S, afterDevice.font === "large" && bAfter.font === "standard" && afterDevice.own.shared.fontSize === "standard"
      && afterDevice.own.currentOverrides.includes("fontSize") && !bAfter.own.currentOverrides.includes("fontSize"),
      "O1：A 本书覆盖大字后，B 改设备通用标准：B 变、A 保持覆盖值", { A: afterDevice.font, B: bAfter.font, shared: afterDevice.own.shared.fontSize });

    // 5) 跨页跟随：有现场先提示，明确接受才切
    await click(A, "#btnBooks");
    await A.waitFor("!document.querySelector('#bookSheet').hidden");
    await A.scrollIntoView("#bookPageModeFollow");
    await click(A, "#bookPageModeFollow");
    await A.waitFor("window.__vocab.getPageBookState().mode==='follow'");
    await click(A, "#bookClose");
    await A.waitFor("document.querySelector('#bookSheet').hidden");
    const groupBeforeFollow = await A.eval(GROUP);
    // B 也切到 follow：这样 B 的切书才会写旧 ACTIVE 跨页信号，A 才能收到并提示（local 页不写信号）。
    await click(B, "#btnBooks");
    await B.waitFor("!document.querySelector('#bookSheet').hidden");
    await B.scrollIntoView("#bookPageModeFollow");
    await click(B, "#bookPageModeFollow");
    await B.waitFor("window.__vocab.getPageBookState().mode==='follow'");
    await B.key("Escape");
    await B.waitFor("document.querySelector('#bookSheet').hidden");
    await click(B, "#btnBooks");
    await B.waitFor("!document.querySelector('#bookSheet').hidden");
    await click(B, '[data-book="cet6"]');
    await B.waitFor("window.__vocab.getBook()==='cet6'");
    await A.waitFor("!document.querySelector('#bookFollowNotice').hidden", { timeout: 8000, label: "A 跨页跟随提示" });
    const notice = await A.eval(`({text:document.querySelector('#bookFollowText').textContent,book:window.__vocab.getBook(),
      group:${GROUP},applyClickable:!!document.querySelector('#bookFollowApply')})`);
    sectionCheck(S, /另一页切到了/.test(notice.text) && /英语六级/.test(notice.text) && notice.book === "kaoyan"
      && same(groupBeforeFollow, notice.group) && notice.applyClickable,
      "O1：跟随页有现场时只提示另一页切书，不静默切换/不丢当前组", notice);
    await shot(A, S, "follow-notice-1440");
    await click(A, "#bookFollowApply");
    await A.waitFor("window.__vocab.getBook()==='cet6'", { timeout: 6000 });
    sectionCheck(S, (await A.eval("window.__vocab.getBook()")) === "cet6"
      && (await A.eval("document.querySelector('#bookFollowNotice').hidden")) === true,
      "O1：明确点「同步切换」后才切换并关闭提示");

    // 6) 三页 console 检查
    for (const page of [A, B, ...extra]) page.clearLogs();
    await sleep(300);
    const errs = [...A.errors(), ...B.errors(), ...extra.flatMap((page) => page.errors())];
    sectionCheck(S, errs.length === 0, "O1：多页面旅程无 console 错误/未捕获异常", errs);
  } finally {
    for (const page of extra) await page.close();
    await A.close();
    await B.close();
  }
}

/* ===========================================================================
 * 执行
 * ========================================================================= */
const RUN = { H: sectionH, F1: sectionF1, EG: sectionEG, O1: sectionO1, D1: sectionD1 };
try {
  for (const id of SECTION_IDS) {
    if (!wants(id)) continue;
    console.log("\n=== " + id + " " + SECTION_TITLES[id] + " ===");
    try {
      await RUN[id]();
    } catch (err) {
      sectionCheck(id, false, "段落执行完整（未抛异常）", { error: String((err && err.stack) || err) });
    }
  }
} finally {
  await rec.save({ shots, downloadsDir: downloads });
  conn.close();
  await chrome.close();
  await server.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
const counts = rec.counts();
console.log(JSON.stringify({ passed: counts["通过"] || 0, failed: counts["失败"] || 0, untested: counts["未测"] || 0,
  report: path.join(RESULTS_DIR, "new-optimizations.json"), screenshots: shots.length }));
if (counts["失败"]) process.exitCode = 1;
