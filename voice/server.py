"""Deep Dot Files narrator service.

Engines (pick with VOICE, e.g. "edge:en-US-AndrewNeural", "gemini:Charon", "kokoro:bm_george", "chatterbox"):
  edge       - Microsoft Edge neural voices (free, very natural)
  gemini     - Google Gemini TTS (natural, needs the Gemini key; free quota is small)
  kokoro     - Kokoro (open source, runs here)
  chatterbox - Chatterbox (open source, runs here, slowed down)
If the chosen engine fails or skips words, the next one in FALLBACK is used.

POST /dev/captioned_speech {"input": "..."}  -> {"audio": <base64 wav>, "audio_format": "wav", "timestamps": [...], "engine": "..."}
POST /sample {"voice": "edge:en-GB-RyanNeural", "input": "..."} -> audio/wav (for the voice test)
"""
import asyncio, base64, io, json, os, re, subprocess, tempfile, threading, time, traceback, urllib.request, wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

VOICE = os.environ.get("VOICE", "edge:en-US-AndrewNeural")
FALLBACK = [v.strip() for v in os.environ.get("FALLBACK", "edge:en-US-AndrewNeural,kokoro:bm_george").split(",") if v.strip()]
PACE = float(os.environ.get("PACE", "0.9"))            # 1.0 = normal speed, 0.9 = 10% slower
KOKORO = os.environ.get("KOKORO_URL", "http://kokoro:8880/dev/captioned_speech")
GEMINI_KEY = os.environ.get("GEMINI_KEY", "")
GEMINI_TTS_MODEL = os.environ.get("GEMINI_TTS_MODEL", "gemini-3.1-flash-tts-preview")
EXAG = float(os.environ.get("EXAGGERATION", "0.5"))
CFG = float(os.environ.get("CFG_WEIGHT", "0.3"))
REF_FILE = os.environ.get("REF_FILE", "/files/assets/narrator.wav")
SR = 24000
LOCK = threading.Lock()
_cb = None
_whisper = None


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ---------------- helpers ----------------
def ffmpeg_to_array(data: bytes, tempo: float = 1.0):
    """Any audio bytes -> mono float32 at 24 kHz, optionally slowed down (pitch kept)."""
    af = f"atempo={tempo:.3f}" if abs(tempo - 1.0) > 0.01 else "anull"
    p = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-af", af,
                        "-ac", "1", "-ar", str(SR), "-f", "f32le", "pipe:1"], input=data, capture_output=True, timeout=180)
    if p.returncode != 0 or not p.stdout:
        raise RuntimeError("ffmpeg: " + p.stderr.decode()[-300:])
    return np.frombuffer(p.stdout, dtype=np.float32).copy()


def pcm16_to_wav(pcm: bytes, rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm)
    return buf.getvalue()


def wav_bytes(audio):
    return pcm16_to_wav((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes(), SR)


def sentences(text):
    return [p.strip() for p in re.split(r"(?<=[.!?])\s+", text.strip()) if p.strip()] or [text]


def norm(w):
    return re.sub(r"[^a-z0-9]", "", str(w).lower())


def coverage(expected, stamps):
    exp = [norm(w) for w in expected.split() if norm(w)]
    got = [norm(s["word"]) for s in stamps if norm(s["word"])]
    j = hit = 0
    for e in exp:
        for k in range(j, min(len(got), j + 4)):
            g = got[k]
            if g == e or (min(len(g), len(e)) >= 4 and g[:4] == e[:4]) or (e.isdigit() and not g.isalpha()):
                hit += 1; j = k + 1
                break
    return hit / max(1, len(exp))


def whisper():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel
        _whisper = WhisperModel("base.en", device="cpu", compute_type="int8")
    return _whisper


def align(audio):
    a16 = np.interp(np.linspace(0, len(audio) - 1, int(len(audio) * 16000 / SR)), np.arange(len(audio)), audio).astype(np.float32)
    segs, _ = whisper().transcribe(a16, language="en", word_timestamps=True, beam_size=1)
    return [{"word": w.word.strip(), "start_time": round(float(w.start), 3), "end_time": round(float(w.end), 3)}
            for s in segs for w in (s.words or [])]


def finish(audio):
    audio = np.concatenate([np.zeros(int(SR * 0.15), np.float32), audio, np.zeros(int(SR * 0.2), np.float32)])
    peak = float(np.max(np.abs(audio))) or 1.0
    return (audio / peak * 0.9).astype(np.float32)


# ---------------- engines ----------------
def tts_edge(text, voice):
    import edge_tts
    rate = f"{round((PACE - 1) * 100):+d}%"
    out = tempfile.mktemp(suffix=".mp3")
    async def run():
        await edge_tts.Communicate(text, voice or "en-US-AndrewNeural", rate=rate).save(out)
    asyncio.run(run())
    data = open(out, "rb").read()
    os.remove(out)
    return ffmpeg_to_array(data)


def tts_gemini(text, voice):
    if not GEMINI_KEY:
        raise RuntimeError("no Gemini key")
    prompt = ("Read this like a calm, warm documentary narrator. Speak slowly and clearly, with natural pauses "
              "between sentences, as if telling a fascinating story to a friend:\n\n" + text)
    body = {"contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseModalities": ["AUDIO"],
                                 "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice or "Charon"}}}}}
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_TTS_MODEL}:generateContent",
                                 data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY})
    with urllib.request.urlopen(req, timeout=180) as r:
        d = json.load(r)
    part = next(p for p in d["candidates"][0]["content"]["parts"] if p.get("inlineData"))
    m = re.search(r"rate=(\d+)", part["inlineData"].get("mimeType", ""))
    return ffmpeg_to_array(pcm16_to_wav(base64.b64decode(part["inlineData"]["data"]), int(m.group(1)) if m else 24000))


def tts_kokoro(text, voice):
    body = json.dumps({"model": "kokoro", "input": text, "voice": voice or "bm_george", "speed": PACE,
                       "response_format": "wav", "stream": False}).encode()
    req = urllib.request.Request(KOKORO, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        d = json.load(r)
    return ffmpeg_to_array(base64.b64decode(d["audio"]))


def chatterbox():
    global _cb
    with LOCK:
        if _cb is None:
            import torch
            orig = torch.load
            def cpu_load(*a, **k):
                k.setdefault("map_location", "cpu")
                return orig(*a, **k)
            torch.load = cpu_load
            torch.set_num_threads(os.cpu_count() or 4)
            from chatterbox.tts import ChatterboxTTS
            _cb = ChatterboxTTS.from_pretrained(device="cpu")
            log("Chatterbox loaded")
    return _cb


def tts_chatterbox(text, voice):
    m = chatterbox()
    ref = REF_FILE if REF_FILE and os.path.exists(REF_FILE) and os.path.getsize(REF_FILE) > 50000 else None
    parts = []
    for s in sentences(text):
        best, best_cov = None, -1
        for _ in range(3):
            kw = {"exaggeration": EXAG, "cfg_weight": CFG}
            if ref:
                kw["audio_prompt_path"] = ref
            a = m.generate(s, **kw).squeeze().detach().cpu().numpy().astype(np.float32)
            if m.sr != SR:
                a = np.interp(np.arange(0, len(a), m.sr / SR), np.arange(len(a)), a).astype(np.float32)
            cov = coverage(s, align(a))
            if cov > best_cov:
                best, best_cov = a, cov
            if cov >= 0.9:
                break
        parts += [best, np.zeros(int(SR * 0.45), np.float32)]
    # Chatterbox has no speed control: slow it down afterwards (pitch kept)
    return ffmpeg_to_array(wav_bytes(np.concatenate(parts)), tempo=PACE)


ENGINES = {"edge": tts_edge, "gemini": tts_gemini, "kokoro": tts_kokoro, "chatterbox": tts_chatterbox}


def speak(spec, text):
    engine, _, voice = spec.partition(":")
    fn = ENGINES.get(engine.strip().lower())
    if not fn:
        raise ValueError(f"unknown voice engine {engine}")
    return finish(fn(text, voice.strip()))


def narrate(text):
    tried = []
    for spec in [VOICE] + [f for f in FALLBACK if f != VOICE]:
        t = time.time()
        try:
            audio = speak(spec, text)
            dur = len(audio) / SR
            stamps = align(audio)
            cov = coverage(text, stamps)
            log(f"{spec}: {dur:.1f}s, {cov:.0%} of the script spoken, {len(text.split()) * 60 / max(1.0, dur):.0f} words/min, {time.time() - t:.0f}s")
            if cov < 0.85 or not 5 < dur < 95:
                raise ValueError(f"only {cov:.0%} spoken / {dur:.1f}s")
            return audio, stamps, spec
        except Exception as e:
            log(f"{spec} failed: {str(e)[:300]}")
            tried.append(spec)
    raise RuntimeError("all voices failed: " + ", ".join(tried))


# ---------------- HTTP ----------------
class Handler(BaseHTTPRequestHandler):
    def _send(self, code, data: bytes, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._send(200, json.dumps({"ok": True, "voice": VOICE}).encode())

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        try:
            req = json.loads(body)
            text = str(req.get("input", "")).strip()
            if self.path.startswith("/sample"):
                self._send(200, wav_bytes(speak(req.get("voice", VOICE), text)), "audio/wav")
                return
            audio, stamps, spec = narrate(text)
            self._send(200, json.dumps({"audio": base64.b64encode(wav_bytes(audio)).decode(), "audio_format": "wav",
                                        "timestamps": stamps, "engine": spec}).encode())
        except Exception:
            log("request failed:\n" + traceback.format_exc()[-1500:])
            self._send(500, json.dumps({"error": traceback.format_exc()[-500:]}).encode())

    def log_message(self, *a):
        pass


def warm_up():
    try:
        whisper()
        if VOICE.startswith("chatterbox") or any(f.startswith("chatterbox") for f in FALLBACK):
            chatterbox()
        log("voice service ready:", VOICE)
    except Exception:
        log("warm-up failed:\n" + traceback.format_exc()[-1500:])


if __name__ == "__main__":
    threading.Thread(target=warm_up, daemon=True).start()
    log(f"voice service on :8880 (voice {VOICE}, fallback {FALLBACK}, pace {PACE})")
    ThreadingHTTPServer(("0.0.0.0", 8880), Handler).serve_forever()
