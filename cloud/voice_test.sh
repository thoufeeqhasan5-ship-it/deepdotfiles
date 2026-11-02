#!/usr/bin/env bash
# Reads one sample script in several voices so you can pick the channel's narrator.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p ../voice-samples
export GEMINI_KEY="$(python3 -c '
import json, os
for c in json.loads(os.environ.get("N8N_CREDENTIALS") or "[]"):
    d = c.get("data") or {}
    if str(d.get("name", "")).lower() == "x-goog-api-key" and d.get("value"):
        print(d["value"]); break
')"
[ -n "$GEMINI_KEY" ] && echo "::add-mask::$GEMINI_KEY"
docker compose build --quiet voice
docker compose up -d kokoro voice
for i in $(seq 1 120); do curl -sf http://localhost:8881/ >/dev/null && curl -sf http://localhost:8880/v1/audio/voices >/dev/null && break; sleep 5; done
sleep 20   # let the narrator service finish loading

TEXT="${SAMPLE_TEXT:-There is a star out there that keeps dimming, and nobody knows why. It is called Tabby's Star, and it sits about fourteen hundred light years from Earth. Most stars dim by about one percent when a planet passes in front. But here's the strange part. This star sometimes dims by more than twenty percent. Scientists now think a huge cloud of dust is the most likely answer.}"
n=0
for v in \
  "edge:en-US-AndrewNeural" "edge:en-US-ChristopherNeural" "edge:en-US-BrianNeural" "edge:en-GB-RyanNeural" \
  "edge:en-US-AvaNeural" "edge:en-GB-SoniaNeural" \
  "gemini:Charon" "gemini:Iapetus" \
  "kokoro:bm_george" "kokoro:am_michael" \
  "chatterbox"; do
  n=$((n + 1))
  name=$(printf '%02d-%s' "$n" "$(echo "$v" | tr ':' '-')")
  body=$(python3 -c 'import json,sys; print(json.dumps({"voice": sys.argv[1], "input": sys.argv[2]}))' "$v" "$TEXT")
  code=$(curl -s -m 900 -X POST -H 'Content-Type: application/json' -d "$body" http://localhost:8881/sample -o "../voice-samples/$name.wav" -w '%{http_code}' || echo 000)
  if [ "$code" = "200" ]; then
    echo "OK   $name"
  else
    echo "FAIL $name (HTTP $code): $(head -c 400 "../voice-samples/$name.wav" 2>/dev/null | tr '\n' ' ')"
    rm -f "../voice-samples/$name.wav"
  fi
done
docker compose logs --no-color --tail 40 voice || true
docker compose down -v >/dev/null 2>&1 || true
ls -l ../voice-samples
