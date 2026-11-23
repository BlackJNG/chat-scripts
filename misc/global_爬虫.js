// ==UserScript==
// @name         自拍图库爬虫V1.3
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  适配新版/album/{id}结构，遍历抓数据，断点续爬，失败id记录重试，JSON导入检测补爬
// @author       You
// @match        *://xn--wst-zipaipiccom-6m3z988bh2ek30lissa.zipaippp.com/*
// @require      https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/crypto-js.min.js
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';
    //====配置====
    const AES_KEY_STR = 'DFVG$W^H%jh67j6j';
    const DELAY_MS = 400;
    const BATCH_SAVE = 50;
    const MAX_AID = 100600;
    const PROGRESS_KEY = 'spider_progress_v1';
    const FAILED_KEY = 'spider_failed_aids_v1';
    //=============

    let progress = GM_getValue(PROGRESS_KEY, {nextAid:1, done:0, fail:0});
    let failedAids = GM_getValue(FAILED_KEY, []);
    let results = [];
    let running = false;
    let retrying = false;

    GM_addStyle(`
#spiderPanel{position:fixed;bottom:80px;right:10px;z-index:9999998;background:#1a1a1a;color:#eee;border-radius:12px;padding:14px;width:300px;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);display:none;font-family:-apple-system,"PingFang SC",sans-serif;}
#spiderPanel.show{display:block;}
#spiderToggle{position:fixed;bottom:10px;right:10px;z-index:9999998;width:48px;height:48px;border-radius:50%;background:#2563eb;color:#fff;font-size:20px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,0.4);}
#spiderPanel h4{margin:0 0 8px;font-size:14px;color:#fff;}
#spiderPanel .row{margin:6px 0;display:flex;align-items:center;gap:6px;}
#spiderPanel label{color:#aaa;white-space:nowrap;}
#spiderPanel input{flex:1;background:#2a2a2a;border:1px solid #333;color:#fff;border-radius:6px;padding:5px 8px;font-size:12px;min-width:0;}
#spiderPanel .btns{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;}
#spiderPanel button{flex:1;background:#2563eb;color:#fff;border:none;padding:8px;border-radius:6px;font-size:12px;cursor:pointer;white-space:nowrap;}
#spiderPanel button.warn{background:#ef4444;}
#spiderPanel button.gray{background:#555;}
#spiderPanel button.green{background:#16a34a;}
#spiderPanel .stats{background:#222;border-radius:6px;padding:8px;margin-top:8px;line-height:1.6;}
#spiderPanel .stats b{color:#6cf;}
#spiderPanel .tip{color:#888;font-size:11px;margin-top:6px;line-height:1.4;}
#spiderPanel .fail-badge{display:inline-block;background:#ef4444;color:#fff;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px;}
`);

    const toggleBtn = document.createElement('div');
    toggleBtn.id = 'spiderToggle';
    toggleBtn.textContent = '爬';
    document.body.appendChild(toggleBtn);

    const panel = document.createElement('div');
    panel.id = 'spiderPanel';
    panel.innerHTML = `
<h4>自拍图库爬虫</h4>
<div class="row"><label>从</label><input type="number" id="spStart" value="${progress.nextAid}"><label>到</label><input type="number" id="spEnd" value="${MAX_AID}"></div>
<div class="row"><label>间隔ms</label><input type="number" id="spDelay" value="${DELAY_MS}"></div>
<div class="stats">
  已爬:<b id="stDone">${progress.done}</b> &nbsp; 失败:<b id="stFail">${progress.fail}</b> <span class="fail-badge" id="stFailBadge" style="display:none"></span><br>
  内存:<b id="stMem">0</b>条<br>
当前:<b id="stCur">-</b>
</div>
<div class="btns">
  <button id="btnStart">开始</button>
  <button id="btnStop" class="warn">暂停</button>
</div>
<div class="btns">
  <button id="btnRetry" class="green">重试失败</button>
  <button id="btnCheck" class="gray">JSON补爬</button>
</div>
<div class="btns">
  <button id="btnExport" class="gray">导出JSON</button>
  <button id="btnMerge" class="gray">合并JSON</button>
  <button id="btnReset" class="gray">重置</button>
</div>
<div class="btns">
  <button id="btnExport404" class="warn">导出404</button>
  <button id="btnExportOther" class="warn">导出其他失败</button>
</div>
<div class="btns">
  <button id="btnFindMissing" class="warn">导入JSON找缺失</button>
  <button id="btnExportMissing" class="warn">导出缺失id</button>
</div>
<div class="btns">
  <button id="btnRetryFromList" class="warn">导入缺失列表直接补爬</button>
</div>
<div class="tip">每爬1000~2000篇点导出备份。"导入缺失列表直接补爬"直接选之前导出的缺失id文件，立刻开爬，不用再对比找缺失。</div>
`;
    document.body.appendChild(panel);
    toggleBtn.onclick = ()=> panel.classList.toggle('show');
// 悬浮窗可拖动
    let dragging = false, dragX=0, dragY=0, origX=0, origY=0;
    panel.addEventListener('mousedown', (e)=>{
        dragging = true;
        dragX = e.clientX; dragY = e.clientY;
        const rect = panel.getBoundingClientRect();
        origX = rect.left; origY = rect.top;
        panel.style.transition = 'none';
    });
    document.addEventListener('mousemove', (e)=>{
        if(!dragging) return;
        const dx = e.clientX - dragX;
        const dy = e.clientY - dragY;
        panel.style.left = (origX + dx) + 'px';
        panel.style.top = (origY + dy) + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', ()=>{ dragging = false; });
    // 手机触摸拖动
    panel.addEventListener('touchstart', (e)=>{
        dragging = true;
        const t = e.touches[0];
        dragX = t.clientX; dragY = t.clientY;
        const rect = panel.getBoundingClientRect();
        origX = rect.left; origY = rect.top;
panel.style.transition = 'none';
    });
    panel.addEventListener('touchmove', (e)=>{
        if(!dragging) return;
        const t = e.touches[0];
        const dx = t.clientX - dragX;
        const dy = t.clientY - dragY;
        panel.style.left = (origX + dx) + 'px';
        panel.style.top = (origY + dy) + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        e.preventDefault();
    }, {passive:false});
    panel.addEventListener('touchend', ()=>{ dragging = false; });

    // AES解密
    const keyWA = CryptoJS.enc.Utf8.parse(AES_KEY_STR);
    function decryptImgUrl(rdata){
        try{
            const cipherParams = CryptoJS.lib.CipherParams.create({
                ciphertext: CryptoJS.enc.Base64.parse(rdata)
            });
            const dec = CryptoJS.AES.decrypt(cipherParams, keyWA, {
                mode: CryptoJS.mode.ECB,
                padding: CryptoJS.pad.Pkcs7
            });
            return dec.toString(CryptoJS.enc.Utf8);
}catch(e){ return null; }
    }

    async function crawlOne(aid){
        const url = '/album/' + aid;
        try{
            const resp = await fetch(url, {credentials:'omit'});
            if(!resp.ok) return {ok:false, code:resp.status};
            const html = await resp.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');

            // 标题：h1.ttle
            let title = '';
            const titleEl = doc.querySelector('h1.ttle, h1[class*=ttle]');
            if(titleEl){
                const clone = titleEl.cloneNode(true);
                const span = clone.querySelector('span');
                if(span) span.remove();
                title = clone.textContent.replace(/\s*\[\d+P\]/g,'').trim();
            }
            if(!title){
                const tt = doc.querySelector('title');
                if(tt) title = tt.textContent.replace(/\s*-\s*自拍图库\.com.*$/,'').replace(/\s*\[\d+P\]/g,'').trim();
            }

            // 页数
            let pcount = 0;
const cnt = doc.querySelector('.zpt-detail-count');
            if(cnt){
                const m = cnt.textContent.match(/(\d+)/);
                if(m) pcount = parseInt(m[1]);
            }
            if(!pcount){
                const m2 = html.match(/\[(\d+)P\]/);
                if(m2) pcount = parseInt(m2[1]);
            }

            // 日期
            let time = '';
            const tm = doc.querySelector('.zpt-detail-published');
            if(tm) time = tm.getAttribute('datetime') || tm.textContent.trim();
            if(!time){
                const m3 = html.match(/datetime="(\d{4}-\d{2}-\d{2})"/);
                if(m3) time = m3[1];
            }

            // 图片：新版直接是 src 明文
            const images = [];
            doc.querySelectorAll('img').forEach(im=>{
                const src = im.getAttribute('src') || '';
                if(src.indexOf('zptk') >= 0 && src.indexOf('/upload/') >= 0) images.push(src);
            });
            // 旧版 rdata 兜底
            if(images.length === 0){
doc.querySelectorAll('img[rdata]').forEach(im=>{
                    const real = decryptImgUrl(im.getAttribute('rdata'));
                    if(real && real.startsWith('http')) images.push(real);
                });
            }
            if(images.length===0) return {ok:false, code:404, reason:'无图片'};
            return {ok:true, item:{aid, title: title || ('文章 '+aid), pcount: pcount || images.length, time, images}};
        }catch(e){
            return {ok:false, code:0, reason:e.message};
        }
    }

    function updateStats(){
        document.getElementById('stDone').textContent = progress.done;
        document.getElementById('stFail').textContent = progress.fail;
        document.getElementById('stMem').textContent = results.length;
        const badge = document.getElementById('stFailBadge');
        if(failedAids.length > 0){
            badge.style.display = 'inline-block';
            badge.textContent = failedAids.length + '个待重试';
        }else{
            badge.style.display = 'none';
}
    }

    //===== 重试一组aid（5线程并发） =====
    async function retryAids(aidList, label){
        console.log('[补爬] retryAids被调用，共' + aidList.length + '个，5线程并发');
        if(retrying) { console.log('[补爬] 已有任务在跑，跳过'); return; }
        retrying = true;
        document.getElementById('stCur').textContent = '准备中...';
        let okCount = 0, failCount = 0, doneCount = 0;
        let cnt404 = 0, cntOtherFail = 0;
        const stillFailed = [];
        const delay = parseInt(document.getElementById('spDelay').value) || DELAY_MS;
        const total = aidList.length;
        console.log('=== 开始' + label + '，共' + total + '个 ===');
        
        // 任务队列
        let idx = 0;
        const THREADS = 5;
        async function worker(){
            while(retrying){
                const myIdx = idx++;
                if(myIdx >= total) break;
                const aid = aidList[myIdx];
                document.getElementById('stCur').textContent = label + ' 进度' + doneCount + '/' + total + ' 当前aid:' + aid;
try{
                    const r = await crawlOne(aid);
                    if(r.ok){
                        let inserted = false;
                        for(let j=0; j<results.length; j++){
                            if(results[j].aid === aid){ results[j] = r.item; inserted = true; break; }
                            if(results[j].aid < aid){ results.splice(j, 0, r.item); inserted = true; break; }
                        }
                        if(!inserted) results.push(r.item);
                        okCount++;
                        console.log('[成功] aid=' + aid);
                    }else{
                        failCount++;
                        const failItem = {aid:aid, code:r.code||0};
                        stillFailed.push(failItem);
                        // 404不记录，只记录其他错误，避免列表太大崩溃
                        if(failItem.code === 404){
                            cnt404++;
                        }else{
                            cntOtherFail++;
                            const exIdx = failedAids.findIndex(x=>x.aid===aid);
if(exIdx>=0){ failedAids[exIdx] = failItem; }
                            else{ failedAids.push(failItem); }
                            GM_setValue(FAILED_KEY, failedAids);
                        }
                        console.log('[失败] aid=' + aid + ' 状态码=' + r.code + ' 原因=' + (r.reason||''));
                    }
                }catch(e){
                    failCount++;
                    const failItem = {aid:aid, code:0};
                    stillFailed.push(failItem);
                    cntOtherFail++;
                    // 异常记录
                    const exIdx = failedAids.findIndex(x=>x.aid===aid);
                    if(exIdx>=0){ failedAids[exIdx] = failItem; }
                    else{ failedAids.push(failItem); }
                    GM_setValue(FAILED_KEY, failedAids);
                    console.log('[异常] aid=' + aid + ' ' + e.toString());
                }
                doneCount++;
                // 更新计数
                document.getElementById('stDone').textContent = okCount;
document.getElementById('stFail').textContent = '其他失败:'+cntOtherFail+' 404:'+cnt404;
                document.getElementById('stMem').textContent = results.length;
                await new Promise(res=>setTimeout(res, delay));
            }
        }
        // 启动5个线程
        const workers = [];
        for(let i=0; i<THREADS; i++) workers.push(worker());
        await Promise.all(workers);
        
        retrying = false;
        updateStats();
        const msg = label + '完成：成功' + okCount + '条，失败' + failCount + '条' +
            (stillFailed.length ? '，仍失败' + stillFailed.length + '个（已记录）' : '');
        console.log('=== ' + msg + ' ===');
        alert(msg + (stillFailed.length ? '\n仍失败的id已记录，可再次重试。\n控制台查看详细失败原因。' : '\n全部成功！'));
        document.getElementById('stCur').textContent = retrying ? '重试中' : '完成';
    }

    //===== 主爬循环 =====
    async function loop(){
        if(!running) return;
        const startAid = parseInt(document.getElementById('spStart').value)||1;
const endAid = parseInt(document.getElementById('spEnd').value)||MAX_AID;
        const delay = parseInt(document.getElementById('spDelay').value)||DELAY_MS;
        if(progress.nextAid < startAid) progress.nextAid = startAid;
        for(; progress.nextAid <= endAid; progress.nextAid++){
            if(!running) break;
            const aid = progress.nextAid;
            document.getElementById('stCur').textContent = '#' + aid;
            const r = await crawlOne(aid);
            if(r.ok){
                // 按aid降序插入到正确位置
                let inserted = false;
                for(let j=0; j<results.length; j++){
                    if(results[j].aid === aid){
                        results[j] = r.item;
                        inserted = true; break;
                    }
                    if(results[j].aid < aid){
                        results.splice(j, 0, r.item);
                        inserted = true; break;
                    }
                }
                if(!inserted) results.push(r.item);
progress.done++;
            }else{
                progress.fail++;
                // 记录失败id，去重，存{aid, code}
                const exist = failedAids.find(x=>x.aid===aid);
                if(!exist){
                    failedAids.push({aid:aid, code:r.code||0});
                    GM_setValue(FAILED_KEY, failedAids);
                }
            }
            updateStats();
            if((progress.done+progress.fail) % BATCH_SAVE === 0){
                GM_setValue(PROGRESS_KEY, progress);
            }
            await new Promise(res=>setTimeout(res, delay));
        }
        running = false;
        GM_setValue(PROGRESS_KEY, progress);
        document.getElementById('stCur').textContent = '完成';
        let msg = '爬取结束！成功' + progress.done + '条，失败' + progress.fail + '条。';
        if(failedAids.length > 0){
            msg += '\n有' + failedAids.length + '个失败id，点"重试失败"重新爬。';
        }
        alert(msg + '\n点"导出JSON"下载数据。');
    }

    document.getElementById('btnStart').onclick = ()=>{
if(running) return;
        running = true;
        loop();
    };
    document.getElementById('btnStop').onclick = ()=>{
        running = false;
        retrying = false;
        GM_setValue(PROGRESS_KEY, progress);
        GM_setValue(FAILED_KEY, failedAids);
        document.getElementById('stCur').textContent = '已暂停';
    };

    //===== 重试失败 =====
    document.getElementById('btnRetry').onclick = ()=>{
        if(failedAids.length === 0){
            alert('没有失败记录');
            return;
        }
        if(!confirm('重试' + failedAids.length + '个失败id？')) return;
        // 复制一份，避免边爬边改
        const list = [...failedAids.map(x=>x.aid)].sort((a,b)=>a-b);
        retryAids(list, '重试失败');
    };

    //===== JSON导入检测补爬 =====
    document.getElementById('btnCheck').onclick = ()=>{
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.json';
        inp.onchange = e=>{
            const f = e.target.files[0];
            if(!f) return;
const reader = new FileReader();
            reader.onload = ev=>{
                console.log('[补爬] 文件已读取，开始解析...');
                try{
                    const arr = JSON.parse(ev.target.result);
                    console.log('[补爬] JSON解析完成，共' + arr.length + '条');
                    if(!Array.isArray(arr)) throw new Error('不是数组');
                    if(arr.length === 0) throw new Error('空文件');
                    // 已有的aid集合
                    const haveAids = new Set(arr.map(x=>x.aid));
                    // 找min/max不用spread，大文件不会栈溢出
                    let minAid = Infinity, maxAid = -Infinity;
                    arr.forEach(x=>{
                        if(x.aid < minAid) minAid = x.aid;
                        if(x.aid > maxAid) maxAid = x.aid;
                    });
                    const missing = [];
                    for(let a=minAid; a<=maxAid; a++){
                        if(!haveAids.has(a)) missing.push(a);
                    }
                    console.log('=== JSON检测 ===');
console.log('文件共' + arr.length + '条，aid范围' + minAid + '~' + maxAid);
                    console.log('缺失' + missing.length + '个aid');
                    console.log('缺失列表:', missing);
                    if(missing.length === 0){
                        alert('JSON完整，无缺失。共' + arr.length + '条，范围' + minAid + '~' + maxAid);
                        return;
                    }
                    if(confirm('文件共' + arr.length + '条，aid范围' + minAid + '~' + maxAid + '\n缺失' + missing.length + '个id\n是否补爬这些缺失id？')){
                        // 先把JSON里的数据插入results正确位置
                        arr.forEach(item=>{
                            let ex = results.findIndex(x=>x.aid===item.aid);
                            if(ex>=0){ results[ex] = item; }
                            else{
                                let ins = false;
                                for(let j=0;j<results.length;j++){
                                    if(results[j].aid < item.aid){
                                        results.splice(j,0,item); ins=true; break;
}
                                }
                                if(!ins) results.push(item);
                            }
                        });
                        updateStats();
                        retryAids(missing, 'JSON补爬');
                    }
                }catch(err){
                    alert('JSON解析失败: ' + err.message);
                    console.log('[JSON补爬] 错误:', err);
                }
            };
            reader.readAsText(f);
        };
        inp.click();
    };

    document.getElementById('btnExport').onclick = ()=>{
        if(results.length===0){ alert('内存里还没有数据'); return; }
        // 按aid范围命名，如1-100.json
        const aids = results.map(x=>x.aid).sort((a,b)=>a-b);
        const minAid = aids[0], maxAid = aids[aids.length-1];
        const blob = new Blob([JSON.stringify(results)], {type:'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = minAid + '-' + maxAid + '.json';
document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    };

    document.getElementById('btnReset').onclick = ()=>{
        if(!confirm('重置进度到1？失败记录也清空，建议先导出')) return;
        progress = {nextAid:1, done:0, fail:0};
        failedAids = [];
        results = [];
        GM_setValue(PROGRESS_KEY, progress);
        GM_setValue(FAILED_KEY, failedAids);
        updateStats();
        document.getElementById('spStart').value = 1;
        document.getElementById('stCur').textContent = '-';
    };

    //===== 导出404失败id =====
    document.getElementById('btnExport404').onclick = ()=>{
        alert('404已自动忽略，不记录不导出\n只记录非404的其他失败（429/网络错误等）');
    };
    //===== 导出其他失败id（429/网络错误等，JSON格式） =====
    document.getElementById('btnExportOther').onclick = ()=>{
        const list = failedAids.filter(x=>x.code!==404);
        if(list.length===0){alert('没有其他失败记录');return;}
        downloadTxt('其他失败id_'+list.length+'个.json', JSON.stringify(list));
};
    function downloadTxt(name, content){
        const blob = new Blob([content], {type:'text/plain'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
    }

    //===== 导入JSON找缺失id =====
    let missingAids = [];
    document.getElementById('btnFindMissing').onclick = ()=>{
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json,.txt';
        inp.onchange = e=>{
            const f = e.target.files[0]; if(!f) return;
            if(f.size > 50*1024*1024){
                alert('文件大小'+(f.size/1024/1024).toFixed(1)+'MB，太大了，手机浏览器解析不了。\n建议用电脑端合并/分析小一点的文件。');
                return;
            }
            const r = new FileReader();
            r.onload = ev=>{
                try{
                    const arr = JSON.parse(ev.target.result);
                    if(!Array.isArray(arr)) throw 0;
                    // 这个JSON里所有的aid
                    const jsonAids = new Set(arr.map(x=>x.aid));
// 当前脚本里已经有的aid
                    const haveAids = new Set(data.map(x=>x.aid));
                    // 找缺失：在JSON范围内，我们脚本里没有的
                    const minAid = Math.min(...jsonAids);
                    const maxAid = Math.max(...jsonAids);
                    missingAids = [];
                    for(let i=minAid; i<=maxAid; i++){
                        if(jsonAids.has(i) && !haveAids.has(i)){
                            missingAids.push(i);
                        }
                    }
                    alert('导入JSON共'+jsonAids.size+'条\n本地已有'+haveAids.size+'条\n缺失id共'+missingAids.length+'个\n点"导出缺失id"下载');
                }catch(err){
                    alert('文件解析失败，请确认是之前导出的JSON数组格式');
                }
            };
            r.readAsText(f);
        };
        inp.click();
    };
    //===== 导出缺失id =====
    document.getElementById('btnExportMissing').onclick = ()=>{
        if(missingAids.length===0){
            alert('请先点"导入JSON找缺失"扫描缺失id');
            return;
}
        // 导出成和失败列表一样的JSON格式，直接可以用来补爬
        const out = missingAids.map(aid=>({aid:aid,code:0}));
        downloadTxt('缺失id_'+missingAids.length+'个.json', JSON.stringify(out));
    };

    //===== 导入缺失列表直接补爬 =====
    document.getElementById('btnRetryFromList').onclick = ()=>{
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json,.txt';
        inp.onchange = e=>{
            const f = e.target.files[0]; if(!f) return;
            if(f.size > 50*1024*1024){
                alert('文件太大了，换小一点的缺失列表文件');
                return;
            }
            const r = new FileReader();
            r.onload = ev=>{
                try{
                    const arr = JSON.parse(ev.target.result);
                    if(!Array.isArray(arr)) throw 0;
                    // 提取所有aid，去重排序
                    const aidSet = new Set();
                    arr.forEach(x=>{
                        if(x.aid != null) aidSet.add(parseInt(x.aid));
                    });
const aidList = [...aidSet].sort((a,b)=>a-b);
                    if(aidList.length===0){
                        alert('文件里没找到任何aid');
                        return;
                    }
                    // 询问从第几个进度开始爬，支持断点续传
                    const startInput = prompt('共'+aidList.length+'个待爬id\n最小'+aidList[0]+' 最大'+aidList[aidList.length-1]+'\n上次跑到第几个？直接回车从第1个开始，输入数字从那继续：', '1');
                    if(startInput===null) return;
                    let startPos = parseInt(startInput)||1;
                    if(startPos < 1) startPos = 1;
                    if(startPos > aidList.length) startPos = aidList.length;
                    const runList = aidList.slice(startPos-1);
                    if(confirm('从第'+startPos+'个id开始爬，共'+runList.length+'个\n最小'+runList[0]+' 最大'+runList[runList.length-1]+'\n是否开始？')){
                        retryAids(runList, '缺失列表补爬(从第'+startPos+'个)');
                    }
                }catch(err){
                    alert('文件解析失败，请确认是之前导出的缺失id/失败列表JSON格式');
}
            };
            r.readAsText(f);
        };
        inp.click();
    };

    //===== 合并多个JSON（支持一次多选） =====
    document.getElementById('btnMerge').onclick = ()=>{
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json,.txt';
        inp.multiple = true; // 一次选多个
        inp.onchange = e=>{
            const files = Array.from(e.target.files);
            if(files.length===0) return;
            let totalIn = 0;
            const map = new Map();
            let done = 0;
            files.forEach(f=>{
                const r = new FileReader();
                r.onload = ev=>{
                    try{
                        const arr = JSON.parse(ev.target.result);
                        if(Array.isArray(arr)){
                            totalIn += arr.length;
                            arr.forEach(x=>{ if(x.aid!=null) map.set(x.aid, x); });
                        }
                    }catch(err){ console.log('跳过格式错误文件:', f.name); }
done++;
                    if(done===files.length){
                        const merged = [...map.values()].sort((a,b)=>b.aid-a.aid);
                        const blob = new Blob([JSON.stringify(merged)],{type:'application/json'});
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = '合并_'+files.length+'个文件_去重后'+merged.length+'条_'+Date.now()+'.json';
                        document.body.appendChild(a); a.click(); document.body.removeChild(a);
                        URL.revokeObjectURL(a.href);
                        alert('合并完成：选了'+files.length+'个文件，共'+totalIn+'条，去重后 '+merged.length+' 条，已下载');
                    }
                };
                r.readAsText(f);
            });
        };
        inp.click();
    };

    updateStats();
    console.log('▶️自拍图库爬虫V1.1已加载，nextAid='+progress.nextAid+'，失败记录='+failedAids.length+'个');
    // 调试用：确认脚本加载
    console.log('[爬虫] 当前页面:', location.href);
    console.log('[爬虫] CryptoJS加载:', typeof CryptoJS !== 'undefined');
})();