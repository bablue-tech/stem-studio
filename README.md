# STEM·STUDIO — AI Music Stem Separator

Upload a song → get **vocals**, **drums**, **bass** and **other** as separate downloadable MP3s.
Powered by [Demucs v4](https://github.com/adefossez/demucs) (Meta AI). Designed to be hosted — files can live in cloud storage so the app runs stateless.

## Features

- Drag & drop upload with live per-model progress (monotonic %, bag-of-models aware)
- Two models: `htdemucs` (fast) and `htdemucs_ft` (fine-tuned, best quality)
- Inline audio previews (range requests) + clean download names (`song_vocals.mp3`)
- Job history persisted across restarts; 24 h auto-cleanup
- Optional cloud storage: stems upload to Cloudinary CDN and local copies are freed

## Run locally

```powershell
npm install
npm start                # → http://localhost:3010
```

First-time machine setup (already done here):

```powershell
npm run setup:ffmpeg                              # static ffmpeg into tools/ffmpeg/
python -m venv .venv
.venv\Scripts\python -m pip install demucs numpy  # torch pulled in automatically
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3010` | Server port |
| `PYTHON` | `.venv/Scripts/python.exe` | Python interpreter running Demucs |
| `CLOUDINARY_CLOUD_NAME` | — | Enable cloud storage (all three required) |
| `CLOUDINARY_API_KEY` | — | Cloudinary key |
| `CLOUDINARY_API_SECRET` | — | Cloudinary secret |

With Cloudinary configured, finished stems upload to the CDN, local copies are deleted, and `/stems/:id/:file` redirects there (`?dl=1` still yields pretty filenames). Without it, everything stays on disk like before — the app works either way.

## Hosting

A ready `Dockerfile` is included (Python 3.12 + Node 22 + ffmpeg + CPU torch). Deploys cleanly to:

- **Render** — Web Service → Deploy from repo (Docker). Add a persistent disk mounted at `/opt/hf` and set `HF_HOME=/opt/hf` so model weights survive deploys.
- **Railway / Fly.io** — same Dockerfile; attach a volume for `/opt/hf`.
- Any container host with ~2 GB RAM (CPU inference).

Recommended env on hosts without a persistent disk: set the three `CLOUDINARY_*` vars so results outlive ephemeral storage.

Notes: model weights (~80 MB each) download on first use; first request after a cold start includes that fetch. One separation runs at a time; extra uploads queue.

## API

| Endpoint | Description |
|---|---|
| `POST /api/separate` | multipart: `audio` file + `model` field → `{ jobId }` |
| `GET /api/jobs/:id` | status, live progress, stem manifest |
| `GET /api/jobs` | history |
| `DELETE /api/jobs/:id` | remove a finished job |
| `GET /stems/:id/:file` | stream preview |
| `GET /stems/:id/:file?dl=1` | force download |

## Structure

```
stem-studio/
├── server.js            # API + job queue + demucs runner + cloud uploads
├── public/              # Neon-noir UI (vanilla HTML/CSS/JS)
├── scripts/setup-ffmpeg.ps1
├── Dockerfile           # production image (python+node+ffmpeg)
├── requirements.txt     # python deps for docker
├── tools/ffmpeg/        # local ffmpeg (dev only; containers use apt ffmpeg)
├── .venv/               # python env (local dev)
└── jobs/                # per-job meta.json (+ stems when no cloud storage)
```
