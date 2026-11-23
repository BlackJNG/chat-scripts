// ==UserScript==
// @name         视频干净浏览器V3.0
// @namespace    http://tampermonkey.net/
// @version      6.5
// @description  纯文字列表；只存文章路径；点进去实时fetch最新auth_key
// @author       You
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    let SITE_BASE = location.origin;
    const STORAGE_KEY = "video_collect_v2";
    const NAV_URL_KEY = "vc_nav_url";
    const NAV_HISTORY_KEY = "vc_nav_history"; // 域名历史记录，最多15个
    const LAST_DOMAIN_KEY = "vc_last_domain"; // 上次使用的域名
    const MAX_HISTORY = 15;
    const MAX_NAV_DOMAINS = 3; // 导航页只取前3条
    let navUrlList = []; // 从导航页解析出的可用域名列表（已去重，最多3条）
    let navLatencyMap = {}; // 域名->延迟(ms)，-1表示不可用

    GM_addStyle(`
#vcFloatBtn{position:fixed;width:46px;height:46px;border-radius:12px;background:#e74c3c;color:#fff;font-size:22px;text-align:center;line-height:46px;cursor:move;z-index:9999999;user-select:none;}
#vcFloatBtn:active{opacity:0.7;}
#vcMainPanel{position:fixed;inset:0;background:#0a0a0a;z-index:99999999;display:none;flex-direction:column;}
.vc-topbar{background:#1a1a1a;padding:10px 14px;display:flex;align-items:center;gap:8px;flex-shrink:0;position:relative;z-index:99999;}
.vc-topbar h3{color:#fff;margin:0;font-size:15px;flex:1;white-space:nowrap;line-height:36px;}
.vc-tab{padding:0 16px;border:none;border-radius:6px;cursor:pointer;font-size:13px;background:#333;color:#aaa;height:36px;white-space:nowrap;}
.vc-tab.active{background:#e74c3c;color:#fff;}
.vc-tab-collect{background:#f59e0b;color:#fff;}
.vc-close{background:#e74c3c;color:#fff;border:none;border-radius:6px;padding:0 14px;cursor:pointer;font-size:13px;height:36px;white-space:nowrap;}
.vc-content{flex:1;overflow-y:auto;padding:10px;}
.vc-row-item{display:flex;align-items:center;gap:10px;background:#1a1a1a;border-radius:8px;padding:14px 12px;margin-bottom:8px;cursor:pointer;}
.vc-row-item:hover{background:#222;}
.vc-row-item .t{flex:1;min-width:0;color:#eee;font-size:18px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.vc-row-item .read-badge{position:absolute;top:6px;left:6px;background:#ef4444;color:#fff;font-size:11px;padding:2px 6px;border-radius:4px;}
.vc-row-item{position:relative;}
.vc-row-btns{display:flex;flex-direction:column;gap:6px;flex-shrink:0;}
.vc-row-btns button{padding:6px 12px;border:none;border-radius:6px;font-size:13px;cursor:pointer;white-space:nowrap;}
#vcPlayerBox{width:100%;background:#000;}
.vc-player-title{color:#fff;font-size:14px;padding:10px 14px;line-height:1.5;}
.vc-video-tabs{display:flex;gap:6px;padding:8px 14px;flex-wrap:wrap;}
.vc-video-tab{background:#333;color:#aaa;border:none;border-radius:5px;padding:6px 12px;font-size:12px;cursor:pointer;}
.vc-video-tab.active{background:#e74c3c;color:#fff;}
.vc-loading{color:#888;text-align:center;padding:40px;font-size:14px;}
.vc-page-nav{display:flex;gap:6px;align-items:center;padding:8px 12px;justify-content:center;flex-wrap:nowrap;}
.vc-page-nav button{background:#333;color:#fff;border:none;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px;white-space:nowrap;}
.vc-page-nav button:disabled{opacity:0.3;}
.vc-page-nav input{width:40px;background:#333;color:#fff;border:none;border-radius:6px;padding:5px;text-align:center;font-size:12px;}
.vc-search-bar{display:flex;gap:8px;padding:8px 12px;align-items:center;}
.vc-search-bar input{flex:1;background:#222;color:#fff;border:1px solid #444;border-radius:6px;padding:7px 10px;font-size:13px;outline:none;}
.vc-search-bar input:focus{border-color:#e74c3c;}
.vc-search-bar button{background:#e74c3c;color:#fff;border:none;border-radius:6px;padding:7px 14px;font-size:13px;cursor:pointer;white-space:nowrap;}
.vc-back-btn{background:#333;color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px;}
.vc-collect-btn{background:#f59e0b;color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px;}
.vc-setting-btn{background:#555;color:#fff;border:none;border-radius:6px;width:44px;height:36px;font-size:18px;cursor:pointer;padding:0;}
#vcSettingPanel{position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:1000000000;display:none;padding:20px;box-sizing:border-box;}
.vc-setting-box{background:#1a1a1a;border-radius:10px;padding:20px;max-width:400px;margin:50px auto;}
.vc-setting-box h4{color:#fff;margin:0 0 16px 0;font-size:15px;}
.vc-setting-box button{display:block;width:100%;margin:8px 0;padding:10px;border:none;border-radius:6px;font-size:14px;cursor:pointer;}
`);

    // 用GM_xmlhttpRequest，绕过同源策略，任意页面都能fetch
    function gmFetch(url, options){
        options = options || {};
        return new Promise((resolve, reject)=>{
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: url,
                headers: options.headers || {},
                data: options.body || '',
                timeout: 10000,
                onload: function(r){
                    if(r.status >= 200 && r.status < 300){
                        resolve(r.responseText);
                    }else{
                        reject(new Error('HTTP '+r.status));
                    }
                },
                onerror: function(){
                    reject(new Error('网络请求失败'));
                },
                ontimeout: function(){
                    reject(new Error('请求超时'));
                }
            });
        });
    }

    // ========== 导航地址获取与手动切换 ==========
    // 从导航页HTML解析所有可用域名（已去重）
    function parseNavDomains(html){
        const domains = [];
        const re = /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
        let m;
        while((m = re.exec(html)) !== null){
            try{
                const u = new URL(m[1]);
                const origin = u.origin;
                if(!domains.includes(origin)){
                    domains.push(origin);
                }
            }catch(e){}
        }
        return domains;
    }

    // 测试域名延迟，返回ms（-1表示不可用/超时）
    function testDomainLatency(domain){
        return new Promise((resolve)=>{
            const start = Date.now();
            GM_xmlhttpRequest({
                method: 'GET',
                url: domain + '/',
                timeout: 5000,
                onload: function(r){
                    if(r.status >= 200 && r.status < 300){
                        resolve(Date.now() - start);
                    }else{
                        resolve(-1);
                    }
                },
                onerror: function(){ resolve(-1); },
                ontimeout: function(){ resolve(-1); }
            });
        });
    }

    // 批量测试所有域名的延迟（并行，结果实时更新）
    async function testAllDomainsLatency(onUpdate){
        navLatencyMap = {};
        const tasks = navUrlList.map(async (domain)=>{
            const latency = await testDomainLatency(domain);
            navLatencyMap[domain] = latency;
            if(onUpdate) onUpdate(domain, latency);
        });
        await Promise.all(tasks);
    }

    // 从导航页获取域名列表（只取前3条，不自动切换）
    async function loadNavDomains(){
        const navUrl = GM_getValue(NAV_URL_KEY, '');
        if(!navUrl) return false;
        try{
            const html = await gmFetch(navUrl);
            navUrlList = parseNavDomains(html).slice(0, MAX_NAV_DOMAINS);
            console.log('[导航] 解析到域名(前3条):', navUrlList);
            return navUrlList.length > 0;
        }catch(e){
            console.log('[导航] 获取失败:', e.message);
            return false;
        }
    }

    // 手动选择域名
    function selectDomain(domain){
        if(!domain) return;
        SITE_BASE = domain;
        GM_setValue(LAST_DOMAIN_KEY, domain); // 保存上次使用的域名
        addToNavHistory(domain);
        console.log('[导航] 手动选择:', domain);
    }

    // 历史记录：读取
    function getNavHistory(){
        try{
            return GM_getValue(NAV_HISTORY_KEY, []);
        }catch(e){
            return [];
        }
    }

    // 历史记录：添加（最多15个，重复的移到最前，多了循环覆盖）
    function addToNavHistory(domain){
        let history = getNavHistory();
        // 去重：已存在的移到最前
        history = history.filter(d => d !== domain);
        history.unshift(domain);
        // 最多15个
        if(history.length > MAX_HISTORY){
            history = history.slice(0, MAX_HISTORY);
        }
        GM_setValue(NAV_HISTORY_KEY, history);
    }

    // 脚本启动时初始化域名：用上次使用的，失败则自动用导航页第一个
    async function initDomain(){
        // 1. 先用上次使用的域名
        const lastDomain = GM_getValue(LAST_DOMAIN_KEY, '');
        if(lastDomain){
            SITE_BASE = lastDomain;
            console.log('[导航] 使用上次域名:', lastDomain);
        }
        // 2. 异步加载导航页域名列表（不阻塞）
        loadNavDomains().then(async (ok)=>{
            if(!ok || navUrlList.length === 0) return;
            // 3. 如果有上次使用的域名，测试是否可用
            if(lastDomain){
                const latency = await testDomainLatency(lastDomain);
                if(latency !== -1){
                    console.log('[导航] 上次域名可用:', lastDomain, latency + 'ms');
                    return; // 可用，保持不变
                }
                console.log('[导航] 上次域名不可用，尝试导航页第一个');
            }
            // 4. 上次域名不可用或没有上次域名，自动用导航页第一个
            const firstDomain = navUrlList[0];
            const latency = await testDomainLatency(firstDomain);
            if(latency !== -1){
                SITE_BASE = firstDomain;
                GM_setValue(LAST_DOMAIN_KEY, firstDomain);
                console.log('[导航] 自动切换到导航页第一个:', firstDomain, latency + 'ms');
            }else{
                console.log('[导航] 导航页第一个也不可用，请手动选择');
            }
        });
    }

    // 悬浮球
    const floatBtn = document.createElement('div');
    floatBtn.id = 'vcFloatBtn';
    floatBtn.textContent = '🎬';
    floatBtn.style.right = '18px';
    floatBtn.style.top = (window.innerHeight/2 - 23) + 'px';
    document.body.appendChild(floatBtn);

    // 悬浮球拖拽
    let isDragging = false, startX, startY, btnLeft, btnTop;
    floatBtn.addEventListener('mousedown', startDrag);
    floatBtn.addEventListener('touchstart', startDrag, {passive:true});
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('touchmove', dragMove, {passive:true});
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchend', stopDrag);
    function startDrag(e){
        isDragging = true;
        const rect = floatBtn.getBoundingClientRect();
        btnLeft = rect.left; btnTop = rect.top;
        const evt = e.type.includes('mouse') ? e : e.touches[0];
        startX = evt.clientX; startY = evt.clientY;
    }
    function dragMove(e){
        if(!isDragging) return;
        const evt = e.type.includes('mouse') ? e : e.touches[0];
        floatBtn.style.left = (btnLeft + evt.clientX - startX) + 'px';
        floatBtn.style.top = (btnTop + evt.clientY - startY) + 'px';
        floatBtn.style.right = 'auto';
    }
    function stopDrag(){ isDragging = false; }

    const panel = document.createElement('div');
    panel.id = 'vcMainPanel';
    panel.innerHTML = `
<div class="vc-topbar">
    <h3>🎬</h3>
    <button class="vc-tab active" data-tab="online">在线看</button>
    <button class="vc-tab vc-tab-collect" data-tab="collect">收藏</button>
    <button class="vc-tab" id="vcSearchToggleBtn" style="background:#333;color:#fff;padding:0 10px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;vertical-align:middle;"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>
    </button>
    <button class="vc-setting-btn" id="vcOpenSettingBtn">⚙️</button>
    <button class="vc-close" id="vcClosePanel">关闭</button>
</div>
<div class="vc-top-search-row" id="vcTopSearchRow" style="display:none;background:#1a1a1a;padding:8px 14px;gap:8px;align-items:center;">
    <input class="vc-top-search-input" id="vcTopSearchInput" type="text" placeholder="搜索视频..." style="flex:1;background:#222;color:#fff;border:1px solid #444;border-radius:6px;padding:8px 10px;font-size:13px;outline:none;">
    <button class="vc-tab" id="vcTopSearchBtn" style="background:#e74c3c;color:#fff;">搜索</button>
</div>
<div class="vc-content" id="vcContent">
    <div class="vc-loading">加载中...</div>
</div>`;
    document.body.appendChild(panel);

    // 设置面板
    const settingPanel = document.createElement('div');
    settingPanel.id = 'vcSettingPanel';
    settingPanel.innerHTML = `
<div class="vc-setting-box">
    <h4>设置</h4>
    <div style="margin:10px 0;">
        <label style="color:#aaa;font-size:13px;display:block;margin-bottom:6px;">导航地址</label>
        <input type="text" id="vcNavUrlInput" placeholder="https://导航页地址/" style="width:100%;background:#222;color:#fff;border:1px solid #444;border-radius:6px;padding:8px 10px;font-size:13px;box-sizing:border-box;">
        <button id="vcSaveNavBtn" style="background:#f59e0b;color:#fff;margin-top:8px;">保存并获取域名</button>
    </div>
    <div style="margin:10px 0;">
        <label style="color:#aaa;font-size:13px;display:block;margin-bottom:6px;">选择域名（点开自动测延迟）</label>
        <div style="position:relative;">
            <button id="vcDomainSelectBtn" style="width:100%;background:#222;color:#fff;border:1px solid #444;border-radius:6px;padding:10px;font-size:13px;text-align:left;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
                <span id="vcDomainSelectText">请先获取域名列表</span>
                <span style="color:#888;">▼</span>
            </button>
            <div id="vcDomainDropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#222;border:1px solid #444;border-radius:6px;margin-top:4px;max-height:300px;overflow-y:auto;z-index:100;">
            </div>
        </div>
        <div id="vcNavStatus" style="color:#888;font-size:12px;margin-top:6px;"></div>
    </div>
    <div style="margin:10px 0;">
        <label style="color:#aaa;font-size:13px;display:block;margin-bottom:6px;">历史域名（最近15个）</label>
        <div id="vcHistoryList" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
    </div>
    <button id="vcExportBtn" style="background:#2563eb;color:#fff;">导出备份</button>
    <input type="file" id="vcImportFile" accept=".json" style="color:#fff;margin:8px 0;">
    <button id="vcCloseSettingBtn" style="background:#555;color:#fff;">关闭设置</button>
</div>`;
    document.body.appendChild(settingPanel);

    let currentPage = 1;
    let dp = null;
    let listCache = null; // 在线列表缓存
    let searchCache = null; // 搜索结果缓存
    let lastScrollTop = 0;
    let lastSearchScrollTop = 0;
    const READ_KEY = "video_read_list";

    // 从href提取文章唯一ID
    function extractArticleId(href){
        if(!href) return '';
        const m = href.match(/\/archives\/(\d+)/);
        return m ? m[1] : href;
    }

    floatBtn.onclick = (e)=>{
        if(isDragging) return;
        panel.style.display = 'flex';
        loadOnlineList(1);
    };
    document.getElementById('vcClosePanel').onclick = ()=>{
        if(dp){ dp.destroy(); dp = null; }
        panel.style.display = 'none';
    };
    document.getElementById('vcOpenSettingBtn').onclick = ()=>{
        settingPanel.style.display = 'block';
        // 显示已保存的导航地址
        const savedNav = GM_getValue(NAV_URL_KEY, '');
        document.getElementById('vcNavUrlInput').value = savedNav;
        // 更新下拉框按钮文字
        updateDomainSelectBtn();
        // 显示历史记录
        renderHistoryList();
        // 状态
        const statusEl = document.getElementById('vcNavStatus');
        if(navUrlList.length > 0){
            statusEl.textContent = `共${navUrlList.length}个域名，当前: ${SITE_BASE}`;
        }else if(savedNav){
            statusEl.textContent = '已保存导航地址，点"保存并获取域名"加载';
        }else{
            statusEl.textContent = '未设置导航地址';
        }
    };

    // 更新下拉框按钮文字
    function updateDomainSelectBtn(){
        const btnText = document.getElementById('vcDomainSelectText');
        if(navUrlList.length > 0){
            btnText.textContent = SITE_BASE;
        }else{
            btnText.textContent = '请先获取域名列表';
        }
    }

    // 渲染历史记录
    function renderHistoryList(){
        const container = document.getElementById('vcHistoryList');
        const history = getNavHistory();
        if(history.length === 0){
            container.innerHTML = '<span style="color:#666;font-size:12px;">暂无历史</span>';
            return;
        }
        container.innerHTML = '';
        history.forEach(domain=>{
            const tag = document.createElement('span');
            tag.style.cssText = 'background:#333;color:#ccc;padding:4px 8px;border-radius:4px;font-size:11px;cursor:pointer;white-space:nowrap;';
            tag.textContent = domain.replace(/^https?:\/\//, '');
            tag.onclick = ()=>{
                selectDomain(domain);
                updateDomainSelectBtn();
                document.getElementById('vcNavStatus').textContent = '已切换到: ' + SITE_BASE;
                renderHistoryList();
            };
            container.appendChild(tag);
        });
    }

    // 渲染下拉框域名列表
    function renderDomainDropdown(){
        const dropdown = document.getElementById('vcDomainDropdown');
        if(navUrlList.length === 0){
            dropdown.innerHTML = '<div style="padding:12px;color:#888;font-size:12px;">暂无域名</div>';
            return;
        }
        dropdown.innerHTML = '';
        navUrlList.forEach(domain=>{
            const item = document.createElement('div');
            item.style.cssText = 'padding:10px 12px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #333;';
            if(domain === SITE_BASE){
                item.style.background = '#2a5a2a';
            }
            item.innerHTML = `
                <span style="color:#ddd;font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${domain.replace(/^https?:\/\//, '')}</span>
                <span class="vc-latency" style="color:#888;font-size:11px;margin-left:8px;flex-shrink:0;">测试中...</span>
            `;
            item.onclick = ()=>{
                selectDomain(domain);
                updateDomainSelectBtn();
                document.getElementById('vcNavStatus').textContent = '已切换到: ' + SITE_BASE;
                renderHistoryList();
                dropdown.style.display = 'none';
                renderDomainDropdown(); // 刷新高亮
            };
            dropdown.appendChild(item);
        });
    }

    // 更新单个域名的延迟显示
    function updateLatencyDisplay(domain, latency){
        const dropdown = document.getElementById('vcDomainDropdown');
        const items = dropdown.querySelectorAll('div');
        items.forEach(item=>{
            const text = item.querySelector('span:first-child');
            if(text && text.textContent === domain.replace(/^https?:\/\//, '')){
                const latencyEl = item.querySelector('.vc-latency');
                if(latencyEl){
                    if(latency === -1){
                        latencyEl.textContent = '不可用';
                        latencyEl.style.color = '#ef4444';
                    }else{
                        latencyEl.textContent = latency + 'ms';
                        latencyEl.style.color = latency < 500 ? '#2ecc71' : (latency < 1500 ? '#f59e0b' : '#ef4444');
                    }
                }
            }
        });
    }

    // 下拉框展开/收起
    document.getElementById('vcDomainSelectBtn').onclick = async ()=>{
        const dropdown = document.getElementById('vcDomainDropdown');
        if(dropdown.style.display === 'none' || !dropdown.style.display){
            if(navUrlList.length === 0){
                // 还没获取域名，自动获取
                const savedNav = GM_getValue(NAV_URL_KEY, '');
                if(!savedNav){
                    alert('请先填写导航地址并保存');
                    return;
                }
                document.getElementById('vcNavStatus').textContent = '正在获取域名列表...';
                await loadNavDomains();
            }
            renderDomainDropdown();
            dropdown.style.display = 'block';
            // 展开时自动测试所有域名延迟
            if(navUrlList.length > 0){
                testAllDomainsLatency((domain, latency)=>{
                    updateLatencyDisplay(domain, latency);
                });
            }
        }else{
            dropdown.style.display = 'none';
        }
    };

    // 点击其他地方关闭下拉框
    document.addEventListener('click', (e)=>{
        const dropdown = document.getElementById('vcDomainDropdown');
        const btn = document.getElementById('vcDomainSelectBtn');
        if(dropdown && btn && !dropdown.contains(e.target) && !btn.contains(e.target)){
            dropdown.style.display = 'none';
        }
    });

    document.getElementById('vcSaveNavBtn').onclick = async ()=>{
        const url = document.getElementById('vcNavUrlInput').value.trim();
        const statusEl = document.getElementById('vcNavStatus');
        if(!url){
            GM_setValue(NAV_URL_KEY, '');
            statusEl.textContent = '已清除导航地址';
            return;
        }
        GM_setValue(NAV_URL_KEY, url);
        statusEl.textContent = '保存成功，正在获取域名列表...';
        const ok = await loadNavDomains();
        if(ok){
            statusEl.textContent = `成功！共${navUrlList.length}个域名，点下拉框选择并测延迟`;
            updateDomainSelectBtn();
        }else{
            statusEl.textContent = '获取失败，请检查地址';
        }
    };
    document.getElementById('vcCloseSettingBtn').onclick = ()=>{
        settingPanel.style.display = 'none';
    };
    document.getElementById('vcExportBtn').onclick = ()=>{
        const list = GM_getValue(STORAGE_KEY, []);
        const blob = new Blob([JSON.stringify(list, null, 2)], {type:"application/json"});
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "video_collect_backup.json";
        a.click();
    };
    document.getElementById('vcImportFile').addEventListener('change', function(e){
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = ev=>{
            try{
                const arr = JSON.parse(ev.target.result);
                if(!Array.isArray(arr)) throw 0;
                const list = GM_getValue(STORAGE_KEY, []);
                list.unshift(...arr);
                GM_setValue(STORAGE_KEY, list);
                alert(`导入完成，共${arr.length}条`);
                settingPanel.style.display = 'none';
            }catch(err){ alert("JSON格式错误"); }
            e.target.value = "";
        };
        reader.readAsText(file);
    });

    document.querySelectorAll('.vc-tab').forEach(tab=>{
        tab.onclick = ()=>{
            document.querySelectorAll('.vc-tab').forEach(t=>t.classList.remove('active'));
            tab.classList.add('active');
            if(tab.dataset.tab === 'online') loadOnlineList(1, true);
            else loadCollectList(true);
        };
    });

    // 顶栏搜索按钮
    const topSearchRow = document.getElementById('vcTopSearchRow');
    const topSearchInput = document.getElementById('vcTopSearchInput');
    const topSearchBtn = document.getElementById('vcTopSearchBtn');
    document.getElementById('vcSearchToggleBtn').onclick = ()=>{
        const show = topSearchRow.style.display === 'none';
        topSearchRow.style.display = show ? 'flex' : 'none';
        if(show) topSearchInput.focus();
    };
    topSearchBtn.onclick = ()=>{
        const kw = topSearchInput.value.trim();
        if(kw) searchOnline(kw, 1);
    };
    topSearchInput.onkeydown = e=>{
        if(e.key === 'Enter'){
            const kw = topSearchInput.value.trim();
            if(kw) searchOnline(kw, 1);
        }
    };

    function parseList(html){
        const items = [];
        const blocks = html.split('<div class="video-item">');
        for(let i = 1; i < blocks.length; i++){
            const block = blocks[i].substring(0, 2000);
            const href = (block.match(/href="(\/archives\/\d+\/)"/)||[])[1] || '';
            if(!href) continue;
            const title = (block.match(/alt="([^"]+)"/)||[])[1] || href;
            items.push({href, title});
        }
        return items;
    }

    function parseArticleVideos(html){
        const configs = [];
        const titleRe = /data-video_title="([^"]+)"/g;
        const titles = [];
        let tm;
        while((tm = titleRe.exec(html)) !== null) titles.push(tm[1]);
        const configRe = /config='([^']+)'/g;
        let m, ti = 0;
        while((m = configRe.exec(html)) !== null){
            try{
                const cfg = JSON.parse(m[1]);
                if(cfg.video && cfg.video.url){
                    configs.push({cfg, title: titles[ti] || ('视频' + (ti+1))});
                }
            }catch(e){}
            ti++;
        }
        // 提取发布时间
        let dateStr = '';
        const dm = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
        if(dm){
            try{
                const d = new Date(dm[1]);
                dateStr = (d.getMonth()+1) + '-' + d.getDate() + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
            }catch(e){}
        }
        return {configs, mainTitle: titles[0] || '未命名视频', dateStr};
    }

    function pageNavHtml(page, prevDisabled, showBack){
        const back = showBack ? '<button class="vc-back-btn vc-collect-back">← 返回</button>' : '';
        return `<div class="vc-page-nav">
            ${back}
            <button class="vc-prev-btn" ${prevDisabled?'disabled':''}>上一页</button>
            <input class="vc-page-input" type="number" value="${page}" min="1">
            <button class="vc-next-btn">下一页</button>
            <button class="vc-go-btn">跳转</button>
        </div>`;
    }

    function searchBarHtml(placeholder){
        return `<div class="vc-search-bar">
            <input class="vc-search-input" type="text" placeholder="${placeholder}" value="">
            <button class="vc-search-btn">搜索</button>
        </div>`;
    }

    async function loadOnlineList(page, force){
        currentPage = page;
        const content = document.getElementById('vcContent');
        if(listCache && listCache.page === page && !force){
            content.innerHTML = listCache.html;
            const listCacheRef = {value: listCache};
            bindListEvents((action, p)=>{
                if(action === 'prev') loadOnlineList(currentPage-1);
                else if(action === 'next') loadOnlineList(currentPage+1);
                else if(action === 'go') loadOnlineList(p);
            }, listCacheRef, ()=> loadOnlineList(currentPage, false));
            bindSearchEvents('online');
            content.scrollTop = lastScrollTop;
            return;
        }
        content.innerHTML = '<div class="vc-loading">加载中...</div>';
        try{
            const url = page > 1 ? `${SITE_BASE}/page/${page}/` : SITE_BASE + '/';
            const html = await gmFetch(url);
            const items = parseList(html);
            if(items.length === 0){
                content.innerHTML = '<div class="vc-loading">没有内容</div>';
                return;
            }
            content.innerHTML = renderListItems(items, page, false);
            listCache = {page, html: content.innerHTML};
            const listCacheRef = {value: listCache};
            bindListEvents((action, p)=>{
                if(action === 'prev') loadOnlineList(currentPage-1);
                else if(action === 'next') loadOnlineList(currentPage+1);
                else if(action === 'go') loadOnlineList(p);
            }, listCacheRef, ()=> loadOnlineList(currentPage, false));
            bindSearchEvents('online');
        }catch(e){
            content.innerHTML = '<div class="vc-loading">加载失败: '+(e.message||e||'未知错误')+'<br><span style="font-size:12px;color:#888;">可在设置里切换其他域名</span></div>';
        }
    }

    // 渲染列表（在线列表和搜索结果共用）
    function renderListItems(items, page, showSearch){
        const readSet = GM_getValue(READ_KEY, {});
        let htmlStr = (showSearch !== false ? searchBarHtml('搜索视频标题...') : '') + pageNavHtml(page, page<=1);
        items.forEach(item=>{
            let href = item.href;
            try{
                if(href && href.startsWith('http')){
                    href = new URL(href).pathname;
                }
            }catch(e){}
            const aid = extractArticleId(href);
            const read = (readSet[aid] || readSet[href]) ? '<span class="read-badge">已读</span>' : '';
            htmlStr += `<div class="vc-row-item" data-url="${href}" data-aid="${aid}">
                ${read}
                <div class="t">${item.title}</div>
            </div>`;
        });
        htmlStr += pageNavHtml(page, page<=1);
        return htmlStr;
    }

    // 在线搜索：用网站POST API
    async function searchOnline(keyword, page){
        page = page || 1;
        const content = document.getElementById('vcContent');
        // 有搜索缓存且不强制刷新
        if(searchCache && searchCache.keyword === keyword && searchCache.page === page){
            content.innerHTML = searchCache.html;
            const searchCacheRef = {value: searchCache};
            bindListEvents((action, p)=>{
                if(action === 'prev') searchOnline(keyword, page-1);
                else if(action === 'next') searchOnline(keyword, page+1);
                else if(action === 'go') searchOnline(keyword, p);
            }, searchCacheRef, ()=> searchOnline(keyword, page));
            bindSearchEvents('online');
            content.scrollTop = lastSearchScrollTop;
            return;
        }
        content.innerHTML = '<div class="vc-loading">搜索中...</div>';
        try{
            const text = await gmFetch(SITE_BASE + '/index/search_article', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': 'application/json, text/javascript, */*; q=0.01'
                },
                body: `word=${encodeURIComponent(keyword)}&page=${page}&oauth_type=h5`
            });
            let items = [];
            try{
                const data = JSON.parse(text);
                const d = data.data || data.result || data;
                if(typeof d === 'string'){
                    items = parseList(d);
                }else if(Array.isArray(d)){
                    items = d.map(x=>{
                        let href = x.url || x.href || x.article_url;
                        if(!href && x.id) href = '/archives/' + x.id + '/';
                        return {href, title: x.title || x.name || x.article_title};
                    });
                }else if(d.list){
                    items = d.list.map(x=>{
                        let href = x.url || x.href || x.article_url;
                        if(!href && x.id) href = '/archives/' + x.id + '/';
                        return {href, title: x.title || x.name || x.article_title};
                    });
                }else if(d.html){
                    items = parseList(d.html);
                }
            }catch(e){
                items = parseList(text);
            }
            if(items.length === 0){
                content.innerHTML = searchBarHtml('搜索视频标题...') + '<div class="vc-loading">没有找到匹配的视频</div>';
                bindSearchEvents('online');
                return;
            }
            content.innerHTML = renderListItems(items, page, false);
            searchCache = {keyword, page, html: content.innerHTML};
            const searchCacheRef = {value: searchCache};
            bindListEvents((action, p)=>{
                if(action === 'prev') searchOnline(keyword, page-1);
                else if(action === 'next') searchOnline(keyword, page+1);
                else if(action === 'go') searchOnline(keyword, p);
            }, searchCacheRef, ()=> searchOnline(keyword, page));
            bindSearchEvents('online');
        }catch(e){
            content.innerHTML = '<div class="vc-loading">搜索失败: '+(e.message||e)+'<br><span style="font-size:12px;color:#888;">可在设置里切换其他域名</span></div>';
        }
    }

    // 绑定列表事件（分页回调可配置，返回回调可配置）
    function bindListEvents(pageCallback, cacheObj, backFn){
        const content = document.getElementById('vcContent');
        content.querySelectorAll('.vc-row-item').forEach(row=>{
            row.onclick = ()=>{
                const href = row.dataset.url;
                const aid = row.dataset.aid || extractArticleId(href);
                const readSet = GM_getValue(READ_KEY, {});
                readSet[aid] = true;
                GM_setValue(READ_KEY, readSet);
                if(!row.querySelector('.read-badge')){
                    const badge = document.createElement('span');
                    badge.className = 'read-badge';
                    badge.textContent = '已读';
                    row.insertBefore(badge, row.firstChild);
                }
                if(cacheObj && cacheObj.value) cacheObj.value.html = content.innerHTML;
                openArticle(href, backFn);
            };
        });
        if(pageCallback){
            content.querySelectorAll('.vc-prev-btn').forEach(btn=>{
                btn.onclick = ()=> pageCallback('prev');
            });
            content.querySelectorAll('.vc-next-btn').forEach(btn=>{
                btn.onclick = ()=> pageCallback('next');
            });
            content.querySelectorAll('.vc-go-btn').forEach(btn=>{
                btn.onclick = ()=>{
                    const input = btn.parentElement.querySelector('.vc-page-input');
                    const p = parseInt(input.value);
                    if(p >= 1) pageCallback('go', p);
                };
            });
            content.querySelectorAll('.vc-page-input').forEach(input=>{
                input.onkeydown = e=>{
                    if(e.key === 'Enter'){
                        const p = parseInt(e.target.value);
                        if(p >= 1) pageCallback('go', p);
                    }
                };
            });
        }
    }

    function bindSearchEvents(type){
        const content = document.getElementById('vcContent');
        const input = content.querySelector('.vc-search-input');
        const btn = content.querySelector('.vc-search-btn');
        if(!input || !btn) return;
        const doSearch = ()=>{
            const kw = input.value.trim();
            if(!kw) return;
            if(type === 'online') searchOnline(kw, 1);
            else searchCollect(kw);
        };
        btn.onclick = doSearch;
        input.onkeydown = e=>{ if(e.key === 'Enter') doSearch(); };
    }

    async function openArticle(articlePath, backFn){
        backFn = backFn || (()=> loadOnlineList(currentPage));
        const content = document.getElementById('vcContent');
        content.innerHTML = '<div class="vc-loading">加载中...</div>';
        try{
            const html = await gmFetch(SITE_BASE + articlePath);
            const {configs, mainTitle, dateStr} = parseArticleVideos(html);
            if(configs.length === 0){
                content.innerHTML = `<div style="padding:16px;">
                    <button class="vc-back-btn" id="vcBackBtn">← 返回</button>
                    <div class="vc-loading">没找到视频</div>
                    <div style="color:#666;font-size:11px;margin-top:10px;">路径: ${articlePath}</div>
                </div>`;
                document.getElementById('vcBackBtn').onclick = backFn;
                return;
            }
            renderPlayerView(mainTitle, configs, articlePath, backFn, dateStr);
        }catch(e){
            content.innerHTML = '<div style="padding:16px;"><button class="vc-back-btn" id="vcBackBtn">← 返回</button><div class="vc-loading">加载失败: '+e.message+'<br>路径: '+articlePath+'<br><span style="font-size:12px;color:#888;">可在设置里切换其他域名</span></div></div>';
            document.getElementById('vcBackBtn').onclick = backFn;
        }
    }

    function renderPlayerView(mainTitle, configs, articlePath, backFn, dateStr){
        const content = document.getElementById('vcContent');
        let tabsHtml = '';
        configs.forEach((c, i)=>{
            tabsHtml += `<button class="vc-video-tab ${i===0?'active':''}" data-vi="${i}">视频${i+1}</button>`;
        });
        const dateHtml = dateStr ? `<span style="color:#888;font-size:12px;float:right;">${dateStr}</span>` : '';
        content.innerHTML = `
<div style="display:flex;gap:10px;padding:10px 0;align-items:center;">
    <button class="vc-back-btn" id="vcBackBtn">← 返回</button>
    <button class="vc-collect-btn" id="vcCollectBtn">⭐ 收藏</button>
    <button class="vc-collect-btn" id="vcOriginBtn" style="background:#ef4444;">原文</button>
</div>
<div class="vc-player-title">${mainTitle}${dateHtml}</div>
<div class="vc-video-tabs">${tabsHtml}</div>
<div id="vcPlayerBox"></div>`;
        document.getElementById('vcBackBtn').onclick = backFn;
        const collectBtn = document.getElementById('vcCollectBtn');
        const list = GM_getValue(STORAGE_KEY, []);
        const isCollected = list.some(x=>x.path === articlePath);
        collectBtn.style.background = isCollected ? '#f59e0b' : '#555';
        collectBtn.textContent = isCollected ? '⭐ 已收藏' : '⭐ 收藏';
        collectBtn.onclick = ()=>{
            const list = GM_getValue(STORAGE_KEY, []);
            if(list.some(x=>x.path === articlePath)){ alert('已收藏过'); return; }
            list.unshift({path: articlePath, title: mainTitle, time: Date.now()});
            GM_setValue(STORAGE_KEY, list);
            alert('已收藏');
            collectBtn.style.background = '#f59e0b';
            collectBtn.textContent = '⭐ 已收藏';
        };
        document.getElementById('vcOriginBtn').onclick = ()=>{
            window.open(SITE_BASE + articlePath, '_blank');
        };
        const playVideo = (idx)=>{
            if(dp) dp.destroy();
            const c = configs[idx];
            dp = new DPlayer({
                container: document.getElementById('vcPlayerBox'),
                video: {url: c.cfg.video.url, type: 'hls', pic: c.cfg.video.pic || ''},
                autoplay: true, theme: '#FADFA3'
            });
        };
        const loadPlayer = ()=>{
            document.querySelectorAll('.vc-video-tab').forEach(tab=>{
                tab.onclick = ()=>{
                    document.querySelectorAll('.vc-video-tab').forEach(t=>t.classList.remove('active'));
                    tab.classList.add('active');
                    playVideo(Number(tab.dataset.vi));
                };
            });
            playVideo(0);
        };
        if(!window.DPlayer){
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://cdn.jsdelivr.net/npm/dplayer@1.27.1/dist/DPlayer.min.css';
            document.head.appendChild(link);
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/dplayer@1.27.1/dist/DPlayer.min.js';
            s.onload = loadPlayer;
            document.head.appendChild(s);
        }else{
            loadPlayer();
        }
    }

    let collectPage = 1;
    let collectCache = null;
    const COLLECT_SIZE = 10;

    function loadCollectList(force){
        const content = document.getElementById('vcContent');
        if(collectCache && !force){
            content.innerHTML = collectCache.html;
            bindCollectEvents();
            content.scrollTop = collectCache.scrollTop || 0;
            return;
        }
        const list = GM_getValue(STORAGE_KEY, []);
        if(list.length === 0){
            content.innerHTML = '<div class="vc-loading">暂无收藏</div>';
            return;
        }
        const totalPage = Math.max(1, Math.ceil(list.length / COLLECT_SIZE));
        if(collectPage > totalPage) collectPage = totalPage;
        const start = (collectPage - 1) * COLLECT_SIZE;
        const slice = list.slice(start, start + COLLECT_SIZE);
        let html = searchBarHtml('搜索收藏标题...') + pageNavHtml(collectPage, collectPage<=1, true);
        slice.forEach((item, i)=>{
            const realI = start + i;
            html += `<div class="vc-row-item">
                <div class="t" data-i="${realI}">${item.title}</div>
                <div class="vc-row-btns">
                    <button class="vc-collect-btn" data-act="open" data-i="${realI}">原文</button>
                    <button class="vc-collect-btn" data-act="del" data-i="${realI}" style="background:#ef4444;">删除</button>
                </div>
            </div>`;
        });
        html += pageNavHtml(collectPage, collectPage<=1);
        content.innerHTML = html;
        collectCache = {html: content.innerHTML, scrollTop: 0};
        bindCollectEvents();
    }

    function bindCollectEvents(){
        const content = document.getElementById('vcContent');
        const list = GM_getValue(STORAGE_KEY, []);
        content.querySelectorAll('[data-act]').forEach(btn=>{
            btn.onclick = (e)=>{
                e.stopPropagation();
                const i = Number(btn.dataset.i);
                const act = btn.dataset.act;
                if(act === 'del'){
                    list.splice(i, 1);
                    GM_setValue(STORAGE_KEY, list);
                    collectCache = null;
                    loadCollectList();
                }else if(act === 'open'){
                    window.open(SITE_BASE + list[i].path, '_blank');
                }
            };
        });
        content.querySelectorAll('.t[data-i]').forEach(t=>{
            t.onclick = ()=>{
                collectCache.scrollTop = content.scrollTop;
                openCollect(list[Number(t.dataset.i)]);
            };
        });
        content.querySelectorAll('.vc-prev-btn').forEach(btn=>{
            btn.onclick = ()=>{ collectPage--; collectCache = null; loadCollectList(); };
        });
        content.querySelectorAll('.vc-next-btn').forEach(btn=>{
            btn.onclick = ()=>{ collectPage++; collectCache = null; loadCollectList(); };
        });
        const backBtn = content.querySelector('.vc-collect-back');
        if(backBtn) backBtn.onclick = ()=>{
            // 恢复在线列表缓存，不重新fetch
            document.querySelectorAll('.vc-tab').forEach(t=>t.classList.remove('active'));
            document.querySelector('.vc-tab[data-tab="online"]').classList.add('active');
            loadOnlineList(currentPage, false);
        };
        content.querySelectorAll('.vc-go-btn').forEach(btn=>{
            btn.onclick = ()=>{
                const input = btn.parentElement.querySelector('.vc-page-input');
                const p = parseInt(input.value);
                if(p >= 1){ collectPage = p; collectCache = null; loadCollectList(); }
            };
        });
        content.querySelectorAll('.vc-page-input').forEach(input=>{
            input.onkeydown = e=>{
                if(e.key === 'Enter'){
                    const p = parseInt(e.target.value);
                    if(p >= 1){ collectPage = p; collectCache = null; loadCollectList(); }
                }
            };
        });
        bindSearchEvents('collect');
    }

    function searchCollect(keyword){
        const content = document.getElementById('vcContent');
        const list = GM_getValue(STORAGE_KEY, []);
        const results = list.filter(item=>item.title.toLowerCase().includes(keyword.toLowerCase()));
        let html = searchBarHtml('搜索收藏标题...');
        if(results.length === 0){
            html += '<div class="vc-loading">没有找到匹配的收藏</div>';
        }else{
            html += `<div style="color:#888;padding:6px 12px;font-size:12px;">找到 ${results.length} 条结果</div>`;
            results.forEach((item, i)=>{
                const realI = list.indexOf(item);
                html += `<div class="vc-row-item">
                    <div class="t" data-i="${realI}">${item.title}</div>
                    <div class="vc-row-btns">
                        <button class="vc-collect-btn" data-act="open" data-i="${realI}">原文</button>
                        <button class="vc-collect-btn" data-act="del" data-i="${realI}" style="background:#ef4444;">删除</button>
                    </div>
                </div>`;
            });
        }
        content.innerHTML = html;
        bindCollectEvents();
    }

    async function openCollect(item){
        const content = document.getElementById('vcContent');
        content.innerHTML = '<div class="vc-loading">获取最新视频地址...</div>';
        try{
            const html = await gmFetch(SITE_BASE + item.path);
            const {configs, mainTitle, dateStr} = parseArticleVideos(html);
            if(configs.length === 0){
                content.innerHTML = '<div style="padding:16px;"><button class="vc-back-btn" id="vcBackBtn">← 返回</button><div class="vc-loading">没找到视频，可能文章已下架</div></div>';
                document.getElementById('vcBackBtn').onclick = loadCollectList;
                return;
            }
            renderPlayerView(mainTitle, configs, item.path, loadCollectList, dateStr);
        }catch(e){
            content.innerHTML = '<div style="padding:16px;"><button class="vc-back-btn" id="vcBackBtn">← 返回</button><div class="vc-loading">加载失败: '+e.message+'<br><span style="font-size:12px;color:#888;">可在设置里切换其他域名</span></div></div>';
            document.getElementById('vcBackBtn').onclick = loadCollectList;
        }
    }
    // 脚本启动时初始化域名（用上次使用的，失败则自动用导航页第一个）
    initDomain();

    console.log('🎬视频干净浏览器V6.5已加载｜导航地址手动选择+延迟测试+历史记录');
})();