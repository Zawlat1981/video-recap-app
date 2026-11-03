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
            "https://video-recap-app.vercel.app,http://localhost:3000,http://127.0.0.1:3000",
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
        "transcribe-audio",
        "hide-sub",
        "export-video",
    ]
    mode: Literal["recap", "dubbing"] = "recap"
    segment_seconds: Literal[30, 60, 120] = 60
    recap_seconds: int = Field(default=600, ge=30, le=600)
    voice: Literal["my-MM-NilarNeural", "my-MM-ThihaNeural"] = "my-MM-NilarNeural"
    include_original_audio: bool = True
    background_volume: int = Field(default=20, ge=0, le=100)
    subtitle_srt: str | None = Field(default=None, max_length=200_000)
    font_family: Literal["Noto Sans Myanmar", "Myanmar Text", "Arial"] = "Noto Sans Myanmar"
    font_size: int = Field(default=32, ge=16, le=80)
    font_color: Literal["white", "yellow", "cyan"] = "white"
    position: Literal["top", "center", "bottom"] = "bottom"
    outline: int = Field(default=2, ge=0, le=8)
    hide_method: Literal["blur", "blackbox", "crop"] = "blur"
    template_ratio: Literal["16:9", "9:16", "1:1"] = "16:9"
    text_overlay: str = Field(default="", max_length=500)
    text_animation: Literal["none", "fade", "slide", "pop"] = "none"
    text_position: Literal["top", "center", "bottom"] = "bottom"
    text_size: int = Field(default=48, ge=18, le=120)
    text_color: Literal["white", "yellow", "cyan"] = "white"


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


def hide_original_subtitles(job_id: str, source_path: Path, method: str) -> Path:
    output_path = RENDER_DIRECTORY / f"{job_id}-hidden.mp4"
    temporary_path = WORK_DIRECTORY / f"{job_id}.partial.mp4"
    command = [
        imageio_ffmpeg.get_ffmpeg_exe(),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source_path),
    ]

    if method == "blur":
        command.extend([
            "-filter_complex",
            "split[base][blur];[blur]crop=iw:ih/5:0:ih*4/5,boxblur=8:2[patch];"
            "[base][patch]overlay=0:H-h[out]",
            "-map",
            "[out]",
        ])
    elif method == "blackbox":
        command.extend([
            "-vf",
            "drawbox=x=0:y=ih*4/5:w=iw:h=ih/5:color=black@0.85:t=fill",
            "-map",
            "0:v:0",
        ])
    elif method == "crop":
        command.extend([
            "-vf",
            "crop=iw:ih*4/5:0:0",
            "-map",
            "0:v:0",
        ])
    else:
        raise ValueError("Unsupported subtitle hiding method.")

    command.extend([
        "-map",
        "0:a?",
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
    ])

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=4 * 60 * 60,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip()[-1000:] or "FFmpeg could not hide the original subtitles.")
        temporary_path.replace(output_path)
        return output_path
    except (OSError, RuntimeError, subprocess.TimeoutExpired):
        temporary_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)
        raise


def _escape_filter_path(path: Path) -> str:
    return (
        str(path.resolve())
        .replace("\\", "/")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace(",", "\\,")
        .replace("[", "\\[")
        .replace("]", "\\]")
    )


def apply_video_design(job_id: str, source_path: Path, parameters: dict[str, object]) -> Path:
    dimensions = {
        "16:9": (1920, 1080),
        "9:16": (1080, 1920),
        "1:1": (1080, 1080),
    }
    width, height = dimensions[str(parameters.get("template_ratio", "16:9"))]
    output_path = RENDER_DIRECTORY / f"{job_id}-designed.mp4"
    temporary_path = WORK_DIRECTORY / f"{job_id}.design.partial.mp4"
    text_path = WORK_DIRECTORY / f"{job_id}.overlay.txt"
    text = str(parameters.get("text_overlay", "")).strip()

    filter_graph = (
        f"[0:v]split=2[background][foreground];"
        f"[background]scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height},boxblur=20:10[blurred];"
        f"[foreground]scale={width}:{height}:force_original_aspect_ratio=decrease[fitted];"
        "[blurred][fitted]overlay=(W-w)/2:(H-h)/2,setsar=1[framed]"
    )

    if text:
        font_path = os.getenv("VIDEO_FONT_PATH", "").strip()
        font_option = ""
        if font_path:
            resolved_font_path = Path(font_path).expanduser()
            if not resolved_font_path.is_file():
                raise RuntimeError("VIDEO_FONT_PATH must point to an installed TTF/OTF font file.")
            font_option = f"fontfile='{_escape_filter_path(resolved_font_path)}':"
        text_path.write_text(text, encoding="utf-8")

        y_positions = {
            "top": "48",
            "center": "(h-text_h)/2",
            "bottom": "h-text_h-48",
        }
        position = str(parameters.get("text_position", "bottom"))
        y_expression = y_positions[position]
        animation = str(parameters.get("text_animation", "none"))
        if animation == "fade":
            animation_options = ":alpha='if(lt(t,1),t,1)'"
        elif animation == "slide":
            target_y = y_expression
            y_expression = f"if(lt(t,0.7),h-text_h-(h-text_h-({target_y}))*t/0.7,({target_y}))"
            animation_options = ""
        elif animation == "pop":
            size = int(parameters.get("text_size", 48))
            animation_options = f":fontsize='if(lt(t,0.5),max(18,{size}*t/0.5),{size})'"
        else:
            animation_options = ""

        colors = {"white": "white", "yellow": "yellow", "cyan": "cyan"}
        text_filter = (
            f"drawtext=textfile='{_escape_filter_path(text_path)}':expansion=none:"
            f"{font_option}fontsize={int(parameters.get('text_size', 48))}:"
            f"fontcolor={colors[str(parameters.get('text_color', 'white'))]}:"
            f"borderw=2:bordercolor=black:shadowcolor=black@0.8:shadowx=2:shadowy=2:"
            f"x=(w-text_w)/2:y='{y_expression}'{animation_options}"
        )
        filter_graph += f";[framed]{text_filter},format=yuv420p[out]"
    else:
        filter_graph += ";[framed]format=yuv420p[out]"

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
                "-filter_complex",
                filter_graph,
                "-map",
                "[out]",
                "-map",
                "0:a?",
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
            raise RuntimeError(result.stderr.strip()[-1000:] or "FFmpeg could not export the video design.")
        temporary_path.replace(output_path)
        return output_path
    except (OSError, RuntimeError, subprocess.TimeoutExpired):
        temporary_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)
        raise
    finally:
        text_path.unlink(missing_ok=True)


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
            if job["operation"] == "export-video":
                output_path = await asyncio.to_thread(
                    apply_video_design,
                    job["id"],
                    source_path,
                    job["parameters"],
                )
            elif job["operation"] == "extract-audio":
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
            elif job["operation"] == "hide-sub":
                output_path = await asyncio.to_thread(
                    hide_original_subtitles,
                    job["id"],
                    source_path,
                    job["parameters"].get("hide_method", "blur"),
                )
            elif job["operation"] in ("create-recap-dub", "transcribe-audio"):
                output_path, result_text = await asyncio.to_thread(
                    create_recap_dub,
                    job_id=job["id"],
                    source_path=source_path,
                    subtitle_srt=job["parameters"].get("subtitle_srt"),
                    voice=job["parameters"].get("voice", "my-MM-NilarNeural"),
                    recap_seconds=job["parameters"].get("recap_seconds", 600),
                    include_original_audio=job["parameters"].get("include_original_audio", True),
                    background_volume=job["parameters"].get("background_volume", 20),
                    mode=job["parameters"].get("mode", "recap"),
                )
            else:
                raise RuntimeError("Unsupported render operation.")
            if job["operation"] in {
                "burn-subtitles",
                "hide-sub",
                "create-recap-dub",
                "transcribe-audio",
            }:
                rendered_output_path = output_path
                try:
                    output_path = await asyncio.to_thread(
                        apply_video_design,
                        job["id"],
                        rendered_output_path,
                        job["parameters"],
                    )
                except Exception:
                    rendered_output_path.unlink(missing_ok=True)
                    raise
                if rendered_output_path != output_path:
                    rendered_output_path.unlink(missing_ok=True)
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