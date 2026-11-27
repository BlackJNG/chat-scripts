// 妈妈短剧 mamaduanju.com 渲染后 DOM 采集（在 GitHub Actions 里跑，绕开本地出网网关）
// 输出 capture/out/*.html + *.json，供本地分析选择器
const fs = require('fs');
const puppeteer = require('puppeteer');

const OUT = 'capture/out';
const BASE = 'https://mamaduanju.com';

const HOME_PROBE = () => {
  const cardLinks = Array.prototype.slice.call(document.querySelectorAll('a[href*="/drama/"]'));
  const clsCount = {};
  document.querySelectorAll('[class]').forEach(el => {
    String(el.className).split(/\s+/).forEach(c => { if (c) clsCount[c] = (clsCount[c] || 0) + 1; });
  });
  const topCls = Object.entries(clsCount).sort((a, b) => b[1] - a[1]).slice(0, 40);
  const sample = cardLinks.slice(0, 14).map(a => ({
    href: a.getAttribute('href'),
    cls: a.className,
    text: (a.innerText || '').replace(/\n/g, ' ').trim().slice(0, 30),
    parentCls: a.parentElement ? a.parentElement.className : '',
    grandCls: a.parentElement && a.parentElement.parentElement ? a.parentElement.parentElement.className : ''
  }));
  // 找一个「像主列表卡」的：href 不带 /ep- 的
  const pure = cardLinks.filter(a => !/\/ep-\d/.test(a.getAttribute('href') || ''));
  return {
    url: location.href, title: document.title,
    totalDramaLinks: cardLinks.length, pureDramaLinks: pure.length,
    topCls, sample,
    firstPureOuter: pure[0] ? pure[0].outerHTML.slice(0, 700) : '',
    firstPureParentOuter: pure[0] && pure[0].parentElement ? pure[0].parentElement.parentElement.outerHTML.slice(0, 1200) : '',
    hasPagerText: (document.body.innerText.match(/共\s*\d+\s*集|全\s*\d+\s*集|加载更多|展开全部|下一页/g) || []).slice(0, 5)
  };
};

const PLAY_PROBE = () => {
  const vids = Array.prototype.slice.call(document.querySelectorAll('video')).map(v => ({
    cls: v.className, id: v.id,
    parentCls: v.parentElement ? v.parentElement.className : '',
    grandCls: v.parentElement && v.parentElement.parentElement ? v.parentElement.parentElement.className : '',
    srcHead: String(v.src || '').slice(0, 24),
    posterHead: String(v.poster || '').slice(0, 60),
    paused: v.paused, currentTime: v.currentTime, readyState: v.readyState,
    w: v.clientWidth, h: v.clientHeight
  }));
  const eps = Array.prototype.slice.call(document.querySelectorAll('a[href*="/ep-"]'));
  const epSample = eps.slice(0, 16).map(a => ({
    href: a.getAttribute('href'), cls: a.className,
    text: (a.innerText || '').replace(/\n/g, ' ').trim().slice(0, 16)
  }));
  const text = document.body.innerText;
  return {
    url: location.href, title: document.title,
    videos: vids, epCount: eps.length, epSample: eps.length ? epSample : [],
    epParentOuter: eps[0] && eps[0].parentElement ? eps[0].parentElement.parentElement.outerHTML.slice(0, 900) : '',
    totalEpText: (text.match(/共\s*\d+\s*集|全\s*\d+\s*集|\d+\s*集全|更新至\s*\d+\s*集/g) || []).slice(0, 6),
    paywallHints: (text.match(/金币|解锁|会员|VIP|付费/g) || []).length,
    firstVideoWrapOuter: (() => {
      const v = document.querySelector('video');
      if (!v) return '';
      let p = v; for (let i = 0; i < 3 && p.parentElement; i++) p = p.parentElement;
      return p.outerHTML.slice(0, 1200);
    })()
  };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--autoplay-policy=no-user-gesture-required']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
  page.setDefaultTimeout(60000);

  const log = [];
  const grab = async (url, name, probeFn) => {
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(r => setTimeout(r, 2500));
      for (let i = 0; i < 8; i++) { await page.evaluate(() => window.scrollBy(0, 700)); await new Promise(r => setTimeout(r, 450)); }
      const html = await page.content();
      fs.writeFileSync(`${OUT}/${name}.html`, html);
      const data = await page.evaluate(probeFn);
      fs.writeFileSync(`${OUT}/${name}.json`, JSON.stringify(data, null, 1));
      log.push({ name, ok: true, bytes: html.length, title: data.title });
      return data;
    } catch (e) {
      log.push({ name, ok: false, err: String(e.message || e) });
      return null;
    }
  };

  const home = await grab(`${BASE}/`, 'home', HOME_PROBE);

  // 从首页挑一个纯剧链接作播放页
  let slug = 'cao-yao-ji';
  if (home && home.sample && home.sample.length) {
    const hit = home.sample.find(s => /^\/drama\/([^/]+)$/.exec(s.href || ''));
    if (hit) slug = /^\/drama\/([^/]+)$/.exec(hit.href)[1];
  }
  log.push({ slug });

  const play = await grab(`${BASE}/drama/${slug}/ep-1`, 'play', PLAY_PROBE);

  fs.writeFileSync(`${OUT}/run.json`, JSON.stringify({ at: new Date().toISOString(), log }, null, 1));
  await browser.close();
  console.log(JSON.stringify(log, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
