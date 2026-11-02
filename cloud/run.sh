#!/usr/bin/env bash
# Runs the whole Deep Dot Files pipeline once on a GitHub cloud machine (one video).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p run ../files/out ../files/work
chmod -R a+rwX ../files run

# never let a key show up in the GitHub log
python3 - <<'PY'
import json, os
def walk(v):
    if isinstance(v, dict):
        for x in v.values(): yield from walk(x)
    elif isinstance(v, list):
        for x in v: yield from walk(x)
    elif isinstance(v, str) and len(v) >= 8:
        yield v
for s in set(walk([c.get("data") for c in json.loads(os.environ["N8N_CREDENTIALS"])])):
    print("::add-mask::" + s.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A"))
PY
printf '%s' "$N8N_CREDENTIALS" > run/credentials.json
# the Gemini key (for Gemini voices) from the saved n8n keys
export GEMINI_KEY="$(python3 -c '
import json, os
for c in json.loads(os.environ["N8N_CREDENTIALS"]):
    d = c.get("data") or {}
    if str(d.get("name", "")).lower() == "x-goog-api-key" and d.get("value"):
        print(d["value"]); break
')"
export N8N_ENCRYPTION_KEY="$(openssl rand -hex 24)"

echo "::group::Build the tools"
docker compose build --quiet n8n piper
export VOICE_SERVICE=kokoro REMOTION=no
EXTRA=""
if docker compose build --quiet voice; then VOICE_SERVICE=chatterbox; EXTRA="$EXTRA voice"; else echo "::warning::Chatterbox voice did not build - using Kokoro"; fi
if docker compose build --quiet remotion; then REMOTION=yes; EXTRA="$EXTRA remotion"; else echo "::warning::Remotion did not build - using the ffmpeg edit"; fi
docker compose up -d kokoro piper $EXTRA
echo "::endgroup::"

echo "::group::Pick topics"
python3 evergreen.py evergreen.txt ../files/history.json run/evergreen.json || echo "[]" > run/evergreen.json
export EVERGREEN=run/evergreen.json HISTORY=../files/history.json
ID=$(python3 prepare.py ../workflow/workflows.json run/workflow.json "${PUBLISH:-true}")
echo "Voice service: $VOICE_SERVICE (Brian / Sonia, pace ${PACE:-0.9}) | Animated edit: $REMOTION | Slot: ${FOCUS:-all}"
echo "::endgroup::"

echo "::group::Wait for Kokoro"
for i in $(seq 1 90); do
  curl -sf http://localhost:8880/v1/audio/voices >/dev/null && break
  sleep 5
done
curl -sf http://localhost:8880/v1/audio/voices >/dev/null && echo "Kokoro ready" || echo "Kokoro not ready - Piper backup will be used"
echo "::endgroup::"

echo "::group::Load workflow and keys into n8n"
docker compose run --rm -T n8n import:credentials --input=/cloudrun/credentials.json
docker compose run --rm -T n8n import:workflow --input=/cloudrun/workflow.json
rm -f run/credentials.json
echo "::endgroup::"

echo "Running workflow $ID ..."
set +e
docker compose run --rm -T n8n execute --id="$ID" > run/execution.log 2>&1
STATUS=$?
set -e
echo "::group::n8n output (last part)"
tail -c 6000 run/execution.log
echo "::endgroup::"
for f in ../files/work/log_*.txt; do [ -f "$f" ] && { echo "::group::Render log $f"; tail -n 20 "$f"; echo "::endgroup::"; }; done
for s in $EXTRA; do echo "::group::$s service log"; docker compose logs --no-color --tail 60 "$s" || true; echo "::endgroup::"; done

docker compose down -v >/dev/null 2>&1 || true

# remember what was posted, so later runs pick different stories
if [ "${PUBLISH:-true}" = "true" ] && [ -f ../files/out/new-history.json ]; then
python3 - <<'PY'
import json
try:
    h = json.load(open("../files/history.json"))
except Exception:
    h = []
h += json.load(open("../files/out/new-history.json"))
json.dump(h[-200:], open("../files/history.json", "w"), indent=1)
print("Story history updated:", [x["title"] for x in h[-3:]])
PY
fi

COUNT=$(ls ../files/out/*.mp4 2>/dev/null | wc -l)
echo "Videos made: $COUNT (n8n exit code $STATUS)"
[ "$COUNT" -gt 0 ] && [ "$STATUS" -eq 0 ]
