// Deep Dot Files - animated story template (Remotion)
// Props come from the n8n workflow: title, area, brand, segDur, voiceEnd, end, words[{w,s,e,c}], media{...}
import React from 'react';
import {
  AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, Easing,
  interpolate, spring, random, useCurrentFrame, useVideoConfig,
} from 'remotion';
import {TransitionSeries, linearTiming} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {slide} from '@remotion/transitions/slide';
import {wipe} from '@remotion/transitions/wipe';
import {clockWipe} from '@remotion/transitions/clock-wipe';

const NAVY = '#06182A';
const CYAN = '#33D6E0';
const FONT = "'Archivo Black', 'Arial Black', 'DejaVu Sans', sans-serif";
const T = 14; // transition length in frames
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'};
const cleanWord = (w) => String(w || '').replace(/[{}\\]/g, '').toUpperCase();

// ---------- one shot: stock clip or real photo ----------
const kenBurns = (p, mode) => ({
  scale: mode === 0 ? interpolate(p, [0, 1], [1.02, 1.14]) : mode === 1 ? interpolate(p, [0, 1], [1.14, 1.04]) : 1.1,
  x: mode === 2 ? interpolate(p, [0, 1], [-40, 40]) : 0,
  y: mode === 1 ? interpolate(p, [0, 1], [18, -18]) : 0,
});

const Shot = ({shot, len}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = Math.min(1, f / Math.max(1, len));
  const kb = kenBurns(p, shot.mode);
  // punch-in on the very first shot, a small bump on every other cut
  const punch = shot.opening ? interpolate(spring({frame: f, fps, config: {damping: 14, stiffness: 160}}), [0, 1], [0.28, 0])
    : interpolate(f, [0, 6], [0.05, 0], clamp);
  const src = shot.src;
  const bg = {overflow: 'hidden', background: `radial-gradient(circle at 50% 40%, #0d3352 0%, ${NAVY} 70%)`};
  if (!src) return <AbsoluteFill style={bg} />;
  if (src.type === 'vid') {
    return (
      <AbsoluteFill style={bg}>
        <OffthreadVideo src={src.src} muted startFrom={src.offset || 0} style={{
          width: '100%', height: '100%', objectFit: 'cover',
          transform: `scale(${kb.scale + punch}) translate(${kb.x}px, ${kb.y}px)`,
          filter: 'saturate(0.9) contrast(1.08) brightness(0.88)',
        }} />
      </AbsoluteFill>
    );
  }
  const wide = src.w / src.h > 0.75;
  if (!wide) {
    return (
      <AbsoluteFill style={bg}>
        <Img src={src.src} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${kb.scale + punch}) translate(${kb.x}px, ${kb.y}px)`}} />
      </AbsoluteFill>
    );
  }
  // landscape photo: show the whole picture on a blurred copy of itself
  const fw = 1000, fh = Math.min(820, Math.round(fw * src.h / src.w));
  const zoom = interpolate(p, [0, 1], [1, 1.07]) + punch;
  return (
    <AbsoluteFill style={bg}>
      <Img src={src.src} style={{width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(38px) brightness(0.45) saturate(1.2)', transform: 'scale(1.25)'}} />
      <div style={{
        position: 'absolute', left: 40, top: 300 + (820 - fh) / 2, width: fw, height: fh, borderRadius: 28, overflow: 'hidden',
        border: '2px solid rgba(51,214,224,0.35)', boxShadow: '0 30px 80px rgba(0,0,0,0.6), 0 0 40px rgba(51,214,224,0.15)',
        transform: `scale(${zoom})`,
      }}>
        <Img src={src.src} style={{width: '100%', height: '100%', objectFit: 'cover',
          transform: `scale(${interpolate(p, [0, 1], [1.04, 1.12])}) translateX(${shot.mode === 2 ? interpolate(p, [0, 1], [-14, 14]) : 0}px)`}} />
      </div>
    </AbsoluteFill>
  );
};

const Credit = ({text}) => (text ? (
  <div style={{position: 'absolute', left: 36, right: 36, bottom: 30, color: 'rgba(255,255,255,0.72)', fontFamily: "'DejaVu Sans', sans-serif",
    fontSize: 21, textShadow: '0 2px 6px #000', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
    Image: {text}
  </div>
) : null);

// ---------- colour grade + vignette ----------
const Grade = () => (
  <AbsoluteFill>
    <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(6,24,42,0.85) 0%, rgba(6,24,42,0.35) 22%, rgba(6,24,42,0) 40%, rgba(6,24,42,0) 55%, rgba(6,24,42,0.55) 75%, rgba(6,24,42,0.92) 100%)'}} />
    <AbsoluteFill style={{background: 'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)'}} />
    <AbsoluteFill style={{background: 'linear-gradient(135deg, rgba(51,214,224,0.10), rgba(0,0,0,0) 50%, rgba(255,170,90,0.06))', mixBlendMode: 'screen'}} />
  </AbsoluteFill>
);

// ---------- floating glowing particles ----------
const Particles = ({until}) => {
  const f = useCurrentFrame();
  if (f > until) return null;
  const fadeOut = interpolate(f, [until - 15, until], [1, 0], clamp);
  return (
    <AbsoluteFill style={{opacity: fadeOut}}>
      {new Array(22).fill(0).map((_, i) => {
        const x0 = random('x' + i) * 1080;
        const y0 = 380 + random('y' + i) * 1400;
        const sp = 0.4 + random('s' + i) * 1.1;
        const r = 2 + random('r' + i) * 5;
        const x = x0 + Math.sin(f / 40 + i) * 18;
        const yy = ((((y0 - f * sp) - 300) % 1500) + 1500) % 1500 + 300;
        const op = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(f / 18 + i * 1.7));
        const col = random('c' + i) < 0.6 ? CYAN : '#FFFFFF';
        return (
          <div key={i} style={{
            position: 'absolute', left: x, top: yy, width: r * 2, height: r * 2, borderRadius: '50%',
            background: col, opacity: op, filter: `blur(${1 + r * 0.4}px)`, boxShadow: `0 0 ${r * 4}px ${col}`,
          }} />
        );
      })}
    </AbsoluteFill>
  );
};

// ---------- light sweep on every cut ----------
const LightSweep = () => {
  const f = useCurrentFrame();
  const x = interpolate(f, [0, 16], [-900, 1300]);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{background: '#F5E9C8', opacity: interpolate(f, [0, 3, 9], [0, 0.18, 0], clamp)}} />
      <div style={{
        position: 'absolute', top: -400, left: x, width: 420, height: 2800, transform: 'rotate(18deg)',
        background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(190,250,255,0.9), rgba(255,255,255,0))',
        opacity: interpolate(f, [0, 4, 12, 16], [0, 0.55, 0.35, 0], clamp), filter: 'blur(18px)',
      }} />
    </AbsoluteFill>
  );
};

// ---------- channel label (top left) ----------
const Brand = ({logo, name}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame: f, fps, config: {damping: 16}});
  return (
    <div style={{
      position: 'absolute', left: 40, top: 50, display: 'flex', alignItems: 'center', gap: 18,
      padding: '12px 30px 12px 12px', borderRadius: 60, background: 'rgba(6,24,42,0.72)',
      border: '2px solid rgba(51,214,224,0.55)', boxShadow: '0 0 30px rgba(51,214,224,0.25)',
      transform: `translateX(${(1 - s) * -420}px)`, opacity: s,
    }}>
      {logo ? <Img src={logo} style={{width: 70, height: 70, borderRadius: '50%'}} />
        : <div style={{width: 70, height: 70, borderRadius: '50%', background: CYAN}} />}
      <div style={{color: '#fff', fontSize: 32, letterSpacing: 3}}>{String(name || '').toUpperCase()}</div>
    </div>
  );
};

// ---------- topic icon ----------
const AreaIcon = ({area, size = 40}) => {
  const a = String(area || '').toLowerCase();
  const st = {width: size, height: size};
  if (a.includes('space')) {
    return (
      <svg viewBox="0 0 40 40" style={st}>
        <circle cx="20" cy="20" r="9" fill={CYAN} />
        <ellipse cx="20" cy="20" rx="18" ry="6" fill="none" stroke="#fff" strokeWidth="2.5" transform="rotate(-20 20 20)" />
      </svg>
    );
  }
  if (a.includes('ocean')) {
    return (
      <svg viewBox="0 0 40 40" style={st}>
        <path d="M2 16 Q8 10 14 16 T26 16 T38 16" stroke={CYAN} strokeWidth="3.5" fill="none" />
        <path d="M2 26 Q8 20 14 26 T26 26 T38 26" stroke="#fff" strokeWidth="3" fill="none" />
      </svg>
    );
  }
  if (a.includes('tech')) {
    return (
      <svg viewBox="0 0 40 40" style={st}>
        <rect x="11" y="11" width="18" height="18" rx="3" fill={CYAN} />
        {[15, 20, 25].map((v) => (
          <g key={v} stroke="#fff" strokeWidth="2.5">
            <line x1={v} y1="4" x2={v} y2="10" /><line x1={v} y1="30" x2={v} y2="36" />
            <line x1="4" y1={v} x2="10" y2={v} /><line x1="30" y1={v} x2="36" y2={v} />
          </g>
        ))}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 40 40" style={st}>
      <path d="M8 32 C8 14 20 6 34 6 C34 22 26 34 8 32 Z" fill={CYAN} />
      <path d="M8 32 L26 14" stroke={NAVY} strokeWidth="2.5" />
    </svg>
  );
};

// ---------- opening hook: 2-4 huge words that punch in ----------
const Hook = ({text}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const words = String(text || '').toUpperCase().split(/\s+/).filter(Boolean).slice(0, 5);
  const out = interpolate(f, [Math.round(1.9 * fps), Math.round(2.3 * fps)], [1, 0], clamp);
  if (!words.length || out <= 0) return null;
  const shake = f < 8 ? Math.sin(f * 2.3) * (8 - f) * 1.4 : 0;
  const size = words.join(' ').length > 18 ? 104 : 124;
  return (
    <div style={{position: 'absolute', left: 30, right: 30, top: 1150, textAlign: 'center', opacity: out,
      transform: `translate(${shake}px, ${-shake * 0.5}px) scale(${1 + (1 - out) * 0.1})`}}>
      {words.map((w, i) => {
        const s = spring({frame: f - i * 4, fps, config: {damping: 11, stiffness: 190}});
        const last = i === words.length - 1;
        return (
          <span key={i} style={{
            display: 'inline-block', margin: '0 0.14em', fontSize: size, lineHeight: 1.05, color: last ? NAVY : '#fff',
            background: last ? CYAN : 'transparent', padding: last ? '0 18px' : 0, borderRadius: 16,
            boxShadow: last ? `0 0 50px rgba(51,214,224,0.7)` : 'none', opacity: Math.min(1, s * 1.5),
            transform: `scale(${interpolate(s, [0, 1], [1.8, 1])}) rotate(${last ? -2 : 0}deg)`,
            textShadow: last ? 'none' : '0 8px 30px rgba(0,0,0,0.85), 0 0 3px #000',
          }}>{w}</span>
        );
      })}
    </div>
  );
};

// ---------- animated fact card: number counts up ----------
const countUp = (value, p) => {
  const m = /^([^\d-]*)(-?[\d][\d,]*\.?\d*)(.*)$/.exec(String(value));
  if (!m) return String(value);
  const raw = m[2], n = parseFloat(raw.replace(/,/g, ''));
  if (!isFinite(n) || /^(1[5-9]|20)\d\d$/.test(raw)) return String(value);   // years stay as they are
  const dec = (raw.split('.')[1] || '').length;
  const v = n * p;
  const txt = raw.includes(',') ? v.toLocaleString('en-US', {minimumFractionDigits: dec, maximumFractionDigits: dec}) : v.toFixed(dec);
  return m[1] + txt + m[3];
};

const FactCard = ({fact}) => {
  const f = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const s = spring({frame: f, fps, config: {damping: 13, stiffness: 150}});
  const out = interpolate(f, [durationInFrames - 8, durationInFrames], [1, 0], clamp);
  const p = interpolate(f, [4, 26], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  return (
    <div style={{position: 'absolute', left: 0, right: 0, top: 930, display: 'flex', justifyContent: 'center', opacity: out}}>
      <div style={{
        padding: '22px 46px 24px', borderRadius: 30, background: 'rgba(6,24,42,0.82)', border: `3px solid ${CYAN}`,
        boxShadow: `0 0 50px rgba(51,214,224,0.35), 0 20px 60px rgba(0,0,0,0.5)`, textAlign: 'center',
        transform: `scale(${interpolate(s, [0, 1], [0.6, 1])}) translateY(${(1 - s) * 40}px)`, opacity: Math.min(1, s * 1.4),
      }}>
        <div style={{fontSize: 96, lineHeight: 1, color: CYAN, textShadow: `0 0 30px rgba(51,214,224,0.6)`}}>{countUp(String(fact.value).toUpperCase(), p)}</div>
        <div style={{fontSize: 34, marginTop: 10, color: '#fff', letterSpacing: 2}}>{String(fact.label || '').toUpperCase()}</div>
      </div>
    </div>
  );
};

// short caption groups: at most 3 words, break after punctuation
const groupWords = (words) => {
  let g = 0, n = 0;
  return words.map((w, i) => {
    if (i > 0 && (n >= 3 || /[.!?,;:]$/.test(String(words[i - 1].w)) || w.s - words[i - 1].e > 0.35)) { g++; n = 0; }
    n++;
    return {...w, c: g};
  });
};

// ---------- word-by-word captions ----------
const Captions = ({words, voiceEnd}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = f / fps;
  if (!words.length || t > voiceEnd || t < 2.25) return null;
  let idx = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i].s <= t) idx = i; else break;
  }
  if (idx < 0) return null;
  const c = words[idx].c;
  const chunk = words.filter((w) => w.c === c);
  const pop = spring({frame: Math.round((t - chunk[0].s) * fps), fps, config: {damping: 12, stiffness: 180}});
  const chars = chunk.reduce((a, w) => a + cleanWord(w.w).length, 0) + chunk.length - 1;
  const size = chars > 20 ? 58 : chars > 16 ? 66 : 76;
  return (
    <div style={{
      position: 'absolute', left: 40, right: 40, top: 1240, display: 'flex',
      justifyContent: 'center', alignItems: 'center', gap: '12px 16px', flexWrap: 'nowrap',
      transform: `scale(${0.85 + 0.15 * pop}) translateY(${(1 - pop) * 25}px)`, opacity: Math.min(1, pop * 1.4),
    }}>
      {chunk.map((w, i) => {
        const nextS = i < chunk.length - 1 ? chunk[i + 1].s : Infinity;
        const active = t >= w.s && t < nextS;
        const ws = spring({frame: Math.max(0, Math.round((t - w.s) * fps)), fps, config: {damping: 10, stiffness: 220}});
        return (
          <span key={i} style={{
            display: 'inline-block', fontSize: size, lineHeight: 1.15, whiteSpace: 'nowrap', padding: '2px 16px', borderRadius: 14,
            color: active ? NAVY : '#fff', background: active ? CYAN : 'transparent',
            boxShadow: active ? '0 0 34px rgba(51,214,224,0.7)' : 'none',
            transform: `scale(${active ? 1 + 0.1 * ws : 1}) rotate(${active ? -2 : 0}deg)`,
            opacity: t >= w.s ? 1 : 0.55,
            textShadow: active ? 'none' : '0 5px 18px rgba(0,0,0,0.85), 0 0 3px #000',
          }}>{cleanWord(w.w)}</span>
        );
      })}
    </div>
  );
};

const Progress = ({total}) => {
  const f = useCurrentFrame();
  return (
    <div style={{
      position: 'absolute', left: 0, bottom: 0, height: 10, width: interpolate(f, [0, total], [0, 1080], clamp),
      background: CYAN, boxShadow: `0 0 20px ${CYAN}`,
    }} />
  );
};

// ---------- outro: horizon arc + glowing dot + logo + call to action ----------
const Outro = ({logo, brand}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const bg = interpolate(f, [0, 14], [0, 0.94], clamp);
  const arc = interpolate(f, [4, 30], [1, 0], {...clamp, easing: Easing.out(Easing.cubic)});
  const dot = spring({frame: f - 16, fps, config: {damping: 9}});
  const logoS = spring({frame: f - 6, fps, config: {damping: 12}});
  const t1 = spring({frame: f - 14, fps});
  const t2 = spring({frame: f - 22, fps});
  const pulse = 0.5 + 0.5 * Math.sin(f / 5);
  return (
    <AbsoluteFill style={{background: `rgba(6,24,42,${bg})`, alignItems: 'center'}}>
      <svg width="1080" height="1920" style={{position: 'absolute', left: 0, top: 0}}>
        <path d="M 90 1060 Q 540 860 990 1060" fill="none" stroke={CYAN} strokeWidth="6" strokeLinecap="round"
          pathLength="1" strokeDasharray="1" strokeDashoffset={arc} />
      </svg>
      <div style={{
        position: 'absolute', left: 522, top: interpolate(dot, [0, 1], [1010, 922]), width: 36, height: 36,
        borderRadius: '50%', background: '#fff', opacity: dot, boxShadow: `0 0 40px #fff, 0 0 ${60 + 30 * pulse}px ${CYAN}`,
      }} />
      <div style={{
        position: 'absolute', top: 580, width: 300, height: 300, borderRadius: '50%', overflow: 'hidden',
        transform: `scale(${logoS})`, boxShadow: `0 0 ${60 + 40 * pulse}px rgba(51,214,224,0.55)`,
      }}>
        {logo ? <Img src={logo} style={{width: 300, height: 300}} /> : <div style={{width: 300, height: 300, background: NAVY}} />}
      </div>
      <div style={{
        position: 'absolute', top: 1150, width: 1000, textAlign: 'center', color: '#fff', fontSize: 72, lineHeight: 1.15,
        opacity: t1, transform: `translateY(${(1 - t1) * 40}px)`,
      }}>
        FOLLOW<br /><span style={{color: CYAN}}>{String(brand || '').toUpperCase()}</span>
      </div>
      <div style={{position: 'absolute', top: 1370, color: '#cfe9ee', fontSize: 34, letterSpacing: 6, opacity: t2}}>
        NEW MYSTERIES EVERY DAY
      </div>
    </AbsoluteFill>
  );
};

const END_PAD = 2.0; // seconds of outro after the voice

const musicVolume = (f, fps, p) => {
  const t = f / fps;
  const end = Number(p.voiceEnd || 20) + END_PAD;
  const fadeIn = interpolate(t, [0, 0.6], [0.3, 1], clamp);
  const fadeOut = interpolate(t, [end - 1.2, end], [1, 0], clamp);
  const level = interpolate(t, [p.voiceEnd - 0.2, p.voiceEnd + 0.4], [0.16, 0.42], clamp);
  return level * fadeIn * fadeOut;
};

const presentations = [
  () => fade(),
  () => slide({direction: 'from-right'}),
  () => wipe({direction: 'from-bottom-left'}),
  () => clockWipe({width: 1080, height: 1920}),
  () => slide({direction: 'from-bottom'}),
  () => fade(),
];

// split every segment into ~2.6 s shots; real photos alternate with stock clips (photo first)
const buildShots = (p, media, fps, segF) => {
  const images = media.images || [];
  const segClips = media.segClips || (media.scenes || []).map((x) => (x ? [x] : []));
  const shots = [];
  let img = 0;
  segF.forEach((d, i) => {
    const n = Math.max(1, Math.round(d / fps / 2.6));
    const base = Math.floor(d / n);
    const clips = segClips[i] || [];
    let c = 0;
    for (let j = 0; j < n; j++) {
      const len = j === n - 1 ? d - base * (n - 1) : base;
      const wantPhoto = images.length && (shots.length === 0 || shots.length % 2 === 0 || !clips.length) && img < images.length * 2;
      let src = null;
      if (wantPhoto) {
        src = {type: 'img', ...images[img % images.length]};
        img++;
      } else if (clips.length) {
        src = {type: 'vid', src: clips[c % clips.length], offset: Math.floor(c / clips.length) * 75};
        c++;
      } else if (images.length) {
        src = {type: 'img', ...images[img % images.length]};
        img++;
      }
      shots.push({seg: i, len, src, segStart: j === 0, opening: shots.length === 0, mode: (shots.length + Number(p.k || 0)) % 3});
    }
  });
  return shots;
};

export const Story = (p) => {
  const {fps} = useVideoConfig();
  const media = p.media || {};
  const segF = (p.segDur || [10]).map((d) => Math.max(T + 6, Math.round(d * fps)));
  const cutF = [];
  segF.slice(0, -1).reduce((acc, d) => { acc += d; cutF.push(acc); return acc; }, 0);
  const voiceEndF = Math.round(Number(p.voiceEnd || 20) * fps);
  const k = Number(p.k || 0);
  const shots = buildShots(p, media, fps, segF);

  const items = [];
  const credits = [];
  let at = 0;
  shots.forEach((sh, i) => {
    const last = i === shots.length - 1;
    const nextIsSeg = !last && shots[i + 1].segStart;
    const len = last ? sh.len + 90 : nextIsSeg ? sh.len + T : sh.len;
    items.push(
      <TransitionSeries.Sequence key={'s' + i} durationInFrames={len}>
        <Shot shot={sh} len={len} />
      </TransitionSeries.Sequence>,
    );
    if (sh.src && sh.src.type === 'img') credits.push({from: at, len: sh.len, text: sh.src.credit});
    at += sh.len;
    if (nextIsSeg) {
      items.push(
        <TransitionSeries.Transition key={'t' + i} presentation={presentations[(i + k) % presentations.length]()}
          timing={linearTiming({durationInFrames: T, easing: Easing.inOut(Easing.cubic)})} />,
      );
    }
  });

  const facts = (p.facts || []).filter((x) => x && x.value).slice(0, 2);
  const factAt = (n) => (cutF[n] !== undefined ? cutF[n] + Math.round(0.5 * fps) : null);

  return (
    <AbsoluteFill style={{backgroundColor: NAVY, fontFamily: FONT}}>
      <TransitionSeries>{items}</TransitionSeries>
      <Grade />
      <Particles until={voiceEndF} />
      {cutF.map((c, i) => (
        <Sequence key={'sw' + i} from={c} durationInFrames={16}><LightSweep /></Sequence>
      ))}
      {credits.map((c, i) => (
        <Sequence key={'cr' + i} from={c.from} durationInFrames={Math.max(1, c.len)}><Credit text={c.text} /></Sequence>
      ))}
      <Sequence durationInFrames={voiceEndF}><Brand logo={media.logo} name={p.brand} /></Sequence>
      <Sequence durationInFrames={Math.round(2.4 * fps)}><Hook text={p.hook || p.title} /></Sequence>
      {facts.map((fact, i) => (factAt(i) !== null && factAt(i) < voiceEndF - fps ? (
        <Sequence key={'f' + i} from={factAt(i)} durationInFrames={Math.round(2.6 * fps)}><FactCard fact={fact} /></Sequence>
      ) : null))}
      <Captions words={groupWords(p.words || [])} voiceEnd={Number(p.voiceEnd || 20)} />
      <Sequence durationInFrames={voiceEndF}><Progress total={voiceEndF} /></Sequence>
      <Sequence from={Math.max(0, voiceEndF - 3)}><Outro logo={media.logo} brand={p.brand} /></Sequence>

      {media.voice ? <Audio src={media.voice} /> : null}
      {media.music ? <Audio src={media.music} loop volume={(f) => musicVolume(f, fps, p)} /> : null}
      {media.boom ? <Audio src={media.boom} volume={0.8} /> : null}
      {media.whoosh ? cutF.map((c, i) => (
        <Sequence key={'wh' + i} from={Math.max(0, c - 12)} durationInFrames={30}><Audio src={media.whoosh} volume={0.45} /></Sequence>
      )) : null}
      {media.boom ? facts.map((fact, i) => (factAt(i) !== null ? (
        <Sequence key={'fb' + i} from={factAt(i)} durationInFrames={40}><Audio src={media.boom} volume={0.35} /></Sequence>
      ) : null)) : null}
    </AbsoluteFill>
  );
};
