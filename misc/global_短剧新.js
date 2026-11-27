// ==UserScript==
// @name         短剧干净播放器V5.0
// @namespace    http://tampermonkey.net/
// @version      8.7
// @description  干净播放器（多站点可配置模板）：卡片直达开播 + 追剧库 + 站点配置切换/编辑。原站为默认配置，新站用 live 模式读 blob 播放；v8.7 关闭面板归还视频元素；新增妈妈短剧（mamaduanju.com）：按 .vslot 槽位取在播源、金币集灰显跳过、真实选择器校正。
// @author       You
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @require      https://cdn.jsdelivr.net/npm/dplayer@1.27.1/dist/DPlayer.min.js
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_VERSION = '8.7';
    const TRACK_KEY = 'sdTrackData_v1';   // 沿用旧版追剧数据，升级不丢
    const SITES_KEY = 'sdSitesV8';        // 用户编辑后的站点配置（覆盖内置）
    const ACTIVE_KEY = 'sdActiveSite';    // 当前激活站点 id

    const cssLink = document.createElement('link');
    cssLink.rel = 'stylesheet';
    cssLink.href = 'https://cdn.jsdelivr.net/npm/dplayer@1.27.1/dist/DPlayer.min.css';
    document.head.appendChild(cssLink);

    // ===== 内置站点配置（默认；可被 GM 覆盖编辑）=====
    // 规则引擎语法（applyRules）：path:正则 | attr:选择器@属性[::jsonKey 或 ::正则] |
    //   sel:选择器 | jsonld:Type.字段 | regex:模式 | count:选择器 ；多规则用 | 取首个非空
    const SITES_DEFAULT = [
        {
            id: 'origin', name: '原站', hosts: [],
            card: { selector: '.hg-drama-card', titleSel: '.hg-drama-card__title', idFrom: 'href:/video/(\\d+)' },
            play: {
                mode: 'fetch',                       // 取静态HTML拿 m3u8 → DPlayer
                pathTest: '/video/(\\d+)(?:/ep-(\\d+))?',
                urlTpl: '/video/{id}/',
                epTpl: '/video/{id}/ep-{ep}/',
                rules: {
                    videoId:   'path:/video/(\\d+)',
                    currentEp: 'path:/video/\\d+/ep-(\\d+)',
                    totalEp:   'attr:body@data-history::total | count:.hg-play__ep-item',
                    title:     'attr:body@data-history::title',
                    desc:      'attr:body@data-history::desc | sel:.hg-play__panel-desc',
                    m3u8:      'attr:article.hg-play__slide@data-play-src | jsonld:VideoObject.contentUrl | regex:https?:[^"\'<>]+\\.m3u8',
                    cover:     'attr:body@data-history::cover | jsonld:VideoObject.thumbnailUrl'
                }
            }
        },
        {
            id: 'newdrama', name: '新站', hosts: [],
            card: { selector: 'a.block[href^="/drama/detail/"]', titleSel: '', idFrom: 'href:/drama/detail/(\\d+)' },
            play: {
                mode: 'live',                        // 真跳播放页，读实时DOM里的 video/blob → 原生video播
                pathTest: '/drama/video/(\\d+)(?:/ep-(\\d+))?',
                urlTpl: '/drama/video/{id}/',
                epTpl: '/drama/video/{id}/ep-{ep}/',
                videoSel: '.dplayer-video',          // 播放页 <video> 选择器
                dpSel: '.dplayer',                   // 带 data-* 元数据的 DPlayer 外层
                // 选集：按 href 模式收集当前剧的集（不依赖容器 class，跨站通用）
                epHrefTest: '/drama/video/(\\d+)(?:/ep-(\\d+))?',
                // 总集数：从「选集 全N集」按钮文本提取（比收集折叠网格更稳）
                totalEpText: '选集\\s*全(\\d+)集',
                // 简介段落：取含 #标签 的那个 <p> 最后一个非标签 span（跳过「当前集数」）
                descSel: 'p',
                descTagClass: 'text-main',
                rules: {
                    videoId:   'attr:.dplayer@data-video_type_id',
                    epId:      'attr:.dplayer@data-video_id',
                    title:     'attr:.dplayer@data-video_title',
                    dramaName: 'attr:.dplayer@data-video_type_name',
                    tags:      'attr:.dplayer@data-video_tag_name',
                    currentEp: 'path:/drama/video/\\d+/ep-(\\d+)'
                }
            }
        },
        {
            // 妈妈短剧 mamaduanju.com：Vue SPA，剧集用拼音 slug（/drama/{slug}/ep-{n}）
            // 播放页 .track 里有 3 个 .vslot 视频槽（未用的带 off 类），取在播那个，见 pickLiveVideo
            // 付费集：<a class="ep locked"> + 48金币徽标，脚本只跟免费集，锁集点一下只提示不跳转
            id: 'mamaduanju', name: '妈妈短剧', hosts: ['mamaduanju.com'],
            card: {
                selector: 'a[href*="/drama/"]',        // 主列表 .home-mobile-card / 轮播 .home-hero-slide / 选集
                titleSel: '.home-card-title',          // 主列表卡标题；轮播卡取 title 属性兜底
                idFrom: 'href:/drama/([a-z0-9][a-z0-9-]*)(?:/ep-(\\d+))?'
            },
            play: {
                mode: 'live',
                pathTest: '/drama/([^/]+)/ep-(\\d+)',
                urlTpl: '/drama/{id}/ep-1',
                epTpl: '/drama/{id}/ep-{ep}',
                videoSel: 'video',
                epHrefTest: '/drama/([^/]+)/ep-(\\d+)',
                lockTest: 'locked|金币|解锁',
                descSel: 'p.prose',                    // 页面正文简介段
                rules: {
                    videoId:   'path:/drama/([^/]+)/ep-',
                    currentEp: 'path:/ep-(\\d+)',
                    title:     'sel:h1'                 // <h1>白蛇淫起 <span>第 1 集</span></h1>
                }
            }
        }
    ];

    // ===== 配置加载（内置 → GM 覆盖）=====
    let sites = SITES_DEFAULT.map(function(s){ return JSON.parse(JSON.stringify(s)); });
    try {
        const raw = GM_getValue(SITES_KEY, null);
        if (Array.isArray(raw) && raw.length) {
            sites = raw;
            // 旧配置只存了自己编辑过的条目：内置新增站点（如妈妈短剧）自动补进来，不覆盖用户改动
            const have = {};
            sites.forEach(function(s){ if (s && s.id) have[s.id] = 1; });
            SITES_DEFAULT.forEach(function(d){
                if (!have[d.id]) sites.push(JSON.parse(JSON.stringify(d)));
            });
        }
    } catch(e){}
    let activeSiteId = 'origin';
    try { const a = GM_getValue(ACTIVE_KEY, null); if (a) activeSiteId = a; } catch(e){}

    // 按当前页面自动识别该用哪套站点配置（host → 播放页路径 → 卡片命中）
    // 这样即使没在设置里手动切站、hosts 为空、或跨子域名，新站页面也会自动用 newdrama，
    // 避免「忘了切站 → 用原站配置在新站 DOM 上取不到 totalEp/desc」的问题。
    function autoDetectSite(){
        // 1) host 归属（配了 hosts 的优先）
        for (let i = 0; i < sites.length; i++){
            const hs = sites[i].hosts || [];
            if (hs.indexOf(location.hostname) >= 0) return sites[i];
        }
        // 2) 播放页路径命中 pathTest：取「最靠左（最具体）」的匹配，避免宽松的 pathTest 抢先
        //    （例：原站 /video/(\d+)/ 会在 /drama/video/3307/ 上误匹配，必须让 /drama/video/ 胜出）
        let best = null, bestIdx = Infinity;
        for (let i = 0; i < sites.length; i++){
            const pt = sites[i].play && sites[i].play.pathTest;
            if (!pt) continue;
            try {
                const m = location.pathname.match(new RegExp(pt));
                if (m && m.index < bestIdx){ bestIdx = m.index; best = sites[i]; }
            } catch(e){}
        }
        if (best) return best;
        // 3) 列表/详情页：卡片选择器命中且能取到 id
        if (typeof document !== 'undefined' && document.querySelector){
            for (let i = 0; i < sites.length; i++){
                // 声明了 hosts 的站点只在自家域名上参与兜底识别，避免宽松选择器串站
                const hs = sites[i].hosts || [];
                if (hs.length && !hs.some(function(h){ return location.hostname.indexOf(h) >= 0; })) continue;
                const cs = sites[i].card && sites[i].card.selector;
                if (cs){ try { const el = document.querySelector(cs); if (el && cardIdFrom(el, sites[i])) return sites[i]; } catch(e){} }
            }
        }
        return null;
    }
    function getActiveSite(){
        const det = autoDetectSite();
        if (det) return det;
        for (let i = 0; i < sites.length; i++) if (sites[i].id === activeSiteId) return sites[i];
        return sites[0];
    }
    function siteById(id){
        for (let i = 0; i < sites.length; i++) if (sites[i].id === id) return sites[i];
        return getActiveSite();
    }
    function setActiveSite(id){ activeSiteId = id; try { GM_setValue(ACTIVE_KEY, id); } catch(e){} }
    function saveSites(){ try { GM_setValue(SITES_KEY, sites); } catch(e){} }
    function resetSites(){
        sites = SITES_DEFAULT.map(function(s){ return JSON.parse(JSON.stringify(s)); });
        saveSites();
    }

    // 全局开关（不随站点变）
    const cfg = { directPlay: true };
    try {
        const raw = GM_getValue('sdCfgV7', null);
        if (raw && typeof raw === 'object' && typeof raw.directPlay === 'boolean') cfg.directPlay = raw.directPlay;
    } catch(e){}
    function saveCfg(){ try { GM_setValue('sdCfgV7', cfg); } catch(e){} }

    GM_addStyle(`
/* ===== 悬浮球 ===== */
#sdFloatBtn{
    position:fixed;width:46px;height:46px;border-radius:50%;
    background:#e74c3c;color:#fff;font-size:20px;text-align:center;line-height:46px;
    cursor:move;z-index:2147483647!important;user-select:none;box-shadow:0 2px 8px rgba(0,0,0,0.4);
    border:none!important;margin:0!important;padding:0!important;
    touch-action:none;will-change:transform;
}
#sdFloatBtn:active{opacity:0.8;}
#sdBadge{
    position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;line-height:18px;
    background:#ffca28;color:#222;border-radius:9px;font-size:11px;font-weight:bold;
    padding:0 5px;box-sizing:border-box;display:none;pointer-events:none;
}
#sdBadge.show{display:block;}

/* ===== 播放器 ===== */
#sdPanel,#sdTrackPanel,#sdSetPanel{
    position:fixed;inset:0;background:#0a0a0a;z-index:2147483647!important;display:none;flex-direction:column;
}
#sdSetPanel.show{display:flex;}
.sd-topbar{
    background:#1a1a1a;padding:10px 14px;display:flex;align-items:center;gap:8px;flex-shrink:0;
}
.sd-ep-tag{color:#e74c3c;font-size:15px;font-weight:bold;white-space:nowrap;}
.sd-drama-name{color:#fff;font-size:15px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sd-total-ep{color:#888;font-size:12px;white-space:nowrap;}
.sd-close{
    background:#e74c3c;color:#fff;border:none;border-radius:20px;padding:6px 16px;
    cursor:pointer;font-size:13px;white-space:nowrap;
}
.sd-content{flex:1;overflow-y:auto;}
.sd-player-wrap{width:100%;background:#000;position:relative;}
.sd-player-wrap .dplayer{width:100%!important;}
.sd-player-wrap video{width:100%!important;height:100%!important;background:#000;display:block;}
.sd-loading{
    color:#888;text-align:center;display:flex;align-items:center;justify-content:center;
    min-height:200px;font-size:14px;
}
/* 工具栏：5 个按钮等宽一行（不换行，小屏也不会把按钮挤出屏幕） */
.sd-toolbar{display:flex;gap:6px;padding:10px 8px;align-items:center;flex-wrap:nowrap;}
.sd-tool-btn{
    background:#333;color:#fff;border:none;border-radius:20px;padding:8px 4px;
    cursor:pointer;font-size:13px;white-space:nowrap;flex:1;min-width:0;
}
.sd-tool-btn:disabled{opacity:0.3;cursor:not-allowed;}
/* 简介：文字 + 右侧「追」圆角卡片（同一行） */
.sd-desc-box{
    display:none;background:#1a1a1a;margin:0 14px;padding:12px;border-radius:12px;
    color:#bbb;font-size:13px;line-height:1.6;
}
.sd-desc-box.show{display:flex;align-items:flex-start;gap:10px;}
.sd-desc-text{flex:1;min-width:0;white-space:pre-wrap;word-break:break-word;}
.sd-follow-chip{
    flex-shrink:0;background:#2a2a2a;color:#ddd;border:none;border-radius:14px;
    padding:5px 13px;font-size:13px;cursor:pointer;white-space:nowrap;line-height:1.5;
}
.sd-follow-chip.on{background:#e74c3c;color:#fff;font-weight:bold;}
.sd-ep-section{display:none;padding:10px 14px 20px;}
.sd-ep-section.show{display:block;}
.sd-ep-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(46px,1fr));gap:6px;}
.sd-ep-item{
    background:#222;color:#ccc;border:none;border-radius:10px;padding:10px 0;
    cursor:pointer;font-size:13px;text-align:center;
}
.sd-ep-item.active{background:#e74c3c;color:#fff;font-weight:bold;}
.sd-ep-item.locked{opacity:.5;background:#1a1a1a;color:#888;text-decoration:line-through;}
.sd-ep-pager{display:flex;gap:8px;justify-content:center;align-items:center;padding:14px 0 0;}

/* ===== 追剧库（界面照「追剧列表效果预览.html」）===== */
.sd-track-top{
    background:#1a1a1a;padding:12px 14px;display:flex;align-items:center;gap:8px;flex-shrink:0;
}
.sd-track-title{color:#fff;font-size:16px;font-weight:bold;flex:1;white-space:nowrap;}
.sd-track-title b{color:#e74c3c;font-size:13px;font-weight:normal;}
.sd-mini-btn{
    background:#2a2a2a;color:#ddd;border:none;border-radius:16px;padding:6px 12px;
    font-size:12px;cursor:pointer;white-space:nowrap;
}
.sd-track-tip{display:none;color:#888;font-size:12px;padding:8px 14px;background:#141414;}
.sd-track-tip.show{display:block;}
.sd-track-body{flex:1;overflow-y:auto;padding:12px;}
.sd-track-item{
    display:block;background:#161616;border-radius:12px;padding:10px 12px;margin-bottom:8px;
}
.sd-track-main{min-width:0;display:flex;flex-direction:column;gap:4px;}
.sd-track-row1{display:flex;align-items:center;gap:6px;}
.sd-track-name{
    display:block;color:#fff;font-size:14px;font-weight:bold;flex:1;min-width:0;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.sd-badge{display:block;font-size:11px;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0;}
.sd-badge.new{background:#e74c3c;color:#fff;font-weight:bold;}
.sd-badge.none{background:#2a2a2a;color:#999;}
.sd-badge.wait{background:#2a2a2a;color:#777;}
.sd-track-meta{display:block;color:#ffca28;font-size:12px;line-height:1.4;}
.sd-track-sub{display:block;color:#888;font-size:12px;line-height:1.4;}
.sd-track-ops{display:flex;gap:8px;margin-top:9px;}
.sd-ico-btn{
    border:none;background:#333;color:#aaa;border-radius:10px;padding:5px 16px;
    font-size:12px;line-height:1.4;cursor:pointer;white-space:nowrap;
}
.sd-ico-btn.play{background:#e74c3c;color:#fff;}
.sd-ico-btn.seen{background:#ffca28;color:#222;}
.sd-empty{color:#666;text-align:center;padding:40px 16px;font-size:13px;line-height:1.9;}
.sd-track-foot{color:#666;font-size:12px;text-align:center;line-height:1.8;padding:6px 0 16px;}

/* ===== 设置（追剧数据导入导出 + 站点配置）===== */
.sd-set-top{background:#1a1a1a;padding:12px 14px;display:flex;align-items:center;gap:8px;flex-shrink:0;}
.sd-set-title{color:#fff;font-size:16px;font-weight:bold;flex:1;}
.sd-set-body{flex:1;overflow-y:auto;padding:14px;}
.sd-set-block{background:#161616;border-radius:12px;padding:12px;margin-bottom:12px;}
.sd-set-label{color:#aaa;font-size:13px;margin-bottom:9px;}
.sd-set-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
.sd-set-row:last-child{margin-bottom:0;}
.sd-set-btn{
    background:#2a2a2a;color:#ddd;border:none;border-radius:10px;padding:8px 15px;
    font-size:13px;cursor:pointer;white-space:nowrap;
}
.sd-set-btn.primary{background:#e74c3c;color:#fff;font-weight:bold;}
.sd-set-btn.danger{background:#3a2222;color:#ff8a80;}
.sd-set-area{
    width:100%;height:150px;background:#0d0d0d;color:#ccc;border:1px solid #2a2a2a;
    border-radius:10px;padding:10px;font-size:12px;box-sizing:border-box;
    font-family:monospace;line-height:1.5;resize:vertical;display:none;
}
.sd-set-area.show{display:block;}
.sd-set-select{background:#0d0d0d;color:#ddd;border:1px solid #2a2a2a;border-radius:10px;padding:8px 12px;font-size:13px;max-width:100%;box-sizing:border-box;}
.sd-set-info{color:#888;font-size:12px;padding:2px 0 10px;}
.sd-set-switch{
    background:#2a2a2a;color:#ddd;border:none;border-radius:16px;padding:7px 16px;
    font-size:13px;cursor:pointer;white-space:nowrap;
}
.sd-set-switch.on{background:#e74c3c;color:#fff;font-weight:bold;}

/* ===== 提示条 ===== */
#sdToast{
    position:fixed;left:50%;bottom:90px;transform:translateX(-50%);
    background:rgba(0,0,0,.88);color:#fff;padding:9px 18px;border-radius:20px;
    font-size:13px;z-index:2147483647!important;opacity:0;pointer-events:none;
    transition:opacity .2s;max-width:80%;text-align:center;
}
#sdToast.show{opacity:1;}
`);

    function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
    function pad(n){ return n < 10 ? '0' + n : '' + n; }
    function fmtTime(ts){
        if (!ts) return '';
        const d = new Date(ts);
        return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) +
               ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    function parseTime(v){
        if (!v) return 0;
        if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
        const m = String(v).match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[\sT](\d{1,2}):(\d{1,2}))?/);
        if (m) return new Date(+m[1], +m[2]-1, +m[3], +(m[4]||0), +(m[5]||0)).getTime();
        return 0;
    }
    function esc(s){
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ===== 提示条 =====
    const toastEl = document.createElement('div');
    toastEl.id = 'sdToast';
    document.body.appendChild(toastEl);
    let toastTimer = null;
    function toast(msg){
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(()=>toastEl.classList.remove('show'), 1800);
    }

    // ===== 规则引擎 =====
    function pathnameOf(url){
        try { return new URL(url).pathname; } catch(e){ return url; }
    }
    function pickJson(obj, path){
        if (obj == null) return '';
        if (!path) return obj;
        const parts = String(path).split('.');
        let cur = obj;
        for (let i = 0; i < parts.length; i++){
            if (cur == null) return '';
            cur = cur[parts[i]];
        }
        if (cur == null) return '';
        return typeof cur === 'string' ? cur : (typeof cur === 'number' ? String(cur) : JSON.stringify(cur));
    }
    function rulePath(regexStr, pathname){
        try { const m = pathname.match(new RegExp(regexStr)); return m ? (m[1] != null ? m[1] : m[0]) : ''; }
        catch(e){ return ''; }
    }
    function ruleAttr(spec, doc){
        const at = spec.indexOf('@');
        if (at < 0) return '';
        const sel = spec.slice(0, at);
        let rest = spec.slice(at + 1);
        const dpos = rest.indexOf('::');
        let attrName = rest, post = '';
        if (dpos >= 0){ attrName = rest.slice(0, dpos); post = rest.slice(dpos + 2); }
        let el;
        try { el = doc.querySelector(sel); } catch(e){ return ''; }
        if (!el) return '';
        const raw = el.getAttribute(attrName) || '';
        if (!raw) return '';
        if (!post) return raw;
        if (post.indexOf('(') >= 0){            // ::正则 → 对原字符串取捕获组
            try { const m = raw.match(new RegExp(post)); return m ? (m[1] != null ? m[1] : m[0]) : ''; }
            catch(e){ return ''; }
        }
        try { const obj = JSON.parse(raw); return pickJson(obj, post); } catch(e){ return ''; }
    }
    function ruleSel(sel, doc){
        try { const el = doc.querySelector(sel); return el ? el.textContent.trim() : ''; }
        catch(e){ return ''; }
    }
    function ruleJsonld(spec, doc){
        const dot = spec.indexOf('.');
        if (dot < 0) return '';
        const type = spec.slice(0, dot), field = spec.slice(dot + 1);
        let scripts;
        try { scripts = doc.querySelectorAll('script[type="application/ld+json"]'); } catch(e){ return ''; }
        for (let i = 0; i < scripts.length; i++){
            try {
                const data = JSON.parse(scripts[i].textContent);
                const graph = data['@graph'] || [data];
                for (let j = 0; j < graph.length; j++){
                    if (graph[j]['@type'] === type){
                        let v = graph[j][field];
                        if (Array.isArray(v)) v = v[0];
                        return v ? String(v) : '';
                    }
                }
            } catch(e){}
        }
        return '';
    }
    function ruleRegex(pat, doc){
        let html = '';
        try { html = (doc.documentElement ? doc.documentElement.outerHTML : (doc.body ? doc.body.outerHTML : '')); }
        catch(e){}
        try { const m = html.match(new RegExp(pat)); return m ? m[0].replace(/&amp;/g, '&') : ''; }
        catch(e){ return ''; }
    }
    function ruleCount(sel, doc){
        if (!sel) return '';
        try { return String(doc.querySelectorAll(sel).length); }
        catch(e){ return ''; }
    }
    function evalRule(expr, doc, pathname){
        const parts = String(expr).split('|');
        for (let i = 0; i < parts.length; i++){
            const p = parts[i].trim();
            if (!p) continue;
            let v = '';
            if (p.indexOf('path:') === 0) v = rulePath(p.slice(5), pathname);
            else if (p.indexOf('attr:') === 0) v = ruleAttr(p.slice(5), doc);
            else if (p.indexOf('sel:') === 0) v = ruleSel(p.slice(4), doc);
            else if (p.indexOf('jsonld:') === 0) v = ruleJsonld(p.slice(7), doc);
            else if (p.indexOf('regex:') === 0) v = ruleRegex(p.slice(6), doc);
            else if (p.indexOf('count:') === 0) v = ruleCount(p.slice(6), doc);
            if (v !== '' && v != null) return v;
        }
        return '';
    }
    function applyRules(doc, rules, ctx){
        ctx = ctx || {};
        const pathname = pathnameOf(ctx.url || (typeof location !== 'undefined' ? location.href : ''));
        const out = {};
        for (const key in rules){
            if (!Object.prototype.hasOwnProperty.call(rules, key)) continue;
            out[key] = evalRule(rules[key], doc, pathname);
        }
        return out;
    }

    function fillTpl(tpl, id, ep){
        return String(tpl).replace('{id}', id).replace('{ep}', ep);
    }
    function epUrl(site, id, ep){
        if (!ep || ep <= 1) return fillTpl(site.play.urlTpl, id, 1);
        return fillTpl(site.play.epTpl, id, ep);
    }

    // live 站点常有多个 <video>（预载 / 备用槽 / 广告层），取「真正在播的那个」
    // 妈妈短剧是 .vslot 槽位轮换：未用的槽带 off 类，先排除 off，再按未暂停 > 面积最大
    function pickLiveVideo(sel){
        let list = [];
        try { list = Array.prototype.slice.call(document.querySelectorAll(sel || 'video')); } catch(e){ list = []; }
        if (!list.length) return null;
        const isBlob = function(v){ return v && v.src && String(v.src).indexOf('blob:') === 0; };
        const blobs = list.filter(function(v){ return isBlob(v); });
        const pool = blobs.length ? blobs : list;
        const hasOff = function(v){
            const c = String((v && v.className) || '');
            return /(^|\s)off(\s|$)/.test(c);
        };
        const live = pool.filter(function(v){ return !hasOff(v); });
        const use = live.length ? live : pool;
        let playing = null, biggest = null, biggestArea = -1;
        for (let i = 0; i < use.length; i++){
            const v = use[i];
            if (!playing && !v.paused && v.readyState > 0) playing = v;
            const area = (v.clientWidth || 0) * (v.clientHeight || 0);
            if (area >= biggestArea){ biggestArea = area; biggest = v; }
        }
        return playing || biggest || use[0];
    }
    // 标题兜底：站点把剧名放在 <title> 里（「剧名 第N集 - 站名」），规则取不到时从这里拆
    function docTitleClean(){
        let t = '';
        try { t = String(document.title || ''); } catch(e){ t = ''; }
        t = t.replace(/\s*[-|｜·]\s*[^-|｜·]{1,20}$/,'').trim();       // 去尾部站名
        t = t.replace(/\s*第\s*\d+\s*集(?:全集)?\s*$/,'').trim();        // 去尾部「第 N 集」
        return t;
    }

    // ===== 播放页解析（当前页 / live）=====
    function parseCurrentPage() {
        const site = getActiveSite();
        const play = site.play;
        let m;
        try { m = location.pathname.match(new RegExp(play.pathTest)); } catch(e){ return null; }
        if (!m) return null;

        const r = applyRules(document, play.rules, {url: location.href});
        let videoId = r.videoId || m[1];
        let currentEp = r.currentEp ? parseInt(r.currentEp) : (m[2] ? parseInt(m[2]) : 1);
        let totalEp = r.totalEp ? parseInt(r.totalEp) : 0;
        let blobSrc = '';
        let epList = null;
        let desc = r.desc || '';

        if (play.mode === 'live') {
            // 取实时 <video> 的 blob 地址（必须同页）；多 video 站点取在播的那个
            try {
                const v = pickLiveVideo(play.videoSel || '.dplayer-video');
                if (v && v.src && String(v.src).indexOf('blob:') === 0) blobSrc = v.src;
            } catch(e){}
            // 选集：按 href 模式收集当前剧的集（不依赖容器 class，跨站通用）
            if (play.epHrefTest) {
                try {
                    const re = new RegExp(play.epHrefTest);
                    let lockExp = null;
                    if (play.lockTest) { try { lockExp = new RegExp(play.lockTest); } catch(e){ lockExp = null; } }
                    const links = document.querySelectorAll('a[href]');
                    const seenIdx = {};
                    epList = [];
                    for (let i = 0; i < links.length; i++){
                        const href = links[i].getAttribute('href') || links[i].href || '';
                        const mm = href.match(re);
                        if (!mm) continue;
                        if (mm[1] !== String(videoId)) continue;   // 只取当前剧
                        const ep = mm[2] ? parseInt(mm[2]) : 1;
                        const epText = (links[i].textContent || '').replace(/\s+/g, ' ').trim();
                        // 集号优先级：显式的 .episode-number > href 里的 ep 号 > 文本开头数字
                        // （妈妈短剧锁定集 textContent 是「248金币」，直接捞首位数字会得到 248，必须避开）
                        let useEp = 0;
                        const numEl = links[i].querySelector ? links[i].querySelector('.episode-number') : null;
                        if (numEl) {
                            const n = parseInt(String(numEl.textContent || '').replace(/[^\d]/g, ''));
                            if (n > 0 && n <= 9999) useEp = n;
                        }
                        if (!useEp && mm[2]) useEp = parseInt(mm[2]);
                        if (!useEp) {
                            const lead = epText.match(/^(\d{1,4})(?![0-9])/);
                            if (lead) useEp = parseInt(lead[1]);
                        }
                        if (!useEp) useEp = 1;
                        // 付费/锁定集：class（ep locked）或文本（2 金币 / 48金币 / 解锁）命中即标记
                        const cls = String(links[i].className || '');
                        const locked = !!lockExp && (lockExp.test(cls) || lockExp.test(epText));
                        // 同一集号可能同时命中「下一集 ›」按钮和真正的选集节点：优先保留带 ep 类的那个
                        const pr = /(^|\s)ep(\s|$)/.test(cls) ? 0 : 1;
                        if (seenIdx[useEp] !== undefined) {
                            const at = seenIdx[useEp];
                            if (pr < epList[at]._pr) epList[at] = { ep: useEp, href: href, locked: locked, _pr: pr };
                            continue;
                        }
                        seenIdx[useEp] = epList.length;
                        epList.push({ ep: useEp, href: href, locked: locked, _pr: pr });
                    }
                    epList.sort(function(a,b){ return a.ep - b.ep; });
                    epList.forEach(function(o){ delete o._pr; });
                } catch(e){ epList = null; }
            }
            // 总集数：优先从「选集 全N集」按钮文本提取（比收集折叠的选集网格更稳）
            if (play.totalEpText) {
                try {
                    const re = new RegExp(play.totalEpText);
                    const btns = document.querySelectorAll('button');
                    for (let i = 0; i < btns.length; i++){
                        const t = (btns[i].textContent || '').replace(/\s+/g, ' ');
                        const mm = t.match(re);
                        if (mm) { const n = parseInt(mm[1]); if (n > 0) { totalEp = n; break; } }
                    }
                } catch(e){}
            }
            // 简介：取含 #标签(text-main) 的那个 <p> 里，最后一个非标签 span 的文本
            //       （第一个非标签 span 是「当前集数」，自然被跳过；简介总在最后）
            if (play.descSel) {
                try {
                    const ps = document.querySelectorAll(play.descSel);
                    let p = null;
                    const tagCls = (play.descTagClass || 'text-main').replace(/^\./, '');
                    for (let i = 0; i < ps.length; i++){
                        if (ps[i].querySelector('.' + tagCls)) p = ps[i];  // 含标签段的 p
                    }
                    if (!p && ps.length) p = ps[ps.length - 1];
                    if (p) {
                        const spans = p.querySelectorAll('span');
                        let last = null;
                        for (let i = 0; i < spans.length; i++){
                            const s = spans[i];
                            if (play.descTagClass && s.classList.contains(play.descTagClass)) continue;
                            last = (s.textContent || '').trim();
                        }
                        desc = last || p.textContent.trim();
                    }
                } catch(e){}
            }
        }

        totalEp = totalEp || (epList ? epList.length : 0) || currentEp;
        const title = r.title || docTitleClean();
        const dramaName = (r.dramaName || title || '').replace(/\s*第\s*\d+\s*集\s*$/, '');
        let cover = r.cover || '';
        if (cover && !/^https?:/.test(cover)) cover = location.origin + cover;
        return {
            videoId: videoId, currentEp: currentEp, totalEp: totalEp,
            m3u8: r.m3u8 || '', title: title, dramaName: dramaName,
            cover: cover, desc: desc, tags: r.tags || '',
            blob: blobSrc, mode: play.mode, epList: epList
        };
    }

    // 解析任意视频页 HTML（切集 / 更新检查 fetch 用，仅 fetch 模式）
    function updateTextFromHtml(html){
        try {
            let mm = html.match(/(?:更新时间|更新于|更新至|最后更新)[^<>{}]{0,30}?((?:20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})|(?:\d+\s*(?:分钟|小时|天|周)前))/);
            if (mm) return mm[1].trim();
            mm = html.match(/(20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})/);
            if (mm) return mm[1];
        } catch(e){}
        return '';
    }
    function parseVideoHtml(html, ctx){
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const site = getActiveSite();
        const r = applyRules(doc, site.play.rules, ctx);
        let videoId = r.videoId || (ctx && ctx.videoId) || '';
        let currentEp = r.currentEp ? parseInt(r.currentEp) : ((ctx && ctx.ep) || 1);
        let totalEp = r.totalEp ? parseInt(r.totalEp) : 0;
        let cover = r.cover || '';
        let origin = (ctx && ctx.origin) || '';
        if (!origin) {
            try { origin = new URL(ctx && ctx.url || (typeof location !== 'undefined' ? location.href : '')).origin; }
            catch(e){ origin = (typeof location !== 'undefined' ? location.origin : ''); }
        }
        if (cover && !/^https?:/.test(cover)) cover = origin + cover;
        const dramaName = (r.dramaName || r.title || '').replace(/\s*第\d+集\s*$/, '');
        return {
            m3u8: r.m3u8 || '', title: r.title || '', cover: cover, videoId: videoId,
            currentEp: currentEp, totalEp: totalEp, desc: r.desc || '',
            dramaName: dramaName, tags: r.tags || '',
            updateText: updateTextFromHtml(html), mode: site.play.mode
        };
    }

    async function fetchEp(videoId, ep, href, site) {
        site = site || getActiveSite();
        const url = href || epUrl(site, videoId, ep);
        const r = await fetch(url, {credentials: 'include'});
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
        const html = await r.text();
        const data = parseVideoHtml(html, {url: url, videoId: videoId, ep: ep,
            origin: typeof location !== 'undefined' ? location.origin : ''});
        if (!data.m3u8) {
            const tm = html.match(/<title>([\s\S]*?)<\/title>/);
            const pageTitle = tm ? tm[1].trim().slice(0, 60) : '(无标题)';
            const m3u8Hit = html.match(/https?:[^"'\s<>]+\.m3u8[^"'\s<>]*/);
            throw new Error('未找到视频地址 [' + pageTitle + '] 长:' + html.length +
                ' slide:' + html.includes('hg-play__slide') +
                ' hist:' + html.includes('data-history') +
                ' jsonld:' + html.includes('application/ld+json') +
                ' m3u8inhtml:' + (m3u8Hit ? '是' : '否'));
        }
        return data;
    }

    // ===== 追剧库：数据层 =====
    let trackData = {items: []};
    try {
        const raw = GM_getValue(TRACK_KEY, null);
        if (raw && typeof raw === 'object' && Array.isArray(raw.items)) trackData = raw;
    } catch(e){}
    if (!Array.isArray(trackData.items)) trackData = {items: []};
    function saveTrack(){ try { GM_setValue(TRACK_KEY, trackData); } catch(e){} }

    function idOf(it){
        if (it.id) return String(it.id);
        const m = String(it.path || '').match(/\/(?:video|detail|drama|play|show|movie|ju|duanju)\/(\d+)/);
        return m ? m[1] : '';
    }
    function pathOf(it){
        const site = siteById(it.site) || getActiveSite();
        if (it.path && /\/(?:video|detail|drama)\/\d+/.test(it.path)) return it.path;
        return fillTpl(site.play.urlTpl, idOf(it), 1);
    }
    function epUrlOf(it, ep){
        const site = siteById(it.site) || getActiveSite();
        const base = pathOf(it);
        if (!ep || ep <= 1) return base;
        return fillTpl(site.play.epTpl, idOf(it), ep);
    }
    function findTrack(id){
        const key = String(id);
        for (let i = 0; i < trackData.items.length; i++) {
            if (idOf(trackData.items[i]) === key) return trackData.items[i];
        }
        return null;
    }
    function isFollowed(id){ return !!findTrack(id); }
    function addTrack(o){
        const id = String(o.id || '');
        if (!id) return false;
        let it = findTrack(id);
        const isNew = !it;
        if (!it) { it = {id: id}; trackData.items.push(it); }
        it.site = o.site || activeSiteId;
        it.path = o.path || pathOf(o);
        it.name = o.name || it.name || '';
        it.watchedEp = Math.max(it.watchedEp || 0, o.watchedEp || 0);
        it.knownEp = Math.max(it.knownEp || 0, o.knownEp || 0);
        it.latestEp = Math.max(it.latestEp || 0, o.latestEp || 0);
        it.addTime = it.addTime || Date.now();
        saveTrack();
        return isNew;
    }
    function removeTrack(id){
        const key = String(id);
        trackData.items = trackData.items.filter(it => idOf(it) !== key);
        saveTrack();
    }
    function diffOf(it){
        if (!it.latestEp) return -1;      // 还没查到
        if (!it.knownEp) return 0;
        return it.latestEp - it.knownEp;
    }
    function updateCount(){
        let n = 0;
        trackData.items.forEach(it=>{ if (diffOf(it) > 0) n++; });
        return n;
    }

    // ===== 卡片直达（站点列表/搜索页点卡片 → 直接开播）=====
    function epFromHref(href){
        const m = String(href || '').match(/\/ep-?(\d+)/);
        return m ? parseInt(m[1]) : 0;
    }
    function cardIdFrom(card, site){
        if (!card || !card.querySelectorAll) return null;
        const expr = site.card.idFrom || '';
        const hm = expr.match(/^href:(.+)$/);
        if (hm) {
            let re;
            try { re = new RegExp(hm[1]); } catch(e){ return null; }
            const links = [];
            // 卡片自身可能就是 <a>（如新站 <a class="block">），也要算进去
            if (card.tagName === 'A' && card.getAttribute('href') != null) links.push(card);
            card.querySelectorAll('a[href]').forEach(function(l){ links.push(l); });
            for (let i = 0; i < links.length; i++){
                const href = links[i].getAttribute('href') || links[i].href || '';
                const idm = href.match(re);
                if (idm) return { videoId: idm[1], ep: epFromHref(href) || 1, href: href };
            }
        }
        // 卡片自带数字型 data-* id
        const attrs = card.attributes || [];
        for (let i = 0; i < attrs.length; i++){
            const an = attrs[i].name || '';
            if (!/id$/i.test(an)) continue;
            const av = String(attrs[i].value || '').trim();
            if (/^\d{3,10}$/.test(av)) return { videoId: av, ep: 1, href: '' };
        }
        // 老影视站形如 /vod/123.html
        const links2 = card.querySelectorAll('a[href]');
        for (let i = 0; i < links2.length; i++){
            const mm = String(links2[i].href || '').match(/\/(\d{3,10})\.html/);
            if (mm) return { videoId: mm[1], ep: 1, href: links2[i].href };
        }
        return null;
    }

    let _longPressSkipped = false;   // 长按卡片 → 不接管（进入原网页的逃生口）
    let _lpTimer = null;
    window.addEventListener('click', function(e){
        if (cfg.directPlay === false) return;
        if (!e || e.defaultPrevented) return;
        if (e.button && e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        if (panel.style.display === 'flex' || trackPanel.style.display === 'flex' ||
            setPanel.classList.contains('show')) return;
        const site = getActiveSite();
        if (site.hosts && site.hosts.length &&
            !site.hosts.some(function(h){ return location.hostname.indexOf(h) >= 0; })) return;
        const card = e.target.closest ? e.target.closest(site.card.selector) : null;
        if (!card) return;
        const info = cardIdFrom(card, site);
        if (!info) return;
        if (_longPressSkipped){ _longPressSkipped = false; return; }
        e.preventDefault();
        e.stopPropagation();
        const nameEl = site.card.titleSel ? card.querySelector(site.card.titleSel) : null;
        const cardText = (card.textContent || '').replace(/\s+/g, ' ').trim();
        const cardAttr = card.getAttribute && card.getAttribute('title');
        const name = nameEl ? nameEl.textContent.trim().slice(0, 12)
                           : (cardText || cardAttr || '').slice(0, 12);
        toast(name ? ('正在打开《' + name + '》…') : '正在打开播放器…');

        if (site.play.mode === 'live') {
            // 新站：blob 只在播放页，真跳过去由 tryAutoOpen 接手
            // 关键：用站点 urlTpl 生成播放页（detail→video），不能用卡片原 href（那是详情页）
            const url = epUrl(site, info.videoId, info.ep);
            setTimeout(function(){ location.href = url; }, 30);
        } else {
            openPlayerById(info.videoId, info.ep || 1, info.href, function(){
                toast('没拿到播放地址，长按卡片可进原网页');
            }, site);
        }
    }, true);   // 捕获阶段：赶在站点自己的跳转逻辑之前

    // 长按 600ms → 本次点击不接管（想看原网页时长按）
    document.addEventListener('touchstart', function(e){
        if (cfg.directPlay === false) return;
        if (panel.style.display === 'flex' || trackPanel.style.display === 'flex') return;
        const site = getActiveSite();
        const card = e.target.closest ? e.target.closest(site.card.selector) : null;
        if (!card || !cardIdFrom(card, site)) return;
        _longPressSkipped = false;
        clearTimeout(_lpTimer);
        _lpTimer = setTimeout(function(){ _longPressSkipped = true; }, 600);
    }, {passive: true, capture: true});
    document.addEventListener('touchend', function(){ clearTimeout(_lpTimer); }, {passive: true, capture: true});
    document.addEventListener('touchmove', function(){ clearTimeout(_lpTimer); }, {passive: true, capture: true});

    // ===== 悬浮球 =====
    const floatBtn = document.createElement('div');
    floatBtn.id = 'sdFloatBtn';
    floatBtn.textContent = '▶';
    floatBtn.title = '短剧干净播放器 v' + SCRIPT_VERSION + '（点击 = 我的追剧）';
    floatBtn.style.right = '18px';
    floatBtn.style.bottom = '130px';
    floatBtn.style.setProperty('z-index', '2147483647', 'important');
    const badge = document.createElement('span');
    badge.id = 'sdBadge';
    floatBtn.appendChild(badge);
    let savedPos = null;
    try { savedPos = GM_getValue('sdBtnPos', null); } catch(e){}
    if (savedPos && typeof savedPos.left === 'number') {
        floatBtn.style.left = savedPos.left + 'px';
        floatBtn.style.top = savedPos.top + 'px';
        floatBtn.style.right = 'auto';
        floatBtn.style.bottom = 'auto';
    }
    document.body.appendChild(floatBtn);

    let usingTopLayer = false;
    try {
        if (typeof floatBtn.showPopover === 'function') {
            floatBtn.setAttribute('popover', 'manual');
            floatBtn.showPopover();
            usingTopLayer = true;
        }
    } catch (e) {}

    // 拖拽：用 transform 偏移，松手落定成真实位置并记忆
    let isDragging = false, dragged = false, startX, startY;
    function startDrag(e){
        isDragging = true; dragged = false;
        const evt = e.type.indexOf('mouse') >= 0 ? e : e.touches[0];
        startX = evt.clientX; startY = evt.clientY;
    }
    function dragMove(e){
        if(!isDragging) return;
        const evt = e.type.indexOf('mouse') >= 0 ? e : e.touches[0];
        const dx = evt.clientX - startX, dy = evt.clientY - startY;
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) dragged = true;
        floatBtn.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
    }
    function stopDrag(){
        if (!isDragging) return;
        isDragging = false;
        const rect = floatBtn.getBoundingClientRect();
        floatBtn.style.transform = '';
        floatBtn.style.left = rect.left + 'px';
        floatBtn.style.top = rect.top + 'px';
        floatBtn.style.right = 'auto';
        floatBtn.style.bottom = 'auto';
        try { GM_setValue('sdBtnPos', {left: Math.round(rect.left), top: Math.round(rect.top)}); } catch(e){}
        setTimeout(function(){ dragged = false; }, 80);
    }
    floatBtn.addEventListener('mousedown', startDrag);
    floatBtn.addEventListener('touchstart', startDrag, {passive:true});
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('touchmove', dragMove, {passive:true});
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchend', stopDrag);

    // ===== 播放器面板 =====
    const panel = document.createElement('div');
    panel.id = 'sdPanel';
    panel.innerHTML = `
<div class="sd-topbar">
    <span class="sd-ep-tag" id="sdEpTag">第1集</span>
    <span class="sd-drama-name" id="sdDramaName">剧名</span>
    <span class="sd-total-ep" id="sdTotalEp">共1集</span>
    <button class="sd-close" id="sdCloseBtn">关闭</button>
</div>
<div class="sd-content">
    <div class="sd-player-wrap">
        <div class="sd-loading" id="sdLoading">加载中...</div>
        <div id="sdPlayerBox"></div>
    </div>
    <div class="sd-toolbar">
        <button class="sd-tool-btn" id="sdPrevEp">上一集</button>
        <button class="sd-tool-btn" id="sdNextEp">下一集</button>
        <button class="sd-tool-btn" id="sdEpBtn">选集</button>
        <button class="sd-tool-btn" id="sdDescBtn">简介</button>
        <button class="sd-tool-btn" id="sdTrackBtn">我的追剧</button>
    </div>
    <div class="sd-desc-box" id="sdDescBox">
        <span class="sd-desc-text" id="sdDescText"></span>
        <button class="sd-follow-chip" id="sdFollowBtn">+ 追</button>
    </div>
    <div class="sd-ep-section show" id="sdEpSection">
        <div class="sd-ep-grid" id="sdEpGrid"></div>
        <div class="sd-ep-pager">
            <button class="sd-tool-btn" id="sdEpPagePrev">‹ 上页</button>
            <button class="sd-tool-btn" id="sdEpPageNext">下页 ›</button>
        </div>
    </div>
</div>`;
    document.body.appendChild(panel);

    // ===== 追剧库面板 =====
    const trackPanel = document.createElement('div');
    trackPanel.id = 'sdTrackPanel';
    trackPanel.innerHTML = `
<div class="sd-track-top">
    <span class="sd-track-title">我的追剧 <b id="sdTrackCount">(0)</b></span>
    <button class="sd-mini-btn" id="sdTrackRefresh">⟳ 刷新</button>
    <button class="sd-mini-btn" id="sdTrackSet">⚙ 设置</button>
    <button class="sd-close" id="sdTrackClose">关闭</button>
</div>
<div class="sd-track-tip" id="sdTrackTip"></div>
<div class="sd-track-body" id="sdTrackBody"></div>`;
    document.body.appendChild(trackPanel);

    // ===== 设置面板（追剧数据导入导出 + 站点配置）=====
    const setPanel = document.createElement('div');
    setPanel.id = 'sdSetPanel';
    setPanel.innerHTML = `
<div class="sd-set-top">
    <span class="sd-set-title">设置</span>
    <button class="sd-close" id="sdSetClose">关闭</button>
</div>
<div class="sd-set-body">
    <div class="sd-set-info" id="sdSetInfo">共 0 部剧</div>
    <div class="sd-set-block">
        <div class="sd-set-label">导出（生成 JSON 文件）</div>
        <div class="sd-set-row">
            <button class="sd-set-btn primary" id="sdExportFile">导出文件</button>
            <button class="sd-set-btn" id="sdExportCopy">复制</button>
            <button class="sd-set-btn" id="sdExportShow">查看</button>
        </div>
    </div>
    <div class="sd-set-block">
        <div class="sd-set-label">导入（选文件 或 粘贴 JSON 后导入）</div>
        <div class="sd-set-row">
            <button class="sd-set-btn" id="sdImportPick">选择文件</button>
            <button class="sd-set-btn primary" id="sdImportMerge">合并导入</button>
            <button class="sd-set-btn danger" id="sdImportOver">覆盖导入</button>
        </div>
        <textarea class="sd-set-area" id="sdSetArea" placeholder="在这里粘贴追剧 JSON，也可以用上方「选择文件」读入"></textarea>
    </div>
    <div class="sd-set-block">
        <div class="sd-set-label">危险操作</div>
        <div class="sd-set-row">
            <button class="sd-set-btn danger" id="sdClearAll">清空全部追剧</button>
        </div>
    </div>
    <div class="sd-set-block">
        <div class="sd-set-label">站点配置（切换站点 / 查看编辑规则）</div>
        <div class="sd-set-row">
            <select class="sd-set-select" id="sdSiteSel"></select>
        </div>
        <div class="sd-set-row">
            <button class="sd-set-btn" id="sdSiteEdit">编辑当前站点</button>
            <button class="sd-set-btn primary" id="sdSiteSave">保存修改</button>
            <button class="sd-set-btn danger" id="sdSiteReset">重置默认</button>
        </div>
        <textarea class="sd-set-area" id="sdSiteArea" placeholder="当前站点的配置 JSON（编辑后点「保存修改」）"></textarea>
        <div class="sd-set-info" id="sdSiteInfo"></div>
    </div>
    <div class="sd-set-block">
        <div class="sd-set-label">站点列表/搜索页点卡片</div>
        <div class="sd-set-row">
            <button class="sd-set-switch" id="sdDirectToggle">直接开播</button>
        </div>
    </div>
</div>`;
    document.body.appendChild(setPanel);
    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = '.json,application/json';
    importInput.style.display = 'none';
    document.body.appendChild(importInput);

    let dp = null;
    let current = null;
    let epPage = 1;
    const EP_PER_PAGE = 24;

    function playM3u8(m3u8, cover){
        document.getElementById('sdLoading').style.display = 'none';
        if (dp) { try { dp.destroy(); } catch(e){} dp = null; }
        dp = new DPlayer({
            container: document.getElementById('sdPlayerBox'),
            video: {url: m3u8, type: 'hls', pic: cover || ''},
            autoplay: true,
            theme: '#e74c3c'
        });
        const v = dp.video;
        if (v) {
            v.setAttribute('playsinline', '');
            v.setAttribute('webkit-playsinline', '');
            v.setAttribute('x5-playsinline', '');
            v.setAttribute('x5-video-player-type', 'h5');
            v.setAttribute('x5-video-player-fullscreen', 'false');
        }
        recordWatch();
        updateFollowUI();
    }

    // live 模式：blob 同页播放（MediaSource 的 blob 不能挂两个 video，故直接搬原 <video> 最稳）
    let liveMove = null;   // 被搬进面板的视频及其原位置，关闭时归还
    function playLiveVideo(blobUrl){
        document.getElementById('sdLoading').style.display = 'none';
        if (dp) { try { dp.destroy(); } catch(e){} dp = null; }
        const box = document.getElementById('sdPlayerBox');
        box.innerHTML = '';
        const site = getActiveSite();
        let v = null;
        try { v = pickLiveVideo(site.play.videoSel || '.dplayer-video'); } catch(e){}
        if (v && v.src && String(v.src).indexOf('blob:') === 0) {
            // 直接把原 <video> 搬进面板（同一文档，blob 有效；MediaSource 也只绑这一个元素）
            // 记住原位置，关闭面板时归还，避免站点自己的播放器被搬空
            liveMove = { el: v, parent: v.parentElement, next: v.nextSibling, hiddenParent: v.parentElement };
            if (v.parentElement) v.parentElement.style.display = 'none';
            v.controls = false; v.autoplay = true;
            v.setAttribute('playsinline', '');
            v.setAttribute('webkit-playsinline', '');
            v.setAttribute('x5-playsinline', '');
            v.setAttribute('x5-video-player-type', 'h5');
            v.style.width = '100%'; v.style.height = '100%'; v.style.background = '#000';
            box.appendChild(v);
            v.play && v.play().catch(function(){});
        } else {
            // 非 blob 兜底：自建 video
            const nv = document.createElement('video');
            nv.src = blobUrl;
            nv.controls = false; nv.autoplay = true;
            nv.setAttribute('playsinline', '');
            nv.setAttribute('webkit-playsinline', '');
            nv.setAttribute('x5-playsinline', '');
            nv.setAttribute('x5-video-player-type', 'h5');
            nv.style.width = '100%'; nv.style.height = '100%'; nv.style.background = '#000';
            box.appendChild(nv);
            nv.play && nv.play().catch(function(){});
        }
        recordWatch();
        updateFollowUI();
    }

    function renderEpGrid(){
        if (!current) return;
        const totalPages = Math.ceil(current.totalEp / EP_PER_PAGE);
        if (epPage > totalPages) epPage = totalPages;
        if (epPage < 1) epPage = 1;
        const start = (epPage - 1) * EP_PER_PAGE + 1;
        const end = Math.min(current.totalEp, epPage * EP_PER_PAGE);
        // 选集 href 映射（live 模式：点真实播放页链接更准）
        const hrefMap = {};
        const lockMap = {};
        if (current.epList) current.epList.forEach(function(o){ hrefMap[o.ep] = o.href; if (o.locked) lockMap[o.ep] = 1; });
        let html = '';
        for (let i = start; i <= end; i++) {
            const href = hrefMap[i] || '';
            html += '<button class="sd-ep-item ' + (i===current.currentEp?'active':'') + (lockMap[i]?' locked':'') +
                    '" data-ep="' + i + '"' + (href ? ' data-href="' + esc(href) + '"' : '') +
                    (lockMap[i] ? ' title="需金币解锁"' : '') +
                    '>' + i + '</button>';
        }
        document.getElementById('sdEpGrid').innerHTML = html;
        document.querySelectorAll('#sdEpGrid .sd-ep-item').forEach(btn=>{
            btn.onclick = function(){
                const ep = parseInt(btn.dataset.ep);
                if (btn.classList.contains('locked')) {
                    toast('第' + ep + '集需金币解锁，脚本不跟付费集');
                    return;
                }
                const h = btn.getAttribute('data-href');
                if (h) { location.href = h; }   // live 选集：直接用真实播放页链接
                else switchEp(ep);
            };
        });
        document.getElementById('sdEpPagePrev').disabled = epPage <= 1;
        document.getElementById('sdEpPageNext').disabled = epPage >= totalPages;
    }

    // 该集是否被锁定（金币/付费）
    function epLocked(ep){
        if (!current || !current.epList) return false;
        for (let k = 0; k < current.epList.length; k++){
            if (current.epList[k].ep === ep) return !!current.epList[k].locked;
        }
        return false;
    }
    function updateBar(){
        if (!current) return;
        document.getElementById('sdEpTag').textContent = '第' + current.currentEp + '集';
        document.getElementById('sdTotalEp').textContent = '共' + current.totalEp + '集';
        const prevLocked = epLocked(current.currentEp - 1), nextLocked = epLocked(current.currentEp + 1);
        const btnPrev = document.getElementById('sdPrevEp'), btnNext = document.getElementById('sdNextEp');
        btnPrev.disabled = current.currentEp <= 1 || prevLocked;
        btnNext.disabled = current.currentEp >= current.totalEp || nextLocked;
        btnPrev.title = prevLocked ? '上一集需金币解锁' : '';
        btnNext.title = nextLocked ? '下一集需金币解锁' : '';
    }

    async function switchEp(ep){
        if (!current || ep === current.currentEp) return;
        if (ep < 1 || ep > current.totalEp) return;
        // 付费/锁定集不跳（妈妈短剧这类按金币解锁的站，脚本只跟免费集）
        if (current.epList) {
            for (let k = 0; k < current.epList.length; k++){
                if (current.epList[k].ep === ep && current.epList[k].locked) {
                    toast('第' + ep + '集需金币解锁，已停在免费集');
                    return;
                }
            }
        }
        const site = siteById(current.site) || getActiveSite();
        if (site.play.mode === 'live') {
            // 真跳播放页，由 tryAutoOpen 重解析；优先用真实选集 href
            let url = epUrl(site, current.videoId, ep);
            if (current.epList) {
                for (let k = 0; k < current.epList.length; k++){
                    if (current.epList[k].ep === ep) { url = current.epList[k].href; break; }
                }
            }
            location.href = url;
            return;
        }
        try{
            const data = await fetchEp(current.videoId, ep, null, site);
            current.currentEp = ep;
            current.m3u8 = data.m3u8;
            if (data.totalEp) current.totalEp = data.totalEp;
            playM3u8(data.m3u8, data.cover);
            renderEpGrid();
            updateBar();
        }catch(e){
            const l = document.getElementById('sdLoading');
            l.style.display = 'flex';
            l.textContent = '加载失败: ' + (e.message||e);
        }
    }

    function closePanel(){
        try{ if (dp) { dp.destroy(); dp = null; } }catch(e){}
        // 归还被搬走的 <video>：放回原父节点、恢复原样式，站点播放器才不会变空白
        try{
            if (liveMove && liveMove.el && liveMove.parent){
                const v = liveMove.el;
                v.style.width = ''; v.style.height = ''; v.style.background = '';
                v.controls = true;
                if (liveMove.next && liveMove.next.parentNode === liveMove.parent) liveMove.parent.insertBefore(v, liveMove.next);
                else liveMove.parent.appendChild(v);
                if (liveMove.hiddenParent) liveMove.hiddenParent.style.display = '';
            }
        }catch(e){}
        liveMove = null;
        panel.style.display = 'none';
        floatBtn.style.display = '';
    }

    function openPanelFromCurrent(cur){
        if (panel.style.display === 'flex' && current &&
            current.videoId === cur.videoId && current.currentEp === cur.currentEp) return;
        current = cur;
        panel.style.display = 'flex';
        document.getElementById('sdDramaName').textContent = cur.dramaName || '加载中...';
        document.getElementById('sdDescText').textContent = cur.desc || '暂无简介';
        epPage = Math.ceil(cur.currentEp / EP_PER_PAGE);
        renderEpGrid();
        updateBar();
        updateFollowUI();
        if (cur.blob && cur.mode === 'live') {
            try { playLiveVideo(cur.blob); }
            catch(e){
                const l = document.getElementById('sdLoading');
                l.style.display = 'flex';
                l.textContent = '播放器加载失败: ' + (e.message||e);
            }
        } else if (cur.m3u8) {
            try{ playM3u8(cur.m3u8, cur.cover); }
            catch(e){
                const l = document.getElementById('sdLoading');
                l.style.display = 'flex';
                l.textContent = '播放器加载失败: ' + (e.message||e);
            }
        } else {
            const l = document.getElementById('sdLoading');
            l.style.display = 'flex';
            l.textContent = '加载中...';
        }
        startContentPolling();   // 开面板后持续补异步数据（选集/简介，SPA 后渲染）
    }

    // 开面板后轮询：SPA 播放页的选集按钮/简介常异步后到，开面板时可能为空，需补
    function startContentPolling(){
        if (!current) return;
        let tries = 0;
        const maxTries = 30;          // 30×400ms≈12s
        const timer = setInterval(function(){
            tries++;
            if (!current || panel.style.display !== 'flex') { clearInterval(timer); return; }
            const cur = parseCurrentPage();
            if (!cur) { if (tries >= maxTries) clearInterval(timer); return; }
            let changed = false;
            if (cur.totalEp && cur.totalEp !== current.totalEp) { current.totalEp = cur.totalEp; changed = true; }
            if (cur.desc && cur.desc !== current.desc) { current.desc = cur.desc; changed = true; }
            if (cur.currentEp && cur.currentEp !== current.currentEp) { current.currentEp = cur.currentEp; changed = true; }
            if (cur.epList && (!current.epList || cur.epList.length !== current.epList.length)) { current.epList = cur.epList; changed = true; }
            if (cur.dramaName && cur.dramaName !== current.dramaName) { current.dramaName = cur.dramaName; changed = true; }
            if (changed) {
                const dn = document.getElementById('sdDramaName'); if (dn) dn.textContent = current.dramaName || '加载中...';
                document.getElementById('sdDescText').textContent = current.desc || '暂无简介';
                document.getElementById('sdTotalEp').textContent = '共' + current.totalEp + '集';
                renderEpGrid();
                updateFollowUI();
                recordWatch();
            }
            const ready = current.totalEp > 0 && current.desc;
            if (tries >= maxTries || ready) {
                if (tries >= maxTries && (!current.totalEp || !current.desc)) {
                    const dt = document.getElementById('sdDescText');
                    if (dt) dt.textContent = '（未解析到选集/简介：请在「设置→站点配置→编辑当前站点」核对 descSel/totalEpText，或把播放页该区域的 F12 真实 HTML 发我）';
                }
                clearInterval(timer);
            }
        }, 400);
    }

    async function openPlayerById(videoId, ep, href, onFail, site){
        site = site || getActiveSite();
        if (site.play.mode === 'live') {
            // 真跳播放页，由 tryAutoOpen 接手
            const url = href || epUrl(site, videoId, ep);
            toast('正在打开播放页…');
            setTimeout(function(){ location.href = url; }, 50);
            return;
        }
        panel.style.display = 'flex';
        const loading = document.getElementById('sdLoading');
        loading.style.display = 'flex';
        loading.textContent = '加载中...';
        document.getElementById('sdDramaName').textContent = '加载中...';
        try{
            const data = await fetchEp(videoId, ep, href, site);
            current = {
                videoId: data.videoId || videoId,
                site: site.id,
                currentEp: data.currentEp || ep,
                totalEp: data.totalEp || ep,
                m3u8: data.m3u8,
                title: data.title,
                dramaName: data.dramaName || (data.title || '').replace(/\s*第\d+集\s*$/, ''),
                cover: data.cover,
                desc: data.desc || '',
                epList: data.epList || null
            };
            document.getElementById('sdDramaName').textContent = current.dramaName || '未知剧名';
            document.getElementById('sdDescText').textContent = current.desc || '暂无简介';
            epPage = Math.ceil(current.currentEp / EP_PER_PAGE);
            renderEpGrid();
            updateBar();
            updateFollowUI();
            playM3u8(data.m3u8, data.cover);
        }catch(e){
            loading.style.display = 'flex';
            loading.textContent = '加载失败: ' + (e.message||e);
            if (onFail) onFail(e);
        }
    }

    // ===== 追剧：记录观看进度 =====
    function recordWatch(){
        if (!current) return;
        const it = findTrack(current.videoId);
        if (!it) return;   // 只有追了的剧才记录
        it.site = current.site || it.site || activeSiteId;
        it.watchedEp = Math.max(it.watchedEp || 0, current.currentEp);
        it.name = current.dramaName || current.title || it.name;
        if (current.totalEp) {
            it.latestEp = Math.max(it.latestEp || 0, current.totalEp);
            if (it.watchedEp >= current.totalEp) it.knownEp = current.totalEp;
        }
        it.watchTime = Date.now();
        saveTrack();
    }

    function updateFollowUI(){
        const id = current ? current.videoId : '';
        const on = id ? isFollowed(id) : false;
        const f = document.getElementById('sdFollowBtn');
        if (f) {
            f.classList.toggle('on', on);
            f.textContent = on ? '✅ 追' : '+ 追';
            f.title = on ? '再点一次取消追剧' : '加入追剧库，有更新会提醒';
        }
        const cnt = document.getElementById('sdTrackCount');
        if (cnt) cnt.textContent = '(' + trackData.items.length + ')';
        const up = updateCount();
        if (up > 0) { badge.textContent = up; badge.classList.add('show'); }
        else badge.classList.remove('show');
    }

    function toggleFollow(){
        if (!current) { toast('先打开一部剧再追'); return; }
        const id = current.videoId;
        if (isFollowed(id)) {
            removeTrack(id);
            toast('已取消追剧');
        } else {
            addTrack({
                id: id,
                site: current.site || activeSiteId,
                path: epUrl(siteById(current.site) || getActiveSite(), id, 1),
                name: current.dramaName || current.title || ('剧 ' + id),
                watchedEp: current.currentEp,
                knownEp: current.totalEp || current.currentEp,
                latestEp: current.totalEp || current.currentEp
            });
            toast('已加入追剧库');
        }
        updateFollowUI();
        if (trackPanel.style.display === 'flex') renderTrackList();
    }

    // ===== 追剧：更新检查 =====
    async function checkOne(it, force){
        if (!force && it.checkTime && (Date.now() - it.checkTime < 5 * 60 * 1000) && it.latestEp) return;
        try {
            const r = await fetch(pathOf(it), {credentials: 'include'});
            if (!r.ok) return;
            const d = parseVideoHtml(await r.text(), {url: pathOf(it),
                origin: typeof location !== 'undefined' ? location.origin : ''});
            if (d.totalEp) {
                it.latestEp = d.totalEp;
                if (!it.knownEp) it.knownEp = d.totalEp;
            }
            if (d.updateText) it.updateText = d.updateText;
            const nm = String(d.title || '').replace(/\s*第\d+集\s*$/, '');
            if (nm) it.name = nm;
            it.checkTime = Date.now();
        } catch(e){}
    }
    async function checkAll(list, force){
        const queue = list.slice();
        const worker = async ()=>{
            while (queue.length) {
                const it = queue.shift();
                await checkOne(it, force);
                if (trackPanel.style.display === 'flex') renderTrackList();
            }
        };
        await Promise.all([worker(), worker(), worker()]);
        saveTrack();
    }

    // ===== 追剧：列表渲染（界面照「追剧列表效果预览.html」）=====
    function renderTrackList(){
        const body = document.getElementById('sdTrackBody');
        if (!body) return;
        const items = trackData.items;

        if (!items.length) {
            body.innerHTML = '<div class="sd-empty">追剧库还是空的<br><br>' +
                '看剧时点播放器里的 <b>＋ 追</b> 就能加进来<br>' +
                '加入后会自动记录看到第几集，并帮你盯更新</div>';
            return;
        }

        const sorted = items.slice().sort(function(a, b){
            const da = diffOf(a), db = diffOf(b);
            if (da > 0 && db <= 0) return -1;
            if (da <= 0 && db > 0) return 1;
            if (da > 0 && db > 0) return db - da;
            return (b.watchTime || b.addTime || 0) - (a.watchTime || a.addTime || 0);
        });

        let html = sorted.map(function(it){
            const d = diffOf(it);
            let badgeHtml = '';
            if (d > 0) badgeHtml = '<span class="sd-badge new">+' + d + '集</span>';
            else if (d === 0) badgeHtml = '<span class="sd-badge none">未更新</span>';
            else badgeHtml = '<span class="sd-badge wait">待检查</span>';

            const upd = it.updateText ? esc(it.updateText) + ' · ' : '';
            const meta = it.latestEp
                ? (upd + '更新至 第' + it.latestEp + '集')
                : (upd ? upd.replace(/ · $/, '') : '更新信息待获取');
            const seen = it.watchedEp ? ('看到 第' + it.watchedEp + '集') : '还没看过';

            return '<div class="sd-track-item" data-id="' + idOf(it) + '">' +
                '<div class="sd-track-main">' +
                    '<div class="sd-track-row1"><span class="sd-track-name">' +
                        esc(it.name || ('剧 ' + idOf(it))) + '</span>' + badgeHtml + '</div>' +
                    '<div class="sd-track-meta">' + meta + '</div>' +
                    '<div class="sd-track-sub">' + seen + '</div>' +
                '</div>' +
                '<div class="sd-track-ops">' +
                    '<button class="sd-ico-btn play" data-act="play">播放</button>' +
                    '<button class="sd-ico-btn seen" data-act="seen">已看</button>' +
                    '<button class="sd-ico-btn del" data-act="del">删除</button>' +
                '</div>' +
            '</div>';
        }).join('');
        html += '<div class="sd-track-foot">排序：有更新的在最上面<br>' +
                '播放＝继续看　已看＝标记已看到最新　删除＝取消追剧</div>';
        body.innerHTML = html;

        sorted.forEach(function(it){
            const id = idOf(it);
            const el = body.querySelector('.sd-track-item[data-id="' + id + '"]');
            if (!el) return;
            el.querySelectorAll('.sd-ico-btn').forEach(function(btn){
                btn.onclick = function(e){
                    e.stopPropagation();
                    const act = btn.dataset.act;
                    if (act === 'play') playFromTrack(it);
                    else if (act === 'del') {
                        if (confirm('取消追剧《' + (it.name || id) + '》？')) {
                            removeTrack(id); renderTrackList(); updateFollowUI(); toast('已删除');
                        }
                    } else if (act === 'seen') {
                        const latest = it.latestEp || it.knownEp || 0;
                        it.knownEp = Math.max(it.knownEp || 0, latest);
                        it.watchedEp = Math.max(it.watchedEp || 0, latest);
                        it.watchTime = Date.now();
                        saveTrack(); renderTrackList(); updateFollowUI();
                        toast('已标记为看到最新');
                    }
                };
            });
            el.onclick = function(){ playFromTrack(it); };
        });
    }

    async function refreshAll(force){
        const tip = document.getElementById('sdTrackTip');
        const btn = document.getElementById('sdTrackRefresh');
        const items = trackData.items;
        if (!items.length) { renderTrackList(); updateFollowUI(); return; }
        tip.textContent = '正在检查 ' + items.length + ' 部剧的更新…';
        tip.classList.add('show');
        btn.disabled = true;
        btn.textContent = '检查中';
        await checkAll(items, force);
        btn.disabled = false;
        btn.textContent = '⟳ 刷新';
        tip.classList.remove('show');
        renderTrackList();
        updateFollowUI();
    }

    let trackFromPlayer = false;   // 从播放器里进的追剧库 → 关闭后回到播放器
    function openTrackPanel(){
        trackFromPlayer = (panel.style.display === 'flex');
        trackPanel.style.display = 'flex';
        floatBtn.style.display = 'none';
        try { if (dp) dp.pause(); } catch(e){}
        renderTrackList();
        refreshAll(false);
    }
    function closeTrackPanel(){
        trackPanel.style.display = 'none';
        setPanel.classList.remove('show');
        if (trackFromPlayer) {
            panel.style.display = 'flex';        // 回到播放器页（而不是空白站点页）
            floatBtn.style.display = 'none';
            try { if (dp) dp.play(); } catch(e){}
        } else {
            floatBtn.style.display = '';
        }
    }
    function playFromTrack(it){
        trackPanel.style.display = 'none';
        setPanel.classList.remove('show');
        const site = siteById(it.site) || getActiveSite();
        let ep = 1;
        if (it.latestEp) ep = Math.min((it.watchedEp || 0) + 1, it.latestEp);
        else ep = Math.max(1, it.watchedEp || 1);
        panel.style.display = 'flex';
        openPlayerById(idOf(it), ep, epUrlOf(it, ep), null, site);
    }

    // ===== 导入导出（JSON 文件）=====
    function buildExport(){
        return {
            app: '短剧追剧库',
            version: 1,
            exportTime: fmtTime(Date.now()),
            count: trackData.items.length,
            list: trackData.items.map(function(it){
                return {
                    path: pathOf(it),
                    name: it.name || '',
                    watchedEp: it.watchedEp || 0,
                    knownEp: it.knownEp || 0,
                    latestEp: it.latestEp || 0,
                    updateText: it.updateText || '',
                    addTimeText: fmtTime(it.addTime),
                    watchTimeText: fmtTime(it.watchTime)
                };
            })
        };
    }
    function exportJson(){ return JSON.stringify(buildExport(), null, 2); }
    function downloadJson(text, filename){
        const blob = new Blob([text], {type: 'application/json;charset=utf-8'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 3000);
    }
    function copyText(text){
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text);
                return true;
            }
        } catch(e){}
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.top = '-1000px';
            document.body.appendChild(ta);
            ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch(e){}
            ta.remove();
            return ok;
        } catch(e){ return false; }
    }
    function normalizeIncoming(list){
        const out = [];
        (list || []).forEach(function(o){
            if (!o || typeof o !== 'object') return;
            const id = String(o.id || idOf(o) || '');
            if (!/^\d+$/.test(id)) return;
            const item = {
                id: id,
                site: o.site || activeSiteId,
                path: o.path || ('/video/' + id + '/'),
                name: o.name || '',
                watchedEp: parseInt(o.watchedEp) || 0,
                knownEp: parseInt(o.knownEp) || 0,
                latestEp: parseInt(o.latestEp) || 0,
                updateText: o.updateText || '',
                addTime: parseTime(o.addTime || o.addTimeText),
                watchTime: parseTime(o.watchTime || o.watchTimeText),
                checkTime: 0
            };
            if (!item.knownEp && item.latestEp) item.knownEp = item.latestEp;
            out.push(item);
        });
        return out;
    }
    function doImport(text, mode){
        let data;
        try { data = JSON.parse(text); }
        catch(e){ toast('JSON 格式不对，导入失败'); return 0; }
        const list = Array.isArray(data) ? data : (data && data.list);
        if (!Array.isArray(list)) { toast('没找到 list 数据'); return 0; }
        const incoming = normalizeIncoming(list);
        if (!incoming.length) { toast('没有可用的追剧数据'); return 0; }
        if (mode === 'over') {
            trackData.items = incoming;
        } else {
            incoming.forEach(function(n){
                const old = findTrack(n.id);
                if (!old) { trackData.items.push(n); return; }
                old.site = n.site || old.site;
                old.name = n.name || old.name;
                old.watchedEp = Math.max(old.watchedEp || 0, n.watchedEp || 0);
                old.latestEp = Math.max(old.latestEp || 0, n.latestEp || 0);
                old.knownEp = Math.max(old.knownEp || 0, n.knownEp || 0);
                old.updateText = n.updateText || old.updateText;
                old.addTime = old.addTime || n.addTime;
            });
        }
        saveTrack();
        renderTrackList();
        updateFollowUI();
        return incoming.length;
    }
    function updateSetInfo(){
        const el = document.getElementById('sdSetInfo');
        if (el) el.textContent = '共 ' + trackData.items.length + ' 部剧 · ' + updateCount() + ' 部有更新';
    }

    // ===== 站点配置 UI =====
    function updateSiteInfo(){
        const el = document.getElementById('sdSiteInfo');
        if (!el) return;
        const a = getActiveSite();
        const det = autoDetectSite();
        const isAuto = det && det.id === a.id;
        el.textContent = '共 ' + sites.length + ' 个站点，当前生效：' + a.name + '（' +
            (a.play.mode === 'live' ? 'live 读 blob' : 'fetch 拿 m3u8') + '）' +
            (isAuto ? ' · 自动识别' : ' · 手动');
    }
    function refreshSiteSel(){
        const sel = document.getElementById('sdSiteSel');
        if (!sel) return;
        const cur = getActiveSite().id;   // 下拉默认选中「实际生效」的站点
        sel.innerHTML = '';
        sites.forEach(function(s){
            const opt = document.createElement('option');
            opt.value = s.id; opt.textContent = s.name + '（' + (s.play.mode === 'live' ? 'live' : 'fetch') + '）';
            if (s.id === cur) opt.selected = true;
            sel.appendChild(opt);
        });
        updateSiteInfo();
    }
    function handleSiteSave(){
        const area = document.getElementById('sdSiteArea');
        const sel = document.getElementById('sdSiteSel');
        const id = sel ? sel.value : activeSiteId;
        let parsed;
        try { parsed = JSON.parse(area.value); }
        catch(e){ toast('JSON 解析失败，未保存'); return; }
        if (!parsed || typeof parsed !== 'object' || !parsed.id) { toast('缺少 id 字段'); return; }
        let replaced = false;
        for (let i = 0; i < sites.length; i++){
            if (sites[i].id === parsed.id){ sites[i] = parsed; replaced = true; break; }
        }
        if (!replaced) sites.push(parsed);
        saveSites();
        if (parsed.id === activeSiteId) setActiveSite(parsed.id);
        refreshSiteSel();
        toast('已保存站点「' + parsed.name + '」');
    }
    function handleSiteEdit(){
        const sel = document.getElementById('sdSiteSel');
        const id = sel ? sel.value : activeSiteId;
        const s = siteById(id);
        const area = document.getElementById('sdSiteArea');
        area.value = JSON.stringify(s, null, 2);
        area.classList.add('show');
        area.focus();
    }
    function handleSiteReset(){
        resetSites();
        activeSiteId = 'origin';
        try { GM_setValue(ACTIVE_KEY, activeSiteId); } catch(e){}
        refreshSiteSel();
        toast('已重置为内置默认配置');
    }

    // ===== 事件绑定 =====
    floatBtn.onclick = function(){
        if (dragged) return;
        openTrackPanel();
    };

    document.getElementById('sdCloseBtn').onclick = closePanel;
    document.getElementById('sdPrevEp').onclick = ()=> switchEp(current.currentEp - 1);
    document.getElementById('sdNextEp').onclick = ()=> switchEp(current.currentEp + 1);
    document.getElementById('sdEpPagePrev').onclick = ()=>{ epPage--; renderEpGrid(); };
    document.getElementById('sdEpPageNext').onclick = ()=>{ epPage++; renderEpGrid(); };
    document.getElementById('sdFollowBtn').onclick = toggleFollow;
    document.getElementById('sdTrackBtn').onclick = openTrackPanel;
    document.getElementById('sdDescBtn').onclick = ()=>{
        const descBox = document.getElementById('sdDescBox');
        const epSection = document.getElementById('sdEpSection');
        const showing = descBox.classList.contains('show');
        descBox.classList.toggle('show');
        epSection.classList.remove('show');
        if (!showing) descBox.classList.add('show');
    };
    document.getElementById('sdEpBtn').onclick = ()=>{
        const descBox = document.getElementById('sdDescBox');
        const epSection = document.getElementById('sdEpSection');
        const showing = epSection.classList.contains('show');
        epSection.classList.toggle('show');
        descBox.classList.remove('show');
        if (!showing) epSection.classList.add('show');
    };

    // 追剧库
    document.getElementById('sdTrackClose').onclick = closeTrackPanel;
    document.getElementById('sdTrackRefresh').onclick = ()=> refreshAll(true);
    document.getElementById('sdTrackSet').onclick = function(){
        setPanel.classList.add('show');
        updateSetInfo();
        refreshSiteSel();
    };
    document.getElementById('sdSetClose').onclick = function(){ setPanel.classList.remove('show'); };

    // 导入导出
    importInput.onchange = function(){
        const f = importInput.files && importInput.files[0];
        if (!f) return;
        const fr = new FileReader();
        fr.onload = function(){
            const area = document.getElementById('sdSetArea');
            area.value = String(fr.result || '');
            area.classList.add('show');
            toast('已读入 ' + f.name + '，选择导入方式');
        };
        fr.readAsText(f, 'utf-8');
        importInput.value = '';
    };
    document.getElementById('sdExportFile').onclick = function(){
        const d = new Date();
        const name = '追剧数据_' + d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) +
                     '_' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
        downloadJson(exportJson(), name);
        toast('已导出 ' + trackData.items.length + ' 部剧');
    };
    document.getElementById('sdExportCopy').onclick = function(){
        toast(copyText(exportJson()) ? 'JSON 已复制到剪贴板' : '复制失败，请用「查看」手动复制');
    };
    document.getElementById('sdExportShow').onclick = function(){
        const area = document.getElementById('sdSetArea');
        area.value = exportJson();
        area.classList.add('show');
        area.focus();
        area.select();
    };
    document.getElementById('sdImportPick').onclick = function(){ importInput.click(); };
    document.getElementById('sdImportMerge').onclick = function(){
        const text = document.getElementById('sdSetArea').value.trim();
        if (!text) { toast('先粘贴 JSON 或选择文件'); return; }
        const n = doImport(text, 'merge');
        if (n) { toast('合并导入 ' + n + ' 部，现共 ' + trackData.items.length + ' 部'); updateSetInfo(); }
    };
    document.getElementById('sdImportOver').onclick = function(){
        const text = document.getElementById('sdSetArea').value.trim();
        if (!text) { toast('先粘贴 JSON 或选择文件'); return; }
        if (!confirm('覆盖导入会替换掉当前的全部追剧数据，确定？')) return;
        const n = doImport(text, 'over');
        if (n) { toast('覆盖导入 ' + n + ' 部'); updateSetInfo(); }
    };
    document.getElementById('sdClearAll').onclick = function(){
        if (!trackData.items.length) { toast('已经是空的了'); return; }
        if (!confirm('确定清空全部 ' + trackData.items.length + ' 部追剧？建议先导出备份。')) return;
        trackData.items = [];
        saveTrack();
        renderTrackList();
        updateFollowUI();
        updateSetInfo();
        toast('已清空');
    };
    document.getElementById('sdDirectToggle').onclick = function(){
        cfg.directPlay = !cfg.directPlay;
        this.classList.toggle('on', cfg.directPlay);
        this.textContent = cfg.directPlay ? '直接开播' : '进原网页';
        saveCfg();
        toast(cfg.directPlay ? '点卡片直接开播' : '点卡片进原网页');
    };
    (function syncSwitch(){
        const b = document.getElementById('sdDirectToggle');
        b.classList.toggle('on', cfg.directPlay !== false);
        b.textContent = cfg.directPlay !== false ? '直接开播' : '进原网页';
    })();

    // 站点配置
    document.getElementById('sdSiteSel').onchange = function(){
        setActiveSite(this.value);
        updateSiteInfo();
        toast('已切换到「' + (siteById(this.value).name) + '」');
    };
    document.getElementById('sdSiteEdit').onclick = handleSiteEdit;
    document.getElementById('sdSiteSave').onclick = handleSiteSave;
    document.getElementById('sdSiteReset').onclick = handleSiteReset;

    // 自愈兜底：悬浮球被站点覆盖/移除时拉回
    setInterval(function(){
        floatBtn.style.setProperty('z-index', '2147483647', 'important');
        if (panel.style.display === 'flex' || trackPanel.style.display === 'flex' ||
            setPanel.classList.contains('show')) return;
        const rect = floatBtn.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const el = document.elementFromPoint(rect.left + rect.width/2, rect.top + rect.height/2);
        if ((el && el !== floatBtn && !floatBtn.contains(el)) || !floatBtn.isConnected) {
            document.body.appendChild(floatBtn);
            if (usingTopLayer) { try { floatBtn.showPopover(); } catch(e){} }
        }
    }, 1500);

    // ===== 进入播放页自动弹出 =====
    let autoOpenedKey = null;
    let lastPath = location.pathname;
    async function tryAutoOpen(remaining){
        if (remaining <= 0) return;
        const cur = parseCurrentPage();
        if (!cur) return;
        const key = cur.videoId + ':' + cur.currentEp + ':' + cur.mode;
        if (autoOpenedKey === key) return;
        if ((cur.blob && cur.mode === 'live') || cur.m3u8) {
            autoOpenedKey = key;
            openPanelFromCurrent(cur);
        } else {
            await sleep(300);
            await tryAutoOpen(remaining - 1);
        }
    }
    setTimeout(()=>tryAutoOpen(20), 300);

    setInterval(()=>{
        if (location.pathname !== lastPath) {
            lastPath = location.pathname;
            autoOpenedKey = null;
            setTimeout(()=>tryAutoOpen(10), 300);
        }
    }, 800);

    console.log('▶️ 短剧干净播放器 V' + SCRIPT_VERSION + ' 已加载（多站点配置模板 + 追剧库）');

    // 仅测试时（window.__SD_TEST__）导出内部函数，便于 jsdom 直接验证规则引擎与配置逻辑
    if (typeof window !== 'undefined' && window.__SD_TEST__) {
        window.__sd = {
            applyRules: applyRules, evalRule: evalRule, fillTpl: fillTpl, epUrl: epUrl,
            getActiveSite: getActiveSite, siteById: siteById, SITES_DEFAULT: SITES_DEFAULT,
            parseVideoHtml: parseVideoHtml, parseCurrentPage: parseCurrentPage,
            cardIdFrom: cardIdFrom, idOf: idOf,
            pathOf: pathOf, epUrlOf: epUrlOf, setActiveSite: setActiveSite
        };
    }
})();
