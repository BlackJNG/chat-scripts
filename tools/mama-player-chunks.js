// 全量下载站点 vite chunks，定位播放器组件源码
const fs = require('fs');
const OUT = 'capture/out';
const SRC = `${OUT}/src2`;
const BASE = 'https://mamaduanju.com';

const KEYS = ['vslot', 'big-play', 'landscape-full', 'theater-speed', 'm-progress', 'clear_enter',
  'requestFullscreen', 'orientation', 'playbackRate', 'MediaSource', 'addSourceBuffer',
  'isTypeSupported', 'pointerdown', 'pointermove', 'passive', 'swipe', 'clearScreen', '清屏'];

const snip = (text, kw) => text.slice(Math.max(0, kw.at - 200), kw.at + 260);

(async () => {
  fs.mkdirSync(SRC, { recursive: true });
  const home = await (await fetch(BASE + '/')).text();
  const entry = (home.match(/src="([^"]+\/assets\/[^"]+\.js)"/) || [])[1] || (home.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/) || [])[1];
  console.log('entry', entry);
  const etext = await (await fetch(new URL(entry, BASE))).text();
  const arr = (etext.match(/m\.f=\[([^\]]+)\]/) || [])[1] || '';
  const files = Array.from(new Set((arr.match(/"[^"]+\.js"/g) || []).map(x => x.slice(1, -1))));
  console.log('chunks', files.length);

  const base = new URL(entry, BASE);
  const results = [];
  const pool = (items, n, fn) => Promise.all(Array.from({ length: n }, (_, k) =>
    (async () => { for (let i = k; i < items.length; i += n) await fn(items[i], i); })()));

  await pool(files, 10, async (f) => {
    try {
      const u = new URL(f, base).href;
      const res = await fetch(u);
      if (!res.ok) { results.push({ f, status: res.status }); return; }
      const text = await res.text();
      const hits = {};
      for (const kw of KEYS) {
        const i = text.indexOf(kw);
        if (i >= 0) hits[kw] = text.slice(Math.max(0, i - 200), i + 260);
      }
      const k = Object.keys(hits);
      if (k.length) {
        fs.writeFileSync(`${SRC}/${f.replace('./', '')}`, text);
        results.push({ f, bytes: text.length, keys: k, hits });
      } else {
        results.push({ f, bytes: text.length });
      }
    } catch (e) { results.push({ f, err: String(e.message || e) }); }
  });

  const hot = results.filter(r => r.keys);
  fs.writeFileSync(`${OUT}/player-chunks.json`, JSON.stringify({ at: new Date().toISOString(), entry, total: files.length, hot }, null, 1));
  console.log(JSON.stringify(hot.map(h => ({ f: h.f, kb: Math.round(h.bytes / 1024), keys: h.keys })), null, 1));
})().catch(e => { console.error(e); process.exit(1); });
