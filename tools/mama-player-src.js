// 抓妈妈短剧播放器源码：进入剧场皮肤后收集所有 JS bundle，按关键词切片段
// 输出：capture/out/src/*.js（artifact）+ capture/out/player-src.json（提交）
const fs = require('fs');
const puppeteer = require('puppeteer');

const OUT = 'capture/out';
const SRC = `${OUT}/src`;
const BASE = 'https://mamaduanju.com';
const SLUG = process.env.MAMA_SLUG || 'ren-yi-men';

const KEYS = [
  'vslot', 'big-play', 'landscape-full', 'theater-speed', 'm-progress', 'clear_enter',
  'requestFullscreen', 'exitFullscreen', 'orientation', 'screen.lock', 'webkitEnterFullscreen',
  'MediaSource', 'addSourceBuffer', 'm3u8', 'Hls', 'isTypeSupported',
  'pointerdown', 'pointermove', 'swipe', 'passive', 'playsinline',
  '__vueParentComponent', 'defineComponent', 'setup('
];

const grab = (text, kw) => {
  const out = [];
  let i = -1, n = 0;
  while ((i = text.indexOf(kw, i + 1)) >= 0 && out.length < 3) {
    out.push(text.slice(Math.max(0, i - 180), i + 220));
    n++;
  }
  return out;
};

(async () => {
  fs.mkdirSync(SRC, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
  page.setDefaultTimeout(60000);

  await page.goto(`${BASE}/drama/${SLUG}/ep-1`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 1500));
  // 点大播放键进剧场皮肤
  await page.evaluate(() => {
    const c = document.querySelector('.big-play, .screen');
    if (c) c.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await new Promise(r => setTimeout(r, 3000));

  const info = await page.evaluate(() => ({
    feedCls: (document.querySelector('.feed') || {}).className || '',
    scripts: Array.prototype.slice.call(document.querySelectorAll('script[src]')).map(s => s.src),
    inlineCount: document.querySelectorAll('script:not([src])').length,
    videos: Array.prototype.slice.call(document.querySelectorAll('video')).map(v => ({
      cls: v.className, src: String(v.src || '').slice(0, 14),
      hasMSE: typeof MediaSource !== 'undefined' && !!window.MediaSource && !!v.buffered && v.buffered.length >= 0,
      buffered: v.buffered ? Array.prototype.slice.call(v.buffered).map(r => [r.start.toFixed(1), r.end.toFixed(1)]) : [],
      duration: v.duration, readyState: v.readyState
    }))
  }));

  const report = { at: new Date().toISOString(), slug: SLUG, feedCls: info.feedCls, scripts: [], videos: info.videos, inlineCount: info.inlineCount };

  // 逐个下载 + 关键词切片（Node 直接抓同站资源）
  for (const u of info.scripts) {
    const name = u.split('/').pop().split('?')[0].slice(0, 80) || 'x.js';
    const item = { url: u, name, bytes: 0, matches: {} };
    try {
      const res = await fetch(u);
      const text = await res.text();
      item.bytes = text.length;
      fs.writeFileSync(`${SRC}/${name}`, text);
      for (const kw of KEYS) {
        const hits = grab(text, kw);
        if (hits.length) item.matches[kw] = hits;
      }
    } catch (e) {
      item.error = String(e.message || e);
    }
    report.scripts.push(item);
  }

  fs.writeFileSync(`${OUT}/player-src.json`, JSON.stringify(report, null, 1));
  await browser.close();
  console.log(JSON.stringify(report.scripts.map(s => ({ n: s.name, kb: Math.round(s.bytes / 1024), k: Object.keys(s.matches) })), null, 1));
})().catch(e => { console.error(e); process.exit(1); });
