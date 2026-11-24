// ==UserScript==
// @name         缘起托管助手（狗头军师版）
// @namespace    https://www.nmliao.cc/
// @version      1.14
// @changelog    1.9 去掉男号黑名单：男生见面即换人，不再累积名单
// @changelog    1.10 增加 @updateURL/@downloadURL，支持油猴自动检查更新
// @changelog    1.11 更新地址切换到 gh-proxy.org
// @changelog    1.12 移除内置智谱 Key（公开仓库泄露），改为本机填写
// @changelog    1.13 接入 APP 桥 GM4W + 女生匹配红色日志 + 匹配统计
// @changelog    1.14 狗头可拖动(位置记忆)；对方消息橙色；隐藏消息页右下角回底箭头(可关)
// @updateURL    https://gh-proxy.org/https://raw.githubusercontent.com/BlackJNG/chat-scripts/main/scripts/%E7%BC%98%E8%B5%B7%E6%89%98%E7%AE%A1%E5%8A%A9%E6%89%8B.user.js
// @downloadURL  https://gh-proxy.org/https://raw.githubusercontent.com/BlackJNG/chat-scripts/main/scripts/%E7%BC%98%E8%B5%B7%E6%89%98%E7%AE%A1%E5%8A%A9%E6%89%8B.user.js
// @description  缘起聊天(nmliao.cc)：纯 socket 自动匹配，配到即自动建会话发「哈喽」；自动回复与捞在线均可在面板设间隔
// @match        https://www.nmliao.cc/*
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
    autoReply: true,
    autoPick: false,      // 捞在线每天 5 次，默认关
    autoMatch: true,
    femaleOnly: true,
    replyEvery: 15,
    pickEvery: 20,
    matchEvery: 9,        // 弹窗处理完 ~9 秒再点下一次
    maxPickPerDay: 5,
    matchWait: 20,   // 发起匹配后最多等多少秒
    matchGap: 10,    // 聊完一个到再发起下一个的间隔（秒）

    maxReplyPerRound: 3,
    hideBottomBtn: true,   // 隐藏消息页右下角“回到底部”箭头（会挡住发送区）
  };
  const LS = { cfg: 'nm_us_cfg', key: 'nm_us_key', sent: 'nm_us_sent', stats: 'nm_us_stats' };
  // 不再维护"男号黑名单"：男号见面即换人，名单只会越滚越大拖慢每轮遍历
  try { localStorage.removeItem('nm_us_black'); } catch (e) {}
  const loadLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const saveLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  Object.assign(S, loadLS(LS.cfg, {}));

  const KEY = () => String(localStorage.getItem(LS.key) || DEFAULT_KEY || '').trim();

  const ME = { id: '', token: '', gender: '', nickname: '' };
  const STATE = { loggedIn: false, uiTried: false, matchAt: 0 };
  const nextRun = { reply: 0, pick: 0, match: 0 };

  const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------- 复用站内 socket（在页面自己的连接上发帧） ----------
  const SOCKS = [];
  (function hookWS() {
    try {
      const Native = W.WebSocket;
      if (!Native || Native.__nmHooked) return;
      function Patched(url, protocols) {
        const ws = protocols ? new Native(url, protocols) : new Native(url);
        if (String(url).indexOf('/socket.io') >= 0) {
          ws.__recv = 0;
          ws.addEventListener('message', (e) => {
            ws.__recv++;
            const d = String(e.data || '');
            if (d === '2') { try { ws.send('3'); } catch (_) {} return; }   // ping → pong
            if (d.indexOf('42') !== 0) return;
            try {
              const arr = JSON.parse(d.slice(2));
              let o = arr && arr[1];
              if (typeof o === 'string') o = JSON.parse(o);
              if (o && o.func) onPush(o);
            } catch (_) {}
          });
          SOCKS.push(ws);
        }
        return ws;
      }
      Patched.prototype = Native.prototype;
      ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k, i) => { Patched[k] = i; });
      Patched.__nmHooked = true;
      W.WebSocket = Patched;
      try { W.__nmSocks = SOCKS; } catch (_) {}
    } catch (e) { /* hook 失败受保护 */ }
  })();

  function readySock() {
    for (let i = SOCKS.length - 1; i >= 0; i--) {
      const w = SOCKS[i];
      if (w && w.readyState === 1 && !w.__nmSelf) return w;   // 只认页面自己的连接
    }
    return null;
  }

  function frame(event, payload) {
    if (payload === undefined) return '42' + JSON.stringify([event]);
    // socket.io emit 语义：数组参数要展开成多个元素，否则服务端会当成一个非法参数忽略掉
    return '42' + JSON.stringify(Array.isArray(payload) ? [event].concat(payload) : [event, payload]);
  }

  // 直接在当前可用连接上发一帧（不等连接、不同步阻塞）
  function sendOnSock(event, payload) {
    const ws = readySock();
    if (!ws) return false;
    const f = frame(event, payload);
    if (window.__nmTrace) log('TRACE ' + f.slice(0, 90));
    try { ws.send(f); return true; } catch (_) { return false; }
  }

  // 只等页面自身的 socket，不再自建第二条连接（第二条连接会被服务端当成另一个会话）
  async function ensureSock() {
    // 等页面 socket 真正完成 login（收到过几帧）再发，否则帧会被服务端丢掉
    for (let i = 0; i < 30; i++) {
      const ws = readySock();
      if (ws && (ws.__recv || 0) >= 2) { await sleep(1200); return true; }
      await sleep(500);
    }
    log('没捕获到页面 socket（请刷新页面后重试）');
    return false;
  }

  function browserId() {
    let b = localStorage.getItem('browserId');
    if (!b) { b = 'nm-' + Math.random().toString(16).slice(2) + Date.now().toString(36); localStorage.setItem('browserId', b); }
    return b;
  }

  async function emit(event, payload) {
    await ensureSock();
    const ws = readySock();
    if (!ws) { log('socket 不可用：' + event + ' 未发送'); return false; }
    try { ws.send(frame(event, payload)); await sleep(300); return true; }
    catch (e) { log('发送帧失败：' + e.message); return false; }
  }

  // ---------- 推送 ----------
  function onPush(o) {
    if (!o || !o.func) return;


    if (o.func === 'match_result') {
      const u = o.data || {};
      STATE.pendingMatch = { nickname: u.nickname, gender: u.gender, id: u.id, match_id: u.match_id };
      STATE.matchAt = Date.now();
      onMatched(u).catch(e => log('自动开聊异常：' + e.message));
      setTimeout(() => { try { hideMatchPopups(); } catch (_) {} }, 1500);
    }
    if (o.func === 'recv_msg' && o.data && o.data.uid && o.data.uid !== ME.id) {
      const d = o.data;
      const mid = d.msg_id || d.message_id || d.id ||
        ('m|' + d.uid + '|' + (d.send_time || d.created_at || d.timestamp || '') + '|' + String(d.msg_content || '').slice(0, 20));
      g4.evt('msg', mid);
      log('收到消息：' + String(o.data.msg_content || '').slice(0, 16) + ' …', '#ffa64d');
      nextRun.reply = Date.now() + 1200;
    }
    if (o.func === 'update_msgs_status' && o.data && o.data.status === 'isSend') return;
  }

  // ---------- 日志 ----------
  const logEl = () => document.getElementById('nm-log');
  const logLines = [];
  function log(msg, tone) {
    const line = `[${new Date().toTimeString().slice(0, 8)}] ${msg}`;
    logLines.unshift({ t: line, c: tone === true ? '#ff5c5c' : (tone || '') });
    if (logLines.length > 40) logLines.length = 40;
    const el = logEl();
    if (el) {
      el.innerHTML = logLines.map(x => x.c
        ? '<span style="color:' + x.c + '">' + esc4(x.t) + '</span>'
        : esc4(x.t)).join('\n');
    }
    console.log('[缘起助手]', msg);
    g4.log(line);
  }

  // ---------- REST ----------
  async function api(path, body) {
    const r = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}), credentials: 'include',
    });
    const txt = await r.text();
    try { return JSON.parse(txt); } catch { return { code: 0, msg: txt, data: null }; }
  }
  const apiData = async (p, b) => (await api(p, b)).data;

  async function loadMe() {
    const d = await apiData('/api/v1/user/get_info', {});
    if (!d || !d.id) { STATE.loggedIn = false; return null; }
    ME.id = d.id; ME.token = d.token || ''; ME.gender = d.gender || ''; ME.nickname = d.nickname || '';
    STATE.loggedIn = true;
    return d;
  }

  async function chats() {
    const d = await apiData('/api/v1/anonchat/load_more_chats', { from_id: null, limit: 40 });
    return (d && d.chats) || [];
  }
  async function msgs(cid, limit) {
    const d = await apiData('/api/v1/anonchat/load_more_messages', { chatid: cid, from_id: null, limit: limit || 20, is_group_chat: false });
    if (Array.isArray(d)) return d;
    return (d && (d.messages || d.msgs || d.list)) || [];
  }
  async function startChat(from, token) {
    const j = await api('/api/v1/anonchat/start_chat', { from, token });
    const d = j.data || {};
    return { chatid: d.chatid || d.chat_id || '', to_uid: d.to_uid || '', uid: d.uid || '' };
  }
  function sendMsg(chatid, toUid, text) {
    return emit('send_msg', {
      message_id: Date.now().toString(36) + Math.random().toString(16).slice(2, 8),
      uid: ME.id, to_uid: toUid || '', chatid: chatid || '',
      msg: { msg_type: 'text', msg_content: text, msg_meta: {} },
      is_group_chat: false, force_green: false,
    });
  }

  // ---------- 智谱 ----------
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

  async function gen(prompt, maxTokens = 90) {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await llmPost({ model: LLM_MODEL, messages: [{ role: 'system', content: SYS }, { role: 'user', content: prompt }], temperature: 0.85, max_tokens: maxTokens });
        if (!r.ok) { await sleep(1500); continue; }
        const j = JSON.parse(r.text);
        const t = ((j.choices && j.choices[0] && j.choices[0].message.content) || '').trim();
        if (t) return clean(t);
      } catch (e) { await sleep(1500); }
    }
    return '';
  }

  const BAN = ['微信', 'QQ', 'qq', 'vx', '支付宝', '转账', '红包', '手机号', '加我', '抖音'];
  function clean(t) {
    t = t.replace(/^["“'「]|["”'」]$/g, '').replace(/\n+/g, ' ').trim();
    t = t.replace(/^(承接|降压|调侃|轻推|约见|澄清|收线|回复)[：:]\s*/, '').trim();
    if (t.length > 45) t = t.slice(0, 45);
    if (BAN.some(w => t.includes(w))) return '';
    return t;
  }

  const MEMK = 'nm_us_mem';
  function memAll() { return loadLS(MEMK, {}); }
  function memAppend(name, text) {
    if (!name || !text) return;
    const m = memAll();
    const list = (m[name] && m[name].said) || [];
    list.push(text.slice(0, 30));
    m[name] = { said: list.slice(-8) };
    saveLS(MEMK, m);
  }
  function stageOf(norm) {
    const total = norm.length;
    const last = (norm[norm.length - 1] || {}).t || '';
    if (/见面|出来|约|有空|在哪|一起|见你/.test(last)) return '想见';
    if (total <= 4) return '陌生';
    if (total <= 12) return '熟一点';
    return '有点暧昧';
  }

  // 只保留安全兜底；其余全部交给模型（避免固定套话）
  function ruleReply(msgs) {
    const L = ((msgs[msgs.length - 1] || {}).t || '').trim();
    if (/不想聊|别联系|不要联系|不欢迎|别烦我|滚/.test(L)) return '行，那不打扰了。';
    if (/我男的|我是男的|性别男/.test(L)) return '行，那就不打扰了。';
    return '';
  }


  const normOf = list => list.map(m => ({ s: (m.uid === ME.id) ? 1 : 0, t: m.msg_content || m.content || '' })).filter(m => m.t);

  async function replyFor(name, list) {
    const norm = normOf(list);
    if (!norm.length) return '';
    const r = ruleReply(norm);
    if (r) return r;
    const stage = stageOf(norm);
    const said = ((memAll()[name] || {}).said || []).slice(-5);
    const lines = norm.slice(-8).map(m => (m.s ? '我：' : name + '：') + m.t).join('\n');
    const last = norm[norm.length - 1].t;
    const hints = [];
    if (/\?|？|吗/.test(last)) hints.push('她在问我：先把她问的答完，最多再轻轻带一句。');
    const prevSelf = [...norm].reverse().find(m => m.s);
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


  // ---------- 自动回复 ----------
  async function autoReplyOnce() {
    if (!STATE.loggedIn && !(await loadMe())) return;
    const list = await chats();
    const st = loadLS(LS.stats, {});
    st.unread = list.filter(c => c.unread_msg_count > 0).length;
    st.convs = list.length; saveLS(LS.stats, st);
    const sent = loadLS(LS.sent, {});
    let done = 0;
    for (const c of list) {
      if (done >= S.maxReplyPerRound) break;
      if (c.is_block || c.other_leave === 1) continue;
      if (!c.unread_msg_count) continue;
      let m;
      try { m = await msgs(c.chatid, 15); } catch (e) { continue; }
      if (!m.length) continue;
      const lastOne = m[m.length - 1];
      if (lastOne.uid === ME.id) continue;
      const key = c.chatid + '|' + (lastOne.ts || '') + '|' + (lastOne.msg_content || '');
      if (sent[key]) continue;
      const reply = await replyFor(c.title || '对方', m);
      if (!reply) { sent[key] = 1; saveLS(LS.sent, sent); continue; }
      try {
        await sendMsg(c.chatid, c.to_uid, reply);
        sent[key] = 1; saveLS(LS.sent, sent); done++;
        log('回复 ' + c.title + '：' + reply);
      memAppend(c.title, reply);
        bump('replies');
      } catch (e) { log('发送失败 ' + c.title + '：' + e.message); }
    }
  }

  async function greeting() { return '哈喽'; }

  // 弹窗：一次性收起匹配结果弹层 + 它自带的遮罩，并解除 body 滚动锁
  function hideMatchPopups() {
    document.querySelectorAll('.adm-center-popup-wrap').forEach(w => {
      const t = (w.textContent || '');
      if (!t.includes('重新匹配') || t.includes('聊聊看')) return;
      w.dataset.nmSkip = '1';
      w.style.display = 'none';
      w.style.pointerEvents = 'none';
      const root = w.closest('.adm-center-popup') || w.parentElement;
      if (root) {
        root.style.display = 'none';
        root.querySelectorAll('.adm-mask').forEach(m => {
          m.style.display = 'none';
          m.style.pointerEvents = 'none';
        });
      }
    });
    // 没有任何还可见的弹层时，把残留遮罩和 body 滚动锁一并清掉
    const visible = Array.from(document.querySelectorAll('.adm-center-popup-wrap'))
      .some(w => w.style.display !== 'none' && !w.dataset.nmSkip);
    if (!visible) {
      document.querySelectorAll('.adm-mask.adm-center-popup-mask').forEach(m => {
        m.style.display = 'none';
        m.style.pointerEvents = 'none';
      });
      document.body.classList.remove('adm-overflow-hidden');
    }
  }

  // ---------- 界面驱动匹配 ----------
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

  function matchDialog() {
    const wrap = document.querySelector('.adm-center-popup-wrap');
    if (!wrap) return null;
    if (wrap.dataset.nmSkip === '1') return null;    // 已判定跳过（男号）的弹层不再重复处理
    const txt = (wrap.innerText || '').replace(/\n+/g, ' | ');
    if (!/重新匹配|开始聊天/.test(txt)) return null;
    const gm = /性别\s*[|:\s]*(男|女)/.exec(txt);
    const nm = (txt.split('性别')[0] || '').replace(/\s*\|\s*/g, '').replace(/编组\s*\d+/g, '').trim().slice(0, 16);
    return { txt, gender: gm ? (gm[1] === '男' ? 'male' : 'female') : '', nickname: nm };
  }

  const M = { phase: 'idle', until: 0 };
  let LAST_MATCH_ID = '';

  async function onMatched(u) {
    if (u.match_id && LAST_MATCH_ID === u.match_id) return;
    LAST_MATCH_ID = u.match_id || '';
    hideMatchPopups();   // 只收这一次的弹层，不影响服务端
    log('配到 ' + (u.nickname || '?') + '（' + (u.gender === 'female' ? '女' : '男') + '/' + (u.age || '?') + '）', u.gender === 'female' ? '#ff5c5c' : '');
    if (!u.match_id) { log('缺 match_id，跳过'); return; }
    if (S.femaleOnly && u.gender !== 'female') {
      log('跳过 ' + (u.nickname || '?') + '（男号，不拉黑）');
      M.phase = 'idle'; M.until = Date.now() + Math.max(2, S.matchGap || 10) * 1000; nextRun.match = M.until;
      return;
    }
    const r = await startChat('match', u.match_id);
    if (!r.chatid) { log('建会话失败（' + (u.nickname || '?') + '），换个再配'); M.phase = 'idle'; M.until = Date.now() + 3000; nextRun.match = M.until; return; }
    if (u.gender === 'female') { stMatched(); g4.evt('match', u.id || u.match_id); }   // 只推配到女生
    const ok = await sendMsg(r.chatid, r.to_uid || u.id, '哈喽');
    log((ok ? '打招呼 ' : '打招呼帧未送达 ') + (u.nickname || '?') + '：哈喽');
    bump('replies');
    M.phase = 'idle';
    M.until = Date.now() + Math.max(2, S.matchGap || 10) * 1000;
    nextRun.match = M.until;
  }

  // 纯 socket 匹配：不点任何按钮，quit → start → 等 match_result
  async function matchLoop() {
    if (!S.autoMatch || !STATE.loggedIn) return;
    const now = Date.now();
    if (now < M.until) return;
    if (M.phase === 'waiting') { log('等 ' + (S.matchWait || 20) + ' 秒没结果，重新发起'); M.phase = 'idle'; }
    if (!readySock()) { log('socket 未就绪，5 秒后重试'); M.until = now + 5000; nextRun.match = M.until; return; }
    const setting = { gender: S.femaleOnly ? 'female' : 'any', position: 'any', min_age: 18, max_age: 70 };
    const wait = Math.max(5, S.matchWait || 20);
    M.phase = 'waiting'; M.until = now + wait * 1000; nextRun.match = M.until;
    sendOnSock('quit_match', ME.id);
    await sleep(1200);
    const ok = sendOnSock('start_match', [ME.id, setting]);
    if (ok) log('socket 发起匹配（' + (S.femaleOnly ? '只女生' : '不限性别') + '），等 ' + wait + ' 秒');
    else { log('start_match 帧发送失败，5 秒后重试'); M.phase = 'idle'; M.until = Date.now() + 5000; nextRun.match = M.until; }
  }

  // ---------- 捞在线（每天 5 次） ----------
  function pickLeft() {
    const st = loadLS(LS.stats, {});
    const today = new Date().toDateString();
    if (st.pickDate !== today) { st.pickDate = today; st.picks = 0; st.rem = S.maxPickPerDay; saveLS(LS.stats, st); }
    return st.rem == null ? S.maxPickPerDay : st.rem;
  }

  async function pickOnce() {
    if (!STATE.loggedIn && !(await loadMe())) return;
    if (pickLeft() <= 0) { log('今日捞取次数已用完（每天 ' + S.maxPickPerDay + ' 次）'); return; }
    const btn = leafByText(/^捞个在线$/);
    if (!btn) { log('没找到「捞个在线」入口'); return; }
    clickEl(btn);
    log('点击捞个在线');
    await sleep(2500);
    // 捞完会弹一个用户卡片，同样有 性别 / 聊聊看
    const card = document.querySelector('.adm-center-popup-wrap');
    if (!card || card.dataset.nmSkip === '1') return;
    const txt = (card.innerText || '').replace(/\n+/g, ' | ');
    const gm = /性别\s*[|:\s]*(男|女)/.exec(txt);
    const g = gm ? (gm[1] === '男' ? 'male' : 'female') : '';
    const nm = (card.innerText || '').split('\n')[0].trim();
    const st = loadLS(LS.stats, {});
    st.picks = (st.picks || 0) + 1; st.rem = Math.max(0, S.maxPickPerDay - st.picks);
    saveLS(LS.stats, st); render();
    log('捞到 ' + nm + '（' + (g || '?') + '）');
    if (S.femaleOnly && g !== 'female') { log('捞到男号 ' + nm + '，直接关掉（不拉黑）'); const no = leafByText(/^关闭$|^取消$/); if (no) clickEl(no); return; }
    const go = leafByText(/^聊聊看$|^开始聊天$/);
    if (go) {
      clickEl(go);
      await sleep(1800);
      const hit = (await chats()).find(c => (c.title || '').trim() === nm.trim());
      if (hit) { const msg = await greeting({ nickname: nm }); await sendMsg(hit.chatid, hit.to_uid, msg); log('打招呼 ' + nm + '：' + msg); bump('replies'); }
    }
  }

  // ---------- 面板 ----------
  function css() {
    if (document.getElementById('nm-style')) return;
    const s = document.createElement('style');
    s.id = 'nm-style';
    s.textContent = `
#nm-fab{position:fixed;right:14px;bottom:96px;z-index:99998;width:46px;height:46px;border-radius:50%;
  background:#2b3a55;color:#fff;border:none;font-size:22px;box-shadow:0 4px 14px rgba(0,0,0,.35)}
#nm-panel{display:none;position:fixed;right:10px;left:10px;bottom:80px;z-index:99999;max-height:72vh;overflow:auto;
  background:#0f1420;color:#e6ebf5;border:1px solid #262d3c;border-radius:16px;padding:12px 14px;
  font:13px/1.5 -apple-system,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.45)}
#nm-panel.show{display:block}
#nm-panel h3{position:sticky;top:-12px;z-index:9;background:#0f1420;margin:0 0 8px;padding:8px 0;
  font-size:14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1b2231}
#nm-panel h3 .x{background:none;border:none;color:#8b94aa;font-size:20px;line-height:1;padding:4px 8px}
.nm-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #1b2231}
.nm-row b{display:block;font-size:13px}
.nm-row span{display:block;font-size:11px;color:#8b94aa}
.nm-tg input{display:none}
.nm-tg i{display:block;width:44px;height:24px;border-radius:12px;background:#2a3245;position:relative;transition:.2s}
.nm-tg i:after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#8b94aa;transition:.2s}
.nm-tg input:checked+i{background:#2f6bff}
.nm-tg input:checked+i:after{left:23px;background:#fff}
.nm-key{display:flex;gap:6px;margin:8px 0 2px}
.nm-key input{flex:1;background:#16202f;border:1px solid #262d3c;color:#cfd7e6;border-radius:8px;padding:7px 9px;font-size:12px}
.nm-key button{background:#2f6bff;color:#fff;border:none;border-radius:8px;padding:0 12px}
.nm-stat{color:#7d86a0;font-size:11px;margin-top:6px}
.nm-health{color:#8b94aa;font-size:11px;margin-top:4px;line-height:1.6}
.nm-btns{display:flex;gap:6px;margin:8px 0 2px}
.nm-setrow button{width:100%;background:#1b2333;color:#9aa3b7;border:1px solid #262d3c;border-radius:9px;padding:8px 0;font-size:12px}
.nm-btns button{flex:1;background:#243049;color:#cfd7e6;border:1px solid #2f3d5c;border-radius:8px;padding:7px 0;font-size:12px}
#nm-log{margin-top:8px;max-height:150px;overflow:auto;font:11px/1.55 ui-monospace,monospace;color:#8b94aa;
  white-space:pre-wrap;border-top:1px solid #1b2231;padding-top:6px}
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
    fab.id = 'nm-fab'; fab.textContent = '🐶';
    const panel = document.createElement('div');
    panel.id = 'nm-panel';
    panel.innerHTML = `
      <h3>缘起托管 · 狗头军师<button class="x" id="nm-x">×</button></h3>
      <div class="nm-row"><div><b>自动回复</b><span>有未读就逐条接一句</span></div>
        <label class="nm-tg"><input type="checkbox" id="nm-r"><i></i></label></div>
      <div class="nm-row"><div><b>自动捞在线</b><span>每天只有 5 次，默认关</span></div>
        <label class="nm-tg"><input type="checkbox" id="nm-p"><i></i></label></div>
      <div class="nm-row"><div><b>自动随机匹配</b><span>纯 socket 匹配，配到自动开聊</span></div>
        <label class="nm-tg"><input type="checkbox" id="nm-m"><i></i></label></div>
      <div class="nm-row"><div><b>只看女生</b><span>男号自动跳过并记入名单</span></div>
        <label class="nm-tg"><input type="checkbox" id="nm-f"><i></i></label></div>
      <div class="nm-row"><div><b>隐藏下滑箭头</b><span>消息页右下角“回到底部”按钮，挡发送区</span></div>
        <label class="nm-tg"><input type="checkbox" id="nm-hb"><i></i></label></div>
      <div class="nm-setrow"><button id="nm-setbtn">设置（间隔 · 模型 · Key）</button></div>
      <div id="nm-set" style="display:none">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:6px 0 2px">
          <label style="font-size:11px;color:#7d86a0">回复间隔(秒)<input id="nm-rv" type="number" min="5" style="width:100%;margin-top:3px;background:#0f1319;border:1px solid #2a3040;color:#dfe5ef;border-radius:8px;padding:6px 8px;font-size:12px"></label>
          <label style="font-size:11px;color:#7d86a0">捞人间隔(秒)<input id="nm-pk" type="number" min="10" style="width:100%;margin-top:3px;background:#0f1319;border:1px solid #2a3040;color:#dfe5ef;border-radius:8px;padding:6px 8px;font-size:12px"></label>
          <label style="font-size:11px;color:#7d86a0">匹配等待(秒)<input id="nm-mw" type="number" min="5" style="width:100%;margin-top:3px;background:#0f1319;border:1px solid #2a3040;color:#dfe5ef;border-radius:8px;padding:6px 8px;font-size:12px"></label>
          <label style="font-size:11px;color:#7d86a0">匹配冷却(秒)<input id="nm-mg" type="number" min="2" style="width:100%;margin-top:3px;background:#0f1319;border:1px solid #2a3040;color:#dfe5ef;border-radius:8px;padding:6px 8px;font-size:12px"></label>
        </div>
        <div class="nm-key"><input id="nm-k" type="password" placeholder="智谱 API Key（必填，只存本机）"><button id="nm-ks">存</button></div>
        <div class="nm-btns"><button id="nm-test">测试模型</button><button id="nm-run">立即跑一轮</button></div>
      </div>
      <div class="nm-stat" id="nm-stat"></div>
      <div class="nm-health" id="nm-health"></div>
      <div class="nm-health" id="nm-next"></div>
      <div id="nm-log"></div>
    `;
    document.body.appendChild(fab);
    document.body.appendChild(panel);
    initFabDrag(fab, 'nm_fab_pos');
    fab.onclick = () => {
      if (fab.dataset.dragged) { delete fab.dataset.dragged; return; }
      panel.classList.toggle('show');
    };
    panel.querySelector('#nm-x').onclick = () => panel.classList.remove('show');
    panel.querySelector('#nm-setbtn').onclick = () => {
      const d = panel.querySelector('#nm-set');
      d.style.display = d.style.display === 'none' ? 'block' : 'none';
    };

    const bind = (id, key) => {
      const el = panel.querySelector(id);
      el.checked = !!S[key];
      el.onchange = () => {
        S[key] = el.checked; saveLS(LS.cfg, S);
        if (el.checked) {
          if (key === 'autoPick') nextRun.pick = Date.now() + 1000;
          if (key === 'autoMatch') nextRun.match = Date.now() + 800;
          if (key === 'autoReply') nextRun.reply = Date.now() + 1000;
        }
        render();
      };
    };
    bind('#nm-r', 'autoReply'); bind('#nm-p', 'autoPick'); bind('#nm-m', 'autoMatch'); bind('#nm-f', 'femaleOnly'); bind('#nm-hb', 'hideBottomBtn');
    applyHideArrow();
    [['#nm-rv','replyEvery','回复间隔'],['#nm-pk','pickEvery','捞人间隔'],['#nm-mw','matchWait','匹配等待'],['#nm-mg','matchGap','匹配冷却']]
      .forEach(([sel,key,name]) => {
        const el = panel.querySelector(sel);
        el.value = S[key];
        el.onchange = () => {
          const v = Math.max(key === 'matchGap' ? 2 : 5, parseInt(el.value, 10) || S[key]);
          S[key] = v; el.value = v; saveLS(LS.cfg, S); log(name + '设为 ' + v + ' 秒'); render();
        };
      });

    const kIn = panel.querySelector('#nm-k');
    kIn.value = localStorage.getItem(LS.key) ? '••••••（已保存）' : '';
    kIn.onfocus = () => { if (kIn.value.startsWith('••')) kIn.value = ''; };
    panel.querySelector('#nm-test').onclick = () => testModel();
    panel.querySelector('#nm-run').onclick = async () => {
      log('手动跑一轮…');
      try { await autoReplyOnce(); } catch (e) { log('回复异常：' + e.message); }
      try { M.phase = 'idle'; await matchLoop(); } catch (e) { log('匹配异常：' + e.message); }
    };
    panel.querySelector('#nm-ks').onclick = () => {
      const v = kIn.value.trim();
      if (!v || v.startsWith('••')) { localStorage.removeItem(LS.key); kIn.value = ''; log('已恢复内置默认 Key'); testModel(true); return; }
      localStorage.setItem(LS.key, v); kIn.value = '••••••（已保存）'; log('API Key 已保存'); testModel(true);
    };
  }

  const MODEL = { ok: null, at: 0 };

  async function testModel(silent) {
    try {
      const r = await llmPost({ model: LLM_MODEL, messages: [{ role: 'user', content: 'hi' }], max_tokens: 8 });
      MODEL.ok = r.ok && !/error|invalid/i.test(r.text.slice(0, 200)); MODEL.at = Date.now();
      if (!silent) log(MODEL.ok ? '模型连通 ✅' : '模型不通：' + r.text.slice(0, 60));
    } catch (e) { MODEL.ok = false; MODEL.at = Date.now(); if (!silent) log('模型失败：' + e.message); }
    render();
  }

  function stMatched() {
    try {
      const st = loadLS(LS.stats, {});
      const today = new Date().toDateString();
      if (st.mDate !== today) { st.mDate = today; st.matched = 0; st.female = 0; }
      st.matched = (st.matched || 0) + 1;
      st.female = (st.female || 0) + 1;
      saveLS(LS.stats, st);
    } catch (e) {}
  }

  function bump(key) {
    const st = loadLS(LS.stats, {});
    const today = new Date().toDateString();
    if (st.date !== today) { st.date = today; st.replies = 0; }
    st[key] = (st[key] || 0) + 1; saveLS(LS.stats, st); render();
  }

  function render() {
    const st = loadLS(LS.stats, {});
    const m = MODEL.ok === null ? '模型 待检测' : (MODEL.ok ? '模型 ✅' : '模型 ❌');
    const h = document.getElementById('nm-health');
    if (h) h.textContent = STATE.loggedIn
      ? `✅ 在线｜未读 ${st.unread || 0} | 会话 ${st.convs || 0} | ${m}`
      : '❌ 未登录：先在站内登录（cjh888 / cjh888）';
    const s1 = document.getElementById('nm-stat');
    if (s1) s1.textContent = `今天：匹配 ${st.matched || 0} · 女生 ${st.female || 0} · 捞取 ${st.picks || 0}/${S.maxPickPerDay} 次 · 回复 ${st.replies || 0} 条 · 剩余捞取 ${pickLeft()}`;
    const n = document.getElementById('nm-next');
    if (n) {
      const now = Date.now();
      n.textContent = '下次：' + [
        S.autoReply ? '回复 ' + Math.max(0, Math.round((nextRun.reply - now) / 1000)) + '秒' : '回复 关',
        S.autoPick ? '捞人 ' + Math.max(0, Math.round((nextRun.pick - now) / 1000)) + '秒' : '捞人 关',
        S.autoMatch ? (M.phase === 'waiting' ? '匹配 等结果 ' + Math.max(0, Math.round((M.until - now) / 1000)) + '秒' : '匹配 即将发起') : '匹配 关',
      ].join(' | ');
    }
  }

  function tick() {
    render();
    const now = Date.now();
    if (S.autoReply && now >= nextRun.reply) { nextRun.reply = now + S.replyEvery * 1000; autoReplyOnce().catch(() => {}); }
    if (S.autoPick && now >= nextRun.pick) { nextRun.pick = now + S.pickEvery * 1000; pickOnce().catch(() => {}); }
    if (S.autoMatch) matchLoop().catch(() => {});
  }

  // ---------- 隐藏消息页右下角“回到底部”箭头 ----------
  const ARROW_CSS = [
    '[class*="to-bottom"],[class*="toBottom"],[class*="scroll-bottom"],[class*="scrollBottom"]',
    '[class*="back-bottom"],[class*="backBottom"],[class*="go-bottom"],[class*="goBottom"]',
    '[class*="down-arrow"],[class*="downArrow"],[class*="bottom-arrow"],[class*="bottomArrow"]',
    '[class*="scroll-to"],[class*="scrollTo"],[class*="toDown"],[class*="to-down"]',
  ].join(',') + '{display:none!important}';

  function applyHideArrow() {
    let st = document.getElementById('nm-hide-arrow');
    if (!S.hideBottomBtn) {
      if (st) st.remove();
      document.querySelectorAll('[data-nm-arrow]').forEach(el => {
        el.style.display = el.dataset.nmArrowOld || '';
        delete el.dataset.nmArrow; delete el.dataset.nmArrowOld;
      });
      return;
    }
    if (!st) {
      st = document.createElement('style');
      st.id = 'nm-hide-arrow';
      st.textContent = ARROW_CSS;
      document.documentElement.appendChild(st);
    }
    sweepArrow();
  }

  // 只认“固定在右下、尺寸小、类名带 arrow/down/bottom/scroll、且不在输入栏里”的元素
  function sweepArrow() {
    try {
      const vw = window.innerWidth, vh = window.innerHeight;
      document.querySelectorAll('[class]').forEach(el => {
        if (el.dataset.nmArrow || el.id === 'nm-panel' || el.closest('#nm-panel')) return;
        if (!/arrow|down|bottom|scroll/i.test(String(el.className || ''))) return;
        const r = el.getBoundingClientRect();
        if (r.width < 12 || r.height < 12 || r.width > 64 || r.height > 64) return;
        if (r.right < vw - 80 || r.bottom < 60 || r.bottom > vh - 56) return;
        if (getComputedStyle(el).position === 'static') return;
        if (el.closest('[class*="input"],[class*="send"],[class*="editor"],[class*="footer"],[class*="textarea"]')) return;
        el.dataset.nmArrowOld = el.style.display || '';
        el.dataset.nmArrow = '1';
        el.style.setProperty('display', 'none', 'important');
      });
    } catch (e) {}
  }

  async function boot() {
    if (document.getElementById('nm-panel')) return;
    buildPanel();
    render();
    const info = await loadMe();
    render();
    const t0 = Date.now();
    nextRun.reply = t0 + 3000;
    nextRun.pick = t0 + 8000;
    nextRun.match = t0 + 3000;
    if (!info) {
      log('未登录，脚本待命（登录后自动接管）');
      applyHideArrow(); setInterval(applyHideArrow, 3000);
      setInterval(async () => { if (await loadMe()) { log('检测到登录：' + ME.nickname); await ensureSock(); } render(); }, 15000);
      setInterval(render, 2000);
      return;
    }
    log('助手已启动（' + ME.nickname + ' / ' + ME.gender + '）');
    applyHideArrow(); setInterval(applyHideArrow, 3000);
    await ensureSock();
    setTimeout(() => testModel(true), 1500);
    setInterval(tick, 1000);
  }

  function startWhenReady() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 900));
    else setTimeout(boot, 900);
  }
  startWhenReady();
})();
