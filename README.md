---
title: Video Recap Backend
emoji: 🎥
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# RecapKit Video Studio

RecapKit is a Next.js creator workspace with a FastAPI/FFmpeg render queue for Burmese recap and dubbing workflows. A licensed Noto Sans Myanmar font is bundled for browser previews and video subtitle rendering; enter Burmese captions as Unicode text.

## Run locally

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements-dev.txt
Copy-Item .env.example .env
npm ci
```

In separate terminals, start `python -m uvicorn backend.main:app --reload --port 8000` and `npm run dev`. Configure an AI provider and a Myanmar/Thai-capable `VIDEO_FONT_PATH` in `.env` as needed. The backend setup, Phase 1–3 render operations, font setup, optional OpenCV install, and tests are documented in [backend/README.md](./backend/README.md).

Run frontend checks with `npm run lint`, `npx tsc --noEmit`, and `npm run build`; run backend tests with `python -m pytest backend`.

## Use on Vercel and mobile

The Next.js frontend is responsive and can be deployed to Vercel. Vercel does **not** host this app's FastAPI/FFmpeg render worker or its persistent uploads, renders, and SQLite database. Deploy the backend separately on a service with FFmpeg support, a persistent volume, and a long-running worker; configure its public HTTPS URL as the Vercel environment variable `NEXT_PUBLIC_API_URL` and redeploy. Set the backend's `CORS_ORIGINS` to the exact Vercel production domain (and any custom domain), and configure provider credentials and `VIDEO_FONT_PATH` on the backend host. Uploads go directly from the browser to the API, so they do not pass through Vercel's request-body limit.

On a phone, open the Vercel URL in the browser. The feature menu becomes a horizontally scrollable toolbar; choose a workspace, upload the source video, and use trim, subtitle, voice, and export controls. Exports are rendered by the separately hosted backend.

## Deploy the backend to Hugging Face Spaces

This repository includes a Docker Space configuration. Create a Space using Docker, connect this repository (or push its `main` branch to the Space), and configure these Space settings before making it public:

- Add `RECAPKIT_API_KEY` as a **Secret** with a long, randomly generated value. Never commit or share the value.
- Keep `RECAPKIT_REQUIRE_API_KEY=true`; the Docker image enables it and refuses API requests if the secret is missing.
- Enable persistent storage mounted at `/data`; uploads, renders, assets, and the SQLite job database are stored there.
- Set Space visibility to public only after the secret is configured. API routes require the key; `/health` is public, and generated media URLs are unguessable.

After the Space finishes building, set `NEXT_PUBLIC_API_URL` in the Vercel project to the Space's HTTPS URL and redeploy. In the app, choose **Backend access** and enter the same Space Secret value on each device that will edit videos. The key is stored in that browser's local storage; use HTTPS and do not enter it on shared devices. The app does not pass uploads through Vercel.
