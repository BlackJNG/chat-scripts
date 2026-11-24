// ==UserScript==
// @name         NVDA托管助手（狗头军师版）
// @namespace    https://nvda.chat/
// @version      1.7
// @changelog    1.3 增加 @updateURL/@downloadURL，支持油猴自动检查更新
// @changelog    1.4 更新地址切换到 gh-proxy.org
// @changelog    1.5 移除内置智谱 Key（公开仓库泄露），改为本机填写
// @changelog    1.6 接入 APP 桥 GM4W + 女生匹配红色日志 + 匹配统计
// @changelog    1.7 去掉机器人过滤（智能体/风险号/擦边广告）；狗头可拖动；对方消息橙色
// @updateURL    https://gh-proxy.org/https://raw.githubusercontent.com/BlackJNG/chat-scripts/main/scripts/nvda%E6%89%98%E7%AE%A1%E5%8A%A9%E6%89%8B.user.js
// @downloadURL  https://gh-proxy.org/https://raw.githubusercontent.com/BlackJNG/chat-scripts/main/scripts/nvda%E6%89%98%E7%AE%A1%E5%8A%A9%E6%89%8B.user.js
// @description  nvda.chat 匿名聊天：以男生身份纯 socket 后台随机匹配，配到女号自动打招呼（自定义/可两句）；男号/机器人自动跳过并立刻换人；聊天中继续后台匹配；侧栏标注男女；自动回复走模型人设
// @match        https://nvda.chat/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      open.bigmodel.cn
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


  const DEFAULT_KEY = '';  // 安全：不再内置任何 Key，只从本机 localStorage 读取
  const LLM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
  const LLM_MODEL = 'glm-4-plus';

  const S = {
    autoMatch: true,
    autoReply: true,
    femaleOnly: true,      // 只接 gender===1
    keepMatching: true,    // 聊天中也继续后台匹配
    maxChats: 3,           // 同时保留几个会话
    myGender: '0',         // 我自己的性别：0=男
    myAge: 20,
    minAge: 0,             // 0=不管（这站年龄基本是滑出来的假数据）
    matchWait: 20,
    matchGap: 2,           // 跳过到下一次匹配的间隔
    replyDelay: 4,
    giveUp: 150,
    greet: '哈喽',          // 打招呼：最多两句，用 | 隔开
    greetGap: 2,           // 第二句隔几秒发
  };
  const LS = { cfg: 'nv_cfg', key: 'nv_key', stats: 'nv_stats', peer: 'nv_peer', mem: 'nv_mem' };
  const loadLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const saveLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  Object.assign(S, loadLS(LS.cfg, {}));
  const KEY = () => String(localStorage.getItem(LS.key) || DEFAULT_KEY || '').trim();

  const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------- 词表 ----------
  const LEAVE = /(不想聊|别联系|不要联系|别烦我|不欢迎|滚|再见)/;
  const MINOR = /(未成年|17岁|16岁|15岁|初中|初三|高一|高二|还没成年|没满18)/;
  const BANOUT = ['微信', 'QQ', 'qq', 'vx', '支付宝', '转账', '红包', '手机号', '加我', '抖音', '地址'];

  const ST = { token: '', bootstrapped: false };
  const CHATS = {};                 // matchId -> chat
  const chatList = () => Object.keys(CHATS).map(k => CHATS[k]);
  const myId = () => (ST.token || localStorage.getItem('userToken') || '');
  const nextRun = { match: 0, poll: 0, side: 0, sideA: 0 };

  // ---------- socket hook ----------
  const SOCKS = [];
  (function hookWS() {
    try {
      const Native = W.WebSocket;
      if (!Native || Native.__nvHooked) return;
      function Patched(url, protocols) {
        const ws = protocols ? new Native(url, protocols) : new Native(url);
        try {
          if (/socket\.io|engine\.io/i.test(String(url))) {
            ws.addEventListener('message', (e) => {
              const d = String(e.data || '');
              if (!d) return;
              if (d === '40' || d.indexOf('40{') === 0 || d.indexOf('42') === 0) ws.__nvReady = true;
              if (!ws.__nvReady) return;
              try { onFrame(d); } catch (_) {}
            });
            SOCKS.push(ws);
            W.__nvSocks = SOCKS;
          }
        } catch (_) {}
        return ws;
      }
      Patched.prototype = Native.prototype;
      ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k, i) => { Patched[k] = i; });
      Patched.__nvHooked = true;
      W.WebSocket = Patched;
    } catch (e) {}
  })();

  function liveSock() {
    for (let i = SOCKS.length - 1; i >= 0; i--) {
      const w = SOCKS[i];
      if (w && w.readyState === 1 && w.__nvReady) return w;
    }
    return null;
  }

  function sendRaw(ev, payload, ackId) {
    const ws = liveSock();
    if (!ws) return false;
    const id = ackId == null ? '' : String(ackId);
    const arr = payload === undefined ? [ev] : [ev, payload];
    try { ws.send('42' + id + JSON.stringify(arr)); return true; } catch (_) { return false; }
  }

  const ACKS = {};
  function onFrame(d) {
    if (d.indexOf('42') === 0) {
      let body = d.slice(2);
      const m = /^\d+/.exec(body);
      if (m) body = body.slice(m[0].length);
      if (body[0] !== '[') return;
      const arr = JSON.parse(body);
      onPush(arr[0], arr[1]);
      return;
    }
    if (d.indexOf('43') === 0) {
      const body = d.slice(2);
      const m = /^\d+/.exec(body);
      if (!m) return;
      const fn = ACKS[m[0]];
      if (fn) { delete ACKS[m[0]]; try { fn(JSON.parse(body.slice(m[0].length))); } catch (_) {} }
    }
  }

  // ---------- 日志 / 统计 ----------
  const logEl = () => document.getElementById('nv-log');
  const logLines = [];
  function log(msg, tone) {
    console.log('[NVDA助手]', msg);
    const line = `[${new Date().toTimeString().slice(0, 8)}] ${msg}`;
    logLines.unshift({ t: line, c: tone === true ? '#ff5c5c' : (tone || '') });
    if (logLines.length > 40) logLines.length = 40;
    const el = logEl();
    if (el) {
      el.innerHTML = logLines.map(x => x.c
        ? '<span style="color:' + x.c + '">' + esc4(x.t) + '</span>'
        : esc4(x.t)).join('\n');
    }
    g4.log(line);
  }
  function bump(key, n) {
    const st = loadLS(LS.stats, {});
    const today = new Date().toDateString();
    if (st.date !== today) { st.date = today; st.matched = 0; st.skipMale = 0; st.skipBot = 0; st.replies = 0; st.chats = 0; st.female = 0; }
    st[key] = (st[key] || 0) + (n == null ? 1 : n);
    saveLS(LS.stats, st);
    render();
  }

  // ---------- 人设 ----------
  function nowLine() {
    const d = new Date();
    const h = d.getHours();
    const part = h < 5 ? '凌晨' : h < 9 ? '早上' : h < 12 ? '上午' : h < 14 ? '中午' : h < 18 ? '下午' : h < 23 ? '晚上' : '深夜';
    return `${part} ${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  const SYS = `你是一个在陌生人社交软件上聊天的真实男生，不是客服、不是陪聊、不是AI助手。

【你是谁】
20岁，在北京生活，写代码的。说话松弛、句子短、有点懒散的好笑，不端着也不装深沉。
具体生活（可自然带出，不要一次说完）：会做饭，拿手是番茄牛腩；周末骑车或者爬山；爱看老电影；手机里存着随手拍的街景和猫。
小缺点：偶尔熬夜、方向感差、不太会安慰人但会认真听人说话。
说话习惯：句子短，少用书面词；不说"亲爱的""宝"；用"嗯，这个我懂"而不是"我理解你的感受"。

【关系阶段】脚本每次会告诉你现在处于哪一段，只做这一段该做的事：
1 陌生：让她觉得你有趣且安全。给一个具体信息 + 抛一个轻问题；不查户口（不问年龄、职业、住哪、全名）。
2 熟一点：她开始主动回、主动说自己的事。交换生活细节，"自曝换自曝"：你先给一个具体小事，再轻轻问她同类的一件。
3 有点暧昧：她会接你的玩笑、主动找你。制造只属于你们俩的默契：给她一个小称呼、把之前聊过的梗拎回来、故意留一句"这个回头说"。
4 想见：她问你在干嘛、说无聊、提到见面相关。给画面感的具体邀约（时间+地点+感觉），允许她说不，不追问理由。

【怎么像人】
- 一条只做一件事：接住她的话，或调侃，或抛一个具体问题，或推进一点。一句话里不塞三个问题。
- 具体胜过抽象：不问"你平时喜欢做什么"，问"你周末是出门那种，还是窝着点外卖那种"。
- 幽默三招：夸张（把她的话放大到荒谬）、错位（正经话用玩笑接）、自嘲（先拿自己垫一下）。
- 推拉要轻、要给糖：夸完接一句调侃，调侃完补一句真诚。例："你这回复速度像在开会偷打字。——不过你刚才那句挺有意思。"
- 留白：不把话说满，不解释自己，不用"哈哈"填缝，不连发两条。
- 她敷衍（嗯/哦/哈哈/表情）时不追问，只加温一小步：给一个自己的小信息或一个轻松画面，然后把话头递回去。连冷两次就收线。
- 她说不聊、要你别联系：一句体面收尾，不再发。

【绝对不做】
不索要微信/QQ/电话/住址，不谈钱不推销，不性暗示不开黄腔，不评价身材外貌，不贬低不PUA不装可怜逼她回，不查户口，不重复上一条说过的话，不提"脚本/AI/托管"。
遇到对方发带性意味的话：不接、不回应、不调侃，直接中性地把话题带走；对方继续就结束对话。
对方提到自己是未成年/学生：立刻收线，不再推进。

【反例，写过这些就算没写好】
"你平时喜欢做什么？"、"那你呢？"、"今天天气不错"、"哈哈，真有意思"、"你也喜欢旅游吗"、"突然想起这事儿"（没有前文的指代）——空转、没有信息、谁都能发。换成带具体细节的说法：地点、时间、动作、一个小画面。
【判断标准】这句话里至少有一个具体的东西（一件事、一个地点、一个时间、一个物件），否则重写。

【输出】只输出要发的那一句话：中文口语，50字以内，无引号、无前缀、无表情符号。先在脑子里比较三种接法，只发你选中的那一条。
【时间】现在是${nowLine()}；提到早上/中午/下午/晚上必须和实际时段一致，拿不准就不提时段。
`;

  let warnedNoKey = false;
  function llmPost(body) {
    return new Promise((resolve, reject) => {
      if (!KEY()) {
        if (!warnedNoKey) { warnedNoKey = true; try { log('⚠ 未填智谱 Key：面板里填一次即可（只存本机）'); } catch (e) {} }
        reject(new Error('no-key')); return;
      }
      const payload = JSON.stringify(body);
      const headers = { 'Authorization': 'Bearer ' + KEY(), 'Content-Type': 'application/json' };
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'POST', url: LLM_URL, headers, data: payload, timeout: 30000,
          onload: r => resolve({ ok: r.status >= 200 && r.status < 300, text: r.responseText }),
          onerror: () => reject(new Error('network')),
          ontimeout: () => reject(new Error('timeout')),
        });
      } else {
        fetch(LLM_URL, { method: 'POST', headers, body: payload })
          .then(r => r.text().then(t => resolve({ ok: r.ok, text: t })))
          .catch(reject);
      }
    });
  }

  async function gen(prompt, maxTokens) {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await llmPost({
          model: LLM_MODEL, temperature: 0.85, max_tokens: maxTokens || 150,
          messages: [{ role: 'system', content: SYS }, { role: 'user', content: prompt }],
        });
        if (!r.ok) { await sleep(1500); continue; }
        const j = JSON.parse(r.text);
        const t = ((j.choices && j.choices[0] && j.choices[0].message.content) || '').trim();
        if (t) return clean(t);
      } catch (e) { await sleep(1500); }
    }
    return '';
  }

  function clean(t) {
    t = t.replace(/^["“'「]|["”'」]$/g, '').replace(/\n+/g, ' ').trim();
    t = t.replace(/^(承接|降压|调侃|轻推|约见|澄清|收线|回复)[：:]\s*/, '').trim();
    if (t.length > 48) t = t.slice(0, 48);
    if (BANOUT.some(w => t.indexOf(w) >= 0)) return '';
    return t;
  }

  function memAll() { return loadLS(LS.mem, {}); }
  function memAppend(name, text) {
    if (!name || !text) return;
    const m = memAll();
    const list = (m[name] || {}).said || [];
    list.push(text.slice(0, 30));
    m[name] = { said: list.slice(-8) };
    saveLS(LS.mem, m);
  }

  function stageOf(list) {
    const total = list.length;
    const last = (list[list.length - 1] || {}).t || '';
    if (/见面|出来|约|有空|在哪|一起|见你/.test(last)) return '想见';
    if (total <= 3) return '陌生';
    if (total <= 9) return '熟一点';
    return '有点暧昧';
  }

  function ruleReply(list) {
    const L = ((list[list.length - 1] || {}).t || '').trim();
    if (LEAVE.test(L)) return '行，那不打扰了。';
    if (/我男的|我是男的|性别男/.test(L)) return '行，那就不打扰了。';
    return '';
  }

  async function replyFor(name, list) {
    if (!list.length) return '';
    const r = ruleReply(list);
    if (r) return r;
    const stage = stageOf(list);
    const said = ((memAll()[name] || {}).said || []).slice(-5);
    const lines = list.slice(-8).map(m => (m.s ? '我：' : name + '：') + m.t).join('\n');
    const last = list[list.length - 1].t;
    const hints = [];
    if (/\?|？|吗/.test(last)) hints.push('她在问我：先把她问的答完，最多再轻轻带一句。');
    const prevSelf = [...list].reverse().find(m => m.s);
    if (prevSelf && /[？?]$/.test(prevSelf.t)) hints.push('上一条我已经问过问题了，这次不要再用问句。');
    const out = await gen(`对象：${name}\n当前阶段：${stage}\n我之前对她说过：${said.length ? said.join('；') : '（还没有）'}\n最近聊天：\n${lines}\n${hints.join('\n')}\n写出我下一条，不要重复我说过的话。`, 150);
    const bad = /你呢|你平时喜欢|今天天气|想起这事/;
    if (!out) return '';
    if (bad.test(out)) {
      const again = await gen(`对象：${name}\n当前阶段：${stage}\n最近聊天：\n${lines}\n换一句：不许出现"你呢/你平时喜欢/今天天气"，必须带一个具体细节（地点、时间、动作或物件）。`, 120);
      if (again && !bad.test(again)) return again;
      return '';
    }
    return out;
  }

  // ---------- 会话 ----------
  // ---------- 侧栏男女标注 ----------
const SIDE = { list: [], at: 0 };
async function pullSideList() {
  try {
    const r = await fetch(`/nd/match/list?token=${encodeURIComponent(myId())}`, { credentials: 'include' });
    const j = await r.json();
    const d = (j && j.data) || [];
    if (Array.isArray(d) && d.length) SIDE.list = d;
  } catch (_) {}
}

function annotateSidebar() {
  if (!SIDE.list.length) return;
  if (!document.querySelector('.match-item-name')) return;
  const spans = document.querySelectorAll('.match-item-name .partner-name-row > span');
  for (const sp of spans) {
    if (sp.querySelector('.chat-partner-info-icon')) continue;
    const t = (sp.innerText || '').trim();
    if (!t) continue;
    const hit = SIDE.list.find(x => String(x.nickname || '').trim() === t);
    if (!hit) continue;
    const girl = Number(hit.gender) === 1;
    const icon = `<i class="van-badge__wrapper nvda-icon ${girl ? 'nvda-icon-girl' : 'nvda-icon-boy'} chat-partner-info-icon" style="font-size:17px;vertical-align:middle;"></i><span class="nv-side-g" style="vertical-align:middle;margin-left:2px;">${girl ? '女' : '男'}</span>`;
    try { sp.insertAdjacentHTML('beforeend', '&nbsp;' + icon); } catch (_) {}
  }
}

async function detail(matchId) {
    try {
      const r = await fetch(`/nd/match/${matchId}?token=${encodeURIComponent(myId())}`, {
        headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      });
      const j = await r.json();
      return (j && j.data) || null;
    } catch (_) { return null; }
  }

  // 9110 = 站点静默拦截（自家前端也是只吞不提示），按频率/敏感词处理
  const CODE_MSG = { 9110: '被站点拦截（疑似太频繁或触了敏感）' };

  function sendMsg(matchId, text, opt) {
    opt = opt || {};
    const id = 8000 + Math.floor(Math.random() * 900);
    const ok = sendRaw('sendMessage', {
      matchId, content: text, messageType: 'text',
      quotation: null, quotationContent: null, mediaId: null, extraInfo: null,
    }, id);
    if (!ok) return false;
    const c = CHATS[matchId];
    const entry = { s: 1, t: text, pend: true };
    if (c) c.hist.push(entry);
    ACKS[id] = (res) => {
      const r = Array.isArray(res) ? res[0] : res;
      if (r && r.code === 0) { entry.pend = false; return; }
      const code = r && r.code;
      log('发送被拒 ' + (code == null ? '?' : code) + '：' + (CODE_MSG[code] || (r && r.msg) || '未知'));
      if (c) { const i = c.hist.indexOf(entry); if (i >= 0) c.hist.splice(i, 1); }
      const tries = opt.retry || 0;
      if (!opt.noRetry && tries < 1) {
        const wait = 9000 + Math.random() * 7000;
        log('9~16 秒后重发一次：' + text.slice(0, 12));
        setTimeout(() => {
          if (!CHATS[matchId]) return;
          sendMsg(matchId, text, { retry: tries + 1 });
        }, wait);
      } else if (tries >= 1) {
        log('重发仍被拒，这条放弃：' + text.slice(0, 12));
      }
    };
    return true;
  }

  function closeChat(matchId, reason) {
    if (!CHATS[matchId]) return;
    delete CHATS[matchId];
    sendRaw('leaveMatch', { matchId }, 8200 + Math.floor(Math.random() * 900));
    log('离开 ' + (reason || '') + '：' + String(matchId || '').slice(-6) + '（剩 ' + chatList().length + ' 个会话）');
    nextRun.match = Date.now() + Math.max(1, S.matchGap) * 1000;
    render();
  }

  function peerSeen() { return loadLS(LS.peer, {}); }
  function peerMark(key) {
    const p = peerSeen();
    p[key] = (p[key] || 0) + 1;
    const keys = Object.keys(p);
    if (keys.length > 300) keys.slice(0, 150).forEach(k => delete p[k]);
    saveLS(LS.peer, p);
    return p[key];
  }

  // 打招呼：静态文本，不走模型；支持两个句子，用 | 或 ｜ 隔开
function greetParts() {
  const raw = String(S.greet == null ? '哈喽' : S.greet);
  const ps = raw.split(/\s*[|｜]\s*|\r?\n+/).map(x => x.trim()).filter(Boolean).slice(0, 2);
  return ps.length ? ps : ['哈喽'];
}
function greet(c) {
  const parts = greetParts();
  c.greeted = true;
  if (!sendMsg(c.matchId, parts[0])) { log('打招呼发送失败 ' + c.nickname); return; }
  log('打招呼 ' + c.nickname + '：' + parts[0] + '（共 ' + chatList().length + ' 个会话）');
  if (parts.length < 2) return;
  const gap = Math.max(1, Number(S.greetGap) || 2) * 1000 + Math.random() * 800;
  setTimeout(() => {
    const live = CHATS[c.matchId];
    if (!live) return;
    const last = live.hist[live.hist.length - 1];
    if (!last || last.s !== 1) return;       // 她先说话了就不再补第二句，免得抢话
    if (sendMsg(c.matchId, parts[1])) log('补第二句 ' + live.nickname + '：' + parts[1]);
    else log('第二句没发出去 ' + live.nickname);
  }, gap);
}

async function onMatched(d) {
    if (!d || !d.matchId) return;
    if (CHATS[d.matchId]) return;
    bump('matched');
    try { SIDE.list.unshift({ matchId: d.matchId, nickname: d.nickname, age: d.age, gender: d.gender }); } catch (_) {}
    const peer = {
      matchId: d.matchId, nickname: d.nickname || '对方', age: Number(d.age || 0),
      gender: Number(d.gender), city: d.lastCity || '', at: Date.now(),
      greeted: false, hist: [], lastRepliedId: '', nextAt: 0, lastSeen: '',
    };
    log('配到 ' + peer.nickname + '（' + (peer.gender === 1 ? '女' : '男') + '/' + (peer.age || '?') + '）', peer.gender === 1 ? '#ff5c5c' : '');

    const skip = (reason, stat) => {
      bump(stat || 'skipBot');
      log('跳过 ' + peer.nickname + '（' + reason + '）→ 立刻换人');
      sendRaw('leaveMatch', { matchId: peer.matchId }, 8200 + Math.floor(Math.random() * 900));
      nextRun.match = Date.now() + Math.max(1, S.matchGap) * 1000;
      render();
    };

    if (S.femaleOnly && peer.gender !== 1) return skip('男号', 'skipMale');
    if (S.minAge && peer.age && peer.age < S.minAge) return skip('年龄 ' + peer.age);

    CHATS[peer.matchId] = peer;
    bump('chats');
    if (peer.gender === 1) { bump('female'); g4.evt('match', peer.matchId); }   // 只推配到女生（id=matchId，稳定）
    greet(peer);
    if (S.keepMatching && chatList().length < Math.max(1, S.maxChats)) {
      nextRun.match = Date.now() + Math.max(1, S.matchGap) * 1000;
    }
    render();
  }

  function onRecv(d) {
    if (!d || !d.matchId) return;
    const text = String(d.content || '');
    if (!text) return;
    const c = CHATS[d.matchId];
    if (!c) { sendRaw('leaveMatch', { matchId: d.matchId }, 8400 + Math.floor(Math.random() * 90)); return; }
    const last = c.hist[c.hist.length - 1];
    if (last && last.s === 0 && last.t === text) return;
    c.hist.push({ s: 0, t: text, id: d.messageId });
    if (d.messageId) c.lastSeen = d.messageId;
    g4.evt('msg', d.messageId || ('m|' + d.matchId + '|' + text.slice(0, 20)));
    log('收 ' + c.nickname + '：' + (text.length > 14 ? text.slice(0, 14) + '…' : text), '#ffa64d');

    if (MINOR.test(text)) {
      log(c.nickname + ' 提到未成年/学生 → 收线');
      closeChat(d.matchId, '未成年');
      return;
    }
    if (S.autoReply) {
      c.nextAt = Date.now() + Math.max(2, S.replyDelay + Math.random() * 3) * 1000;
      render();
    }
  }

  async function maybeReply(c) {
    if (!c || !S.autoReply) return;
    const h = c.hist;
    if (!h.length) return;
    const last = h[h.length - 1];
    if (last.s === 1) return;
    const key = last.id || ('t:' + last.t);
    if (c.lastRepliedId === key) return;
    c.lastRepliedId = key;
    const text = await replyFor(c.nickname, h);
    if (!text) { log('这次没生成出可发的话，先不发'); return; }
    if (!CHATS[c.matchId]) return;
    if (sendMsg(c.matchId, text)) {
      memAppend(c.nickname, text);
      bump('replies');
      log('回复 ' + c.nickname + '：' + text);
    }
    render();
  }

  // 兜底：从 REST 同步（推送只覆盖当前会话时靠这个不漏消息）
  async function syncChats() {
    if (!chatList().length) return;
    let list = [];
    try {
      const r = await fetch(`/nd/match/list?token=${encodeURIComponent(myId())}`, { credentials: 'include' });
      const j = await r.json();
      list = (j && j.data) || [];
    } catch (_) { return; }
    for (const c of chatList()) {
      const item = list.find(x => x.matchId === c.matchId);
      if (!item) { closeChat(c.matchId, '会话已不存在'); continue; }
      if (item.close === true) { closeChat(c.matchId, '会话已关闭'); continue; }
      if (item.unreadCount > 0 || (item.messageId && item.messageId !== c.lastSeen)) {
        const det = await detail(c.matchId);
        if (!det || !Array.isArray(det.messages)) continue;
        const mapped = det.messages.map(m => ({ s: m.self === 1 ? 1 : 0, t: String(m.content || ''), id: m.messageId }));
        c.hist = mapped;
        const nl = mapped[mapped.length - 1];
        if (item.messageId) c.lastSeen = item.messageId;
        if (nl && nl.s === 0 && S.autoReply) c.nextAt = Date.now() + Math.max(2, S.replyDelay) * 1000;
      }
    }
  }

  // ---------- 匹配 ----------
  function leafByText(re) {
    const all = document.querySelectorAll('div,span,button,a');
    for (const el of all) {
      if (el.children.length) continue;
      const t = (el.innerText || '').trim();
      if (t && re.test(t)) return el;
    }
    return null;
  }
  function clickEl(el) {
    if (!el) return false;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']
      .forEach(t => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
    return true;
  }

  function bootstrapOnce() {
    if (ST.bootstrapped) return false;
    if (liveSock()) return true;
    const btn = leafByText(/^开始匹配$/);
    if (!btn) return false;
    ST.bootstrapped = true;
    log('页面 socket 还没建立，先点一次「开始匹配」把连接拉起来');
    clickEl(btn);
    return false;
  }

  async function matchLoop() {
    if (!S.autoMatch) return;
    const now = Date.now();
    if (now < nextRun.match) return;
    if (!S.keepMatching && chatList().length) return;
    if (chatList().length >= Math.max(1, S.maxChats)) return;
    if (!liveSock()) { bootstrapOnce(); nextRun.match = now + 4000; return; }

    const nid = localStorage.getItem('nicknameId') || 0;
    const id = 8300 + Math.floor(Math.random() * 500);
    ACKS[id] = (res) => {
      const r = Array.isArray(res) ? res[0] : res;
      if (r && r.code !== 0) log('匹配被拒：' + (r.msg || r.code));
    };
    const ok = sendRaw('match', {
      nicknameId: String(nid),
      age: Number(S.myAge) || 20,
      gender: String(S.myGender),   // 我自己的性别（0=男）
      agentMatch: false,            // 不接官方智能体
    }, id);
    if (!ok) { nextRun.match = now + 5000; return; }
    log('发起匹配（我=男，等 ' + S.matchWait + ' 秒）');
    nextRun.match = now + Math.max(5, S.matchWait) * 1000;
    render();
  }

  // ---------- 面板 ----------
  function css() {
    if (document.getElementById('nv-style')) return;
    const s = document.createElement('style');
    s.id = 'nv-style';
    s.textContent = `
#nv-fab{position:fixed;right:14px;bottom:96px;z-index:99998;width:46px;height:46px;border-radius:50%;
  background:#1f6f8b;color:#fff;border:none;font-size:22px;box-shadow:0 4px 14px rgba(0,0,0,.35)}
#nv-panel{display:none;position:fixed;right:10px;left:10px;bottom:80px;z-index:99999;max-height:72vh;overflow:auto;
  background:#0e1720;color:#e6f0f5;border:1px solid #24323c;border-radius:16px;padding:12px 14px;
  font:13px/1.5 -apple-system,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.45)}
#nv-panel.show{display:block}
#nv-panel h3{position:sticky;top:-12px;z-index:9;background:#0e1720;margin:0 0 8px;padding:8px 0;
  font-size:14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1a2630}
#nv-panel h3 .x{background:none;border:none;color:#8296a2;font-size:20px;line-height:1;padding:4px 8px}
.nv-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #1a2630}
.nv-row b{display:block;font-size:13px}
.nv-row span{display:block;font-size:11px;color:#8296a2}
.nv-tg input{display:none}
.nv-tg i{display:block;width:44px;height:24px;border-radius:12px;background:#26323b;position:relative;transition:.2s}
.nv-tg i:after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#8295a1;transition:.2s}
.nv-tg input:checked+i{background:#1f8fb5}
.nv-tg input:checked+i:after{left:23px;background:#fff}
.nv-key{display:flex;gap:6px;margin:8px 0 2px}
.nv-key input{flex:1;background:#132029;border:1px solid #24323c;color:#cfdde5;border-radius:8px;padding:7px 9px;font-size:12px}
.nv-key button{background:#1f8fb5;color:#fff;border:none;border-radius:8px;padding:0 12px}
.nv-stat{color:#75909e;font-size:11px;margin-top:6px}
.nv-health{color:#8296a2;font-size:11px;margin-top:4px;line-height:1.6}
.nv-btns{display:flex;gap:6px;margin:8px 0 2px}
.nv-setrow button{width:100%;background:#17232c;color:#93a7b2;border:1px solid #24323c;border-radius:9px;padding:8px 0;font-size:12px}
.nv-btns button{flex:1;background:#1b2b36;color:#cfdde5;border:1px solid #2c3f4c;border-radius:8px;padding:7px 0;font-size:12px}
#nv-log{margin-top:8px;max-height:150px;overflow:auto;font:11px/1.55 ui-monospace,monospace;color:#8296a2;
  white-space:pre-wrap;border-top:1px solid #1a2630;padding-top:6px}
#nv-fab{display:flex;align-items:center;justify-content:center;padding:0;line-height:0}
.match-item-name .nvda-icon-boy.chat-partner-info-icon{color:#1677ff!important}
.match-item-name .nvda-icon-girl.chat-partner-info-icon{color:#ff4d6d!important}
.nv-side-g{vertical-align:middle;margin-left:2px}
`;
    document.head.appendChild(s);
  }

  // ---------- 狗头悬浮球：可拖动（位置记忆） ----------
  function initFabDrag(fab, posKey) {
    fab.style.touchAction = 'none';
    const place = (l, t) => {
      const w = fab.offsetWidth || 46, h = fab.offsetHeight || 46;
      l = Math.min(Math.max(2, l), Math.max(2, window.innerWidth - w - 2));
      t = Math.min(Math.max(2, t), Math.max(2, window.innerHeight - h - 2));
      fab.style.left = l + 'px'; fab.style.top = t + 'px';
      fab.style.right = 'auto'; fab.style.bottom = 'auto';
      return { l: Math.round(l), t: Math.round(t) };
    };
    try {
      const saved = JSON.parse(localStorage.getItem(posKey) || 'null');
      if (saved && typeof saved.l === 'number' && typeof saved.t === 'number') place(saved.l, saved.t);
    } catch (e) {}
    let drag = null, last = null;
    fab.addEventListener('pointerdown', e => {
      const r = fab.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, l: r.left, t: r.top, moved: false };
      last = { l: r.left, t: r.top };
      try { fab.setPointerCapture(e.pointerId); } catch (_) {}
    });
    fab.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && (Math.abs(dx) + Math.abs(dy) > 6)) drag.moved = true;
      if (!drag.moved) return;
      last = place(drag.l + dx, drag.t + dy);
      e.preventDefault();
    });
    const end = () => {
      if (!drag) return;
      if (drag.moved) {
        fab.dataset.dragged = '1';   // 拖完不触发 onclick
        try { localStorage.setItem(posKey, JSON.stringify(last || { l: 0, t: 0 })); } catch (_) {}
      }
      drag = null;
    };
    fab.addEventListener('pointerup', end);
    fab.addEventListener('pointercancel', end);
  }

  function buildPanel() {
    css();
    const fab = document.createElement('button');
    fab.id = 'nv-fab';
    fab.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <ellipse cx="12" cy="13" rx="6.5" ry="6.1" fill="#ffe0b0" stroke="#c9924f" stroke-width=".9"/>
      <ellipse cx="5.1" cy="12.4" rx="1.9" ry="3.6" fill="#cf9a5c" transform="rotate(-14 5.1 12.4)"/>
      <ellipse cx="18.9" cy="12.4" rx="1.9" ry="3.6" fill="#cf9a5c" transform="rotate(14 18.9 12.4)"/>
      <circle cx="9.7" cy="11.6" r="1.05" fill="#3a2b20"/>
      <circle cx="14.3" cy="11.6" r="1.05" fill="#3a2b20"/>
      <ellipse cx="12" cy="14.3" rx="1.5" ry="1.05" fill="#3a2b20"/>
      <path d="M12 15.4c0 1.3-.9 2.1-2 2.2M12 15.4c0 1.3.9 2.1 2 2.2" stroke="#3a2b20" stroke-width=".7" stroke-linecap="round" fill="none"/>
    </svg>`;
    const panel = document.createElement('div');
    panel.id = 'nv-panel';
    panel.innerHTML = `
      <h3>NVDA托管 · 狗头军师<button class="x" id="nv-x">×</button></h3>
      <div class="nv-row"><div><b>自动随机匹配</b><span>纯 socket，后台配，不碰对话框</span></div>
        <label class="nv-tg"><input type="checkbox" id="nv-m"><i></i></label></div>
      <div class="nv-row"><div><b>聊天中继续匹配</b><span>边聊边配，可同时挂几个会话</span></div>
        <label class="nv-tg"><input type="checkbox" id="nv-k2"><i></i></label></div>
      <div class="nv-row"><div><b>自动回复</b><span>她说话就由模型接一句</span></div>
        <label class="nv-tg"><input type="checkbox" id="nv-r"><i></i></label></div>
      <div class="nv-row"><div><b>只接女生</b><span>男号直接走，不聊</span></div>
        <label class="nv-tg"><input type="checkbox" id="nv-f"><i></i></label></div>
      <div class="nv-setrow"><button id="nv-setbtn">设置（间隔 · 并行数 · 年龄 · 模型 · Key）</button></div>
      <div id="nv-set" style="display:none">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:6px 0 2px">
          <label style="font-size:11px;color:#75909e">回复间隔(秒)<input id="nv-rd" type="number" min="2" style="width:100%;margin-top:3px;background:#0d151b;border:1px solid #26333d;color:#dfeaf0;border-radius:8px;padding:6px 8px;font-size:12px"></label>
          <label style="font-size:11px;color:#75909e">匹配等待(秒)<input id="nv-mw" type="number" min="5" style="width:100%;margin-top:3px;background:#0d151b;border:1px solid #26333d;color:#dfeaf0;border-radius:8px;padding:6px 8px;font-size:12px"></label>
          <label style="font-size:11px;color:#75909e">换人冷却(秒)<input id="nv-mg" type="number" min="1" style="width:100%;margin-top:3px;background:#0d151b;border:1px solid #26333d;color:#dfeaf0;border-radius:8px;padding:6px 8px;font-size:12px"></label>
          <label style="font-size:11px;color:#75909e">同时会话上限<input id="nv-mx" type="number" min="1" style="width:100%;margin-top:3px;background:#0d151b;border:1px solid #26333d;color:#dfeaf0;border-radius:8px;padding:6px 8px;font-size:12px"></label>
          <label style="font-size:11px;color:#75909e">我的年龄<input id="nv-ya" type="number" min="18" style="width:100%;margin-top:3px;background:#0d151b;border:1px solid #26333d;color:#dfeaf0;border-radius:8px;padding:6px 8px;font-size:12px"></label>
          <label style="font-size:11px;color:#75909e">最小年龄(0=不管)<input id="nv-ma" type="number" min="0" style="width:100%;margin-top:3px;background:#0d151b;border:1px solid #26333d;color:#dfeaf0;border-radius:8px;padding:6px 8px;font-size:12px"></label>
        </div>
        <div style="display:flex;gap:6px;align-items:flex-end;margin:4px 0 2px">
          <label style="flex:1;font-size:11px;color:#75909e">打招呼（最多两句，用 | 隔开）
            <input id="nv-gr" placeholder="哈喽|在干嘛呢" style="width:100%;margin-top:3px;background:#0d151b;border:1px solid #26333d;color:#dfeaf0;border-radius:8px;padding:6px 8px;font-size:12px">
          </label>
          <label style="font-size:11px;color:#75909e;width:76px">第二句隔(秒)
            <input id="nv-gg" type="number" min="1" style="width:100%;margin-top:3px;background:#0d151b;border:1px solid #26333d;color:#dfeaf0;border-radius:8px;padding:6px 8px;font-size:12px">
          </label>
        </div>
        <div class="nv-key"><input id="nv-k" type="password" placeholder="智谱 API Key（必填，只存本机）"><button id="nv-ks">存</button></div>
        <div class="nv-btns"><button id="nv-test">测试模型</button><button id="nv-run">立刻配一个</button></div>
      </div>
      <div class="nv-stat" id="nv-stat"></div>
      <div class="nv-health" id="nv-health"></div>
      <div class="nv-health" id="nv-next"></div>
      <div id="nv-log"></div>
    `;
    document.body.appendChild(fab);
    document.body.appendChild(panel);
    initFabDrag(fab, 'nv_fab_pos');
    fab.onclick = () => {
      if (fab.dataset.dragged) { delete fab.dataset.dragged; return; }
      panel.classList.toggle('show');
    };
    panel.querySelector('#nv-x').onclick = () => panel.classList.remove('show');
    panel.querySelector('#nv-setbtn').onclick = () => {
      const d = panel.querySelector('#nv-set');
      d.style.display = d.style.display === 'none' ? 'block' : 'none';
    };
    const bind = (sel, key) => {
      const el = panel.querySelector(sel);
      el.checked = !!S[key];
      el.onchange = () => {
        S[key] = el.checked; saveLS(LS.cfg, S);
        if (key === 'autoMatch' && el.checked) nextRun.match = Date.now() + 500;
        render();
      };
    };
    bind('#nv-m', 'autoMatch'); bind('#nv-k2', 'keepMatching'); bind('#nv-r', 'autoReply');
    bind('#nv-f', 'femaleOnly');
    [['#nv-rd', 'replyDelay', 2], ['#nv-mw', 'matchWait', 5], ['#nv-mg', 'matchGap', 1],
     ['#nv-mx', 'maxChats', 1], ['#nv-ya', 'myAge', 18], ['#nv-ma', 'minAge', 0], ['#nv-gg', 'greetGap', 1]]
      .forEach(([sel, key, min]) => {
        const el = panel.querySelector(sel);
        el.value = S[key];
        el.onchange = () => {
          const v = Math.max(min, parseInt(el.value, 10) || S[key]);
          S[key] = v; el.value = v; saveLS(LS.cfg, S); log(key + ' 设为 ' + v); render();
        };
      });
    const gIn = panel.querySelector('#nv-gr');
    gIn.value = S.greet || '哈喽';
    gIn.onchange = () => {
      const v = gIn.value.trim().slice(0, 60) || '哈喽';
      S.greet = v; gIn.value = v; saveLS(LS.cfg, S);
      log('打招呼改为：' + v.replace(/[|｜]/g, ' / '));
    };
    const kIn = panel.querySelector('#nv-k');
    kIn.value = localStorage.getItem(LS.key) ? '••••••（已保存）' : '';
    kIn.onfocus = () => { if (kIn.value.indexOf('••') === 0) kIn.value = ''; };
    panel.querySelector('#nv-test').onclick = () => testModel();
    panel.querySelector('#nv-run').onclick = () => { nextRun.match = Date.now(); log('手动配一个…'); };
    panel.querySelector('#nv-ks').onclick = () => {
      const v = kIn.value.trim();
      if (!v || v.indexOf('••') === 0) { localStorage.removeItem(LS.key); kIn.value = ''; log('已恢复内置 Key'); testModel(true); return; }
      localStorage.setItem(LS.key, v); kIn.value = '••••••（已保存）'; log('API Key 已保存'); testModel(true);
    };
  }

  const MODEL = { ok: null };
  async function testModel(silent) {
    try {
      const r = await llmPost({ model: LLM_MODEL, messages: [{ role: 'user', content: 'hi' }], max_tokens: 8 });
      MODEL.ok = r.ok && !/error|invalid/i.test(r.text.slice(0, 200));
      if (!silent) log(MODEL.ok ? '模型连通 ✅' : '模型不通：' + r.text.slice(0, 60));
    } catch (e) { MODEL.ok = false; if (!silent) log('模型失败：' + e.message); }
    render();
  }

  function render() {
    const st = loadLS(LS.stats, {});
    const m = MODEL.ok === null ? '模型 待测' : (MODEL.ok ? '模型 ✅' : '模型 ❌');
    const h = document.getElementById('nv-health');
    if (h) {
      const names = chatList().map(c => c.nickname).join('、');
      h.textContent = (liveSock() ? '✅ socket 已接管' : '⏳ 等 socket') + '｜' + m + '｜' +
        (chatList().length ? '在聊 ' + chatList().length + '：' + names : '空闲');
    }
    const s1 = document.getElementById('nv-stat');
    if (s1) s1.textContent = `今天：匹配 ${st.matched || 0} · 女生 ${st.female || 0} · 跳过男号 ${st.skipMale || 0} · 开聊 ${st.chats || 0} · 回复 ${st.replies || 0}`;
    const n = document.getElementById('nv-next');
    if (n) {
      const now = Date.now();
      n.textContent = '下次：' + (S.autoMatch
        ? (chatList().length >= Math.max(1, S.maxChats) && !S.keepMatching
          ? '会话满了，暂停匹配'
          : '匹配 ' + Math.max(0, Math.round((nextRun.match - now) / 1000)) + ' 秒')
        : '匹配 关');
    }
  }

  function onPush(ev, data) {
    try {
      if (ev === 'authSuccess') {
        if (data && data.data && data.data.userToken) { ST.token = data.data.userToken; log('socket 认证通过'); render(); }
      }
      if (ev === 'matchSuccess') onMatched(data && data.data).catch(e => log('开聊异常：' + e.message));
      if (ev === 'matchFailed') { nextRun.match = Date.now() + 3 * 1000; log('匹配失败：' + ((data && data.msg) || '稍后重试')); }
      if (ev === 'receiveMessage') onRecv(data && data.data);
      if (ev === 'closeChat') {
        const id = data && data.data;
        if (CHATS[id]) { delete CHATS[id]; log('对方离开：' + String(id).slice(-6)); render(); }
      }
      if (ev === 'error' && data && data.code === 1109) log('同账号在别处登录，脚本暂停匹配');
    } catch (e) {}
  }

  function tick() {
    render();
    const now = Date.now();
    if (S.autoReply) {
      for (const c of chatList()) {
        if (c.nextAt && now >= c.nextAt) { c.nextAt = 0; maybeReply(c).catch(() => {}); }
      }
    }
    if (now >= nextRun.poll) { nextRun.poll = now + 20000; syncChats().catch(() => {}); }
    if (now >= nextRun.side) { nextRun.side = now + 12000; pullSideList().then(annotateSidebar).catch(() => {}); }
    if (now >= nextRun.sideA) { nextRun.sideA = now + 2500; annotateSidebar(); }
    if (S.autoMatch) matchLoop().catch(() => {});
    for (const c of chatList()) {
      if (c.greeted && c.hist.filter(m => m.s === 0).length === 0 && Date.now() - c.at > Math.max(30, S.giveUp) * 1000) {
        log(c.nickname + ' 一直没说话，走人');
        closeChat(c.matchId, '沉默');
      }
    }
  }

  function boot() {
    if (document.getElementById('nv-panel')) return;
    buildPanel();
    render();
    ST.token = localStorage.getItem('userToken') || '';
    const t0 = Date.now();
    nextRun.match = t0 + 2000;
    nextRun.poll = t0 + 5000;
    nextRun.side = t0 + 2000;
    log('助手已启动（' + (localStorage.getItem('nickname') || '匿名') + '）· 以男生身份匹配');
    setTimeout(() => testModel(true), 2000);
    setInterval(tick, 1000);
    setInterval(render, 2000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 900));
  else setTimeout(boot, 900);
})();
