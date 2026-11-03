---
title: Video Recap Backend
emoji: 🎥
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
---

# RecapKit API

The backend accepts video and media uploads, stores them locally under `backend/storage`, and queues FFmpeg audio extraction, subtitle rendering, subtitle hiding, video splitting, voiceover, template/element export, audio mixing, image-to-video, and magic-tool jobs. Job state and generated scripts are persisted in SQLite at `backend/storage/jobs.sqlite3`.

From the project root, create and activate a Python 3.11 virtual environment, then install the backend and test requirements:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements-dev.txt
Copy-Item .env.example .env
```

Set `AZURE_SPEECH_KEY` and `AZURE_SPEECH_TTS_REGION` in `.env` for Nilar/Thiha Burmese speech synthesis. Set `OPENAI_API_KEY` to use OpenAI for recap writing and translation, or leave it empty and run the local Ollama server with the model named by `OLLAMA_MODEL` (default `qwen2.5`). Source audio is transcribed locally by Faster-Whisper. Provider keys stay server-side and are not sent to Next.js. Never commit `.env`.

## Myanmar and Thai fonts

FFmpeg text overlays need a TTF/OTF file with the required glyphs. Install a Myanmar-capable font such as [Noto Sans Myanmar](https://fonts.google.com/noto/specimen/Noto+Sans+Myanmar), place it in `backend/storage/fonts/`, or point `VIDEO_FONT_PATH` to an installed file. The font list in Brand Kit is discovered from this directory, the configured path, and the Windows Fonts directory. The font itself and `.env` are local and should not be committed.

```dotenv
VIDEO_FONT_PATH=backend/storage/fonts/NotoSansMyanmar.ttf
```

Verify a chosen font with a short export containing `မင်္ဂလာပါ`. Uploaded brand logos, image assets, and audio tracks are stored under the ignored `backend/storage/assets/` directory.

Start the API from the project root:

```powershell
python -m uvicorn backend.main:app --reload --port 8000
```

The upload endpoint is `POST http://localhost:8000/api/uploads` with a multipart field named `file`. Start audio extraction with `POST http://localhost:8000/api/jobs` and `{"upload_id":"<id>","operation":"extract-audio"}`. To burn subtitles into an MP4, send `{"upload_id":"<id>","operation":"burn-subtitles","subtitle_srt":"1\\n00:00:00,000 --> 00:00:03,000\\nမြန်မာစာတန်း\\n","font_family":"Myanmar Text","font_size":32,"font_color":"white","position":"bottom","outline":2}`. Split a video into clips by sending `{"upload_id":"<id>","operation":"split-video","segment_seconds":60}`; allowed clip lengths are 30, 60, and 120 seconds, and the result is a ZIP under `/renders/`.

Hide subtitles near the bottom of an uploaded video with `{"upload_id":"<id>","operation":"hide-sub","hide_method":"blur"}`. Available methods are `blur`, `blackbox`, and `crop`; the backend runs FFmpeg with argument arrays (not a shell) and returns an MP4 render.

Choose `mode: "recap"` to create a new Burmese recap script, or `mode: "dubbing"` to transcribe Thai dialogue and translate it directly into Burmese. Dubbing uses Thai SRT text when supplied; otherwise Faster-Whisper transcribes the source audio as Thai. Both modes synthesize with Azure's `my-MM-NilarNeural` or `my-MM-ThihaNeural` voice. For example: `{"upload_id":"<id>","operation":"create-recap-dub","mode":"dubbing","voice":"my-MM-NilarNeural","include_original_audio":true,"background_volume":20}`. Dubbing translates the dialogue as a whole; it does not yet align each translated utterance to the original dialogue timestamps.

Video render jobs accept `template_ratio` (`16:9`, `9:16`, or `1:1`), `text_overlay`, `text_animation` (`none`, `fade`, `slide`, `pop`, or `typewriter`), `text_position`, `text_size`, and `text_color`. The FFmpeg export fits the source in the selected canvas with a blurred background fill and center framing; it does not detect faces automatically. Animated text is burned into the MP4. Set `VIDEO_FONT_PATH` to an installed TTF/OTF font with Myanmar/Thai glyphs to render those scripts. Video styling applies to subtitle, subtitle-hiding, and voiceover MP4 jobs; start an `export-video` job to export styling without another edit.

## Phase 2 exports

`export-video` accepts an `elements` array. Supported element kinds are `heart`, `star`, `sparkle`, `happy`, `sad`, `angry`, `shock`, `laugh`, `tractor`, `lower-third`, and `bubble`. Each item may set normalized `x`/`y` canvas positions, scale, rotation, start/end seconds, and text. Brand options include `brand_primary`, `brand_background`, `font_id`, optional uploaded `logo_asset_id`, watermark settings, and optional three-second intro/five-second outro. An uploaded BGM track can be looped and mixed at `bgm_volume`; optional `sound_effects` entries specify an uploaded `asset_id`, start time, and volume. These are uploaded through `POST /api/assets` with `category=image` or `category=audio`.

Create a Ken Burns clip or slideshow with `operation=image-to-video`, `image_asset_ids` (one to ten uploaded image IDs), `image_duration` (3–10 seconds per image), and `image_motion` (`zoom-in`, `zoom-out`, `pan-left`, `pan-right`, or `zoom-pan`). Batch export accepts `operation=batch-export` and one to ten `batch_upload_ids`, and returns a ZIP. `auto-cut-silence` removes pauses of at least one second while keeping audio/video segments synchronized. `magic-resize` uses the selected template; optional face centering requires OpenCV and can fail clearly when no face is detected. Install `python -m pip install -r backend/requirements-magic.txt` for that optional feature. `remove-green-screen` keys solid green footage only; it is not an AI background remover.

The element palette is a small original built-in set, not a bundled collection of 50+ third-party stickers. Music and effects are user-uploaded rather than bundled. Batch and render jobs run sequentially in the existing local worker.

A completed job stores any generated recap/translation in `result_text` and its rendered file under `/renders/`. Poll `GET http://localhost:8000/api/jobs/<job-id>` until `completed` or `failed`.

Run the backend tests with `python -m pytest backend`. FFmpeg is provided by the `imageio-ffmpeg` Python package, so a system-wide FFmpeg install is not required. Azure TTS has a 10-minute per-request output limit. Uploads, renders, working files, and the SQLite database are local and ignored by Git. On API startup, jobs left `running` by a crash are requeued. This setup intentionally uses one local worker; deploy multiple workers or long-running production jobs with a broker-backed queue such as Celery/Redis. Authentication and cloud storage are not included yet. The Next.js page uses this API by default; set `NEXT_PUBLIC_API_URL` if the API runs at another origin.
