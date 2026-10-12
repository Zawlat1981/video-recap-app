---
title: Video Recap Backend
emoji: 🎥
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
---

# RecapKit API

The backend accepts video uploads, stores them locally in `backend/storage/uploads`, and queues FFmpeg audio-extraction, subtitle-burn, video-split, or AI recap voiceover jobs. Job state and generated recap scripts are persisted in SQLite at `backend/storage/jobs.sqlite3`.

From the project root, create and activate a virtual environment, then install the backend requirements:

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
Copy-Item .env.example .env
```

Set `OPENAI_API_KEY`, `AZURE_SPEECH_KEY`, and `AZURE_SPEECH_TTS_REGION` in `.env`. If a recap job has no usable SRT text, also set `AZURE_SPEECH_STT_ENDPOINT` to the Speech resource endpoint, for example `https://<resource>.cognitiveservices.azure.com`. The backend loads `.env`; provider secrets stay server-side and are not sent to Next.js. Never commit `.env`.

Start the API from the project root:

```powershell
python -m uvicorn backend.main:app --reload --port 8000
```

The upload endpoint is `POST http://localhost:8000/api/uploads` with a multipart field named `file`. Start audio extraction with `POST http://localhost:8000/api/jobs` and `{"upload_id":"<id>","operation":"extract-audio"}`. To burn subtitles into an MP4, send `{"upload_id":"<id>","operation":"burn-subtitles","subtitle_srt":"1\\n00:00:00,000 --> 00:00:03,000\\nမြန်မာစာတန်း\\n","font_family":"Myanmar Text","font_size":32,"font_color":"white","position":"bottom","outline":2}`. Split a video into clips by sending `{"upload_id":"<id>","operation":"split-video","segment_seconds":60}`; allowed clip lengths are 30, 60, and 120 seconds, and the result is a ZIP under `/renders/`.

Create a Burmese recap narration, synthesize it with Azure Speech, and mux it over the source video with `{"upload_id":"<id>","operation":"create-recap-dub","subtitle_srt":"optional SRT text","voice":"my-MM-NilarNeural","recap_seconds":60,"include_original_audio":true,"background_volume":20}`. Supported voices are `my-MM-NilarNeural` and `my-MM-ThihaNeural`; recap lengths are 30, 60, or 90 seconds. If SRT text contains captions, it is used as the recap source. Otherwise, the backend transcribes the video audio with Azure's Burmese `my-MM` fast-transcription API. A completed recap job stores its generated script as `result_text` and its rendered MP4 under `/renders/`. Poll `GET http://localhost:8000/api/jobs/<job-id>` until `completed` or `failed`.

FFmpeg is provided by the `imageio-ffmpeg` Python package, so a system-wide FFmpeg install is not required. Azure file transcription has a documented limit under 250 MB and 2 hours; longer videos should provide subtitles or be shortened first. Azure TTS has a 10-minute per-request output limit. AI jobs require OpenAI and Azure Speech credentials in the server `.env`; see `.env.example`. Uploads, renders, working files, and the SQLite database are local and ignored by Git. On API startup, jobs left `running` by a crash are requeued. This setup intentionally uses one local worker; deploy multiple workers or long-running production jobs with a broker-backed queue such as Celery/Redis. Authentication and cloud storage are not included yet. The Next.js page uses this API by default; set `NEXT_PUBLIC_API_URL` if the API runs at another origin.
