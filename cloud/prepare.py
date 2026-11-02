#!/usr/bin/env python3
"""Turn the workflow exported from the laptop's n8n into a one-shot cloud run.

- picks the Deep Dot Files workflow (the one with a 'Render Videos (ffmpeg)' node)
- replaces the 6 PM schedule with a manual start (GitHub decides the time)
- splits long Wait nodes into 60 s steps (the CLI run can't park executions)
- in test mode, switches off every YouTube / Instagram / Facebook node
- with FOCUS set: makes ONE video for that time slot and avoids recently posted stories
"""
import json, math, os, re, sys, uuid, copy

src, out, publish = sys.argv[1], sys.argv[2], sys.argv[3].lower() == "true"
focus = os.environ.get("FOCUS", "").strip()          # e.g. "SPACE" - empty = classic 3 videos per run
history_file = os.environ.get("HISTORY", "../files/history.json")

data = json.load(open(src, encoding="utf-8-sig"))
flows = data if isinstance(data, list) else [data]
flows = [w for w in flows if any(n.get("name") == "Render Videos (ffmpeg)" for n in w.get("nodes", []))]
if not flows:
    sys.exit("No Deep Dot Files workflow found in the export (no 'Render Videos (ffmpeg)' node).")
flows.sort(key=lambda w: str(w.get("updatedAt", "")), reverse=True)
wf = flows[0]
nodes, conns = wf["nodes"], wf.setdefault("connections", {})

# 1. schedule -> manual start
starts = []
for n in [n for n in nodes if n["type"] == "n8n-nodes-base.scheduleTrigger"]:
    for branch in conns.pop(n["name"], {}).get("main", []):
        starts += [c["node"] for c in branch]
    nodes.remove(n)
if not starts:
    starts = ["Config"]
nodes.append({"parameters": {}, "id": str(uuid.uuid4()), "name": "Cloud start",
              "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 200]})
conns["Cloud start"] = {"main": [[{"node": s, "type": "main", "index": 0} for s in dict.fromkeys(starts)]]}

# 2. long waits -> chain of 60 s waits
UNIT = {"seconds": 1, "minutes": 60, "hours": 3600}
for n in [n for n in nodes if n["type"] == "n8n-nodes-base.wait"]:
    p = n.get("parameters", {})
    # n8n leaves out default values on export: Wait v1 defaults to hours, v1.1+ to seconds
    default_unit = "hours" if float(n.get("typeVersion", 1)) < 1.1 else "seconds"
    secs = float(p.get("amount", 1)) * UNIT.get(p.get("unit", default_unit), 1)
    if secs < 65:
        continue
    steps = min(10, math.ceil(secs / 60))   # never more than 10 minutes of waiting
    p["amount"], p["unit"] = 60, "seconds"
    after = conns.pop(n["name"], None)
    prev = n["name"]
    for i in range(2, steps + 1):
        extra = copy.deepcopy(n)
        extra.update(id=str(uuid.uuid4()), name=f"{n['name']} ({i})", webhookId=str(uuid.uuid4()),
                     position=[n["position"][0], n["position"][1] + 120 * (i - 1)])
        nodes.append(extra)
        conns[prev] = {"main": [[{"node": extra["name"], "type": "main", "index": 0}]]}
        prev = extra["name"]
    if after:
        conns[prev] = after

# 3. test mode: no posting
if not publish:
    for n in nodes:
        if n["name"].startswith(("YT:", "IG:", "FB:", "Upload to YouTube")):
            n["disabled"] = True

# 4. one video per run, any era: today's news + timeless topics, never repeating recent stories
if focus:
    bp = next(n for n in nodes if n["name"] == "Build Prompt")
    code = bp["parameters"]["jsCode"]
    try:
        recent = json.load(open(history_file))[-30:]
    except Exception:
        recent = []
    try:
        evergreen = json.load(open(os.environ.get("EVERGREEN", "run/evergreen.json")))
    except Exception:
        evergreen = []
    recent_txt = "\n".join(f"- {r.get('title','')}" for r in recent) or "- (none yet)"
    safe = lambda t: t.replace("\\", "/").replace("`", "'").replace("${", "$ {")
    pick_old = re.search(r"pick the 3 stories people are most likely to be talking about TODAY.*?everyday life\.", code, re.S)
    if not pick_old:
        sys.exit("Build Prompt text changed - could not find the story-picking sentence.")
    pick_new = ('pick the 1 story with the strongest "wait, what?" factor - the one that would make someone stop scrolling. '
                'It does NOT have to be new: choose freely between today\'s headlines and the TIMELESS list (famous, well-documented '
                'real mysteries and discoveries from any year). Only pick a recent headline if it is genuinely jaw-dropping. '
                'For a timeless topic, never say it happened today or recently.')
    code = code[:pick_old.start()] + pick_new + code[pick_old.end():]
    swaps = [
        ("They must come from at least 3 DIFFERENT areas out of nature, technology, space and ocean (never two from the same area if another area is available).",
         f"This video's slot is {focus}: strongly prefer a story from {focus}. If nothing in that area is truly fascinating, pick the best one from any of the four areas. "
         "It must NOT be about the same discovery or topic as any of these videos we already posted:\n" + safe(recent_txt) + "\n"),
        ('The "stories" array must contain exactly 3 stories.', 'The "stories" array must contain exactly 1 story.'),
        ("Headlines:\n${list}`", "Headlines:\n${list}\n\nTIMELESS (any year - famous, well-documented; use only the facts given here):\n${EVERGREEN_LIST}`"),
    ]
    for old, new in swaps:
        if old not in code:
            sys.exit(f"Build Prompt text changed - could not find: {old[:60]}...")
        code = code.replace(old, new)
    ev_lines = "\n".join(f"T{i + 1}. [timeless, {e['area']}] {safe(e['title'])}\n   {safe(e['extract'])}\n   Link: {e['url']}"
                          for i, e in enumerate(evergreen)) or "(none today)"
    code = "const EVERGREEN_LIST = " + json.dumps(ev_lines) + ";\n" + code

    # ---- Version 2 script: hook-first, 4 beats, loop ending, real-image search, fact cards ----
    words = os.environ.get("SCRIPT_WORDS", "80-100")
    try:
        lo, hi = (int(x) for x in words.split("-"))
    except Exception:
        lo, hi = 80, 100
    lo, hi = max(lo, 80), max(hi, 100)   # clear, complete stories need at least ~80 words (about 35-40 s)
    per = lambda f: f"{max(8, round(lo * f))}-{max(10, round(hi * f))}"
    a = code.find("For EACH story write 3 segments")
    b = code.find("Return ONLY valid JSON")
    if a < 0 or b < 0:
        sys.exit("Build Prompt text changed - could not find the segment instructions.")
    code = code[:a] + f"""For the story write 5 segments that tell ONE complete, clear story that a 12-year-old with no science background can fully understand. By the end the viewer must know exactly WHAT the thing is, WHERE and WHEN it was found, WHAT is strange about it and WHAT scientists think it means.
Total voiceover: {lo}-{hi} words (count them - this is a hard requirement), calm and clear. Short sentences (max 15 words). Plain everyday words; explain any technical term in a few words (e.g. "an exoplanet - a planet orbiting another star"). Use simple comparisons for big numbers (e.g. "three times wider than Earth").
- Segment 1 = HOOK ({per(0.12)} words): a startling fact or question that already NAMES the subject in plain words (e.g. "There is a star out there that keeps dimming, and nobody knows why.").
- Segment 2 = WHAT IT IS ({per(0.22)} words): what it is, where it is, when and how it was found.
- Segment 3 = THE KEY DETAIL ({per(0.22)} words): the main facts, with one clear number or comparison.
- Segment 4 = THE STRANGE PART ({per(0.22)} words): start with "But here's the strange part" and explain clearly what does not fit.
- Segment 5 = THE ANSWER SO FAR ({per(0.22)} words): what scientists currently think it means, then one clear takeaway sentence. Resolve the story - no cliffhanger, never leave the viewer confused. Do NOT mention the channel name or ask people to follow.
"hook_text": 3-5 BIG on-screen words that say clearly what the video is about AND make people curious (e.g. "THIS STAR KEEPS DISAPPEARING", "A LAKE UNDER 4 KM OF ICE", "A 2,000-YEAR-OLD COMPUTER"). Specific, not vague, and honest.
"facts": 1 or 2 striking facts taken EXACTLY from the source, each as a short "value" (a number with unit or a short term, max 12 characters, e.g. "11 KM", "1977", "-89 C", "13.8 BILLION") and a "label" of max 5 words (e.g. "below the ice"). Only facts that are in the source.
"image_query": the most specific English name of the real subject so a photo search finds IT (e.g. "Europa moon", "Antikythera mechanism", "giant squid", "Blood Falls Antarctica", "KIC 8462852"). Never a person, never a general word like "space", "planet" or "ocean".
The "title" is a CLEAR, plain-English headline that tells the viewer what the story is about in max 7 words (e.g. "A star that dims for no reason"). It stays on screen during the video.
For each segment give "visuals": 3 DIFFERENT 1-3 word English stock-video search terms that show what is being said at that moment, as concretely as possible (e.g. "foggy forest", "deep ocean", "night sky stars", "arctic ice", "telescope", "laboratory microscope"). Never use names of people or brands.
"caption": start with a question people will want to answer in the comments (e.g. "Would you go down there?"), then 1 short line, then 4 relevant hashtags.

""" + code[b:]
    swaps2 = [
        ('{ "text": "why it matters + closing line", "visuals": ["search term", "search term"] }',
         '{ "text": "the key detail", "visuals": ["search term", "search term", "search term"] },\n        { "text": "the strange part", "visuals": ["search term", "search term", "search term"] },\n        { "text": "the answer so far + clear takeaway", "visuals": ["search term", "search term", "search term"] }'),
        ('"source": "the Link of the story"',
         '"source": "the Link of the story",\n      "hook_text": "3-5 big words",\n      "facts": [{ "value": "11 KM", "label": "below the ice" }],\n      "image_query": "name of the real subject"'),
        ("source: { type: 'STRING' } } } } } } }",
         "source: { type: 'STRING' }, hook_text: { type: 'STRING' }, image_query: { type: 'STRING' }, "
         "facts: { type: 'ARRAY', items: { type: 'OBJECT', required: ['value', 'label'], properties: { value: { type: 'STRING' }, label: { type: 'STRING' } } } } } } } } } }"),
        ("required: ['area', 'title', 'segments', 'caption', 'youtube_title', 'youtube_description', 'tags', 'source']",
         "required: ['area', 'title', 'segments', 'caption', 'youtube_title', 'youtube_description', 'tags', 'source', 'hook_text', 'image_query', 'facts']"),
    ]
    for old, new in swaps2:
        if code.count(old) != 1:
            sys.exit(f"Build Prompt text changed - expected exactly one: {old[:60]}")
        code = code.replace(old, new)
    bp["parameters"]["jsCode"] = code

    ps = next(n for n in nodes if n["name"] == "Parse Stories")
    pc = ps["parameters"]["jsCode"]
    for old, new in [
        (".slice(0, 2);\n    if (!v.length) v = ['city skyline'];", ".slice(0, 3);\n    if (!v.length) v = ['city skyline'];"),
        ("s.segments.slice(0, 4)", "s.segments.slice(0, 5)"),
        ("tags: tags.join(','),",
         "tags: tags.join(','),\n    hook_text: String(s.hook_text || '').slice(0, 40),\n    image_query: String(s.image_query || '').slice(0, 80),\n"
         "    facts: (Array.isArray(s.facts) ? s.facts : []).slice(0, 2).map(f => ({ value: String(f.value || '').slice(0, 14), label: String(f.label || '').slice(0, 40) })).filter(f => f.value),\n"
         "    source_url: String(s.source || ''),"),
    ]:
        if pc.count(old) != 1:
            sys.exit(f"Parse Stories changed - expected exactly one: {old[:50]}")
        pc = pc.replace(old, new)
    pc = pc.replace("if (words > 100)", "if (words > 190)")
    ps["parameters"]["jsCode"] = pc

    # save today's titles so the next runs avoid them
    vr = next(n for n in nodes if n["name"] == "Video Ready")
    x, y = vr["position"]
    hist_code = (
        "const done = $('Video Ready').all().map(i => i.json.story - 1);\n"
        "const list = $('Parse Stories').all().map(i => i.json).filter(s => done.includes(s.k))\n"
        "  .map(s => ({ date: new Date().toISOString().slice(0, 10), area: s.area, title: s.title,\n"
        "    source: ((s.youtube_description || '').match(/Source:\\s*(\\S+)/) || [])[1] || '' }));\n"
        "return [{ json: { count: list.length }, binary: { data: { data: Buffer.from(JSON.stringify(list)).toString('base64'),"
        " mimeType: 'application/json', fileName: 'new-history.json' } } }];")
    nodes.append({"parameters": {"jsCode": hist_code}, "id": str(uuid.uuid4()), "name": "Cloud: Story History",
                  "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [x + 260, y + 420],
                  "executeOnce": True, "onError": "continueRegularOutput"})
    nodes.append({"parameters": {"operation": "write", "fileName": "/files/out/new-history.json", "dataPropertyName": "data", "options": {}},
                  "id": str(uuid.uuid4()), "name": "Cloud: Save History", "type": "n8n-nodes-base.readWriteFile",
                  "typeVersion": 1, "position": [x + 520, y + 420], "onError": "continueRegularOutput"})
    conns.setdefault("Video Ready", {"main": [[]]})["main"][0].append({"node": "Cloud: Story History", "type": "main", "index": 0})
    conns["Cloud: Story History"] = {"main": [[{"node": "Cloud: Save History", "type": "main", "index": 0}]]}

# 5. expressive voice: Chatterbox service (it falls back to Kokoro by itself)
if os.environ.get("VOICE_SERVICE") == "chatterbox":
    vo = next((n for n in nodes if n["name"] == "Voiceover (Kokoro)"), None)
    if vo:
        vo["parameters"]["url"] = "http://voice:8880/dev/captioned_speech"
        vo["parameters"].setdefault("options", {})["timeout"] = 1500000
        vo["retryOnFail"] = False

# 6. animated edit: Remotion first, the ffmpeg edit stays as automatic backup
if os.environ.get("REMOTION") == "yes":
    prf = next(n for n in nodes if n["name"] == "Prepare Render Files")
    c = prf["parameters"]["jsCode"]
    swaps = [
        ("let t = lead, wi = 0;", "const capWords = []; let capChunk = -1;\n  let t = lead, wi = 0;"),
        ("for (const words of chunks) {", "for (const words of chunks) {\n      capChunk++;"),
        ("t = e; wi++;", "capWords.push({ w, s: Number(s.toFixed(3)), e: Number(Math.min(e, voiceEnd).toFixed(3)), c: capChunk, seg: i }); t = e; wi++;"),
        ("return { ass, sh: lines.join('\\n') + '\\n' };",
         "const props = { k, title: T, area: clean(area || 'mystery'), brand: brandName, duration, voiceEnd, end, segDur, words: capWords,\n"
         "    clips: segDur.map((_, i) => (clips[i] || []).filter(Boolean)), voice: { file: `/files/work/voice_${k}.pcm`, rate } };\n"
         "  const remo = [`if [ -s props_${k}.json ] && node /files/cloud/remotion-call.js /files/work/props_${k}.json \"$OUT\" > remo_${k}.log 2>&1; then echo 'edit: remotion'; echo RENDER_OK; stat -c %s \"/files/out/$OUT\"; exit 0; fi`,\n"
         "    `echo \"edit: ffmpeg backup (remotion said: $(tail -c 400 remo_${k}.log 2>/dev/null))\"`];\n"
         "  lines.splice(3, 0, ...remo);\n"
         "  return { ass, sh: lines.join('\\n') + '\\n', props: JSON.stringify(props) };"),
        ("font: cfg.FONT_NAME, clips, rate, brand: cfg.CHANNEL_NAME });",
         "font: cfg.FONT_NAME, clips, rate, brand: cfg.CHANNEL_NAME });\n"
         "  if (plan.props) { const pp = JSON.parse(plan.props); Object.assign(pp, { hook: s.hook_text || '', facts: s.facts || [], imageQuery: s.image_query || '', "
         "source: s.source_url || '', story: s.title }); plan.props = JSON.stringify(pp); }"),
        ("  file(`render_${k}.sh`, Buffer.from(plan.sh, 'utf8').toString('base64'), 'text/plain');",
         "  file(`render_${k}.sh`, Buffer.from(plan.sh, 'utf8').toString('base64'), 'text/plain');\n"
         "  if (plan.props) file(`props_${k}.json`, Buffer.from(plan.props, 'utf8').toString('base64'), 'application/json');"),
    ]
    for old, new in swaps:
        if c.count(old) != 1:
            sys.exit(f"Prepare Render Files changed - expected exactly one: {old[:60]}")
        c = c.replace(old, new)
    c = c.replace("duration > 75", "duration > 95")
    prf["parameters"]["jsCode"] = c

wf["active"] = False
wf.pop("pinData", None)
json.dump([wf], open(out, "w"), indent=1)
print(wf["id"])
print(f"Prepared '{wf['name']}' (publish={'yes' if publish else 'NO - test run'}, slot={focus or 'all 3 videos'})", file=sys.stderr)
