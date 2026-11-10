---
title: Video Recap Backend
emoji: 🎥
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
---

# RecapKit API

The backend accepts video and media uploads, stores them under `RECAPKIT_STORAGE_DIR` (default: `backend/storage`), and queues FFmpeg audio extraction, subtitle rendering, subtitle hiding, video splitting, voiceover, template/element export, audio mixing, image-to-video, and magic-tool jobs. Job state and generated scripts are persisted in SQLite at `<RECAPKIT_STORAGE_DIR>/jobs.sqlite3`.

From the project root, create and activate a Python 3.11 virtual environment, then install the backend and test requirements:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements-dev.txt
Copy-Item .env.example .env
```

Set `AZURE_SPEECH_KEY` and `AZURE_SPEECH_TTS_REGION` in `.env` for Nilar/Thiha Burmese speech synthesis. Set `OPENAI_API_KEY` to use OpenAI for recap writing and translation, or leave it empty and run the local Ollama server with the model named by `OLLAMA_MODEL` (default `qwen2.5:7b-instruct-q4_K_M`). Pull that model with `ollama pull qwen2.5:7b-instruct-q4_K_M`, or set `OLLAMA_MODEL` to a model already installed locally. Local recap requests use Ollama's native API with CPU inference by default (`OLLAMA_NUM_GPU=0`) to avoid unstable Vulkan GPU runners; generation can be slower, particularly with 7B models. Set `OLLAMA_NUM_GPU` to a positive layer count only if GPU inference is stable on your machine. Source audio is transcribed locally by Faster-Whisper. Provider keys stay server-side and are not sent to Next.js. Never commit `.env`.

## Myanmar and Thai fonts

The app bundles Noto Sans Myanmar in `backend/fonts/` for the render worker and `public/fonts/` for browser previews; subtitle rendering explicitly loads the bundled font through FFmpeg/libass. Additional TTF/OTF fonts can be placed in `backend/storage/fonts/`, or selected with `VIDEO_FONT_PATH`. Brand Kit lists the bundled and configured fonts. Enter Burmese captions as Unicode; Zawgyi conversion is not performed.

```dotenv
VIDEO_FONT_PATH=backend/storage/fonts/NotoSansMyanmar.ttf
```

Verify a chosen font with a short export containing `မင်္ဂလာပါ`. Uploaded brand logos, image assets, and audio tracks are stored under the ignored `backend/storage/assets/` directory.

Start the API from the project root:

```powershell
python -m uvicorn backend.main:app --reload --port 8000
```

The upload endpoint is `POST http://localhost:8000/api/uploads` with a multipart field named `file`. Start audio extraction with `POST http://localhost:8000/api/jobs` and `{"upload_id":"<id>","operation":"extract-audio"}`. Trim a video to a chosen time range with `{"upload_id":"<id>","operation":"trim-video","trim_start_seconds":4.5,"trim_end_seconds":18}`; the end must be after the start. To burn subtitles into an MP4, send `{"upload_id":"<id>","operation":"burn-subtitles","subtitle_srt":"1\\n00:00:00,000 --> 00:00:03,000\\nမြန်မာစာတန်း\\n","font_family":"Myanmar Text","font_size":32,"font_color":"white","position":"bottom","outline":2}`. Split a video into clips by sending `{"upload_id":"<id>","operation":"split-video","segment_seconds":60}`; allowed clip lengths are 30, 60, and 120 seconds, and the result is a ZIP under `/renders/`. To join two to ten uploaded clips in order, send `{"upload_id":"00000000000000000000000000000000","operation":"merge-clips","merge_clip_ids":["<first-upload-id>","<second-upload-id>"]}`. The merge export re-encodes clips to a consistent MP4 format and adds silence where an input clip has no audio.

Hide subtitles near the bottom of an uploaded video with `{"upload_id":"<id>","operation":"hide-sub","hide_method":"blur"}`. Available methods are `blur`, `blackbox`, and `crop`; the backend runs FFmpeg with argument arrays (not a shell) and returns an MP4 render.

Choose `mode: "recap"` to create a new Burmese recap script, or `mode: "dubbing"` to transcribe Thai dialogue and translate it directly into Burmese. Recap transcription uses `source_language` (`th`, `my`, or `en`; default `th`) so Whisper matches the spoken language; dubbing always transcribes Thai. Dubbing uses Thai SRT text when supplied; otherwise Faster-Whisper transcribes the source audio as Thai. Both modes synthesize with Azure's `my-MM-NilarNeural` or `my-MM-ThihaNeural` voice. For example: `{"upload_id":"<id>","operation":"create-recap-dub","mode":"dubbing","voice":"my-MM-NilarNeural","include_original_audio":true,"background_volume":20}`. Dubbing translates the dialogue as a whole; it does not yet align each translated utterance to the original dialogue timestamps.

For externally written narration, use `operation: "script-voiceover"` with `script_text`, a timed `subtitle_srt`, and a voice. This sends the supplied text directly to Burmese TTS without recap generation or translation, mixes it with the original audio only when requested, keeps the full narration by extending a short source video with its final frame, applies the selected design, and burns the SRT subtitles into the same MP4. Narration and subtitle wording/timing are separate inputs; review their alignment before export. After a successful `merge-clips` job, `POST /api/uploads/from-merge/{job_id}` makes its MP4 available as the next editing source without downloading and re-uploading it in the browser.

Video render jobs accept `template_ratio` (`16:9`, `9:16`, or `1:1`), `text_overlay`, `text_animation` (`none`, `fade`, `slide`, `pop`, or `typewriter`), `text_position`, `text_size`, and `text_color`. The FFmpeg export fits the source in the selected canvas with a blurred background fill and center framing; it does not detect faces automatically. Animated text is burned into the MP4. Set `VIDEO_FONT_PATH` to an installed TTF/OTF font with Myanmar/Thai glyphs to render those scripts. Video styling applies to subtitle, subtitle-hiding, and voiceover MP4 jobs; start an `export-video` job to export styling without another edit. To mix a creator's own recorded narration, upload it as an audio asset and include its asset ID in `sound_effects` with `start_seconds: 0` and the desired `volume`; this keeps the original track and other audio mixes available.

## Phase 2 exports

`export-video` accepts an `elements` array. Supported element kinds are `heart`, `star`, `sparkle`, `happy`, `sad`, `angry`, `shock`, `laugh`, `tractor`, `lower-third`, and `bubble`. Each item may set normalized `x`/`y` canvas positions, scale, rotation, start/end seconds, and text. Brand options include `brand_primary`, `brand_background`, `font_id`, optional uploaded `logo_asset_id`, watermark settings, and optional three-second intro/five-second outro. An uploaded BGM track can be looped and mixed at `bgm_volume`; optional `sound_effects` entries specify an uploaded `asset_id`, start time, and volume. These are uploaded through `POST /api/assets` with `category=image` or `category=audio`.

Create a Ken Burns clip or slideshow with `operation=image-to-video`, `image_asset_ids` (one to ten uploaded image IDs), `image_duration` (3–10 seconds per image), and `image_motion` (`zoom-in`, `zoom-out`, `pan-left`, `pan-right`, or `zoom-pan`). Batch export accepts `operation=batch-export` and one to ten `batch_upload_ids`, and returns a ZIP. `auto-cut-silence` removes pauses of at least one second while keeping audio/video segments synchronized. `magic-resize` uses the selected template; optional face centering requires OpenCV and can fail clearly when no face is detected. Install `python -m pip install -r backend/requirements-magic.txt` for that optional feature. `remove-green-screen` keys solid green footage only; it is not an AI background remover.

The element palette is a small original built-in set, not a bundled collection of 50+ third-party stickers. Music and effects are user-uploaded rather than bundled. Batch and render jobs run sequentially in the existing local worker.

## Phase 3 templates, AI, and export profiles

The Templates Pro panel includes 24 built-in layout/style presets and stores custom presets in the current browser's `localStorage`; thumbnails are generated from CSS and no third-party art is bundled. Applying a preset updates the editor's ratio, text, elements, brand colors, and intro/outro settings. Saving the current editor also captures its selected font, logo, and uploaded BGM reference; built-in presets do not bundle music or logo files.

AI Pro operations use the existing Faster-Whisper model locally to transcribe audio. Recap scripts, story scripts, SEO metadata, and Angel suggestions use the configured OpenAI-compatible provider (`OPENAI_API_KEY` / `OPENAI_BASE_URL`) or local Ollama (`OLLAMA_BASE_URL` / `OLLAMA_MODEL`). Configure a provider before using these features. Whisper may download its model on first use. Angel currently uses the active editor context and available features; Kubota manuals and a separate RAG knowledge base are not configured. Highlight selection ranks non-overlapping audio windows by one-second loudness; it does not analyze faces or understand story semantics. Timed SRT uses Whisper segment timestamps, not word-level alignment.

The grouped Workspace menu links to the existing project, design, AI, and export panels without discarding editor state. Story Studio accepts an original idea and generates an editable Burmese chapter script with narration and visual prompts through the configured AI provider. It does not generate image, voice, or video assets; review Burmese wording before recording. `POST /api/jobs` accepts `{"upload_id":"00000000000000000000000000000000","operation":"story-script","ai_prompt":"...","story_genre":"drama","story_chapters":5}` without a video upload; chapter count must be 3–12.

`export-pro` supports `youtube-1080`, `youtube-4k`, `tiktok`, `youtube-shorts`, `instagram-square`, and `facebook-portrait` output sizes. Vertical exports use the 9:16 blurred-background layout and may optionally center on a detected face (requires OpenCV). TikTok/Shorts exports are capped at 60 seconds and encoded at 6 Mbps; the resulting file size varies with audio and duration, so a fixed sub-50-MB size is not guaranteed. Watermarks are optional. `export-pro-batch` applies the current editor design and selected profile to up to ten uploaded videos, then returns a ZIP. Exports remain local under `backend/storage/renders`; S3, Vercel Blob, seven-day links, and cloud export are not configured.

A completed job stores any generated recap/translation in `result_text` and its rendered file under `/renders/`. Poll `GET http://localhost:8000/api/jobs/<job-id>` until `completed` or `failed`.

Run the backend tests with `python -m pytest backend`. FFmpeg is provided by the `imageio-ffmpeg` Python package, so a system-wide FFmpeg install is not required. Azure TTS has a 10-minute per-request output limit. On API startup, jobs left `running` by a crash are requeued. This setup intentionally uses one local worker; deploy multiple workers or long-running production jobs with a broker-backed queue such as Celery/Redis.

## API-key protection and deployment storage

Set `RECAPKIT_API_KEY` on the backend host to require `X-API-Key` on API routes; use a long random value and never commit it. Set `RECAPKIT_REQUIRE_API_KEY=true` to fail closed with HTTP 503 when the key is missing (enabled by the repository Docker image). `/health` and the UUID-named `/media`, `/renders`, and `/assets` URLs remain reachable without a header for browser playback/download. CORS allows the configured `CORS_ORIGINS` and the `X-API-Key` request header.

For Hugging Face Spaces, enable persistent storage mounted at `/data`; the Docker image sets `RECAPKIT_STORAGE_DIR=/data`. Add `RECAPKIT_API_KEY` as a Space Secret before making the Space public. In the web app, use **Backend access** to enter the same key on each device; it is stored only in that browser's local storage. Point Vercel's `NEXT_PUBLIC_API_URL` at the Space's HTTPS URL and redeploy. Without mounted persistent storage, user uploads and jobs may be lost when the Space restarts.
