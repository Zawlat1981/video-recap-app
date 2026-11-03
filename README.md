---
title: Video Recap Backend
emoji: 🎥
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
---

# RecapKit Video Studio

RecapKit is a Next.js creator workspace with a local FastAPI/FFmpeg render queue for Burmese recap and dubbing workflows.

## Run locally

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements-dev.txt
Copy-Item .env.example .env
npm ci
```

In separate terminals, start `python -m uvicorn backend.main:app --reload --port 8000` and `npm run dev`. Configure provider credentials and a Myanmar/Thai-capable `VIDEO_FONT_PATH` in `.env` as needed. The backend setup, Phase 1/2 render operations, font setup, optional OpenCV install, and tests are documented in [backend/README.md](./backend/README.md).

Run frontend checks with `npm run lint`, `npx tsc --noEmit`, and `npm run build`; run backend tests with `python -m pytest backend`.
