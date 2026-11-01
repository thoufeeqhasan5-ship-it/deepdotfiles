# Deep Dot Files: cloud runner (GitHub Actions)

GitHub starts a free cloud computer three times a day (about 9 AM, 2 PM and 7 PM India time).
Each run makes ONE video and posts it (space, then ocean/nature, then technology), then shuts down.
Your laptop can stay off.

## What makes each video
| Step | Tool (all free) | Backup if it fails |
|---|---|---|
| Story | Gemini picks the most fascinating story: today's news **or** a timeless mystery from `cloud/evergreen.txt` (facts fetched from Wikipedia) | news only |
| Voice | **Chatterbox** (MIT), expressive narrator cloned from the Kokoro `bm_george` voice | Kokoro, then Piper |
| Footage | Pixabay clips | navy background |
| Edit | **Remotion** animated template (`remotion/src/Story.jsx`) | the ffmpeg edit |
| Posting | YouTube, Instagram, Facebook | — |

## Files
| Folder or file | What it is |
|---|---|
| `daily-schedule.yml` | The schedule plus a manual **Run workflow** button. On GitHub it lives at `.github/workflows/daily.yml` |
| `cloud/` | Start-up script, services list, workflow converter, timeless topic pool |
| `remotion/` | Animated video template + render service |
| `voice/` | Chatterbox voice service |
| `docker/` | The same n8n + ffmpeg image and Piper voice as on your laptop |
| `files/music`, `files/assets` | Background music and logo |
| `files/history.json` | Created automatically: stories already posted (so nothing repeats) |
| `workflow/workflows.json` | Your workflow, written by `export-for-cloud.bat` |
| `export-for-cloud.bat` | Copies your latest workflow here and puts your keys on the clipboard |

**Keys** live only in the GitHub secret `N8N_CREDENTIALS`. They are hidden in logs and never stored in the repository.

**Tuning**
- Times and topics: the `cron` lines and the `FOCUS` line in `.github/workflows/daily.yml`
- Voice emotion: `EXAGGERATION` (0.5 = natural, 0.8 = dramatic) and `CFG_WEIGHT` (lower = slower) in `cloud/docker-compose.yml`
- Timeless topics: add lines to `cloud/evergreen.txt` (`area|Wikipedia_Article_Title`)

**Videos:** each run keeps its video for 7 days under *Actions → the run → Artifacts*.
