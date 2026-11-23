// ==UserScript==
// @name         短剧干净播放器V4.0
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  无广告干净播放器 + 追剧库：追剧/取消、更新提醒(+N/未更新)、观看进度记录、追剧列表管理、JSON导入导出
// @author       You
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @require      https://cdn.jsdelivr.net/npm/dplayer@1.27.1/dist/DPlayer.min.js
// ==/UserScript==

(function() {
    'use strict';

    const cssLink = document.createElement('link');
    cssLink.rel = 'stylesheet';
    cssLink.href = 'https://cdn.jsdelivr.net/npm/dplayer@1.27.1/dist/DPlayer.min.css';
    document.head.appendChild(cssLink);

    GM_addStyle(`
#sdFloatBtn{
    position:fixed;width:46px;height:46px;border-radius:50%;
    background:#e74c3c;color:#fff;font-size:20px;text-align:center;line-height:46px;
    cursor:move;z-index:2147483647!important;user-select:none;box-shadow:0 2px 8px rgba(0,0,0,0.4);
    border:none!important;margin:0!important;padding:0!important;
    touch-action:none;will-change:transform;
}
#sdFloatBtn:active{opacity:0.8;}
#sdBtnBadge{
    position:absolute;top:-3px;right:-3px;min-width:17px;height:17px;line-height:17px;
    background:#ffca28;color:#7a3b00;border-radius:9px;font-size:11px;font-weight:bold;
    padding:0 4px;box-shadow:0 1px 4px rgba(0,0,0,.5);display:none;pointer-events:none;
}
#sdBtnBadge.show{display:block;}
#sdPanel{
    position:fixed;inset:0;background:#0a0a0a;z-index:2147483647!important;display:none;flex-direction:column;
}
.sd-topbar{
    background:#1a1a1a;padding:10px 14px;display:flex;align-items:center;gap:8px;flex-shrink:0;
}
.sd-ep-nav{
    background:#2a2a2a;color:#e74c3c;border:none;border-radius:10px;
    width:46px;height:38px;font-size:20px;cursor:pointer;flex-shrink:0;
    display:flex;align-items:center;justify-content:center;
}
.sd-ep-nav:disabled{opacity:0.3;cursor:not-allowed;}
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
.sd-loading{
    color:#888;text-align:center;display:flex;align-items:center;justify-content:center;
    min-height:200px;font-size:14px;
}
.sd-toolbar{display:flex;gap:8px;padding:10px 14px;align-items:center;flex-wrap:wrap;}
.sd-tool-btn{
    background:#222;color:#ccc;border:none;border-radius:10px;padding:9px 16px;
    cursor:pointer;font-size:13px;white-space:nowrap;
}
.sd-tool-btn:disabled{opacity:0.3;cursor:not-allowed;}
.sd-tool-btn.follow{
    background:#222;color:#ccc;border:none;padding:9px 16px;
}
.sd-tool-btn.follow.on{background:#e74c3c;color:#fff;font-weight:bold;}
.sd-tool-btn.count b{color:#e74c3c;}
.sd-desc-box{
    display:none;background:#1a1a1a;margin:0 14px 14px;padding:12px;border-radius:12px;
    color:#bbb;font-size:13px;line-height:1.6;
}
.sd-desc-box.show{display:block;}
.sd-desc-text{white-space:pre-wrap;word-break:break-word;}
.sd-follow-row{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:center;}
.sd-follow-btn{
    background:#222;color:#ccc;border:none;border-radius:10px;
    padding:9px 16px;font-size:13px;cursor:pointer;
}
.sd-follow-btn.on{background:#e74c3c;color:#fff;font-weight:bold;}
.sd-follow-btn.ghost{
    background:#222;color:#ccc;
}
.sd-ep-section{display:none;padding:10px 14px;}
.sd-ep-section.show{display:block;}
.sd-ep-pager{display:flex;gap:8px;justify-content:center;align-items:center;padding:8px 0;}
.sd-ep-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(48px,1fr));gap:6px;}
.sd-ep-item{
    background:#222;color:#ccc;border:none;border-radius:10px;padding:10px 0;
    cursor:pointer;font-size:13px;text-align:center;
}
.sd-ep-item.active{background:#e74c3c;color:#fff;font-weight:bold;}

/* ===== 追剧库 ===== */
#sdTrackPanel{
    position:fixed;inset:0;background:#0a0a0a;z-index:2147483647!important;
    display:none;flex-direction:column;
}
.sd-track-top{
    background:#1a1a1a;padding:10px 14px;display:flex;align-items:center;gap:8px;flex-shrink:0;
}
.sd-track-title{color:#fff;font-size:16px;font-weight:bold;flex:1;white-space:nowrap;}
.sd-track-title b{color:#e74c3c;font-size:13px;font-weight:normal;}
.sd-mini-btn{
    background:#2a2a2a;color:#ddd;border:none;border-radius:16px;padding:6px 12px;
    font-size:12px;cursor:pointer;white-space:nowrap;
}
.sd-track-tip{
    display:none;color:#888;font-size:12px;padding:8px 14px;background:#141414;
}
.sd-track-tip.show{display:block;}
.sd-track-body{flex:1;overflow-y:auto;padding:10px 12px 24px;}
.sd-track-item{
    display:block;background:#161616;border-radius:12px;padding:10px 12px;margin-bottom:8px;
}
.sd-track-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;}
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
.sd-track-ops{
    display:flex;gap:8px;margin-top:9px;flex-shrink:0;
}
.sd-ico-btn{
    border:none;background:#333;color:#aaa;border-radius:10px;
    padding:5px 16px;font-size:12px;line-height:1.4;cursor:pointer;white-space:nowrap;
}
.sd-ico-btn.play{background:#e74c3c;color:#fff;}
.sd-ico-btn.seen{background:#ffca28;color:#222;}
.sd-ico-btn.del{background:#333;color:#aaa;}
.sd-ico-btn:active{opacity:.75;}
.sd-empty{
    color:#777;text-align:center;padding:60px 20px;font-size:13px;line-height:1.9;
}
.sd-empty b{color:#e74c3c;}
/* 设置面板 */
.sd-set-mask{
    position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2147483647!important;
    display:none;align-items:center;justify-content:center;padding:16px;
}
.sd-set-mask.show{display:flex;}
.sd-set-box{
    background:#161616;border-radius:14px;padding:16px;width:100%;max-width:420px;
    max-height:88vh;overflow-y:auto;
}
.sd-set-title{color:#fff;font-size:15px;font-weight:bold;margin-bottom:6px;}
.sd-set-info{color:#888;font-size:12px;margin-bottom:12px;}
.sd-set-sec{margin-bottom:14px;}
.sd-set-label{color:#aaa;font-size:12px;margin-bottom:6px;}
.sd-set-btns{display:flex;gap:8px;flex-wrap:wrap;}
.sd-set-btn{
    background:#2a2a2a;color:#ddd;border:none;border-radius:18px;padding:8px 14px;
    font-size:13px;cursor:pointer;
}
.sd-set-btn.danger{background:#3a1f1f;color:#ff8a80;}
.sd-set-area{
    width:100%;height:110px;margin-top:8px;background:#0d0d0d;color:#ccc;border:1px solid #2a2a2a;
    border-radius:8px;padding:8px;font-size:12px;box-sizing:border-box;resize:vertical;
}
.sd-set-foot{display:flex;justify-content:flex-end;margin-top:4px;}
/* toast */
.sd-toast{
    position:fixed;left:50%;bottom:14%;transform:translateX(-50%) translateY(6px);
    background:rgba(0,0,0,.88);color:#fff;font-size:13px;padding:10px 18px;border-radius:20px;
    z-index:2147483647!important;opacity:0;transition:opacity .2s,transform .2s;pointer-events:none;
    max-width:80%;text-align:center;
}
.sd-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
`);

    function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

    // ===== 追剧库：数据层 =====
    const TRACK_KEY = 'sdTrackData_v1';
    let trackData = {items: []};
    try {
        const raw = GM_getValue(TRACK_KEY, null);
        if (raw && typeof raw === 'object' && Array.isArray(raw.items)) trackData = raw;
    } catch(e){}
    if (!Array.isArray(trackData.items)) trackData = {items: []};

    function saveTrack(){ try { GM_setValue(TRACK_KEY, trackData); } catch(e){} }

    function idOf(it){
        if (it.id) return String(it.id);
        const m = String(it.path || '').match(/\/(?:video|detail)\/(\d+)/);
        return m ? m[1] : '';
    }
    function pathOf(it){
        if (it.path && /\/(?:video|detail)\/\d+/.test(it.path)) return it.path;
        return '/video/' + idOf(it) + '/';
    }
    // 拼某一集的地址：第1集就是 /video/数字/，其它是 /video/数字/ep-N/
    function epUrlOf(it, ep){
        const base = pathOf(it);
        if (!ep || ep <= 1) return base;
        return base.replace(/\/(video|detail)\/(\d+)(\/ep-\d+)?\/?$/,
            function(m0, kind, id){ return '/' + kind + '/' + id + '/ep-' + ep + '/'; });
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
        it.path = o.path || pathOf(o);
        it.origin = o.origin || it.origin || location.origin || '';
        it.name = o.name || it.name || '';
        it.cover = o.cover || it.cover || '';
        it.watchedEp = Math.max(it.watchedEp || 0, o.watchedEp || 0);
        it.knownEp = Math.max(it.knownEp || 0, o.knownEp || 0);
        it.latestEp = Math.max(it.latestEp || 0, o.latestEp || 0);
        it.updateText = o.updateText || it.updateText || '';
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
        if (!it.latestEp) return -1;           // 还没查到
        if (!it.knownEp) return 0;
        return it.latestEp - it.knownEp;
    }
    function updateCount(){
        let n = 0;
        trackData.items.forEach(it=>{ if (diffOf(it) > 0) n++; });
        return n;
    }

    // ===== 时间格式化 =====
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

    // 从页面里尽力提取“更新时间”文本
    function extractUpdateText(html){
        try {
            let m = html.match(/(?:更新时间|更新于|更新至|最后更新)[^<>{}]{0,30}?((?:20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})|(?:\d+\s*(?:分钟|小时|天|周)前))/);
            if (m) return m[1].trim();
            m = html.match(/(20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})/);
            if (m) return m[1];
        } catch(e){}
        return '';
    }

    function parseCurrentPage() {
        const path = location.pathname;
        const m = path.match(/\/video\/(\d+)(?:\/ep-(\d+))?/);
        if (!m) return null;
        let videoId = m[1];
        let currentEp = m[2] ? parseInt(m[2]) : 1;

        // ① 新结构：body[data-history] 一把拿到 id/集数/总集数/标题/简介/封面
        let history = null;
        try {
            const attr = document.body.getAttribute('data-history');
            if (attr) history = JSON.parse(attr);
        } catch(e){}

        let totalEp = 0, title = '', desc = '', cover = '';
        if (history) {
            if (history.id) videoId = String(history.id);
            if (history.ep) currentEp = parseInt(history.ep) || currentEp;
            if (history.total) totalEp = parseInt(history.total) || 0;
            title = history.title || '';
            desc = history.desc || '';
            cover = history.cover || '';
        }

        // ② 新结构：播放地址直接挂在 article 的 data-play-src 上
        let m3u8 = '';
        const slide = document.querySelector('article.hg-play__slide[data-play-src]');
        if (slide) m3u8 = slide.getAttribute('data-play-src') || '';

        // ③ 站点直接给的上下集地址（备用）
        const ps = document.querySelector('section.hg-play[data-hg-next-url]');
        const nextUrl = ps ? (ps.getAttribute('data-hg-next-url') || '') : '';
        const prevUrl = ps ? (ps.getAttribute('data-hg-prev-url') || '') : '';

        // ④ 旧结构兜底（老页面仍能解析）
        if (!totalEp) {
            document.querySelectorAll('.hg-play__ep-item').forEach(a=>{
                const epId = parseInt(a.dataset.epId);
                if (epId > totalEp) totalEp = epId;
            });
        }
        if (!m3u8) {
            document.querySelectorAll('script[type="application/ld+json"]').forEach(s=>{
                try{
                    const data = JSON.parse(s.textContent);
                    const graph = data['@graph'] || [];
                    graph.forEach(node=>{
                        if (node['@type'] === 'VideoObject') {
                            m3u8 = m3u8 || node.contentUrl || '';
                            title = title || node.name || '';
                            cover = cover || (node.thumbnailUrl || [''])[0] || '';
                        }
                    });
                }catch(e){}
            });
        }
        // ⑤ 新站兜底：m3u8 藏在页面任意 script/字段里，整页正则提取（&amp;还原成&）
        if (!m3u8) {
            const outer = document.documentElement.outerHTML;
            const hit = outer.match(/https?:[^"'\s<>]+\.m3u8[^"'\s<>]*/);
            if (hit) m3u8 = hit[0].replace(/&amp;/g, '&');
        }
        if (!desc) {
            const descEl = document.querySelector('.hg-play__panel-desc');
            if (descEl) desc = descEl.textContent.trim();
        }
        if (cover && !/^https?:/.test(cover)) cover = location.origin + cover;

        const dramaName = (title || '').replace(/\s*第\d+集\s*$/, '');
        return {
            videoId, currentEp,
            totalEp: totalEp || currentEp,
            m3u8, title, dramaName, cover, desc,
            nextUrl, prevUrl
        };
    }

    // 解析任意视频页HTML（切集fetch用）：新结构优先，旧结构兜底，一个请求拿全所有信息
    function parseVideoHtml(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        let m3u8 = '', title = '', cover = '', videoId = '', desc = '', currentEp = 1, totalEp = 0, updateText = '';

        const slide = doc.querySelector('article.hg-play__slide[data-play-src]');
        if (slide) m3u8 = slide.getAttribute('data-play-src') || '';

        try {
            const attr = doc.body && doc.body.getAttribute('data-history');
            if (attr) {
                const h = JSON.parse(attr);
                videoId = h.id || videoId;
                title = h.title || title;
                desc = h.desc || desc;
                cover = h.cover || cover;
                totalEp = parseInt(h.total) || 0;
                currentEp = parseInt(h.ep) || 1;
                // 更新时间：各站字段不统一，尽力取
                const raw = h.update_time || h.updatetime || h.updateTime || h.updated_at ||
                            h.updated || h.last_time || h.time || h.date || '';
                if (raw) {
                    if (/^\d{9,13}$/.test(String(raw))) {
                        const n = parseInt(raw);
                        updateText = fmtTime(n > 1e12 ? n : n * 1000);
                    } else if (/20\d{2}[-\/.]\d{1,2}/.test(String(raw))) {
                        updateText = String(raw);
                    }
                }
            }
        } catch(e){}

        if (!m3u8) {
            doc.querySelectorAll('script[type="application/ld+json"]').forEach(s=>{
                try{
                    const data = JSON.parse(s.textContent);
                    const graph = data['@graph'] || [];
                    graph.forEach(node=>{
                        if (node['@type'] === 'VideoObject') {
                            m3u8 = m3u8 || node.contentUrl || '';
                            title = title || node.name || '';
                            cover = cover || (node.thumbnailUrl || [''])[0] || '';
                        }
                    });
                }catch(e){}
            });
        }
        // ④ 新站兜底：m3u8 藏在页面任意 script/字段里，整页正则提取（&amp;还原成&）
        if (!m3u8) {
            const hit = html.match(/https?:[^"'\s<>]+\.m3u8[^"'\s<>]*/);
            if (hit) m3u8 = hit[0].replace(/&amp;/g, '&');
        }
        if (!totalEp) {
            doc.querySelectorAll('.hg-play__ep-item').forEach(a=>{
                const n = parseInt(a.dataset.epId);
                if (n > totalEp) totalEp = n;
            });
        }
        if (!desc) {
            const descEl = doc.querySelector('.hg-play__panel-desc');
            if (descEl) desc = descEl.textContent.trim();
        }
        if (!updateText) updateText = extractUpdateText(html);
        if (cover && !/^https?:/.test(cover)) cover = location.origin + cover;

        return {m3u8, title, cover, videoId, currentEp, totalEp, desc, updateText};
    }

    async function fetchEp(videoId, ep, href) {
        // 优先用触摸到的完整链接（跨域名也正确），否则按标准路径拼
        const url = href || (ep === 1 ? `/video/${videoId}/` : `/video/${videoId}/ep-${ep}/`);
        const r = await fetch(url, {credentials: 'include'});
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
        const html = await r.text();
        const data = parseVideoHtml(html);
        if (!data.m3u8) {
            // 诊断信息：把返回页面的特征带出来，方便定位
            const tm = html.match(/<title>([\s\S]*?)<\/title>/);
            const pageTitle = tm ? tm[1].trim().slice(0, 60) : '(无标题)';
            const m3u8Hit = html.match(/https?:[^"'\s<>]+\.m3u8[^"'\s<>]*/);
            throw new Error('未找到视频地址 [' + pageTitle + '] 长:' + html.length +
                ' slide:' + html.includes('hg-play__slide') +
                ' src:' + /data-play-src=/.test(html) +
                ' hist:' + html.includes('data-history') +
                ' jsonld:' + html.includes('application/ld+json') +
                ' m3u8inhtml:' + (m3u8Hit ? '是(' + m3u8Hit[0].slice(0, 60) + ')' : '否'));
        }
        return data;
    }

    // ===== 触摸封面后台记录id（/detail/ 和 /video/ 的 id 相同，直接通用） =====
    let lastTouched = null;
    function findVideoFromEl(el){
        let node = el;
        for (let i = 0; i < 6 && node && node.nodeType === 1; i++) {
            // ① 标准：封面/标题是 <a href="/video/或/detail/数字">，记录完整链接供fetch
            if (node.tagName === 'A' && node.href) {
                const m = node.href.match(/\/(?:video|detail)\/(\d+)(?:\/ep-(\d+))?/);
                if (m) return {videoId: m[1], ep: m[2] ? parseInt(m[2]) : 1, href: node.href};
            }
            // ② 兜底：新版列表卡片自带 data-track-id，摸到卡片任何位置都能拿到id
            const tid = node.getAttribute && node.getAttribute('data-track-id');
            if (tid && /^\d+$/.test(tid)) return {videoId: tid, ep: 1};
            node = node.parentElement;
        }
        return null;
    }
    document.addEventListener('touchstart', e=>{
        if ((panel && panel.style.display === 'flex') ||
            (trackPanel && trackPanel.style.display === 'flex')) return;
        const t = e.touches && e.touches[0];
        if (!t) return;
        const hit = findVideoFromEl(e.target);
        if (hit) lastTouched = hit;
    }, {passive: true, capture: true});

    const floatBtn = document.createElement('div');
    floatBtn.id = 'sdFloatBtn';
    floatBtn.textContent = '▶';
    // 默认：右下角往上两指(约130px)、靠右
    floatBtn.style.right = '18px';
    floatBtn.style.bottom = '130px';
    floatBtn.style.setProperty('z-index', '2147483647', 'important');
    // 读上次记住的位置
    let savedPos = null;
    try { savedPos = GM_getValue('sdBtnPos', null); } catch(e){}
    if (savedPos && typeof savedPos.left === 'number') {
        floatBtn.style.left = savedPos.left + 'px';
        floatBtn.style.top = savedPos.top + 'px';
        floatBtn.style.right = 'auto';
        floatBtn.style.bottom = 'auto';
    }
    const btnBadge = document.createElement('span');
    btnBadge.id = 'sdBtnBadge';
    floatBtn.appendChild(btnBadge);
    document.body.appendChild(floatBtn);

    // 提升到浏览器"顶层"
    let usingTopLayer = false;
    try {
        if (typeof floatBtn.showPopover === 'function') {
            floatBtn.setAttribute('popover', 'manual');
            floatBtn.showPopover();
            usingTopLayer = true;
        }
    } catch (e) {}

    // ===== 拖拽：全程用 transform 偏移（GPU合成、不触发reflow，解决UC卡顿） =====
    let isDragging = false, startX, startY;
    let lpTimer = null, lpStart = null, lpMoved = false, longPressFired = false;
    function startDrag(e){
        isDragging = true;
        const evt = e.type.includes('mouse') ? e : e.touches[0];
        startX = evt.clientX; startY = evt.clientY;
        // 长按 700ms → 打开追剧库
        lpStart = {x: evt.clientX, y: evt.clientY};
        lpMoved = false; longPressFired = false;
        clearTimeout(lpTimer);
        lpTimer = setTimeout(function(){
            if (lpMoved) return;
            isDragging = false;
            longPressFired = true;
            try { navigator.vibrate && navigator.vibrate(15); } catch(err){}
            openTrackPanel();
        }, 700);
    }
    function dragMove(e){
        if(!isDragging) return;
        const evt = e.type.includes('mouse') ? e : e.touches[0];
        if (lpStart && (Math.abs(evt.clientX - lpStart.x) > 8 || Math.abs(evt.clientY - lpStart.y) > 8)) {
            lpMoved = true;
            clearTimeout(lpTimer);
        }
        const dx = evt.clientX - startX;
        const dy = evt.clientY - startY;
        floatBtn.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    function stopDrag(){
        clearTimeout(lpTimer);
        if (!isDragging) return;
        isDragging = false;
        // 松手：把 transform 落定成真实位置，并记住
        const rect = floatBtn.getBoundingClientRect();
        floatBtn.style.transform = '';
        floatBtn.style.left = rect.left + 'px';
        floatBtn.style.top = rect.top + 'px';
        floatBtn.style.right = 'auto';
        floatBtn.style.bottom = 'auto';
        try { GM_setValue('sdBtnPos', {left: Math.round(rect.left), top: Math.round(rect.top)}); } catch(e){}
    }
    floatBtn.addEventListener('mousedown', startDrag);
    floatBtn.addEventListener('touchstart', startDrag, {passive:true});
    floatBtn.addEventListener('contextmenu', e=>{ e.preventDefault(); });
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('touchmove', dragMove, {passive:true});
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchend', stopDrag);

    const panel = document.createElement('div');
    panel.id = 'sdPanel';
    panel.innerHTML = `
<div class="sd-topbar">
    <span class="sd-ep-tag" id="sdEpTag">第1集</span>
    <span class="sd-drama-name" id="sdDramaName">剧名</span>
    <button class="sd-ep-nav" id="sdTopPrev" title="上一集">⏮</button>
    <button class="sd-ep-nav" id="sdTopNext" title="下一集">⏭</button>
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
        <button class="sd-tool-btn follow" id="sdFollowBtn">＋ 追剧</button>
        <button class="sd-tool-btn" id="sdTrackBtn">我的追剧</button>
    </div>
    <div class="sd-ep-section show" id="sdEpSection">
        <div class="sd-ep-pager">
            <button class="sd-tool-btn" id="sdEpPagePrev">‹ 上页</button>
            <button class="sd-tool-btn" id="sdEpPageNext">下页 ›</button>
        </div>
        <div class="sd-ep-grid" id="sdEpGrid"></div>
    </div>
    <div class="sd-desc-box" id="sdDescBox">
        <div class="sd-desc-text" id="sdDescText"></div>
        <div class="sd-follow-row">
            <button class="sd-follow-btn" id="sdFollowBtn2">＋ 追剧</button>
            <button class="sd-follow-btn ghost" id="sdTrackBtn2">追剧列表</button>
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

    // ===== 设置（导入导出）面板 =====
    const setPanel = document.createElement('div');
    setPanel.className = 'sd-set-mask';
    setPanel.innerHTML = `
<div class="sd-set-box">
    <div class="sd-set-title">追剧数据管理</div>
    <div class="sd-set-info" id="sdSetInfo">共 0 部剧</div>
    <div class="sd-set-info">每部剧按 <b>/video/数字/</b> 存地址，换设备导入即可</div>
    <div class="sd-set-sec">
        <div class="sd-set-label">导出</div>
        <div class="sd-set-btns">
            <button class="sd-set-btn" id="sdExportFile">下载 JSON</button>
            <button class="sd-set-btn" id="sdExportCopy">复制 JSON</button>
            <button class="sd-set-btn" id="sdExportShow">查看 / 全选</button>
        </div>
    </div>
    <div class="sd-set-sec">
        <div class="sd-set-label">导入（先选文件或粘贴，再点导入方式）</div>
        <div class="sd-set-btns">
            <button class="sd-set-btn" id="sdImportPick">选择文件</button>
            <button class="sd-set-btn" id="sdImportMerge">合并导入</button>
            <button class="sd-set-btn danger" id="sdImportOver">覆盖导入</button>
        </div>
        <textarea class="sd-set-area" id="sdSetArea" placeholder="把 JSON 粘贴到这里，或点上面“选择文件”"></textarea>
    </div>
    <div class="sd-set-sec">
        <button class="sd-set-btn danger" id="sdClearAll">清空全部追剧</button>
    </div>
    <div class="sd-set-foot"><button class="sd-close" id="sdSetClose">关闭</button></div>
</div>`;
    document.body.appendChild(setPanel);

    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = '.json,application/json,text/plain';
    importInput.style.display = 'none';
    document.body.appendChild(importInput);

    // ===== toast =====
    const toastEl = document.createElement('div');
    toastEl.className = 'sd-toast';
    document.body.appendChild(toastEl);
    let toastTimer = null;
    function toast(msg){
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(()=>toastEl.classList.remove('show'), 1800);
    }

    let dp = null;
    let current = null;
    let epPage = 1;
    const EP_PER_PAGE = 24;

    // ===== 追剧：记录观看进度 =====
    function recordWatch(){
        if (!current) return;
        const it = findTrack(current.videoId);
        if (!it) return;   // 只有追了的剧才记录
        it.watchedEp = Math.max(it.watchedEp || 0, current.currentEp);
        it.name = current.dramaName || current.title || it.name;
        if (current.cover) it.cover = current.cover;
        it.watchTime = Date.now();
        if (current.totalEp) {
            it.latestEp = Math.max(it.latestEp || 0, current.totalEp);
            // 看到最新一集 → 基准同步为最新，下次更新才提示
            if (it.watchedEp >= current.totalEp) it.knownEp = current.totalEp;
        }
        saveTrack();
    }

    // ===== 追剧：UI 状态同步 =====
    function updateFollowUI(){
        const id = current ? current.videoId : '';
        const on = id ? isFollowed(id) : false;
        const f1 = document.getElementById('sdFollowBtn');
        const f2 = document.getElementById('sdFollowBtn2');
        [f1, f2].forEach(b=>{
            if (!b) return;
            b.classList.toggle('on', on);
            b.textContent = on ? '✓ 已追剧' : '＋ 追剧';
            b.title = on ? '再点一次取消追剧' : '加入追剧库，有更新会提醒';
        });
        const n = trackData.items.length;
        const t1 = document.getElementById('sdTrackBtn');
        const t2 = document.getElementById('sdTrackBtn2');
        if (t1) t1.textContent = '我的追剧(' + n + ')';
        if (t2) t2.textContent = '追剧列表(' + n + ')';
        const up = updateCount();
        if (up > 0) { btnBadge.textContent = up; btnBadge.classList.add('show'); }
        else btnBadge.classList.remove('show');
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
                path: '/video/' + id + '/',
                origin: location.origin,
                name: current.dramaName || current.title || ('剧 ' + id),
                cover: current.cover || '',
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
            const html = await r.text();
            const d = parseVideoHtml(html);
            if (d.totalEp) {
                it.latestEp = d.totalEp;
                if (!it.knownEp) it.knownEp = d.totalEp;  // 首次拿到才补基准，避免一次性 +N
            }
            if (d.updateText) it.updateText = d.updateText;
            const nm = String(d.title || '').replace(/\s*第\d+集\s*$/, '');
            if (nm) it.name = nm;
            if (d.cover) it.cover = d.cover;
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

    // ===== 追剧：列表渲染 =====
    function renderTrackList(){
        const body = document.getElementById('sdTrackBody');
        if (!body) return;
        const items = trackData.items;
        const cnt = document.getElementById('sdTrackCount');
        if (cnt) cnt.textContent = '(' + items.length + ')';

        if (!items.length) {
            body.innerHTML = '<div class="sd-empty">追剧库还是空的<br><br>' +
                '看剧时点播放器里的 <b>＋ 追剧</b> 就能加进来<br>' +
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

        body.innerHTML = sorted.map(function(it){
            const d = diffOf(it);
            let badge = '';
            if (d > 0) badge = '<span class="sd-badge new">+' + d + '集</span>';
            else if (d === 0) badge = '<span class="sd-badge none">未更新</span>';
            else badge = '<span class="sd-badge wait">待检查</span>';

            // 第2行：更新时间 · 更新至 X 集
            const upd = it.updateText ? esc(it.updateText) + ' · ' : '';
            const meta = it.latestEp
                ? (upd + '更新至 第' + it.latestEp + '集')
                : (upd ? upd.replace(/ · $/, '') : '更新信息待获取');
            const seen = it.watchedEp ? ('看到 第' + it.watchedEp + '集') : '还没看过';

            return '<div class="sd-track-item" data-id="' + idOf(it) + '">' +
                '<div class="sd-track-main">' +
                    '<div class="sd-track-row1"><span class="sd-track-name">' + esc(it.name || ('剧 ' + idOf(it))) + '</span>' + badge + '</div>' +
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

        items.forEach(function(it){
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

    function esc(s){
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    async function refreshAll(force){
        const tip = document.getElementById('sdTrackTip');
        const btn = document.getElementById('sdTrackRefresh');
        const items = trackData.items;
        if (!items.length) { renderTrackList(); return; }
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

    function openTrackPanel(){
        trackPanel.style.display = 'flex';
        floatBtn.style.display = 'none';
        try { if (dp) dp.pause(); } catch(e){}
        renderTrackList();
        refreshAll(false);
    }

    function closeTrackPanel(){
        trackPanel.style.display = 'none';
        setPanel.classList.remove('show');
        floatBtn.style.display = '';
        longPressFired = false;
    }

    function playFromTrack(it){
        closeTrackPanel();
        let ep = 1;
        if (it.latestEp) {
            // 有更新就接着看下一集，否则重看上次那一集
            ep = Math.min((it.watchedEp || 0) + 1, it.latestEp);
        } else {
            ep = Math.max(1, it.watchedEp || 1);
        }
        panel.style.display = 'flex';
        openPlayerById(idOf(it), ep, epUrlOf(it, ep));
    }

    // ===== 导入导出 =====
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
                    cover: it.cover || '',
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
    function exportJson(){
        return JSON.stringify(buildExport(), null, 2);
    }
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
                path: o.path || ('/video/' + id + '/'),
                origin: o.origin || location.origin,
                name: o.name || '',
                cover: o.cover || '',
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
                old.name = n.name || old.name;
                old.cover = n.cover || old.cover;
                old.watchedEp = Math.max(old.watchedEp || 0, n.watchedEp || 0);
                old.latestEp = Math.max(old.latestEp || 0, n.latestEp || 0);
                old.knownEp = Math.max(old.knownEp || 0, n.knownEp || 0);
                old.updateText = n.updateText || old.updateText;
                old.addTime = old.addTime || n.addTime;
                old.watchTime = Math.max(old.watchTime || 0, n.watchTime || 0);
            });
        }
        saveTrack();
        renderTrackList();
        updateFollowUI();
        return incoming.length;
    }

    function playM3u8(m3u8, cover){
        document.getElementById('sdLoading').style.display = 'none';
        if (dp) { dp.destroy(); dp = null; }
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
    }

    function renderEpGrid(){
        if (!current) return;
        const totalPages = Math.ceil(current.totalEp / EP_PER_PAGE);
        if (epPage > totalPages) epPage = totalPages;
        if (epPage < 1) epPage = 1;
        const start = (epPage - 1) * EP_PER_PAGE + 1;
        const end = Math.min(current.totalEp, epPage * EP_PER_PAGE);
        let html = '';
        for (let i = start; i <= end; i++) {
            html += `<button class="sd-ep-item ${i===current.currentEp?'active':''}" data-ep="${i}">${i}</button>`;
        }
        document.getElementById('sdEpGrid').innerHTML = html;
        document.querySelectorAll('#sdEpGrid .sd-ep-item').forEach(btn=>{
            btn.onclick = ()=> switchEp(parseInt(btn.dataset.ep));
        });
        document.getElementById('sdEpPagePrev').disabled = epPage <= 1;
        document.getElementById('sdEpPageNext').disabled = epPage >= totalPages;
    }

    function updateBar(){
        if (!current) return;
        document.getElementById('sdEpTag').textContent = '第' + current.currentEp + '集';
        document.getElementById('sdTotalEp').textContent = '共' + current.totalEp + '集';
        document.getElementById('sdPrevEp').disabled = current.currentEp <= 1;
        document.getElementById('sdNextEp').disabled = current.currentEp >= current.totalEp;
        document.getElementById('sdTopPrev').disabled = current.currentEp <= 1;
        document.getElementById('sdTopNext').disabled = current.currentEp >= current.totalEp;
    }

    async function switchEp(ep){
        if (!current || ep === current.currentEp) return;
        if (ep < 1 || ep > current.totalEp) return;
        try{
            const data = await fetchEp(current.videoId, ep);
            current.currentEp = ep;
            if (data.totalEp) current.totalEp = Math.max(current.totalEp, data.totalEp);
            playM3u8(data.m3u8, data.cover);
            renderEpGrid();
            updateBar();
            recordWatch();
        }catch(e){
            document.getElementById('sdLoading').style.display = 'flex';
            document.getElementById('sdLoading').textContent = '加载失败: ' + (e.message||e);
        }
    }

    function closePanel(){
        try{ if (dp) { dp.destroy(); dp = null; } }catch(e){}
        panel.style.display = 'none';
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
        recordWatch();
        if (cur.m3u8) {
            try{ playM3u8(cur.m3u8, cur.cover); }
            catch(e){
                document.getElementById('sdLoading').style.display = 'flex';
                document.getElementById('sdLoading').textContent = '播放器加载失败: ' + (e.message||e);
            }
        } else {
            document.getElementById('sdLoading').style.display = 'flex';
            document.getElementById('sdLoading').textContent = '加载中...';
        }
        // 已追的剧有更新 → 提示一下
        const it = findTrack(cur.videoId);
        if (it && it.latestEp && it.knownEp && it.latestEp > it.knownEp) {
            setTimeout(()=>toast('这部剧更新了 ' + (it.latestEp - it.knownEp) + ' 集，共 ' + it.latestEp + ' 集'), 1200);
        }
    }

    // 用触摸到的id打开（detail=video同id，直接fetch）
    async function openPlayerById(videoId, ep, href){
        panel.style.display = 'flex';
        const loading = document.getElementById('sdLoading');
        loading.style.display = 'flex';
        loading.textContent = '加载中...';
        document.getElementById('sdDramaName').textContent = '加载中...';
        try{
            // 新结构单请求：fetch 一集页面即含 m3u8/总集数/简介/封面，无需再请求第二次
            const data = await fetchEp(videoId, ep, href);
            const totalEp = data.totalEp || ep;
            const desc = data.desc || '';
            current = {
                videoId: data.videoId || videoId,
                currentEp: data.currentEp || ep,
                totalEp,
                m3u8: data.m3u8,
                title: data.title,
                dramaName: (data.title || '').replace(/\s*第\d+集\s*$/, ''),
                cover: data.cover,
                desc
            };
            document.getElementById('sdDramaName').textContent = current.dramaName || '未知剧名';
            document.getElementById('sdDescText').textContent = desc || '暂无简介';
            epPage = Math.ceil(current.currentEp / EP_PER_PAGE);
            renderEpGrid();
            updateBar();
            updateFollowUI();
            recordWatch();
            playM3u8(data.m3u8, data.cover);
        }catch(e){
            loading.style.display = 'flex';
            loading.textContent = '加载失败: ' + (e.message||e);
        }
    }

    floatBtn.onclick = function(){
        if (isDragging) return;
        if (longPressFired) { longPressFired = false; return; }
        if (trackPanel.style.display === 'flex') { closeTrackPanel(); return; }
        if (panel.style.display === 'flex') { closePanel(); return; }
        const cur = parseCurrentPage();
        if (cur) { openPanelFromCurrent(cur); return; }
        if (lastTouched) { openPlayerById(lastTouched.videoId, lastTouched.ep, lastTouched.href); return; }
        alert('请先在列表上摸一下想播的短剧封面，再点我\n（长按按钮可直接打开追剧库）');
    };

    document.getElementById('sdCloseBtn').onclick = closePanel;
    document.getElementById('sdPrevEp').onclick = ()=> switchEp(current.currentEp - 1);
    document.getElementById('sdNextEp').onclick = ()=> switchEp(current.currentEp + 1);
    document.getElementById('sdTopPrev').onclick = ()=> switchEp(current.currentEp - 1);
    document.getElementById('sdTopNext').onclick = ()=> switchEp(current.currentEp + 1);
    document.getElementById('sdEpPagePrev').onclick = ()=>{ epPage--; renderEpGrid(); };
    document.getElementById('sdEpPageNext').onclick = ()=>{ epPage++; renderEpGrid(); };
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
    document.getElementById('sdFollowBtn').onclick = toggleFollow;
    document.getElementById('sdFollowBtn2').onclick = toggleFollow;
    document.getElementById('sdTrackBtn').onclick = openTrackPanel;
    document.getElementById('sdTrackBtn2').onclick = openTrackPanel;

    // ===== 追剧面板事件 =====
    document.getElementById('sdTrackClose').onclick = closeTrackPanel;
    document.getElementById('sdTrackSet').onclick = function(){
        document.getElementById('sdSetInfo').textContent =
            '共 ' + trackData.items.length + ' 部剧 · ' + updateCount() + ' 部有更新';
        setPanel.classList.add('show');
    };
    document.getElementById('sdTrackRefresh').onclick = function(){ refreshAll(true); };
    setPanel.addEventListener('click', function(e){
        if (e.target === setPanel) setPanel.classList.remove('show');
    });
    document.getElementById('sdSetClose').onclick = function(){ setPanel.classList.remove('show'); };

    document.getElementById('sdExportFile').onclick = function(){
        const d = new Date();
        const name = '追剧数据_' + d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) +
                     '_' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
        downloadJson(exportJson(), name);
        toast('已导出 ' + trackData.items.length + ' 部剧');
    };
    document.getElementById('sdExportCopy').onclick = function(){
        const ok = copyText(exportJson());
        toast(ok ? 'JSON 已复制到剪贴板' : '复制失败，请用“查看”手动复制');
    };
    document.getElementById('sdExportShow').onclick = function(){
        const area = document.getElementById('sdSetArea');
        area.value = exportJson();
        area.style.display = '';
        area.focus();
        area.select();
        toast('已生成，长按可全选复制');
    };
    document.getElementById('sdImportPick').onclick = function(){ importInput.click(); };
    importInput.onchange = function(){
        const f = importInput.files && importInput.files[0];
        if (!f) return;
        const fr = new FileReader();
        fr.onload = function(){
            const area = document.getElementById('sdSetArea');
            area.value = String(fr.result || '');
            area.style.display = '';
            toast('已读入 ' + f.name + '，选择导入方式');
        };
        fr.readAsText(f, 'utf-8');
        importInput.value = '';
    };
    document.getElementById('sdImportMerge').onclick = function(){
        const text = document.getElementById('sdSetArea').value.trim();
        if (!text) { toast('先粘贴 JSON 或选择文件'); return; }
        const n = doImport(text, 'merge');
        if (n) {
            toast('合并导入 ' + n + ' 部，现共 ' + trackData.items.length + ' 部');
            document.getElementById('sdSetInfo').textContent =
                '共 ' + trackData.items.length + ' 部剧 · ' + updateCount() + ' 部有更新';
        }
    };
    document.getElementById('sdImportOver').onclick = function(){
        const text = document.getElementById('sdSetArea').value.trim();
        if (!text) { toast('先粘贴 JSON 或选择文件'); return; }
        if (!confirm('覆盖导入会替换掉当前的全部追剧数据，确定？')) return;
        const n = doImport(text, 'over');
        if (n) {
            toast('覆盖导入 ' + n + ' 部');
            document.getElementById('sdSetInfo').textContent =
                '共 ' + trackData.items.length + ' 部剧 · ' + updateCount() + ' 部有更新';
        }
    };
    document.getElementById('sdClearAll').onclick = function(){
        if (!trackData.items.length) { toast('已经是空的了'); return; }
        if (!confirm('确定清空全部 ' + trackData.items.length + ' 部追剧？建议先导出备份。')) return;
        trackData.items = [];
        saveTrack();
        renderTrackList();
        updateFollowUI();
        document.getElementById('sdSetInfo').textContent = '共 0 部剧';
        toast('已清空');
    };

    // 自愈兜底
    setInterval(function(){
        floatBtn.style.setProperty('z-index', '2147483647', 'important');
        if (panel.style.display === 'flex' || trackPanel.style.display === 'flex') return;
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
        if (trackPanel.style.display === 'flex') return;
        const cur = parseCurrentPage();
        if (!cur) return;
        const key = cur.videoId + ':' + cur.currentEp;
        if (autoOpenedKey === key) return;
        if (cur.m3u8) {
            autoOpenedKey = key;
            openPanelFromCurrent(cur);
        } else {
            await sleep(300);
            tryAutoOpen(remaining - 1);
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

    // ===== 后台静默检查（进站 12 秒后，30 分钟内只跑一次）=====
    let silentRunning = false;
    async function silentCheck(){
        if (silentRunning) return;
        const items = trackData.items;
        if (!items.length) return;
        let newest = 0;
        items.forEach(it=>{ if ((it.checkTime || 0) > newest) newest = it.checkTime; });
        if (newest && Date.now() - newest < 30 * 60 * 1000) { updateFollowUI(); return; }
        silentRunning = true;
        await checkAll(items.slice(), false);
        silentRunning = false;
        updateFollowUI();
        const n = updateCount();
        if (n > 0) toast('有 ' + n + ' 部剧更新了，长按▶打开追剧库');
    }
    setTimeout(function(){
        if (!parseCurrentPage()) silentCheck();
    }, 12000);

    updateFollowUI();

    console.log('▶️ 短剧干净播放器V4.0已加载（追剧库：追剧/更新提醒/进度记录/JSON导入导出）');
})();
