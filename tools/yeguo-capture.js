// 抓野果短剧（yeguodj.com）真实 DOM：首页 → 第一张卡 → 详情 → 点播放 → 播放页
const fs = require('fs');
const OUT = 'capture/out';
const BASE = process.env.YEGUO_BASE || 'https://yeguodj.com';

const probe = () => {
  const links = Array.prototype.slice.call(document.querySelectorAll('a[href]'))
    .map(a => ({ href: a.getAttribute('href'), cls: a.className, txt: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) }))
    .filter(o => /\/drama|\/play|\/video/.test(o.href));
  return {
    url: location.href,
    title: document.title,
    links: links.slice(0, 40),
    dramaCount: links.length,
    videos: Array.prototype.slice.call(document.querySelectorAll('video')).map(v => ({
      cls: v.className, src: String(v.src || '').slice(0, 18), paused: v.paused, dur: v.duration
    })),
    dplayer: Array.prototype.slice.call(document.querySelectorAll('.dplayer')).map(e => {
      const o = {}; for (const a of e.attributes) if (a.name.indexOf('data-') === 0) o[a.name] = a.value.slice(0, 60); return o;
    }),
    bodyCls: document.body.className,
    scripts: Array.prototype.slice.call(document.querySelectorAll('script[src]')).map(s => s.src).slice(0, 12),
    htmlLen: document.documentElement.outerHTML.length
  };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
  page.setDefaultTimeout(60000);

  const out = {};

  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 1500));
  out.home = await page.evaluate(probe);
  fs.writeFileSync(`${OUT}/yeguo-home.html`, await page.content());
  fs.writeFileSync(`${OUT}/yeguo-home.json`, JSON.stringify(out.home, null, 1));

  // 找第一张剧卡（优先 /drama/ 链接）
  const href = (out.home.links.find(o => /\/drama\//.test(o.href)) || {}).href;
  if (href) {
    const abs = new URL(href, BASE).href;
    await page.goto(abs, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 1500));
    out.detail = await page.evaluate(probe);
    out.detailUrl = abs;
    fs.writeFileSync(`${OUT}/yeguo-detail.html`, await page.content());
    fs.writeFileSync(`${OUT}/yeguo-detail.json`, JSON.stringify({ url: abs, ...out.detail }, null, 1));

    // 点播放（各种常见按钮）
    await page.evaluate(() => {
      const cand = ['.play-btn', '.btn-play', '.big-play', '.dplayer', '.screen', 'button[class*="play"]', 'a[class*="play"]', '.video-play'];
      for (const s of cand) {
        const el = document.querySelector(s);
        if (el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return s; }
      }
      const v = document.querySelector('video');
      if (v) { v.muted = true; v.play && v.play().catch(() => {}); }
      return null;
    });
    await new Promise(r => setTimeout(r, 3500));
    out.play = await page.evaluate(probe);
    fs.writeFileSync(`${OUT}/yeguo-play.html`, await page.content());
    fs.writeFileSync(`${OUT}/yeguo-play.json`, JSON.stringify({ url: page.url(), ...out.play }, null, 1));
  }

  fs.writeFileSync(`${OUT}/yeguo-run.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, firstCard: href || null, urls: out.home.links.slice(0, 6) }, null, 1));
  await browser.close();
  console.log(JSON.stringify({ homeDrama: out.home.dramaCount, first: href, playUrl: out.play && out.play.url }, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
