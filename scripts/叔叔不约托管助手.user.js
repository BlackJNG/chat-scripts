// ==UserScript==
// @name         叔叔不约 · 一对一托管助手
// @namespace    https://shushubuyue.net/
// @version      3.0.5
// @changelog    3.0.1 增加 @updateURL/@downloadURL，支持油猴自动检查更新
// @changelog    3.0.2 更新地址切换到 gh-proxy.org
// @changelog    3.0.3 接入 APP 桥 GM4W + 女生匹配红色日志 + 女生统计；DOM 版无消息回调，不推 msg 事件
// @changelog    3.0.4 面板：日志移到选项上方、复选框置底；日志最新在最上（40 行可滚）
// @changelog    3.0.5 日志配色参数兼容（无新增行为）
// @updateURL    https://gh-proxy.org/https://raw.githubusercontent.com/BlackJNG/chat-scripts/main/scripts/%E5%8F%94%E5%8F%94%E4%B8%8D%E7%BA%A6%E6%89%98%E7%AE%A1%E5%8A%A9%E6%89%8B.user.js
// @downloadURL  https://gh-proxy.org/https://raw.githubusercontent.com/BlackJNG/chat-scripts/main/scripts/%E5%8F%94%E5%8F%94%E4%B8%8D%E7%BA%A6%E6%89%98%E7%AE%A1%E5%8A%A9%E6%89%8B.user.js
// @description  叔叔不约（shushubuyue.net/.com）随机聊天：男生秒离开、只配女生（客户端筛，不拉黑）、对方离开自动点长条离开、招呼一次不重复、面板可拖动可调间隔；不做全页 500ms 扫描，避免拖卡
// @author       you
// @match        *://*.shushubuyue.net/*
// @match        *://*.shushubuyue.com/*
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;

  // ---------- APP 桥（window.GM4W）：桥不存在时静默跳过 ----------
  const g4 = {
    // 页面桥在真实 window 上；油猴沙箱里要优先取 unsafeWindow
    w() { try { return (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window; } catch (e) { return window; } },
    log(t) { try { const W = g4.w(); if (W.GM4W && W.GM4W.pushLog) W.GM4W.pushLog(String(t)); } catch (e) {} },
    evt(type, id) { try { const W = g4.w(); if (W.GM4W && W.GM4W.pushEvent && id != null) W.GM4W.pushEvent(type, String(id)); } catch (e) {} },
  };
  const esc4 = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));


  /* ============================================================
   * 0. 配置
   * ============================================================ */
  const CFG_KEY = 'arsenal.sb.cfg';
  const VKEY = 'arsenal.sb.version';
  const cfg = Object.assign({
    on: false,
    onlyFemale: true,     // 客户端筛女生（男生直接离开），不维护黑名单
    greet: true,          // 配到女生自动打招呼
    greetText: '哈喽',
    skipPureOnly: true,   // 女生只有"清流"一个标签时跳过（原脚本逻辑）
    gapMin: 3,            // 换人间隔下限（秒）
    gapMax: 6,            // 上限
    soundOn: true,        // 尝试把站内音效打开一次（失败就放弃，不反复折腾）
    tick: 1200,           // 主循环间隔（ms），别调到 500 以下
  }, JSON.parse(localStorage.getItem(CFG_KEY) || '{}'));
  const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {} };
  try {
    if (localStorage.getItem(VKEY) !== '3.0.0') {
      localStorage.removeItem('sb_sound_state');
      localStorage.setItem(VKEY, '3.0.0');
    }
  } catch (e) {}

  const now = () => Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const gapMs = () => {
    const a = Number(cfg.gapMin) || 1;
    const b = Math.max(a, Number(cfg.gapMax) || a);
    return rnd(a * 1000, b * 1000);
  };

  /* ============================================================
   * 1. 面板
   * ============================================================ */
  let panel, statusEl, logEl, peerEl, statEl;
  const logs = [];

  function renderStat() {
    if (statEl) statEl.textContent = '匹配 ' + st.matched + ' / 女生 ' + st.female + ' / 换人 ' + st.leaved;
  }
  function log(msg, tone) {
    const t = new Date().toTimeString().slice(0, 8);
    const line = t + ' ' + msg;
    logs.push({ t: line, c: tone === true ? '#ff5c5c' : (tone || '') });
    if (logs.length > 40) logs.shift();
    if (logEl) {
      logEl.innerHTML = logs.slice().reverse().map(x => x.c
        ? '<span style="color:' + x.c + '">' + esc4(x.t) + '</span>'
        : esc4(x.t)).join('\n');
      logEl.scrollTop = 0;   // 最新一行永远贴顶
    }
    renderStat();
    g4.log(line);
  }
  function setStatus(txt, tone) {
    if (!statusEl) return;
    statusEl.textContent = txt;
    statusEl.style.color = tone === 'ok' ? '#6ee7a8' : tone === 'bad' ? '#ff8a8a' : tone === 'busy' ? '#ffd479' : '#cfd6e4';
  }

  function clampPanel() {
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let l = r.left, t = r.top;
    if (r.height + 16 > vh) t = 8;
    else if (t + r.height > vh - 8) t = Math.max(8, vh - r.height - 8);
    if (l + r.width > vw - 8) l = Math.max(8, vw - r.width - 8);
    if (l < 8) l = 8;
    if (t < 8) t = 8;
    panel.style.left = l + 'px';
    panel.style.top = t + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function buildPanel() {
    const host = document.createElement('div');
    host.id = 'sb-panel';
    host.innerHTML = [
      '<div class="sb-head"><span class="sb-title">叔叔不约 托管</span><span class="sb-min">–</span></div>',
      '<div class="sb-body">',
      '  <div class="sb-row"><span class="sb-k">状态</span><span class="sb-v" id="sb-status">启动中</span></div>',
      '  <div class="sb-row"><span class="sb-k">对方</span><span class="sb-v sb-peer" id="sb-peer">—</span></div>',
      '  <div class="sb-row"><span class="sb-k">统计</span><span class="sb-v" id="sb-stat">匹配 0 / 女生 0 / 换人 0</span></div>',
      '  <div class="sb-btns"><button class="sb-b" id="sb-toggle">开始</button>',
      '    <button class="sb-b ghost" id="sb-leave">离开</button></div>',
      '  <div class="sb-row"><span class="sb-k">换人间隔</span><span class="sb-v">',
      '    <input class="sb-num" id="sb-gapmin" type="number" min="1" step="1"> – ',
      '    <input class="sb-num" id="sb-gapmax" type="number" min="1" step="1"> 秒</span></div>',
      '  <div class="sb-log" id="sb-log"></div>',
      '  <label class="sb-opt"><input type="checkbox" id="sb-female"> 只配女生（客户端筛）</label>',
      '  <label class="sb-opt"><input type="checkbox" id="sb-greet"> 自动打招呼</label>',
      '  <label class="sb-opt"><input type="checkbox" id="sb-pure"> 女生只有"清流"标签时跳过</label>',
      '</div>',
    ].join('');
    document.documentElement.appendChild(host);

    const css = document.createElement('style');
    css.textContent = [
      '#sb-panel{position:fixed;right:12px;bottom:12px;z-index:2147483000;width:238px;background:rgba(18,20,26,.94);',
      'color:#e8ecf6;border:1px solid rgba(255,255,255,.12);border-radius:12px;font:12px/1.55 -apple-system,"PingFang SC",sans-serif;',
      'box-shadow:0 8px 28px rgba(0,0,0,.4);overflow:hidden}',
      '#sb-panel.collapsed .sb-body{display:none}',
      '#sb-panel .sb-head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;',
      'background:rgba(255,255,255,.05);cursor:move}',
      '#sb-panel .sb-title{font-weight:600}',
      '#sb-panel .sb-min{cursor:pointer;padding:0 4px;opacity:.7}',
      '#sb-panel .sb-body{padding:8px 10px 10px}',
      '#sb-panel .sb-row{display:flex;justify-content:space-between;margin-bottom:5px;gap:6px}',
      '#sb-panel .sb-k{opacity:.6;white-space:nowrap}',
      '#sb-panel .sb-v{text-align:right;max-width:150px;word-break:break-all}',
      '#sb-panel .sb-peer{color:#ffd479}',
      '#sb-panel .sb-btns{display:flex;gap:6px;margin:4px 0 8px}',
      '#sb-panel .sb-b{flex:1;padding:6px 0;border-radius:8px;border:0;background:#3b6bff;color:#fff;font-size:12px}',
      '#sb-panel .sb-b.ghost{background:rgba(255,255,255,.1);color:#dfe5f2}',
      '#sb-panel .sb-opt{display:block;margin:3px 0;opacity:.85}',
      '#sb-panel .sb-num{width:40px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);',
      'border-radius:6px;color:#e8ecf6;font-size:12px;padding:1px 4px;text-align:center}',
      '#sb-panel .sb-log{margin-top:8px;height:128px;overflow:auto;background:rgba(0,0,0,.35);border-radius:8px;',
      'padding:6px;font-size:11px;line-height:1.5;white-space:pre-wrap;color:#aab4c8}',
    ].join('');
    document.documentElement.appendChild(css);

    panel = host;
    statusEl = host.querySelector('#sb-status');
    logEl = host.querySelector('#sb-log');
    peerEl = host.querySelector('#sb-peer');
    statEl = host.querySelector('#sb-stat');

    const cbF = host.querySelector('#sb-female');
    const cbG = host.querySelector('#sb-greet');
    const cbP = host.querySelector('#sb-pure');
    cbF.checked = !!cfg.onlyFemale;
    cbG.checked = !!cfg.greet;
    cbP.checked = !!cfg.skipPureOnly;
    cbF.addEventListener('change', (e) => { cfg.onlyFemale = e.target.checked; saveCfg(); log('只配女生：' + (cfg.onlyFemale ? '开' : '关')); });
    cbG.addEventListener('change', (e) => { cfg.greet = e.target.checked; saveCfg(); });
    cbP.addEventListener('change', (e) => { cfg.skipPureOnly = e.target.checked; saveCfg(); });

    const gmin = host.querySelector('#sb-gapmin');
    const gmax = host.querySelector('#sb-gapmax');
    gmin.value = cfg.gapMin; gmax.value = cfg.gapMax;
    const applyGap = () => {
      const a = Number(gmin.value), b = Number(gmax.value);
      cfg.gapMin = isFinite(a) && a > 0 ? a : 3;
      cfg.gapMax = isFinite(b) && b > 0 ? Math.max(cfg.gapMin, b) : cfg.gapMin + 3;
      gmin.value = cfg.gapMin; gmax.value = cfg.gapMax;
      saveCfg(); log('换人间隔 ' + cfg.gapMin + '–' + cfg.gapMax + ' 秒');
    };
    gmin.addEventListener('change', applyGap);
    gmax.addEventListener('change', applyGap);

    host.querySelector('.sb-min').addEventListener('click', () => {
      host.classList.toggle('collapsed');
      setTimeout(clampPanel, 0);
    });

    /* 拖动 */
    const head = host.querySelector('.sb-head');
    let drag = null;
    const pt = (e) => {
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      if (t && typeof t.clientX === 'number') return { x: t.clientX, y: t.clientY };
      return { x: typeof e.clientX === 'number' ? e.clientX : 0, y: typeof e.clientY === 'number' ? e.clientY : 0 };
    };
    head.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('sb-min')) return;
      const p = pt(e), r = host.getBoundingClientRect();
      drag = { dx: p.x - r.left, dy: p.y - r.top };
      host.style.left = r.left + 'px'; host.style.top = r.top + 'px';
      host.style.right = 'auto'; host.style.bottom = 'auto';
    });
    head.addEventListener('touchstart', (e) => {
      if (e.target.classList.contains('sb-min')) return;
      const p = pt(e), r = host.getBoundingClientRect();
      drag = { dx: p.x - r.left, dy: p.y - r.top };
      host.style.left = r.left + 'px'; host.style.top = r.top + 'px';
      host.style.right = 'auto'; host.style.bottom = 'auto';
    }, { passive: true });
    const move = (e) => {
      if (!drag) return;
      const p = pt(e);
      host.style.left = Math.max(0, Math.min(window.innerWidth - 60, p.x - drag.dx)) + 'px';
      host.style.top = Math.max(0, Math.min(window.innerHeight - 40, p.y - drag.dy)) + 'px';
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('touchmove', move, { passive: true });
    const up = () => { if (drag) { drag = null; clampPanel(); } };
    document.addEventListener('mouseup', up);
    document.addEventListener('touchend', up);
    window.addEventListener('resize', clampPanel);

    host.querySelector('#sb-toggle').addEventListener('click', () => {
      cfg.on = !cfg.on; saveCfg();
      host.querySelector('#sb-toggle').textContent = cfg.on ? '暂停' : '开始';
      if (cfg.on) { setStatus('运行中', 'ok'); log('托管已开启'); st.nextRun = now(); }
      else { setStatus('已暂停', 'idle'); log('托管已暂停'); }
    });
    host.querySelector('#sb-leave').addEventListener('click', () => leaveChat(true));
  }

  /* ============================================================
   * 2. DOM 工具（只在需要时扫，避免每 500ms 全页遍历）
   * ============================================================ */
  const Q = (sel, root) => { try { return (root || document).querySelector(sel); } catch (e) { return null; } };
  const QA = (sel, root) => { try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; } };

  function clickAncestor(el) {
    let cur = el;
    for (let i = 0; i < 8 && cur; i++) {
      try { if (getComputedStyle(cur).cursor === 'pointer') return cur; } catch (e) {}
      cur = cur.parentElement;
    }
    return el;
  }

  function forceClick(el) {
    if (!el) return false;
    const t = clickAncestor(el);
    try { t.click(); } catch (e) {}
    ['mousedown', 'mouseup', 'click'].forEach((k) => {
      try { t.dispatchEvent(new MouseEvent(k, { bubbles: true, cancelable: true })); } catch (e) {}
    });
    try {
      t.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
      t.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }));
    } catch (e) {}
    return true;
  }

  // 文本查找：先在小范围里找，找不到才全页扫（全页扫限频，最多 2 秒一次）
  let lastFullScan = 0;
  function findByText(text, exact) {
    const scopes = ['.uni-page-body', '.chat-container', '#app'];
    for (const s of scopes) {
      const root = Q(s);
      if (!root) continue;
      const hit = scan(root, text, exact);
      if (hit) return hit;
    }
    if (now() - lastFullScan < 2000) return null;
    lastFullScan = now();
    return scan(document.body, text, exact);
  }
  function scan(root, text, exact) {
    const all = QA('uni-view, uni-text, div, span', root);
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.children.length > 4 && !exact) continue;
      const t = (el.innerText || '').trim();
      if (!t) continue;
      if (exact ? t === text : t.indexOf(text) !== -1) return el;
    }
    return null;
  }

  /* ============================================================
   * 3. 站点状态
   * ============================================================ */
  const st = { matched: 0, female: 0, leaved: 0, nextRun: 0, lastKey: '', femaleKey: '', greetKey: '', leaving: false, leaveAt: 0 };

  function peerGender() {
    const box = findByText('对方信息', false);
    if (!box) return null;
    const t = box.innerText || '';
    if (t.indexOf('男生') !== -1) return 'male';
    if (t.indexOf('女生') !== -1) return 'female';
    return null;
  }
  function peerTags() {
    return QA('.tag-item').map((el) => (el.textContent || '').trim()).filter(Boolean);
  }
  function peerName() {
    const box = findByText('对方信息', false);
    if (!box) return '';
    const lines = (box.innerText || '').split('\n').map((x) => x.trim()).filter(Boolean);
    return lines.find((x) => x !== '对方信息' && x.indexOf('岁') < 0 && x !== '男生' && x !== '女生') || '';
  }
  function showPeer(g, tags) {
    if (!peerEl) return;
    const gTxt = g === 'male' ? '男生' : g === 'female' ? '女生' : '未知';
    peerEl.textContent = gTxt + (tags && tags.length ? '｜' + tags.join('/') : '');
  }

  function longLeaveBtn() {
    const list = QA('uni-view');
    for (const el of list) {
      const t = (el.innerText || '').trim();
      if (t === '离开聊天' && /bg-red-\d+/.test(el.className || '')) {
        const r = el.getBoundingClientRect();
        if (r.width > 2 && r.height > 2) return el;
      }
    }
    return null;
  }

  function rematchBtn() {
    return Q('.rematch-btn') || findByText('重新匹配', false);
  }

  function sendGreeting() {
    const ta = Q('textarea');
    if (!ta) { log('没找到输入框'); return false; }
    ta.value = cfg.greetText;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(() => {
      const btn = Q('.send-btn') || QA('uni-view').find((v) => (v.className || '').indexOf('send-btn') !== -1);
      if (btn) { forceClick(btn); log('我：' + cfg.greetText); return; }
      try {
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        log('我：' + cfg.greetText + '（回车发送）');
      } catch (e) {}
    }, 400);
    return true;
  }

  function leaveChat(force) {
    if (st.leaving && now() - st.leaveAt < 4000) return false;
    const btn = longLeaveBtn() || Q('.leave-btn') || findByText('离开', true);
    if (!btn) { log('没找到离开按钮'); return false; }
    st.leaving = true; st.leaveAt = now();
    st.leaved++;
    forceClick(btn);
    setTimeout(() => {
      const ok = Q('.uni-modal__btn_primary') ||
        QA('.uni-modal__btn').find((b) => (b.innerText || '').indexOf('确认离开') !== -1) ||
        findByText('确认离开', true);
      if (ok) { forceClick(ok); log('已确认离开'); }
      setTimeout(() => {
        const rm = rematchBtn();
        if (rm) { forceClick(rm); log('已重新匹配'); st.nextRun = now() + gapMs(); }
        else { log('没找到重新匹配，稍后重试'); st.nextRun = now() + 2000; }
        st.leaving = false;
      }, 900);
    }, 800);
    return true;
  }

  /* ============================================================
   * 4. 主循环（默认 1.2 秒，不做无意义的全页扫描）
   * ============================================================ */
  let timer = null;

  function tick() {
    if (!cfg.on) return;
    if (now() < st.nextRun) return;

    // 1) 页面上有"重新匹配"按钮 → 说明已回到待匹配页
    const rm = Q('.rematch-btn');
    if (rm) {
      setStatus('待匹配', 'idle');
      if (now() - st.leaveAt > 800) { forceClick(rm); st.nextRun = now() + 800; log('点重新匹配'); }
      return;
    }

    // 2) 对方离开的长条按钮出现 → 点掉（不管男女）
    if (longLeaveBtn()) {
      setStatus('对方已离开', 'busy');
      leaveChat();
      return;
    }

    // 3) 读对方性别
    const g = peerGender();
    if (!g) { setStatus('等待配对', 'idle'); return; }
    const tags = peerTags();
    showPeer(g, tags);
    const key = peerName() + '|' + tags.join(',');
    if (key !== st.lastKey) { st.lastKey = key; st.matched++; }
    if (cfg.onlyFemale && g === 'male') {
      log('男生，直接离开（不拉黑）');
      setStatus('换人', 'busy');
      leaveChat(true);
      st.nextRun = now() + gapMs();
      return;
    }
    if (g === 'female') {
      if (cfg.skipPureOnly && tags.length === 1 && tags[0] === '清流') {
        log('女生只有"清流"标签，跳过');
        leaveChat(true);
        st.nextRun = now() + gapMs();
        return;
      }
      setStatus('聊天中', 'ok');
      if (st.femaleKey !== key) {
        st.femaleKey = key;
        st.female++;
        renderStat();
        g4.evt('match', key);   // 只推配到女生（id=昵称|标签，稳定）
      }
      if (cfg.greet && st.greetKey !== key) {
        st.greetKey = key;
        setTimeout(() => { if (sendGreeting()) setStatus('已打招呼', 'ok'); }, rnd(600, 1200));
      }
    }
  }

  function startLoop() {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, Math.max(800, Number(cfg.tick) || 1200));
  }

  /* ============================================================
   * 5. 音效开关（一次性尝试，失败就放弃，不反复开抽屉）
   * ============================================================ */
  function ensureSoundOnce() {
    if (!cfg.soundOn) return;
    try {
      const drawer = Q('.uni-drawer');
      const getSw = () => {
        const d = Q('.uni-drawer');
        if (!d) return null;
        const rows = QA('.item-padding', d).find((x) => (x.innerText || '').indexOf('音效') !== -1);
        return rows ? (rows.querySelector('.cursor-pointer') || rows) : null;
      };
      const readOn = (sw) => {
        if (!sw) return null;
        const dot = sw.querySelector('.rounded-full.shadow-md, uni-view.absolute.rounded-full');
        if (dot) {
          const cls = dot.className || '';
          if (cls.indexOf('bg-theme-color') !== -1) return true;
          if (cls.indexOf('bg-gray-300') !== -1 || cls.indexOf('bg-gray-500') !== -1) return false;
          const left = (dot.style && dot.style.left) || '';
          if (/3[0-9]px/.test(left)) return true;
          if (left === '0px') return false;
        }
        const input = sw.querySelector('uni-switch, .van-switch, input');
        if (input) {
          if (input.checked !== undefined) return !!input.checked;
          if ((input.className || '').indexOf('checked') !== -1) return true;
        }
        return null;
      };
      const finish = () => { const m = Q('.uni-drawer__mask'); if (m) forceClick(m); };
      if (!drawer) {
        const bars = Q('.uniui-bars');
        if (!bars) return;
        forceClick(bars);
      }
      let n = 0;
      const iv = setInterval(() => {
        n++;
        const sw = getSw();
        if (sw) {
          clearInterval(iv);
          const on = readOn(sw);
          if (on !== true) { forceClick(sw); setTimeout(() => { finish(); log('已尝试打开音效'); }, 500); }
          else { finish(); log('音效本来就是开的'); }
        } else if (n > 15) { clearInterval(iv); finish(); }
      }, 200);
    } catch (e) {}
  }

  /* ============================================================
   * 6. 启动
   * ============================================================ */
  function start() {
    buildPanel();
    const host = document.getElementById('sb-panel');
    host.querySelector('#sb-toggle').textContent = cfg.on ? '暂停' : '开始';
    log('站点：' + location.host + '（DOM 版 v3.0）');
    setStatus(cfg.on ? '运行中' : '就绪，未开始', cfg.on ? 'ok' : 'idle');
    log('提示：socket 协议还没抓（需登录后抓 WSS 帧），这版走页面按钮路径');
    if (cfg.on) st.nextRun = now();
    startLoop();
    setTimeout(ensureSoundOnce, 2500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 800));
  else setTimeout(start, 800);
})();
