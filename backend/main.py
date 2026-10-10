import asyncio
import os
import re
import subprocess
import uuid
from zipfile import ZIP_STORED, ZipFile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator, Literal

import imageio_ffmpeg
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from backend.ai_providers import ProviderError
from backend.job_store import (
    claim_next_job,
    create_job,
    get_job,
    initialize_job_store,
    public_job,
    update_job,
)
from backend.voiceover import create_recap_dub, srt_to_plain_text

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm"}
STORAGE_DIRECTORY = Path(__file__).resolve().parent / "storage"
UPLOAD_DIRECTORY = STORAGE_DIRECTORY / "uploads"
RENDER_DIRECTORY = STORAGE_DIRECTORY / "renders"
WORK_DIRECTORY = STORAGE_DIRECTORY / "working"
UPLOAD_DIRECTORY.mkdir(parents=True, exist_ok=True)
RENDER_DIRECTORY.mkdir(parents=True, exist_ok=True)
WORK_DIRECTORY.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    initialize_job_store()
    stop_event = asyncio.Event()
    worker = asyncio.create_task(render_worker(stop_event))
    try:
        yield
    finally:
        stop_event.set()
        await worker


app = FastAPI(title="RecapKit API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000",
        ).split(",")
        if origin.strip()
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.mount("/media", StaticFiles(directory=UPLOAD_DIRECTORY), name="media")
app.mount("/renders", StaticFiles(directory=RENDER_DIRECTORY), name="renders")


class CreateRenderJobRequest(BaseModel):
    upload_id: str
    operation: Literal[
        "extract-audio",
        "burn-subtitles",
        "split-video",
        "create-recap-dub",
    ]
    segment_seconds: Literal[30, 60, 120] = 60
    recap_seconds: Literal[30, 60, 90, 120, 180, 300, 420, 600] = 60
    voice: Literal["my-MM-NilarNeural", "my-MM-ThihaNeural"] = "my-MM-NilarNeural"
    include_original_audio: bool = True
    background_volume: int = Field(default=20, ge=0, le=100)
    subtitle_srt: str | None = Field(default=None, max_length=200_000)
    font_family: Literal["Noto Sans Myanmar", "Myanmar Text", "Arial"] = "Noto Sans Myanmar"
    font_size: int = Field(default=32, ge=16, le=80)
    font_color: Literal["white", "yellow", "cyan"] = "white"
    position: Literal["top", "center", "bottom"] = "bottom"
    outline: int = Field(default=2, ge=0, le=8)


def extract_audio(job_id: str, source_path: Path) -> Path:
    output_path = RENDER_DIRECTORY / f"{job_id}.mp3"
    temporary_path = WORK_DIRECTORY / f"{job_id}.partial.mp3"
    result = subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(),
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source_path),
            "-vn",
            "-map",
            "0:a:0",
            "-codec:a",
            "libmp3lame",
            "-q:a",
            "2",
            str(temporary_path),
        ],
        capture_output=True,
        text=True,
        timeout=4 * 60 * 60,
        check=False,
    )
    if result.returncode != 0:
        temporary_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)
        raise RuntimeError(result.stderr.strip()[-1000:] or "FFmpeg could not extract an audio track.")
    temporary_path.replace(output_path)
    return output_path


def split_video(job_id: str, source_path: Path, segment_seconds: int) -> Path:
    output_path = RENDER_DIRECTORY / f"{job_id}-clips.zip"
    temporary_zip = WORK_DIRECTORY / f"{job_id}.partial.zip"
    segment_pattern = WORK_DIRECTORY / f"{job_id}-part-%03d.mp4"

    try:
        result = subprocess.run(
            [
                imageio_ffmpeg.get_ffmpeg_exe(),
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(source_path),
                "-map",
                "0:v:0",
                "-map",
                "0:a?",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "24",
                "-force_key_frames",
                f"expr:gte(t,n_forced*{segment_seconds})",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                "-f",
                "segment",
                "-segment_time",
                str(segment_seconds),
                "-break_non_keyframes",
                "1",
                "-reset_timestamps",
                "1",
                "-segment_format",
                "mp4",
                str(segment_pattern),
            ],
            capture_output=True,
            text=True,
            timeout=4 * 60 * 60,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip()[-1000:] or "FFmpeg could not split the video.")

        segments = sorted(WORK_DIRECTORY.glob(f"{job_id}-part-*.mp4"))
        if not segments:
            raise RuntimeError("FFmpeg did not produce any video segments.")

        with ZipFile(temporary_zip, "w", compression=ZIP_STORED) as archive:
            for segment in segments:
                archive.write(segment, arcname=segment.name)

        temporary_zip.replace(output_path)
        return output_path
    except Exception:
        temporary_zip.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)
        raise
    finally:
        for segment in WORK_DIRECTORY.glob(f"{job_id}-part-*.mp4"):
            segment.unlink(missing_ok=True)


def burn_subtitles(job_id: str, source_path: Path, parameters: dict[str, str | int]) -> Path:
    subtitle_path = WORK_DIRECTORY / f"{job_id}.srt"
    temporary_path = WORK_DIRECTORY / f"{job_id}.partial.mp4"
    output_path = RENDER_DIRECTORY / f"{job_id}.mp4"
    subtitle_path.write_text(str(parameters["subtitle_srt"]), encoding="utf-8")

    colors = {
        "white": "&H00FFFFFF",
        "yellow": "&H0000FFFF",
        "cyan": "&H00FFFF00",
    }
    alignments = {"bottom": 2, "center": 5, "top": 8}
    position = str(parameters["position"])
    margin = 48 if position != "center" else 0
    font_size = int(parameters["font_size"])
    outline = int(parameters["outline"])
    font_family = str(parameters["font_family"])
    escaped_path = str(subtitle_path.resolve()).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
    style = (
        f"FontName={font_family},FontSize={font_size},"
        f"PrimaryColour={colors[str(parameters['font_color'])]},"
        f"OutlineColour=&HAA000000,Outline={outline},Shadow=1,"
        f"Alignment={alignments[position]},MarginV={margin}"
    )

    try:
        result = subprocess.run(
            [
                imageio_ffmpeg.get_ffmpeg_exe(),
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(source_path),
                "-map",
                "0:v:0",
                "-map",
                "0:a?",
                "-vf",
                f"subtitles=filename='{escaped_path}':force_style='{style}'",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "22",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-movflags",
                "+faststart",
                str(temporary_path),
            ],
            capture_output=True,
            text=True,
            timeout=4 * 60 * 60,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip()[-1000:] or "FFmpeg could not burn subtitles.")
        temporary_path.replace(output_path)
        return output_path
    except (OSError, RuntimeError, subprocess.TimeoutExpired):
        temporary_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)
        raise
    finally:
        subtitle_path.unlink(missing_ok=True)


async def render_worker(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        job = claim_next_job()
        if job is None:
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=0.5)
            except TimeoutError:
                pass
            continue

        try:
            source_path = find_uploaded_video(job["upload_id"])
            result_text = None
            if job["operation"] == "extract-audio":
                output_path = await asyncio.to_thread(extract_audio, job["id"], source_path)
            elif job["operation"] == "burn-subtitles":
                output_path = await asyncio.to_thread(
                    burn_subtitles,
                    job["id"],
                    source_path,
                    job["parameters"],
                )
            elif job["operation"] == "split-video":
                output_path = await asyncio.to_thread(
                    split_video,
                    job["id"],
                    source_path,
                    job["parameters"]["segment_seconds"],
                )
            elif job["operation"] == "create-recap-dub":
                output_path, result_text = await asyncio.to_thread(
                    create_recap_dub,
                    job["id"],
                    source_path,
                    subtitle_srt=job["parameters"].get("subtitle_srt"),
                    voice=job["parameters"]["voice"],
                    recap_seconds=job["parameters"]["recap_seconds"],
                    include_original_audio=job["parameters"]["include_original_audio"],
                    background_volume=job["parameters"]["background_volume"],
                )
            else:
                raise RuntimeError("Unsupported render operation.")
            update_job(
                job["id"],
                status="completed",
                output_url=f"/renders/{output_path.name}",
                result_text=result_text,
            )
        except Exception as error:
            update_job(job["id"], status="failed", error=str(error)[:1000])


def find_uploaded_video(upload_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{32}", upload_id):
        raise HTTPException(status_code=404, detail="Uploaded video not found.")

    for extension in ALLOWED_EXTENSIONS:
        source_path = UPLOAD_DIRECTORY / f"{upload_id}{extension}"
        if source_path.is_file():
            return source_path

    raise HTTPException(status_code=404, detail="Uploaded video not found.")


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/uploads", status_code=201)
async def upload_video(file: UploadFile) -> dict[str, str | int]:
    original_name = file.filename or ""
    extension = Path(original_name).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail="MP4, MOV, MKV သို့မဟုတ် WEBM ဖိုင်ကိုသာ တင်နိုင်ပါတယ်။",
        )
    if file.size is not None and file.size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="ဖိုင်အရွယ်အစား 2 GB ထက်မကျော်ရပါ။")

    upload_id = uuid.uuid4().hex
    stored_name = f"{upload_id}{extension}"
    temporary_path = UPLOAD_DIRECTORY / f"{upload_id}.upload"
    final_path = UPLOAD_DIRECTORY / stored_name
    saved_size = 0

    try:
        with temporary_path.open("xb") as destination:
            while chunk := await file.read(CHUNK_SIZE):
                saved_size += len(chunk)
                if saved_size > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail="ဖိုင်အရွယ်အစား 2 GB ထက်မကျော်ရပါ။",
                    )
                destination.write(chunk)

        if saved_size == 0:
            raise HTTPException(status_code=400, detail="ဗလာဖိုင်ကို တင်လို့မရပါ။")

        temporary_path.replace(final_path)
    except HTTPException:
        temporary_path.unlink(missing_ok=True)
        raise
    except OSError as error:
        temporary_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="ဖိုင်ကို သိမ်းဆည်းမရပါ။") from error
    finally:
        await file.close()

    return {
        "id": upload_id,
        "filename": original_name,
        "size_bytes": saved_size,
        "media_url": f"/media/{stored_name}",
    }


@app.post("/api/jobs", status_code=202)
async def create_render_job(
    request: CreateRenderJobRequest,
) -> dict[str, str | None]:
    find_uploaded_video(request.upload_id)
    if request.operation == "create-recap-dub":
        missing_settings = [
            name
            for name in ("OPENAI_API_KEY", "AZURE_SPEECH_KEY", "AZURE_SPEECH_TTS_REGION")
            if not os.getenv(name)
        ]
        if not srt_to_plain_text(request.subtitle_srt or "") and not os.getenv("AZURE_SPEECH_STT_ENDPOINT"):
            missing_settings.append("AZURE_SPEECH_STT_ENDPOINT")
        if missing_settings:
            raise HTTPException(
                status_code=503,
                detail="Configure these backend environment values to use AI recap and Burmese voice: "
                + ", ".join(missing_settings),
            )
    if request.operation == "burn-subtitles" and (
        not request.subtitle_srt or "-->" not in request.subtitle_srt
    ):
        raise HTTPException(status_code=422, detail="SRT subtitle text with timecodes is required.")

    job_id = uuid.uuid4().hex
    parameters = request.model_dump(
        exclude={"upload_id", "operation"},
        exclude_none=True,
    )
    return public_job(create_job(job_id, request.upload_id, request.operation, parameters))


@app.get("/api/jobs/{job_id}")
async def get_render_job(job_id: str) -> dict[str, str | None]:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Render job not found.")
    return public_job(job)