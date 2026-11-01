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
const TYPES = {'.mp4': 'video/mp4', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg'};
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

function pickMusic(area, k) {
  let files = [];
  try { files = fs.readdirSync('/files/music').filter((f) => /\.(m4a|mp3|wav)$/i.test(f)).sort(); } catch { /* none */ }
  if (!files.length) return null;
  const a = String(area || '').toLowerCase();
  const want = a.includes('space') ? 'space' : (a.includes('ocean') || a.includes('nature')) ? 'ocean' : a.includes('tech') ? 'discovery' : '';
  const match = files.find((f) => want && f.toLowerCase().includes(want));
  return '/files/music/' + (match || files[(Math.floor(Date.now() / 86400000) + k) % files.length]);
}

function prepareMedia(P) {
  const dir = `/files/work/remo_${P.k}`;
  fs.mkdirSync(dir, {recursive: true});
  const media = {scenes: []};

  // voice: raw PCM -> loudness-normalised stereo WAV
  ff(['-f', 's16le', '-ar', String(P.voice.rate), '-ac', '1', '-i', P.voice.file,
    '-af', 'loudnorm=I=-15:TP=-1.5:LRA=9', '-ar', '44100', '-ac', '2', `${dir}/voice.wav`]);
  media.voice = MEDIA + `${dir}/voice.wav`;

  // stock clips: download, loop to length, crop to 9:16
  P.segDur.forEach((d, i) => {
    const L = (i < P.segDur.length - 1 ? d + 0.5 : d + 2.5).toFixed(2);
    const raw = `${dir}/raw_${i}.mp4`, scene = `${dir}/scene_${i}.mp4`;
    for (const url of (P.clips[i] || [])) {
      try {
        ff(['-i', url, '-t', String(Number(L) + 1), '-an', '-c', 'copy', raw], 120000);
        ff(['-stream_loop', '-1', '-i', raw, '-t', L, '-an',
          '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', scene]);
        if (exists(scene)) break;
      } catch (e) { log(`clip ${i} failed: ${String(e.stderr || e.message).slice(0, 200)}`); }
    }
    media.scenes.push(exists(scene) ? MEDIA + scene : null);
    try { fs.unlinkSync(raw); } catch { /* ok */ }
  });

  // sound effects (synthesised, cached)
  const whoosh = '/files/work/sfx_whoosh.wav', boom = '/files/work/sfx_boom.wav';
  try {
    if (!exists(whoosh)) ff(['-f', 'lavfi', '-i', 'anoisesrc=color=pink:d=0.9:a=0.7:r=44100', '-af', 'highpass=f=250,lowpass=f=2600,afade=t=in:d=0.5:curve=exp,afade=t=out:st=0.5:d=0.4,aecho=0.6:0.4:60:0.3,volume=0.9', '-ac', '2', whoosh]);
    if (!exists(boom)) ff(['-f', 'lavfi', '-i', "aevalsrc='0.9*sin(2*PI*(46+30*exp(-6*t))*t)*exp(-2.8*t)':s=44100:d=1.6", '-af', 'lowpass=f=180,aecho=0.7:0.6:120|260:0.4|0.25,volume=1.2', '-ac', '2', boom]);
  } catch (e) { log('sfx failed', String(e.stderr || e.message).slice(0, 200)); }
  if (exists(whoosh)) media.whoosh = MEDIA + whoosh;
  if (exists(boom)) media.boom = MEDIA + boom;

  const music = pickMusic(P.area, P.k);
  if (music) media.music = MEDIA + music;
  const logo = ['/files/assets/logo.png'].find(exists);
  if (logo) media.logo = MEDIA + logo;
  return media;
}

async function render(propsFile, outName) {
  const P = JSON.parse(fs.readFileSync(propsFile, 'utf8'));
  const t0 = Date.now();
  const media = prepareMedia(P);
  log(`media ready (${media.scenes.filter(Boolean).length}/${P.segDur.length} clips) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
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
