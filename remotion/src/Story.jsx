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

// ---------- background scene (stock clip with slow camera move) ----------
const Scene = ({src, idx, dur}) => {
  const f = useCurrentFrame();
  const p = Math.min(1, f / Math.max(1, dur));
  const mode = idx % 3;
  const scale = mode === 0 ? interpolate(p, [0, 1], [1.02, 1.16]) : mode === 1 ? interpolate(p, [0, 1], [1.16, 1.04]) : 1.12;
  const x = mode === 2 ? interpolate(p, [0, 1], [-45, 45]) : 0;
  const y = mode === 1 ? interpolate(p, [0, 1], [20, -20]) : 0;
  return (
    <AbsoluteFill style={{overflow: 'hidden', background: `radial-gradient(circle at 50% 40%, #0d3352 0%, ${NAVY} 70%)`}}>
      {src ? (
        <OffthreadVideo
          src={src}
          muted
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            transform: `scale(${scale}) translate(${x}px, ${y}px)`,
            filter: 'saturate(0.88) contrast(1.08) brightness(0.88)',
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

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

// ---------- headline: big reveal in the centre, then docks at the top ----------
const TitleBlock = ({title, area}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const words = String(title || '').toUpperCase().split(/\s+/).filter(Boolean);
  const dock = spring({frame: f - Math.round(1.5 * fps), fps, config: {damping: 18, stiffness: 110}});
  const top = interpolate(dock, [0, 1], [700, 190]);
  const scale = interpolate(dock, [0, 1], [1, 0.62]);
  const chipIn = spring({frame: f - 2, fps, config: {damping: 14}});
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, top, display: 'flex', flexDirection: 'column',
      alignItems: 'center', transform: `scale(${scale})`, transformOrigin: '50% 0%',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '10px 28px', borderRadius: 40, marginBottom: 26,
        background: 'rgba(6,24,42,0.55)', border: `2px solid ${CYAN}`, color: CYAN, fontSize: 34, letterSpacing: 6,
        opacity: chipIn, transform: `translateY(${(1 - chipIn) * 30}px)`,
      }}>
        <AreaIcon area={area} />{String(area || 'mystery').toUpperCase()}
      </div>
      <div style={{
        width: 960, textAlign: 'center', lineHeight: 1.08, fontSize: 94, color: '#fff',
        textShadow: '0 6px 30px rgba(0,0,0,0.75), 0 0 2px #000',
      }}>
        {words.map((w, i) => {
          const s = spring({frame: f - 4 - i * 3, fps, config: {damping: 13, stiffness: 140}});
          return (
            <span key={i} style={{
              display: 'inline-block', marginRight: i < words.length - 1 ? '0.28em' : 0, opacity: s,
              transform: `translateY(${(1 - s) * 60}px) scale(${0.7 + 0.3 * s})`, filter: `blur(${(1 - s) * 8}px)`,
            }}>{w}</span>
          );
        })}
      </div>
      <div style={{
        marginTop: 22, height: 6, width: interpolate(dock, [0, 1], [0, 260]), borderRadius: 3,
        background: CYAN, boxShadow: `0 0 18px ${CYAN}`,
      }} />
    </div>
  );
};

// ---------- word-by-word captions ----------
const Captions = ({words, voiceEnd}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = f / fps;
  if (!words.length || t > voiceEnd) return null;
  let idx = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i].s <= t) idx = i; else break;
  }
  if (idx < 0) return null;
  const c = words[idx].c;
  const chunk = words.filter((w) => w.c === c);
  const pop = spring({frame: Math.round((t - chunk[0].s) * fps), fps, config: {damping: 12, stiffness: 180}});
  return (
    <div style={{
      position: 'absolute', left: 50, right: 50, top: 1190, display: 'flex', flexWrap: 'wrap',
      justifyContent: 'center', alignItems: 'center', gap: '12px 16px',
      transform: `scale(${0.85 + 0.15 * pop}) translateY(${(1 - pop) * 25}px)`, opacity: Math.min(1, pop * 1.4),
    }}>
      {chunk.map((w, i) => {
        const nextS = i < chunk.length - 1 ? chunk[i + 1].s : Infinity;
        const active = t >= w.s && t < nextS;
        const ws = spring({frame: Math.max(0, Math.round((t - w.s) * fps)), fps, config: {damping: 10, stiffness: 220}});
        return (
          <span key={i} style={{
            display: 'inline-block', fontSize: 84, lineHeight: 1.15, padding: '2px 16px', borderRadius: 14,
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

const musicVolume = (f, fps, p) => {
  const t = f / fps;
  const fadeIn = interpolate(t, [0, 1.2], [0, 1], clamp);
  const fadeOut = interpolate(t, [p.end - 1.4, p.end], [1, 0], clamp);
  const level = interpolate(t, [p.voiceEnd - 0.2, p.voiceEnd + 0.6], [0.16, 0.42], clamp);
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

export const Story = (p) => {
  const {fps} = useVideoConfig();
  const media = p.media || {};
  const segF = (p.segDur || [10]).map((d) => Math.max(T + 6, Math.round(d * fps)));
  const cutF = [];
  segF.slice(0, -1).reduce((acc, d) => { acc += d; cutF.push(acc); return acc; }, 0);
  const voiceEndF = Math.round(Number(p.voiceEnd || 20) * fps);
  const k = Number(p.k || 0);

  const items = [];
  segF.forEach((d, i) => {
    const last = i === segF.length - 1;
    const len = last ? d + 60 : d + T;
    items.push(
      <TransitionSeries.Sequence key={'s' + i} durationInFrames={len}>
        <Scene src={(media.scenes || [])[i]} idx={i + k} dur={len} />
      </TransitionSeries.Sequence>,
    );
    if (!last) {
      items.push(
        <TransitionSeries.Transition
          key={'t' + i}
          presentation={presentations[(i + k) % presentations.length]()}
          timing={linearTiming({durationInFrames: T, easing: Easing.inOut(Easing.cubic)})}
        />,
      );
    }
  });

  return (
    <AbsoluteFill style={{backgroundColor: NAVY, fontFamily: FONT}}>
      <TransitionSeries>{items}</TransitionSeries>
      <Grade />
      <Particles until={voiceEndF} />
      {cutF.map((c, i) => (
        <Sequence key={'sw' + i} from={c} durationInFrames={16}><LightSweep /></Sequence>
      ))}
      <Sequence durationInFrames={voiceEndF}><Brand logo={media.logo} name={p.brand} /></Sequence>
      <Sequence durationInFrames={voiceEndF}><TitleBlock title={p.title} area={p.area} /></Sequence>
      <Captions words={p.words || []} voiceEnd={Number(p.voiceEnd || 20)} />
      <Sequence durationInFrames={voiceEndF}><Progress total={voiceEndF} /></Sequence>
      <Sequence from={Math.max(0, voiceEndF - 3)}><Outro logo={media.logo} brand={p.brand} /></Sequence>

      {media.voice ? <Audio src={media.voice} /> : null}
      {media.music ? <Audio src={media.music} loop volume={(f) => musicVolume(f, fps, p)} /> : null}
      {media.boom ? <Audio src={media.boom} volume={0.7} /> : null}
      {media.whoosh ? cutF.map((c, i) => (
        <Sequence key={'wh' + i} from={Math.max(0, c - 12)} durationInFrames={30}><Audio src={media.whoosh} volume={0.45} /></Sequence>
      )) : null}
      {media.whoosh ? (
        <Sequence from={Math.round(1.45 * fps)} durationInFrames={30}><Audio src={media.whoosh} volume={0.25} /></Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
