// 妈妈短剧「剧场 / 连播」入口与路由采集
// 1) /theater 列表 → 点第一个 → 记录真实 URL + 剧场 DOM
// 2) /drama/{slug}/ep-1 → 点大播放键 → 看是否切进剧场模式（URL / DOM 变化）
const fs = require('fs');
const puppeteer = require('puppeteer');

const OUT = 'capture/out';
const BASE = 'https://mamaduanju.com';
const SLUG = process.env.MAMA_SLUG || 'ren-yi-men';

const PROBE = () => {
  const feed = document.querySelector('.feed.mobile.theater-series, .feed.mobile, .theater-series');
  const vids = Array.prototype.slice.call(document.querySelectorAll('video')).map(v => ({
    cls: v.className, src: String(v.src || '').slice(0, 14),
    paused: v.paused, t: Number(v.currentTime || 0).toFixed(1), rs: v.readyState, w: v.clientWidth, h: v.clientHeight
  }));
  const txt = sel => { const e = document.querySelector(sel); return e ? (e.textContent || '').trim() : ''; };
  return {
    url: location.href, path: location.pathname + location.search, title: document.title,
    feedKey: document.querySelector('[data-feed-key]') ? document.querySelector('[data-feed-key]').getAttribute('data-feed-key') : '',
    feedCls: feed ? feed.className : '',
    videos: vids,
    seriesTitle: txt('.series-bar .sb-t'),
    strongTitle: txt('.theater-title strong'),
    epLabel: txt('.theater-episode-label'),
    descText: txt('.theater-description-text'),
    tags: Array.prototype.slice.call(document.querySelectorAll('.theater-tags a')).map(a => a.textContent.trim()).slice(0, 8),
    footer: txt('.theater-bottom-episodes'),
    peekNext: txt('.peek.next .peek-cap'),
    epLinks: document.querySelectorAll('a[href*="/ep-"]').length,
    totalHint: (document.body.innerText.match(/已更新\s*\d+\s*集|全\s*\d+\s*集/g) || []).slice(0, 4),
    theaterLinks: Array.prototype.slice.call(document.querySelectorAll('a[href*="/theater"]')).slice(0, 6).map(a => (a.textContent || '').trim().slice(0, 12) + ' -> ' + a.getAttribute('href'))
  };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const log = [];
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
  page.setDefaultTimeout(60000);

  const dump = async (name, extra) => {
    const html = await page.content();
    fs.writeFileSync(`${OUT}/${name}.html`, html);
    const data = await page.evaluate(PROBE);
    const all = Object.assign({}, data, extra || {});
    fs.writeFileSync(`${OUT}/${name}.json`, JSON.stringify(all, null, 1));
    log.push({ name, url: data.url, videos: data.videos.length, cls: data.feedCls, feedKey: data.feedKey });
    return all;
  };

  // A) /theater 列表
  await page.goto(`${BASE}/theater`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2500));
  const theaterHome = await dump('theater-home', {});
  const firstCard = await page.evaluate(() => {
    const a = document.querySelector('a[href*="/drama/"], .theater-card, .feed-card');
    return a ? { tag: a.tagName, href: a.getAttribute('href') || '', cls: a.className, text: (a.innerText || '').trim().slice(0, 20) } : null;
  });
  log.push({ step: 'theater-first-card', firstCard });
  if (firstCard && firstCard.href) {
    const el = await page.$(`a[href="${firstCard.href}"]`);
    if (el) {
      await el.click().catch(() => {});
      await new Promise(r => setTimeout(r, 3000));
      log.push({ step: 'theater-click', after: page.url() });
      await dump('theater-item', { fromCard: firstCard });
    }
  }

  // B) 剧集页点大播放键
  await page.goto(`${BASE}/drama/${SLUG}/ep-1`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2000));
  const before = page.url();
  const clicked = await page.evaluate(() => {
    const cand = document.querySelector('.big-play, .screen, .player, .video');
    if (!cand) return false;
    cand.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  });
  await new Promise(r => setTimeout(r, 3000));
  log.push({ step: 'ep-page-click', before, after: page.url(), clicked });
  await dump('ep-after-play', {});

  fs.writeFileSync(`${OUT}/theater-run.json`, JSON.stringify({ at: new Date().toISOString(), log }, null, 1));
  await browser.close();
  console.log(JSON.stringify(log, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
