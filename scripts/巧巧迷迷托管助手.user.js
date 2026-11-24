// ==UserScript==
// @name         巧巧 / 迷迷 · 一对一托管助手
// @namespace    https://qiaoqiao.chat/
// @version      1.3.4
// @changelog    1.3.1 增加 @updateURL/@downloadURL，支持油猴自动检查更新
// @changelog    1.3.2 更新地址切换到 gh-proxy.org
// @changelog    1.3.3 接入 APP 桥 GM4W + 女生匹配红色日志（统计原已有：匹配/女生）
// @changelog    1.3.4 面板：日志移到选项上方、复选框置底；日志最新在最上（40 行可滚）
// @updateURL    https://gh-proxy.org/https://raw.githubusercontent.com/BlackJNG/chat-scripts/main/scripts/%E5%B7%A7%E5%B7%A7%E8%BF%B7%E8%BF%B7%E6%89%98%E7%AE%A1%E5%8A%A9%E6%89%8B.user.js
// @downloadURL  https://gh-proxy.org/https://raw.githubusercontent.com/BlackJNG/chat-scripts/main/scripts/%E5%B7%A7%E5%B7%A7%E8%BF%B7%E8%BF%B7%E6%89%98%E7%AE%A1%E5%8A%A9%E6%89%8B.user.js
// @description  巧巧/迷迷 一对一自动匹配 + 自动接话（NIM SDK 层）；默认不筛性别、不带服务端筛选参数，配到人直接聊；换人间隔可自设；拦截站点反调试跳转；资料栏/跳过机器人/面板可拖动
// @author       you
// @match        https://www.qiaoqiao.chat/*
// @match        https://www.mimiu.chat/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ---------- APP 桥（window.GM4W）：桥不存在时静默跳过 ----------
  const g4 = {
    // 页面桥在真实 window 上；油猴沙箱里要优先取 unsafeWindow
    w() { try { return (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window; } catch (e) { return window; } },
    log(t) { try { const W = g4.w(); if (W.GM4W && W.GM4W.pushLog) W.GM4W.pushLog(String(t)); } catch (e) {} },
    evt(type, id) { try { const W = g4.w(); if (W.GM4W && W.GM4W.pushEvent && id != null) W.GM4W.pushEvent(type, String(id)); } catch (e) {} },
  };
  const esc4 = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));


  /* 站点用 disable-devtool（webpack 分块 js/818.<hash>.js，里面只有 2818 这一个模块）。
     它的配置是：一检测到 DevTools 就 location.href = "https://httpstatus.io/403"。
     这里在 script 元素创建时拦掉这个分块，让反调试库永远不初始化；主包其它功能不受影响。 */
  (function blockDevtoolChunk() {
    try {
      const origCreate = Document.prototype.createElement;
      Document.prototype.createElement = function (tag) {
        const el = origCreate.apply(this, arguments);
        if (String(tag).toLowerCase() === 'script') {
          let real = '';
          try {
            Object.defineProperty(el, 'src', {
              configurable: true,
              get() { return real; },
              set(v) {
                const u = String(v);
                if (/\/js\/818\.[a-f0-9]+\.js/i.test(u)) { return; }   // 静默吞掉：不设 src，就不会发起请求，也不会触发 onDevtoolOpen
                real = u;
                el.setAttribute('src', u);
              },
            });
          } catch (e) {}
        }
        return el;
      };
    } catch (e) {}
  })();

  /* ============================================================
   * 0. 站点常量
   * ============================================================ */
  const API = 'https://www.mimiu.chat';          // 两个站共用这套后端
  const IS_MM = /mimi/i.test(location.host);
  const MODE = IS_MM ? 'mm' : 'qc';              // CHANNEL 头
  const SK = MODE + '.';                         // localStorage 前缀 qc. / mm.
  const APPKEY = '38fb9a8f641c247d5e887f94eba2e6d4';
  const AESKEY = '6399717526910958';
  const SUB = { TEXT: 1, PICTURE: 2, VIDEO: 3, AUDIO: 4, DICE: 5, TOPIC: 6, REVOKE: 302 };
  const NTF = { MATCHED: 100, DISCONNECT: 102 };
  const RECEIVE_SUBS = [1, 2, 3, 4, 5, 6, 302];

  /* ============================================================
   * 1. 基础工具
   * ============================================================ */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const now = () => Date.now();

  const store = {
    get(k, def) {
      try {
        const v = localStorage.getItem(SK + k);
        if (v === null || v === '' || v === 'undefined') return def === undefined ? null : def;
        return JSON.parse(v);
      } catch (e) { return def === undefined ? null : def; }
    },
    set(k, v) {
      try { localStorage.setItem(SK + k, JSON.stringify(v)); } catch (e) {}
    },
  };

  // 换人/超时后的重新匹配间隔（用户在面板里自己设，单位秒）
  const gapMs = () => {
    const a = Number(cfg.gapMin) || 0.5;
    const b = Math.max(a, Number(cfg.gapMax) || a);
    return Math.round(rnd(a * 1000, b * 1000));
  };

  const MY_SETTINGS_KEY = 'arsenal.qq.settings';
  const cfg = Object.assign({
    on: false,            // 总开关
    greet: true,          // 匹配成功后主动打招呼
    onlyFemale: false,    // 只匹配女生（默认关：先让你看清匹配到人是什么样）
    gapMin: 3,            // 换人/超时后重新匹配的最小间隔（秒）
    gapMax: 6,            // 最大间隔（秒）
    autoRematch: true,    // 对方离开后自动重新匹配
    maxLen: 42,           // 单条最多字数
    minGap: 2600,         // 两次发送最小间隔
    maxPerHour: 40,       // 单号每小时最多发多少条
    showMeta: true,       // 资料栏（城市｜注册日期｜机器人）
    skipBot: true,        // 检测到 auto=true 的机器人直接断开
    autoSound: true,      // 自动把站内"消息提示"打开
    pureOff: true,        // 渲染资料后把"清流模式"关掉（否则城市那行还是糊的）
    filterByNum: true,    // 勾了"只匹配女生"时，用 contactInfo.gender(1男/2女)兜底筛
    serverFilter: false,  // 是否把 filterGender:2 塞进匹配请求；非 VIP 会被服务端拒/忽略，默认关，免得直接匹配失败
  }, JSON.parse(localStorage.getItem(MY_SETTINGS_KEY) || '{}'));
  const saveCfg = () => localStorage.setItem(MY_SETTINGS_KEY, JSON.stringify(cfg));

  // 版本迁移：老版本存过 onlyFemale=true / serverFilter=true，会盖掉新默认值，这里强制清一次
  try {
    const VKEY = 'arsenal.qq.version';
    if (localStorage.getItem(VKEY) !== '1.3.0') {
      cfg.onlyFemale = false;
      cfg.serverFilter = false;
      saveCfg();
      localStorage.setItem(VKEY, '1.3.0');
    }
  } catch (e) {}

  /* ============================================================
   * 2. 接管页面里的 NIM SDK
   * ============================================================ */
  let __req = null;
  let sdk = null;
  let aes = null;
  const cache = { sdkMod: null, aesMod: null };

  function getReq() {
    if (__req) return __req;
    const chunk = window.webpackChunkxchat_web;
    if (!chunk || typeof chunk.push !== 'function') return null;
    let r = null;
    try { chunk.push([[Symbol('arsenal')], {}, (req) => { r = req; }]); } catch (e) { return null; }
    __req = r;
    return r;
  }

  const srcOf = (factory) => { try { return factory.toString(); } catch (e) { return ''; } };

  // 模块号会随打包变化（实测 8242 稳定、AES 从 959 变成 1959），所以按特征扫描
  function findSDKModule(req) {
    if (cache.sdkMod) return cache.sdkMod;
    let ids = [];
    try { ids = Object.keys(req.m || {}); } catch (e) { return null; }
    for (let i = 0; i < ids.length; i++) {
      const src = srcOf(req.m[ids[i]]);
      if (!src || src.indexOf('V2NIMLoginService') < 0) continue;
      try {
        const m = req(ids[i]);
        const ex = m && (m.default || m);
        if (ex && typeof ex.getInstance === 'function') { cache.sdkMod = ex; return ex; }
      } catch (e) {}
    }
    return null;
  }

  function findAESModule(req) {
    if (cache.aesMod) return cache.aesMod;
    let ids = [];
    try { ids = Object.keys(req.m || {}); } catch (e) { return null; }
    for (let i = 0; i < ids.length; i++) {
      const src = srcOf(req.m[ids[i]]);
      if (!src || src.indexOf(AESKEY) < 0) continue;
      try {
        const m = req(ids[i]);
        const ex = m && (m.default || m);
        if (ex && typeof ex.w === 'function' && typeof ex.Y === 'function') { cache.aesMod = ex; return ex; }
      } catch (e) {}
    }
    return null;
  }

  const encText = (t) => { try { return aes ? String(aes.w(String(t))) : ''; } catch (e) { return ''; } };
  const decText = (c) => { try { return aes ? String(aes.Y(String(c))) : ''; } catch (e) { return ''; } };

  async function boot() {
    for (let i = 0; i < 60; i++) {
      const req = getReq();
      if (req) {
        const s = findSDKModule(req);
        const a = findAESModule(req);
        if (s && a) { cache.sdkMod = s; cache.aesMod = a; break; }
      }
      await sleep(700);
    }
    if (!cache.sdkMod) { setStatus('页面脚本未就绪', 'bad'); log('找不到 NIM 模块，站点可能改版'); return; }
    aes = cache.aesMod;
    for (let i = 0; i < 20; i++) {
      try {
        sdk = cache.sdkMod.getInstance();
        if (sdk) break;
      } catch (e) {}
      await sleep(700);
    }
    if (!sdk) { setStatus('请先登录账号', 'bad'); log('SDK 未初始化：先登录'); return; }
    hook();
    setStatus('就绪，未开始', 'idle');
    log('SDK 已接管（' + (IS_MM ? '迷迷' : '巧巧') + '）');
  }

  function hook() {
    try {
      sdk.V2NIMMessageService.on('onReceiveMessages', onMessages);
    } catch (e) { log('监听消息失败 ' + e.message); }
    try {
      sdk.V2NIMNotificationService.on('onReceiveCustomNotifications', onNotifications);
    } catch (e) { log('监听通知失败 ' + e.message); }
  }

  /* ============================================================
   * 3. 会话状态
   * ============================================================ */
  const myImId = () => { const sid = store.get('sid'); return sid ? 'q_' + sid : null; };
  const convInfo = () => store.get('conversationInfo') || null;
  const contactInfo = () => store.get('contactInfo') || {};
  const convActive = () => { const c = convInfo(); return !!(c && c.id && c.connect !== false); };

  const st = {
    matchedAt: 0, stage: 1, peerMsgs: 0, myMsgs: 0,
    repliedOnce: false, pendingReply: null, lastSendAt: 0,
    sentThisHour: 0, hourStart: now(), greetSent: false,
    lastHadQuestion: false, coldCount: 0, matching: false, matchTimer: null,
    matches: 0, femaleCount: 0,
  };

  const userId = (c) => (c && (c.nickname || c.nick || c.userName || c.name)) || (c && c.imId) || '对方';
  const peerGender = (c) => { if (!c) return null; return c.gender != null ? c.gender : (c.sex != null ? c.sex : null); };

  /* ============================================================
   * 4. 匹配 / 断开
   * ============================================================ */
  function api(path, body) {
    const token = store.get('token');
    const username = store.get('username');
    return fetch(API + '/api/' + path, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'CHANNEL': MODE,
        'VERSION': '127',
        'TOKEN': token || '',
        'USERNAME': username || '',
      },
      body: JSON.stringify(body || {}),
    }).then((r) => r.json());
  }

  function matchNow() {
    if (!cfg.on) { log('总开关没开'); return; }
    if (st.matching) { log('正在匹配中，别重复点'); return; }
    if (!store.get('token') || !store.get('username')) { log('未登录，先登录'); return; }
    st.matching = true;
    setStatus('匹配中…', 'busy');
    const sid = store.get('sid');
    const body = {
      gender: Number(store.get('gender') || 1),
      age: Number(store.get('age') || 22),
      tags: store.get('tags') || [],
      hideLocation: !!store.get('hideLocation'),
      hideVipTag: !!store.get('hideVipTag'),
      openBan: !!store.get('openBan'),
      filterGender: (cfg.serverFilter && cfg.onlyFemale) ? 2 : 0,
      filterLocation: 0,
      filterAge: 0,
    };
    const srv = (cfg.serverFilter && cfg.onlyFemale);
    log('发起匹配（服务端性别筛：' + (srv ? 'filterGender=2' : '关，不带参数') + '｜客户端筛女生：' + (cfg.onlyFemale ? '开' : '关') + '）');
    api('match/start', body).then((j) => {
      const code = j && j.code;
      if (code !== 0) {
        st.matching = false;
        setStatus('匹配失败', 'bad');
        log('匹配失败 ' + (code || '') + ' ' + ((j && j.msg) || ''));
        if (code === 40001) log('提示：账号登录态失效，重新登录');
        return;
      }
      log('等待配对（最长 30 秒）');
      clearTimeout(st.matchTimer);
      st.matchTimer = setTimeout(() => {
        if (st.matching && !convActive()) {
          st.matching = false;
          setStatus('这轮没配到', 'idle');
          log('30 秒没有配到，稍后重试');
          scheduleRematch(gapMs());
        }
      }, 30000);
    }).catch((e) => {
      st.matching = false;
      setStatus('网络异常', 'bad');
      log('匹配请求异常 ' + e.message);
    });
    // 兜底：sid 拿不到时也可以靠通知里的 conversationInfo 建立会话
    if (!sid) log('提示：未读到 sid，仍可继续（只发不收损失）');
  }

  function scheduleRematch(ms) {
    if (!cfg.on || !cfg.autoRematch) return;
    clearTimeout(st.pendingReply);
    setTimeout(() => { if (cfg.on && !convActive()) matchNow(); }, ms == null ? rnd(2000, 4500) : ms);
  }

  function disconnectMine(silent) {
    const c = convInfo();
    const ct = contactInfo();
    const me = myImId();
    if (!c || !c.id) return;
    try {
      if (!silent) sdk.V2NIMNotificationService.sendCustomNotification(c.id, JSON.stringify({ subType: NTF.DISCONNECT, info: { disconnectId: me } }));
    } catch (e) {}
    api('match/disconnect', { disconnectId: me, notifyId: ct.imId, chatLength: st.myMsgs }).catch(() => {});
    const next = Object.assign({}, c, { connect: false, disconnectId: me, disconnectTime: now() });
    store.set('conversationInfo', next);
    log('已断开当前会话');
  }

  /* ============================================================
   * 5. 收发消息
   * ============================================================ */
  function sendText(text) {
    if (!sdk) return false;
    const c = convInfo();
    if (!c || !c.id || c.connect === false) { log('当前没有可发送的会话'); return false; }
    const throttle = checkSendBudget();
    if (throttle) { log(throttle); return false; }
    const body = String(text == null ? '' : text).trim().slice(0, cfg.maxLen);
    const safe = sanitizeOut(body);
    if (!safe) return false;
    const raw = JSON.stringify({ body: encText(safe) });
    let msg = null;
    try {
      msg = sdk.V2NIMMessageCreator.createCustomMessageWithAttachment({ raw }, SUB.TEXT);
    } catch (e) { log('建消息失败 ' + e.message); return false; }
    if (!msg) { log('建消息返回空'); return false; }
    try {
      sdk.V2NIMMessageService.sendMessage(msg, c.id).then(() => {
        st.myMsgs++; st.lastSendAt = now(); st.sentThisHour++;
        log('我：' + safe);
        setStatus('聊天中', 'ok');
      }).catch((err) => {
        const code = err && err.code;
        log('发送失败 ' + (code || (err && err.message) || ''));
        if (code === 102426) { log('已被对方拉黑，重新匹配'); onPeerLeft('拉黑'); }
      });
      return true;
    } catch (e) { log('发送异常 ' + e.message); return false; }
  }

  function checkSendBudget() {
    if (now() - st.hourStart > 3600000) { st.hourStart = now(); st.sentThisHour = 0; }
    if (st.sentThisHour >= cfg.maxPerHour) return '本小时发送已达上限，先歇会儿';
    if (now() - st.lastSendAt < cfg.minGap) return '发送太快，缓一下';
    return '';
  }

  // 出站清洗：不出现联系方式、链接、敏感词
  function sanitizeOut(t) {
    const banned = /(微信|威信|薇信|vx|wx|qq|扣扣|企鹅|电话|手机号|加我|加个好友|二维码|扫码|链接|https?:|www\.|\.com)/i;
    if (banned.test(t)) return '';
    return t.replace(/\s+/g, ' ').trim();
  }

  function onMessages(list) {
    if (!list || !list.length) return;
    const c = convInfo();
    const me = myImId();
    list.slice().reverse().forEach((m) => {
      if (!m || m.messageType !== 100) return;
      if (RECEIVE_SUBS.indexOf(m.subType) < 0) return;
      if (m.subType === SUB.REVOKE) return;
      if (me && m.senderId === me) return;
      if (c && c.id && m.conversationId && m.conversationId !== c.id) return;

      let body = '';
      try {
        const raw = m.attachment && m.attachment.raw;
        const obj = JSON.parse(raw);
        body = decText(obj.body);
      } catch (e) { body = ''; }

      if (!body) {
        if (m.subType === SUB.PICTURE) body = '[图片]';
        else if (m.subType === SUB.AUDIO) body = '[语音]';
        else if (m.subType === SUB.DICE) body = '';
        else if (m.subType === SUB.TOPIC) body = '';
        else return;
      }
      onPeerText(body, m);
    });
  }

  function onNotifications(list) {
    const n = list && list[0];
    if (!n) return;
    let payload = null;
    try { payload = JSON.parse(n.content || '{}'); } catch (e) { return; }
    const sub = payload.subType;
    const info = payload.info || {};

    if (sub === NTF.MATCHED) {
      if (!info.conversationInfo || !info.contactInfo) return;
      store.set('conversationInfo', info.conversationInfo);
      store.set('contactInfo', info.contactInfo);
      st.matching = false;
      clearTimeout(st.matchTimer);
      st.matchedAt = now(); st.stage = 1; st.peerMsgs = 0; st.myMsgs = 0;
      st.greetSent = false; st.coldCount = 0; st.lastHadQuestion = false;
      const ct = info.contactInfo || {};
      st.matches++;
      updateStat();
      setStatus('聊天中', 'ok');
      const isGirl = (numGender(ct) !== 1);
      log('配对成功：' + userId(ct) + '（数字性别 ' + (ct.gender != null ? ct.gender : '?') + '）', isGirl);
      if (isGirl) g4.evt('match', userId(ct));   // 只推配到女生（id=对方 imId）
      afterMatched(ct);
      return;
    }

    if (sub === NTF.DISCONNECT) {
      const d = info.disconnectId;
      if (d && d === myImId()) return;  // 自己发的
      onPeerLeft('对方断开');
    }
  }

  // 换人节奏：换太勤会被站点限流，连续换 6 次就歇 60 秒
  const skipStat = { n: 0, since: now() };

  // 配到人之后：先记资料 → 数字性别快速判（1=男，立刻走，不等 DOM）→ DOM 兜底复核
  function afterMatched(ct) {
    try {
      log('[calib] ' + JSON.stringify({
        imId: ct.imId, gender: ct.gender, auto: ct.auto, vip: ct.vip,
        city: ct.city, province: ct.province, registerTime: ct.registerTime, matchNumber: ct.matchNumber,
      }).slice(0, 320));
    } catch (e) {}
    renderMeta(ct);                        // 城市｜注册日期｜机器人
    setTimeout(turnOffPure, 500);          // 清流不关，城市那行看不清

    if (cfg.skipBot && ct.auto === true) { log('机器人（auto=true），换人'); leaveAndRematch(); return; }

    // 关键：非 VIP 服务端不会帮你筛，这里按 contactInfo.gender 立刻筛（1=男）
    const numG = numGender(ct);
    if (cfg.onlyFemale && numG === 'male') { log('性别=1（男），立刻换人，不浪费话术'); leaveAndRematch(); return; }

    // 数字拿不到（或不是男）→ 等页面 .user-info 渲染出来再复核一次
    setTimeout(() => judgePeer(ct), 1200);
  }

  function judgePeer(ct) {
    if (!convActive()) return;
    const domG = genderFromDom();
    log('页面性别：' + genderLabel(domG) + '｜contactInfo.gender=' + (ct.gender != null ? ct.gender : '?'));
    const eff = domG || (cfg.filterByNum ? numGender(ct) : null);

    if (cfg.onlyFemale && eff === 'male') { log('不是女生（DOM 复核），换人'); leaveAndRematch(); return; }
    if (eff === 'female') { st.femaleCount++; updateStat(); }
    if (cfg.onlyFemale && !eff) log('性别没读到，先留着（数字字段也没有，只能等对方开口）');

    if (cfg.greet && !st.greetSent && st.peerMsgs === 0) {
      setTimeout(() => {
        if (!convActive() || st.peerMsgs > 0) return;  // 对方先说话了就不重复打招呼
        if (sendText(pick(['哈喽', '哈喽', '哈喽呀']))) st.greetSent = true;
      }, rnd(900, 1600));
    }
  }

  function leaveAndRematch() {
    clearTimeout(st.pendingReply);
    st.pendingReply = null;
    st.greetSent = true;          // 都要走了，别再说一句
    disconnectMine(false);
    setStatus('已换人', 'busy');
    skipStat.n++;
    if (now() - skipStat.since > 10 * 60 * 1000) { skipStat.n = 1; skipStat.since = now(); }
    if (skipStat.n >= 6) {
      skipStat.n = 0; skipStat.since = now();
      log('连续换人 6 次，停 60 秒再匹配（防站点限流）');
      scheduleRematch(60000);
      return;
    }
    scheduleRematch(gapMs());
  }

  function onPeerLeft(reason) {
    const c = convInfo();
    if (c && c.id) {
      store.set('conversationInfo', Object.assign({}, c, { connect: false, disconnectId: contactInfo().imId || '', disconnectTime: now() }));
    }
    setStatus('已结束', 'idle');
    log(reason + '，稍后重新匹配');
    clearTimeout(st.pendingReply);
    st.pendingReply = null;
    scheduleRematch(gapMs());
  }

  /* ============================================================
   * 6. 人设与回复策略
   *   原则：短句、口语、不查户口、不要联系方式、不 PUA、不重复
   * ============================================================ */
  const bag = new Set();
  function draw(pool) {
    let cands = pool.filter((x) => !bag.has(x));
    if (!cands.length) { pool.forEach((x) => bag.delete(x)); cands = pool.slice(); }
    if (bag.size > 40) bag.clear();
    const s = pick(cands);
    bag.add(s);
    return s;
  }

  const P = {
    greetBack: ['哈喽', '你好呀', '在呢', '嗯 在的', '哈喽哈喽'],
    warm: ['刚下班 有点累', '今天天气还挺舒服的', '你在干嘛呢', '刚吃完饭 在刷手机', '我这边刚忙完一阵'],
    probe: ['你平时都这个点在线啊', '你说话还挺有意思的', '感觉你挺会聊的', '你平时都玩些什么', '听你这么说 有点好奇'],
    deep: ['我最近也挺宅的 懒得出门', '有时候一个人待着还挺舒服', '你这么一说 我倒想起点事', '我属于慢热那种 聊开了话就多', '说实话 我也不是特别会聊天的人'],
    laugh: ['哈哈哈哈', '笑死 你也太逗了', '这个我真没想到', '行 你赢了'],
    shortReply: ['嗯嗯', '哈哈 咋啦', '在呢', '嗯 你说'],
    coldBack: ['嗯', '好', '行'],
    askBack: ['你呢', '你那边怎么样', '换你了 说说你', '你先说'],
    close: ['那就先这样 有空再聊', '行 不打扰你了', '嗯 那先忙你的'],
  };

  function isContactAsk(t) {
    return /(微信|vx|wx|qq|加个|留个|电话|手机号|联系方式|二维码|扫码)/i.test(t);
  }
  function isGreeting(t) {
    return /^(哈喽|哈啰|hello|hi|嗨|你好|在吗|在不在|在嘛|有人吗)/i.test(t.trim());
  }
  function isQuestion(t) {
    return /[?？]\s*$/.test(t) || /(吗|呢|什么|怎么|为什么|哪|多少|几岁|多大|是不是|有没有)/.test(t);
  }
  function isCold(t) {
    const s = t.trim();
    return s.length <= 2 || /^(嗯+|哦+|好+|行+|ok|okay|额+|啊+)$/i.test(s);
  }

  function replyFor(t) {
    const s = String(t || '').trim();
    if (!s) return draw(P.warm);

    if (isContactAsk(s)) {
      // 不换联系方式，也不硬拒，轻巧带过
      return draw(['先聊着呗', '我这人不太爱加人 先聊着', '哈哈 急啥 先聊着', '暂时不加这些 聊得来再说']);
    }
    if (isGreeting(s)) return draw(P.greetBack);
    if (isCold(s)) {
      st.coldCount++;
      if (st.coldCount >= 2) return draw(P.coldBack);
      return draw(P.shortReply);
    }
    st.coldCount = 0;

    if (isQuestion(s)) {
      // 回答 + 反问，但连续两次反问就改成陈述
      const base = draw(st.stage >= 4 ? P.deep : P.warm);
      if (st.lastHadQuestion) { st.lastHadQuestion = false; return base; }
      st.lastHadQuestion = true;
      return base + '，' + draw(P.askBack);
    }
    if (/哈哈|笑死|😂|🤣|搞笑/.test(s)) return draw(P.laugh);

    st.stage = Math.min(4, st.stage + 1);
    if (s.length >= 18) return draw(P.deep);
    return draw(st.stage >= 3 ? P.probe : P.warm);
  }

  function onPeerText(text, msg) {
    const shown = String(text || '').slice(0, 60);
    const mid = (msg && (msg.clientMsgId || msg.id || msg.uuid || msg.messageId)) ||
      ('m|' + (st.matches || 0) + '|' + st.peerMsgs + '|' + shown.slice(0, 20));
    g4.evt('msg', mid);
    log('TA：' + (shown || '[非文本]'));
    st.peerMsgs++;
    st.greetSent = true;
    if (!cfg.on) return;
    if (!convActive()) return;
    if (text === '[图片]' || text === '[语音]') {
      scheduleReply(() => sendText(draw(['看不清 你发的是啥', '刚没注意 你说啥', '这边有点卡 看图没加载出来'])));
      return;
    }
    if (!text) return;
    if (st.stage < 2) st.stage = 2;
    scheduleReply(() => sendText(replyFor(text)));
  }

  function scheduleReply(fn) {
    if (st.pendingReply) clearTimeout(st.pendingReply);
    const delay = rnd(1200, 2800);
    st.pendingReply = setTimeout(() => {
      st.pendingReply = null;
      if (!cfg.on || !convActive()) return;
      // 对方连发多条时只回一次（合并）
      fn();
    }, delay);
  }

  /* ============================================================
   * 6.5 站点 DOM 辅助（只读站点节点 + 只 append/删自己的节点）
   *   2026-11-23 实测（未登录的 /home）：
   *     .van-nav-bar__right 常驻，内含 position:absolute 的筛选图标盒
   *     .menuCell 抽屉单元格 15 个常驻 DOM：首页/漂流瓶/无名信/广播/…/
   *       隐藏位置/隐藏VIP标志/开启消息提示/敏感词过滤/夜间模式/…
   *     → 开关能"直接读"，不需要旧版那样先开菜单再关菜单
   *     .user-info、.custom_rich_input 只在聊天页出现
   * ============================================================ */
  const DOMX = {
    q(sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } },
    qa(sel, root) { try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; } },
    point(e) {
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      if (t && typeof t.clientX === 'number') return { x: t.clientX, y: t.clientY };
      return { x: typeof e.clientX === 'number' ? e.clientX : 0, y: typeof e.clientY === 'number' ? e.clientY : 0 };
    },
    forceClick(el) {
      if (!el) return false;
      const o = { bubbles: true, cancelable: true };
      try { el.dispatchEvent(new MouseEvent('mousedown', o)); el.dispatchEvent(new MouseEvent('mouseup', o)); } catch (e) {}
      try { el.dispatchEvent(new MouseEvent('click', o)); } catch (e) {}
      try { if (typeof el.click === 'function') el.click(); } catch (e) {}
      return true;
    },
  };

  function fmtTs(ts) {
    if (!ts) return '';
    const t = String(ts).length === 10 ? Number(ts) * 1000 : Number(ts);
    const d = new Date(t);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // 资料文案：城市｜注册:YYYY-MM-DD｜机器人/VIP
  function metaText(ct) {
    if (!ct) return '';
    const city = ct.city || ct.province || '';
    const reg = ct.registerTime ? '注册:' + fmtTs(ct.registerTime) : '';
    const flag = ct.auto === true ? '机器人' : (ct.vip === true ? 'VIP' : '');
    const parts = [];
    if (city) parts.push(city);
    if (reg) parts.push(reg);
    if (flag) parts.push(flag);
    return parts.length ? '【' + parts.join('｜') + '】' : '';
  }

  // 城市那一行：找 .user-info 里带 location 图标的 .row-center
  function findCityHost() {
    let row = null;
    DOMX.qa('.user-info .row-center').forEach((r) => {
      if (row) return;
      let hit = false;
      try { hit = !!r.querySelector('img[src*="location"]') || /location_fill|location\.[a-f0-9]/i.test(r.innerHTML); } catch (e) {}
      if (hit) row = r;
    });
    if (!row) return null;
    const div = row.querySelector('div:not(.icon-container)');
    return div || row.lastElementChild || row;
  }

  let metaFor = '';
  function renderMeta(ct) {
    if (!cfg.showMeta) return;
    const txt = metaText(ct);
    const rowEl = document.getElementById('ars-qq-meta');
    if (rowEl) rowEl.textContent = txt || '—';

    // 只删自己上一次插的 span，绝不碰站点节点
    const old = document.getElementById('ars-qq-citytag');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    const hostEl = findCityHost();
    const key = String(ct.imId || '') + '|' + String(ct.startMatchTime || '');
    if (hostEl && txt) {
      const span = document.createElement('span');
      span.id = 'ars-qq-citytag';
      span.textContent = ' ' + txt;
      span.style.cssText = 'color:#ffd479;font-size:11px;margin-left:2px;';
      try { hostEl.appendChild(span); } catch (e) {}
      metaFor = key;
      log('资料：' + txt);
    } else if (txt) {
      log('资料（页面上没找到城市行，只写在面板）：' + txt);
    }
  }

  function genderFromDom() {
    const info = DOMX.q('.user-info');
    if (!info) return null;
    const t = info.innerText || '';
    if (t.indexOf('男生') >= 0) return 'male';
    if (t.indexOf('女生') >= 0) return 'female';
    return null;
  }
  const genderLabel = (g) => (g === 'male' ? '男' : g === 'female' ? '女' : '未知');
  // 站点数字约定：1=男 2=女（未逐项验证，故默认只用于日志/可选兜底）
  function numGender(ct) {
    const g = ct && ct.gender;
    if (g === 2 || g === '2') return 'female';
    if (g === 1 || g === '1') return 'male';
    return null;
  }

  /* ---------- 站内开关（消息提示 / 清流模式） ---------- */
  function cellSwitch(kw) {
    const cells = DOMX.qa('.menuCell');
    for (let i = 0; i < cells.length; i++) {
      const t = cells[i].innerText || '';
      if (t.indexOf(kw) >= 0) {
        const sw = cells[i].querySelector('.van-switch');
        if (sw) return sw;
      }
    }
    return null;
  }
  const soundSwitch = () => cellSwitch('消息提示');
  const pureSwitch = () => cellSwitch('清流');
  const swOn = (sw) => !!(sw && String(sw.className || '').indexOf('van-switch--on') >= 0);

  const svgSound = (c) => '<svg viewBox="0 0 24 24" width="19" height="19" xmlns="http://www.w3.org/2000/svg"><path d="M3 9v6h4l5 5V4L7 9H3z" fill="' + c + '"/><path d="M16.5 8.5a5 5 0 0 1 0 7" stroke="' + c + '" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M19 6a8.5 8.5 0 0 1 0 12" stroke="' + c + '" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
  const svgShield = (c) => '<svg viewBox="0 0 24 24" width="19" height="19" xmlns="http://www.w3.org/2000/svg"><path d="M12 2l8 3.2v5.8c0 4.7-3.2 8.1-8 11-4.8-2.9-8-6.3-8-11V5.2L12 2z" fill="' + c + '"/><path d="M12 7l3.5 1.4v2.4c0 1.9-1.3 3.3-3.5 4.5-2.2-1.2-3.5-2.6-3.5-4.5V8.4L12 7z" fill="rgba(0,0,0,.25)"/></svg>';

  function updateTopIcon(which, on) {
    const el = document.getElementById(which === 'sound' ? 'ars-top-sound' : 'ars-top-pure');
    if (!el) return;
    el.innerHTML = which === 'sound' ? svgSound(on ? '#ffc800' : 'rgba(255,255,255,.85)') : svgShield(on ? '#4ade80' : '#ffc800');
  }

  let topTries = 0;
  function initTopToggles() {
    if (topTries >= 15) return;
    const navRight = DOMX.q('.van-nav-bar__right');
    if (!navRight) { topTries++; setTimeout(initTopToggles, 1200); return; }

    const filterBox = navRight.querySelector('div[style*="position: absolute"]');
    const fw = (filterBox && filterBox.offsetWidth) || 32;
    const gap = 6;

    const pureOnNow = swOn(pureSwitch());
    const soundOnNow = swOn(soundSwitch()) || true; // 默认按开显色，读到关会覆盖

    if (!document.getElementById('ars-top-pure')) {
      const pure = document.createElement('div');
      pure.id = 'ars-top-pure';
      pure.title = '清流模式';
      pure.style.cssText = 'position:absolute;right:' + (12 + fw + gap) + 'px;top:50%;transform:translateY(-50%);display:flex;align-items:center;cursor:pointer;padding:4px;z-index:10;';
      pure.innerHTML = svgShield(pureOnNow ? '#4ade80' : '#ffc800');
      navRight.appendChild(pure);
      pure.addEventListener('click', () => {
        const sw = pureSwitch();
        if (!sw) { log('没找到"清流模式"开关（可能要登录后才出现）'); return; }
        const before = swOn(sw);
        DOMX.forceClick(sw);
        setTimeout(() => { updateTopIcon('pure', !before); log('清流模式：' + (!before ? '开' : '关')); }, 300);
      });
    }

    const pureEl = document.getElementById('ars-top-pure');
    const pw = (pureEl && pureEl.offsetWidth) || 27;

    if (!document.getElementById('ars-top-sound')) {
      const snd = document.createElement('div');
      snd.id = 'ars-top-sound';
      snd.title = '消息提示';
      snd.style.cssText = 'position:absolute;right:' + (12 + fw + gap + pw + gap) + 'px;top:50%;transform:translateY(-50%);display:flex;align-items:center;cursor:pointer;padding:4px;z-index:10;';
      snd.innerHTML = svgSound(soundOnNow ? '#ffc800' : 'rgba(255,255,255,.85)');
      navRight.appendChild(snd);
      snd.addEventListener('click', () => {
        const sw = soundSwitch();
        if (!sw) { log('没找到"开启消息提示"开关'); return; }
        const before = swOn(sw);
        DOMX.forceClick(sw);
        setTimeout(() => { updateTopIcon('sound', !before); log('消息提示：' + (!before ? '开' : '关')); }, 300);
      });
    }

    if (swOn(soundSwitch())) updateTopIcon('sound', true);
    updateTopIcon('pure', pureOnNow);
  }

  let soundDone = false, pureDone = false;
  function ensureSound() {
    if (!cfg.autoSound || soundDone) return;
    const sw = soundSwitch();
    if (!sw) return;
    if (swOn(sw)) { soundDone = true; updateTopIcon('sound', true); return; }
    DOMX.forceClick(sw);
    setTimeout(() => {
      const s2 = soundSwitch();
      if (s2 && !swOn(s2)) DOMX.forceClick(s2);
      soundDone = true;
      updateTopIcon('sound', true);
      log('消息提示已自动开启');
    }, 700);
  }

  function turnOffPure() {
    if (!cfg.pureOff || pureDone) return;
    const sw = pureSwitch();
    if (!sw) return;
    if (!swOn(sw)) { pureDone = true; updateTopIcon('pure', false); return; }
    DOMX.forceClick(sw);
    setTimeout(() => {
      const s2 = pureSwitch();
      if (s2 && swOn(s2)) DOMX.forceClick(s2);
      pureDone = true;
      updateTopIcon('pure', false);
      log('清流模式已自动关闭（不然资料那行看不清）');
    }, 700);
  }

  // 匹配超时弹窗：站点自己的弹窗会挡住页面，替它点掉（我的 30s 计时器仍照常重试）
  function guardDialog() {
    if (!cfg.on) return;
    const d = DOMX.q('.var-dialog__title');
    if (!d) return;
    const t = d.innerText || '';
    if (t.indexOf('匹配超时') < 0) return;
    const ok = DOMX.q('.var-dialog__confirm-button');
    if (ok) { DOMX.forceClick(ok); log('关掉了站点的"匹配超时"弹窗'); }
  }

  /* ============================================================
   * 7. 悬浮面板（不扫描 DOM、不动站点节点，只 append 自己的壳）
   * ============================================================ */
  let panel, statusEl, logEl, btnToggle, btnMatch, btnStop, statEl;
  const logs = [];

  function log(msg, red) {
    const t = new Date().toTimeString().slice(0, 8);
    const line = t + ' ' + msg;
    logs.push({ t: line, r: !!red });
    if (logs.length > 40) logs.shift();
    if (logEl) {
      logEl.innerHTML = logs.slice().reverse().map(x => x.r
        ? '<span style="color:#ff5c5c">' + esc4(x.t) + '</span>'
        : esc4(x.t)).join('\n');
      logEl.scrollTop = 0;   // 最新一行永远贴顶
    }
    g4.log(line);
  }

  function updateStat() {
    if (statEl) statEl.textContent = '匹配 ' + st.matches + ' / 女生 ' + st.femaleCount;
  }

  // 展开/拖动后把面板收回视口内，避免内容落到屏幕外看不到
  function clampPanelToViewport() {
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

  function setStatus(txt, tone) {
    if (!statusEl) return;
    statusEl.textContent = txt;
    statusEl.style.color = tone === 'ok' ? '#6ee7a8' : tone === 'bad' ? '#ff8a8a' : tone === 'busy' ? '#ffd479' : '#cfd6e4';
  }

  function buildPanel() {
    const host = document.createElement('div');
    host.id = 'ars-qq-panel';
    host.innerHTML = [
      '<div class="ars-head">',
      '  <span class="ars-title">巧巧/迷迷 托管</span>',
      '  <span class="ars-min" title="收起">–</span>',
      '</div>',
      '<div class="ars-body">',
      '  <div class="ars-row"><span class="ars-k">状态</span><span class="ars-v" id="ars-status">启动中</span></div>',
      '  <div class="ars-row"><span class="ars-k">资料</span><span class="ars-v ars-meta" id="ars-qq-meta">—</span></div>',
      '  <div class="ars-row"><span class="ars-k">统计</span><span class="ars-v" id="ars-stat">匹配 0 / 女生 0</span></div>',
      '  <div class="ars-row"><span class="ars-k">换人间隔</span><span class="ars-v">',
      '    <input class="ars-num" id="ars-gapmin" type="number" min="0.5" step="0.5"> – ',
      '    <input class="ars-num" id="ars-gapmax" type="number" min="0.5" step="0.5"> 秒</span></div>',
      '  <div class="ars-btns">',
      '    <button class="ars-b" id="ars-toggle">开始</button>',
      '    <button class="ars-b ghost" id="ars-match">匹配</button>',
      '    <button class="ars-b ghost" id="ars-stop">断开</button>',
      '  </div>',
      '  <div class="ars-log" id="ars-log"></div>',
      '  <label class="ars-opt"><input type="checkbox" id="ars-female"> 只匹配女生（客户端筛，不需要 VIP）</label>',
      '  <label class="ars-opt"><input type="checkbox" id="ars-greet" checked> 自动打招呼</label>',
      '  <label class="ars-opt"><input type="checkbox" id="ars-rematch" checked> 离开后自动再匹配</label>',
      '  <label class="ars-opt"><input type="checkbox" id="ars-skipbot" checked> 跳过机器人</label>',
      '  <label class="ars-opt"><input type="checkbox" id="ars-metaopt" checked> 显示城市/注册日期</label>',
      '</div>',
    ].join('');
    document.documentElement.appendChild(host);

    const css = document.createElement('style');
    css.textContent = [
      '#ars-qq-panel{position:fixed;right:14px;bottom:14px;z-index:2147483000;width:250px;',
      'background:rgba(18,20,26,.94);color:#e8ecf6;border:1px solid rgba(255,255,255,.12);border-radius:12px;',
      'font:12px/1.55 -apple-system,"PingFang SC",sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.4);overflow:hidden}',
      '#ars-qq-panel.ars-collapsed .ars-body{display:none}',
      '#ars-qq-panel .ars-head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;',
      'background:rgba(255,255,255,.05);cursor:default}',
      '#ars-qq-panel .ars-title{font-weight:600;letter-spacing:.3px}',
      '#ars-qq-panel .ars-min{cursor:pointer;padding:0 4px;opacity:.7}',
      '#ars-qq-panel .ars-body{padding:8px 10px 10px}',
      '#ars-qq-panel .ars-row{display:flex;justify-content:space-between;margin-bottom:6px}',
      '#ars-qq-panel .ars-k{opacity:.6}',
      '#ars-qq-panel .ars-meta{color:#ffd479;text-align:right;max-width:168px;word-break:break-all}',
      '#ars-qq-panel .ars-num{width:42px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);',
      'border-radius:6px;color:#e8ecf6;font-size:12px;padding:1px 4px;text-align:center}',
      '#ars-qq-panel .ars-btns{display:flex;gap:6px;margin:2px 0 8px}',
      '#ars-qq-panel .ars-b{flex:1;padding:6px 0;border-radius:8px;border:0;background:#3b6bff;color:#fff;font-size:12px;cursor:pointer}',
      '#ars-qq-panel .ars-b.ghost{background:rgba(255,255,255,.1);color:#dfe5f2}',
      '#ars-qq-panel .ars-opt{display:block;margin:3px 0;opacity:.85}',
      '#ars-qq-panel .ars-log{margin-top:8px;height:132px;overflow:auto;background:rgba(0,0,0,.35);border-radius:8px;',
      'padding:6px;font-size:11px;line-height:1.5;white-space:pre-wrap;color:#aab4c8}',
    ].join('');
    document.documentElement.appendChild(css);

    panel = host;
    statusEl = host.querySelector('#ars-status');
    logEl = host.querySelector('#ars-log');
    btnToggle = host.querySelector('#ars-toggle');
    btnMatch = host.querySelector('#ars-match');
    btnStop = host.querySelector('#ars-stop');

    const cbFemale = host.querySelector('#ars-female');
    const cbGreet = host.querySelector('#ars-greet');
    const cbRematch = host.querySelector('#ars-rematch');
    const cbBot = host.querySelector('#ars-skipbot');
    const cbMeta = host.querySelector('#ars-metaopt');
    cbFemale.checked = !!cfg.onlyFemale;
    cbGreet.checked = !!cfg.greet;
    cbRematch.checked = !!cfg.autoRematch;
    cbBot.checked = !!cfg.skipBot;
    cbMeta.checked = !!cfg.showMeta;

    const gapMinEl = host.querySelector('#ars-gapmin');
    const gapMaxEl = host.querySelector('#ars-gapmax');
    statEl = host.querySelector('#ars-stat');
    const clampGap = (v, def) => { const n = Number(v); return isFinite(n) && n > 0 ? n : def; };
    gapMinEl.value = cfg.gapMin;
    gapMaxEl.value = cfg.gapMax;
    const applyGap = () => {
      cfg.gapMin = clampGap(gapMinEl.value, 3);
      cfg.gapMax = Math.max(cfg.gapMin, clampGap(gapMaxEl.value, cfg.gapMin));
      gapMinEl.value = cfg.gapMin;
      gapMaxEl.value = cfg.gapMax;
      saveCfg();
      log('换人间隔设为 ' + cfg.gapMin + '–' + cfg.gapMax + ' 秒');
    };
    gapMinEl.addEventListener('change', applyGap);
    gapMaxEl.addEventListener('change', applyGap);

    host.querySelector('.ars-min').addEventListener('click', () => {
      host.classList.toggle('ars-collapsed');
      setTimeout(clampPanelToViewport, 0);   // 展开后高度变了，重新收进视口
    });
    cbFemale.addEventListener('change', (e) => { cfg.onlyFemale = e.target.checked; saveCfg(); log('只匹配女生：' + (cfg.onlyFemale ? '开' : '关')); });
    cbGreet.addEventListener('change', (e) => { cfg.greet = e.target.checked; saveCfg(); });
    cbRematch.addEventListener('change', (e) => { cfg.autoRematch = e.target.checked; saveCfg(); });
    cbBot.addEventListener('change', (e) => { cfg.skipBot = e.target.checked; saveCfg(); log('跳过机器人：' + (cfg.skipBot ? '开' : '关')); });
    cbMeta.addEventListener('change', (e) => {
      cfg.showMeta = e.target.checked; saveCfg();
      if (!cfg.showMeta) {
        const t = document.getElementById('ars-qq-citytag');
        if (t && t.parentNode) t.parentNode.removeChild(t);
        const r = document.getElementById('ars-qq-meta');
        if (r) r.textContent = '—';
      } else if (contactInfo().imId) renderMeta(contactInfo());
    });

    /* ---- 面板拖动（mouse/touch 都走 getPoint，避免 TouchEvent 没有 clientX 报错） ---- */
    const head = host.querySelector('.ars-head');
    head.style.cursor = 'move';
    let drag = null;
    const onDown = (e) => {
      if (e.target && e.target.classList && e.target.classList.contains('ars-min')) return;
      const p = DOMX.point(e);
      const r = host.getBoundingClientRect();
      drag = { dx: p.x - r.left, dy: p.y - r.top };
      host.style.left = r.left + 'px';
      host.style.top = r.top + 'px';
      host.style.right = 'auto';
      host.style.bottom = 'auto';
    };
    const onMove = (e) => {
      if (!drag) return;
      const p = DOMX.point(e);
      const lx = Math.max(0, Math.min(window.innerWidth - 60, p.x - drag.dx));
      const ly = Math.max(0, Math.min(window.innerHeight - 40, p.y - drag.dy));
      host.style.left = lx + 'px';
      host.style.top = ly + 'px';
    };
    const onUp = () => { if (!drag) return; drag = null; clampPanelToViewport(); };
    head.addEventListener('mousedown', onDown);
    head.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);

    btnToggle.addEventListener('click', () => {
      cfg.on = !cfg.on; saveCfg();
      btnToggle.textContent = cfg.on ? '暂停' : '开始';
      if (cfg.on) {
        log('托管已开启' + (cfg.onlyFemale ? '（只筛女生，服务端要 VIP，这里走客户端筛）' : ''));
        if (!convActive()) matchNow(); else setStatus('聊天中', 'ok');
      }
      else { log('托管已暂停'); setStatus('已暂停', 'idle'); }
    });
    btnMatch.addEventListener('click', () => { if (convActive()) { log('当前会话还在，先断开'); return; } matchNow(); });
    btnStop.addEventListener('click', () => { disconnectMine(false); setStatus('已结束', 'idle'); scheduleRematch(gapMs()); });
  }

  /* ============================================================
   * 8. 启动
   * ============================================================ */
  function start() {
    if (window.top !== window.self) return;
    if (location.pathname === '/') { /* 首页也允许，面板照常 */ }
    buildPanel();
    btnToggle.textContent = cfg.on ? '暂停' : '开始';
    log('站点：' + (IS_MM ? '迷迷 mimiu.chat' : '巧巧 qiaoqiao.chat'));
    updateStat();
    window.addEventListener('resize', clampPanelToViewport);
    initTopToggles();
    setTimeout(ensureSound, 3000);          // 等页面 Vue 稳定再动站内开关
    setInterval(guardDialog, 2000);         // 站点"匹配超时"弹窗来了替它点掉
    boot().then(() => {
      if (contactInfo().imId) renderMeta(contactInfo());   // 页面刷新时把上一会话资料补回面板
      if (cfg.on) {
        if (convActive()) { setStatus('聊天中', 'ok'); log('检测到进行中的会话'); }
        else matchNow();
      }
    });
  }

  // 调试钩子：真机校准时可在控制台调用 __ars.meta(contactInfo对象) / __ars.gender()
  try { window.__ars = { meta: renderMeta, judge: judgePeer, gender: genderFromDom, cfg: cfg }; } catch (e) {}

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
