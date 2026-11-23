// ==UserScript==
// @name         图片收藏精简版V9‑14【修改：顶部标题只显示content_xxxx】
// @namespace    http://tampermonkey.net/
// @version      9.14.1
// @description  V9‑13基础：大图关闭按钮放大；收藏页顶部新增当前文章标题+发布时间栏（仅content_数字.html页面更新），标题改为可跳转链接，**只显示content_xxxx，不带域名**，路径不带.html
// @author       You
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';
    const PAGE_SIZE = 8;
    const STORAGE_KEY = "img_collect_v9";
    const RULES_KEY = "img_grab_rules";
    const FILTER_RULES_KEY = "img_filter_rules";
    const ARTICLE_INFO_KEY = "current_article_info";
    //====配置====
    const ASPECT_THRESHOLD = 2.8;
    const ENABLE_DEBUG_LOG = true;
    //================

    let collectList = GM_getValue(STORAGE_KEY, []);
    let grabRules = GM_getValue(RULES_KEY, []);
    let filterRules = GM_getValue(FILTER_RULES_KEY, [
        "logo","banner","advert","ad.","ads.","icon","button","slogan"
    ]);
    const tempAddedUrls = new Set();

    GM_addStyle(`
#floatMainBtn{position:fixed;width:44px;height:44px;border-radius:10px;background:rgba(0,0,0,0.22);color:rgba(255,255,255,0.6);font-size:22px;text-align:center;line-height:44px;cursor:move;z-index:9999999;user-select:none;border:1px solid rgba(255,255,255,0.1);}
#floatMainBtn:active{opacity:0.75;}
#collectAlbumWrap{position:fixed;inset:0;background:#111;z-index:99999999;display:none;overflow-y:auto;}
.album-header{position:sticky;top:0;background:#1e1e1e;padding:12px 16px;display:flex;align-items:center;}
.album-header h3{color:#fff;margin:0;font-size:14px;white-space:nowrap;}
.header-right-group{display:flex;gap:8px;align-items:center;white-space:nowrap;margin-left:auto;flex-shrink:0;}
/* 新增：文章信息栏 */
.album-subheader{display:flex;align-items:center;gap:12px;padding:0 16px 10px 16px;background:#1e1e1e;border-bottom:1px solid #333;}
.album-article-title{flex:1;color:#bbb;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
.album-article-title a{color:#6cf;text-decoration:none;}
.album-article-title a:hover{text-decoration:underline;}
.album-article-time{color:#888;font-size:12px;white-space:nowrap;flex-shrink:0;}
.btn{padding:5px 8px;border:none;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap;}
.btn-red{background:#ef4444;color:#fff;}
.btn-blue{background:#2563eb;color:#fff;}
.btn-gray{background:#555;color:#fff;}
.album-grid{padding:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;}
.album-card{aspect-ratio:1/1;background:#222;border-radius:8px;overflow:hidden;cursor:pointer;}
.album-card img{width:100%;height:100%;object-fit:contain;}
.page-control{display:flex;gap:10px;padding:16px;justify-content:center;flex-wrap:wrap;}
.page-control span{color:#fff;line-height:36px;}

#lightboxModal{position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:999999999;display:none;}
/* 关闭按钮放大 */
.lightbox-close{position:absolute;top:14px;right:16px;color:#fff;font-size:44px;cursor:pointer;z-index:10;width:56px;height:56px;line-height:52px;text-align:center;border-radius:50%;background:rgba(255,255,255,0.08);}
.lightbox-close:active{background:rgba(255,255,255,0.18);}
.lightbox-content{width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:12px;position:relative;}
.lightbox-content img{max-width:100%;max-height:88vh;position:relative;z-index:3;pointer-events:none;}
.lightbox-click-left{position:absolute;left:0;top:0;width:30%;height:100%;z-index:2;cursor:pointer;}
.lightbox-click-right{position:absolute;right:0;top:0;width:30%;height:100%;z-index:2;cursor:pointer;}
.lightbox-del{position:absolute;bottom:30px;left:50%;transform:translateX(-50%);background:#ef4444;color:#fff;padding:8px 16px;border-radius:8px;border:none;cursor:pointer;z-index:4;}

.config-panel{position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:1000000000;display:none;overflow-y:auto;padding:16px;box-sizing:border-box;}
.config-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}
.config-panel h4{color:#fff;margin:0 0 8px 0;font-size:14px;}
.config-item{background:#222;padding:10px;border-radius:6px;margin-bottom:8px;color:#fff;font-size:13px;}
.config-item input{width:100%;box-sizing:border-box;padding:6px;margin:4px 0;background:#333;color:#fff;border:1px solid #444;border-radius:4px;}
hr{border-color:#444;margin:14px 0;}

.toast-notice{position:fixed;left:50%;bottom:80px;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:10px 18px;border-radius:8px;z-index:9999999999;font-size:14px;pointer-events:none;opacity:0;transition:opacity 0.25s ease;}
.toast-notice.show{opacity:1;}
`);

function showToastEx(text, ms){
    let toast = document.querySelector(".toast-notice");
    if(!toast){
        toast = document.createElement("div");
        toast.className = "toast-notice";
        document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(()=>{
        toast.classList.remove("show");
    }, ms);
}

//====新增：从当前页面提取文章标题和发布时间，仅content_数字.html页面执行====
function extractArticleInfo(){
    // 仅匹配 /content_5到6位数字.html 格式
    if(!/\/content_\d{1,6}\.html/i.test(location.pathname)){
        if(ENABLE_DEBUG_LOG) console.log("[文章信息] URL格式不匹配，跳过提取");
        return;
    }

    let title = "";
    let pubTime = "";

    // 提取标题：h3.ttle，去掉里面的span（如10P）
    const titleEl = document.querySelector('h3.ttle');
    if(titleEl){
        const clone = titleEl.cloneNode(true);
        const span = clone.querySelector('span');
        if(span) span.remove();
        title = clone.textContent.trim();
    }

    // 提取发布时间：在.artical-content下找含"发布时间"的p
    const contentEl = document.querySelector('.artical-content');
    if(contentEl){
        const pList = contentEl.querySelectorAll('p');
        for(let i=0;i<pList.length;i++){
            const txt = pList[i].textContent;
            if(txt.indexOf('发布时间') >= 0){
                const m = txt.match(/\d{4}-\d{2}-\d{2}/);
                if(m) pubTime = m[0];
                break;
            }
        }
    }

    if(title || pubTime){
        GM_setValue(ARTICLE_INFO_KEY, {
            title: title,
            time: pubTime,
            url: location.href,
            updateAt: Date.now()
        });
        if(ENABLE_DEBUG_LOG) console.log("[文章信息] 已更新 title:"+title+" time:"+pubTime);
    }else{
        if(ENABLE_DEBUG_LOG) console.log("[文章信息] 未找到标题或时间，不更新");
    }
}

//====【修改这里】打开相册时刷新顶部文章信息栏，标题改为可点击链接，**只展示content_xxxx**====
function updateAlbumSubHeader(){
    const info = GM_getValue(ARTICLE_INFO_KEY, null);
    const titleEl = document.getElementById('albumArticleTitle');
    const timeEl = document.getElementById('albumArticleTime');
    if(!titleEl || !timeEl) return;

    if(info && info.url){
        const urlObj = new URL(info.url);
        // 去掉.html后缀
        let rawPath = urlObj.pathname.replace(/\.html$/i,"");
        // 分割路径，只取最后一段 content_xxxx
        const pathArr = rawPath.split('/');
        const showText = pathArr.pop() || '';
        // 跳转链接保持原始url不变
        titleEl.innerHTML = `<a target="_blank" href="${info.url}">${showText}</a>`;
        timeEl.textContent = info.time || '';
    }else{
        titleEl.textContent = '未记录文章信息（进入content_数字.html页面后自动记录）';
        timeEl.textContent = '';
    }
}

//====natural宽高比广告判断====
function checkBannerAspect(imgEl){
    const natW = imgEl.naturalWidth;
    const natH = imgEl.naturalHeight;
    if(natW <=0 || natH <=0){
        if(ENABLE_DEBUG_LOG) console.log("[比例校验] natural=0，直接放行");
        return false;
    }
    const ratio = Number((natW / natH).toFixed(2));
    if(ENABLE_DEBUG_LOG) console.log("[比例校验] natural:"+natW+"x"+natH+" ratio:"+ratio+" threshold:"+ASPECT_THRESHOLD);
    return ratio > ASPECT_THRESHOLD;
}

//悬浮球拖拽
const floatMainBtn = document.createElement('div');
floatMainBtn.id = "floatMainBtn";
floatMainBtn.textContent = "★";
const floatPos = GM_getValue("float_pos", {top:"100px", right:"18px", left:"auto"});
Object.assign(floatMainBtn.style, floatPos);
document.body.appendChild(floatMainBtn);

let isDragging = false, startX, startY, btnLeft, btnTop;
function startDrag(e) {
    isDragging = true;
    const rect = floatMainBtn.getBoundingClientRect();
    btnLeft = rect.left;
    btnTop = rect.top;
    startX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
    startY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
}
function dragMove(e) {
    if (!isDragging) return;
    const x = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
    const y = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
    floatMainBtn.style.left = btnLeft + (x - startX) + 'px';
    floatMainBtn.style.top = btnTop + (y - startY) + 'px';
    floatMainBtn.style.right = 'auto';
}
function stopDrag() {
    if (!isDragging) return;
    isDragging = false;
    GM_setValue("float_pos", {
        top: floatMainBtn.style.top,
        left: floatMainBtn.style.left,
        right:"auto"
    });
}

floatMainBtn.addEventListener('mousedown', startDrag);
floatMainBtn.addEventListener('touchstart', startDrag, { passive:true });
document.addEventListener('mousemove', dragMove);
document.addEventListener('touchmove', dragMove, { passive:true });
document.addEventListener('mouseup', stopDrag);
document.addEventListener('touchend', stopDrag);

const albumWrap = document.createElement('div');
albumWrap.id = "collectAlbumWrap";
albumWrap.innerHTML = `
<div class="album-header">
    <h3>我的收藏</h3>
    <div class="header-right-group">
        <button id="saveAllBtn" class="btn btn-blue">一键收藏</button>
        <button id="delCurrentPageBtn" class="btn btn-red">删除本页</button>
        <button id="openSettingBtn" class="btn btn-gray">设置</button>
        <button id="closeAlbumBtn" class="btn btn-red">关闭</button>
    </div>
</div>
<div class="album-subheader">
    <span class="album-article-title" id="albumArticleTitle">-</span>
    <span class="album-article-time" id="albumArticleTime">-</span>
</div>
<div class="album-grid" id="albumGridBox"></div>
<div class="page-control">
    <button id="prevPage">上一页</button>
    <span id="pageInfo">1 / 1</span>
    <button id="nextPage">下一页</button>
</div>
`;
document.body.appendChild(albumWrap);

const lightboxModal = document.createElement('div');
lightboxModal.id = "lightboxModal";
lightboxModal.innerHTML = `
<div class="lightbox-close" id="closeLightbox">×</div>
<div class="lightbox-content">
    <div class="lightbox-click-left" id="lbClickLeft"></div>
    <img id="lightboxImg" src="">
    <div class="lightbox-click-right" id="lbClickRight"></div>
</div>
<button class="lightbox-del" id="lightboxDelBtn">删除</button>
`;
document.body.appendChild(lightboxModal);

const configPanel = document.createElement('div');
configPanel.className = "config-panel";
configPanel.innerHTML = `
<div class="config-header">
    <h4>设置</h4>
    <button id="closeConfigPanel" class="btn btn-red">关闭设置</button>
</div>
<h4>备份与恢复</h4>
<input type="file" id="importFileInput" accept=".json" style="margin:8px 0;">
<button id="exportJson" class="btn btn-blue">导出备份</button>
<button id="cleanDuplicateBtn" class="btn btn-red" style="margin‑left:8px;">清理收藏库重复项</button>
<hr>
<h4>网站抓取规则</h4>
<div class="config-item">
    <input id="ruleDomain" placeholder="域名，如 xxx.com">
    <input id="ruleProp" placeholder="属性，如 dataset.original / src">
    <button id="addRuleBtn" class="btn btn-blue">新增抓取规则</button>
</div>
<div id="ruleListBox"></div>
<hr>
<h4>图片过滤规则（URL关键词命中即不收藏）</h4>
<div class="config-item">
    <input id="filterKeyword" placeholder="关键词如 logo banner ad">
    <button id="addFilterRuleBtn" class="btn btn-blue">新增过滤关键词</button>
</div>
<div id="filterRuleListBox"></div>
`;
document.body.appendChild(configPanel);

let currentPage = 1;
let lightboxIndex = -1;

function getCurrentRule(){
    const host = window.location.host;
    for(const r of grabRules){
        if(host.includes(r.domain)) return r;
    }
    return null;
}

function getRealImageSrc(imgEl){
    const rule = getCurrentRule();
    if(!rule) return imgEl.src;
    try{
        const val = eval(`imgEl.${rule.prop}`);
        if(val) return val;
    }catch(e){}
    return imgEl.src;
}

function isFilterUrl(url){
    const lowerUrl = url.toLowerCase();
    for(let kw of filterRules){
        if(kw && lowerUrl.includes(kw.toLowerCase())){
            return true;
        }
    }
    return false;
}

function saveImage(imgEl) {
    if(imgEl.dataset.skipCollect === "1"){
        console.log("🟡跳过脚本相册内部图片");
        return false;
    }
    if(imgEl.width<40 || imgEl.height<40){
        showToastEx("图片尺寸过小，跳过",1200);
        return false;
    }
    if(checkBannerAspect(imgEl)){
        showToastEx("过滤广告 1 张",1200);
        return false;
    }

    let src = getRealImageSrc(imgEl);
    if(src.startsWith("blob:")){
        console.log("🟡Blob资源不支持收藏 "+src);
        showToastEx("Blob资源不支持收藏",1200);
        return false;
    }
    if(isFilterUrl(src)){
        console.log("🟡命中过滤规则跳过 "+src);
        showToastEx("命中过滤规则，跳过",1200);
        return false;
    }
    if(tempAddedUrls.has(src)){
        console.log("🟡本次会话已经添加过，跳过 "+src);
        showToastEx("本次会话已收藏，跳过",1200);
        return false;
    }
    tempAddedUrls.add(src);
    collectList = GM_getValue(STORAGE_KEY, []);
    collectList.unshift({
        mediaUrl: src,
        pageUrl: window.location.href,
        time: Date.now()
    });
    GM_setValue(STORAGE_KEY, collectList);
    console.log("🟢单图收藏成功 url:"+src);
    showToastEx("单图收藏成功",1200);
    return true;
}

function saveAllPageImages(){
    const imgs = Array.from(document.querySelectorAll('img'))
        .filter(img=>{
            if(img.dataset.skipCollect === "1") return false;
            return img.width>=40&&img.height>=40;
        });
    const valid = [];
    const skipTemp = [];
    let bannerFilterCount = 0;

    imgs.forEach(img=>{
        if(checkBannerAspect(img)){
            bannerFilterCount++;
            return;
        }
        const s = getRealImageSrc(img);
        if(s.startsWith("blob:") || isFilterUrl(s)) return;
        if(tempAddedUrls.has(s)){
            skipTemp.push(s);
            return;
        }
        valid.push(s);
    });

    if(valid.length===0 && skipTemp.length===0 && bannerFilterCount===0){
        showToastEx("本页没有可收藏图片",2200);
        return;
    }
    skipTemp.forEach(u=>console.log("🟡一键收藏：本次会话已添加 "+u));

    collectList = GM_getValue(STORAGE_KEY, []);
    for(let i = valid.length -1; i >=0; i--){
        const url = valid[i];
        tempAddedUrls.add(url);
        collectList.unshift({mediaUrl:url,pageUrl:location.href,time:Date.now()});
        console.log("🟢一键收藏新增 url:"+url);
    }
    GM_setValue(STORAGE_KEY, collectList);
    showToastEx("✅一键收藏：新增"+valid.length+"张，会话重复跳过"+skipTemp.length+"张，过滤广告 "+bannerFilterCount+" 张",2800);
    renderAlbum();
}

function cleanDuplicateItems(){
    const originList = GM_getValue(STORAGE_KEY, []);
    const originTotal = originList.length;
    const urlMap = new Map();
    originList.forEach(item=>{
        const url = item.mediaUrl;
        if(!urlMap.has(url)){
            urlMap.set(url, item);
        }else{
            const exist = urlMap.get(url);
            if(item.time > exist.time){
                urlMap.set(url, item);
            }
        }
    });
    const newList = Array.from(urlMap.values());
    const afterTotal = newList.length;
    const delCount = originTotal - afterTotal;
    GM_setValue(STORAGE_KEY, newList);
    renderAlbum();
    const msg = "清理完成：原始"+originTotal+"条，删除重复"+delCount+"条，剩余"+afterTotal+"条";
    console.log("🧹"+msg);
    showToastEx(msg,3000);
}

function deleteCurrentPageItems(){
    if(!confirm("确定删除本页全部图片？此操作不可恢复！")){
        return;
    }
    collectList = GM_getValue(STORAGE_KEY, []);
    const start = (currentPage -1)*PAGE_SIZE;
    const delCount = collectList.slice(start, start+PAGE_SIZE).length;
    collectList.splice(start, PAGE_SIZE);
    GM_setValue(STORAGE_KEY, collectList);
    GM_setValue(STORAGE_KEY, collectList);
    renderAlbum();
    console.log("🔴删除本页，移除条目数:"+delCount);
}

function renderRuleList(){
    const box = document.getElementById("ruleListBox");
    box.innerHTML = "";
    grabRules.forEach((r,i)=>{
        const div = document.createElement("div");
        div.className="config-item";
        div.innerHTML = "域名:"+r.domain+" | 属性:"+r.prop+' <button data-idx="'+i+'" class="del-rule btn btn-red">删除</button>';
        box.appendChild(div);
    });
    box.querySelectorAll(".del-rule").forEach(el=>{
        el.onclick = ()=>{
            const idx = Number(el.dataset.idx);
            grabRules.splice(idx,1);
            GM_setValue(RULES_KEY,grabRules);
            renderRuleList();
            console.log("🔴删除抓取规则下标:"+idx);
        }
    })
}

function renderFilterRuleList(){
    const box = document.getElementById("filterRuleListBox");
    box.innerHTML = "";
    filterRules.forEach((kw,i)=>{
        const div = document.createElement("div");
        div.className="config-item";
        div.innerHTML = "关键词："+kw+' <button data-fidx="'+i+'" class="del-filter-rule btn btn-red">删除</button>';
        box.appendChild(div);
    });
    box.querySelectorAll(".del-filter-rule").forEach(el=>{
        el.onclick = ()=>{
            const idx = Number(el.dataset.fidx);
            filterRules.splice(idx,1);
            GM_setValue(FILTER_RULES_KEY,filterRules);
            renderFilterRuleList();
            console.log("🔴删除过滤关键词:"+kw);
        }
    })
}

function exportBackup(){
    collectList = GM_getValue(STORAGE_KEY, []);
    const blob = new Blob([JSON.stringify(collectList,null,2)],{type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "img_collect_backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
    console.log("🟢导出JSON备份完成");
}

document.getElementById("importFileInput").addEventListener("change",function(e){
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ev=>{
        try{
            const arr = JSON.parse(ev.target.result);
            if(!Array.isArray(arr)) throw 0;
            collectList = GM_getValue(STORAGE_KEY, collectList);
            collectList.unshift(...arr);
            GM_setValue(STORAGE_KEY, collectList);
            showToastEx("✅导入完成，共导入"+arr.length+"条",1200);
            renderAlbum();
            console.log("🟢导入JSON备份，导入"+arr.length+"条，重复请手动执行清理重复项");
        }catch(err){
            showToastEx("❌JSON格式错误",1200);
            console.log("🔴导入JSON失败，格式异常");
        }
        e.target.value = "";
    };
    reader.readAsText(file);
});

document.getElementById("cleanDuplicateBtn").addEventListener("click",function(){
    const ok = confirm("⚠️建议先导出备份！\n该操作会清理库内url重复条目，同一个图片仅保留最新一条，删除其余重复，确认执行？");
    if(ok){
        cleanDuplicateItems();
    }
});

function renderAlbum(){
    collectList = GM_getValue(STORAGE_KEY, []);
    const total = collectList.length;
    const totalPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if(currentPage>totalPage) currentPage = totalPage;
    if(currentPage<1) currentPage = 1;
    const start = (currentPage -1)*PAGE_SIZE;
    const slice = collectList.slice(start, start+PAGE_SIZE);
    document.getElementById('pageInfo').textContent = currentPage+"/"+totalPage;
    const grid = document.getElementById('albumGridBox');
    grid.innerHTML = '';
    slice.forEach((item,i)=>{
        const realIdx = start+i;
        const card = document.createElement('div');
        card.className = 'album-card';
        card.innerHTML = '<img data-skip-collect="1" src="'+item.mediaUrl+'" loading="lazy">';
        card.onclick = ()=>{
            lightboxIndex = realIdx;
            document.getElementById('lightboxImg').src = collectList[realIdx].mediaUrl;
            lightboxModal.style.display = 'block';
        };
        grid.appendChild(card);
    })
}

function prevLight(){
    if(lightboxIndex <= 0) return;
    lightboxIndex--;
    document.getElementById('lightboxImg').src = collectList[lightboxIndex].mediaUrl;
}
function nextLight(){
    if(lightboxIndex >= collectList.length-1) return;
    document.getElementById('lightboxImg').src = collectList[lightboxIndex].mediaUrl;
    lightboxIndex++;
}

function deleteLightboxItem(){
    collectList.splice(lightboxIndex,1);
    GM_setValue(STORAGE_KEY, collectList);
    if(lightboxIndex < collectList.length){
        document.getElementById('lightboxImg').src = collectList[lightboxIndex].mediaUrl;
    }else{
        lightboxModal.style.display = 'none';
    }
    renderAlbum();
    console.log("🔵大图预览删除原下标:"+lightboxIndex);
}

floatMainBtn.onclick = function(){
    if(isDragging) return;
    currentPage = 1;
    renderAlbum();
    updateAlbumSubHeader(); // 打开相册时刷新顶部文章信息
    albumWrap.style.display = 'block';
};
document.getElementById('closeAlbumBtn').onclick = ()=>{
    albumWrap.style.display = 'none';
};
document.getElementById('closeLightbox').onclick = ()=>{
    lightboxModal.style.display = 'none';
};
document.getElementById('lbClickLeft').onclick = prevLight;
document.getElementById('lbClickRight').onclick = nextLight;
document.getElementById('lightboxDelBtn').onclick = deleteLightboxItem;
document.getElementById('prevPage').onclick = ()=>{currentPage--;renderAlbum();};
document.getElementById('nextPage').onclick = ()=>{currentPage++;renderAlbum();};
document.getElementById('saveAllBtn').onclick = saveAllPageImages;
document.getElementById('delCurrentPageBtn').onclick = deleteCurrentPageItems;

document.getElementById('openSettingBtn').onclick = ()=>{
    configPanel.style.display="block";
    renderRuleList();
    renderFilterRuleList();
};
document.getElementById('closeConfigPanel').onclick = ()=>{configPanel.style.display="none";};
document.getElementById('exportJson').onclick = exportBackup;

document.getElementById('addRuleBtn').onclick = ()=>{
    const dom = document.getElementById("ruleDomain").value.trim();
    const prop = document.getElementById("ruleProp").value.trim();
    if(!dom||!prop){showToastEx("域名与属性不能为空",1200);return;}
    grabRules.push({domain:dom,prop:prop});
    GM_setValue(RULES_KEY,grabRules);
    document.getElementById("ruleDomain").value="";
    document.getElementById("ruleProp").value="";
    renderRuleList();
    console.log("🟢新增抓取规则 域名:"+dom+",属性:"+prop);
};

document.getElementById('addFilterRuleBtn').onclick = ()=>{
    const kw = document.getElementById("filterKeyword").value.trim();
    if(!kw){showToastEx("过滤关键词不能为空",1200);return;}
    filterRules.push(kw);
    GM_setValue(FILTER_RULES_KEY, filterRules);
    document.getElementById("filterKeyword").value = "";
    renderFilterRuleList();
    console.log("🟢新增过滤关键词："+kw);
};

//长按收藏，1000ms
let pressTimer = null;
document.addEventListener('touchstart',e=>{
    const target = e.target;
    if(target.tagName!=='IMG') return;
    if(target.width<40||target.height<40) return;
    pressTimer = setTimeout(()=>{
        saveImage(target);
    },1000);
});
document.addEventListener('touchend',()=>{
    if(pressTimer){
        clearTimeout(pressTimer);
        pressTimer=null;
    }
});

// 页面加载完成后延迟提取文章信息（等待DOM渲染）
function tryExtractArticle(){
    setTimeout(extractArticleInfo, 800);
}
if(document.readyState === 'complete'){
    tryExtractArticle();
}else{
    window.addEventListener('load', tryExtractArticle);
}

console.log("▶️图片收藏脚本V9‑14.1已加载；natural宽高比2.8广告过滤；收藏页顶部文章信息栏；标题改为可点击链接，仅展示content_xxxx，路径去除.html；大图关闭按钮放大");
})();
