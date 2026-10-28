#!/usr/bin/env node
/**
 * 批次A（2026-10-27）真实浏览器旅程：R03 保存并休息 / R04 5词停靠与纯复习 / R05 单词与例句朗读。
 *
 * 只以隔离临时 profile 的真实 Chrome 运行：真实点击、真实按键、真实刷新与真实布局几何；
 * 设备语音用页面初始化脚本替换为可观测的假 speechSynthesis（仅采集 utterance 与 speak/cancel 调用，
 * 不外放声音），业务判定、队列、进度与完成页全部走真实生产代码，不写业务 hook 伪造学习结果。
 * 测试夹具只允许写 localStorage / 清除会话快照来准备场景。
 *
 * 运行：node --max-old-space-size=512 tests/browser/check-batch-a.mjs
 * 报告：tests/reports/browser/results/batch-a.json（ignored）
 * 截图：tests/reports/browser/shots/batch-a-*.png（ignored）
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  startStaticServer, launchChrome, connect, Page, sleep, RESULTS_DIR, REPO_ROOT,
} from "./cdp.mjs";

const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(path.join(REPO_ROOT, file))).digest("hex");
const fingerprint = () => Object.fromEntries(
  ["index.html", "js/app.js", "css/app.css", "sw.js"].map((f) => [f, sha(f)])
);

/* 假设备语音：只捕获 utterance / speak / cancel，绝不发声，也不依赖系统已装语音。
 * 因为是真实 app.js 的 speak() 调到这里，所以能断言语言、语速、慢速比例与取消/迟到回调。 */
const FAKE_SPEECH = `(() => {
  const state = {
    utterances: [], speakCalls: 0, cancelCalls: 0, autoStart: true,
    voices: [
      {name: "BatchA English (US)", lang: "en-US", voiceURI: "batcha-en-US", "default": true, localService: true},
      {name: "BatchA English (GB)", lang: "en-GB", voiceURI: "batcha-en-GB", "default": false, localService: true}
    ]
  };
  window.__audioFake = state;
  function FakeUtterance(text){
    this.text = String(text); this.lang = ""; this.rate = 1; this.pitch = 1; this.volume = 1;
    this.voice = null; this.onstart = null; this.onend = null; this.onerror = null;
    this.onpause = null; this.onresume = null; this.onboundary = null;
    this.paused = false; this.pending = false; this.speaking = false;
  }
  const api = {
    getVoices(){ return state.voices.map(v => Object.assign({}, v)); },
    speak(u){
      state.speakCalls++;
      state.utterances.push(u);
      if (state.autoStart && typeof u.onstart === "function") {
        setTimeout(() => { try { u.onstart(); } catch (e) {} }, 0);
      }
    },
    cancel(){ state.cancelCalls++; },
    pause(){}, resume(){},
    addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return false; },
    pending: false, speaking: false, paused: false, onvoiceschanged: null
  };
  try { Object.defineProperty(window, "speechSynthesis", {configurable: true, get(){ return api; }}); }
  catch (e) { try { window.speechSynthesis = api; } catch (e2) {} }
  try { Object.defineProperty(window, "SpeechSynthesisUtterance", {configurable: true, writable: true, value: FakeUtterance}); }
  catch (e) { try { window.SpeechSynthesisUtterance = FakeUtterance; } catch (e2) {} }
})();`;

const report = {
  name: "batch-a",
  startedAt: new Date().toISOString(),
  sources: fingerprint(),
  checks: [],
  errors: [],
  shots: [],
  fixtures: [],
  defects: [],
  notes: [
    "首轮（本次会话早先运行）375×812 #spk 实测 40×40，低于 ≥44px 契约；Lead 修复 css/app.css 批次A媒体查询后，本轮复验 375 #spk=44×44、#spkSlow/#spkStop 高度 44px。",
    "sources 指纹取自本轮运行前；sourcesStable=true 表示运行期间 index.html/js/app.js/css/app.css/sw.js 字节未变化。",
    "复核修复批次（P1-1/P2-1/P2-2/P2-4）在本文件新增真实断言：休息后继续并完成本组自动续背资格、待应用设置提示在休息页隐藏/继续后恢复、存储失败持续错误下完成页「继续学习」不开组且清除错误后可继续、无候选纯复习完成页 #again 禁用。",
    "观察（非本批断言）：在完成页注入主记录写入失败后约 1 秒内，本组结束触发的学习时长 flush 若同样写入失败，会把「重试保存并休息」持续错误覆盖为通用「进度保存失败」；本次 P2-2 用例在注入前先等一个 studyTimeTick 让时长落盘，以稳定断言 P2-2 契约。该竞态未修改产品代码，已报告 Lead 供评估。",
  ],
  limits: [
    "Chrome headless 隔离 profile；375×812 手机视口与深色主题为仿真，不代表真机、读屏或系统语音验收",
    "设备语音被内存中的假 speechSynthesis 替换以采集 utterance/speak/cancel；真实发声、离线语音与语音质量未验证",
    "刷新使用 CDP Page.reload（真实整页重载与新文档初始化），不是物理 F5；会话快照恢复走真实启动路径",
    "自动续背只验证资格/阶段与状态文案，不等待 30 秒闲置与 3 秒倒计时（真实计时由既有 check-empty-wait 覆盖）",
    "R03 本组进行中的保存失败分支未注入；P2-2 只在完成页通过覆盖 Storage.prototype.setItem 注入真实写入失败（非真实磁盘配额耗尽），未测刷新后持续错误恢复；跨标签推进、真机触摸与 Safari/Firefox 未覆盖",
    "纯复习候选与到期词由 localStorage 夹具预置，不代表真实多日学习数据分布",
    "146px 桌面短高动作区档位未覆盖（本批只取 375×812=151 与 1440×1000=156）",
  ],
};

const check = (name, ok, actual = "") => {
  report.checks.push({ name, ok: !!ok, actual });
  console.log((ok ? "PASS " : "FAIL ") + name);
  return !!ok;
};
const shot = async (page, name) => {
  const file = await page.screenshot("batch-a-" + name + ".png");
  report.shots.push(file);
  return file;
};

const server = await startStaticServer();
const chrome = await launchChrome({ windowSize: "1440,1000" });
const conn = await connect(chrome.wsUrl);
let page = null;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 只读现场：不通过业务 hook 改状态。 */
const SCENE = `(() => {
  const v = window.__vocab, s = v.getS(), d = new Date();
  const day = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const a = v.getAutoResumeState();
  return {
    book: v.getBook(), cur: v.cur, phase: v.phase, verdict: v.verdict,
    answered: v.answered, rightN: v.qi, qi: v.qi, total: v.getGroupTotal(),
    Q: v.Q.slice(), plan: v.getPlan(), day: JSON.parse(JSON.stringify(s.days[day] || null)),
    ledger: v.getReviewLedger(), n: (s.days[day] || {}).n || 0, r: (s.days[day] || {}).r || 0,
    dailyNew: s.settings.dailyNew, theme: document.documentElement.dataset.theme || "",
    resting: v.isResting(), stop: v.getStopTarget(),
    snapshot: {valid: v.getSessionSnapshotState().valid, reason: v.getSessionSnapshotState().reason},
    auto: {phase: a.phase, eligible: a.eligible, completedPage: a.completedPage, waitingForDue: a.waitingForDue, pausedToday: a.pausedToday},
    canContinue: (() => { const b = document.querySelector("#again"); return b ? {exists: true, disabled: b.disabled, text: b.textContent} : {exists: false}; })()
  };
})()`;

const VISIBLE = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  return {
    w: r.width, h: r.height, x: r.x, y: r.y,
    hidden: !!el.hidden, display: cs.display, visibility: cs.visibility, opacity: Number(cs.opacity),
    disabled: !!el.disabled,
    inViewport: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
    text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 240)
  };
})()`;

async function pkey(name) {
  await page.send("Page.bringToFront");
  await page.key(name);
  await sleep(20);
}
async function click(selector, { settle = 90 } = {}) {
  await page.send("Page.bringToFront");
  await page.scrollIntoView(selector);
  await sleep(70);
  if (!(await page.isClickable(selector))) throw new Error("控件无法真实命中：" + selector);
  await page.clickSelector(selector);
  await sleep(settle);
}
/** 真实键盘判定并等待揭示。 */
async function judge(keyName = "keyF") {
  await pkey(keyName);
  await page.waitFor('window.__vocab.phase === "revealed"', { timeout: 8000, label: "判定后揭示" });
}
/** 真实点击 #nx 翻页；完成时 cur 为空。 */
async function nextByButton() {
  await click("#nx");
  await page.waitFor('window.__vocab.cur === null || (window.__vocab.phase === "recall" && window.__vocab.cur !== null)',
    { timeout: 8000, label: "下一个" });
}

/**
 * 夹具：只写 localStorage（清空快照用 new-document 脚本，避免上一次 pagehide 写回旧现场），
 * 然后真实 reload 让生产启动路径自然开组。
 */
async function seed(opts = {}) {
  const cfg = Object.assign({
    width: 1440, height: 1000, theme: "light", dailyNew: 3, groupSize: 3, cap: 100,
    due: 0, dayNew: 0, enabled: false, threshold: 1, idleMs: 30000, countdownMs: 3000, order: "freq",
  }, opts);
  report.fixtures.push({
    width: cfg.width, height: cfg.height, theme: cfg.theme, dailyNew: cfg.dailyNew,
    groupSize: cfg.groupSize, cap: cfg.cap, due: cfg.due, dayNew: cfg.dayNew,
    autoResume: cfg.enabled ? "enabled" : "disabled",
  });
  await page.setViewport(cfg.width, cfg.height, { mobile: cfg.width < 500 });
  const { identifier } = await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));",
  });
  try {
    await page.eval(`(() => {
      const s = JSON.parse(JSON.stringify(window.__vocab.getS()));
      const now = Date.now(), d = new Date();
      const day = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      s.dv = 3; s.progress = {}; s.days = {}; s.stars = {}; s.proficient = {}; s.timeSec = 0;
      s.reviewDay = {d: day, used: 0}; s.extraDay = {d: day, extra: 0}; s.spelling = {};
      // 夹具允许预置「今天已学 dayNew 个新词」的既有日记录，用于把新词额度耗尽（不伪造逐词进度）。
      if (${cfg.dayNew} > 0) s.days[day] = {n: ${cfg.dayNew}, r: ${cfg.dayNew}, ok: ${cfg.dayNew}, no: 0};
      for (let i = 0; i < ${cfg.due}; i++) s.progress[i] = [1, now - 1000, 1, 0, now - 86400000];
      Object.assign(s.settings, {
        dailyNew: ${cfg.dailyNew}, groupSize: ${cfg.groupSize}, dailyReviewCap: ${cfg.cap},
        order: ${JSON.stringify(cfg.order)}, pmin: 0, fmin: 1, fmax: 0, pos: [], posMode: "primary",
        kyOnly: false, theme: ${JSON.stringify(cfg.theme)}, fontSize: "standard", autoSpk: false,
        singleCharKeys: true,
        keys: {know: "f", dont: "j", next: " ", speak: "s", star: "b", proficient: "m"},
        actionKeys: {continue: null, wait: null, return: null, listSearch: null},
        autoResume: {enabled: ${cfg.enabled}, threshold: ${cfg.threshold}, idleMs: ${cfg.idleMs}, countdownMs: ${cfg.countdownMs}}
      });
      localStorage.clear(); sessionStorage.clear();
      localStorage.setItem("kaoyan_vocab_v1", JSON.stringify(s));
      localStorage.setItem("kaoyan_vocab_proficient_v1", "{}");
      localStorage.setItem("vocab_active_book_v1", "kaoyan");
      localStorage.setItem("vocab_guide_v1", JSON.stringify({version: 1, dismissedAt: new Date().toISOString()}));
    })()`);
    await page.reload();
    await page.waitFor('window.__vocab && window.__vocab.cur !== null', { timeout: 30000, label: "夹具开组" });
    await page.send("Page.bringToFront");
    await sleep(220); // 等词卡进入动画/布局落定后再测几何
  } finally {
    await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  }
}

/* 朗读观测：假 speechSynthesis 的只读快照。 */
const AUDIO = `(() => {
  const f = window.__audioFake, u = f.utterances[f.utterances.length - 1];
  const v = window.__vocab, p = v.getSpeechPlayback();
  return {
    speakCalls: f.speakCalls, cancelCalls: f.cancelCalls, count: f.utterances.length,
    last: u ? {text: u.text, lang: u.lang, rate: u.rate, voice: u.voice && u.voice.voiceURI} : null,
    playback: {status: p.status, kind: p.kind, slow: p.slow, text: p.text},
    wordStatus: document.querySelector("#wordAudioStatus") ? document.querySelector("#wordAudioStatus").textContent : null,
    spkPressed: document.querySelector("#spk") ? document.querySelector("#spk").getAttribute("aria-pressed") : null,
    slowPressed: document.querySelector("#spkSlow") ? document.querySelector("#spkSlow").getAttribute("aria-pressed") : null,
    stopDisabled: document.querySelector("#spkStop") ? document.querySelector("#spkStop").disabled : null
  };
})()`;

try {
  page = await Page.open(conn, { url: server.url("/index.html"), initScripts: [FAKE_SPEECH] });
  await page.waitFor('window.__vocab && document.querySelector("#card")', { timeout: 60000, label: "app.js 初始化" });
  await page.send("Page.bringToFront");

  /* ================================================================== *
   * 组一：1440×1000 浅色 —— R05 朗读控制（正常/慢速/停止/例句/换词防护）
   * ================================================================== */
  await seed({ width: 1440, height: 1000, theme: "light", dailyNew: 3, groupSize: 3 });
  let scene = await page.eval(SCENE);
  check("1440×1000 浅色主题生效", scene.theme === "light", scene.theme);

  const readVisible = async (sel) => page.eval(VISIBLE(sel));
  const spk = await readVisible("#spk");
  const spkSlow = await readVisible("#spkSlow");
  const spkStop = await readVisible("#spkStop");
  const audioGroup = await readVisible("#card .word-audio");
  const sentenceGroupsBefore = await page.eval('document.querySelectorAll("#card .answer [data-audio-text]").length');
  const visOk = (r) => !!r && !r.hidden && r.display !== "none" && r.visibility !== "hidden"
    && Number(r.opacity) !== 0 && r.w > 2 && r.h > 2 && r.inViewport;
  check("1440 回忆态 #spk/#spkSlow/#spkStop 真实可见", visOk(spk) && visOk(spkSlow) && visOk(spkStop) && visOk(audioGroup),
    { spk, spkSlow, spkStop });
  check("1440 #spk 命中区 ≥44px（亚像素取整）",
    !!spk && Math.round(spk.w) >= 44 && Math.round(spk.h) >= 44, spk && { w: spk.w, h: spk.h });
  check("1440 #spkStop 初始 disabled", !!spkStop && spkStop.disabled === true, spkStop && spkStop.disabled);
  check("1440 判定前没有例句朗读组", sentenceGroupsBefore === 0, sentenceGroupsBefore);
  await shot(page, "1440-r05-recall");

  await click("#spk");
  await page.waitFor(`["准备中","朗读中"].includes(document.querySelector("#wordAudioStatus").textContent)`,
    { timeout: 6000, label: "单词朗读状态" });
  let audio = await page.eval(AUDIO);
  const normalRate = audio.last && audio.last.rate;
  check("真实点击 #spk：提交英语 utterance 且状态/按下态可见",
    audio.speakCalls >= 1 && !!audio.last && /^en/i.test(audio.last.lang)
      && ["准备中", "朗读中"].includes(audio.wordStatus) && audio.spkPressed === "true" && audio.stopDisabled === false,
    audio);

  const beforeSlowCalls = audio.speakCalls;
  await click("#spkSlow");
  await page.waitFor(`window.__audioFake.speakCalls > ${beforeSlowCalls}`, { timeout: 6000, label: "慢速朗读提交" });
  audio = await page.eval(AUDIO);
  check("真实点击 #spkSlow：新 utterance 约为正常语速 ×0.75 且不低于 0.5",
    !!audio.last && Math.abs(audio.last.rate - normalRate * 0.75) <= 0.02 && audio.last.rate >= 0.5,
    { normalRate, slowRate: audio.last && audio.last.rate });

  const beforeStopCancel = audio.cancelCalls;
  await click("#spkStop");
  await page.waitFor('document.querySelector("#wordAudioStatus").textContent === "已停止"',
    { timeout: 6000, label: "朗读已停止" });
  audio = await page.eval(AUDIO);
  check("真实点击 #spkStop：cancel 被调用、停止键禁用、状态已停止、aria-pressed=false",
    audio.cancelCalls > beforeStopCancel && audio.wordStatus === "已停止"
      && audio.stopDisabled === true && audio.spkPressed === "false" && audio.slowPressed === "false",
    audio);

  /* 普通例句控件是answer的直接子节点；义项证据另有折叠内的控件，不能误选隐藏项。
   * 判定前的泄题检查仍覆盖所有后代，判定后的原58项只定位原本的普通例句。 */
  await judge("keyF");
  const sentence = await page.eval(`(() => {
    const v = window.__vocab, ex = v.getW()[v.cur].ex;
    const group = document.querySelector("#card .answer > [data-audio-text]");
    const play = [...document.querySelectorAll("#card .answer > [data-audio-text] [data-audio-play]")];
    const stop = document.querySelector("#card .answer > [data-audio-text] [data-audio-stop]");
    const clickable = (sel) => { const el = document.querySelector(sel); if (!el) return false;
      const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (r.width < 2 || r.height < 2 || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
      const hit = document.elementFromPoint(x, y); return !!(hit && (hit === el || el.contains(hit))); };
    return {
      ex, count: document.querySelectorAll("#card .answer > [data-audio-text]").length,
      groupText: group && group.dataset.audioText, kind: group && group.dataset.audioKind,
      plays: play.map(b => ({mode: b.dataset.audioPlay, text: b.textContent, disabled: b.disabled, pressed: b.getAttribute("aria-pressed")})),
      stopDisabled: stop && stop.disabled,
      normalClickable: clickable('#card .answer > [data-audio-text] [data-audio-play="normal"]'),
      slowClickable: clickable('#card .answer > [data-audio-text] [data-audio-play="slow"]')
    };
  })()`);
  check("真实按键 F 揭示后出现例句朗读组且 normal/slow 可达、stop 初始禁用",
    sentence.count === 1 && sentence.kind === "sentence" && sentence.plays.length === 2
      && sentence.normalClickable && sentence.slowClickable && sentence.stopDisabled === true,
    sentence);
  check("例句朗读组只含英文原句，不含中文来源标签",
    sentence.groupText === sentence.ex && !/[\u4e00-\u9fff]/.test(sentence.groupText || ""),
    { groupText: sentence.groupText, ex: sentence.ex });

  const beforeSentenceCalls = (await page.eval(AUDIO)).speakCalls;
  await click('#card .answer > [data-audio-text] [data-audio-play="slow"]');
  await page.waitFor(`window.__audioFake.speakCalls > ${beforeSentenceCalls}`, { timeout: 6000, label: "例句慢速提交" });
  const sentenceAudio = await page.eval(`(() => {
    const f = window.__audioFake, u = f.utterances[f.utterances.length - 1];
    const group = document.querySelector("#card .answer > [data-audio-text]");
    return {
      text: u.text, lang: u.lang, rate: u.rate,
      groupStatus: group.querySelector(".audio-status").textContent,
      slowPressed: group.querySelector('[data-audio-play="slow"]').getAttribute("aria-pressed"),
      normalPressed: group.querySelector('[data-audio-play="normal"]').getAttribute("aria-pressed"),
      stopDisabled: group.querySelector("[data-audio-stop]").disabled,
      wordStatus: document.querySelector("#wordAudioStatus").textContent
    };
  })()`);
  check("真实点击例句「慢速」：utterance 文本等于当前词例句且为英文",
    sentenceAudio.text === sentence.ex && !/[\u4e00-\u9fff]/.test(sentenceAudio.text || "")
      && /^en/i.test(sentenceAudio.lang || ""),
    sentenceAudio);
  check("例句播放状态只落在例句组，单词组不被误标",
    sentenceAudio.groupStatus === "朗读中" && sentenceAudio.slowPressed === "true"
      && sentenceAudio.normalPressed === "false" && sentenceAudio.stopDisabled === false
      && sentenceAudio.wordStatus === "" && (await page.eval('document.querySelector("#spk").getAttribute("aria-pressed")')) === "false",
    sentenceAudio);

  await click('#card .answer > [data-audio-text] [data-audio-stop]');
  const sentenceStopped = await page.eval(`(() => {
    const group = document.querySelector("#card .answer > [data-audio-text]");
    return {status: group.querySelector(".audio-status").textContent,
      stopDisabled: group.querySelector("[data-audio-stop]").disabled,
      slowPressed: group.querySelector('[data-audio-play="slow"]').getAttribute("aria-pressed")};
  })()`);
  check("真实点击例句「停止」：例句组回到已停止且释放按下态",
    sentenceStopped.status === "已停止" && sentenceStopped.stopDisabled === true && sentenceStopped.slowPressed === "false",
    sentenceStopped);

  /* 换词串卡防护：播放单词 → 真实 F 判定 → 真实点 #nx 换词 → 迟到回调不得串卡。 */
  await nextByButton();
  await page.waitFor('window.__vocab.cur !== null && window.__vocab.phase === "recall"', { label: "下一词回忆态" });
  const switchedWord = (await page.eval(SCENE)).cur;
  await click("#spk");
  await page.waitFor('window.__vocab.getSpeechPlayback().status === "playing"', { timeout: 6000, label: "换词前单词朗读中" });
  await page.eval(`window.__batchAOldUtterance = window.__audioFake.utterances[window.__audioFake.utterances.length - 1];
    window.__batchACancelBefore = window.__audioFake.cancelCalls; true`);
  await pkey("keyF");
  await page.waitFor('window.__vocab.phase === "revealed"', { label: "换词前判定" });
  await click("#nx");
  await page.waitFor('window.__vocab.cur !== null && window.__vocab.cur !== ' + JSON.stringify(switchedWord)
    + ' && window.__vocab.phase === "recall"', { timeout: 8000, label: "换到下一词" });
  await sleep(260); // 任务要求等待 ≥200ms 后检查迟到的上一段状态
  const afterSwitch = await page.eval(`(() => {
    const v = window.__vocab, p = v.getSpeechPlayback();
    return {status: document.querySelector("#wordAudioStatus").textContent,
      wordStatus: document.querySelector("#wordAudioStatus").textContent,
      pressed: document.querySelector("#spk").getAttribute("aria-pressed"),
      slowPressed: document.querySelector("#spkSlow").getAttribute("aria-pressed"),
      playback: p.status, cancelCalls: window.__audioFake.cancelCalls, cancelBefore: window.__batchACancelBefore,
      sameCard: v.cur === ${JSON.stringify(switchedWord)}};
  })()`);
  check("换词后上一段「朗读中」不会串到新卡（≥200ms）",
    afterSwitch.status !== "朗读中" && afterSwitch.pressed === "false"
      && afterSwitch.slowPressed === "false" && afterSwitch.playback !== "playing"
      && afterSwitch.cancelCalls > afterSwitch.cancelBefore && afterSwitch.sameCard === false,
    afterSwitch);
  await page.eval('window.__batchAOldUtterance && window.__batchAOldUtterance.onend && window.__batchAOldUtterance.onend(); true');
  await sleep(120);
  const afterLateEnd = await page.eval(`(() => {
    const v = window.__vocab, p = v.getSpeechPlayback();
    return {status: document.querySelector("#wordAudioStatus").textContent,
      pressed: document.querySelector("#spk").getAttribute("aria-pressed"),
      playback: p.status, text: p.text, kind: p.kind};
  })()`);
  check("换词后手动触发旧 utterance.onend，不会把新卡标成播放中",
    afterLateEnd.status !== "朗读中" && afterLateEnd.status !== "已结束"
      && afterLateEnd.pressed === "false" && afterLateEnd.playback !== "playing",
    afterLateEnd);

  /* #acts 几何：判定前后都必须是桌面 156px，横向不溢出。 */
  const geometry = `(() => {
    const a = document.querySelector("#acts").getBoundingClientRect();
    return {h: a.height, docW: document.documentElement.scrollWidth, innerW: innerWidth};
  })()`;
  const recallGeo = await page.eval(geometry);
  check("1440 回忆态 #acts 保持 156px 且无横向溢出",
    Math.abs(recallGeo.h - 156) <= 1 && recallGeo.docW <= recallGeo.innerW + 1, recallGeo);
  await pkey("keyF");
  await page.waitFor('window.__vocab.phase === "revealed"', { label: "几何揭示态" });
  const revealedGeo = await page.eval(geometry);
  check("1440 揭示态 #acts 保持 156px 且无横向溢出",
    Math.abs(revealedGeo.h - 156) <= 1 && revealedGeo.docW <= revealedGeo.innerW + 1, revealedGeo);
  await shot(page, "1440-r05-sentence");

  /* ================================================================== *
   * 组一继续：1440×1000 浅色 —— R03 保存并休息、真实刷新恢复
   * ================================================================== */
  await seed({ width: 1440, height: 1000, theme: "light", dailyNew: 3, groupSize: 3 });
  await judge("keyF");
  await pkey("Space");
  await page.waitFor('window.__vocab.cur !== null && window.__vocab.phase === "recall"', { label: "R03 第二张回忆态" });
  let beforeRest = await page.eval(SCENE);
  const restWord = beforeRest.cur;

  await click("#btnSaveRest");
  const restUi = await page.eval(`(() => {
    const v = window.__vocab, rs = v.getRestState();
    return {
      resting: v.isResting(), doneRest: !!document.querySelector("#card .done-rest"),
      h2: (document.querySelector("#card h2") || {}).textContent || "",
      cardText: (document.querySelector("#card") || {}).textContent || "",
      resume: !!document.querySelector("#restResume"),
      saveRestHidden: document.querySelector("#btnSaveRest").hidden,
      saveRestDisabled: document.querySelector("#btnSaveRest").disabled,
      snapshotSaved: !!(rs.restState && rs.restState.snapshotSaved),
      restCur: rs.cur, answered: rs.answered, groupTotal: rs.groupTotal,
      completionCard: !!document.querySelector("#card .done:not(.done-rest)")
    };
  })()`);
  check("真实点击 #btnSaveRest 出现休息页并确认已保存", restUi.resting === true && restUi.doneRest === true
    && restUi.h2.includes("已保存，先休息") && restUi.cardText.includes("学习记录已保存")
    && restUi.resume === true && restUi.snapshotSaved === true, restUi);
  check("休息页不把未完成组伪装成本组完成，且入口隐藏",
    restUi.completionCard === false && restUi.saveRestHidden === true && restUi.answered === beforeRest.answered
      && restUi.groupTotal === beforeRest.total && restUi.restCur === restWord, restUi);
  await shot(page, "1440-r03-rest");

  await click("#restResume");
  const resumed = await page.eval(`(() => {
    const v = window.__vocab;
    return {cur: v.cur, resting: v.isResting(), wordFace: !!document.querySelector("#card .word-face"),
      phase: v.phase, answered: v.answered, total: v.getGroupTotal()};
  })()`);
  check("点「继续本组」回到同一单词并恢复学习卡", resumed.cur === restWord && resumed.resting === false
    && resumed.wordFace === true && resumed.phase === "recall"
    && resumed.answered === beforeRest.answered && resumed.total === beforeRest.total, resumed);

  const afterResume = await page.eval(SCENE);
  check("保存并离开再继续本组不额外作答/不消费额度",
    same({day: afterResume.day, ledger: afterResume.ledger, n: afterResume.n, r: afterResume.r},
      {day: beforeRest.day, ledger: beforeRest.ledger, n: beforeRest.n, r: beforeRest.r}), afterResume);

  await click("#btnSaveRest");
  const beforeReload = await page.eval(SCENE);
  await page.reload();
  await page.waitFor('window.__vocab && document.querySelector("#card")', { timeout: 30000, label: "R03 刷新后启动" });
  try {
    await page.waitFor('window.__vocab.cur === ' + JSON.stringify(beforeReload.cur), { timeout: 10000 });
  } catch { /* 下面用断言说明恢复失败 */ }
  await sleep(200);
  const afterReload = await page.eval(SCENE);
  check("真实刷新后恢复到同一单词与同一组", afterReload.cur === beforeReload.cur
    && afterReload.answered === beforeReload.answered && afterReload.total === beforeReload.total
    && afterReload.qi === beforeReload.qi, {
    before: {cur: beforeReload.cur, answered: beforeReload.answered, total: beforeReload.total, qi: beforeReload.qi},
    after: {cur: afterReload.cur, answered: afterReload.answered, total: afterReload.total, qi: afterReload.qi},
  });
  check("刷新恢复来自合法会话快照且不进入休息态", afterReload.snapshot.valid === true
    && afterReload.resting === false && (await page.eval('!document.querySelector("#card .done-rest")')) === true,
    afterReload.snapshot);
  check("休息并刷新不增加今日作答/额度，进度摘要一致",
    same({day: afterReload.day, ledger: afterReload.ledger},
      {day: beforeRest.day, ledger: beforeRest.ledger})
      && afterReload.n === beforeRest.n && afterReload.r === beforeRest.r
      && afterReload.answered === beforeReload.answered && afterReload.total === beforeReload.total, {
    before: {day: beforeRest.day, ledger: beforeRest.ledger},
    after: {day: afterReload.day, ledger: afterReload.ledger},
  });

  /* R03 补充：已揭示（F）后保存并休息，继续后仍是同一张已判定卡，释义不丢。 */
  await seed({ width: 1440, height: 1000, theme: "light", dailyNew: 3, groupSize: 3 });
  await judge("keyF");
  const revealedBefore = await page.eval(`(() => {
    const v = window.__vocab;
    return {cur: v.cur, verdict: v.verdict, phase: v.phase, answer: !!document.querySelector("#card .answer"),
      wordFace: !!document.querySelector("#card .word-face"), answered: v.answered, total: v.getGroupTotal()};
  })()`);
  await click("#btnSaveRest");
  const revealedRest = await page.eval(`({resting: window.__vocab.isResting(),
    h2: (document.querySelector("#card h2") || {}).textContent || ""})`);
  await click("#restResume");
  const revealedAfter = await page.eval(`(() => {
    const v = window.__vocab;
    return {cur: v.cur, verdict: v.verdict, phase: v.phase, answer: !!document.querySelector("#card .answer"),
      wordFace: !!document.querySelector("#card .word-face"), answered: v.answered, total: v.getGroupTotal()};
  })()`);
  check("揭示态保存并休息后恢复同一张已判定卡（verdict/.answer 不丢）",
    revealedBefore.verdict === true && revealedBefore.phase === "revealed" && revealedBefore.answer === true
      && revealedRest.resting === true && revealedRest.h2.includes("已保存，先休息")
      && revealedAfter.cur === revealedBefore.cur && revealedAfter.verdict === true
      && revealedAfter.phase === "revealed" && revealedAfter.answer === true
      && revealedAfter.wordFace === true && revealedAfter.answered === revealedBefore.answered
      && revealedAfter.total === revealedBefore.total,
    {before: revealedBefore, rest: revealedRest, after: revealedAfter});

  /* ================================================================== *
   * 组一继续（复核修复 P2-1 + P1-1）：待应用设置与休息页、完成后自动续背资格
   * ================================================================== */
  await seed({ width: 1440, height: 1000, theme: "light", dailyNew: 10, groupSize: 5,
    enabled: true, threshold: 1, idleMs: 30000, countdownMs: 3000 });
  const pendingSetup = await page.eval(`(() => {
    const v = window.__vocab;
    const before = {pending: v.hasPendingScopeSettings(), groupSize: v.getGroupSize(), total: v.getGroupTotal()};
    const set = v.setGroupSize(6);   // 合法设置写入口：只影响下一组
    return {before, set, after: {pending: v.hasPendingScopeSettings(), groupSize: v.getGroupSize(),
      total: v.getGroupTotal(), noticeHidden: document.querySelector("#planPendingNotice").hidden,
      noticeText: (document.querySelector("#planPendingText") || {}).textContent || ""}};
  })()`);
  check("P2-1 学习中改每组词数后显示待应用提示且不重建本组",
    pendingSetup.before.pending === false && pendingSetup.set.ok === true
      && pendingSetup.after.pending === true && pendingSetup.after.groupSize === 6
      && pendingSetup.after.total === pendingSetup.before.total
      && pendingSetup.after.noticeHidden === false && pendingSetup.after.noticeText.includes("下一组"),
    pendingSetup);

  await click("#btnSaveRest");
  const pendingRestPage = await page.eval(`({resting: window.__vocab.isResting(),
    noticeHidden: document.querySelector("#planPendingNotice").hidden,
    doneRest: !!document.querySelector("#card .done-rest"),
    total: window.__vocab.getGroupTotal(), answered: window.__vocab.answered})`);
  check("P2-1 休息页隐藏待应用设置提示，不把下一组设置混进休息现场",
    pendingRestPage.resting === true && pendingRestPage.doneRest === true
      && pendingRestPage.noticeHidden === true && pendingRestPage.total === 5, pendingRestPage);
  await shot(page, "1440-r03-rest-pending");

  await click("#restResume");
  const pendingResumed = await page.eval(`({resting: window.__vocab.isResting(),
    noticeHidden: document.querySelector("#planPendingNotice").hidden,
    pending: window.__vocab.hasPendingScopeSettings(),
    noticeText: (document.querySelector("#planPendingText") || {}).textContent || "",
    total: window.__vocab.getGroupTotal(), answered: window.__vocab.answered})`);
  check("P2-1 点「继续本组」后待应用设置提示恢复且本组现场不变",
    pendingResumed.resting === false && pendingResumed.pending === true
      && pendingResumed.noticeHidden === false && pendingResumed.noticeText.includes("下一组")
      && pendingResumed.total === 5 && pendingResumed.answered === pendingRestPage.answered, pendingResumed);

  /* P1-1：先休息再继续本组，用真实 J/F + 空格完成整组，完成页自动续背资格必须恢复。 */
  let restFinishGuard = 0;
  await judge("keyJ");
  await pkey("Space");
  await page.waitFor('window.__vocab.cur === null || (window.__vocab.phase === "recall" && window.__vocab.cur !== null)',
    { timeout: 8000, label: "休息后第一张翻页" });
  while (await page.eval('window.__vocab.cur !== null')) {
    if (restFinishGuard++ > 20) throw new Error("休息后未能通过真实按键完成本组");
    await judge("keyF");
    await pkey("Space");
    await page.waitFor('window.__vocab.cur === null || (window.__vocab.phase === "recall" && window.__vocab.cur !== null)',
      { timeout: 8000, label: "休息后翻页" });
  }
  await page.waitFor('window.__vocab.cur === null', { label: "休息后完成页" });
  await sleep(250);
  const restAuto = await page.eval(`(() => {
    const v = window.__vocab, a = v.getAutoResumeState();
    return {eligible: a.eligible, phase: a.phase, completedPage: a.completedPage,
      autoHidden: document.querySelector("#autoResume").hidden,
      countdownHidden: document.querySelector("#autoResumeCountdown").hidden,
      text: (document.querySelector("#autoResumeText") || {}).textContent || ""};
  })()`);
  check("P1-1 休息→继续本组→真实完成本组后自动续背资格恢复（不等闲置倒计时）",
    restAuto.eligible === true && restAuto.phase !== "countdown" && restAuto.completedPage === true
      && restAuto.autoHidden === false && restAuto.countdownHidden === true
      && !restAuto.text.includes("本次已选择先休息"), restAuto);
  await shot(page, "1440-r03-rest-auto-resume");

  /* ================================================================== *
   * 组一继续：1440×1000 浅色 —— R04 纯复习小组
   * ================================================================== */
  await seed({ width: 1440, height: 1000, theme: "light", dailyNew: 1, groupSize: 1, due: 3, enabled: false });
  await judge("keyF");
  await pkey("Space");
  await page.waitFor('window.__vocab.cur === null', { label: "R04 主组完成页" });
  await sleep(150);
  const reviewEntry = await page.eval(`(() => {
    const v = window.__vocab, b = document.querySelector("#startReviewOnly");
    const r = b && b.getBoundingClientRect();
    const clickable = !!b && (() => { const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y); return !!(hit && (hit === b || b.contains(hit))); })();
    return {exists: !!b, text: b && b.textContent, title: b && b.title, clickable,
      h2: (document.querySelector("#card h2") || {}).textContent,
      candidates: v.getReviewOnlyCandidates(), available: v.reviewOnlyEntryAvailable()};
  })()`);
  check("完成页真实出现「纯复习」到期词入口且可命中",
    reviewEntry.exists && reviewEntry.clickable && reviewEntry.text.includes("纯复习")
      && reviewEntry.candidates.count > 0 && reviewEntry.available === true
      && reviewEntry.h2 === "本组完成", reviewEntry);

  const beforeReview = await page.eval(SCENE);
  await click("#startReviewOnly");
  await page.waitFor('window.__vocab.cur !== null', { label: "纯复习开组" });
  const reviewStarted = await page.eval(`(() => {
    const v = window.__vocab, Q = v.Q;
    return {
      cur: v.cur, phase: v.phase, answered: v.answered, total: v.getGroupTotal(),
      plan: v.getPlan(), qLen: Q.length,
      allMainProgress: Q.every(i => v.hasMainProgress(v.getS().progress[i])),
      n: (() => { const s = v.getS(), d = new Date();
        const day = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
        return (s.days[day] || {}).n || 0; })(),
      dailyNew: v.getS().settings.dailyNew,
      toast: (document.querySelector("#toast") || {}).textContent || ""
    };
  })()`);
  check("真实点击纯复习后进入 kind=reviewOnly 学习卡，Q 全部为已学到期词",
    !!reviewStarted.plan && reviewStarted.plan.kind === "reviewOnly" && reviewStarted.cur !== null
      && reviewStarted.qLen > 0 && reviewStarted.qLen <= 5 && reviewStarted.allMainProgress === true
      && reviewStarted.qLen === reviewEntry.candidates.count, reviewStarted);
  check("纯复习不学新词：今日新词数不增加、dailyNew 不变",
    reviewStarted.n === beforeReview.n && reviewStarted.dailyNew === beforeReview.dailyNew
      && reviewStarted.dailyNew === 1, { before: beforeReview.n, after: reviewStarted.n, dailyNew: reviewStarted.dailyNew });
  await shot(page, "1440-r04-review-only-start");

  let guard = 0;
  while (await page.eval('window.__vocab.cur !== null')) {
    if (guard++ > 12) throw new Error("纯复习组未能在预期步数内完成");
    await judge("keyF");
    await nextByButton();
  }
  await page.waitFor('window.__vocab.cur === null', { label: "纯复习完成页" });
  await sleep(200);
  const reviewDone = await page.eval(`(() => {
    const v = window.__vocab, a = v.getAutoResumeState();
    return {
      h2: (document.querySelector("#card h2") || {}).textContent,
      footer: (document.querySelector("#groupFooterText") || {}).textContent || "",
      autoHidden: document.querySelector("#autoResume").hidden,
      countdownHidden: document.querySelector("#autoResumeCountdown").hidden,
      again: (document.querySelector("#again") || {}).textContent || "",
      againDisabled: document.querySelector("#again") ? document.querySelector("#again").disabled : null,
      plan: v.getPlan() && v.getPlan().kind,
      n: (() => { const s = v.getS(), d = new Date();
        const day = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
        return (s.days[day] || {}).n || 0; })(),
      dailyNew: v.getS().settings.dailyNew,
      auto: {phase: a.phase, eligible: a.eligible}
    };
  })()`);
  check("纯复习组完成后完成页明确「纯复习完成」", reviewDone.h2 === "纯复习完成"
    && reviewDone.footer.includes("纯复习完成") && reviewDone.plan === "reviewOnly", reviewDone);
  check("纯复习完成页隐藏自动续背且继续按钮回到普通学习",
    reviewDone.autoHidden === true && reviewDone.countdownHidden === true
      && reviewDone.again.includes("开始普通学习") && reviewDone.againDisabled === false
      && reviewDone.auto.eligible === false, reviewDone);
  check("纯复习全程不增加今日新词数、不改每日新词计划",
    reviewDone.n === beforeReview.n && reviewDone.dailyNew === beforeReview.dailyNew, reviewDone);
  await shot(page, "1440-r04-review-only-done");

  /* P2-4：耗尽今日新词额度后再完成纯复习组，无可行候选时 #again 必须禁用。 */
  await seed({ width: 1440, height: 1000, theme: "light", dailyNew: 1, groupSize: 1, due: 2, dayNew: 1 });
  await judge("keyF");
  await pkey("Space");
  await page.waitFor('window.__vocab.cur === null', { label: "P2-4 主组完成页" });
  await sleep(150);
  const noCandEntry = await page.eval(`(() => { const v = window.__vocab; return {
    button: !!document.querySelector("#startReviewOnly"),
    text: (document.querySelector("#startReviewOnly") || {}).textContent || "",
    candidates: v.getReviewOnlyCandidates()}; })()`);
  check("P2-4 新词额度耗尽后完成页仍可显式开始到期纯复习",
    noCandEntry.button === true && noCandEntry.text.includes("纯复习")
      && noCandEntry.candidates.count === 1, noCandEntry);
  await click("#startReviewOnly");
  await page.waitFor('window.__vocab.cur !== null', { label: "P2-4 纯复习开组" });
  let noCandGuard = 0;
  while (await page.eval('window.__vocab.cur !== null')) {
    if (noCandGuard++ > 10) throw new Error("P2-4 纯复习组未能通过真实按键完成");
    await judge("keyF");
    await pkey("Space");
    await page.waitFor('window.__vocab.cur === null || (window.__vocab.phase === "recall" && window.__vocab.cur !== null)',
      { timeout: 8000, label: "P2-4 纯复习翻页" });
  }
  await page.waitFor('window.__vocab.cur === null', { label: "P2-4 纯复习完成页" });
  await sleep(250);
  const noCandDone = await page.eval(`(() => { const v = window.__vocab, a = v.getAutoResumeState();
    const pres = v.deriveStudyPresentation();
    return {h2: (document.querySelector("#card h2") || {}).textContent,
      againText: (document.querySelector("#again") || {}).textContent || "",
      againDisabled: document.querySelector("#again") ? document.querySelector("#again").disabled : null,
      candidates: pres.candidates.available, autoHidden: document.querySelector("#autoResume").hidden,
      plan: v.getPlan() && v.getPlan().kind}; })()`);
  check("P2-4 无可继续候选的纯复习完成页禁用「开始普通学习」，不空开组",
    noCandDone.h2 === "纯复习完成" && noCandDone.plan === "reviewOnly"
      && noCandDone.candidates === 0 && noCandDone.againDisabled === true
      && noCandDone.againText.includes("开始普通学习") && noCandDone.autoHidden === true, noCandDone);
  await shot(page, "1440-r04-review-only-no-candidate");

  /* ================================================================== *
   * 组二：375×812 深色 —— R05 朗读可见性与动作区几何
   * ================================================================== */
  await seed({ width: 375, height: 812, theme: "dark", dailyNew: 6, groupSize: 6 });
  scene = await page.eval(SCENE);
  check("375×812 深色主题生效", scene.theme === "dark", scene.theme);
  const mobileSpk = await readVisible("#spk");
  const mobileSlow = await readVisible("#spkSlow");
  const mobileStop = await readVisible("#spkStop");
  const mobileSentenceBefore = await page.eval('document.querySelectorAll("#card .answer [data-audio-text]").length');
  check("375 回忆态单词朗读三键真实可见",
    visOk(mobileSpk) && visOk(mobileSlow) && visOk(mobileStop), { spk: mobileSpk, slow: mobileSlow, stop: mobileStop });
  const mobileHitOk = !!mobileSpk && Math.round(mobileSpk.w) >= 44 && Math.round(mobileSpk.h) >= 44;
  check("375 #spk 命中区 ≥44px（亚像素取整）", mobileHitOk, mobileSpk && { w: mobileSpk.w, h: mobileSpk.h });
  check("375 触控命中：#spkSlow/#spkStop 高度 ≥44px",
    !!mobileSlow && Math.round(mobileSlow.h) >= 44 && !!mobileStop && Math.round(mobileStop.h) >= 44,
    { slow: mobileSlow && { w: mobileSlow.w, h: mobileSlow.h }, stop: mobileStop && { w: mobileStop.w, h: mobileStop.h } });
  if (!mobileHitOk) {
    report.defects.push({
      id: "spk-hit-area-375",
      title: "375×812 学习卡 #spk 命中区小于 44px",
      evidence: {measured: mobileSpk && {w: mobileSpk.w, h: mobileSpk.h}},
      note: "产品 CSS @media (max-width:720px) 覆盖 #spk 尺寸；未修改产品代码，按产品缺陷记录 FAIL。",
    });
  }
  check("375 #spkStop 初始 disabled 且判定前无例句朗读组",
    !!mobileStop && mobileStop.disabled === true && mobileSentenceBefore === 0, mobileStop);
  const mobileGeoRecall = await page.eval(geometry);
  check("375 回忆态 #acts 保持 151px 且无横向溢出",
    Math.abs(mobileGeoRecall.h - 151) <= 1 && mobileGeoRecall.docW <= mobileGeoRecall.innerW + 1, mobileGeoRecall);
  await shot(page, "375-r05-recall");
  await pkey("keyF");
  await page.waitFor('window.__vocab.phase === "revealed"', { label: "375 揭示态" });
  const mobileGeoRevealed = await page.eval(geometry);
  check("375 揭示态 #acts 保持 151px 且无横向溢出",
    Math.abs(mobileGeoRevealed.h - 151) <= 1 && mobileGeoRevealed.docW <= mobileGeoRevealed.innerW + 1, mobileGeoRevealed);
  const mobileSentenceAfter = await page.eval(`(() => {
    const g = document.querySelector("#card .answer > [data-audio-text]");
    const v = window.__vocab, x = v.getW()[v.cur];
    return {count: document.querySelectorAll("#card .answer > [data-audio-text]").length,
      text: g && g.dataset.audioText, ex: x.ex};
  })()`);
  check("375 揭示后例句朗读组出现且使用英文原句",
    mobileSentenceAfter.count === 1 && mobileSentenceAfter.text === mobileSentenceAfter.ex, mobileSentenceAfter);

  /* R05 补充：320×568 极窄屏下朗读控制不得压住词面或统计条。 */
  await seed({ width: 320, height: 568, theme: "light", dailyNew: 3, groupSize: 3 });
  const narrowLayout = await page.eval(`(() => {
    const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect();
      return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height}; };
    const card = box("#card"), wa = box("#card .word-audio"), word = box("#card .word"), stats = box("#statLine");
    const visible = (b) => !!b && b.w > 10 && b.h > 10 && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth;
    const intersects = (a, b) => !!(a && b && a.left < b.right - 1 && a.right > b.left + 1
      && a.top < b.bottom - 1 && a.bottom > b.top + 1);
    return {card, wa, word, stats,
      insideCard: !!wa && !!card && wa.top >= card.top - 1 && wa.bottom <= card.bottom + 1,
      belowStats: !!wa && !!stats && wa.top >= stats.bottom - 1,
      separatedFromWord: !!wa && !!word && !intersects(wa, word),
      wordVisible: visible(word), audioVisible: visible(wa)};
  })()`);
  check("320×568 单词朗读组与词面/统计条不重叠、词面仍可见",
    narrowLayout.insideCard && narrowLayout.belowStats && narrowLayout.separatedFromWord
      && narrowLayout.wordVisible && narrowLayout.audioVisible, narrowLayout);
  await shot(page, "320-r05-word-audio");

  /* ================================================================== *
   * 组二继续：375×812 深色 —— R04 「本组再学 5 词」停靠目标
   * ================================================================== */
  await seed({ width: 375, height: 812, theme: "dark", dailyNew: 6, groupSize: 6, enabled: false });
  await click("#btnStopTarget");
  const stopSet = await page.eval(`(() => {
    const v = window.__vocab, box = document.querySelector("#stopTarget");
    return {progress: v.getStopTarget(), boxHidden: box.hidden,
      text: (document.querySelector("#stopTargetText") || {}).textContent || "",
      restHidden: document.querySelector("#stopTargetRest").hidden,
      contHidden: document.querySelector("#stopTargetContinue").hidden,
      cancelHidden: document.querySelector("#stopTargetCancel").hidden,
      entryHidden: document.querySelector("#btnStopTarget").hidden,
      toast: (document.querySelector("#toast") || {}).textContent || ""};
  })()`);
  check("真实点击「学 5 词就停」显示停靠目标状态与「再学 5 个不同词」",
    stopSet.boxHidden === false && stopSet.progress && stopSet.progress.goal === 5
      && stopSet.progress.done === 0 && stopSet.text.includes("再学 5 个不同词")
      && stopSet.restHidden === true && stopSet.contHidden === true
      && stopSet.cancelHidden === false && stopSet.entryHidden === true, stopSet);

  /* 真实 F/J 交替判定 5 个不同词（J 的重考留在队尾，不影响计数）。 */
  for (let i = 0; i < 5; i++) {
    await judge(i % 2 === 0 ? "keyF" : "keyJ");
    if (i < 4) {
      await click("#nx");
      await page.waitFor('window.__vocab.cur !== null && window.__vocab.phase === "recall"', { label: "停靠目标下一词" });
    }
  }
  const stopReached = await page.eval(`(() => {
    const v = window.__vocab, p = v.getStopTarget();
    return {progress: p, restHidden: document.querySelector("#stopTargetRest").hidden,
      contHidden: document.querySelector("#stopTargetContinue").hidden,
      cancelHidden: document.querySelector("#stopTargetCancel").hidden,
      restText: (document.querySelector("#stopTargetRest") || {}).textContent || "",
      contText: (document.querySelector("#stopTargetContinue") || {}).textContent || "",
      text: (document.querySelector("#stopTargetText") || {}).textContent || ""};
  })()`);
  check("真实判定满 5 个不同词后出现「先休息 / 继续本组」且取消目标收起",
    stopReached.progress && stopReached.progress.reached === true && stopReached.progress.done === 5
      && stopReached.restHidden === false && stopReached.contHidden === false
      && stopReached.cancelHidden === true && stopReached.text.includes("已学满"), stopReached);
  await shot(page, "375-r04-stop-target");
  await page.scrollIntoView("#stopTarget");
  await sleep(120);
  await shot(page, "375-r04-stop-target-actions");

  await click("#stopTargetContinue");
  const stopCleared = await page.eval(`(() => {
    const v = window.__vocab, box = document.querySelector("#stopTarget");
    return {progress: v.getStopTarget(), boxHidden: box.hidden,
      toast: (document.querySelector("#toast") || {}).textContent || ""};
  })()`);
  check("点「继续本组」后临时停靠目标消失且保留本组现场",
    stopCleared.progress === null && stopCleared.boxHidden === true
      && stopCleared.toast.includes("停靠目标结束") && await page.eval('window.__vocab.cur !== null'), stopCleared);

  /* 完成页抑制自动续背：5 词小主组 + 自动续背开启（阈值 1，闲置 30 秒不可等）。 */
  await seed({ width: 375, height: 812, theme: "dark", dailyNew: 5, groupSize: 5,
    enabled: true, threshold: 1, idleMs: 30000, countdownMs: 3000 });
  await click("#btnStopTarget");
  for (let i = 0; i < 5; i++) {
    await judge("keyF");
    await click("#nx");
  }
  await page.waitFor('window.__vocab.cur === null', { timeout: 8000, label: "停靠目标完成页" });
  await sleep(250);
  const stopCompletion = await page.eval(`(() => {
    const v = window.__vocab, a = v.getAutoResumeState();
    return {h2: (document.querySelector("#card h2") || {}).textContent,
      autoHidden: document.querySelector("#autoResume").hidden,
      autoText: (document.querySelector("#autoResumeText") || {}).textContent || "",
      countdownHidden: document.querySelector("#autoResumeCountdown").hidden,
      countdownText: (document.querySelector("#autoResumeCountdown") || {}).textContent || "",
      phase: a.phase, eligible: a.eligible, completedPage: a.completedPage,
      stop: v.getStopTarget(),
      restHidden: document.querySelector("#stopTargetRest").hidden,
      contHidden: document.querySelector("#stopTargetContinue").hidden,
      restText: (document.querySelector("#stopTargetRest") || {}).textContent || "",
      contText: (document.querySelector("#stopTargetContinue") || {}).textContent || ""};
  })()`);
  check("达标后自然完成本组：完成页不进入倒计时/不自动开组且文案提及停靠目标",
    stopCompletion.h2 === "本组完成" && stopCompletion.autoHidden === false
      && stopCompletion.phase !== "countdown" && stopCompletion.eligible === false
      && stopCompletion.countdownHidden === true && stopCompletion.autoText.includes("停靠目标")
      && stopCompletion.stop && stopCompletion.stop.reached === true, stopCompletion);
  check("完成页保留「今天先到这里 / 继续学习」两个真实入口",
    stopCompletion.restHidden === false && stopCompletion.contHidden === false
      && stopCompletion.restText.includes("今天先到这里") && stopCompletion.contText.includes("继续学习"),
    { restText: stopCompletion.restText, contText: stopCompletion.contText });
  await shot(page, "375-r04-stop-completion");
  await page.scrollIntoView("#stopTarget");
  await sleep(120);
  const completionActions = await page.eval(`(() => {
    const hit = (sel) => { const el = document.querySelector(sel); if (!el) return false;
      const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (r.width < 2 || r.height < 2) return false;
      const h = document.elementFromPoint(x, y); return !!(h && (h === el || el.contains(h))); };
    return {rest: hit("#stopTargetRest"), cont: hit("#stopTargetContinue")};
  })()`);
  check("完成页「今天先到这里 / 继续学习」两个入口真实可命中",
    completionActions.rest === true && completionActions.cont === true, completionActions);
  await shot(page, "375-r04-stop-completion-actions");

  await click("#stopTargetContinue");
  const stopCompletionContinued = await page.eval(`(() => {
    const v = window.__vocab, a = v.getAutoResumeState();
    return {stop: v.getStopTarget(), boxHidden: document.querySelector("#stopTarget").hidden,
      eligible: a.eligible, phase: a.phase, countdownHidden: document.querySelector("#autoResumeCountdown").hidden,
      autoText: (document.querySelector("#autoResumeText") || {}).textContent || ""};
  })()`);
  check("点「继续学习」后停靠目标清除，自动续背资格恢复正常",
    stopCompletionContinued.stop === null && stopCompletionContinued.boxHidden === true
      && stopCompletionContinued.eligible === true && stopCompletionContinued.phase !== "countdown"
      && stopCompletionContinued.countdownHidden === true, stopCompletionContinued);

  /* P2-2：完成页持续错误（#appAlert）可见时，「继续学习」不得开组；重试保存后可继续。 */
  await seed({ width: 375, height: 812, theme: "dark", dailyNew: 10, groupSize: 5,
    enabled: true, threshold: 1, idleMs: 30000, countdownMs: 3000 });
  await click("#btnStopTarget");
  for (let i = 0; i < 5; i++) {
    await judge("keyF");
    await click("#nx");
  }
  await page.waitFor('window.__vocab.cur === null', { timeout: 8000, label: "P2-2 停靠目标完成页" });
  // 等完成页首个 studyTimeTick 用真实存储落盘（本组结束会 flush 学习时长）；
  // 若把合成失败注入得太早，自动 flush 的失败会覆盖「重试保存并休息」提示，干扰本项语义。
  await sleep(1500);
  const alertReady = await page.eval(`(() => { const v = window.__vocab; return {
    stop: v.getStopTarget(), contHidden: document.querySelector("#stopTargetContinue").hidden,
    alertHidden: document.querySelector("#appAlert").hidden,
    candidates: v.getAutoResumeState().candidates.available}; })()`);
  check("P2-2 完成页停靠目标可兑现且确有下一组候选",
    alertReady.stop && alertReady.stop.reached === true && alertReady.contHidden === false
      && alertReady.alertHidden === true && alertReady.candidates > 0, alertReady);
  // 真实存储失败：主记录写入抛错，走 save() 的持续错误提示（#appAlert）
  await page.eval(`(() => { window.__batchAOrigSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "kaoyan_vocab_v1") throw new DOMException("batch-a forced save failure", "QuotaExceededError");
      return window.__batchAOrigSetItem.call(this, k, v); };
    return true; })()`);
  await click("#stopTargetRest");
  const alertShown = await page.eval(`(() => ({alertHidden: document.querySelector("#appAlert").hidden,
    title: (document.querySelector("#appAlertTitle") || {}).textContent || "",
    buttons: [...document.querySelectorAll("#appAlertActions button")].map(b => b.textContent),
    stop: window.__vocab.getStopTarget(),
    contHidden: document.querySelector("#stopTargetContinue").hidden}))()`);
  check("P2-2 存储失败时显示持续错误，停靠目标「继续学习」仍在",
    alertShown.alertHidden === false && alertShown.title.includes("未保存")
      && alertShown.buttons.includes("重试保存并休息") && !!alertShown.stop
      && alertShown.contHidden === false, alertShown);

  await click("#stopTargetContinue");
  await sleep(220);
  const alertBlocked = await page.eval(`(() => { const v = window.__vocab; return {
    cur: v.cur, stop: v.getStopTarget(), alertHidden: document.querySelector("#appAlert").hidden,
    boxHidden: document.querySelector("#stopTarget").hidden,
    againHidden: document.querySelector("#again") ? document.querySelector("#again").hidden : null,
    toast: (document.querySelector("#toast") || {}).textContent || ""}; })()`);
  check("P2-2 #appAlert 可见时点完成页「继续学习」不得开组且保留错误提示",
    alertBlocked.cur === null && alertBlocked.alertHidden === false
      && alertBlocked.boxHidden === true && alertBlocked.stop === null
      && alertBlocked.toast.includes("记录错误"), alertBlocked);
  await shot(page, "375-r04-stop-completion-alert");

  // 恢复真实存储能力，关闭持续错误提示后手动继续；下一次真实判定应恢复正常保存。
  await page.eval("Storage.prototype.setItem = window.__batchAOrigSetItem; true");
  await click("#appAlertActions button:last-child");
  await page.waitFor('document.querySelector("#appAlert").hidden === true', { timeout: 8000, label: "关闭后清除错误提示" });
  await sleep(180);
  const clearedAlert = await page.eval(`({alertHidden: document.querySelector("#appAlert").hidden,
    cur: window.__vocab.cur, h2: (document.querySelector("#card h2") || {}).textContent || ""})`);
  await page.waitFor('document.querySelector("#again") && !document.querySelector("#again").disabled',
    { timeout: 8000, label: "错误清除后继续按钮恢复可用" });
  await click("#again");
  await page.waitFor('window.__vocab.cur !== null', { timeout: 8000, label: "错误清除后继续开组" });
  const resumedAfterAlert = await page.eval(`({cur: window.__vocab.cur, answered: window.__vocab.answered,
    phase: window.__vocab.phase, total: window.__vocab.getGroupTotal()})`);
  await judge("keyF");
  const savedAfterAlert = await page.eval(`({storageOK: window.__vocab.getStorageOK(),
    alertHidden: document.querySelector("#appAlert").hidden, phase: window.__vocab.phase})`);
  check("P2-2 清除持续错误后可正常继续下一组并恢复保存",
    clearedAlert.alertHidden === true && clearedAlert.cur === null
      && resumedAfterAlert.cur !== null && resumedAfterAlert.answered === 0
      && resumedAfterAlert.phase === "recall" && savedAfterAlert.storageOK === true
      && savedAfterAlert.alertHidden === true, {clearedAlert, resumedAfterAlert, savedAfterAlert});

  /* ---- 无未解释的 console.error / 页面异常 ---- */
  report.errors = page.errors();
  check("全程无未解释 console.error / 页面异常", report.errors.length === 0, report.errors);
} catch (error) {
  check("批次A 旅程完整执行", false, String((error && error.stack) || error));
  report.errors = page ? page.errors() : [];
} finally {
  if (page) {
    if (!report.checks.some((c) => c.name.includes("console.error"))) {
      report.errors = page.errors();
      check("全程无未解释 console.error / 页面异常", report.errors.length === 0, report.errors);
    }
    await page.close().catch(() => {});
  }
  conn.close();
  await chrome.close();
  await server.close();
  report.sourcesAfter = fingerprint();
  report.sourcesStable = same(report.sources, report.sourcesAfter);
  report.finishedAt = new Date().toISOString();
  report.passed = report.checks.filter((c) => c.ok).length;
  report.failed = report.checks.length - report.passed;
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, "batch-a.json");
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    passed: report.passed, failed: report.failed, report: file,
    screenshots: report.shots.length, sourcesStable: report.sourcesStable,
  }));
  if (report.failed) process.exitCode = 1;
}
