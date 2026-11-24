// ==UserScript==
// @name         星缘托管助手（狗头军师版）
// @namespace    https://www.starfate.vip/
// @version      1.14
// @changelog    1.9 去掉男号黑名单：男生见面即换人，不再累积名单
// @changelog    1.10 增加 @updateURL/@downloadURL，支持油猴自动检查更新
// @changelog    1.11 更新地址切换到 gh-proxy.org
// @changelog    1.12 移除内置智谱 Key（公开仓库泄露），改为本机填写
// @changelog    1.13 接入 APP 桥 GM4W（日志/事件推送）+ 女生匹配红色日志 + 匹配统计
// @changelog    1.14 狗头悬浮球可拖动（位置记忆）
// @updateURL    https://gh-proxy.org/https://raw.githubusercontent.com/BlackJNG/chat-scripts/main/scripts/%E6%98%9F%E7%BC%98%E6%89%98%E7%AE%A1%E5%8A%A9%E6%89%8B.user.js
// @downloadURL  https://gh-proxy.org/https://raw.githubusercontent.com/BlackJNG/chat-scripts/main/scripts/%E6%98%9F%E7%BC%98%E6%89%98%E7%AE%A1%E5%8A%A9%E6%89%8B.user.js
// @description  自动回复/自动捞在线/自动随机匹配，只聊女生，智谱生成，狗头军师话术规则
// @match        https://www.starfate.vip/*
// @grant        GM_xmlhttpRequest
// @connect      open.bigmodel.cn
// @run-at       document-idle
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


  // ---------- 配置 ----------
  const DEFAULT_KEY = '';  // 安全：不再内置任何 Key，只从本机 localStorage 读取
  const LLM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
  const LLM_MODEL = 'glm-4-plus';

  const S = {
    autoReply: true,
    autoPick: true,
    autoMatch: false,
    femaleOnly: true,
    picksPerRound: 20,
    replyEvery: 15,   // 秒
    pickEvery: 60,    // 秒
    matchEvery: 180,  // 秒
    maxReplyPerRound: 3,
    matchPoll: 30,   // 匹配状态轮询上限（秒）
    matchGap: 8,     // 换人冷却（秒）

  };
  const LS = {
    cfg: 'xy_us_cfg',
    key: 'xy_us_key',
    sent: 'xy_us_sent',
    stats: 'xy_us_stats'
  };
  const loadLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const saveLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  Object.assign(S, loadLS(LS.cfg, {}));

  const KEY = () => String(localStorage.getItem(LS.key) || DEFAULT_KEY || '').trim();
  // 不再维护"男号黑名单"：男生本来就是见面即换人，拉黑只会污染名单、拖慢 localStorage
  try { localStorage.removeItem('xy_us_black'); } catch (e) {}
  const TOKEN = () => localStorage.getItem('token');

  // ---------- 工具 ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const logEl = () => document.getElementById('xy-log');
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
    console.log('[星缘助手]', msg);
    g4.log(line);   // 额外推一份给 APP
  }

  async function api(path, opt = {}) {
    const t = TOKEN();
    const r = await fetch(path, {
      ...opt,
      headers: {
        'Authorization': 'Bearer ' + t,
        'Content-Type': 'application/json',
        ...(opt.headers || {})
    },
    });
    if (!r.ok) throw new Error(path + ' -> ' + r.status);
    const txt = await r.text();
    try { return JSON.parse(txt); } catch { return txt; }
  }

  // ---------- 发送队列：所有发送串行，最小间隔 900ms，避免并发拥堵 ----------
  let sendChain = Promise.resolve();
  function enqueueSend(fn) {
    sendChain = sendChain.then(async () => {
      await fn();
      await sleep(900);
    }).catch(() => {});
    return sendChain;
  }

  // ---------- 发送：SignalR over WebSocket ----------
  async function hubSend(cid, text) {
    const t = TOKEN();
    if (!t) throw new Error('未登录');
    const nr = await fetch('/hubs/chat/negotiate?negotiateVersion=1', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + t }
    });
    if (!nr.ok) throw new Error('negotiate ' + nr.status);
    const nj = await nr.json();
    const wsUrl = location.origin.replace('https', 'wss') + '/hubs/chat?id=' + nj.connectionToken +
      '&access_token=' + encodeURIComponent(t);
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error('ws error'));
      setTimeout(() => rej(new Error('ws timeout')), 8000);
    });
    let done = false, ok = false, errMsg = '';
    ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + '\u001e');
    ws.onmessage = e => {
      String(e.data).split('\u001e').filter(Boolean).forEach(x => {
        try {
          const j = JSON.parse(x);
          if (j.type === 3 && j.invocationId === '1') { done = true; ok = !j.error; if (j.error) errMsg = j.error; }
          if (j.type === 7) { done = true; ok = false; errMsg = j.error || 'close'; }
        } catch (_) {}
      });
    };
    await sleep(800);
    ws.send(JSON.stringify({
      type: 1, invocationId: '1', target: 'SendMessage',
      arguments: [{ conversationId: cid, text: text, msgType: 'text', burnAfterRead: false, replyToId: null }]
    }) + '\u001e');
    const t0 = Date.now();
    while (!done && Date.now() - t0 < 6000) await sleep(120);
    try { ws.close(); } catch (_) {}
    if (!ok) throw new Error('发送失败: ' + (errMsg || '无回帧'));
    return true;
  }

  // ---------- 数据 ----------
  const getConvs = () => api('/api/chat/conversations').then(j => j.data || []);
  const getMsgs = (cid, n = 10) => api(`/api/chat/conversations/${cid}/messages?pageSize=${n}`).then(j => j.data || []);
  async function createConv(uid) {
    const j = await api('/api/chat/conversations', { method: 'POST', body: JSON.stringify({ targetUserId: uid }) });
    return (j.data && j.data.id) || j.id || null;
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
21岁，在福州生活，写代码的。说话松弛、句子短、有点懒散的好笑，不端着也不装深沉。
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

  // 智谱走 GM_xmlhttpRequest，绕过跨域限制（浏览器直连 open.bigmodel.cn 会被 CORS 拦）
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
        const r = await llmPost({
          model: LLM_MODEL,
          messages: [{ role: 'system', content: SYS }, { role: 'user', content: prompt }],
          temperature: 0.85, max_tokens: maxTokens
        });
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

  // ---------- 规则层（比模型更稳的硬场景） ----------
  const MEMK = 'xy_us_mem';
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


  async function replyFor(name, msgs) {
    const norm = msgs.map(m => ({ s: m.isSelf ? 1 : 0, t: m.text || '', time: (m.createdAt || '').slice(11, 16) }));
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
    const convs = await getConvs();
    const sent = loadLS(LS.sent, {});
    let done = 0;
    for (const c of convs) {
      if (done >= S.maxReplyPerRound) break;
      if (c.isDeleted || c.peerIsBanned) continue;
      if (c.unread === 0) continue;   // 只处理有未读的，省请求
      const msgs = await getMsgs(c.id, 10);
      if (!msgs.length) continue;
      const last = msgs[msgs.length - 1];
      if (last.isSelf) continue;                     // 我方已最后发言，不追加
      const key = c.id + '|' + (last.createdAt || '') + '|' + (last.text || '');
      if (sent[key]) continue;                        // 同一条已处理过
      g4.evt('msg', key);                             // 新消息事件（id 与去重键一致，稳定唯一）
      const reply = await replyFor(c.peerNickname, msgs);
      if (!reply) { log('跳过 ' + c.peerNickname + '（模型空或触发禁词）'); sent[key] = 1; saveLS(LS.sent, sent); continue; }
      const prevSelf = [...msgs].reverse().find(m => m.isSelf);
      if (prevSelf && prevSelf.text === reply) { log('跳过 ' + c.peerNickname + '（与上条重复）'); sent[key] = 1; saveLS(LS.sent, sent); continue; }
      try {
        await enqueueSend(() => hubSend(c.id, reply));
        sent[key] = 1; saveLS(LS.sent, sent);
        done++;
        log('回复 ' + c.peerNickname + '：' + reply);
        pushStat(c.peerNickname, reply);
        memAppend(c.peerNickname, reply);
        await sleep(1200);
      } catch (e) { log('发送失败 ' + c.peerNickname + '：' + e.message); }
    }
  }

  // ---------- 开场 ----------
  async function greeting() { return '哈喽'; }

  async function pickOnce() {
    const seen = new Set((await getConvs()).map(c => c.peerNickname));
    let n = 0, rem = null;
    for (let i = 0; i < S.picksPerRound; i++) {
      let r;
      try { r = (await api('/api/match/pick-online', { method: 'POST', body: '{}' })).data; }
      catch (e) { log('捞个在线失败：' + e.message); break; }
      if (!r || !r.user) { log('捞个在线：' + ((r && r.message) || '无返回')); break; }
      const u = r.user; n++; rem = r.remainingPicks;
      if (S.femaleOnly && u.gender !== 'female') { log('跳过男号 ' + u.nickname + '（不拉黑）'); }
      else if (!seen.has(u.nickname)) {
        const cid = await createConv(u.id);
        if (cid) {
          const msg = await greeting(u);
          try { await hubSend(cid, msg); seen.add(u.nickname); log('打招呼 ' + u.nickname + '(' + u.gender + '/' + u.age + ')：' + msg); }
          catch (e) { log('打招呼失败 ' + u.nickname + '：' + e.message); }
          await sleep(1500);
        }
      }
      if (rem !== null && rem <= 0) { log('今日捞取额度已用尽'); break; }
      await sleep(1000);
    }
    const st = loadLS(LS.stats, { date: '' });
    const today = new Date().toDateString();
    if (st.date !== today) { st.date = today; st.picks = 0; st.replies = 0; }
    st.picks += n; st.rem = rem; saveLS(LS.stats, st);
    refreshPanel();
    log('本轮捞取 ' + n + ' 次，剩余额度 ' + (rem === null ? '?' : rem));
  }

  async function matchOnce() {
    // 连续匹配：男的换下一个，女的打招呼后继续，直到关开关或连续超时
    for (let round = 0; round < 99999 && S.autoMatch; round++) {
      let ok = false;
      try {
        await api('/api/match/start', { method: 'POST', body: '{}' });
      } catch (e) { log('发起匹配失败：' + e.message); await sleep(3000); continue; }
      log('发起随机匹配（客户端只接女生）');

      const poll = Math.max(5, S.matchPoll || 30);
      for (let i = 0; i < poll && S.autoMatch; i++) {
        await sleep(1000);
        let st;
        try { st = (await api('/api/match/status')).data; } catch { continue; }
        if (!st) continue;
        const u = st.user;
        if (st.status !== 'matched' || !u) continue;
        ok = true;
        if (S.femaleOnly && u.gender !== 'female') {
          log('配到男号 ' + u.nickname + '，换下一个（冷却 ' + (S.matchGap || 8) + ' 秒）');
          await sleep(Math.max(2, S.matchGap || 8) * 1000);
          break;
        }
        const cid = await createConv(u.id);
        if (cid) {
          const msg = await greeting(u);
          try {
            await enqueueSend(() => hubSend(cid, msg));
            const isGirl = (u.gender === 'female');
            log('配到 ' + u.nickname + '(' + u.gender + '/' + u.age + ')：' + msg, isGirl);
            stMatched(u);
            if (isGirl) g4.evt('match', u.id);   // 只推配到女生
            pushStat(u.nickname, msg);
          } catch (e) { log('打招呼失败：' + e.message); }
        }
        await sleep(Math.max(2, S.matchGap || 8) * 1000);
        break;    // 女生处理完，继续下一轮
      }
      if (!ok) { log('这一轮没配到人（队列超时），30 秒后重试'); await sleep(30000); }
    }
  }

  // 匹配统计：总匹配次数 + 配到女生数
  function stMatched(u) {
    try {
      const st = loadLS(LS.stats, {});
      const today = new Date().toDateString();
      if (st.mDate !== today) { st.mDate = today; st.matched = 0; st.female = 0; }
      st.matched = (st.matched || 0) + 1;
      if (u && u.gender === 'female') st.female = (st.female || 0) + 1;
      saveLS(LS.stats, st);
    } catch (e) {}
  }

  // ---------- 面板 ----------
  function pushStat(name, text) {
    const stats = loadLS(LS.stats, {});
    const list = stats.recent || [];
    list.unshift({ t: new Date().toTimeString().slice(0, 5), n: name, x: text });
    stats.recent = list.slice(0, 12); saveLS(LS.stats, stats); refreshPanel();
  }

  function css() {
    if (document.getElementById('xy-style')) return;
    const s = document.createElement('style');
    s.id = 'xy-style';
    s.textContent = `
#xy-fab{position:fixed;right:14px;bottom:96px;z-index:99999;width:48px;height:48px;border-radius:50%;
 background:#2f6df6;color:#fff;border:0;font-size:19px;box-shadow:0 6px 18px rgba(0,0,0,.35)}
#xy-panel{position:fixed;right:10px;bottom:150px;z-index:99999;width:min(94vw,360px);max-height:70vh;overflow:auto;
 background:#151a24;color:#e6ebf5;border:1px solid #262d3c;border-radius:16px;font:13px/1.5 -apple-system,sans-serif;
 box-shadow:0 12px 30px rgba(0,0,0,.45);padding:12px 14px;display:none}
#xy-panel.show{display:block}
#xy-panel h3{position:sticky;top:-12px;z-index:9;background:#0f1420;margin:0 0 8px;padding:8px 0 8px;
  font-size:15px;color:#fff;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1b2231}
#xy-panel .x{background:#2a3040;border:0;color:#9aa3b7;width:26px;height:26px;border-radius:8px;font-size:15px}
.xy-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #212838}
.xy-row b{font-size:13px}
.xy-row span{display:block;color:#7d86a0;font-size:11px;margin-top:2px}
.xy-tg{position:relative;width:44px;height:24px;flex:0 0 44px}
.xy-tg input{display:none}
.xy-tg i{position:absolute;inset:0;background:#2a3040;border-radius:12px;transition:.18s}
.xy-tg i:after{content:"";position:absolute;left:3px;top:3px;width:18px;height:18px;background:#8d95ab;border-radius:50%;transition:.18s}
.xy-tg input:checked+i{background:#2f6df6}
.xy-tg input:checked+i:after{left:23px;background:#fff}
.xy-key{display:flex;gap:6px;margin:8px 0 4px}
.xy-key input{flex:1;min-width:0;background:#0f1319;border:1px solid #2a3040;color:#dfe5ef;border-radius:8px;padding:7px 9px;font-size:12px}
.xy-key button{background:#2f6df6;color:#fff;border:0;border-radius:8px;padding:0 12px;font-size:12px}
#xy-log{margin-top:8px;max-height:150px;overflow:auto;font:11px/1.55 ui-monospace,monospace;color:#8b94aa;
 background:#0f1319;border-radius:10px;padding:8px;white-space:pre-wrap}
.xy-stat{color:#7d86a0;font-size:11px;margin-top:6px}
.xy-health{color:#8b94aa;font-size:11px;margin-top:4px;line-height:1.6}
.xy-btns{display:flex;gap:6px;margin:8px 0 2px}
.xy-btns button{flex:1;background:#243049;color:#cfd7e6;border:1px solid #2f3d5c;border-radius:8px;padding:7px 0;font-size:12px}
#xy-panel .xy-setrow button{width:100%!important;background:#1b2333!important;color:#9aa3b7!important;border:1px solid #262d3c!important;border-radius:9px!important;padding:9px 0!important;font-size:12px!important;box-shadow:none!important;-webkit-appearance:none!important;appearance:none!important}
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
    fab.id = 'xy-fab'; fab.textContent = '🐶';
    const panel = document.createElement('div');
    panel.id = 'xy-panel';
    panel.innerHTML = `
      <h3>星缘托管 · 狗头军师<button class="x" id="xy-x">×</button></h3>
      <div class="xy-row"><div><b>自动回复</b><span>有未读就逐条接一句</span></div>
        <label class="xy-tg"><input type="checkbox" id="xy-r"><i></i></label></div>
      <div class="xy-row"><div><b>自动捞在线</b><span>只捞女生，捞到就打招呼</span></div>
        <label class="xy-tg"><input type="checkbox" id="xy-p"><i></i></label></div>
      <div class="xy-row"><div><b>自动随机匹配</b><span>只匹配女生，配到就打招呼</span></div>
        <label class="xy-tg"><input type="checkbox" id="xy-m"><i></i></label></div>
      <div class="xy-row"><div><b>只看女生</b><span>男号见面即换人，不再拉黑记名单</span></div>
        <label class="xy-tg"><input type="checkbox" id="xy-f"><i></i></label></div>
      <div class="xy-setrow"><button id="xy-setbtn">设置（间隔 · 模型 · Key）</button></div>
      <div id="xy-set" style="display:none">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:6px 0 2px">
          <label style="font-size:11px;color:#7d86a0">回复间隔(秒)<input id="xy-rv" type="number" min="5" style="width:100%;margin-top:3px;background:#0f1319;border:1px solid #2a3040;color:#dfe5ef;border-radius:8px;padding:6px 8px;font-size:12px"></label>
          <label style="font-size:11px;color:#7d86a0">捞人间隔(秒)<input id="xy-pk" type="number" min="10" style="width:100%;margin-top:3px;background:#0f1319;border:1px solid #2a3040;color:#dfe5ef;border-radius:8px;padding:6px 8px;font-size:12px"></label>
          <label style="font-size:11px;color:#7d86a0">匹配轮询(秒)<input id="xy-mw" type="number" min="5" style="width:100%;margin-top:3px;background:#0f1319;border:1px solid #2a3040;color:#dfe5ef;border-radius:8px;padding:6px 8px;font-size:12px"></label>
          <label style="font-size:11px;color:#7d86a0">换人冷却(秒)<input id="xy-mg" type="number" min="2" style="width:100%;margin-top:3px;background:#0f1319;border:1px solid #2a3040;color:#dfe5ef;border-radius:8px;padding:6px 8px;font-size:12px"></label>
        </div>
        <div class="xy-key"><input id="xy-k" type="password" placeholder="智谱 API Key（必填，只存本机）"><button id="xy-ks">存</button></div>
        <div class="xy-btns"><button id="xy-test">测试模型</button><button id="xy-run">立即跑一轮</button></div>
      </div>
      <div class="xy-stat" id="xy-stat"></div>
      <div class="xy-health" id="xy-health"></div>
      <div class="xy-health" id="xy-next"></div>
      <div id="xy-log"></div>
    `;
    panel.dataset.owner = UI.owner; fab.dataset.owner = UI.owner;
    document.body.appendChild(fab);
    document.body.appendChild(panel);
    initFabDrag(fab, 'xy_fab_pos');
    renderAll();
    fab.onclick = () => {
      if (fab.dataset.dragged) { delete fab.dataset.dragged; return; }
      panel.classList.toggle('show');
    };
    panel.querySelector('#xy-x').onclick = () => panel.classList.remove('show');
    panel.querySelector('#xy-setbtn').onclick = () => {
      const d = panel.querySelector('#xy-set');
      d.style.display = d.style.display === 'none' ? 'block' : 'none';
    };
    const bind = (id, key) => {
      const el = panel.querySelector(id);
      el.checked = !!S[key];
      el.onchange = () => {
        S[key] = el.checked; saveLS(LS.cfg, S);
        if (el.checked) {   // 打开就立刻跑一次，不用等定时器
          if (key === 'autoPick') { nextRun.pick = Date.now() + 1000; log('自动捞在线已开，马上开始'); }
          if (key === 'autoMatch') { nextRun.match = Date.now() + 1000; log('自动匹配已开，马上开始'); }
          if (key === 'autoReply') { nextRun.reply = Date.now() + 1000; }
        }
        tick();
      };
    };
    bind('#xy-r', 'autoReply'); bind('#xy-p', 'autoPick'); bind('#xy-m', 'autoMatch'); bind('#xy-f', 'femaleOnly');
    [['#xy-rv','replyEvery','回复间隔'],['#xy-pk','pickEvery','捞人间隔'],['#xy-mw','matchPoll','匹配轮询'],['#xy-mg','matchGap','换人冷却']]
      .forEach(([sel,key,name]) => {
        const el = panel.querySelector(sel);
        el.value = S[key];
        el.onchange = () => {
          const v = Math.max(2, parseInt(el.value, 10) || S[key]);
          S[key] = v; el.value = v; saveLS(LS.cfg, S); log(name + '设为 ' + v + ' 秒'); renderAll();
        };
      });
    const kIn = panel.querySelector('#xy-k');
    kIn.value = localStorage.getItem(LS.key) ? '••••••（已保存）' : '';
    kIn.onfocus = () => { if (kIn.value.startsWith('••')) kIn.value = ''; };
    panel.querySelector('#xy-test').onclick = () => { testModel(); };
    panel.querySelector('#xy-run').onclick = async () => {
      log('手动跑一轮…');
      try { await autoReplyOnce(); } catch (e) { log('回复异常：' + e.message); }
    };
    panel.querySelector('#xy-ks').onclick = () => {
      const v = kIn.value.trim();
      if (!v || v.startsWith('••')) {          // 留空或占位符：清掉自定义 key，回落内置默认
        localStorage.removeItem(LS.key);
        kIn.value = '';
        log('已恢复使用内置默认 Key');
        testModel(true);
        return;
      }
      localStorage.setItem(LS.key, v);
      kIn.value = '••••••（已保存）';
      log('API Key 已保存，正在测试…');
      testModel(true);
    };
  }

  const MODEL = { state: 'idle', at: 0, hint: '' };
  const UI = { owner: 'xy' + Math.random().toString(36).slice(2, 7), boot: 0, apiErr: '', ready: false };

  function health(state) {          // 兼容旧调用：只覆盖第一行
    const el = document.getElementById('xy-health');
    if (el) el.textContent = state;
  }

  function modelText() {
    if (MODEL.state === 'ok') return '模型 ✅';
    if (MODEL.state === 'testing') return '模型 …';
    if (MODEL.state === 'fail') return '模型 ❌' + (MODEL.hint ? '（' + MODEL.hint + '）' : '');
    return '模型 待测';
  }

  // 三行状态 + 日志框：任何一行都从当前内存变量直接渲染，不等接口
  function renderAll() {
    const h = document.getElementById('xy-health');
    const st = document.getElementById('xy-stat');
    const nx = document.getElementById('xy-next');
    if (!h || !st || !nx) return;
    if (!TOKEN()) {
      h.textContent = '❌ 未登录：先在站内登录（登录后自动接管）';
    } else {
      const d = loadLS(LS.stats, {});
      h.textContent = '✅ 在线｜未读 ' + (d.unread ?? '—') + '｜会话 ' + (d.convs ?? '—') + '｜' + modelText();
    }
    const d = loadLS(LS.stats, {});
    st.textContent = '今天：匹配 ' + (d.matched || 0) + ' · 女生 ' + (d.female || 0) + ' · 捞取 ' + (d.picks || 0) + ' 次 · 回复 ' + (d.replied || 0) + ' 条 · 剩余额度 ' + (d.rem ?? '—');
    const now = Date.now();
    nx.textContent = '下次：' + [
      S.autoReply ? '回复 ' + (busy.reply ? '执行中' : fmt(nextRun.reply - now)) : '回复 关',
      S.autoPick ? '捞人 ' + (busy.pick ? '执行中' : fmt(nextRun.pick - now)) : '捞人 关',
      S.autoMatch ? '匹配 ' + (busy.match ? '执行中' : fmt(nextRun.match - now)) : '匹配 关',
    ].join(' ｜ ');
  }

  async function selfCheck() {
    const t = TOKEN();
    if (!t) { health('❌ 未登录：先在站内登录'); return false; }
    if (typeof GM_xmlhttpRequest !== 'function') {
      health('⚠️ 当前不是油猴环境：模型请求会被浏览器跨域拦截');
    }
    return true;
  }

  async function testModel(silent) {
    MODEL.state = 'testing'; MODEL.hint = ''; renderAll();
    let t = '';
    try { t = await gen('只回复四个字：模型正常', 12); } catch (e) { t = ''; }
    if (!t && typeof GM_xmlhttpRequest !== 'function') MODEL.hint = '非油猴环境被CORS拦';
    MODEL.state = t ? 'ok' : 'fail'; MODEL.at = Date.now();
    const st = loadLS(LS.stats, {});
    st.model = !!t; saveLS(LS.stats, st);
    renderAll();
    if (!silent) log(MODEL.ok ? '模型测试通过：' + t.slice(0, 8) : '模型测试失败：检查 key / @connect');
    return MODEL.ok;
  }

  function refreshPanel() { renderAll(); }

  // 只有当前持有面板的实例才允许发请求，防止旧实例残留继续刷 400
  function ownsPanel() {
    const p = document.getElementById('xy-panel');
    return !!p && p.dataset.owner === UI.owner;
  }

  // ---------- 调度 ----------
  const nextRun = { reply: 0, pick: 0, match: 0, lastPick: 0, lastMatch: 0, lastReply: 0 };
  let busy = { reply: false, pick: false, match: false };
  let SETTINGS_WARNED = false;

  function fmt(ms) {
    if (ms <= 0) return '进行中';
    const s2 = Math.ceil(ms / 1000);
    return s2 >= 60 ? Math.floor(s2 / 60) + '分' + (s2 % 60) + '秒' : s2 + '秒';
  }

  function statusLine() { renderAll(); }

  function tick() { renderAll(); }

  async function runReply() {
    if (!S.autoReply || busy.reply || !TOKEN() || !ownsPanel()) return;
    busy.reply = true; tick();
    try { await autoReplyOnce(); } catch (e) { log('自动回复异常：' + e.message); }
    busy.reply = false;
    nextRun.reply = Date.now() + S.replyEvery * 1000;
    nextRun.lastReply = Date.now(); tick();
  }

  async function runPick() {
    if (!S.autoPick || busy.pick || !TOKEN() || !ownsPanel()) return;
    busy.pick = true; tick();
    try { await pickOnce(); } catch (e) { log('自动捞人异常：' + e.message); }
    busy.pick = false;
    nextRun.pick = Date.now() + S.pickEvery * 1000;
    nextRun.lastPick = Date.now(); tick();
  }

  async function runMatch() {
    if (!S.autoMatch || busy.match || !TOKEN() || !ownsPanel()) return;
    busy.match = true; tick();
    try { await matchOnce(); } catch (e) { log('自动匹配异常：' + e.message); }
    busy.match = false;
    nextRun.match = Date.now() + 3000;   // 匹配是连续循环，结束 3 秒后接上
    nextRun.lastMatch = Date.now(); tick();
  }

  // 面板自愈：旧实例/重复实例留下的死面板会被清掉重建
  function ensurePanel() {
    const ps = Array.from(document.querySelectorAll('#xy-panel'));
    const fabs = Array.from(document.querySelectorAll('#xy-fab'));
    if (ps.length === 1 && ps[0].dataset.owner === UI.owner && fabs.length === 1) return;
    ps.forEach(e => e.remove());
    fabs.forEach(e => e.remove());
    buildPanel();
  }

  async function refreshFromApi() {
    if (!ownsPanel()) return;
    if (!TOKEN()) { UI.apiErr = ''; renderAll(); return; }
    try {
      const convs = await getConvs();
      const st = loadLS(LS.stats, {});
      st.unread = convs.filter(c => c.unread > 0).length;
      st.convs = convs.length;
      saveLS(LS.stats, st);
      UI.apiErr = '';
    } catch (e) { UI.apiErr = e.message; }
    renderAll();
  }

  function start() {
    const myBoot = (window.__xyBoot = (window.__xyBoot || 0) + 1);
    const alive = () => window.__xyBoot === myBoot;
    try { ensurePanel(); } catch (e) { console.error('[星缘助手] 面板构建失败', e); }
    log('助手已启动（' + (TOKEN() ? '已登录' : '未登录') + '）');
    renderAll();
    try { selfCheck(); } catch (_) {}
    refreshFromApi();                       // 立刻拉一次未读/会话，不等 30 秒
    setTimeout(() => { if (alive()) testModel(true); }, 1500);

    const boot = Date.now();
    nextRun.reply = boot + 3000;
    nextRun.pick = boot + 5000;
    nextRun.match = boot + 8000;

    setInterval(() => {
      if (!alive()) return;
      try { ensurePanel(); } catch (_) {}
      try {
        const now = Date.now();
        if (now >= nextRun.reply) runReply();
        if (now >= nextRun.pick) runPick();
        if (now >= nextRun.match) runMatch();
      } catch (e) { console.error('[星缘助手] 调度异常', e); }
    }, 1000);

    // 面板文字不用每秒重写：2 秒一次足够，减少滚动/重排
    setInterval(() => { if (alive()) { try { renderAll(); } catch (_) {} } }, 2000);

    setInterval(() => {
      if (!alive()) return;
      try { refreshFromApi(); } catch (_) {}
    }, 30000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
