/* =========================================================
   背单词网页 · app.js（考研 / 英语四级 / 英语六级 / 综合词书）
   门控：未判定（recall）时「下一个」不翻页
   ========================================================= */
(function () {
  "use strict";

  /* ================= 数据与词书注册 ================= */
  const POSN = ["名词","动词","形容词","副词","介词","限定词","代词","助动词","并列连词","从属连词","数词","小品词","专有名词","感叹词","其他","符号"];
  const POSIDX = {"NOUN":0,"VERB":1,"ADJ":2,"ADV":3,"ADP":4,"DET":5,"PRON":6,"AUX":7,"CCONJ":8,"SCONJ":9,"NUM":10,"PART":11,"PROPN":12,"INTJ":13,"X":14,"SYM":15};

  /**
   * 词书注册（数组顺序即 UI 顺序）。
   * 数据来源：考研 js/words-data.js → window.WORDS_RAW；
   * 四/六级 js/cet-words-data.js → window.WORDS_CET4 / window.WORDS_CET6（由 vocab-builder 生成）。
   * 存储键、文案、默认筛选各书独立；考研键名保持历史原样，老用户进度零迁移。
   * paperCount / yearRange 优先取 window.WORD_BOOK_META[id]，缺省 paperCount 用 max(词条.c)。
   */
  const BOOK_DEFS = [
    { id: "kaoyan", name: "考研英语", mark: "研", dataKey: "WORDS_RAW",
      KEY: "kaoyan_vocab_v1", PROF_KEY: "kaoyan_vocab_proficient_v1",
      SURVEY_KEY: "kaoyan_vocab_survey_v1",
      paperUnit: "套考研真题", tagLabel: "考研大纲", kyOnlyLabel: "只保留考研大纲词", defaultPmin: 2 },
    { id: "cet4", name: "英语四级", mark: "四", dataKey: "WORDS_CET4",
      KEY: "cet4_vocab_v1", PROF_KEY: "cet4_vocab_proficient_v1",
      SURVEY_KEY: "cet4_vocab_survey_v1",
      paperUnit: "套四级真题", tagLabel: "四级大纲", kyOnlyLabel: "只保留四级大纲词", defaultPmin: 2 },
    { id: "cet6", name: "英语六级", mark: "六", dataKey: "WORDS_CET6",
      KEY: "cet6_vocab_v1", PROF_KEY: "cet6_vocab_proficient_v1",
      SURVEY_KEY: "cet6_vocab_survey_v1",
      paperUnit: "套六级真题", tagLabel: "六级大纲", kyOnlyLabel: "只保留六级大纲词", defaultPmin: 2 },
    { id: "combined", name: "综合词书", mark: "综", dataKey: "WORDS_COMBINED",
      KEY: "combined_vocab_v1", PROF_KEY: "combined_vocab_proficient_v1",
      SURVEY_KEY: "combined_vocab_survey_v1",
      paperUnit: "套真题（考研/四级/六级合计）", tagLabel: "考试大纲", kyOnlyLabel: "只保留任一考试大纲词", defaultPmin: 2,
      requires: ["WORDS_RAW", "WORDS_CET4", "WORDS_CET6"] }
  ];
  /** 当前词书 id（纯字符串，如 "cet4"），缺省/非法/数据不可用 → 考研 */
  const ACTIVE_KEY = "vocab_active_book_v1";
  /**
   * 11 首次引导状态：纯界面偏好，独立全局 localStorage 键；
   * 不进每书 state、不进备份 v3、不影响学习进度/熟练/配额，四书共用。
   */
  const GUIDE_KEY = "vocab_guide_v1";
  /** 13 上次成功发起文件导出的时间：独立全局键，不进学习记录/备份 v3，不改变导出只读契约。 */
  const LAST_EXPORT_KEY = "vocab_last_export_v1";

  /** 11 元组 → 内部结构（与 words-data.js 字段一致） */
  function mapWords(raw){
    return (Array.isArray(raw) ? raw : []).map(a => ({
      w: a[0], ph: a[1], m: a[2], p: a[3], r: a[4], f: a[5], c: a[6],
      ex: a[7], src: a[8], ky: a[9], fm: a[10]
    }));
  }
  /**
   * 解析词书数据版本与迁移链（数据侧契约，见 task-9）：
   *   meta.dataVersion: 当前词书数据版本（整数，缺省 1）
   *   meta.migrations: [{from,to,removed:[旧下标…]}]，from→from+1，removed 升序唯一
   * 非法/缺失 → 忽略迁移、dataVersion 默认 1，**不得抛错**。
   * 校验方式：从目标版本倒推每一版旧数组长度，确认 removed 下标都在范围内；
   * 迁移链必须从 1 连续到 dataVersion，否则整组忽略（避免半套映射错位）。
   */
  function readBookDataVersion(meta, newLength){
    const fallback = {dataVersion: 1, migrations: []};
    if (!meta || typeof meta !== "object") return fallback;
    const v = meta.dataVersion;
    if (!(typeof v === "number" && isFinite(v) && v >= 1 && Math.floor(v) === v)) return fallback;
    const version = Math.floor(v);
    if (version === 1) return fallback;
    if (!Array.isArray(meta.migrations)) return fallback;
    const byFrom = new Map();
    for (const m of meta.migrations) {
      if (!m || typeof m !== "object" || Array.isArray(m)) continue;
      if (!Number.isInteger(m.from) || !Number.isInteger(m.to) || m.to !== m.from + 1 || m.from < 1) continue;
      if (!Array.isArray(m.removed)) continue;
      let prev = -1, bad = false;
      for (const r of m.removed) {
        if (!Number.isInteger(r) || r <= prev) { bad = true; break; }   // 升序、唯一、非负
        prev = r;
      }
      if (bad || byFrom.has(m.from)) continue;   // 非法/重复 from：忽略该条
      const entry = {from: m.from, to: m.to, removed: m.removed.slice(), addedCount: 0};
      if (Array.isArray(m.removedWords) && m.removedWords.length === m.removed.length
          && m.removedWords.every(w => typeof w === "string" && /^[a-z]+$/.test(w))) {
        entry.removedWords = m.removedWords.slice();
      }
      if (Array.isArray(m.added) && m.added.every(n => Number.isInteger(n) && n >= 0)) entry.addedCount = m.added.length;
      else if (Array.isArray(m.addedWords) && m.addedWords.every(w => typeof w === "string" && /^[a-z]+$/.test(w))) entry.addedCount = m.addedWords.length;
      byFrom.set(m.from, entry);
    }
    const chain = [];
    let ver = version, len = newLength;
    while (ver > 1) {
      const m = byFrom.get(ver - 1);
      if (!m) return fallback;                        // 迁移链不完整 → 整组忽略
      const oldLen = len + m.removed.length - (m.addedCount || 0);
      if (oldLen <= 0 || m.removed.length >= oldLen) return fallback;
      for (const r of m.removed) if (r >= oldLen) return fallback;
      chain.unshift(m);
      len = oldLen;
      ver = m.from;
    }
    return {dataVersion: version, migrations: chain};
  }

  /** 注册全部词书；数据缺失/空数组 → 不可用（老缓存页面缺 cet 数据时只有考研可用） */
  const BOOKS = {};
  BOOK_DEFS.forEach(def => {
    const words = mapWords(window[def.dataKey]);
    const meta = (window.WORD_BOOK_META && window.WORD_BOOK_META[def.id]) || {};
    let paperCount = meta.paperCount;
    if (!(typeof paperCount === "number" && isFinite(paperCount) && paperCount > 0)) {
      paperCount = 0;
      for (const x of words) if (x.c > paperCount) paperCount = x.c;
    }
    const dv = readBookDataVersion(meta, words.length);
    BOOKS[def.id] = Object.assign({}, def, {
      words: words,
      available: words.length > 0 && (!def.requires || def.requires.every(key => Array.isArray(window[key]) && window[key].length > 0)),
      paperCount: paperCount,
      yearRange: typeof meta.yearRange === "string" ? meta.yearRange : "",
      wordIndex: new Map(words.map((x, i) => [x.w, i])),
      dataVersion: dv.dataVersion,
      migrations: dv.migrations,
      removedWords: dv.migrations.length && dv.migrations.every(m => Array.isArray(m.removedWords))
        ? new Set(dv.migrations.flatMap(m => m.removedWords)) : null
    });
  });
  function pickActiveBook(stored){
    if (stored && BOOKS[stored] && BOOKS[stored].available) return stored;
    if (BOOKS.kaoyan && BOOKS.kaoyan.available) return "kaoyan";
    const first = BOOK_DEFS.map(d => d.id).find(id => BOOKS[id].available);
    return first || "kaoyan";
  }
  /* ================= O1 本页词书 / 下次默认 / 跨页跟随（§7） =================
   * 三个独立位置，不再让 ACTIVE_KEY 同时决定一切：
   *   sessionStorage vocab_page_book_v1      本页词书（刷新保留；不可用时降本页内存并明确说明）
   *   localStorage  vocab_default_book_v1    下次新开页面默认（改它不切已开页面）
   *   sessionStorage vocab_page_book_mode_v1 local=仅本页 / follow=参与跨页跟随
   * 新页默认 local；旧用户首次迁移可保留 follow。旧 ACTIVE_KEY 保留为迁移/兼容信号：
   * follow 模式切书仍写它，local 模式只写 sessionStorage。
   * 首启优先级：本页合法 sessionStorage → 默认词书 → 旧 ACTIVE 迁移值 → 考研。
   */
  const PAGE_BOOK_KEY = "vocab_page_book_v1";
  const DEFAULT_BOOK_KEY = "vocab_default_book_v1";
  const PAGE_BOOK_MODE_KEY = "vocab_page_book_mode_v1";
  const PAGE_BOOK_MODES = ["local", "follow"];
  const pageMemoryStore = new Map();
  let pageSessionStoreMissing = false;
  let defaultBookWriteFailed = false;
  let bookModeMigrated = null;            // "follow" | null：本次启动是否执行了旧用户迁移
  function storageArea(kind){
    try {
      if (kind === "page") return (typeof window !== "undefined" && window.sessionStorage) || null;
      return (typeof window !== "undefined" && window.localStorage) || null;
    } catch (e) { return null; }
  }
  function areaRead(area, key){
    if (!area) return null;
    try { return area.getItem(key); } catch (e) { return null; }
  }
  function areaWrite(area, key, value){
    if (!area) return false;
    try { area.setItem(key, value); return true; } catch (e) { return false; }
  }
  function pageStoreGet(key){
    const area = storageArea("page");
    if (area) {
      const got = areaRead(area, key);
      if (got !== null) return got;
    }
    return pageMemoryStore.has(key) ? pageMemoryStore.get(key) : null;
  }
  function pageStoreSet(key, value){
    pageMemoryStore.set(key, value);
    const area = storageArea("page");
    if (area && areaWrite(area, key, value)) return true;
    pageSessionStoreMissing = true;
    return false;
  }
  function validBookIdRaw(id){ return typeof id === "string" && Object.prototype.hasOwnProperty.call(BOOKS, id) && BOOKS[id].available; }
  function pageBookModeRaw(){
    const stored = pageStoreGet(PAGE_BOOK_MODE_KEY);
    return PAGE_BOOK_MODES.includes(stored) ? stored : null;
  }
  /** 首启解析：执行一次性默认书迁移、模式迁移，并按优先级得到本页词书。 */
  function initialPageBookChoice(){
    const local = storageArea("main");
    const legacyActive = areaRead(local, ACTIVE_KEY);
    let defaultBook = areaRead(local, DEFAULT_BOOK_KEY);
    const defaultMissing = !validBookIdRaw(defaultBook);
    if (defaultMissing) {
      // 首次迁移：把默认词书固定为当时合法旧 ACTIVE 或考研；之后单次全页同步不改下次默认。
      defaultBook = pickActiveBook(legacyActive);
      if (!areaWrite(local, DEFAULT_BOOK_KEY, defaultBook)) defaultBookWriteFailed = true;
    }
    // 模式迁移：本页已有显式选择优先；否则旧用户（迁移前已有合法 ACTIVE）保留 follow，
    // 新用户/之后的新页面默认 local。开启 follow 不立即追历史 ACTIVE。
    if (!pageBookModeRaw()) {
      const mode = (defaultMissing && validBookIdRaw(legacyActive)) ? "follow" : "local";
      pageStoreSet(PAGE_BOOK_MODE_KEY, mode);
      bookModeMigrated = mode === "follow" ? "follow" : null;
    }
    const pageBook = pageStoreGet(PAGE_BOOK_KEY);
    if (validBookIdRaw(pageBook)) return pickActiveBook(pageBook);
    if (validBookIdRaw(defaultBook)) return pickActiveBook(defaultBook);
    if (validBookIdRaw(legacyActive)) return pickActiveBook(legacyActive);
    return pickActiveBook(null);
  }
  let currentBookId = initialPageBookChoice();
  function currentBook(){ return BOOKS[currentBookId]; }
  function bookOf(id){ return Object.prototype.hasOwnProperty.call(BOOKS, id) ? BOOKS[id] : null; }
  function wordBookTags(word){
    if (currentBookId !== "combined") return "";
    return BOOK_DEFS.filter(def => def.id !== "combined" && BOOKS[def.id].wordIndex.has(word))
      .map(def => '<span class="tag">' + esc(def.name) + '</span>').join("");
  }

  /** 当前词书数据（切换词书时整体重建；数组顺序即进度主键，各书互不影响） */
  let W = BOOKS[currentBookId].words;
  let wordIndex = BOOKS[currentBookId].wordIndex;
  /** 当前词书的存储键（切换词书时更新；考研键名与历史版本完全一致） */
  let KEY = BOOKS[currentBookId].KEY;
  let PROF_KEY = BOOKS[currentBookId].PROF_KEY;
  let SURVEY_KEY = BOOKS[currentBookId].SURVEY_KEY;
  /** 乱序模式随机抽样：单词 → 0/1（1 = 首次作答「会」）。按词文本存，跨数据版本天然对齐。 */
  let SURVEY = {};
  let lastSurvey = {};

  /* ================= 复习曲线（可配置十档，单位：分钟） =================
   * 契约：docs/学习计划与额度设计-2026-10-22.md §1/§1.1/§1.2/§3/§4「19」。
   * 持久化与校验统一使用 1–525600 的整数分钟；毫秒只在运行时与组内快照中换算。
   * 十档数量与阶段索引不动：走完第 10 档后再答对一次 = 已掌握（MASTER）。
   */
  const STAGE_COUNT = 10;
  const MINUTE_MS = 60 * 1000;
  const DAY_MINUTES = 1440;
  const MIN_STAGE_MINUTES = 1;
  const MAX_STAGE_MINUTES = 525600;   // 365 天
  /** 预设常量只此一处；阶段间隔单位均为分钟。 */
  const STAGE_PRESETS = {
    balanced: { label: "均衡", stages: [1440, 2880, 5760, 10080, 14400, 21600, 30240, 43200, 64800, 86400], relearn: 1440 },
    light: { label: "轻负荷", stages: [1440, 4320, 10080, 20160, 30240, 43200, 64800, 86400, 129600, 172800], relearn: 1440 },
    intense: { label: "短期强化", stages: [30, 240, 720, 1440, 2880, 5760, 10080, 21600, 43200, 86400], relearn: 30 },
    legacy: { label: "旧版密集", stages: [5, 30, 720, 1440, 2880, 5760, 10080, 21600, 43200, 86400], relearn: 5 }
  };
  const STAGE_PRESET_NAMES = ["balanced", "light", "intense", "legacy"];
  /** 已掌握 = 走完全部 10 档复习（含第 10 档）之后再答对一次 */
  const MASTER = STAGE_COUNT + 1;
  /** 加载/导入时遇到的非法曲线配置（可展示）：{bookId, error} | null */
  let stageConfigError = null;
  /** 设置页最近一次编辑错误（可展示）：{index,message} | null；成功后清空。 */
  let rhythmLastError = null;
  /** 唯一时长格式化：分钟整数 → 「N 分钟 / N 小时 / N 天」。 */
  function formatMinutes(minutes){
    const m = Math.max(1, Math.round(+minutes || 0));
    if (m % DAY_MINUTES === 0) return (m / DAY_MINUTES) + " 天";
    if (m % 60 === 0) return (m / 60) + " 小时";
    return m + " 分钟";
  }
  /** 毫秒间隔 → 与 formatMinutes 同一格式（避免浮点残留）。 */
  function formatStagesMs(ms){
    return formatMinutes(Math.max(1, Math.round((+ms || 0) / MINUTE_MS)));
  }
  /** 完整周期摘要（十档间隔之和，分钟）；以天/小时展示，如「约 N 天」。 */
  function formatCycleMinutes(minutes){
    const m = Math.max(1, Math.round(+minutes || 0));
    if (m % DAY_MINUTES === 0) return "约 " + (m / DAY_MINUTES) + " 天";
    if (m >= DAY_MINUTES) return "约 " + Math.round(m / DAY_MINUTES) + " 天";
    if (m % 60 === 0) return "约 " + (m / 60) + " 小时";
    return "约 " + m + " 分钟";
  }
  /**
   * 校验一组十档配置（纯函数，不读写设置）。
   * 整组接受或整组拒绝：ok 时返回规范化副本；失败时 stages/relearn 为 null，配置保持不变。
   * error.index 为 0 基档位下标；relearn/结构错误为 -1。
   */
  function normalizeStageConfig(stages, relearn){
    const fail = (index, message) => ({ ok: false, stages: null, relearn: null, error: { index: index, message: message } });
    if (!Array.isArray(stages) || stages.length !== STAGE_COUNT) {
      return fail(-1, "复习曲线：需要恰好 " + STAGE_COUNT + " 个档位间隔");
    }
    const out = [];
    for (let i = 0; i < STAGE_COUNT; i++) {
      const v = stages[i];
      if (typeof v !== "number" || !Number.isInteger(v)) {
        return fail(i, "第 " + (i + 1) + " 档：必须是整数分钟");
      }
      if (v < MIN_STAGE_MINUTES || v > MAX_STAGE_MINUTES) {
        return fail(i, "第 " + (i + 1) + " 档：需在 1–525600 分钟（1 分钟–365 天）之间");
      }
      if (i > 0 && v <= out[i - 1]) {
        return fail(i, "第 " + (i + 1) + " 档：必须大于第 " + i + " 档");
      }
      out.push(v);
    }
    if (typeof relearn !== "number" || !Number.isInteger(relearn)) {
      return fail(-1, "不会后重学间隔：必须是整数分钟");
    }
    if (relearn < MIN_STAGE_MINUTES || relearn > MAX_STAGE_MINUTES) {
      return fail(-1, "不会后重学间隔：需在 1–525600 分钟（1 分钟–365 天）之间");
    }
    return { ok: true, stages: out, relearn: relearn, error: null };
  }
  /** 由 stages/relearn 反推预设名；不匹配任何内置预设 → "custom"。 */
  function presetKeyOf(stages, relearn){
    for (const name of STAGE_PRESET_NAMES) {
      const p = STAGE_PRESETS[name];
      if (p.relearn !== relearn || p.stages.length !== stages.length) continue;
      let same = true;
      for (let i = 0; i < stages.length; i++) {
        if (stages[i] !== p.stages[i]) { same = false; break; }
      }
      if (same) return name;
    }
    return "custom";
  }
  /** 当前设置的有效配置（内部已保证合法；异常时回退旧版密集曲线，保证调度有值）。 */
  function currentStageConfig(){
    const cfg = normalizeStageConfig(S.settings.stages, S.settings.relearn);
    return cfg.ok
      ? { stages: cfg.stages, relearn: cfg.relearn }
      : { stages: STAGE_PRESETS.legacy.stages.slice(), relearn: STAGE_PRESETS.legacy.relearn };
  }
  function currentStagesMs(){
    return currentStageConfig().stages.map(m => m * MINUTE_MS);
  }
  function currentRelearnMs(){
    return currentStageConfig().relearn * MINUTE_MS;
  }
  /** 本组冻结计划：startSession() 时生成；judge/改判/重考只用快照，设置只影响下一组。 */
  let sessionPlan = null;
  // U3：学习页与设置/统计共用 #main；暂离后回到同词同组的阅读位置。
  let studyReadingScroll = null;
  /**
   * 08 范围/计划签名：设置页据此判断「当前组是否已与新设置不一致」。
   * 只包含计划/范围类字段（外观/语音/键盘立即生效，不参与），每日复习上限即时生效也不参与。
   */
  function currentScopeSignature(){
    return JSON.stringify([
      S.settings.dailyNew, S.settings.order, S.settings.fmin, S.settings.fmax,
      S.settings.pmin, S.settings.kyOnly, (S.settings.pos || []).slice().sort(),
      getPosMode(), S.settings.groupSize, !!S.settings.backlogGuard
    ]);
  }
  /**
   * kind: "main"=普通组，"extra"=23 临时加量子组，"newOnly"=07 纯新词子组；
   * groupSize 在本组开始时冻结，之后设置只影响下一组（08 的“应用到下一组”）。
   * scopeSig/scopeCount/dailyNewTarget 记录「本组开始时的范围与计划」，供设置页标注当前组；
   * 范围内到期集合仍每次重新计算（跨天/改熟练后取最新）。
   */
  function createSessionPlan(kind){
    const cfg = currentStageConfig();
    return {
      stagesMs: cfg.stages.map(m => m * MINUTE_MS),
      relearnMs: cfg.relearn * MINUTE_MS,
      bookId: currentBookId,
      kind: kind === "extra" || kind === "newOnly" ? kind : "main",
      groupSize: Number.isInteger(S.settings.groupSize) ? S.settings.groupSize : GROUP_SIZE_DEFAULT,
      startedAt: Date.now(),
      scopeSig: currentScopeSignature(),
      scopeCount: inScopeCount(),
      dailyNewTarget: S.settings.dailyNew
    };
  }
  /** 组内调度/展示用冻结快照；无组或已切书时回退当前设置。 */
  function activePlan(){
    return sessionPlan && sessionPlan.bookId === currentBookId ? sessionPlan : null;
  }
  function activeStagesMs(){
    const plan = activePlan();
    return plan ? plan.stagesMs : currentStagesMs();
  }
  function activeRelearnMs(){
    const plan = activePlan();
    return plan ? plan.relearnMs : currentRelearnMs();
  }
  function nextOnKnow(stage){
    const stagesMs = activeStagesMs();
    const idx = Math.min(Math.max(0, stage), stagesMs.length - 1);
    return {stage: Math.min(stage + 1, MASTER), delay: stagesMs[idx]};
  }
  function nextOnForget(){ return {stage: 0, delay: activeRelearnMs()}; }
  /** 档位标签（1..10 档、0=新学、≥MASTER=已掌握）；plan 传入组内快照以显示冻结曲线。 */
  function stageLabel(stage, plan){
    if (stage >= MASTER) return "已掌握";
    if (stage <= 0) return "新学";
    const stagesMs = plan && plan.stagesMs ? plan.stagesMs : currentStagesMs();
    const idx = Math.min(stage - 1, stagesMs.length - 1);
    return "第 " + stage + " 档 · " + formatStagesMs(stagesMs[idx]);
  }
  /**
   * 保存一组曲线配置（设置页/UI 与测试钩子共用）。非法整组拒绝并保留原配置；
   * 成功只写 settings + 保存 + 重渲染设置页，不重建当前组、不追溯改已写好的 p[1]。
   */
  function saveStageConfig(stages, relearn, presetName){
    const cfg = normalizeStageConfig(stages, relearn);
    if (!cfg.ok) return { ok: false, error: cfg.error };
    S.settings.stages = cfg.stages.slice();
    S.settings.relearn = cfg.relearn;
    S.settings.stagePreset = presetName || presetKeyOf(cfg.stages, cfg.relearn);
    if (presetName && STAGE_PRESETS[presetName]) {
      // 切换预设时让单位显示按新数值自动选择；用户逐档手动切过的单位只在 custom 编辑后保留。
      for (const key of Object.keys(rhythmUnitTouched)) delete rhythmUnitTouched[key];
      rhythmRelearnUnitTouched = false;
    }
    const saved = save();
    stageConfigError = null;
    rhythmLastError = null;
    renderRhythmPanel();
    markSettingsSaved();
    // 曲线与范围同属下组设置；仅同步提示，不替换当前卡/查词浮层或改写旧会话快照。
    renderSettingsLifecycle();
    renderPlanPendingNotice();
    renderStudyScope();
    return { ok: true, stages: cfg.stages.slice(), relearn: cfg.relearn, preset: S.settings.stagePreset, saved: saved };
  }
  function getStages(){ return currentStageConfig().stages.slice(); }
  function getRelearn(){ return currentStageConfig().relearn; }
  function getStagePresets(){
    const out = {};
    for (const name of STAGE_PRESET_NAMES) {
      const p = STAGE_PRESETS[name];
      out[name] = { name: name, label: p.label, stages: p.stages.slice(), relearn: p.relearn };
    }
    return out;
  }
  function getCycleSummary(){
    const cfg = currentStageConfig();
    const minutes = cfg.stages.reduce((n, m) => n + m, 0);
    return { minutes: minutes, text: formatCycleMinutes(minutes) };
  }
  function applyStagePreset(name){
    if (!Object.prototype.hasOwnProperty.call(STAGE_PRESETS, name)) {
      return { ok: false, error: { index: -1, message: "复习曲线：未知的预设「" + name + "」" } };
    }
    const p = STAGE_PRESETS[name];
    return saveStageConfig(p.stages, p.relearn, name);
  }
  function setStageMinutes(index, minutes){
    if (!Number.isInteger(index) || index < 0 || index >= STAGE_COUNT) {
      return { ok: false, error: { index: -1, message: "复习曲线：档位下标需在 0–9 之间" } };
    }
    const base = currentStageConfig();
    const candidate = base.stages.slice();
    candidate[index] = minutes;
    const cfg = normalizeStageConfig(candidate, base.relearn);
    if (!cfg.ok) return { ok: false, error: cfg.error };
    return saveStageConfig(cfg.stages, cfg.relearn, "custom");
  }
  function setRelearnMinutes(minutes){
    const base = currentStageConfig();
    const cfg = normalizeStageConfig(base.stages, minutes);
    if (!cfg.ok) return { ok: false, error: cfg.error };
    return saveStageConfig(cfg.stages, cfg.relearn, "custom");
  }
  function getPlan(){
    if (!sessionPlan) return null;
    return {
      stagesMs: sessionPlan.stagesMs.slice(),
      relearnMs: sessionPlan.relearnMs,
      bookId: sessionPlan.bookId,
      kind: sessionPlan.kind || "main",
      groupSize: sessionPlan.groupSize || S.settings.groupSize,
      startedAt: sessionPlan.startedAt,
      scopeSig: sessionPlan.scopeSig,
      scopeCount: sessionPlan.scopeCount,
      dailyNewTarget: sessionPlan.dailyNewTarget
    };
  }
  function todayStr(d){ d=d||new Date(); const p=n=>String(n).padStart(2,"0");
    return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); }
  function rng(seed){ let a=seed>>>0; return function(){ a|=0; a=a+0x6D2B79F5|0;
    let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
  function shuffle(arr,seed){ const r=rng(seed), a=arr.slice();
    for(let i=a.length-1;i>0;i--){ const j=Math.floor(r()*(i+1)); const tmp=a[i]; a[i]=a[j]; a[j]=tmp; } return a; }

  /* ================= 状态与持久化 ================= */
  // KEY / PROF_KEY 已在上方按当前词书初始化：考研键名 = 历史键名，老用户零迁移。
  // Only explicit proficiency actions write PROF_KEY; stale tabs cannot erase exclusions.
  const DEFKEYS = {know:"f", dont:"j", next:" ", speak:"s", star:"b", proficient:"m"};
  const DEFACTIONKEYS = Object.freeze({continue:null, wait:null, return:null, listSearch:null});
  const DEFAULT_GESTURES = Object.freeze({enabled:true,
    recall:Object.freeze({left:"dont",right:"know"}), revealed:Object.freeze({left:"none",right:"none"})});
  const INPUT_ACTIONS = Object.freeze([
    {id:"know",label:"会",contexts:["card"]}, {id:"dont",label:"不会",contexts:["card"]},
    {id:"next",label:"下一个",contexts:["card"]}, {id:"speak",label:"发音",contexts:["card"]},
    {id:"star",label:"收藏",contexts:["card"]}, {id:"proficient",label:"熟练",contexts:["card"]},
    {id:"continue",label:"继续下一组",contexts:["done","empty","wait"]},
    {id:"wait",label:"开始 / 退出本页等待",contexts:["empty","wait"]},
    {id:"return",label:"返回原现场",contexts:["card","done","empty","wait"]},
    {id:"listSearch",label:"词表搜索",contexts:["card","done","empty","wait"]}
  ]);
  const GESTURE_RECALL_ACTIONS = Object.freeze(["none","know","dont","speak","star","proficient","undo"]);
  const GESTURE_REVEALED_ACTIONS = Object.freeze([...GESTURE_RECALL_ACTIONS,"next"]);
  /** 旧单字符字节保持；新增只接受明确Shift+字母，保留浏览器/系统组合。 */
  function normalizeKeyBinding(value){
    if(typeof value!=="string")return null;
    if(/^[a-z0-9 ]$/i.test(value))return value.toLowerCase();
    if(/^shift\+[a-z]$/i.test(value))return value.toLowerCase();
    return null;
  }
  function normalizeActionKeys(value){
    const out=Object.assign({},DEFACTIONKEYS);
    if(value && typeof value==="object" && !Array.isArray(value))for(const id of Object.keys(out)) {
      out[id]=value[id]===null?null:normalizeKeyBinding(value[id]);
    }
    return out;
  }
  function normalizeGestures(value){
    const out={enabled:true,recall:{left:"dont",right:"know"},revealed:{left:"none",right:"none"}};
    if(!value || typeof value!=="object" || Array.isArray(value))return out;
    if(typeof value.enabled==="boolean")out.enabled=value.enabled;
    for(const phase of ["recall","revealed"])for(const side of ["left","right"]) {
      const allowed=phase==="recall"?GESTURE_RECALL_ACTIONS:GESTURE_REVEALED_ACTIONS;
      if(allowed.includes(value[phase]?.[side]))out[phase][side]=value[phase][side];
    }
    return out;
  }
  function normalizeActionLayout(value){return ["standard","left","right"].includes(value)?value:"standard";}
  /** F1 阅读顺序：必须恰好是 meaning/example/forms 的全排列；其余整组回默认。 */
  function normalizeReadingOrder(value){
    return Array.isArray(value) && value.length === READING_ORDER_KEYS.length
      && new Set(value).size === value.length
      && value.every(k => READING_ORDER_KEYS.includes(k))
      ? value.slice() : READING_ORDER_DEFAULT.slice();
  }
  /** F1 次级动作：0–2 个、无重复、仅 undo/proficient/speak/star；非法整组回默认。 */
  function normalizeSecondaryActions(value){
    return Array.isArray(value) && value.length <= 2 && new Set(value).size === value.length
      && value.every(id => SECONDARY_ACTION_IDS.includes(id))
      ? value.slice() : SECONDARY_ACTIONS_DEFAULT.slice();
  }
  function inputBindingConflict(keys,actionKeys){
    const all=Object.assign({},keys,actionKeys), actions=INPUT_ACTIONS;
    for(let i=0;i<actions.length;i++)for(let j=i+1;j<actions.length;j++) {
      const a=actions[i],b=actions[j];
      if(all[a.id] && all[a.id]===all[b.id] && a.contexts.some(c=>b.contexts.includes(c)))
        return {first:a.id,second:b.id,label:a.label+" / "+b.label,binding:all[a.id]};
    }
    return null;
  }
  function normalizeInputSettings(settings, old){
    settings.gestures=normalizeGestures(old.gestures);
    settings.actionLayout=normalizeActionLayout(old.actionLayout);
    const candidates=normalizeActionKeys(old.actionKeys);
    settings.actionKeys=Object.assign({},DEFACTIONKEYS);
    // 非法新映射只修该映射，不覆盖已保存的旧六键。
    for(const id of Object.keys(DEFACTIONKEYS)) {
      const value=candidates[id];
      if(!value)continue;
      settings.actionKeys[id]=value;
      if(inputBindingConflict(settings.keys,settings.actionKeys))settings.actionKeys[id]=null;
    }
  }
  function getInputActionDescriptors(){return INPUT_ACTIONS.map(x=>({id:x.id,label:x.label,contexts:x.contexts.slice()}));}
  function getGestureActions(phase){
    return (phase==="revealed"?GESTURE_REVEALED_ACTIONS:GESTURE_RECALL_ACTIONS).map(id=>({id,label:id==="none"?"不执行操作":id==="undo"?"撤销":INPUT_ACTIONS.find(x=>x.id===id)?.label||id}));
  }
  /** 单日复习上限：0=不限；合法范围 1–1000 次。新用户默认 100，旧记录缺字段按 0（不限，旧行为）。 */
  const DAILY_REVIEW_CAP_DEFAULT = 100;
  const DAILY_REVIEW_CAP_MAX = 1000;
  /** 今日临时加量：单次授予上限 100（UI 自定义 1–100），今日总目标硬上限 500。 */
  const EXTRA_NEW_GRANT_MAX = 100;
  const EXTRA_NEW_TARGET_MAX = 500;
  const EXTRA_GRANT_DEDUPE_MS = 600;   // 同一指针连击（detail>=2）只生效一次
  /** 07 分组与积压保护（21 默认值）：每组主卡 30 张、积压保护默认开。 */
  const GROUP_SIZE_DEFAULT = 30;
  const GROUP_SIZE_MIN = 1;
  const GROUP_SIZE_MAX = 100;
  /* ---- 22 完成页挂机自动续背（21 统一默认值的组成部分） ----
   * 新用户默认开启；旧记录缺 autoResume 字段 → enabled:false（见 normalizeAutoResume）。
   * 这些设置只控制「下一组何时自动出现」，不改变判定/额度/学习时长。 */
  const AUTO_RESUME_DEFAULT = {enabled: true, threshold: 5, idleMs: 120000, countdownMs: 15000};
  const AUTO_RESUME_LEGACY_DEFAULT = Object.assign({}, AUTO_RESUME_DEFAULT, {enabled: false});
  const AUTO_RESUME_PRESETS = {
    quick: {label: "便捷", threshold: 1, idleMs: 30000, countdownMs: 3000},
    timely: {label: "及时", threshold: 1, idleMs: 60000, countdownMs: 15000},
    balanced: {label: "均衡", threshold: 5, idleMs: 120000, countdownMs: 15000},
    focused: {label: "集中", threshold: 10, idleMs: 300000, countdownMs: 15000}
  };
  const AUTO_RESUME_BOUNDS = {
    thresholdMin: 1, thresholdMax: 50,
    idleMinMs: 30000, idleMaxMs: 600000,
    countdownMinMs: 3000, countdownMaxMs: 60000
  };
  /** 自动续背内部采样间隔（只用于倒计时/闲置判定，不承诺后台精准定时）。 */
  const AUTO_RESUME_TICK_MS = 1000;
  /** 多标签短租约：启动前抢占，只允许一个标签真正开组。 */
  const AUTO_RESUME_LEASE_KEY = "vocab_autoresume_lease_v1";
  /**
   * 「今天暂停自动续背」独立键（A 遗留修复）：{bookId:"YYYY-MM-DD"}。
   * 不进每书 state/settings、不进备份 v3、不进 savedStateSignature；同一天刷新保持、跨天失效、四书独立。
   */
  const AUTO_RESUME_PAUSE_KEY = "vocab_autoresume_pause_v1";
  /**
   * 15 刷新后继续未完成组：每本书独立轻量会话快照键（不改变备份 v3 契约）。
   * 快照只存运行时现场（队列/当前词用单词文本映射 + 主记录签名），不存学习记录本体，
   * 不进 savedStateSignature、不进导出；主记录/熟练键永远优先。
   */
  const SESSION_SNAPSHOT_VERSION = 1;
  const SESSION_SNAPSHOT_PREFIX = "vocab_session_snapshot_";
  const SESSION_SNAPSHOT_MAX_QUEUE = 200;
  const AUTO_RESUME_LEASE_TTL_MS = 60000;
  const AUTO_RESUME_TAB_ID = "tab-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
  /** 21 默认值：TXT 拆分默认每份 4000 词（界面与文本导出共用）。 */
  const TXT_SPLIT_DEFAULT = 4000;
  /* ---- 12 阅读字号与设备发音（跨书界面偏好；旧记录缺字段回退标准/默认语速） ----
   * 字号只放大释义、例句等阅读文本；发音偏好只影响本机 speechSynthesis，
   * 不保证设备离线可用、也不代表词典原声。 */
  const FONT_SIZE_DEFAULT = "standard";
  const FONT_SIZE_VALUES = ["standard", "large"];
  /** 语音语速允许范围（0.5–1.5），默认沿用历史固定值 0.92。 */
  const SPEECH_RATE_DEFAULT = 0.92;
  const SPEECH_RATE_MIN = 0.5;
  const SPEECH_RATE_MAX = 1.5;
  /* ---- F1 阅读与布局定制（跨书界面偏好，立即生效；不改学习算法/队列/预算） ----
   * readingOrder 是判定后主体的严格全排列；单词词头始终在答案前，回忆阶段不泄漏释义。
   * secondaryActions 固定原第三行的 0–2 个动作，不减少“更多操作”里的入口。 */
  const CARD_DENSITY_VALUES = ["comfortable", "compact"];
  const CARD_DENSITY_DEFAULT = "comfortable";
  const READING_ORDER_KEYS = ["meaning", "example", "forms"];
  const READING_ORDER_DEFAULT = ["meaning", "example", "forms"];
  const SECONDARY_ACTION_IDS = ["undo", "proficient", "speak", "star"];
  const SECONDARY_ACTIONS_DEFAULT = ["undo", "proficient"];
  /** 统计页 6 个高阶面板的展开偏好：设备级独立键，不进备份 v3/进度签名/设置目录/scopeSig。 */
  const STATS_PANELS_KEY = "vocab_stats_panels_v1";
  const STATS_PANEL_IDS = ["statsForecastPanel", "surveyPanel", "statsFreqPanel",
    "statsStagesPanel", "statsDaysPanel", "statsHeatmapPanel"];
  const STATS_CARD_IDS = ["statsPlanPanel", "statsOverviewPanel", ...STATS_PANEL_IDS, "statsStoragePanel"];
  /* ---- 16 拼写专项（只做拼写；不占新词额度、不推进主 SRS、不写主学习统计） ----
   * 记录按书写入 state.spelling（随备份 v3 的每书 state 整体导出），只保存累计与最近一组汇总，
   * 不保存逐词明细；判定规则见 spellCompare()：大小写不敏感 → 显式英美变体表 → 分隔符宽松 → 判错。 */
  const SPELLING_ROUND_SIZE = 10;
  const SPELLING_MAX_INPUT = 80;
  /** 显式英美拼写变体对（整词、双向；仅当词库词是其中一端时接受另一端，不做后缀规则）。 */
  const SPELLING_VARIANT_PAIRS = [
    ["colour", "color"], ["favourite", "favorite"], ["honour", "honor"], ["honourable", "honorable"],
    ["labour", "labor"], ["neighbour", "neighbor"], ["behaviour", "behavior"], ["flavour", "flavor"],
    ["harbour", "harbor"], ["humour", "humor"], ["rumour", "rumor"], ["centre", "center"],
    ["metre", "meter"], ["litre", "liter"], ["theatre", "theater"], ["fibre", "fiber"],
    ["organise", "organize"], ["organisation", "organization"], ["realise", "realize"],
    ["recognise", "recognize"], ["analyse", "analyze"], ["apologise", "apologize"],
    ["criticise", "criticize"], ["emphasise", "emphasize"], ["specialise", "specialize"],
    ["summarise", "summarize"], ["defence", "defense"], ["offence", "offense"], ["licence", "license"],
    ["programme", "program"], ["travelled", "traveled"], ["travelling", "traveling"],
    ["cancelled", "canceled"], ["cancelling", "canceling"], ["labelled", "labeled"],
    ["modelling", "modeling"], ["jewellery", "jewelry"], ["grey", "gray"], ["tyre", "tire"],
    ["ageing", "aging"], ["judgement", "judgment"], ["acknowledgement", "acknowledgment"],
    ["fulfil", "fulfill"], ["enrolment", "enrollment"], ["instalment", "installment"],
    ["skilful", "skillful"], ["wilful", "willful"], ["plough", "plow"], ["mould", "mold"],
    ["cosy", "cozy"], ["sceptical", "skeptical"]
  ];
  /** 词 -> 允许的另一端拼写；label 表示用户输入的是哪种拼写。 */
  const SPELLING_VARIANTS = (() => {
    const map = new Map();
    const add = (key, other, label) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({word: other, label: label});
    };
    for (const pair of SPELLING_VARIANT_PAIRS) {
      add(pair[0], pair[1], "美式");
      add(pair[1], pair[0], "英式");
    }
    return map;
  })();
  /**
   * DEF 是唯一默认值来源：新用户/新词书、归一化缺省值、表单回填、恢复默认都从这里取。
   */
  const DEF = {
    settings: {
      // 首次打开：考研词书 + 随机乱序 + 每日 20 词 + 浅色主题。
      dailyNew: 20, order: "shuffle",
      // 单日主流程复习判定次数上限（不含新词首次学习与错词特训）。
      dailyReviewCap: DAILY_REVIEW_CAP_DEFAULT,
      // 07 每组入组主卡数（到期优先，剩余槽位按新词额度补）；只是分组长度，不是每日复习上限。
      groupSize: GROUP_SIZE_DEFAULT,
      // 07 积压保护：到期量超过今日剩余复习预算时，不自动往本组补新词。
      backlogGuard: true,
      fmin: 1, fmax: 0, pmin: 2, kyOnly: false, pos: [],
      // 词性筛选口径：primary=只按主标签 x.p（默认，向后兼容）；all=按释义 m 中出现的全部词性。
      posMode: "primary",
      // 复习曲线（新用户默认＝均衡预设；旧记录缺字段在 normalizeState 走 legacy 兼容）。
      stages: STAGE_PRESETS.balanced.stages.slice(),
      relearn: STAGE_PRESETS.balanced.relearn,
      stagePreset: "balanced",
      theme: "light",
      showPh: true, showEx: true, showFm: true, autoSpk: false,
      // 12 阅读字号（standard|large，只影响释义/例句等阅读文本）与设备语音偏好。
      fontSize: FONT_SIZE_DEFAULT,
      voiceURI: "",
      speechRate: SPEECH_RATE_DEFAULT,
      singleCharKeys: true,
      keys: Object.assign({}, DEFKEYS),
      actionKeys: Object.assign({}, DEFACTIONKEYS),
      gestures: normalizeGestures(DEFAULT_GESTURES),
      actionLayout: "standard",
      // F1 阅读与布局：密度/判定后主体顺序/卡片次要元信息/固定次级动作；只改呈现。
      cardDensity: CARD_DENSITY_DEFAULT,
      readingOrder: READING_ORDER_DEFAULT.slice(),
      showCardMeta: true, showCardStage: true, showCardPos: true,
      secondaryActions: SECONDARY_ACTIONS_DEFAULT.slice(),
      // 22 完成页挂机自动续背：新用户默认开启；旧记录缺字段默认关闭（normalizeAutoResume）。
      autoResume: Object.assign({}, AUTO_RESUME_DEFAULT)
    },
    // 当日主流程复习判定台账（按书、按本地日期）；freshState/normalizeState 填今日。
    reviewDay: null,
    // 当日临时加量（按书、按本地日期，0–500）；跨天归零、不结转，长期 dailyNew 不变。
    extraDay: null,
    // 16 拼写专项（每书独立）：只累计完成的组与最近一组汇总，不含逐词明细。
    spelling: {sessions: 0, attempts: 0, correct: 0, skipped: 0, lastDay: null, lastSession: null},
    progress: {}, days: {}, stars: {}, proficient: {}, timeSec: 0, dv: 1
  };
  /** 空白记录：dv = 该词书当前数据版本（旧记录无 dv 视作 1） */
  function freshState(book){
    const st = JSON.parse(JSON.stringify(DEF));
    st.dv = ((book || currentBook()).dataVersion) || 1;
    st.reviewDay = {d: todayStr(), used: 0};
    st.extraDay = {d: todayStr(), extra: 0};
    return st;
  }

  /* ================= O1 设备通用 / 本书覆盖偏好归属 =================
   * 依据 docs/输入与偏好下一步规格-2026-10-24.md §6：
   * - 独立 localStorage 键 vocab_device_preferences_v1：shared=设备通用值（19 项严格合法），
   *   overrides[book]=本书覆盖的字段名；effective = 有覆盖 ? 该书 settings 值 : shared 值。
   * - S.settings 继续是当前书已解析运行时快照（不为 O1 改几十处读点）；覆盖标记才是取值来源裁决，
   *   shared 变化后未覆盖字段必须重新解析，不信任主记录里的物化缓存。
   * - 迁移：设备键不存在时 shared=DEF 默认值，每本已有旧主记录的书把 19 项全部标本书覆盖
   *   （值取该书旧 settings）；不选基准书、不改已有主记录、只写设备键。写失败保留本页值并
   *   明确提示归属未保存，本次不执行会覆盖目标书偏好的旧 carry，安全降级为每书独立。
   * - 设备键损坏/高版本：保留原文、禁写该键，各书仍读自己的 settings（每书独立），不以空 shared 覆写。
   * - 覆盖增删 / “设为设备通用” / 方案同时改计划与偏好：小事务 vocab_preferences_journal_v1，
   *   准备值 → 比较最新原文 → 全成功才提交内存；失败整份回滚，回滚失败保留日志并启动提示恢复。
   * - 备份 v3 导出每书实际有效偏好（只读快照，不写 shared/overrides 元数据）；导入后把被导入书
   *   的可携带偏好标本书覆盖，设备 shared 不变，未导入书覆盖不动，导入 journal 含设备键旧原文。
   */
  const DEVICE_PREFS_KEY = "vocab_device_preferences_v1";
  const DEVICE_PREFS_KIND = "vocab-device-preferences";
  const DEVICE_PREFS_VERSION = 1;
  const PREF_JOURNAL_KEY = "vocab_preferences_journal_v1";
  /** 设备通用/本书覆盖的偏好字段 = 原 CARRY_SETTINGS 全部 19 项（O1 后由覆盖标记裁决来源）。 */
  const PREFERENCE_FIELDS = Object.freeze([
    "theme", "keys", "showPh", "showEx", "showFm", "autoSpk", "singleCharKeys",
    "fontSize", "voiceURI", "speechRate", "actionKeys", "gestures", "actionLayout",
    "cardDensity", "readingOrder", "showCardMeta", "showCardStage", "showCardPos", "secondaryActions"
  ]);
  const PREFERENCE_LABELS = Object.freeze({
    theme: "颜色主题", keys: "自定义快捷键", showPh: "显示音标", showEx: "显示例句", showFm: "显示词形",
    autoSpk: "自动发音", singleCharKeys: "单字符快捷键", fontSize: "阅读字号", voiceURI: "英语语音",
    speechRate: "朗读语速", actionKeys: "继续与返回快捷键", gestures: "卡片滑动手势",
    actionLayout: "左右手操作布局", cardDensity: "卡片密度", readingOrder: "判定后阅读顺序",
    showCardMeta: "卡片词频套卷标签", showCardStage: "卡片复习阶段", showCardPos: "卡片词性",
    secondaryActions: "固定次级动作"
  });
  const PREFERENCE_CARD_FIELDS = Object.freeze(["showPh", "showEx", "showFm", "keys", "singleCharKeys",
    "fontSize", "cardDensity", "readingOrder", "showCardMeta", "showCardStage", "showCardPos",
    "secondaryActions", "actionLayout"]);
  /** 设备偏好运行态：shared/overrides 内存镜像 + 原文与状态；损坏/高版本时只读原文、禁写。 */
  let devicePrefs = null;
  let devicePrefsRaw = null;
  let devicePrefsStatus = "pending";     // pending|ok|missing|damaged|unsupported|write-failed|unavailable
  let devicePrefsError = "";
  let devicePrefsLegacy = false;
  let devicePrefsInitialized = false;
  let devicePrefsWriteNotified = false;
  let lastResolvedPrefs = {};
  let prefJournalRecovered = false;
  let prefJournalRecoveryFailed = false;

  function clonePrefValue(value){
    return (value && typeof value === "object") ? JSON.parse(JSON.stringify(value)) : value;
  }
  function prefValuesEqual(a, b){ return JSON.stringify(a) === JSON.stringify(b); }
  function prefBookIds(){ return BOOK_DEFS.map(def => def.id); }
  function defaultPreferenceShared(){
    const out = {};
    for (const field of PREFERENCE_FIELDS) out[field] = clonePrefValue(DEF.settings[field]);
    return out;
  }
  function emptyPreferenceOverrides(){
    const out = {};
    for (const id of prefBookIds()) out[id] = [];
    return out;
  }
  /** 严格字段校验（与设置方案同一口径；不把非法值静默修成默认）。 */
  function validPreferenceValue(field, value){
    switch (field) {
      case "theme": return ["light", "dark", "auto"].includes(value);
      case "keys": return isRecord(value) && Object.keys(value).length === Object.keys(DEFKEYS).length
        && Object.keys(DEFKEYS).every(k => Object.prototype.hasOwnProperty.call(value, k)
          && validKey(value[k]) && value[k] === normalizeKeyBinding(value[k]))
        && Object.keys(value).every(k => Object.prototype.hasOwnProperty.call(DEFKEYS, k))
        && new Set(Object.values(value)).size === Object.keys(DEFKEYS).length;
      case "showPh": case "showEx": case "showFm": case "autoSpk": case "singleCharKeys":
      case "showCardMeta": case "showCardStage": case "showCardPos": return typeof value === "boolean";
      case "fontSize": return FONT_SIZE_VALUES.includes(value);
      case "voiceURI": return typeof value === "string" && value === value.trim() && value.length <= 200;
      case "speechRate": return typeof value === "number" && Number.isFinite(value)
        && value >= SPEECH_RATE_MIN && value <= SPEECH_RATE_MAX
        && Math.abs(value * 100 - Math.round(value * 100)) < 0.00000001;
      case "actionKeys": return isRecord(value) && Object.keys(value).length === Object.keys(DEFACTIONKEYS).length
        && Object.keys(value).every(k => Object.prototype.hasOwnProperty.call(DEFACTIONKEYS, k))
        && Object.values(value).every(k => k === null || normalizeKeyBinding(k) === k);
      case "gestures": {
        if (!isRecord(value) || Object.keys(value).length !== 3
          || typeof value.enabled !== "boolean" || !isRecord(value.recall) || !isRecord(value.revealed)) return false;
        for (const phase of ["recall", "revealed"]) {
          const allowed = phase === "recall" ? GESTURE_RECALL_ACTIONS : GESTURE_REVEALED_ACTIONS;
          const sideMap = value[phase];
          if (Object.keys(sideMap).length !== 2) return false;
          for (const side of ["left", "right"]) {
            if (!Object.prototype.hasOwnProperty.call(sideMap, side) || !allowed.includes(sideMap[side])) return false;
          }
        }
        return true;
      }
      case "actionLayout": return ["standard", "left", "right"].includes(value);
      case "cardDensity": return CARD_DENSITY_VALUES.includes(value);
      case "readingOrder": return Array.isArray(value) && value.length === READING_ORDER_KEYS.length
        && new Set(value).size === value.length && value.every(k => READING_ORDER_KEYS.includes(k));
      case "secondaryActions": return Array.isArray(value) && value.length <= 2
        && new Set(value).size === value.length && value.every(id => SECONDARY_ACTION_IDS.includes(id));
      default: return false;
    }
  }
  /**
   * 严格解码设备偏好键。只对“本批新增字段缺失”做 DEF 兼容解码（先 O1 后 F1 的历史：
   * 旧 version:1 键缺新字段仍合法），未知字段/类型错误/格式错误/高版本一律拒绝。
   * 解码本身不写回原文。
   */
  function decodeDevicePreferences(raw){
    if (raw === null || raw === undefined) return {ok: false, status: "missing"};
    let parsed = null;
    try { parsed = JSON.parse(raw); }
    catch (e) { return {ok: false, status: "damaged", error: "偏好归属存储不是有效的 JSON"}; }
    if (!isRecord(parsed)) return {ok: false, status: "damaged", error: "偏好归属存储格式不正确"};
    if (typeof parsed.version === "number" && parsed.version > DEVICE_PREFS_VERSION) {
      return {ok: false, status: "unsupported", error: "偏好归属存储版本高于当前页面"};
    }
    if (parsed.kind !== DEVICE_PREFS_KIND || parsed.version !== DEVICE_PREFS_VERSION) {
      return {ok: false, status: "damaged", error: "偏好归属存储标识或版本不正确"};
    }
    if (Object.keys(parsed).some(k => !["kind", "version", "shared", "overrides"].includes(k))) {
      return {ok: false, status: "damaged", error: "偏好归属存储含未知字段"};
    }
    if (!isRecord(parsed.shared)) return {ok: false, status: "damaged", error: "偏好归属缺少设备通用值"};
    const shared = {};
    let legacy = false;
    for (const field of PREFERENCE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(parsed.shared, field)) {
        shared[field] = clonePrefValue(DEF.settings[field]);
        legacy = true;
        continue;
      }
      const value = parsed.shared[field];
      if (!validPreferenceValue(field, value)) {
        return {ok: false, status: "damaged", error: "偏好归属值不合法：" + (PREFERENCE_LABELS[field] || field)};
      }
      shared[field] = clonePrefValue(value);
    }
    if (Object.keys(parsed.shared).some(k => !PREFERENCE_FIELDS.includes(k))) {
      return {ok: false, status: "damaged", error: "偏好归属含未知字段"};
    }
    if (inputBindingConflict(shared.keys, shared.actionKeys)) {
      return {ok: false, status: "damaged", error: "偏好归属的快捷键互相冲突"};
    }
    if (!isRecord(parsed.overrides)) return {ok: false, status: "damaged", error: "偏好归属缺少本书覆盖表"};
    const overrides = emptyPreferenceOverrides();
    for (const [bookId, list] of Object.entries(parsed.overrides)) {
      if (!Object.prototype.hasOwnProperty.call(overrides, bookId)) {
        return {ok: false, status: "damaged", error: "偏好归属含未知词书"};
      }
      if (!Array.isArray(list)) return {ok: false, status: "damaged", error: "偏好归属覆盖表格式不正确"};
      const seen = new Set();
      for (const field of list) {
        if (typeof field !== "string" || !PREFERENCE_FIELDS.includes(field) || seen.has(field)) {
          return {ok: false, status: "damaged", error: "偏好归属覆盖表含非法字段"};
        }
        seen.add(field);
      }
      overrides[bookId] = PREFERENCE_FIELDS.filter(field => seen.has(field));
    }
    return {ok: true, status: "ok", legacy: legacy,
      prefs: {kind: DEVICE_PREFS_KIND, version: DEVICE_PREFS_VERSION, shared: shared, overrides: overrides}};
  }
  function readDevicePreferences(){
    let raw = null;
    try { raw = localStorage.getItem(DEVICE_PREFS_KEY); }
    catch (e) {
      devicePrefs = null; devicePrefsRaw = null; devicePrefsStatus = "unavailable";
      devicePrefsError = "浏览器存储不可用";
      return {status: "unavailable", error: devicePrefsError};
    }
    const decoded = decodeDevicePreferences(raw);
    devicePrefsRaw = raw;
    if (decoded.ok) {
      devicePrefs = decoded.prefs;
      devicePrefsStatus = "ok";
      devicePrefsError = "";
      devicePrefsLegacy = !!decoded.legacy;
      return {status: "ok", prefs: devicePrefs, legacy: devicePrefsLegacy};
    }
    devicePrefs = null;
    devicePrefsStatus = decoded.status || "damaged";
    devicePrefsError = decoded.error || "";
    return {status: devicePrefsStatus, error: devicePrefsError, raw: raw};
  }
  function persistDevicePreferences(prefs){
    const text = JSON.stringify(prefs);
    try {
      localStorage.setItem(DEVICE_PREFS_KEY, text);
      if (localStorage.getItem(DEVICE_PREFS_KEY) !== text) throw new Error("readback");
    } catch (e) { return false; }
    devicePrefs = clonePrefValue(prefs);
    devicePrefsRaw = text;
    devicePrefsStatus = "ok";
    devicePrefsError = "";
    devicePrefsLegacy = false;
    return true;
  }
  function preferenceDeviceUsable(){
    return devicePrefsStatus === "ok" || (devicePrefsStatus === "write-failed" && !!devicePrefs);
  }
  function preferenceStatusText(){
    if (devicePrefsStatus === "write-failed") return "偏好归属尚未保存到本机（浏览器存储写入失败）";
    if (devicePrefsStatus === "damaged") return "偏好归属存储损坏，已保留原文并暂停写入";
    if (devicePrefsStatus === "unsupported") return "偏好归属存储版本高于当前页面，已保留原文并暂停写入";
    if (devicePrefsStatus === "unavailable") return "浏览器存储不可用，偏好归属暂不可用";
    if (devicePrefsStatus === "missing") return "偏好归属尚未建立";
    return "偏好归属尚未准备好";
  }
  function markPreferenceWriteFailure(message){
    if (devicePrefsStatus === "ok") devicePrefsStatus = "write-failed";
    if (devicePrefsWriteNotified) return;
    devicePrefsWriteNotified = true;
    showAlert("偏好归属未能保存", (message || "外观、发音与按键等偏好暂按每书独立保存")
      + "。当前页仍显示新值；刷新后可能回到旧值。学习进度与已被其他词书覆盖的偏好不受影响，请检查浏览器存储空间。",
      {kind: "prefs"});
  }
  /**
   * 一次性迁移（bootstrapSession 之前）：设备键不存在 → shared=DEF、每本已有旧主记录的书 19 项
   * 全部标本书覆盖；只写设备键，不改任何主记录。写失败：本页保留迁移后的取值规则（旧书即各自
   * 旧值），但明确提示归属未保存，且暂不写设备键。
   */
  function initDevicePreferences(force){
    if (devicePrefsInitialized && !force) return devicePrefsStatus;
    devicePrefsInitialized = true;
    const got = readDevicePreferences();
    if (got.status === "ok") return "ok";
    if (got.status !== "missing") return got.status;   // 损坏/高版本/不可用：保留原文、禁写
    const prefs = {kind: DEVICE_PREFS_KIND, version: DEVICE_PREFS_VERSION,
      shared: defaultPreferenceShared(), overrides: emptyPreferenceOverrides()};
    for (const def of BOOK_DEFS) {
      const book = BOOKS[def.id];
      if (!book || !book.available) continue;
      let raw = null;
      try { raw = localStorage.getItem(book.KEY); } catch (e) { continue; }
      if (raw === null) continue;
      // 损坏记录不归一化、不改写、不标覆盖；它自己的读取失败由原有保护流程处理。
      try {
        const parsed = JSON.parse(raw);
        if (isRecord(parsed)) prefs.overrides[def.id] = PREFERENCE_FIELDS.slice();
      } catch (e) { /* ignore */ }
    }
    if (persistDevicePreferences(prefs)) return "ok";
    devicePrefs = prefs;
    devicePrefsRaw = null;
    devicePrefsStatus = "write-failed";
    devicePrefsError = "偏好归属未能写入浏览器存储";
    markPreferenceWriteFailure();
    return "write-failed";
  }
  function preferenceOverrideList(bookId){
    if (!devicePrefs || !devicePrefs.overrides) return [];
    const list = devicePrefs.overrides[bookId];
    return Array.isArray(list) ? list : [];
  }
  function isPreferenceOverridden(field, bookId){
    return preferenceOverrideList(bookId || currentBookId).includes(field);
  }
  /** 运行时常量入口：effective = 覆盖 ? 本书 settings : shared；设备键不可用时回退本书 settings。 */
  function resolveBookPreferences(bookState, bookId, prefs){
    const source = prefs || (preferenceDeviceUsable() ? devicePrefs : null);
    const settings = clonePrefValue((bookState && bookState.settings) || DEF.settings) || {};
    if (!source || !isRecord(source.shared)) return settings;
    const overrides = Array.isArray(source.overrides?.[bookId]) ? source.overrides[bookId] : [];
    for (const field of PREFERENCE_FIELDS) {
      if (overrides.includes(field)) continue;
      if (Object.prototype.hasOwnProperty.call(source.shared, field)) {
        settings[field] = clonePrefValue(source.shared[field]);
      }
    }
    return settings;
  }
  /** 把某书 state 的 settings 解析为有效快照（就地修改；读载入/切书/导出只读快照共用）。 */
  function applyBookPreferenceResolution(state, bookId){
    if (!state || !state.settings || !preferenceDeviceUsable()) return false;
    const resolved = resolveBookPreferences(state, bookId, devicePrefs);
    let changed = false;
    for (const field of PREFERENCE_FIELDS) {
      if (!prefValuesEqual(state.settings[field], resolved[field])) {
        state.settings[field] = resolved[field];
        changed = true;
      }
    }
    return changed;
  }
  function syncLastResolvedPreferences(){
    lastResolvedPrefs = {};
    for (const field of PREFERENCE_FIELDS) lastResolvedPrefs[field] = clonePrefValue(S.settings[field]);
  }
  function localInheritedPreferenceEdits(){
    const fields = [];
    if (!preferenceDeviceUsable()) return fields;
    for (const field of PREFERENCE_FIELDS) {
      if (isPreferenceOverridden(field)) continue;
      if (!prefValuesEqual(S.settings[field], devicePrefs.shared[field])) fields.push(field);
    }
    return fields;
  }
  /** 远端 shared 变化/迁移后，只重解析本书未覆盖字段并刷新呈现（不换书/不 startSession/不关浮层）。 */
  function reResolveInheritedPreferences(){
    if (!preferenceDeviceUsable()) return false;
    const previous = clonePrefValue(S.settings);
    for (const field of PREFERENCE_FIELDS) {
      if (isPreferenceOverridden(field)) continue;
      S.settings[field] = clonePrefValue(devicePrefs.shared[field]);
    }
    const changed = !prefValuesEqual(previous, S.settings);
    if (changed) {
      noteInputPreferencesCommitted(previous);
      syncLastResolvedPreferences();
      refreshPreferenceDisplaySurfaces(previous);
    }
    return changed;
  }
  /** 偏好相关呈现的轻量刷新：主题/字号即时，卡片相关延后到无浮层时。 */
  function refreshPreferenceDisplaySurfaces(previous){
    try { applyTheme(); applyFontSize(); } catch (e) { /* ignore */ }
    try {
      if (PREFERENCE_CARD_FIELDS.some(field => !prefValuesEqual(previous?.[field], S.settings[field]))) {
        sharedCardRefreshPending = currentBookId;
      }
      if (sharedCardRefreshPending === currentBookId && !activeSheet) renderCard();
    } catch (e) { /* ignore */ }
    renderPreferenceOwnershipControls();
  }
  /**
   * 本地显式改动的继承字段写回设备 shared（save 路径）。写前重读最新原文：
   * 另一页面刚改过设备键时，不拿本页旧缓存整份覆盖；本次偏好未写入并明确提示。
   */
  function flushInheritedPreferenceEdits(){
    if (!preferenceDeviceUsable()) return true;
    const fields = localInheritedPreferenceEdits();
    if (!fields.length) return true;
    let latestRaw = null;
    try { latestRaw = localStorage.getItem(DEVICE_PREFS_KEY); }
    catch (e) { markPreferenceWriteFailure("浏览器存储不可用"); return false; }
    let base = devicePrefs;
    if (latestRaw !== devicePrefsRaw) {
      const decoded = decodeDevicePreferences(latestRaw);
      if (!decoded.ok) {
        devicePrefsStatus = decoded.status || "damaged";
        devicePrefsError = decoded.error || "";
        markPreferenceWriteFailure("另一页面刚更新或损坏了偏好归属存储，本次偏好未写入");
        return false;
      }
      base = decoded.prefs;
    }
    // 同字段的远端更新不能被旧基线编辑覆盖；不同字段仍合并到最新设备原文。
    // 拒绝的字段立即采纳最新值并清除待写差异，避免下一次学习自动保存又偷偷提交旧输入。
    const conflicts = fields.filter(field =>
      (!prefValuesEqual(base.shared[field], devicePrefs.shared[field])
        && !prefValuesEqual(S.settings[field], base.shared[field]))
      || ((base.overrides[currentBookId] || []).includes(field) !== isPreferenceOverridden(field)));
    const accepted = fields.filter(field => !conflicts.includes(field));
    if (accepted.length) {
      const next = clonePrefValue(base);
      for (const field of accepted) next.shared[field] = clonePrefValue(S.settings[field]);
      if (!persistDevicePreferences(next)) {
        markPreferenceWriteFailure("浏览器存储写入失败");
        return false;
      }
    } else {
      devicePrefs = clonePrefValue(base);
      devicePrefsRaw = latestRaw;
      devicePrefsStatus = "ok";
      devicePrefsError = "";
    }
    // 远端其他未覆盖字段按最新 shared 重新解析；只保留本次实际被接受的编辑。
    const previous = clonePrefValue(S.settings);
    for (const field of PREFERENCE_FIELDS) {
      if (accepted.includes(field) || isPreferenceOverridden(field)) continue;
      S.settings[field] = clonePrefValue(devicePrefs.shared[field]);
    }
    // 若另一页把本字段切为本书覆盖，采用该书最新已保存值，不能把拒绝的旧编辑留在内存。
    const overriddenConflicts = conflicts.filter(field => isPreferenceOverridden(field));
    if (overriddenConflicts.length) {
      try {
        const latest = localStorage.getItem(KEY), saved = latest && normalizeState(JSON.parse(latest), currentBookId);
        for (const field of overriddenConflicts) S.settings[field] = clonePrefValue(saved?.settings?.[field] ?? lastResolvedPrefs[field]);
      } catch (e) {
        for (const field of overriddenConflicts) S.settings[field] = clonePrefValue(lastResolvedPrefs[field]);
      }
    }
    noteInputPreferencesCommitted(previous);
    syncLastResolvedPreferences();
    if (!prefValuesEqual(previous, S.settings)) refreshSharedSettingsSurfaces(true, previous);
    if (conflicts.length) {
      const message = "另一页面刚更新了“" + conflicts.map(field => PREFERENCE_LABELS[field] || field).join("、")
        + "”，已同步最新值；本次旧值未覆盖，请核对后重试。";
      toast(message);
      const status = $("#preferenceOwnershipStatus");
      if (status) status.textContent = message;
    }
    return conflicts.length === 0;
  }
  /**
   * 主记录设置同步路径里的另一页“有效偏好快照”：未被本书覆盖的字段差异写回设备 shared。
   * 若设备键已被另一页面更新，则以设备键为准，不把主记录旧物化快照写回 shared。
   */
  function adoptIncomingPreferenceSettings(materialized){
    if (!preferenceDeviceUsable() || !isRecord(materialized)) return false;
    const fields = [];
    for (const field of PREFERENCE_FIELDS) {
      if (isPreferenceOverridden(field)) continue;
      if (!prefValuesEqual(materialized[field], devicePrefs.shared[field])) fields.push(field);
    }
    if (!fields.length) return false;
    let latestRaw = null;
    try { latestRaw = localStorage.getItem(DEVICE_PREFS_KEY); } catch (e) { return false; }
    if (latestRaw !== devicePrefsRaw) {
      const decoded = decodeDevicePreferences(latestRaw);
      if (!decoded.ok) { devicePrefsStatus = decoded.status || "damaged"; return false; }
      devicePrefs = decoded.prefs;
      devicePrefsRaw = latestRaw;
      devicePrefsStatus = "ok";
      return false;
    }
    const next = clonePrefValue(devicePrefs);
    for (const field of fields) next.shared[field] = clonePrefValue(materialized[field]);
    return persistDevicePreferences(next);
  }
  /** 主记录里收到的设置（另一页的有效快照）→ 采纳 + 按覆盖标记重新解析。 */
  function resolveIncomingPreferenceSettings(materialized){
    if (!preferenceDeviceUsable() || !isRecord(materialized)) return clonePrefValue(materialized);
    const out = clonePrefValue(materialized);
    adoptIncomingPreferenceSettings(materialized);
    for (const field of PREFERENCE_FIELDS) {
      out[field] = isPreferenceOverridden(field)
        ? clonePrefValue(materialized[field])
        : clonePrefValue(devicePrefs.shared[field]);
    }
    return out;
  }

  /* ---- O1 小事务 / 恢复日志：设备键 + 受影响书主键，全成功才提交内存 ---- */
  function prefFail(error){ return {ok: false, error: error}; }
  function readPreferenceJournal(){
    try {
      const raw = localStorage.getItem(PREF_JOURNAL_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function validPreferenceJournal(journal){
    return isRecord(journal) && isRecord(journal.keys)
      && Object.keys(journal.keys).length > 0
      && Object.keys(journal.keys).every(key => journal.keys[key] === null || typeof journal.keys[key] === "string");
  }
  function restorePreferenceJournalKeys(journal){
    for (const [key, value] of Object.entries(journal.keys)) {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    localStorage.removeItem(PREF_JOURNAL_KEY);
  }
  /** 启动恢复：上次偏好归属事务未完成 → 恢复涉及的键；失败保留日志并提示。 */
  function recoverPreferenceJournal(){
    let journal = null;
    try {
      const raw = localStorage.getItem(PREF_JOURNAL_KEY);
      journal = raw ? JSON.parse(raw) : null;
    } catch (e) { prefJournalRecoveryFailed = true; return false; }
    if (!journal) return true;
    if (!validPreferenceJournal(journal)) { prefJournalRecoveryFailed = true; return false; }
    try {
      restorePreferenceJournalKeys(journal);
      prefJournalRecovered = true;
      return true;
    } catch (e) { prefJournalRecoveryFailed = true; return false; }
  }
  /**
   * 提交一次偏好归属改动：设备键 + 当前书主键（可选）作为一个事务。
   * 准备值 → 比较最新原文 → 写恢复日志 → 写入并回读核对 → 全成功才提交内存；失败整份回滚。
   */
  function commitPreferenceChange(nextPrefs, nextSettings, opts){
    opts = opts || {};
    if (!preferenceDeviceUsable()) return prefFail(preferenceStatusText() + "，暂按每书独立保存");
    if (pendingReplacementToken) return prefFail("当前学习记录尚未安全保存，偏好归属未改动");
    if (readPreferenceJournal()) return prefFail("上次偏好归属保存未完成，请刷新页面恢复后再试");
    let latestDeviceRaw = null;
    try { latestDeviceRaw = localStorage.getItem(DEVICE_PREFS_KEY); }
    catch (e) { return prefFail("浏览器存储不可用，偏好归属未改动"); }
    if (latestDeviceRaw !== devicePrefsRaw) return prefFail("另一页面刚更新了偏好归属，请等待同步后重试，本次未改动");
    const deviceText = JSON.stringify(nextPrefs);
    let mainText = null;
    if (opts.saveBook !== false) {
      let latestMainRaw = null;
      try { latestMainRaw = localStorage.getItem(KEY); }
      catch (e) { return prefFail("浏览器存储不可用，偏好归属未改动"); }
      if (latestMainRaw !== lastMainRaw) return prefFail("另一页面已更新本书记录，请等待同步后重试，本次未改动");
      mainText = serializeSharedState(Object.assign({}, S, {settings: nextSettings}), latestMainRaw, pendingReplacementToken);
    }
    const journal = {at: new Date().toISOString(), keys: {}};
    journal.keys[DEVICE_PREFS_KEY] = latestDeviceRaw;
    if (mainText !== null) journal.keys[KEY] = localStorage.getItem(KEY);
    try { localStorage.setItem(PREF_JOURNAL_KEY, JSON.stringify(journal)); }
    catch (e) { return prefFail("无法创建偏好归属恢复点（存储空间不足），本次未改动"); }
    const rollback = () => {
      try {
        for (const [key, value] of Object.entries(journal.keys)) {
          // 写入失败时该键可能尚未改变：跳过无变化的恢复，避免在配额不足时把可恢复错误升级为回滚失败。
          const current = localStorage.getItem(key);
          if ((current === null ? null : current) === (value === null || value === undefined ? null : value)) continue;
          if (value === null || value === undefined) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        }
        localStorage.removeItem(PREF_JOURNAL_KEY);
        return true;
      } catch (e) { return false; }
    };
    try {
      localStorage.setItem(DEVICE_PREFS_KEY, deviceText);
      if (localStorage.getItem(DEVICE_PREFS_KEY) !== deviceText) throw new Error("设备偏好写入校验失败");
      if (mainText !== null) {
        localStorage.setItem(KEY, mainText);
        if (localStorage.getItem(KEY) !== mainText) throw new Error("主记录写入校验失败");
      }
    } catch (e) {
      if (rollback()) return prefFail("偏好归属保存失败，已回滚到改动前");
      showAlert("偏好归属保存失败", "自动回滚也未完成：恢复日志已保留，请刷新页面以尝试恢复；"
        + "恢复前请勿继续修改偏好归属或导入备份。", {kind: "prefs", prefRecover: true});
      return prefFail("偏好归属保存失败且自动回滚未完成，恢复日志已保留");
    }
    try { localStorage.removeItem(PREF_JOURNAL_KEY); } catch (e) { /* ignore */ }
    // 提交内存
    const previous = clonePrefValue(S.settings);
    devicePrefs = clonePrefValue(nextPrefs);
    devicePrefsRaw = deviceText;
    devicePrefsStatus = "ok";
    devicePrefsError = "";
    devicePrefsLegacy = false;
    if (mainText !== null) lastMainRaw = mainText;
    if (nextSettings) {
      S.settings = clonePrefValue(nextSettings);
      noteInputPreferencesCommitted(previous);
    }
    lastSavedSignature = savedStateSignature(S);
    syncLastResolvedPreferences();
    storageOK = true;
    blockedBooks.delete(currentBookId);
    clearAlert("save");
    return {ok: true, previousSettings: previous, deviceChanged: true};
  }
  function preferenceAffectedBooks(fields){
    const names = [];
    for (const def of BOOK_DEFS) {
      const book = BOOKS[def.id];
      if (!book || !book.available) continue;
      if (fields.some(field => !isPreferenceOverridden(field, def.id))) names.push(book.name);
    }
    return names;
  }
  /**
   * 显式入口：setPreferenceInheritance(fields[, inheritFromDevice])。
   * 默认（不传/ false）= 把当前有效值冻结到本书并标记“本书单独”；
   * true = 移除覆盖立即跟随设备 shared。成功后才提交内存并刷新呈现。
   */
  function setPreferenceInheritance(fields, inheritFromDevice){
    if (!Array.isArray(fields) || !fields.length || fields.some(field => !PREFERENCE_FIELDS.includes(field))) {
      return prefFail("未知的偏好字段");
    }
    if (readPreferenceJournal()) return prefFail("上次偏好归属保存未完成，请先刷新页面恢复");
    if (!preferenceDeviceUsable()) return prefFail(preferenceStatusText() + "，暂按每书独立保存");
    const next = clonePrefValue(devicePrefs);
    const overrides = new Set(preferenceOverrideList(currentBookId));
    const previous = clonePrefValue(S.settings);
    const nextSettings = clonePrefValue(S.settings);
    for (const field of fields) {
      if (inheritFromDevice === true) {
        if (!overrides.has(field)) continue;
        overrides.delete(field);
        nextSettings[field] = clonePrefValue(next.shared[field]);
      } else {
        // 冻结当前有效值到本书：覆盖标记 + 本书 settings 值（主记录随后一并保存）。
        nextSettings[field] = clonePrefValue(nextSettings[field]);
        overrides.add(field);
      }
    }
    next.overrides[currentBookId] = PREFERENCE_FIELDS.filter(field => overrides.has(field));
    const result = commitPreferenceChange(next, nextSettings);
    if (!result.ok) return result;
    refreshSharedSettingsSurfaces(true, previous);
    renderPreferenceOwnershipControls();
    const label = fields.map(field => PREFERENCE_LABELS[field] || field).join("、");
    toast(inheritFromDevice === true
      ? "已让「" + label + "」跟随设备通用值"
      : "已把「" + label + "」设为本书单独（当前值已冻结到本书）");
    return {ok: true, bookId: currentBookId, fields: fields.slice(),
      mode: inheritFromDevice === true ? "device" : "book"};
  }
  /**
   * 显式入口：applyPreferencePatch(patch, {target:"device"|"book"})。
   * device = “将当前值设为设备通用”（只改 shared，不移除其他书已有覆盖）；
   * book = 冻结到本书（建立/更新本书覆盖）。device 不可用时降级为只写本书记录。
   */
  function applyPreferencePatch(patch, opts){
    opts = opts || {};
    if (!isRecord(patch) || !Object.keys(patch).length) return prefFail("没有要修改的偏好");
    const fields = Object.keys(patch);
    if (fields.some(field => !PREFERENCE_FIELDS.includes(field))) return prefFail("只能修改可归属的界面偏好字段");
    for (const field of fields) {
      if (!validPreferenceValue(field, patch[field])) {
        return prefFail("偏好值不合法：" + (PREFERENCE_LABELS[field] || field));
      }
    }
    if (readPreferenceJournal()) return prefFail("上次偏好归属保存未完成，请先刷新页面恢复");
    const previous = clonePrefValue(S.settings);
    const target = opts.target === "device" ? "device" : "book";
    if (!preferenceDeviceUsable()) {
      // 安全降级仍需先保存后提交内存；不能返回失败却留下看似已生效的新值。
      const saved = applySettingsPatch(patch);
      if (!saved.ok) return prefFail(saved.error || "偏好保存失败，原配置保持不变");
      refreshSharedSettingsSurfaces(true, previous);
      renderPreferenceOwnershipControls();
      return {ok: true, target: "book", fields: fields.slice(), fallback: true, affectedBooks: []};
    }
    const next = clonePrefValue(devicePrefs);
    const overrides = preferenceOverrideList(currentBookId);
    const nextSettings = clonePrefValue(S.settings);
    if (target === "device") {
      for (const field of fields) next.shared[field] = clonePrefValue(patch[field]);
      for (const field of fields) {
        if (!overrides.includes(field)) nextSettings[field] = clonePrefValue(patch[field]);
      }
    } else {
      for (const field of fields) {
        nextSettings[field] = clonePrefValue(patch[field]);
        if (!overrides.includes(field)) overrides.push(field);
      }
      next.overrides[currentBookId] = PREFERENCE_FIELDS.filter(field => overrides.includes(field));
    }
    const result = commitPreferenceChange(next, nextSettings);
    if (!result.ok) return result;
    refreshSharedSettingsSurfaces(true, previous);
    renderPreferenceOwnershipControls();
    const affected = preferenceAffectedBooks(fields);
    return {ok: true, target: target, fields: fields.slice(), affectedBooks: affected,
      hasOtherOverrides: BOOK_DEFS.some(def => def.id !== currentBookId && preferenceOverrideList(def.id).length > 0)};
  }
  function retryDevicePreferenceWrite(){
    if (devicePrefsStatus !== "write-failed" || !devicePrefs) {
      renderPreferenceOwnershipControls();
      return prefFail(preferenceStatusText());
    }
    if (!persistDevicePreferences(devicePrefs)) {
      markPreferenceWriteFailure("仍然无法写入偏好归属");
      renderPreferenceOwnershipControls();
      return prefFail("偏好归属写入失败");
    }
    devicePrefsWriteNotified = false;
    const previous = clonePrefValue(S.settings);
    for (const field of PREFERENCE_FIELDS) {
      if (isPreferenceOverridden(field)) continue;
      S.settings[field] = clonePrefValue(devicePrefs.shared[field]);
    }
    syncLastResolvedPreferences();
    refreshPreferenceDisplaySurfaces(previous);
    clearAlert("prefs");
    toast("偏好归属已保存到本机：之后可逐项选择“此设备通用/本书单独”");
    renderPreferenceOwnershipControls();
    return {ok: true};
  }
  /** 重置当前书记录时同步清掉它的本书覆盖（只写设备键；失败只提示，不阻断重置本身）。 */
  function clearBookPreferenceOverrides(bookId){
    if (!preferenceDeviceUsable()) return false;
    if (!preferenceOverrideList(bookId).length) return true;
    const next = clonePrefValue(devicePrefs);
    next.overrides[bookId] = [];
    if (!persistDevicePreferences(next)) {
      markPreferenceWriteFailure("重置时未能清除本书偏好归属");
      return false;
    }
    return true;
  }
  /** 导入成功后把被导入书可携带偏好标本书覆盖（设备 shared 不变，未导入书覆盖不动）。 */
  function markImportedPreferenceOverrides(bookIds){
    if (!preferenceDeviceUsable() || !bookIds || !bookIds.length) return;
    const next = clonePrefValue(devicePrefs);
    for (const id of bookIds) {
      if (!Object.prototype.hasOwnProperty.call(next.overrides, id)) continue;
      next.overrides[id] = PREFERENCE_FIELDS.slice();
    }
    const text = JSON.stringify(next);
    // 导入 journal 已包含设备键旧原文：写入失败时由外层整份回滚。
    localStorage.setItem(DEVICE_PREFS_KEY, text);
    if (localStorage.getItem(DEVICE_PREFS_KEY) !== text) throw new Error("偏好归属写入校验失败");
    devicePrefs = next;
    devicePrefsRaw = text;
    devicePrefsStatus = "ok";
    devicePrefsLegacy = false;
  }
  /** 只读诊断：当前设备归属状态/迁移信息/当前书覆盖与恢复日志（测试与设置页共用）。 */
  function getPreferenceOwnership(){
    return {
      status: devicePrefsStatus,
      error: devicePrefsError,
      usable: preferenceDeviceUsable(),
      legacy: devicePrefsLegacy,
      rawPresent: devicePrefsRaw !== null,
      fields: PREFERENCE_FIELDS.slice(),
      currentBook: currentBookId,
      currentOverrides: preferenceOverrideList(currentBookId).slice(),
      shared: devicePrefs ? clonePrefValue(devicePrefs.shared) : null,
      overrides: devicePrefs ? clonePrefValue(devicePrefs.overrides) : null,
      journal: !!readPreferenceJournal(),
      journalKey: PREF_JOURNAL_KEY,
      deviceKey: DEVICE_PREFS_KEY,
      sessionStoreMissing: pageSessionStoreMissing
    };
  }
  function preferenceOwnershipSummaryText(){    if (devicePrefsStatus === "write-failed") {
      return preferenceStatusText() + "；当前页仍按迁移后的每书值显示，可点“重试保存偏好归属”。";
    }
    if (!preferenceDeviceUsable()) {
      const reason = devicePrefsStatus === "damaged" || devicePrefsStatus === "unsupported"
        ? "（原文已保留，不会覆写）" : "";
      return preferenceStatusText() + reason + "。各词书仍使用自己记录里的偏好，属于来源裁决的安全降级。";
    }
    const overrides = preferenceOverrideList(currentBookId);
    const otherOverrides = BOOK_DEFS.reduce((sum, def) => def.id === currentBookId ? sum : sum + preferenceOverrideList(def.id).length, 0);
    let text = "当前书「" + (BOOKS[currentBookId]?.name || currentBookId) + "」："
      + overrides.length + " 项本书单独 · " + (PREFERENCE_FIELDS.length - overrides.length) + " 项此设备通用";
    if (otherOverrides) text += "；其他词书另有 " + otherOverrides + " 项本书单独";
    text += "。";
    if (devicePrefsLegacy) text += "已按旧版每书偏好完成一次迁移，旧值都保留为本书覆盖。";
    if (bookModeMigrated === "follow") text += "本页词书模式已从旧版跟随设置迁移。";
    return text;
  }

  /* ---- 归属控件动态注入：放在 SETTINGS_CATALOG 每项 target 所在行附近，不改各行原有 handlers ---- */
  const prefOwnershipUi = {ready: false, lines: new Map(), retry: null};
  function preferenceInsertionHome(field){
    const entry = SETTINGS_CATALOG_MAP.get(field);
    const target = entry ? $(entry.target) : null;
    if (!target) return null;
    if (target.id === "settings-keys") {
      const anchor = $("#keyReset");
      const row = anchor && typeof anchor.closest === "function" ? anchor.closest(".key-reset-row") : null;
      return row || target;
    }
    if (target.tagName === "DETAILS") return target;
    const row = typeof target.closest === "function" ? (target.closest(".set") || target.closest(".field")) : null;
    return row || target;
  }
  function appendPreferenceOwnershipLine(home, line){
    if (!home) return false;
    try {
      const parent = home.parentNode;
      if (parent && typeof parent.insertBefore === "function") {
        parent.insertBefore(line, home.nextSibling || null);
        return true;
      }
      if (typeof home.appendChild === "function") { home.appendChild(line); return true; }
    } catch (e) { /* ignore */ }
    return false;
  }
  function bindPreferenceOwnershipLine(field, refs){
    refs.main.onclick = () => {
      if (!preferenceDeviceUsable()) { toast(preferenceStatusText()); return; }
      const overridden = isPreferenceOverridden(field);
      const result = setPreferenceInheritance([field], overridden);
      if (!result.ok) toast(result.error);
    };
    refs.device.onclick = () => {
      if (!preferenceDeviceUsable()) { toast(preferenceStatusText()); return; }
      const patch = {};
      patch[field] = clonePrefValue(S.settings[field]);
      const result = applyPreferencePatch(patch, {target: "device"});
      if (!result.ok) { toast(result.error); return; }
      const names = (result.affectedBooks || []).filter(name => name !== BOOKS[currentBookId]?.name);
      toast("已把当前值设为设备通用" + (names.length ? "：将影响 " + names.join("、") + "（已有本书单独设置的书保持覆盖）" : "（其他词书已有本书单独设置，保持覆盖）"));
    };
  }
  function initPreferenceOwnershipUi(){
    if (prefOwnershipUi.ready) return;
    prefOwnershipUi.ready = true;
    const retry = $("#preferenceOwnershipRetry");
    if (retry) {
      prefOwnershipUi.retry = retry;
      retry.onclick = () => {
        const result = retryDevicePreferenceWrite();
        if (!result.ok) toast(result.error);
      };
    }
    if (typeof document === "undefined" || typeof document.createElement !== "function") return;
    for (const field of PREFERENCE_FIELDS) {
      try {
        const home = preferenceInsertionHome(field);
        if (!home) continue;
        const line = document.createElement("p");
        line.setAttribute("class", "control-help pref-ownership-line");
        line.setAttribute("id", "prefOwnLine_" + field);
        line.setAttribute("data-pref-field", field);
        const state = document.createElement("span");
        state.setAttribute("id", "prefOwnState_" + field);
        const sep1 = document.createElement("span");
        sep1.textContent = " · ";
        const main = document.createElement("button");
        main.setAttribute("type", "button");
        main.setAttribute("class", "text-action");
        main.setAttribute("id", "prefOwnBtn_" + field);
        const sep2 = document.createElement("span");
        sep2.textContent = " · ";
        const device = document.createElement("button");
        device.setAttribute("type", "button");
        device.setAttribute("class", "text-action");
        device.setAttribute("id", "prefOwnDeviceBtn_" + field);
        device.textContent = "设为设备通用";
        line.appendChild(state);
        line.appendChild(sep1);
        line.appendChild(main);
        line.appendChild(sep2);
        line.appendChild(device);
        const refs = {line: line, state: state, main: main, device: device};
        bindPreferenceOwnershipLine(field, refs);
        if (!appendPreferenceOwnershipLine(home, line)) continue;
        prefOwnershipUi.lines.set(field, refs);
      } catch (e) { /* 单个控件注入失败不影响归属裁决 */ }
    }
    renderPreferenceOwnershipControls();
  }
  function renderPreferenceOwnershipControls(){
    if (!prefOwnershipUi.ready) return;
    const usable = preferenceDeviceUsable();
    for (const field of PREFERENCE_FIELDS) {
      const refs = prefOwnershipUi.lines.get(field);
      if (!refs) continue;
      if (!usable) {
        refs.state.textContent = "偏好归属：" + preferenceStatusText();
        refs.main.textContent = "重试保存归属";
        refs.device.hidden = true;
        continue;
      }
      const overridden = isPreferenceOverridden(field);
      refs.state.textContent = "偏好归属：" + (overridden ? "本书单独" : "此设备通用");
      refs.main.textContent = overridden ? "跟随设备" : "改为本书单独";
      refs.device.hidden = !overridden;
    }
    const status = $("#preferenceOwnershipStatus");
    if (status) status.textContent = preferenceOwnershipSummaryText();
    const retry = prefOwnershipUi.retry || $("#preferenceOwnershipRetry");
    if (retry) {
      retry.hidden = !(devicePrefsStatus === "write-failed" || devicePrefsStatus === "damaged" || devicePrefsStatus === "unsupported");
    }
  }

  /* ---- O1 本页词书 / 默认 / 跟随 UI ---- */
  let pendingFollowBookId = null;
  let bookPageUiReady = false;
  function pageBookMode(){
    const stored = pageStoreGet(PAGE_BOOK_MODE_KEY);
    return PAGE_BOOK_MODES.includes(stored) ? stored : "local";
  }
  function currentDefaultBookId(){
    const id = areaRead(storageArea("main"), DEFAULT_BOOK_KEY);
    return validBookIdRaw(id) ? id : null;
  }
  function pageBookUiState(){
    return {
      bookId: currentBookId,
      mode: pageBookMode(),
      defaultBook: currentDefaultBookId(),
      defaultBookWriteFailed: defaultBookWriteFailed,
      pageSessionAvailable: !pageSessionStoreMissing,
      activeSignal: areaRead(storageArea("main"), ACTIVE_KEY),
      migratedFollow: bookModeMigrated === "follow"
    };
  }
  function setPageBookMode(mode){
    if (!PAGE_BOOK_MODES.includes(mode)) return {ok: false, error: "未知的本页词书模式"};
    const persisted = pageStoreSet(PAGE_BOOK_MODE_KEY, mode);
    bookModeMigrated = null;
    renderBookPageUi();
    toast(!persisted
      ? "本页词书模式只保存在当前页面内存中（浏览器会话存储不可用），刷新后可能恢复默认"
      : mode === "follow"
        ? "已开启跨页跟随：其他页面切书时，本页没有未完成组会同步；有现场时只提示，不自动丢进度"
        : "本页仅使用自己的词书：其他页面的切书不会影响本页，也不改其他页面");
    return {ok: true, mode: mode, persisted: persisted};
  }
  function setDefaultBookForNextOpen(bookId){
    const id = bookId || currentBookId;
    if (!validBookIdRaw(id)) return {ok: false, error: "该词书数据不可用"};
    if (!areaWrite(storageArea("main"), DEFAULT_BOOK_KEY, id)) {
      defaultBookWriteFailed = true;
      renderBookPageUi();
      toast("下次默认词书未能保存：浏览器存储不可用或空间不足");
      return {ok: false, error: "浏览器存储不可用"};
    }
    defaultBookWriteFailed = false;
    renderBookPageUi();
    toast("已设为下次新开页面的默认词书：" + BOOKS[id].name + "。本页与其他已开页面不会因此切换。");
    return {ok: true, bookId: id};
  }
  /** 切书时提交本页词书：始终写本页 sessionStorage；follow 模式才写旧 ACTIVE 作为跨页信号。 */
  function commitPageBookSelection(bookId, opts){
    opts = opts || {};
    const pagePersisted = pageStoreSet(PAGE_BOOK_KEY, bookId);
    let activeWritten = false;
    if (opts.writeActiveSignal) {
      activeWritten = areaWrite(storageArea("main"), ACTIVE_KEY, bookId);
    }
    renderBookPageUi();
    return {pagePersisted: pagePersisted, activeWritten: activeWritten};
  }
  function renderBookPageUi(){
    const state = pageBookUiState();
    const localBtn = $("#bookPageModeLocal");
    const followBtn = $("#bookPageModeFollow");
    if (localBtn) {
      localBtn.classList?.toggle("on", state.mode === "local");
      localBtn.setAttribute?.("aria-pressed", String(state.mode === "local"));
    }
    if (followBtn) {
      followBtn.classList?.toggle("on", state.mode === "follow");
      followBtn.setAttribute?.("aria-pressed", String(state.mode === "follow"));
    }
    const status = $("#bookModeStatus");
    if (status) {
      let text = state.mode === "follow"
        ? "同步到跟随页面：其他页面切书时，本页若已打开未完成组会先提示，不会悄悄丢现场。"
        : "仅本页：这里的切书只影响当前页面，不会改变其他页面或下次默认。";
      if (state.migratedFollow) text += "（已从旧版“所有页面跟随”迁移，可随时改为仅本页）";
      if (!state.pageSessionAvailable) text += " 浏览器会话存储不可用：本页选择只保存在内存，刷新后可能丢失。";
      if (state.defaultBookWriteFailed) text += " 默认词书未能写入本机存储。";
      status.textContent = text;
    }
    const defaultEl = $("#bookDefaultStatus");
    if (defaultEl) {
      defaultEl.textContent = state.defaultBook
        ? "下次新开页面默认：" + (BOOKS[state.defaultBook]?.name || state.defaultBook)
        : "下次新开页面：尚未设置（按上次迁移值）";
    }
  }
  function renderBookFollowNotice(){
    const box = $("#bookFollowNotice");
    if (!box) return;
    if (!pendingFollowBookId || !validBookIdRaw(pendingFollowBookId)) { box.hidden = true; return; }
    box.hidden = false;
    const text = $("#bookFollowText");
    if (text) {
      text.textContent = "另一页切到了「" + BOOKS[pendingFollowBookId].name
        + "」，本页已保留当前组，未自动切换。";
    }
  }
  function applyBookFollowNotice(){
    const id = pendingFollowBookId;
    pendingFollowBookId = null;
    renderBookFollowNotice();
    if (!validBookIdRaw(id)) return false;
    const ok = switchBook(id, {silent: true, persist: false, carry: false});
    if (ok) toast("已同步切换到「" + BOOKS[id].name + "」");
    return ok;
  }
  function initBookPageUi(){
    if (bookPageUiReady) return;
    bookPageUiReady = true;
    const localBtn = $("#bookPageModeLocal");
    const followBtn = $("#bookPageModeFollow");
    if (localBtn) localBtn.onclick = () => setPageBookMode("local");
    if (followBtn) followBtn.onclick = () => setPageBookMode("follow");
    const setDefault = $("#bookSetDefault");
    if (setDefault) setDefault.onclick = () => setDefaultBookForNextOpen(currentBookId);
    const apply = $("#bookFollowApply");
    const dismiss = $("#bookFollowDismiss");
    if (apply) apply.onclick = applyBookFollowNotice;
    if (dismiss) dismiss.onclick = () => { pendingFollowBookId = null; renderBookFollowNotice(); };
    renderBookPageUi();
    renderBookFollowNotice();
  }

  const POSCHIPS = [
    {k:"n", t:"名词"}, {k:"v", t:"动词"}, {k:"a", t:"形容词"}, {k:"d", t:"副词"}, {k:"x", t:"其他"}
  ];
  const POSMAP = {n:[0], v:[1], a:[2], d:[3]};
  /* ---- 词性派生层：主标签 + 释义 m 中的词性前缀 → 统一口径（06） ----
   * x.p 是词典主要词性，而 m 已按真题考义重排，两者可能不一致（如 work 主标签名词、首义 vi.）。
   * 这里从 m 的词性前缀派生多词性集合，配合 settings.posMode 提供可切换口径；
   * 不改 p、不改词库数组。每本书构建一次 bitmask 缓存，随 W/currentBookId 失效。
   */
  const POS_TAGS = ["n", "v", "a", "d", "x"];
  const POS_TAG_BIT = {n:1, v:2, a:4, d:8, x:16};
  /** 释义前缀 token → 归类；未列出的前缀不猜测。 */
  const POS_PREFIX_TAGS = {
    n: "n", pl: "n",
    v: "v", vt: "v", vi: "v",
    a: "a", adj: "a",
    d: "d", ad: "d", adv: "d",
    prep: "x", pron: "x", conj: "x", num: "x", art: "x", det: "x",
    aux: "x", interj: "x", int: "x", abbr: "x", phr: "x"
  };
  /** 主标签归类（沿用 POSMAP 语义：0名/1动/2形/3副，其余其他）。 */
  function posTagOfPos(pIdx){
    if (pIdx === 0) return "n";
    if (pIdx === 1) return "v";
    if (pIdx === 2) return "a";
    if (pIdx === 3) return "d";
    return "x";
  }
  /** 解析释义里的词性前缀（n./pl./vt./vi./v./a./adv./prep./vt.vi. 等），去重返回 tag 数组。 */
  function meaningPosTags(m){
    const out = [];
    for (const segment of String(m == null ? "" : m).split(/[；;]/)) {
      const match = segment.match(/^\s*((?:[A-Za-z]{1,6}\.)+)\s*/);
      if (!match) continue;
      for (const token of match[1].split(".")) {
        const tag = POS_PREFIX_TAGS[token.toLowerCase()];
        if (tag && out.indexOf(tag) < 0) out.push(tag);
      }
    }
    return out;
  }
  let posMaskCache = null;
  function posMaskIndex(){
    if (posMaskCache && posMaskCache.words === W && posMaskCache.bookId === currentBookId) {
      return posMaskCache.map;
    }
    const map = new Map();
    for (let i = 0; i < W.length; i++) {
      const x = W[i];
      let mask = POS_TAG_BIT[posTagOfPos(x.p)];
      for (const tag of meaningPosTags(x.m)) mask |= POS_TAG_BIT[tag];
      map.set(x.w, mask);
    }
    posMaskCache = { words: W, bookId: currentBookId, map: map };
    return map;
  }
  function posMaskOf(x){
    if (!x) return 0;
    const hit = posMaskIndex().get(x.w);
    if (hit != null) return hit;
    // 非当前词书的临时对象（详情/测试夹具）按同一规则现算，不写缓存。
    let mask = POS_TAG_BIT[posTagOfPos(x.p)];
    for (const tag of meaningPosTags(x.m)) mask |= POS_TAG_BIT[tag];
    return mask;
  }
  /** 该词释义中出现的全部词性归类（含主标签），按 n/v/a/d/x 固定顺序返回数组。 */
  function posTagsOf(x){
    const mask = posMaskOf(x);
    const out = [];
    for (const tag of POS_TAGS) if (mask & POS_TAG_BIT[tag]) out.push(tag);
    return out;
  }
  /**
   * 词性筛选单一判据。sel = 选中 tag 数组；空数组表示不限。
   * primary（默认）：只按主标签 x.p，行为与旧版一致；all：任一 tag 命中释义派生集合即通过。
   */
  function posMatches(x, sel, mode = S.settings.posMode){
    const selected = Array.isArray(sel) ? sel : [];
    if (!selected.length) return true;
    if (mode !== "all") {
      for (const k of selected) {
        if (k === "x") { if (![0,1,2,3].includes(x.p)) return true; }
        else if (POSMAP[k] && POSMAP[k].includes(x.p)) return true;
      }
      return false;
    }
    const mask = posMaskOf(x);
    for (const k of selected) {
      const bit = POS_TAG_BIT[k];
      if (bit && (mask & bit)) return true;
    }
    return false;
  }
  function getPosMode(){ return S.settings.posMode === "all" ? "all" : "primary"; }
  /** 卡片/详情词性小标签：多词性时追加「释义亦含…」，单词性保持纯 POSN。 */
  function poslineText(x){
    const base = POSN[x.p] || "";
    const extra = posTagsOf(x).filter(tag => tag !== posTagOfPos(x.p));
    if (!extra.length) return base;
    const names = {n:"名词", v:"动词", a:"形容词", d:"副词", x:"其他"};
    const text = extra.map(tag => names[tag]).filter(Boolean).join("、");
    return text ? base + " · 释义亦含" + text : base;
  }

  let S = freshState(currentBook());
  let storageOK = true;
  let loadError = null;
  // 某本书的主记录损坏/存储被禁用时暂停该书写入，避免把可恢复的备份覆盖成空记录。
  // 只影响损坏的那一本；切换到另一本仍可正常读写。
  const blockedBooks = new Set();
  let lastMainRaw = null;
  // 只存在主记录原文中的同步代际；不进 S、备份或 normalizeState 白名单。
  // 显式重置/导入换代，普通保存沿用，避免旧页面把重置前的辅助累计重新合回。
  let pendingReplacementToken = null;
  let replacementSequence = 0;
  let studyPendingMs = 0;
  function replacementToken(raw){
    if (typeof raw !== "string") return "";
    try {
      const token = JSON.parse(raw)?._replace;
      return typeof token === "string" && token.length <= 160 ? token : "";
    } catch (e) { return ""; }
  }
  function newReplacementToken(){
    replacementSequence++;
    return AUTO_RESUME_TAB_ID + ":" + Date.now().toString(36) + ":" + replacementSequence.toString(36);
  }
  function serializeSharedState(state, raw, token){
    const out = Object.assign({}, state);
    delete out._replace;
    const keep = token || replacementToken(raw);
    if (keep) out._replace = keep;
    return JSON.stringify(out);
  }
  // 渲染会建立空的当日计数；空计数不代表有尚未保存的用户改动。
  function savedStateSignature(state){
    return JSON.stringify([state.settings, state.progress,
      Object.fromEntries(Object.entries(state.days).filter(([, d]) => d.r > 0)),
      state.stars, state.proficient, state.timeSec]);
  }
  /** 只比较会令当前组失效的学习内容。设置、时长和独立台账不重开冻结组；空日记录等价。 */
  function sharedLearningSignature(state){
    const sorted = obj => Object.entries(obj || {}).sort(([a], [b]) => a.localeCompare(b));
    const days = sorted(state.days).filter(([, d]) => d.n || d.r || d.ok || d.no)
      .map(([date, d]) => [date, d.n || 0, d.r || 0, d.ok || 0, d.no || 0]);
    return JSON.stringify([sorted(state.progress), days, sorted(state.stars), sorted(state.proficient)]);
  }
  /** 存储事件尚未送达时：本地显式改动的字段胜出，其余字段采用最新存储，避免覆盖远端偏好。 */
  function mergeSharedSettings(local, incoming, baseline){
    const merged = Object.assign({}, incoming);
    for (const key of Object.keys(local)) {
      if (JSON.stringify(local[key]) !== JSON.stringify(baseline[key])) merged[key] = local[key];
    }
    return merged;
  }
  function mergeSharedCounters(incoming){
    autoResumeCheckCache = null;
    if ((incoming.timeSec || 0) > (S.timeSec || 0)) studyPendingMs = 0;
    S.timeSec = Math.max(S.timeSec || 0, incoming.timeSec || 0);
    const localReview = reviewLedger(), review = normalizeReviewDay(incoming.reviewDay);
    if (review.d === localReview.d && review.used > localReview.used) S.reviewDay = review;
    const localExtra = extraDayLedger(), extra = normalizeExtraDay(incoming.extraDay);
    if (extra.d === localExtra.d && extra.extra > localExtra.extra) S.extraDay = extra;
    S.spelling = mergeSpellingState(S.spelling, incoming.spelling);
  }
  /** 权威同步不能让原本空的页面绕过显式等待，save与storage必须采用同一裁决。 */
  function resumeAfterSharedChange(wasEmptyPage, replaced){
    if (!wasEmptyPage) { startSession(); return; }
    if (replaced) autoResumeEmptyWaitBook = null;
    sessionPlan = null; sessionScopeSet = null; undoStack = [];
    autoResumeReturnSnap = null; autoResumeReturnArmed = false;
    autoResumeReturnFromWait = false;
    resetAutoResumeRuntime(); renderCard(); updateBar();
  }
  /** 完成页开下一组前主动同步：storage 事件可能尚未送达，先采用最新权威记录再抽组。 */
  function refreshSharedBeforeNextGroup(){
    if (cur != null || drillMode || inSubgroup()) return false;
    try {
      // 保存失败后的本页记录仍可能仅在内存中，不能借“刷新”悄悄丢弃。
      if (!storageOK && savedStateSignature(S) !== lastSavedSignature) return false;
      const raw = localStorage.getItem(KEY);
      const candidate = raw === null ? freshState(currentBook()) : normalizeState(JSON.parse(raw), currentBookId);
      candidate.proficient = readBookProficient(currentBook(), candidate.proficient);
      const replaced = raw === null || replacementToken(raw) !== replacementToken(lastMainRaw);
      if (pendingReplacementToken && !replaced) return false;
      // O1：下一组前同步同样按“设备通用/本书覆盖”解析；换代不把物化快照装进 shared。
      if (replaced) {
        try { readDevicePreferences(); } catch (e) { /* ignore */ }
        candidate.settings = resolveBookPreferences(candidate, currentBookId);
      } else {
        candidate.settings = resolveIncomingPreferenceSettings(candidate.settings);
      }
      const before = S;
      const pendingTimeBefore = studyPendingMs;
      const incomingTime = candidate.timeSec || 0;
      const contentChanged = sharedLearningSignature(candidate) !== sharedLearningSignature(before);
      S = candidate;
      if (replaced) {
        autoResumeEmptyWaitBook = null;
        studyPendingMs = 0;
        clearProfPending(currentBookId);
        pendingReplacementToken = null;
      } else {
        S.proficient = mergePendingProficient(S.proficient, currentBookId);
        mergeSharedCounters(before);
        studyPendingMs = incomingTime > (before.timeSec || 0) ? 0 : pendingTimeBefore;
      }
      if (replaced || contentChanged) {
        clearSessionSnapshot(currentBookId);
        // 旧完成页的撤销和“返回上一组”不能再回滚已经替换的权威记录。
        Q = []; qi = 0; rounds = {}; cur = null; verdict = null; snap = null; phase = "recall";
        answered = 0; rightN = 0; groupTotal = 0; undoStack = []; autoSpoken = false;
        sessionPlan = null; sessionScopeSet = null; resumeNoticePending = null;
        capPaused = false; capGroupEnded = false;
        autoResumeReturnSnap = null; autoResumeReturnArmed = false;
        resetAutoResumeRuntime();
      }
      lastMainRaw = raw;
      lastSavedSignature = savedStateSignature(S);
      syncLastResolvedPreferences();
      trackAutoResumeLegacy(currentBookId, raw);
      storageOK = true;
      blockedBooks.delete(currentBookId);
      refreshSharedSettingsSurfaces(false, before.settings);
      if (replaced || contentChanged) renderCard();
      return true;
    } catch (e) {
      return false;
    }
  }
  let sharedCardRefreshPending = false;
  let sharedListRefreshPending = false;
  function refreshSharedSettingsSurfaces(renderStudyCard = true, previous = {}){
    const differs = key => JSON.stringify(previous[key]) !== JSON.stringify(S.settings[key]);
    const scopeChanged = ["fmin", "fmax", "pmin", "kyOnly", "pos", "posMode"].some(differs);
    // O1：任一可归属偏好变化都可能影响卡片二次操作/呈现，统一走既有延迟重绘机制。
    const cardChanged = PREFERENCE_FIELDS.some(differs);
    noteInputPreferencesCommitted(previous);
    bindSet();
    if (scopeChanged) {
      if (activeSheet) sharedListRefreshPending = currentBookId;
      else applyFilter(false);
    }
    renderStats(); renderCapSurfaces(); fitVisibleWords();
    renderPlanPendingNotice(); renderGroupSurfaces(); updateBar();
    const popOpen = $("#exPop") && $("#exPop").hidden === false;
    // 阅读浮层及其触发节点保持；关闭后再应用会替换卡片DOM的显示偏好。
    if (cardChanged) sharedCardRefreshPending = currentBookId;
    if (sharedCardRefreshPending && renderStudyCard && !activeSheet && !popOpen) renderCard();
    renderAutoResume();
    syncOpenWorkspaceFields();
    applyActionLayout(); applyActionBindingHints();
    if(activeSheet?.id === "helpSheet") renderHelp();
  }
  let lastSavedSignature = savedStateSignature(S);
  /**
   * 熟练键写入失败时，新增/取消操作仍保留在本页内存中。导出与后续保存
   * 用「最新存储 + 待写入操作」合并，既不丢这次操作，也不覆盖别的标签页。
   */
  const pendingProf = new Map();
  function pendingProfOf(bookId){
    let p = pendingProf.get(bookId);
    if (!p) { p = {add: new Map(), remove: new Set()}; pendingProf.set(bookId, p); }
    return p;
  }
  function markProfPending(bookId, word, value, at){
    const p = pendingProfOf(bookId);
    if (value) { p.add.set(word, at || Date.now()); p.remove.delete(word); }
    else { p.remove.add(word); p.add.delete(word); }
    if (!p.add.size && !p.remove.size) pendingProf.delete(bookId);
  }
  function clearProfPending(bookId){ pendingProf.delete(bookId); }
  function mergePendingProficient(list, bookId){
    const p = pendingProf.get(bookId);
    if (!p) return Object.assign({}, list || {});
    const out = Object.assign({}, list || {});
    for (const w of p.remove) delete out[w];
    for (const [w, at] of p.add) out[w] = at;
    return out;
  }
  function pendingProfCount(bookId){
    const p = pendingProf.get(bookId);
    return p ? p.add.size + p.remove.size : 0;
  }
  function snapshotPendingProf(){
    const out = new Map();
    for (const [id, p] of pendingProf) out.set(id, {add: new Map(p.add), remove: new Set(p.remove)});
    return out;
  }
  function restorePendingProf(snap){
    pendingProf.clear();
    for (const [id, p] of snap || []) pendingProf.set(id, {add: new Map(p.add), remove: new Set(p.remove)});
  }

  // spaCy 残缺词形 → 正确词形（与 tests/fixtures/spelling-fixes.json 保持一致）。
  // 仅当旧拼写已不在词库、新拼写存在时才迁移熟练名单键，避免与保留的同名词条冲突。
  const SPELLING_FIX = {
    "acqui": "acquire",
    "alloparente": "alloparent",
    "backloade": "backload",
    "bestselle": "bestseller",
    "blogge": "blog",
    "cofounde": "cofound",
    "complie": "comply",
    "conceite": "conceit",
    "cosmo": "cosmos",
    "diabete": "diabetes",
    "dispassione": "dispassion",
    "downshifte": "downshift",
    "downstair": "downstairs",
    "earning": "earnings",
    "farsighte": "farsighted",
    "farth": "far",
    "firefighte": "firefight",
    "foresighte": "foresight",
    "freethinke": "freethinking",
    "goode": "good",
    "graf": "grave",
    "graffitie": "graffiti",
    "groundbreake": "groundbreaker",
    "hardworke": "hardworking",
    "hearte": "heart",
    "housebuilde": "housebuilding",
    "hoverflie": "hoverfly",
    "inboxe": "inbox",
    "inputte": "input",
    "justifie": "justify",
    "laborsave": "laborsaving",
    "maladapte": "maladapted",
    "manif": "manifest",
    "maste": "master",
    "mathematic": "mathematics",
    "misadjuste": "misadjust",
    "mispredicte": "mispredict",
    "modifie": "modify",
    "overfishe": "overfish",
    "overfunde": "overfund",
    "paywalle": "paywall",
    "photocopi": "photocopy",
    "plateaue": "plateau",
    "policymake": "policymaking",
    "quirki": "quirky",
    "readmitte": "readmit",
    "remedie": "remedy",
    "renowne": "renowned",
    "reskille": "reskill",
    "satisfie": "satisfy",
    "sens": "sense",
    "sensore": "sensor",
    "suppresse": "suppress",
    "talente": "talent",
    "uncontrolle": "uncontrolled",
    "underfunde": "underfund",
    "undiscusse": "undiscussed",
    "unhampere": "unhampered",
    "unmentione": "unmentioned",
    "unquestione": "unquestioned",
    "unreflecte": "unreflecting",
    "upskille": "upskill",
    "vanishe": "vanish",
    "wellbee": "wellbeing"
  };
  const isRecord = o => !!o && typeof o === "object" && !Array.isArray(o);
  /** 单词下标是否合法（按指定词书的词库长度判断） */
  const validIndex = (k, book) => /^(0|[1-9]\d*)$/.test(k) && +k < (book || currentBook()).words.length;
  const nonnegative = n => typeof n === "number" && Number.isFinite(n) && n >= 0;
  const validProgress = p => Array.isArray(p) && p.length === 5 && p.every(nonnegative)
    && Number.isInteger(p[0]) && p[0] <= MASTER && Number.isInteger(p[2]) && Number.isInteger(p[3]);
  const integer = (n, fallback, min, max) => nonnegative(n)
    ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
  const validKey = k => normalizeKeyBinding(k) !== null;
  function resolveProficientWord(w, book){
    const idx = (book || currentBook()).wordIndex;
    if (idx.has(w)) return w;
    const fixed = SPELLING_FIX[w];
    return fixed && idx.has(fixed) ? fixed : w;
  }
  /** 熟练名单按单词文本存；校验词必须存在于指定词书 */
  function normalizeProficient(o, book){
    if (!isRecord(o)) throw new Error("熟练标记格式不正确");
    book = book || currentBook();
    const out = {};
    for (const [w0, v] of Object.entries(o)) {
      const w = resolveProficientWord(w0, book);
      if (!book.wordIndex.has(w) || !nonnegative(v) || !v) throw new Error("熟练词条不存在或格式不正确");
      if (out[w] === undefined) out[w] = v;
    }
    return out;
  }
  /** 迁移时旧下标 → 新下标：new = old - count(removed < old)（removed 已升序） */
  function countRemovedBefore(removed, old){
    let lo = 0, hi = removed.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (removed[mid] < old) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
  /** 单步迁移（from → to）：progress/stars 下标重映射，删词对应的熟练标记丢弃，其余原样保留 */
  function applyBookMigration(st, migration, book){
    const removed = migration.removed;
    const removedSet = new Set(removed);
    const oldLength = book.words.length + book.migrations
      .filter(m => m.from >= migration.from)
      .reduce((n, m) => n + m.removed.length - (m.addedCount || 0), 0);
    const out = JSON.parse(JSON.stringify(st));
    if (isRecord(st.progress)) {
      const progress = {};
      for (const [k, v] of Object.entries(st.progress)) {
        // 删除之前也必须校验旧条目，不能让迁移掩盖损坏的备份。
        if (!/^(0|[1-9]\d*)$/.test(k) || +k >= oldLength || !validProgress(v)) {
          throw new Error("单词进度格式不正确");
        }
        const old = +k;
        if (removedSet.has(old)) continue;                              // 被删词条 → 丢弃该条进度
        progress[String(old - countRemovedBefore(removed, old))] = v;
      }
      out.progress = progress;
    }
    if (isRecord(st.stars)) {
      const stars = {};
      for (const [k, v] of Object.entries(st.stars)) {
        if (!/^(0|[1-9]\d*)$/.test(k) || +k >= oldLength) throw new Error("收藏词条不存在");
        const old = +k;
        if (removedSet.has(old)) continue;
        stars[String(old - countRemovedBefore(removed, old))] = v;
      }
      out.stars = stars;
    }
    if (isRecord(st.proficient)) {
      const proficient = {};
      for (const [w0, v] of Object.entries(st.proficient)) {
        if (!nonnegative(v) || !v) throw new Error("熟练词条格式不正确");
        const w = resolveProficientWord(w0, book);
        if (!book.wordIndex.has(w)) {
          if (book.removedWords && !book.removedWords.has(w0)) throw new Error("熟练词条不存在");
          continue;   // 仅清理确认被删的词；旧元数据无词名时兼容原迁移口径。
        }
        if (proficient[w] === undefined) proficient[w] = v;
      }
      out.proficient = proficient;
    }
    out.dv = migration.to;
    return out;
  }
  /**
   * 把记录迁移到词书当前 dataVersion：无 dv 视作 1；已是当前/更新版本原样返回；
   * 旧版本按 migrations 链逐级迁移。缺少迁移链时抛错（读记录 → blocked，导入 → 整份拒绝）。
   */
  function migrateState(o, book){
    book = book || currentBook();
    if (!isRecord(o)) return o;                       // 交给 normalizeState 报错
    const target = book.dataVersion || 1;
    const dv = integer(o.dv, 1, 1, Number.MAX_SAFE_INTEGER);
    if (dv > target) {
      throw new Error("学习记录来自更新的词库（数据版本 " + dv + " > 当前 " + target + "）；请更新应用后再导入，原记录不会被覆盖");
    }
    if (dv === target) return o;
    let cur = o, v = dv;
    while (v < target) {
      const m = book.migrations.find(x => x.from === v);
      if (!m) throw new Error("学习记录版本过旧，缺少迁移映射");
      cur = applyBookMigration(cur, m, book);
      v = m.to;
    }
    cur.dv = target;
    return cur;
  }
  /** 熟练名单容错归一：数据重建删词后，已不在词书里的键丢弃（不因删词判整份损坏） */
  function normalizeProficientLenient(o, book){
    if (!isRecord(o)) throw new Error("熟练标记格式不正确");
    book = book || currentBook();
    const out = {};
    for (const [w0, v] of Object.entries(o)) {
      if (!nonnegative(v) || !v) throw new Error("熟练词条格式不正确");
      const w = resolveProficientWord(w0, book);
      if (!book.wordIndex.has(w)) {
        if (book.removedWords && !book.removedWords.has(w0)) throw new Error("熟练词条不存在");
        continue;
      }
      if (out[w] === undefined) out[w] = v;
    }
    return out;
  }
  /** 按词书是否带迁移决定熟练名单校验口径（有迁移=数据重建过，允许丢弃已删词） */
  function normalizeProficientByBook(o, book){
    book = book || currentBook();
    return book.migrations.length ? normalizeProficientLenient(o, book) : normalizeProficient(o, book);
  }
  /** 独立熟练键是最新名单；即使主记录损坏，导入/导出仍可保留它。 */
  function readBookProficient(book, fallback){
    const raw = localStorage.getItem(book.PROF_KEY);
    return raw === null ? fallback : normalizeProficientByBook(JSON.parse(raw), book);
  }
  function syncProficientFromStorage(){
    const raw = localStorage.getItem(PROF_KEY);
    if (raw === null) {
      // 独立键尚未建立时，主记录里的熟练名单仍然有效，不能被空值抹掉。
      S.proficient = mergePendingProficient(S.proficient, currentBookId);
      return;
    }
    const parsed = JSON.parse(raw);
    const next = normalizeProficientByBook(parsed, currentBook());
    // 旧拼写键已迁移 / 删词清理时回写一次，让 localStorage 与词库文本对齐。
    if (Object.keys(parsed).some(k => !(k in next))) {
      try { localStorage.setItem(PROF_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
    }
    S.proficient = mergePendingProficient(next, currentBookId);
  }

  /* ---- 12 阅读字号/语音偏好的归一化（旧记录缺字段回退默认，非法值只修该字段） ---- */
  function normalizeFontSize(v){
    return FONT_SIZE_VALUES.includes(v) ? v : FONT_SIZE_DEFAULT;
  }
  /** 语速 0.5–1.5，保留两位小数；非法/缺省 → 0.92（历史固定值）。 */
  function normalizeSpeechRate(v){
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return SPEECH_RATE_DEFAULT;
    const clamped = Math.min(SPEECH_RATE_MAX, Math.max(SPEECH_RATE_MIN, n));
    return Math.round(clamped * 100) / 100;
  }
  /** 语音 URI 只接受字符串；空串 = 跟随设备自动选择英语语音。 */
  function normalizeVoiceURI(v){
    return typeof v === "string" ? v.trim().slice(0, 200) : "";
  }

  /**
   * Validate completely before replacing live state. Old v1 exports remain compatible.
   * bookId 缺省 = 当前词书；非法/本版本不可用的 bookId 回退当前书，再按该书的
   * 词库长度 / paperCount 校验（import v2 会先跳过不可用词书，不会误用回退口径）。
   */
  function normalizeState(o, bookId){
    const picked = typeof bookId === "string" ? bookOf(bookId) : null;
    const book = (picked && picked.available) ? picked : currentBook();
    if (!book || !book.available) throw new Error("词书数据未载入");
    o = migrateState(o, book);   // 关键顺序：先按 migrations 把旧下标迁到当前数组，再校验
    if (!isRecord(o) || !isRecord(o.progress) || !isRecord(o.days)) throw new Error("缺少学习记录");
    const out = JSON.parse(JSON.stringify(DEF));
    const old = isRecord(o.settings) ? o.settings : {};
    const s = out.settings;
    const pminMax = book.paperCount > 0 ? book.paperCount : (book.defaultPmin || 2);
    s.dailyNew = integer(old.dailyNew, DEF.settings.dailyNew, 1, 500);
    s.fmin = integer(old.fmin, 1, 1, 9999);
    s.fmax = integer(old.fmax, 0, 0, 9999);
    if (s.fmax) s.fmax = Math.max(s.fmin, s.fmax);
    s.pmin = integer(old.pmin, Math.min(book.defaultPmin || 2, pminMax), 0, pminMax);
    if (["freq", "shuffle", "wrong"].includes(old.order)) s.order = old.order;
    if (["auto", "light", "dark"].includes(old.theme)) s.theme = old.theme;
    for (const k of ["kyOnly", "showPh", "showEx", "showFm", "autoSpk", "singleCharKeys"]) {
      if (typeof old[k] === "boolean") s[k] = old[k];
    }
    s.pos = Array.isArray(old.pos) ? [...new Set(old.pos.filter(k => POSCHIPS.some(x => x.k === k)))] : [];
    // 旧记录/旧备份没有 posMode：一律回 primary（与旧行为一致），非法值同样回落，不报错。
    s.posMode = old.posMode === "all" ? "all" : "primary";
    // 复习曲线：已有记录缺字段 → 旧版密集曲线（5m/30m/12h/…，旧行为）；非法值整组回退 legacy
    // 并记录可展示原因，不抛异常、不丢其他设置。新用户默认已在 DEF（均衡），两者分开判断。
    {
      const legacy = STAGE_PRESETS.legacy;
      const rawStages = old.stages === undefined ? legacy.stages : old.stages;
      const rawRelearn = old.relearn === undefined ? legacy.relearn : old.relearn;
      const stageCfg = normalizeStageConfig(rawStages, rawRelearn);
      if (stageCfg.ok) {
        s.stages = stageCfg.stages;
        s.relearn = stageCfg.relearn;
        s.stagePreset = presetKeyOf(stageCfg.stages, stageCfg.relearn);
        if (stageConfigError && stageConfigError.bookId === book.id) stageConfigError = null;
      } else {
        s.stages = legacy.stages.slice();
        s.relearn = legacy.relearn;
        s.stagePreset = "legacy";
        stageConfigError = { bookId: book.id, error: stageCfg.error };
      }
    }
    migrateScope(old, s);
    // 单日复习上限（20）：0=不限，1–1000；已有记录缺字段 → 0（旧行为不限），非法值 → 0，四书独立。
    s.dailyReviewCap = normalizeDailyReviewCap(old.dailyReviewCap, 0);
    // 07 分组/积压保护（21 默认值）：旧记录缺字段按每组 30、积压保护开；非法值回退默认，四书独立。
    s.groupSize = (typeof old.groupSize === "number" && Number.isInteger(old.groupSize)
      && old.groupSize >= GROUP_SIZE_MIN && old.groupSize <= GROUP_SIZE_MAX)
      ? old.groupSize : GROUP_SIZE_DEFAULT;
    s.backlogGuard = typeof old.backlogGuard === "boolean" ? old.backlogGuard : true;
    // 22 自动续背：旧记录缺整个字段 → enabled:false（兼容分支与新用户默认分开），其余子项取默认；
    // 记录存在时 enabled 非布尔 → false，单个非法子项只修该子项，不整份重置。
    s.autoResume = normalizeAutoResume(old.autoResume, old.autoResume === undefined);
    // 12 阅读字号与设备语音偏好：旧记录缺字段 → 标准/默认语速；非法值只修该字段（四书独立）。
    s.fontSize = normalizeFontSize(old.fontSize);
    s.voiceURI = normalizeVoiceURI(old.voiceURI);
    s.speechRate = normalizeSpeechRate(old.speechRate);
    // F1 阅读与布局：旧记录缺字段 → 舒适/默认顺序/显示元信息/固定撤销与熟练；
    // 单个非法子项只修该字段，不整份重置；不改学习计划、范围或曲线。
    s.cardDensity = CARD_DENSITY_VALUES.includes(old.cardDensity) ? old.cardDensity : CARD_DENSITY_DEFAULT;
    s.readingOrder = normalizeReadingOrder(old.readingOrder);
    for (const k of ["showCardMeta", "showCardStage", "showCardPos"]) {
      if (typeof old[k] === "boolean") s[k] = old[k];
    }
    s.secondaryActions = normalizeSecondaryActions(old.secondaryActions);
    // 设置页「开启推荐方案」提示只在当前书读取/切换时由 trackAutoResumeLegacy 维护，
    // 这里不再按归一化路径反复增删，避免普通保存/校准把真实旧记录提示清掉。
    if (isRecord(old.keys)) {
      for (const k of Object.keys(DEFKEYS)) {
        if (validKey(old.keys[k])) s.keys[k] = old.keys[k].toLowerCase();
      }
      if (new Set(Object.values(s.keys)).size !== Object.keys(s.keys).length) s.keys = Object.assign({}, DEFKEYS);
    }
    normalizeInputSettings(s,old);
    for (const [k, p] of Object.entries(o.progress)) {
      if (!validIndex(k, book) || !validProgress(p)) {
        throw new Error("单词进度格式不正确");
      }
      out.progress[k] = p.slice();
    }
    for (const [k, d] of Object.entries(o.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !isRecord(d)
          || ![d.n, d.r, d.ok, d.no].every(n => nonnegative(n) && Number.isInteger(n))
          || d.n > d.r || d.ok + d.no !== d.r) throw new Error("每日记录格式不正确");
      const date = new Date(k + "T12:00:00");
      if (Number.isNaN(date.getTime()) || todayStr(date) !== k) throw new Error("记录日期不正确");
      out.days[k] = {n:d.n, r:d.r, ok:d.ok, no:d.no};
    }
    if (o.stars !== undefined && !isRecord(o.stars)) throw new Error("收藏格式不正确");
    for (const [k, v] of Object.entries(o.stars || {})) {
      if (!validIndex(k, book)) throw new Error("收藏词条不存在");
      if (v) out.stars[k] = 1;
    }
    out.proficient = normalizeProficient(o.proficient === undefined ? {} : o.proficient, book);
    // 当日复习台账（20）：只保留「今日」的计数，过期/非法一律归今日 0，不伪造历史。
    out.reviewDay = normalizeReviewDay(o.reviewDay);
    // 当日临时加量（23）：只认今日的 extra，过期/非法一律归今日 0，不结转。
    out.extraDay = normalizeExtraDay(o.extraDay);
    // 16 拼写专项记录（每书独立，旧记录/旧备份缺字段 → 空白，不报错、不丢其它字段）。
    out.spelling = normalizeSpellingState(o.spelling);
    out.timeSec = integer(o.timeSec, 0, 0, Number.MAX_SAFE_INTEGER);
    out.dv = book.dataVersion || 1;   // 迁移/校验完成后标记为当前数据版本
    return out;
  }
  /** 读取某本词书已保存的 state；无记录 → 空白默认记录，损坏 → 抛错 */
  function readBookState(book){
    const raw = localStorage.getItem(book.KEY);
    if (raw === null) return {state: freshState(book), raw: null};
    return {state: normalizeState(JSON.parse(raw), book.id), raw: raw};
  }
  /**
   * 22 旧记录兼容标记：原始记录缺 settings.autoResume → 设置页显示「开启推荐方案」。
   * 新记录（无原始数据）不显示该提示；读取失败时不动现有标记。
   */
  function trackAutoResumeLegacy(bookId, raw){
    if (raw === null || raw === undefined) { autoResumeLegacyBooks.delete(bookId); return; }
    try {
      const o = JSON.parse(raw);
      if (isRecord(o) && isRecord(o.settings) && o.settings.autoResume !== undefined) autoResumeLegacyBooks.delete(bookId);
      else autoResumeLegacyBooks.add(bookId);
    } catch (e) { /* 损坏记录由现有恢复流程处理 */ }
  }
  function load(){
    const book = currentBook();
    try {
      const got = readBookState(book);
      S = got.state;
      lastMainRaw = got.raw;
      pendingReplacementToken = null;
      blockedBooks.delete(book.id);
      storageOK = true;
      loadError = null;
      trackAutoResumeLegacy(book.id, got.raw);
    } catch (e) {
      storageOK = false;
      blockedBooks.add(book.id);
      loadError = e && e.message ? e.message : "记录格式无法读取";
      // Do not overwrite an unreadable or damaged backup with empty records.
    }
    // Permanent exclusions can still be recovered if the main backup is damaged.
    try { syncProficientFromStorage(); }
    catch (e) { storageOK = false; blockedBooks.add(book.id); }
    // O1：主记录只提供“本书 settings”来源；未覆盖字段按设备通用值重新解析，不信任物化缓存。
    applyBookPreferenceResolution(S, book.id);
    syncLastResolvedPreferences();
    lastSavedSignature = savedStateSignature(S);
    loadSurvey();
  }
  function save(proficiencyChanged = false, replaceAll = false){
    if (blockedBooks.has(currentBookId)) return false;   // 该书记录损坏/不可写时保护原文件
    if (replaceAll) {
      pendingReplacementToken = newReplacementToken();
      clearProfPending(currentBookId);
    }
    try {
      let latest = localStorage.getItem(KEY);
      const wasEmptyPage = emptyMainPage();
      // 替换必须在写独立熟练键之前裁决，不能先把旧 pending 熟练操作写回。
      const replaced = !replaceAll && latest !== lastMainRaw
        && (latest === null || replacementToken(latest) !== replacementToken(lastMainRaw));
      if (replaced) {
        const authoritative = latest === null ? freshState(currentBook()) : normalizeState(JSON.parse(latest), currentBookId);
        authoritative.proficient = readBookProficient(currentBook(), authoritative.proficient);
        S = authoritative;
        // 换代（导入/重置/清空）由来源页写覆盖标记；本页先读最新设备键再解析，不把换代记录装进 shared。
        try { readDevicePreferences(); } catch (e) { /* ignore */ }
        applyBookPreferenceResolution(S, currentBookId);
        syncLastResolvedPreferences();
        clearProfPending(currentBookId);
        pendingReplacementToken = null;
        studyPendingMs = 0;
        lastMainRaw = latest;
        lastSavedSignature = savedStateSignature(S);
        clearSessionSnapshot(currentBookId);
        if (activeSheet) closeSheet();
        bindSet(); applyFilter(); renderStats(); resumeAfterSharedChange(wasEmptyPage, true);
        storageOK = true;
        blockedBooks.delete(currentBookId);
        clearAlert("save");
        toast("另一窗口已替换记录，学习队列已同步");
        return true;
      }
      // O1：先按“此设备通用/本书单独”裁决，把本页显式改动的继承偏好写回设备 shared；
      // 写失败只提示归属未保存，学习判定/进度仍照常保存。
      if (!replaceAll) flushInheritedPreferenceEdits();
      // 写入失败后保留待提交换代；同一旧代的设置/累计不能再合入这份显式替换。
      if (proficiencyChanged || pendingReplacementToken) {
        localStorage.setItem(PROF_KEY, JSON.stringify(S.proficient));
        clearProfPending(currentBookId);
      } else {
        syncProficientFromStorage();
        // 上次熟练写入失败时，随这次主记录保存一并重试。
        if (pendingProfCount(currentBookId)) {
          localStorage.setItem(PROF_KEY, JSON.stringify(S.proficient));
          clearProfPending(currentBookId);
        }
      }
      if (!replaceAll && !pendingReplacementToken && latest !== lastMainRaw) {
        // A delayed storage event must not let an older tab overwrite newer learning records.
        const localLedger = reviewLedger();   // 本页当日台账（引用 S.reviewDay，含刚消费的计数）
        const latestState = latest !== null ? normalizeState(JSON.parse(latest), currentBookId) : freshState(currentBook());
        let baselineState = null;
        if (lastMainRaw !== null) {
          try { baselineState = normalizeState(JSON.parse(lastMainRaw), currentBookId); } catch (e) { baselineState = null; }
        }
        // 学习内容相等时，仅设置/台账等变化不应抢掉本页这次有效判定。
        const onlySettingsAndCountersDiffer = latest !== null && baselineState !== null
          && sharedLearningSignature(latestState) === sharedLearningSignature(baselineState);
        const localExtra = normalizeExtraDay(S.extraDay);
        const localSpelling = normalizeSpellingState(S.spelling);
        if (onlySettingsAndCountersDiffer) {
          const previousSettingsObject = S.settings;
          const previousSettings = JSON.stringify(S.settings);
          S.settings = mergeSharedSettings(S.settings, latestState.settings, baselineState.settings);
          // O1：合并结果里“另一页的有效偏好快照”→ 设备 shared；再按覆盖标记解析本页快照。
          S.settings = resolveIncomingPreferenceSettings(S.settings);
          mergeSharedCounters(latestState);
          const mergedRaw = serializeSharedState(S, latest, pendingReplacementToken);
          localStorage.setItem(KEY, mergedRaw);
          pendingReplacementToken = null;
          lastMainRaw = mergedRaw;
          lastSavedSignature = savedStateSignature(S);
          syncLastResolvedPreferences();
          storageOK = true;
          blockedBooks.delete(currentBookId);
          clearAlert("save");
          if (JSON.stringify(S.settings) !== previousSettings) refreshSharedSettingsSurfaces(false, previousSettingsObject);
          return true;
        }
        // 内容（进度/熟练/日统计等）确实被别标签更新：整份采用最新存储，本页这次判定让位，
        // 但当日台账/临时加量取较大值，不能让别的标签的旧快照把本页已消费额度或已授予加量回退。
        S = latestState;
        S.settings = resolveIncomingPreferenceSettings(S.settings);
        pendingReplacementToken = null;
        syncProficientFromStorage();
        const mergedLedger = reviewLedger();
        let mergedConflict = false;
        if (latest !== null && localLedger.d === mergedLedger.d && localLedger.used > mergedLedger.used) {
          S.reviewDay = {d: mergedLedger.d, used: localLedger.used};
          mergedConflict = true;
        }
        const mergedExtra = extraDayLedger();
        if (latest !== null && localExtra.d === mergedExtra.d && localExtra.extra > mergedExtra.extra) {
          S.extraDay = {d: mergedExtra.d, extra: localExtra.extra};
          mergedConflict = true;
        }
        // 16：本页刚完成的拼写组不能被别标签的旧快照覆盖；更新的一方保留并使合并结果落盘。
        const mergedSpelling = latest !== null ? mergeSpellingState(localSpelling, latestState.spelling)
          : normalizeSpellingState(latestState.spelling);
        if (JSON.stringify(mergedSpelling) !== JSON.stringify(normalizeSpellingState(S.spelling))) {
          S.spelling = mergedSpelling;
          mergedConflict = true;
        }
        if (mergedConflict) {
          try {
            const mergedRaw = serializeSharedState(S, latest);
            localStorage.setItem(KEY, mergedRaw);
            latest = mergedRaw;
          } catch (e) { /* 写入失败：内存值保留，下一次保存重试 */ }
        }
        lastMainRaw = latest;
        lastSavedSignature = savedStateSignature(S);
        if (latest === null) { studyPendingMs = 0; clearProfPending(currentBookId); }
        bindSet(); applyFilter(); renderStats(); resumeAfterSharedChange(wasEmptyPage, false);
        toast("另一窗口已更新记录，学习队列已同步");
        storageOK = true;
        blockedBooks.delete(currentBookId);
        return true;
      }
      // 保存时若当日台账/加量的日期已不是今天则归「今日 0」（跨午夜且轮询尚未刷新也不写错日期）。
      S.reviewDay = normalizeReviewDay(S.reviewDay);
      S.extraDay = normalizeExtraDay(S.extraDay);
      const serialized = serializeSharedState(S, latest, pendingReplacementToken);
      const committedReplacement = !!pendingReplacementToken;
      localStorage.setItem(KEY, serialized); lastMainRaw = serialized;
      pendingReplacementToken = null;
      if (committedReplacement) studyPendingMs = 0;
      lastSavedSignature = savedStateSignature(S);
      storageOK = true; blockedBooks.delete(currentBookId); clearAlert("save"); return true;
    }
    catch (e) {
      storageOK = false;
      showAlert("进度保存失败", "受影响词书：" + currentBook().name
        + "。浏览器存储不可用或空间不足；当前页面仍可继续学习，但刷新前请导出备份。"
        + (pendingProfCount(currentBookId) ? "另有熟练标记尚未写入。" : ""), {kind: "save", export: true});
      return false;
    }
  }
  function migrateScope(oldSet, cur){
    if (oldSet.fmin !== undefined) return;
    if (oldSet.scope === "high") cur.fmin = 5;
    else if (oldSet.scope === "ky") cur.kyOnly = true;
    else if (oldSet.scope === "all") { cur.fmin = 1; cur.fmax = 0; }
  }

  /* ================= 多词书：切换 / 统计 / 备份 ================= */
  /** 兼容旧称：O1 后这些字段改由“设备通用/本书覆盖”解析，不再在切书时无条件复制。 */
  const CARRY_SETTINGS = PREFERENCE_FIELDS;
  function cloneSettingsValue(v){
    return (v && typeof v === "object") ? JSON.parse(JSON.stringify(v)) : v;
  }
  /** 某书学习概况（用于词书列表展示）：已学 = 有进度记录的词数，已掌握 = 走完全部档位 */
  function bookStats(id){
    let prog = null;
    if (id === currentBookId && blockedBooks.has(id)) return {ok: false, learned: 0, mastered: 0};
    if (id === currentBookId) prog = S.progress;
    else {
      try {
        prog = readBookState(BOOKS[id]).state.progress;   // 迁移后再统计，删词不计入
      } catch (e) { return {ok: false, learned: 0, mastered: 0}; }
    }
    let learned = 0, mastered = 0;
    for (const k of Object.keys(prog || {})) {
      const p = prog[k];
      if (!Array.isArray(p) || !hasMainProgress(p)) continue;
      learned++;
      if (p[0] >= MASTER) mastered++;
    }
    return {ok: true, learned: learned, mastered: mastered};
  }
  /** 读取某书 state（qa 钩子用；非法/不可用 → null，未保存过 → 空白记录） */
  function getBookState(id){
    if (!bookOf(id)) return null;
    if (id === currentBookId) return S;
    if (!BOOKS[id].available) return null;
    try {
      const state = readBookState(BOOKS[id]).state;
      // O1：对外只读视图按“覆盖 ? 本书值 : 设备通用值”解析；不写内存/存储。
      applyBookPreferenceResolution(state, id);
      try { state.proficient = readBookProficient(BOOKS[id], state.proficient); } catch (e) {}
      state.proficient = mergePendingProficient(state.proficient, id);
      return state;
    }
    catch (e) { return null; }
  }
  /** 直接写入某本非当前词书（导入 v2 用）；主记录与熟练键都写，保持两处一致 */
  function writeBookState(id, state){
    const book = BOOKS[id];
    if (!book) return false;
    try {
      localStorage.setItem(book.KEY, serializeSharedState(state, null, newReplacementToken()));
      localStorage.setItem(book.PROF_KEY, JSON.stringify(state.proficient));
      clearProfPending(id);
      blockedBooks.delete(id);
      return true;
    } catch (e) {
      storageOK = false;
      toast("部分词书记录未能保存，请检查浏览器存储空间");
      return false;
    }
  }
  /**
   * 切换当前词书。
   * opts.silent  不弹切换提示（跨标签页跟随时用）
   * opts.persist 是否写 ACTIVE_KEY 并保存界面偏好（跨标签页跟随时 false）
   * opts.carry   是否携带当前书的 theme/keys/显示偏好（导入恢复时为 false 以保留备份设置）
   */
  function switchBook(id, opts){
    opts = opts || {};
    const book = bookOf(id);
    if (!book || !book.available) {
      if (!opts.silent) toast("该词书数据未载入，暂时无法切换");
      return false;
    }
    if (id === currentBookId) {
      if (!opts.silent) { renderBookList(); if (activeSheet) closeSheet(); }
      return true;
    }
    saveListUi();
    const saved = opts.persist === false ? storageOK : save();
    if (!saved) {
      // 保存失败后切走会丢掉只能从当前内存导出的学习记录。
      // 初次读到损坏记录、尚未学习的书仍可切出，不妨碍其它词书使用。
      if (!blockedBooks.has(currentBookId) || savedStateSignature(S) !== lastSavedSignature) {
        toast("当前词书未能保存，已保留在本页；请先导出进度备份后再切换");
        return false;
      }
    }
    // 15：切书视为退出刷新恢复现场；当前书与目标书的旧会话快照都丢弃（主记录不受影响）。
    clearSessionSnapshot(currentBookId);
    clearSessionSnapshot(id);
    // 读取目标书记录；目标记录损坏时保护原文件（blocked）并先用空白记录，可由导入备份恢复
    let target = freshState(book);
    let targetRaw = null;
    let targetBlocked = false;
    try {
      const got = readBookState(book);
      target = got.state;
      targetRaw = got.raw;
      try {
        const profRaw = localStorage.getItem(book.PROF_KEY);
        if (profRaw !== null) target.proficient = normalizeProficientByBook(JSON.parse(profRaw), book);
      } catch (e) { targetBlocked = true; }
      target.proficient = mergePendingProficient(target.proficient, id);
    } catch (e) { targetBlocked = true; }
    trackAutoResumeLegacy(id, targetRaw);
    // O1：切书不再无条件复制 CARRY_SETTINGS；目标书未覆盖字段按设备通用值解析，
    // 本书覆盖字段保留目标书自己的值（旧迁移明确把旧书值标为覆盖，不会被别的书抹平）。
    applyBookPreferenceResolution(target, id);
    syncLastResolvedPreferences();
    // 先用旧词书关闭浮层，避免关闭时拿旧filt/活动行索引访问目标词库。
    if (activeSheet) closeSheet();
    // 旧列表DOM中的数字索引也不能被renderRows带到新书；焦点留在稳定入口。
    if ($("#v-list")?.classList.contains("on")) $("#btnBooks")?.focus?.({preventScroll: true});
    currentBookId = id;
    sharedCardRefreshPending = false;
    sharedListRefreshPending = false;
    KEY = book.KEY;
    PROF_KEY = book.PROF_KEY;
    SURVEY_KEY = book.SURVEY_KEY;
    W = book.words;
    wordIndex = book.wordIndex;
    S = target;
    pendingReplacementToken = null;
    loadSurvey();
    lastMainRaw = targetRaw;
    lastSavedSignature = savedStateSignature(S);
    if (targetBlocked) blockedBooks.add(id); else blockedBooks.delete(id);
    storageOK = !targetBlocked;
    // O1：本页词书写 sessionStorage；只有 follow 模式才写旧 ACTIVE 作为跨页信号。
    // 跨标签 silent 跟随（persist:false）不回写 ACTIVE，也不保存目标书，避免来回触发。
    commitPageBookSelection(id, {writeActiveSignal: opts.persist !== false && pageBookMode() === "follow"});
    if (opts.persist !== false) {
      save();   // 保存当前书学习记录与新书解析后的偏好快照（目标记录损坏时自动跳过）
    }
    pendingFollowBookId = null;
    renderBookFollowNotice();
    rebinding = null;
    detailWord = null;
    bindSet();
    restoreListUi(id);
    applyFilter(false);
    renderStats();
    startSession();
    updateScopeCount();
    updateBar();
    applyBrand();
    renderBookList();
    if (!opts.silent) toast("已切换到「" + book.name + "」");
    return true;
  }
  /**
   * 跨标签页词书信号 ACTIVE_KEY 的接收端（O1 §7）：
   * - local 页完全忽略 ACTIVE；
   * - follow 页在无未完成卡/特训/受控子组/本页等待/浮层时可 silent 跟随；
   * - 有受保护现场时只提示「另一页切到了××，本页已保留当前组 [同步切换]」，用户明确点才切；
   * - 相同 ID 不重复 startSession；开启 follow 不追历史 ACTIVE（只处理之后的变更事件）。
   */
  function followActiveBook(){
    if (pageBookMode() !== "follow") return false;   // 仅本页：忽略 ACTIVE，不动其他页也不被带动
    let id = null;
    try { id = localStorage.getItem(ACTIVE_KEY); } catch (e) { return false; }
    if (!id || id === currentBookId || !validBookIdRaw(id)) return false;
    const protectedScene = cur != null || drillMode || inSubgroup() || emptyWaitActive() || !!activeSheet;
    if (protectedScene) {
      showBookFollowNotice(id);
      return false;
    }
    pendingFollowBookId = null;
    renderBookFollowNotice();
    return switchBook(id, {silent: true, persist: false, carry: false});
  }
  function showBookFollowNotice(bookId){
    if (!validBookIdRaw(bookId) || bookId === currentBookId) return false;
    pendingFollowBookId = bookId;
    renderBookFollowNotice();
    return true;
  }
  const APP_ID = "kaoyan-vocab";
  const JOURNAL_KEY = "vocab_import_journal_v1";

  /** 导出只读：最新独立熟练键 + 尚未落盘的增删操作；不修改 S。 */
  function currentExportProficient(){
    let stored = S.proficient;
    try {
      const raw = localStorage.getItem(PROF_KEY);
      if (raw !== null) stored = normalizeProficientByBook(JSON.parse(raw), currentBook());
    } catch (e) { /* 损坏/不可用时保留内存名单，collect 会给出警告 */ }
    return mergePendingProficient(stored, currentBookId);
  }
  function exportStateSnapshot(st, book, includePending){
    return JSON.parse(JSON.stringify({
      dv: st.dv || book.dataVersion || 1,
      settings: st.settings || DEF.settings, progress: st.progress || {}, days: st.days || {},
      stars: st.stars || {}, proficient: includePending ? currentExportProficient() : (st.proficient || {}),
      // 当日复习台账随备份 v3 整体导出（旧备份缺字段由 normalizeState 按今日 0 兼容）。
      reviewDay: normalizeReviewDay(st.reviewDay),
      // 当日临时加量随备份 v3 整体导出（旧备份缺字段按今日 0 兼容）。
      extraDay: normalizeExtraDay(st.extraDay),
      // 16 拼写专项累计与最近一组汇总（不含逐词明细；旧备份缺字段按空白兼容，不升备份版本）。
      spelling: normalizeSpellingState(st.spelling),
      timeSec: st.timeSec || 0
    }));
  }
  /**
   * 只读收集全部词书。当前书用内存快照（可能含尚未落盘的学习进度），
   * 熟练名单与最新存储及待写入操作合并；其他书只读存储，绝不改动内存。
   */
  function collectExportData(){
    const books = {}, corrupted = [], warnings = [];
    for (const def of BOOK_DEFS) {
      const book = BOOKS[def.id];
      if (!book.available) continue;
      let raw = null, profRaw = null;
      try {
        raw = localStorage.getItem(book.KEY);
        profRaw = localStorage.getItem(book.PROF_KEY);
      } catch (e) {
        if (def.id === currentBookId) {
          warnings.push({id: def.id, name: book.name, reason: "memory-only"});
          // 当前书就是已解析运行时快照（含尚未落盘的进度/偏好编辑），原样只读导出。
          books[def.id] = exportStateSnapshot(S, book, true);
        } else {
          warnings.push({id: def.id, name: book.name, reason: "storage-unavailable"});
        }
        continue;
      }
      if (def.id === currentBookId) {
        if (raw !== null) {
          try { normalizeState(JSON.parse(raw), def.id); }
          catch (err) {
            corrupted.push({id: def.id, name: book.name, raw: raw, proficient: profRaw, error: err.message});
            continue;
          }
        }
        // 当前书 S 已是“覆盖 ? 本书值 : 设备通用值”解析后的快照，原样只读导出；
        // 其他词书才需要按覆盖标记从存储重算（不修改内存/存储、不装 shared/overrides）。
        books[def.id] = exportStateSnapshot(S, book, true);
        if (profRaw !== null) {
          try { normalizeProficientByBook(JSON.parse(profRaw), book); }
          catch (err) { warnings.push({id: def.id, name: book.name, reason: "proficient-unreadable"}); }
        }
        continue;
      }
      if (raw === null) {
        const empty = freshState(book);
        // O1：无记录的词书导出其实际有效偏好（未覆盖字段 = 设备通用值），只读、不写存储。
        applyBookPreferenceResolution(empty, def.id);
        empty.proficient = mergePendingProficient(empty.proficient, def.id);
        books[def.id] = exportStateSnapshot(empty, book, false);
        continue;
      }
      let state;
      try { state = normalizeState(JSON.parse(raw), def.id); }
      catch (err) {
        corrupted.push({id: def.id, name: book.name, raw: raw, proficient: profRaw, error: err.message});
        continue;
      }
      // O1：备份 v3 的每书 settings 填该书实际有效偏好；归属关系本身不随备份往返。
      applyBookPreferenceResolution(state, def.id);
      if (profRaw !== null) {
        try { state.proficient = normalizeProficientByBook(JSON.parse(profRaw), book); }
        catch (err) { warnings.push({id: def.id, name: book.name, reason: "proficient-unreadable"}); }
      }
      state.proficient = mergePendingProficient(state.proficient, def.id);
      books[def.id] = exportStateSnapshot(state, book, false);
    }
    return {books: books, corrupted: corrupted, warnings: warnings};
  }
  function warningIds(warnings){
    return warnings.map(w => w.reason === "proficient-unreadable"
      ? w.name + "（熟练名单无法读取，已使用主记录中的名单）"
      : w.reason === "memory-only"
        ? w.name + "（存储不可用，已使用当前内存快照）"
        : w.name + "（当前浏览器存储不可用，未包含）").join("；");
  }
  /** 导出 v3：全部可用词书；任一主记录损坏时拒绝常规导出，避免伪装成空白记录。 */
  function buildExport(){
    const data = collectExportData();
    if (data.corrupted.length) {
      const error = new Error("有词书的记录无法读取：" + data.corrupted.map(c => c.name).join("、")
        + "。已停止常规导出，避免把损坏记录导出成空白；请使用救援导出保留原文。");
      error.code = "EXPORT_CORRUPTED";
      error.corrupted = data.corrupted;
      throw error;
    }
    const out = {
      app: APP_ID, version: 3, exportedAt: new Date().toISOString(),
      activeBook: currentBookId, books: data.books
    };
    if (data.warnings.length) out.warnings = data.warnings.map(w => ({id: w.id, name: w.name, reason: w.reason}));
    return out;
  }
  /** 救援导出：正常词书 + 损坏词书的原始文本；该文件明确标记为不可直接导入。 */
  function buildRescueExport(){
    const data = collectExportData();
    return {
      app: APP_ID, version: 3, exportedAt: new Date().toISOString(),
      activeBook: currentBookId, rescue: true, books: data.books,
      damaged: Object.fromEntries(data.corrupted.map(c => [c.id, {
        name: c.name, state: c.raw, proficient: c.proficient, error: c.error
      }])),
      warnings: data.warnings.map(w => ({id: w.id, name: w.name, reason: w.reason}))
    };
  }

  function validateBackupEnvelope(o){
    if (!isRecord(o)) throw new Error("备份内容不是对象");
    if (o.version === 2 || o.version === 3) {
      if (o.app !== APP_ID) throw new Error("不是本应用的进度备份（应用标识不匹配）");
      if (o.rescue) throw new Error("这是救援导出，包含损坏原文，不能直接导入；请先修复或重新导出正常备份");
      if (!isRecord(o.books)) throw new Error("备份缺少词书记录");
      return o.version;
    }
    if (o.version === undefined || o.version === 1) {
      if (o.app !== undefined && o.app !== APP_ID) throw new Error("不是本应用的进度备份（应用标识不匹配）");
      if (isRecord(o.books)) throw new Error("备份版本与内容不一致");
      return 1;
    }
    throw new Error("不支持的备份版本");
  }
  function stateHasRecoverableContent(raw, state){
    const has = o => isRecord(o) && Object.keys(o).length > 0;
    if (has(raw.progress) || has(raw.stars) || has(raw.proficient)) return true;
    if (isRecord(raw.days) && Object.values(raw.days).some(d => d && ((d.r || 0) > 0 || (d.n || 0) > 0))) return true;
    if (isRecord(raw.reviewDay) && nonnegative(raw.reviewDay.used) && raw.reviewDay.used > 0) return true;
    if (isRecord(raw.extraDay) && nonnegative(raw.extraDay.extra) && raw.extraDay.extra > 0) return true;
    // 16：只练过拼写、尚无主学习记录的备份也应可导入，不静默拒绝专项记录。
    if (isRecord(raw.spelling)) {
      const sp = normalizeSpellingState(raw.spelling);
      if (sp.sessions > 0 || sp.attempts > 0 || sp.lastSession) return true;
    }
    if (nonnegative(raw.timeSec) && raw.timeSec > 0) return true;
    // 只把显式改过的设置视为可恢复内容；默认设置的空备份仍然拒绝。
    if (isRecord(raw.settings)) {
      for (const [key, value] of Object.entries(raw.settings)) {
        if (JSON.stringify(value) !== JSON.stringify(DEF.settings[key])) return true;
      }
    }
    return !!(state && (Object.keys(state.progress || {}).length || Object.keys(state.stars || {}).length
      || Object.keys(state.proficient || {}).length));
  }
  function backupLearnedCount(state){
    return Object.values(state.progress || {}).filter(p => Array.isArray(p) && p[4] > 0).length;
  }
  function backupMasteredCount(state){
    return Object.values(state.progress || {}).filter(p => Array.isArray(p) && p[0] >= MASTER).length;
  }
  /** 导入前摘要：完整校验但不写入任何存储，用于展示备份时间、各书记录量与替换范围。 */
  function prepareImportPlan(o){
    const version = validateBackupEnvelope(o);
    if (version === 1) {
      const state = normalizeState(o, "kaoyan");
      if (!stateHasRecoverableContent(o, state)) throw new Error("备份中没有可恢复的学习记录");
      return {
        kind: "legacy", version: 1, exportedAt: null, activeBook: "kaoyan",
        books: [{id: "kaoyan", name: BOOKS.kaoyan.name, learned: backupLearnedCount(state),
          mastered: backupMasteredCount(state)}]
      };
    }
    const books = [], seen = new Set();
    for (const [id, raw] of Object.entries(o.books)) {
      const book = bookOf(id);
      if (!book || !book.available || seen.has(id)) continue;
      seen.add(id);
      const state = normalizeState(raw, id);
      books.push({id: id, name: book.name, learned: backupLearnedCount(state),
        mastered: backupMasteredCount(state), raw: raw});
    }
    if (!books.length) throw new Error("备份中没有可用于当前版本的词书记录");
    if (!books.some(b => stateHasRecoverableContent(b.raw, normalizeState(b.raw, b.id)))) {
      throw new Error("备份中没有可恢复的学习记录");
    }
    return {
      kind: "books", version: version,
      exportedAt: (typeof o.exportedAt === "string" && !Number.isNaN(Date.parse(o.exportedAt))) ? o.exportedAt : null,
      activeBook: (typeof o.activeBook === "string" && bookOf(o.activeBook) && BOOKS[o.activeBook].available) ? o.activeBook : null,
      books: books
    };
  }

  function captureStorageKeys(ids){
    const keys = {};
    for (const id of ids) {
      const book = BOOKS[id];
      if (!book) continue;
      keys[book.KEY] = localStorage.getItem(book.KEY);
      keys[book.PROF_KEY] = localStorage.getItem(book.PROF_KEY);
    }
    keys[ACTIVE_KEY] = localStorage.getItem(ACTIVE_KEY);
    // O1：导入后会被标本书覆盖，设备键旧原文也在恢复点里，失败时整份回滚。
    keys[DEVICE_PREFS_KEY] = localStorage.getItem(DEVICE_PREFS_KEY);
    return keys;
  }
  function beginImportJournal(ids){
    try {
      if (localStorage.getItem(JOURNAL_KEY)) {
        throw new Error("发现上次未完成的导入恢复点，请先在页面提示中恢复导入前记录，再重新导入");
      }
    } catch (e) {
      if (e && e.message && e.message.includes("恢复点")) throw e;
      throw new Error("浏览器存储不可用，导入未开始，现有记录未改动");
    }
    const originals = captureStorageKeys(ids);
    try {
      localStorage.setItem(JOURNAL_KEY, JSON.stringify({at: new Date().toISOString(), keys: originals,
        pageBook: pageStoreGet(PAGE_BOOK_KEY)}));
    }
    catch (e) { throw new Error("无法创建导入恢复点（浏览器存储空间不足），导入未开始，现有记录未改动"); }
    return originals;
  }
  function rollbackImportJournal(originals){
    try {
      for (const [key, value] of Object.entries(originals)) {
        if (value === null || value === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
      localStorage.removeItem(JOURNAL_KEY);
      return true;
    } catch (e) { return false; }
  }
  function endImportJournal(){
    try { localStorage.removeItem(JOURNAL_KEY); } catch (e) { /* ignore */ }
  }
  function recoverImportJournal(){
    let journal;
    try {
      const raw = localStorage.getItem(JOURNAL_KEY);
      journal = raw ? JSON.parse(raw) : null;
      if (!journal || !isRecord(journal.keys)) throw new Error("恢复日志格式不正确");
      for (const [key, value] of Object.entries(journal.keys)) {
        if (value === null || value === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
      localStorage.removeItem(JOURNAL_KEY);
    } catch (e) {
      showAlert("导入恢复失败", "恢复日志无法读取或写入：" + (e.message || "存储不可用") + "。请不要继续导入，先导出救援备份。", {kind: "import"});
      return false;
    }
    try { initDevicePreferences(true); } catch (e) { /* 恢复后按当前设备键/降级规则解析 */ }
    try {
      const pageBook = validBookIdRaw(journal.pageBook) ? journal.pageBook : pageStoreGet(PAGE_BOOK_KEY);
      currentBookId = pickActiveBook(validBookIdRaw(pageBook) ? pageBook
        : localStorage.getItem(ACTIVE_KEY));
      pageStoreSet(PAGE_BOOK_KEY, currentBookId);
    } catch (e) { /* 保持当前书 */ }
    const active = currentBook();
    KEY = active.KEY; PROF_KEY = active.PROF_KEY; SURVEY_KEY = active.SURVEY_KEY;
    W = active.words; wordIndex = active.wordIndex;
    load();
    clearAllSessionSnapshots();   // 15：导入恢复属于外部替换，旧会话快照失效
    bindSet(); restoreListUi(currentBookId); applyFilter(false); renderStats(); startSession();
    updateBar(); renderBookList(); applyBrand();
    clearAlert("import");
    toast("已恢复上次导入前的记录");
    return true;
  }
  function importFailureMessage(error, names){
    return (error && error.message ? error.message : "导入未完成")
      + (names && names.length ? "（受影响词书：" + names.join("、") + "）" : "");
  }
  function importCommittedState(entries, o){
    const failed = [];
    for (const entry of entries) {
      const id = entry.id, state = entry.state;
      if (id === currentBookId) {
        try { syncProficientFromStorage(); } catch (e) { /* 保留当前可用名单 */ }
        state.proficient = Object.assign({}, S.proficient, state.proficient);
        S = state;
        blockedBooks.delete(id);
        if (!save(true, true)) failed.push(id);
      } else {
        const existing = getBookState(id) || freshState(BOOKS[id]);
        try { existing.proficient = readBookProficient(BOOKS[id], existing.proficient); } catch (e) { /* ignore */ }
        state.proficient = Object.assign({}, existing.proficient, state.proficient);
        if (!writeBookState(id, state)) failed.push(id);
      }
    }
    if (failed.length) throw new Error(importFailureMessage(new Error("导入未能全部保存"), failed.map(id => BOOKS[id].name)));
    // O1：被导入书可携带偏好标本书覆盖（设备 shared 不变、未导入书覆盖不动）。
    // 写入失败会抛出 → 外层用含设备键旧原文的导入恢复点整份回滚。
    markImportedPreferenceOverrides(entries.map(entry => entry.id));
    // 15：仅在导入整份写入成功后丢弃旧会话快照；失败回滚时保持存储键与导入前完全一致。
    clearAllSessionSnapshots();
    const target = (typeof o.activeBook === "string"
      && bookOf(o.activeBook) && BOOKS[o.activeBook].available) ? o.activeBook : null;
    if (target && target !== currentBookId) switchBook(target, {carry: false, silent: true});
    else {
      bindSet(); applyFilter(false); renderStats(); startSession(); updateBar();
      if (activeSheet) closeSheet();
      renderBookList();
    }
    endImportJournal();
    toast("进度已导入（备份中词书的记录已恢复，原有熟练标记已保留）");
    return S;
  }
  /** 导入旧版（v1 平铺）备份：固定按考研书解析，替换考研学习记录、保留考研已有熟练标记 */
  function importLegacyV1(o){
    validateBackupEnvelope(o);
    const imported = normalizeState(o, "kaoyan");
    if (!stateHasRecoverableContent(o, imported)) throw new Error("备份中没有可恢复的学习记录");
    const originals = beginImportJournal(["kaoyan"]);
    const beforeS = JSON.parse(JSON.stringify(S));
    const beforeBook = currentBookId;
    const beforeBlocked = new Set(blockedBooks);
    const beforeRaw = lastMainRaw;
    const beforeSig = lastSavedSignature;
    const beforeReplacementToken = pendingReplacementToken;
    const beforeStorageOK = storageOK;
    const beforePending = snapshotPendingProf();
    const beforeDevicePrefs = preferenceDeviceUsable() ? clonePrefValue(devicePrefs) : null;
    const beforeDeviceRaw = devicePrefsRaw;
    try {
      if (currentBookId === "kaoyan") {
        // Importing an older backup cannot silently undo permanent manual exclusions.
        try { syncProficientFromStorage(); } catch (e) { /* keep memory */ }
        imported.proficient = Object.assign({}, S.proficient, imported.proficient);
        S = imported;
        blockedBooks.delete(currentBookId);
        if (!save(true, true)) throw new Error("考研记录未能保存");
        markImportedPreferenceOverrides(["kaoyan"]);
        S.settings = resolveBookPreferences(S, "kaoyan");
        syncLastResolvedPreferences();
        clearAllSessionSnapshots();   // 15：导入成功后才丢弃旧会话快照
        bindSet(); applyFilter(false); renderStats(); startSession();
        if (activeSheet) closeSheet();
        renderBookList();
      } else {
        // 当前在四/六级：只恢复考研书，不强制切书
        const existing = getBookState("kaoyan") || freshState(BOOKS.kaoyan);
        try { existing.proficient = readBookProficient(BOOKS.kaoyan, existing.proficient); } catch (e) { /* ignore */ }
        imported.proficient = Object.assign({}, existing.proficient, imported.proficient);
        if (!writeBookState("kaoyan", imported)) throw new Error("考研记录未能保存");
        markImportedPreferenceOverrides(["kaoyan"]);
        clearAllSessionSnapshots();   // 15：导入成功后才丢弃旧会话快照
        if (activeSheet) closeSheet();
        renderBookList();
      }
      endImportJournal();
      toast("进度已导入（原有熟练标记已保留）");
      return S;
    } catch (err) {
      if (rollbackImportJournal(originals)) {
        S = beforeS; currentBookId = beforeBook;
        blockedBooks.clear(); beforeBlocked.forEach(id => blockedBooks.add(id));
        lastMainRaw = beforeRaw; lastSavedSignature = beforeSig;
        pendingReplacementToken = beforeReplacementToken;
        storageOK = beforeStorageOK;
        restorePendingProf(beforePending);
        // O1：恢复内存里的设备偏好镜像（存储已由恢复点整份回滚）。
        if (beforeDevicePrefs) { devicePrefs = beforeDevicePrefs; devicePrefsRaw = beforeDeviceRaw; devicePrefsStatus = "ok"; }
        else { try { readDevicePreferences(); } catch (e) { /* ignore */ } }
        syncLastResolvedPreferences();
        pageStoreSet(PAGE_BOOK_KEY, currentBookId);
        KEY = BOOKS[currentBookId].KEY; PROF_KEY = BOOKS[currentBookId].PROF_KEY;
        SURVEY_KEY = BOOKS[currentBookId].SURVEY_KEY;
        W = BOOKS[currentBookId].words; wordIndex = BOOKS[currentBookId].wordIndex;
        sessionSnapshotWriteSuspended = true;
        try { bindSet(); applyFilter(false); renderStats(); startSession(); updateBar(); renderBookList(); }
        finally { sessionSnapshotWriteSuspended = false; }
        throw new Error(err.message + "；已回滚到导入前记录");
      }
      throw new Error("导入中断且自动回滚失败；恢复日志与损坏原文已保留，请立即导出救援备份");
    }
  }
  /**
   * 导入 v2/v3 全量备份：先整份校验，任一非法整份拒绝；建立恢复点后逐本合入，
   * 任一写入失败即整体回滚。activeBook 合法则切换。v2（无 dv）按 v1 逐书迁移后再校验。
   */
  function importBooksBackup(o){
    validateBackupEnvelope(o);
    const entries = [];
    let hasContent = false;
    for (const [id, raw] of Object.entries(o.books)) {
      const book = bookOf(id);
      if (!book || !book.available) continue;
      const state = normalizeState(raw, id);   // 任一非法直接抛错，零改动
      if (stateHasRecoverableContent(raw, state)) hasContent = true;
      entries.push({id: id, state: state});
    }
    if (!entries.length) throw new Error("备份中没有可用于当前版本的词书记录");
    if (!hasContent) throw new Error("备份中没有可恢复的学习记录");
    const originals = beginImportJournal(entries.map(e => e.id));
    const beforeS = JSON.parse(JSON.stringify(S));
    const beforeBook = currentBookId;
    const beforeBlocked = new Set(blockedBooks);
    const beforeRaw = lastMainRaw;
    const beforeSig = lastSavedSignature;
    const beforeReplacementToken = pendingReplacementToken;
    const beforeStorageOK = storageOK;
    const beforePending = snapshotPendingProf();
    const beforeDevicePrefs = preferenceDeviceUsable() ? clonePrefValue(devicePrefs) : null;
    const beforeDeviceRaw = devicePrefsRaw;
    try {
      return importCommittedState(entries, o);
    } catch (err) {
      const rolled = rollbackImportJournal(originals);
      if (rolled) {
        S = beforeS;
        if (currentBookId !== beforeBook) {
          currentBookId = beforeBook;
          const book = currentBook();
          KEY = book.KEY; PROF_KEY = book.PROF_KEY; SURVEY_KEY = book.SURVEY_KEY;
          W = book.words; wordIndex = book.wordIndex;
        }
        pageStoreSet(PAGE_BOOK_KEY, currentBookId);
        blockedBooks.clear(); beforeBlocked.forEach(id => blockedBooks.add(id));
        lastMainRaw = beforeRaw; lastSavedSignature = beforeSig;
        pendingReplacementToken = beforeReplacementToken;
        storageOK = beforeStorageOK;
        restorePendingProf(beforePending);
        if (beforeDevicePrefs) { devicePrefs = beforeDevicePrefs; devicePrefsRaw = beforeDeviceRaw; devicePrefsStatus = "ok"; }
        else { try { readDevicePreferences(); } catch (e) { /* ignore */ } }
        syncLastResolvedPreferences();
        sessionSnapshotWriteSuspended = true;
        try { bindSet(); applyFilter(false); renderStats(); startSession(); updateBar(); renderBookList(); }
        finally { sessionSnapshotWriteSuspended = false; }
        throw new Error(err.message + "；已回滚到导入前记录");
      }
      throw new Error("导入中断且自动回滚失败；恢复日志与损坏原文已保留，请立即导出救援备份");
    }
  }


  function isStar(i){ return !!(S.stars && S.stars[i]); }
  function toggleStar(i){
    S.stars = S.stars || {};
    if (S.stars[i]) delete S.stars[i]; else S.stars[i] = 1;
    save();
  }
  function streak(){
    const d = new Date(); let n = 0;
    for (let k = 0; k <= Object.keys(S.days).length; k++) {
      const rec = S.days[todayStr(d)];
      if (rec && rec.r > 0) n++;
      else if (k > 0) break;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }
  function fmtTime(sec){
    sec = sec || 0;
    const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60);
    return h ? h + " 小时 " + m + " 分" : m + " 分钟";
  }
  function day(){
    const k = todayStr();
    if (!S.days[k]) S.days[k] = {n:0, r:0, ok:0, no:0};
    return S.days[k];
  }
  function st(i){ return S.progress[i]; }
  /**
   * 主学习过的判据：p[4] 是主判定时间。特训可为未学词建立 [0,0,0,错次,0]
   * 占位记录，它只属于错词本，不应算新词额度、应继续按新词入队。
   */
  function hasMainProgress(p){ return !!p && p[4] > 0; }
  function isMainLearned(i){ return hasMainProgress(st(i)); }
  function isMastered(i){ const p = st(i); return p && p[0] >= MASTER; }
  function isProficient(i){ return !!(W[i] && Object.prototype.hasOwnProperty.call(S.proficient, W[i].w)); }
  function proficientCount(){ return Object.keys(S.proficient).length; }

  /* ================= 20 单日复习上限 · 当日台账（唯一计数入口） =================
   * 语义（docs/学习计划与额度设计-2026-10-22.md §2）：
   * - 「主流程复习判定次数」= 台账 reviewDay.used；计入已学词的到期待复习判定 + 组内重考判定
   *   （判定前 hasMainProgress(before) 为真即计入）；不计入新词首次学习、错词特训、改判、
   *   熟练/收藏/详情/发音等非判定动作。
   * - judge() 是唯一消费点，undo() 是唯一回滚点；本文件其它地方不得加减 used。
   * - 暂停态是派生状态（settings + 台账 + 当前卡），不持久化。
   */
  /** 单日复习上限校验：0=不限，1–1000 整数；非法 → fallback（旧记录 fallback=0）。 */
  function normalizeDailyReviewCap(n, fallback){
    return (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= DAILY_REVIEW_CAP_MAX)
      ? n : fallback;
  }
  /**
   * 22 自动续背设置归一：新用户走 AUTO_RESUME_DEFAULT（DEF 已含），
   * 旧记录缺整个字段 → enabled:false（推荐方案可由设置页一键开启），其余子项取默认；
   * 单个非法子项只修该子项，不整份重置。返回新对象，不修改入参。
   */
  function normalizeAutoResume(v, legacyMissing){
    const base = legacyMissing ? AUTO_RESUME_LEGACY_DEFAULT : AUTO_RESUME_DEFAULT;
    if (!isRecord(v)) return Object.assign({}, base);
    const out = Object.assign({}, base);
    // 记录存在但 enabled 不是布尔：按关闭处理（保守，避免旧/损坏数据擅自自动开组）。
    out.enabled = typeof v.enabled === "boolean" ? v.enabled : false;
    const b = AUTO_RESUME_BOUNDS;
    if (Number.isInteger(v.threshold) && v.threshold >= b.thresholdMin && v.threshold <= b.thresholdMax) {
      out.threshold = v.threshold;
    }
    if (Number.isInteger(v.idleMs) && v.idleMs >= b.idleMinMs && v.idleMs <= b.idleMaxMs) {
      out.idleMs = v.idleMs;
    }
    if (Number.isInteger(v.countdownMs) && v.countdownMs >= b.countdownMinMs && v.countdownMs <= b.countdownMaxMs) {
      out.countdownMs = v.countdownMs;
    }
    return out;
  }
  /** 当前书生效的自动续背设置（读取时再归一一次，兼容外部直接改 S.settings 的旧数据）。 */
  function getAutoResume(){ return normalizeAutoResume(S.settings.autoResume, false); }
  /** 严格写入（设置页/测试入口）：任一字段非法整次拒绝，返回 {ok,error,settings}。 */
  function setAutoResume(patch){
    const cur = getAutoResume();
    const next = Object.assign({}, cur);
    const b = AUTO_RESUME_BOUNDS;
    if (isRecord(patch)) {
      if (patch.enabled !== undefined) {
        if (typeof patch.enabled !== "boolean") return {ok: false, error: "自动续背开关需为布尔值", settings: cur};
        next.enabled = patch.enabled;
      }
      if (patch.threshold !== undefined) {
        if (!Number.isInteger(patch.threshold) || patch.threshold < b.thresholdMin || patch.threshold > b.thresholdMax) {
          return {ok: false, error: "待背阈值需为 " + b.thresholdMin + "–" + b.thresholdMax + " 的整数", settings: cur};
        }
        next.threshold = patch.threshold;
      }
      if (patch.idleMs !== undefined) {
        if (!Number.isInteger(patch.idleMs) || patch.idleMs < b.idleMinMs || patch.idleMs > b.idleMaxMs) {
          return {ok: false, error: "挂机等待需在 30 秒–10 分钟之间", settings: cur};
        }
        next.idleMs = patch.idleMs;
      }
      if (patch.countdownMs !== undefined) {
        if (!Number.isInteger(patch.countdownMs) || patch.countdownMs < b.countdownMinMs || patch.countdownMs > b.countdownMaxMs) {
          return {ok: false, error: "倒计时需在 3–60 秒之间", settings: cur};
        }
        next.countdownMs = patch.countdownMs;
      }
    }
    S.settings.autoResume = normalizeAutoResume(next, false);
    save();
    autoResumeLegacyBooks.delete(currentBookId);
    // 用户显式改自动续背设置时解除「今天暂停」，让新阈值立即有机会生效（仍要重新等满 idleMs）。
    clearAutoResumePause(currentBookId);
    // 设置变化后重新开始闲置等待，避免用旧阈值立即触发。
    resetAutoResumeRuntime();
    syncAutoResumeSettings();
    return {ok: true, settings: getAutoResume()};
  }
  /** 套用预设：便捷(1/30s/3s)、及时(1/1min)、均衡(5/2min)、集中(10/5min)、关闭。 */
  function applyAutoResumePreset(name){
    if (name === "off") return setAutoResume({enabled: false});
    const p = AUTO_RESUME_PRESETS[name];
    if (!p) return {ok: false, error: "未知的自动续背预设", settings: getAutoResume()};
    return setAutoResume({enabled: true, threshold: p.threshold, idleMs: p.idleMs, countdownMs: p.countdownMs});
  }
  function autoResumePresetOf(ar){
    if (!ar.enabled) return "off";
    for (const name of Object.keys(AUTO_RESUME_PRESETS)) {
      const p = AUTO_RESUME_PRESETS[name];
      if (ar.threshold === p.threshold && ar.idleMs === p.idleMs && ar.countdownMs === p.countdownMs) return name;
    }
    return "custom";
  }
  /** 台账归一：只认「今日」的计数；缺失/非法/过期/跨日 → {今日,0}（不伪造历史）。 */
  function normalizeReviewDay(v){
    const today = todayStr();
    if (!isRecord(v) || v.d !== today) return {d: today, used: 0};
    const used = v.used;
    if (typeof used !== "number" || !Number.isInteger(used) || used < 0) return {d: today, used: 0};
    return {d: today, used: used};
  }
  /** 当前书的当日台账；即使跨午夜轮询尚未触发，也按今天懒重置，不把昨天计数当今天。 */
  function reviewLedger(){
    const today = todayStr();
    const rec = isRecord(S.reviewDay) ? S.reviewDay : null;
    const ok = rec && rec.d === today && typeof rec.used === "number"
      && Number.isInteger(rec.used) && rec.used >= 0;
    if (!ok) S.reviewDay = {d: today, used: 0};
    return S.reviewDay;
  }
  function resetReviewLedgerForToday(){
    S.reviewDay = {d: todayStr(), used: 0};
    return S.reviewDay;
  }
  function getReviewCap(){ return normalizeDailyReviewCap(S.settings.dailyReviewCap, 0); }
  function reviewLedgerUsed(){ return reviewLedger().used; }
  /** 今日剩余复习预算：cap=0（不限）→ Infinity；否则 max(0, cap - used)。 */
  function reviewCapLeft(){
    const cap = getReviewCap();
    return cap === 0 ? Infinity : Math.max(0, cap - reviewLedgerUsed());
  }
  /**
   * 多标签：消费/回滚前先读主键对齐——若存储里是同一日的更大 used 就先采纳，
   * 避免两个标签各自获得整份预算。读不到/损坏时保留本页台账，不影响继续学习。
   */
  function alignReviewLedgerFromStorage(){
    const ledger = reviewLedger();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === null || raw === lastMainRaw) return ledger;   // 自己的最新写入无需对齐
      // 新一代主记录来自显式导入/重置；旧台账不能跨代取大，等待整份权威同步。
      if (replacementToken(raw) !== replacementToken(lastMainRaw)) return ledger;
      const stored = JSON.parse(raw);
      const rec = stored && isRecord(stored.reviewDay) ? stored.reviewDay : null;
      if (!rec || rec.d !== ledger.d) return ledger;
      const used = rec.used;
      if (typeof used === "number" && Number.isInteger(used) && used > ledger.used) ledger.used = used;
    } catch (e) { /* 别的标签记录损坏：保留本页台账 */ }
    return ledger;
  }
  /** 消费 1 次复习额度（judge 路径唯一入口）。保存失败时内存值保留，下次 save 重试。 */
  function consumeReviewCount(){
    const ledger = alignReviewLedgerFromStorage();
    ledger.used += 1;
    return ledger.used;
  }
  /** 撤销回滚：该次判定计过数时 used-1，不低于 0。 */
  function releaseReviewCount(n){
    const ledger = alignReviewLedgerFromStorage();
    ledger.used = Math.max(0, ledger.used - (n || 1));
    return ledger.used;
  }
  /** 暂停态是派生状态：当前卡是未揭示的复习卡（判定前已有主学习进度）且今日预算用尽。 */
  function computeCapPaused(){
    if (drillMode || cur == null || verdict !== null) return false;
    if (!hasMainProgress(st(cur))) return false;
    return reviewCapLeft() <= 0;
  }
  function isCapPaused(){ capPaused = computeCapPaused(); return capPaused; }
  /** 统计快照（只读）：cap/used/left/dueTotal（当前范围到期）/remainingDue（暂停时仍未复习的到期）/paused。 */
  function capStats(){
    const cap = getReviewCap();
    const used = reviewLedgerUsed();
    const left = cap === 0 ? Infinity : Math.max(0, cap - used);
    const paused = computeCapPaused();
    const dueTotal = countDue();
    return {cap: cap, used: used, left: left, dueTotal: dueTotal,
      remainingDue: paused ? dueTotal : 0, paused: paused};
  }

  /* ================= 23 今日临时加量 · 状态与授予（授予/消费分离） =================
   * extraDay={d,extra} 按书按本地日期，只表示「今天额外加了多少新词目标」；点击加量
   * 不写 progress、不改 day().n、不预抽候选，下一组 startSession 才按 effectiveNewTarget 补词。
   * 与复习上限完全独立：加量不提高 dailyReviewCap；新增词的后续重考仍受复习预算约束。
   */
  /** 临时加量校验：0–500 的整数；缺失/非法 → 0。 */
  function normalizeExtraDay(v){
    const today = todayStr();
    if (!isRecord(v) || v.d !== today) return {d: today, extra: 0};
    const extra = v.extra;
    if (typeof extra !== "number" || !Number.isInteger(extra) || extra < 0 || extra > EXTRA_NEW_TARGET_MAX) {
      return {d: today, extra: 0};
    }
    return {d: today, extra: extra};
  }
  /* ================= 16 拼写专项 · 状态归一（每书 state.spelling） ================= */
  /** 空白拼写记录（新用户/旧记录缺字段默认）。 */
  function spellingEmpty(){
    return {sessions: 0, attempts: 0, correct: 0, skipped: 0, lastDay: null, lastSession: null};
  }
  /** 合法本地日期串（与 days 校验同一口径）；非法返回 false。 */
  function validSpellingDay(v){
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(v + "T12:00:00");
    return !Number.isNaN(d.getTime()) && todayStr(d) === v;
  }
  const SPELLING_COUNT_MAX = 10000000;
  /**
   * 归一化「最近一组」汇总：字段/计数非法或自相矛盾（attempts+skipped!=total、
   * correct>attempts、total 越界）→ 整条丢弃为 null；不伪造历史。旧备份缺字段即 null。
   */
  function normalizeSpellingSession(v){
    if (!isRecord(v)) return null;
    const total = v.total;
    if (typeof total !== "number" || !Number.isInteger(total) || total < 1 || total > 100) return null;
    const attempts = v.attempts, correct = v.correct, skipped = v.skipped;
    if (typeof attempts !== "number" || !Number.isInteger(attempts) || attempts < 0 || attempts > total) return null;
    if (typeof correct !== "number" || !Number.isInteger(correct) || correct < 0 || correct > attempts) return null;
    if (typeof skipped !== "number" || !Number.isInteger(skipped) || skipped < 0 || skipped > total) return null;
    if (attempts + skipped !== total) return null;
    if (!validSpellingDay(v.day)) return null;
    const at = typeof v.at === "string" && !Number.isNaN(Date.parse(v.at)) ? v.at : null;
    return {day: v.day, total: total, attempts: attempts, correct: correct, skipped: skipped,
      mixed: v.mixed === true, at: at};
  }
  /**
   * 归一化每书拼写记录：缺字段/非对象 → 空白；各计数非负整数、correct<=attempts；
   * 单个非法子项只修该子项（不整份重置、不丢其它字段）；lastSession 结构非法 → null。
   */
  function normalizeSpellingState(v){
    const out = spellingEmpty();
    if (!isRecord(v)) return out;
    const int = (n, max) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;
    if (int(v.sessions, 100000)) out.sessions = v.sessions;
    if (int(v.attempts, SPELLING_COUNT_MAX)) out.attempts = v.attempts;
    if (int(v.correct, out.attempts)) out.correct = v.correct;
    if (int(v.skipped, SPELLING_COUNT_MAX)) out.skipped = v.skipped;
    if (validSpellingDay(v.lastDay)) out.lastDay = v.lastDay;
    out.lastSession = normalizeSpellingSession(v.lastSession);
    if (out.lastSession && !out.lastDay) out.lastDay = out.lastSession.day;
    return out;
  }
  /**
   * 跨标签合并：完成组数多（同组数比作答次数）的一方胜；不累加计数，避免同一组被重复记账。
   * 两边都没有记录时返回空白；only 用于 save()/storage 的辅助字段合并，不改学习字段语义。
   */
  function mergeSpellingState(local, incoming){
    const a = normalizeSpellingState(local);
    const b = normalizeSpellingState(incoming);
    if (b.sessions > a.sessions) return b;
    if (b.sessions < a.sessions) return a;
    if (b.attempts > a.attempts) return b;
    if (b.attempts < a.attempts) return a;
    const at = r => (r.lastSession && r.lastSession.at ? Date.parse(r.lastSession.at) : 0);
    return at(b) > at(a) ? b : a;
  }
  /** 当前书的当日加量；跨午夜即使轮询未刷新也按今天懒重置（不结转）。 */
  function extraDayLedger(){
    const today = todayStr();
    const rec = isRecord(S.extraDay) ? S.extraDay : null;
    const ok = rec && rec.d === today && typeof rec.extra === "number"
      && Number.isInteger(rec.extra) && rec.extra >= 0 && rec.extra <= EXTRA_NEW_TARGET_MAX;
    if (!ok) S.extraDay = {d: today, extra: 0};
    return S.extraDay;
  }
  function resetExtraDayForToday(){
    S.extraDay = {d: todayStr(), extra: 0};
    return S.extraDay;
  }
  function getExtraDay(){ const e = extraDayLedger(); return {d: e.d, extra: e.extra}; }
  /** 今日有效新词目标 = dailyNew + 临时加量（硬上限 500）；长期 dailyNew 不变。 */
  function effectiveNewTarget(){
    const plan = S.settings.dailyNew;
    return Math.min(EXTRA_NEW_TARGET_MAX, Math.max(1, plan + extraDayLedger().extra));
  }
  /** 钩子用的别名（读取今日有效新词目标）。 */
  function getEffectiveNewTarget(){ return effectiveNewTarget(); }
  /** 当前书/范围、排除熟练、尚未主学习过的新词数量（加量候选）。 */
  function extraCandidatesAvailable(){
    let n = 0;
    for (let i = 0; i < W.length; i++) {
      if (!inScope(i) || isProficient(i)) continue;
      if (!hasMainProgress(st(i))) n++;
    }
    return n;
  }
  /** 读取主记录里「今日」的 extra；读不到/损坏/不是今天 → null（用于多标签对齐）。 */
  function readStoredExtraSameDay(){
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === null) return null;
      const stored = JSON.parse(raw);
      const rec = stored && isRecord(stored.extraDay) ? stored.extraDay : null;
      if (!rec || rec.d !== todayStr()) return null;
      const extra = rec.extra;
      return (typeof extra === "number" && Number.isInteger(extra) && extra >= 0) ? extra : null;
    } catch (e) { return null; }
  }
  /** 校验单次授予量：1–100 整数；非法 → null。 */
  function normalizeExtraGrant(n){
    return (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= EXTRA_NEW_GRANT_MAX) ? n : null;
  }
  /**
   * 授予今日临时加量（完成页/暂停页/测试钩子共用）。返回
   * {ok, extra, effectiveTarget, available, granted?, clamped?, duplicate?, fromPause, error?}。
   *
   * 入口条件（23 提示词）：「今日计划内新词已学完」与「主组因复习预算用尽而暂停」是**并列**入口：
   * - 完成页（默认，opts 缺省/fromPause=false）：要求 day().n >= dailyNew（plan-not-finished 只属于此语义）；
   * - 暂停页（opts.fromPause=true）：不要求计划已完成，只校验数量、候选与 500 上限。
   * 连击/跨标签：提交中 extraGrantBusy 防重入；写前读主键对齐，若存储同日的 extra
   * 已比本页大（别的标签已完成同一动作）→ 只采纳不再叠加；写失败保留内存值。
   */
  function grantExtraNew(n, opts){
    const fromPause = !!(opts && opts.fromPause);
    const amount = normalizeExtraGrant(n);
    const learned = day().n;
    const plan = S.settings.dailyNew;
    const availableBefore = extraCandidatesAvailable();
    const snapshot = (ok, error, extraFields) => Object.assign({
      ok: !!ok, extra: extraDayLedger().extra, effectiveTarget: effectiveNewTarget(),
      available: extraCandidatesAvailable(), fromPause: fromPause, error: error || null
    }, extraFields || {});
    if (extraGrantBusy) return snapshot(false, "busy");
    if (amount === null) return snapshot(false, "invalid-amount");
    if (!fromPause && learned < plan) return snapshot(false, "plan-not-finished");
    if (availableBefore <= 0) return snapshot(false, "no-candidates");
    extraGrantBusy = true;
    let result;
    try {
      const ledger = extraDayLedger();
      const storedExtra = readStoredExtraSameDay();
      if (storedExtra !== null && storedExtra > ledger.extra) {
        // 另一个标签已完成这次加量提交：只同步结果，不重复叠加。
        ledger.extra = storedExtra;
        S.extraDay = normalizeExtraDay(ledger);
        save();
        result = snapshot(true, null, {duplicate: true, granted: 0});
      } else {
        const room = EXTRA_NEW_TARGET_MAX - plan - ledger.extra;
        const grant = Math.max(0, Math.min(amount, availableBefore, room));
        if (grant <= 0) {
          result = snapshot(false, "target-cap");
        } else {
          ledger.extra += grant;
          S.extraDay = normalizeExtraDay(ledger);
          save();
          // 截断原因要能区分：候选不够 vs 今日 500 词总目标上界（toast/hint 用）。
          const limitedBy = grant < amount
            ? (availableBefore <= room ? "candidates" : "target-cap") : null;
          result = snapshot(true, null, {granted: grant, clamped: grant < amount, limitedBy: limitedBy, duplicate: false});
        }
      }
    } finally { extraGrantBusy = false; }
    autoResumeCheckCache = null;   // 今日有效新词目标变化 → 自动续背候选重算
    renderExtraSurfaces();
    if (cur == null && !drillMode && !inSubgroup() && $("#v-study").classList.contains("on")) renderCard();
    return result;
  }
  /** 暂停页加量入口的专用别名：与 grantExtraNew(n, {fromPause:true}) 等价。 */
  function grantExtraNewFromPause(n){ return grantExtraNew(n, {fromPause: true}); }
  /** 授予失败的原因文案（UI/toast 用）。 */
  function extraGrantErrorText(error){
    return error === "plan-not-finished" ? "先完成今日计划内的新词，再加量"
      : error === "no-candidates" ? "当前范围没有可加的新词"
      : error === "target-cap" ? "今日新词目标已达 500 上界，不能再加"
      : error === "busy" ? "正在提交上一次加量，请稍候"
      : "加量数量需为 1–100 的整数";
  }

  /* ================= 大版本首批：只读学习呈现与统一动作 =================
   * 本块不接管原按钮/键位，不保存新状态。呈现模型只读，命令委托既有业务入口。
   * 预算暂停仍由当前卡与今日台账派生；原 grantExtraNew 继续只负责授予。 */
  const STUDY_ACTION_LABELS = {
    know: "会", dont: "不会", next: "下一个", speak:"发音", star:"收藏", proficient:"熟练", undo:"撤销", listSearch:"词表搜索", continue: "继续下一组",
    wait: "开始等待到期", enableWait: "启用便捷并在本页等待", stopWait: "退出本页等待",
    return: "返回原组", addExtraAndStudy: "加量并学习", restoreAuto: "恢复今天自动续背", pauseAuto: "今天暂停自动续背"
  };
  let extraStudyBusy = false;
  function studyActionBlockedBy(event,action,source){
    source=source || (event?.type==="keydown"?"keyboard":event?.type?.startsWith("pointer")?"gesture":event?"button":"program");
    if (event && (event.repeat || event.isComposing || event.defaultPrevented || event.keyCode===229
      || event.key==="Dead" || event.key==="Unidentified" || event.getModifierState?.("AltGraph"))) return "input-event";
    if (event && (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName || "") || event.target?.isContentEditable)) return "text-input";
    if(["keyboard","gesture"].includes(source) && Boolean(window.getSelection?.()?.toString()))return "selection";
    if (!$("#v-study")?.classList.contains("on")) return "not-study";
    if (document.visibilityState === "hidden") return "hidden";
    if (activeSheet) return "sheet";
    if ($("#exPop") && !$("#exPop").hidden) return "lookup";
    // 保存失败时仍允许本页手动回忆/改判/撤销；只有开组与授予/等待要求先处理持续错误。
    if (["continue","wait","enableWait","addExtraAndStudy"].includes(action) && $("#appAlert") && !$("#appAlert").hidden) return "alert";
    return null;
  }
  /** 只读暂停状态：不初始化/改写缓存，失败读时保留本页已知值与未落盘操作。 */
  function studyPresentationPausedToday(){
    if (autoResumePausePending.has(currentBookId)) return autoResumePausePending.get(currentBookId) === todayStr();
    try {
      const raw = JSON.parse(localStorage.getItem(AUTO_RESUME_PAUSE_KEY) || "null");
      return !!(raw && raw[currentBookId] === todayStr());
    } catch (e) { return autoResumePauseStore.map[currentBookId] === todayStr(); }
  }
  /** 候选唯一只读口径：不建立日记录/台账，不排序抽样或写缓存；开组仍按原业务复核。 */
  function readOnlyCandidateStats(now = Date.now()){
    now = now || Date.now();
    let dueTotal = 0, freshPoolCount = 0;
    for (let i = 0; i < W.length; i++) {
      if (!inScope(i) || isProficient(i)) continue;
      const p = st(i);
      if (!hasMainProgress(p)) freshPoolCount++;
      else if (p[0] < MASTER && p[1] <= now) dueTotal++;
    }
    const cap = getReviewCap();
    let used = normalizeReviewDay(S.reviewDay).used;
    if (cap > 0) {
      try {
        const raw = localStorage.getItem(KEY);
        // 显式重置/导入的新一代不能和旧现场台账取大；等待命令入口权威同步。
        if (raw && replacementToken(raw) === replacementToken(lastMainRaw)) used = Math.max(used, normalizeReviewDay(JSON.parse(raw).reviewDay).used);
      } catch (e) { /* 只读保留已知预算；启动/判定沿用原有安全门控 */ }
    }
    const capLeft = cap === 0 ? Infinity : Math.max(0, cap - used);
    const groupSize = Math.max(GROUP_SIZE_MIN, Math.min(GROUP_SIZE_MAX,
      Number.isInteger(S.settings.groupSize) ? S.settings.groupSize : GROUP_SIZE_DEFAULT));
    const extra = normalizeExtraDay(S.extraDay), learned = (S.days[todayStr()] || {}).n || 0;
    const quota = Math.max(0, Math.min(EXTRA_NEW_TARGET_MAX, S.settings.dailyNew + extra.extra) - learned);
    const plannedDue = Math.min(groupSize, dueTotal);
    const dueActive = cap === 0 ? plannedDue : Math.min(plannedDue, capLeft);
    const backlogGuarded = !!S.settings.backlogGuard && cap > 0 && dueTotal > capLeft;
    const fresh = backlogGuarded ? 0 : Math.min(quota, freshPoolCount);
    const freshActive = Math.min(Math.max(0, groupSize - plannedDue), fresh);
    const capPausedNow = cap > 0 && capLeft <= 0 && dueTotal > 0;
    return {available: capPausedNow ? 0 : dueActive + freshActive,
      due: dueTotal, dueActive, fresh, freshActive, quota, groupSize, cap,
      capLeft: capLeft === Infinity ? null : capLeft, backlogGuarded, capPaused: capPausedNow};
  }
  function deriveStudyPresentation(){
    const mode = drillMode ? "drill" : extraSubgroup ? "extra" : newOnlySubgroup ? "newOnly" : "main";
    const candidates = readOnlyCandidateStats();
    const capPausedNow = !drillMode && cur != null && verdict === null && hasMainProgress(st(cur)) && candidates.cap > 0 && candidates.capLeft <= 0;
    const waiting = emptyWaitActive(), empty = emptyMainPage(), paused = studyPresentationPausedToday();
    const ar = currentAutoResume(), blockedBy = studyActionBlockedBy();
    const state = capPausedNow ? "cap" : drillMode ? "drill" : inSubgroup() ? "subgroup"
      : cur != null ? phase : waiting ? "wait" : empty ? "empty" : "done";
    const canReturn = drillMode || inSubgroup() || (autoResumeReturnArmed && autoResumeReturnSnap && answered === 0);
    const returnLabel = drillMode ? "退出特训" : inSubgroup() ? "返回原组" : autoResumeReturnFromWait ? "返回等待页" : "返回上一组结果";
    const learned = (S.days[todayStr()] || {}).n || 0, extra = normalizeExtraDay(S.extraDay);
    let extraReason = "context";
    if (mode === "main" && (capPausedNow || (cur == null && !capGroupEnded))) {
      const pending = capPausedNow ? new Set(Q.slice(qi)) : new Set();
      let reserved = 0, available = extraCandidatesAvailable();
      for (const i of pending) if (!hasMainProgress(st(i))) {
        reserved++;
        if (inScope(i) && !isProficient(i)) available--;
      }
      const target = Math.min(EXTRA_NEW_TARGET_MAX, S.settings.dailyNew + extra.extra);
      const reusableExtra = extra.extra > 0 && target > learned + reserved;
      extraReason = available <= 0 ? "no-candidates" : !capPausedNow && candidates.capPaused ? "review-cap"
        : reusableExtra ? "" : !capPausedNow && learned < S.settings.dailyNew ? "plan-not-finished"
        : target >= EXTRA_NEW_TARGET_MAX ? "target-cap" : "";
    }
    const candidateReason = candidates.available > 0 ? "" : candidates.capPaused ? "review-cap"
      : candidates.backlogGuarded ? "backlog" : candidates.quota <= 0 ? "new-quota" : "no-candidates";
    const allowed = {
      know: cur != null && !capPausedNow, dont: cur != null && !capPausedNow,
      next: cur != null && phase === "revealed", speak:cur!=null, star:cur!=null, proficient:cur!=null,
      undo:undoStack.length>0, listSearch:true,
      continue: cur == null && mode === "main" && candidates.available > 0,
      wait: empty && !waiting && ar.enabled && !paused && storageOK && !autoResumeStorageError,
      enableWait: empty && !waiting && !ar.enabled && !paused && storageOK && !autoResumeStorageError,
      stopWait: waiting, return: !!canReturn,
      addExtraAndStudy: extraReason === "",
      restoreAuto: mode === "main" && ar.enabled && paused,
      pauseAuto: mode === "main" && cur == null && ar.enabled && !paused
    };
    const preferredAction = cur != null ? (phase === "revealed" ? "next" : capPausedNow && canReturn ? "return" : null)
      : canReturn ? "return" : waiting ? "stopWait" : candidates.available > 0 ? "continue"
        : empty ? (paused && ar.enabled ? "restoreAuto" : ar.enabled ? "wait" : "enableWait") : "continue";
    const actions=Object.entries(STUDY_ACTION_LABELS).map(([id,label])=>{
      const actionBlock=studyActionBlockedBy(null,id);
      return {id,label:id==="return"?returnLabel:label,enabled:!actionBlock && !!allowed[id],
        reason:actionBlock || (allowed[id]?"":id==="addExtraAndStudy"?extraReason
          :id==="continue" && cur==null && mode==="main"?candidateReason:"context")};
    });
    const primaryAction=actions.find(a=>a.id===preferredAction && a.enabled)?.id || null;
    return {
      state,mode,phase,reason:blockedBy || (capPausedNow?"review-cap":capGroupEnded?"cap-ended":paused?"auto-paused"
        :cur==null && mode==="main"?candidateReason:""),
      blockedBy,primaryAction,returnAction:canReturn?"return":null,candidates,actions
    };
  }
  /** 单命令先用尚未学习的加量额度；失败重试/跨标签已授予不再追加。 */
  function addExtraAndStudy(n, options = {}){
    let granted = 0, reused = false, fromPause = false, available = 0;
    const result = (ok, error = null, started = false) => ({ok, error, started, granted, reused,
      mode: fromPause ? "extra" : "main", available, actual: started ? Q.length : 0,
      extra: normalizeExtraDay(S.extraDay).extra, amount: n});
    if (normalizeExtraGrant(n) === null) return result(false, "invalid-amount");
    const blocked = studyActionBlockedBy(options.event,"addExtraAndStudy",options.source);
    if (blocked) return result(false, blocked);
    if (extraStudyBusy) return result(false, "busy");
    let view = deriveStudyPresentation();
    const eligibility = view.actions.find(action => action.id === "addExtraAndStudy");
    if (!eligibility?.enabled) return result(false, eligibility?.reason || "context");
    extraStudyBusy = true;
    try {
      // 保存失败的授予可能只在内存：先重试保存，不能直接刷新丢掉它。
      if (!storageOK && !save()) return result(false, "storage");
      fromPause = view.state === "cap";
      if (fromPause) {
        if (!save()) return result(false, "storage");
        alignReviewLedgerFromStorage();
      } else if (!refreshSharedBeforeNextGroup()) return result(false, "storage");
      view = deriveStudyPresentation();
      if (view.mode !== "main" || (cur != null && view.state !== "cap") || capGroupEnded) return result(false, "context");
      fromPause = view.state === "cap";
      const pending = fromPause ? new Set(Q.slice(qi)) : new Set();
      let reserved = 0;
      for (const i of pending) if (!hasMainProgress(st(i))) reserved++;
      for (let i = 0; i < W.length; i++) if (inScope(i) && !isProficient(i) && !hasMainProgress(st(i)) && !pending.has(i)) available++;
      if (!available) return result(false, "no-candidates");
      if (!fromPause && candidateStatsNow().capPaused) return result(false, "review-cap");
      const extra = normalizeExtraDay(S.extraDay), learned = (S.days[todayStr()] || {}).n || 0;
      const remaining = Math.max(0, Math.min(EXTRA_NEW_TARGET_MAX, S.settings.dailyNew + extra.extra) - learned - reserved);
      reused = extra.extra > 0 && remaining > 0;
      if (!reused) {
        const generation = replacementToken(lastMainRaw);
        const grant = grantExtraNew(Math.min(n, available), {fromPause});
        if (!grant.ok) return result(false, grant.error);
        granted = grant.granted || 0; reused = !!grant.duplicate;
        if (!storageOK) return result(false, "storage");
        if (replacementToken(lastMainRaw) !== generation || (cur != null && !fromPause)) return result(false, "shared-change");
      }
      const started = fromPause ? startExtraSubgroup() : continueMainSession();
      return result(!!started, started ? null : "unavailable", !!started);
    } finally { extraStudyBusy = false; }
  }
  function runStudyAction(action, options = {}){
    const outcome = (ok, error = null, started = false) => ({ok, action, error, started});
    if (!Object.prototype.hasOwnProperty.call(STUDY_ACTION_LABELS, action)) return outcome(false, "unknown-action");
    const blocked = studyActionBlockedBy(options.event,action,options.source);
    if (blocked) return outcome(false, blocked);
    if(action==="next" && cur!=null && phase!=="revealed"){tryNext(true);return outcome(false,"recall-gate");}
    if(["know","dont"].includes(action) && cur!=null && computeCapPaused()){judge(action==="know");return outcome(false,"review-cap");}
    if(options.source!=="gesture" && verdict!==null && ["know","dont","next","undo","proficient"].includes(action)
      && swallowJudgeDoubleClick(options.event))return outcome(false,"duplicate-pointer");
    const descriptor = deriveStudyPresentation().actions.find(item => item.id === action);
    if (!descriptor?.enabled) return outcome(false, descriptor?.reason || "context");
    if (action === "addExtraAndStudy") return Object.assign({action}, addExtraAndStudy(options.amount, options));
    if (["know", "dont", "next"].includes(action)) {
      if (action === "next") { tryNext(true); return outcome(true); }
      const known = action === "know";
      if (verdict === known) return outcome(false, "no-change");
      if(verdict===null)markJudgeGesture(options.source==="gesture"?null:options.event);
      judge(known);return outcome(verdict===known,verdict===known?null:"unavailable");
    }
    if(action==="speak"){speak(W[cur].w);return outcome(true);}
    if(action==="star"){const i=cur;toggleStar(i);renderCard();toast(isStar(i)?"已收藏":"已取消收藏");return outcome(true);}
    if(action==="proficient"){const i=cur;setProficient(i,true);return outcome(isProficient(i));}
    if(action==="undo"){undo();return outcome(true);}
    if(action==="listSearch"){show("list");$("#q")?.focus?.();return outcome(true);}
    if (action === "continue") { const started = continueMainSession(); return outcome(started, started ? null : "unavailable", started); }
    if (action === "return") {
      if (!save()) return outcome(false, "storage");
      if (!deriveStudyPresentation().returnAction) return outcome(false, "context");
      const ok = drillMode ? exitDrill() : inSubgroup() ? endActiveSubgroup() : returnToPreviousResults();
      return outcome(ok, ok ? null : "unavailable");
    }
    if (action === "enableWait") {
      const updated = applyAutoResumePreset("quick");
      if (!updated.ok || !storageOK) return outcome(false, "storage");
    }
    if (action === "wait" || action === "enableWait") { const ok = startEmptyWait(); return outcome(ok, ok ? null : "unavailable"); }
    if (action === "stopWait") return outcome(stopEmptyWait());
    if (action === "restoreAuto") return outcome(restoreAutoResumeToday());
    if (action === "pauseAuto") { pauseAutoResumeToday(); return outcome(true); }
    return outcome(false, "unknown-action");
  }


  /**
   * 乱序模式下新词按随机顺序出现，每张首次作答的新词卡相当于一次随机抽查：
   * 答「会」记为已掌握、答「不会」记为未掌握，用样本比例估计当前背诵范围的掌握率。
   * 样本按单词文本存储（不随词库数组顺序/数据版本迁移），每本书独立。
   */
  function wilsonInterval(k, n, z){
    z = z || 1.96;
    if (!(n > 0)) return {rate: 0, lo: 0, hi: 0};
    const p = k / n, z2 = z * z;
    const denom = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denom;
    const half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom;
    return {rate: p, lo: Math.max(0, center - half), hi: Math.min(1, center + half)};
  }
  /** 读取某本书的抽样记录；词库已清理的旧词直接忽略，损坏记录按空样本处理。 */
  function readSurvey(book){
    const out = {};
    try {
      const raw = localStorage.getItem(book.SURVEY_KEY);
      if (!raw) return out;
      const o = JSON.parse(raw);
      if (!isRecord(o)) return out;
      for (const [w, v] of Object.entries(o)) {
        if (typeof w !== "string" || !book.wordIndex.has(w)) continue;
        if (v === 1 || v === true) out[w] = 1;
        else if (v === 0 || v === false) out[w] = 0;
      }
    } catch (e) { /* 抽样记录损坏不影响主进度 */ }
    return out;
  }
  function loadSurvey(){
    SURVEY = readSurvey(currentBook());
    lastSurvey = Object.assign({}, SURVEY);
  }
  function saveSurvey(){
    try {
      // storage 事件可能尚未送达；只写本标签修改过的词，保留其它标签的新样本。
      const merged = readSurvey(currentBook());
      for (const w of new Set([...Object.keys(lastSurvey), ...Object.keys(SURVEY)])) {
        if (SURVEY[w] === lastSurvey[w]) continue;
        if (Object.prototype.hasOwnProperty.call(SURVEY, w)) merged[w] = SURVEY[w];
        else delete merged[w];
      }
      localStorage.setItem(SURVEY_KEY, JSON.stringify(merged));
      SURVEY = merged;
      lastSurvey = Object.assign({}, merged);
      return true;
    }
    catch (e) { return false; }
  }
  function surveyStats(){
    let n = 0, k = 0;
    for (const [w, v] of Object.entries(SURVEY)) {
      if (!wordIndex.has(w)) continue;
      n++;
      if (v) k++;
    }
    const ci = wilsonInterval(k, n);
    return {n: n, k: k, missed: n - k, rate: ci.rate, lo: ci.lo, hi: ci.hi,
      margin: (ci.hi - ci.lo) / 2};
  }
  function surveyPct(x){ return Math.round(x * 100) + "%"; }
  /** 只统计乱序模式下第一次出现的词；复习/特训/其它顺序都不计入，避免抽样偏差。 */
  function recordSurvey(i, known){
    if (drillMode || S.settings.order !== "shuffle") return false;
    const w = W[i] && W[i].w;
    if (!w || !wordIndex.has(w)) return false;
    const next = known ? 1 : 0;
    if (SURVEY[w] === next) return false;
    SURVEY[w] = next;
    saveSurvey();
    return true;
  }
  function resetSurvey(){
    SURVEY = {};
    lastSurvey = {};
    try { localStorage.removeItem(SURVEY_KEY); } catch (e) { /* ignore */ }
    renderSurvey();
  }
  /** 统计条 chip（仅乱序模式显示）与统计页面板共用同一份实时估计。 */
  function renderSurvey(){
    const stats = surveyStats();
    const show = S.settings.order === "shuffle";
    const chip = $("#surveyChip");
    if (chip) {
      chip.hidden = !show;
      if (show) {
        const val = $("#s-survey"), ci = $("#s-survey-ci"), nEl = $("#s-survey-n");
        if (val) val.textContent = stats.n ? surveyPct(stats.rate) : "—";
        if (ci) ci.textContent = stats.n ? "95% 区间 " + surveyPct(stats.lo) + "–" + surveyPct(stats.hi) : "";
        // 09：紧凑保留样本量；长解释放在 #surveyDetail（可展开），不挤占统计条。
        if (nEl) nEl.textContent = stats.n ? "样本 " + stats.n : "";
        chip.title = stats.n
          ? "历史首次自评样本：已记录 " + stats.n + " 词（首次就会 " + stats.k + " / 不会 " + stats.missed +
            "）；95% 置信区间 " + surveyPct(stats.lo) + "–" + surveyPct(stats.hi) +
            "。只含各次乱序学习中首次作答的新词，筛选范围可能已经变化，不代表当前范围或全书掌握率。"
          : "乱序模式下首次作答的新词会留下自评样本；这里展示历史样本的描述性统计，不代表全书掌握率。";
      }
    }
    const detail = $("#surveyDetail");
    if (detail) {
      detail.hidden = !show;
      if (!show) detail.open = false;
    }
    markStatsDetailEmpty("#surveyKpis", stats.n === 0);
    const kpis = $("#surveyKpis");
    if (kpis) {
      kpis.innerHTML = stats.n
        ? [[surveyPct(stats.rate), "历史首次就会"],
           [surveyPct(stats.lo) + "–" + surveyPct(stats.hi), "95% 置信区间"],
           [stats.n + " 词", "历史样本"]]
            .map(([a, b]) => '<div class="kpi"><b>' + a + "</b><span>" + b + "</span></div>").join("")
        : '<div class="kpi"><b>—</b><span>还没有历史样本</span></div>';
    }
    const gauge = $("#surveyGauge");
    if (gauge) {
      const axis = '<div class="sg-axis"><span>0%</span><span>50%</span><span>100%</span></div>';
      gauge.innerHTML = stats.n
        ? axis +
          '<div class="sg-track" role="img" aria-label="历史首次自评比例 ' + surveyPct(stats.rate) +
            "，95% 置信区间 " + surveyPct(stats.lo) + " 到 " + surveyPct(stats.hi) + '">' +
            '<i class="sg-band" style="left:' + (stats.lo * 100) + "%;width:" + ((stats.hi - stats.lo) * 100) + '%"></i>' +
            '<b class="sg-dot" style="left:clamp(6px,' + (stats.rate * 100) + '%,calc(100% - 6px))"></b>' +
          "</div>" +
          '<div class="sg-note">实心点 = 样本估计 · 色带 = 95% 置信区间</div>'
        : axis + '<div class="sg-track sg-empty"></div><div class="sg-note">还没有样本可绘制区间</div>';
    }
    const hint = $("#surveyHint");
    if (hint) {
      const mode = S.settings.order === "shuffle";
      hint.textContent = !stats.n
        ? (mode
            ? "乱序模式首次作答的新词会留下自评样本。这里只描述你实际抽到过的词，样本范围随当时筛选变化，不代表当前范围或全书掌握率。"
            : "当前不是乱序模式。切到「乱序」后，首次作答的新词才会留下历史自评样本。")
        : (!mode
            ? "历史样本：" + stats.n + " 词，其中 " + stats.k + " 词首次就会。当前不是乱序模式，样本不再增加；切回「乱序」可继续累计。"
            : "历史样本：" + stats.n + " 词，其中 " + stats.k + " 词首次就会、" + stats.missed +
              " 词不会。这些词来自不同时间的乱序筛选，不能外推为当前范围或全书掌握率；复习与错词特训不计入。");
    }
  }

  /** 最近一次「标为熟练」的反馈对象，仅用于短暂浮动确认，不进入学习记录。 */
  let profMark = null;
  const PROF_FEEDBACK_MS = 6000;
  let profFeedbackTarget = null, profFeedbackTimer = null, profFeedbackDeadline = 0;
  let profFeedbackRemaining = PROF_FEEDBACK_MS;
  const profFeedbackPauses = new Set();
  function dismissProfFeedback(){
    clearTimeout(profFeedbackTimer);
    profFeedbackTimer = null;
    profFeedbackTarget = null;
    profFeedbackPauses.clear();
    profMark = null;
    const box = $("#profFeedback");
    if (box) box.hidden = true;
  }
  function scheduleProfFeedback(){
    clearTimeout(profFeedbackTimer);
    if (!profMark || profFeedbackPauses.size) return;
    profFeedbackDeadline = Date.now() + profFeedbackRemaining;
    profFeedbackTimer = setTimeout(dismissProfFeedback, profFeedbackRemaining);
  }
  function pauseProfFeedback(reason){
    if (!profMark || profFeedbackPauses.has(reason)) return;
    if (!profFeedbackPauses.size) {
      profFeedbackRemaining = Math.max(1200, profFeedbackDeadline - Date.now());
      clearTimeout(profFeedbackTimer);
    }
    profFeedbackPauses.add(reason);
  }
  function resumeProfFeedback(reason){
    if (!profFeedbackPauses.delete(reason) || profFeedbackPauses.size) return;
    scheduleProfFeedback();
  }
  /** A manual, permanent exclusion, independent of the spaced-repetition stage. */
  function setProficient(i, value){
    if (storageOK) { try { syncProficientFromStorage(); } catch (e) {} }
    if (!W[i] || isProficient(i) === !!value) return;
    // 15：熟练名单变化 → 旧会话现场不可安全恢复，丢弃临时快照（主记录优先）。
    clearSessionSnapshot(currentBookId);
    const word = W[i].w;
    if (value) {
      profMark = { bookId: currentBookId, i: i, w: word };
      S.proficient[word] = Date.now();
      markProfPending(currentBookId, word, true, S.proficient[word]);
      if (cur === i && phase === "revealed") qi++;
      Q = Q.slice(0, qi).concat(Q.slice(qi).filter(k => k !== i));
      undoStack = [];
      // 主会话在特训期间暂停；其旧撤销记录同样不能再指向已熟练的词。
      if (mainSnap) mainSnap.undoStack = [];
      if (cur === i) nextCard();
    } else {
      if (profMark && profMark.i === i && profMark.bookId === currentBookId) profMark = null;
      delete S.proficient[word];
      markProfPending(currentBookId, word, false);
      // Keep its previous review schedule. The next session will include it when due.
      undoStack = [];
    }
    const saved = save(true);
    renderCard(); updateScopeCount(); syncFreqControls(); applyFilter(false); renderStats(); updateBar();
    renderProfFeedback();
    // 成功标记由可取消的浮动确认说明，避免同时叠加普通 toast；保存失败沿用错误提示。
    if (!saved || !value) toast(saved ? "已取消熟练，下组将按原进度安排学习"
      : "熟练状态已更新，但未能保存；请立即导出进度备份");
  }
  function resetProficient(){
    clearSessionSnapshot(currentBookId);
    for (const word of Object.keys(S.proficient)) markProfPending(currentBookId, word, false);
    S.proficient = {};
    profMark = null;
    const saved = save(true);
    startSession(); updateScopeCount(); syncFreqControls(); applyFilter(); renderStats(); updateBar();
    renderProfFeedback();
    toast(saved ? "已清空熟练标记，按原进度恢复学习" : "已清空熟练标记，但未能保存；请导出备份");
  }
  /**
   * 熟练反馈的「取消熟练」入口：复用正式取消逻辑 setProficient(i,false)。
   * 容器/按钮由 index.html 静态提供（#profFeedback / #profFeedbackText / #btnUnMaster），
   * 固定浮动、不占卡片网格行；6 秒后收起，悬停/键盘聚焦时暂停计时。
   * 收起只清反馈，熟练标记保留；之后仍可从词表「熟练」中取消。
   */
  function renderProfFeedback(){
    const box = $("#profFeedback");
    if (!box) { dismissProfFeedback(); return; }
    const text = $("#profFeedbackText"), btn = $("#btnUnMaster");
    const mark = profMark;
    const valid = !!(mark && mark.bookId === currentBookId && W[mark.i]
      && W[mark.i].w === mark.w && isProficient(mark.i));
    if (!valid) {
      dismissProfFeedback();
      if (text) text.textContent = "";
      return;
    }
    if (profFeedbackTarget !== mark) {
      profFeedbackTarget = mark;
      // 静态取消按钮/浮层节点不会随目标换词而重建，因此不会再次触发 focusin/pointerenter。
      // 以真实焦点/悬停重建暂停原因，既保留正在使用的入口，也不继承已离开的旧原因。
      const focused = !!box.contains?.(document.activeElement);
      const hovered = typeof box.matches === "function" ? box.matches(":hover") : profFeedbackPauses.has("hover");
      profFeedbackPauses.clear();
      if (focused) profFeedbackPauses.add("focus");
      if (hovered) profFeedbackPauses.add("hover");
      profFeedbackRemaining = PROF_FEEDBACK_MS;
      scheduleProfFeedback();
    }
    if (text) text.textContent = "「" + mark.w + "」已移出学习队列";
    box.hidden = false;
    if (btn && !btn.__unMasterBound) {
      btn.__unMasterBound = true;
      btn.onclick = () => {
        const target = profMark;
        if (!target || target.bookId !== currentBookId) return;
        dismissProfFeedback();
        setProficient(target.i, false);
        renderProfFeedback();
        $("#card")?.focus?.({ preventScroll: true });
      };
    }
    if (!box.__profFeedbackBound) {
      box.__profFeedbackBound = true;
      box.addEventListener("pointerenter", () => pauseProfFeedback("hover"));
      box.addEventListener("pointerleave", () => resumeProfFeedback("hover"));
      box.addEventListener("focusin", () => pauseProfFeedback("focus"));
      box.addEventListener("focusout", e => {
        if (!box.contains?.(e.relatedTarget)) resumeProfFeedback("focus");
      });
      const close = $("#profFeedbackDismiss");
      if (close) close.onclick = () => {
        dismissProfFeedback();
        $("#card")?.focus?.({preventScroll: true});
      };
    }
  }

  /* ================= DOM ================= */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  }

  /* ---- 可选读音层：按词键控，词性 ↔ 读音对应（不改词库 11 元组、不新增请求） ---- */
  /**
   * 多词性异读词。词库 ph 只保留一个主读音；这里按词性列出其余读音，
   * 渲染时每个读音各自加斜线并标注词性。没有词条的词完全回退原 /ph/ 输出。
   * 仅收已核对读音的词；新增请保持 pos 短标签 + 不带斜线的 IPA。
   */
  const WORD_PRON_VARIANTS = {
    use: [{ pos: "动", ipa: "juːz" }, { pos: "名", ipa: "juːs" }],
    minute: [{ pos: "名", ipa: "ˈminit" }, { pos: "形", ipa: "maɪˈnjuːt" }],
    contract: [{ pos: "名", ipa: "ˈkɒntrækt" }, { pos: "动", ipa: "kənˈtrækt" }],
    // 释义同时收了名/动两义但读音不同：铅 /led/、反对 /əbˈdʒekt/。
    lead: [{ pos: "动", ipa: "liːd" }, { pos: "名", ipa: "led" }],
    object: [{ pos: "名", ipa: "ˈɒbdʒekt" }, { pos: "动", ipa: "əbˈdʒekt" }]
  };
  /** 词的读音清单（非法/缺失返回 null）；返回副本，调用方不能改内置数据。 */
  function wordPronVariants(word){
    const key = String(word == null ? "" : word).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(WORD_PRON_VARIANTS, key)) return null;
    const list = WORD_PRON_VARIANTS[key];
    if (!Array.isArray(list)) return null;
    const out = [];
    for (const item of list) {
      if (!item || typeof item.ipa !== "string" || !item.ipa.trim()) continue;
      out.push({ pos: typeof item.pos === "string" ? item.pos.trim() : "", ipa: item.ipa.trim() });
    }
    return out.length ? out : null;
  }
  /**
   * 词头音标文本（已转义、自带斜线）。有读音清单时逐个输出「词性 /ipa/」；
   * 无词条/无 ph 时返回空串；无读音清单时与原输出逐字节一致。
   */
  function pronHtml(x){
    const variants = wordPronVariants(x && x.w);
    if (variants) {
      return variants.map(v => (v.pos ? esc(v.pos) + " " : "") + "/" + esc(v.ipa) + "/").join(" · ");
    }
    return x && x.ph ? "/" + esc(x.ph) + "/" : "";
  }

  /* ================= 例句点词查义 ================= */
  /** 例句切成「英文词 / 其它」片段，英文词可点击 */
  function exTokens(text){
    return String(text == null ? "" : text)
      .split(/([A-Za-z]+(?:['’][A-Za-z]+)*)/g)
      .filter(s => s !== "");
  }
  /**
   * 常见不规则屈折（fm 缺失时的兜底）：只收明显属于同一个词的形式，
   * 不把任意派生词/专名当作目标词高亮。
   */
  const IRREGULAR_FORMS = {
    medium: ["media"], alumnus: ["alumni"],
    curriculum: ["curricula"], criterion: ["criteria"], phenomenon: ["phenomena"],
    datum: ["data"], bacterium: ["bacteria"], stimulus: ["stimuli"],
    nucleus: ["nuclei"], radius: ["radii"], analysis: ["analyses"],
    crisis: ["crises"], thesis: ["theses"], basis: ["bases"], axis: ["axes"],
    index: ["indices"], matrix: ["matrices"], vertex: ["vertices"],
    appendix: ["appendices"], formula: ["formulae"], vertebra: ["vertebrae"],
    maximum: ["maxima"], minimum: ["minima"], optimum: ["optima"]
  };
  const IRREGULAR_VERB_FORMS = {
    be: ["been", "being"], have: ["has", "had", "having"],
    do: ["does", "did", "done", "doing"], go: ["goes", "went", "gone", "going"],
    take: ["took", "taken"], come: ["came"], see: ["saw", "seen"], know: ["knew", "known"],
    get: ["got", "gotten"], give: ["gave", "given"], find: ["found"], think: ["thought"],
    tell: ["told"], become: ["became"], show: ["showed", "shown"], leave: ["left"],
    feel: ["felt"], put: ["put"], bring: ["brought"], begin: ["began", "begun"],
    keep: ["kept"], hold: ["held"], write: ["wrote", "written"], stand: ["stood"],
    hear: ["heard"], let: ["let"], mean: ["meant"], set: ["set"], meet: ["met"],
    run: ["ran"], pay: ["paid"], sit: ["sat"], speak: ["spoke", "spoken"],
    lie: ["lay", "lain"], lead: ["led"], read: ["read"], grow: ["grew", "grown"],
    lose: ["lost"], fall: ["fell", "fallen"], send: ["sent"], build: ["built"],
    understand: ["understood"], draw: ["drew", "drawn"], break: ["broke", "broken"],
    spend: ["spent"], cut: ["cut"], rise: ["rose", "risen"], drive: ["drove", "driven"],
    buy: ["bought"], wear: ["wore", "worn"], choose: ["chose", "chosen"],
    eat: ["ate", "eaten"], sing: ["sang", "sung"], swim: ["swam", "swum"],
    throw: ["threw", "thrown"], catch: ["caught"], teach: ["taught"], fight: ["fought"],
    seek: ["sought"], sell: ["sold"], shoot: ["shot"], steal: ["stole", "stolen"],
    strike: ["struck"], fly: ["flew", "flown"], forget: ["forgot", "forgotten"],
    forgive: ["forgave", "forgiven"], freeze: ["froze", "frozen"], hide: ["hid", "hidden"],
    hit: ["hit"], hurt: ["hurt"], mistake: ["mistook", "mistaken"],
    ride: ["rode", "ridden"], ring: ["rang", "rung"], shake: ["shook", "shaken"],
    shut: ["shut"], sink: ["sank", "sunk"], sleep: ["slept"], slide: ["slid"],
    smell: ["smelt", "smelled"], spell: ["spelt", "spelled"], spill: ["spilt", "spilled"],
    split: ["split"], spread: ["spread"], spring: ["sprang", "sprung"],
    stick: ["stuck"], sting: ["stung"], sweep: ["swept"], swell: ["swelled", "swollen"],
    tear: ["tore", "torn"], wake: ["woke", "woken"], wind: ["wound"], win: ["won"],
    bite: ["bit", "bitten"], blow: ["blew", "blown"], feed: ["fed"], flee: ["fled"],
    forbid: ["forbade", "forbidden"], grind: ["ground"], kneel: ["knelt", "kneeled"],
    lay: ["laid"], light: ["lit", "lighted"], overhear: ["overheard"],
    rebuild: ["rebuilt"], repay: ["repaid"], rethink: ["rethought"], rewrite: ["rewrote", "rewritten"],
    sew: ["sewed", "sewn"], sow: ["sowed", "sown"], speed: ["sped", "speeded"],
    spin: ["spun"], spit: ["spat", "spit"], spoil: ["spoilt", "spoiled"],
    weave: ["wove", "woven"], weep: ["wept"], dig: ["dug"], hang: ["hung"],
    learn: ["learnt", "learned"], dream: ["dreamt", "dreamed"],
    burn: ["burnt", "burned"], leap: ["leapt", "leaped"], prove: ["proven"],
    shine: ["shone", "shined"], unlearn: ["unlearnt", "unlearned"]
  };
  const VOWELS = "aeiou";
  /** 判断词尾是否为「辅音+元音+辅音」，用于 hopped/hopping 一类双写。 */
  function cvcEnding(word){
    if (word.length < 3) return false;
    const n = word.length;
    return !VOWELS.includes(word[n - 3]) && VOWELS.includes(word[n - 2])
      && !VOWELS.includes(word[n - 1]) && !/[wxy]/.test(word[n - 1]);
  }
  /** 按词性生成保守的规则屈折；不生成任意派生词。 */
  function regularInflections(base, pos, fm){
    const forms = new Set();
    if (!/^[a-z]+$/.test(base)) return forms;
    const last = base[base.length - 1];
    // 双写规则存在歧义：star→starred 而 stare→stared。若 base+"e" 本身是词库
    // 中的另一个词，就不再生成星号式单写形式，避免把 stared 标成 star。
    let eCollision = false;
    try {
      // 用四本书的并集判断，保证同一词条在不同词书里的高亮结果一致。
      eCollision = Object.keys(BOOKS).some(id => BOOKS[id] && BOOKS[id].wordIndex.has(base + "e"));
    } catch (e) { eCollision = false; }
    // 复数 / 第三人称单数
    if (/(s|x|z|ch|sh)$/.test(base)) forms.add(base + "es");
    else if (/[^aeiou]y$/.test(base)) forms.add(base.slice(0, -1) + "ies");
    else if (base.endsWith("o")) { forms.add(base + "s"); forms.add(base + "es"); }
    else forms.add(base + "s");
    // 未知词性时也补动词形式（真实词条均有词性）；但不做比较级猜测。
    const verb = pos === 1 || pos === undefined || /过去式|过去分词|现在分词|第三人称单数/.test(fm);
    if (verb) {
      if (base.endsWith("e")) forms.add(base + "d");
      else if (/[^aeiou]y$/.test(base)) forms.add(base.slice(0, -1) + "ied");
      else if (cvcEnding(base)) {
        forms.add(base + last + "ed");
        if (!eCollision) forms.add(base + "ed");
      } else forms.add(base + "ed");
      if (base.endsWith("ie")) forms.add(base.slice(0, -2) + "ying");
      else if (base.endsWith("e") && !base.endsWith("ee")) forms.add(base.slice(0, -1) + "ing");
      else if (cvcEnding(base)) {
        forms.add(base + last + "ing");
        if (!eCollision) forms.add(base + "ing");
      } else forms.add(base + "ing");
    }
    if (pos === 2 || pos === 3) {
      if (base.endsWith("e")) { forms.add(base + "r"); forms.add(base + "st"); }
      else if (/[^aeiou]y$/.test(base)) {
        forms.add(base.slice(0, -1) + "ier");
        forms.add(base.slice(0, -1) + "iest");
      } else if (cvcEnding(base)) {
        forms.add(base + last + "er"); forms.add(base + last + "est");
        if (!eCollision) { forms.add(base + "er"); forms.add(base + "est"); }
      } else { forms.add(base + "er"); forms.add(base + "est"); }
    }
    if (pos === 3) forms.add(base + "s");
    return forms;
  }
  /** 当前词、词典明确词形与保守规则屈折；不借助查词回退猜测任意派生词。 */
  function exampleWordForms(currentWord){
    const word = typeof currentWord === "string" ? currentWord : currentWord && currentWord.w;
    const base = String(word || "").toLowerCase();
    const entry = typeof currentWord === "string" ? W[wordIndex.get(base)] : currentWord;
    const forms = new Set(/^[a-z]+$/.test(base) ? [base] : []);
    const fm = String(entry && entry.fm || "");
    for (const field of fm.split(/[；;]/)) {
      const match = field.trim().match(/^(?:复数|过去式|过去分词|现在分词|第三人称单数|比较级|最高级)\s+([a-z]+(?:\s*\/\s*[a-z]+)*)$/i);
      if (match) for (const form of match[1].split("/")) forms.add(form.trim().toLowerCase());
    }
    for (const form of regularInflections(base, entry && entry.p, fm)) forms.add(form);
    for (const form of IRREGULAR_FORMS[base] || []) forms.add(form);
    for (const form of IRREGULAR_VERB_FORMS[base] || []) forms.add(form);
    return forms;
  }

  /* ---- 例句查义：明确词形 → 原形反向索引（按当前词书隔离） ----
   * 数据来源只有三处，不新增第二份词形表：
   *   1) 词条自带的 fm 字段（四书词条均标注复数/过去式/过去分词/现在分词/第三人称单数/比较级/最高级）；
   *   2) IRREGULAR_FORMS（名词/形容词不规则复数等）；
   *   3) IRREGULAR_VERB_FORMS（不规则动词）。
   * 索引只收当前词书的词条，键为当前词书 id + W 引用，切换词书后首次查询自动重建；
   * 返回的一律是当前书 W 的下标，不做四书并集。
   */
  let exFormIndexCache = null;
  /** fm 字段中列出的明确词形（去掉词头本身）。 */
  function fmExplicitForms(entry){
    const out = [];
    const base = String(entry && entry.w || "").toLowerCase();
    const fm = String(entry && entry.fm || "");
    for (const field of fm.split(/[；;]/)) {
      const match = field.trim().match(/^(?:复数|过去式|过去分词|现在分词|第三人称单数|比较级|最高级)\s+([a-z]+(?:\s*\/\s*[a-z]+)*)$/i);
      if (!match) continue;
      for (const part of match[1].split("/")) {
        const form = part.trim().toLowerCase();
        if (form && form !== base) out.push(form);
      }
    }
    return out;
  }
  function explicitFormIndex(){
    if (exFormIndexCache && exFormIndexCache.words === W && exFormIndexCache.bookId === currentBookId) {
      return exFormIndexCache.map;
    }
    const map = new Map();
    const add = (form, i) => {
      if (!form || !W[i]) return;
      if (form === String(W[i].w).toLowerCase()) return;
      let list = map.get(form);
      if (!list) { list = []; map.set(form, list); }
      if (list.indexOf(i) < 0) list.push(i);
    };
    for (let i = 0; i < W.length; i++) for (const form of fmExplicitForms(W[i])) add(form, i);
    for (const [lemma, forms] of Object.entries(IRREGULAR_FORMS)) {
      const i = wordIndex.get(lemma);
      if (i == null) continue;
      for (const form of forms) add(String(form).toLowerCase(), i);
    }
    for (const [lemma, forms] of Object.entries(IRREGULAR_VERB_FORMS)) {
      const i = wordIndex.get(lemma);
      if (i == null) continue;
      for (const form of forms) add(String(form).toLowerCase(), i);
    }
    exFormIndexCache = { words: W, bookId: currentBookId, map: map };
    return map;
  }
  /** 歧义候选顺序：常见词（词频排名靠前）优先，其次按词库下标稳定排序。 */
  function candidateOrder(list){
    return list.slice().sort((a, b) =>
      (((W[a] && W[a].r) || 0) - ((W[b] && W[b].r) || 0)) || (a - b));
  }
  /**
   * 保守规则候选：后缀还原 + 双写辅音还原，只在查询时现算。
   * 每个候选都必须能由 regularInflections(原形) 反向生成该词形，
   * 避免 stared 被还原成 star 一类误还原；原形不在当前书时直接跳过。
   */
  function regularRuleCandidates(token){
    const bases = [];
    const push = (x) => {
      if (!x || x.length < 2 || bases.indexOf(x) >= 0) return;
      if (!wordIndex.has(x)) return;
      bases.push(x);
    };
    const undouble = (x) => { if (/([b-df-hj-np-tv-z])\1$/.test(x)) push(x.slice(0, -1)); };
    if (/ies$/.test(token)) push(token.slice(0, -3) + "y");
    if (/es$/.test(token)) { push(token.slice(0, -2)); push(token.slice(0, -1)); }
    if (/s$/.test(token) && !/ss$/.test(token)) { const s = token.slice(0, -1); push(s); undouble(s); }
    if (/ied$/.test(token)) push(token.slice(0, -3) + "y");
    if (/ed$/.test(token)) { const s = token.slice(0, -2); push(s); push(s + "e"); undouble(s); }
    if (/ying$/.test(token)) push(token.slice(0, -4) + "ie");
    if (/ing$/.test(token)) { const s = token.slice(0, -3); push(s); push(s + "e"); undouble(s); }
    if (/ier$/.test(token)) push(token.slice(0, -3) + "y");
    if (/iest$/.test(token)) push(token.slice(0, -4) + "y");
    if (/er$/.test(token)) { const s = token.slice(0, -2); push(s); push(s + "e"); undouble(s); }
    if (/est$/.test(token)) { const s = token.slice(0, -3); push(s); push(s + "e"); undouble(s); }
    const hits = [];
    for (const base of bases) {
      const i = wordIndex.get(base);
      if (i == null || hits.indexOf(i) >= 0) continue;
      const entry = W[i];
      const forms = regularInflections(String(entry.w || "").toLowerCase(), entry.p, entry.fm);
      if (forms.has(token)) hits.push(i);
    }
    return hits;
  }
  /** 旧版后缀兜底（-ly/-er 等派生词）：只在前几层都没有合理命中时采用，保留原有覆盖。 */
  function legacySuffixCandidates(token){
    const bases = [];
    const push = (x) => { if (x && bases.indexOf(x) < 0) bases.push(x); };
    if (/ies$/.test(token)) push(token.replace(/ies$/, "y"));
    if (/es$/.test(token)) { push(token.replace(/es$/, "")); push(token.replace(/es$/, "e")); }
    if (/s$/.test(token) && !/ss$/.test(token)) push(token.replace(/s$/, ""));
    if (/ed$/.test(token)) {
      push(token.replace(/ed$/, "")); push(token.replace(/ed$/, "e")); push(token.replace(/ied$/, "y"));
    }
    if (/ing$/.test(token)) {
      push(token.replace(/ing$/, "")); push(token.replace(/ing$/, "e")); push(token.replace(/ying$/, "ie"));
    }
    if (/ly$/.test(token)) push(token.replace(/ly$/, ""));
    if (/er$/.test(token)) { push(token.replace(/er$/, "")); push(token.replace(/er$/, "e")); }
    if (/est$/.test(token)) { push(token.replace(/est$/, "")); push(token.replace(/est$/, "e")); }
    for (const base of bases) {
      const hit = wordIndex.get(base);
      if (hit != null) return [hit];
    }
    return [];
  }
  /**
   * 查词候选，按优先级返回当前词书 W 的下标数组：
   *   1) 精确词头（含所有格还原）——saw/left/rose/running 等独立词头优先，
   *      四/六/综合书的 running 是独立词头，只有考研书才回退到 run；
   *   2) 明确词形（fm/不规则表反向索引）；多原形歧义保留全部候选，不做 Map 覆盖；
   *   3) 保守规则候选（可反向再生校验，含双写辅音）；
   *   4) 旧后缀兜底。
   */
  function lookupExWordCandidates(token){
    const w = String(token == null ? "" : token).trim().toLowerCase().replace(/[’]/g, "'");
    if (!w) return [];
    const exact = wordIndex.get(w);
    if (exact != null) return [exact];
    const withoutPossessive = w.replace(/'s$/, "").replace(/s'$/, "s");
    if (withoutPossessive !== w) {
      const hit = wordIndex.get(withoutPossessive);
      if (hit != null) return [hit];
    }
    const index = explicitFormIndex();
    const explicit = index.get(w) || (withoutPossessive !== w ? index.get(withoutPossessive) : null);
    if (explicit && explicit.length) return candidateOrder(explicit);
    const rules = regularRuleCandidates(w);
    if (rules.length) return rules;
    return legacySuffixCandidates(w);
  }
  /** 例句来源徽标：真题（可跨词书）/ 自编 / 词典。 */
  function srcBadge(src){
    const s=String(src||"");
    if(!s) return "例句";
    if(s==="自编"||s==="自编例句") return "自编例句";
    if(s==="词典例句") return "词典例句";
    return "真题例句 · "+s;
  }
  /** 例句 → 可点词 HTML；当前词及其已知词形用 strong 强调，其余原样转义。 */
  function exHtml(text, currentWord){
    const forms = exampleWordForms(currentWord);
    const lemma = String((typeof currentWord === "string" ? currentWord : currentWord && currentWord.w) || "").toLowerCase();
    return exTokens(text).map(part => {
      if (/^[A-Za-z]/.test(part)) {
        const current = forms.has(part.toLowerCase());
        // 例句整体只有一个键盘入口；词本身不再各占一个 Tab 停靠点。
        return '<span class="ex-word' + (current ? " ex-current" : "") + '" data-exw="' + esc(part) + '" tabindex="-1"'
          + (current ? ' data-exlemma="' + esc(lemma) + '"' : "") + '>'
          + (current ? "<strong>" + esc(part) + "</strong>" : esc(part)) + "</span>";
      }
      return esc(part);
    }).join("");
  }
  /* 可选义项证据：始终按词书与单词文本读取，不接触学习记录或进度下标。 */
  function wordSenseEntry(x){
    const data = window.WORD_SENSES;
    const object = v => v && typeof v === "object" && !Array.isArray(v);
    const own = (v, key) => object(v) && Object.prototype.hasOwnProperty.call(v, key);
    if (!x || typeof x.w !== "string" || !object(data) || data.schemaVersion !== 1
        || !own(data.books, currentBookId) || !own(data.books[currentBookId], x.w)) return null;
    const entry = data.books[currentBookId][x.w];
    if (!object(entry) || !Array.isArray(entry.preferred) || !entry.preferred.length
        || typeof entry.additional !== "string") return null;
    for (const sense of entry.preferred) {
      if (!object(sense) || typeof sense.meaning !== "string" || !sense.meaning.trim()
          || !Array.isArray(sense.examples) || !sense.examples.length) return null;
      for (const example of sense.examples) {
        if (!object(example) || !["source", "quote", "surface"].every(k => typeof example[k] === "string" && example[k].trim())
            || (example.label !== undefined && typeof example.label !== "string")
            || !example.quote.replace(/\s+/g, " ").toLowerCase().includes(example.surface.replace(/\s+/g, " ").toLowerCase())) return null;
      }
    }
    return entry;
  }
  /** 真题语境义与词典补充分别显示；无有效证据文件时完整降级到原释义。 */
  function meaningHtml(x, compact = false){
    const entry = wordSenseEntry(x);
    if (!entry) {
      return '<div class="sense-dictionary">' + esc(x.m || "（暂无词典释义，请参考例句）") + '</div>'
        + '<p class="sense-note">词典释义，具体用法请结合例句；例句点词可查义。</p>';
    }
    if (compact) {
      return '<div class="sense-popup">' + entry.preferred.map(s => esc(s.meaning)).join("；") + '</div>'
        + '<p class="sense-note">本书真题已核对义项优先；原句与其他释义见详情。</p>';
    }
    const preferred = entry.preferred.map(sense =>
      '<li class="sense-item"><div class="sense-meaning">' + esc(sense.meaning) + '</div>'
      + '<details class="sense-evidence"><summary>查看原句与出处</summary>'
      + sense.examples.map(example => '<div class="sense-example" data-ex-linked="1">'
        + '<p class="sense-quote" lang="en" data-ex-linked="1" tabindex="0" role="group" aria-expanded="false" aria-label="例句，左右方向键选词，回车查义">' + exHtml(example.quote, x) + '</p>'
        + '<p class="sense-source">' + esc(example.label || example.source) + '</p></div>').join("")
      + '</details></li>'
    ).join("");
    const additional = entry.additional.trim()
      ? '<details class="sense-additional"><summary>其他词典释义</summary>'
        + '<div class="sense-additional-meaning">' + esc(entry.additional) + '</div>'
        + '<p class="sense-note">这些释义尚未逐义核验，不代表历年真题未考。</p></details>' : "";
    return '<div class="sense-block"><p class="sense-label">本书真题已核对义项</p>'
      + '<ol class="sense-preferred">' + preferred + '</ol>' + additional
      + '<p class="sense-note">按已核对原句前置，仅覆盖所列语境；尚未穷尽历年全部用法。</p></div>';
  }
  /** 轻量屈折还原后在当前词书找词，找不到返回 -1；歧义时取候选第一位。 */
  function lookupExWord(token){
    const candidates = lookupExWordCandidates(token);
    return candidates.length ? candidates[0] : -1;
  }
  let exPopReturn = null;
  function exContainerOf(el){
    return el && el.closest ? el.closest("[data-ex-linked]") : null;
  }
  function setExActive(container, wordEl){
    if (!container || !container.querySelectorAll) return;
    const words = Array.from(container.querySelectorAll(".ex-word"));
    for (const word of words) word.classList.toggle("ex-active", word === wordEl);
    if (wordEl) {
      container.setAttribute?.("aria-label", "例句，当前选中 " + (wordEl.getAttribute?.("data-exw") || wordEl.textContent)
        + "，左右方向键选词，回车查义");
    }
  }
  /** 例句查词浮层：键盘入口在整句，打开后焦点进入浮层，Esc 回到触发词。 */
  function showExPop(token, anchor){
    const pop = $("#exPop");
    if (!pop) return;
    // 高亮词已由该词条的明确词形生成，直接沿用其原形，支持 took/canned 等变化；
    // 其余词形精确词头优先，歧义时保留全部候选（不把最后一个写入当唯一答案）。
    const markedLemma = typeof anchor?.dataset?.exlemma === "string" ? wordIndex.get(anchor.dataset.exlemma) : undefined;
    const candidates = markedLemma === undefined ? lookupExWordCandidates(token) : [markedLemma];
    const i = candidates.length ? candidates[0] : -1;
    const raw = String(token == null ? "" : token);
    const trigger = exContainerOf(anchor);
    exPopReturn = trigger ? {trigger: trigger, word: anchor} : null;
    if (trigger) trigger.setAttribute?.("aria-expanded", "true");
    if (i < 0) {
      pop.innerHTML =
        '<div class="ex-pop-w">' + esc(raw) + "</div>" +
        '<div class="ex-pop-m">词库未收录该词</div>';
      pop.setAttribute?.("aria-label", "例句查词：词库未收录 " + raw);
    } else {
      const x = W[i];
      // 歧义候选行：候选按钮都可 Tab 到达，Enter/空格切换查看，Esc 仍回到触发词。
      // 容器的 aria 说明放在浮层 aria-label 与按钮文本上，避免额外的 tab 停靠点。
      const candidateLine = candidates.length > 1
        ? '<div class="ex-pop-cand"><span>也可能是：</span>' +
            candidates.slice(1).map(k =>
              '<button type="button" class="btn ghost sm" data-excand="' + k + '">' + esc(W[k].w) + "</button>"
            ).join("") +
          "</div>"
        : "";
      pop.innerHTML =
        '<div class="ex-pop-w">' + esc(x.w) +
          (pronHtml(x) ? ' <span class="ex-pop-ph">' + pronHtml(x) + "</span>" : "") +
        "</div>" +
        '<div class="ex-pop-m">' + meaningHtml(x, true) + "</div>" +
        '<div class="ex-pop-meta">词频 #' + x.r + " · " + x.f + " 次 / " + x.c + " 套卷</div>" +
        candidateLine +
        '<div class="ex-pop-acts">' +
          '<button type="button" class="btn ghost sm" id="exPopDetail">详情</button>' +
          '<button type="button" class="btn ghost sm" id="exPopSpeak" aria-label="发音">♪</button>' +
        "</div>";
      pop.setAttribute?.("aria-label", "例句查词：" + x.w
        + (candidates.length > 1 ? "，另有 " + (candidates.length - 1) + " 个可能的原形" : ""));
      const detailBtn = pop.querySelector("#exPopDetail");
      if (detailBtn) detailBtn.onclick = (e) => {
        e.stopPropagation();
        hideExPop();
        openWord(i);
      };
      const spkBtn = pop.querySelector("#exPopSpeak");
      if (spkBtn) spkBtn.onclick = (e) => {
        e.stopPropagation();
        speak(x.w);
      };
      for (const candBtn of Array.from(pop.querySelectorAll ? pop.querySelectorAll("[data-excand]") : [])) {
        candBtn.onclick = (e) => {
          e.stopPropagation();
          const k = +candBtn.getAttribute("data-excand");
          if (W[k]) showExPop(W[k].w, anchor);
        };
      }
    }
    // 12 语言标记：浮层单词与候选单词是英文，中文释义/词频保持中文（不改 innerHTML 字符串）。
    pop.querySelector?.(".ex-pop-w")?.setAttribute?.("lang", "en");
    for (const candWord of Array.from(pop.querySelectorAll?.("[data-excand]") || [])) {
      candWord.setAttribute?.("lang", "en");
    }
    pop.hidden = false;
    pop.classList.add("on");
    pop.setAttribute?.("aria-expanded", "true");
    // 就近定位（失败则居中偏下）
    try {
      const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
      if (r && r.width) {
        const pw = pop.offsetWidth || 240;
        const left = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), (window.innerWidth || 900) - pw - 8);
        const top = (r.bottom + 8 + (pop.offsetHeight || 120) < (window.innerHeight || 700))
          ? r.bottom + 8
          : Math.max(8, r.top - (pop.offsetHeight || 120) - 8);
        pop.style.left = left + "px";
        pop.style.top = top + "px";
        pop.style.transform = "none";
      } else {
        pop.style.left = "50%";
        pop.style.top = "40%";
        pop.style.transform = "translate(-50%, 0)";
      }
    } catch (_) {
      pop.style.left = "50%";
      pop.style.top = "40%";
      pop.style.transform = "translate(-50%, 0)";
    }
    pop.focus?.({ preventScroll: true });
  }
  function hideExPop(restoreFocus){
    const pop = $("#exPop");
    if (!pop) return;
    const previous = exPopReturn;
    const containers = Array.from($("#card")?.querySelectorAll?.(".ex[data-ex-linked], .sense-quote[data-ex-linked]") || []);
    const containerIndex = previous ? containers.indexOf(previous.trigger) : -1;
    const wordIndexInQuote = previous ? Array.from(previous.trigger.querySelectorAll?.(".ex-word") || []).indexOf(previous.word) : -1;
    exPopReturn = null;
    pop.hidden = true;
    pop.classList.remove("on");
    pop.setAttribute?.("aria-expanded", "false");
    applyActionLayout();
    applyActionBindingHints();
    if (previous && previous.trigger) previous.trigger.setAttribute?.("aria-expanded", "false");
    const refresh = sharedCardRefreshPending === currentBookId && !activeSheet;
    if (refresh) renderCard();
    if (restoreFocus && previous && previous.trigger) {
      if (refresh && containerIndex >= 0) {
        const nextContainer = $("#card")?.querySelectorAll?.(".ex[data-ex-linked], .sense-quote[data-ex-linked]")?.[containerIndex];
        const nextWord = nextContainer?.querySelectorAll?.(".ex-word")?.[wordIndexInQuote];
        if (nextContainer) { setExActive(nextContainer, nextWord); (nextWord || nextContainer).focus?.({preventScroll: true}); }
        else $("#card")?.focus?.({preventScroll: true});
        return;
      }
      setExActive(previous.trigger, previous.word);
      const target = previous.word && previous.word.isConnected !== false ? previous.word : previous.trigger;
      target.focus?.({ preventScroll: true });
    }
  }
  function bindExLookup(root){
    if (!root || root.__exLookupBound) return;
    root.__exLookupBound = true;
    root.addEventListener("click", (e) => {
      const t = e.target;
      const wordEl = t && t.closest ? t.closest(".ex-word") : null;
      if (!wordEl) return;
      e.preventDefault();
      e.stopPropagation();
      const container = exContainerOf(wordEl);
      if (container) setExActive(container, wordEl);
      showExPop(wordEl.getAttribute("data-exw") || wordEl.textContent, wordEl);
    });
    root.addEventListener("focusin", (e) => {
      const container = exContainerOf(e.target);
      if (!container || (root.contains && !root.contains(container))) return;
      const wordEl = e.target.closest ? e.target.closest(".ex-word") : null;
      if (wordEl) setExActive(container, wordEl);
      else {
        const first = container.querySelector(".ex-word");
        if (first && !container.querySelector(".ex-word.ex-active")) setExActive(container, first);
      }
    });
    root.addEventListener("keydown", (e) => {
      const container = exContainerOf(e.target);
      if (!container) return;
      const words = Array.from(container.querySelectorAll ? container.querySelectorAll(".ex-word") : []);
      if (!words.length) return;
      const active = container.querySelector(".ex-word.ex-active");
      let index = words.indexOf(active);
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Home") index = 0;
        else if (e.key === "End") index = words.length - 1;
        else if (index < 0) index = 0;
        else index = (index + (e.key === "ArrowRight" ? 1 : -1) + words.length) % words.length;
        setExActive(container, words[index]);
        words[index].focus?.({ preventScroll: true });
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        const wordEl = active || words[0];
        setExActive(container, wordEl);
        showExPop(wordEl.getAttribute("data-exw") || wordEl.textContent, wordEl);
        return;
      }
      if (e.key === "Escape" && !$("#exPop").hidden) {
        e.preventDefault();
        e.stopPropagation();
        hideExPop(true);
      }
    });
  }

  /* ================= 主题 ================= */
  function resolvedDark(){
    const t = S.settings.theme || "auto";
    const sysDark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    return (t === "dark") || (t === "auto" && sysDark);
  }
  function applyTheme(){
    const t = S.settings.theme || "auto";
    const dark = resolvedDark();
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    const themeColor = $('meta[name="theme-color"]');
    themeColor?.setAttribute?.("content", dark ? "#1B1916" : "#F6F3ED");
    $$("#themeSeg button").forEach(b => {
      b.classList.toggle("on", b.dataset.theme === t);
      b.setAttribute?.("aria-pressed", String(b.dataset.theme === t));
    });
    // 首页顶部主题按钮：显示下一次点击会切换到的模式。
    const toggle = $("#btnTheme");
    if (toggle) {
      const next = dark ? "light" : "dark";
      toggle.dataset.nextTheme = next;
      toggle.setAttribute?.("aria-label", next === "dark" ? "切换到深色模式" : "切换到浅色模式");
      toggle.setAttribute?.("aria-pressed", String(dark));
      toggle.setAttribute?.("title", next === "dark" ? "切换到深色模式" : "切换到浅色模式");
    }
  }
  /** 顶部按钮：在浅色/深色之间直接切换；原本「跟随系统」时也变成显式选择。 */
  function toggleTheme(){
    S.settings.theme = resolvedDark() ? "light" : "dark";
    save();
    applyTheme();
    toast(S.settings.theme === "dark" ? "已切换到深色模式" : "已切换到浅色模式");
  }
  try {
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if ((S.settings.theme || "auto") === "auto") applyTheme();
      });
    }
  } catch (e) {}

  /* ================= 词库筛选 ================= */
  function passBaseFilters(x, s = S.settings){
    if (s.pmin && x.c < s.pmin) return false;
    if (s.kyOnly && x.ky !== 1) return false;
    // 词性只走 posMatches 单一判据：队列/范围/直方图/列表/统计/TXT 共用。
    return posMatches(x, s.pos || [], s.posMode);
  }
  function inScope(i, s = S.settings){
    const x = W[i];
    if (x.f < (s.fmin || 1)) return false;
    if (s.fmax && x.f > s.fmax) return false;
    return passBaseFilters(x, s);
  }

  /* ================= 词频分布曲线 + 双端滑块 ================= */
  const FREQ_BINS = 20;
  const FREQ_POS_MAX = 1000;
  function bookMaxFreq(){
    let m = 1;
    for (let i = 0; i < W.length; i++) {
      const f = W[i].f;
      if (f > m) m = f;
    }
    return m;
  }
  /** 对数刻度：1 次在最左，maxF 次在最右 */
  function freqToPos(f, maxF){
    maxF = Math.max(1, maxF || 1);
    if (maxF <= 1) return 0;
    const v = Math.max(1, Math.min(maxF, +f || 1));
    return Math.round(Math.log(v) / Math.log(maxF) * FREQ_POS_MAX);
  }
  /** 1000 = 不限（仅上界）；下界 1000 = maxF */
  function posToFreq(pos, maxF, unlimited){
    pos = Math.max(0, Math.min(FREQ_POS_MAX, Math.round(+pos || 0)));
    if (unlimited && pos >= FREQ_POS_MAX) return 0;
    maxF = Math.max(1, maxF || 1);
    if (maxF <= 1) return 1;
    return Math.max(1, Math.min(maxF, Math.round(Math.pow(maxF, pos / FREQ_POS_MAX))));
  }
  function freqBinLayout(){
    const maxF = bookMaxFreq();
    const B = Math.max(1, Math.min(FREQ_BINS, maxF));
    const bnd = [1];
    for (let b = 1; b <= B; b++) {
      bnd[b] = Math.min(maxF, Math.max(bnd[b - 1] + 1, Math.round(Math.pow(maxF, b / B))));
    }
    bnd[B] = maxF;
    return { maxF: maxF, B: B, bnd: bnd };
  }
  /** 只按套卷/大纲/词性过滤，不受词频区间影响，拖动滑块时柱形保持稳定 */
  function freqHistogram(){
    const layout = freqBinLayout();
    const bins = new Array(layout.B).fill(0);
    let total = 0;
    for (let i = 0; i < W.length; i++) {
      const x = W[i];
      if (!passBaseFilters(x)) continue;
      total++;
      let b = 0;
      while (b < layout.B - 1 && x.f >= layout.bnd[b + 1]) b++;
      bins[b]++;
    }
    return {
      maxF: layout.maxF,
      total: total,
      bins: bins.map((count, b) => ({
        count: count,
        lo: layout.bnd[b],
        hi: b === layout.B - 1 ? layout.maxF : layout.bnd[b + 1] - 1
      }))
    };
  }
  function renderFreqAxis(maxF){
    const el = $("#freqAxis");
    if (!el) return;
    const width = el.clientWidth || 600;
    const ticks = [1, maxF];
    const occupied = [];
    const addTick = f => {
      if (f < 1 || f > maxF || occupied.some(t => t.f === f)) return;
      const x = freqToPos(f, maxF) / FREQ_POS_MAX * width;
      const labelWidth = String(f).length * 7;
      const left = f === 1 ? 0 : f === maxF ? width - labelWidth : x - labelWidth / 2;
      const right = left + labelWidth;
      if (f !== 1 && f !== maxF && occupied.some(t => left < t.right + 10 && right > t.left - 10)) return;
      occupied.push({f, left, right});
    };
    ticks.forEach(addTick);
    // 优先保留低频端的 2、5 和十进位刻度，窄屏自动略去会重叠的次要标签。
    [2, 5, 10, 100, 1000, 10000, 20, 50, 200, 500, 2000, 5000].forEach(addTick);
    const uniq = occupied.map(t => t.f).sort((a, b) => a - b);
    el.innerHTML = uniq.map((f, i) => {
      const cls = i === 0 ? "at-start" : (i === uniq.length - 1 ? "at-end" : "");
      return '<span class="' + cls + '" data-freq="' + f + '" style="left:' + (freqToPos(f, maxF) / 10) + '%">' + f + "</span>";
    }).join("");
  }
  /** 单调三次插值：保留分布走势，不产生高于采样峰值或低于零的过冲。 */
  function freqCurvePath(points){
    const slopes = [], tangent = [];
    for (let i = 0; i < points.length - 1; i++) slopes.push((points[i + 1].y - points[i].y) / (points[i + 1].x - points[i].x));
    tangent[0] = slopes[0];
    tangent[points.length - 1] = slopes[slopes.length - 1];
    for (let i = 1; i < points.length - 1; i++) tangent[i] = slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
    for (let i = 0; i < slopes.length; i++) {
      if (!slopes[i]) { tangent[i] = tangent[i + 1] = 0; continue; }
      const a = tangent[i] / slopes[i], b = tangent[i + 1] / slopes[i];
      const length = Math.hypot(a, b);
      if (length > 3) { tangent[i] = 3 * a * slopes[i] / length; tangent[i + 1] = 3 * b * slopes[i] / length; }
    }
    const round = n => Math.round(n * 100) / 100;
    let path = "M" + round(points[0].x) + "," + round(points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const p = points[i], q = points[i + 1], dx = (q.x - p.x) / 3;
      path += " C" + round(p.x + dx) + "," + round(p.y + tangent[i] * dx) + " " + round(q.x - dx) + "," +
        round(q.y - tangent[i + 1] * dx) + " " + round(q.x) + "," + round(q.y);
    }
    return path;
  }
  function renderFreqHistogram(){
    const el = $("#freqBars");
    if (!el) return;
    const h = freqHistogram();
    // 按真实次数聚合后在 log 坐标上平滑，不把不同宽度的 20 桶原始计数连成伪峰。
    // 固定 1.45 倍频次的带宽，让四本词书使用相同的平滑尺度。
    const counts = new Map();
    for (const word of W) if (passBaseFilters(word)) counts.set(word.f, (counts.get(word.f) || 0) + 1);
    const samples = Array.from(counts, ([frequency, count]) => ({log: Math.log(frequency), count}));
    const bandwidth = Math.log(1.45), maxLog = Math.log(h.maxF), resolution = 96;
    const density = Array.from({length: resolution + 1}, (_, i) => {
      const log = maxLog * i / resolution;
      let value = 0;
      for (const sample of samples) {
        const distance = (log - sample.log) / bandwidth;
        if (Math.abs(distance) <= 4) value += sample.count * Math.exp(-distance * distance / 2);
      }
      return value;
    });
    const peak = Math.max(1, ...density);
    const points = density.map((value, i) => ({x: FREQ_POS_MAX * i / resolution, y: 160 - value / peak * 140}));
    const curve = freqCurvePath(points), area = curve + " L1000,160 L0,160 Z";
    el.innerHTML = '<svg class="freq-curve" viewBox="0 0 1000 160" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="freqCurveGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity=".04"/></linearGradient>' +
      '<clipPath id="freqCurveClip" clipPathUnits="userSpaceOnUse"><rect id="freqCurveClipRect" x="0" y="0" width="1000" height="160"/></clipPath></defs>' +
      '<path class="freq-curve-base-area" d="' + area + '"/><path class="freq-curve-base-line" d="' + curve + '"/>' +
      '<g clip-path="url(#freqCurveClip)"><path class="freq-curve-selected-area" fill="url(#freqCurveGradient)" d="' + area + '"/><path class="freq-curve-selected-line" d="' + curve + '"/></g></svg>' +
      (h.total ? "" : '<span class="freq-curve-empty">当前条件下暂无词频分布</span>');
    el.setAttribute?.("aria-label", "词频分布平滑概览：共 " + h.total + " 词，词频 1 至 " + h.maxF + " 次；精确筛选结果见下方词数");
    renderFreqAxis(h.maxF);
    syncFreqControls();
  }
  function renderFreqHandleLabels(lo, hi, loPos, hiPos){
    const low = $("#freqMinLabel"), high = $("#freqMaxLabel"), combined = $("#freqCombinedLabel");
    if (!low || !high || !combined) return;
    low.textContent = "≥ " + lo + " 次";
    high.textContent = hi ? "≤ " + hi + " 次" : "不限";
    const width = $("#freqTrack")?.clientWidth || 600;
    const textWidth = el => el.textContent.length * 7 + 16;
    const merged = (hiPos - loPos) / FREQ_POS_MAX * width < (textWidth(low) + textWidth(high)) / 2 + 12;
    low.hidden = high.hidden = merged;
    combined.hidden = !merged;
    combined.textContent = hi === lo ? "仅 " + lo + " 次" : !hi ? "≥ " + lo + " 次" : lo + "–" + hi + " 次";
    const place = (el, pos) => {
      el.style.left = (pos / 10) + "%";
      el.classList.toggle("at-start", pos / FREQ_POS_MAX * width < textWidth(el) / 2);
      el.classList.toggle("at-end", (1 - pos / FREQ_POS_MAX) * width < textWidth(el) / 2);
    };
    place(low, loPos); place(high, hiPos); place(combined, (loPos + hiPos) / 2);
  }
  function refreshFreqPresentation(){
    if (!$("#v-set")?.classList.contains("on")) return;
    renderFreqAxis(bookMaxFreq());
    syncFreqControls();
  }
  /** 滑块位置、选中窗口、柱形高亮与实时计数 */
  function syncFreqControls(){
    const s = S.settings;
    const maxF = bookMaxFreq();
    const loRaw = Math.max(1, s.fmin || 1);
    const hiRaw = s.fmax || 0;
    const loPos = loRaw > maxF ? FREQ_POS_MAX : freqToPos(loRaw, maxF);
    const hiPos = hiRaw ? freqToPos(Math.max(loRaw, Math.min(hiRaw, maxF)), maxF) : FREQ_POS_MAX;
    const loEl = $("#fminRange"), hiEl = $("#fmaxRange");
    if (loEl) {
      loEl.value = String(loPos);
      loEl.setAttribute?.("aria-valuetext", loRaw + " 次");
      loEl.setAttribute?.("aria-valuemin", "0");
      loEl.setAttribute?.("aria-valuemax", String(hiPos));
    }
    if (hiEl) {
      hiEl.value = String(hiPos);
      hiEl.setAttribute?.("aria-valuetext", hiRaw ? hiRaw + " 次" : "不限");
      hiEl.setAttribute?.("aria-valuemin", String(loPos));
      hiEl.setAttribute?.("aria-valuemax", String(FREQ_POS_MAX));
    }
    const left = Math.min(100, loPos / 10);
    const right = Math.min(100, hiPos / 10);
    const win = $("#freqWin");
    if (win) {
      const single = hiRaw === loRaw && loRaw <= maxF;
      win.style.left = left + "%";
      win.style.width = Math.max(0, right - left) + "%";
      win.classList.toggle("single", single);
      win.hidden = right <= left && !single;
    }
    const fill = $("#freqFill");
    if (fill) {
      fill.style.left = left + "%";
      fill.style.width = Math.max(0, right - left) + "%";
    }
    renderFreqHandleLabels(loRaw, hiRaw, loPos, hiPos);
    const clip = $("#freqCurveClipRect");
    clip?.setAttribute?.("x", String(loPos));
    clip?.setAttribute?.("width", String(Math.max(0, hiPos - loPos)));
    let total = 0, inRange = 0, active = 0, proficient = 0;
    for (let i = 0; i < W.length; i++) {
      const x = W[i];
      if (!passBaseFilters(x)) continue;
      total++;
      if (x.f < loRaw || (hiRaw && x.f > hiRaw)) continue;
      inRange++;
      if (isProficient(i)) proficient++; else active++;
    }
    const rangeText = hiRaw === loRaw ? "仅 " + loRaw + " 次" : (loRaw > 1 || hiRaw)
      ? loRaw + " ～ " + (hiRaw || "不限") + " 次"
      : "全部词频";
    const rangeEl = $("#freqRangeNow");
    if (rangeEl) rangeEl.textContent = rangeText;
    const metaEl = $("#freqScopeNow");
    if (metaEl) {
      metaEl.innerHTML = '<span class="freq-result"><strong>' + active.toLocaleString() + '</strong> 个可背单词</span>' +
        '<span class="freq-result-note">候选词中有 ' + (total ? Math.round(inRange / total * 100) : 0) + '% 落在此范围' +
        (proficient ? ' · 已排除 ' + proficient + ' 个熟练词' : '') + '</span>';
    }
  }
  let freqRangeChanged = false;
  function setFreqActivity(which, dragging){
    const track = $("#freqTrack");
    if (!track) return;
    track.dataset.active = which;
    if (dragging !== undefined) track.dataset.dragging = String(dragging);
  }
  /** 写入精确次数；键盘以实际次数步进，避免低频区多次按键仍无变化。 */
  function setFreqValue(which, value){
    const s = S.settings, maxF = bookMaxFreq();
    const oldMin = s.fmin, oldMax = s.fmax;
    if (which === "min") {
      s.fmin = Math.max(1, Math.min(Math.round(value), s.fmax || maxF, maxF));
    } else {
      const f = Math.max(Math.min(s.fmin || 1, maxF), Math.min(maxF, Math.round(value)));
      s.fmax = f >= maxF ? 0 : f;
    }
    if (oldMin !== s.fmin || oldMax !== s.fmax) {
      freqRangeChanged = true;
      markSettingsEditing();
    }
    const minInput = $("#fmin"), maxInput = $("#fmax");
    if (minInput) minInput.value = s.fmin;
    if (maxInput) maxInput.value = s.fmax || "";
    setFreqActivity(which);
    syncFreqControls();
    updateScopeCount();
    syncPresets();
  }
  /** 把一个滑块位置换算成实际词频并写入设置 */
  function setFreqPos(which, pos){
    const s = S.settings;
    const maxF = bookMaxFreq();
    pos = Math.max(0, Math.min(FREQ_POS_MAX, Math.round(+pos || 0)));
    if (which === "min") {
      const cap = s.fmax ? freqToPos(Math.min(s.fmax, maxF), maxF) : FREQ_POS_MAX;
      pos = Math.min(pos, cap);
      setFreqValue(which, posToFreq(pos, maxF, false));
    } else {
      const floor = freqToPos(Math.max(1, Math.min(s.fmin || 1, maxF)), maxF);
      pos = Math.max(pos, floor);
      setFreqValue(which, posToFreq(pos, maxF, true) || maxF);
    }
  }
  /** 拖动滑块：先实时更新范围与计数，松手后再重建队列 */
  function onFreqRangeInput(which){
    // 部分触摸浏览器在 pointerdown 被阻止后仍派发原生 range 输入。
    // 重合手柄由方向分派独立控制，原生值只能还原，不能同时改写另一端。
    if (freqOverlapDrag) { syncFreqControls(); return false; }
    const el = $(which === "min" ? "#fminRange" : "#fmaxRange");
    if (el) setFreqPos(which, +el.value);
    return true;
  }
  function onFreqRangeKey(e, which){
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const keys = ["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp", "PageDown", "PageUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const maxF = bookMaxFreq(), s = S.settings;
    const low = which === "min" ? 1 : Math.min(maxF, s.fmin || 1);
    const high = which === "min" ? (s.fmax || maxF) : maxF;
    let value = which === "min" ? s.fmin : (s.fmax || maxF);
    if (e.key === "Home") value = low;
    else if (e.key === "End") value = high;
    else {
      const delta = e.key.startsWith("Page") || e.shiftKey ? 10 : 1;
      value += ["ArrowLeft", "ArrowDown", "PageDown"].includes(e.key) ? -delta : delta;
    }
    setFreqValue(which, Math.max(low, Math.min(high, value)));
    commitFreqRange();
  }
  /** 点击轨道空白处：把最近的一端圆点移过去 */
  function onFreqTrackClick(e){
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest("input")) return;
    const loEl = $("#fminRange"), hiEl = $("#fmaxRange");
    if (!loEl || !hiEl) return;
    e.preventDefault();
    const pos = freqPosFromEvent(e);
    const lo = +loEl.value, hi = +hiEl.value;
    const which = Math.abs(hi - lo) <= 1
      ? (pos < lo ? "min" : "max")
      : (Math.abs(pos - lo) < Math.abs(pos - hi) ? "min" : "max");
    setFreqPos(which, pos);
    $(which === "min" ? "#fminRange" : "#fmaxRange").focus?.({ preventScroll: true });
    commitFreqRange();
  }
  function commitFreqRange(){
    if (!freqRangeChanged) return;
    freqRangeChanged = false;
    // 08：频段设置只影响下一组；当前组按开始时的范围继续，不因拖动滑块重建。
    onSet();
    bindSet();
    applyFilter();
    renderStats();
    markSettingsSaved();
  }
  /** 两个手柄重合时原生滑块只有一个能抓住：向右抬高上界、向左降低下界 */
  let freqOverlapDrag = null;
  let freqPointerDrag = null;
  function freqPosFromEvent(e){
    const bars = $("#freqBars");
    if (!bars) return 0;
    const rect = bars.getBoundingClientRect();
    if (!rect.width) return 0;
    return Math.max(0, Math.min(FREQ_POS_MAX,
      Math.round((e.clientX - rect.left) / rect.width * FREQ_POS_MAX)));
  }
  function startFreqRangeDrag(e, which){
    if ((e.button !== undefined && e.button !== 0) || e.isPrimary === false) return;
    const loEl = $("#fminRange"), hiEl = $("#fmaxRange");
    if (!loEl || !hiEl) return;
    freqPointerDrag = { pointerId: e.pointerId, book: currentBookId };
    setFreqActivity(which, true);
    window.addEventListener("pointerup", endFreqRangeDrag);
    window.addEventListener("pointercancel", endFreqRangeDrag);
    const lo = +loEl.value, hi = +hiEl.value;
    if (Math.abs(hi - lo) > 12) return;   // 未重合，交给原生滑块
    e.preventDefault();
    freqOverlapDrag = { startX: e.clientX, moved: false, which: null };
    window.addEventListener("pointermove", moveFreqOverlapDrag, { passive: false });
  }
  function moveFreqOverlapDrag(e){
    if (!freqOverlapDrag || (freqPointerDrag && e.pointerId !== freqPointerDrag.pointerId)) return;
    const dx = e.clientX - freqOverlapDrag.startX;
    if (!freqOverlapDrag.moved && Math.abs(dx) < 3) return;
    freqOverlapDrag.moved = true;
    if (!freqOverlapDrag.which) freqOverlapDrag.which = dx > 0 ? "max" : "min";
    e.preventDefault();
    setFreqPos(freqOverlapDrag.which, freqPosFromEvent(e));
  }
  function endFreqRangeDrag(e){
    if (!freqPointerDrag || (e && e.pointerId !== freqPointerDrag.pointerId)) return;
    const book = freqPointerDrag.book;
    freqPointerDrag = null;
    freqOverlapDrag = null;
    window.removeEventListener("pointermove", moveFreqOverlapDrag);
    window.removeEventListener("pointerup", endFreqRangeDrag);
    window.removeEventListener("pointercancel", endFreqRangeDrag);
    const track = $("#freqTrack");
    if (track) track.dataset.dragging = "false";
    if (book === currentBookId) commitFreqRange();
    else freqRangeChanged = false;
  }
  function orderedPool(){
    const pool = [];
    for (let i = 0; i < W.length; i++) if (inScope(i) && !isProficient(i)) pool.push(i);
    if (S.settings.order === "wrong") {
      return pool.sort((a, b) => {
        const A = st(a), B = st(b);
        return ((B && B[3]) || 0) - ((A && A[3]) || 0) || W[a].r - W[b].r;
      });
    }
    return pool.sort((a, b) => W[a].r - W[b].r);
  }
  /** 积压保护是否生效：到期池大于今日剩余复习预算时，不自动往本组补新词。 */
  function isBacklogGuarded(now){
    if (!S.settings.backlogGuard) return false;
    if (getReviewCap() === 0) return false;
    return countDue(now) > reviewCapLeft();
  }
  /** 新词池按当前顺序规则排列（shuffle 打乱 / freq、wrong 按词频），供组装配与子组共用。 */
  function orderFreshPool(pool){
    if (S.settings.order === "shuffle") return shuffle(pool, sessionSeed + 1);
    const set = new Set(pool);
    return orderedPool().filter(i => set.has(i));
  }
  /**
   * 构建完整到期池与新词池。返回契约保持 {due, fresh} 意义不变（6 个既有测试依赖），
   * 另加：duePool=完整到期池（排序后），freshPool=不分额度截断的完整未学池，
   * backlogGuarded=积压保护是否生效（生效时 fresh=[]，不自动补新词）。
   */
  function buildQueue(now){
    now = now || Date.now();
    const duePool = [], freshPool = [];
    for (let i = 0; i < W.length; i++) {
      if (!inScope(i) || isProficient(i)) continue;
      const p = st(i);
      if (!hasMainProgress(p)) freshPool.push(i);
      else if (p[0] < MASTER && p[1] <= now) duePool.push(i);
    }
    let due;
    if (S.settings.order === "shuffle") {
      due = shuffle(duePool, sessionSeed);
    } else {
      due = duePool.slice();
      if (S.settings.order === "wrong") {
        // 错词优先：复习队列按错误次数降序，再按到期时间；新词仍按词频
        due.sort((a, b) => {
          const A = st(a), B = st(b);
          return ((B && B[3]) || 0) - ((A && A[3]) || 0) || (A && A[1] || 0) - (B && B[1] || 0);
        });
      } else {
        due.sort((a, b) => st(a)[1] - st(b)[1]);
      }
    }
    // 有效新词目标 = dailyNew + 今日临时加量（23）；长期 dailyNew 不变。
    const quota = Math.max(0, effectiveNewTarget() - day().n);
    const backlogGuarded = isBacklogGuarded(now);
    const freshOrdered = orderFreshPool(freshPool);
    return {
      due: due,
      fresh: backlogGuarded ? [] : freshOrdered.slice(0, quota),
      duePool: duePool,
      freshPool: freshPool,
      backlogGuarded: backlogGuarded
    };
  }

  /* ================= 会话状态 ================= */
  let Q = [], qi = 0, rounds = {}, cur = null, answered = 0, rightN = 0;
  /** 本组初始词数：重考只增加待巩固，不扩大主进度分母。 */
  let groupTotal = 0;
  let sessionSeed = 1;
  /** verdict: null | true(会) | false(不会) */
  let verdict = null, snap = null, stageBefore = 0;
  /** phase: "recall" | "revealed" —— 门控核心 */
  let phase = "recall";
  let undoStack = [];
  let autoSpoken = false;
  /** 错词特训：独立队列，不影响主背诵队列与今日新词额度 */
  let drillMode = false;
  let mainSnap = null;
  /** 20 单日复习上限：暂停态是派生状态（不持久化），capGroupEnded 表示用户主动结束被暂停的本组。 */
  let capPaused = false;
  let capGroupEnded = false;
  /** 23 临时加量子组：独立进入/退出，保留原主组现场（含暂停态），不嵌套。 */
  let extraSubgroup = false;
  let extraSnap = null;
  let extraGrantBusy = false;
  let lastExtraPointer = null;   // 同一指针连击去重 {n, at}
  /** 07 纯新词子组（kind="newOnly"）：积压保护/暂停时只学今日计划内新词，同样保留原组现场。 */
  let newOnlySubgroup = false;
  let newOnlySnap = null;
  /** 任一受控子组（extra/newOnly）进行中：两者与特训互斥、不嵌套。 */
  function inSubgroup(){ return extraSubgroup || newOnlySubgroup; }
  /* ---- 08 本组范围快照：startSession 时冻结，改设置不追溯当前组 ---- */
  let sessionScopeSet = null;
  /* ---- 15 刷新恢复提示：非 null 表示刚恢复了未完成的一组（显示一句说明，可由用户关闭） ---- */
  let resumeNoticePending = null;
  /** 导入回滚期间暂停写会话快照：失败路径要求存储键与导入前完全一致（不覆盖旧临时快照）。 */
  let sessionSnapshotWriteSuspended = false;
  /* ---- 22 完成页挂机自动续背（运行时状态，不持久化；租约是唯一短存储） ---- */
  let autoResumePhase = "idle";          // idle | waiting | countdown | paused | blocked
  let autoResumeDeadline = 0;            // 倒计时截止时刻（Date.now）
  let autoResumeIdleSince = null;        // 当前「完成页连续无有效交互」的起点；null=尚未开始计时
  let autoResumeLastReason = "";         // 最近一次未触发原因（UI/调试只读）
  let autoResumeCheckCache = null;       // 最近一次候选复核明细（只读 UI/调试）
  let autoResumeCacheExpiresAt = 0, autoResumeNextDueAt = null;
  let autoResumeStorageError = false;    // 存储不可用：放弃自动开组，提示手动继续
  let autoResumeReturnSnap = null;       // 自动开组前上一组完成页现场（含撤销栈内存副本）
  let autoResumeReturnArmed = false;     // 新组首个有效判定前「返回上一组结果」可用
  let autoResumeReturnFromWait = false; // 空页等待启动的返回入口不能冒充上一组结果
  let autoResumeEmptyWaitBook = null;   // 用户显式开启的本页等待资格；不持久化、不伪造完成组
  let autoResumeStarting = false;        // 自动开组进行中：startSession 不清返回现场
  // 「今天暂停自动续背」的 localStorage 缓存（AUTO_RESUME_PAUSE_KEY）；首次读取后常驻内存。
  const autoResumePauseStore = {loaded: false, readable: false, map: {}};
  const autoResumePausePending = new Map(); // 暂停键写失败时的本页增删；强制重读也不能抹掉用户操作
  const autoResumeLegacyBooks = new Set();     // 旧记录缺 autoResume 的书：设置页提示推荐方案
  let autoResumeLastRenderKey = "";
  let autoResumeLastRenderAt = 0;
  let autoResumeScrollInputAt = -Infinity; // 将真实滚动关联到输入，布局/滚动锚点的scroll不算交互

  function newSeed(){ return (Math.random() * 0x7fffffff) | 0; }

  /** 错词本：wrong>0 且未熟练。按错次降序、词频升序，不看当前筛选范围 */
  function wrongWordIndices(){
    const out = [];
    for (let i = 0; i < W.length; i++) {
      if (isProficient(i)) continue;
      const p = st(i);
      if (p && p[3] > 0) out.push(i);
    }
    out.sort((a, b) => (st(b)[3] - st(a)[3]) || (W[a].r - W[b].r));
    return out;
  }

  /* ================= 打印生词本（纯逻辑） ================= */
  /** TXT 导出：scope 对应设置页范围，filter 对应词表当前搜索/状态/范围。 */
  function wordBookTxt(source = "scope"){
    let indices;
    if (source === "filter") {
      applyFilter(false);
      indices = filt.slice();
    } else {
      indices = [];
      for (let i = 0; i < W.length; i++) if (inScope(i) && !isProficient(i)) indices.push(i);
      indices.sort((a, b) => W[a].r - W[b].r);
    }
    const words = indices.map(i => W[i].w);
    return words.length ? words.join("\n") + "\n" : "";
  }
  function exportWordBookTxt(source = "scope"){
    // 熟练名单以最新的独立存储为准，避免另一个窗口刚标记的熟练词漏排。
    try { syncProficientFromStorage(); } catch (e) { /* 保留当前内存中的名单 */ }
    const content = wordBookTxt(source);
    if (!content) { toast("当前范围没有可导出的单词，请调整筛选条件"); return false; }
    const count = content.trimEnd().split("\n").length;
    const a = document.createElement("a");
    const url = URL.createObjectURL(new Blob([content], {type: "text/plain;charset=utf-8"}));
    a.href = url;
    a.download = currentBook().name + (source === "filter" ? (statsDrill ? "_下钻筛选_" : "_筛选结果_") : "_背诵范围_") + count + "词_" + todayStr() + ".txt";
    document.body.appendChild(a);
    a.click();
    a.remove?.();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast("已导出 " + count + " 词，每行一个单词");
    return true;
  }
  /** 拆分只切连续区间，不改变导出顺序；均分时多出的词依次分给前几份。 */
  function splitTxtWords(words, mode, amount){
    if (!Array.isArray(words)) throw new Error("词表格式不正确");
    if (!["words", "parts"].includes(mode)) throw new Error("请选择拆分方式");
    if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("请输入大于 0 的整数");
    if (!words.length) return [];
    if (mode === "parts" && amount > words.length) throw new Error("份数不能超过单词总数");
    const count = mode === "parts" ? amount : Math.ceil(words.length / amount);
    const base = Math.floor(words.length / count), extra = words.length % count;
    const parts = [];
    let start = 0;
    for (let i = 0; i < count; i++) {
      const size = mode === "words" ? Math.min(amount, words.length - start) : base + (i < extra ? 1 : 0);
      parts.push(words.slice(start, start + size));
      start += size;
    }
    return parts;
  }
  let txtSplitContext = null, txtSplitPage = 0;
  const TXT_SPLIT_PAGE_SIZE = 20;
  function downloadWordBookFile(name, content, type){
    const url = URL.createObjectURL(new Blob([content], {type}));
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove?.();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  function renderTxtSplitFiles(){
    const files = txtSplitContext ? txtSplitContext.files : [];
    const pages = Math.max(1, Math.ceil(files.length / TXT_SPLIT_PAGE_SIZE));
    txtSplitPage = Math.min(Math.max(0, txtSplitPage), pages - 1);
    const start = txtSplitPage * TXT_SPLIT_PAGE_SIZE;
    $("#txtSplitFiles").innerHTML = files.slice(start, start + TXT_SPLIT_PAGE_SIZE).map((file, n) =>
      '<div class="txt-split-file"><div><b>第 ' + (start + n + 1) + ' 份 · ' + file.count + ' 词</b>' +
      '<small>第 ' + file.start + '–' + file.end + ' 个单词</small></div>' +
      '<button type="button" class="btn ghost sm" data-txt-part="' + (start + n) + '" aria-label="下载第 ' + (start + n + 1) + ' 份 TXT">下载 TXT</button></div>'
    ).join("");
    $("#txtSplitPager").hidden = pages <= 1;
    $("#txtSplitPrev").disabled = txtSplitPage === 0;
    $("#txtSplitNext").disabled = txtSplitPage >= pages - 1;
    $("#txtSplitPage").textContent = (txtSplitPage + 1) + " / " + pages + " 页";
  }
  function renderTxtSplit(){
    if (!txtSplitContext) return [];
    txtSplitPage = 0;
    const mode = $("#txtSplitMode").value, raw = $("#txtSplitAmount").value.trim();
    const summary = $("#txtSplitSummary"), zip = $("#txtSplitZip");
    $("#txtSplitAmountLabel").textContent = mode === "parts" ? "分成几份" : "每份最多词数";
    if (mode === "parts") $("#txtSplitAmount").max = String(txtSplitContext.words.length);
    else $("#txtSplitAmount").removeAttribute?.("max");
    try {
      const parts = splitTxtWords(txtSplitContext.words, mode, raw ? Number(raw) : NaN);
      const width = String(txtSplitContext.words.length).length;
      const partWidth = Math.max(2, String(parts.length).length);
      let offset = 0;
      txtSplitContext.files = parts.map((words, i) => {
        const start = offset + 1, end = offset + words.length; offset = end;
        return {
          name: txtSplitContext.prefix + "_第" + String(i + 1).padStart(partWidth, "0") + "份_"
            + String(start).padStart(width, "0") + "-" + String(end).padStart(width, "0")
            + "_" + words.length + "词_" + txtSplitContext.date + ".txt",
          text: words.join("\n") + "\n", count: words.length, start, end
        };
      });
      summary.textContent = "共 " + txtSplitContext.words.length + " 词，将拆为 " + parts.length + " 份。"
        + (mode === "words" ? "每份最多 " + raw + " 词，最后一份保留余词。" : "各份词数相差不超过 1。");
      zip.disabled = !parts.length;
    } catch (e) {
      txtSplitContext.files = [];
      summary.textContent = e.message;
      zip.disabled = true;
    }
    renderTxtSplitFiles();
    return txtSplitContext.files;
  }
  function openTxtSplit(source = "scope"){
    try { syncProficientFromStorage(); } catch (e) { /* 保留内存中的名单 */ }
    const text = wordBookTxt(source);
    if (!text) { toast("当前范围没有可导出的单词，请调整筛选条件"); return false; }
    if (activeSheet) closeSheet();
    txtSplitContext = {
      bookId: currentBookId, prefix: currentBook().name + (source === "filter" ? (statsDrill ? "_下钻筛选" : "_筛选结果") : "_背诵范围"),
      date: todayStr(), words: text.trimEnd().split("\n"), files: []
    };
    $("#txtSplitSource").textContent = currentBook().name + " · " + (source === "filter" ? "当前筛选结果" : "当前背诵范围")
      + " · 共 " + txtSplitContext.words.length + " 词";
    $("#txtSplitMode").value = "words";
    $("#txtSplitAmount").value = String(TXT_SPLIT_DEFAULT);
    renderTxtSplit();
    openSheet("#txtSplitSheet");
    return true;
  }
  function downloadTxtPart(index){
    const file = txtSplitContext && txtSplitContext.files[index];
    if (!Number.isInteger(index) || !file || txtSplitContext.bookId !== currentBookId) return false;
    downloadWordBookFile(file.name, file.text, "text/plain;charset=utf-8");
    toast("已下载第 " + (index + 1) + " 份（" + file.count + " 词）");
    return true;
  }
  function downloadTxtSplitZip(){
    if (!txtSplitContext || !txtSplitContext.files.length || txtSplitContext.bookId !== currentBookId) return false;
    try {
      if (typeof window.createTxtZipBytes !== "function") throw new Error("ZIP 组件未加载，请刷新后重试，或逐份下载 TXT");
      const bytes = window.createTxtZipBytes(txtSplitContext.files);
      downloadWordBookFile(txtSplitContext.prefix + "_" + txtSplitContext.files.length + "份_"
        + txtSplitContext.words.length + "词_" + txtSplitContext.date + ".zip", bytes, "application/zip");
      toast("已打包 " + txtSplitContext.files.length + " 份 TXT，解压后即可使用");
      return true;
    } catch (e) { toast(e.message || "打包失败，请逐份下载 TXT"); return false; }
  }
  const PRINT_SRC_LABEL = { wrong: "错词本", star: "收藏", filter: "筛选结果" };
  /** 导出/打印来源标签：统计下钻时明确标注是临时下钻词集，不冒充学习范围。 */
  function printSourceLabel(source){
    if (source === "filter" && statsDrill) return "筛选结果（统计下钻：" + statsDrill.label + "）";
    return PRINT_SRC_LABEL[source] || "错词本";
  }
  function printStatusLabel(i){
    const p = st(i);
    return isProficient(i) ? "熟练" : isMastered(i) ? "已掌握" : (hasMainProgress(p) ? "第" + p[0] + "档" : "未学");
  }
  function printMetaText(wrong, status, star){
    const parts = [];
    if (wrong > 0) parts.push("错 " + wrong + " 次");
    if (star) parts.push("收藏");
    parts.push(status || "未学");
    return parts.join(" · ");
  }
  /** source: "wrong" | "star" | "filter"（filter = 词表当前筛选结果） */
  function printBookEntries(source){
    let idx;
    if (source === "star") {
      idx = [];
      for (let i = 0; i < W.length; i++) if (isStar(i) && !isProficient(i)) idx.push(i);
      idx.sort((a, b) => W[a].r - W[b].r);
    } else if (source === "filter") {
      // 可能尚未打开过词表，或离开词表后又产生了新的学习记录。
      // 导出时按当前控件重新筛选，并保留词表滚动位置。
      applyFilter(false);
      idx = filt.slice();
    } else {
      idx = wrongWordIndices();
    }
    return idx.map(i => {
      const p = st(i), x = W[i];
      return {
        i, w: x.w, ph: x.ph || "", m: x.m || "",
        wrong: (p && p[3]) || 0,
        status: printStatusLabel(i),
        star: isStar(i)
      };
    });
  }
  function printBookMarkdown(entries, opts){
    opts = opts || {};
    const date = opts.date || todayStr();
    const label = opts.sourceLabel || PRINT_SRC_LABEL[opts.source] || "错词本";
    const list = entries || [];
    const lines = [
      "# " + currentBook().name + "生词本 · " + label,
      "",
      "日期：" + date + " · 共 " + list.length + " 词",
      ""
    ];
    for (const e of list) {
      const ph = e.ph ? " /" + e.ph + "/ " : " ";
      lines.push("- [ ] **" + e.w + "**" + ph + " " + (e.m || "—") +
        "（" + printMetaText(e.wrong, e.status, e.star) + "）");
    }
    lines.push("");
    return lines.join("\n");
  }

  /** 特训判定：只调错次 p[3]，不动学习档位 p[0]/到期时间 p[1]，不占今日新词额度 */
  function applyDrill(i, known){
    const prev = st(i), p = prev ? prev.slice() : [0, 0, 0, 0, 0];
    p[3] = known ? Math.max(0, p[3] - 1) : p[3] + 1;
    S.progress[i] = p;
    const d = day();
    if (known) d.ok++; else d.no++;
    d.r++;
  }

  /* ================= 学习热力图（纯函数） ================= */
  /** 当日学习量分级：vol = 新词 + 复习次数 = 当日总作答次数 r */
  function heatLevel(vol){
    if (!(vol > 0)) return 0;
    if (vol <= 4) return 1;
    if (vol <= 9) return 2;
    if (vol <= 19) return 3;
    return 4;
  }
  /**
   * 近 weeks 周学习热力（含本周；本周尚未到来的日子标记 future）。
   * 返回 cells：按时间升序，长度 weeks*7；每项 {date, n, r, ok, no, vol, level, future, weekday}。
   * 列=周、行=星期；cells[k] 的 weekday = k % 7（起点为周日）。
   */
  function heatmapData(days, todayKey, weeks){
    if (!/^\d{4}-\d{2}-\d{2}$/.test(todayKey || "")) throw new Error("热力图日期不正确");
    const t = new Date(todayKey + "T12:00:00");
    if (Number.isNaN(t.getTime()) || todayStr(t) !== todayKey) throw new Error("热力图日期不正确");
    weeks = Math.min(26, Math.max(1, Math.floor(weeks) || 12));
    const dow = t.getDay();
    const end = new Date(t); end.setDate(t.getDate() + (6 - dow));
    const start = new Date(end); start.setDate(end.getDate() - (weeks * 7 - 1));
    const cells = [];
    for (let k = 0; k < weeks * 7; k++) {
      const d = new Date(start); d.setDate(start.getDate() + k);
      const date = todayStr(d);
      const rec = (days && days[date]) || null;
      const n = rec ? rec.n : 0, r = rec ? rec.r : 0;
      const ok = rec ? rec.ok : 0, no = rec ? rec.no : 0;
      const vol = r; // 新词 + 复习次数
      cells.push({ date, n, r, ok, no, vol, level: heatLevel(vol), future: date > todayKey, weekday: d.getDay() });
    }
    return cells;
  }

  /** 主组混排：shuffle 整体打乱；freq/wrong 保持「5 到期 + 1 新词」节奏（只在切片后的数组上）。 */
  function assembleMainMix(dueTake, freshTake){
    if (S.settings.order === "shuffle") return shuffle(dueTake.concat(freshTake), sessionSeed + 2);
    const mix = [];
    let a = 0, b = 0;
    while (a < dueTake.length || b < freshTake.length) {
      for (let k = 0; k < 5 && a < dueTake.length; k++) mix.push(dueTake[a++]);
      if (b < freshTake.length) mix.push(freshTake[b++]);
      if (a >= dueTake.length && b >= freshTake.length) break;
    }
    return mix;
  }
  /** 本组范围快照：词下标集合；当前组内改范围设置不追溯，queue 仍按开始时的范围走。 */
  function buildSessionScopeSet(){
    const set = new Set();
    for (let i = 0; i < W.length; i++) if (inScope(i)) set.add(i);
    return set;
  }
  function sessionScopeHas(i){
    return sessionScopeSet ? sessionScopeSet.has(i) : inScope(i);
  }
  /* ---- 22 自动续背：会话层重置（换组/切书/隐藏/跨天时清空等待与倒计时） ---- */
  function resetAutoResumeRuntime(){
    autoResumePhase = "idle";
    autoResumeDeadline = 0;
    autoResumeIdleSince = null;
    autoResumeCheckCache = null;
    autoResumeLastReason = "";
    autoResumeLastRenderKey = "";
    autoResumeLastRenderAt = 0;
    renderAutoResume();
  }
  /**
   * 开始一组学习。
   * - kind="main"（默认）：按 sessionPlan.groupSize 组装——先取 min(groupSize, due.length) 张到期，
   *   剩余槽位补新词；未进组的到期词保持到期状态（不改 progress/不清队列）。
   * - kind="extra"（23 临时加量）/ "newOnly"（07 纯新词子组）：只学新词，越过积压保护，
   *   排除原主组未答队列里的词，按剩余有效目标额度取词；父组现场由调用方用快照保存。
   * 注意 onclick 直接绑定会传入事件对象，因此只认字符串 kind，其余都按 main。
   */
  function startSession(kind){
    kind = kind === "extra" ? "extra" : kind === "newOnly" ? "newOnly" : "main";
    autoResumeEmptyWaitBook = null;
    if (!autoResumeStarting) {
      // 22：手动开新组/继续下一组时，不再保留上一组完成页的「返回上一组结果」。
      autoResumeReturnSnap = null;
      autoResumeReturnArmed = false;
      autoResumeReturnFromWait = false;
    }
    drillMode = false;
    mainSnap = null;
    capGroupEnded = false;
    if (kind === "main") {
      extraSubgroup = false; extraSnap = null;
      newOnlySubgroup = false; newOnlySnap = null;
    } else if (kind === "extra") {
      extraSubgroup = true; newOnlySubgroup = false; newOnlySnap = null;
    } else {
      newOnlySubgroup = true; extraSubgroup = false; extraSnap = null;
    }
    // 本组冻结调度配置（曲线/每组词数）：之后设置只影响下一组；已有 progress 的 p[1] 不追溯重排。
    sessionPlan = createSessionPlan(kind);
    sessionScopeSet = buildSessionScopeSet();
    sessionSeed = newSeed();
    const queue = buildQueue();
    const plannedGroupSize = Number.isInteger(sessionPlan.groupSize) ? sessionPlan.groupSize
      : Number.isInteger(S.settings.groupSize) ? S.settings.groupSize : GROUP_SIZE_DEFAULT;
    const groupSize = Math.max(GROUP_SIZE_MIN, Math.min(GROUP_SIZE_MAX, plannedGroupSize));
    let mix;
    if (kind === "main") {
      const dueTake = queue.due.slice(0, Math.min(groupSize, queue.due.length));
      const slots = Math.max(0, groupSize - dueTake.length);
      const freshTake = queue.fresh.slice(0, Math.min(slots, queue.fresh.length));
      mix = assembleMainMix(dueTake, freshTake);
    } else {
      const snapshot = kind === "extra" ? extraSnap : newOnlySnap;
      const pendingMain = snapshot ? new Set(snapshot.Q.slice(snapshot.qi)) : null;
      let fresh = orderFreshPool(queue.freshPool);
      if (pendingMain) fresh = fresh.filter(i => !pendingMain.has(i));
      let quota = Math.max(0, effectiveNewTarget() - day().n);
      if (snapshot) {
        // 原主组未答队列里尚未学的新词仍会算进今日目标（恢复原组时继续学），
        // 子组只补「原队列之外」的剩余额度，避免同一目标被两组重复学习/超额。
        // extra 子组由此只剩本次加量部分；newOnly 子组由此只剩原队列之外的计划内新词。
        let pendingUnlearned = 0;
        for (const i of snapshot.Q.slice(snapshot.qi)) if (!hasMainProgress(st(i))) pendingUnlearned++;
        quota = Math.max(0, quota - pendingUnlearned);
      }
      mix = fresh.slice(0, quota);
    }
    Q = mix; qi = 0; rounds = {}; answered = 0; rightN = 0;
    groupTotal = Q.length;
    undoStack = [];
    // 15：显式开新组/继续下一组 → 退出上一次刷新恢复现场，改写本组快照。
    resumeNoticePending = null;
    // 22：换组后清空自动续背等待/倒计时（自动开组本身也走这里，随后由调用方设置返回现场）。
    resetAutoResumeRuntime();
    nextCard();
    updateBar();
    renderDrillEntry();
    renderResumeNotice();
    persistSessionSnapshot();
    if ($("#v-set")?.classList.contains("on")) renderSettingsLifecycle();
  }

  /** 保存当前主会话现场（临时加量子组返回时用；与特训 mainSnap 同一套基线思路）。 */
  function captureSessionSnapshot(){
    return {
      Q: Q.slice(), qi, rounds: Object.assign({}, rounds), cur,
      answered, rightN, groupTotal, verdict, snap, phase, stageBefore,
      undoStack: undoStack.slice(), autoSpoken, sessionPlan,
      scopeSet: sessionScopeSet ? Array.from(sessionScopeSet) : null,
      drillBaseline: {
        wrong: Object.fromEntries(Object.entries(S.progress).map(([i, p]) => [i, p[3]])),
        days: Object.fromEntries(Object.entries(S.days).map(([date, d]) => [date, Object.assign({}, d)]))
      }
    };
  }

  /**
   * 23 从额度暂停页（或完成页，供 22 复用）进入只含额外新词的受控子组：
   * 保存原主组现场（含未答位置、待巩固、撤销栈与冻结曲线），不伪装完成、不嵌套。
   */
  function startExtraSubgroup(){
    if (inSubgroup() || drillMode) return false;               // 不嵌套、不抢占特训
    if (activeSheet || ($("#exPop") && $("#exPop").hidden === false)) return false;  // 浮层期间不抢占
    if (cur != null && !computeCapPaused()) {
      toast("请先完成当前这张卡，再进入临时加量子组");
      return false;
    }
    const remaining = Math.max(0, effectiveNewTarget() - day().n);
    if (remaining <= 0) {
      toast("今日新词目标已完成，可先加量再学");
      renderExtraSurfaces();
      return false;
    }
    const snapshot = captureSessionSnapshot();
    const pending = new Set(snapshot.Q.slice(snapshot.qi));
    let candidates = 0;
    for (let i = 0; i < W.length; i++) {
      if (!inScope(i) || isProficient(i) || hasMainProgress(st(i)) || pending.has(i)) continue;
      candidates++;
    }
    if (!candidates) {
      toast("当前范围没有可学的额外新词");
      renderExtraSurfaces();
      return false;
    }
    clearSessionSnapshot(currentBookId);   // 15：进入受控子组前清主组快照
    extraSnap = snapshot;
    extraSubgroup = true;
    startSession("extra");
    if (!Q.length) {           // 极端情况下没有建成：回滚到原现场
      endExtraSubgroup();
      toast("当前范围没有可学的额外新词");
      return false;
    }
    renderExtraSurfaces();
    toast("已进入临时加量子组：只学新词，完成后回到原组");
    return true;
  }

  /** 恢复任一受控子组保存的父组现场（子组写入的进度/日统计保留，撤销父组不会抹掉）。 */
  function restoreSessionSnapshot(s){
    rebaseMainSnapshots(s);
    Q = s.Q.slice();
    qi = s.qi;
    rounds = s.rounds;
    answered = s.answered;
    rightN = s.rightN;
    groupTotal = s.groupTotal || Q.length;
    undoStack = s.undoStack;
    verdict = s.verdict;
    snap = s.snap;
    phase = s.phase;
    stageBefore = s.stageBefore;
    autoSpoken = s.autoSpoken;
    sessionPlan = s.sessionPlan && s.sessionPlan.bookId === currentBookId
      ? s.sessionPlan : createSessionPlan("main");
    sessionScopeSet = Array.isArray(s.scopeSet) ? new Set(s.scopeSet) : buildSessionScopeSet();
    drillMode = false;
    capGroupEnded = false;
    if (qi < Q.length && Q[qi] === cur && !isProficient(cur)) renderCard();
    else nextCard();
  }

  /** 结束临时加量子组，回到原主组现场（暂停态按当时额度重新派生；不清空子组进度）。 */
  function endExtraSubgroup(){
    if (!extraSubgroup) return false;
    extraSubgroup = false;
    const s = extraSnap;
    extraSnap = null;
    if (s) restoreSessionSnapshot(s);
    else startSession();
    persistSessionSnapshot();
    updateBar();
    renderDrillEntry();
    renderExtraSurfaces();
    renderGroupSurfaces();
    toast(isCapPaused()
      ? "已回到原组：今日复习额度已用完，可提高上限或明天继续"
      : "已回到原组");
    return true;
  }

  /**
   * 07 纯新词子组（kind="newOnly"）：积压保护生效或复习额度暂停时，用户主动「仍学今日计划内新词」。
   * 用剩余有效新词额度取 freshPool（不因复习预算耗尽而挡住），保存原组现场，结束回原现场、不嵌套。
   */
  function startNewOnlySubgroup(){
    if (inSubgroup() || drillMode) return false;               // 不嵌套、不抢占特训
    if (activeSheet || ($("#exPop") && $("#exPop").hidden === false)) return false;  // 浮层期间不抢占
    if (cur != null && !computeCapPaused()) {
      toast("请先完成当前这张卡，再进入纯新词子组");
      return false;
    }
    const remaining = Math.max(0, effectiveNewTarget() - day().n);
    if (remaining <= 0) {
      toast("今日计划内新词已学完，如需继续可用临时加量");
      renderGroupSurfaces();
      return false;
    }
    const snapshot = captureSessionSnapshot();
    const pending = new Set(snapshot.Q.slice(snapshot.qi));
    let candidates = 0;
    for (let i = 0; i < W.length; i++) {
      if (!inScope(i) || isProficient(i) || hasMainProgress(st(i)) || pending.has(i)) continue;
      candidates++;
    }
    if (!candidates) {
      toast("当前范围没有可学的新词");
      renderGroupSurfaces();
      return false;
    }
    clearSessionSnapshot(currentBookId);   // 15：进入受控子组前清主组快照
    newOnlySnap = snapshot;
    newOnlySubgroup = true;
    startSession("newOnly");
    if (!Q.length) {           // 极端情况下没有建成：回滚到原现场
      endNewOnlySubgroup();
      toast("当前范围没有可学的新词");
      return false;
    }
    renderGroupSurfaces();
    toast("已进入纯新词子组：只学今日计划内新词，完成后回到原组");
    return true;
  }

  /** 结束纯新词子组，回到原主组现场（积压保护/暂停态按最新数据重新派生）。 */
  function endNewOnlySubgroup(){
    if (!newOnlySubgroup) return false;
    newOnlySubgroup = false;
    const s = newOnlySnap;
    newOnlySnap = null;
    if (s) restoreSessionSnapshot(s);
    else startSession();
    persistSessionSnapshot();
    updateBar();
    renderDrillEntry();
    renderExtraSurfaces();
    renderGroupSurfaces();
    toast(isCapPaused()
      ? "已回到原组：今日复习额度已用完，可提高上限或明天继续"
      : "已回到原组");
    return true;
  }

  /** 结束当前受控子组（暂停面板「返回原组」等入口用）：extra/newOnly 派发。 */
  function endActiveSubgroup(){
    if (extraSubgroup) return endExtraSubgroup();
    if (newOnlySubgroup) return endNewOnlySubgroup();
    return false;
  }

  /** 错词特训：独立队列；保存主会话，退出时原样恢复 */
  function startDrill(){
    const list = wrongWordIndices();
    if (!list.length) {
      toast("错词本为空，先在背诵中积累错词吧");
      return false;
    }
    if (!drillMode) {
      mainSnap = {
        Q: Q.slice(), qi, rounds: Object.assign({}, rounds), cur,
        answered, rightN, groupTotal, verdict, snap, phase, stageBefore,
        undoStack: undoStack.slice(), autoSpoken, sessionPlan,
        scopeSet: sessionScopeSet ? Array.from(sessionScopeSet) : null,
        drillBaseline: {
          wrong: Object.fromEntries(Object.entries(S.progress).map(([i, p]) => [i, p[3]])),
          days: Object.fromEntries(Object.entries(S.days).map(([date, d]) => [date, Object.assign({}, d)]))
        }
      };
    }
    clearSessionSnapshot(currentBookId);   // 15：进入特训 = 明确退出刷新恢复现场
    drillMode = true;
    Q = list; qi = 0; rounds = {}; answered = 0; rightN = 0;
    groupTotal = Q.length;
    undoStack = [];
    nextCard();
    updateBar();
    renderDrillEntry();
    return true;
  }

  /**
   * 特训已写入同一份 progress/days。把这些增量补进暂停的主会话快照，
   * 这样返回后改判或撤销主会话，只回滚主会话本身，不会抹掉特训成果。
   */
  function rebaseMainSnapshots(s){
    if (!s.drillBaseline) return;
    const base = s.drillBaseline;
    const wrongDelta = new Map();
    for (const i of new Set(Object.keys(base.wrong).concat(Object.keys(S.progress)))) {
      const delta = ((S.progress[i] && S.progress[i][3]) || 0) - (base.wrong[i] || 0);
      if (delta) wrongDelta.set(+i, delta);
    }
    const dayDelta = {};
    for (const date of new Set(Object.keys(base.days).concat(Object.keys(S.days)))) {
      const before = base.days[date] || {}, after = S.days[date] || {};
      const delta = {};
      for (const k of ["n", "r", "ok", "no"]) delta[k] = (after[k] || 0) - (before[k] || 0);
      if (Object.values(delta).some(v => v !== 0)) dayDelta[date] = delta;
    }
    const seen = new Set();
    function rebase(record, i){
      // snap 和 originalSnap 可能被多个撤销条目共享，只能补一次。
      if (!record || seen.has(record)) return;
      seen.add(record);
      const delta = wrongDelta.get(i) || 0;
      // 抵消量可为负，必须保留到重放主判定之后再取零下界。
      // 提前截断会让“主不会→特训会→主改会→主改不会”重新长出已清零的错次。
      if (delta) record.drillWrongDelta = (record.drillWrongDelta || 0) + delta;
      for (const date of Object.keys(record.days)) {
        if (!dayDelta[date]) continue;
        const next = Object.assign({n:0, r:0, ok:0, no:0}, record.days[date]);
        for (const k of ["n", "r", "ok", "no"]) next[k] += dayDelta[date][k];
        record.days[date] = next;
      }
      if (record.days[record.date]) record.day = Object.assign({}, record.days[record.date]);
    }
    rebase(s.snap, s.cur);
    for (const u of s.undoStack) {
      rebase(u.snap, u.i);
      rebase(u.originalSnap, u.i);
    }
  }

  /** 退出特训：恢复进入前的主背诵会话，不影响今日新词额度 */
  function exitDrill(){
    if (!drillMode) return false;
    drillMode = false;
    const s = mainSnap;
    mainSnap = null;
    if (s) {
      rebaseMainSnapshots(s);
      Q = s.Q.slice();
      qi = s.qi;
      rounds = s.rounds;
      answered = s.answered;
      rightN = s.rightN;
      groupTotal = s.groupTotal || Q.length;
      undoStack = s.undoStack;
      verdict = s.verdict;
      snap = s.snap;
      phase = s.phase;
      stageBefore = s.stageBefore;
      autoSpoken = s.autoSpoken;
      cur = s.cur;
      if (Array.isArray(s.scopeSet)) sessionScopeSet = new Set(s.scopeSet);
      // 特训期间若把主队列当前词标为熟练，返回时对齐队列
      if (qi < Q.length && Q[qi] === cur && !isProficient(cur)) renderCard();
      else nextCard();
      updateBar();
    } else {
      startSession();
    }
    persistSessionSnapshot();
    renderDrillEntry();
    toast("已退出错词特训，回到普通背诵");
    return true;
  }

  /* ================= 16 拼写专项（模态 #spellingSheet；只写 state.spelling） =================
   * 入口：背诵完成页「拼写专项（N 词）」→ sheet。主组 Q/cur/undo/sessionPlan 完全不碰，
   * 关闭即回原完成页；sheet 打开期间 autoResumeEligiblePage 因 activeSheet 为 false，不触发自动续背。
   * 隔离：只写 S.spelling（每书独立）；不写 progress/days/reviewDay/extraDay/stars/proficient/timeSec，
   * 不判定、不消费额度、不推进主 SRS。
   */
  let spellingSession = null;

  /** 拼写比较用规范化：弯撇号→直撇号、trim、折叠空白、小写。 */
  function spellClean(v){
    return String(v == null ? "" : v)
      .replace(/[’‘`´]/g, "'")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }
  /** 分隔符宽松比较：去掉空格/连字符/撇号后再比（用于「连字符/空格差异」明确说明）。 */
  function spellLoose(v){ return spellClean(v).replace(/[\s'\-‐‑–—]/g, ""); }
  /** 首个不同字符位置（1 基）；完全相同返回 0，前缀返回较短长度 +1。 */
  function spellFirstDiff(user, want){
    const a = String(user || ""), b = String(want || "");
    const n = Math.min(a.length, b.length);
    for (let k = 0; k < n; k++) if (a[k] !== b[k]) return k + 1;
    return a.length === b.length ? 0 : n + 1;
  }
  /**
   * 拼写判定纯函数：精确（忽略大小写/空白）→ 显式英美变体表 → 分隔符宽松 → 判错。
   * 不做模糊容错/自动纠错；接受变体或宽松匹配时必须带说明（不静默判对）。
   */
  function spellCompare(input, expected){
    const wanted = String(expected == null ? "" : expected).trim();
    const raw = typeof input === "string" ? input : String(input == null ? "" : input);
    const user = spellClean(raw);
    const want = spellClean(wanted);
    if (!user) {
      return {correct: false, status: "empty", input: raw.trim(), expected: wanted,
        note: "请输入拼写后再提交", firstDiff: null};
    }
    if (user === want) {
      const caseOnly = raw.trim() !== wanted;
      return {correct: true, status: caseOnly ? "case" : "exact", input: raw.trim(), expected: wanted,
        note: caseOnly ? "已忽略大小写/多余空白差异（词库拼写：" + wanted + "）" : "", firstDiff: null};
    }
    for (const variant of SPELLING_VARIANTS.get(want) || []) {
      if (user === spellClean(variant.word)) {
        return {correct: true, status: "variant", input: raw.trim(), expected: wanted, variant: variant.word,
          note: "已接受" + variant.label + "拼写：" + variant.word + "（词库用 " + wanted + "）", firstDiff: null};
      }
    }
    if (spellLoose(raw) === spellLoose(wanted)) {
      return {correct: true, status: "relaxed", input: raw.trim(), expected: wanted,
        note: "已忽略空格/连字符/撇号差异；词库拼写为 " + wanted, firstDiff: null};
    }
    return {correct: false, status: "wrong", input: raw.trim(), expected: wanted, note: "",
      firstDiff: spellFirstDiff(user, want)};
  }
  /**
   * 专项只读中文题面：去掉词性缩写、英文搭配（含答案/变体），保留混合括号中的中文。
   * 不直接复用主释义，也不把答案放进隐藏节点/可访问属性；没有中文时不生成题目。
   */
  function spellingChineseHint(x){
    let hint = String(x && x.m || "")
      .replace(/[A-Za-z\u00c0-\u024f\uff21-\uff3a\uff41-\uff5a]+(?:['’\-‐‑][A-Za-z\u00c0-\u024f\uff21-\uff3a\uff41-\uff5a]+)*\.?/g, "")
      .replace(/[\/\\|]+/g, " ");
    // 逐层清理英文留下的空括号；不能连中文说明一起整段删除。
    let previous;
    do {
      previous = hint;
      hint = hint.replace(/（[^（）]*）|\([^()]*\)|【[^【】]*】|\[[^\[\]]*\]/g,
        part => /[\u3400-\u9fff\d]/.test(part) ? part : "");
    } while (hint !== previous);
    hint = hint
      .replace(/([（(【\[])[\s,，;；:：·、]+/g, "$1")
      .replace(/[\s,，;；:：·、]+([）)】\]])/g, "$1")
      .replace(/([,，;；、])[\s,，;；、]+/g, "$1")
      .replace(/\s+([,，;；、）)】\]])/g, "$1")
      .replace(/\s+/g, " ")
      .replace(/^[\s.,，;；:：·、]+|[\s.,，;；:：·、]+$/g, "");
    return /[\u3400-\u9fff]/.test(hint) ? hint : "";
  }
  /** 候选口径：当前书 + 当前范围 + 非熟练 + 有效中文题面；已学优先，不足补未学。 */
  function spellingCandidateStats(){
    let learned = 0, fresh = 0, skippedNoHint = 0;
    for (let i = 0; i < W.length; i++) {
      if (!inScope(i) || isProficient(i)) continue;
      if (!spellingChineseHint(W[i])) { skippedNoHint++; continue; }
      if (hasMainProgress(st(i))) learned++; else fresh++;
    }
    const total = learned + fresh;
    return {learned: learned, fresh: fresh, total: total, size: Math.min(SPELLING_ROUND_SIZE, total),
      skippedNoHint: skippedNoHint};
  }
  function pickSpellingIndices(){
    const stats = spellingCandidateStats();
    if (!stats.size) return {queue: [], mixed: false, learnedCount: 0, stats: stats};
    const learned = [], fresh = [];
    for (let i = 0; i < W.length; i++) {
      if (!inScope(i) || isProficient(i) || !spellingChineseHint(W[i])) continue;
      (hasMainProgress(st(i)) ? learned : fresh).push(i);
    }
    const wantLearned = Math.min(learned.length, stats.size);
    const picked = shuffle(learned, newSeed()).slice(0, wantLearned);
    const need = stats.size - picked.length;
    const pickedFresh = need > 0 ? shuffle(fresh, newSeed() + 7).slice(0, Math.min(need, fresh.length)) : [];
    return {queue: picked.concat(pickedFresh), mixed: pickedFresh.length > 0,
      learnedCount: picked.length, stats: stats};
  }
  function currentSpellingWord(){
    if (!spellingSession) return null;
    const i = spellingSession.queue[spellingSession.index];
    return i == null ? null : W[i] || null;
  }
  function spellingProgressText(){
    const s = spellingSession;
    if (!s) return "";
    const total = s.queue.length;
    if (s.phase === "done") return "本组完成 · 共 " + total + " 词";
    return "第 " + Math.min(s.index + 1, total) + " / " + total + " 词";
  }
  function focusSpellInput(clear){
    const input = $("#spellInput");
    if (!input) return;
    try {
      if (clear) input.value = "";
      input.focus?.({preventScroll: true});
      input.scrollIntoView?.({block: "nearest"});
    } catch (e) { /* 测试桩/旧浏览器忽略 */ }
  }
  function beginSpellingSession(){
    const plan = pickSpellingIndices();
    if (!plan.queue.length) {
      toast(plan.stats.skippedNoHint
        ? "当前范围的候选词缺少有效中文提示，已跳过；可调整筛选后再练习"
        : "当前范围没有可用于拼写练习的词；可调整筛选或取消熟练标记");
      return false;
    }
    spellingSession = {
      bookId: currentBookId,
      queue: plan.queue.slice(),
      index: 0,
      phase: "input",
      results: [],
      attempts: 0,
      correct: 0,
      skipped: 0,
      mixed: plan.mixed,
      learnedCount: plan.learnedCount,
      totalCandidates: plan.stats.total,
      skippedNoHint: plan.stats.skippedNoHint,
      startedAt: Date.now()
    };
    renderSpellingSession();
    return true;
  }
  /** 完成页入口：主组现场（完成页/撤销栈）完全不改；只打开独立 sheet。 */
  function startSpellingDrill(){
    if (drillMode || inSubgroup()) { toast("请先退出错词特训或子组，再开始拼写专项"); return false; }
    if (activeSheet) { toast("请先关闭当前浮层，再开始拼写专项"); return false; }
    if (cur != null) { toast("请先完成当前这张卡，再开始拼写专项"); return false; }
    if (!beginSpellingSession()) return false;
    openSheet("#spellingSheet");
    focusSpellInput(true);
    return true;
  }
  /** 结果页「再来一组」：留在 sheet 内换一组，不重复记账上一组。 */
  function restartSpellingDrill(){
    if (!spellingSession) return startSpellingDrill();
    spellingSession = null;
    if (!beginSpellingSession()) return false;
    focusSpellInput(true);
    return true;
  }
  function spellFeedbackHtml(s){
    const last = s.results[s.results.length - 1];
    if (!last) return "";
    const answer = '<span lang="en"><b>' + esc(last.w) + "</b></span>";
    if (last.status === "skipped") return '<p class="spell-no"><b>已跳过</b> · 正确拼写：' + answer + "</p>";
    if (last.correct) {
      return '<p class="spell-ok"><b>拼写正确</b> · ' + answer + "</p>"
        + (last.note ? '<p class="spell-note">' + esc(last.note) + "</p>" : "");
    }
    return '<p class="spell-no"><b>拼写不正确</b></p>'
      + '<p class="spell-answer">你的答案：<code>' + esc(last.input || "（空）") + "</code></p>"
      + '<p class="spell-answer">正确拼写：' + answer + "</p>"
      + (last.firstDiff ? '<p class="spell-note">从第 ' + last.firstDiff + " 个字符起不同。</p>" : "");
  }
  function renderSpellingSession(){
    const s = spellingSession;
    const sheet = $("#spellingSheet");
    if (!s || !sheet) return;
    const progress = $("#spellProgress");
    const groupNote = $("#spellGroupNote");
    const prompt = $("#spellPrompt");
    const form = $("#spellForm");
    const feedback = $("#spellFeedback");
    const actions = $("#spellActions");
    const result = $("#spellResult");
    if (progress) progress.textContent = spellingProgressText();
    if (s.phase === "done") {
      if (result) result.hidden = false;
      if (prompt) prompt.hidden = true;
      if (form) form.hidden = true;
      if (actions) actions.hidden = true;
      if (groupNote) groupNote.hidden = true;
      if (feedback) feedback.innerHTML = "";
      const line = $("#spellResultLine");
      if (line) {
        const acc = s.attempts ? Math.round(s.correct / s.attempts * 100) + "%" : "—";
        line.textContent = "正确 " + s.correct + " / 作答 " + s.attempts + "（跳过 " + s.skipped + "）"
          + " · 本组拼写正确率 " + acc;
      }
      const words = $("#spellResultWords");
      if (words) {
        const wrong = s.results.filter(r => r.status === "wrong");
        words.innerHTML = wrong.length
          ? '<p class="spell-result-sub">本组错词：</p><ul class="spell-wrong-list">' + wrong.map(r =>
              '<li><span class="spell-wrong-my">' + esc(r.input || "（空）") + '</span> → <b lang="en">'
              + esc(r.w) + "</b></li>").join("") + "</ul>"
          : '<p class="spell-result-sub">本组没有拼写错误' + (s.skipped ? "（跳过 " + s.skipped + " 词）" : "") + "。</p>";
      }
      return;
    }
    if (result) result.hidden = true;
    if (prompt) prompt.hidden = false;
    if (form) form.hidden = false;
    if (actions) actions.hidden = false;
    if (groupNote) {
      groupNote.hidden = false;
      const sourceNote = s.mixed
        ? "本组含 " + Math.max(0, s.queue.length - s.learnedCount) + " 个未学词：只练拼写，不记为学习进度。"
        : "本组词来自当前范围的已学词。";
      groupNote.textContent = sourceNote + (s.skippedNoHint
        ? " 已跳过 " + s.skippedNoHint + " 个缺少有效中文提示的词。" : "");
    }
    const x = currentSpellingWord();
    if (x) {
      const pos = $("#spellPos"); if (pos) pos.textContent = poslineText(x);
      const mean = $("#spellMean"); if (mean) mean.textContent = spellingChineseHint(x);
      const ph = $("#spellPh");
      if (ph) {
        const p = S.settings.showPh ? pronHtml(x) : "";
        ph.textContent = p || "";
        ph.hidden = !p;
      }
    }
    const auditing = s.phase === "feedback";
    const input = $("#spellInput"); if (input) input.disabled = auditing;
    const submit = $("#spellSubmit"); if (submit) submit.hidden = auditing;
    const next = $("#spellNext"); if (next) next.hidden = !auditing;
    const skip = $("#spellSkip"); if (skip) skip.hidden = auditing;
    if (feedback) feedback.innerHTML = auditing ? spellFeedbackHtml(s) : "";
    const hint = $("#spellHint");
    if (hint) {
      hint.textContent = auditing
        ? "按 Enter 或点「下一词」继续；本组词数 " + s.queue.length + " 词，及格与否只影响本组专项表现。"
        : "大小写不敏感；连字符/空格、撇号与常见英美变体会在反馈中说明。练习不占每日新词额度、不推进主学习档位，也不记为「已学」。";
    }
  }
  /** 提交当前拼写：空输入不判定不计数；反馈后焦点到「下一词」。 */
  function submitSpellingInput(){
    const s = spellingSession;
    if (!s || s.phase !== "input") return false;
    const input = $("#spellInput");
    const raw = input ? String(input.value == null ? "" : input.value) : "";
    if (raw.length > SPELLING_MAX_INPUT * 4) { toast("输入过长，请检查是否粘贴了整段文本"); return false; }
    const x = currentSpellingWord();
    if (!x) return false;
    const cmp = spellCompare(raw, x.w);
    if (cmp.status === "empty") {
      toast("请输入拼写后再提交");
      focusSpellInput(false);
      return false;
    }
    s.phase = "feedback";
    s.attempts++;
    if (cmp.correct) s.correct++;
    s.results.push({i: s.queue[s.index], w: x.w, input: cmp.input || raw.trim(), status: cmp.status,
      correct: !!cmp.correct, note: cmp.note || "", firstDiff: cmp.firstDiff || null});
    renderSpellingSession();
    $("#spellNext")?.focus?.({preventScroll: true});
    return true;
  }
  function skipSpellingWord(){
    const s = spellingSession;
    if (!s || s.phase !== "input") return false;
    const x = currentSpellingWord();
    s.skipped++;
    s.results.push({i: s.queue[s.index], w: x ? x.w : "", input: "", status: "skipped",
      correct: false, note: "", firstDiff: null});
    s.phase = "feedback";
    renderSpellingSession();
    $("#spellNext")?.focus?.({preventScroll: true});
    return true;
  }
  function nextSpellingWord(){
    const s = spellingSession;
    if (!s || s.phase !== "feedback") return false;
    if (s.index + 1 >= s.queue.length) return finishSpellingSession();
    s.index++;
    s.phase = "input";
    renderSpellingSession();
    focusSpellInput(true);
    return true;
  }
  /** 完成一组：累计写入每书 state.spelling（不含逐词明细），随备份 v3 导出；保存失败内存保留。 */
  function finishSpellingSession(){
    const s = spellingSession;
    if (!s) return false;
    const prev = normalizeSpellingState(S.spelling);
    const at = new Date().toISOString();
    const sessionRec = {
      day: todayStr(), total: s.queue.length, attempts: s.attempts,
      correct: s.correct, skipped: s.skipped, mixed: s.mixed, at: at
    };
    s.phase = "done";
    S.spelling = {
      sessions: prev.sessions + 1,
      attempts: prev.attempts + s.attempts,
      correct: prev.correct + s.correct,
      skipped: prev.skipped + s.skipped,
      lastDay: sessionRec.day,
      lastSession: sessionRec
    };
    const saved = save();   // 保存失败时内存统计保留，下次成功保存落盘（与其它记录同一策略）
    renderSpellingSession();
    const result = $("#spellResult");
    if (result) { result.setAttribute?.("tabindex", "-1"); result.focus?.({preventScroll: true}); }
    if (!saved) toast("拼写记录暂未保存，稍后会随下次保存重试");
    return true;
  }
  /** sheet 关闭清理（Esc/背景/×/退出/完成返回都走这里）：未完成组只提示，不计入专项表现。 */
  function onSpellingSheetClosed(){
    const s = spellingSession;
    spellingSession = null;
    if (!s) return;
    if (s.phase === "done") toast("已结束拼写专项，回到完成页");
    else toast("已退出拼写专项（本组未完成，不计入专项表现）");
  }
  function getSpellingState(){
    const s = spellingSession;
    if (!s) return {active: false, stats: normalizeSpellingState(S.spelling)};
    const x = currentSpellingWord();
    return {
      active: true, bookId: s.bookId, phase: s.phase, index: s.index, total: s.queue.length,
      attempts: s.attempts, correct: s.correct, skipped: s.skipped, mixed: s.mixed,
      current: x ? {i: s.queue[s.index], w: x.w, m: x.m || "", p: x.p, ph: x.ph || ""} : null,
      last: s.results.length ? Object.assign({}, s.results[s.results.length - 1]) : null,
      stats: normalizeSpellingState(S.spelling)
    };
  }
  function bindSpellingSheet(){
    const sheet = $("#spellingSheet");
    if (!sheet) return;
    $$("#spellingSheet [data-spell-close]").forEach(el => { el.onclick = () => closeSheet(); });
    const form = $("#spellForm");
    if (form && form.addEventListener) {
      form.addEventListener("submit", (e) => { e.preventDefault?.(); submitSpellingInput(); });
    }
    const input = $("#spellInput");
    if (input && input.addEventListener) {
      input.addEventListener("keydown", (e) => {
        if (!e || e.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault?.();
          if (spellingSession && spellingSession.phase === "feedback") nextSpellingWord();
          else submitSpellingInput();
        }
      });
    }
    const submit = $("#spellSubmit");
    if (submit && submit.addEventListener) {
      submit.addEventListener("click", (e) => { e.preventDefault?.(); submitSpellingInput(); });
    }
    const next = $("#spellNext"); if (next) next.onclick = nextSpellingWord;
    const skip = $("#spellSkip"); if (skip) skip.onclick = skipSpellingWord;
    const exit = $("#spellExit"); if (exit) exit.onclick = () => closeSheet();
    const listen = $("#spellListen");
    if (listen) listen.onclick = () => { const x = currentSpellingWord(); if (x) speak(x.w); };
    const again = $("#spellAgain"); if (again) again.onclick = restartSpellingDrill;
    const done = $("#spellDone"); if (done) done.onclick = () => closeSheet();
  }

  function nextCard(){
    autoSpoken = false;
    while (qi < Q.length) {
      const i = Q[qi];
      if (isProficient(i)) { Q.splice(qi, 1); continue; }
      if (drillMode) {
        // 特训队列只留错词；错次清零后退出本组剩余队列
        const p = st(i);
        if (!p || !(p[3] > 0)) { Q.splice(qi, 1); continue; }
      } else if (!sessionScopeHas(i)) {
        // 08：当前组沿用开始时冻结的范围；组内改筛选不把已入组卡逐张剔掉（分母固定）。
        Q.splice(qi, 1); continue;
      }
      break;
    }
    if (qi >= Q.length) {
      cur = null; verdict = null; snap = null; phase = "recall";
      renderCard();
      return;
    }
    cur = Q[qi];
    verdict = null;
    snap = null;
    stageBefore = 0;
    phase = "recall";
    renderCard();
  }

  function snapshot(i, extraDates){
    const date = todayStr(), d = day();
    const dates = Array.from(new Set([date].concat(extraDates || [])));
    return {
      prog: st(i) ? st(i).slice() : null,
      survey: (W[i] && Object.prototype.hasOwnProperty.call(SURVEY, W[i].w)) ? SURVEY[W[i].w] : null,
      date,
      days: Object.fromEntries(dates.map(k => [k, S.days[k] ? Object.assign({}, S.days[k]) : null])),
      day: { n: d.n, r: d.r, ok: d.ok, no: d.no }
    };
  }
  function restore(i, s){
    const wrong = snapshotWrong(s);
    if (s.prog) {
      S.progress[i] = s.prog.slice();
      S.progress[i][3] = Math.max(0, wrong);
    } else if (wrong > 0) {
      // 撤销首次学习后仍保留特训产生的错次，不制造升档或新词配额。
      S.progress[i] = [0, 0, 0, wrong, 0];
    } else delete S.progress[i];
    for (const [k, d] of Object.entries(s.days)) {
      if (d) S.days[k] = Object.assign({}, d); else delete S.days[k];
    }
    if (W[i] && W[i].w) {
      const w = W[i].w;
      if (s.survey === null || s.survey === undefined) { if (w in SURVEY) { delete SURVEY[w]; saveSurvey(); } }
      else if (SURVEY[w] !== s.survey) { SURVEY[w] = s.survey; saveSurvey(); }
    }
  }
  function snapshotWrong(s){
    return ((s.prog && s.prog[3]) || 0) + (s.drillWrongDelta || 0);
  }
  function applySRS(i, known, wrongBefore, hadBefore){
    const prev = st(i), had = hadBefore === undefined ? hasMainProgress(prev) : hadBefore;
    const p = prev || [0,0,0,0,0], now = Date.now();
    const wrong = wrongBefore === undefined ? p[3] : wrongBefore;
    if (known) {
      const n = nextOnKnow(p[0]);
      S.progress[i] = [n.stage, now + n.delay, p[2] + 1, Math.max(0, wrong), now];
      day().ok++;
    } else {
      const n = nextOnForget();
      S.progress[i] = [n.stage, now + n.delay, p[2], Math.max(0, wrong + 1), now];
      day().no++;
    }
    if (!had) day().n++;
    day().r++;
  }

  /** 判定：首次判定或改判；完成后 phase → revealed */
  function judge(known){
    if (cur == null || isProficient(cur)) return;
    // storage 事件可能尚未送达：先对齐台账，再做首次复习判定的预算门控。
    // 若等到 applySRS 之后才对齐，别标签刚用完的最后一次额度会被再次消费。
    if (!drillMode && verdict === null && hasMainProgress(st(cur))) alignReviewLedgerFromStorage();
    // 20 单日复习上限：只拦「未揭示的复习卡」；已揭示的卡仍可改判/撤销（撤销会回滚额度）。
    if (computeCapPaused()) { capPaused = true; blockJudgeByCap(); return; }
    const i = cur;
    const apply = drillMode ? applyDrill : applySRS;
    if (verdict === null) {
      // 唯一计数判据：判定前已有主学习进度（复习卡 / 组内重考）计 1 次；
      // 新词首次主学习、错词特训（drillMode）不计。改判走下面的 else-if，永不重复计入。
      const counted = !drillMode && hasMainProgress(st(i));
      undoStack.push({ type: "judge", i, snap: snapshot(i), answeredBefore: answered, rightBefore: rightN,
        counted, countedDay: counted ? todayStr() : null });
      snap = snapshot(i);
      // 抽样独立保存；恢复早期备份后再次遇到同一新词，也不能覆盖首次作答。
      const firstSample = !hasMainProgress(snap.prog) && snap.survey === null;
      stageBefore = snap.prog ? snap.prog[0] : 0;
      verdict = known;
      answered++;
      if (known) rightN++;
      apply(i, known);
      if (counted) consumeReviewCount();
      if (firstSample) recordSurvey(i, known);
      phase = "revealed";
      // 22：自动开出的新组已产生首个有效判定，「返回上一组结果」与完成页撤销现场到此不可再用。
      if (autoResumeReturnArmed) { autoResumeReturnArmed = false; autoResumeReturnSnap = null; }
    } else if (verdict !== known) {
      const before = snapshot(i, Object.keys(snap.days));
      undoStack.push({ type: "rejudge", i, snap: before, originalSnap: snap, prevVerdict: verdict, answeredBefore: answered, rightBefore: rightN });
      // 后台标签跨午夜时，轮询可能尚未刷新。将新日期的作答前记录补入
      // 原始基线，让后续改判只保留一次作答，撤销也能完整还原中间日期。
      for (const [date, record] of Object.entries(before.days)) {
        if (!Object.prototype.hasOwnProperty.call(snap.days, date)) {
          snap.days[date] = record ? Object.assign({}, record) : null;
        }
      }
      restore(i, snap);
      apply(i, known, snapshotWrong(snap), hasMainProgress(snap.prog));
      rightN += known ? 1 : -1;
      verdict = known;
      if (!hasMainProgress(snap.prog) && snap.survey === null) recordSurvey(i, known);   // 只修正本次新增的样本
      phase = "revealed";
    } else {
      return;
    }
    save();
    dismissResumeNotice();
    persistSessionSnapshot();
    renderCard();
    updateBar();
  }

  /** 待巩固词数：已安排/即将安排的重考，不计入本组主进度分母。 */
  function pendingReinforce(){
    let n = 0;
    const seen = new Set();
    for (let k = qi; k < Q.length; k++) {
      const i = Q[k];
      if ((rounds[i] || 0) > 0 && !seen.has(i)) { n++; seen.add(i); }
    }
    if (cur != null && verdict === false && (rounds[cur] || 0) < 2 && !seen.has(cur)) n++;
    return n;
  }

  /** 翻页：仅 revealed 阶段允许 */
  function tryNext(userTriggered){
    if (cur == null) return;
    if (phase !== "revealed") {
      if (userTriggered) gateBlock();
      return;
    }
    const i = cur;
    undoStack.push({
      type: "next",
      i,
      qiBefore: qi,
      queueLengthBefore: Q.length,
      roundsBefore: rounds[i] || 0,
      answeredBefore: answered,
      rightBefore: rightN,
      verdict: verdict,
      snap: snap,
      stageBefore
    });
    if (verdict === false && !isProficient(i) && (rounds[i] || 0) < 2) {
      rounds[i] = (rounds[i] || 0) + 1;
      Q.push(i);
    }
    qi++;
    verdict = null;
    snap = null;
    phase = "recall";
    capGroupEnded = false;   // 回到正常学习流，结束态标记失效
    nextCard();
    persistSessionSnapshot();
    updateBar();
  }

  /** 撤销：支持 判定 / 改判 / 翻页 */
  function undo(){
    if (!undoStack.length) {
      toast("没有可撤销的操作");
      return;
    }
    const u = undoStack.pop();
    if (u.type === "judge" || u.type === "rejudge") {
      // 该次判定若消费过复习额度则回滚；改判（rejudge）本身从未计数，撤销只回到原判定。
      // 台账只保存今天：撤销昨日判定不能退还今天（例如跨天子组刚消费）的额度。
      // 旧内存条目尚无 countedDay 时，原始快照日期就是该次首次判定的消费日。
      if (u.type === "judge" && u.counted && (u.countedDay || u.snap?.date) === todayStr()) releaseReviewCount(1);
      if (u.type === "rejudge") {
        restore(u.i, u.snap);
        verdict = u.prevVerdict;
        phase = "revealed";
        snap = u.originalSnap;
      } else {
        restore(u.i, u.snap);
        verdict = null;
        snap = null;
        phase = "recall";
        stageBefore = 0;
      }
      answered = u.answeredBefore;
      rightN = u.rightBefore;
      cur = u.i;
      save();
      renderCard();
      updateBar();
      toast(u.type === "judge" ? "已撤销判定" : "已撤销改判");
    } else if (u.type === "next") {
      Q.length = u.queueLengthBefore;
      qi = u.qiBefore;
      if (u.roundsBefore) rounds[u.i] = u.roundsBefore; else delete rounds[u.i];
      answered = u.answeredBefore;
      rightN = u.rightBefore;
      cur = Q[qi];
      stageBefore = u.stageBefore;
      if (u.verdict !== undefined && u.verdict !== null) {
        verdict = u.verdict;
        phase = "revealed";
        snap = u.snap || snapshot(cur);
      } else {
        verdict = null;
        phase = "recall";
        snap = null;
      }
      renderCard();
      updateBar();
      toast("已撤销翻页");
    }
    persistSessionSnapshot();
  }

  /* ================= 12 阅读字号（标准 / 大字） ================= */
  /**
   * 字号偏好只改 <html data-font-size>（CSS 变量控制释义/例句等阅读文本），
   * 不触发布局重建、不参与「设置只应用到下一组」判断，切换后立即生效。
   */
  function applyFontSize(){
    const large = S.settings.fontSize === "large";
    try { document.documentElement.dataset.fontSize = large ? "large" : "standard"; } catch (e) { /* ignore */ }
    $$("#fontSizeSeg [data-font-size]").forEach(b => {
      const on = b.dataset.fontSize === S.settings.fontSize;
      b.classList.toggle("on", on);
      b.setAttribute?.("aria-pressed", String(on));
    });
    fitVisibleWords();
  }
  function setFontSize(size){
    const next = normalizeFontSize(size);
    if (S.settings.fontSize === next) { applyFontSize(); return {ok: true, size: next}; }
    S.settings.fontSize = next;
    save();
    applyFontSize();
    if ($("#v-study")?.classList.contains("on")) renderCard();
    markSettingsSaved();
    return {ok: true, size: next};
  }
  function getFontSize(){ return S.settings.fontSize; }
  /** 标准/大字下词头最小可读字号（px）：长词不再无限缩小，低于该值时换行。 */
  function minWordFontPx(){ return S.settings.fontSize === "large" ? 34 : 30; }

  /* ================= 12 设备发音（语音 / 语速 / 试听） =================
   * 只用本机 speechSynthesis：英语语音列表可能延迟到达（voiceschanged），也可能一个都没有。
   * 偏好存每书 settings.voiceURI / speechRate 并随界面偏好跨书携带；
   * 语音 URI 失效时回退默认英语语音；文案不称「词典原声」、不承诺所有设备离线可用。
   */
  let speechVoiceList = [];      // 当前设备可用英语语音
  let speechVoicesReady = false; // 已拿到一次非空语音列表（区分「尚未加载」与「设备没有英语语音」）
  const SPEECH_HINT_BASE = "朗读使用设备系统语音（不是词典原声）；能否离线发音取决于系统已安装的英语语音。";

  function speechApi(){
    try { if (window && window.speechSynthesis) return window.speechSynthesis; } catch (e) { /* ignore */ }
    try { if (typeof speechSynthesis !== "undefined" && speechSynthesis) return speechSynthesis; } catch (e) { /* ignore */ }
    return null;
  }
  function utteranceCtor(){
    try { if (window && window.SpeechSynthesisUtterance) return window.SpeechSynthesisUtterance; } catch (e) { /* ignore */ }
    try { if (typeof SpeechSynthesisUtterance !== "undefined") return SpeechSynthesisUtterance; } catch (e) { /* ignore */ }
    return null;
  }
  function englishVoices(){
    const api = speechApi();
    if (!api || typeof api.getVoices !== "function") return [];
    try {
      const list = Array.from(api.getVoices() || []);
      return list.filter(v => v && typeof v.lang === "string" && /^en([-_]|$)/i.test(v.lang));
    } catch (e) { return []; }
  }
  /** 拉取设备英语语音；voices 延迟到达时由 voiceschanged 再次调用。 */
  function refreshSpeechVoices(){
    const api = speechApi();
    speechVoiceList = englishVoices();
    if (speechVoiceList.length) speechVoicesReady = true;
    else if (api && typeof api.getVoices === "function") {
      // getVoices 返回空数组不代表设备一定没有英语语音（可能仍在加载）：只有非空过才算「已就绪」。
      try { if ((api.getVoices() || []).length) speechVoicesReady = true; } catch (e) { /* ignore */ }
    }
    renderSpeechControls();
    return speechVoiceList.slice();
  }
  /** 选中的语音：voiceURI 命中 → 默认 en-US → 第一个英语语音；空串/失效都回退，不用中文语音读英文。 */
  function pickSpeechVoice(){
    if (!speechVoiceList.length) return null;
    const uri = S.settings.voiceURI;
    if (uri) {
      const hit = speechVoiceList.find(v => v.voiceURI === uri);
      if (hit) return hit;
    }
    return speechVoiceList.find(v => /^en[-_]US/i.test(v.lang)) || speechVoiceList[0];
  }
  /** 语音/语速控件回填 + 能力说明（节点缺失时静默跳过）。 */
  function renderSpeechControls(){
    const prefURI = S.settings.voiceURI;
    const rate = normalizeSpeechRate(S.settings.speechRate);
    const sel = $("#voiceSelect");
    if (sel) {
      const opts = ['<option value="">跟随设备（自动选择英语语音）</option>'];
      for (const v of speechVoiceList) {
        const uri = String(v.voiceURI || "");
        if (!uri) continue;
        opts.push('<option value="' + esc(uri) + '">' + esc(v.name || uri) + (v.lang ? " · " + esc(v.lang) : "") + "</option>");
      }
      sel.innerHTML = opts.join("");
      const valid = prefURI && speechVoiceList.some(v => v.voiceURI === prefURI);
      sel.value = valid ? prefURI : "";
      sel.disabled = !speechVoiceList.length;
    }
    const rateEl = $("#speechRate");
    if (rateEl) {
      rateEl.value = String(rate);
      if (rateEl.setAttribute) rateEl.setAttribute("aria-valuetext", rate.toFixed(2) + " 倍速");
    }
    const rateVal = $("#speechRateVal");
    if (rateVal) rateVal.textContent = rate.toFixed(2) + "×";
    const hint = $("#voiceHint");
    if (hint) {
      let text;
      if (!speechApi()) {
        text = "当前浏览器不支持语音朗读；可改用系统浏览器或开启系统语音。学习与离线缓存不受影响。";
      } else if (speechVoicesReady && !speechVoiceList.length) {
        text = "当前设备没有可用的英语语音，发音按钮会提示不可用；可在系统设置中安装英语语音后重试。" + SPEECH_HINT_BASE;
      } else if (!speechVoiceList.length) {
        text = "正在读取设备英语语音…（语音列表由系统提供，可能延迟出现）。" + SPEECH_HINT_BASE;
      } else if (prefURI && !speechVoiceList.some(v => v.voiceURI === prefURI)) {
        text = "之前选择的语音在当前设备不可用，已回退为默认英语语音。" + SPEECH_HINT_BASE;
      } else {
        text = "已检测到 " + speechVoiceList.length + " 个英语语音，可选「跟随设备」自动选择。" + SPEECH_HINT_BASE;
      }
      hint.textContent = text;
    }
  }
  /** 试听：用当前卡片词（没有卡时用示例词），走与正式朗读相同的偏好与错误处理。 */
  function speechTestText(){
    return W[cur] && W[cur].w ? W[cur].w : "vocabulary";
  }
  /**
   * 统一发音入口（自动发音、快捷键 S、卡片/详情/试听都走这里）。
   * 连续点击先取消上一段；语音缺失时明确提示且不假装发声。
   * 返回 true 表示已交给 speechSynthesis。
   */
  function speak(text){
    const api = speechApi();
    const Ctor = utteranceCtor();
    if (!api || typeof api.speak !== "function" || !Ctor) {
      toast("当前浏览器不支持语音朗读，请使用系统浏览器或开启系统语音");
      return false;
    }
    // 尚未拿到语音列表（可能仍在加载）时不阻塞默认朗读；已确认没有英语语音才明确拒绝。
    if (speechVoicesReady && !speechVoiceList.length) {
      toast("当前设备没有可用的英语语音，暂时无法发音；可在系统设置中安装英语语音后重试");
      return false;
    }
    try {
      api.cancel();   // 连续点击只保留最后一段
      const u = new Ctor(text);
      const voice = pickSpeechVoice();
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang || "en-US";
      } else {
        u.lang = "en-US";
      }
      u.rate = normalizeSpeechRate(S.settings.speechRate);
      u.onerror = (e) => {
        if (e && (e.error === "canceled" || e.error === "interrupted" || e.error === "aborted")) return;
        toast("发音失败，请检查系统语音或网络设置");
      };
      api.speak(u);
      return true;
    } catch (e) {
      toast("发音失败，请检查系统语音设置");
      return false;
    }
  }
  function getSpeechPrefs(){
    return {
      voiceURI: S.settings.voiceURI,
      rate: normalizeSpeechRate(S.settings.speechRate),
      rateDefault: SPEECH_RATE_DEFAULT,
      rateMin: SPEECH_RATE_MIN,
      rateMax: SPEECH_RATE_MAX,
      voices: speechVoiceList.map(v => ({name: v.name || "", lang: v.lang || "", voiceURI: v.voiceURI || ""})),
      voicesReady: speechVoicesReady
    };
  }
  function setSpeechRate(rate){
    S.settings.speechRate = normalizeSpeechRate(rate);
    save();
    renderSpeechControls();
    markSettingsSaved();
    return S.settings.speechRate;
  }
  function setVoiceURI(uri){
    S.settings.voiceURI = normalizeVoiceURI(uri);
    save();
    renderSpeechControls();
    markSettingsSaved();
    return S.settings.voiceURI;
  }

  /* ================= 门控提示 ================= */
  let gateTimer = null;
  function gateBlock(){
    const capped = isCapPaused();
    const card = $("#card"), t = $("#gateToast");
    if (card) {
      card.classList.remove("shake");
      // reflow
      void card.offsetWidth;
      card.classList.add("shake");
      setTimeout(() => card.classList.remove("shake"), 360);
    }
    if (t) {
      t.textContent = capped
        ? "今日复习额度已用完：本组已暂停，未答位置已保留（可提高上限、撤销或明天继续）"
        : "请先选择「会」或「不会」；已经熟悉的词可直接标为「熟练」";
      t.classList.add("on");
      clearTimeout(gateTimer);
      gateTimer = setTimeout(() => t.classList.remove("on"), 1800);
    }
    const hint = $("#hint");
    if (hint && phase === "recall") {
      hint.textContent = capped
        ? "今日复习额度已用完：当前复习卡与待巩固已保留。提高上限、撤销判定或明天继续后可恢复；新词与错词特训不受此限制。"
        : drillMode
          ? "错词特训：先选「会」或「不会」只调错次，不占新词额度——未判定不能翻页"
          : "想好中文意思后，按「会」或「不会」——未判定不能翻页";
    }
    if (capped) renderCapPausePanel();
  }

  /* ================= 20 单日复习上限 · 暂停面板与额度展示 ================= */
  /** 暂停时拦截判定：沿用现有 gate toast / shake / 提示行，不弹 alert。 */
  function blockJudgeByCap(){
    capPaused = true;
    renderCapPausePanel();
    gateBlock();
  }
  /** 同步背诵页暂停面板；节点缺失（旧 DOM/测试桩）时静默跳过，不影响学习。 */
  function renderCapPausePanel(){
    const box = $("#capPause");
    const paused = isCapPaused();
    // 受控子组内不显示暂停/加量嵌套入口：子组暂停由卡片提示 + 「返回原组」处理。
    const visible = paused && !inSubgroup();
    if (box) box.hidden = !visible;
    if (!paused) { renderExtraPausedEntries(false); return; }
    if (!visible || !box) { renderExtraPausedEntries(false); return; }
    const cap = getReviewCap(), used = reviewLedgerUsed(), left = reviewCapLeft();
    const due = countDue();
    const title = $("#capPauseTitle");
    if (title) title.textContent = extraSubgroup
      ? "复习额度已用完 · 临时加量子组暂停"
      : newOnlySubgroup
        ? "复习额度已用完 · 纯新词子组暂停"
        : "今日复习额度已用完 · 本组已暂停";
    const desc = $("#capPauseDesc");
    if (desc) desc.textContent = inSubgroup()
      ? "受控子组只学新词，但新词的组内重考仍受当日复习预算限制。可提高复习上限，或先返回原组。"
      : "单日复习上限只限制已学词的到期复习与组内重考，"
        + "新词首次学习和错词特训照常。当前未答位置与待巩固已保留：提高上限、撤销判定或明天继续后会自动恢复。";
    const stats = $("#capPauseStats");
    if (stats) stats.innerHTML =
      "<span>今日已用 <b>" + used + "</b></span>" +
      "<span>· 上限 <b>" + (cap === 0 ? "不限" : cap) + "</b></span>" +
      "<span>· 可继续复习 <b>" + (left === Infinity ? "不限" : left) + "</b></span>" +
      "<span>· 仍待复习 <b>" + due + "</b></span>";
    const actEnd = $("#capPauseEnd");
    if (actEnd) {
      actEnd.textContent = inSubgroup() ? "返回原组" : "结束本组，明天继续";
      actEnd.onclick = endCapPausedGroup;
    }
    // 23：额度暂停页也提供临时加量入口（受控进入只含额外新词的子组）；子组内不嵌套。
    renderExtraPausedEntries(true);
  }
  /** 结束被额度暂停的本组：只收起当前卡（保留 Q/未答位置/待巩固/撤销栈），不改写 p[1]。 */
  function endCapPausedGroup(){
    if (inSubgroup()) { endActiveSubgroup(); return; }   // 子组暂停：回原组而不是结束原组
    if (!computeCapPaused()) { renderCard(); return; }
    capPaused = false;
    capGroupEnded = true;
    cur = null; verdict = null; snap = null; phase = "recall"; stageBefore = 0;
    clearSessionSnapshot(currentBookId);   // 15：用户主动结束本组 → 不作为未完成组恢复
    renderCard();
    updateBar();
    toast("本组已暂停：今天的复习额度用完，明天自动重置；也可在设置页提高上限后继续");
  }
  /** 背诵页「今日复习 x / 上限」、暂停面板与完成页加量入口的通用刷新（节点缺失时静默）。 */
  function renderCapSurfaces(){
    const cap = getReviewCap();
    const revMax = $("#s-revmax");
    if (revMax) revMax.textContent = cap === 0 ? "不限" : String(cap);
    renderCapPausePanel();
    renderExtraNewRow();
    renderGroupSurfaces();
  }

  /* ================= 23 今日临时加量 · 完成页 / 暂停页入口 ================= */
  /** 今日加量入口是否具备前提：计划内新词已学完（暂停页/完成页共用）。 */
  function extraEntryBaseReady(){
    return day().n >= S.settings.dailyNew;
  }
  /** 完成页「今天还想再学」的显示条件：完整完成页（非暂停收尾/特训/子组/作答中）。 */
  function extraRowEligible(){
    return cur == null && !drillMode && !inSubgroup() && !capGroupEnded && extraEntryBaseReady();
  }
  /** 加量入口 hint：摘要 + 候选不足/上界原因（文案由 ui-cap 约定）。 */
  function extraEntryHintHtml(){
    const plan = S.settings.dailyNew;
    const extra = extraDayLedger().extra;
    const target = effectiveNewTarget();
    const learned = day().n;
    const available = extraCandidatesAvailable();
    const room = Math.max(0, EXTRA_NEW_TARGET_MAX - plan - extra);
    let h = "计划 <b>" + plan + "</b> + 临时 <b>" + extra + "</b>，今日目标 <b>" + target
      + "</b>，已学 <b>" + learned + "</b>/<b>" + target + "</b>";
    if (available <= 0) h += "；当前范围没有可加的新词";
    else if (room <= 0) h += "；今日目标已达 " + EXTRA_NEW_TARGET_MAX + " 上界";
    else if (available < 10) h += "；仅剩 " + available + " 词，实际最多加 " + available + " 个";
    return h;
  }
  /** 加量按钮可用性：候选与 500 上界共同决定；不可用时按钮 disabled，不写额度。 */
  function extraGrantDisabled(){
    const available = extraCandidatesAvailable();
    const room = EXTRA_NEW_TARGET_MAX - S.settings.dailyNew - extraDayLedger().extra;
    return available <= 0 || room <= 0;
  }
  /** 同一指针连击（click.detail>=2）只生效一次；键盘/程序调用立即生效。 */
  function isExtraPointerDuplicate(n, e){
    if (!e || !(e.detail >= 2)) return false;
    const last = lastExtraPointer;
    return !!last && last.n === n && (Date.now() - last.at) < EXTRA_GRANT_DEDUPE_MS;
  }
  /** 完成页/暂停页共用：授予加量；暂停页随后进入只含额外新词的子组。 */
  function handleExtraGrantAmount(n, fromPause, e){
    if (isExtraPointerDuplicate(n, e)) return false;
    lastExtraPointer = {n: n, at: Date.now()};
    // 两处入口条件并列：完成页要求计划已完成；暂停页因复习预算用尽即可加量（不要求计划完成）。
    const result = fromPause ? grantExtraNew(n, {fromPause: true}) : grantExtraNew(n);
    if (!result.ok) {
      toast(extraGrantErrorText(result.error));
      renderExtraSurfaces();
      return false;
    }
    if (result.duplicate) toast("另一窗口已完成这次加量，已同步");
    else if (result.clamped) toast("已加 " + result.granted + " 个（" + (result.limitedBy === "target-cap"
      ? "已达每日 500 词总目标上界" : "候选不足，按实际可加量") + "）");
    else toast("今日目标已加到 " + result.effectiveTarget + " 个");
    if (fromPause) {
      if (!startExtraSubgroup()) {
        // 加量已生效但子组没建成（例如候选被主组未答卡占满）：保留已授予额度，回到暂停现场。
        renderExtraSurfaces();
        if (isCapPaused()) renderCapPausePanel();
      }
    }
    return true;
  }
  function handleExtraStudyAmount(n, e){
    if (isExtraPointerDuplicate(n, e)) return false;
    lastExtraPointer = {n, at:Date.now()};
    const r = runStudyAction("addExtraAndStudy",{amount:n,event:e});
    if (r.ok) {
      toast(r.reused ? "已使用尚未学习的加量额度，开始下一组。"
        : "已增加 " + r.granted + " 个新词额度，并开始学习（本组 " + r.actual + " 张）。");
      return true;
    }
    const errors = {storage:"记录暂时无法安全保存，请检查存储状态后重试。",context:"当前页面不能加量，请先完成本组或返回原组。",
      "no-candidates":"当前范围没有可补充的新词。","review-cap":"今日复习预算已用完，可调整上限后继续。",
      "shared-change":"其他页面已更新学习现场，请核对后重试。",unavailable:"暂时没有可开组的词，已授予额度会保留。",
      "not-study":"请先返回背诵页。",hidden:"回到当前页面后再试。",sheet:"请先关闭浮层。",lookup:"请先关闭查词。",alert:"请先处理页面中的记录错误。"};
    toast((r.granted ? "已增加 " + r.granted + " 个额度，但尚未开始学习。" : "") + (errors[r.error] || extraGrantErrorText(r.error)));
    renderExtraSurfaces();
    return false;
  }
  function handleExtraGrantOnly(n, fromPause, e){
    if (isExtraPointerDuplicate(n,e)) return false;
    lastExtraPointer={n,at:Date.now()};
    const r=grantExtraNew(n,{fromPause});
    toast(!r.ok?extraGrantErrorText(r.error):!storageOK?"额度暂存本页，保存失败；请检查记录状态。":"已增加 "+r.granted+" 个新词额度；点击继续时使用。");
    renderExtraSurfaces();
    return r.ok;
  }
  /** 解析自定义输入：合法 1–100 整数 → 数字；否则 null（不写额度）。 */
  function parseExtraAmountInput(input){
    if (!input) return null;
    const raw = Number(input.value);
    return (Number.isInteger(raw) && raw >= 1 && raw <= EXTRA_NEW_GRANT_MAX) ? raw : null;
  }
  /** 绑定一组加量按钮（suffix="" 完成页，"Paused" 暂停页）；节点缺失静默。 */
  function bindExtraGrantControls(suffix, fromPause){
    [["#extraNew10" + suffix, 10], ["#extraNew20" + suffix, 20]].forEach(([sel, n]) => {
      const btn = $(sel);
      if (!btn) return;
      btn.disabled = extraGrantDisabled();
      btn.onclick = (e) => handleExtraStudyAmount(n, e);
    });
    const customBtn = $("#extraNewCustom" + suffix);
    const box = $("#extraNewCustomBox" + suffix);
    const input = $("#extraNewCustomInput" + suffix);
    const go = $("#extraNewCustomGo" + suffix);
    if (customBtn) customBtn.disabled = extraGrantDisabled();
    if (customBtn && box) {
      customBtn.onclick = () => {
        const open = !!box.hidden;
        box.hidden = !open;
        customBtn.setAttribute?.("aria-expanded", String(open));
        if (open && input) { input.focus?.({preventScroll: true}); input.select?.(); }
      };
    }
    if (go) {
      go.disabled = extraGrantDisabled();
      go.onclick = (e) => {
        const amount = parseExtraAmountInput(input);
        if (amount === null) { toast("自定义加量需为 1–100 的整数"); return; }
        handleExtraStudyAmount(amount, e);
      };
    }
    const only = $("#extraNewGrantOnly" + suffix);
    if (only) {
      only.disabled=extraGrantDisabled();
      only.onclick=e=>{const amount=parseExtraAmountInput(input);if(amount===null){toast("自定义加量需为1–100的整数");return;}handleExtraGrantOnly(amount,fromPause,e);};
    }
    if (input && input.value === "") input.value = "10";   // 默认 10（静态 HTML 也是 10）
  }
  /** 完成页「今天还想再学」入口；不满足条件时保持 hidden。 */
  function renderExtraNewRow(){
    const row = $("#extraNewRow");
    if (!row) return;
    if (!extraRowEligible()) { row.hidden = true; return; }
    row.hidden = false;
    bindExtraGrantControls("", false);
    const hint = $("#extraNewHint");
    if (hint) hint.innerHTML = extraEntryHintHtml();
  }
  /**
   * 额度暂停页加量入口。显示条件与完成页并列而非前置：主组因复习预算用尽暂停时，
   * 即使今日计划内新词还没学完也允许主动加量（也不嵌套子组）。达到 500 上界或无候选时隐藏。
   */
  function renderExtraPausedEntries(paused){
    const wrap = $("#extraNewPaused");
    if (!wrap) return;
    const available = extraCandidatesAvailable();
    const room = EXTRA_NEW_TARGET_MAX - S.settings.dailyNew - extraDayLedger().extra;
    const show = !!paused && !inSubgroup() && available > 0 && room > 0;
    wrap.hidden = !show;
    const hint = $("#extraNewHintPaused");
    if (!show) {
      // 隐藏时也要清掉旧摘要，避免再次显示/读屏时读到过期的「已学 x/目标」。
      if (hint) hint.innerHTML = "";
      return;
    }
    bindExtraGrantControls("Paused", true);
    if (hint) hint.innerHTML = extraEntryHintHtml();
  }
  /** 加量入口通用刷新（完成页 + 暂停页）；节点缺失时静默。 */
  function renderExtraSurfaces(){
    renderExtraNewRow();
    renderExtraPausedEntries(isCapPaused());
  }

  /* ================= 07 分组 / 积压保护 / 纯新词子组 · UI ================= */
  /** 设置页「每组词数」「积压保护」控件同步（节点缺失时静默）。 */
  function syncGroupControls(){
    const sizeEl = $("#groupSize");
    if (sizeEl) sizeEl.value = String(S.settings.groupSize);
    const guardEl = $("#backlogGuard");
    if (guardEl) guardEl.checked = !!S.settings.backlogGuard;
    // 说明随当前值刷新，但必须保留两个关键点：不是每日复习上限、未进组的到期词不会消失。
    const desc = $("#groupSizeDesc");
    if (desc) {
      desc.innerHTML = "当前每组 <b>" + S.settings.groupSize
        + "</b> 张：只决定一次来多少张卡，<b>不是每日复习上限</b>；先取到期复习，剩余槽位补新词；"
        + "未进组的到期词仍然到期，不会被清掉或改期。";
    }
  }
  /**
   * 组尾/纯新词子组状态区。按 ui-cap 约定只填 #groupFooterText，
   * #nextGroupBtn / #returnMainGroup 是静态按钮（不覆盖 #groupFooter 内部结构）。
   */
  function renderGroupFooter(){
    const footer = $("#groupFooter");
    const text = $("#groupFooterText");
    const nextBtn = $("#nextGroupBtn");
    const returnBtn = $("#returnMainGroup");
    const info = groupInfo();
    const mainTail = !drillMode && !inSubgroup() && cur == null && groupTotal > 0;
    const show = mainTail || newOnlySubgroup;
    if (footer) footer.hidden = !show;
    if (text) {
      if (newOnlySubgroup) {
        text.innerHTML = "纯新词子组：只学今日计划内新词 · 已学新词 <b>" + day().n
          + "</b>/<b>" + effectiveNewTarget() + "</b>";
      } else if (mainTail) {
        const capStopped = capGroupEnded && reviewCapLeft() <= 0;
        text.innerHTML = "本组完成 <b>" + info.done + "</b>/<b>" + info.groupTotal
          + "</b> · 剩余到期 <b>" + info.remainingDue + "</b> 个"
          + (capStopped ? " · <b>今日复习额度已用完，本组已暂停</b>"
            : (info.hasMore ? "" : " · 本组已完成，明天继续"));
      } else {
        text.innerHTML = "";
      }
    }
    if (nextBtn) {
      const showNext = false; // 继续动作统一在#again；组尾只显示本组结果。
      nextBtn.hidden = !showNext;
      nextBtn.disabled = !showNext;
      nextBtn.onclick = () => startSession("main");
    }
    if (returnBtn) {
      // ui-cap 约定：该按钮是纯新词子组的返回入口；子组完成页 #acts 已有主按钮「返回原组」，
      // 此时隐藏静态按钮，避免同屏两个返回入口（作答中仍由它提供返回）。
      const showReturn = newOnlySubgroup && cur != null;
      returnBtn.hidden = !showReturn;
      returnBtn.disabled = !showReturn;
      returnBtn.onclick = () => endNewOnlySubgroup();
    }
  }
  /** 背诵页/统计页积压保护提示（只填 #backlogNoticeText，按钮静态）。 */
  function renderBacklogNotice(){
    const guarded = !drillMode && !inSubgroup() && isBacklogGuarded();
    const quotaLeft = Math.max(0, effectiveNewTarget() - day().n);
    const candidates = extraCandidatesAvailable();
    const notice = $("#backlogNotice");
    const noticeText = $("#backlogNoticeText");
    if (notice) notice.hidden = !guarded;
    if (noticeText) {
      if (guarded) {
        const due = countDue();
        const left = reviewCapLeft();
        noticeText.innerHTML = "还有 <b>" + due + "</b> 个到期词超出今日剩余复习额度 <b>"
          + (left === Infinity ? "不限" : left) + "</b>，先复习更划算。";
      } else {
        noticeText.innerHTML = "";
      }
    }
    const learnBtn = $("#learnNewAnyway");
    if (learnBtn) {
      // 作答中不抢占界面：只有完成页（cur==null）或额度暂停态才能进入纯新词子组。
      const canEnter = cur == null || computeCapPaused();
      const canLearn = guarded && canEnter && quotaLeft > 0 && candidates > 0;
      learnBtn.hidden = !guarded;
      learnBtn.disabled = !canLearn;
      learnBtn.onclick = () => {
        if (!canEnter) { toast("请先完成当前这张卡，再进入纯新词子组"); return; }
        startNewOnlySubgroup();
      };
    }
  }
  /** 07 组相关 UI 统一刷新（节点缺失时静默）。 */
  function renderGroupSurfaces(){
    renderGroupFooter();
    renderBacklogNotice();
  }

  /** 设置页「单日复习上限」控件同步：预设 aria-pressed、自定义值/禁用态；节点缺失时静默。 */
  function syncReviewCapControls(){
    const cap = getReviewCap();
    $$("#reviewCapPresets [data-cap]").forEach(b => {
      const on = Number(b.dataset.cap) === cap;
      b.setAttribute?.("aria-pressed", String(on));
      b.onclick = () => setReviewCap(Number(b.dataset.cap));
    });
    const custom = $("#reviewCapCustom");
    if (custom) {
      if (cap > 0) custom.value = String(cap);
      else if (custom.value === "" || custom.value === undefined || custom.value === null) {
        custom.value = String(DAILY_REVIEW_CAP_DEFAULT);
      }
      custom.disabled = cap === 0;
    }
  }
  /** 设置单日复习上限（UI/测试共用）：0=不限，1–1000 整数；非法值不改配置。 */
  function setReviewCap(n){
    const cap = normalizeDailyReviewCap(n, null);
    if (cap === null) {
      toast("单日复习上限需为 0–1000 的整数（0 = 不限）");
      return {ok: false, cap: getReviewCap(), error: "invalid-cap"};
    }
    S.settings.dailyReviewCap = cap;
    autoResumeCheckCache = null;
    save();
    syncReviewCapControls();
    renderCapSurfaces();
    if ($("#v-study").classList.contains("on")) renderCard();
    if ($("#v-stats").classList.contains("on")) renderStats();
    updateBar();
    return {ok: true, cap: getReviewCap()};
  }
  /** 设置每组入组词数（07）：1–100 整数；只影响下一组，不重建当前组（08 生命周期不含本批）。 */
  function setGroupSize(n){
    const size = (typeof n === "number" && Number.isInteger(n)
      && n >= GROUP_SIZE_MIN && n <= GROUP_SIZE_MAX) ? n : null;
    if (size === null) {
      toast("每组词数需为 1–100 的整数");
      return {ok: false, groupSize: S.settings.groupSize, error: "invalid-group-size"};
    }
    S.settings.groupSize = size;
    autoResumeCheckCache = null;
    save();
    syncGroupControls();
    renderGroupSurfaces();
    renderSettingsLifecycle();
    renderPlanPendingNotice();
    if ($("#v-stats").classList.contains("on")) renderStats();
    return {ok: true, groupSize: S.settings.groupSize};
  }
  /** 开关积压保护（07）：只影响之后的配词，当前组不变。 */
  function setBacklogGuard(v){
    S.settings.backlogGuard = !!v;
    autoResumeCheckCache = null;
    save();
    syncGroupControls();
    renderGroupSurfaces();
    renderSettingsLifecycle();
    renderPlanPendingNotice();
    if ($("#v-stats").classList.contains("on")) renderStats();
    return {ok: true, backlogGuard: S.settings.backlogGuard};
  }

  /* ================= 渲染：背诵 ================= */
  function dotsHtml(stage){
    let h = '<div class="dots" aria-label="掌握阶段">';
    for (let i = 0; i < MASTER; i++) {
      const cls = (stage >= MASTER || i < stage) ? "on" : (i === stage ? "cur" : "");
      h += '<span class="' + cls + '"></span>';
    }
    h += "<em>" + esc(stageLabel(stage, activePlan())) + "</em></div>";
    return h;
  }

  // 使用实际字形宽度适配单行词面，兼顾字体差异、展开双栏与窗口缩放。
  // 12：长词不再无限缩小——低于最小可读字号时改用换行（.word-wrap），保证大字/200% 缩放仍可读。
  function fitWord(el){
    if (!el || !el.clientWidth || typeof window.getComputedStyle !== "function") return;
    el.style.fontSize = "";
    el.classList?.remove?.("word-wrap");
    const base = parseFloat(window.getComputedStyle(el).fontSize);
    const available = el.clientWidth;
    if (!base || !available || el.scrollWidth <= available) return;
    const fitted = Math.floor(base * (available - 2) / el.scrollWidth * 100) / 100;
    const min = minWordFontPx();
    if (fitted >= min) {
      el.style.fontSize = fitted + "px";
    } else {
      // 再缩就不可读：保留最小字号并允许合理换行，不让词面溢出或压住操作区。
      el.style.fontSize = min + "px";
      el.classList?.add?.("word-wrap");
    }
  }
  function fitVisibleWords(){
    fitWord($("#card .word"));
    fitWord($("#wordTitle"));
  }

  /** 只在既有动作槽内换位，DOM、视觉与Tab顺序一致；不重绘词卡或学习状态。 */
  function applyActionLayout(){
    const root = $("#acts");
    if (!root || activeSheet || ($("#exPop") && !$("#exPop").hidden)) return false;
    const layout = ["left","right"].includes(S.settings.actionLayout) ? S.settings.actionLayout : "standard";
    root.dataset.layout = layout;
    const before = (first, second) => {
      const a=$("#"+first), b=$("#"+second);
      if(a && b && a.parentNode === root && b.parentNode === root && typeof root.insertBefore === "function")root.insertBefore(a,b);
    };
    if(verdict === null) before(layout === "right" ? "no" : "ok",layout === "right" ? "ok" : "no");
    else {
      before(layout === "left" ? "nx" : "fix",layout === "left" ? "fix" : "nx");
      // F1：固定次级动作在第三行容器内换位，DOM 顺序与视觉/Tab 顺序一致。
      orderSecondaryActionsRow();
    }
    return true;
  }
  /** 新增动作按键只补已有入口提示，不复制按钮，也不改变学习场景。 */
  function applyActionBindingHints(){
    if(typeof getInputPreferences !== "function" || activeSheet || ($("#exPop") && !$("#exPop").hidden))return;
    const bindings=getInputPreferences().actionKeys;
    const selectors={continue:["#again"],wait:["#startEmptyWait","#stopEmptyWait"],return:["#returnPrevResult","#extraExitBtn","#extraBack","#returnMainGroup","#exitDrillBtn"]};
    for(const [action,items] of Object.entries(selectors))for(const selector of items){
      if(action==="continue" && drillMode)continue;
      const el=$(selector);if(!el || !el.querySelectorAll)continue;
      el.querySelectorAll("[data-action-hint]").forEach(x=>x.remove?.());
      const completedAction = cur == null && groupTotal > 0
        && (action === "continue" || action === "return" && (drillMode || inSubgroup()));
      const binding = bindings[action] || (completedAction ? S.settings.keys.next : null);
      if(completedAction || binding && S.settings.singleCharKeys !== false){
        const kbd=document.createElement("kbd");kbd.dataset.actionHint=action;
        kbd.textContent=completedAction ? (S.settings.singleCharKeys === false ? "Enter" : keyName(binding) + " / Enter") : keyName(binding);
        el.appendChild(kbd);
      }
    }
    const list=$("[data-v='list']");
    if(list)list.title=bindings.listSearch?"搜索词表（"+keyName(bindings.listSearch)+"）":"词表";
  }
  function completionShortcutHint(action){
    if (S.settings.singleCharKeys === false) return "按 Enter " + (action === "return" ? "返回原学习现场" : "继续下一组")
      + (undoStack.length ? "　·　Ctrl/Cmd+Z 撤销" : "");
    const binding = S.settings.actionKeys[action] || S.settings.keys.next;
    return "按 " + keyName(binding) + " / Enter" + (action === "return" ? " 返回原学习现场" : " 继续下一组")
      + (undoStack.length ? "　·　Ctrl/Cmd+Z 撤销" : "");
  }

  /* ================= 判定 → 翻页的同一指针连击保护 ================= */
  // 判定后 #acts 立刻换成释义态按钮，同一次双击的第二次点击会命中新按钮
  // （窄屏曾出现「不会」→「下一个」直接翻页）。这里不给所有输入加延迟：
  // 只在判定点击之后记录该指针点击的时间与坐标，600ms 内「同一次连击」的
  // 第二次指针点击才会被吞掉；键盘激活（click.detail===0）、明显换了位置
  // 或 600ms 之后的点击一律放行，所以刻意快速学习与键盘操作不受影响。
  const JUDGE_DBL_GUARD_MS = 600;
  const JUDGE_DBL_GUARD_PX = 44;
  let judgePointerGesture = null;
  let judgeGuardNoticeAt = 0;
  /** 判定按钮点击时布防；键盘/程序触发（detail 为 0）不布防。 */
  function markJudgeGesture(e){
    if (!e || !(e.detail > 0)) { judgePointerGesture = null; return; }
    const hasX = typeof e.clientX === "number" && Number.isFinite(e.clientX);
    const hasY = typeof e.clientY === "number" && Number.isFinite(e.clientY);
    judgePointerGesture = {at: Date.now(), x: hasX ? e.clientX : null, y: hasY ? e.clientY : null, cur: cur};
  }
  /** 坐标不可用（合成事件/老浏览器）时按同位置处理，不能因此放行危险过渡。 */
  function nearJudgeGesture(g, x, y){
    if (g.x === null || x === null) return true;
    return Math.hypot(x - g.x, y - g.y) <= JUDGE_DBL_GUARD_PX;
  }
  /** 释义态按钮统一入口：吞掉判定后同一次快速连击的第二次指针点击。 */
  function swallowJudgeDoubleClick(e){
    const g = judgePointerGesture;
    if (!g) return false;
    if (g.cur !== cur) { judgePointerGesture = null; return false; }   // 已换卡：旧连击不再拦截
    if (!e || !(e.detail > 0)) return false;            // 键盘激活 / 程序 click 不拦
    const now = Date.now(), dt = now - g.at;
    if (!(dt >= 0 && dt <= JUDGE_DBL_GUARD_MS)) return false;
    const x = typeof e.clientX === "number" && Number.isFinite(e.clientX) ? e.clientX : null;
    const y = typeof e.clientY === "number" && Number.isFinite(e.clientY) ? e.clientY : null;
    if (!(e.detail >= 2 || nearJudgeGesture(g, x, y))) return false;
    judgePointerGesture = null;                          // 只吞一次，后续独立点击正常生效
    const acts = $("#acts");
    if (acts && acts.dataset) acts.dataset.guard = "judge-dblclick";
    if (now - judgeGuardNoticeAt > JUDGE_DBL_GUARD_MS) {
      judgeGuardNoticeAt = now;
      toast("已记录判定，先看释义；再点一次「下一个」继续");
    }
    return true;
  }
  // 捕获阶段统一拦截释义态的连击点击：真实浏览器里第二次点击可能落在任何新
  // 按钮上（「下一个」「记错了，其实会」，或以后新增的「取消熟练」），一律不执行，
  // 避免改判、翻页或误标熟练。键盘激活的 click.detail 为 0，不受影响。
  document.addEventListener("click", (e) => {
    if (verdict === null) return;
    if (!swallowJudgeDoubleClick(e)) return;
    e.stopPropagation?.();
    e.preventDefault?.();
  }, true);

  /**
   * 22 自动续背后「返回上一组结果」按钮：仅在新组首个有效判定前可用。
   * 现场是内存快照（含上一组完成页撤销栈），刷新后不可恢复，按钮文案与 title 如实说明。
   */
  function autoReturnButtonHtml(){
    if (!autoResumeReturnArmed || !autoResumeReturnSnap) return "";
    if (drillMode || inSubgroup() || verdict !== null) return "";
    if (answered !== 0) return "";
    const label = autoResumeReturnFromWait ? "返回等待页" : "返回上一组结果";
    const title = autoResumeReturnFromWait
      ? "仅在自动开始的新组首个判定前可用；刷新后本页等待资格失效"
      : "仅在自动开始的新组首个判定前可用；刷新页面后上一组结果不可恢复";
    return '<button type="button" class="btn ghost sm" id="returnPrevResult" title="' + title + '">' + label + '</button>';
  }

  function renderCard(){
    sharedCardRefreshPending = false;
    renderSurvey();
    hideExPop();
    const c = $("#card"), a = $("#acts");
    const cardWord = currentBookId + ":" + cur;
    const wordChanged = c.dataset.renderedWord !== cardWord;
    if (wordChanged) { c.scrollTop = 0; studyReadingScroll = null; }
    c.dataset.renderedWord = cardWord;
    c.classList.toggle("has-answer", cur !== null && verdict !== null);
    // F1 卡片密度：只给卡片加内部密度 class，动作区/按钮/释义字号不动。
    c.classList.toggle("card-compact", cur != null && S.settings.cardDensity === "compact");
    const oldFocus = document.activeElement;
    const restoreFocus = oldFocus && (c.contains?.(oldFocus) || a.contains?.(oldFocus));
    a.classList.toggle("revealed", cur !== null && verdict !== null);
    if (a.dataset) a.dataset.guard = "";   // 新一次渲染后旧的连击拦截标记失效
    const finishRender = () => {
      cancelInputGesture();
      applyActionLayout();
      applyActionBindingHints();
      fitVisibleWords();
      const message = cur == null ? (emptyWaitActive() ? "本页正在等待可背词，可随时退出等待。" : groupTotal ? "本组学习结束。" : "当前暂无待背单词。") : W[cur].w + (verdict === null
        ? "，请先回忆，再选择会或不会。"
        : (verdict ? "，已记为会。" : "，已记为不会。") + W[cur].m);
      c.setAttribute?.("aria-label", cur == null ? (emptyMainPage() ? "等待到期与学习范围" : "本组学习结果") : "当前单词：" + W[cur].w);
      const announcement = $("#studyAnnouncement");
      if (announcement && announcement.textContent !== message) announcement.textContent = message;
      // 重绘会移除原按钮；键盘操作后把焦点留在学习区，空格仍可继续。
      if (restoreFocus) {
        const target = oldFocus.id && $("#" + oldFocus.id);
        (target || c).focus?.({preventScroll: true});
      }
      renderCapSurfaces();
      renderPlanPendingNotice();
      renderAutoResume();
      renderResumeNotice();
      // U3：整页统一滚动后，换词从词头继续；同卡改判/呈现调整保留阅读位置。
      // 只在词头已被卷出学习主区时上移，不因首次渲染把统计条卷走。
      const studyMain = $("#main");
      if (wordChanged && cur != null && $("#v-study")?.classList.contains("on")
          && studyMain?.scrollTop > 0 && c.getBoundingClientRect && studyMain.getBoundingClientRect) {
        const cardTop = c.getBoundingClientRect().top, mainTop = studyMain.getBoundingClientRect().top;
        if (cardTop < mainTop) studyMain.scrollTop = Math.max(0, studyMain.scrollTop + cardTop - mainTop);
      }
      if ($("#v-set")?.classList.contains("on")) renderSettingsLifecycle();
    };
    const d = day();
    $("#s-new").textContent = d.n;
    $("#s-rev").textContent = Math.max(0, d.r - d.n);
    const progLabel = $("#s-proglabel");
    if (progLabel) progLabel.textContent = drillMode ? "错词特训" : extraSubgroup ? "临时加量" : newOnlySubgroup ? "纯新词子组" : "本次进度";
    $("#s-prog").textContent = Math.min(answered, groupTotal) + "/" + groupTotal;
    const pendingEl = $("#s-pending");
    if (pendingEl) {
      const pending = pendingReinforce();
      pendingEl.textContent = pending ? "待巩固 " + pending + " 次" : "";
      pendingEl.hidden = !pending;
    }
    $("#s-acc").textContent = (d.ok + d.no) ? Math.round(d.ok / (d.ok + d.no) * 100) + "%" : "—";

    if (cur == null) {
      const due = countDue();
      const freshLeft = orderedPool().some(i => !hasMainProgress(st(i)));
      const quotaLeft = Math.max(0, effectiveNewTarget() - d.n);
      const completed = answered > 0;
      const drillListN = drillMode ? 0 : wrongWordIndices().length;
      if (drillMode) {
        c.innerHTML =
          '<div class="done">' +
            "<h2>错词特训完成</h2>" +
            "<p>本次共 " + answered + " 张，正确 " + rightN + " 张</p>" +
            "<p>「会」会减少错次，「不会」会增加错次；学习档位与复习计划不受影响</p>" +
          "</div>";
        a.innerHTML =
          '<button type="button" class="btn primary" id="again">再练一组</button>' +
          '<button type="button" class="btn ghost" id="exitDrillBtn">退出特训</button>' +
          (undoStack.length ? '<button type="button" class="btn ghost sm" id="undoBtn">撤销上一步</button>' : "");
        $("#again").onclick = () => startDrill();
        $("#exitDrillBtn").onclick = exitDrill;
        if (undoStack.length) $("#undoBtn").onclick = undo;
        $("#hint").textContent = completionShortcutHint("return");
        renderDrillEntry();
        finishRender();
        return;
      }
      if (inSubgroup()) {
        // 受控子组（23 临时加量 / 07 纯新词子组）完成页：回原主组现场，不把原组伪装完成
        const capBlockedNow = reviewCapLeft() <= 0;
        const subTitle = extraSubgroup ? "临时加量完成" : "纯新词子组完成";
        const subLead = extraSubgroup
          ? "<p>本次临时加量 " + groupTotal + " 张，正确 " + rightN + " 张</p>"
          : "<p>本次纯新词子组 " + groupTotal + " 张，正确 " + rightN + " 张</p>";
        c.innerHTML =
          '<div class="done">' +
            "<h2>" + subTitle + "</h2>" +
            subLead +
            "<p>今日已学新词 <b>" + d.n + "</b> / <b>" + effectiveNewTarget() + "</b>；子组结束会回到原组现场</p>" +
            (capBlockedNow ? "<p>原组仍暂停：今日复习额度已用完，可提高上限或明天继续</p>" : "") +
          "</div>";
        a.innerHTML =
          '<button type="button" class="btn primary" id="extraBack">' +
            (capBlockedNow ? "返回原组（复习额度暂停）" : "返回原组") + "</button>" +
          '<button type="button" class="btn ghost" id="goStats">查看统计</button>' +
          (undoStack.length ? '<button type="button" class="btn ghost sm" id="undoBtn">撤销上一步</button>' : "");
        $("#extraBack").onclick = endActiveSubgroup;
        $("#goStats").onclick = () => show("stats");
        if (undoStack.length) $("#undoBtn").onclick = undo;
        $("#hint").textContent = completionShortcutHint("return");
        renderDrillEntry();
        finishRender();
        return;
      }
      const capDone = capGroupEnded && reviewCapLeft() <= 0;   // 用户主动结束被额度暂停的本组
      const gInfo = groupInfo();
      // 16：拼写专项入口与批次 D 的 #resumeNotice、自动续背完成页状态区共存——只加一个按钮，
      // 不改 #card/#acts 顺序与几何（完成页 #card 无 .word-face，不受固定高度规则影响）。
      const spellStats = spellingCandidateStats(), spellN = spellStats.size;
      c.innerHTML =
        '<div class="done">' +
          "<h2>" + (capDone ? "本组已暂停" : completed ? "本组完成" : emptyWaitActive() ? "本页等待到期" : "暂无待背单词") + "</h2>" +
          "<p>本次共 " + answered + " 张，正确 " + rightN + " 张</p>" +
          (completed
            ? "<p>本组完成 <b>" + gInfo.done + "</b>/<b>" + gInfo.groupTotal + "</b> · 剩余到期 <b>"
              + gInfo.remainingDue + "</b> 个</p>"
            : "") +
          '<div class="big">' + scopedMasteredCount() + "<span>/ " + inScopeCount() + " 已掌握</span></div>" +
          (capDone
            ? "<p>今日复习额度已用完，仍有 <b>" + due + "</b> 个词到期；明天自动重置，也可在设置页提高上限后继续。未答位置与待巩固已保留</p>"
            : due
              ? "<p>另有 <b>" + due + "</b> 个词已到复习时间</p>"
              : freshLeft && quotaLeft ? (isBacklogGuarded()
                  ? "<p>今天优先复习：到期词超出今日剩余复习额度，已暂停自动补新词；如需继续学新词，可点「仍学今日计划内新词」</p>"
                  : "<p>还有新词可学，可继续下一组</p>")
              : freshLeft ? "<p>今日新词目标已完成；到期复习可继续，新词明天更新</p>"
              : "<p>当前范围没有新词或到期复习；可调整筛选或管理熟练词</p>") +
          (hasPendingScopeSettings()
            ? "<p>设置已更改：下一组将按新设置开始（匹配 <b>" + inScopeCount()
              + "</b> 词）；上一组仍按开始时的范围与固定分母统计。</p>"
            : "") +
          (drillListN ? "<p>错词本有 <b>" + drillListN + "</b> 个词，可开始错词特训</p>" : "") +
          (proficientCount() ? "<p>已排除 " + proficientCount() + " 个熟练词，可在词表中取消</p>" : "") +
          (!spellN && spellStats.skippedNoHint
            ? "<p>当前范围有 " + spellStats.skippedNoHint + " 个词缺少有效中文提示，已跳过拼写专项。</p>" : "") +
        "</div>";
      a.innerHTML =
        '<button type="button" class="btn primary" id="again">' + (capDone ? "重新开始本组" : "继续下一组") + "</button>" +
        (drillListN ? '<button type="button" class="btn ghost" id="startDrillBtn">错词特训</button>' : "") +
        (spellN ? '<button type="button" class="btn ghost" id="startSpellingBtn" title="用当前范围的词练拼写：不占新词额度、不记为学习进度">拼写专项（' + spellN + " 词）</button>" : "") +
        '<button type="button" class="btn ghost" id="goStats">查看统计</button>' +
        (undoStack.length ? '<button type="button" class="btn ghost sm" id="undoBtn">撤销上一步</button>' : "");
      $("#again").onclick = e => runStudyAction("continue",{event:e});
      $("#again").disabled = candidateStatsNow().available < 1;
      if (drillListN) $("#startDrillBtn").onclick = () => startDrill();
      if (spellN) $("#startSpellingBtn").onclick = () => startSpellingDrill();
      $("#goStats").onclick = () => show("stats");
      if (undoStack.length) $("#undoBtn").onclick = undo;
      $("#hint").textContent = groupTotal > 0 && candidateStatsNow().available > 0 ? completionShortcutHint("continue") : "";
      renderDrillEntry();
      finishRender();
      return;
    }

    const x = W[cur], p = st(cur);
    const stage = p ? p[0] : 0, K = S.settings.keys;
    const proficientBtn = '<button type="button" class="btn proficient" id="markProficient" title="熟练词今后不再进入背诵或复习">熟练<kbd>' + esc(keyName(K.proficient)) + '</kbd></button>';
    const starBtn =
      '<button type="button" class="star' + (isStar(cur) ? " on" : "") + '" id="star" ' +
      'aria-label="' + (isStar(cur) ? "取消收藏" : "收藏") + '" aria-pressed="' + isStar(cur) + '" title="收藏（' + keyName(K.star) + '）">★</button>';

    // F1：标签/阶段/词性由外观设置控制；词头始终在答案前，回忆阶段不生成释义块。
    let h = '<div class="word-face" role="group" aria-label="' + (S.settings.showCardStage ? "单词与复习阶段" : "单词") + '" tabindex="0">';
    h += cardMetaHtml(x);
    h += '<div class="word" lang="en">' + esc(x.w) + "</div>";
    if (S.settings.showPh) { const pron = pronHtml(x); if (pron) h += '<div class="ph">' + pron + "</div>"; }
    h += cardPosHtml(x);
    h += cardStageHtml(stage);
    h += '<button type="button" class="spk" id="spk" aria-label="发音" title="发音（' + keyName(K.speak) + '）"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg></button>';
    h += "</div>";

    if (verdict !== null) {
      h += '<div class="answer" role="region" aria-label="释义与例句" tabindex="0"><span class="answer-label">释义与用法</span>';
      h += cardAnswerBodyHtml(x);
      h += "</div>";
    }

    // F1：同一张卡只重绘呈现时保留已展开的词形 details 与卡内滚动；换词回默认。
    const keepCardView = !wordChanged;
    const fmOpenBefore = keepCardView && !!c.querySelector?.(".answer-extra")?.open;
    const scrollBefore = keepCardView ? (c.scrollTop || 0) : 0;
    c.innerHTML = starBtn + h;
    if (keepCardView) {
      if (scrollBefore) c.scrollTop = scrollBefore;
      if (fmOpenBefore) { const fm = c.querySelector?.(".answer-extra"); if (fm) fm.open = true; }
    }
    if (wordChanged) {
      c.classList.remove("enter");
      c.classList.add("enter");
      setTimeout(() => c.classList.remove("enter"), 200);   // 动画 .16s，留 40ms 余量
    }
    bindExLookup(c);

    $("#spk").onclick = (e) => { e.stopPropagation(); runStudyAction("speak",{event:e,source:"button"}); };
    $("#star").onclick = (e) => {
      e.stopPropagation();
      runStudyAction("star",{event:e,source:"button"});
    };
    if (S.settings.autoSpk && verdict === null && !autoSpoken) { autoSpoken = true; speak(x.w); }

    if (verdict === null) {
      a.innerHTML =
        '<button type="button" class="btn ok" id="ok">会<kbd>' + keyName(K.know) + "</kbd></button>" +
        '<button type="button" class="btn no" id="no">不会<kbd>' + keyName(K.dont) + "</kbd></button>" + proficientBtn +
        autoReturnButtonHtml() +
        (drillMode ? '<button type="button" class="btn ghost sm" id="exitDrillBtn">退出特训</button>' : "") +
        // 23 临时加量子组没有组尾入口，用 #acts 里的返回按钮；07 纯新词子组统一用 #groupFooter 的 #returnMainGroup，避免同屏两个「返回原组」。
        (extraSubgroup ? '<button type="button" class="btn ghost sm" id="extraExitBtn">返回原组</button>' : "");
      $("#no").onclick = (e) => runStudyAction("dont",{event:e,source:"button"});
      $("#ok").onclick = (e) => runStudyAction("know",{event:e,source:"button"});
      if ($("#returnPrevResult")) $("#returnPrevResult").onclick = returnToPreviousResults;
      if (extraSubgroup) $("#extraExitBtn").onclick = endExtraSubgroup;
      if (drillMode) {
        $("#exitDrillBtn").onclick = exitDrill;
        $("#hint").textContent = "错词特训：「会」减少错次，「不会」增加错次；不改动学习档位";
      } else if (isCapPaused()) {
        $("#hint").textContent = "今日复习额度已用完：当前复习卡与待巩固已保留。提高上限、撤销判定或明天继续后可恢复；新词与错词特训不受此限制";
      } else if (extraSubgroup) {
        $("#hint").textContent = "临时加量：本组只含新词，完成后回到原组；已学新词的组内重考仍受当日复习预算约束";
      } else if (newOnlySubgroup) {
        $("#hint").textContent = "纯新词子组：只学今日计划内新词，完成后回到原组；已学新词的组内重考仍受当日复习预算约束";
      } else {
        $("#hint").textContent = "想好中文意思后按「会」或「不会」；标为「熟练」会移出背诵与复习，可在词表恢复";
      }
    } else {
      const wasOK = verdict === true;
      const otherKey = wasOK ? K.dont : K.know;
      const otherTxt = wasOK ? "不会" : "会";
      a.innerHTML =
        '<span class="verdict ' + (wasOK ? "ok" : "no") + '">' +
          '<span class="seal" aria-hidden="true">' + (wasOK ? "✓" : "✗") + "</span>" +
          (wasOK ? "已记为「会」" : "已记为「不会」") +
          "<kbd>" + keyName(wasOK ? K.know : K.dont) + "</kbd>" +
        "</span>" +
        '<button type="button" class="btn ghost" id="fix">记错了，其实' + otherTxt +
          "<kbd>" + keyName(otherKey) + "</kbd></button>" +
        '<button type="button" class="btn primary sm" id="nx">下一个<kbd>' + keyName(K.next) + "</kbd></button>" +
        // F1：第三行固定次级动作 + 未固定撤销/熟练的「更多操作」（始终占原第三行槽位）。
        secondaryActionsRowHtml() +
        (drillMode ? '<button type="button" class="btn ghost sm" id="exitDrillBtn">退出特训</button>' : "") +
        // 同 recall：newOnly 用组尾 #returnMainGroup 返回，避免重复入口。
        (extraSubgroup ? '<button type="button" class="btn ghost sm" id="extraExitBtn">返回原组</button>' : "");
      $("#fix").onclick = (e) => runStudyAction(wasOK?"dont":"know",{event:e,source:"button"});
      if (extraSubgroup) $("#extraExitBtn").onclick = endExtraSubgroup;
      $("#nx").onclick = (e) => runStudyAction("next",{event:e,source:"button"});
      const undoEl = $("#undoBtn");
      if (undoEl) undoEl.onclick = (e) => runStudyAction("undo",{event:e,source:"button"});
      bindSecondaryActionButtons();
      if (drillMode) {
        $("#exitDrillBtn").onclick = exitDrill;
        $("#hint").textContent = (wasOK ? "「会」→ 错次 -1" : "「不会」→ 错次 +1，留在错词本")
          + "　·　记错了按 " + keyName(otherKey) + " 改判　·　Ctrl+Z 撤销";
      } else if (wasOK && stageBefore + 1 >= MASTER) {
        $("#hint").textContent = "「会」→ 已掌握，不再安排复习　·　记错了按 " + keyName(otherKey) + " 改判　·　Ctrl+Z 撤销";
      } else if (wasOK) {
        const active = activeStagesMs();
        const idx = Math.min(stageBefore, active.length - 1);
        $("#hint").textContent = "「会」→ " + formatStagesMs(active[idx]) + "后复习　·　记错了按 " + keyName(otherKey) + " 改判　·　Ctrl+Z 撤销";
      } else {
        $("#hint").textContent = "「不会」→ 本组稍后重考，" + formatStagesMs(activeRelearnMs()) + "后重新学习　·　Ctrl+Z 撤销";
      }
    }
    const profEl = $("#markProficient");
    if (profEl) profEl.onclick = (e) => {
      runStudyAction("proficient",{event:e,source:"button"});
    };
    renderDrillEntry();
    finishRender();
  }

  function countDue(){
    const now = Date.now();
    let n = 0;
    for (let i = 0; i < W.length; i++) {
      if (!inScope(i) || isProficient(i)) continue;
      const p = st(i);
      if (hasMainProgress(p) && p[0] < MASTER && p[1] <= now) n++;
    }
    return n;
  }
  /** 本组尚未判定、且当前仍到期的卡数（属于本组，不再重复计入 remainingDue）。 */
  function groupOwnRemainingDue(){
    const now = Date.now();
    const seen = new Set();
    let own = 0;
    for (let k = qi; k < Q.length; k++) {
      const i = Q[k];
      if (i == null || seen.has(i)) continue;
      seen.add(i);
      if (i === cur && verdict !== null) continue;    // 当前卡已判定
      const p = st(i);
      if (!p || !hasMainProgress(p) || p[0] >= MASTER || p[1] > now || isProficient(i)) continue;
      own++;
    }
    return own;
  }
  /**
   * 组尾/继续下一组统计：done=本组已判定主卡数（分母固定），
   * remainingDue=countDue() 去掉本组未判定的到期卡；hasMore=还有到期或（有额度、有未学词且未被积压保护拦下）。
   */
  function groupInfo(){
    const plan = activePlan();
    const plannedGroupSize = plan && Number.isInteger(plan.groupSize) ? plan.groupSize
      : Number.isInteger(S.settings.groupSize) ? S.settings.groupSize : GROUP_SIZE_DEFAULT;
    const groupSize = Math.max(GROUP_SIZE_MIN, Math.min(GROUP_SIZE_MAX, plannedGroupSize));
    const total = groupTotal;
    const done = Math.min(answered, total);
    // 额度暂停态被用户主动结束（capGroupEnded）后，Q 里未判定的到期卡不再属于本组，
    // 不得再从 remainingDue 扣掉，否则组尾「剩余到期」会偏小并与积压提示自相矛盾。
    const ownUnjudgedDue = capGroupEnded ? 0 : groupOwnRemainingDue();
    const remainingDue = Math.max(0, countDue() - ownUnjudgedDue);
    const quotaLeft = Math.max(0, effectiveNewTarget() - day().n);
    const hasMore = remainingDue > 0
      || (quotaLeft > 0 && extraCandidatesAvailable() > 0 && !isBacklogGuarded());
    return {groupSize: groupSize, groupTotal: total, done: done,
      remainingDue: remainingDue, hasMore: hasMore};
  }
  function formatReviewTime(time){
    const d = new Date(time), pad = n => String(n).padStart(2, "0");
    return todayStr(d) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  /** 与实际入队范围一致：排除熟练、已掌握与范围外词。 */
  function reviewPlan(now = Date.now()){
    let due = 0, upcoming = 0, next = null;
    for (let i = 0; i < W.length; i++) {
      const p = st(i);
      if (!hasMainProgress(p) || p[0] >= MASTER || isProficient(i) || !inScope(i)) continue;
      if (p[1] <= now) due++;
      else {
        if (p[1] <= now + 24 * 60 * 60 * 1000) upcoming++;
        if (next === null || p[1] < next) next = p[1];
      }
    }
    return {due, upcoming, next};
  }
  function renderReviewPlan(){
    const plan = reviewPlan(), el = $("#reviewPlan");
    if (el) el.innerHTML = '<span class="review-count"><b>' + plan.due + '</b><span>个词已到期</span></span>' +
      '<span class="review-upcoming">接下来 24 小时到期 ' + plan.upcoming + ' 词</span>' +
      '<span class="review-next">' + esc(plan.next !== null ? "下次到期：" + formatReviewTime(plan.next) : "当前没有后续复习安排，可继续学习新词。") + "</span>";
    // 20 单日复习额度摘要：今日已用 / 上限、可继续复习、仍待复习（与 #reviewPlan 格式互不影响）。
    const capLine = $("#reviewCapLine");
    if (capLine) {
      const cap = getReviewCap(), used = reviewLedgerUsed(), left = reviewCapLeft();
      capLine.innerHTML =
        "<span>今日已用 <b>" + used + "</b> / 上限 <b>" + (cap === 0 ? "不限" : cap) + "</b></span>" +
        "<span>· 可继续复习 <b>" + (left === Infinity ? "不限" : left) + "</b></span>" +
        "<span>· 仍待复习 <b>" + plan.due + "</b></span>";
    }
    const btn = $("#btnDueList");
    if (btn) {
      btn.disabled = !plan.due;
      btn.textContent = plan.due ? "查看 " + plan.due + " 个到期词" : "暂无到期词";
      btn.classList.toggle("primary", Boolean(plan.due));
      btn.classList.toggle("ghost", !plan.due);
    }
    const studyBtn = $("#btnStatsStudy");
    if (studyBtn) {
      studyBtn.textContent = Object.keys(S.progress || {}).length ? "继续背诵" : "开始背诵";
      studyBtn.classList.toggle("primary", !plan.due);
      studyBtn.classList.toggle("ghost", Boolean(plan.due));
    }
    const goal = $("#todayGoal");
    if (goal) {
      const d = S.days[todayStr()] || {n: 0, r: 0, ok: 0, no: 0};
      // 23 今日有效目标 = 计划 + 临时加量；长期 dailyNew 不变（设置页输入仍是计划值）。
      const plan = Math.max(1, S.settings.dailyNew);
      const extra = extraDayLedger().extra;
      const quota = Math.max(1, effectiveNewTarget());
      const pct = Math.min(100, Math.round(d.n / quota * 100));
      const acc = (d.ok + d.no) ? Math.round(d.ok / (d.ok + d.no) * 100) + "%" : "—";
      const planText = extra > 0 ? "计划 " + plan + " + 临时 " + extra + " · " : "";
      goal.innerHTML = '<div class="tg-head"><span>今日新词</span><b>' + d.n + " / " + quota + "</b></div>" +
        '<div class="tg-track" role="img" aria-label="今日新词 ' + d.n + " / " + quota + '"><i style="width:' + pct + '%"></i></div>' +
        '<div class="tg-meta">' + planText + "今日已作答 " + d.r + " 题 · 正确率 " + acc + "</div>";
    }
  }
  function startOfLocalDay(t){
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  /** 未来 N 天的到期词数；今天这一柱包含已到期与今天稍后到期的词 */
  function dueForecast(days = 14, now = Date.now()){
    days = Math.max(1, Math.min(31, Math.round(days || 14)));
    const start = startOfLocalDay(now);
    const dates = [], labels = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      dates.push(todayStr(d));
      labels.push(i === 0 ? "今天" : i === 1 ? "明天"
        : d.getDate() === 1 ? (d.getMonth() + 1) + "/1" : String(d.getDate()));
    }
    const counts = new Array(days).fill(0);
    let overdue = 0, dueToday = 0, later = 0;
    for (let i = 0; i < W.length; i++) {
      if (!inScope(i) || isProficient(i)) continue;
      const p = st(i);
      if (!hasMainProgress(p) || p[0] >= MASTER) continue;
      const due = p[1];
      const idx = Math.round((startOfLocalDay(due) - start) / 86400000);
      if (idx <= 0) {
        counts[0]++;
        if (due <= now) overdue++; else dueToday++;
      } else if (idx < days) {
        counts[idx]++;
      } else {
        later++;
      }
    }
    let peak = -1, peakCount = 0;
    counts.forEach((v, i) => {
      if (v > peakCount) { peakCount = v; peak = i; }
    });
    return {
      days: days, dates: dates, labels: labels, counts: counts,
      overdue: overdue, dueToday: dueToday, later: later,
      peak: peak, peakCount: peakCount,
      next7: counts.slice(0, 7).reduce((a, b) => a + b, 0),
      total: counts.reduce((a, b) => a + b, 0)
    };
  }
  const FREQ_TIERS = [
    { key: "high", label: "高频", range: "≥20 次", min: 20, max: Infinity },
    { key: "upper", label: "中高频", range: "10–19 次", min: 10, max: 19 },
    { key: "mid", label: "中频", range: "5–9 次", min: 5, max: 9 },
    { key: "low", label: "低频", range: "2–4 次", min: 2, max: 4 },
    { key: "rare", label: "仅 1 次", range: "1 次", min: 1, max: 1 }
  ];
  /** 当前背诵范围按真题词频分层的已掌握 / 学习中 / 未学分布 */
  function frequencyMastery(){
    const rows = FREQ_TIERS.map(t => ({
      key: t.key, label: t.label, range: t.range, min: t.min, max: t.max,
      total: 0, mastered: 0, learning: 0, unseen: 0
    }));
    let total = 0, mastered = 0;
    for (let i = 0; i < W.length; i++) {
      if (!inScope(i) || isProficient(i)) continue;
      const x = W[i];
      let row = null;
      for (const r of rows) {
        if (x.f >= r.min && x.f <= r.max) { row = r; break; }
      }
      if (!row) continue;
      row.total++;
      total++;
      const p = st(i);
      if (!hasMainProgress(p)) {
        row.unseen++;
      } else if (p[0] >= MASTER) {
        row.mastered++;
        mastered++;
      } else {
        row.learning++;
      }
    }
    return {
      rows: rows.filter(r => r.total > 0),
      total: total,
      mastered: mastered,
      rate: total ? mastered / total : 0
    };
  }
  function pctOf(part, whole){
    return whole ? Math.round(part / whole * 100) : 0;
  }
  function wordReviewLabel(i){
    if (isProficient(i)) return "已标为熟练，不再安排复习";
    const p = st(i);
    if (!hasMainProgress(p)) return "尚未学习，判定后安排复习";
    if (p[0] >= MASTER) return "已掌握，不再安排复习";
    return "下次复习：" + (p[1] <= Date.now() ? "已到期 · " : "") + formatReviewTime(p[1]);
  }
  function masteredCount(){
    let n = 0;
    for (let i = 0; i < W.length; i++) if (isMastered(i)) n++;
    return n;
  }
  function scopedMasteredCount(){
    let n = 0;
    for (let i = 0; i < W.length; i++) if (inScope(i) && !isProficient(i) && isMastered(i)) n++;
    return n;
  }
  function inScopeCount(){
    let n = 0;
    for (let i = 0; i < W.length; i++) if (inScope(i) && !isProficient(i)) n++;
    return n;
  }

  /* ================= 词表（虚拟滚动） ================= */
  const RH = 52;
  let filt = [];
  /** 每本词书独立保留搜索、筛选、滚动位置与活动行；只有主动改筛选才回顶部。 */
  const listUiByBook = {};
  let listActiveWord = null;
  let listActiveAction = "open-word";
  function listUiFor(id){
    if (!listUiByBook[id]) {
      listUiByBook[id] = {
        q: "", fst: "all", fsc: "scope",
        scrollTop: 0, activeWord: null, activeAction: "open-word"
      };
    }
    return listUiByBook[id];
  }
  function saveListUi(){
    // 统计下钻是临时列表筛选层：不把下钻基线的控件值写入逐书保存的筛选，退出后恢复进入前筛选。
    if (statsDrill) return;
    const ui = listUiFor(currentBookId);
    if ($("#q")) ui.q = $("#q").value;
    if ($("#fst")) ui.fst = $("#fst").value || "all";
    if ($("#fsc")) ui.fsc = $("#fsc").value || "scope";
    if ($("#listScroll")) ui.scrollTop = $("#listScroll").scrollTop || 0;
    ui.activeWord = listActiveWord;
    ui.activeAction = listActiveAction;
  }
  function restoreListUi(id){
    const ui = listUiFor(id);
    if ($("#q")) $("#q").value = ui.q;
    if ($("#fst")) $("#fst").value = ui.fst;
    if ($("#fsc")) $("#fsc").value = ui.fsc;
    listActiveWord = ui.activeWord;
    listActiveAction = ui.activeAction || "open-word";
    if ($("#listScroll")) $("#listScroll").scrollTop = ui.scrollTop || 0;
  }
  function listStatusText(i){
    const p = st(i);
    return isProficient(i) ? "熟练" : isMastered(i) ? "已掌握" : (hasMainProgress(p) ? "第" + p[0] + "档" : "未学");
  }
  /** 词表状态/范围摘要的文案表（与 #fst / #fsc 选项一一对应）。 */
  const LIST_STATUS_LABEL = {
    all: "全部", active: "待学习", new: "未学", learn: "学习中",
    due: "到期", done: "已掌握", proficient: "熟练", wrong: "错词", star: "收藏"
  };
  const LIST_SCOPE_LABEL = { all: "全库", high: "全库 · 高频", cold: "全库 · 冷门", ky: "全库 · 大纲词" };
  /**
   * 11 词表结果摘要：「当前范围/全库 · 状态 · 共 N 词」。
   * 保留「共 N 词」子串（既有测试与读屏习惯），当前范围时补充全库词数说明作用域。
   */
  function listSummaryText(){
    // 统计下钻是独立临时筛选层：摘要明确来源与「共 N 词」，不冒充用户保存的筛选。
    if (statsDrill) {
      return "统计下钻 · " + statsDrill.label + " · 共 " + filt.length + " 词（临时列表筛选，不改学习范围）"
        + (storageOK ? "" : "　·　当前环境无法保存进度");
    }
    const fs = $("#fst") ? $("#fst").value : "all";
    const sc = $("#fsc") ? $("#fsc").value || "scope" : "scope";
    const q = $("#q") ? String($("#q").value || "").trim() : "";
    const scope = sc === "scope" ? "当前范围" : (LIST_SCOPE_LABEL[sc] || "全库");
    const status = LIST_STATUS_LABEL[fs] || "全部";
    const head = (q ? "搜索「" + q + "」 · " : "") + scope + " · " + status;
    const tail = sc === "scope" ? "（全库 " + W.length + " 词）" : "";
    return head + " · 共 " + filt.length + " 词" + tail
      + (storageOK ? "" : "　·　当前环境无法保存进度");
  }
  function announceListRow(){
    const el = $("#listAnnouncement");
    if (!el) return;
    const pos = listActiveWord == null ? -1 : filt.indexOf(listActiveWord);
    if (pos < 0) { el.textContent = "词表共 " + filt.length + " 行"; return; }
    const x = W[filt[pos]];
    el.textContent = "第 " + (pos + 1) + " 行，共 " + filt.length + " 行；" + x.w + "，" + listStatusText(filt[pos]);
  }
  function applyFilter(resetScroll = true){
    dropStaleStatsDrill();
    const drilled = !!statsDrill;
    // 下钻层用统计同口径的独立词集，忽略当前控件值；控件只作为普通筛选的唯一入口。
    const q = drilled ? "" : $("#q").value.trim().toLowerCase();
    const fs = drilled ? "all" : $("#fst").value, sc = drilled ? "scope" : $("#fsc").value;
    const now = Date.now();
    if (drilled) {
      filt = statsDrillIndices();
    } else {
      filt = [];
      for (let i = 0; i < W.length; i++) {
        const x = W[i];
        if (sc === "scope" && !inScope(i)) continue;
        if (sc === "high" && x.f < 5) continue;
        if (sc === "cold" && x.f > 2) continue;
        if (sc === "ky" && x.ky !== 1) continue;
        const p = st(i);
        const proficient = isProficient(i);
        if (proficient && fs !== "proficient") continue;
        if (fs === "proficient" && !proficient) continue;
        if (fs === "active" && (proficient || isMastered(i))) continue;
        if (fs === "new" && (proficient || hasMainProgress(p))) continue;
        if (fs === "learn" && (proficient || !hasMainProgress(p) || p[0] >= MASTER)) continue;
        if (fs === "due" && (proficient || !hasMainProgress(p) || p[0] >= MASTER || p[1] > now)) continue;
        if (fs === "done" && (proficient || !isMastered(i))) continue;
        if (fs === "wrong" && (proficient || !p || p[3] === 0)) continue;
        if (fs === "star" && !isStar(i)) continue;
        if (q && x.w.indexOf(q) < 0 && x.m.toLowerCase().indexOf(q) < 0) continue;
        filt.push(i);
      }
    }
    if (drilled) {
      const kind = statsDrill.kind;
      filt.sort((a, b) => (kind === "due" ? st(a)[1] - st(b)[1] : 0) || W[a].r - W[b].r);
    } else {
      filt.sort((a, b) => (fs === "due" ? st(a)[1] - st(b)[1] : 0) || W[a].r - W[b].r);
    }
    pruneListSelection();
    $("#listCount").textContent = listSummaryText();
    const empty = $("#listEmpty");
    if (empty) empty.hidden = filt.length > 0;
    $("#listWrap").hidden = !filt.length;
    const inner = $("#listInner");
    inner.style.height = (filt.length * RH) + "px";
    if (resetScroll) {
      $("#listScroll").scrollTop = 0;
      listActiveWord = filt.length ? filt[0] : null;
      listActiveAction = "open-word";
    } else {
      $("#listScroll").scrollTop = Math.min($("#listScroll").scrollTop, Math.max(0, filt.length * RH - $("#listScroll").clientHeight));
      if (listActiveWord == null || filt.indexOf(listActiveWord) < 0) {
        listActiveWord = filt.length ? filt[0] : null;
        listActiveAction = "open-word";
      }
    }
    saveListUi();
    renderRows();
    renderDrillEntry();
    renderListToolSurfaces();
  }
  /**
   * 虚拟列表渲染。restoreFocus=false 供 focusListRow 使用：方向键换行时旧行会被 innerHTML
   * 重绘移除，把焦点还给旧行会触发 focusin 把 listActiveWord 改写回旧词（C-07b 首次按键失效）；
   * 因此导航路径由调用者直接聚焦目标行。
   */
  function renderRows(restoreFocus = true){
    const sc = $("#listScroll"), top = sc.scrollTop, h = sc.clientHeight;
    const inner = $("#listInner"), focused = document.activeElement;
    const focusAction = focused?.dataset?.openWord !== undefined ? "open-word"
      : focused?.dataset?.proficient !== undefined ? "proficient"
      : focused?.dataset?.rowCheck !== undefined ? "row-check" : null;
    const focusWord = focusAction === "open-word" ? focused.dataset.openWord
      : focusAction === "proficient" ? focused?.dataset?.proficient
      : focusAction === "row-check" ? focused?.dataset?.rowCheck : undefined;
    const hasFocus = focusAction && inner.contains?.(focused);
    if (!filt.length) {
      if (inner.innerHTML !== "") inner.innerHTML = "";
      return;
    }
    const s = Math.max(0, Math.floor(top / RH) - 6);
    const e = Math.min(filt.length, Math.ceil((top + h) / RH) + 6);
    let activePos = listActiveWord == null ? -1 : filt.indexOf(listActiveWord);
    if (activePos < s || activePos >= e) activePos = Math.min(filt.length - 1, Math.max(0, s));
    listActiveWord = filt[activePos];
    if (!hasFocus) listActiveAction = "open-word";
    let html = "";
    for (let k = s; k < e; k++) {
      const i = filt[k], x = W[i], p = st(i);
      const active = k === activePos;
      const proficient = isProficient(i);
      const cls = proficient ? "badge-proficient" : isMastered(i) ? "st2" : (hasMainProgress(p) ? "st1" : "st0");
      const txt = listStatusText(i);
      const wordTab = active && listActiveAction === "open-word" ? "0" : "-1";
      const profTab = active && listActiveAction === "proficient" ? "0" : "-1";
      const selected = listOrganize && listSelection.has(i);
      // 非整理模式保持原有「单词按钮本身就是网格单元」的 DOM，整理模式才包一层放选择按钮。
      const wordButton = '<button type="button" class="' + (listOrganize ? "row-word" : "c-word row-word") +
        '" lang="en" data-open-word="' + i + '" tabindex="' + wordTab + '" aria-label="查看 ' + esc(x.w) +
        ' 详情">' + esc(x.w) + (isStar(i) ? " ★" : "") + "</button>";
      const wordCell = listOrganize
        ? '<span class="c-word has-check"><button type="button" class="row-check" role="checkbox" aria-checked="' +
          (selected ? "true" : "false") + '" data-row-check="' + i + '" tabindex="-1" aria-label="' +
          (selected ? "已选择 " : "选择 ") + esc(x.w) + '">✓</button>' + wordButton + "</span>"
        : wordButton;
      html += '<div class="row' + (active ? " row-active" : "") + (selected ? " row-selected" : "") + '" data-i="' + i + '" style="top:' + (k * RH) + 'px">' +
        '<span class="c-rank">#' + x.r + "</span>" + wordCell +
        '<span class="c-ph">' + esc(x.ph || "") + "</span>" +
        '<span class="c-mean">' + esc(x.m || "—") + "</span>" +
        '<span class="c-st ' + cls + '">' + txt + '</span>' +
        '<div class="c-actions row-actions"><button type="button" data-proficient="' + i + '" tabindex="' + profTab + '" aria-label="' + (proficient ? "取消" : "标为") + '熟练：' + esc(x.w) + '">' + (proficient ? "取消熟练" : "标为熟练") + '</button></div></div>';
    }
    if (inner.innerHTML === html) return;
    inner.innerHTML = html;
    if (hasFocus && restoreFocus) {
      const target = inner.querySelector?.('[data-' + focusAction + '="' + focusWord + '"]');
      (target || sc).focus?.({preventScroll: true});
    }
  }

  function scrollListRowIntoView(pos){
    const sc = $("#listScroll");
    if (!sc) return;
    const top = pos * RH;
    if (top < sc.scrollTop) sc.scrollTop = top;
    else if (top + RH > sc.scrollTop + sc.clientHeight) sc.scrollTop = top + RH - sc.clientHeight;
  }
  /**
   * C-07b：方向键/Tab 换行必须一次生效。先记下目标词与操作，再用 restoreFocus=false 渲染，
   * 避免 renderRows 把焦点还回旧行（旧行 focusin 会把 listActiveWord 改写回旧词），
   * 渲染后直接聚焦目标节点，并在聚焦后再写一次活动行，保证 listActiveWord/播报/焦点一致。
   */
  function focusListRow(pos, action){
    if (pos < 0 || pos >= filt.length) return false;
    const word = filt[pos], act = action || "open-word";
    listActiveWord = word;
    listActiveAction = act;
    scrollListRowIntoView(pos);
    renderRows(false);
    const target = $("#listInner")?.querySelector?.('[data-' + act + '="' + word + '"]');
    target?.focus?.({ preventScroll: true });
    listActiveWord = word;
    listActiveAction = act;
    announceListRow();
    saveListUi();
    return true;
  }
  function navigateList(e){
    const target = e.target;
    const isWord = target.dataset?.openWord !== undefined;
    const isProficientButton = target.dataset?.proficient !== undefined;
    const isRowCheck = target.dataset?.rowCheck !== undefined;
    if (!isWord && !isProficientButton && !isRowCheck) return;
    const word = +(isWord ? target.dataset.openWord : isProficientButton ? target.dataset.proficient : target.dataset.rowCheck);
    const pos = filt.indexOf(word);
    if (pos < 0) return;
    listActiveWord = word;
    listActiveAction = isWord ? "open-word" : isProficientButton ? "proficient" : "row-check";
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      let next = pos;
      if (e.key === "ArrowDown") next++;
      else if (e.key === "ArrowUp") next--;
      else if (e.key === "Home") next = 0;
      else next = filt.length - 1;
      if (next < 0 || next >= filt.length) return;
      e.preventDefault();
      focusListRow(next, "open-word");
      return;
    }
    const rowActions = listOrganize ? ["open-word", "row-check", "proficient"] : ["open-word", "proficient"];
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const at = Math.max(0, rowActions.indexOf(listActiveAction));
      const nextAct = e.key === "ArrowRight"
        ? rowActions[Math.min(rowActions.length - 1, at + 1)]
        : rowActions[Math.max(0, at - 1)];
      focusListRow(pos, nextAct);
      return;
    }
    if (e.key === "Tab") {
      // Tab 顺序与视觉顺序一致：单词 →（整理模式：选择）→ 熟练操作 → 离开列表；Shift+Tab 反向。
      const at = rowActions.indexOf(listActiveAction);
      if (at < 0) return;
      if (!e.shiftKey && at < rowActions.length - 1) {
        e.preventDefault();
        focusListRow(pos, rowActions[at + 1]);
      } else if (e.shiftKey && at > 0) {
        e.preventDefault();
        focusListRow(pos, rowActions[at - 1]);
      }
    }
  }

  /* ================= E 词表整理：保存筛选视图 / 多选批量整理 =================
   * 全部为列表侧状态：视图存独立 localStorage 键（不进每书 state/备份 v3/设置目录/进度签名）；
   * 整理选择与批量操作只在内存；批量熟练复用 setProficient 的权威语义（熟练键+主记录），
   * 一次保存、失败整次回滚内存；不写学习进度/判定/复习预算/学习时长。
   */
  const LIST_VIEWS_KEY = "vocab_list_views_v1";
  const LIST_VIEWS_KIND = "vocab-list-views";
  const LIST_VIEWS_VERSION = 1;
  const LIST_VIEWS_PER_BOOK = 12;
  const LIST_VIEW_NAME_MAX = 30;
  const LIST_VIEW_Q_MAX = 100;
  const LIST_VIEW_FST = ["all", "active", "new", "learn", "due", "done", "proficient", "wrong", "star"];
  const LIST_VIEW_FSC = ["scope", "all", "high", "cold", "ky"];
  const listViewStore = {loaded: false, ready: false, corrupt: false, error: "", views: []};
  let listViewStoreRaw = null;
  let listViewDirty = true;
  let listViewBookId = null;

  function normalizeListViewItem(v){
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const id = typeof v.id === "string" ? v.id.trim() : "";
    const book = typeof v.book === "string" ? v.book : "";
    const name = typeof v.name === "string" ? v.name.trim() : "";
    if (!id || id.length > 40) return null;
    if (!bookOf(book)) return null;
    if (!name || name.length > LIST_VIEW_NAME_MAX) return null;
    if (typeof v.q !== "string" || v.q.length > LIST_VIEW_Q_MAX) return null;
    if (!LIST_VIEW_FST.includes(v.fst) || !LIST_VIEW_FSC.includes(v.fsc)) return null;
    const at = Number.isFinite(v.at) && v.at > 0 ? Math.floor(v.at) : 0;
    return {id: id, book: book, name: name, q: v.q, fst: v.fst, fsc: v.fsc, at: at};
  }
  /** 严格解析独立视图键：任何一条非法都视为整份损坏（保留原文、拒绝覆写，需显式重置）。 */
  function parseListViewStore(raw){
    if (raw === null || raw === undefined) return {ok: true, corrupt: false, views: []};
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) {
      return {ok: false, corrupt: true, views: [], error: "保存的筛选视图不是有效 JSON"};
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || parsed.kind !== LIST_VIEWS_KIND || parsed.version !== LIST_VIEWS_VERSION
      || !Array.isArray(parsed.views)) {
      return {ok: false, corrupt: true, views: [], error: "筛选视图存储格式不正确（kind/version/views）"};
    }
    const views = [], ids = new Set();
    for (const item of parsed.views) {
      const view = normalizeListViewItem(item);
      if (!view) return {ok: false, corrupt: true, views: [], error: "筛选视图包含非法条目"};
      if (ids.has(view.id)) return {ok: false, corrupt: true, views: [], error: "筛选视图存在重复标识"};
      ids.add(view.id);
      views.push(view);
    }
    return {ok: true, corrupt: false, views: views};
  }
  function loadListViewStore(force){
    if (listViewStore.loaded && !force) return listViewStore;
    listViewStore.loaded = true;
    listViewStore.ready = false;
    listViewStore.corrupt = false;
    listViewStore.error = "";
    listViewStore.views = [];
    listViewStoreRaw = null;
    try {
      listViewStoreRaw = localStorage.getItem(LIST_VIEWS_KEY);
    } catch (e) {
      listViewStore.error = "当前环境无法读取本地存储，筛选视图暂不可用";
      listViewStore.corrupt = true;   // 读不到原文时也不覆盖
      listViewDirty = true;
      return listViewStore;
    }
    const parsed = parseListViewStore(listViewStoreRaw);
    listViewStore.ready = parsed.ok;
    listViewStore.corrupt = parsed.corrupt;
    listViewStore.error = parsed.error || "";
    listViewStore.views = parsed.views;
    listViewDirty = true;
    return listViewStore;
  }
  function persistListViewStore(views){
    if (!listViewStore.ready) return {ok: false, error: listViewStore.error || "筛选视图存储不可写"};
    try {
      const raw = JSON.stringify({kind: LIST_VIEWS_KIND, version: LIST_VIEWS_VERSION, views: views});
      localStorage.setItem(LIST_VIEWS_KEY, raw);
      listViewStoreRaw = raw;
      listViewStore.views = views;
      return {ok: true};
    } catch (e) {
      return {ok: false, error: "筛选视图保存失败：浏览器存储不可用或空间不足"};
    }
  }
  function currentBookListViews(){ return listViewStore.views.filter(v => v.book === currentBookId); }
  function newListViewId(){ return "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function setListViewStatus(text, error){
    const status = $("#listViewsStatus");
    if (!status) return;
    status.dataset.error = error ? "true" : "";
    status.textContent = text || "";
  }
  function listViewMetaText(view){
    const scope = view.fsc === "scope" ? "当前范围" : (LIST_SCOPE_LABEL[view.fsc] || "全库");
    const status = LIST_STATUS_LABEL[view.fst] || "全部";
    return (view.q ? "搜索「" + view.q + "」 · " : "") + scope + " · " + status;
  }
  function renderListViewRows(){
    loadListViewStore();
    listViewBookId = currentBookId;
    const list = $("#listViewsList"), saveBtn = $("#btnSaveListView"),
      resetBtn = $("#btnResetListViews"), input = $("#listViewName");
    const corrupt = listViewStore.corrupt || !listViewStore.ready;
    if (list) {
      if (corrupt) list.innerHTML = "";
      else {
        list.innerHTML = currentBookListViews().map(v =>
          '<div class="list-view-row" data-view-row="' + esc(v.id) + '">' +
            '<button type="button" class="list-view-apply" data-view-apply="' + esc(v.id) + '" aria-label="应用视图 ' + esc(v.name) + '">' + esc(v.name) + "</button>" +
            '<p class="list-view-meta">' + esc(listViewMetaText(v)) + "</p>" +
            '<input class="list-view-rename" data-view-rename-input="' + esc(v.id) + '" value="' + esc(v.name) + '" maxlength="' + LIST_VIEW_NAME_MAX + '" aria-label="重命名视图 ' + esc(v.name) + '">' +
            '<button type="button" class="btn ghost sm" data-view-rename="' + esc(v.id) + '">保存名称</button>' +
            '<button type="button" class="btn ghost sm" data-view-delete="' + esc(v.id) + '">删除</button>' +
          "</div>").join("");
      }
    }
    if (saveBtn) saveBtn.disabled = corrupt || !!statsDrill;
    if (input) input.disabled = corrupt || !!statsDrill;
    if (resetBtn) resetBtn.hidden = !listViewStore.corrupt;
    if (listViewStore.corrupt) {
      setListViewStatus("筛选视图存储已损坏，已保留原文并拒绝覆写：" + listViewStore.error
        + "。可点下方「重置损坏的视图存储」恢复为空列表。", true);
    } else if (!listViewStore.ready) {
      setListViewStatus(listViewStore.error || "筛选视图暂不可用", true);
    } else if (statsDrill) {
      setListViewStatus("统计下钻是临时筛选；返回统计或退出下钻后才能保存视图。", false);
    } else {
      setListViewStatus("《" + currentBook().name + "》已保存 " + currentBookListViews().length + " / " + LIST_VIEWS_PER_BOOK + " 个视图", false);
    }
    listViewDirty = false;
  }
  function saveCurrentListView(){
    loadListViewStore();
    const input = $("#listViewName");
    const name = input ? String(input.value || "").trim() : "";
    if (listViewStore.corrupt || !listViewStore.ready) {
      setListViewStatus(listViewStore.error || "筛选视图存储不可用，未保存", true);
      return false;
    }
    if (statsDrill) {
      setListViewStatus("统计下钻是临时筛选，先返回统计或退出下钻再保存视图", true);
      return false;
    }
    if (!name) { setListViewStatus("请输入 1–30 字的视图名称", true); input?.focus?.(); return false; }
    if (name.length > LIST_VIEW_NAME_MAX) { setListViewStatus("视图名称最多 " + LIST_VIEW_NAME_MAX + " 字", true); input?.focus?.(); return false; }
    const views = currentBookListViews();
    if (views.length >= LIST_VIEWS_PER_BOOK) {
      setListViewStatus("《" + currentBook().name + "》最多保存 " + LIST_VIEWS_PER_BOOK + " 个视图，请先删除一个", true);
      return false;
    }
    if (views.some(v => v.name === name)) {
      setListViewStatus("已有同名视图，请换一个名称或先重命名", true);
      return false;
    }
    const fst = $("#fst") ? ($("#fst").value || "all") : "all";
    const view = {
      id: newListViewId(), book: currentBookId, name: name,
      q: $("#q") ? String($("#q").value || "") : "",
      fst: fst, fsc: fst === "proficient" ? "all" : ($("#fsc") ? ($("#fsc").value || "scope") : "scope"),
      at: Date.now()
    };
    const res = persistListViewStore(listViewStore.views.concat([view]));
    if (!res.ok) { setListViewStatus(res.error, true); return false; }
    if (input) input.value = "";
    renderListViewRows();
    setListViewStatus("已保存视图「" + name + "」（仅《" + currentBook().name + "》）；应用只改列表筛选，不动学习设置与队列。");
    toast("已保存筛选视图：" + name);
    return true;
  }
  function findSavedListView(id){
    return listViewStore.views.find(v => v.id === id && v.book === currentBookId) || null;
  }
  function applySavedListView(id){
    loadListViewStore();
    const view = findSavedListView(id);
    if (!view) { setListViewStatus("视图不存在或不属于当前词书", true); return false; }
    listSelection.clear();
    listBatchPreview = null;
    if (statsDrill) exitStatsDrill({restore: true, render: false});
    if ($("#q")) $("#q").value = view.q;
    if ($("#fst")) $("#fst").value = view.fst;
    if ($("#fsc")) $("#fsc").value = view.fst === "proficient" ? "all" : view.fsc;
    applyFilter();
    const menu = $("#listViewsMenu");
    if (menu) menu.open = false;
    const first = $("#listInner")?.querySelector?.("[data-open-word]");
    (first || $("#listScroll"))?.focus?.({preventScroll: true});
    toast("已应用视图：" + view.name);
    return true;
  }
  function renameSavedListView(id){
    loadListViewStore();
    const view = findSavedListView(id);
    const input = $("#listViewsList")?.querySelector?.('[data-view-rename-input="' + id + '"]');
    if (!view) { setListViewStatus("视图不存在或不属于当前词书", true); return false; }
    if (listViewStore.corrupt || !listViewStore.ready) { setListViewStatus(listViewStore.error || "筛选视图存储不可用", true); return false; }
    const name = input ? String(input.value || "").trim() : "";
    if (!name || name.length > LIST_VIEW_NAME_MAX) {
      setListViewStatus("视图名称需为 1–" + LIST_VIEW_NAME_MAX + " 字", true);
      input?.focus?.();
      return false;
    }
    if (name === view.name) { setListViewStatus("名称未变化"); return true; }
    if (currentBookListViews().some(v => v.id !== id && v.name === name)) {
      setListViewStatus("已有同名视图，请换一个名称", true);
      return false;
    }
    const next = listViewStore.views.map(v => v.id === id ? Object.assign({}, v, {name: name}) : v);
    const res = persistListViewStore(next);
    if (!res.ok) { setListViewStatus(res.error, true); return false; }
    renderListViewRows();
    setListViewStatus("已重命名为「" + name + "」");
    toast("视图已重命名：" + name);
    return true;
  }
  function deleteSavedListView(id){
    loadListViewStore();
    const view = findSavedListView(id);
    if (!view) { setListViewStatus("视图不存在或不属于当前词书", true); return false; }
    if (listViewStore.corrupt || !listViewStore.ready) { setListViewStatus(listViewStore.error || "筛选视图存储不可用", true); return false; }
    if (!confirm("删除保存的筛选视图「" + view.name + "」？只删除这个视图，不改学习记录、词库或当前列表筛选。")) return false;
    const res = persistListViewStore(listViewStore.views.filter(v => v.id !== id));
    if (!res.ok) { setListViewStatus(res.error, true); return false; }
    renderListViewRows();
    setListViewStatus("已删除视图「" + view.name + "」");
    toast("已删除视图：" + view.name);
    return true;
  }
  function resetListViewStore(){
    if (!listViewStore.corrupt) return false;
    if (!confirm("筛选视图存储已损坏，原样保留以便排查。重置会丢弃这份损坏数据并恢复为空视图列表；不影响学习记录、词库或备份。继续？")) return false;
    try { localStorage.removeItem(LIST_VIEWS_KEY); }
    catch (e) { setListViewStatus("无法重置：浏览器存储不可用", true); return false; }
    listViewStore.loaded = false;
    loadListViewStore(true);
    listViewDirty = true;
    renderListViewRows();
    if (listViewStore.ready) { setListViewStatus("已重置损坏的筛选视图存储（当前为空视图列表）"); toast("已重置损坏的筛选视图存储"); }
    return true;
  }

  /* ---- E2 整理模式：已选行 vs 当前筛选全部结果 ---- */
  let listOrganize = false;
  const listSelection = new Set();
  let listBatchPreview = null;   // {op, value, ids, sig, effective, text}
  let listSelectionBookId = null;
  function ensureListSelectionBook(){
    if (listSelectionBookId !== currentBookId) {
      listSelection.clear();
      listBatchPreview = null;
      listSelectionBookId = currentBookId;
    }
  }
  function validListSelectionIndices(){
    ensureListSelectionBook();
    const ids = [];
    for (const i of listSelection) if (Number.isInteger(i) && i >= 0 && i < W.length) ids.push(i);
    ids.sort((a, b) => a - b);
    return ids;
  }
  function pruneListSelection(){
    ensureListSelectionBook();
    if (!listSelection.size) return;
    const allowed = new Set(filt);
    let changed = false;
    for (const i of Array.from(listSelection)) if (!allowed.has(i)) { listSelection.delete(i); changed = true; }
    if (changed) listBatchPreview = null;
  }
  function listSelectionSummaryText(){
    const total = filt.length, n = listSelection.size;
    if (!n) return "尚未选择词。可点「选择当前筛选全部 " + total + " 词」，或点行内复选框逐个选择。";
    const all = total > 0 && n === total;
    return (all ? "已选择当前筛选全部 " + n + " 词" : "已选 " + n + " / 当前筛选 " + total + " 词")
      + (all ? "（包含虚拟列表未渲染的行）" : "；全选可覆盖整个筛选结果，不只是已渲染行");
  }
  function renderListBatchPreview(){
    const box = $("#listBatchPreview"), text = $("#listBatchPreviewText"), confirmBtn = $("#btnBatchConfirm");
    if (!box) return;
    const showBox = !!(listOrganize && listBatchPreview);
    box.hidden = !showBox;
    if (!showBox) return;
    if (text) text.textContent = listBatchPreview.text;
    if (confirmBtn) confirmBtn.disabled = !listBatchPreview.effective;
  }
  function renderListOrganizeBar(){
    ensureListSelectionBook();
    const bar = $("#listOrganizeBar"), btn = $("#btnToggleOrganize"), summary = $("#listSelectionSummary");
    if (btn) {
      btn.textContent = listOrganize ? "退出整理" : "整理";
      btn.setAttribute?.("aria-pressed", String(listOrganize));
    }
    if (bar) bar.hidden = !listOrganize;
    if (!listOrganize) { renderListBatchPreview(); return; }
    const n = listSelection.size;
    const selectAll = $("#btnSelectAllFiltered"), clear = $("#btnClearSelection"),
      star = $("#btnBatchStar"), unstar = $("#btnBatchUnstar"),
      prof = $("#btnBatchProficient"), unprof = $("#btnBatchUnproficient");
    if (selectAll) {
      selectAll.disabled = filt.length === 0;
      selectAll.textContent = "选择当前筛选全部 " + filt.length + " 词";
    }
    [clear, star, unstar, prof, unprof].forEach(el => { if (el) el.disabled = n === 0; });
    if (summary) summary.textContent = listSelectionSummaryText();
    renderListBatchPreview();
  }
  function renderListToolSurfaces(){
    renderListDrillChip();
    renderListOrganizeBar();
    renderListExportHint();
    if (listViewDirty || listViewBookId !== currentBookId) renderListViewRows();
  }
  function renderListExportHint(){
    const hint = $("#listExportHint");
    if (!hint) return;
    let text = "";
    if (statsDrill) {
      text = "当前为统计下钻的临时筛选：「导出筛选结果」「拆分导出」和打印生词本只包含下钻词集；完整学习范围请在设置页导出。";
    } else if (listOrganize && listSelection.size) {
      text = "已选 " + listSelection.size + " 词仅用于批量整理；导出与打印仍按当前筛选与来源，不受选择影响。";
    }
    hint.hidden = !text;
    hint.textContent = text;
  }
  function renderListDrillChip(){
    const chip = $("#listDrillChip"), src = $("#listDrillSource"), count = $("#listDrillCount");
    if (!chip) return;
    const on = !!statsDrill;
    chip.hidden = !on;
    if (!on) return;
    if (src) src.textContent = "统计下钻 · " + statsDrill.label;
    if (count) count.textContent = "共 " + filt.length + " 词 · 只影响列表";
  }
  function enterListOrganize(){
    ensureListSelectionBook();
    listOrganize = true;
    if (listActiveAction === "proficient" || listActiveAction === "row-check") listActiveAction = "open-word";
    renderRows();
    renderListToolSurfaces();
    const ann = $("#listAnnouncement");
    if (ann) ann.textContent = "已进入整理模式，当前筛选共 " + filt.length + " 词";
    toast("整理模式：可全选当前筛选结果批量操作");
  }
  function exitListOrganize(){
    listOrganize = false;
    listSelection.clear();
    listBatchPreview = null;
    if (listActiveAction === "row-check") listActiveAction = "open-word";
    renderRows();
    renderListToolSurfaces();
  }
  function toggleListSelection(i){
    ensureListSelectionBook();
    if (!Number.isInteger(i)) return false;
    const value = !listSelection.has(i);
    if (value) listSelection.add(i); else listSelection.delete(i);
    listBatchPreview = null;
    const box = $("#listInner")?.querySelector?.('[data-row-check="' + i + '"]');
    if (box) {
      box.setAttribute?.("aria-checked", value ? "true" : "false");
      box.setAttribute?.("aria-label", (value ? "已选择 " : "选择 ") + (W[i] ? W[i].w : ""));
      const row = box.closest?.(".row");
      if (row) row.classList.toggle("row-selected", value);
    }
    renderListOrganizeBar();
    renderListExportHint();
    const ann = $("#listAnnouncement");
    if (ann) ann.textContent = "已选 " + listSelection.size + " 词，当前筛选共 " + filt.length + " 词";
    return value;
  }
  function selectAllFilteredList(){
    ensureListSelectionBook();
    listSelection.clear();
    for (const i of filt) listSelection.add(i);
    listBatchPreview = null;
    renderRows();
    renderListToolSurfaces();
    const ann = $("#listAnnouncement");
    if (ann) ann.textContent = "已选择当前筛选全部 " + filt.length + " 词（包含虚拟列表未渲染的行）";
    toast("已选择当前筛选全部 " + filt.length + " 词");
  }
  function clearListSelection(){
    ensureListSelectionBook();
    listSelection.clear();
    listBatchPreview = null;
    renderRows();
    renderListToolSurfaces();
    const ann = $("#listAnnouncement");
    if (ann) ann.textContent = "已清空选择";
  }
  function batchSetStar(value){
    const ids = validListSelectionIndices();
    if (!ids.length) { toast("请先选择词"); return {ok: false, changed: 0}; }
    const before = Object.assign({}, S.stars || {});
    let changed = 0;
    S.stars = S.stars || {};
    for (const i of ids) {
      const has = !!S.stars[i];
      if (has === !!value) continue;
      if (value) S.stars[i] = 1; else delete S.stars[i];
      changed++;
    }
    if (!changed) {
      toast(value ? "所选词都已在收藏中" : "所选词都未收藏");
      return {ok: true, changed: 0};
    }
    const saved = save();
    if (!saved) {
      S.stars = before;
      renderRows();
      renderListToolSurfaces();
      toast("批量收藏未保存，已恢复原状态；请先导出进度备份");
      return {ok: false, changed: 0};
    }
    const lost = ids.filter(i => !!S.stars[i] !== !!value).length;
    renderRows();
    renderListToolSurfaces();
    toast((value ? "已收藏 " : "已取消收藏 ") + changed + " 词（含未渲染行）"
      + (lost ? "；另有 " + lost + " 词因另一窗口替换记录未生效" : ""));
    return {ok: true, changed: changed};
  }
  function buildBatchProficiencyPreview(value){
    const ids = validListSelectionIndices();
    if (!ids.length) { toast("请先选择词"); return null; }
    let effective = 0;
    for (const i of ids) if (isProficient(i) !== !!value) effective++;
    const unchanged = ids.length - effective;
    const curIncluded = value && cur != null && ids.includes(cur);
    const text = value
      ? "将把所选 " + ids.length + " 个词中的 " + effective + " 个标为熟练，并移出背诵/复习/乱序队列"
        + (unchanged ? "；另有 " + unchanged + " 个词已是熟练，保持不变" : "")
        + "。" + (curIncluded ? "当前正在学习的词在所选范围内，确认后会跳到下一张。" : "")
        + "只改熟练标记，不改学习进度、到期时间、复习预算或学习时长。"
      : "将取消所选 " + ids.length + " 个词中的 " + effective + " 个熟练标记，按原学习进度恢复背诵/复习安排（不重置进度、不复活撤销栈）"
        + (unchanged ? "；另有 " + unchanged + " 个词本来就不是熟练，保持不变" : "") + "。";
    return {op: value ? "proficient" : "unproficient", value: !!value, ids: ids, sig: ids.join(","), effective: effective, text: text};
  }
  function openBatchProficiencyPreview(value){
    const preview = buildBatchProficiencyPreview(value);
    if (!preview) return null;
    listBatchPreview = preview;
    renderListOrganizeBar();
    return preview;
  }
  /** 批量熟练：与 setProficient 同语义，但整批一次保存；失败整次回滚内存并尽力恢复独立熟练键。 */
  function batchSetProficient(value){
    const ids = validListSelectionIndices();
    if (!ids.length) { toast("请先选择词"); return {ok: false, changed: 0}; }
    if (storageOK) { try { syncProficientFromStorage(); } catch (e) { /* 保留当前内存名单 */ } }
    const todo = ids.filter(i => W[i] && isProficient(i) !== !!value);
    if (!todo.length) {
      toast(value ? "所选词都已是熟练" : "所选词都不是熟练");
      return {ok: true, changed: 0};
    }
    clearSessionSnapshot(currentBookId);
    const rollback = {
      proficient: JSON.parse(JSON.stringify(S.proficient || {})),
      profRaw: (function(){ try { return localStorage.getItem(PROF_KEY); } catch (e) { return undefined; } })(),
      pending: snapshotPendingProf(),
      Q: Q.slice(), qi: qi, undoStack: undoStack.slice(),
      mainSnapUndo: mainSnap ? mainSnap.undoStack : null,
      profMark: profMark
    };
    let curMarked = false;
    for (const i of todo) {
      const word = W[i].w;
      if (value) {
        profMark = {bookId: currentBookId, i: i, w: word};
        S.proficient[word] = Date.now();
        markProfPending(currentBookId, word, true, S.proficient[word]);
        if (cur === i) {
          curMarked = true;
          if (phase === "revealed") qi++;
        }
        Q = Q.slice(0, qi).concat(Q.slice(qi).filter(k => k !== i));
        undoStack = [];
        if (mainSnap) mainSnap.undoStack = [];
      } else {
        if (profMark && profMark.i === i && profMark.bookId === currentBookId) profMark = null;
        delete S.proficient[word];
        markProfPending(currentBookId, word, false);
        undoStack = [];
        if (mainSnap) mainSnap.undoStack = [];
      }
    }
    const saved = save(true);
    if (!saved) {
      // 整次回滚内存：不留下半写状态；独立熟练键尽力恢复为写入前原文。
      S.proficient = rollback.proficient;
      Q = rollback.Q; qi = rollback.qi; undoStack = rollback.undoStack;
      if (mainSnap) mainSnap.undoStack = rollback.mainSnapUndo || [];
      profMark = rollback.profMark;
      restorePendingProf(rollback.pending);
      try {
        if (rollback.profRaw === null) localStorage.removeItem(PROF_KEY);
        else if (rollback.profRaw !== undefined) localStorage.setItem(PROF_KEY, rollback.profRaw);
      } catch (e) { /* 保持当前可读状态 */ }
      if (curMarked) renderCard();
      renderRows(); renderStats(); renderListToolSurfaces(); renderProfFeedback(); updateScopeCount();
      toast("批量熟练未保存，已恢复原状态；请先导出进度备份");
      return {ok: false, changed: 0};
    }
    const lost = todo.filter(i => isProficient(i) !== !!value).length;
    if (curMarked) nextCard();
    renderCard(); updateScopeCount(); syncFreqControls(); applyFilter(false); renderStats(); updateBar();
    renderProfFeedback(); renderListToolSurfaces();
    toast((value ? "已标为熟练 " : "已取消熟练 ") + todo.length + " 词（含未渲染行）"
      + (value ? "，已移出背诵与复习" : "，将按原进度恢复")
      + (lost ? "；另有 " + lost + " 词因另一窗口替换记录未生效" : ""));
    return {ok: true, changed: todo.length};
  }
  function confirmListBatchProficiency(){
    if (!listBatchPreview) return false;
    const sig = listBatchPreview.sig, value = listBatchPreview.value;
    const ids = validListSelectionIndices();
    if (ids.join(",") !== sig) {
      listBatchPreview = null;
      renderListOrganizeBar();
      toast("选择已变化，请重新预览后再确认");
      return false;
    }
    listBatchPreview = null;
    renderListBatchPreview();
    batchSetProficient(value);
    renderListOrganizeBar();
    return true;
  }

  /* ================= G 统计下钻：临时列表筛选层 =================
   * 下钻只改词表临时筛选：不改 settings.fmin/fmax/pmin/kyOnly/pos、不重建当前组、
   * 不写 q/fst/fsc 的逐书持久值；退出后恢复进入前列表筛选。
   */
  let statsDrill = null;        // {kind:"due"|"freq"|"stage", bookId, label, dayIndex/tier/stage}
  let statsDrillReturn = null;  // 进入前列表筛选/滚动与统计现场
  let statsSelForecast = -1, statsSelStage = -1;
  function dropStaleStatsDrill(){
    if (statsDrill && statsDrill.bookId !== currentBookId) {
      statsDrill = null;
      statsDrillReturn = null;
      listViewDirty = true;
    }
  }
  /** 与统计面板共用同一口径的下钻词集（当前范围、非熟练、pos/套卷/大纲、按本地日桶）。 */
  function statsDrillIndices(){
    const out = [];
    if (!statsDrill) return out;
    const start = startOfLocalDay(Date.now());
    const tier = statsDrill.kind === "freq" ? FREQ_TIERS.find(t => t.key === statsDrill.tier) : null;
    for (let i = 0; i < W.length; i++) {
      if (!inScope(i) || isProficient(i)) continue;
      const p = st(i);
      if (statsDrill.kind === "due") {
        if (!hasMainProgress(p) || p[0] >= MASTER) continue;
        const bucket = Math.round((startOfLocalDay(p[1]) - start) / 86400000);
        if (statsDrill.dayIndex === 0 ? bucket <= 0 : bucket === statsDrill.dayIndex) out.push(i);
      } else if (statsDrill.kind === "freq") {
        if (!tier) continue;
        if (W[i].f >= tier.min && W[i].f <= tier.max) out.push(i);
      } else if (statsDrill.kind === "stage") {
        if (!hasMainProgress(p)) continue;
        if (Math.min(p[0], MASTER) !== statsDrill.stage) continue;
        out.push(i);
      }
    }
    return out;
  }
  /** 阶段分布（统计页与下钻共用唯一口径）：只统计当前范围非熟练词。 */
  function stageDistribution(){
    const dist = new Array(MASTER + 1).fill(0);
    let learning = 0, mastered = 0, unseen = 0, wrong = 0;
    for (let i = 0; i < W.length; i++) {
      if (!inScope(i) || isProficient(i)) continue;
      const p = st(i);
      if (p && p[3] > 0) wrong++;
      if (!hasMainProgress(p)) { unseen++; continue; }
      dist[Math.min(p[0], MASTER)]++;
      if (p[0] < MASTER) learning++; else mastered++;
    }
    return {dist: dist, learning: learning, mastered: mastered, unseen: unseen, wrong: wrong};
  }
  function drillDueDayLabel(idx, fc){
    return fc.dates[idx] + (idx === 0 ? "（今天）" : idx === 1 ? "（明天）" : "") + " 到期词";
  }
  function updateForecastDrillUi(){
    const btn = $("#btnDrillDueDay"), note = $("#forecastDrillNote");
    if (!btn) return;
    const fc = dueForecast(14);
    const idx = statsSelForecast;
    const ok = idx >= 0 && idx < fc.counts.length;
    const count = ok ? fc.counts[idx] : 0;
    const label = ok ? drillDueDayLabel(idx, fc) : "";
    btn.textContent = ok ? "查看" + drillDueDayLabel(idx, fc) + " (" + count + ")" : "查看该日到期词";
    btn.disabled = !ok || count === 0;
    btn.title = !ok ? "先在上方选择日期" : count ? "进入词表临时筛选「" + label + "」，不改学习范围" : label + "没有可查看的到期词";
    if (note) {
      note.textContent = !ok ? "选择某个日期柱后，可查看该本地日桶内的到期词。"
        : count ? label + "：" + count + " 词（当前背诵范围、未熟练、未掌握）。"
        : label + "没有到期词可查看（不是历史学习记录，无法还原当天具体单词）。";
    }
  }
  function updateStageDrillUi(){
    const btn = $("#btnDrillStage"), note = $("#stagesDrillNote");
    if (!btn) return;
    const dist = stageDistribution().dist;
    const idx = statsSelStage;
    const ok = idx >= 0 && idx < dist.length;
    const count = ok ? dist[idx] : 0;
    const name = !ok ? "" : (idx === MASTER ? "已掌握" : idx === 0 ? "重学（第零档）" : "第" + idx + "档");
    btn.textContent = ok ? "查看" + name + "词 (" + count + ")" : "查看该档词";
    btn.disabled = !ok || count === 0;
    btn.title = !ok ? "先在上方选择档位" : count ? "进入词表临时筛选「" + name + "」，不改学习范围" : name + "没有可查看的词";
    if (note) {
      note.textContent = !ok ? "选择某个档位后，可查看该档内的已学词（与上方统计口径一致）。"
        : count ? name + "：" + count + " 词（当前背诵范围、未熟练、有主学习进度）。"
        : name + "没有可查看的词。";
    }
  }
  function statsPointSelected(root, point){
    if (!root || !point) return;
    if (root.id === "forecast") {
      statsSelForecast = Array.from(root.querySelectorAll?.("[data-fc-label]") || []).indexOf(point);
      updateForecastDrillUi();
    } else if (root.id === "stages") {
      statsSelStage = Array.from(root.querySelectorAll?.("[data-stage-label]") || []).indexOf(point);
      updateStageDrillUi();
    }
  }
  function enterStatsDrill(desc){
    if (!desc || ["due", "freq", "stage"].indexOf(desc.kind) < 0) return false;
    if (statsDrill && statsDrill.bookId === currentBookId) return false;
    const ui = listUiFor(currentBookId);
    const trigger = desc.trigger || {};
    statsDrillReturn = {
      bookId: currentBookId,
      q: ui.q, fst: ui.fst, fsc: ui.fsc,
      scrollTop: ui.scrollTop || 0,
      activeWord: ui.activeWord, activeAction: ui.activeAction || "open-word",
      mainScrollTop: $("#main") ? ($("#main").scrollTop || 0) : 0,
      panelId: trigger.panelId || "", rootId: trigger.rootId || "",
      selector: trigger.selector || "", hintId: trigger.hintId || "",
      index: Number.isInteger(trigger.index) ? trigger.index : -1
    };
    statsDrill = {kind: desc.kind, bookId: currentBookId, label: desc.label};
    if (desc.kind === "due") statsDrill.dayIndex = desc.dayIndex;
    if (desc.kind === "freq") statsDrill.tier = desc.tier;
    if (desc.kind === "stage") statsDrill.stage = desc.stage;
    listSelection.clear();
    listBatchPreview = null;
    listViewDirty = true;
    show("list");
    // 下钻层用独立词集，控件设为中性避免与临时筛选混淆；保存的逐书筛选在 statsDrillReturn 里。
    if ($("#q")) $("#q").value = "";
    if ($("#fst")) $("#fst").value = "all";
    if ($("#fsc")) $("#fsc").value = "scope";
    applyFilter();
    const first = $("#listInner")?.querySelector?.("[data-open-word]");
    (first || $("#listScroll"))?.focus?.({preventScroll: true});
    renderListViewRows();
    return true;
  }
  function exitStatsDrill(opts){
    opts = opts || {};
    const ret = statsDrillReturn;
    const had = !!statsDrill;
    statsDrill = null;
    statsDrillReturn = null;
    if (opts.restore && ret && ret.bookId === currentBookId) {
      const ui = listUiFor(currentBookId);
      ui.q = ret.q; ui.fst = ret.fst; ui.fsc = ret.fsc;
      ui.scrollTop = ret.scrollTop; ui.activeWord = ret.activeWord; ui.activeAction = ret.activeAction;
      if ($("#q")) $("#q").value = ret.q;
      if ($("#fst")) $("#fst").value = ret.fst;
      if ($("#fsc")) $("#fsc").value = ret.fsc;
      listActiveWord = ret.activeWord;
      listActiveAction = ret.activeAction || "open-word";
      if ($("#listScroll")) $("#listScroll").scrollTop = ret.scrollTop || 0;
    }
    listSelection.clear();
    listBatchPreview = null;
    listViewDirty = true;
    if (opts.render !== false) applyFilter(false);
    renderListToolSurfaces();
    return had;
  }
  function returnFromStatsDrill(){
    const ret = statsDrillReturn;
    if (!statsDrill || !ret || ret.bookId !== currentBookId) {
      statsDrill = null;
      statsDrillReturn = null;
      show("stats");
      return false;
    }
    exitStatsDrill({restore: true, render: false});
    show("stats");
    if ($("#main")) $("#main").scrollTop = ret.mainScrollTop || 0;
    const panel = ret.panelId ? $("#" + ret.panelId) : null;
    if (panel) panel.open = true;
    const root = ret.rootId ? $("#" + ret.rootId) : null;
    if (root && ret.selector) {
      const nodes = Array.from(root.querySelectorAll?.(ret.selector) || []);
      const point = nodes[ret.index] || nodes[0] || null;
      if (point) {
        selectStatsPoint(root, ret.selector, ret.hintId ? $("#" + ret.hintId) : null, point);
        point.focus?.({preventScroll: true});
      } else if (panel?.querySelector) {
        panel.querySelector("summary")?.focus?.({preventScroll: true});
      }
    }
    if ($("#main")) $("#main").scrollTop = ret.mainScrollTop || 0;
    return true;
  }
  function drillDueDay(){
    const fc = dueForecast(14), idx = statsSelForecast;
    if (idx < 0 || idx >= fc.counts.length || !fc.counts[idx]) return false;
    return enterStatsDrill({
      kind: "due", dayIndex: idx, label: "本地日 " + drillDueDayLabel(idx, fc),
      trigger: {panelId: "statsForecastPanel", rootId: "forecast", selector: "[data-fc-label]", index: idx, hintId: "forecastHint"}
    });
  }
  function drillFreqTier(key){
    const row = frequencyMastery().rows.find(r => r.key === key);
    if (!row || !row.total) return false;
    return enterStatsDrill({
      kind: "freq", tier: key, label: "词频层 · " + row.label + "（" + row.range + "）",
      trigger: {panelId: "statsFreqPanel"}
    });
  }
  function drillStage(){
    const dist = stageDistribution().dist, idx = statsSelStage;
    if (idx < 0 || idx >= dist.length || !dist[idx]) return false;
    const name = idx === MASTER ? "已掌握" : idx === 0 ? "重学（第零档）" : "第" + idx + "档";
    return enterStatsDrill({
      kind: "stage", stage: idx, label: "阶段 · " + name,
      trigger: {panelId: "statsStagesPanel", rootId: "stages", selector: "[data-stage-label]", index: idx, hintId: "stagesHint"}
    });
  }
  /** 用户在列表里显式改筛选/搜索：先退出下钻并恢复进入前筛选，再套用本次改动。 */
  function onListFilterControlChanged(id){
    const user = {
      q: $("#q") ? $("#q").value : "",
      fst: $("#fst") ? ($("#fst").value || "all") : "all",
      fsc: $("#fsc") ? ($("#fsc").value || "scope") : "scope"
    };
    listSelection.clear();
    listBatchPreview = null;
    if (statsDrill) exitStatsDrill({restore: true, render: false});
    if (id === "q" && $("#q")) $("#q").value = user.q;
    else if (id === "fst" && $("#fst")) $("#fst").value = user.fst;
    else if (id === "fsc" && $("#fsc")) $("#fsc").value = user.fsc;
    if ($("#fst") && $("#fst").value === "proficient" && $("#fsc")) $("#fsc").value = "all";
    applyFilter();
  }

  /* ================= 统计 ================= */
  function syncStatsChartHints(){
    $$("#v-stats .chart-scroll").forEach(scroll => {
      const hint = scroll.parentElement?.querySelector?.(".chart-mobile-hint");
      if (hint) hint.hidden = !scroll.clientWidth || scroll.scrollWidth <= scroll.clientWidth + 1;
    });
  }
  function selectStatsPoint(root, selector, hint, point){
    if (!root || !point) return;
    const nodes = Array.from(root.querySelectorAll?.(selector) || []);
    for (const node of nodes) {
      const selected = node === point;
      node.setAttribute?.("aria-pressed", String(selected));
      node.tabIndex = selected ? 0 : -1;
    }
    const label = point.dataset.dayLabel || point.dataset.fcLabel || point.dataset.stageLabel
      || point.getAttribute?.("aria-label") || "";
    if (hint) hint.textContent = label;
    // G：选中日期柱/阶段档后同步该面板的「查看该日/该档词」入口与空集说明。
    statsPointSelected(root, point);
  }
  function bindStatsChart(id, selector, hintId, grid){
    const root = $(id);
    if (!root) return;
    const select = e => {
      const point = e.target.closest?.(selector);
      if (point && !point.disabled) selectStatsPoint(root, selector, $(hintId), point);
    };
    root.addEventListener("click", select);
    root.addEventListener("focusin", select);
    root.addEventListener("keydown", e => {
      const point = e.target.closest?.(selector);
      if (!point) return;
      const nodes = Array.from(root.querySelectorAll?.(selector) || []).filter(x => !x.disabled);
      const current = nodes.indexOf(point);
      let next = current;
      if (e.key === "Home") next = 0;
      else if (e.key === "End") next = nodes.length - 1;
      else if (e.key === "ArrowLeft") next -= grid ? 7 : 1;
      else if (e.key === "ArrowRight") next += grid ? 7 : 1;
      else if (grid && e.key === "ArrowUp") next--;
      else if (grid && e.key === "ArrowDown") next++;
      else return;
      e.preventDefault();
      const target = nodes[Math.max(0, Math.min(nodes.length - 1, next))];
      if (target) {
        selectStatsPoint(root, selector, $(hintId), target);
        target.focus?.({preventScroll: true});
        target.scrollIntoView?.({block: "nearest", inline: "nearest"});
      }
    });
  }
  function renderHeatmap(){
    const root = $("#heatmap");
    if (!root) return;
    const cells = heatmapData(S.days, todayStr(), 12);
    const weeks = 12;
    let months = "";
    let lastM = -1;
    let lastLabelW = -99;
    for (let w = 0; w < weeks; w++) {
      const m = +cells[w * 7].date.slice(5, 7);
      // 相邻月标签至少隔 2 列，避免「7月8月」粘连
      if (m !== lastM && w - lastLabelW >= 2) {
        months += '<span class="hm-m">' + m + "月</span>";
        lastM = m;
        lastLabelW = w;
      } else {
        if (m !== lastM) lastM = m;
        months += '<span class="hm-m"></span>';
      }
    }
    let body = "";
    for (const c of cells) {
      const label = c.date + "：学习 " + c.vol + " 次（新词 " + c.n + "，复习 " + Math.max(0, c.r - c.n) + "）";
      body += '<button type="button" class="hm-cell' + (c.future ? " future" : "") + '" data-level="' + c.level + '"' +
        (c.future ? " disabled" : ' tabindex="' + (c.date === todayStr() ? "0" : "-1") + '" aria-pressed="false"') +
        ' aria-label="' + esc(label) + '" title="' + esc(label) + '"></button>';
    }
    root.innerHTML =
      '<div class="hm-months" aria-hidden="true"><span class="hm-m gap"></span>' + months + "</div>" +
      '<div class="hm-body">' +
        '<div class="hm-days" aria-hidden="true">' +
          "<span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>" +
        "</div>" +
        '<div class="hm-grid" role="group" aria-label="近 12 周每日学习量，方向键切换日期">' + body + "</div>" +
      "</div>";
    const totalVol = cells.reduce((a, c) => a + (c.vol || 0), 0);
    markStatsDetailEmpty("#heatmap", totalVol === 0);
    const tipDefault = totalVol
      ? "选择格子查看当日学习量；方向键可切换日期"
      : "最近 12 周还没有学习记录；学完第一个词后这里会出现热力图。";
    const tip = $("#heatmapTip");
    if (tip) tip.textContent = tipDefault;
    root.onmouseover = (e) => hmPeek(e);
    root.onmouseleave = () => {
      const chosen = root.querySelector?.('.hm-cell[aria-pressed="true"]');
      const t = $("#heatmapTip");
      if (t) t.textContent = chosen?.getAttribute?.("aria-label") || tipDefault;
    };
  }
  function hmPeek(e){
    const tip = $("#heatmapTip");
    if (!tip || !e || !e.target) return;
    const t = e.target;
    const label = (t.getAttribute && (t.getAttribute("title") || t.getAttribute("aria-label"))) || "";
    if (t.classList && t.classList.contains("hm-cell") && !t.classList.contains("future")) {
      tip.textContent = label;
      if (e.type !== "mouseover") selectStatsPoint($("#heatmap"), ".hm-cell", tip, t);
    }
  }

  function renderDrillEntry(){
    const n = wrongWordIndices().length;
    const btn = $("#btnDrill");
    // 09：没有错词（且不在特训中）时折叠特训入口；上下文条本身常驻，左侧范围摘要始终可点。
    const showDrill = drillMode || n > 0;
    if (btn) {
      btn.hidden = !showDrill;
      btn.textContent = drillMode ? "退出特训" : "错词特训";
      btn.setAttribute?.("aria-label", drillMode ? "退出错词特训，回到普通背诵" : "进入错词特训");
      btn.onclick = () => { if (drillMode) exitDrill(); else startDrill(); };
      if ("disabled" in btn) btn.disabled = !drillMode && n === 0;
    }
    const hint = $("#drillHint");
    if (hint) {
      hint.hidden = !showDrill;
      hint.textContent = showDrill
        ? (drillMode
            ? "错词特训进行中 · 退出后回到原来的背诵进度"
            : "错词本 " + n + " 词，可专项突破")
        : "";
    }
    // 词表工具栏入口：startDrill() 固定训练当前词书整个错词本（wrongWordIndices），
    // 与搜索词/范围筛选无关，所以文案如实写「全部错词」，不写成当前筛选的 N 词。
    const listBtn = $("#btnDrillList");
    const listRow = $("#listDrillRow");
    const listHint = $("#drillListHint");
    const fs = $("#fst") ? $("#fst").value : "all";
    const showList = fs === "wrong";
    if (listRow) listRow.hidden = !showList;
    if (listBtn) {
      listBtn.hidden = !showList;
      if (showList) {
        listBtn.disabled = n === 0;
        listBtn.textContent = n ? "特训全部错词（" + n + "）" : "暂无错词可特训";
        listBtn.setAttribute?.("aria-label", n
          ? "开始错词特训：训练当前词书全部 " + n + " 个错词，不受当前搜索和范围筛选影响"
          : "当前词书没有错词可特训");
        listBtn.onclick = n ? () => { if (startDrill()) show("study"); } : null;
      } else {
        listBtn.onclick = null;
      }
    }
    if (listHint) {
      listHint.textContent = showList
        ? (n ? "错词本 " + n + " 词 · 训练整个错词本，不受当前搜索/范围筛选影响"
             : "当前词书还没有错词；先在背诵中积累错词后再来特训")
        : "";
    }
    renderStudyScope();
    renderProfFeedback();
  }

  function renderMasteryMeter(tot, mastered, learning){
    const el = $("#masteryMeter");
    if (!el) return;
    const rate = pctOf(mastered, tot);
    const unseen = Math.max(0, tot - mastered - learning);
    el.innerHTML = tot
      ? '<div class="mm-head"><span>当前背诵范围掌握率</span><b>' + rate + '%</b></div>' +
        '<div class="mm-track" role="img" aria-label="已掌握 ' + mastered + ' 词，学习中 ' + learning + ' 词，未学 ' + unseen + ' 词">' +
          '<i class="mm-mastered" style="width:' + (mastered / tot * 100) + '%"></i>' +
          '<i class="mm-learning" style="width:' + (learning / tot * 100) + '%"></i>' +
        '</div>' +
        '<div class="mm-meta">已掌握 ' + mastered + ' · 学习中 ' + learning + ' · 未学 ' + unseen + '</div>'
      : '<p class="chart-hint">当前筛选范围没有可背诵的词，先调整设置页的词库筛选。</p>';
  }
  /** 09：统计页高阶面板为空样本时收起空图，只保留一句简洁说明（CSS 依据 data-empty）。 */
  function markStatsDetailEmpty(selector, empty){
    const el = $(selector);
    const panel = el && typeof el.closest === "function" ? el.closest("details.stats-details") : null;
    if (!panel || !panel.dataset) return;
    panel.dataset.empty = empty ? "1" : "";
  }
  function renderDueForecast(){
    const el = $("#forecast");
    if (!el) return;
    const fc = dueForecast(14);
    markStatsDetailEmpty("#forecast", !fc.total);
    const mx = Math.max(1, ...fc.counts);
    el.innerHTML = fc.counts.map((v, i) => {
      const h = v ? Math.max(4, Math.round(v / mx * 100)) : 0;
      const day = fc.dates[i];
      const detail = i === 0
        ? day + "：待复习 " + v + " 词" + (fc.overdue ? "（已到期 " + fc.overdue + "）" : "")
        : day + "：到期 " + v + " 词";
      return '<button type="button" class="fc-col' + (i === 0 ? " today" : "") + '" tabindex="' + (i === 0 ? "0" : "-1") + '" aria-pressed="false" aria-describedby="forecastHint" data-fc-label="' + esc(detail) +
        '" aria-label="' + esc(detail) + '" title="' + esc(detail) + '">' +
        '<span class="fc-count">' + (v || "") + "</span>" +
        '<span class="fc-plot"><span class="fc-bar' + (v ? "" : " zero") + '" style="height:' + h + '%"></span></span>' +
        "<em>" + fc.labels[i] + "</em></button>";
    }).join("");
    if (fc.total) {
      const parts = ["今日待复习 " + fc.counts[0] + " 词" + (fc.overdue ? "（已到期 " + fc.overdue + "）" : "")];
      parts.push("7 天内（含今天）" + fc.next7);
      parts.push("14 天内（含今天）" + fc.total);
      if (fc.later) parts.push("14 天后另有 " + fc.later + " 词");
      if (fc.peak >= 0) {
        const pl = fc.peak === 0 ? "今天" : fc.peak === 1 ? "明天" : fc.dates[fc.peak].slice(5).replace("-", "/");
        parts.push("峰值 " + pl + " · " + fc.peakCount + " 词");
      }
      $("#forecastSummary").textContent = parts.join(" · ");
      $("#forecastHint").textContent = "点击柱形查看日期与到期词数，再点「查看该日到期词」进入词表";
    } else {
      $("#forecastSummary").textContent = "未来 14 天没有到期复习";
      $("#forecastHint").textContent = "学完第一批词后，这里会出现未来两周的复习负荷曲线";
    }
    // G：下钻按钮跟随已选日期柱；未选日期或该日 0 词时禁用并说明（空样本面板整体隐藏）。
    if (statsSelForecast >= fc.counts.length) statsSelForecast = -1;
    const nodes = Array.from(el.querySelectorAll?.("[data-fc-label]") || []);
    if (statsSelForecast >= 0 && nodes[statsSelForecast]) {
      nodes.forEach((node, i) => {
        node.setAttribute?.("aria-pressed", String(i === statsSelForecast));
        node.tabIndex = i === statsSelForecast ? 0 : -1;
      });
    }
    updateForecastDrillUi();
  }
  function renderFreqMastery(){
    const el = $("#freqMastery");
    if (!el) return;
    const data = frequencyMastery();
    const summary = $("#freqMasterySummary");
    markStatsDetailEmpty("#freqMastery", !data.total);
    if (!data.total) {
      el.innerHTML = '<p class="chart-hint">当前筛选范围没有可统计的词。</p>';
      if (summary) summary.textContent = "";
      return;
    }
    el.innerHTML = data.rows.map(r => {
      const mp = r.mastered / r.total * 100;
      const lp = r.learning / r.total * 100;
      const up = r.unseen / r.total * 100;
      const label = r.label + "（" + r.range + "）：共 " + r.total + " 词，已掌握 " + r.mastered +
        "，学习中 " + r.learning + "，未学 " + r.unseen;
      return '<div class="fm-row">' +
        '<div class="fm-head"><b>' + r.label + "</b><span>" + r.range + "</span><em>" + r.total +
          " 词</em><strong>" + pctOf(r.mastered, r.total) + "%</strong></div>" +
        '<div class="fm-bar" role="img" aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
          '<i class="fm-mastered" style="width:' + mp + '%"></i>' +
          '<i class="fm-learning" style="width:' + lp + '%"></i>' +
          '<i class="fm-unseen" style="width:' + up + '%"></i>' +
        "</div>" +
        // G：词频层直达词表（临时筛选，与统计同口径）。
        '<button type="button" class="fm-drill" data-drill-freq="' + esc(r.key) + '"' +
          (r.total ? "" : " disabled") + ' aria-label="查看' + esc(r.label) + "层 " + r.total + ' 个词">查看该层词 (' + r.total + ")</button>" +
      "</div>";
    }).join("");
    const parts = ["全范围 " + pctOf(data.mastered, data.total) + "%"];
    const high = data.rows.find(r => r.key === "high");
    if (high) parts.push("高频段 " + pctOf(high.mastered, high.total) + "%");
    const lowRows = data.rows.filter(r => r.key === "low" || r.key === "rare");
    const lowTotal = lowRows.reduce((n, r) => n + r.total, 0);
    const lowMastered = lowRows.reduce((n, r) => n + r.mastered, 0);
    if (lowTotal) parts.push("低频段 " + pctOf(lowMastered, lowTotal) + "%");
    const weakest = data.rows.slice().sort((a, b) =>
      a.mastered / a.total - b.mastered / b.total)[0];
    if (weakest) parts.push("最低：" + weakest.label + " " + pctOf(weakest.mastered, weakest.total) + "%");
    if (summary) summary.textContent = parts.join(" · ");
  }
  function renderStats(){
    const tot = inScopeCount(), mas = scopedMasteredCount();
    // 阶段分布与下钻共用 stageDistribution()，保证「统计看到的 N」与词表下钻词集完全一致。
    const stageInfo = stageDistribution();
    const learning = stageInfo.learning, wrong = stageInfo.wrong, unseen = stageInfo.unseen;
    const dist = stageInfo.dist;
    renderMasteryMeter(tot, mas, learning);
    const k = Object.keys(S.days).filter(k => S.days[k].r > 0).sort();
    const okAll = k.reduce((a, d) => a + S.days[d].ok, 0);
    const noAll = k.reduce((a, d) => a + S.days[d].no, 0);
    const kpiHtml = entries => entries.map(([a, b]) => '<div class="kpi"><b>' + b + "</b><span>" + a + "</span></div>").join("");
    $("#kpis").innerHTML = '<div class="stats-primary-kpis">' + kpiHtml([
      ["已掌握", mas], ["学习中", learning], ["连续打卡", streak() + " 天"],
      ["累计正确率", (okAll + noAll) ? Math.round(okAll / (okAll + noAll) * 100) + "%" : "—"]
    ]) + '</div><div class="stats-secondary-kpis">' + kpiHtml([
      ["未学", unseen], ["熟练（全词库）", proficientCount()],
      ["错词", wrong], ["收藏", Object.keys(S.stars || {}).length], ["学习天数", k.length], ["累计时长", fmtTime(S.timeSec)]
    ]) + "</div>";

    markStatsDetailEmpty("#stages", learning + mas === 0);
    $("#stagesHint").textContent = learning + mas === 0
      ? "还没有开始学习 —— 学完第一个词，这里就会出现各档位的分布"
      : "";
    const stageUnseen = unseen;
    const stageDist = dist.slice();
    const stageSummary = $("#stagesSummary");
    if (stageSummary) stageSummary.textContent = "已学 " + (learning + mas) + " 词 · 未学 " + stageUnseen + " 词未计入；选择档位查看词数";
    const mx = Math.max(1, ...stageDist);
    $("#stages").innerHTML = stageDist.map((v, i) => {
      const label = (i === MASTER ? "已掌握" : i === 0 ? "重学（第零档）" : "第" + i + "档") + "：" + v + " 词";
      return '<button type="button" class="chart-bar" tabindex="' + (i === 0 ? "0" : "-1") + '" aria-pressed="false" aria-describedby="stagesHint" data-stage-label="' + esc(label) + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"><span class="stage-plot"><span class="stage-fill" style="height:' + (v ? Math.max(3, v / mx * 100) : 0) + '%"><i>' + (v || "") + '</i></span></span><u>' + (i === MASTER ? "掌握" : i === 0 ? "重学" : i) + "</u></button>";
    }).join("");
    // G：档位下钻按钮跟随已选档位；0 词禁用并说明（与统计分布同一口径）。
    if (statsSelStage >= stageDist.length) statsSelStage = -1;
    const stageNodes = Array.from($("#stages").querySelectorAll?.("[data-stage-label]") || []);
    if (statsSelStage >= 0 && stageNodes[statsSelStage]) {
      stageNodes.forEach((node, i) => {
        node.setAttribute?.("aria-pressed", String(i === statsSelStage));
        node.tabIndex = i === statsSelStage ? 0 : -1;
      });
    }
    updateStageDrillUi();

    const last = [];
    let sumN = 0, sumR = 0, sumOk = 0, sumNo = 0;
    for (let d = 13; d >= 0; d--) {
      const t = new Date(); t.setDate(t.getDate() - d);
      const key = todayStr(t);
      const v = S.days[key] || {n: 0, r: 0, ok: 0, no: 0};
      last.push({key: key, date: t, n: v.n, r: v.r, ok: v.ok, no: v.no});
      sumN += v.n; sumR += v.r; sumOk += v.ok; sumNo += v.no;
    }
    const dmx = Math.max(1, ...last.map(x => x.r));
    $("#days").innerHTML = last.map((x, idx) => {
      const todayCol = idx === last.length - 1;
      const label = todayCol ? "今天" : idx === last.length - 2 ? "昨天"
        : x.date.getDate() === 1 ? (x.date.getMonth() + 1) + "/1" : String(x.date.getDate());
      const h = x.r ? Math.max(3, Math.round(x.r / dmx * 100)) : 0;
      const nh = x.r ? x.n / x.r * 100 : 0;
      const rh = x.r ? (x.r - x.n) / x.r * 100 : 0;
      const acc = (x.ok + x.no) ? Math.round(x.ok / (x.ok + x.no) * 100) + "%" : "—";
      const detail = x.key + "：新词 " + x.n + " · 复习 " + (x.r - x.n) + " · 正确率 " + acc;
      return '<button type="button" class="day-col' + (todayCol ? " today" : "") +
        '" tabindex="' + (todayCol ? "0" : "-1") + '" aria-pressed="false" aria-describedby="daysHint" data-day-label="' + esc(detail) + '" aria-label="' + esc(detail) + '" title="' + esc(detail) + '">' +
        '<span class="day-plot"><span class="day-bar' + (x.r ? "" : " zero") + '" style="height:' + h + '%">' +
          (x.n ? '<i class="day-new" style="height:' + nh + '%"></i>' : "") +
          (x.r - x.n > 0 ? '<i class="day-rev" style="height:' + rh + '%"></i>' : "") +
        "</span></span><em>" + label + "</em></button>";
    }).join("");
    $("#daysSummary").textContent = sumR
      ? "近 14 天：新词 " + sumN + " · 复习 " + (sumR - sumN) + " · 正确率 " +
        ((sumOk + sumNo) ? Math.round(sumOk / (sumOk + sumNo) * 100) + "%" : "—")
      : "";
    markStatsDetailEmpty("#days", sumR === 0);
    $("#daysHint").textContent = sumR ? "" : "最近 14 天还没有学习记录";
    renderDueForecast();
    renderFreqMastery();
    renderHeatmap();
    renderDrillEntry();
    renderReviewPlan();
    renderGroupSurfaces();
    renderSurvey();
    syncStatsChartHints();
    renderBackupStatus();
  }

  /* ================= 打印生词本（界面） ================= */
  function renderPrintBook(){
    const source = ($("#printSource") && $("#printSource").value) || "wrong";
    const entries = printBookEntries(source);
    const label = printSourceLabel(source);
    const date = todayStr();
    const body = $("#printBody");
    const count = $("#printCount");
    if (count) {
      count.textContent = entries.length
        ? "共 " + entries.length + " 词 · 来源：" + label
        : "「" + label + "」暂无词条，换一个来源试试";
    }
    if (!body) return entries;
    if (!entries.length) {
      body.innerHTML = '<p class="print-empty">暂无词条</p>';
      return entries;
    }
    let html = '<div class="print-book">' +
      '<header class="print-book-head">' +
        '<h3 class="print-book-title">' + esc(currentBook().name + "生词本") + "</h3>" +
        '<p class="print-book-sub">' + esc(date) + " · " + esc(label) + " · 共 " + entries.length + " 词</p>" +
      "</header>" +
      '<ol class="print-entries">';
    for (const e of entries) {
      html += '<li class="print-entry">' +
        '<input type="checkbox" class="print-check" aria-label="自测 ' + esc(e.w) + '">' +
        '<div class="print-main">' +
          '<div class="print-word-line"><b class="print-word">' + esc(e.w) + "</b>" +
            (e.ph ? '<span class="print-ph">/' + esc(e.ph) + "/</span>" : "") + "</div>" +
          '<div class="print-mean">' + esc(e.m || "—") + "</div>" +
          '<div class="print-meta">' + esc(printMetaText(e.wrong, e.status, e.star)) + "</div>" +
        "</div></li>";
    }
    body.innerHTML = html + "</ol></div>";
    return entries;
  }
  function openPrintBook(){
    const sel = $("#printSource");
    if (sel) {
      if ($("#v-list")?.classList.contains("on")) sel.value = "filter";
      else if (wrongWordIndices().length) sel.value = "wrong";
      else if (printBookEntries("star").length) sel.value = "star";
      else sel.value = "filter";
    }
    renderPrintBook();
    openSheet("#printSheet");
  }
  async function copyPrintMarkdown(){
    const source = ($("#printSource") && $("#printSource").value) || "wrong";
    const entries = printBookEntries(source);
    const md = printBookMarkdown(entries, {
      date: todayStr(),
      sourceLabel: printSourceLabel(source)
    });
    $("#printMarkdownCopy")?.remove?.();
    let ok = false;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(md);
        ok = true;
      }
    } catch (e) { /* fall through */ }
    if (!ok) {
      const ta = document.createElement("textarea");
      ta.id = "printMarkdownCopy";
      ta.value = md;
      ta.setAttribute?.("readonly", "");
      ta.setAttribute?.("aria-label", "生词本 Markdown，自动复制失败时可手动复制");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      // 放在浮层内，确保焦点陷阱和 inert 不会阻止手动复制。
      const host = $("#printSheet .print-toolbar") || document.body;
      const focusBefore = document.activeElement;
      host.appendChild(ta);
      ta.focus?.();
      ta.select?.();
      try { ok = document.execCommand && document.execCommand("copy"); } catch (e) { ok = false; }
      if (ok) {
        ta.remove?.();
        focusBefore?.focus?.({ preventScroll: true });
      } else {
        ta.style.position = "static";
        ta.style.left = "";
        ta.style.width = "100%";
        ta.style.boxSizing = "border-box";
        ta.rows = 8;
        ta.focus?.();
        ta.select?.();
      }
    }
    toast(ok ? "已复制为 Markdown（" + entries.length + " 词）" : "自动复制失败，已选中 Markdown；请按 Ctrl/Cmd+C 复制");
    return md;
  }

  /* ================= 08 设置与当前组生命周期 =================
   * 契约：设置仍即时自动保存；计划/范围类改动默认只「应用到下一组」，
   * 当前组沿用 startSession 时冻结的 sessionPlan（范围、曲线、每组词数、每日计划）；
   * 只有显式「应用并重新开始」才重建当前组。外观/显示/语音/键盘偏好仍立即生效。
   * 特训、受控子组、已揭示卡与撤销现场在改设置时保持稳定（本段全部不调用 startSession）。
   */
  /** 当前「主组」的冻结计划；受控子组/特训进行中时取保存的父组现场，避免把子组当主组。 */
  function mainSessionPlan(){
    if (extraSubgroup && extraSnap && extraSnap.sessionPlan) return extraSnap.sessionPlan;
    if (newOnlySubgroup && newOnlySnap && newOnlySnap.sessionPlan) return newOnlySnap.sessionPlan;
    if (drillMode && mainSnap && mainSnap.sessionPlan) return mainSnap.sessionPlan;
    return sessionPlan;
  }
  /** 主组是否仍在进行（完成页/无卡时为 false）：此时改设置不自动开组，由用户点继续。 */
  function mainGroupActiveForSettings(){
    if (inSubgroup()) return !!(extraSubgroup ? extraSnap : newOnlySnap);
    if (drillMode) return !!(mainSnap && (mainSnap.cur != null || mainSnap.qi < mainSnap.Q.length));
    return cur != null || (Q.length > 0 && qi < Q.length);
  }
  /** 只读比较冻结主组与下组配置；scopeSig 保持原格式，曲线直接按已有快照字段比较。 */
  function pendingSessionSettings(){
    const plan = mainSessionPlan();
    const diff = {scope: false, stageCount: 0, relearn: false};
    if (!plan || plan.bookId !== currentBookId) return diff;
    diff.scope = typeof plan.scopeSig === "string" && plan.scopeSig !== currentScopeSignature();
    const cfg = currentStageConfig();
    if (Array.isArray(plan.stagesMs) && plan.stagesMs.length === cfg.stages.length) {
      diff.stageCount = cfg.stages.reduce((n, minutes, i) => n + (plan.stagesMs[i] !== minutes * MINUTE_MS ? 1 : 0), 0);
    }
    diff.relearn = Number.isFinite(plan.relearnMs) && plan.relearnMs !== cfg.relearn * MINUTE_MS;
    return diff;
  }
  /** 保留原入口名称：范围、计划、曲线与重学间隔偏离都统一提示「下一组生效」。 */
  function hasPendingScopeSettings(){
    const diff = pendingSessionSettings();
    return diff.scope || diff.stageCount > 0 || diff.relearn;
  }
  /** 与复习节奏区同样按实际参数识别名称；stagePreset 纯展示，不会制造参数差异。 */
  function rhythmConfigLabel(stages, relearn){
    const key = presetKeyOf(stages, relearn);
    return key === "custom" ? "自定义" : STAGE_PRESETS[key].label;
  }
  /** 有限长摘要：不在学习页重复十档编辑器；重学间隔明确给出本组值与下组值。 */
  function pendingRhythmText(){
    const plan = mainSessionPlan(), diff = pendingSessionSettings(), parts = [];
    if (!plan || (!diff.stageCount && !diff.relearn)) return "";
    const cfg = currentStageConfig();
    if (diff.stageCount) {
      const before = rhythmConfigLabel(plan.stagesMs.map(ms => ms / MINUTE_MS), plan.relearnMs / MINUTE_MS);
      const after = rhythmConfigLabel(cfg.stages, cfg.relearn);
      parts.push("复习曲线：" + (before === after ? after : before + " → " + after) + "（" + diff.stageCount + " 档变更）");
    }
    if (diff.relearn) parts.push("不会后重学：" + formatMinutes(plan.relearnMs / MINUTE_MS) + " → " + formatMinutes(cfg.relearn));
    return parts.join("；");
  }
  /** 08 范围摘要：与设置控件逐项对应，供设置页「下一组预览」展示。 */
  function scopeSummaryText(){
    const s = S.settings;
    const cfg = currentStageConfig();
    const orderText = {freq: "按词频顺序", shuffle: "随机乱序", wrong: "错词优先"}[s.order] || "按词频顺序";
    const freqText = (!s.fmax && s.fmin <= 1) ? "全部词频"
      : (s.fmax ? "词频 " + s.fmin + "–" + s.fmax : "词频 ≥" + s.fmin);
    const posText = (s.pos && s.pos.length)
      ? "词性 " + s.pos.map(k => (POSCHIPS.find(c => c.k === k) || {}).t || k).join("/")
      : "词性不限";
    return [
      orderText, freqText,
      s.pmin ? "≥" + s.pmin + " 套卷" : "套卷不限",
      s.kyOnly ? "仅" + currentBook().tagLabel : "大纲不限",
      posText,
      getPosMode() === "all" ? "按全部词性" : "按主要词性",
      "每日 " + s.dailyNew + " 新词", "每组 " + s.groupSize + " 词",
      "复习曲线 " + rhythmConfigLabel(cfg.stages, cfg.relearn), "不会后重学 " + formatMinutes(cfg.relearn)
    ].join(" · ");
  }
  /** 设置页生命周期区：下一组预览 + 当前组快照说明 + 显式重开按钮。 */
  function renderSettingsLifecycle(){
    const nextEl = $("#settingsNextPreview");
    const curEl = $("#settingsCurrentGroup");
    const btn = $("#applySettingsRestart");
    if (!nextEl && !curEl && !btn) return;
    if (nextEl) {
      nextEl.innerHTML = "下一组预览：按当前设置匹配 <b>" + inScopeCount() + "</b> 词 · "
        + esc(scopeSummaryText());
    }
    const plan = mainSessionPlan();
    const active = mainGroupActiveForSettings();
    const busy = drillMode || inSubgroup();
    const rhythmDiff = pendingRhythmText();
    const detail = $("#settingsLifecycleDetails");
    if (detail && active && hasPendingScopeSettings()) detail.open = true;
    const startLabel = $("#btnStartFromSettings");
    if (startLabel) startLabel.textContent = active ? "继续当前组 ↗" : "开始背诵 ↗";
    if (curEl) {
      if (busy) {
        curEl.innerHTML = "错词特训/受控子组进行中：改设置仍只应用到下一组；退出后回到原组现场，不会重建进行中的卡。"
          + (hasPendingScopeSettings() ? " 当前已有<b>设置更改待应用</b>。" : "")
          + (rhythmDiff ? " " + esc(rhythmDiff) + "。" : "");
      } else if (active && plan && plan.bookId === currentBookId) {
        const sc = plan.scopeCount != null ? plan.scopeCount : "—";
        const dn = plan.dailyNewTarget != null ? plan.dailyNewTarget : S.settings.dailyNew;
        const done = Math.min(answered, groupTotal);
        curEl.innerHTML = "当前组：开始时的范围 <b>" + sc + "</b> 词 · 每日 <b>" + dn + "</b> 新词 · 每组 <b>"
          + (plan.groupSize || S.settings.groupSize) + "</b> 张 · 本组进度 <b>" + done + "/" + groupTotal
          + "</b>（分母固定，重考不扩大）"
          + (hasPendingScopeSettings() ? " · <b>设置已更改，将在下一组生效</b>" : " · 与当前设置一致")
          + (rhythmDiff ? " · " + esc(rhythmDiff) : "");
      } else {
        curEl.innerHTML = "当前没有进行中的组：设置保存后，点「继续背诵」或「开始背诵」时按新设置开组。";
      }
    }
    if (btn) {
      const show = active && hasPendingScopeSettings() && !busy;
      btn.hidden = !show;
      btn.disabled = !show;
    }
  }
  /** 仅同步目标展示；设置页预览也会调用，不创建当日记录或改变本组/额度。 */
  function renderNewGoalSummary(){
    const plan = mainSessionPlan();
    const active = mainGroupActiveForSettings();
    const targetPending = active && plan && Number.isInteger(plan.dailyNewTarget)
      && plan.dailyNewTarget !== S.settings.dailyNew;
    const goalLabel = $("#s-newlabel");
    if (goalLabel) goalLabel.textContent = targetPending ? "下组目标" : "今日新词";
    const goalChip = $("#newGoalChip");
    if (goalChip) goalChip.setAttribute?.("title", targetPending
      ? "数字为今日已学新词 / 已保存的下组目标。当前组每日新词计划 " + plan.dailyNewTarget
        + "；下一组计划 " + S.settings.dailyNew + " + 今日临时 " + extraDayLedger().extra
        + "，下组目标 " + effectiveNewTarget() + "（上限 500）。当前卡和本组张数不变。"
      : "今日已学新词 / 今日目标（每日计划 + 今日临时加量）；圆环表示今日目标完成度");
    const target = Math.max(1, effectiveNewTarget());
    const maxEl = $("#s-newmax");
    if (maxEl) maxEl.textContent = String(target);
    const learned = (S.days[todayStr()] || {}).n || 0;
    const goalPct = Math.min(1, learned / target);
    const ring = $("#ringFg");
    if (ring) {
      const C = 2 * Math.PI * 15;
      ring.style.strokeDasharray = String(C);
      ring.style.strokeDashoffset = String(C * (1 - goalPct));
    }
    const goalEl = $("#s-goal");
    if (goalEl) goalEl.textContent = Math.round(goalPct * 100) + "%";
  }
  /** 学习页轻提示：只解释待应用设置，不重建当前卡/判定/队列。 */
  function renderPlanPendingNotice(){
    renderNewGoalSummary();
    const plan = mainSessionPlan();
    const active = mainGroupActiveForSettings();
    const targetPending = active && plan && Number.isInteger(plan.dailyNewTarget)
      && plan.dailyNewTarget !== S.settings.dailyNew;
    const box = $("#planPendingNotice");
    if (!box) return;
    const show = !drillMode && !inSubgroup() && active && hasPendingScopeSettings();
    if (!show) { box.hidden = true; return; }
    box.hidden = false;
    const text = $("#planPendingText");
    if (text) {
      const diff = pendingSessionSettings(), rhythmDiff = pendingRhythmText();
      const categories = [diff.scope ? "范围/计划" : "", diff.stageCount || diff.relearn ? "复习节奏" : ""].filter(Boolean).join("与");
      text.innerHTML = "设置已更改：新" + categories + "将在下一组生效。本组仍按开始时的范围 <b>"
        + (plan && plan.scopeCount != null ? plan.scopeCount : "—") + "</b> 词统计，进度分母固定 <b>"
        + groupTotal + "</b> 张。"
        + (targetPending ? "本组每日新词计划 <b>" + plan.dailyNewTarget
          + "</b>；下一组已保存计划 <b>" + S.settings.dailyNew + "</b>（今日临时 "
          + extraDayLedger().extra + "，下组目标 " + effectiveNewTarget() + "）。" : "")
        + (rhythmDiff ? esc(rhythmDiff) + "。" : "");
    }
    const btn = $("#planPendingApply");
    if (btn) btn.onclick = applySettingsRestart;
  }
  /** 显式「应用并重新开始」：只有这里才重建当前组（无确认弹窗，toast 说明）。 */
  function applySettingsRestart(){
    if (drillMode) { toast("请先退出错词特训，再应用设置并重新开始本组"); return false; }
    if (inSubgroup()) { toast("请先返回原组，再应用设置并重新开始本组"); return false; }
    if (!mainGroupActiveForSettings()) {
      toast("当前没有进行中的组；点「继续背诵」即按新设置开始");
      return false;
    }
    startSession("main");
    toast("已按当前设置重新开始本组");
    renderSettingsLifecycle();
    return true;
  }
  /** 按类恢复默认：只影响该类字段，不清空学习/熟练/收藏，也不重建当前组。 */
  function resetSettingsClass(kind){
    const d = DEF.settings;
    if (kind === "plan") {
      S.settings.dailyNew = d.dailyNew;
      S.settings.groupSize = d.groupSize;
      S.settings.dailyReviewCap = d.dailyReviewCap;
      S.settings.backlogGuard = d.backlogGuard;
      S.settings.order = d.order;
      S.settings.autoResume = normalizeAutoResume(d.autoResume, false);
      autoResumeLegacyBooks.delete(currentBookId);
      clearAutoResumePause(currentBookId);
      resetAutoResumeRuntime();
    } else if (kind === "scope") {
      S.settings.fmin = d.fmin;
      S.settings.fmax = d.fmax;
      S.settings.pmin = Math.min(currentBook().defaultPmin || d.pmin, currentBook().paperCount || d.pmin);
      S.settings.kyOnly = d.kyOnly;
      S.settings.pos = [];
      S.settings.posMode = d.posMode;
    } else if (kind === "appearance") {
      S.settings.theme = d.theme;
      S.settings.showPh = d.showPh; S.settings.showEx = d.showEx; S.settings.showFm = d.showFm;
      S.settings.autoSpk = d.autoSpk;
      // 12 外观类同时恢复字号与设备语音偏好（同属界面偏好，不是学习计划/范围）。
      S.settings.fontSize = d.fontSize;
      S.settings.voiceURI = d.voiceURI;
      S.settings.speechRate = d.speechRate;
      // F1 阅读与布局字段同属外观类；恢复只改呈现，不重建当前组/不清进度。
      S.settings.cardDensity = d.cardDensity;
      S.settings.readingOrder = d.readingOrder.slice();
      S.settings.showCardMeta = d.showCardMeta;
      S.settings.showCardStage = d.showCardStage;
      S.settings.showCardPos = d.showCardPos;
      S.settings.secondaryActions = d.secondaryActions.slice();
      S.settings.keys = Object.assign({}, DEFKEYS);
      // AGENTS 契约：恢复默认按键不得自动重新启用单字符快捷键；该开关保持用户当前选择。
    } else {
      return {ok: false, kind: kind, error: "unknown-class"};
    }
    save();
    bindSet();
    applyFilter();
    renderStats();
    if ($("#v-study")?.classList.contains("on")) renderCard();
    markSettingsSaved();
    renderSettingsLifecycle();
    renderPlanPendingNotice();
    return {ok: true, kind: kind};
  }
  /**
   * 计划/范围类设置的统一保存/预览链：自动保存 + 只影响下一组（不 startSession）。
   * posMode 按钮、词性 chip、combo 预设、pmin/频段输入与 onSet 全部走这一条链。
   */
  function settingsChangedSurfaces(){
    save();
    autoResumeCheckCache = null;
    updateScopeCount();
    markSettingsSaved();
    renderSettingsLifecycle();
    renderPlanPendingNotice();
    renderGroupSurfaces();
    renderCapSurfaces();
    renderFreqHistogram();
    if ($("#v-study")?.classList.contains("on")) renderCard();
    if ($("#v-stats")?.classList.contains("on")) renderStats();
  }

  /* ================= 学习方案：纯配置目录与原子写入（下一大版本 A/B） =================
   * 本区只管理已存在的 settings 字段。方案目录独立存储，不进入学习备份 v3、
   * 主进度签名、今日暂停、临时加量或会话快照；不更改旧记录默认分支。
   */
  const SETTINGS_PROFILES_KEY = "vocab_settings_profiles_v1";
  const SETTINGS_PROFILES_KIND = "vocab-settings-profiles";
  const SETTINGS_PROFILES_MAX = 30;
  const SETTINGS_CATEGORIES = Object.freeze([
    {id: "plan", label: "学习计划"}, {id: "scope", label: "词库范围"},
    {id: "rhythm", label: "复习曲线"}, {id: "appearance", label: "外观与显示"},
    {id: "speech", label: "设备发音"}, {id: "keys", label: "操作偏好"}
  ].map(x => Object.freeze(x)));
  const SETTINGS_CATALOG = Object.freeze([
    ["dailyNew", "每日新词", "plan", "next", "book", "#dailyNew", "新词 目标 配额"],
    ["order", "出词顺序", "plan", "next", "book", "#order", "乱序 随机 词频 错词优先"],
    ["dailyReviewCap", "每日复习上限", "plan", "now", "book", "#reviewCapCustom", "次数 预算 配额 不限"],
    ["groupSize", "每组词数", "plan", "next", "book", "#groupSize", "分组 数量"],
    ["backlogGuard", "积压保护", "plan", "next", "book", "#backlogGuard", "到期 优先复习 补新词"],
    ["autoResume", "自动续背", "plan", "now", "book", "#autoResumePresets", "连续 等待 挂机 阈值 倒计时"],
    ["fmin", "最低词频", "scope", "next", "book", "#fmin", "频段 次数 下界"],
    ["fmax", "最高词频", "scope", "next", "book", "#fmax", "频段 次数 上界 不限"],
    ["pmin", "最低套卷数", "scope", "next", "book", "#pmin", "真题 套数 筛选"],
    ["kyOnly", "仅考试大纲词", "scope", "next", "book", "#kyOnly", "大纲 范围"],
    ["pos", "词性筛选", "scope", "next", "book", "#posChips", "名词 动词 形容词 副词 其他"],
    ["posMode", "词性口径", "scope", "next", "book", "#posMode", "主词性 全部词性 释义"],
    ["stages", "十档复习间隔", "rhythm", "next", "book", "#rhythmStages", "曲线 记忆 均衡 强化 自定义"],
    ["relearn", "不会后重学间隔", "rhythm", "next", "book", "#rhythmRelearn", "遗忘 分钟 跨组"],
    ["stagePreset", "复习曲线名称", "rhythm", "next", "book", "#rhythmPresets", "预设 轻负荷 密集"],
    ["theme", "颜色主题", "appearance", "now", "carry", "#themeSeg", "浅色 深色 跟随系统"],
    ["showPh", "显示音标", "appearance", "now", "carry", "#showPh", "读音"],
    ["showEx", "显示例句", "appearance", "now", "carry", "#showEx", "原句"],
    ["showFm", "显示词形", "appearance", "now", "carry", "#showFm", "变化 屈折"],
    ["fontSize", "阅读字号", "appearance", "now", "carry", "#fontSizeSeg", "大字 标准 释义"],
    ["cardDensity", "卡片密度", "appearance", "now", "carry", "#cardDensitySeg", "紧凑 舒适 间距"],
    ["readingOrder", "判定后阅读顺序", "appearance", "now", "carry", "#readingOrderControls", "释义 例句 词形 顺序"],
    ["showCardMeta", "显示词频套卷标签", "appearance", "now", "carry", "#showCardMeta", "词频 套卷 书源"],
    ["showCardStage", "显示复习阶段", "appearance", "now", "carry", "#showCardStage", "阶段 点"],
    ["showCardPos", "显示卡片词性", "appearance", "now", "carry", "#showCardPos", "词性 名词 动词"],
    ["secondaryActions", "固定次级动作", "appearance", "now", "carry", "#secondaryActionsControls", "撤销 熟练 发音 收藏"],
    ["autoSpk", "自动发音", "speech", "now", "carry", "#autoSpk", "读音 朗读"],
    ["voiceURI", "英语语音", "speech", "now", "carry", "#voiceSelect", "设备 声音 英式 美式"],
    ["speechRate", "朗读语速", "speech", "now", "carry", "#speechRate", "发音 快慢"],
    ["singleCharKeys", "单字符快捷键", "keys", "now", "carry", "#singleCharKeys", "键盘 开关"],
    ["keys", "自定义快捷键", "keys", "now", "carry", "#settings-keys", "会 不会 下一个 发音 收藏 熟练 按键" ],
    ["actionKeys", "继续与返回快捷键", "keys", "now", "carry", "#actionKeysSettings", "等待 继续 返回 搜索 Shift 组合键"],
    ["gestures", "卡片滑动手势", "keys", "now", "carry", "#gestureSettings", "触摸 左右 关闭 反转 判定"],
    ["actionLayout", "左右手操作布局", "keys", "now", "carry", "#actionLayoutSettings", "左手 右手 按钮 顺序"]
  ].map(a => Object.freeze({key: a[0], label: a[1], category: a[2], effect: a[3], scope: a[4],
    target: a[5], search: a[1] + " " + a[6], defaultValue: cloneSettingsValue(DEF.settings[a[0]])})));
  const SETTINGS_CATALOG_MAP = new Map(SETTINGS_CATALOG.map(x => [x.key, x]));
  let settingsProfileSequence = 0;
  function settingsProfileFail(error, extra){ return Object.assign({ok: false, error: error}, extra || {}); }
  function settingsProfileCategories(input, allowed){
    if (!Array.isArray(input) || !input.length || input.length > SETTINGS_CATEGORIES.length
      || new Set(input).size !== input.length || input.some(x => !SETTINGS_CATEGORIES.some(c => c.id === x)
        || (allowed && !allowed.includes(x)))) return null;
    return SETTINGS_CATEGORIES.map(c => c.id).filter(id => input.includes(id));
  }
  function settingsFieldsForCategories(categories){ return SETTINGS_CATALOG.filter(x => categories.includes(x.category)).map(x => x.key); }
  function settingsProfileName(name){
    return typeof name === "string" && name === name.trim() && [...name].length >= 1 && [...name].length <= 40
      && !/[\u0000-\u001f\u007f]/.test(name);
  }
  function settingsProfileSame(a, b){ return JSON.stringify(a) === JSON.stringify(b); }
  /** 严格校验已选字段；不同于学习记录兼容读取，绝不把非法配置静默修成默认值。 */
  function validateSettingsSelection(settings, fields, book){
    if (!isRecord(settings) || !book || !book.available) return "词书或配置不可用";
    const between = (v, a, b) => typeof v === "number" && Number.isInteger(v) && v >= a && v <= b;
    for (const key of fields) {
      if (!Object.prototype.hasOwnProperty.call(settings, key)) return "缺少配置：" + (SETTINGS_CATALOG_MAP.get(key)?.label || key);
      const v = settings[key];
      let valid = true;
      switch (key) {
        case "dailyNew": valid = between(v, 1, 500); break;
        case "groupSize": valid = between(v, 1, 100); break;
        case "dailyReviewCap": valid = between(v, 0, 1000); break;
        case "fmin": valid = between(v, 1, 9999); break;
        case "fmax": valid = between(v, 0, 9999); break;
        case "pmin": valid = between(v, 0, book.paperCount || book.defaultPmin || 2); break;
        case "order": valid = ["freq", "shuffle", "wrong"].includes(v); break;
        case "posMode": valid = ["primary", "all"].includes(v); break;
        case "theme": valid = ["light", "dark", "auto"].includes(v); break;
        case "fontSize": valid = ["standard", "large"].includes(v); break;
        case "voiceURI": valid = typeof v === "string" && v.length <= 200 && v === v.trim(); break;
        case "speechRate": valid = typeof v === "number" && Number.isFinite(v) && v >= 0.5 && v <= 1.5
          && Math.abs(v * 100 - Math.round(v * 100)) < 0.00000001; break;
        case "pos": valid = Array.isArray(v) && v.length <= POS_TAGS.length && new Set(v).size === v.length && v.every(x => POS_TAGS.includes(x)); break;
        case "keys": valid = isRecord(v) && Object.keys(v).length === Object.keys(DEFKEYS).length
          && Object.keys(DEFKEYS).every(k => validKey(v[k]) && v[k] === v[k].toLowerCase())
          && Object.keys(v).every(k => Object.prototype.hasOwnProperty.call(DEFKEYS, k))
          && new Set(Object.values(v)).size === Object.keys(DEFKEYS).length; break;
        case "actionKeys": valid = isRecord(v) && Object.keys(v).length === Object.keys(DEFACTIONKEYS).length
          && Object.keys(v).every(k=>Object.prototype.hasOwnProperty.call(DEFACTIONKEYS,k))
          && Object.values(v).every(k=>k===null || normalizeKeyBinding(k)===k); break;
        case "gestures": valid = isRecord(v) && Object.keys(v).length===3 && Object.keys(v).every(k=>["enabled","recall","revealed"].includes(k))
          && typeof v.enabled==="boolean" && ["recall","revealed"].every(phase=>isRecord(v[phase])
            && Object.keys(v[phase]).length===2 && Object.keys(v[phase]).every(k=>["left","right"].includes(k))
            && Object.values(v[phase]).every(a=>(phase==="recall"?GESTURE_RECALL_ACTIONS:GESTURE_REVEALED_ACTIONS).includes(a))); break;
        case "actionLayout": valid = ["standard","left","right"].includes(v); break;
        case "cardDensity": valid = CARD_DENSITY_VALUES.includes(v); break;
        case "readingOrder": valid = Array.isArray(v) && v.length === READING_ORDER_KEYS.length
          && new Set(v).size === v.length && v.every(k => READING_ORDER_KEYS.includes(k)); break;
        case "secondaryActions": valid = Array.isArray(v) && v.length <= 2 && new Set(v).size === v.length
          && v.every(id => SECONDARY_ACTION_IDS.includes(id)); break;
        case "showCardMeta": case "showCardStage": case "showCardPos": valid = typeof v === "boolean"; break;
        case "autoResume": valid = isRecord(v) && Object.keys(v).length === 4
          && Object.keys(v).every(k => ["enabled", "threshold", "idleMs", "countdownMs"].includes(k))
          && typeof v.enabled === "boolean" && between(v.threshold, 1, 50)
          && between(v.idleMs, 30000, 600000) && between(v.countdownMs, 3000, 60000); break;
        case "stages": case "relearn": valid = normalizeStageConfig(settings.stages, settings.relearn).ok; break;
        case "stagePreset": valid = typeof v === "string" && v === presetKeyOf(settings.stages, settings.relearn); break;
        default: valid = ["backlogGuard", "kyOnly", "showPh", "showEx", "showFm", "autoSpk", "singleCharKeys"].includes(key) && typeof v === "boolean";
      }
      if (!valid) return (SETTINGS_CATALOG_MAP.get(key)?.label || key) + "的值不合法"
        + (key === "pmin" ? "（" + book.name + "最多 " + book.paperCount + " 套卷）" : "");
    }
    if ((fields.includes("fmin") || fields.includes("fmax")) && settings.fmax !== 0 && settings.fmax < settings.fmin) return "最高词频不能小于最低词频";
    if(fields.includes("keys") || fields.includes("actionKeys")) {
      const conflict=inputBindingConflict(settings.keys||DEFKEYS,settings.actionKeys||DEFACTIONKEYS);
      if(conflict)return "快捷键冲突："+conflict.label+"共用了"+keyName(conflict.binding);
    }
    return null;
  }
  /** 旧方案兼容解码只补明确新增批次字段；读取旧方案不写回目录，不修原有缺失或坏值。 */
  const APPEARANCE_COMPAT_FIELDS = ["cardDensity", "readingOrder", "showCardMeta", "showCardStage", "showCardPos", "secondaryActions"];
  function decodeSettingsProfile(profile){
    const out=cloneSettingsValue(profile);
    if(isRecord(out) && Array.isArray(out.categories) && isRecord(out.settings)) {
      if(out.categories.includes("keys")) {
        for(const key of ["actionKeys","gestures","actionLayout"])
          if(!Object.prototype.hasOwnProperty.call(out.settings,key))out.settings[key]=cloneSettingsValue(DEF.settings[key]);
      }
      // F1 批次：v51 外观方案只有 theme/showPh/showEx/showFm/fontSize，缺 F1 六字段；
      // 只补这六个明确新增字段，原本应有字段缺失或未知字段仍整份拒绝。
      if(out.categories.includes("appearance")) {
        for(const key of APPEARANCE_COMPAT_FIELDS)
          if(!Object.prototype.hasOwnProperty.call(out.settings,key))out.settings[key]=cloneSettingsValue(DEF.settings[key]);
      }
    }
    return out;
  }
  function validateSettingsProfile(profile){
    profile=decodeSettingsProfile(profile);
    if (!isRecord(profile) || Object.keys(profile).some(k => !["id", "name", "bookId", "categories", "settings", "createdAt", "updatedAt"].includes(k))) return "方案结构不正确";
    if (typeof profile.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(profile.id)) return "方案标识不正确";
    if (!settingsProfileName(profile.name)) return "方案名称需为 1–40 个字";
    if (!bookOf(profile.bookId)?.available) return "方案来源词书不可用";
    const categories = settingsProfileCategories(profile.categories);
    if (!categories || !isRecord(profile.settings)) return "方案类别不正确";
    const fields = settingsFieldsForCategories(categories);
    if (Object.keys(profile.settings).length !== fields.length || Object.keys(profile.settings).some(k => !fields.includes(k))) return "方案中含有未选择类别或非配置字段";
    if (![profile.createdAt, profile.updatedAt].every(v => typeof v === "number" && Number.isSafeInteger(v) && v > 0)
      || profile.updatedAt < profile.createdAt) return "方案时间不正确";
    return validateSettingsSelection(profile.settings, fields, bookOf(profile.bookId));
  }
  function parseSettingsProfilesEnvelope(value){
    if (typeof value === "string" && value.length > 524288) return settingsProfileFail("配置方案文件过大（最多 512 KB）");
    let parsed;
    try { parsed = typeof value === "string" ? JSON.parse(value) : cloneSettingsValue(value); }
    catch (e) { return settingsProfileFail("配置方案文件不是有效的 JSON"); }
    if (!isRecord(parsed) || parsed.kind !== SETTINGS_PROFILES_KIND || parsed.version !== 1
      || Object.keys(parsed).some(k => !["kind", "version", "profiles"].includes(k))
      || !Array.isArray(parsed.profiles) || parsed.profiles.length > SETTINGS_PROFILES_MAX) return settingsProfileFail("配置方案格式或版本不支持（最多 30 个方案）");
    const ids = new Set(), names = new Set();
    for (let profileIndex=0;profileIndex<parsed.profiles.length;profileIndex++) {
      const profile=decodeSettingsProfile(parsed.profiles[profileIndex]);
      parsed.profiles[profileIndex]=profile;
      if (typeof profile?.id === "string" && profile.id.startsWith("builtin_")) return settingsProfileFail("个人方案不能使用内置方案标识");
      const error = validateSettingsProfile(profile);
      if (error) return settingsProfileFail(error);
      const name = profile.name.toLocaleLowerCase();
      if (ids.has(profile.id) || names.has(name)) return settingsProfileFail("方案标识或名称重复");
      ids.add(profile.id); names.add(name);
    }
    return {ok: true, profiles: parsed.profiles, envelope: parsed};
  }
  function readSettingsProfiles(){
    let raw;
    try { raw = localStorage.getItem(SETTINGS_PROFILES_KEY); }
    catch (e) { return settingsProfileFail("无法读取配置方案存储", {raw: null, profiles: []}); }
    if (raw === null) return {ok: true, raw: null, profiles: []};
    const result = parseSettingsProfilesEnvelope(raw);
    if (!result.ok) return settingsProfileFail("配置方案存储损坏，已保留原文：" + result.error, {raw: raw, profiles: []});
    return {ok: true, raw: raw, profiles: result.profiles};
  }
  function writeSettingsProfiles(profiles, previousRaw){
    const envelope = {kind: SETTINGS_PROFILES_KIND, version: 1, profiles: profiles};
    const checked = parseSettingsProfilesEnvelope(envelope);
    if (!checked.ok) return checked;
    try {
      // 同步操作前再比原文；另一页面刚写入时拒绝覆盖，下一次操作重读最新目录。
      if (localStorage.getItem(SETTINGS_PROFILES_KEY) !== previousRaw) return settingsProfileFail("另一页面刚更新了方案，请重试");
      localStorage.setItem(SETTINGS_PROFILES_KEY, JSON.stringify(envelope));
    } catch (e) { return settingsProfileFail("配置方案保存失败，原方案保持不变"); }
    return {ok: true, profiles: cloneSettingsValue(profiles)};
  }
  function newSettingsProfileId(profiles){
    let id;
    do { settingsProfileSequence++; id = "p_" + Date.now().toString(36) + "_" + settingsProfileSequence.toString(36) + "_" + Math.random().toString(36).slice(2, 9); }
    while (profiles.some(p => p.id === id));
    return id;
  }
  function saveSettingsProfile(name, categories, options){
    const stored = readSettingsProfiles(); if (!stored.ok) return stored;
    const picked = settingsProfileCategories(categories);
    const cleanName = typeof name === "string" ? name.trim() : name;
    if (!picked || !settingsProfileName(cleanName)) return settingsProfileFail("请选择类别，并填写 1–40 个字的方案名称");
    const replaceId = options && options.replaceId;
    const old = replaceId ? stored.profiles.find(p => p.id === replaceId) : null;
    if (replaceId && !old) return settingsProfileFail("待替换的方案不存在");
    if (!old && stored.profiles.length >= SETTINGS_PROFILES_MAX) return settingsProfileFail("最多保存 30 个方案，请先删除不再使用的方案");
    if (stored.profiles.some(p => p.id !== replaceId && p.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) return settingsProfileFail("已有同名方案，请换一个名称");
    const settings = {};
    for (const key of settingsFieldsForCategories(picked)) settings[key] = cloneSettingsValue(S.settings[key]);
    const now = Date.now();
    const profile = {id: old ? old.id : newSettingsProfileId(stored.profiles), name: cleanName, bookId: currentBookId,
      categories: picked, settings: settings, createdAt: old ? old.createdAt : now, updatedAt: Math.max(now, old ? old.createdAt : now)};
    const error = validateSettingsProfile(profile); if (error) return settingsProfileFail(error);
    const profiles = old ? stored.profiles.map(p => p.id === old.id ? profile : p) : stored.profiles.concat(profile);
    const result = writeSettingsProfiles(profiles, stored.raw);
    return result.ok ? Object.assign(result, {profile: cloneSettingsValue(profile)}) : result;
  }
  function renameSettingsProfile(id, name){
    const stored = readSettingsProfiles(); if (!stored.ok) return stored;
    const source = stored.profiles.find(p => p.id === id), cleanName = typeof name === "string" ? name.trim() : name;
    if (!source || !settingsProfileName(cleanName)) return settingsProfileFail("方案不存在，或名称不符合 1–40 个字要求");
    if (stored.profiles.some(p => p.id !== id && p.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) return settingsProfileFail("已有同名方案，请换一个名称");
    const profile = Object.assign({}, source, {name: cleanName, updatedAt: Math.max(Date.now(), source.updatedAt)});
    const result = writeSettingsProfiles(stored.profiles.map(p => p.id === id ? profile : p), stored.raw);
    return result.ok ? Object.assign(result, {profile: cloneSettingsValue(profile)}) : result;
  }
  function duplicateSettingsProfile(id, name){
    const stored = readSettingsProfiles(); if (!stored.ok) return stored;
    const source = stored.profiles.find(p => p.id === id), cleanName = typeof name === "string" ? name.trim() : name;
    if (!source || !settingsProfileName(cleanName)) return settingsProfileFail("方案不存在，或名称不符合 1–40 个字要求");
    if (stored.profiles.length >= SETTINGS_PROFILES_MAX) return settingsProfileFail("最多保存 30 个方案");
    if (stored.profiles.some(p => p.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) return settingsProfileFail("已有同名方案，请换一个名称");
    const profile = Object.assign({}, cloneSettingsValue(source), {id: newSettingsProfileId(stored.profiles), name: cleanName,
      createdAt: Date.now(), updatedAt: Date.now()});
    const result = writeSettingsProfiles(stored.profiles.concat(profile), stored.raw);
    return result.ok ? Object.assign(result, {profile: cloneSettingsValue(profile)}) : result;
  }
  function deleteSettingsProfile(id){
    const stored = readSettingsProfiles(); if (!stored.ok) return stored;
    if (!stored.profiles.some(p => p.id === id)) return settingsProfileFail("方案不存在");
    return writeSettingsProfiles(stored.profiles.filter(p => p.id !== id), stored.raw);
  }
  function previewSettingsPatch(patch){
    if (!isRecord(patch) || !Object.keys(patch).length || Object.keys(patch).some(k => !SETTINGS_CATALOG_MAP.has(k))) return settingsProfileFail("只能修改已有配置字段");
    const fields = Object.keys(patch), next = cloneSettingsValue(S.settings);
    for (const key of fields) next[key] = cloneSettingsValue(patch[key]);
    if ((fields.includes("stages") || fields.includes("relearn")) && !fields.includes("stagePreset")) {
      const cfg = normalizeStageConfig(next.stages, next.relearn);
      if (!cfg.ok) return settingsProfileFail(cfg.error.message);
      next.stagePreset = presetKeyOf(next.stages, next.relearn);
      fields.push("stagePreset");
    }
    const error = validateSettingsSelection(next, fields, currentBook());
    if (error) return settingsProfileFail(error);
    const changes = SETTINGS_CATALOG.filter(x => fields.includes(x.key) && !settingsProfileSame(S.settings[x.key], next[x.key]))
      .map(x => ({key: x.key, label: x.label, category: x.category, effect: x.effect,
        before: cloneSettingsValue(S.settings[x.key]), after: cloneSettingsValue(next[x.key])}));
    return {ok: true, settings: next, changes: changes,
      scopeCount: W.reduce((n, x, i) => n + (inScope(i, next) && !isProficient(i) ? 1 : 0), 0), targetBook: currentBookId};
  }
  function previewSettingsProfile(profile, selectedCategories){
    profile=decodeSettingsProfile(profile);
    const error = validateSettingsProfile(profile); if (error) return settingsProfileFail(error);
    const categories = settingsProfileCategories(selectedCategories || profile.categories, profile.categories);
    if (!categories) return settingsProfileFail("请选择方案已包含的类别");
    const patch = {};
    for (const key of settingsFieldsForCategories(categories)) patch[key] = cloneSettingsValue(profile.settings[key]);
    const result = previewSettingsPatch(patch);
    const preferenceFields = Object.keys(patch).filter(key => PREFERENCE_FIELDS.includes(key));
    const ownershipChanges = preferenceDeviceUsable()
      ? preferenceFields.filter(key => !isPreferenceOverridden(key)) : [];
    return Object.assign(result, {sourceBook: profile.bookId, targetBook: currentBookId, crossBook: profile.bookId !== currentBookId,
      categories: categories, profileId: profile.id, profileName: profile.name,
      preferenceScope: "book", preferenceFields: preferenceFields, ownershipChanges: ownershipChanges});
  }
  function applySettingsPatch(patch, options){
    options = options || {};
    const preview = previewSettingsPatch(patch); if (!preview.ok) return preview;
    // 方案明确应用当前书：即使值相同，也冻结所选偏好为本书覆盖；普通现场编辑仍按来源保存。
    const bookPreferenceFields = options.preferenceScope === "book" && preferenceDeviceUsable()
      ? Object.keys(patch).filter(key => PREFERENCE_FIELDS.includes(key)) : [];
    const ownershipChanges = bookPreferenceFields.filter(key => !isPreferenceOverridden(key));
    if (!preview.changes.length && !ownershipChanges.length) return preview;
    if (blockedBooks.has(currentBookId) || pendingReplacementToken) return settingsProfileFail("当前学习记录尚未安全保存，配置保持不变");
    // 独立熟练键仍是权威；未送达的熟练变化先交既有同步链处理，不能借配置覆盖。
    try {
      const latestProficient = readBookProficient(currentBook(), S.proficient);
      if (!settingsProfileSame(mergePendingProficient(latestProficient, currentBookId), S.proficient)) return settingsProfileFail("熟练标记刚在另一页面更新，请等待同步后重试");
    } catch (e) { return settingsProfileFail("配置保存失败，原配置与当前学习现场保持不变"); }
    if (bookPreferenceFields.length) {
      const nextPrefs = clonePrefValue(devicePrefs), overrides = new Set(preferenceOverrideList(currentBookId));
      bookPreferenceFields.forEach(field => overrides.add(field));
      nextPrefs.overrides[currentBookId] = PREFERENCE_FIELDS.filter(field => overrides.has(field));
      const committed = commitPreferenceChange(nextPrefs, preview.settings);
      if (!committed.ok) return settingsProfileFail(committed.error);
      finishSettingsPatchCommit(preview, committed.previousSettings);
      return Object.assign(preview, {preferenceScope: "book", preferenceFields: bookPreferenceFields,
        ownershipChanges: ownershipChanges});
    }
    // O1：偏好字段按来源裁决——未覆盖字段改设备 shared（同时保存本书记录快照），
    // 本书覆盖字段改本书自己的值；涉及设备键 + 主键时走小事务/恢复日志。
    const prefFields = preview.changes.map(change => change.key).filter(key => PREFERENCE_FIELDS.includes(key));
    const devicePrefFields = prefFields.filter(field => preferenceDeviceUsable() && !isPreferenceOverridden(field));
    if (devicePrefFields.length) {
      const nextPrefs = clonePrefValue(devicePrefs);
      for (const field of devicePrefFields) nextPrefs.shared[field] = clonePrefValue(preview.settings[field]);
      const committed = commitPreferenceChange(nextPrefs, preview.settings);
      if (!committed.ok) return settingsProfileFail(committed.error);
      finishSettingsPatchCommit(preview, committed.previousSettings);
      return preview;
    }
    let serialized;
    try {
      const latest = localStorage.getItem(KEY);
      if (latest !== lastMainRaw) return settingsProfileFail("另一页面已更新本书记录，请等待同步后重试，配置保持不变");
      serialized = serializeSharedState(Object.assign({}, S, {settings: preview.settings}), latest);
      localStorage.setItem(KEY, serialized);
    } catch (e) { return settingsProfileFail("配置保存失败，原配置与当前学习现场保持不变"); }
    const previous = S.settings;
    S.settings = preview.settings;
    noteInputPreferencesCommitted(previous);
    lastMainRaw = serialized; lastSavedSignature = savedStateSignature(S);
    storageOK = true; clearAlert("save");
    syncLastResolvedPreferences();
    finishSettingsPatchCommit(preview, previous);
    return preview;
  }
  /** applySettingsPatch 成功后的呈现刷新（保持原有即时偏好/方案工作台行为）。 */
  function finishSettingsPatchCommit(preview, previous){
    autoResumeCheckCache = null;
    if (preview.changes.some(x => x.key === "autoResume")) {
      autoResumeLegacyBooks.delete(currentBookId);
      // 切换配置不得抹掉用户今天的暂停，仅重新计时。
      resetAutoResumeRuntime();
    }
    applyTheme(); applyFontSize();
    renderPreferenceOwnershipControls();
    if (typeof refreshSettingsWorkspace === "function") refreshSettingsWorkspace(previous, preview.changes);
  }
  function applySettingsProfile(profile, selectedCategories){
    profile=decodeSettingsProfile(profile);
    const preview = previewSettingsProfile(profile, selectedCategories); if (!preview.ok) return preview;
    const patch = {};
    for (const key of settingsFieldsForCategories(preview.categories)) patch[key] = cloneSettingsValue(profile.settings[key]);
    const result = applySettingsPatch(patch, {preferenceScope: "book"});
    return Object.assign(result, {sourceBook: profile.bookId, targetBook: currentBookId, crossBook: profile.bookId !== currentBookId,
      categories: preview.categories, profileId: profile.id, profileName: profile.name,
      preferenceScope: "book", preferenceFields: preview.preferenceFields, ownershipChanges: preview.ownershipChanges});
  }
  /** 内置起点仅包含计划/曲线；读取不改个人方案目录，也不覆盖范围、显示或操作。 */
  function getBuiltinSettingsProfiles(){
    return [
      {id: "builtin_daily", name: "日常均衡", dailyNew: 20, dailyReviewCap: 100, groupSize: 30, rhythm: "balanced"},
      {id: "builtin_light", name: "轻量稳步", dailyNew: 10, dailyReviewCap: 60, groupSize: 20, rhythm: "light"}
    ].map(item => {
      const settings = {};
      for (const key of settingsFieldsForCategories(["plan", "rhythm"])) settings[key] = cloneSettingsValue(DEF.settings[key]);
      settings.dailyNew = item.dailyNew; settings.dailyReviewCap = item.dailyReviewCap; settings.groupSize = item.groupSize;
      settings.stages = STAGE_PRESETS[item.rhythm].stages.slice(); settings.relearn = STAGE_PRESETS[item.rhythm].relearn;
      settings.stagePreset = item.rhythm;
      return {id: item.id, name: item.name, bookId: currentBookId, categories: ["plan", "rhythm"], settings: settings, createdAt: 1, updatedAt: 1};
    });
  }
  function exportSettingsProfiles(ids){
    const stored = readSettingsProfiles(); if (!stored.ok) return stored;
    if (ids !== undefined && (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(id => !stored.profiles.some(p => p.id === id)))) return settingsProfileFail("请选择有效的方案");
    const profiles = ids === undefined ? stored.profiles : stored.profiles.filter(p => ids.includes(p.id));
    if (!profiles.length) return settingsProfileFail("还没有可导出的方案");
    return {ok: true, envelope: {kind: SETTINGS_PROFILES_KIND, version: 1, profiles: cloneSettingsValue(profiles)}};
  }
  function prepareSettingsProfilesImport(value){
    const incoming = parseSettingsProfilesEnvelope(value); if (!incoming.ok) return incoming;
    if (!incoming.profiles.length) return settingsProfileFail("配置文件没有方案");
    const stored = readSettingsProfiles(); if (!stored.ok) return stored;
    const added = [], skipped = [];
    for (const profile of incoming.profiles) {
      const old = stored.profiles.find(p => p.id === profile.id);
      if (old) {
        if (settingsProfileSame(old, profile)) { skipped.push(profile); continue; }
        return settingsProfileFail("方案标识冲突：" + profile.name + "；请先在原设备复制并命名后再导入");
      }
      if (stored.profiles.some(p => p.name.toLocaleLowerCase() === profile.name.toLocaleLowerCase())) return settingsProfileFail("已有同名方案：" + profile.name + "；请先重命名后再导入");
      added.push(profile);
    }
    if (stored.profiles.length + added.length > SETTINGS_PROFILES_MAX) return settingsProfileFail("导入后超过 30 个方案，请先删除不再使用的方案");
    return {ok: true, added: cloneSettingsValue(added), skipped: cloneSettingsValue(skipped), count: added.length,
      profiles: stored.profiles.concat(added), raw: stored.raw};
  }
  function importSettingsProfiles(value){
    const prepared = prepareSettingsProfilesImport(value); if (!prepared.ok) return prepared;
    if (!prepared.added.length) return {ok: true, count: 0, skipped: prepared.skipped, profiles: prepared.profiles};
    const result = writeSettingsProfiles(prepared.profiles, prepared.raw);
    return Object.assign(result, result.ok ? {count: prepared.count, added: prepared.added, skipped: prepared.skipped} : {});
  }
  // 与既有 __vocab 同为可检查钩子；对外只给副本，不暴露方案目录的可变缓存。
  window.__vocabSettingsProfiles = {
    key: SETTINGS_PROFILES_KEY, kind: SETTINGS_PROFILES_KIND, max: SETTINGS_PROFILES_MAX,
    getCatalog: () => cloneSettingsValue(SETTINGS_CATALOG), getCategories: () => cloneSettingsValue(SETTINGS_CATEGORIES),
    getBuiltinSettingsProfiles, readSettingsProfiles, saveSettingsProfile, renameSettingsProfile, duplicateSettingsProfile, deleteSettingsProfile,
    previewSettingsPatch, applySettingsPatch, previewSettingsProfile, applySettingsProfile,
    exportSettingsProfiles, prepareSettingsProfilesImport, importSettingsProfiles
  };

  /* ================= 设置 ================= */
  /* 学习配置工作台：独立界面偏好；不写学习进度或会话快照。 */
  const WORKSPACE_PREFS_KEY = "vocab_settings_workspace_v1";
  const QUICK_KEYS = ["dailyNew", "groupSize", "dailyReviewCap", "autoResume", "fontSize", "autoSpk",
    "theme", "showPh", "showEx", "showFm", "speechRate", "backlogGuard", "order", "singleCharKeys"];
  const QUICK_DEFAULTS = QUICK_KEYS.slice(0, 6);
  let workspacePane = "quick", workspaceImportRaw = null, workspaceImportSequence = 0;
  function workspacePrefs(){
    try {
      const raw = localStorage.getItem(WORKSPACE_PREFS_KEY);
      if (raw === null) return {ok: true, pins: QUICK_DEFAULTS.slice()};
      const p = JSON.parse(raw);
      if (!p || p.version !== 1 || !Array.isArray(p.pins) || p.pins.length > QUICK_KEYS.length
          || new Set(p.pins).size !== p.pins.length || p.pins.some(k => !QUICK_KEYS.includes(k))) throw Error();
      return {ok: true, pins: p.pins.slice()};
    } catch (e) { return {ok: false, pins: QUICK_DEFAULTS.slice()}; }
  }
  function workspaceStatus(text, error = false){
    const el = $("#workspaceStatus");
    if (el) {
      el.textContent = text || ""; el.dataset.error = error ? "true" : "false";
      const r=el.getBoundingClientRect?.();
      if(text && activeSheet?.id === "settingsWorkspaceSheet" && r && (r.bottom<60 || r.top>window.innerHeight))toast(text);
    }
  }
  function settingLabel(key){ return SETTINGS_CATALOG.find(x => x.key === key)?.label || key; }
  function settingsValueText(key, value){
    if (typeof value === "boolean") return value ? "开启" : "关闭";
    if (key === "dailyReviewCap" && value === 0) return "不限";
    if (key === "fmax" && value === 0) return "不限";
    if (key === "stages") return value.map(formatMinutes).join(" / ");
    if (key === "relearn") return formatMinutes(value);
    if (key === "autoResume") return value.enabled
      ? value.threshold + " 张 / 等待 " + value.idleMs / 1000 + " 秒 / 倒计时 " + value.countdownMs / 1000 + " 秒" : "关闭";
    if (key === "pos") return value.length ? value.map(k => (POSCHIPS.find(c => c.k === k) || {}).t || k).join("、") : "不限";
    if (key === "keys") return Object.keys(value).map(k => keyName(value[k])).join(" / ");
    if (key === "actionKeys") return Object.entries(value).map(([action,binding]) => (STUDY_ACTION_LABELS[action] || action) + "：" + (binding ? keyName(binding) : "未绑定")).join("；");
    if (key === "gestures") {
      const name=action=>action==="none"?"不操作":STUDY_ACTION_LABELS[action] || action;
      return (value.enabled?"开启":"关闭，保留映射")+"；回忆左"+name(value.recall.left)+" / 右"+name(value.recall.right)+"；判定后左"+name(value.revealed.left)+" / 右"+name(value.revealed.right);
    }
    if (key === "actionLayout") return {standard:"标准布局",left:"左手布局",right:"右手布局"}[value] || String(value);
    if (key === "voiceURI") return value || "设备自动选择";
    const enums = {order:{shuffle:"随机乱序",freq:"按词频",wrong:"错词优先"},theme:{light:"浅色",dark:"深色",auto:"跟随系统"},fontSize:{standard:"标准",large:"大字"},posMode:{primary:"主要词性",all:"全部词性"}};
    return enums[key]?.[value] || String(value);
  }
  function pendingSettingsDetails(){
    const p = mainSessionPlan();
    if (!p || p.bookId !== currentBookId) return [];
    const before = parseScopeSig(p.scopeSig);
    if (!before) return [];
    const rows = [];
    for (const key of ["dailyNew","order","fmin","fmax","pmin","kyOnly","pos","posMode","groupSize","backlogGuard"]) {
      if (before[key] !== undefined && JSON.stringify(before[key]) !== JSON.stringify(S.settings[key]))
        rows.push({key, label: settingLabel(key), before: before[key], after: S.settings[key], effect: "next"});
    }
    const cfg = currentStageConfig();
    if (Array.isArray(p.stagesMs) && JSON.stringify(p.stagesMs) !== JSON.stringify(cfg.stages.map(n => n * MINUTE_MS)))
      rows.push({key:"stages", label:settingLabel("stages"), before:p.stagesMs.map(n=>n/MINUTE_MS), after:cfg.stages, effect:"next"});
    if (p.relearnMs !== cfg.relearn * MINUTE_MS)
      rows.push({key:"relearn", label:settingLabel("relearn"), before:p.relearnMs/MINUTE_MS, after:cfg.relearn, effect:"next"});
    return rows;
  }
  function diffRowsHtml(rows){
    return '<ul class="config-diff">' + rows.map(d => '<li><span>' + esc(d.label)
      + '</span><span>' + esc(settingsValueText(d.key,d.before)) + ' → <b>' + esc(settingsValueText(d.key,d.after))
      + '</b><small>' + (d.effect === "next" ? "下一组" : "立即") + '</small></span></li>').join("") + '</ul>';
  }
  function renderQuickPending(){
    const el = $("#quickPendingDiff");
    if (!el) return;
    const rows = pendingSettingsDetails();
    const active = mainGroupActiveForSettings();
    el.innerHTML = rows.length ? '<p>' + (active ? '本组保持原计划；以下更改从下一组生效：' : '本组已结束；下一组将使用以下更改：') + '</p>' + diffRowsHtml(rows)
      : '<p>' + (active ? '当前组与已保存计划一致。更改计划不会打断当前卡。' : '当前没有进行中的组；计划将在下次开始时使用。') + '</p>';
    const conflict = autoResumeConfigConflict(currentAutoResume());
    if (conflict) {
      const note = document.createElement("p"); note.className="workspace-warning";
      note.textContent = "自动续背设置需要调整：" + conflict;
      const locate = document.createElement("button"); locate.type="button"; locate.className="text-action";
      locate.textContent="调整等待阈值"; locate.onclick=()=>focusSetting("#autoResumeThreshold");
      const quick = document.createElement("button"); quick.type="button"; quick.className="text-action";
      quick.textContent="改用便捷续背";
      quick.onclick=()=>{const r=applySettingsPatch({autoResume:{enabled:true,threshold:1,idleMs:30000,countdownMs:3000}});workspaceStatus(r.ok?"已改用便捷续背"+(autoResumePausedToday()?"；今天的暂停仍保留。":"。"):r.error,!r.ok);if(r.ok){renderQuickSettings();($("#quick-autoResume")||$("#workspaceQuickTab"))?.focus?.({preventScroll:true});}};
      note.appendChild(locate); note.appendChild(quick); el.appendChild(note);
    }
    if (autoResumePausedToday()) {
      const note = document.createElement("p");
      note.textContent = "今天已暂停自动续背；切换方案仍保留这次暂停。";
      if (currentAutoResume().enabled) {
        const b = document.createElement("button"); b.type="button"; b.className="text-action";
        b.textContent="恢复今天自动续背";
        b.onclick=()=>{restoreAutoResumeToday();renderQuickPending();};
        note.appendChild(b);
      }
      el.appendChild(note);
    }
  }
  function syncOpenWorkspaceFields(){
    if (activeSheet?.id !== "settingsWorkspaceSheet") return;
    if (workspacePane === "quick") {
      if (document.activeElement?.dataset?.quickKey) workspaceStatus("另一页面更新了配置；正在编辑的输入已保留，提交时只应用这一项。");
      $$("[data-quick-key]").forEach(el=>{
        if (el === document.activeElement) return;
        const key=el.dataset.quickKey, value=S.settings[key];
        if(el.type === "checkbox")el.checked=!!value;
        else if(key === "autoResume") {
          el.value="keep";if(el.options?.[0])el.options[0].textContent=value.enabled?"已开启，保留参数":"关闭";
          const summary=el.closest?.("label")?.querySelector?.(".quick-ar-summary");
          if(summary){summary.hidden=!value.enabled;summary.textContent=settingsValueText(key,value);}
        }
        else el.value=String(value);
      });
      renderQuickPending();
    } else if (!document.activeElement?.closest?.(".profile-edit")) renderSettingsProfiles();
  }
  function quickInputHtml(key){
    const s = S.settings, v = s[key];
    const attr = ' data-quick-key="' + key + '" id="quick-' + key + '"';
    const select = opts => '<select' + attr + '>' + opts.map(([val,label]) => '<option value="' + esc(val) + '"'
      + (String(v) === String(val) ? ' selected' : '') + '>' + esc(label) + '</option>').join("") + '</select>';
    if (key === "autoResume") return '<select' + attr + '><option value="keep">' + (v.enabled ? '已开启，保留参数' : '关闭')
      + '</option><option value="enabled">开启，沿用原参数</option><option value="off">关闭</option><option value="quick">便捷：1 张 / 30 秒 / 3 秒</option></select>';
    if (key === "fontSize") return select([["standard","标准"],["large","大字"]]);
    if (key === "theme") return select([["light","浅色"],["dark","深色"],["auto","跟随系统"]]);
    if (key === "order") return select([["shuffle","随机乱序"],["freq","按词频"],["wrong","错词优先"]]);
    if (typeof v === "boolean") return '<input type="checkbox" role="switch"' + attr + (v ? ' checked' : '') + '>';
    const lim = {dailyNew:[1,500,1],groupSize:[1,100,1],dailyReviewCap:[0,1000,1],speechRate:[0.5,1.5,0.01]}[key];
    return '<input type="number"' + attr + ' value="' + v + '" min="' + lim[0] + '" max="' + lim[1] + '" step="' + lim[2] + '" inputmode="decimal">';
  }
  function renderQuickSettings(){
    const root = $("#quickSettingsFields"), choices = $("#quickPinsChoices");
    if (!root || !choices) return;
    const prefs = workspacePrefs();
    root.innerHTML = prefs.pins.map(key => '<label class="quick-field" for="quick-' + key + '"><span>' + esc(settingLabel(key))
      + '<small>' + (SETTINGS_CATALOG.find(x=>x.key===key)?.effect === "next" ? "下一组生效" : "立即生效")
      + (key === "dailyReviewCap" ? " · 0 为不限" : "") + '</small>'
      + (key === "autoResume" ? '<small class="quick-ar-summary"' + (S.settings.autoResume.enabled?'':' hidden') + '>' + esc(settingsValueText(key,S.settings.autoResume)) + '</small>' : '')
      + '</span>' + quickInputHtml(key) + '</label>').join("")
      || '<p class="sheet-note">还没有固定项。在下方选择你常用的设置。</p>';
    choices.innerHTML = QUICK_KEYS.map(key => '<label><input type="checkbox" data-quick-pin="' + key + '"'
      + (prefs.pins.includes(key) ? ' checked' : '') + '>' + esc(settingLabel(key)) + '</label>').join("");
    if (!prefs.ok) workspaceStatus("常用项偏好无法读取，已临时显示默认项；原记录保留。", true);
    renderQuickPending();
  }
  function quickSettingsChanged(el){
    const key = el.dataset.quickKey;
    let val = el.type === "checkbox" ? el.checked : el.value;
    if (["dailyNew","groupSize","dailyReviewCap","speechRate"].includes(key)) val = el.value.trim() === "" ? NaN : Number(el.value);
    if (key === "autoResume") {
      if (val === "keep") return;
      val = val === "quick" ? {enabled:true,threshold:1,idleMs:30000,countdownMs:3000}
        : Object.assign({}, S.settings.autoResume, {enabled: val === "enabled"});
    }
    const result = applySettingsPatch({[key]:val});
    workspaceStatus(result.ok ? "已保存 · " + (SETTINGS_CATALOG.find(x=>x.key===key)?.effect === "next" ? "下一组生效，本组保持" : "立即生效") : result.error, !result.ok);
    if (result.ok) {
      el.removeAttribute?.("aria-invalid");
      if(key === "autoResume"){renderQuickSettings();$("#quick-autoResume")?.focus?.({preventScroll:true});}
      renderQuickPending();renderSettingsProfiles();
    }
    else el.setAttribute?.("aria-invalid","true");
  }
  function refreshSettingsWorkspace(previous, changes){
    bindSet();
    applyActionLayout(); applyActionBindingHints();
    autoResumeCheckCache = null;
    renderGroupSurfaces(); renderCapSurfaces();
    if (changes.some(x => ["showPh","showEx","showFm","fontSize","keys","singleCharKeys",
      "cardDensity","readingOrder","showCardMeta","showCardStage","showCardPos","secondaryActions","actionLayout"].includes(x.key))) {
      const readingOverlay = activeSheet || ($("#exPop") && !$("#exPop").hidden);
      if(readingOverlay)sharedCardRefreshPending=currentBookId;
      else if ($("#v-study")?.classList.contains("on")) renderCard();
      if (detailWord != null && !readingOverlay) renderWordDetail();
    }
    if ($("#v-stats")?.classList.contains("on")) renderStats();
    renderQuickPending(); renderSettingsProfiles();
  }
  function workspaceCategories(container, attr, defaults){
    const el = $(container); if (!el) return;
    el.innerHTML = SETTINGS_CATEGORIES.map(c => '<label><input type="checkbox" ' + attr + '="' + c.id + '"'
      + (defaults.includes(c.id) ? ' checked' : '') + '>' + esc(c.label) + '</label>').join("");
  }
  function chosenProfileCategories(){ return $$("[data-profile-apply-category]").filter(x=>x.checked).map(x=>x.dataset.profileApplyCategory); }
  function allWorkspaceProfiles(){
    const r = readSettingsProfiles();
    return {ok:r.ok, error:r.error, profiles:[...getBuiltinSettingsProfiles(), ...(r.ok ? r.profiles : [])]};
  }
  function renderSettingsProfiles(){
    const el = $("#settingsProfilesList"); if (!el) return;
    const activeProfile = document.activeElement?.closest?.(".profile-card")?.dataset.profileId;
    const r = allWorkspaceProfiles(), selected = chosenProfileCategories();
    el.innerHTML = (!r.ok ? '<p class="workspace-error">' + esc(r.error) + '</p>' : '') + r.profiles.map(p => {
      const cats = p.categories.filter(c=>selected.includes(c));
      const preview = previewSettingsProfile(p,cats), builtin = p.id.startsWith("builtin_");
      return '<article class="profile-card" data-profile-id="' + esc(p.id) + '"><div class="profile-heading"><h3>' + esc(p.name)
        + '</h3><span>' + esc((BOOKS[p.bookId] || {}).name || p.bookId) + (builtin ? " · 内置" : "") + '</span></div>'
        + (preview.ok ? '<p class="sheet-note">应用到' + esc(currentBook().name) + ' · 范围匹配 ' + preview.scopeCount + ' 词 · '
          + (preview.changes.length ? preview.changes.length + ' 项变化' : '配置值已一致')
          + (preview.preferenceFields.length ? ' · 仅应用本书，界面偏好设为本书单独' : ' · 仅应用本书') + '</p>'
          + (preview.changes.length ? '<details class="profile-changes"><summary>查看差异与生效时间</summary>' + diffRowsHtml(preview.changes) + '</details>' : '')
          : '<p class="workspace-error">' + esc(preview.error) + '</p>')
        + '<div class="profile-actions"><button type="button" class="btn primary sm" data-profile-apply="' + esc(p.id) + '"'
        + (!preview.ok ? ' disabled' : '') + '>应用所选类别</button>'
        + (!builtin ? '<button type="button" class="btn ghost sm" data-profile-edit="' + esc(p.id) + '">管理</button>' : '')
        + '</div><div class="profile-edit" data-profile-edit-box="' + esc(p.id) + '" hidden><label>新名称<input type="text" maxlength="40" value="' + esc(p.name) + '"></label><button type="button" class="btn ghost sm" data-profile-rename="' + esc(p.id) + '">保存名称</button><button type="button" class="btn ghost sm" data-profile-copy="' + esc(p.id) + '">另存副本</button><button type="button" class="btn ghost sm" data-profile-update="' + esc(p.id) + '">用当前配置更新</button><button type="button" class="btn ghost sm" data-profile-delete="' + esc(p.id) + '">删除</button></div></article>';
    }).join("");
    if (activeProfile) $('#settingsProfilesList [data-profile-id="' + activeProfile + '"] [data-profile-apply]')?.focus?.({preventScroll:true});
  }
  function showWorkspacePane(pane){
    workspacePane = pane;
    for (const [name,id] of [["quick","workspaceQuick"],["profiles","workspaceProfiles"]]) {
      const tab = $("#" + id + "Tab"), panel = $("#" + id);
      if (panel) panel.hidden = pane !== name;
      if (tab) { tab.setAttribute("aria-selected",String(pane===name)); tab.tabIndex=pane===name?0:-1; }
    }
    if (pane === "quick") renderQuickSettings(); else renderSettingsProfiles();
  }
  function openSettingsWorkspace(pane = "quick"){
    workspaceStatus(""); workspaceImportRaw = null;
    if ($("#profilesImportPreview")) $("#profilesImportPreview").hidden = true;
    showWorkspacePane(pane); openSheet("#settingsWorkspaceSheet");
  }
  function focusSetting(target){
    if (activeSheet) closeSheet();
    show("set");
    const root = $(target); if (!root) return false;
    const el = root.matches?.("input,select,button") ? root : root.querySelector?.("input,select,button") || root;
    let parent = el.parentElement;
    while (parent) { if (parent.tagName === "DETAILS") parent.open = true; parent = parent.parentElement; }
    const section = el.closest?.(".settings-section");
    if (!el.matches?.("input,select,button,[tabindex]")) el.tabIndex = -1;
    el.scrollIntoView?.({block:"center",behavior:"auto"}); el.focus?.({preventScroll:true});
    section?.classList.add("settings-located"); setTimeout(()=>section?.classList.remove("settings-located"),1500);
    if ($( "#settingsSearchResults")) $("#settingsSearchResults").hidden = true;
    return true;
  }
  function renderSettingsSearch(){
    const query = ($("#settingsSearch")?.value || "").trim().toLowerCase(), root = $("#settingsSearchResults");
    if (!root) return;
    root.hidden = !query; if (!query) { root.innerHTML = ""; return; }
    const rows = SETTINGS_CATALOG.filter(x=>(x.label+" "+x.search+" "+x.key).toLowerCase().includes(query));
    root.innerHTML = rows.length ? rows.map(x=>'<button type="button" data-setting-target="' + esc(x.target) + '"><span>'
      + esc(x.label) + '</span><small>' + (x.effect === "next" ? "下一组生效" : "立即生效") + '</small></button>').join("")
      : '<p>没有找到。试试“语音”“词频”或“快捷键”。</p>';
  }
  async function previewProfilesFile(file){
    const sequence = ++workspaceImportSequence;
    workspaceImportRaw = null;
    $("#profilesImportPreview").hidden = true;
    try {
      if (file.size > 524288) throw Error("方案文件过大，最多 512 KB");
      const raw = await file.text();
      if (sequence !== workspaceImportSequence) return;
      const r = prepareSettingsProfilesImport(raw);
      if (!r.ok) throw Error(r.error);
      workspaceImportRaw = raw;
      $("#profilesImportSummary").textContent = "新增 " + r.added.length + " 个方案，跳过 " + r.skipped.length
        + " 个相同方案。只加入方案库，不应用设置或替换进度。"
        + r.added.map(p => p.name + "（" + ((BOOKS[p.bookId] || {}).name || p.bookId) + "）").join("、");
      $("#profilesImportPreview").hidden = false;
      workspaceStatus("请核对方案后确认导入。");
    } catch (e) {
      if (sequence === workspaceImportSequence) workspaceStatus(e.message || "方案文件无法读取", true);
    } finally {
      if (sequence === workspaceImportSequence) $("#profilesFile").value = "";
    }
  }
  function initSettingsWorkspace(){
    if (!$("#settingsWorkspaceSheet")) return;
    workspaceCategories("#profileApplyCategories","data-profile-apply-category",SETTINGS_CATEGORIES.map(x=>x.id));
    workspaceCategories("#profileSaveCategories","data-profile-save-category",["plan","scope","rhythm"]);
    $("#btnQuickSettings").onclick=()=>openSettingsWorkspace("quick");
    for (const id of ["#btnStudyProfiles","#btnSettingsProfiles"]) $(id).onclick=()=>openSettingsWorkspace("profiles");
    for (const [pane,id] of [["quick","#workspaceQuickTab"],["profiles","#workspaceProfilesTab"]]) {
      $(id).onclick=()=>showWorkspacePane(pane);
      $(id).onkeydown=e=>{if (["ArrowLeft","ArrowRight","Home","End"].includes(e.key)) {e.preventDefault(); const p = e.key==="Home"?"quick":e.key==="End"?"profiles":pane==="quick"?"profiles":"quick";showWorkspacePane(p);$(p==="quick"?"#workspaceQuickTab":"#workspaceProfilesTab").focus();}};
    }
    $("#quickSettingsFields").onchange=e=>{if(e.target.dataset.quickKey)quickSettingsChanged(e.target);};
    $("#quickPinsChoices").onchange=e=>{
      if (!e.target.dataset.quickPin) return;
      if (!workspacePrefs().ok) {e.target.checked=!e.target.checked;workspaceStatus("常用项原记录无法读取，暂不能覆盖。",true);return;}
      try {const key=e.target.dataset.quickPin,pins=new Set(workspacePrefs().pins);if(e.target.checked)pins.add(key);else pins.delete(key);localStorage.setItem(WORKSPACE_PREFS_KEY,JSON.stringify({version:1,pins:QUICK_KEYS.filter(k=>pins.has(k))}));renderQuickSettings();$('#quickPinsChoices [data-quick-pin="'+key+'"]').focus?.({preventScroll:true});}
      catch(err){e.target.checked=!e.target.checked;workspaceStatus("常用项保存失败，本次选择未保存。",true);}
    };
    $("#workspaceAllSettings").onclick=()=>{closeSheet();show("set");$("#settingsSearch").focus?.();};
    $("#settingsSearch").oninput=renderSettingsSearch;
    $("#settingsSearch").onkeydown=e=>{if(e.key==="ArrowDown"||e.key==="Enter"){const b=$("#settingsSearchResults button");if(b){e.preventDefault();b.focus();}}else if(e.key==="Escape"){$("#settingsSearchResults").hidden=true;}};
    $("#settingsSearchResults").onclick=e=>{const b=e.target.closest?.("[data-setting-target]");if(b)focusSetting(b.dataset.settingTarget);};
    $("#settingsAdvancedToggle").onclick=()=>{const open=$("#settingsAdvancedToggle").getAttribute("aria-pressed")!=="true";$$("#v-set .settings-advanced").forEach(x=>x.open=open);$("#settingsAdvancedToggle").setAttribute("aria-pressed",String(open));$("#settingsAdvancedToggle").textContent=open?"收起高级设置":"展开高级设置";};
    $("#profileApplyCategories").onchange=renderSettingsProfiles;
    $$("[data-reset-simple]").forEach(b=>{b.onclick=()=>{
      const patch={};SETTINGS_CATALOG.filter(x=>x.category===b.dataset.resetSimple).forEach(x=>patch[x.key]=cloneSettingsValue(DEF.settings[x.key]));
      const r=applySettingsPatch(patch);toast(r.ok?"已恢复默认"+(b.dataset.resetSimple==="speech"?"发音":"外观")+"，其他类别保持。":r.error);
    };});
    $("#saveSettingsProfile").onclick=()=>{const r=saveSettingsProfile($("#profileName").value,$$("[data-profile-save-category]").filter(x=>x.checked).map(x=>x.dataset.profileSaveCategory));workspaceStatus(r.ok?"已保存当前配置；下次打开方案即可应用。":r.error,!r.ok);if(r.ok){$("#profileName").value="";renderSettingsProfiles();}};
    $("#settingsProfilesList").onclick=e=>{
      const b=e.target.closest?.("button");if(!b)return;
      const id=b.dataset.profileApply||b.dataset.profileDelete||b.dataset.profileEdit||b.dataset.profileRename||b.dataset.profileCopy||b.dataset.profileUpdate;if(!id)return;
      if(b.dataset.profileEdit){const box=b.closest(".profile-card").querySelector(".profile-edit");box.hidden=!box.hidden;if(!box.hidden)box.querySelector("input").focus();return;}
      let r, deleted;
      if(b.dataset.profileApply){const p=allWorkspaceProfiles().profiles.find(x=>x.id===id);if(!p){workspaceStatus("此方案已在另一页面移除，请重新选择。",true);renderSettingsProfiles();return;}r=applySettingsProfile(p,p.categories.filter(c=>chosenProfileCategories().includes(c)));}
      else if(b.dataset.profileDelete){deleted=readSettingsProfiles().profiles.find(x=>x.id===id);r=deleteSettingsProfile(id);}
      else if(b.dataset.profileUpdate){const p=allWorkspaceProfiles().profiles.find(x=>x.id===id);if(!p){workspaceStatus("此方案已在另一页面移除，请重新选择。",true);renderSettingsProfiles();return;}r=saveSettingsProfile(p.name,p.categories,{replaceId:id});}
      else {
        let name=b.closest(".profile-card").querySelector(".profile-edit input").value;
        if(b.dataset.profileCopy){
          const profiles=readSettingsProfiles().profiles,source=profiles.find(x=>x.id===id);
          if(source && name.trim()===source.name){
            const stem=[...source.name].slice(0,32).join("");let n=1;
            do{name=stem+" 副本"+(n===1?"":" "+n);n++;}while(profiles.some(x=>x.name.toLowerCase()===name.toLowerCase()));
          }
        }
        r=b.dataset.profileRename?renameSettingsProfile(id,name):duplicateSettingsProfile(id,name);
      }
      let successText = "方案已保存。";
      if(b.dataset.profileApply) successText = !r.ok ? "" : !r.changes.length ? (r.ownershipChanges?.length ? "方案已应用到本书：所选界面偏好已设为本书单独。" : "方案与当前设置一致。")
        : r.changes.some(x=>x.effect==="next") ? "方案已应用：计划与范围将在下一组生效，即时偏好已经生效。" : "方案已应用，所选偏好立即生效。";
      if (b.dataset.profileApply && r.ok && r.changes.length && r.preferenceFields?.length) successText += "仅影响本书，所选界面偏好已设为本书单独。";
      else if(b.dataset.profileDelete) successText = "已删除方案，可撤销。";
      else if(b.dataset.profileUpdate) successText = "已用当前配置更新方案。";
      else if(b.dataset.profileCopy && r.ok) successText = "已复制为“" + r.profile.name + "”。";
      else if(b.dataset.profileRename) successText = "方案已重命名。";
      workspaceStatus(r.ok ? successText : r.error, !r.ok);
      if(r.ok){renderSettingsProfiles();renderQuickPending();}
      if(r.ok && deleted){const undoButton=document.createElement("button");undoButton.type="button";undoButton.className="text-action";undoButton.textContent="撤销删除";undoButton.onclick=()=>{const restored=importSettingsProfiles({kind:SETTINGS_PROFILES_KIND,version:1,profiles:[deleted]});workspaceStatus(restored.ok?"已恢复方案。":restored.error,!restored.ok);if(restored.ok){renderSettingsProfiles();const restoredButton=$('#settingsProfilesList [data-profile-id="'+deleted.id+'"] [data-profile-apply]');restoredButton?.scrollIntoView?.({block:"center"});restoredButton?.focus?.({preventScroll:true});}};$("#workspaceStatus").appendChild(undoButton);undoButton.scrollIntoView?.({block:"center"});undoButton.focus?.({preventScroll:true});}
    };
    $("#exportProfiles").onclick=()=>{const r=exportSettingsProfiles();if(!r.ok){workspaceStatus(r.error,true);return;}downloadWordBookFile("学习配置方案_"+todayStr()+".json",JSON.stringify(r.envelope,null,2),"application/json;charset=utf-8");workspaceStatus("方案下载已发起，请确认文件保存。进度备份请使用统计页入口。");};
    $("#importProfiles").onclick=()=>$("#profilesFile").click();
    $("#profilesFile").onchange=()=>{const file=$("#profilesFile").files?.[0];if(file)previewProfilesFile(file);};
    $("#confirmProfilesImport").onclick=()=>{if(workspaceImportRaw===null)return;const r=importSettingsProfiles(workspaceImportRaw);workspaceStatus(r.ok?"方案已导入；点击应用后才更改设置。":r.error,!r.ok);if(r.ok){workspaceImportRaw=null;$("#profilesImportPreview").hidden=true;renderSettingsProfiles();$("#importProfiles").focus?.({preventScroll:true});}};
    $("#cancelProfilesImport").onclick=()=>{workspaceImportSequence++;workspaceImportRaw=null;$("#profilesImportPreview").hidden=true;workspaceStatus("已取消导入。");$("#importProfiles").focus?.({preventScroll:true});};
    window.addEventListener?.("storage",e=>{
      if(activeSheet?.id!=="settingsWorkspaceSheet")return;
      if(e.key===SETTINGS_PROFILES_KEY && !document.activeElement?.closest?.(".profile-edit"))renderSettingsProfiles();
      if(e.key===WORKSPACE_PREFS_KEY && !document.activeElement?.closest?.("#quickSettingsFields"))renderQuickSettings();
    });
    window.__vocabWorkspace={getState:()=>({pane:workspacePane,prefs:workspacePrefs(),importPending:workspaceImportRaw!==null}),getPendingDiff:()=>JSON.parse(JSON.stringify(pendingSettingsDetails())),prefsKey:WORKSPACE_PREFS_KEY};
  }

  function inputPreferencesStatus(message, error = false){
    const el = $("#inputPreferencesStatus");
    if(el){el.textContent=message || "";el.dataset.error=String(error);}
    if(error)toast(message);
  }
  function syncInputControls(force = false){
    if(typeof getInputPreferences !== "function" || typeof getGestureActions !== "function")return;
    const p=getInputPreferences(), g=p.gestures;
    const enabled=$("#gesturesEnabled");if(enabled)enabled.checked=g.enabled;
    for(const [phase,side,id] of [["recall","left","gestureRecallLeft"],["recall","right","gestureRecallRight"],["revealed","left","gestureRevealedLeft"],["revealed","right","gestureRevealedRight"]]){
      const select=$("#"+id);if(!select)continue;
      if(!select.dataset.inputOptions){select.innerHTML=getGestureActions(phase).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.label)+'</option>').join("");select.dataset.inputOptions=phase;}
      if(force || select !== document.activeElement)select.value=g[phase][side];
    }
    const label=(phase,side)=>getGestureActions(phase).find(x=>x.id===g[phase][side])?.label || "不执行操作";
    const summary=$("#gestureSummary");if(summary)summary.textContent=(g.enabled?"已开启":"已关闭，映射保留")+" · 回忆时：向左“"+label("recall","left")+"”，向右“"+label("recall","right")+"”；判定后：向左“"+label("revealed","left")+"”，向右“"+label("revealed","right")+"”。";
    $$("[data-gesture-preset]").forEach(b=>{const standard=b.dataset.gesturePreset==="standard";b.setAttribute?.("aria-pressed",String(g.recall.left===(standard?"dont":"know")&&g.recall.right===(standard?"know":"dont")));});
    $$("[data-action-layout]").forEach(b=>b.setAttribute?.("aria-pressed",String(p.actionLayout===b.dataset.actionLayout)));
  }
  function applyInputControlsPatch(patch){
    const r=applySettingsPatch(patch);
    inputPreferencesStatus(r.ok?"已保存，操作偏好立即生效；当前学习组保持。":r.error,!r.ok);
    if(r.ok){syncInputControls(true);applyActionLayout();}
    return r;
  }
  function initInputControls(){
    if(!$("#gesturesEnabled") || typeof getInputPreferences !== "function")return;
    syncInputControls();
    $("#gesturesEnabled").onchange=e=>{const g=getInputPreferences().gestures;g.enabled=e.target.checked;applyInputControlsPatch({gestures:g});};
    $$("[data-gesture-preset]").forEach(b=>{b.onclick=()=>{const g=getInputPreferences().gestures;g.recall=b.dataset.gesturePreset==="standard"?{left:"dont",right:"know"}:{left:"know",right:"dont"};applyInputControlsPatch({gestures:g});};});
    for(const [phase,side,id] of [["recall","left","gestureRecallLeft"],["recall","right","gestureRecallRight"],["revealed","left","gestureRevealedLeft"],["revealed","right","gestureRevealedRight"]]){
      const el=$("#"+id);if(el)el.onchange=()=>{const g=getInputPreferences().gestures;g[phase][side]=el.value;applyInputControlsPatch({gestures:g});};
    }
    $$("[data-action-layout]").forEach(b=>{b.onclick=()=>applyInputControlsPatch({actionLayout:b.dataset.actionLayout});});
    const resets=$("#inputResetChoices");
    if(resets){
      resets.innerHTML=getInputActionDescriptors().map(x=>'<button type="button" class="btn ghost sm" data-input-reset="'+esc(x.id)+'">恢复“'+esc(x.label)+'”</button>').join("");
      resets.onclick=e=>{const b=e.target.closest?.("[data-input-reset]");if(!b)return;const r=resetInputBinding(b.dataset.inputReset);inputPreferencesStatus(r.ok?"已恢复此项，其他按键和开关保持。":r.error,!r.ok);};
    }
  }

  /* ================= F1 阅读与布局定制 =================
   * 只改呈现：卡片密度、判定后主体顺序、卡片次要标签、固定次级动作与「更多操作」。
   * 全部立即生效；不 startSession、不重建当前组、不清撤销/快照/特判/子组；
   * 不改变 TXT/打印的扁平内容、字号档位或动作区高度常量。
   * 统计页 6 个 details 的展开偏好写独立设备键 STATS_PANELS_KEY（不进备份/进度签名）。
   */
  const READING_ORDER_LABELS = Object.freeze({meaning: "释义", example: "例句", forms: "词形变化"});
  const SECONDARY_ACTION_LABELS = Object.freeze({undo: "撤销", proficient: "熟练", speak: "发音", star: "收藏"});
  function readingOrderLabel(key){ return READING_ORDER_LABELS[key] || String(key); }
  function currentReadingOrder(){ return normalizeReadingOrder(S.settings.readingOrder); }
  function currentSecondaryActions(){ return normalizeSecondaryActions(S.settings.secondaryActions); }
  function currentActionLayout(){
    return ["left","right"].includes(S.settings.actionLayout) ? S.settings.actionLayout : "standard";
  }
  /** 卡片元信息（词频/套卷/书源）：详情页不经过这里，始终保留完整元信息。 */
  function cardMetaHtml(x){
    if (!S.settings.showCardMeta) return "";
    let h = '<div class="tagrow">';
    h += '<span class="tag">词频 #' + x.r + "</span>";
    h += '<span class="tag">' + x.f + " 次 / " + x.c + " 套卷</span>";
    if (x.ky) h += '<span class="tag ky">' + esc(currentBook().tagLabel) + "</span>";
    h += wordBookTags(x.w);
    h += "</div>";
    return h;
  }
  function cardStageHtml(stage){
    return S.settings.showCardStage ? dotsHtml(stage) : "";
  }
  function cardPosHtml(x){
    return S.settings.showCardPos ? '<div class="posline">' + esc(poslineText(x)) + "</div>" : "";
  }
  /** 判定后主体：按 readingOrder 全排列渲染；缺内容自然跳过，回忆阶段不调用。 */
  function cardAnswerBodyHtml(x){
    const blocks = new Map();
    const mean = meaningHtml(x);
    if (mean) blocks.set("meaning", '<div class="mean">' + mean + "</div>");
    if (S.settings.showEx && x.ex) {
      blocks.set("example",
        '<div class="ex" lang="en" data-ex-linked="1" tabindex="0" role="group" aria-expanded="false" aria-label="例句，左右方向键选词，回车查义">'
        + exHtml(x.ex, x) + '<span class="src" lang="zh-CN">— ' + esc(srcBadge(x.src)) + "</span></div>");
    } else if (S.settings.showEx) {
      blocks.set("example", '<div class="ex ex-empty">暂无例句，可先记住释义与词形。</div>');
    }
    if (S.settings.showFm && x.fm) {
      blocks.set("forms", '<details class="answer-extra"><summary>词形变化</summary><div class="fm">' + esc(x.fm) + "</div></details>");
    }
    return currentReadingOrder().map(key => blocks.get(key) || "").join("");
  }
  /** 固定次级动作按钮：保留原 id/动作入口，插槽顺序由 secondaryActions + actionLayout 决定。 */
  function secondaryActionButtonHtml(id, slot){
    const cls = "btn ghost sm acts-secondary-btn slot-" + slot;
    if (id === "undo") {
      return '<button type="button" class="' + cls + '" id="undoBtn" data-secondary="undo" title="Ctrl/Cmd+Z">撤销</button>';
    }
    if (id === "proficient") {
      return '<button type="button" class="btn proficient acts-secondary-btn slot-' + slot + '" id="markProficient" data-secondary="proficient" title="熟练词今后不再进入背诵或复习">熟练<kbd>' + esc(keyName(S.settings.keys.proficient)) + "</kbd></button>";
    }
    if (id === "speak") {
      return '<button type="button" class="' + cls + '" id="actsSpeak" data-secondary="speak" aria-label="发音" title="发音（' + esc(keyName(S.settings.keys.speak)) + '）">发音<kbd>' + esc(keyName(S.settings.keys.speak)) + "</kbd></button>";
    }
    return '<button type="button" class="' + cls + '" id="actsStar" data-secondary="star" aria-label="' + (isStar(cur) ? "取消收藏" : "收藏") + '" aria-pressed="' + isStar(cur) + '" title="收藏（' + esc(keyName(S.settings.keys.star)) + '）">★ ' + (isStar(cur) ? "已收藏" : "收藏") + "</button>";
  }
  /** 更多操作里的入口：只放当前未固定的撤销/熟练；发音与收藏始终有卡片图标，不重复搬两套。 */
  function moreSecondaryActionHtml(id){
    if (id === "undo") {
      return '<button type="button" class="btn ghost sm" id="undoBtn" data-secondary="undo" title="Ctrl/Cmd+Z">撤销上一步</button>';
    }
    return '<button type="button" class="btn ghost sm" id="markProficient" data-secondary="proficient" title="熟练词今后不再进入背诵或复习">熟练<kbd>' + esc(keyName(S.settings.keys.proficient)) + "</kbd></button>";
  }
  /** 判定后第三行：固定次级动作始终占原槽位；未固定的撤销/熟练由「更多操作」可达。
   *  固定满 2 个时「更多」缩为同一行的 44px 触发，展开内容为绝对定位浮层，
   *  任何组合都不增加 #acts 行高（151/156/146px 契约）。 */
  function secondaryActionsRowHtml(){
    const fixed = currentSecondaryActions();
    const ordered = currentActionLayout() === "left" ? fixed.slice().reverse() : fixed.slice();
    const unfixed = ["undo","proficient"].filter(id => !fixed.includes(id));
    const hasMore = unfixed.length > 0;
    const compactMore = hasMore && ordered.length === 2;
    let h = '<div class="acts-secondary" id="actsSecondary" data-secondary-count="' + ordered.length + '"'
      + (hasMore ? ' data-has-more="1"' : "") + ">";
    ordered.forEach((id, i) => { h += secondaryActionButtonHtml(id, i); });
    if (hasMore) {
      const summary = compactMore
        ? '<summary class="acts-more-toggle" aria-label="更多操作" title="更多操作"><span aria-hidden="true">⋯</span></summary>'
        : '<summary class="acts-more-toggle" aria-label="更多操作">更多操作<span aria-hidden="true">⋯</span></summary>';
      h += '<details class="acts-more" id="actsMore">' + summary
        + '<div class="acts-more-menu" role="group" aria-label="未固定的次级动作">'
        + unfixed.map(id => moreSecondaryActionHtml(id)).join("") + "</div></details>";
    }
    h += "</div>";
    return h;
  }
  function bindSecondaryActionButtons(){
    const speakEl = $("#actsSpeak");
    if (speakEl) speakEl.onclick = (e) => { e.stopPropagation?.(); runStudyAction("speak", {event: e, source: "button"}); };
    const starEl = $("#actsStar");
    if (starEl) starEl.onclick = (e) => { e.stopPropagation?.(); runStudyAction("star", {event: e, source: "button"}); };
  }
  /** 左右手布局只换呈现：固定的次级动作随布局换位，DOM 顺序与视觉/Tab 顺序一致。 */
  function orderSecondaryActionsRow(){
    const row = $("#actsSecondary");
    if (!row || typeof row.insertBefore !== "function") return;
    const details = $("#actsMore");
    const fixed = currentSecondaryActions();
    const ordered = currentActionLayout() === "left" ? fixed.slice().reverse() : fixed.slice();
    for (const id of ordered) {
      const btn = $('#actsSecondary [data-secondary="' + id + '"]');
      if (btn && btn.parentNode === row) row.insertBefore(btn, details && details.parentNode === row ? details : null);
    }
  }
  function readStatsPanelPrefs(){
    try {
      const raw = localStorage.getItem(STATS_PANELS_KEY);
      if (raw === null) return {ok: true, open: STATS_PANEL_IDS.slice(), order: STATS_CARD_IDS.slice()};
      const p = JSON.parse(raw);
      if (!isRecord(p) || p.version !== 1 || !Array.isArray(p.open) || p.open.length > STATS_PANEL_IDS.length
          || new Set(p.open).size !== p.open.length || p.open.some(id => !STATS_PANEL_IDS.includes(id))) throw new Error("bad stats panels");
      if (p.order !== undefined && (!Array.isArray(p.order) || p.order.length !== STATS_CARD_IDS.length
          || new Set(p.order).size !== p.order.length || p.order.some(id => !STATS_CARD_IDS.includes(id)))) throw new Error("bad stats order");
      return {ok: true, open: p.open.slice(), order: p.order ? p.order.slice() : STATS_CARD_IDS.slice()};
    } catch (e) { return {ok: false, open: STATS_PANEL_IDS.slice(), order: STATS_CARD_IDS.slice()}; }
  }
  function statsLayoutStatus(message){
    const el = $("#statsLayoutStatus");
    if (el) el.textContent = message || "";
  }
  function statsCardElements(){
    const root = $("#v-stats");
    return root ? Array.from(root.children || []).filter(el => STATS_CARD_IDS.includes(el.id)) : [];
  }
  function statsCardOrder(){
    const ids = statsCardElements().map(el => el.id);
    return ids.length === STATS_CARD_IDS.length ? ids : STATS_CARD_IDS.slice();
  }
  function writeStatsPanelPrefs(open, order){
    // 损坏原文不得因 toggle 或排序而被悄悄覆盖；页面内仍可调整。
    const previous = readStatsPanelPrefs();
    if (!previous.ok) {
      statsLayoutStatus("统计布局原记录无法读取，本次调整仅在本页保留；原记录已保留。");
      return false;
    }
    if (JSON.stringify(previous.open.slice().sort()) === JSON.stringify(open.slice().sort())
        && JSON.stringify(previous.order) === JSON.stringify(order)) return true;
    try { localStorage.setItem(STATS_PANELS_KEY, JSON.stringify({version: 1, open: open, order: order})); return true; }
    catch (e) { return false; }
  }
  /** 新页面默认展开；旧 v1 的 open 名单完整保留，新 order 为同版本可选字段。 */
  function applyStatsPanelPrefs(){
    const prefs = readStatsPanelPrefs();
    for (const panel of $$("#v-stats details.stats-details")) {
      if (panel && STATS_PANEL_IDS.includes(panel.id)) panel.open = prefs.open.includes(panel.id);
    }
    const root = $("#v-stats");
    if (root && statsCardElements().length === STATS_CARD_IDS.length && typeof root.appendChild === "function"
        && JSON.stringify(statsCardOrder()) !== JSON.stringify(prefs.order)) {
      for (const id of prefs.order) root.appendChild($("#" + id));
    }
    syncStatsReorderControls();
    return prefs.ok;
  }
  function persistStatsPanels(){
    const open = $$("#v-stats details.stats-details")
      .filter(panel => panel && panel.open && STATS_PANEL_IDS.includes(panel.id))
      .map(panel => panel.id);
    const saved = writeStatsPanelPrefs(open, statsCardOrder());
    if (!saved && readStatsPanelPrefs().ok) statsLayoutStatus("统计布局未能保存，本次调整仅在本页保留。");
    return saved;
  }
  function syncStatsReorderControls(){
    const order = statsCardOrder();
    $$("#v-stats [data-stats-move]").forEach(button => {
      const pos = order.indexOf(button.dataset.statsPanel);
      button.disabled = button.dataset.statsMove === "up" ? pos <= 0 : pos < 0 || pos === order.length - 1;
    });
  }
  function moveStatsPanel(id, direction){
    if (!STATS_CARD_IDS.includes(id) || !["up", "down"].includes(direction)) return false;
    const root = $("#v-stats"), panels = statsCardElements(), pos = panels.findIndex(el => el.id === id);
    const targetPos = pos + (direction === "up" ? -1 : 1);
    if (!root || pos < 0 || targetPos < 0 || targetPos >= panels.length || typeof root.insertBefore !== "function") return false;
    const target = panels[targetPos];
    if (direction === "up") root.insertBefore(panels[pos], target);
    else root.insertBefore(target, panels[pos]);
    syncStatsReorderControls();
    const saved = persistStatsPanels();
    if (saved) statsLayoutStatus("已调整卡片顺序（第 " + (targetPos + 1) + " / " + panels.length + " 张），下次打开会保留。");
    return true;
  }
  function initStatsPanelOrdering(){
    const root = $("#v-stats");
    if (!root || statsCardElements().length !== STATS_CARD_IDS.length) return;
    let tracking = null, suppressClickUntil = 0, suppressClickHandle = null;
    const closeMenus = (returnFocus = false) => {
      const activeTools = returnFocus ? document.activeElement?.closest?.(".stats-order-tools") : null;
      $$("#v-stats .stats-order-menu").forEach(el => { el.hidden = true; });
      $$("#v-stats .stats-drag-handle").forEach(el => el.setAttribute("aria-expanded", "false"));
      activeTools?.querySelector(".stats-drag-handle")?.focus?.({preventScroll: true});
    };
    const cancel = (commit = false) => {
      if (!tracking) return;
      const t = tracking; tracking = null; clearTimeout(t.timer); clearInterval(t.edgeTimer);
      if (t.active) {
        t.panel.classList.remove("stats-dragging");
        root.classList.remove("stats-sorting");
        try { t.handle.releasePointerCapture?.(t.pointerId); } catch (e) { /* 已释放 */ }
        suppressClickUntil = Date.now() + 700;
        suppressClickHandle = t.handle;
        if (!commit) {
          // Esc、第二指针、切后台等取消应恢复开始拖动前的视觉顺序。
          for (const id of t.original) root.appendChild($("#" + id));
        } else if (persistStatsPanels()) statsLayoutStatus("卡片顺序已保存，下次打开会保留。");
        syncStatsReorderControls();
      }
    };
    const placeAtPointer = t => {
      const cards = statsCardElements().filter(el => el !== t.panel);
      const before = cards.find(el => { const r = el.getBoundingClientRect(); return t.y < r.top + r.height / 2; });
      root.insertBefore(t.panel, before || null);
    };
    for (const panel of statsCardElements()) {
      const heading = panel.querySelector(panel.tagName === "DETAILS" ? "summary" : ".panel-heading");
      if (!heading) continue;
      const name = heading.querySelector("h3")?.textContent || "统计卡片";
      const tools = document.createElement("span"); tools.className = "stats-order-tools";
      tools.innerHTML = '<button type="button" class="stats-drag-handle" data-stats-drag="' + panel.id
        + '" aria-label="排列' + esc(name) + '：长按拖动，或点击选择上移下移" title="长按拖动；点击排列；Alt+↑/↓移动" aria-expanded="false">'
        + '<span aria-hidden="true">⠿</span></button><span class="stats-order-menu" hidden>'
        + '<button type="button" class="btn ghost sm" data-stats-move="up" data-stats-panel="' + panel.id + '">上移</button>'
        + '<button type="button" class="btn ghost sm" data-stats-move="down" data-stats-panel="' + panel.id + '">下移</button></span>';
      heading.appendChild(tools);
      const handle = tools.querySelector(".stats-drag-handle"), menu = tools.querySelector(".stats-order-menu");
      handle.addEventListener("click", e => {
        e.preventDefault(); e.stopPropagation();
        if (e.detail !== 0 && handle === suppressClickHandle && Date.now() < suppressClickUntil) return;
        const show = menu.hidden; closeMenus(); menu.hidden = !show; handle.setAttribute("aria-expanded", String(show));
      });
      tools.addEventListener("click", e => {
        e.preventDefault(); e.stopPropagation();
        const button = e.target.closest?.("[data-stats-move]");
        if (!button || button.disabled) return;
        moveStatsPanel(panel.id, button.dataset.statsMove);
        closeMenus(); handle.focus?.({preventScroll: true});
      });
      handle.addEventListener("keydown", e => {
        if (e.altKey && !e.ctrlKey && !e.metaKey && ["ArrowUp", "ArrowDown"].includes(e.key)) {
          e.preventDefault(); e.stopPropagation();
          moveStatsPanel(panel.id, e.key === "ArrowUp" ? "up" : "down"); handle.focus?.({preventScroll: true});
        }
      });
      handle.addEventListener("pointerdown", e => {
        if (tracking || e.isPrimary === false || (e.button !== undefined && e.button !== 0)) { cancel(); return; }
        closeMenus();
        const t = {panel, handle, pointerId: e.pointerId, x: e.clientX, y: e.clientY, active: false,
          original: statsCardOrder(), timer: null, edgeTimer: null};
        tracking = t;
        t.timer = setTimeout(() => {
          if (tracking !== t || document.visibilityState === "hidden" || !root.classList.contains("on")) { cancel(); return; }
          t.active = true; panel.classList.add("stats-dragging"); root.classList.add("stats-sorting");
          try { handle.setPointerCapture?.(e.pointerId); } catch (error) { /* 窗口已取消 */ }
          statsLayoutStatus("正在排列“" + name + "”，上下拖动后松开保存；Esc 取消。");
          // 长列表靠近视口边缘时持续滚动，用户无需反复挪动手指。
          t.edgeTimer = setInterval(() => {
            if (tracking !== t) return;
            if (!root.classList.contains("on") || document.visibilityState === "hidden") { cancel(); return; }
            const scroller = $("#main"), r = scroller?.getBoundingClientRect?.();
            if (!r) return;
            if (t.y < r.top + 60) { scroller.scrollTop -= 18; placeAtPointer(t); }
            else if (t.y > r.bottom - 60) { scroller.scrollTop += 18; placeAtPointer(t); }
          }, 40);
        }, 420);
      });
    }
    document.addEventListener("pointerdown", e => {
      if (tracking && e.pointerId !== tracking.pointerId) cancel();
      if (!e.target.closest?.(".stats-order-tools")) closeMenus();
    });
    document.addEventListener("pointermove", e => {
      const t = tracking;
      if (!t || e.pointerId !== t.pointerId) return;
      if (!root.classList.contains("on") || document.visibilityState === "hidden") { cancel(); return; }
      if (!t.active) {
        if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 9) cancel();
        return;
      }
      e.preventDefault();
      t.x = e.clientX; t.y = e.clientY; placeAtPointer(t);
    }, {passive: false});
    document.addEventListener("pointerup", e => { if (tracking && e.pointerId === tracking.pointerId) cancel(root.classList.contains("on") && document.visibilityState !== "hidden"); });
    document.addEventListener("pointercancel", () => cancel());
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        if (tracking?.active) { e.preventDefault(); e.stopPropagation(); }
        cancel(); closeMenus(true);
      }
    });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { cancel(); closeMenus(); } });
    window.addEventListener("blur", () => { cancel(); closeMenus(); });
    $("#main")?.addEventListener("scroll", () => { if (tracking && !tracking.active) cancel(); }, {passive: true});
    syncStatsReorderControls();
  }
  function syncReadingLayoutControls(){
    const s = S.settings;
    const density = CARD_DENSITY_VALUES.includes(s.cardDensity) ? s.cardDensity : CARD_DENSITY_DEFAULT;
    $$("#cardDensitySeg [data-card-density]").forEach(b => {
      const on = b.dataset.cardDensity === density;
      b.classList.toggle("on", on);
      b.setAttribute?.("aria-pressed", String(on));
    });
    const order = currentReadingOrder();
    const list = $("#readingOrderList");
    if (list) {
      const focusBefore = document.activeElement;
      const focusedBtn = focusBefore?.closest?.("#readingOrderList [data-order-key]");
      const focusKey = focusedBtn?.dataset?.orderKey, focusDir = focusedBtn?.dataset?.orderDir;
      list.innerHTML = order.map((key, pos) => {
        const label = readingOrderLabel(key);
        const upOff = pos === 0, downOff = pos === order.length - 1;
        return '<div class="reading-order-row" data-order-row="' + key + '">'
          + '<span class="reading-order-pos" aria-hidden="true">' + (pos + 1) + "</span>"
          + '<span class="reading-order-name">' + label + "</span>"
          + '<span class="reading-order-actions">'
          + '<button type="button" class="btn ghost sm" data-order-key="' + key + '" data-order-dir="-1" aria-label="上移' + label + '" title="上移' + label + '"' + (upOff ? ' aria-disabled="true"' : "") + ">↑</button>"
          + '<button type="button" class="btn ghost sm" data-order-key="' + key + '" data-order-dir="1" aria-label="下移' + label + '" title="下移' + label + '"' + (downOff ? ' aria-disabled="true"' : "") + ">↓</button>"
          + "</span></div>";
      }).join("");
      if (focusKey != null) {
        $('#readingOrderList [data-order-key="' + focusKey + '"][data-order-dir="' + focusDir + '"]')?.focus?.({preventScroll: true});
      }
    }
    const summary = $("#readingOrderSummary");
    if (summary) summary.textContent = "当前顺序：" + order.map(readingOrderLabel).join(" → ")
      + "。单词词头始终显示在答案之前；未显示的内容（如关闭例句）自动跳过。";
    for (const id of ["showCardMeta", "showCardStage", "showCardPos"]) {
      const el = $("#" + id);
      if (el) el.checked = !!s[id];
    }
    const fixed = currentSecondaryActions();
    $$("#secondaryActionChoices [data-secondary-action]").forEach(input => {
      input.checked = fixed.includes(input.dataset.secondaryAction);
    });
    const status = $("#secondaryActionsSummary");
    if (status) status.textContent = fixed.length
      ? "已固定：" + fixed.map(id => SECONDARY_ACTION_LABELS[id] || id).join("、") + "。未固定的动作仍在“更多操作”中可达；不会隐藏撤销或熟练入口。"
      : "当前没有固定次级动作；撤销与熟练仍可从“更多操作”打开，发音与收藏仍在卡片上。";
  }
  function applyReadingLayoutPatch(patch){
    // O1 偏好归属层可用时，走显式偏好入口：默认编辑目标与来源一致（本书已覆盖 → 本书；
    // 否则 → 设备通用），避免刷新/切书后被设备通用值重新解析覆盖。归属层不可用（或尚未
    // 落地）时退回统一设置保存，仍走严格校验与原子写入。
    if (typeof applyPreferencePatch === "function" && typeof getPreferenceOwnership === "function") {
      let ownership = null;
      try { ownership = getPreferenceOwnership(); } catch (e) { ownership = null; }
      if (ownership && ownership.usable && Array.isArray(ownership.currentOverrides)) {
        const fields = Object.keys(patch);
        const owned = fields.filter(f => ownership.currentOverrides.includes(f));
        const inherited = fields.filter(f => !ownership.currentOverrides.includes(f));
        let result = null, threw = false;
        try {
          if (owned.length) result = applyPreferencePatch(Object.fromEntries(owned.map(f => [f, patch[f]])), {target: "book"});
          if ((!result || result.ok) && inherited.length) {
            const deviceResult = applyPreferencePatch(Object.fromEntries(inherited.map(f => [f, patch[f]])), {target: "device"});
            if (!deviceResult.ok) result = deviceResult;
          }
        } catch (e) { threw = true; result = null; }
        if (!threw) {
          if (result && result.ok) { syncReadingLayoutControls(); return result; }
          if (result && !result.ok) {
            toast(result.error || "阅读布局设置保存失败，原设置保持不变");
            syncReadingLayoutControls();
            return result;
          }
        }
      }
    }
    const r = applySettingsPatch(patch);
    if (!r.ok) {
      toast(r.error || "阅读布局设置保存失败，原设置保持不变");
      syncReadingLayoutControls();
      return r;
    }
    syncReadingLayoutControls();
    return r;
  }
  function moveReadingOrder(key, dir){
    const order = currentReadingOrder().slice();
    const i = order.indexOf(key), j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return null;
    const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    applyReadingLayoutPatch({readingOrder: order});
    return order;
  }
  function bindReadingLayoutControls(){
    if (!$("#cardDensitySeg") && !$("#readingOrderControls")) return;
    $$("#cardDensitySeg [data-card-density]").forEach(b => {
      b.onclick = () => applyReadingLayoutPatch({cardDensity: b.dataset.cardDensity});
    });
    const list = $("#readingOrderList");
    if (list) {
      list.onclick = (e) => {
        const btn = e.target?.closest?.("[data-order-key][data-order-dir]");
        if (!btn || btn.getAttribute?.("aria-disabled") === "true") return;
        moveReadingOrder(btn.dataset.orderKey, Number(btn.dataset.orderDir));
      };
    }
    for (const elId of ["showCardMeta", "showCardStage", "showCardPos"]) {
      const el = $("#" + elId);
      if (el) el.onchange = () => applyReadingLayoutPatch({[elId]: !!el.checked});
    }
    const choices = $("#secondaryActionChoices");
    if (choices) {
      choices.innerHTML = SECONDARY_ACTION_IDS.map(id =>
        '<label class="secondary-action-choice"><input type="checkbox" data-secondary-action="' + id + '"><span>'
        + (SECONDARY_ACTION_LABELS[id] || id) + "</span></label>").join("");
      choices.onchange = (e) => {
        const input = e.target;
        const id = input?.dataset?.secondaryAction;
        if (!id) return;
        const fixed = currentSecondaryActions().slice();
        const i = fixed.indexOf(id);
        if (i >= 0) fixed.splice(i, 1);
        else {
          if (fixed.length >= 2) {
            input.checked = false;
            syncReadingLayoutControls();
            toast("最多固定两个次级动作，请先取消一个");
            return;
          }
          fixed.push(id);
        }
        applyReadingLayoutPatch({secondaryActions: fixed});
      };
    }
    // 「更多操作」浮层：点外部或 Esc 关闭并把焦点还给触发按钮；不改变 #acts 行高。
    document.addEventListener("click", (e) => {
      const more = $("#actsMore");
      if (!more || !more.open || !e.target || (more.contains && more.contains(e.target))) return;
      more.open = false;
    }, true);
    document.addEventListener("keydown", (e) => {
      const more = $("#actsMore");
      if (!more || !more.open || e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation?.();
      more.open = false;
      more.querySelector?.("summary")?.focus?.({preventScroll: true});
    }, true);
    syncReadingLayoutControls();
  }

  function markSettingsEditing(){
    const el = $("#settingsSaveState");
    if (!el) return;
    el.dataset.state = "editing";
    if (el.textContent !== "调整中 · 松手后保存") el.textContent = "调整中 · 松手后保存";
  }
  function markSettingsSaved(){
    const el = $("#settingsSaveState");
    if (!el) return;
    const ok = storageOK && !blockedBooks.has(currentBookId);
    el.dataset.state = ok ? "saved" : "error";
    const text = ok ? "已自动保存" : "保存失败，请导出进度备份";
    if (el.textContent !== text) el.textContent = text;
  }
  function updateSettingsSummary(){
    const el = $("#settingsSummary");
    if (el) {
      const order = {freq: "按词频顺序", shuffle: "随机乱序", wrong: "错词优先"};
      el.textContent = currentBook().name + " · 每日 " + S.settings.dailyNew + " 个新词 · " + (order[S.settings.order] || "按词频顺序");
    }
    $$("[data-step-target]").forEach(b => {
      const input = $("#" + b.dataset.stepTarget);
      if (!input) return;
      const value = Number(input.value);
      b.disabled = +b.dataset.stepDir < 0 ? value <= +input.min : value >= +input.max;
    });
  }
  function syncSettingsNav(){
    if (!$("#v-set")?.classList.contains("on")) return;
    const main = $("#main");
    if (!main?.getBoundingClientRect) return;
    const boundary = main.getBoundingClientRect().top + (window.innerWidth <= 840 ? 100 : 52);
    let current = "settings-plan";
    $$(".settings-section").forEach(el => {
      if (el.getBoundingClientRect?.().top <= boundary) current = el.id;
    });
    // 13：末节不再固定为「复习节奏」——底部对齐时高亮最后一个设置分区（含新增的离线与帮助）。
    if (main.scrollHeight && main.scrollTop + main.clientHeight >= main.scrollHeight - 2) {
      const sections = $$(".settings-section");
      if (sections.length) current = sections[sections.length - 1].id;
    }
    $$(".settings-nav a").forEach(a => {
      const on = a.getAttribute?.("href") === "#" + current;
      const wasOn = a.classList.contains("on");
      a.classList.toggle("on", on);
      if (on) a.setAttribute?.("aria-current", "location");
      else a.removeAttribute?.("aria-current");
      if (on && !wasOn && window.innerWidth <= 840) {
        const nav = a.parentElement;
        if (nav && a.offsetLeft < nav.scrollLeft) nav.scrollLeft = a.offsetLeft;
        else if (nav && a.offsetLeft + a.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = a.offsetLeft + a.offsetWidth - nav.clientWidth;
      }
    });
  }
  /* ================= 复习节奏设置页（预设 / 十档编辑 / 跨组重学） =================
   * index.html 静态提供容器：节点缺失时各渲染函数容错跳过。
   * 显示单位 m/h/d ↔ 1/60/1440 分钟；落库始终是整数分钟（rhythmMinutesFrom 四舍五入）。
   */
  const RHYTHM_UNIT_FACTOR = {m: 1, h: 60, d: DAY_MINUTES};
  const RHYTHM_UNIT_LABEL = {m: "分钟", h: "小时", d: "天"};
  /** 行的单位显示：用户手动切过就尊重用户选择，否则按当前分钟自动选较大单位。 */
  const rhythmUnitByRow = {};
  const rhythmUnitTouched = {};
  let rhythmRelearnUnit = null;
  let rhythmRelearnUnitTouched = false;
  function rhythmUnitFactor(unit){ return RHYTHM_UNIT_FACTOR[unit] || 1; }
  function rhythmUnitLabel(unit){ return RHYTHM_UNIT_LABEL[unit] || "分钟"; }
  function rhythmUnitOptions(selected){
    return ["m", "h", "d"].map(u =>
      '<option value="' + u + '"' + (u === selected ? " selected" : "") + ">" + RHYTHM_UNIT_LABEL[u] + "</option>").join("");
  }
  /** 存储分钟 → 当前单位显示值（整数优先；除不尽最多 3 位小数，仅显示用，不落库）。 */
  function rhythmDisplayValue(minutes, unit){
    const v = Math.max(1, Math.round(+minutes || 1)) / rhythmUnitFactor(unit);
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  }
  /** 输入值 + 单位 → 整数分钟；非数字返回 NaN，交给 normalizeStageConfig 整组拒绝。 */
  function rhythmMinutesFrom(value, unit){
    const n = +value;
    if (!isFinite(n)) return NaN;
    return Math.round(n * rhythmUnitFactor(unit));
  }
  /** 自动选择展示单位：能整除就用较大的单位（1440→天、720→小时、5→分钟）。 */
  function rhythmUnitFor(minutes){
    const m = Math.max(1, Math.round(+minutes || 1));
    if (m % DAY_MINUTES === 0) return "d";
    if (m % 60 === 0) return "h";
    return "m";
  }
  /** 读取 data-* 属性：真实 DOM 走 getAttribute，测试/兼容桩回退 dataset。 */
  function rhythmData(el, name){
    if (!el) return null;
    const attr = typeof el.getAttribute === "function" ? el.getAttribute(name) : null;
    if (attr !== null && attr !== undefined) return String(attr);
    const key = name.replace(/^data-/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return el.dataset && el.dataset[key] !== undefined ? String(el.dataset[key]) : null;
  }
  function rhythmErrorText(error){
    return error && error.message ? error.message : "复习曲线设置不正确";
  }
  /** 显示最近一次编辑错误并定位到具体档位；成功后清空。 */
  function showRhythmError(error){
    rhythmLastError = error || null;
    renderRhythmError();
    if (error && Number.isInteger(error.index) && error.index >= 0) {
      $('#rhythmStages [data-stage-index="' + error.index + '"]')?.focus?.({ preventScroll: true });
      // 09：375×812 等矮视口下错误条底边可能超出视口；聚焦档位后把错误提示滚进可视区（不抢焦点）。
      $("#rhythmError")?.scrollIntoView?.({ block: "nearest", behavior: "auto" });
    }
  }
  function renderRhythmError(){
    const el = $("#rhythmError");
    if (!el) return;
    const error = rhythmLastError
      || (stageConfigError && stageConfigError.bookId === currentBookId ? stageConfigError.error : null);
    if (error) {
      el.hidden = false;
      el.textContent = rhythmErrorText(error);
      if (el.classList && el.classList.add) el.classList.add("on");
    } else {
      el.hidden = true;
      el.textContent = "";
      if (el.classList && el.classList.remove) el.classList.remove("on");
    }
  }
  function rhythmPresetLabel(name){
    return name !== "custom" && STAGE_PRESETS[name] ? STAGE_PRESETS[name].label : "自定义";
  }
  function rhythmPreviewText(cfg){
    const preset = presetKeyOf(cfg.stages, cfg.relearn);
    const cycle = getCycleSummary();
    return cfg.stages.map(m => formatMinutes(m)).join(" · ")
      + " · 完整周期" + cycle.text
      + " · 不会后重学 " + formatMinutes(cfg.relearn)
      + " · 当前" + (preset === "custom" ? "自定义曲线" : STAGE_PRESETS[preset].label + "曲线");
  }
  /** 预设按钮：静态节点优先（ui-shell 提供），空容器时按同一 data-preset 属性兜底渲染。 */
  function renderRhythmPresets(presetName){
    const box = $("#rhythmPresets");
    if (!box) return;
    let buttons = $$("#rhythmPresets [data-preset]");
    if (!buttons.length) {
      box.innerHTML = STAGE_PRESET_NAMES.map(n =>
        '<button type="button" data-preset="' + n + '" aria-pressed="' + (n === presetName) + '"'
        + (n === presetName ? ' class="on"' : "") + ">" + esc(STAGE_PRESETS[n].label) + "</button>").join("");
      buttons = $$("#rhythmPresets [data-preset]");
    }
    for (const b of buttons) {
      const name = rhythmData(b, "data-preset");
      const on = name === presetName;
      if (b.classList && b.classList.toggle) b.classList.toggle("on", on);
      b.setAttribute?.("aria-pressed", String(on));
      b.onclick = () => {
        const r = applyStagePreset(name);
        if (r.ok) toast("已切换复习曲线：" + rhythmPresetLabel(name));
        else showRhythmError(r.error);
      };
    }
  }
  function renderRhythmStages(stages){
    const box = $("#rhythmStages");
    if (!box) return;
    box.innerHTML = stages.map((minutes, i) => {
      const unit = rhythmUnitTouched[i] && rhythmUnitByRow[i] ? rhythmUnitByRow[i] : rhythmUnitFor(minutes);
      rhythmUnitByRow[i] = unit;
      return '<div class="rhythm-stage" data-stage-row="' + i + '">' +
        '<span class="rhythm-stage-no">' + String(i + 1).padStart(2, "0") + "</span>" +
        '<input class="rhythm-stage-input" type="number" data-stage-index="' + i + '" inputmode="numeric" min="1" step="1" value="'
          + esc(rhythmDisplayValue(minutes, unit)) + '" aria-label="第 ' + (i + 1) + " 档间隔数值（" + rhythmUnitLabel(unit) + '）">' +
        '<select class="rhythm-stage-unit" data-stage-unit-select="' + i + '" aria-label="第 ' + (i + 1) + ' 档单位">'
          + rhythmUnitOptions(unit) + "</select>" +
        '<span class="rhythm-stage-eq">= ' + esc(formatMinutes(minutes)) + "</span>" +
        "</div>";
    }).join("");
    $$("#rhythmStages [data-stage-index]").forEach(inp => {
      inp.onchange = () => {
        const idx = +rhythmData(inp, "data-stage-index");
        const minutes = rhythmMinutesFrom(inp.value, rhythmUnitByRow[idx] || "m");
        const r = setStageMinutes(idx, minutes);
        // 先按旧有效值重绘（整组回退），再显示错误并聚焦到出错档位，避免焦点被重绘冲掉。
        if (!r.ok) { renderRhythmPanel(); showRhythmError(r.error); }
        else toast("已更新第 " + (idx + 1) + " 档：" + formatMinutes(minutes));
      };
    });
    $$("#rhythmStages [data-stage-unit-select]").forEach(sel => {
      sel.onchange = () => {
        const idx = +rhythmData(sel, "data-stage-unit-select");
        rhythmUnitByRow[idx] = sel.value;
        rhythmUnitTouched[idx] = true;
        renderRhythmPanel();
        $('#rhythmStages [data-stage-index="' + idx + '"]')?.focus?.({ preventScroll: true });
      };
    });
  }
  function renderRhythmRelearn(relearn){
    const box = $("#rhythmRelearn");
    if (!box) return;
    const unit = rhythmRelearnUnitTouched && rhythmRelearnUnit ? rhythmRelearnUnit : rhythmUnitFor(relearn);
    rhythmRelearnUnit = unit;
    box.innerHTML = '<div class="rhythm-relearn-row">' +
      '<input class="rhythm-relearn-input" type="number" data-relearn="1" inputmode="numeric" min="1" step="1" value="'
        + esc(rhythmDisplayValue(relearn, unit)) + '" aria-label="不会后跨组重学间隔数值（' + rhythmUnitLabel(unit) + '）">' +
      '<select class="rhythm-relearn-unit" data-relearn-unit aria-label="不会后跨组重学间隔单位">'
        + rhythmUnitOptions(unit) + "</select>" +
      '<span class="rhythm-relearn-eq">= ' + esc(formatMinutes(relearn)) + "</span>" +
      "</div>";
    const input = $("#rhythmRelearn [data-relearn]");
    if (input) input.onchange = () => {
      const minutes = rhythmMinutesFrom(input.value, rhythmRelearnUnit);
      const r = setRelearnMinutes(minutes);
      // 先按旧有效值重绘，再显示错误并聚焦，避免提示与焦点被重绘冲掉。
      if (!r.ok) { renderRhythmPanel(); showRhythmError(r.error); }
      else toast("已更新不会后重学间隔：" + formatMinutes(minutes));
    };
    const unitSel = $("#rhythmRelearn [data-relearn-unit]");
    if (unitSel) unitSel.onchange = () => {
      rhythmRelearnUnit = unitSel.value;
      rhythmRelearnUnitTouched = true;
      renderRhythmPanel();
    };
  }
  /** 重渲染前记录节奏区焦点，避免 innerHTML 重建后键盘焦点丢到 body。 */
  function rhythmFocusSelector(){
    const a = document.activeElement;
    if (!a) return null;
    const stageIndex = rhythmData(a, "data-stage-index");
    if (stageIndex !== null) return '#rhythmStages [data-stage-index="' + stageIndex + '"]';
    const stageUnit = rhythmData(a, "data-stage-unit-select");
    if (stageUnit !== null) return '#rhythmStages [data-stage-unit-select="' + stageUnit + '"]';
    if (rhythmData(a, "data-relearn") !== null) return "#rhythmRelearn [data-relearn]";
    if (rhythmData(a, "data-relearn-unit") !== null) return "#rhythmRelearn [data-relearn-unit]";
    return null;
  }
  /** 设置页「复习节奏」统一入口（容器由 index.html 静态提供；节点缺失时各渲染函数静默跳过）。 */
  function renderRhythmPanel(){
    const focusSel = rhythmFocusSelector();
    const cfg = currentStageConfig();
    const presetName = presetKeyOf(cfg.stages, cfg.relearn);
    renderRhythmPresets(presetName);
    renderRhythmStages(cfg.stages);
    renderRhythmRelearn(cfg.relearn);
    const status = $("#rhythmStatus");
    if (status) status.textContent = "当前：" + rhythmPresetLabel(presetName);
    const preview = $("#rhythmPreview");
    if (preview) preview.textContent = rhythmPreviewText(cfg);
    renderRhythmError();
    for (const b of $$("[data-rhythm-reset]")) {
      b.onclick = () => {
        const r = applyStagePreset("balanced");
        if (r.ok) toast("已恢复默认复习曲线：均衡");
        else showRhythmError(r.error);
      };
    }
    if (focusSel) $(focusSel)?.focus?.({ preventScroll: true });
  }

  /* ================= 22 设置页：完成后自动续背编辑区 ================= */
  function formatAutoMinutes(ms){
    const min = Math.round((+ms || 0) / 60000 * 10) / 10;
    return (Number.isInteger(min) ? String(min) : String(min)) + " 分钟";
  }
  /** 设置页自动续背控件同步：预设 aria-pressed、自定义输入回显、旧记录推荐方案提示。 */
  function syncAutoResumeSettings(){
    const ar = getAutoResume();
    const preset = autoResumePresetOf(ar);
    $$("#autoResumePresets [data-ar-preset]").forEach(b => {
      const name = b.dataset.arPreset;
      const on = name === preset;
      b.classList.toggle("on", on);
      b.setAttribute?.("aria-pressed", String(on));
      b.onclick = () => {
        const r = applyAutoResumePreset(name);
        if (!r.ok) { toast(r.error || "自动续背设置不正确"); return; }
        toast(name === "off" ? "已关闭完成页自动续背" : "已开启自动续背：" + AUTO_RESUME_PRESETS[name].label + "方案");
      };
    });
    const t = $("#autoResumeThreshold");
    if (t) t.value = String(ar.threshold);
    const idle = $("#autoResumeIdleMin");
    if (idle) idle.value = String(Math.round(ar.idleMs / 6000) / 10);
    const cd = $("#autoResumeCountdownSec");
    if (cd) cd.value = String(Math.round(ar.countdownMs / 1000));
    const status = $("#autoResumeStatus");
    if (status) {
      status.textContent = ar.enabled
        ? "已开启：" + (preset === "custom" ? "自定义" : AUTO_RESUME_PRESETS[preset].label) + "方案 · 可背词达到 "
          + ar.threshold + " 张、连续 " + formatAutoMinutes(ar.idleMs) + " 无有效操作后，倒计时 "
          + Math.round(ar.countdownMs / 1000) + " 秒自动开始下一组"
        : "已关闭：完成一组后不会自动开始下一组；点「继续下一组」仍可手动开始。";
      if (ar.enabled && ar.threshold > S.settings.groupSize) status.textContent += "；" + autoResumeConfigConflict(ar);
    }
    const legacy = $("#autoResumeLegacy");
    if (legacy) legacy.hidden = !(autoResumeLegacyBooks.has(currentBookId) && !ar.enabled);
    const rec = $("#autoResumeRecommend");
    if (rec) rec.onclick = () => {
      const r = applyAutoResumePreset("balanced");
      if (r.ok) toast("已按推荐方案开启自动续背（5 张 / 2 分钟 / 15 秒）");
    };
    // 自定义三项一起提交：任一非法整次拒绝并回显当前有效值（不写半套配置）。
    const applyCustom = () => {
      const threshold = t ? Number(t.value) : ar.threshold;
      const idleMin = idle ? Number(idle.value) : ar.idleMs / 60000;
      const cdSec = cd ? Number(cd.value) : ar.countdownMs / 1000;
      if (!Number.isFinite(threshold) || !Number.isFinite(idleMin) || !Number.isFinite(cdSec)) {
        toast("自动续背自定义值需为数字");
        syncAutoResumeSettings();
        return;
      }
      const r = setAutoResume({
        enabled: true,
        threshold: Math.round(threshold),
        idleMs: Math.round(idleMin * 60000),
        countdownMs: Math.round(cdSec * 1000)
      });
      if (!r.ok) toast(r.error || "自动续背设置不正确");
      else toast("已保存自动续背自定义设置");
      syncAutoResumeSettings();
    };
    [t, idle, cd].forEach(el => { if (el) el.onchange = applyCustom; });
  }

  /** 按类恢复默认按钮（学习计划 / 范围筛选 / 外观与键盘）。 */
  function bindSettingsResetButtons(){
    $$("[data-reset]").forEach(b => {
      const kind = b.dataset.reset;
      b.onclick = () => {
        const r = resetSettingsClass(kind);
        if (!r.ok) return;
        const label = kind === "plan" ? "学习计划" : kind === "scope" ? "范围筛选" : "外观与键盘";
        toast("已恢复默认" + label + "（不影响学习进度、熟练与收藏）");
      };
    });
  }

  function bindSet(){
    const focusBefore = document.activeElement;
    const focusedPmin = focusBefore?.closest?.("#pminPresets") ? focusBefore.dataset.pmin : null;
    const focusedPos = focusBefore?.closest?.("#posChips") ? focusBefore.dataset.pos : null;
    const s = S.settings;
    applyBookText();
    $("#dailyNew").value = s.dailyNew;
    $("#order").value = s.order;
    $("#fmin").value = s.fmin;
    $("#fmax").value = s.fmax || "";
    $("#pmin").value = s.pmin;
    $("#kyOnly").checked = !!s.kyOnly;
    renderPosChips();
    renderPosMode();
    syncPresets();
    applyTheme();
    applyFontSize();
    renderSpeechControls();
    renderOfflineStatus();
    $("#showPh").checked = s.showPh;
    $("#showEx").checked = s.showEx;
    $("#showFm").checked = s.showFm;
    $("#autoSpk").checked = s.autoSpk;
    const singleCharEl = $("#singleCharKeys");
    if (singleCharEl) singleCharEl.checked = s.singleCharKeys !== false;
    updateScopeCount();   // 内部已刷新设置摘要；不再重复调用 updateSettingsSummary()
    renderFreqHistogram();
    renderKeys();
    syncReviewCapControls();
    syncGroupControls();
    syncAutoResumeSettings();
    bindSettingsResetButtons();
    const settingsRestartBtn = $("#applySettingsRestart");
    if (settingsRestartBtn) settingsRestartBtn.onclick = applySettingsRestart;
    renderSettingsLifecycle();
    markSettingsSaved();
    const rhythmFocusBefore = rhythmFocusSelector();
    renderRhythmPanel();
    renderPlanPendingNotice();
    syncInputControls();
    syncReadingLayoutControls();
    renderPreferenceOwnershipControls();
    if (focusedPmin != null) $('#pminPresets button[data-pmin="' + focusedPmin + '"]')?.focus?.({preventScroll: true});
    else if (focusedPos != null) $('#posChips button[data-pos="' + focusedPos + '"]')?.focus?.({preventScroll: true});
    else if (rhythmFocusBefore) $(rhythmFocusBefore)?.focus?.({preventScroll: true});
  }
  function onSet(){
    S.settings.dailyNew = integer(+$("#dailyNew").value, DEF.settings.dailyNew, 1, 500);
    S.settings.order = $("#order").value;
    const fmaxRaw = +$("#fmax").value;
    S.settings.fmin = integer(+$("#fmin").value, 1, 1, 9999);
    S.settings.fmax = (fmaxRaw > 0) ? Math.max(S.settings.fmin, integer(fmaxRaw, 0, 0, 9999)) : 0;
    // pmin 上限 = 当前词书的套卷数（考研 46，回归测试写死）
    S.settings.pmin = integer(+$("#pmin").value, 0, 0, currentBook().paperCount || 46);
    S.settings.kyOnly = $("#kyOnly").checked;
    S.settings.showPh = $("#showPh").checked;
    S.settings.showEx = $("#showEx").checked;
    S.settings.showFm = $("#showFm").checked;
    S.settings.autoSpk = $("#autoSpk").checked;
    const singleCharEl = $("#singleCharKeys");
    if (singleCharEl) S.settings.singleCharKeys = singleCharEl.checked;
    // 07 分组/积压保护：只影响下一组配词（当前组冻结在 sessionPlan）。
    const groupSizeEl = $("#groupSize");
    if (groupSizeEl) {
      S.settings.groupSize = (typeof +groupSizeEl.value === "number" && Number.isInteger(+groupSizeEl.value)
        && +groupSizeEl.value >= GROUP_SIZE_MIN && +groupSizeEl.value <= GROUP_SIZE_MAX)
        ? +groupSizeEl.value : GROUP_SIZE_DEFAULT;
    }
    const guardEl = $("#backlogGuard");
    if (guardEl) S.settings.backlogGuard = !!guardEl.checked;
    // 08：计划/范围改动默认只应用到下一组；当前组沿用 sessionPlan 快照，因此这里绝不 startSession。
    settingsChangedSurfaces();
  }
  /** 09：把 08 冻结的 scopeSig 解析回范围字段（只读；非法快照回退当前设置）。 */
  function parseScopeSig(sig){
    try {
      const a = JSON.parse(sig);
      if (Array.isArray(a) && a.length >= 10) {
        return {
          dailyNew: a[0], order: a[1], fmin: a[2], fmax: a[3], pmin: a[4],
          kyOnly: a[5], pos: Array.isArray(a[6]) ? a[6] : [], posMode: a[7], groupSize: a[8], backlogGuard: a[9]
        };
      }
    } catch (e) { /* 非法/旧快照：按当前设置兜底 */ }
    return null;
  }
  /** 简短范围文案：如「乱序 · ≥2 套卷 · 4,777 词」，用于学习页上下文条与页头入口。 */
  function shortScopeText(sig, count){
    const s = parseScopeSig(sig) || S.settings;
    const parts = [{freq: "按词频", shuffle: "乱序", wrong: "错词优先"}[s.order] || "乱序"];
    if (s.fmax) parts.push(s.fmin + "–" + s.fmax + " 次");
    else if (s.fmin > 1) parts.push("≥" + s.fmin + " 次");
    if (s.pmin) parts.push("≥" + s.pmin + " 套卷");
    if (s.kyOnly) parts.push("仅" + currentBook().tagLabel);
    if (Array.isArray(s.pos) && s.pos.length) parts.push("词性 " + s.pos.length + " 类");
    if (s.posMode === "all") parts.push("全部词性");
    if (count != null) parts.push(Number(count).toLocaleString() + " 词");
    return parts.join(" · ");
  }
  /** 学习页上下文条的范围摘要：优先显示本组冻结范围（08），无组时显示当前设置。 */
  function renderStudyScope(){
    const el = $("#studyScope");
    if (!el) return;
    const plan = mainSessionPlan();
    const hasPlan = !!(plan && plan.bookId === currentBookId);
    const pending = hasPendingScopeSettings();
    const count = hasPlan && plan.scopeCount != null ? plan.scopeCount : inScopeCount();
    const text = shortScopeText(hasPlan ? plan.scopeSig : currentScopeSignature(), count);
    el.textContent = (pending ? "本组 " : "范围 ") + text;
    const full = (pending
      ? "本组开始时的范围：" + text + "；设置已更改，将在下一组生效"
      : hasPlan ? "本组范围：" + text : "当前筛选范围：" + text) + "。点击查看并调整词库范围。";
    el.title = full;
    el.setAttribute?.("aria-label", full);
    // 学习页两处范围摘要同源：当前设置只是下一组预览，不能冒充冻结的本组范围。
    if ($("#v-study")?.classList.contains("on")) {
      const label = $("#scopeLabel");
      if (label) {
        label.textContent = (pending ? "本组范围 " : "背诵范围 ") + count.toLocaleString() + " / " + W.length + " 词";
        label.title = full;
        label.setAttribute?.("aria-label", full);
      }
    }
  }
  /** 学习页范围摘要与页头副标题的统一入口：进入设置页「词库范围」并聚焦该节。 */
  function jumpToScopeSettings(){
    show("set");
    const target = $("#settings-scope");
    if (!target) return;
    target.scrollIntoView?.({block: "start", behavior: "auto"});
    target.tabIndex = -1;
    target.focus?.({preventScroll: true});
    syncSettingsNav();
  }
  function updateScopeCount(){
    const n = inScopeCount();
    const label = $("#scopeLabel");
    if (label) {
      label.textContent = "背诵范围 " + n + " / " + W.length + " 词";
      label.title = "当前筛选范围：" + shortScopeText(currentScopeSignature(), n) + "。点击查看并调整词库范围。";
    }
    const sc = $("#scopeCount");
    sc.textContent = n.toLocaleString() + " 个单词";
    sc.style.color = n ? "var(--accent)" : "var(--no)";
    const empty = $("#scopeEmpty");
    if (empty) empty.hidden = n > 0;
    const start = $("#btnStartFromSettings");
    if (start) start.disabled = !n;
    updateSettingsSummary();
    renderStudyScope();
  }
  function syncPresets(){
    const s = S.settings;
    $$("#presets button").forEach(b => {
      const on = (+b.dataset.fmin === (s.fmin || 1)) &&
        ((b.dataset.fmax || "") === (s.fmax ? String(s.fmax) : ""));
      b.classList.toggle("on", on);
      b.setAttribute?.("aria-pressed", String(on));
    });
    $$("#pminPresets button").forEach(b => {
      const on = +b.dataset.pmin === (s.pmin || 0);
      b.classList.toggle("on", on);
      b.setAttribute?.("aria-pressed", String(on));
    });
    $$("[data-combo]").forEach(b => {
      const combo = b.dataset.combo;
      const pos = s.pos || [];
      const matches = combo === "core" ? s.fmin === 5 && !s.fmax && s.pmin === 3 && !s.kyOnly && !pos.length
        : combo === "cold" ? s.fmin === 1 && s.fmax === 2 && !s.pmin && !s.kyOnly && !pos.length
        : combo === "adj" ? s.fmin === 1 && !s.fmax && !s.pmin && !s.kyOnly && pos.length === 1 && pos[0] === "a"
        : s.fmin === DEF.settings.fmin && s.fmax === DEF.settings.fmax && s.pmin === DEF.settings.pmin && s.kyOnly === DEF.settings.kyOnly && !pos.length;
      b.classList.toggle("on", matches);
      b.setAttribute?.("aria-pressed", String(matches));
    });
  }
  /**
   * 词性筛选口径按钮（#posMode [data-pos-mode]）。静态容器由 index.html 提供；
   * 节点缺失时容错跳过。点击后与 chip 共用同一条保存/重算链。
   */
  function renderPosMode(){
    const box = $("#posMode");
    if (!box) return;
    const mode = getPosMode();
    $$("#posMode [data-pos-mode]").forEach(b => {
      const on = b.dataset.posMode === mode;
      b.classList.toggle("on", on);
      b.setAttribute?.("aria-pressed", String(on));
      b.onclick = () => setPosMode(b.dataset.posMode);
    });
  }
  function setPosMode(mode){
    const next = mode === "all" ? "all" : "primary";
    if (getPosMode() === next) return;
    S.settings.posMode = next;
    // 08：词性口径只影响下一组；与 chip/combo/pmin/频段共用同一条保存/预览链。
    settingsChangedSurfaces();
    renderPosMode();
    syncPresets();
    applyFilter();
    renderStats();
    $('#posMode [data-pos-mode="' + next + '"]')?.focus?.({preventScroll: true});
  }
  function renderPosChips(){
    const sel = S.settings.pos || [];
    $("#posChips").innerHTML = POSCHIPS.map(c =>
      '<button type="button" data-pos="' + c.k + '" aria-pressed="' + (sel.indexOf(c.k) >= 0) + '" class="' + (sel.indexOf(c.k) >= 0 ? "on" : "") + '">' +
      c.t + "</button>"
    ).join("");
    $$("#posChips button").forEach(b => {
      b.onclick = () => {
        const k = b.dataset.pos;
        const cur = (S.settings.pos || []).slice();
        const i = cur.indexOf(k);
        if (i >= 0) cur.splice(i, 1); else cur.push(k);
        S.settings.pos = cur;
        // 08：词性 chip 只影响下一组；当前组跳过重建，已揭示/撤销现场保持不变。
        settingsChangedSurfaces();
        renderPosChips();
        $('#posChips button[data-pos="' + k + '"]')?.focus?.({preventScroll: true});
        syncPresets();
        applyFilter();
        renderStats();
      };
    });
  }

  /* ================= 词书 UI（品牌 / 动态文案 / 选择浮层） ================= */
  /** 品牌区、页面标题与词书入口展示当前词书 */
  function applyBrand(){
    const book = currentBook();
    const mark = $("#brandMark");
    if (mark) mark.textContent = book.mark;
    const title = $("#brandTitle");
    if (title) title.textContent = book.name + "单词";
    document.title = book.name + "单词背诵";
    const btn = $("#btnBooks");
    if (btn) {
      btn.textContent = "词书⌄";
      btn.setAttribute?.("aria-label", "切换词书（当前 " + book.name + "）");
      btn.setAttribute?.("title", "切换词书（当前 " + book.name + "）");
    }
  }
  /** 设置页随当前词书变化的文案、上限与预设 */
  function applyBookText(){
    const book = currentBook();
    const setText = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };
    setText("#kyOnlyLabel", book.kyOnlyLabel);
    setText("#kyOnlyDesc", "开启后只背 ECDICT 标注为" + book.tagLabel + "的词");
    setText("#fRangeDesc", "按 " + book.paperCount + " " + book.paperUnit +
      "的正文词频选择范围。拖动两端手柄，选择这次想背的单词。");
    setText("#pminDesc", "本词书共 " + book.paperCount + " " + book.paperUnit +
      "。跨试卷覆盖可补充词频信息：只在一套卷里反复出现的词，可能与该套卷的主题有关");
    setText("#fscKy", "大纲词");
    const pmin = $("#pmin");
    if (pmin) {
      pmin.max = String(book.paperCount);
      pmin.setAttribute?.("max", String(book.paperCount));
    }
    renderPminPresets();
  }
  /** 「至少出现在几套卷子里」预设随 paperCount 动态（超过上限的档位不显示） */
  function renderPminPresets(){
    const el = $("#pminPresets");
    if (!el) return;
    const pc = currentBook().paperCount;
    const items = [[0, "不限"], [2, "≥2 套（推荐）"], [3, "≥3 套"], [5, "≥5 套"], [10, "≥10 套"], [20, "≥20 套"]]
      .filter(([v]) => v === 0 || v <= pc);
    el.innerHTML = items.map(([v, t]) =>
      '<button type="button" data-pmin="' + v + '">' + t + "</button>").join("");
    $$("#pminPresets button").forEach(b => {
      b.onclick = () => {
        $("#pmin").value = b.dataset.pmin;
        onSet(); bindSet(); applyFilter(); renderStats();
        toast("已设为 " + b.textContent);
      };
    });
  }
  /** 词书选择列表：名称、词数 · 已学 · 已掌握，当前书高亮 */
  function renderBookList(){
    const list = $("#bookList");
    if (!list) return;
    list.innerHTML = BOOK_DEFS.map(def => {
      const book = BOOKS[def.id];
      const on = def.id === currentBookId;
      if (!book.available) {
        return '<button type="button" class="book-item disabled" data-book="' + esc(def.id) +
          '" data-unavailable="1" aria-disabled="true">' +
          '<span class="book-mark">' + esc(def.mark) + "</span>" +
          '<span class="book-main"><b class="book-name">' + esc(def.name) + "</b>" +
          '<span class="book-meta">词书数据未载入</span></span></button>';
      }
      const st = bookStats(def.id);
      const meta = book.words.length + " 词 · " + (st.ok
        ? "已学 " + st.learned + " · 已掌握 " + st.mastered
        : "记录无法读取");
      return '<button type="button" class="book-item' + (on ? " on" : "") +
        '" data-book="' + esc(def.id) + '" aria-pressed="' + on + '">' +
        '<span class="book-mark">' + esc(def.mark) + "</span>" +
        '<span class="book-main"><b class="book-name">' + esc(def.name) + "</b>" +
        '<span class="book-meta">' + esc(meta) + "</span></span>" +
        (on ? '<span class="book-check" aria-hidden="true">✓</span>' : "") +
        "</button>";
    }).join("");
  }
  function openBookSheet(){
    renderBookList();
    renderBookPageUi();
    openSheet("#bookSheet");
    const btn = $("#btnBooks");
    if (btn) btn.setAttribute?.("aria-expanded", "true");
  }

  /* ================= 按键：同一解析/冲突/命令入口 ================= */
  let inputPreferenceRevision = 0;
  function noteInputPreferencesCommitted(previous){
    if(["keys","actionKeys","gestures","actionLayout","singleCharKeys"].some(k=>JSON.stringify(previous?.[k])!==JSON.stringify(S.settings[k])))inputPreferenceRevision++;
  }
  function getInputPreferences(){return cloneSettingsValue({keys:S.settings.keys,actionKeys:S.settings.actionKeys,
    gestures:S.settings.gestures,actionLayout:S.settings.actionLayout,singleCharKeys:S.settings.singleCharKeys});}
  function keyName(k){
    if(k===null || k===undefined || k==="")return "未绑定";
    if(k===" ")return "空格";
    if(/^shift\+[a-z]$/.test(k))return "Shift + "+k.slice(-1).toUpperCase();
    const arrows={ArrowLeft:"←",ArrowRight:"→",ArrowUp:"↑",ArrowDown:"↓"};
    return arrows[k] || (k.length===1?k.toUpperCase():k);
  }
  function inputEventIgnored(e){
    return !!(e.repeat || e.isComposing || e.keyCode===229 || e.key==="Dead" || e.key==="Unidentified" || e.getModifierState?.("AltGraph"));
  }
  function bindingFromEvent(e){
    if(inputEventIgnored(e) || e.ctrlKey || e.metaKey || e.altKey)return null;
    const key=(e.key===" " || e.code==="Space")?" ":e.key;
    if(e.shiftKey)return typeof key==="string" && /^[a-z]$/i.test(key)?"shift+"+key.toLowerCase():null;
    return normalizeKeyBinding(key);
  }
  function keyMatch(e,k){
    const normalized=normalizeKeyBinding(k);
    if(!normalized || inputEventIgnored(e) || e.ctrlKey || e.metaKey || e.altKey)return false;
    if(normalized.startsWith("shift+"))return !!e.shiftKey && typeof e.key==="string" && e.key.toLowerCase()===normalized.slice(-1);
    if(normalized===" ")return e.key===" " || e.code==="Space";
    return typeof e.key==="string" && e.key.toLowerCase()===normalized;
  }
  function inputContext(){return cur!=null?"card":emptyWaitActive()?"wait":emptyMainPage()?"empty":"done";}
  function completedNextAction(){
    if (cur != null || groupTotal <= 0) return null;
    return drillMode || inSubgroup() ? "return" : "continue";
  }
  function boundActionForEvent(e){
    const all=Object.assign({},S.settings.keys,S.settings.actionKeys),context=inputContext();
    const active=INPUT_ACTIONS.filter(a=>a.contexts.includes(context));
    const exact=bindingFromEvent(e);
    if(exact && exact.startsWith("shift+")) {
      const matching=INPUT_ACTIONS.filter(a=>all[a.id]===exact);
      if(matching.length) return matching.find(a=>a.contexts.includes(context))?.id
        || (matching.some(a => a.id === "next") ? completedNextAction() : null);
    }
    return active.find(a=>keyMatch(e,all[a.id]))?.id
      || (keyMatch(e, all.next) ? completedNextAction() : null);
  }
  function setInputBinding(action,binding){
    const descriptor=INPUT_ACTIONS.find(a=>a.id===action);
    if(!descriptor)return {ok:false,error:"未知快捷键动作"};
    const extra=Object.prototype.hasOwnProperty.call(DEFACTIONKEYS,action);
    const normalized=binding===null && extra?null:normalizeKeyBinding(binding);
    if(normalized===null && !(binding===null && extra))return {ok:false,error:"可用单个字母、数字、空格或 Shift 加字母；其他组合留给浏览器或系统"};
    const keys=Object.assign({},S.settings.keys),actionKeys=Object.assign({},S.settings.actionKeys);
    (extra?actionKeys:keys)[action]=normalized;
    const conflict=inputBindingConflict(keys,actionKeys);
    if(conflict)return {ok:false,error:"这个键在同一场景已被「"+INPUT_ACTIONS.find(a=>a.id===(conflict.first===action?conflict.second:conflict.first)).label+"」占用"};
    return applySettingsPatch(extra?{actionKeys}:{keys});
  }
  function resetInputBinding(action){return setInputBinding(action,Object.prototype.hasOwnProperty.call(DEFKEYS,action)?DEFKEYS[action]:null);}
  function resetInputBindings(){
    return applySettingsPatch({keys:Object.assign({},DEFKEYS),actionKeys:Object.assign({},DEFACTIONKEYS)});
  }
  let rebinding = null;
  function renderKeys(){
    const all=Object.assign({},S.settings.keys,S.settings.actionKeys);
    $$(".keybtn").forEach(b=>{
      const action=b.dataset.k,descriptor=INPUT_ACTIONS.find(a=>a.id===action);
      if(!descriptor)return;
      const bindingLabel=action === "continue" && !all[action]
        ? "沿用 " + keyName(S.settings.keys.next) : keyName(all[action]);
      b.textContent=rebinding===action?"按下新按键…":bindingLabel;
      b.classList.toggle("cap",rebinding===action);
      b.setAttribute?.("aria-label","修改"+descriptor.label+"快捷键，当前 "+bindingLabel);
      b.setAttribute?.("aria-pressed",String(rebinding===action));
    });
    const status=$("#keyBindingStatus"),descriptor=INPUT_ACTIONS.find(a=>a.id===rebinding);
    if(status)status.textContent=descriptor?"正在修改「"+descriptor.label+"」：按新键或Shift+字母，Esc取消。"+(Object.prototype.hasOwnProperty.call(DEFACTIONKEYS,rebinding)?"Backspace清除绑定。":"")
      :"选择一个按键后按新键，支持Shift+字母；Esc取消。";
  }
  function captureKey(e){
    if(e.key==="Escape"){rebinding=null;renderKeys();return;}
    if(["Shift","Control","Alt","Meta"].includes(e.key))return;
    if(inputEventIgnored(e))return;
    const clear=Object.prototype.hasOwnProperty.call(DEFACTIONKEYS,rebinding) && ["Backspace","Delete"].includes(e.key);
    const key=clear?null:bindingFromEvent(e);
    if(key===null && !clear){toast("请选择字母、数字、空格或Shift+字母；其他组合留给浏览器或系统");return;}
    const r=setInputBinding(rebinding,key);
    if(!r.ok){toast(r.error);return;}
    rebinding=null;renderKeys();
    toast(clear?"已清除这项绑定":"已设为 "+keyName(key));
  }

  /* ================= 11 首次使用引导（首屏提示条 + 可重开说明浮层） =================
   * 引导状态只作界面偏好：独立全局键 GUIDE_KEY，不进每书 state / 备份 v3 / 学习进度与配额。
   * 首次打开显示可关闭的提示条（不是强制多步教程，也不拦截键盘判定）；
   * 提示条可打开完整说明，之后随时可从帮助浮层或设置页「离线与帮助」再次打开。
   */
  function readGuideState(){
    try {
      const raw = localStorage.getItem(GUIDE_KEY);
      if (raw === null) return {seen: false, dismissedAt: null};
      const o = JSON.parse(raw);
      const at = o && typeof o.dismissedAt === "string" ? o.dismissedAt : null;
      return {seen: !!(o && o.version === 1 && at), dismissedAt: at};
    } catch (e) { return {seen: false, dismissedAt: null}; }
  }
  function guideSeen(){ return readGuideState().seen; }
  /** 记下「已看过」；写失败（隐私模式/存储满）不影响本次隐藏，下次仍会提示。 */
  function markGuideSeen(){
    const state = readGuideState();
    if (state.seen) return false;
    try {
      localStorage.setItem(GUIDE_KEY, JSON.stringify({version: 1, dismissedAt: new Date().toISOString()}));
      return true;
    } catch (e) { return false; }
  }
  /** 只在背诵页、且尚未看过引导时显示首屏提示条（不遮挡 #cards/#acts，不阻塞键盘）。 */
  function renderGuideBanner(){
    const el = $("#guideBanner");
    if (!el) return;
    const studyOn = !!$("#v-study")?.classList.contains("on");
    el.hidden = !(studyOn && !guideSeen());
  }
  function dismissGuideBanner(){
    markGuideSeen();
    const el = $("#guideBanner");
    if (el) el.hidden = true;
  }
  /** 打开完整说明：同样视为已看引导，隐藏首屏提示条。 */
  function openGuide(){
    markGuideSeen();
    const banner = $("#guideBanner");
    if (banner) banner.hidden = true;
    openSheet("#guideSheet");
  }
  function getGuideState(){
    const state = readGuideState();
    const banner = $("#guideBanner");
    return {
      key: GUIDE_KEY,
      seen: state.seen,
      dismissedAt: state.dismissedAt,
      bannerVisible: !!(banner && banner.hidden === false)
    };
  }

  /* ================= 快捷键浮层 ================= */
  function renderHelp(){
    const K = S.settings.keys;
    const items = [
      [keyName(K.know), "标记「会」并显示释义"],
      [keyName(K.dont), "标记「不会」并显示释义"],
      [keyName(K.next) + " / Enter", "下一个（须先判定）；本组结束后沿用下一个按键或 Enter 继续，子组/特训完成后返回原组"],
      [keyName(K.speak), "发音"],
      [keyName(K.star), "收藏 / 取消收藏"],
      [keyName(K.proficient), "标为熟练并移出背诵队列"],
      ["Ctrl/Cmd + Z", "撤销上一步"],
      ["← / →", "不会 / 会（等价于判定）"],
      ["?", "打开 / 关闭本帮助"],
      ["Esc", "关闭浮层 / 取消改键"]
    ];
    if(typeof getInputPreferences === "function") {
      const bindings=getInputPreferences().actionKeys;
      const labels={continue:"继续下一组",wait:"开始或退出本页等待",return:"返回原学习现场",listSearch:"打开词表搜索"};
      items.splice(6,0,...Object.entries(bindings).filter(([,binding])=>binding).map(([id,binding])=>[keyName(binding),labels[id]]));
    }
    $("#keyList").innerHTML = items.map(([k, t]) =>
      "<li><span>" + esc(t) + '</span><span class="k">' + esc(k) + "</span></li>"
    ).join("");
  }
  let activeSheet = null, previousFocus = null, detailWord = null;
  function openSheet(id){
    cancelInputGesture();
    if (rebinding) { rebinding = null; renderKeys(); }
    hideExPop();
    if (activeSheet) closeSheet();
    previousFocus = document.activeElement;
    activeSheet = $(id);
    activeSheet.hidden = false;
    $("#main").inert = true;
    $(".top").inert = true;
    const panel = activeSheet.querySelector?.(".sheet-panel");
    if (panel) { panel.tabIndex = -1; panel.focus?.(); }
    fitVisibleWords();
  }
  function closeSheet(){
    if (!activeSheet) return;
    hideExPop();
    const closedId = activeSheet.id;
    if (closedId === "txtSplitSheet") txtSplitContext = null;
    if (closedId === "importSheet") pendingImport = null;
    if (closedId === "spellingSheet") onSpellingSheetClosed();
    if (closedId === "wordSheet") resetWordIssueSurface();
    activeSheet.hidden = true;
    activeSheet = null;
    $("#main").inert = false;
    $(".top").inert = false;
    if (sharedCardRefreshPending === currentBookId) renderCard();
    if (sharedListRefreshPending === currentBookId) {
      sharedListRefreshPending = false;
      applyFilter(false);
    }
    if (closedId === "bookSheet") {
      const btn = $("#btnBooks");
      if (btn) btn.setAttribute?.("aria-expanded", "false");
    }
    // 关闭浮层后若回到背诵页，焦点归到卡片：避免焦点留在触发按钮（如 #btnBooks）上时，
    // 空格/回车先被按钮原生激活吞掉（曾导致切书后按空格又打开词书浮层）。
    const studyView = $("#v-study");
    if (studyView && studyView.classList.contains("on")) {
      const card = $("#card");
      if (card && card.focus) card.focus({ preventScroll: true });
      else if (previousFocus && previousFocus.isConnected) previousFocus.focus?.();
    } else if (previousFocus && previousFocus.isConnected && previousFocus !== document.body) {
      // 非背诵页：仅当触发元素不是 body 时归还焦点（body 不可聚焦，focus 无效）
      previousFocus.focus?.({ preventScroll: true });
    } else if ($("#v-list")?.classList.contains("on")) {
      const pos = filt.indexOf(listActiveWord);
      if (pos >= 0) focusListRow(pos, listActiveAction);
      else $("#listScroll")?.focus?.({preventScroll: true});
    }
    previousFocus = null;
    applyActionLayout();
    applyActionBindingHints();
  }

  /* ================= H 本词问题本地记录（详情页，独立键） =================
   * 契约：docs/H本词问题工作记录-2026-10-24.md
   * - 独立全局键 WORD_ISSUES_KEY：不进每书 state/settings、不进备份 v3、不进
   *   进度签名或任何学习记录；不改词库 11 元组；不联网发送。
   * - 按 bookId + word 键控，四书隔离；单条备注 ≤500 字、全库最多 500 条。
   * - 存储原文损坏时保留原文并停止覆写（只读提示），绝不用默认值覆盖用户数据。
   */
  const WORD_ISSUES_KEY = "vocab_word_issues_v1";
  const WORD_ISSUES_KIND = "vocab-word-issues";
  const WORD_ISSUES_VERSION = 1;
  const WORD_ISSUES_MAX = 500;
  const WORD_ISSUE_NOTE_MAX = 500;
  /** 当前详情词的 bookId::word；切词/关闭详情时重置（草稿只在同一次打开内保留）。 */
  let wordIssueContext = null;
  /** 用户已输入但尚未保存：详情重渲染（收藏/熟练等）时不得覆盖草稿。 */
  let wordIssueDirty = false;
  function issueKey(bookId, word){ return String(bookId) + "\u0000" + String(word); }
  function issueNoteLength(text){ return Array.from(String(text == null ? "" : text)).length; }
  function issueTimeText(iso){
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso || "未记录") : formatBackupTime(iso);
  }
  /** 逐条严格校验；任何字段非法都按「存储损坏」处理（保留原文、不修复、不覆写）。 */
  function normalizeWordIssueEntry(item){
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const bookId = typeof item.bookId === "string" ? item.bookId.trim() : "";
    const bookName = typeof item.bookName === "string" ? item.bookName.trim() : "";
    const word = typeof item.word === "string" ? item.word.trim() : "";
    if (!bookId || !bookName || !word) return null;
    if (typeof item.source !== "string") return null;
    if (typeof item.note !== "string") return null;
    const noteLen = issueNoteLength(item.note);
    if (noteLen < 1 || noteLen > WORD_ISSUE_NOTE_MAX) return null;
    if (!(typeof item.createdAt === "string" && !Number.isNaN(Date.parse(item.createdAt)))) return null;
    if (!(typeof item.updatedAt === "string" && !Number.isNaN(Date.parse(item.updatedAt)))) return null;
    return {bookId: bookId, bookName: bookName, word: word, source: item.source, note: item.note,
      createdAt: item.createdAt, updatedAt: item.updatedAt};
  }
  function issueCorruption(raw, reason){
    return {ok: false, corrupted: true, storageError: false, entries: [], raw: raw, reason: reason};
  }
  /**
   * 只读读取问题记录：
   *   {ok:true, entries, raw, corrupted:false}（键不存在 → entries 为空）
   *   {ok:false, corrupted:true, raw, reason}（原文保留，调用方必须禁止写入）
   *   {ok:false, corrupted:false, storageError:true, raw:null}
   */
  function readWordIssues(){
    let raw = null;
    try { raw = localStorage.getItem(WORD_ISSUES_KEY); }
    catch (e) { return {ok: false, corrupted: false, storageError: true, entries: [], raw: null, reason: "浏览器存储不可用"}; }
    if (raw === null) return {ok: true, entries: [], raw: null, corrupted: false};
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { return issueCorruption(raw, "不是有效 JSON"); }
    if (!data || typeof data !== "object" || Array.isArray(data)) return issueCorruption(raw, "顶层结构不是对象");
    if (data.kind !== WORD_ISSUES_KIND) return issueCorruption(raw, "缺少问题记录标识");
    if (data.version !== WORD_ISSUES_VERSION) return issueCorruption(raw, "版本不受支持");
    if (!Array.isArray(data.entries)) return issueCorruption(raw, "条目不是数组");
    if (data.entries.length > WORD_ISSUES_MAX) return issueCorruption(raw, "条目数超过上限");
    const entries = [], seen = new Set();
    for (const item of data.entries) {
      const entry = normalizeWordIssueEntry(item);
      if (!entry) return issueCorruption(raw, "条目字段非法");
      const key = issueKey(entry.bookId, entry.word);
      if (seen.has(key)) return issueCorruption(raw, "存在重复条目");
      seen.add(key);
      entries.push(entry);
    }
    return {ok: true, entries: entries, raw: raw, corrupted: false};
  }
  /** 写回问题记录；expectedRaw 检测其他标签的并发修改（不一致则不写，由调用方重读一次）。 */
  function writeWordIssuesFile(entries, expectedRaw){
    try {
      if (expectedRaw !== undefined && localStorage.getItem(WORD_ISSUES_KEY) !== expectedRaw) return {ok: false, stale: true};
      localStorage.setItem(WORD_ISSUES_KEY, JSON.stringify({
        kind: WORD_ISSUES_KIND, version: WORD_ISSUES_VERSION, entries: entries
      }));
      return {ok: true};
    } catch (e) { return {ok: false, storageError: true}; }
  }
  function findIssueIndex(entries, bookId, word){
    const key = issueKey(bookId, word);
    for (let i = 0; i < entries.length; i++) if (issueKey(entries[i].bookId, entries[i].word) === key) return i;
    return -1;
  }
  function currentIssueEntry(entries, bookId, word){
    const idx = findIssueIndex(entries, bookId, word);
    return idx >= 0 ? entries[idx] : null;
  }
  /** 保存（新建或更新）；并发被其他标签改写时重读一次再试，损坏/不可用直接拒绝。 */
  function saveWordIssueEntry(fields){
    const note = String(fields && fields.note != null ? fields.note : "");
    const clean = {
      bookId: String((fields && fields.bookId) || ""), bookName: String((fields && fields.bookName) || ""),
      word: String((fields && fields.word) || ""), source: String((fields && fields.source) || ""), note: note
    };
    if (!clean.bookId || !clean.bookName || !clean.word) return {ok: false, error: "invalid"};
    if (!clean.note.trim()) return {ok: false, error: "empty"};
    if (issueNoteLength(clean.note) > WORD_ISSUE_NOTE_MAX) return {ok: false, error: "too-long"};
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = readWordIssues();
      if (!current.ok) return current;
      const entries = current.entries.slice();
      const now = new Date().toISOString();
      const idx = findIssueIndex(entries, clean.bookId, clean.word);
      const created = idx < 0;
      if (!created) {
        entries[idx] = Object.assign({}, entries[idx], {
          bookName: clean.bookName, source: clean.source, note: clean.note, updatedAt: now
        });
      } else {
        if (entries.length >= WORD_ISSUES_MAX) return {ok: false, error: "limit", count: entries.length};
        entries.push({bookId: clean.bookId, bookName: clean.bookName, word: clean.word, source: clean.source,
          note: clean.note, createdAt: now, updatedAt: now});
      }
      const saved = writeWordIssuesFile(entries, current.raw);
      if (saved.ok) return {ok: true, created: created, entry: entries[created ? entries.length - 1 : idx], entries: entries};
      if (!saved.stale) return saved;
    }
    return {ok: false, storageError: true, reason: "存储被其他页面频繁修改"};
  }
  function deleteWordIssueEntry(bookId, word){
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = readWordIssues();
      if (!current.ok) return current;
      const entries = current.entries.slice();
      const idx = findIssueIndex(entries, bookId, word);
      if (idx < 0) return {ok: false, error: "missing"};
      entries.splice(idx, 1);
      const saved = writeWordIssuesFile(entries, current.raw);
      if (saved.ok) return {ok: true, entries: entries};
      if (!saved.stale) return saved;
    }
    return {ok: false, storageError: true, reason: "存储被其他页面频繁修改"};
  }
  /** 详情页展示/随记录保存的可读来源：11 元组 src + 词频/卷次（只读派生，不改词条）。 */
  function wordIssueSourceText(x){
    if (!x) return "";
    return [x.src ? srcBadge(x.src) : "例句来源未标注", "词频 #" + x.r, x.f + " 次 / " + x.c + " 套卷"].join(" · ");
  }
  function detailWordIssueContext(){
    const x = detailWord != null ? W[detailWord] : null;
    if (!x) return null;
    return {bookId: currentBookId, bookName: currentBook().name, word: x.w, source: wordIssueSourceText(x)};
  }
  function setWordIssueStatus(text, isError){
    const el = $("#wordIssueStatus");
    if (!el) return;
    el.textContent = text || "";
    if (isError) el.setAttribute("data-error", "true");
    else el.removeAttribute("data-error");
  }
  /**
   * 渲染详情页问题区：已有记录（来源/时间）、条数、按钮可见性；
   * 不覆盖用户尚未保存的草稿（wordIssueDirty）。返回当前词的问题记录或 null。
   */
  function renderWordIssueBlock(){
    const ctx = detailWordIssueContext();
    const noteEl = $("#wordIssueNote");
    if (!ctx) return null;
    const key = issueKey(ctx.bookId, ctx.word);
    if (wordIssueContext !== key) {
      wordIssueContext = key;
      wordIssueDirty = false;
      if (noteEl) noteEl.value = "";
      setWordIssueStatus("");
    }
    const state = readWordIssues();
    const entry = state.ok ? currentIssueEntry(state.entries, ctx.bookId, ctx.word) : null;
    const known = $("#wordIssueKnown");
    if (known) {
      if (entry) {
        known.hidden = false;
        known.innerHTML = '<b>已有记录</b> · 来源：' + esc(entry.source || "未记录")
          + '<br>创建：' + esc(issueTimeText(entry.createdAt)) + ' · 更新：' + esc(issueTimeText(entry.updatedAt));
      } else {
        known.hidden = true;
        known.innerHTML = "";
      }
    }
    if (noteEl && entry && !wordIssueDirty) noteEl.value = entry.note;
    const totalEl = $("#wordIssueTotal");
    if (totalEl) {
      if (!state.ok) totalEl.textContent = "";
      else {
        const bookCount = state.entries.filter(item => item.bookId === ctx.bookId).length;
        totalEl.textContent = "本书 " + bookCount + " 条 · 全部 " + state.entries.length + " / " + WORD_ISSUES_MAX + " 条上限";
      }
    }
    const canRead = state.ok;
    const saveBtn = $("#wordIssueSave"), deleteBtn = $("#wordIssueDelete"), copyBtn = $("#wordIssueCopy");
    const exportBookBtn = $("#wordIssueExportBook"), exportAllBtn = $("#wordIssueExportAll");
    if (saveBtn) saveBtn.disabled = !canRead;
    if (deleteBtn) { deleteBtn.hidden = !entry; deleteBtn.disabled = !canRead; }
    if (copyBtn) { copyBtn.hidden = !entry; copyBtn.disabled = !canRead; }
    if (exportBookBtn) exportBookBtn.disabled = !canRead;
    if (exportAllBtn) exportAllBtn.disabled = !canRead;
    if (!state.ok) {
      setWordIssueStatus(state.corrupted
        ? "本词问题记录的存储原文已损坏（" + (state.reason || "格式无法识别") + "）。已保留原文并停止写入、导出，避免覆盖；输入内容只在本页保留。"
        : "浏览器存储当前不可用：本词问题记录无法读取或保存；已输入内容只在本页保留。", true);
    }
    return entry;
  }
  function wordIssueFailureText(r){
    if (r && r.corrupted) return "本词问题记录的存储原文已损坏：已保留原文并停止写入，本次未保存。";
    if (r && r.storageError) return "保存失败：浏览器存储不可用或空间不足；输入已保留，可稍后重试。";
    if (r && r.error === "limit") return "最多保存 " + WORD_ISSUES_MAX + " 条本词问题（含全部词书），请先删除不再需要的记录；本次未保存。";
    if (r && r.error === "empty") return "请先写下问题或备注再保存。";
    if (r && r.error === "too-long") return "单条最多 " + WORD_ISSUE_NOTE_MAX + " 字，请精简后再保存；输入已保留。";
    if (r && r.error === "missing") return "本词还没有可删除的问题记录。";
    return "保存失败：" + ((r && (r.reason || r.error)) || "浏览器存储不可用") + "；输入已保留。";
  }
  /** 详情页「保存」：读文本框 → 校验 → 写独立键；失败时保留输入并提示。 */
  function saveDetailWordIssue(){
    const ctx = detailWordIssueContext();
    if (!ctx) return {ok: false, error: "no-word"};
    const noteEl = $("#wordIssueNote");
    const note = String(noteEl && noteEl.value != null ? noteEl.value : "").replace(/\r\n?/g, "\n").trim();
    if (!note) {
      setWordIssueStatus("请先写下问题或备注再保存。");
      noteEl?.focus?.();
      return {ok: false, error: "empty"};
    }
    if (issueNoteLength(note) > WORD_ISSUE_NOTE_MAX) {
      setWordIssueStatus("单条最多 " + WORD_ISSUE_NOTE_MAX + " 字，请精简后再保存；输入已保留。", true);
      noteEl?.focus?.();
      return {ok: false, error: "too-long"};
    }
    const r = saveWordIssueEntry({bookId: ctx.bookId, bookName: ctx.bookName, word: ctx.word, source: ctx.source, note: note});
    if (!r.ok) {
      setWordIssueStatus(wordIssueFailureText(r), true);
      return r;
    }
    wordIssueDirty = false;
    renderWordIssueBlock();
    setWordIssueStatus(r.created
      ? "已保存本词问题：只保存在当前浏览器，供后续核对；不会改动词库或学习进度。"
      : "已更新本词问题（只保存在当前浏览器）。");
    toast(r.created ? "已保存本词问题" : "已更新本词问题");
    return r;
  }
  function deleteDetailWordIssue(){
    const ctx = detailWordIssueContext();
    if (!ctx) return {ok: false, error: "no-word"};
    // 本地问题记录删了不可撤销：与仓库其它破坏性操作一致，显式确认一次。
    if (typeof confirm === "function"
        && !confirm("确定删除「" + ctx.bookName + " · " + ctx.word + "」的本词问题记录？此操作不可撤销。")) {
      return {ok: false, cancelled: true};
    }
    const r = deleteWordIssueEntry(ctx.bookId, ctx.word);
    if (!r.ok) {
      setWordIssueStatus(wordIssueFailureText(r), true);
      return r;
    }
    wordIssueDirty = false;
    const noteEl = $("#wordIssueNote");
    if (noteEl) noteEl.value = "";
    renderWordIssueBlock();
    setWordIssueStatus("已删除本词问题记录。");
    toast("已删除本词问题");
    return r;
  }
  function currentDetailIssueEntry(){
    const ctx = detailWordIssueContext();
    if (!ctx) return null;
    const state = readWordIssues();
    if (!state.ok) return null;
    return currentIssueEntry(state.entries, ctx.bookId, ctx.word);
  }
  function wordIssueCopyText(entry){
    if (!entry) return "";
    return "【" + entry.bookName + "】" + entry.word
      + "\n来源：" + (entry.source || "未记录")
      + "\n问题：" + entry.note
      + "\n创建：" + issueTimeText(entry.createdAt)
      + "\n更新：" + issueTimeText(entry.updatedAt);
  }
  /** 复制单条：优先 navigator.clipboard，失败回退隐藏 textarea + execCommand。 */
  async function copyDetailWordIssue(){
    const entry = currentDetailIssueEntry();
    if (!entry) { setWordIssueStatus("本词还没有可复制的问题记录。", true); return {ok: false, error: "missing"}; }
    const text = wordIssueCopyText(entry);
    let ok = false;
    try {
      if (typeof navigator !== "undefined" && navigator && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch (e) { ok = false; }
    if (!ok) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute?.("readonly", "");
      ta.setAttribute?.("aria-label", "本词问题文本，自动复制失败时可手动复制");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      // 放在浮层内，确保焦点陷阱与 inert 不会阻止手动复制。
      const host = $("#wordSheet .sheet-panel") || document.body;
      const focusBefore = document.activeElement;
      host.appendChild(ta);
      ta.focus?.();
      ta.select?.();
      try { ok = !!(document.execCommand && document.execCommand("copy")); } catch (e) { ok = false; }
      if (ok) {
        ta.remove?.();
        focusBefore?.focus?.({ preventScroll: true });
      } else {
        ta.style.position = "static";
        ta.style.left = "";
        ta.style.width = "100%";
        ta.style.boxSizing = "border-box";
        ta.rows = 6;
        ta.focus?.();
        ta.select?.();
      }
    }
    setWordIssueStatus(ok
      ? "已复制本条问题记录（含词书、词头、来源与时间）。"
      : "自动复制失败，已选中问题文本；请按 Ctrl/Cmd+C 复制。", !ok);
    return {ok: ok, text: text};
  }
  function pickWordIssueFields(entry){
    return {bookId: entry.bookId, bookName: entry.bookName, word: entry.word, source: entry.source,
      note: entry.note, createdAt: entry.createdAt, updatedAt: entry.updatedAt};
  }
  /** 纯导出数据（不触发下载）：仅问题记录必要字段，不含任何学习记录。 */
  function wordIssuesExportData(scope){
    const state = readWordIssues();
    if (!state.ok) return null;
    const entries = (scope === "book" ? state.entries.filter(item => item.bookId === currentBookId) : state.entries)
      .map(pickWordIssueFields);
    return {kind: WORD_ISSUES_KIND, version: WORD_ISSUES_VERSION, exportedAt: new Date().toISOString(), entries: entries};
  }
  function exportWordIssuesFile(scope){
    const data = wordIssuesExportData(scope);
    if (!data) {
      setWordIssueStatus("本词问题记录当前无法导出：存储原文已损坏或浏览器存储不可用。", true);
      return null;
    }
    if (!data.entries.length) {
      setWordIssueStatus(scope === "book" ? "本书还没有保存过本词问题，未生成文件。" : "还没有保存过任何本词问题，未生成文件。");
      return null;
    }
    const name = "背词问题_" + (scope === "book" ? currentBook().name : "全部词书") + "_" + todayStr() + ".json";
    downloadJsonFile(name, data);
    setWordIssueStatus("已导出 " + data.entries.length + " 条本词问题：文件只含词书、词头、来源、备注与时间，不含学习进度、熟练或设置。");
    toast("已导出 " + data.entries.length + " 条本词问题");
    return data;
  }
  /** 关闭详情时清空问题区草稿/上下文；不动存储，不阻断关闭。 */
  function resetWordIssueSurface(){
    wordIssueContext = null;
    wordIssueDirty = false;
    const noteEl = $("#wordIssueNote");
    if (noteEl) noteEl.value = "";
    setWordIssueStatus("");
  }

  function openHelp(){
    renderHelp();
    openSheet("#helpSheet");
  }
  function closeHelp(){
    closeSheet();
  }
  function renderWordDetail(){
    const i = detailWord, x = W[i];
    if (!x) return;
    const pron = pronHtml(x);
    const titleEl = $("#wordTitle");
    if (titleEl) {
      titleEl.textContent = x.w;
      // 详情词头是英文单词：标 lang=en 供读屏切换语言（中文释义/来源不继承英文）。
      titleEl.setAttribute?.("lang", "en");
    }
    $("#wordDetail").innerHTML =
      '<div class="tagrow"><span class="tag">词频 #' + x.r + '</span><span class="tag">' + x.f + ' 次 / ' + x.c + ' 套卷</span>' +
      '<span class="tag pos-tag">' + esc(poslineText(x)) + '</span>' +
      '<span class="tag ' + (isProficient(i) ? "badge-proficient" : "") + '">' + esc(isProficient(i) ? "熟练 · 已移出背诵" : stageLabel(st(i) ? st(i)[0] : 0)) + '</span>' + wordBookTags(x.w) + '</div>' +
      '<p class="storage-note">' + esc(wordReviewLabel(i)) + '</p>' +
      (pron ? '<div class="ph">' + pron + '</div>' : '') +
      '<div class="mean">' + meaningHtml(x) + '</div>' +
      (x.ex ? '<div class="ex" lang="en" data-ex-linked="1" tabindex="0" role="group" aria-expanded="false" aria-label="例句，左右方向键选词，回车查义">' + exHtml(x.ex, x) + '<span class="src" lang="zh-CN">— ' + esc(srcBadge(x.src)) + '</span></div>'
        : '<div class="ex ex-empty">暂无例句，可先记住释义与词形。</div>') +
      (x.fm ? '<div class="fm">词形：' + esc(x.fm) + '</div>' : '');
    bindExLookup($("#wordDetail"));
    $("#wordActions").innerHTML =
      '<button type="button" class="btn proficient" id="detailProficient">' + (isProficient(i) ? "取消熟练" : "标为熟练") + '</button>' +
      '<button type="button" class="btn ghost" id="detailStar">' + (isStar(i) ? "取消收藏" : "收藏") + '</button>' +
      '<button type="button" class="btn ghost" id="detailSpeak">发音</button>';
    $("#detailProficient").onclick = () => { setProficient(i, !isProficient(i)); renderWordDetail(); $("#detailProficient").focus?.(); };
    $("#detailStar").onclick = () => { toggleStar(i); applyFilter(false); renderWordDetail(); $("#detailStar").focus?.(); };
    $("#detailSpeak").onclick = () => speak(x.w);
    fitWord($("#wordTitle"));
    // H：本词问题区（独立键，只读写自己的存储；不写学习进度/熟练/备份）。
    renderWordIssueBlock();
  }
  function openWord(i){
    if (!W[i]) return;
    detailWord = i;
    renderWordDetail();
    openSheet("#wordSheet");
  }

  /* ================= 视图 ================= */
  function show(v){
    cancelInputGesture();
    if (v !== "set" && rebinding) { rebinding = null; renderKeys(); }
    const wasList = $("#v-list").classList.contains("on");
    if (wasList && v !== "list") saveListUi();
    const main = $("#main"), changingView = !$("#v-" + v).classList.contains("on");
    if (v !== "study" && $("#v-study").classList.contains("on") && cur != null) {
      studyReadingScroll = {book: currentBookId, word: cur, plan: sessionPlan, top: main.scrollTop || 0};
    }
    // 其他页从顶部开始；返回同词同组时，末尾恢复学习页自己的阅读位置。
    if (changingView) main.scrollTop = 0;
    $$(".view").forEach(x => x.classList.remove("on"));
    $("#v-" + v).classList.add("on");
    $$(".nav button").forEach(b => {
      b.classList.toggle("on", b.dataset.v === v);
      if (b.dataset.v === v) b.setAttribute?.("aria-current", "page");
      else b.removeAttribute?.("aria-current");
    });
    $("#main").classList.toggle("wide", v !== "study");
    // 22：只有可见的背诵完成页参与自动续背；切到其他视图立即停止等待/倒计时，不抢焦点。
    if (v === "study") {
      autoResumeIdleSince = null;
      renderAutoResume();
      renderResumeNotice();
    } else {
      autoResumeEmptyWaitBook = null; // 离开本页等待流程，需要回来后再次明确选择
      dismissResumeNotice();   // 15：切换页面=明确退出恢复现场；已恢复的学习记录不丢
      if (autoResumePhase !== "idle" || autoResumeIdleSince !== null) {
        autoResumePhase = "idle";
        autoResumeDeadline = 0;
        autoResumeIdleSince = null;
        renderAutoResume();
      }
    }
    if (v === "study") { fitVisibleWords(); renderCapSurfaces(); }
    updateScopeCount();
    if (v === "list") {
      // 首次进入且尚无保存状态时，尊重当前控件值（例如从统计页点「到期词」预设的筛选）。
      if (!wasList && listUiByBook[currentBookId]) restoreListUi(currentBookId);
      applyFilter(false);
      announceListRow();
    }
    if (v === "stats") renderStats();
    if (v === "set") { bindSet(); syncSettingsNav(); }
    // 11 首屏提示条只在背诵页显示（不占 #v-study 网格行，避免挤压卡片与操作区）。
    renderGuideBanner();
    updateBar();
    if (v === "study" && changingView && studyReadingScroll
        && studyReadingScroll.book === currentBookId && studyReadingScroll.word === cur
        && studyReadingScroll.plan === sessionPlan) main.scrollTop = studyReadingScroll.top;
  }
  function updateBar(){
    const v = $(".view.on");
    const id = v && v.id ? v.id.replace("v-", "") : "study";
    let pct = 0;
    if (id === "study") {
      pct = groupTotal ? Math.round(Math.min(answered, groupTotal) / groupTotal * 100) : 0;
    } else {
      const tot = Math.max(1, inScopeCount());
      pct = Math.round(scopedMasteredCount() / tot * 100);
    }
    const bar = $("#bar");
    if (bar) bar.style.width = pct + "%";
  }

  /* ================= Toast / 持续错误提示 ================= */
  let tt = null;
  function toast(m){
    const t = $("#toast");
    t.textContent = m;
    t.classList.add("on");
    clearTimeout(tt);
    tt = setTimeout(() => t.classList.remove("on"), 2200);
  }
  function showAlert(title, body, opts){
    opts = opts || {};
    const el = $("#appAlert");
    if (!el) { toast(title + "：" + body); return; }
    el.dataset.kind = opts.kind || "general";
    const titleEl = $("#appAlertTitle"), bodyEl = $("#appAlertBody"), actions = $("#appAlertActions");
    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.textContent = body;
    if (actions) {
      actions.innerHTML = "";
      const add = (label, fn, primary) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "btn sm " + (primary ? "primary" : "ghost");
        b.textContent = label;
        b.onclick = fn;
        actions.appendChild(b);
      };
      if (opts.recover) add("恢复导入前记录", recoverImportJournal, true);
      if (opts.prefRecover) add("恢复偏好归属", () => {
        if (!recoverPreferenceJournal()) {
          toast("偏好归属恢复日志无法读取或写入，请先导出救援备份");
          return;
        }
        initDevicePreferences(true);
        load();
        applyTheme(); bindSet(); applyFilter(false); renderStats(); startSession(); updateBar(); renderBookList();
        el.hidden = true;
        toast("已恢复上次偏好归属修改前的状态");
      }, true);
      if (opts.rescue) add("救援导出", exportRescueBackup, true);
      if (opts.export) add("导出备份", exportBackupFile, !opts.rescue && !opts.recover);
      add("关闭", () => { el.hidden = true; }, false);
    }
    el.hidden = false;
  }
  function clearAlert(kind){
    const el = $("#appAlert");
    if (!el) return;
    if (kind && el.dataset.kind !== kind) return;
    el.hidden = true;
    el.dataset.kind = "";
  }

  /* ================= 13 离线与更新状态（真实 Service Worker 事件） =================
   * 状态只来自 navigator.serviceWorker.register() 结果与 installing/waiting/active、
   * updatefound、statechange、controllerchange、ready、controller；
   * 「注册成功」不等于「已离线」：首装未受控时只说明缓存已就绪、重开页面后由缓存提供。
   * 保持 sw.js 整组发布契约不变：不在这里 skipWaiting、不自动刷新、不弹强制升级。
   */
  const OFFLINE_TEXT = {
    init: "正在检查离线缓存…",
    registering: "资源准备中：正在注册离线缓存…",
    installing: "资源准备中：正在缓存页面与词库，完成后可在断网时打开。",
    "ready-uncontrolled": "资源已缓存；重新打开本页面后就会由缓存提供（当前页面尚未受缓存控制）。",
    ready: "已可离线：当前页面已由缓存提供，断网也能打开本页。",
    "update-waiting": "更新已下载，等待所有旧页面关闭后启用；关闭其他标签页并重新打开本页即可完成更新（不会自动刷新）。",
    failed: "离线准备失败",
    file: "当前是直接双击打开的本地文件（file://），浏览器不会注册离线缓存。建议用本地静态服务打开（例如在项目目录运行 python3 -m http.server）后再使用离线。",
    unsupported: "当前浏览器不支持离线缓存；联网时可正常学习，学习记录与发音不受影响。"
  };
  let offlineState = null;
  function pageProtocol(){
    try {
      if (typeof location !== "undefined" && location && typeof location.protocol === "string") return location.protocol;
    } catch (e) { /* ignore */ }
    try {
      if (typeof window !== "undefined" && window.location && typeof window.location.protocol === "string") return window.location.protocol;
    } catch (e) { /* ignore */ }
    return "";
  }
  function offlineServiceWorker(){
    try {
      if (typeof navigator !== "undefined" && navigator && navigator.serviceWorker) return navigator.serviceWorker;
    } catch (e) { /* ignore */ }
    try {
      if (typeof window !== "undefined" && window.navigator && window.navigator.serviceWorker) return window.navigator.serviceWorker;
    } catch (e) { /* ignore */ }
    return null;
  }
  function ensureOfflineState(){
    if (offlineState) return offlineState;
    offlineState = {
      started: false,
      supported: !!offlineServiceWorker(),
      file: pageProtocol() === "file:",
      status: "init",
      controlled: false,
      waiting: false,
      assetsReady: false,
      error: "",
      registration: null,
      trackedWorkers: new Set(),
      registerCalls: 0
    };
    return offlineState;
  }
  function offlineStateText(st){
    st = st || ensureOfflineState();
    if (st.status === "failed") {
      return OFFLINE_TEXT.failed + (st.error ? "：" + st.error : "") + "；联网仍可正常学习，可点「重试」重新准备。";
    }
    return OFFLINE_TEXT[st.status] || OFFLINE_TEXT.init;
  }
  /** 设置页离线状态区渲染（节点缺失时跳过；不弹窗、不刷新、不重建当前卡）。 */
  function renderOfflineStatus(){
    const st = ensureOfflineState();
    const el = $("#offlineStatus");
    if (el) {
      el.textContent = offlineStateText(st);
      el.dataset.state = st.status;
    }
    const badge = $("#offlineBadge");
    if (badge) {
      const label = st.status === "ready" ? "已可离线"
        : st.status === "ready-uncontrolled" ? "缓存已就绪"
        : st.status === "update-waiting" ? "更新等待启用"
        : st.status === "failed" ? "准备失败"
        : st.status === "file" ? "file:// 模式"
        : st.status === "unsupported" ? "不支持离线缓存"
        : "准备中";
      badge.textContent = label;
    }
    const retry = $("#offlineRetry");
    if (retry) retry.hidden = !(st.status === "failed" && !st.file && st.supported);
  }
  function offlineFail(err){
    const st = ensureOfflineState();
    st.status = "failed";
    st.error = err && err.message ? String(err.message) : "未知错误";
    renderOfflineStatus();
  }
  function attachOfflineWorker(worker){
    const st = ensureOfflineState();
    if (!worker || st.trackedWorkers.has(worker)) return;
    st.trackedWorkers.add(worker);
    if (worker.state === "installing") st.status = "installing";
    if (typeof worker.addEventListener === "function") {
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" || worker.state === "activated") st.assetsReady = true;
        refreshOfflineFromRegistration();
      });
    }
  }
  function attachOfflineRegistration(reg){
    const st = ensureOfflineState();
    if (!reg) { offlineFail(new Error("注册结果为空")); return; }
    st.registration = reg;
    const sw = offlineServiceWorker();
    st.controlled = !!(sw && sw.controller);
    if (typeof reg.addEventListener === "function") {
      reg.addEventListener("updatefound", () => {
        attachOfflineWorker(reg.installing);
        refreshOfflineFromRegistration();
      });
    }
    attachOfflineWorker(reg.installing);
    attachOfflineWorker(reg.waiting);
    attachOfflineWorker(reg.active);
    try {
      if (sw && sw.ready && typeof sw.ready.then === "function") {
        sw.ready.then(() => { st.assetsReady = true; refreshOfflineFromRegistration(); }).catch(() => {});
      }
    } catch (e) { /* ignore */ }
    refreshOfflineFromRegistration();
  }
  /** 仅根据真实注册对象/controller 推状态；等待中的新版本优先于「已就绪」。 */
  function refreshOfflineFromRegistration(){
    const st = ensureOfflineState();
    if (!st.started || st.file || !st.supported || st.status === "failed") return;
    const sw = offlineServiceWorker();
    const reg = st.registration;
    st.controlled = !!(sw && sw.controller);
    st.waiting = !!(reg && reg.waiting);
    if (st.waiting) {
      st.status = "update-waiting";
    } else if (reg && reg.installing && !st.assetsReady) {
      st.status = "installing";
    } else if (st.assetsReady || (reg && (reg.active && !reg.installing))) {
      st.status = st.controlled ? "ready" : "ready-uncontrolled";
    } else {
      st.status = "registering";
    }
    st.error = "";
    renderOfflineStatus();
  }
  function registerOfflineWorker(){
    const st = ensureOfflineState();
    const sw = offlineServiceWorker();
    if (!sw || typeof sw.register !== "function") { offlineFail(new Error("浏览器未提供 Service Worker 注册接口")); return; }
    st.status = "registering";
    st.error = "";
    st.registerCalls++;
    renderOfflineStatus();
    let result;
    try { result = sw.register("sw.js"); }
    catch (e) { offlineFail(e); return; }
    if (result && typeof result.then === "function") {
      result.then(reg => attachOfflineRegistration(reg)).catch(err => offlineFail(err));
    } else {
      attachOfflineRegistration(result);
    }
  }
  /** 启动时一次：file:// 不注册并说明；不支持时说明；其余注册并跟踪事件。 */
  function initOfflineStatus(){
    const st = ensureOfflineState();
    if (st.started) return st;
    st.started = true;
    if (st.file) { st.status = "file"; renderOfflineStatus(); return st; }
    if (!st.supported) { st.status = "unsupported"; renderOfflineStatus(); return st; }
    try {
      const sw = offlineServiceWorker();
      if (sw && typeof sw.addEventListener === "function") {
        sw.addEventListener("controllerchange", () => {
          if (!offlineState) return;
          offlineState.controlled = true;
          refreshOfflineFromRegistration();
        });
      }
    } catch (e) { /* ignore */ }
    registerOfflineWorker();
    return st;
  }
  /** 失败后的显式重试（只重新注册，不 skipWaiting、不刷新页面）。 */
  function retryOfflineStatus(){
    const st = ensureOfflineState();
    if (st.file || !st.supported) { renderOfflineStatus(); return false; }
    st.status = "registering";
    st.error = "";
    st.registration = null;
    st.assetsReady = false;
    st.waiting = false;
    st.trackedWorkers = new Set();
    renderOfflineStatus();
    registerOfflineWorker();
    return true;
  }
  function getOfflineStatus(){
    const st = ensureOfflineState();
    return {
      status: st.status,
      supported: st.supported,
      file: st.file,
      controlled: st.controlled,
      waiting: st.waiting,
      assetsReady: st.assetsReady,
      error: st.error,
      text: offlineStateText(st),
      hasRegistration: !!st.registration,
      registerCalls: st.registerCalls
    };
  }

  /* ================= 13 备份状态（低打扰本地提醒） =================
   * 导出只读契约不变：只在下载触发成功后写独立 localStorage 键，不修改内存学习记录。
   * 下载触发不等于文件已被妥善保管，因此文案不出现「已安全备份」。
   */
  function readLastExport(){
    try {
      const raw = localStorage.getItem(LAST_EXPORT_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      const at = o && typeof o.at === "string" ? o.at : "";
      if (!at) return null;
      const d = new Date(at);
      if (Number.isNaN(d.getTime())) return null;
      return { at: at, time: d.getTime(), version: o && typeof o.version === "number" ? o.version : null };
    } catch (e) { return null; }
  }
  /** 是否已有主学习记录（只读；用于决定提醒语气）。 */
  function hasAnyMainProgress(){
    try {
      for (const k of Object.keys(S.progress || {})) {
        if (hasMainProgress(S.progress[k])) return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }
  function backupStatusText(){
    const last = readLastExport();
    const learned = hasAnyMainProgress();
    const parts = ["学习记录只保存在当前浏览器，清除网站数据或更换浏览器后不会自动恢复。"];
    if (last) {
      const days = Math.max(0, Math.floor((Date.now() - last.time) / 86400000));
      parts.push("上次导出：" + formatBackupTime(last.at)
        + "（" + (days === 0 ? "今天" : days + " 天前") + "；下载已发起，请确认文件已妥善保存）");
      if (learned && days >= 30) parts.push("距上次导出已超过 30 天，建议再导出一份进度备份。");
    } else {
      parts.push("尚未导出过进度备份。");
      if (learned) parts.push("当前已有学习记录，建议在统计页先导出一份进度备份。");
    }
    return parts.join(" ");
  }
  function renderBackupStatus(){
    const el = $("#backupStatus");
    if (!el) return;
    el.textContent = backupStatusText();
  }
  function recordLastExport(data){
    const at = new Date().toISOString();
    try {
      localStorage.setItem(LAST_EXPORT_KEY, JSON.stringify({ at: at, version: data && typeof data.version === "number" ? data.version : 3 }));
    } catch (e) { /* 存储不可用时不影响导出本身 */ }
    renderBackupStatus();
    return at;
  }
  function getBackupStatus(){
    const last = readLastExport();
    return {
      key: LAST_EXPORT_KEY,
      exists: !!last,
      at: last ? last.at : null,
      time: last ? last.time : null,
      version: last ? last.version : null,
      text: backupStatusText()
    };
  }

  function downloadJsonFile(name, data){
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove?.();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  function exportBackupFile(){
    try {
      const data = buildExport();
      downloadJsonFile("背词进度_" + todayStr() + ".json", data);
      // 13：仅在下载触发成功后记录时间；导出只读契约不变（不修改内存学习记录）。
      recordLastExport(data);
      if (data.warnings && data.warnings.length) {
        showAlert("备份已导出，但有提醒", warningIds(data.warnings) + "。当前文件已包含全部可读取的词书。", {kind: "export"});
      } else {
        clearAlert("export");
        toast("进度备份已导出");
      }
      return data;
    } catch (err) {
      if (err && err.corrupted) {
        showAlert("无法常规导出", err.message, {kind: "export", rescue: true});
      } else {
        showAlert("导出失败", (err && err.message ? err.message : "未知错误") + "。现有记录未改动。", {kind: "export", export: true});
      }
      return null;
    }
  }
  function exportRescueBackup(){
    try {
      const data = buildRescueExport();
      downloadJsonFile("背词救援_" + todayStr() + ".json", data);
      showAlert("救援备份已导出", "文件包含正常词书与损坏词书的原始文本，但不能直接导入。请保留原文件，并在修复或重新导出正常备份前不要重置损坏词书。", {kind: "export"});
      return data;
    } catch (err) {
      showAlert("救援导出失败", (err && err.message ? err.message : "浏览器存储不可用") + "。请尝试复制浏览器存储或更换环境。", {kind: "export"});
      return null;
    }
  }

  /* ================= 导入确认 ================= */
  let pendingImport = null;
  function formatBackupTime(iso){
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso || "未记录";
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function renderImportPlan(plan){
    const summary = $("#importSummary");
    if (summary) {
      summary.textContent = (plan.version === 1 ? "旧版备份（v1）" : "备份 v" + plan.version)
        + " · " + (plan.exportedAt ? "导出于 " + formatBackupTime(plan.exportedAt) : "未记录导出时间")
        + " · 备份时词书：" + (plan.activeBook && BOOKS[plan.activeBook] ? BOOKS[plan.activeBook].name : "未记录");
    }
    const list = $("#importBookList");
    if (list) {
      list.innerHTML = plan.books.map(b =>
        '<div class="import-book"><b>' + esc(b.name) + "</b><span>已学 " + b.learned
        + " 词 · 已掌握 " + b.mastered + " 词 · 将替换本机同名记录</span></div>"
      ).join("");
    }
    const scope = $("#importScopeNote");
    if (scope) {
      scope.textContent = "导入会替换上述词书的学习记录、设置、收藏与每日统计；本机已有熟练标记会保留，其他词书不变。"
        + (plan.kind === "legacy" ? "旧版备份只恢复考研记录。" : "");
    }
  }
  function openImportConfirm(o){
    try {
      const plan = prepareImportPlan(o);
      pendingImport = {data: o, plan: plan};
      renderImportPlan(plan);
      openSheet("#importSheet");
    } catch (err) {
      pendingImport = null;
      showAlert("无法导入备份", (err && err.message ? err.message : "文件格式不正确") + "。现有记录未改动。", {kind: "import"});
    }
  }

  /* ================= 手势：可关闭、反转及分阶段映射 ================= */
  let cancelActiveInputGesture = null;
  function cancelInputGesture(){if(cancelActiveInputGesture)cancelActiveInputGesture();}
  function bindSwipe(){
    const card=$("#card");
    let tracking=null;
    const cancel=()=>{tracking=null;};
    cancelActiveInputGesture=cancel;
    const hasSelection=()=>Boolean(window.getSelection?.()?.toString());
    card.addEventListener("pointerdown",e=>{
      cancel();
      if(!S.settings.gestures.enabled || !["touch","pen"].includes(e.pointerType) || e.isPrimary===false
        || (e.button!=null && e.button!==0) || e.target.closest?.("button,input,select,textarea,a,summary")
        || hasSelection() || cur==null || studyActionBlockedBy(e,null,"gesture"))return;
      tracking={pointerId:e.pointerId,pointerType:e.pointerType,x:e.clientX,y:e.clientY,book:currentBookId,word:cur,phase,
        qi,revision:inputPreferenceRevision,plan:sessionPlan};
    });
    card.addEventListener("pointerup",e=>{
      const start=tracking;
      if(!start || start.pointerId!==e.pointerId)return;
      cancel();
      if(!S.settings.gestures.enabled || e.pointerType!==start.pointerType || e.isPrimary===false || hasSelection() || cur==null || start.book!==currentBookId
        || start.word!==cur || start.phase!==phase || start.qi!==qi || start.plan!==sessionPlan
        || start.revision!==inputPreferenceRevision || studyActionBlockedBy(e,null,"gesture"))return;
      const dx=e.clientX-start.x,dy=e.clientY-start.y;
      if(Math.abs(dx)<56 || Math.abs(dx)<Math.abs(dy)*1.2)return;
      const action=S.settings.gestures[phase]?.[dx>0?"right":"left"];
      if(action && action!=="none")runStudyAction(action,{event:e,source:"gesture"});
    });
    card.addEventListener("pointercancel",cancel);
    document.addEventListener("pointerdown",e=>{if(tracking && (e.pointerId!==tracking.pointerId || !card.contains?.(e.target)))cancel();},true);
    document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")cancel();});
  }

  /* ================= 全局键盘 ================= */
  // 最后一张的翻页按键只负责结束本组。必须松开后再按一次，才会执行组尾续组/返回。
  let completionKeyRelease = null;
  document.addEventListener("keyup", e => {
    if (completionKeyRelease && (e.code || e.key) === completionKeyRelease) completionKeyRelease = null;
  });
  window.addEventListener?.("blur", () => { completionKeyRelease = null; });
  document.addEventListener("keydown", (e) => {
    if (inputEventIgnored(e) || e.defaultPrevented) return;
    if (rebinding) {
      if(!e.ctrlKey && !e.metaKey && !e.altKey)e.preventDefault();
      captureKey(e);
      return;
    }
    const pop = $("#exPop");
    if (pop && pop.classList && pop.classList.contains("on") && e.key === "Escape") {
      e.preventDefault();
      hideExPop(true);
      return;
    }
    const tag = e.target.tagName;
    if (activeSheet) {
      if (e.key === "Escape" || (activeSheet.id === "helpSheet" && e.key === "?")) {
        e.preventDefault();
        closeSheet();
      } else if (e.key === "Tab") {
        const selector = 'button, input, select, textarea, summary, a[href], [tabindex="0"]';
        const nodes = Array.from(activeSheet.querySelectorAll?.(selector) || [])
          .concat(pop && !pop.hidden ? Array.from(pop.querySelectorAll?.(selector) || []) : [])
          .filter(x => !x.disabled && !x.hidden
            && !x.closest?.("[hidden], [inert]")
            && (!x.getClientRects || x.getClientRects().length > 0));
        if (nodes.length) {
          const first = nodes[0], last = nodes[nodes.length - 1];
          if (e.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))) { e.preventDefault(); first.focus(); }
        }
      }
      return;
    }
    // 查词期间只操作浮层，避免熟练、改判、发音或撤销误作用于背后的学习卡。
    if (pop && !pop.hidden) {
      if (e.key === "Tab") {
        const nodes = Array.from(pop.querySelectorAll?.("button, [tabindex='0']") || [])
          .filter(x => !x.disabled && !x.hidden);
        nodes.unshift(pop);
        if (nodes.length) {
          const first = nodes[0], last = nodes[nodes.length - 1];
          if (e.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) {
            e.preventDefault(); last.focus?.();
          } else if (!e.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))) {
            e.preventDefault(); first.focus?.();
          }
        }
      }
      return;
    }
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
    if(Boolean(window.getSelection?.()?.toString()))return;
    const singleChar=S.settings.singleCharKeys!==false;
    if(singleChar && e.key==="?" && !e.ctrlKey && !e.metaKey && !e.altKey){e.preventDefault();openHelp();return;}
    if((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key||"").toLowerCase()==="z") {
      if($("#v-study").classList.contains("on")){
        const r=runStudyAction("undo",{event:e,source:"keyboard"});
        if(r.ok)e.preventDefault();
      }
      return;
    }
    if(e.ctrlKey || e.metaKey || e.altKey || !$("#v-study").classList.contains("on"))return;
    if((tag==="BUTTON" || tag==="SUMMARY") && (e.key==="Enter" || e.key===" "))return;
    let action=e.key==="Enter"?(cur!=null?"next":completedNextAction()):cur!=null && e.key==="ArrowLeft"?"dont"
      :cur!=null && e.key==="ArrowRight"?"know":singleChar?boundActionForEvent(e):null;
    if(action==="wait" && emptyWaitActive())action="stopWait";
    if(!action)return;
    if (cur == null && completionKeyRelease === (e.code || e.key) && ["continue", "return"].includes(action)) {
      e.preventDefault();
      return;
    }
    const hadCard = cur != null;
    const result=runStudyAction(action,{event:e,source:"keyboard"});
    if (hadCard && cur == null && result.ok) completionKeyRelease = e.code || e.key;
    if(result.ok || ["recall-gate","review-cap","no-change"].includes(result.error))e.preventDefault();
  });

  /* ================= 启动 ================= */
  // O1：先恢复上次未完成的偏好归属事务，再建立设备通用/本书覆盖，最后才 load 主记录并按归属解析。
  try { recoverPreferenceJournal(); } catch (e) { /* 恢复失败在下方提示 */ }
  try { initDevicePreferences(); } catch (e) { /* 不可用时安全降级为每书独立 */ }
  load();
  applyTheme();
  bindSet();
  initPreferenceOwnershipUi();
  initBookPageUi();
  initSettingsWorkspace();
  initInputControls();
  bindReadingLayoutControls();
  bindExLookup($("#card"));
  bindExLookup($("#wordDetail"));
  // 鼠标点击按钮后主动移走焦点：按钮保留焦点时空格/回车会先被浏览器原生激活按钮，
  // 导致点过导航/主题/预设/切书等按钮后无法用空格翻页（真实浏览器回归）。
  // 只处理指针点击（e.detail>0）；键盘触发的 click 保留焦点，兼容键盘操作。浮层内按钮由 closeSheet 管理。
  document.addEventListener("click", (e) => {
    if (!e.detail) return;
    const t = e.target;
    const btn = t && t.closest ? t.closest("button") : null;
    if (btn && !(btn.closest && btn.closest(".sheet"))) btn.blur?.();
  }, true);
  document.addEventListener("click", (e) => {
    const pop = $("#exPop");
    if (!pop || pop.hidden) return;
    const t = e.target;
    if (t && (t.closest && (t.closest(".ex-word") || t.closest("#exPop")))) return;
    hideExPop();
  });
  // 查词浮层固定在视口中；其锚点所在容器一旦滚动，就关闭旧位置的浮层。
  document.addEventListener("scroll", (e) => {
    const pop = $("#exPop");
    if (!pop || pop.hidden || pop === e.target || pop.contains?.(e.target)) return;
    hideExPop();
  }, true);
  window.addEventListener?.("resize", hideExPop);
  window.addEventListener?.("resize", fitVisibleWords);
  window.addEventListener?.("resize", refreshFreqPresentation);
  // 主窗口侧栏变化也会改变可用宽度；字体就绪后重新测量，离线系统字体同样适用。
  if (typeof window.ResizeObserver === "function") {
    let lastWidth = 0;
    const wordResize = new window.ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width !== lastWidth) { lastWidth = width; fitVisibleWords(); refreshFreqPresentation(); }
    });
    wordResize.observe($("#main"));
  }
  document.fonts?.ready?.then(fitVisibleWords);
  document.fonts?.addEventListener?.("loadingdone", fitVisibleWords);
  window.visualViewport?.addEventListener("resize", hideExPop);
  window.visualViewport?.addEventListener("scroll", hideExPop);

  $("#q").addEventListener("input", () => onListFilterControlChanged("q"));
  $("#fst").addEventListener("change", () => {
    if ($("#fst").value === "proficient") $("#fsc").value = "all";
    onListFilterControlChanged("fst");
  });
  $("#fsc").addEventListener("change", () => onListFilterControlChanged("fsc"));
  const dueListBtn = $("#btnDueList");
  if (dueListBtn) dueListBtn.onclick = () => {
    show("list");
    $("#fst").value = "due";
    $("#fsc").value = "scope";
    $("#q").value = "";
    applyFilter();
    const first = $("#listInner")?.querySelector?.('[data-open-word]');
    (first || $("#listScroll"))?.focus?.({preventScroll: true});
  };
  const statsStudyBtn = $("#btnStatsStudy");
  if (statsStudyBtn) statsStudyBtn.onclick = () => {
    show("study");
    $("#card").focus?.({preventScroll: true});
  };

  $("#listScroll").addEventListener("scroll", () => { saveListUi(); renderRows(); });
  $("#listInner").addEventListener("keydown", navigateList);
  $("#listInner").addEventListener("focusin", (e) => {
    const t = e.target;
    if (t?.dataset?.openWord !== undefined) {
      listActiveWord = +t.dataset.openWord; listActiveAction = "open-word";
    } else if (t?.dataset?.proficient !== undefined) {
      listActiveWord = +t.dataset.proficient; listActiveAction = "proficient";
    } else if (t?.dataset?.rowCheck !== undefined) {
      listActiveWord = +t.dataset.rowCheck; listActiveAction = "row-check";
    } else return;
    announceListRow(); saveListUi();
  });
  bindStatsChart("#days", "[data-day-label]", "#daysHint");
  bindStatsChart("#forecast", "[data-fc-label]", "#forecastHint");
  bindStatsChart("#stages", "[data-stage-label]", "#stagesHint");
  bindStatsChart("#heatmap", ".hm-cell", "#heatmapTip", true);
  window.addEventListener?.("resize", syncStatsChartHints);
  const clearFilters = $("#clearListFilters");
  if (clearFilters) clearFilters.onclick = () => {
    if (statsDrill) exitStatsDrill({restore: true, render: false});
    listSelection.clear();
    listBatchPreview = null;
    $("#q").value = "";
    $("#fst").value = "all";
    $("#fsc").value = "all";
    applyFilter();
    $("#q").focus?.({preventScroll: true});
  };
  $("#listInner").addEventListener("click", (e) => {
    const check = e.target.closest?.("[data-row-check]");
    if (check) {
      toggleListSelection(+check.dataset.rowCheck);
      return;
    }
    const action = e.target.closest("[data-proficient]");
    if (action) {
      const i = +action.dataset.proficient;
      listActiveWord = i; listActiveAction = "proficient";
      setProficient(i, !isProficient(i));
      return;
    }
    const r = e.target.closest(".row");
    if (!r) return;
    listActiveWord = +r.dataset.i; listActiveAction = "open-word";
    announceListRow();
    openWord(+r.dataset.i);
  });

  /* ---- E 词表整理：视图菜单 / 整理模式 / 批量操作 / 统计下钻入口与返回 ---- */
  const toggleOrganizeBtn = $("#btnToggleOrganize");
  if (toggleOrganizeBtn) toggleOrganizeBtn.onclick = () => { if (listOrganize) exitListOrganize(); else enterListOrganize(); };
  const exitOrganizeBtn = $("#btnExitOrganize");
  if (exitOrganizeBtn) exitOrganizeBtn.onclick = exitListOrganize;
  const selectAllBtn = $("#btnSelectAllFiltered");
  if (selectAllBtn) selectAllBtn.onclick = selectAllFilteredList;
  const clearSelectionBtn = $("#btnClearSelection");
  if (clearSelectionBtn) clearSelectionBtn.onclick = clearListSelection;
  const batchStarBtn = $("#btnBatchStar");
  if (batchStarBtn) batchStarBtn.onclick = () => batchSetStar(true);
  const batchUnstarBtn = $("#btnBatchUnstar");
  if (batchUnstarBtn) batchUnstarBtn.onclick = () => batchSetStar(false);
  const batchProfBtn = $("#btnBatchProficient");
  if (batchProfBtn) batchProfBtn.onclick = () => openBatchProficiencyPreview(true);
  const batchUnprofBtn = $("#btnBatchUnproficient");
  if (batchUnprofBtn) batchUnprofBtn.onclick = () => openBatchProficiencyPreview(false);
  const batchConfirmBtn = $("#btnBatchConfirm");
  if (batchConfirmBtn) batchConfirmBtn.onclick = confirmListBatchProficiency;
  const batchCancelBtn = $("#btnBatchCancel");
  if (batchCancelBtn) batchCancelBtn.onclick = () => { listBatchPreview = null; renderListOrganizeBar(); };
  const saveListViewBtn = $("#btnSaveListView");
  if (saveListViewBtn) saveListViewBtn.onclick = saveCurrentListView;
  const resetListViewsBtn = $("#btnResetListViews");
  if (resetListViewsBtn) resetListViewsBtn.onclick = resetListViewStore;
  const listViewNameInput = $("#listViewName");
  if (listViewNameInput) listViewNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); saveCurrentListView(); }
  });
  const viewsMenu = $("#listViewsMenu");
  if (viewsMenu) {
    viewsMenu.addEventListener("toggle", () => {
      if (viewsMenu.open) {
        listViewDirty = true;
        renderListViewRows();
      }
    });
    viewsMenu.addEventListener("click", (e) => {
      const applyView = e.target.closest?.("[data-view-apply]");
      if (applyView) { applySavedListView(applyView.dataset.viewApply); return; }
      const renameView = e.target.closest?.("[data-view-rename]");
      if (renameView) { renameSavedListView(renameView.dataset.viewRename); return; }
      const deleteView = e.target.closest?.("[data-view-delete]");
      if (deleteView) deleteSavedListView(deleteView.dataset.viewDelete);
    });
    viewsMenu.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const input = e.target.closest?.("[data-view-rename-input]");
      if (input) {
        e.preventDefault();
        renameSavedListView(input.dataset.viewRenameInput);
      }
    });
  }
  const backToStatsBtn = $("#btnBackToStats");
  if (backToStatsBtn) backToStatsBtn.onclick = returnFromStatsDrill;
  const drillDueDayBtn = $("#btnDrillDueDay");
  if (drillDueDayBtn) drillDueDayBtn.onclick = drillDueDay;
  const drillStageBtn = $("#btnDrillStage");
  if (drillStageBtn) drillStageBtn.onclick = drillStage;
  const freqMasteryEl = $("#freqMastery");
  if (freqMasteryEl) freqMasteryEl.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-drill-freq]");
    if (btn && !btn.disabled) drillFreqTier(btn.dataset.drillFreq);
  });

  $$("#presets button").forEach(b => {
    b.onclick = () => {
      $("#fmin").value = b.dataset.fmin;
      $("#fmax").value = b.dataset.fmax || "";
      if (b.dataset.pmin !== undefined) $("#pmin").value = b.dataset.pmin;
      onSet(); bindSet(); applyFilter(); renderStats();
      toast("已设为 " + b.textContent);
    };
  });
  function applyComboFilters(c){
    const d = DEF.settings;
    if (c === "core") {
      S.settings.fmin = 5; S.settings.fmax = 0; S.settings.pmin = 3;
      S.settings.kyOnly = false; S.settings.pos = [];
    } else if (c === "cold") {
      S.settings.fmin = 1; S.settings.fmax = 2; S.settings.pmin = 0;
      S.settings.kyOnly = false; S.settings.pos = [];
    } else if (c === "adj") {
      S.settings.fmin = 1; S.settings.fmax = 0; S.settings.pmin = 0;
      S.settings.kyOnly = false; S.settings.pos = ["a"];
    } else {
      S.settings.fmin = d.fmin; S.settings.fmax = d.fmax; S.settings.pmin = d.pmin;
      S.settings.kyOnly = d.kyOnly; S.settings.pos = [];
    }
  }
  $$("[data-combo]").forEach(b => {
    b.onclick = () => {
      const moveFocus = b.closest?.("#scopeEmpty") && document.activeElement === b;
      // 08：「恢复默认筛选」属于范围类恢复；其余组合只改设置，不重建当前组。
      if (b.dataset.combo === "reset") resetSettingsClass("scope");
      else {
        applyComboFilters(b.dataset.combo);
        settingsChangedSurfaces();
      }
      bindSet(); applyFilter(); renderStats(); markSettingsSaved();
      if (moveFocus) $("#btnStartFromSettings")?.focus?.({preventScroll: true});
      toast(b.dataset.combo === "reset" ? "已恢复默认筛选" : "已应用：" + b.textContent);
    };
  });
  $$("#themeSeg button").forEach(b => {
    b.onclick = () => {
      S.settings.theme = b.dataset.theme;
      save(); applyTheme();
      toast("主题：" + b.textContent);
      markSettingsSaved();
    };
  });
  // 12 阅读字号：外观偏好即时生效，不在「只应用到下一组」的判断里。
  $$("#fontSizeSeg [data-font-size]").forEach(b => {
    b.onclick = () => {
      const r = setFontSize(b.dataset.fontSize);
      if (r.ok) toast(r.size === "large" ? "已切换到大字阅读" : "已切换回标准字号");
      applyFontSize();
    };
  });
  const speechSelectEl = $("#voiceSelect");
  if (speechSelectEl) speechSelectEl.addEventListener("change", () => {
    setVoiceURI(speechSelectEl.value);
    toast("已更新发音语音偏好");
  });
  const speechRateEl = $("#speechRate");
  if (speechRateEl) {
    speechRateEl.addEventListener("input", () => {
      const val = normalizeSpeechRate(speechRateEl.value);
      const out = $("#speechRateVal");
      if (out) out.textContent = val.toFixed(2) + "×";
    });
    speechRateEl.addEventListener("change", () => {
      setSpeechRate(speechRateEl.value);
      toast("语速已设为 " + normalizeSpeechRate(speechRateEl.value).toFixed(2) + "×");
    });
  }
  const voiceTestEl = $("#btnVoiceTest");
  if (voiceTestEl) voiceTestEl.onclick = () => speak(speechTestText());
  // voices 可能延迟到达：监听 voiceschanged 刷新可选项与提示（不阻塞学习）。
  try {
    const speech = speechApi();
    if (speech && typeof speech.addEventListener === "function") {
      speech.addEventListener("voiceschanged", () => { refreshSpeechVoices(); });
    }
  } catch (e) { /* 不支持 voiceschanged 的浏览器忽略 */ }
  refreshSpeechVoices();
  function applySettingsControl(){
    // 设置仍即时自动保存；onSet 只更新预览/提示，不重建当前组（08）。
    onSet(); bindSet(); applyFilter(); renderStats(); renderCard();
  }
  $$("[data-step-target]").forEach(b => {
    b.onclick = () => {
      const input = $("#" + b.dataset.stepTarget);
      if (!input) return;
      const fallback = b.dataset.stepTarget === "dailyNew" ? DEF.settings.dailyNew : 0;
      const value = input.value === "" ? fallback : Number(input.value);
      input.value = Math.max(+input.min, Math.min(+input.max, value + +b.dataset.stepDir * (+input.step || 1)));
      applySettingsControl();
    };
  });
  const startFromSettings = $("#btnStartFromSettings");
  if (startFromSettings) startFromSettings.onclick = () => show("study");
  $$(".settings-nav a").forEach(a => {
    a.onclick = (e) => {
      const target = $(a.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView?.({block: "start", behavior: "auto"});
      target.tabIndex = -1;
      target.focus?.({preventScroll: true});
      syncSettingsNav();
    };
  });
  let settingsNavFrame = false;
  // 09：页头副标题与学习页上下文条的范围摘要都进入设置页「词库范围」。
  ["#scopeLabel", "#studyScope"].forEach(sel => {
    const el = $(sel);
    if (el) el.onclick = jumpToScopeSettings;
  });
  // 统计面板默认展开；旧偏好优先。展开/收起后重新测量横向滑动提示。
  applyStatsPanelPrefs();
  initStatsPanelOrdering();
  $$("#v-stats details.stats-details").forEach(d => {
    d.addEventListener("toggle", () => { syncStatsChartHints(); persistStatsPanels(); });
  });
  $("#main").addEventListener("scroll", () => {
    if (settingsNavFrame || !$("#v-set")?.classList.contains("on")) return;
    settingsNavFrame = true;
    const schedule = window.requestAnimationFrame || ((fn) => fn());
    schedule(() => { settingsNavFrame = false; syncSettingsNav(); });
  }, {passive: true});
  ["dailyNew","order","fmin","fmax","pmin","kyOnly","showPh","showEx","showFm","autoSpk","singleCharKeys","groupSize","backlogGuard"].forEach(id => {
    const el = $("#" + id);
    if (el) el.addEventListener("change", applySettingsControl);
  });
  // 20 单日复习上限：换成合法值立即保存；非法输入不写入配置，回显当前生效值。
  const reviewCapCustomEl = $("#reviewCapCustom");
  if (reviewCapCustomEl) {
    reviewCapCustomEl.addEventListener("change", () => {
      const raw = reviewCapCustomEl.value;
      if (raw === null || raw === undefined || String(raw).trim() === "") { syncReviewCapControls(); return; }
      const effective = getReviewCap();
      const result = setReviewCap(Number(raw));
      if (!result.ok) reviewCapCustomEl.value = effective > 0 ? String(effective) : "";
      else if (result.cap === 0) reviewCapCustomEl.value = "";
    });
  }
  [["fminRange", "min"], ["fmaxRange", "max"]].forEach(([id, which]) => {
    const el = $("#" + id);
    if (!el) return;
    el.addEventListener("input", () => onFreqRangeInput(which));
    el.addEventListener("change", () => { if (onFreqRangeInput(which) !== false) commitFreqRange(); });
    el.addEventListener("keydown", e => onFreqRangeKey(e, which));
    el.addEventListener("focus", () => setFreqActivity(which));
    el.addEventListener("blur", () => commitFreqRange());
    el.addEventListener("pointerdown", e => startFreqRangeDrag(e, which));
  });
  const freqTrackEl = $("#freqTrack");
  if (freqTrackEl) freqTrackEl.addEventListener("pointerdown", onFreqTrackClick);

  $("#exp").onclick = () => exportBackupFile();
  const exportBookTxtBtn = $("#btnExportBookTxt");
  if (exportBookTxtBtn) exportBookTxtBtn.onclick = () => exportWordBookTxt("scope");
  const exportListTxtBtn = $("#btnExportListTxt");
  if (exportListTxtBtn) exportListTxtBtn.onclick = () => exportWordBookTxt("filter");
  const splitBookTxtBtn = $("#btnSplitBookTxt");
  if (splitBookTxtBtn) splitBookTxtBtn.onclick = () => openTxtSplit("scope");
  const splitListTxtBtn = $("#btnSplitListTxt");
  if (splitListTxtBtn) splitListTxtBtn.onclick = () => openTxtSplit("filter");
  $("#txtSplitAmount")?.addEventListener("input", renderTxtSplit);
  $("#txtSplitMode")?.addEventListener("change", () => {
    if (!txtSplitContext) return;
    $("#txtSplitAmount").value = $("#txtSplitMode").value === "parts" ? String(Math.min(2, txtSplitContext.words.length)) : String(TXT_SPLIT_DEFAULT);
    renderTxtSplit();
  });
  const splitZipBtn = $("#txtSplitZip");
  if (splitZipBtn) splitZipBtn.onclick = downloadTxtSplitZip;
  $("#txtSplitFiles")?.addEventListener("click", e => {
    const btn = e.target.closest?.("[data-txt-part]");
    if (btn) downloadTxtPart(Number(btn.dataset.txtPart));
  });
  const splitPrevBtn = $("#txtSplitPrev"), splitNextBtn = $("#txtSplitNext");
  if (splitPrevBtn) splitPrevBtn.onclick = () => { txtSplitPage--; renderTxtSplitFiles(); };
  if (splitNextBtn) splitNextBtn.onclick = () => { txtSplitPage++; renderTxtSplitFiles(); };
  $$("#txtSplitSheet [data-txt-split-close]").forEach(el => { el.onclick = closeSheet; });
  ["#btnPrintBook", "#btnPrintBookList"].forEach(sel => {
    const el = $(sel);
    if (el) el.onclick = openPrintBook;
  });
  const printSrcEl = $("#printSource");
  if (printSrcEl) printSrcEl.addEventListener("change", () => renderPrintBook());
  const copyMdEl = $("#btnCopyMd");
  if (copyMdEl) copyMdEl.onclick = () => copyPrintMarkdown();
  const doPrintEl = $("#btnDoPrint");
  if (doPrintEl) doPrintEl.onclick = () => { renderPrintBook(); window.print?.(); };
  $$("#printSheet [data-print-close]").forEach(el => { el.onclick = closeSheet; });
  $("#imp").onclick = () => $("#file").click();
  /** 兼容 v1（平铺，按考研书）与 v2/v3（books 分书全量备份）；返回当前书 state */
  function importState(o){
    if (isRecord(o) && (o.version === 2 || o.version === 3)) return importBooksBackup(o);
    return importLegacyV1(o);
  }
  $("#file").onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      showAlert("备份文件过大", "请选择本应用导出的 JSON 进度文件（不超过 10 MB）。现有记录未改动。", {kind: "import"});
      e.target.value = "";
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      let o;
      try { o = JSON.parse(r.result); }
      catch (err) {
        showAlert("文件格式不正确", "无法解析为 JSON。现有进度未改变，请确认选择的是本应用导出的备份。", {kind: "import"});
        return;
      }
      openImportConfirm(o);
    };
    r.onerror = () => showAlert("文件读取失败", "请重新选择备份文件。现有进度未改变。", {kind: "import"});
    r.readAsText(f);
    e.target.value = "";
  };
  $$("#importSheet [data-import-close]").forEach(el => { el.onclick = () => { pendingImport = null; closeSheet(); }; });
  const importConfirmBtn = $("#importConfirm");
  if (importConfirmBtn) importConfirmBtn.onclick = () => {
    if (!pendingImport) return;
    const data = pendingImport.data;
    pendingImport = null;
    closeSheet();
    try {
      importState(data);
      clearAlert("import");
    } catch (err) {
      showAlert("导入失败", (err && err.message ? err.message : "备份无法导入") + "。现有记录已保留。", {kind: "import", export: true});
    }
  };
  $("#rst").onclick = () => {
    const name = currentBook().name;
    if (confirm("确定重置「" + name + "」的学习记录、熟练标记、收藏、抽样统计与设置？此操作只影响当前词书（不是全部词书），且不可撤销。请先导出备份。")) {
      clearAllSessionSnapshots();   // 15：重置后旧会话现场失效
      S = freshState(currentBook());
      resetSurvey();
      blockedBooks.delete(currentBookId);
      const saved = save(true, true);
      // O1：重置本书记录同时清除它的“本书单独”覆盖；设备通用偏好不属于该书记录，保持不动。
      clearBookPreferenceOverrides(currentBookId);
      applyBookPreferenceResolution(S, currentBookId);
      syncLastResolvedPreferences();
      bindSet(); applyFilter(); renderStats(); startSession(); updateBar(); renderBookList();
      toast(saved ? "已重置「" + name + "」的当前词书记录" : "已重置，但未能保存；请检查浏览器存储");
    }
  };
  $("#resetProficient").onclick = () => {
    if (!proficientCount()) { toast("还没有熟练标记"); return; }
    if (confirm("确定清空「" + currentBook().name + "」的全部熟练标记？这些单词将按原学习进度恢复背诵和复习，其他学习记录保留。")) resetProficient();
  };

  $$(".nav button").forEach(b => { b.onclick = () => show(b.dataset.v); });
  $$(".keybtn").forEach(b => {
    b.onclick = () => { rebinding = b.dataset.k; renderKeys(); };
  });
  $("#keyReset").onclick = () => {
    const r=resetInputBindings();
    if(r.ok){rebinding=null;renderKeys();}
    toast(r.ok?"已恢复默认按键；手势、布局与单字符开关保持原值":r.error);
  };

  const themeBtnEl = $("#btnTheme");
  if (themeBtnEl) themeBtnEl.onclick = toggleTheme;
  $("#btnHelp").onclick = openHelp;
  $$("#helpSheet [data-close]").forEach(el => {
    el.onclick = closeHelp;
  });
  // 11 引导：首次提示条按钮、帮助浮层与设置页的「再看一次使用说明」。
  const guideBannerOpenBtn = $("#guideBannerOpen");
  if (guideBannerOpenBtn) guideBannerOpenBtn.onclick = openGuide;
  const guideBannerDismissBtn = $("#guideBannerDismiss");
  if (guideBannerDismissBtn) guideBannerDismissBtn.onclick = dismissGuideBanner;
  const guideFromHelpBtn = $("#btnGuideFromHelp");
  if (guideFromHelpBtn) guideFromHelpBtn.onclick = openGuide;
  const guideReplayBtn = $("#btnReplayGuide");
  if (guideReplayBtn) guideReplayBtn.onclick = openGuide;
  const offlineRetryBtn = $("#offlineRetry");
  if (offlineRetryBtn) offlineRetryBtn.onclick = () => {
    if (retryOfflineStatus()) toast("正在重新准备离线缓存…");
  };
  $$("#guideSheet [data-close]").forEach(el => { el.onclick = closeSheet; });
  $$("#wordSheet [data-word-close]").forEach(el => { el.onclick = closeSheet; });
  // H 本词问题本地记录：详情页保存/删除/复制/导出（独立键，不写学习记录；Esc/Tab 沿用词详情浮层）。
  const wordIssueSaveBtn = $("#wordIssueSave");
  if (wordIssueSaveBtn) wordIssueSaveBtn.onclick = () => { saveDetailWordIssue(); };
  const wordIssueDeleteBtn = $("#wordIssueDelete");
  if (wordIssueDeleteBtn) wordIssueDeleteBtn.onclick = () => { deleteDetailWordIssue(); };
  const wordIssueCopyBtn = $("#wordIssueCopy");
  if (wordIssueCopyBtn) wordIssueCopyBtn.onclick = () => { copyDetailWordIssue(); };
  const wordIssueExportBookBtn = $("#wordIssueExportBook");
  if (wordIssueExportBookBtn) wordIssueExportBookBtn.onclick = () => { exportWordIssuesFile("book"); };
  const wordIssueExportAllBtn = $("#wordIssueExportAll");
  if (wordIssueExportAllBtn) wordIssueExportAllBtn.onclick = () => { exportWordIssuesFile("all"); };
  const wordIssueNoteEl = $("#wordIssueNote");
  if (wordIssueNoteEl) wordIssueNoteEl.addEventListener("input", () => { wordIssueDirty = true; });
  bindSpellingSheet();

  // 词书入口与选择浮层
  const bookBtnEl = $("#btnBooks");
  if (bookBtnEl) bookBtnEl.onclick = openBookSheet;
  $$("#bookSheet [data-close]").forEach(el => { el.onclick = closeSheet; });
  const bookCloseEl = $("#bookClose");
  if (bookCloseEl) bookCloseEl.onclick = closeSheet;
  const bookListEl = $("#bookList");
  if (bookListEl) {
    bookListEl.addEventListener("click", (e) => {
      const t = e.target;
      const item = t && t.closest ? t.closest("[data-book]") : null;
      if (!item) return;
      if (item.getAttribute("data-unavailable")) { toast("该词书数据未载入，暂时无法切换"); return; }
      const id = item.getAttribute("data-book");
      if (id && id !== currentBookId) switchBook(id);
      else if (activeSheet) closeSheet();
    });
  }

  if (!storageOK || blockedBooks.has(currentBookId)) {
    showAlert("已有记录无法读取", "受影响词书：" + currentBook().name
      + "。原因：" + (loadError || "记录格式无法读取")
      + "。已暂停写入以避免覆盖原文件；可导入备份恢复、使用救援导出保留原文，或在统计页显式重置当前词书。",
      {kind: "save", recover: false, export: true, rescue: true});
  }
  try {
    if (localStorage.getItem(JOURNAL_KEY)) {
      showAlert("发现未完成的导入", "上次导入可能在中途中断。可恢复到导入前记录；恢复前不要继续导入或重置词书。",
        {kind: "import", recover: true});
    }
  } catch (e) { /* 存储不可用时已有保存失败提示 */ }
  try {
    if (localStorage.getItem(PREF_JOURNAL_KEY)) {
      showAlert("发现未完成的偏好归属保存", "上次修改“此设备通用/本书单独”可能在中途中断。"
        + "可恢复到修改前状态；恢复前不要继续修改偏好归属或导入备份。",
        {kind: "prefs", prefRecover: true});
    }
  } catch (e) { /* 存储不可用时已有保存失败提示 */ }
  if (prefJournalRecovered) toast("已恢复上次未完成的偏好归属保存");
  if (devicePrefsStatus === "write-failed") {
    toast("偏好归属尚未保存到本机：当前按每书独立显示，可在设置页“偏好归属”处重试保存");
  } else if (defaultBookWriteFailed) {
    toast("下次默认词书未能保存到本机：浏览器存储不可用");
  }

  applyBrand();
  bindSwipe();
  // 15：先尝试恢复未完成组现场，无效则安全开新组（主记录已在 load() 中读取）。
  bootstrapSession();
  renderStats();
  updateBar();
  renderGuideBanner();
  initOfflineStatus();
  // 13 离线状态：页面重新可见/聚焦时按真实注册对象刷新（等待中的更新会在旧页面关闭后变化）。
  window.addEventListener?.("focus", refreshOfflineFromRegistration);
  window.addEventListener?.("pageshow", refreshOfflineFromRegistration);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") refreshOfflineFromRegistration();
  });

  /**
   * 统一恢复入口：跨天、从后台回来、统计页停留跨日都走这里。
   * 只刷新额度/到期/图表，不重建当前卡、判定、特训与撤销历史。
   */
  let lastDay = todayStr();
  function refreshForResume(){
    const today = todayStr();
    const dayChanged = today !== lastDay;
    if (dayChanged) lastDay = today;
    // 20/23 跨天：当日复习台账与临时加量自然归「今日 0」，暂停态随剩余预算恢复；同日刷新不重置。
    if (dayChanged) {
      resetReviewLedgerForToday();
      resetExtraDayForToday();
      // 22 跨天：候选与「今天暂停」都按新日期重算，重新开始闲置等待。
      autoResumeIdleSince = null;
      autoResumeCheckCache = null;
      if (autoResumePhase === "countdown") { autoResumePhase = "idle"; autoResumeDeadline = 0; }
      pruneAutoResumePause();   // A 遗留修复：跨天清除过期的「今天暂停」记录（快照不参与）
    }
    autoResumeCheckCache = null;   // 到期/熟练/额度可能变化：自动续背候选按最新口径重算
    if ($("#v-study").classList.contains("on") && (dayChanged || cur == null)) renderCard();
    renderReviewPlan();
    if ($("#v-stats").classList.contains("on")) renderStats();
    if ($("#v-list").classList.contains("on") && $("#fst").value === "due") applyFilter(false);
    renderCapSurfaces();
    renderAutoResume();
    updateBar();
  }

  /* ================= 22 完成页挂机自动续背 =================
   * 触发条件全部满足才倒计时：kind==="main" 真正完成、无待巩固、非额度暂停、
   * 无浮层/特训/子组、当前在可见的背诵完成页、设置开启、连续 idleMs 无有效交互。
   * 到点前用 candidateStatsNow() 复核「真正可入组数量」≥ threshold，到点后再次复核 + 抢租约；
   * 启动走 refreshForResume() + startSession("main")（应用内刷新，禁止整页 reload）。
   * 不判定、不消费额度、不增加学习时长、不自动提高上限、不循环空开组。
   */
  function currentAutoResume(){ return normalizeAutoResume(S.settings.autoResume, false); }
  /** 读取并缓存 AUTO_RESUME_PAUSE_KEY；损坏/不可读时按空处理，不影响主记录。 */
  function readAutoResumePauseStore(force = false){
    if (autoResumePauseStore.loaded && !force) return autoResumePauseStore.map;
    autoResumePauseStore.loaded = true;
    autoResumePauseStore.readable = false;
    const map = {};
    try {
      const raw = localStorage.getItem(AUTO_RESUME_PAUSE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (isRecord(parsed)) {
        for (const [book, day] of Object.entries(parsed)) {
          if (bookOf(book) && typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)) map[book] = day;
        }
      }
      autoResumePauseStore.readable = true;
    } catch (e) { Object.assign(map, autoResumePauseStore.map); /* 不可读时保留已知暂停，避免错误解除 */ }
    for (const [book, day] of autoResumePausePending) {
      if (day === null) delete map[book];
      else map[book] = day;
    }
    autoResumePauseStore.map = map;
    return map;
  }
  /** 写回暂停键：顺手清理跨天记录；写失败不影响本页内存态（下次判定/刷新前仍生效）。 */
  function writeAutoResumePauseStore(){
    const today = todayStr();
    const map = readAutoResumePauseStore();
    for (const k of Object.keys(map)) if (map[k] !== today) delete map[k];
    try {
      localStorage.setItem(AUTO_RESUME_PAUSE_KEY, JSON.stringify(map));
      autoResumePausePending.clear();
      return true;
    }
    catch (e) { return false; }
  }
  function clearAutoResumePause(bookId){
    const map = readAutoResumePauseStore(true);
    if (!Object.prototype.hasOwnProperty.call(map, bookId)) return false;
    delete map[bookId];
    autoResumePausePending.set(bookId, null);
    writeAutoResumePauseStore();
    return true;
  }
  function pruneAutoResumePause(){
    const today = todayStr();
    const map = readAutoResumePauseStore(true);
    let changed = false;
    for (const k of Object.keys(map)) if (map[k] !== today) {
      delete map[k]; autoResumePausePending.set(k, null); changed = true;
    }
    if (changed) writeAutoResumePauseStore();
  }
  function autoResumePausedToday(){
    const map = readAutoResumePauseStore();
    return map[currentBookId] === todayStr();
  }
  function pauseAutoResumeToday(){
    const map = readAutoResumePauseStore(true);
    map[currentBookId] = todayStr();
    autoResumePausePending.set(currentBookId, todayStr());
    const persisted = writeAutoResumePauseStore();
    autoResumePhase = "paused";
    autoResumeDeadline = 0;
    autoResumeIdleSince = null;
    renderAutoResume();
    toast(persisted
      ? "今天不再自动续背（刷新后仍保持）；需要时仍可手动点「继续下一组」"
      : "今天不再自动续背；浏览器存储不可用，暂停仅本次页面有效");
  }
  /** 只解除本书今日暂停：沿用原方案，不开组、不授予空页等待资格。 */
  function restoreAutoResumeToday(){
    if (!currentAutoResume().enabled) return false;
    const map = readAutoResumePauseStore(true);
    // 失败删除保留 null 覆盖层；再次显式调用可重试落盘，不误报已经持久恢复。
    const pendingClear = autoResumePausePending.has(currentBookId) && autoResumePausePending.get(currentBookId) === null;
    if (map[currentBookId] !== todayStr() && !pendingClear) return false;
    delete map[currentBookId];
    autoResumePausePending.set(currentBookId, null);
    // 无法读到最新 map 时只在本页恢复，避免用旧缓存覆盖另一书的暂停。
    const persisted = autoResumePauseStore.readable && writeAutoResumePauseStore();
    resetAutoResumeRuntime();
    toast(persisted
      ? "已恢复今天自动续背，沿用原方案并重新等待"
      : "已在本页恢复自动续背，沿用原方案；浏览器存储不可用，刷新后可能仍暂停");
    return true;
  }
  /** 主组「真正完成」：无当前卡、非特训/子组、非被额度暂停结束、答过至少一张、无未答位置。 */
  function mainGroupCompletedForAuto(){
    if (cur != null || drillMode || inSubgroup() || capGroupEnded) return false;
    if (!(groupTotal > 0) || !(answered > 0) || qi < Q.length) return false;
    return true;
  }
  /** 普通空页本身没有自动资格；只能由显式选择进入本页等待。 */
  function emptyMainPage(){
    return cur == null && !drillMode && !inSubgroup() && !capGroupEnded
      && groupTotal === 0 && answered === 0 && Q.length === 0 && pendingReinforce() === 0;
  }
  function emptyWaitActive(){ return autoResumeEmptyWaitBook === currentBookId && emptyMainPage(); }
  function startEmptyWait(){
    if (!emptyMainPage() || !$("#v-study")?.classList.contains("on") || document.visibilityState === "hidden") return false;
    if (activeSheet || ($("#exPop") && !$("#exPop").hidden) || ($("#appAlert") && !$("#appAlert").hidden)) return false;
    readAutoResumePauseStore(true);
    if (!currentAutoResume().enabled) { toast("请先开启便捷续背，再开始等待到期"); return false; }
    if (autoResumePausedToday()) { toast("今天已暂停自动续背；进入等待不会解除暂停"); return false; }
    if (autoResumeStorageError || !storageOK || !refreshSharedBeforeNextGroup()) {
      toast("无法安全读取最新记录，暂不能开始等待"); return false;
    }
    if (!emptyMainPage() || !currentAutoResume().enabled || autoResumePausedToday()) return false;
    sessionPlan = null; sessionScopeSet = null; // 0张空组没有需要冻结的学习现场；等待使用当前保存范围
    autoResumeEmptyWaitBook = currentBookId;
    resetAutoResumeRuntime();
    autoResumeIdleSince = Date.now();
    renderCard();
    toast("已开始本页等待；刷新、切书或离开背诵页后退出等待");
    return true;
  }
  function stopEmptyWait(){
    const waiting = autoResumeEmptyWaitBook !== null;
    autoResumeEmptyWaitBook = null;
    resetAutoResumeRuntime();
    if (waiting && cur == null) renderCard();
    return waiting;
  }
  /** 完成页是否满足所有静态前提（可见、无浮层、无待巩固、非额度暂停、主组计划）。 */
  function autoResumeEligiblePage(){
    if (!$("#v-study")?.classList.contains("on")) return false;
    if (document.visibilityState === "hidden") return false;
    const waiting = emptyWaitActive();
    if (!mainGroupCompletedForAuto() && !waiting) return false;
    const plan = activePlan();
    if ((!plan && !waiting) || (plan && plan.kind && plan.kind !== "main")) return false;
    if (pendingReinforce() > 0) return false;
    if (computeCapPaused()) return false;
    if (activeSheet) return false;
    if ($("#exPop") && $("#exPop").hidden === false) return false;
    // 导入/保存失败的持续错误提示期间不自动开组：状态不确定时交给用户手动继续。
    if ($("#appAlert") && $("#appAlert").hidden === false) return false;
    return true;
  }
  /**
   * 候选复核口径与 startSession("main") 一致：
   * 到期优先、受今日剩余复习预算约束；剩余槽位按新词剩余额度补，积压保护生效则不补新词。
   */
  function candidateStatsNow(now){ return readOnlyCandidateStats(now || Date.now()); }
  function getCandidatesNow(){ return candidateStatsNow().available; }
  /** 候选最多缓存30秒，最近到期时刻提前失效；设置/进度/台账变化会主动清空。 */
  function autoResumeStats(now = Date.now()){
    if (!autoResumeCheckCache || now >= autoResumeCacheExpiresAt) {
      autoResumeCheckCache = candidateStatsNow(now);
      autoResumeNextDueAt = reviewPlan(now).next;
      autoResumeCacheExpiresAt = Math.min(now + 30000, autoResumeNextDueAt || Infinity);
    }
    return autoResumeCheckCache;
  }
  /** 未触发/不满足原因文案（完成页状态与只读调试用）。 */
  function autoResumeReasonText(stats, ar){
    if (autoResumePausedToday()) return "今天已暂停自动续背";
    if (autoResumeStorageError) return "浏览器存储不可用，无法安全自动开始；请手动点「继续下一组」";
    const pending = pendingReinforce();
    if (pending > 0) return "本组还有 " + pending + " 张待巩固";
    if (computeCapPaused()) return "今日复习额度已用完（本组暂停）";
    if (stats.capPaused) return "今日复习额度已用完（仍有 " + stats.due + " 张到期）";
    const conflict = autoResumeConfigConflict(ar);
    if (conflict) return conflict;
    if (stats.available <= 0) {
      if (stats.due > 0 || stats.fresh > 0) {
        return "当前范围没有真正可入组的词（受剩余复习预算/新词额度/积压保护限制）";
      }
      return "当前范围没有可背词";
    }
    if (stats.available < ar.threshold) return "候选 " + stats.available + " 张未达阈值 " + ar.threshold + " 张";
    return "";
  }
  /** 完成页自动续背状态区渲染（静态节点；倒计时每秒更新一次）。 */
  function autoResumePanelRelevant(){
    return mainGroupCompletedForAuto() || emptyMainPage();
  }
  function renderAutoResume(){
    const box = $("#autoResume");
    if (!box) return;
    const ar = currentAutoResume();
    const empty = emptyMainPage(), waiting = emptyWaitActive();
    const visible = autoResumePanelRelevant() && $("#v-study")?.classList.contains("on");
    if (!visible) {
      if (!box.hidden) box.hidden = true;
      autoResumeLastRenderKey = "";
      return;
    }
    box.hidden = false;
    const stats = autoResumeStats();
    const paused = autoResumePausedToday();
    let phase = paused ? "paused" : autoResumePhase;
    if (phase === "countdown" && autoResumeDeadline <= Date.now()) phase = "waiting";   // 下一 tick 启动
    const remainSec = phase === "countdown" ? Math.max(0, Math.ceil((autoResumeDeadline - Date.now()) / 1000)) : 0;
    const reason = paused || autoResumeStorageError || phase === "countdown" || stats.available >= ar.threshold
      ? "" : (autoResumeLastReason || autoResumeReasonText(stats, ar));
    const key = [currentBookId, ar.enabled, empty, waiting, phase, remainSec, stats.available, ar.threshold, ar.idleMs, paused,
      autoResumeStorageError, reason].join("|");
    if (key === autoResumeLastRenderKey) return;
    autoResumeLastRenderKey = key;
    autoResumeLastRenderAt = Date.now();
    const text = $("#autoResumeText");
    if (text) {
      let html;
      const counts = "下一组可复习 <b>" + stats.dueActive + "</b> 张 · 新词 <b>" + stats.freshActive + "</b> 张";
      if (empty && !waiting && ar.enabled && !paused) {
        html = counts + "。本页尚未等待；点击「开始等待到期」后，有到期词或新词额度恢复时按当前方案续背。刷新、切书或离开背诵页会退出。";
      } else if (paused) {
        html = counts + "。今天已暂停自动续背（刷新后仍保持），有候选时仍可手动继续。";
      } else if (!ar.enabled) {
        html = counts + "。自动续背未开启；可选择便捷方案：1 张 / 闲置 30 秒 / 倒计时 3 秒。";
      } else if (autoResumeStorageError) {
        html = esc(reason || autoResumeReasonText(stats, ar));
      } else if (phase === "countdown") {
        html = counts + "；倒计时后自动继续，任何有效操作可取消。";
      } else if (stats.available >= ar.threshold) {
        html = counts + "；已开启自动续背，连续 " + formatAutoMinutes(ar.idleMs) + "无有效操作后倒计时。";
      } else {
        const next = autoResumeNextDueAt;
        html = counts + "；" + esc(reason || autoResumeReasonText(stats, ar))
          + (next ? "。下次到期：" + esc(formatReviewTime(next)) : "");
      }
      if (waiting) html = "本页已在等待。" + html;
      if (text.innerHTML !== html) text.innerHTML = html;
    }
    const cd = $("#autoResumeCountdown");
    if (cd) {
      if (phase === "countdown") {
        cd.hidden = false;
        cd.textContent = "将在 " + remainSec + " 秒后自动开始下一组";
      } else {
        cd.hidden = true;
        cd.textContent = "";
      }
    }
    const nowBtn = $("#autoResumeNow");
    if (nowBtn) {
      nowBtn.hidden = true; // 历史宿主兼容；唯一手动入口为#again。
    }
    const restoreBtn = $("#autoResumeRestore");
    if (restoreBtn) {
      restoreBtn.hidden = !ar.enabled || !paused;
      restoreBtn.onclick = restoreAutoResumeToday;
    }
    const quickBtn = $("#autoResumeQuick");
    if (quickBtn) {
      quickBtn.hidden = ar.enabled && !paused && !autoResumeConfigConflict(ar);
      quickBtn.textContent = empty && !ar.enabled && !paused ? "启用便捷并在本页等待" : autoResumeConfigConflict(ar) ? "改用便捷续背（1 张）" : ar.enabled ? "改用便捷续背" : "开启便捷续背";
      quickBtn.onclick = e => {
        if (empty && !ar.enabled && !paused) {
          const result=runStudyAction("enableWait",{event:e});
          if (!result.ok) toast("暂时未能开始等待，请检查自动续背与存储状态。");
          return;
        }
        const r = applyAutoResumePreset("quick");
        if (r.ok) toast("已开启便捷续背：1 张 / 闲置 30 秒 / 倒计时 3 秒");
      };
    }
    const pauseBtn = $("#autoResumePause");
    if (pauseBtn) {
      pauseBtn.hidden = !ar.enabled || paused;
      pauseBtn.disabled = paused;
      pauseBtn.onclick = pauseAutoResumeToday;
    }
    const startWait = $("#startEmptyWait"), stopWait = $("#stopEmptyWait");
    if (startWait) {
      startWait.hidden = !empty || waiting;
      startWait.disabled = !ar.enabled || paused || autoResumeStorageError || !storageOK;
      startWait.onclick = e => runStudyAction("wait",{event:e});
    }
    if (stopWait) { stopWait.hidden = !waiting; stopWait.onclick = e => runStudyAction("stopWait",{event:e}); }
    const title = $("#autoResumeTitle");
    if (title) title.textContent = waiting ? "本页等待到期" : empty ? "等待到期" : paused ? "下一组 · 今天暂停自动续背" : "下一组";
    const again = $("#again");
    if (again) again.disabled = stats.available < 1;
    applyActionBindingHints();
  }
  function autoResumeConfigConflict(ar){
    return ar.enabled && ar.threshold > S.settings.groupSize
      ? "每组 " + S.settings.groupSize + " 张，自动阈值 " + ar.threshold + " 张无法达到；可改用便捷续背。" : "";
  }
  /** 手动继续与自动阈值/今日暂停独立，但仍复核候选和最新预算，不空开组。 */
  function continueMainSession(){
    if (cur != null || drillMode || inSubgroup()) return false;
    if (!refreshSharedBeforeNextGroup()) { toast("无法安全读取最新记录，请先检查存储状态"); return false; }
    refreshForResume();
    alignReviewLedgerFromStorage();
    const stats = candidateStatsNow();
    if (stats.available < 1) { renderCard(); toast(autoResumeReasonText(stats, currentAutoResume())); return false; }
    startSession("main");
    return Q.length > 0;
  }
  /** 有效交互：重置闲置起点；倒计时中则立即取消。鼠标移动不算（不监听 pointermove/mousemove）。 */
  function noteAutoResumeActivity(){
    if (!mainGroupCompletedForAuto() && !emptyWaitActive()) return;
    if (!$("#v-study")?.classList.contains("on") || document.visibilityState === "hidden") return;
    autoResumeIdleSince = Date.now();
    if (autoResumePhase === "countdown") {
      autoResumePhase = "idle";
      autoResumeDeadline = 0;
      autoResumeLastReason = "";
      renderAutoResume();
    } else if (autoResumePhase === "waiting" || autoResumePhase === "blocked") {
      autoResumePhase = "idle";
    }
  }
  /** 内部采样：进度/额度/可见性变化由 refreshForResume 处理；这里只推进等待与倒计时。 */
  function autoResumeTick(){
    const now = Date.now();
    if (todayStr() !== lastDay) { refreshForResume(); return; }
    const ar = currentAutoResume();
    if (!ar.enabled || !autoResumeEligiblePage()) {
      if (autoResumePhase === "countdown") { autoResumePhase = "idle"; autoResumeDeadline = 0; }
      autoResumeIdleSince = null;
      autoResumeCheckCache = null;
      renderAutoResume();
      return;
    }
    if (autoResumePausedToday() || autoResumeStorageError) { renderAutoResume(); return; }
    if (autoResumeIdleSince === null) autoResumeIdleSince = now;
    if (autoResumePhase === "countdown") {
      if (now >= autoResumeDeadline) startAutoResumeNow();
      else renderAutoResume();
      return;
    }
    if (now - autoResumeIdleSince < ar.idleMs) { renderAutoResume(); return; }
    // 到闲置阈值：用最新口径复核候选，达到阈值才进入可取消倒计时，否则显示原因、不空开组。
    const stats = autoResumeStats(now);
    if (stats.available >= ar.threshold) {
      autoResumePhase = "countdown";
      autoResumeDeadline = now + ar.countdownMs;
      autoResumeLastReason = "";
    } else {
      autoResumePhase = "waiting";
      autoResumeLastReason = autoResumeReasonText(stats, ar);
    }
    renderAutoResume();
  }
  /* ---- 多标签短租约：启动前抢占并回读，只允许一组真正开始 ---- */
  function readAutoResumeLease(){
    try {
      const raw = localStorage.getItem(AUTO_RESUME_LEASE_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      return isRecord(v) ? v : null;
    } catch (e) { return null; }
  }
  function leaseBlocksAutoResume(){
    const lease = readAutoResumeLease();
    if (!lease) return false;
    if (lease.tab === AUTO_RESUME_TAB_ID) return false;
    if (lease.book !== currentBookId || lease.day !== todayStr()) return false;
    if (typeof lease.ts !== "number") return false;
    const age = Date.now() - lease.ts;
    return age >= 0 && age < AUTO_RESUME_LEASE_TTL_MS;
  }
  function acquireAutoResumeLease(){
    if (leaseBlocksAutoResume()) return false;
    try {
      const payload = JSON.stringify({ts: Date.now(), tab: AUTO_RESUME_TAB_ID, book: currentBookId, day: todayStr()});
      localStorage.setItem(AUTO_RESUME_LEASE_KEY, payload);
      const back = localStorage.getItem(AUTO_RESUME_LEASE_KEY);
      const check = back ? JSON.parse(back) : null;
      return !!(isRecord(check) && check.tab === AUTO_RESUME_TAB_ID);
    } catch (e) {
      autoResumeStorageError = true;
      return false;
    }
  }
  /** 到点真正启动：再次复核 + 抢租约 + 保存上一组现场 + 应用内刷新后开组。 */
  function startAutoResumeNow(){
    if (autoResumeStarting) return false;
    readAutoResumePauseStore(true);
    if (!currentAutoResume().enabled || !autoResumeEligiblePage() || autoResumePausedToday()) return false;
    if (!refreshSharedBeforeNextGroup()) {
      autoResumePhase = "waiting";
      autoResumeLastReason = "无法安全读取最新记录，请手动检查后继续";
      renderAutoResume();
      return false;
    }
    const ar = currentAutoResume();
    readAutoResumePauseStore(true);
    if (!ar.enabled) return false;
    if (!autoResumeEligiblePage()) { renderAutoResume(); return false; }
    if (autoResumePausedToday()) { renderAutoResume(); return false; }
    // 统一应用内恢复入口：只刷新额度/到期/统计，不重建当前卡，也不整页 reload。
    refreshForResume();
    alignReviewLedgerFromStorage();
    const stats = candidateStatsNow();
    autoResumeCheckCache = stats;
    if (stats.available < ar.threshold) {
      autoResumePhase = "waiting";
      autoResumeLastReason = autoResumeReasonText(stats, ar);
      renderAutoResume();
      return false;
    }
    if (leaseBlocksAutoResume()) {
      autoResumePhase = "waiting";
      autoResumeLastReason = "另一标签页已开始下一组";
      renderAutoResume();
      return false;
    }
    if (!acquireAutoResumeLease()) {
      autoResumePhase = autoResumeStorageError ? "blocked" : "waiting";
      autoResumeLastReason = autoResumeStorageError
        ? "浏览器存储不可用，无法安全自动开始下一组；请手动点「继续下一组」"
        : "另一标签页已开始下一组";
      renderAutoResume();
      return false;
    }
    // 保存上一组完成页现场（含完成页撤销栈的内存副本）：新组首个有效判定前可返回。
    const fromWait = emptyWaitActive();
    const prevSnap = captureSessionSnapshot();
    autoResumeStarting = true;
    autoResumeReturnSnap = prevSnap;
    autoResumeReturnArmed = true;
    autoResumeReturnFromWait = fromWait;
    autoResumePhase = "idle";
    autoResumeDeadline = 0;
    autoResumeIdleSince = null;
    autoResumeCheckCache = null;
    autoResumeLastReason = "";
    try {
      startSession("main");
    } finally {
      autoResumeStarting = false;
    }
    if (!Q.length) {
      // 不循环空开组：复核后没有建成时回到完成页并说明，不再自动倒计时。
      autoResumeReturnSnap = null;
      autoResumeReturnArmed = false;
      autoResumePhase = "waiting";
      autoResumeCheckCache = null;
      autoResumeLastReason = "复核后没有可入组的词（可能已被其他标签消耗）";
      renderAutoResume();
      return false;
    }
    // 程序化开组不是学习活动：不把自动开始计入学习时长。
    studyLastFingerprint = studyStateFingerprint();
    studyLastTickAt = Date.now();
    toast("已自动开始下一组（" + Q.length + " 张）；首个判定前可" + (fromWait ? "返回等待页" : "返回上一组结果"));
    renderAutoResume();
    return true;
  }
  /** 返回上一组结果：恢复自动开组前的完成页现场与撤销栈（仅内存，刷新后不可用）。 */
  function returnToPreviousResults(){
    if (!autoResumeReturnSnap || !autoResumeReturnArmed) { toast("上一组结果已不可返回"); return false; }
    if (answered !== 0 || drillMode || inSubgroup()) {
      toast("已有新的判定，上一组结果不再提供返回");
      return false;
    }
    const s = autoResumeReturnSnap;
    const fromWait = autoResumeReturnFromWait;
    autoResumeReturnSnap = null;
    autoResumeReturnArmed = false;
    autoResumeReturnFromWait = false;
    restoreSessionSnapshot(s);
    autoResumeEmptyWaitBook = fromWait ? currentBookId : null;
    if (fromWait) { sessionPlan = null; sessionScopeSet = null; }
    clearSessionSnapshot(currentBookId);   // 15：回到完成页，不需要未完成组快照
    updateBar();
    renderDrillEntry();
    renderGroupSurfaces();
    resetAutoResumeRuntime();
    renderCard();
    toast(fromWait ? "已返回等待页；刷新、切书或离开背诵页会退出等待" : "已返回上一组结果：撤销上一组判定仍可用（刷新后不可恢复）");
    return true;
  }

  /* ================= 15 刷新后继续未完成组（会话快照试点） =================
   * 主学习记录（KEY / PROF_KEY）永远是唯一权威；会话快照只保存「当前组现场」：
   *   队列/当前词用单词文本映射（不依赖数组下标）、已完成判定与额度已在主记录中，恢复时不再提交；
   *   用 progressSig（队列内单词进度 + 当日日统计 + 当日复习台账）校验主记录未被其他标签/导入推进。
   * 快照不参与备份 v3、不进 savedStateSignature；日期/词书/dataVersion/熟练/签名/损坏任一不符一律丢弃并安全开组。
   * 08 裁决：刷新恢复不因「当前设置 scopeSig ≠ 快照 scopeSig」失效（当前组沿用开始快照是 08 契约）：
   *   恢复后照常显示「设置已更改，下一组生效」；仅校验 snapshot.scopeSig 与 snapshot.plan.scopeSig 内部一致。
   */
  function sessionSnapshotKey(bookId){
    return SESSION_SNAPSHOT_PREFIX + (bookId || currentBookId) + "_v1";
  }
  function sessionSnapshotKeys(){ return BOOK_DEFS.map(def => sessionSnapshotKey(def.id)); }
  /** 32 位 FNV-1a：只用于「主记录是否在快照之后变化」的轻量校验，不是安全哈希。 */
  function sessionHash(str){
    let h = 0x811c9dc5;
    const text = String(str || "");
    for (let k = 0; k < text.length; k++) {
      h ^= text.charCodeAt(k);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16);
  }
  /** 快照对应的主记录签名：队列内单词进度 + 快照当日日统计 + 当日复习台账（只读）。 */
  /**
   * 当日日统计签名：缺失记录与「全 0 记录」等价。
   * 真实刷新差异修复（D-15-01）：页面渲染会惰性创建 `days[today]={n:0,r:0,ok:0,no:0}`，
   * 但若此前没有 save()（如全新 profile 刚开组），主记录里并没有该字段；
   * 刷新后 load() 得到的是缺失记录。二者必须签名一致，否则开组即 F5 会误判「主进度已推进」而丢现场。
   */
  function sessionDaySignature(day){
    const rec = S.days && S.days[day];
    if (!rec) return "0";
    const n = nonnegative(rec.n) ? rec.n : 0, r = nonnegative(rec.r) ? rec.r : 0;
    const ok = nonnegative(rec.ok) ? rec.ok : 0, no = nonnegative(rec.no) ? rec.no : 0;
    return (n || r || ok || no) ? JSON.stringify({n: n, r: r, ok: ok, no: no}) : "0";
  }
  function sessionMainSignature(day, words){
    const parts = ["d:" + sessionDaySignature(day)];
    for (const w of words) {
      const i = wordIndex.get(w);
      parts.push(w + ":" + (i === undefined ? "-" : JSON.stringify(S.progress[i] || null)));
    }
    const ledger = isRecord(S.reviewDay) && S.reviewDay.d === day ? S.reviewDay.used : 0;
    parts.push("l:" + ledger);
    return sessionHash(parts.join("|"));
  }
  function readSessionSnapshotRaw(bookId){
    try { return localStorage.getItem(sessionSnapshotKey(bookId)); } catch (e) { return null; }
  }
  function clearSessionSnapshot(bookId){
    try { localStorage.removeItem(sessionSnapshotKey(bookId || currentBookId)); } catch (e) { /* ignore */ }
  }
  function clearAllSessionSnapshots(){
    for (const key of sessionSnapshotKeys()) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
  }
  /** 当前主组是否能写快照：特训/受控子组/已完成/无当前卡不写（避免半套现场）。 */
  function sessionSnapshotEligible(){
    if (drillMode || inSubgroup()) return false;
    if (cur == null) return false;
    if (!sessionPlan || (sessionPlan.kind || "main") !== "main") return false;
    if (sessionPlan.bookId !== currentBookId) return false;
    if (!Q.length) return false;
    return true;
  }
  /** 捕获当前组现场（只读）；返回 null 表示当前状态不应写快照。 */
  function captureSessionPersistData(){
    if (!sessionSnapshotEligible()) return null;
    const words = Q.map(i => (W[i] ? W[i].w : null));
    if (words.some(w => typeof w !== "string")) return null;
    const roundsByWord = {};
    for (const [k, v] of Object.entries(rounds)) {
      const i = +k;
      if (W[i] && Number.isInteger(v) && v > 0) roundsByWord[W[i].w] = Math.min(2, v);
    }
    const baseline = (verdict !== null && phase === "revealed" && snap)
      ? JSON.parse(JSON.stringify(snap)) : null;
    return {
      v: SESSION_SNAPSHOT_VERSION,
      book: currentBookId,
      dv: currentBook().dataVersion || 1,
      day: todayStr(),
      writer: AUTO_RESUME_TAB_ID,
      updatedAt: Date.now(),
      scopeSig: sessionPlan.scopeSig || null,
      plan: {
        stagesMs: sessionPlan.stagesMs.slice(),
        relearnMs: sessionPlan.relearnMs,
        groupSize: sessionPlan.groupSize,
        kind: "main",
        startedAt: sessionPlan.startedAt,
        scopeSig: sessionPlan.scopeSig || null,
        scopeCount: sessionPlan.scopeCount,
        dailyNewTarget: sessionPlan.dailyNewTarget
      },
      queue: words,
      qi: qi,
      cur: cur != null && W[cur] ? W[cur].w : null,
      phase: phase,
      verdict: verdict,
      answered: answered,
      rightN: rightN,
      groupTotal: groupTotal,
      stageBefore: stageBefore,
      rounds: roundsByWord,
      curBaseline: baseline,
      progressSig: sessionMainSignature(todayStr(), words)
    };
  }
  /** 低频写入点：判定/翻页/改判/撤销/开组/页面隐藏等；已完成或特训/子组中自动清空。 */
  function persistSessionSnapshot(){
    if (sessionSnapshotWriteSuspended) return false;
    const data = captureSessionPersistData();
    if (!data) { clearSessionSnapshot(currentBookId); return false; }
    try { localStorage.setItem(sessionSnapshotKey(currentBookId), JSON.stringify(data)); return true; }
    catch (e) { return false; }
  }
  function parseSessionSnapshotRaw(raw){
    if (raw === null || raw === undefined || raw === "") return null;
    try {
      const o = JSON.parse(raw);
      return isRecord(o) ? o : null;
    } catch (e) { return null; }
  }
  /** 临时快照会在改判时回写这些基线，必须与主记录使用相同的数据校验边界。 */
  function validSessionDayRecord(record){
    return isRecord(record) && [record.n, record.r, record.ok, record.no]
      .every(n => nonnegative(n) && Number.isSafeInteger(n))
      && record.n <= record.r && record.ok + record.no === record.r;
  }
  function validSessionBaseline(baseline, snapshotDay){
    if (!isRecord(baseline) || !isRecord(baseline.days)
      || !validSpellingDay(baseline.date) || baseline.date > snapshotDay
      || !Object.prototype.hasOwnProperty.call(baseline.days, baseline.date)
      || !validSessionDayRecord(baseline.day)) return false;
    if (baseline.prog !== null && !validProgress(baseline.prog)) return false;
    if (!(baseline.survey === null || baseline.survey === 0 || baseline.survey === 1)) return false;
    if (baseline.drillWrongDelta !== undefined && !Number.isSafeInteger(baseline.drillWrongDelta)) return false;
    for (const [date, record] of Object.entries(baseline.days)) {
      if (!validSpellingDay(date) || date > snapshotDay
        || (record !== null && !validSessionDayRecord(record))) return false;
    }
    const originalDay = baseline.days[baseline.date];
    return validSessionDayRecord(originalDay)
      && ["n", "r", "ok", "no"].every(k => originalDay[k] === baseline.day[k]);
  }
  /** 只验冻结配置自身，不与当前设置比较（08：设置更改后本组仍可恢复）。 */
  function validSessionFrozenPlan(plan, scopeSig){
    if (!isRecord(plan) || plan.kind !== "main" || typeof scopeSig !== "string"
      || plan.scopeSig !== scopeSig || !Array.isArray(plan.stagesMs)) return false;
    const config = normalizeStageConfig(plan.stagesMs.map(ms => typeof ms === "number" ? ms / MINUTE_MS : null),
      typeof plan.relearnMs === "number" ? plan.relearnMs / MINUTE_MS : null);
    if (!config.ok || !Number.isInteger(plan.groupSize)
      || plan.groupSize < GROUP_SIZE_MIN || plan.groupSize > GROUP_SIZE_MAX
      || !Number.isSafeInteger(plan.startedAt) || plan.startedAt < 0
      || Number.isNaN(new Date(plan.startedAt).getTime())
      || !Number.isInteger(plan.scopeCount) || plan.scopeCount < 0 || plan.scopeCount > W.length
      || !Number.isInteger(plan.dailyNewTarget) || plan.dailyNewTarget < 1 || plan.dailyNewTarget > 500) return false;
    let scope;
    try { scope = JSON.parse(scopeSig); } catch (e) { return false; }
    const bounded = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
    return Array.isArray(scope) && scope.length === 10
      && scope[0] === plan.dailyNewTarget && ["freq", "shuffle", "wrong"].includes(scope[1])
      && bounded(scope[2], 1, 9999) && bounded(scope[3], 0, 9999)
      && (scope[3] === 0 || scope[3] >= scope[2])
      && bounded(scope[4], 0, currentBook().paperCount)
      && typeof scope[5] === "boolean" && Array.isArray(scope[6])
      && scope[6].every(k => POSCHIPS.some(chip => chip.k === k))
      && new Set(scope[6]).size === scope[6].length
      && ["primary", "all"].includes(scope[7]) && scope[8] === plan.groupSize
      && typeof scope[9] === "boolean";
  }
  /** 只读校验：所有条件通过才允许恢复；返回 {ok:true} 或 {ok:false, reason}。 */
  function validateSessionSnapshot(data){
    const fail = reason => ({ok: false, reason: reason});
    if (!isRecord(data) || data.v !== SESSION_SNAPSHOT_VERSION) return fail("bad-version");
    if (data.book !== currentBookId) return fail("book-mismatch");
    if (data.day !== todayStr()) return fail("day-mismatch");
    if (data.dv !== (currentBook().dataVersion || 1)) return fail("dv-mismatch");
    if (!Array.isArray(data.queue) || data.queue.length < 1 || data.queue.length > SESSION_SNAPSHOT_MAX_QUEUE) return fail("bad-queue");
    const plan = data.plan;
    // 08 裁决：只校验快照内部范围签名一致，不与「当前设置」比对（改设置后刷新仍恢复本组）。
    if (!validSessionFrozenPlan(plan, data.scopeSig)) return fail("bad-plan");
    const queue = data.queue;
    // 重考词会在本组队尾重复出现（同一单词最多 3 次：原卡 + 最多 2 轮重考）。
    const occurrences = new Map();
    for (const w of queue) {
      const n = (occurrences.get(w) || 0) + 1;
      if (n > 3) return fail("bad-queue");
      occurrences.set(w, n);
    }
    for (const w of queue) if (typeof w !== "string" || !wordIndex.has(w)) return fail("word-missing");
    if (!Number.isInteger(data.qi) || data.qi < 0 || data.qi >= queue.length) return fail("bad-qi");
    // 重考会在队尾追加词条：queue 长度可大于本组分母，answered 按队列出现次数计。
    if (!Number.isInteger(data.groupTotal) || data.groupTotal < 1 || data.groupTotal > queue.length
      || data.groupTotal > plan.groupSize) return fail("bad-total");
    if (!Number.isInteger(data.answered) || data.answered < 0 || data.answered > queue.length) return fail("bad-answered");
    if (!Number.isInteger(data.rightN) || data.rightN < 0 || data.rightN > data.answered) return fail("bad-right");
    if (!(data.phase === "recall" || data.phase === "revealed")) return fail("bad-phase");
    if (!Number.isInteger(data.stageBefore) || data.stageBefore < 0 || data.stageBefore > MASTER) return fail("bad-stage");
    if (typeof data.cur !== "string" || queue[data.qi] !== data.cur) return fail("bad-cur");
    if (data.phase === "revealed") {
      if (!(data.verdict === true || data.verdict === false)) return fail("bad-verdict");
      if (!validSessionBaseline(data.curBaseline, data.day)) return fail("bad-baseline");
    } else if (data.verdict !== null || data.curBaseline !== null) return fail("bad-verdict");
    if (!isRecord(data.rounds)) return fail("bad-rounds");
    const rounds = data.rounds;
    for (const [w, n] of Object.entries(rounds)) {
      if (!wordIndex.has(w) || !Number.isInteger(n) || n < 1 || n > 2) return fail("bad-rounds");
      if (!queue.includes(w)) return fail("bad-rounds");
    }
    // 熟练名单以最新独立存储为准：队列里任何词已熟练 → 旧现场不可恢复。
    for (const w of queue) {
      if (S.proficient && Object.prototype.hasOwnProperty.call(S.proficient, w)) return fail("proficient-changed");
    }
    // 主进度 / 当日统计 / 台账在快照之后被其他标签、导入或重置改变 → 快照失效。
    if (typeof data.progressSig !== "string"
      || data.progressSig !== sessionMainSignature(data.day, queue)) return fail("progress-changed");
    return {ok: true, reason: ""};
  }
  /** 恢复现场：只重建内存会话指针与快照派生数据，不重复提交判定/额度、不改主记录。 */
  function applySessionPersistData(data){
    const queue = data.queue.map(w => wordIndex.get(w));
    const plan = {
      stagesMs: data.plan.stagesMs.slice(),
      relearnMs: data.plan.relearnMs,
      bookId: currentBookId,
      kind: "main",
      groupSize: Number.isInteger(data.plan.groupSize) ? data.plan.groupSize : S.settings.groupSize,
      startedAt: Number.isInteger(data.plan.startedAt) ? data.plan.startedAt : Date.now(),
      scopeSig: data.plan.scopeSig,
      scopeCount: Number.isInteger(data.plan.scopeCount) ? data.plan.scopeCount : inScopeCount(),
      dailyNewTarget: Number.isInteger(data.plan.dailyNewTarget) ? data.plan.dailyNewTarget : S.settings.dailyNew
    };
    sessionPlan = plan;
    // 恢复组沿用快照现场：队列内单词视为本组范围（组内改设置不追溯是 08 契约）。
    sessionScopeSet = new Set(queue);
    Q = queue.slice();
    qi = data.qi;
    groupTotal = data.groupTotal;
    answered = data.answered;
    rightN = data.rightN;
    rounds = {};
    for (const [w, n] of Object.entries(isRecord(data.rounds) ? data.rounds : {})) {
      const i = wordIndex.get(w);
      if (i !== undefined) rounds[i] = n;
    }
    cur = queue[data.qi];
    verdict = data.phase === "revealed" ? data.verdict : null;
    phase = data.phase === "revealed" ? "revealed" : "recall";
    snap = data.phase === "revealed" ? data.curBaseline : null;
    stageBefore = Number.isInteger(data.stageBefore) ? data.stageBefore : 0;
    undoStack = [];   // 刷新前的撤销记录不可再用（当前缓存内不含撤销栈）
    autoSpoken = false;
    drillMode = false; mainSnap = null; capPaused = false; capGroupEnded = false;
    extraSubgroup = false; extraSnap = null; newOnlySubgroup = false; newOnlySnap = null;
    autoResumeReturnSnap = null; autoResumeReturnArmed = false;
    // D-15-01 产品口径：只要恢复了现场就显示一句说明（0 判定开组即刷新也显示，保持行为一致）；
    // noAction 仅用于文案区分（尚未作答），不参与任何校验/安全性判断。
    const hadAction = answered > 0 || qi > 0 || phase === "revealed" || Object.keys(rounds).length > 0;
    resumeNoticePending = {answered: answered, groupTotal: groupTotal, qi: qi, noAction: !hadAction};
    renderCard();
    updateBar();
    renderDrillEntry();
    renderResumeNotice();
    if ($("#v-set")?.classList.contains("on")) renderSettingsLifecycle();
    return true;
  }
  /** 启动尝试恢复：有效快照 → 恢复现场并返回 true；无效只清临时快照并返回 false（调用方安全开组）。 */
  function tryRestoreSessionSnapshot(){
    if (!storageOK || blockedBooks.has(currentBookId)) return false;
    const raw = readSessionSnapshotRaw(currentBookId);
    if (raw === null || raw === undefined) return false;
    const data = parseSessionSnapshotRaw(raw);
    const check = data ? validateSessionSnapshot(data) : {ok: false, reason: "corrupt"};
    if (!check.ok) { clearSessionSnapshot(currentBookId); return false; }
    return applySessionPersistData(data);
  }
  /** 启动入口（页面加载唯一入口）：先尝试恢复未完成组，否则安全开新组。 */
  function bootstrapSession(){
    try {
      if (tryRestoreSessionSnapshot()) return "restored";
    } catch (e) { clearSessionSnapshot(currentBookId); }
    startSession("main");
    return "started";
  }
  /** 恢复提示：一句说明，可由用户关闭；不占学习页网格额外行（放在 #groupStatus 内）。 */
  function renderResumeNotice(){
    const box = $("#resumeNotice");
    if (!box) { resumeNoticePending = null; return; }
    const show = !!resumeNoticePending && !drillMode && !inSubgroup() && cur != null
      && $("#v-study")?.classList.contains("on");
    if (!show) { if (!box.hidden) box.hidden = true; return; }
    box.hidden = false;
    const n = resumeNoticePending;
    const text = $("#resumeNoticeText");
    if (text) {
      text.innerHTML = n.noAction
        ? "已恢复上次未完成的一组（尚未作答，当前第 <b>" + (n.qi + 1) + "</b> 张）。刷新前的撤销记录不可再用；恢复不会重复提交判定或消耗额度。"
        : "已恢复上次未完成的一组（本组进度 <b>" + Math.min(n.answered, n.groupTotal) + "/" + n.groupTotal
          + "</b>，当前第 <b>" + (n.qi + 1) + "</b> 张）。刷新前的撤销记录不可再用；已计入的判定与额度不会重复提交。";
    }
    const btn = $("#resumeNoticeDismiss");
    if (btn) btn.onclick = dismissResumeNotice;
  }
  function dismissResumeNotice(){
    if (!resumeNoticePending) return;
    resumeNoticePending = null;
    renderResumeNotice();
  }
  /** 只读调试信息：当前书的快照是否存在/有效，最近一次恢复原因。 */
  function getSessionSnapshotState(){
    const raw = readSessionSnapshotRaw(currentBookId);
    const data = parseSessionSnapshotRaw(raw);
    const check = data ? validateSessionSnapshot(data) : {ok: false, reason: raw === null ? "none" : "corrupt"};
    return {
      key: sessionSnapshotKey(currentBookId),
      keys: sessionSnapshotKeys(),
      present: raw !== null,
      valid: !!check.ok,
      reason: check.reason || "",
      data: data,
      notice: resumeNoticePending ? Object.assign({}, resumeNoticePending) : null
    };
  }
  /**
   * 测试/诊断钩子：模拟整页刷新（重新读主记录 → 尝试恢复快照 → 否则安全开组）。
   * 真实浏览器刷新走同一 bootstrapSession 路径；页面级瞬时状态（撤销栈/自动续背倒计时等）按刷新语义重置。
   */
  function simulateReloadForTest(){
    autoResumeEmptyWaitBook = null;
    autoResumeReturnFromWait = false;
    autoResumeScrollInputAt = -Infinity;
    autoResumePausePending.clear();
    autoResumePauseStore.loaded = false;
    autoResumePauseStore.map = {};
    if (drillMode) { drillMode = false; mainSnap = null; }
    extraSubgroup = false; extraSnap = null;
    newOnlySubgroup = false; newOnlySnap = null;
    capPaused = false; capGroupEnded = false;
    Q = []; qi = 0; rounds = {}; cur = null; verdict = null; snap = null; phase = "recall"; stageBefore = 0;
    answered = 0; rightN = 0; groupTotal = 0; undoStack = []; autoSpoken = false;
    sessionPlan = null; sessionScopeSet = null;
    autoResumeReturnSnap = null; autoResumeReturnArmed = false;
    resumeNoticePending = null;
    // 16：真实刷新会丢失拼写专项现场（不持久化逐词明细）；模拟刷新同样清空，避免残留 session。
    spellingSession = null;
    resetAutoResumeRuntime();
    S = freshState(currentBook());
    // 真实 F5 会重新读取设备偏好键；模拟刷新同步（不重新做一次性迁移判定，缺失时按现状降级）。
    try { initDevicePreferences(true); } catch (e) { /* ignore */ }
    load();
    lastDay = todayStr();
    // 真实刷新会重新初始化学习时长采样状态；这里同步，避免模拟刷新把旧活动当成本页活动。
    studyLastTickAt = Date.now();
    studyLastActivityAt = 0;
    studyPendingMs = 0;
    studyWasHidden = false;
    studyWasOnStudy = false;
    studyBookId = currentBookId;
    studyLastFingerprint = studyStateFingerprint();
    // 真实页面启动顺序：load() → applyTheme/bindSet（不碰 day()）→ 先 bootstrapSession()（恢复/安全开组）
    // → 之后才 renderStats/applyFilter。顺序必须与真实 boot 一致，否则模拟刷新会提前惰性创建当日记录，
    // 掩盖「开组即 F5」的真实签名差异（D-15-01）。
    applyTheme();
    bindSet();
    const mode = bootstrapSession();
    applyFilter(false); renderStats(); applyBrand();
    renderStats(); updateBar(); renderCapSurfaces(); renderDrillEntry();
    return {mode: mode, plan: getPlan(), cur: cur};
  }
  // 页面隐藏/关闭：低频写一次快照（真实刷新前最后一次现场）；恢复靠下一次启动校验。
  window.addEventListener?.("pagehide", () => persistSessionSnapshot());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistSessionSnapshot();
  });

  /** 只读调试快照：阶段、倒计时、闲置与候选明细。 */
  function getAutoResumeState(){
    const ar = currentAutoResume();
    const stats = candidateStatsNow();
    const now = Date.now();
    return {
      enabled: ar.enabled, threshold: ar.threshold, idleMs: ar.idleMs, countdownMs: ar.countdownMs,
      phase: autoResumePhase, pausedToday: autoResumePausedToday(),
      eligible: autoResumeEligiblePage(), completedPage: mainGroupCompletedForAuto(),
      emptyPage: emptyMainPage(), waitingForDue: emptyWaitActive(),
      returnKind: autoResumeReturnArmed ? (autoResumeReturnFromWait ? "waiting" : "results") : null,
      idleSince: autoResumeIdleSince,
      idleRemainingMs: autoResumeIdleSince === null ? null : Math.max(0, ar.idleMs - (now - autoResumeIdleSince)),
      countdownDeadline: autoResumeDeadline,
      countdownRemainingMs: autoResumeDeadline ? Math.max(0, autoResumeDeadline - now) : 0,
      reason: autoResumeLastReason,
      storageError: autoResumeStorageError,
      returnAvailable: autoResumeReturnArmed,
      candidates: stats
    };
  }
  // 有效交互（鼠标移动不算）：点击、键盘、触摸/笔、阅读滚动都会取消当前倒计时并重置闲置起点。
  document.addEventListener("click", () => noteAutoResumeActivity(), true);
  document.addEventListener("keydown", (e) => {
    autoResumeScrollInputAt = Date.now();
    if (!e || e.repeat || e.isComposing) return;
    noteAutoResumeActivity();
  }, true);
  document.addEventListener("pointerdown", (e) => {
    autoResumeScrollInputAt = Date.now();
    if (e) noteAutoResumeActivity();
  }, true);
  document.addEventListener("pointermove", e => {
    if (!e || !e.buttons) return; // 无按压的鼠标移动仍不计活动
    autoResumeScrollInputAt = Date.now();
    noteAutoResumeActivity();
  }, {capture: true, passive: true});
  document.addEventListener("wheel", () => {
    autoResumeScrollInputAt = Date.now();
    noteAutoResumeActivity();
  }, {capture: true, passive: true});
  document.addEventListener("scroll", e => {
    // 浏览器布局/scrollIntoView同样发trusted scroll。只有近期输入导致的真实滚动重计闲置；
    // 非浏览器事件保留既有DOM测试/程序调用语义。按键、触摸、滚轮、拖动本身仍立即取消。
    if (e?.isTrusted === true && Date.now() - autoResumeScrollInputAt > 1500) return;
    noteAutoResumeActivity();
  }, true);
  // 后台不抢焦点、不启动：隐藏时清空倒计时与闲置起点，回前台由统一恢复入口重新计时。
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    autoResumePhase = "idle";
    autoResumeDeadline = 0;
    autoResumeIdleSince = null;
    renderAutoResume();
  });
  // 注：定时器注册放在文件末尾（学习时长采样之后），避免与既有 1 秒计时器混在同一位置。

  // 到期词轮询：未开始新组时补显示到期词；跨天只刷新现场数据
  setInterval(() => {
    if (todayStr() !== lastDay) { refreshForResume(); return; }
    if (cur == null && countDue() > 0) {
      if (emptyWaitActive()) renderAutoResume();
      else renderCard();
    }
    renderReviewPlan();
    if ($("#v-list").classList.contains("on") && $("#fst").value === "due") applyFilter(false);
  }, 30000);

  /* ================= 学习时长：实际经过时长 + 最近有效活动 ================= */
  // 旧口径每个回调固定 +15 秒，只要学习页可见且有当前词就累计，挂机也涨。
  // 新口径按 Date.now() 实际经过时间计量，且只在学习页可见、有当前词、最近
  // STUDY_IDLE_MS 内有有效活动时累计；隐藏/休眠/页面恢复不补记整段间隔。
  // 持久化仍是既有 S.timeSec（整数秒、主记录、备份 v3 不变），不新增字段。
  const STUDY_TICK_MS = 1000;          // 采样间隔；按时间差计量，不按回调次数
  const STUDY_IDLE_MS = 60000;         // 有效活动后的宽限，超时视为闲置并暂停
  const STUDY_SUSPEND_GAP_MS = 120000; // 单次采样间隔超过它视为休眠/长跳变，本段不补记
  const STUDY_PERSIST_MS = 30000;      // 累计满 30 秒才落盘一次，避免高频写入
  let studyLastTickAt = Date.now();
  let studyLastActivityAt = 0;         // 0 = 尚无有效活动；首次活动后才开始计时
  let studyWasHidden = false;
  let studyWasOnStudy = false;
  let studyBookId = currentBookId;
  let studyLastFingerprint = studyStateFingerprint();

  function studyPageActive(){
    return cur != null && $("#v-study").classList.contains("on");
  }
  /** 学习状态指纹：判定/改判/撤销/翻页/熟练/收藏等程序化调用也算有效活动。 */
  function studyStateFingerprint(){
    return [cur, verdict, answered, qi, Q.length,
      Object.keys(S.stars || {}).length, Object.keys(S.proficient || {}).length,
      Object.keys(S.progress || {}).length].join("|");
  }
  /** 只比较学习内容（排除 timeSec），用于判断别的标签是否写入了更新的学习记录。 */
  function studyContentSignature(state){
    return savedStateSignature({settings: state.settings, progress: state.progress,
      days: state.days, stars: state.stars, proficient: state.proficient, timeSec: 0});
  }
  function noteStudyActivity(){
    studyLastActivityAt = Date.now();
  }
  /** 把待记的整秒时长并入主记录；多标签以存储为准合并，绝不覆盖别人的判定。 */
  function studyTimeFlush(){
    if (pendingReplacementToken) return false;
    const whole = Math.floor(studyPendingMs / 1000);
    if (whole <= 0) return true;
    let raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { return false; }
    if (raw === null && lastMainRaw !== null) return false;   // 别的标签清空记录：等同步，不写回旧状态
    let storedTime = 0;
    if (raw !== null && raw !== lastMainRaw) {
      // 计时不能先采纳新 raw 再用旧 S 保存，否则会抹掉换代信号并复活旧辅助记录。
      if (replacementToken(raw) !== replacementToken(lastMainRaw)) return false;
      let latest;
      try { latest = normalizeState(JSON.parse(raw), currentBookId); }
      catch (e) { return false; }
      if (studyContentSignature(latest) !== studyContentSignature(S)) return false;
      storedTime = latest.timeSec || 0;
      lastMainRaw = raw;
      if (storedTime > (S.timeSec || 0)) {
        // 另一标签已把同一时段的时长落盘：以存储为准，丢弃本页可能重复的部分。
        S.timeSec = storedTime;
        studyPendingMs = 0;
        lastSavedSignature = savedStateSignature(S);
        return true;
      }
      lastSavedSignature = savedStateSignature(S);
    }
    S.timeSec = Math.max(S.timeSec || 0, storedTime) + whole;
    studyPendingMs -= whole * 1000;
    save();
    return true;
  }
  function studyTimeTick(){
    const now = Date.now();
    const elapsed = now - studyLastTickAt;
    studyLastTickAt = now;
    if (studyBookId !== currentBookId) {
      // 切换词书：上一本不足 1 秒的待记时长丢弃，不记到新词书。
      studyBookId = currentBookId;
      studyPendingMs = 0;
      studyLastFingerprint = studyStateFingerprint();
    }
    // 程序化判定/翻页不产生 DOM 事件，用状态指纹兜底算一次有效活动。
    const fingerprint = studyStateFingerprint();
    if (fingerprint !== studyLastFingerprint) {
      studyLastFingerprint = fingerprint;
      if (studyPageActive() && document.visibilityState !== "hidden") noteStudyActivity();
    }
    const onStudy = studyPageActive();
    if (studyWasOnStudy && !onStudy) studyTimeFlush();   // 离开学习页/本组结束：把已满整秒落盘
    studyWasOnStudy = onStudy;
    if (!onStudy || document.visibilityState === "hidden") return;
    if (!(elapsed > 0) || elapsed > STUDY_SUSPEND_GAP_MS) return;  // 休眠/长跳变：整段不补记
    if (!studyLastActivityAt) return;                              // 还没有任何有效活动
    const startedAt = now - elapsed;
    const activeUntil = studyLastActivityAt + STUDY_IDLE_MS;
    studyPendingMs += Math.max(0, Math.min(elapsed, activeUntil - startedAt));
    if (studyPendingMs >= STUDY_PERSIST_MS) studyTimeFlush();
  }
  /** 恢复（可见/页面恢复/聚焦）：从当前时刻重新开始计，绝不补记后台或休眠间隔。 */
  function studyTimeRestart(){
    studyWasHidden = false;
    studyLastTickAt = Date.now();
    studyLastActivityAt = studyLastTickAt;
    studyLastFingerprint = studyStateFingerprint();
  }
  function studyTimeHide(){
    studyWasHidden = true;
    studyTimeFlush();
    studyLastTickAt = Date.now();
  }
  // 有效学习活动：指针点击、有效按键、触摸/笔手势、阅读滚动；鼠标移动不算。
  document.addEventListener("click", () => {
    if (studyPageActive()) noteStudyActivity();
  }, true);
  document.addEventListener("keydown", (e) => {
    if (!e || e.repeat || e.isComposing) return;
    const k = e.key || "";
    if (!k || ["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn", "OS"].includes(k)) return;
    if (studyPageActive()) noteStudyActivity();
  }, true);
  document.addEventListener("pointerdown", (e) => {
    if (e && (e.pointerType === "touch" || e.pointerType === "pen") && studyPageActive()) noteStudyActivity();
  }, true);
  document.addEventListener("scroll", () => {
    if (studyPageActive()) noteStudyActivity();
  }, true);
  setInterval(studyTimeTick, STUDY_TICK_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") studyTimeHide();
    else studyTimeRestart();
  });
  window.addEventListener?.("pageshow", () => { if (studyWasHidden) studyTimeRestart(); });
  window.addEventListener?.("focus", studyTimeRestart);
  window.addEventListener?.("pagehide", studyTimeHide);
  // 只读诊断钩子（纯内存态，不属于持久化契约），供回归测试用。
  window.__vocabStudy = {
    getDebug(){
      return {
        timeSec: S.timeSec || 0, pendingMs: studyPendingMs,
        lastActivityAt: studyLastActivityAt, lastTickAt: studyLastTickAt,
        bookId: studyBookId,
        tickMs: STUDY_TICK_MS, idleMs: STUDY_IDLE_MS,
        suspendGapMs: STUDY_SUSPEND_GAP_MS, persistMs: STUDY_PERSIST_MS,
        studyActive: studyPageActive()
      };
    },
    tick: studyTimeTick,
    act: noteStudyActivity,
    flush: studyTimeFlush
  };

  // 后台标签跨天兜底：保留正在学习的卡片与撤销栈
  setInterval(() => {
    if (todayStr() !== lastDay) refreshForResume();
  }, 60000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") refreshForResume();
  });
  window.addEventListener?.("pageshow", refreshForResume);
  window.addEventListener?.("focus", refreshForResume);

  /** 设备偏好键的跨标签变化：只重新解析本书未覆盖字段，保留学习现场/浮层/撤销。 */
  function handleDevicePreferencesStorageEvent(){
    const previous = clonePrefValue(S.settings);
    const got = readDevicePreferences();
    if (got.status !== "ok") {
      if (devicePrefsStatus === "damaged" || devicePrefsStatus === "unsupported") {
        showAlert("偏好归属存储异常", preferenceStatusText()
          + "。当前书仍使用自己记录里的偏好，本页不会覆写原文。", {kind: "prefs"});
      }
      renderPreferenceOwnershipControls();
      return;
    }
    // 已有手势的 revision 会随 inputPreferences 变化自动作废（沿用既有机制）。
    reResolveInheritedPreferences();
    renderPreferenceOwnershipControls();
    if (!prefValuesEqual(previous, S.settings) && activeSheet && activeSheet.id === "helpSheet") renderHelp();
  }
  /** localStorage.clear()：设备键与主记录一起消失；只重置本页内存镜像，不把旧 shared 写回。 */
  function resetDevicePreferencesAfterStorageClear(){
    devicePrefs = {kind: DEVICE_PREFS_KIND, version: DEVICE_PREFS_VERSION,
      shared: defaultPreferenceShared(), overrides: emptyPreferenceOverrides()};
    devicePrefsRaw = null;
    devicePrefsStatus = "missing";
    devicePrefsError = "";
    devicePrefsLegacy = false;
    devicePrefsWriteNotified = false;
    prefJournalRecovered = false;
    prefJournalRecoveryFailed = false;
    lastResolvedPrefs = {};
    renderPreferenceOwnershipControls();
    renderBookPageUi();
  }
  window.addEventListener?.("storage", (e) => {
    if (e.key === ACTIVE_KEY) { followActiveBook(); return; }
    if (e.key === DEVICE_PREFS_KEY) { handleDevicePreferencesStorageEvent(); return; }
    if (e.key === DEFAULT_BOOK_KEY || e.key === PAGE_BOOK_KEY) { renderBookPageUi(); return; }
    if (e.key === null) resetDevicePreferencesAfterStorageClear();
    if (e.key === AUTO_RESUME_PAUSE_KEY || e.key === null) {
      if (e.key === null) { autoResumePausePending.clear(); autoResumePauseStore.map = {}; }
      readAutoResumePauseStore(true);
      if (autoResumePausedToday()) {
        autoResumePhase = "paused"; autoResumeDeadline = 0; autoResumeIdleSince = null;
      } else if (autoResumePhase === "paused") resetAutoResumeRuntime();
      renderAutoResume();
      if (e.key !== null) return;
    }
    for (const id of Object.keys(BOOKS)) {
      if (e.key === BOOKS[id].SURVEY_KEY) {
        if (id === currentBookId) { loadSurvey(); renderSurvey(); }
        return;
      }
    }
    // 找到变化键所属的词书
    let owner = null;
    for (const id of Object.keys(BOOKS)) {
      if (e.key === BOOKS[id].KEY || e.key === BOOKS[id].PROF_KEY) { owner = id; break; }
    }
    // localStorage.clear() 的事件 key 为 null，也必须清除本页旧状态，避免再次写回复活。
    if (e.key === null) { owner = currentBookId; loadSurvey(); }
    if (!owner) return;
    if (owner !== currentBookId) {
      // 别的书被别人更新：本标签只刷新词书列表统计，不切换
      if (activeSheet && activeSheet.id === "bookSheet") renderBookList();
      return;
    }
    try {
      const raw = localStorage.getItem(KEY);
      const wasEmptyPage = emptyMainPage();
      const candidate = raw !== null ? normalizeState(JSON.parse(raw), currentBookId) : freshState(currentBook());
      const replaced = raw === null || e.key === null || replacementToken(raw) !== replacementToken(lastMainRaw);
      // 显式替换写入失败仍在本页待提交；旧一代普通通知不能把它改回旧累计。
      if (pendingReplacementToken && !replaced) return;
      const proficientRaw = localStorage.getItem(PROF_KEY);
      if (proficientRaw !== null) candidate.proficient = normalizeProficientByBook(JSON.parse(proficientRaw), currentBook());
      if (!replaced && sharedLearningSignature(candidate) === sharedLearningSignature(S)
          && !Q.slice(qi).some(i => !!candidate.proficient[W[i].w])) {
        const previousSettings = S.settings;
        // O1：主记录设置（另一页有效快照）→ 未覆盖字段采纳进设备 shared 后重新解析。
        S.settings = resolveIncomingPreferenceSettings(candidate.settings);
        const settingsChanged = JSON.stringify(previousSettings) !== JSON.stringify(S.settings);
        mergeSharedCounters(candidate);
        lastMainRaw = raw;
        lastSavedSignature = savedStateSignature(S);
        syncLastResolvedPreferences();
        storageOK = true;
        blockedBooks.delete(currentBookId);
        if (settingsChanged) refreshSharedSettingsSurfaces(true, previousSettings);
        renderCapSurfaces();
        if ($("#v-study").classList.contains("on") && cur == null) renderCard();
        return;
      }
      const prevTimeSec = S.timeSec || 0;
      const localReviewBefore = reviewLedger();
      const localExtraBefore = normalizeExtraDay(S.extraDay);
      const localSpellingBefore = normalizeSpellingState(S.spelling);
      S = candidate;
      pendingReplacementToken = null;
      // O1：换代（导入/重置/clear）先读最新设备键再解析；普通内容同步采纳另一页的有效偏好快照。
      if (replaced) {
        try { readDevicePreferences(); } catch (e2) { /* ignore */ }
        S.settings = resolveBookPreferences(S, currentBookId);
      } else {
        S.settings = resolveIncomingPreferenceSettings(S.settings);
      }
      syncLastResolvedPreferences();
      // 内容被别的标签更新时，当日台账/临时加量仍取较大值，不回退本页已知的消费或授予。
      const afterReview = reviewLedger();
      const removed = replaced;
      if (!removed && localReviewBefore.d === afterReview.d && localReviewBefore.used > afterReview.used) {
        S.reviewDay = {d: afterReview.d, used: localReviewBefore.used};
      }
      const afterExtra = extraDayLedger();
      if (!removed && localExtraBefore.d === afterExtra.d && localExtraBefore.extra > afterExtra.extra) {
        S.extraDay = {d: afterExtra.d, extra: localExtraBefore.extra};
      }
      // 16：本页刚完成的拼写组不被别标签旧快照覆盖；更新的一方保留（下一次保存落盘）。
      if (!removed) S.spelling = mergeSpellingState(localSpellingBefore, candidate.spelling);
      else { studyPendingMs = 0; clearProfPending(currentBookId); pendingReplacementToken = null; }
      if ((S.timeSec || 0) > prevTimeSec) studyPendingMs = 0;   // 外部时长覆盖了本页待记的部分
      studyLastFingerprint = studyStateFingerprint();           // 外部同步不算本页的学习活动
      lastMainRaw = raw;
      lastSavedSignature = savedStateSignature(S);
      storageOK = true;
      blockedBooks.delete(currentBookId);
      if (activeSheet) closeSheet();
      bindSet(); applyFilter(); renderStats();
      resumeAfterSharedChange(wasEmptyPage, replaced);
      applyBrand(); renderBookList();
      toast("另一窗口的进度已同步");
    } catch (err) { toast("另一窗口的记录无法读取，当前进度已保留"); }
  });

  // 22 自动续背内部采样（放在其它定时器之后注册；只推进等待/倒计时，不做高频存储写入）。
  setInterval(autoResumeTick, AUTO_RESUME_TICK_MS);

  /* 调试 / 测试钩子（保留原有语义，默认作用于当前词书） */
  window.__vocab = {
    get phase() { return phase; },
    get verdict() { return verdict; },
    get cur() { return cur; },
    get qi() { return qi; },
    get Q() { return Q; },
    get answered() { return answered; },
    get drillMode() { return drillMode; },
    judge, tryNext, undo, startSession, nextCard,
    deriveStudyPresentation, runStudyAction, addExtraAndStudy, readOnlyCandidateStats,
    getInputPreferences,getInputActionDescriptors,getGestureActions,normalizeGestures,normalizeActionKeys,normalizeActionLayout,
    normalizeKeyBinding,keyName,keyMatch,setInputBinding,resetInputBinding,resetInputBindings,cancelInputGesture,
    // —— F1 阅读与布局（applyReadingLayoutPatch/moveReadingOrder 为合法写入口；统计展开偏好为设备键） ——
    applyReadingLayoutPatch, moveReadingOrder,
    getReadingLayout: () => ({
      cardDensity: S.settings.cardDensity, readingOrder: currentReadingOrder(),
      showCardMeta: !!S.settings.showCardMeta, showCardStage: !!S.settings.showCardStage,
      showCardPos: !!S.settings.showCardPos, secondaryActions: currentSecondaryActions(),
      actionLayout: currentActionLayout()
    }),
    normalizeReadingOrder, normalizeSecondaryActions,
    statsPanelsKey: STATS_PANELS_KEY, statsPanelIds: STATS_PANEL_IDS.slice(), statsCardIds: STATS_CARD_IDS.slice(),
    readStatsPanelPrefs, applyStatsPanelPrefs, moveStatsPanel, syncReadingLayoutControls,
    buildExport, buildRescueExport, prepareImportPlan, recoverImportJournal,
    hasMainProgress, isMainLearned, isMastered, pendingReinforce,
    getGroupTotal: () => groupTotal,
    getListActiveWord: () => listActiveWord,
    applyComboFilters,
    freqToPos, posToFreq, freqHistogram, renderFreqHistogram, syncFreqControls,
    inScope, inScopeCount, masteredCount, scopedMasteredCount, countDue, buildQueue,
    passBaseFilters, posTagOfPos, posTagsOf, posMatches, getPosMode, setPosMode, poslineText,
    getStages, getRelearn, getStagePresets, getCycleSummary, normalizeStageConfig,
    // —— 20 单日复习上限 / 台账 / 暂停态（只读调试钩子；setReviewCap 为唯一写入口） ——
    getReviewCap, setReviewCap, reviewCapLeft,
    getReviewLedger: () => Object.assign({}, reviewLedger()),
    getCapLeft: () => reviewCapLeft(),
    getCapStats: () => capStats(),
    isCapPaused: () => isCapPaused(),
    getCapPaused: () => isCapPaused(),
    refreshForResume,
    refreshSharedBeforeNextGroup,
    // —— 23 今日临时加量 / 额外新词子组（只读 + grantExtraNew/endExtraSubgroup 为合法写入口） ——
    getExtraDay, getEffectiveNewTarget, grantExtraNew, grantExtraNewFromPause,
    getExtraCandidatesAvailable: () => extraCandidatesAvailable(),
    isExtraSubgroup: () => extraSubgroup,
    endExtraSubgroup, startExtraSubgroup,
    // —— 07 分组 / 积压保护 / 纯新词子组（setGroupSize/setBacklogGuard 为设置写入口） ——
    getGroupSize: () => S.settings.groupSize,
    setGroupSize,
    getGroupInfo: () => groupInfo(),
    getDuePool: () => buildQueue().duePool.slice(),
    getFreshPool: () => buildQueue().freshPool.slice(),
    getBacklogGuard: () => !!S.settings.backlogGuard,
    setBacklogGuard,
    isBacklogGuarded: () => isBacklogGuarded(),
    startNewOnlySubgroup, isNewOnlySubgroup: () => newOnlySubgroup,
    endNewOnlySubgroup, endActiveSubgroup,
    // —— 08 设置与当前组生命周期（预览/显式重开/按类恢复默认；写入口仅 applySettingsRestart/resetSettingsClass） ——
    hasPendingScopeSettings,
    getSettingsLifecycle: () => ({
      pending: hasPendingScopeSettings(),
      active: mainGroupActiveForSettings(),
      nextScopeCount: inScopeCount(),
      nextSummary: scopeSummaryText(),
      plan: mainSessionPlan() ? {
        kind: mainSessionPlan().kind || "main",
        scopeCount: mainSessionPlan().scopeCount,
        dailyNewTarget: mainSessionPlan().dailyNewTarget,
        groupSize: mainSessionPlan().groupSize,
        startedAt: mainSessionPlan().startedAt
      } : null,
      groupTotal: groupTotal,
      answered: answered
    }),
    applySettingsRestart,
    resetSettingsClass,
    scopeSummaryText,
    // —— 22 完成页挂机自动续背（getAutoResume/getCandidatesNow/getAutoResumeState 只读） ——
    getAutoResume,
    getCandidatesNow,
    getAutoResumeState,
    continueMainSession,
    startEmptyWait, stopEmptyWait,
    setAutoResume,
    applyAutoResumePreset,
    pauseAutoResumeToday,
    restoreAutoResumeToday,
    startAutoResumeNow,
    returnToPreviousResults,
    autoResumeLeaseKey: AUTO_RESUME_LEASE_KEY,
    autoResumePauseKey: AUTO_RESUME_PAUSE_KEY,
    // —— 15 刷新后继续未完成组（getSessionSnapshotState 只读；simulateReload 仅供调试/测试模拟刷新） ——
    getSessionSnapshotState,
    getSessionSnapshotKey: (bookId) => sessionSnapshotKey(bookId),
    getSessionSnapshotKeys: () => sessionSnapshotKeys(),
    sessionSnapshotPrefix: SESSION_SNAPSHOT_PREFIX,
    persistSessionSnapshot,
    clearSessionSnapshot: (bookId) => { clearSessionSnapshot(bookId); return true; },
    simulateReload: simulateReloadForTest,
    getResumeNotice: () => (resumeNoticePending ? Object.assign({}, resumeNoticePending) : null),
    dismissResumeNotice,
    getAutoResumePause: () => {
      const map = readAutoResumePauseStore();
      return {day: map[currentBookId] || null, today: todayStr(), pausedToday: map[currentBookId] === todayStr()};
    },
    applyStagePreset, setStageMinutes, setRelearnMinutes, getPlan, stageLabel, formatMinutes,
    reviewPlan, wordReviewLabel, dueForecast, frequencyMastery,
    isProficient, setProficient, resetProficient, proficientCount, renderProfFeedback,
    getProfMark: () => (profMark ? { bookId: profMark.bookId, i: profMark.i, w: profMark.w } : null),
    normalizeState, importState, applyFilter, show, openWord, closeSheet,
    // —— 11 引导与词表范围（getGuideState 只读；openGuide 是界面入口，不写学习记录） ——
    getGuideState, openGuide, guideKey: GUIDE_KEY,
    // —— H 本词问题本地记录（getWordIssueState/buildWordIssuesExport 只读；保存/删除/导出走界面入口） ——
    wordIssuesKey: WORD_ISSUES_KEY,
    wordIssuesKind: WORD_ISSUES_KIND,
    wordIssuesVersion: WORD_ISSUES_VERSION,
    wordIssuesMax: WORD_ISSUES_MAX,
    wordIssueNoteMax: WORD_ISSUE_NOTE_MAX,
    getWordIssueState: () => {
      const state = readWordIssues();
      const ctx = detailWordIssueContext();
      const entry = state.ok && ctx ? currentIssueEntry(state.entries, ctx.bookId, ctx.word) : null;
      return {
        key: WORD_ISSUES_KEY, ok: state.ok, corrupted: !!state.corrupted,
        storageError: !!state.storageError, reason: state.reason || "",
        count: state.ok ? state.entries.length : 0,
        raw: state.corrupted ? state.raw : null,
        context: ctx ? {bookId: ctx.bookId, bookName: ctx.bookName, word: ctx.word, source: ctx.source} : null,
        entry: entry ? pickWordIssueFields(entry) : null
      };
    },
    buildWordIssuesExport: (scope) => wordIssuesExportData(scope === "book" ? "book" : "all"),
    wordIssueSourceText: (i) => wordIssueSourceText(W[i]),
    getListSummary: () => listSummaryText(),
    // —— E 词表整理 / G 统计下钻（只读检查钩子；写操作只走界面按钮，不进学习记录） ——
    getFilterIndices: () => filt.slice(),
    getListSelection: () => validListSelectionIndices(),
    isListOrganize: () => listOrganize,
    getListViewState: () => ({
      loaded: listViewStore.loaded, ready: listViewStore.ready, corrupt: listViewStore.corrupt,
      error: listViewStore.error, raw: listViewStoreRaw, key: LIST_VIEWS_KEY,
      perBook: LIST_VIEWS_PER_BOOK, nameMax: LIST_VIEW_NAME_MAX,
      views: JSON.parse(JSON.stringify(listViewStore.views))
    }),
    getStatsDrill: () => statsDrill ? Object.assign({}, statsDrill) : null,
    getStatsDrillIndices: () => statsDrillIndices(),
    getStatsSelection: () => ({forecast: statsSelForecast, stage: statsSelStage}),
    enterStatsDrill, drillDueDay, drillFreqTier, drillStage, returnFromStatsDrill,
    // —— 13 离线与更新 / 备份状态（retryOffline 为显式重试入口，其余只读） ——
    getOfflineStatus, retryOffline: retryOfflineStatus,
    getBackupStatus, lastExportKey: LAST_EXPORT_KEY, renderBackupStatus,
    // —— 12 阅读字号 / 语言标记 / 设备发音（setFontSize/speak 为合法入口，其余只读） ——
    getFontSize, setFontSize, applyFontSize, getMinWordFontPx: () => minWordFontPx(), fitWord, fitVisibleWords,
    speak, getSpeechPrefs, refreshSpeechVoices, setSpeechRate, setVoiceURI,
    // —— 16 拼写专项（start/exit/submit/skip/next/again 为界面入口；其余只读） ——
    startSpellingDrill,
    exitSpellingDrill: () => {
      if (activeSheet && activeSheet.id === "spellingSheet") { closeSheet(); return true; }
      spellingSession = null;
      return false;
    },
    submitSpellingInput, skipSpellingWord, nextSpellingWord, restartSpellingDrill,
    getSpellingState, getSpellingStats: () => normalizeSpellingState(S.spelling),
    getSpellingCandidates: () => spellingCandidateStats(),
    spellingRoundSize: SPELLING_ROUND_SIZE,
    spellCompare, spellNormalize: spellClean,
    getSpellingVariants: () => SPELLING_VARIANT_PAIRS.map(pair => pair.slice()),
    normalizeSpellingState: (v) => normalizeSpellingState(v),
    wrongWordIndices, applyDrill, startDrill, exitDrill,
    printStatusLabel, printMetaText, printBookEntries, printBookMarkdown,
    wordBookTxt, exportWordBookTxt,
    splitTxtWords, openTxtSplit, renderTxtSplit, downloadTxtPart, downloadTxtSplitZip,
    getTxtSplitFiles: () => txtSplitContext ? txtSplitContext.files : [],
    renderPrintBook, openPrintBook, copyPrintMarkdown,
    heatLevel, heatmapData,
    wilsonInterval, surveyStats, getSurveyStats: () => surveyStats(),
    resetSurvey, getSurvey: () => JSON.parse(JSON.stringify(SURVEY)),
    exTokens, exHtml, meaningHtml, lookupExWord, lookupExWordCandidates, showExPop, hideExPop,
    wordPronVariants, pronHtml, getWordPronVariants: () => JSON.parse(JSON.stringify(WORD_PRON_VARIANTS)),
    getStorageOK: () => storageOK && !blockedBooks.has(currentBookId),
    getStorageAlert: () => $("#appAlert")?.hidden === false ? ($("#appAlertBody")?.textContent || "") : "",
    getS: () => S, getW: () => W,
    // —— 多词书钩子（契约 4.5） ——
    getBook: () => currentBookId,
    getBooks: () => BOOK_DEFS.map(def => ({
      id: def.id,
      name: def.name,
      words: BOOKS[def.id].words.length,
      paperCount: BOOKS[def.id].paperCount,
      available: BOOKS[def.id].available
    })),
    switchBook: (id) => switchBook(id),
    getBookState: (id) => getBookState(id),
    getStorageKeys: () => {
      const books = {};
      for (const def of BOOK_DEFS) books[def.id] = { state: BOOKS[def.id].KEY, prof: BOOKS[def.id].PROF_KEY, survey: BOOKS[def.id].SURVEY_KEY };
      return { active: ACTIVE_KEY, books: books, device: DEVICE_PREFS_KEY,
        defaultBook: DEFAULT_BOOK_KEY, pageBook: PAGE_BOOK_KEY, pageBookMode: PAGE_BOOK_MODE_KEY,
        preferenceJournal: PREF_JOURNAL_KEY };
    },
    // —— O1 设备通用/本书覆盖偏好归属（getPreferenceOwnership 只读；resolve/apply/setInheritance 为合法入口） ——
    getPreferenceFields: () => PREFERENCE_FIELDS.slice(),
    getPreferenceOwnership,
    resolveBookPreferences: (state, bookId, prefs) => resolveBookPreferences(state, bookId, prefs),
    applyPreferencePatch,
    setPreferenceInheritance,
    isPreferenceInherited: (field, bookId) => PREFERENCE_FIELDS.includes(field)
      && !isPreferenceOverridden(field, bookId),
    retryDevicePreferenceWrite,
    recoverPreferenceJournal,
    preferenceJournalKey: PREF_JOURNAL_KEY,
    devicePreferencesKey: DEVICE_PREFS_KEY,
    clearBookPreferenceOverrides,
    getInputPreferenceRevision: () => inputPreferenceRevision,
    // —— O1 本页词书 / 下次默认 / 跨页跟随（setPageBookMode/setDefaultBook 为仅有的显式写入口） ——
    getPageBookState: () => Object.assign(pageBookUiState(), {pageBookKey: PAGE_BOOK_KEY,
      defaultBookKey: DEFAULT_BOOK_KEY, pageModeKey: PAGE_BOOK_MODE_KEY}),
    setPageBookMode,
    setDefaultBook: (id) => setDefaultBookForNextOpen(id),
    applyBookFollowNotice,
    showBookFollowNotice,
    getPendingBookFollow: () => pendingFollowBookId,
    setPhase(p) { phase = p; },
    setCur(i) { cur = i; renderCard(); },
    setVerdict(v) { verdict = v; phase = v === null ? "recall" : "revealed"; }
  };
})();
