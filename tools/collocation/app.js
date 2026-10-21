/* 完形填空固定搭配记忆卡片 — 逻辑 */
(function () {
  'use strict';

  var LS_KEY = 'collocation_v1';
  var DATA = window.COLLOC_DATA || [];
  var CATEGORIES = ['动词短语', '介词搭配', '名词搭配', '形容词搭配', '副词/连接短语', '其他'];
  var COUNT_BUCKETS = [
    { id: 'all', label: '不限', test: function () { return true; } },
    { id: 'ge2', label: '≥2次', test: function (r) { return r.k >= 2; } },
    { id: 'eq2', label: '=2次', test: function (r) { return r.k === 2; } },
    { id: 'eq1', label: '=1次', test: function (r) { return r.k === 1; } }
  ];

  // ── 状态 ──
  var state = {
    seed: 20260101,
    shuffle: true,
    filterScope: 'all',      // all | wrong
    filterCat: '全部',
    filterCount: 'all',
    showCloze: true,
    wrong: Object.create(null),   // colloc -> true
    known: Object.create(null),   // colloc -> true
    sessionKnown: 0,
    sessionBad: 0,
    sessionJudged: Object.create(null) // colloc -> true/false（本轮判定，支持改判）
  };

  var deck = [];        // 当前过滤后的顺序牌堆
  var idx = 0;
  var flipped = false;
  var ui = {};

  // ── 存储 ──
  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        seed: state.seed,
        shuffle: state.shuffle,
        filterScope: state.filterScope,
        filterCat: state.filterCat,
        filterCount: state.filterCount,
        showCloze: state.showCloze,
        wrong: Object.keys(state.wrong),
        known: Object.keys(state.known)
      }));
    } catch (e) { /* private mode */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (typeof d.seed === 'number') state.seed = d.seed;
      if (typeof d.shuffle === 'boolean') state.shuffle = d.shuffle;
      if (typeof d.showCloze === 'boolean') state.showCloze = d.showCloze;
      if (d.filterScope === 'all' || d.filterScope === 'wrong') state.filterScope = d.filterScope;
      if (d.filterCat) state.filterCat = d.filterCat;
      if (d.filterCount) state.filterCount = d.filterCount;
      (d.wrong || []).forEach(function (c) { state.wrong[c] = true; });
      (d.known || []).forEach(function (c) { state.known[c] = true; });
    } catch (e) { /* ignore */ }
  }

  // ── 可复现乱序（mulberry32） ──
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededShuffle(arr, seed) {
    var rnd = mulberry32(seed);
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // ── 过滤 / 组牌 ──
  function currentBucket() {
    for (var i = 0; i < COUNT_BUCKETS.length; i++) {
      if (COUNT_BUCKETS[i].id === state.filterCount) return COUNT_BUCKETS[i];
    }
    return COUNT_BUCKETS[0];
  }

  function buildDeck() {
    var bucket = currentBucket();
    var list = DATA.filter(function (r) {
      if (state.filterScope === 'wrong' && !state.wrong[r.c]) return false;
      if (state.filterCat !== '全部' && r.t !== state.filterCat) return false;
      return bucket.test(r);
    });
    if (state.shuffle) {
      deck = seededShuffle(list, state.seed);
    } else {
      deck = list.slice();
    }
  }

  function cardAt(i) {
    return deck[i] || null;
  }

  // ── 句子渲染 ──
  // 源句中答案写作 【answord】；同句其他空格为 ____
  function clozeHTML(sentence, answord) {
    if (!sentence) return '';
    var esc = sentence
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // 先把【…】换成占位符或高亮
    var out = esc.replace(/【([^】]*)】/g, function (_, ans) {
      return '<span class="blank">____</span>';
    });
    // 其他空格 ____ 保持
    return out;
  }

  function highlightHTML(sentence) {
    if (!sentence) return '';
    var esc = sentence
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return esc.replace(/【([^】]*)】/g, function (_, ans) {
      return '<span class="ans-hl">' + ans + '</span>';
    });
  }

  function pickOcc(card) {
    if (!card || !card.o || !card.o.length) return null;
    // 稳定取第一条
    return card.o[0];
  }

  function sourceLine(occ) {
    var exam = occ.p === '旧' ? '旧卷' : occ.p;
    return exam + ' ' + occ.y + ' · Q' + occ.q;
  }

  // ── 渲染 ──
  function renderStats() {
    var total = DATA.length;
    var wrongN = Object.keys(state.wrong).length;
    var knownN = Object.keys(state.known).length;
    var roundTotal = deck.length;
    var roundDone = deck.reduce(function (n, r) {
      return n + (state.sessionJudged[r.c] !== undefined ? 1 : 0);
    }, 0);
    var judged = state.sessionKnown + state.sessionBad;
    var rate = judged ? Math.round((state.sessionKnown / judged) * 100) : 0;

    ui.statRound.innerHTML = '本轮进度<b>' + roundDone + ' / ' + roundTotal + '</b>';
    ui.statRate.innerHTML = '认识率<b>' + rate + '%</b>';
    ui.statWrong.innerHTML = '错题本<b>' + wrongN + '</b>';
    ui.statKnown.innerHTML = '已掌握<b>' + knownN + ' / ' + total + '</b>';
  }

  function renderCard() {
    var card = cardAt(idx);
    if (!card) {
      ui.stage.hidden = true;
      ui.actions.hidden = true;
      ui.nav.hidden = true;
      ui.empty.hidden = false;
      var msg = state.filterScope === 'wrong' && Object.keys(state.wrong).length === 0
        ? '错题本是空的，先去刷一遍吧。'
        : '当前筛选条件下没有卡片。';
      ui.empty.querySelector('p').textContent = msg;
      renderStats();
      return;
    }
    ui.stage.hidden = false;
    ui.actions.hidden = false;
    ui.nav.hidden = false;
    ui.empty.hidden = true;

    var occ = pickOcc(card);
    var tags = '<span class="tag cat">' + card.t + '</span>';
    if (card.k >= 2) tags += '<span class="tag hot">出现 ' + card.k + ' 次</span>';
    else tags += '<span class="tag">出现 ' + card.k + ' 次</span>';
    if (state.wrong[card.c]) tags += '<span class="tag" style="background:var(--no-soft);color:var(--no);border-color:transparent">错题</span>';
    if (state.known[card.c]) tags += '<span class="tag" style="background:var(--ok-soft);color:var(--ok);border-color:transparent">已掌握</span>';

    // 正面
    var frontHTML = '<div class="tag-row">' + tags + '</div>' +
      '<div class="colloc">' + escapeHtml(card.c) + '</div>' +
      '<div class="hint">点击卡片或按空格翻面</div>';
    if (state.showCloze && occ) {
      frontHTML += '<div class="example-box">' +
        '<div class="ex-label">真题例句 · 答案挖空</div>' +
        '<div class="example-sent">' + clozeHTML(occ.s) + '</div>' +
        '</div>';
    }

    // 背面
    var backHTML = '<div class="tag-row">' + tags + '</div>' +
      '<div class="colloc" style="font-size:1.35rem">' + escapeHtml(card.c) + '</div>' +
      '<div class="meaning">' + escapeHtml(card.m) + '</div>';
    if (card.n) {
      backHTML += '<div class="note">' + escapeHtml(card.n) + '</div>';
    }
    if (occ) {
      backHTML += '<div class="example-box" style="margin-top:0;border-top:none;padding-top:0">' +
        '<div class="ex-label">真题原句 · 答案高亮</div>' +
        '<div class="example-sent">' + highlightHTML(occ.s) + '</div>' +
        '</div>';
    }
    // 全部出处
    var srcs = card.o.map(function (o) {
      return '<div class="src-item"><span class="src-meta">' + sourceLine(o) + '</span></div>';
    }).join('');
    backHTML += '<div class="sources">' + srcs + '</div>';

    ui.faceFront.innerHTML = frontHTML;
    ui.faceBack.innerHTML = backHTML;
    setFlipped(false);
    renderStats();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setFlipped(v) {
    flipped = v;
    ui.cardInner.classList.toggle('flipped', flipped);
  }

  function toggleFlip() {
    if (!cardAt(idx)) return;
    setFlipped(!flipped);
  }

  // ── 判定 ──
  function judge(known) {
    var card = cardAt(idx);
    if (!card) return;
    var prev = state.sessionJudged[card.c];
    if (prev === undefined) {
      if (known) state.sessionKnown += 1;
      else state.sessionBad += 1;
    } else if (prev !== known) {
      if (known) { state.sessionKnown += 1; state.sessionBad -= 1; }
      else { state.sessionKnown -= 1; state.sessionBad += 1; }
    }
    state.sessionJudged[card.c] = known;

    if (known) {
      state.known[card.c] = true;
      delete state.wrong[card.c];
      showToast('✓ 记入已掌握');
    } else {
      state.wrong[card.c] = true;
      delete state.known[card.c];
      showToast('✗ 已加入错题本');
    }
    save();
    next();
  }

  function next() {
    if (idx < deck.length - 1) {
      idx += 1;
    } else {
      idx = 0;
      showToast('本轮走完一圈，回到开头');
    }
    renderCard();
  }

  function prev() {
    if (idx > 0) idx -= 1;
    else idx = deck.length - 1;
    renderCard();
  }

  // ── 筛选 UI ──
  function renderFilters() {
    // 范围
    ui.scopeChips.innerHTML = '';
    [['all', '全部'], ['wrong', '错题本']].forEach(function (pair) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.filterScope === pair[0] ? ' on' + (pair[0] === 'wrong' ? ' bad' : '') : '');
      b.textContent = pair[1];
      b.addEventListener('click', function () {
        state.filterScope = pair[0];
        save();
        buildDeck();
        idx = 0;
        renderFilters();
        renderCard();
      });
      ui.scopeChips.appendChild(b);
    });

    // 类型
    ui.catChips.innerHTML = '';
    ['全部'].concat(CATEGORIES).forEach(function (cat) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.filterCat === cat ? ' on' : '');
      b.textContent = cat;
      b.addEventListener('click', function () {
        state.filterCat = cat;
        save();
        buildDeck();
        idx = 0;
        renderFilters();
        renderCard();
      });
      ui.catChips.appendChild(b);
    });

    // 次数
    ui.countChips.innerHTML = '';
    COUNT_BUCKETS.forEach(function (bk) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.filterCount === bk.id ? ' on' : '');
      b.textContent = bk.label;
      b.addEventListener('click', function () {
        state.filterCount = bk.id;
        save();
        buildDeck();
        idx = 0;
        renderFilters();
        renderCard();
      });
      ui.countChips.appendChild(b);
    });

    ui.shuffleInput.checked = state.shuffle;
    ui.clozeInput.checked = state.showCloze;
    ui.seedLabel.textContent = 'seed ' + state.seed;
  }

  // ── toast ── */
  var toastTimer = null;
  function showToast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      ui.toast.classList.remove('show');
    }, 1600);
  }

  // ── 键盘 ── */
  function onKey(e) {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      toggleFlip();
    } else if (e.key === 'j' || e.key === 'J' || e.key === '1') {
      judge(false);
    } else if (e.key === 'k' || e.key === 'K' || e.key === '2') {
      judge(true);
    } else if (e.key === 'ArrowRight') {
      next();
    } else if (e.key === 'ArrowLeft') {
      prev();
    }
  }

  // ── 启动 ── */
  function init() {
    ui.stage = document.getElementById('stage');
    ui.card = document.getElementById('card');
    ui.cardInner = document.getElementById('cardInner');
    ui.faceFront = document.getElementById('faceFront');
    ui.faceBack = document.getElementById('faceBack');
    ui.actions = document.getElementById('actions');
    ui.nav = document.getElementById('nav');
    ui.empty = document.getElementById('empty');
    ui.toast = document.getElementById('toast');
    ui.statRound = document.getElementById('statRound');
    ui.statRate = document.getElementById('statRate');
    ui.statWrong = document.getElementById('statWrong');
    ui.statKnown = document.getElementById('statKnown');
    ui.scopeChips = document.getElementById('scopeChips');
    ui.catChips = document.getElementById('catChips');
    ui.countChips = document.getElementById('countChips');
    ui.shuffleInput = document.getElementById('shuffleInput');
    ui.clozeInput = document.getElementById('clozeInput');
    ui.seedLabel = document.getElementById('seedLabel');

    load();
    buildDeck();
    renderFilters();
    renderCard();

    ui.card.addEventListener('click', toggleFlip);
    document.getElementById('btnNo').addEventListener('click', function (e) {
      e.stopPropagation();
      judge(false);
    });
    document.getElementById('btnYes').addEventListener('click', function (e) {
      e.stopPropagation();
      judge(true);
    });
    document.getElementById('btnPrev').addEventListener('click', function () {
      setFlipped(false);
      prev();
    });
    document.getElementById('btnNext').addEventListener('click', function () {
      setFlipped(false);
      next();
    });
    document.getElementById('btnRebuild').addEventListener('click', function () {
      // 用当前 seed 重建（可复现）
      buildDeck();
      idx = 0;
      setFlipped(false);
      renderCard();
      showToast('已按 seed ' + state.seed + ' 重排');
    });
    document.getElementById('btnReseed').addEventListener('click', function () {
      state.seed = Math.floor(Math.random() * 2147483647);
      save();
      buildDeck();
      idx = 0;
      setFlipped(false);
      renderFilters();
      renderCard();
      showToast('新 seed ' + state.seed + '（可复现）');
    });

    ui.shuffleInput.addEventListener('change', function () {
      state.shuffle = ui.shuffleInput.checked;
      save();
      buildDeck();
      idx = 0;
      renderCard();
    });
    ui.clozeInput.addEventListener('change', function () {
      state.showCloze = ui.clozeInput.checked;
      save();
      renderCard();
    });

    document.addEventListener('keydown', onKey);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
