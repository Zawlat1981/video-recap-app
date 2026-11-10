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

The Next.js frontend is deployed on Vercel; its FastAPI/FFmpeg worker runs separately on Render. Uploads go directly from the browser to the API and do not pass through Vercel's request-body limit. `NEXT_PUBLIC_API_URL` can override the default Render service URL (`https://recapkit-video-backend.onrender.com`) in the Vercel project settings.

On a phone, open the Vercel URL in the browser. The feature menu becomes a horizontally scrollable toolbar; choose a workspace, upload the source video, and use trim, subtitle, voice, and export controls. Exports are rendered by the separately hosted backend.

## Deploy the backend to Render

The root `render.yaml` Blueprint builds the Docker backend as `recapkit-video-backend` in Singapore on Render's **Free** web-service plan, enables the `/health` check, requires an API key, and stores files temporarily under `/tmp/recapkit-storage`. The container listens on Render's default web-service port, `10000`. It does not create or require a persistent disk or payment method.

1. Push this repository to GitHub and open the Render Dashboard. Choose **New > Blueprint**, connect `Zawlat1981/video-recap-app`, and deploy the `main` branch.
2. When prompted, set `RECAPKIT_API_KEY` to a long random secret. You may reuse the secret already saved in Hugging Face, or generate a new one. Never commit it or send it in chat.
3. Wait until the service reports **Live** and `https://recapkit-video-backend.onrender.com/health` returns `{"status":"ok"}`.
4. In Vercel project settings, set `NEXT_PUBLIC_API_URL` to `https://recapkit-video-backend.onrender.com` for Production and redeploy. The frontend defaults to this URL as well, but the explicit Vercel setting ensures it is clear which backend is active.
5. In RecapKit, choose **Backend access** and enter the same Render secret on each device. It is stored only in that browser's local storage.

**Free-plan limitations:** the service sleeps after 15 minutes without traffic, may take about a minute to wake, and has only 512 MB RAM, 0.1 CPU, and 750 instance-hours per workspace each month. Render can restart it at any time. Its filesystem is ephemeral, so uploaded videos, renders, and jobs are deleted when it sleeps, restarts, or redeploys. Large or AI/Whisper-heavy renders may be slow or run out of memory; this setup is for temporary experimentation, not reliable production editing. The API key protects API routes; health checks are public, while UUID media URLs remain available to browser playback/download as long as that instance's files exist.
