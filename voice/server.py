"""Chatterbox narrator with Kokoro fallback.

POST /dev/captioned_speech  {"input": "...", ...Kokoro fields}
 -> {"audio": <base64 wav>, "audio_format": "wav", "timestamps": [{"word","start_time","end_time"}], "engine": "chatterbox"}
Any failure -> the same request is passed to Kokoro, so the video is always made.
"""
import base64, io, json, os, re, threading, time, traceback, urllib.request, wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

KOKORO = os.environ.get("KOKORO_URL", "http://kokoro:8880/dev/captioned_speech")
EXAG = float(os.environ.get("EXAGGERATION", "0.5"))      # emotion: 0.5 natural, 0.7+ dramatic
CFG = float(os.environ.get("CFG_WEIGHT", "0.5"))          # 0.5 = Chatterbox's natural pacing
REF_VOICE = os.environ.get("REF_VOICE", "")                # "" = Chatterbox's own natural voice; or a Kokoro voice name to clone
REF_FILE = os.environ.get("REF_FILE", "/files/assets/narrator.wav")  # optional real voice sample (10-20 s) to clone
LOCK = threading.Lock()
_model = None
_whisper = None
_ref = None


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def model():
    global _model
    with LOCK:
        if _model is None:
            import torch
            orig = torch.load
            def cpu_load(*a, **k):
                k.setdefault("map_location", "cpu")
                return orig(*a, **k)
            torch.load = cpu_load
            torch.set_num_threads(os.cpu_count() or 4)
            from chatterbox.tts import ChatterboxTTS
            t = time.time()
            _model = ChatterboxTTS.from_pretrained(device="cpu")
            log(f"Chatterbox loaded in {time.time() - t:.0f}s")
    return _model


def whisper():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel
        _whisper = WhisperModel("base.en", device="cpu", compute_type="int8")
    return _whisper


def kokoro(body: bytes) -> bytes:
    req = urllib.request.Request(KOKORO, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return r.read()


def reference():
    """Voice to clone: a real voice sample if one is provided, else (optionally) a Kokoro voice, else Chatterbox's own."""
    global _ref
    if _ref is not None:
        return _ref or None
    _ref = ""
    if REF_FILE and os.path.exists(REF_FILE) and os.path.getsize(REF_FILE) > 50000:
        _ref = REF_FILE
        log("cloning narrator sample:", REF_FILE)
    elif REF_VOICE:
        try:
            text = ("Deep below the surface, something has been waiting for a very long time. "
                    "Scientists have finally found a way to listen, and what they heard was not what anyone expected.")
            data = json.loads(kokoro(json.dumps({"model": "kokoro", "input": text, "voice": REF_VOICE, "speed": 0.95,
                                                 "response_format": "wav", "stream": False}).encode()))
            open("/tmp/ref.wav", "wb").write(base64.b64decode(data["audio"]))
            _ref = "/tmp/ref.wav"
            log("cloning Kokoro voice:", REF_VOICE)
        except Exception as e:
            log("no reference voice:", e)
    else:
        log("using Chatterbox's own voice")
    return _ref or None


def norm(w):
    return re.sub(r"[^a-z0-9]", "", str(w).lower())


def coverage(expected, stamps):
    """Share of the expected words that were actually spoken, in order."""
    exp = [norm(w) for w in expected.split() if norm(w)]
    got = [norm(s["word"]) for s in stamps if norm(s["word"])]
    j = hit = 0
    for e in exp:
        for k in range(j, min(len(got), j + 4)):
            g = got[k]
            if g == e or (min(len(g), len(e)) >= 4 and g[:4] == e[:4]) or (e.isdigit() and not g.isalpha()):
                hit += 1
                j = k + 1
                break
    return hit / max(1, len(exp))


def phrases(text):
    """Split into sentences, and long sentences into shorter phrases (Chatterbox drops words on long input).
    Returns [(phrase, pause_after_seconds)]."""
    out = []
    for sent in [p.strip() for p in re.split(r"(?<=[.!?])\s+", text.strip()) if p.strip()]:
        parts = [sent]
        if len(sent.split()) > 14:
            bits = [b.strip() for b in re.split(r"(?<=[,;:\u2014])\s+|\s+(?=\u2014)|\s+-\s+", sent) if b.strip()]
            parts, cur = [], ""
            for b in bits:
                cur = (cur + " " + b).strip()
                if len(cur.split()) >= 5:
                    parts.append(cur)
                    cur = ""
            if cur:
                if parts and len(cur.split()) < 4:
                    parts[-1] += " " + cur
                else:
                    parts.append(cur)
        for i, p in enumerate(parts):
            p = p.lstrip("\u2014\u2013- ").strip()
            out.append((p, 0.38 if i == len(parts) - 1 else 0.16))
    # glue very short sentences to the previous one
    merged = []
    for p, gap in out:
        if merged and len(p.split()) < 3:
            merged[-1] = (merged[-1][0] + " " + p, gap)
        else:
            merged.append((p, gap))
    return merged or [(text, 0.3)]


def speak(m, text, first, ref):
    """Generate one phrase, check every word was spoken, retry if not. Returns (audio, coverage)."""
    sr = m.sr
    best, best_cov = None, -1.0
    for attempt in range(3):
        kw = {"exaggeration": min(1.0, EXAG + (0.1 if first else 0.0)), "cfg_weight": CFG}
        if ref:
            kw["audio_prompt_path"] = ref
        wav = m.generate(text, **kw)
        a = wav.squeeze().detach().cpu().numpy().astype(np.float32)
        stamps = align(a, sr)
        cov = coverage(text, stamps)
        if stamps:  # trim silence / stray sounds before the first and after the last word
            a = a[max(0, int((stamps[0]["start_time"] - 0.08) * sr)): int((stamps[-1]["end_time"] + 0.18) * sr)]
        if cov > best_cov:
            best, best_cov = a, cov
        if cov >= 0.9:
            break
        log(f"  retry ({cov:.0%} of words spoken): {text[:60]}")
    return best, best_cov


def synth(text):
    m = model()
    ref = reference()
    sr = m.sr
    pieces = [np.zeros(int(sr * 0.15), np.float32)]
    for i, (p, gap) in enumerate(phrases(text)):
        t = time.time()
        a, cov = speak(m, p, i == 0, ref)
        log(f"phrase {i + 1}: {len(a) / sr:.1f}s, {cov:.0%} of words, {time.time() - t:.0f}s")
        if cov < 0.7:
            raise ValueError(f"Chatterbox kept skipping words in: {p}")
        pieces += [a, np.zeros(int(sr * gap), np.float32)]
    audio = np.concatenate(pieces)
    peak = float(np.max(np.abs(audio))) or 1.0
    return (audio / peak * 0.9).astype(np.float32), sr


def align(audio, sr):
    n16 = int(len(audio) * 16000 / sr)
    a16 = np.interp(np.linspace(0, len(audio) - 1, n16), np.arange(len(audio)), audio).astype(np.float32)
    segs, _ = whisper().transcribe(a16, language="en", word_timestamps=True, beam_size=1)
    return [{"word": w.word.strip(), "start_time": round(float(w.start), 3), "end_time": round(float(w.end), 3)}
            for s in segs for w in (s.words or [])]


def wav_b64(audio, sr):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
    return base64.b64encode(buf.getvalue()).decode()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, data: bytes):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._send(200, json.dumps({"ok": True, "loaded": _model is not None}).encode())

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        try:
            text = str(json.loads(body).get("input", "")).strip()
            if not text:
                raise ValueError("empty text")
            t = time.time()
            audio, sr = synth(text)
            dur = len(audio) / sr
            if not 5 < dur < 80:
                raise ValueError(f"odd length {dur:.1f}s")
            stamps = align(audio, sr)
            total = coverage(text, stamps)
            if total < 0.85:
                raise ValueError(f"only {total:.0%} of the script was spoken")
            log(f"{total:.0%} of the script spoken. " + f"Chatterbox voice {dur:.1f}s, {len(stamps)} words timed, {time.time() - t:.0f}s total")
            self._send(200, json.dumps({"audio": wav_b64(audio, sr), "audio_format": "wav",
                                        "timestamps": stamps, "engine": "chatterbox"}).encode())
        except Exception:
            log("Chatterbox failed, using Kokoro:\n" + traceback.format_exc()[-1500:])
            try:
                self._send(200, kokoro(body))
            except Exception as e:
                self._send(502, json.dumps({"error": f"chatterbox and kokoro both failed: {e}"}).encode())

    def log_message(self, *a):
        pass


def warm_up():
    try:
        model()
        whisper()
        log("voice service warmed up")
    except Exception:
        log("warm-up failed:\n" + traceback.format_exc()[-1500:])


if __name__ == "__main__":
    threading.Thread(target=warm_up, daemon=True).start()
    log("voice service on :8880")
    ThreadingHTTPServer(("0.0.0.0", 8880), Handler).serve_forever()
