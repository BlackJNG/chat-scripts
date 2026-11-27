// 妈妈短剧「连播 / 剧场」页结构采集：从剧集详情页点播进入，记录真实路由 + 播放器 DOM
const fs = require('fs');
const puppeteer = require('puppeteer');

const OUT = 'capture/out';
const BASE = 'https://mamaduanju.com';
const SLUG = process.env.MAMA_SLUG || 'ren-yi-men';

const THEATER_PROBE = () => {
  const feed = document.querySelector('.feed.mobile.theater-series, .feed.mobile, .theater-series');
  const vids = Array.prototype.slice.call(document.querySelectorAll('.vslot, video')).map(v => ({
    tag: v.tagName, cls: v.className,
    src: String(v.src || '').slice(0, 14),
    paused: v.paused, t: v.currentTime, rs: v.readyState, w: v.clientWidth, h: v.clientHeight
  }));
  const txt = sel => { const e = document.querySelector(sel); return e ? (e.textContent || '').trim() : ''; };
  return {
    url: location.href, title: document.title,
    feedKey: (document.querySelector('[data-feed-key]') || {}).getAttribute
      ? document.querySelector('[data-feed-key]').getAttribute('data-feed-key') : '',
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
    bodyHas: (document.body.innerText.match(/已更新\s*\d+\s*集|全\s*\d+\s*集|选集/g) || []).slice(0, 5),
    feedOuter: feed ? feed.outerHTML.slice(0, 600) : ''
  };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const log = [];
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
  page.setDefaultTimeout(60000);

  // 1) 详情页：列出所有可能进播放的入口
  await page.goto(`${BASE}/drama/${SLUG}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2000));
  const entries = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('a,button').forEach(el => {
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 14);
      const h = el.getAttribute('href') || '';
      if (!t && !h) return;
      if (/播|看|连播|剧场|开始/.test(t) || /theater|feed|play|watch/.test(h)) {
        out.push({ tag: el.tagName, text: t, href: h, cls: el.className });
      }
    });
    return out.slice(0, 20);
  });
  log.push({ step: 'detail-entries', slug: SLUG, entries });

  // 2) 点第一个像「立即观看」的入口
  const pick = await page.evaluateHandle(() => {
    const cands = Array.prototype.slice.call(document.querySelectorAll('a,button'))
      .filter(el => /立即观看|开始观看|播放|连播|剧场/.test((el.innerText || '')));
    return cands[0] || null;
  });
  if (pick && pick.asElement()) {
    const before = page.url();
    await pick.asElement().click().catch(() => {});
    await new Promise(r => setTimeout(r, 2500));
    log.push({ step: 'clicked', before, after: page.url() });
  } else {
    log.push({ step: 'clicked', note: '未找到入口按钮' });
  }

  // 3) 采集当前页（可能就是剧场页）
  await page.waitForTimeout ? 0 : 0;
  const html = await page.content();
  fs.writeFileSync(`${OUT}/theater.html`, html);
  const data = await page.evaluate(THEATER_PROBE);
  fs.writeFileSync(`${OUT}/theater.json`, JSON.stringify(data, null, 1));
  log.push({ step: 'captured', url: data.url, cls: data.feedCls, videos: data.videos.length });

  fs.writeFileSync(`${OUT}/theater-run.json`, JSON.stringify({ at: new Date().toISOString(), log }, null, 1));
  await browser.close();
  console.log(JSON.stringify(log, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
