// Remotion render service for Deep Dot Files.
// POST /render {"props": "/files/work/props_0.json", "out": "video.mp4"}  ->  /files/out/video.mp4
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';

const PORT = 3000;
const MEDIA_PORT = 3001;
const MEDIA = `http://localhost:${MEDIA_PORT}`;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- bundle the template once, in the background ----------
let bundlePromise = null;
const getBundle = () => {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      const R = await import('@remotion/renderer');
      if (typeof R.ensureBrowser === 'function') await R.ensureBrowser();
      const url = await bundle({entryPoint: path.resolve('src/index.jsx'), publicDir: path.resolve('public')});
      log('template bundled');
      return url;
    })();
    bundlePromise.catch((e) => { log('bundle failed', e); bundlePromise = null; });
  }
  return bundlePromise;
};
getBundle();

// ---------- small file server so the browser can load /files/... ----------
const TYPES = {'.jpeg': 'image/jpeg', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg'};
http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!p.startsWith('/files/') || p.includes('..')) { res.statusCode = 404; return res.end(); }
  fs.stat(p, (err, st) => {
    if (err || !st.isFile()) { res.statusCode = 404; return res.end(); }
    const type = TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', type);
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${st.size}`);
      res.setHeader('Content-Length', end - start + 1);
      return fs.createReadStream(p, {start, end}).pipe(res);
    }
    res.setHeader('Content-Length', st.size);
    fs.createReadStream(p).pipe(res);
  });
}).listen(MEDIA_PORT);

// ---------- helpers ----------
const ff = (args, timeout = 240000) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {timeout, stdio: ['ignore', 'ignore', 'pipe']});
const exists = (f) => { try { return fs.statSync(f).size > 0; } catch { return false; } };

// ---------- real photos: NASA (public domain) + Wikimedia Commons (free licences, credited on screen) ----------
const UA = 'DeepDotFilesBot/1.0 (educational shorts; GitHub Actions)';
const NOT_WANTED = /\b(portraits?|headshots?|astronauts?|crew|official photo|selfie|logos?|signature|flags?|coat of arms|map of|diagrams?|charts?|graphs?|posters?|stamps?|book cover|screenshots?|people|persons?|man|woman|men|women)\b/i;
const getJSON = async (url) => {
  const r = await fetch(url, {headers: {'User-Agent': UA}, signal: AbortSignal.timeout(15000)});
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};
const stripHtml = (h) => String(h || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

async function nasaImages(q) {
  const d = await getJSON('https://images-api.nasa.gov/search?media_type=image&q=' + encodeURIComponent(q));
  return (d.collection?.items || []).slice(0, 12).map((it) => {
    const href = (it.links || []).find((l) => l.render === 'image')?.href;
    const data = (it.data || [])[0] || {};
    if (!href || NOT_WANTED.test(`${data.title} ${(data.keywords || []).join(' ')}`)) return null;
    return {url: href.replace(/~thumb\.jpg$/i, '~large.jpg'), alt: href.replace(/~thumb\.jpg$/i, '~medium.jpg'), credit: 'NASA'};
  }).filter(Boolean);
}

async function commonsImages(q) {
  const u = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=20'
    + '&gsrsearch=' + encodeURIComponent(q + ' filetype:bitmap') + '&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1600';
  const d = await getJSON(u);
  return Object.values(d.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0)).map((p) => {
    const ii = (p.imageinfo || [])[0];
    if (!ii) return null;
    const m = ii.extmetadata || {};
    const lic = stripHtml(m.LicenseShortName?.value);
    const free = /^(public domain|pd|cc0|cc[- ]by(-sa)?\b)/i.test(lic) && !/\b(nc|nd)\b/i.test(lic);
    if (!free || !/jpe?g|png/i.test(ii.mime || '') || (ii.width || 0) < 900) return null;
    if (NOT_WANTED.test(`${p.title} ${stripHtml(m.ImageDescription?.value)} ${stripHtml(m.Categories?.value)}`)) return null;
    const artist = stripHtml(m.Artist?.value).slice(0, 40);
    return {url: ii.thumburl || ii.url, credit: /^(public domain|pd|cc0)/i.test(lic) ? `${artist || 'Wikimedia Commons'} (${lic})` : `${artist || 'Unknown'}, ${lic}, via Wikimedia Commons`};
  }).filter(Boolean);
}

async function realImages(P, dir) {
  const q = String(P.imageQuery || P.story || P.title || '').trim();
  if (!q) return [];
  let cands = [];
  const tries = [
    async () => (String(P.area).toLowerCase().includes('space') ? (await nasaImages(q)).slice(0, 3) : []),
    async () => (await commonsImages(q)).slice(0, 4),
    async () => (cands.length < 2 ? (await commonsImages(q.split(/\s+/).slice(0, 2).join(' '))).slice(0, 3) : []),
  ];
  for (const t of tries) { try { cands.push(...await t()); } catch (e) { log('image search failed:', e.message); } }
  const out = [];
  for (const c of cands) {
    if (out.length >= 4) break;
    for (const url of [c.url, c.alt].filter(Boolean)) {
      try {
        const r = await fetch(url, {headers: {'User-Agent': UA}, signal: AbortSignal.timeout(30000)});
        if (!r.ok) continue;
        const raw = `${dir}/img_raw_${out.length}`, jpg = `${dir}/img_${out.length}.jpg`;
        fs.writeFileSync(raw, Buffer.from(await r.arrayBuffer()));
        ff(['-i', raw, '-frames:v', '1', '-vf', "scale='min(1600,iw)':-2", '-q:v', '3', jpg], 60000);
        fs.unlinkSync(raw);
        const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', jpg]).toString().trim().split(',').map(Number);
        if (w >= 600 && h >= 400) { out.push({src: MEDIA + jpg, w, h, credit: c.credit}); break; }
      } catch (e) { log('image download failed:', String(e.message).slice(0, 120)); }
    }
  }
  log(`real images for "${q}": ${out.length} (${out.map((o) => o.credit).join(' | ')})`);
  return out;
}

function pickMusic(area, k) {
  let files = [];
  try { files = fs.readdirSync('/files/music').filter((f) => /\.(m4a|mp3|wav)$/i.test(f)).sort(); } catch { /* none */ }
  if (!files.length) return null;
  const a = String(area || '').toLowerCase();
  const want = a.includes('space') ? 'space' : (a.includes('ocean') || a.includes('nature')) ? 'ocean' : a.includes('tech') ? 'discovery' : '';
  const match = files.find((f) => want && f.toLowerCase().includes(want));
  return '/files/music/' + (match || files[(Math.floor(Date.now() / 86400000) + k) % files.length]);
}

async function prepareMedia(P) {
  const dir = `/files/work/remo_${P.k}`;
  fs.mkdirSync(dir, {recursive: true});
  const media = {scenes: []};

  // voice: raw PCM -> loudness-normalised stereo WAV
  ff(['-f', 's16le', '-ar', String(P.voice.rate), '-ac', '1', '-i', P.voice.file,
    '-af', 'loudnorm=I=-15:TP=-1.5:LRA=9', '-ar', '44100', '-ac', '2', `${dir}/voice.wav`]);
  media.voice = MEDIA + `${dir}/voice.wav`;

  // stock clips: every clip of a segment becomes its own shot (short, cropped to 9:16)
  media.segClips = [];
  P.segDur.forEach((d, i) => {
    const L = Math.min(7, d + 1).toFixed(2);
    const list = [];
    (P.clips[i] || []).forEach((url, j) => {
      const raw = `${dir}/raw_${i}_${j}.mp4`, scene = `${dir}/scene_${i}_${j}.mp4`;
      try {
        ff(['-i', url, '-t', String(Number(L) + 1), '-an', '-c', 'copy', raw], 120000);
        ff(['-stream_loop', '-1', '-i', raw, '-t', L, '-an',
          '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', scene]);
        if (exists(scene)) list.push(MEDIA + scene);
      } catch (e) { log(`clip ${i}.${j} failed: ${String(e.stderr || e.message).slice(0, 200)}`); }
      try { fs.unlinkSync(raw); } catch { /* ok */ }
    });
    media.segClips.push(list);
  });
  media.scenes = media.segClips.map((l) => l[0] || null);

  // sound effects (synthesised, cached)
  const whoosh = '/files/work/sfx_whoosh.wav', boom = '/files/work/sfx_boom.wav';
  try {
    if (!exists(whoosh)) ff(['-f', 'lavfi', '-i', 'anoisesrc=color=pink:d=0.9:a=0.7:r=44100', '-af', 'highpass=f=250,lowpass=f=2600,afade=t=in:d=0.5:curve=exp,afade=t=out:st=0.5:d=0.4,aecho=0.6:0.4:60:0.3,volume=0.9', '-ac', '2', whoosh]);
    if (!exists(boom)) ff(['-f', 'lavfi', '-i', "aevalsrc='0.9*sin(2*PI*(46+30*exp(-6*t))*t)*exp(-2.8*t)':s=44100:d=1.6", '-af', 'lowpass=f=180,aecho=0.7:0.6:120|260:0.4|0.25,volume=1.2', '-ac', '2', boom]);
  } catch (e) { log('sfx failed', String(e.stderr || e.message).slice(0, 200)); }
  if (exists(whoosh)) media.whoosh = MEDIA + whoosh;
  if (exists(boom)) media.boom = MEDIA + boom;

  media.images = await realImages(P, dir);
  const music = pickMusic(P.area, P.k);
  if (music) media.music = MEDIA + music;
  const logo = ['/files/assets/logo.png'].find(exists);
  if (logo) media.logo = MEDIA + logo;
  return media;
}

async function render(propsFile, outName) {
  const P = JSON.parse(fs.readFileSync(propsFile, 'utf8'));
  const t0 = Date.now();
  const media = await prepareMedia(P);
  log(`media ready (${media.segClips.flat().length} clips, ${media.images.length} photos) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const inputProps = {...P, media};
  const serveUrl = await getBundle();
  const composition = await selectComposition({serveUrl, id: 'Story', inputProps});
  const outputLocation = `/files/out/${outName}`;
  let last = -1;
  await renderMedia({
    composition, serveUrl, inputProps, outputLocation,
    codec: 'h264', crf: 20, audioBitrate: '192k', x264Preset: 'veryfast',
    concurrency: Math.max(1, os.cpus().length),
    timeoutInMilliseconds: 120000,
    onProgress: ({progress}) => { const p = Math.floor(progress * 10); if (p !== last) { last = p; log(`rendering ${p * 10}%`); } },
  });
  log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${outputLocation}`);
  return fs.statSync(outputLocation).size;
}

// ---------- API ----------
let busy = Promise.resolve();
http.createServer((req, res) => {
  if (req.method === 'GET') { res.end('ok'); return; }
  if (req.method !== 'POST' || !req.url.startsWith('/render')) { res.statusCode = 404; res.end(); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    busy = busy.then(async () => {
      try {
        const {props, out} = JSON.parse(body);
        if (!/^[\w.-]+\.mp4$/.test(String(out))) throw new Error('bad output name');
        const size = await render(props, out);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ok: true, size}));
      } catch (e) {
        log('render failed', e);
        res.statusCode = 500;
        res.end(JSON.stringify({ok: false, error: String(e && e.stack || e).slice(0, 1500)}));
      }
    });
  });
}).listen(PORT, () => log(`remotion service on :${PORT}`));
