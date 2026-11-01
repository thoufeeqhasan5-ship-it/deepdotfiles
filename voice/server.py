"""Chatterbox narrator with Kokoro fallback.

POST /dev/captioned_speech  {"input": "...", ...Kokoro fields}
 -> {"audio": <base64 wav>, "audio_format": "wav", "timestamps": [{"word","start_time","end_time"}], "engine": "chatterbox"}
Any failure -> the same request is passed to Kokoro, so the video is always made.
"""
import base64, io, json, os, re, threading, time, traceback, urllib.request, wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

KOKORO = os.environ.get("KOKORO_URL", "http://kokoro:8880/dev/captioned_speech")
EXAG = float(os.environ.get("EXAGGERATION", "0.6"))      # emotion: 0.5 natural, 0.7+ dramatic
CFG = float(os.environ.get("CFG_WEIGHT", "0.35"))         # lower = slower, calmer pacing
REF_VOICE = os.environ.get("REF_VOICE", "bm_george")       # Kokoro voice used as the reference to clone ("" = Chatterbox default)
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
    """A short clip of the channel's Kokoro voice, so Chatterbox keeps the same narrator."""
    global _ref
    if _ref is not None or not REF_VOICE:
        return _ref or None
    try:
        text = ("Deep below the surface, something has been waiting for a very long time. "
                "Scientists have finally found a way to listen, and what they heard was not what anyone expected.")
        data = json.loads(kokoro(json.dumps({"model": "kokoro", "input": text, "voice": REF_VOICE, "speed": 0.95,
                                             "response_format": "wav", "stream": False}).encode()))
        path = "/tmp/ref.wav"
        open(path, "wb").write(base64.b64decode(data["audio"]))
        _ref = path
        log("reference voice ready:", REF_VOICE)
    except Exception as e:
        log("no reference voice, using Chatterbox default:", e)
        _ref = ""
    return _ref or None


def sentences(text):
    parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", text.strip()) if p.strip()]
    out = []
    for p in parts:
        if out and len(p.split()) < 4:
            out[-1] += " " + p
        else:
            out.append(p)
    return out or [text]


def synth(text):
    m = model()
    ref = reference()
    sr = m.sr
    pieces = [np.zeros(int(sr * 0.12), np.float32)]
    for i, s in enumerate(sentences(text)):
        kw = {"exaggeration": min(1.2, EXAG + (0.15 if i == 0 else 0.0)), "cfg_weight": CFG}
        if ref:
            kw["audio_prompt_path"] = ref
        t = time.time()
        wav = m.generate(s, **kw)
        a = wav.squeeze().detach().cpu().numpy().astype(np.float32)
        log(f"sentence {i + 1}: {len(a) / sr:.1f}s audio in {time.time() - t:.0f}s")
        pieces += [a, np.zeros(int(sr * 0.28), np.float32)]
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
            log(f"Chatterbox voice {dur:.1f}s, {len(stamps)} words timed, {time.time() - t:.0f}s total")
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
