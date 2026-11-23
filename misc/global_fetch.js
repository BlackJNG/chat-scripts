// ==UserScript==
// @name         Fetch地址测试工具
// @namespace    http://tampermonkey.net/
// @version      2.9
// @description  输入任意网址，测试能不能fetch到内容
// @author       You
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    GM_addStyle(`
#fetchTestPanel{
    position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    width:94%;max-width:440px;height:94vh;max-height:900px;
    background:#1a1a1a;border-radius:10px;z-index:2147483647;
    box-shadow:0 4px 20px rgba(0,0,0,0.5);overflow:hidden;
    display:flex;flex-direction:column;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
}
#fetchTestPanel *{
    pointer-events:auto;
    box-sizing:border-box;
    font-family:inherit;
    line-height:normal;
}
#fetchTestPanel .header{
    background:#e74c3c;color:#fff;padding:10px 14px;
    display:flex;justify-content:space-between;align-items:center;
    font-size:14px;font-weight:bold;cursor:move;flex-shrink:0;
    user-select:none;
}
#fetchTestPanel .close{
    background:none;border:none;color:#fff;font-size:20px;cursor:pointer;
    line-height:1;padding:0 4px;
}
#fetchTestPanel .body{padding:12px;overflow-y:auto;flex:1;}
#fetchTestPanel .controls{
    padding:10px 12px;background:#1a1a1a;flex-shrink:0;
    border-bottom:1px solid #333;
}
#fetchTestPanel .result-area{
    display:block !important;
    height:calc(94vh - 130px);
    max-height:calc(900px - 130px);
    overflow-y:auto !important;
    overflow-x:hidden !important;
    padding:10px 12px 100px !important;
    -webkit-overflow-scrolling:touch;
}
#fetchTestPanel .input-row{display:flex;gap:8px;margin-bottom:10px;}
#fetchTestPanel input{
    flex:1;background:#222;color:#fff;border:1px solid #444;
    border-radius:6px;padding:8px 10px;font-size:13px;outline:none;
}
#fetchTestPanel input:focus{border-color:#e74c3c;}
#fetchTestPanel button{
    background:#e74c3c;color:#fff;border:none;border-radius:6px;
    padding:8px 14px;font-size:13px;cursor:pointer;white-space:nowrap;
}
#fetchTestPanel button:hover{background:#c0392b;}
#fetchTestPanel .search-row{
    display:flex;gap:4px;margin-bottom:0;align-items:center;
    flex-wrap:nowrap;
}
#fetchTestPanel .search-row input{
    flex:1;min-width:0;padding:5px 6px;font-size:11px;
}
#fetchTestPanel .search-row button{
    padding:5px 6px;font-size:10px;background:#555;flex-shrink:0;
}
#fetchTestPanel .search-row #resultSearchBtn{
    background:#e74c3c;
}
#fetchTestPanel .search-row #resultPrevBtn{
    background:#666;
}
#fetchTestPanel .search-row #resultNextBtn{
    background:#2563eb;
}
#fetchTestPanel .search-row .count{
    color:#888;font-size:10px;white-space:nowrap;flex-shrink:0;
}
#fetchTestPanel .result{
    font-size:12px;color:#aaa !important;word-break:break-all;line-height:1.6 !important;
    display:block !important;
}
#fetchTestPanel .result div{
    display:block !important;margin:2px 0 !important;
    color:#aaa !important;font-size:12px !important;line-height:1.6 !important;
}
#fetchTestPanel .result .success{color:#2ecc71 !important;font-weight:bold !important;}
#fetchTestPanel .result .error{color:#e74c3c !important;font-weight:bold !important;}
#fetchTestPanel .result .info{color:#f39c12 !important;}
#fetchTestPanel .result pre{
    display:block !important;
    float:left !important;
    width:100% !important;
    height:auto !important;
    min-height:500px !important;
    margin:8px 0 60px !important;padding:8px !important;
    background:#0a0a0a !important;border-radius:4px !important;
    white-space:pre-wrap !important;word-break:break-all !important;
    font-size:11px !important;color:#ddd !important;
    line-height:1.5 !important;max-height:none !important;
    overflow:visible !important;
}
#fetchTestPanel .result .hl{
    background:#f39c12;color:#000;padding:0 2px;border-radius:2px;
}
#fetchTestPanel .result .hl.current{
    background:#e74c3c;color:#fff;outline:2px solid #fff;
}
#fetchTestFloatBtn{
    position:fixed;top:100px;right:10px;
    width:44px;height:44px;border-radius:50%;background:#e74c3c;color:#fff;font-size:20px;
    display:flex;align-items:center;justify-content:center;
    cursor:move;z-index:2147483647;box-shadow:0 2px 10px rgba(0,0,0,0.5);
    user-select:none;touch-action:none;
}
#fetchTestFloatBtn:active{opacity:0.8;}
`);

    // 悬浮按钮
    const floatBtn = document.createElement('div');
    floatBtn.id = 'fetchTestFloatBtn';
    floatBtn.textContent = '🔍';
    document.body.appendChild(floatBtn);

    // 面板
    const panel = document.createElement('div');
    panel.id = 'fetchTestPanel';
    panel.style.display = 'none';
    panel.innerHTML = `
<div class="header" id="fetchTestHeader">
    <span>Fetch 地址测试</span>
    <button class="close" id="fetchTestClose">×</button>
</div>
<div class="controls">
    <div class="input-row">
        <input type="text" id="fetchUrlInput" placeholder="输入网址，如 https://example.com/article/123">
        <button id="fetchBtn">Fetch</button>
    </div>
    <div class="search-row">
        <input type="text" id="resultSearchInput" placeholder="搜索结果内容...">
        <button id="resultSearchBtn">搜索</button>
        <button id="resultPrevBtn">上一个</button>
        <button id="resultNextBtn">下一个</button>
        <span class="count" id="resultSearchCount"></span>
    </div>
</div>
<div class="result-area">
    <div class="result" id="fetchResult">等待输入网址...</div>
</div>
`;
    document.body.appendChild(panel);

    // 悬浮球拖动（参考悄悄迷迷实现）
    let isDragging = false, dragMoved = false, startX, startY, btnLeft, btnTop;
    function getPoint(e){
        const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
        if(touch && typeof touch.clientX === 'number'){
            return {x: touch.clientX, y: touch.clientY};
        }
        return {x: typeof e.clientX === 'number' ? e.clientX : 0, y: typeof e.clientY === 'number' ? e.clientY : 0};
    }
    function startDrag(e){
        isDragging = true;
        dragMoved = false;
        const rect = floatBtn.getBoundingClientRect();
        btnLeft = rect.left;
        btnTop = rect.top;
        const p = getPoint(e);
        startX = p.x;
        startY = p.y;
    }
    function dragMove(e){
        if(!isDragging) return;
        const p = getPoint(e);
        const dx = p.x - startX;
        const dy = p.y - startY;
        if(Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
        floatBtn.style.left = btnLeft + dx + 'px';
        floatBtn.style.top = btnTop + dy + 'px';
        floatBtn.style.right = 'auto';
    }
    function stopDrag(){
        isDragging = false;
    }
    floatBtn.addEventListener('mousedown', startDrag);
    floatBtn.addEventListener('touchstart', startDrag, {passive: true});
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('touchmove', dragMove, {passive: true});
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchend', stopDrag);

    floatBtn.onclick = ()=>{
        if(dragMoved) return;
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    };
    const closeBtn = document.getElementById('fetchTestClose');
    closeBtn.addEventListener('click', e=>{
        e.stopPropagation();
        panel.style.display = 'none';
    });
    closeBtn.addEventListener('mousedown', e=> e.stopPropagation());
    closeBtn.addEventListener('touchstart', e=> e.stopPropagation(), {passive:false});

    // 快捷键 Alt+F 打开/关闭
    document.addEventListener('keydown', e=>{
        if(e.altKey && e.key.toLowerCase() === 'f'){
            e.preventDefault();
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        }
    });

    const fetchBtn = document.getElementById('fetchBtn');
    const urlInput = document.getElementById('fetchUrlInput');

    fetchBtn.addEventListener('click', e=>{
        e.stopPropagation();
        e.preventDefault();
        doFetch();
    });
    fetchBtn.addEventListener('touchstart', e=>{
        e.stopPropagation();
    }, {passive:false});

    urlInput.addEventListener('click', e=> e.stopPropagation());
    urlInput.addEventListener('touchstart', e=> e.stopPropagation(), {passive:false});
    urlInput.addEventListener('keydown', e=>{
        e.stopPropagation();
        if(e.key === 'Enter') doFetch();
    });

    // 阻止面板内的点击冒泡到页面
    panel.addEventListener('click', e=> e.stopPropagation());
    panel.addEventListener('touchstart', e=> e.stopPropagation(), {passive:false});

    // ========== 拖拽面板 ==========
    const header = document.getElementById('fetchTestHeader');
    let panelDragging = false, panelDragStartX, panelDragStartY, panelStartLeft, panelStartTop;
    function startPanelDrag(e){
        panelDragging = true;
        const rect = panel.getBoundingClientRect();
        panelStartLeft = rect.left;
        panelStartTop = rect.top;
        const evt = e.type.includes('mouse') ? e : e.touches[0];
        panelDragStartX = evt.clientX;
        panelDragStartY = evt.clientY;
        panel.style.transform = 'none';
        e.preventDefault();
    }
    function onPanelDrag(e){
        if(!panelDragging) return;
        const evt = e.type.includes('mouse') ? e : e.touches[0];
        panel.style.left = (panelStartLeft + evt.clientX - panelDragStartX) + 'px';
        panel.style.top = (panelStartTop + evt.clientY - panelDragStartY) + 'px';
    }
    function stopPanelDrag(){ panelDragging = false; }
    header.addEventListener('mousedown', startPanelDrag);
    header.addEventListener('touchstart', startPanelDrag, {passive:false});
    document.addEventListener('mousemove', onPanelDrag);
    document.addEventListener('touchmove', onPanelDrag, {passive:false});
    document.addEventListener('mouseup', stopPanelDrag);
    document.addEventListener('touchend', stopPanelDrag);

    // ========== 搜索结果内容 ==========
    let lastResultHtml = '';
    const resultSearchInput = document.getElementById('resultSearchInput');
    const resultSearchCount = document.getElementById('resultSearchCount');
    document.getElementById('resultSearchBtn').addEventListener('click', doResultSearch);
    let currentMatchIndex = -1;
    let totalMatches = 0;
    resultSearchInput.addEventListener('keydown', e=>{
        if(e.key === 'Enter') doResultSearch();
    });
    const nextBtn = document.getElementById('resultNextBtn');
    const prevBtn = document.getElementById('resultPrevBtn');
    nextBtn.addEventListener('click', e=>{
        e.stopPropagation();
        e.preventDefault();
        if(totalMatches === 0){
            resultSearchCount.textContent = '请先搜索';
            return;
        }
        goNextMatch();
    });
    nextBtn.addEventListener('touchstart', e=> e.stopPropagation(), {passive:false});
    prevBtn.addEventListener('click', e=>{
        e.stopPropagation();
        e.preventDefault();
        if(totalMatches === 0){
            resultSearchCount.textContent = '请先搜索';
            return;
        }
        goPrevMatch();
    });
    prevBtn.addEventListener('touchstart', e=> e.stopPropagation(), {passive:false});
    function doResultSearch(){
        const kw = resultSearchInput.value.trim();
        const resultEl = document.getElementById('fetchResult');
        currentMatchIndex = -1;
        if(!kw){
            resultSearchCount.textContent = '';
            resultEl.innerHTML = lastResultHtml;
            return;
        }
        if(!lastResultHtml){
            resultSearchCount.textContent = '无内容';
            return;
        }
        // 先恢复原始内容
        resultEl.innerHTML = lastResultHtml;
        // 找到pre元素，在里面高亮
        const pre = resultEl.querySelector('pre');
        if(!pre){
            resultSearchCount.textContent = '无内容';
            return;
        }
        const originalText = pre.textContent || '';
        const lowerText = originalText.toLowerCase();
        const lowerKw = kw.toLowerCase();
        let count = 0, pos = 0;
        while((pos = lowerText.indexOf(lowerKw, pos)) !== -1){
            count++;
            pos += lowerKw.length;
        }
        totalMatches = count;
        if(count === 0){
            resultSearchCount.textContent = '未找到';
            return;
        }
        resultSearchCount.textContent = `共${count}处`;
        // 高亮：pre里的内容是纯文本，必须同时转义&和<，否则&会被当成HTML实体导致截断
        const escaped = originalText.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        let idx = 0;
        const highlighted = escaped.replace(regex, m=>{
            return `<span class="hl" id="match-${idx++}">${m}</span>`;
        });
        pre.innerHTML = highlighted;
        // 自动定位到第一个
        requestAnimationFrame(()=> goNextMatch());
    }
    function goNextMatch(){
        if(totalMatches === 0) return;
        currentMatchIndex = (currentMatchIndex + 1) % totalMatches;
        scrollToMatch();
    }
    function goPrevMatch(){
        if(totalMatches === 0) return;
        currentMatchIndex = (currentMatchIndex - 1 + totalMatches) % totalMatches;
        scrollToMatch();
    }
    function scrollToMatch(){
        const el = document.getElementById('match-' + currentMatchIndex);
        if(el){
            document.querySelectorAll('.hl.current').forEach(e=> e.classList.remove('current'));
            el.classList.add('current');
            // 手动滚动结果区域，不用scrollIntoView（会滚动整个页面）
            const resultArea = document.querySelector('.result-area');
            if(resultArea){
                const areaRect = resultArea.getBoundingClientRect();
                const elRect = el.getBoundingClientRect();
                const offset = elRect.top - areaRect.top - areaRect.height / 2 + elRect.height / 2;
                resultArea.scrollBy({top: offset, behavior: 'smooth'});
            }
            resultSearchCount.textContent = `${currentMatchIndex+1}/${totalMatches}`;
        }
    }

    function doFetch(){
        const url = document.getElementById('fetchUrlInput').value.trim();
        const result = document.getElementById('fetchResult');
        if(!url){
            result.innerHTML = '<span class="error">请输入网址</span>';
            return;
        }
        result.innerHTML = '<span class="info">正在请求...</span>';
        const startTime = Date.now();

        // 用GM_xmlhttpRequest跨域请求
        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            headers: {
                'User-Agent': navigator.userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            timeout: 15000,
            onload: function(r){
                const elapsed = Date.now() - startTime;
                const status = r.status;
                const contentType = r.responseHeaders.match(/content-type:\s*([^\r\n]+)/i);
                const ct = contentType ? contentType[1].trim() : '未知';
                const len = r.responseText.length;
                const isOk = status >= 200 && status < 300;

                let html = '';
                html += `<div class="${isOk ? 'success' : 'error'}">${isOk ? '✅ 请求成功' : '⚠️ 状态码异常: ' + status}</div>`;
                html += `<div>状态码: <b>${status}</b></div>`;
                html += `<div>耗时: <b>${elapsed}ms</b></div>`;
                html += `<div>内容类型: <b>${ct}</b></div>`;
                html += `<div>内容长度: <b>${len} 字符</b></div>`;

                if(len === 0){
                    html += `<div class="error" style="margin-top:8px;">⚠️ 返回内容为空！</div>`;
                    html += `<div style="color:#888;margin-top:4px;">可能原因：服务器返回空响应、重定向、或被CDN拦截</div>`;
                    html += `<div style="color:#888;">响应头：<pre style="color:#aaa !important;">${(r.responseHeaders||'').replace(/</g,'&lt;')}</pre></div>`;
                }else{
                    // 检查有没有dplayer config
                    const hasDplayer = r.responseText.includes('dplayer') || r.responseText.includes('config=');
                    const hasM3u8 = r.responseText.includes('.m3u8');
                    const hasAuthKey = r.responseText.includes('auth_key');
                    html += `<div>包含dplayer: <b>${hasDplayer ? '是' : '否'}</b></div>`;
                    html += `<div>包含m3u8: <b>${hasM3u8 ? '是' : '否'}</b></div>`;
                    html += `<div>包含auth_key: <b>${hasAuthKey ? '是' : '否'}</b></div>`;

                    // 显示完整内容（必须转义&和<，否则&会被当成HTML实体导致截断）
                    html += `<div style="margin-top:8px;color:#888;">完整内容(${len}字符):</div>`;
                    html += `<pre>${r.responseText.replace(/&/g,'&amp;').replace(/</g, '&lt;')}</pre>`;
                }

                result.innerHTML = html;
                lastResultHtml = html;
            },
            onerror: function(e){
                const elapsed = Date.now() - startTime;
                result.innerHTML = `
<div class="error">❌ 请求失败</div>
<div>耗时: <b>${elapsed}ms</b></div>
<div>错误: <b>${e.error || '连接失败'}</b></div>
<div style="margin-top:8px;color:#888;">可能原因：</div>
<div>1. 网址错误或不存在</div>
<div>2. 服务器拒绝请求(CDN拦截/WAF)</div>
<div>3. 网络超时</div>
<div>4. 需要特定cookie或登录</div>
`;
            },
            ontimeout: function(){
                const elapsed = Date.now() - startTime;
                result.innerHTML = `<div class="error">⏱️ 请求超时(${elapsed}ms)</div><div>服务器15秒内未响应</div>`;
            }
        });
    }
})();