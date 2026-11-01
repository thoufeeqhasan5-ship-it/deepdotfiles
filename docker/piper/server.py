"""Tiny local text-to-speech server for Deep Dot Files (Piper, runs offline).
POST /  {"text": "...", "voice": "en_US-ryan-high", "length_scale": 1.05}
-> {"rate": 22050, "pcm_b64": "<16-bit mono PCM, base64>", "voice": "..."}
"""
import base64, io, json, os, wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from piper import PiperVoice

VOICE_DIR = "/voices"
DEFAULT_VOICE = os.environ.get("PIPER_VOICE", "en_US-ryan-high")
_cache = {}

def load(name):
    if name not in _cache:
        _cache[name] = PiperVoice.load(os.path.join(VOICE_DIR, name + ".onnx"))
    return _cache[name]

def synth(text, name, length_scale):
    voice = load(name)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        if hasattr(voice, "synthesize_wav"):          # piper-tts >= 1.3
            try:
                from piper import SynthesisConfig
                voice.synthesize_wav(text, w, syn_config=SynthesisConfig(length_scale=length_scale))
            except ImportError:
                voice.synthesize_wav(text, w)
        else:                                          # older piper-tts
            voice.synthesize(text, w, length_scale=length_scale)
    buf.seek(0)
    with wave.open(buf, "rb") as r:
        if r.getsampwidth() != 2:
            raise ValueError("unexpected sample width")
        frames = r.readframes(r.getnframes())
        rate, channels = r.getframerate(), r.getnchannels()
    if channels != 1:
        raise ValueError("expected mono audio")
    return rate, frames

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        voices = sorted(f[:-5] for f in os.listdir(VOICE_DIR) if f.endswith(".onnx"))
        self._send(200, {"ok": True, "default": DEFAULT_VOICE, "voices": voices})

    def do_POST(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            text = str(body.get("text", "")).strip()
            if not text:
                return self._send(400, {"error": "text is required"})
            name = body.get("voice") or DEFAULT_VOICE
            rate, pcm = synth(text, name, float(body.get("length_scale", 1.0)))
            self._send(200, {"rate": rate, "voice": name, "pcm_b64": base64.b64encode(pcm).decode()})
        except Exception as e:  # report instead of crashing
            self._send(500, {"error": f"{type(e).__name__}: {e}"})

    def log_message(self, *args):
        pass

if __name__ == "__main__":
    print(f"Piper TTS ready on :5000 (default voice {DEFAULT_VOICE})", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 5000), Handler).serve_forever()
