import asyncio
import os
import re
import shutil
import subprocess
import uuid
import unicodedata
from zipfile import ZIP_STORED, ZipFile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator, Literal

import imageio_ffmpeg
from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, model_validator
from dotenv import load_dotenv

from backend.job_store import (
    claim_next_job,
    create_job,
    get_job,
    initialize_job_store,
    public_job,
    update_job,
)
from backend.elements import render_element
from backend.ai_pro import (
    auto_cut_highlights,
    generate_recap_scenes,
    generate_seo_metadata,
    generate_story_script,
    segments_to_srt,
    suggest_editor_changes,
    transcribe_segments,
)
from backend.export_pro import export_video as export_video_pro
from backend.magic_tools import (
    auto_cut_silence,
    create_image_video,
    estimate_face_center_x,
)
from backend.voiceover import create_recap_dub, srt_to_plain_text

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm"}
STORAGE_DIRECTORY = Path(__file__).resolve().parent / "storage"
BUNDLED_FONT_DIRECTORY = Path(__file__).resolve().parent / "fonts"
UPLOAD_DIRECTORY = STORAGE_DIRECTORY / "uploads"
RENDER_DIRECTORY = STORAGE_DIRECTORY / "renders"
WORK_DIRECTORY = STORAGE_DIRECTORY / "working"
ASSET_DIRECTORY = STORAGE_DIRECTORY / "assets"
ELEMENT_DIRECTORY = STORAGE_DIRECTORY / "elements"
UPLOAD_DIRECTORY.mkdir(parents=True, exist_ok=True)
RENDER_DIRECTORY.mkdir(parents=True, exist_ok=True)
WORK_DIRECTORY.mkdir(parents=True, exist_ok=True)
ASSET_DIRECTORY.mkdir(parents=True, exist_ok=True)
ELEMENT_DIRECTORY.mkdir(parents=True, exist_ok=True)

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
app.mount("/assets", StaticFiles(directory=ASSET_DIRECTORY), name="assets")


class ElementOverlay(BaseModel):
    kind: Literal[
        "heart",
        "star",
        "sparkle",
        "happy",
        "sad",
        "angry",
        "shock",
        "laugh",
        "tractor",
        "lower-third",
        "bubble",
    ]
    x: float = Field(default=0.5, ge=0, le=1)
    y: float = Field(default=0.8, ge=0, le=1)
    scale: float = Field(default=1, ge=0.2, le=2)
    rotation: int = Field(default=0, ge=-180, le=180)
    start_seconds: float = Field(default=0, ge=0, le=86_400)
    end_seconds: float = Field(default=86_400, ge=0, le=86_400)
    text: str = Field(default="", max_length=100)
    subtitle: str = Field(default="", max_length=100)

    @model_validator(mode="after")
    def validate_time_range(self) -> "ElementOverlay":
        if self.end_seconds <= self.start_seconds:
            raise ValueError("An element's end time must be after its start time.")
        return self


class SoundEffectTrack(BaseModel):
    asset_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    start_seconds: float = Field(default=0, ge=0, le=86_400)
    volume: float = Field(default=0.8, ge=0, le=1)


class CreateRenderJobRequest(BaseModel):
    upload_id: str
    operation: Literal[
        "extract-audio",
        "trim-video",
        "burn-subtitles",
        "split-video",
        "merge-clips",
        "create-recap-dub",
        "transcribe-audio",
        "hide-sub",
        "export-video",
        "image-to-video",
        "auto-cut-silence",
        "magic-resize",
        "remove-green-screen",
        "batch-export",
        "ai-script",
        "auto-highlights",
        "subtitle-timing",
        "angel-chat",
        "seo-metadata",
        "export-pro",
        "export-pro-batch",
        "story-script",
        "script-voiceover",
    ]
    mode: Literal["recap", "dubbing"] = "recap"
    source_language: Literal["th", "my", "en"] = "th"
    segment_seconds: Literal[30, 60, 120] = 60
    trim_start_seconds: float = Field(default=0, ge=0, le=86_400)
    trim_end_seconds: float = Field(default=0, ge=0, le=86_400)
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
    text_animation: Literal["none", "fade", "slide", "pop", "typewriter"] = "none"
    text_position: Literal["top", "center", "bottom"] = "bottom"
    text_size: int = Field(default=48, ge=18, le=120)
    text_color: Literal["white", "yellow", "cyan"] = "white"
    elements: list[ElementOverlay] = Field(default_factory=list, max_length=30)
    logo_asset_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    logo_enabled: bool = False
    logo_opacity: float = Field(default=0.8, ge=0, le=1)
    logo_scale: float = Field(default=0.16, ge=0.05, le=0.5)
    font_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9._ -]{1,120}$")
    intro_enabled: bool = False
    outro_enabled: bool = False
    brand_primary: str = Field(default="#FF6600", pattern=r"^#[0-9a-fA-F]{6}$")
    brand_background: str = Field(default="#172A3A", pattern=r"^#[0-9a-fA-F]{6}$")
    face_center_x: float | None = Field(default=None, ge=0, le=1)
    face_center: bool = False
    remove_green_screen: bool = False
    bgm_asset_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    bgm_volume: float = Field(default=0.2, ge=0, le=1)
    bgm_ducking: bool = True
    sound_effects: list[SoundEffectTrack] = Field(default_factory=list, max_length=10)
    image_asset_ids: list[str] = Field(default_factory=list, max_length=10)
    image_duration: int = Field(default=5, ge=3, le=10)
    image_motion: Literal["zoom-in", "zoom-out", "pan-left", "pan-right", "zoom-pan"] = "zoom-in"
    batch_upload_ids: list[str] = Field(default_factory=list, max_length=10)
    merge_clip_ids: list[str] = Field(default_factory=list, max_length=10)
    minimum_silence: float = Field(default=1, ge=1, le=10)
    silence_threshold_db: int = Field(default=-40, ge=-60, le=-20)
    ai_script_seconds: int = Field(default=60, ge=30, le=120)
    ai_language: Literal["th", "my", "en"] = "th"
    ai_prompt: str = Field(default="", max_length=2000)
    ai_context: str = Field(default="", max_length=4000)
    ai_script: str = Field(default="", max_length=12000)
    script_text: str = Field(default="", max_length=12000)
    story_genre: str = Field(default="drama", max_length=40)
    story_chapters: int = Field(default=5, ge=3, le=12)
    target_seconds: int = Field(default=60, ge=15, le=60)
    export_preset: Literal[
        "youtube-1080",
        "youtube-4k",
        "tiktok",
        "youtube-shorts",
        "instagram-square",
        "facebook-portrait",
    ] = "tiktok"


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


def trim_video(job_id: str, source_path: Path, start_seconds: float, end_seconds: float) -> Path:
    if end_seconds <= start_seconds:
        raise RuntimeError("The trim end time must be after the start time.")

    output_path = RENDER_DIRECTORY / f"{job_id}-trimmed.mp4"
    temporary_path = WORK_DIRECTORY / f"{job_id}.trim.partial.mp4"
    try:
        result = subprocess.run(
            [
                imageio_ffmpeg.get_ffmpeg_exe(),
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-ss",
                f"{start_seconds:.3f}",
                "-i",
                str(source_path),
                "-t",
                f"{end_seconds - start_seconds:.3f}",
                "-map",
                "0:v:0",
                "-map",
                "0:a?",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "20",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
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
            output_path.unlink(missing_ok=True)
            raise RuntimeError(result.stderr.strip()[-1000:] or "FFmpeg could not trim the video.")
        temporary_path.replace(output_path)
        return output_path
    finally:
        temporary_path.unlink(missing_ok=True)


def merge_clips(
    job_id: str,
    clip_paths: list[Path],
    *,
    render_directory: Path | None = None,
    work_directory: Path | None = None,
) -> Path:
    if not 2 <= len(clip_paths) <= 10:
        raise RuntimeError("Choose between two and ten video clips to merge.")

    render_directory = render_directory or RENDER_DIRECTORY
    work_directory = work_directory or WORK_DIRECTORY
    render_directory.mkdir(parents=True, exist_ok=True)
    work_directory.mkdir(parents=True, exist_ok=True)
    output_path = render_directory / f"{job_id}-merged.mp4"
    temporary_path = work_directory / f"{job_id}.partial.mp4"
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    clip_info: list[tuple[float, bool]] = []

    try:
        for index, clip_path in enumerate(clip_paths, start=1):
            probe = subprocess.run(
                [ffmpeg, "-hide_banner", "-i", str(clip_path)],
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            video_line = next(
                (line for line in probe.stderr.splitlines() if "Video:" in line),
                None,
            )
            if video_line is None:
                raise RuntimeError(f"Clip {index} has no readable video stream.")
            if index == 1:
                dimensions = re.search(r"\b(\d{2,5})x(\d{2,5})\b", video_line)
                if dimensions is None:
                    raise RuntimeError("Could not read the first clip's video dimensions.")
                source_width, source_height = map(int, dimensions.groups())
                scale = min(1, 1920 / source_width, 1920 / source_height)
                output_width = max(2, int(source_width * scale) // 2 * 2)
                output_height = max(2, int(source_height * scale) // 2 * 2)

            duration_match = re.search(
                r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)",
                probe.stderr,
            )
            if duration_match is None:
                raise RuntimeError(f"Could not read the duration of clip {index}.")
            hours, minutes, seconds = duration_match.groups()
            duration = int(hours) * 3600 + int(minutes) * 60 + float(seconds)
            if duration <= 0:
                raise RuntimeError(f"Clip {index} has an invalid duration.")
            has_audio = any("Audio:" in line for line in probe.stderr.splitlines())
            clip_info.append((duration, has_audio))

        filter_parts: list[str] = []
        video_audio_labels: list[str] = []
        includes_audio = any(info[1] for info in clip_info)
        for index, (duration, clip_has_audio) in enumerate(clip_info):
            video_label = f"v{index}"
            filter_parts.append(
                f"[{index}:v:0]"
                f"scale={output_width}:{output_height}:force_original_aspect_ratio=decrease,"
                f"pad={output_width}:{output_height}:(ow-iw)/2:(oh-ih)/2:color=black,"
                f"setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[{video_label}]"
            )
            video_audio_labels.append(f"[{video_label}]")
            if includes_audio:
                audio_label = f"a{index}"
                if clip_has_audio:
                    filter_parts.append(
                        f"[{index}:a:0]"
                        f"aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                        f"apad=whole_dur={duration:.6f},atrim=duration={duration:.6f},"
                        f"asetpts=PTS-STARTPTS[{audio_label}]"
                    )
                else:
                    filter_parts.append(
                        f"anullsrc=r=48000:cl=stereo,atrim=duration={duration:.6f},"
                        f"asetpts=PTS-STARTPTS[{audio_label}]"
                    )
                video_audio_labels.append(f"[{audio_label}]")

        audio_streams = 1 if includes_audio else 0
        concat_inputs = "".join(video_audio_labels)
        output_labels = "[outv][outa]" if includes_audio else "[outv]"
        filter_parts.append(
            f"{concat_inputs}concat=n={len(clip_paths)}:v=1:a={audio_streams}{output_labels}"
        )
        command = [
            ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
        ]
        for clip_path in clip_paths:
            command.extend(["-i", str(clip_path)])
        command.extend(
            [
                "-filter_complex",
                ";".join(filter_parts),
                "-map",
                "[outv]",
            ]
        )
        if includes_audio:
            command.extend(["-map", "[outa]", "-c:a", "aac", "-b:a", "160k"])
        else:
            command.append("-an")
        command.extend(
            [
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-threads",
                "2",
                "-movflags",
                "+faststart",
                str(temporary_path),
            ]
        )
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=4 * 60 * 60,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip()[-1000:] or "FFmpeg could not merge the clips.")
        if not temporary_path.is_file() or temporary_path.stat().st_size == 0:
            raise RuntimeError("FFmpeg did not produce a merged video.")
        temporary_path.replace(output_path)
        return output_path
    except Exception:
        temporary_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)
        raise


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
    font_path = _resolve_font_path()
    escaped_path = str(subtitle_path.resolve()).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
    escaped_font_directory = _escape_filter_path(font_path.parent) if font_path else ""
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
                f"subtitles=filename='{escaped_path}':"
                f"fontsdir='{escaped_font_directory}':force_style='{style}'",
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


def _video_has_audio(path: Path) -> bool:
    probe = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-i", str(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    return any("Audio:" in line and re.search(r"Stream #\d+:\d+", line) for line in probe.stderr.splitlines())


def _text_clusters(text: str) -> list[str]:
    clusters: list[str] = []
    for character in text:
        if clusters and unicodedata.category(character).startswith("M"):
            clusters[-1] += character
        else:
            clusters.append(character)
    return clusters


def _font_options() -> list[dict[str, str]]:
    candidates: list[Path] = []
    configured = os.getenv("VIDEO_FONT_PATH", "").strip()
    if configured:
        candidates.append(Path(configured).expanduser())
    candidates.extend((STORAGE_DIRECTORY / "fonts").glob("*.ttf"))
    candidates.extend((STORAGE_DIRECTORY / "fonts").glob("*.otf"))
    candidates.extend(BUNDLED_FONT_DIRECTORY.glob("*.ttf"))
    candidates.extend(BUNDLED_FONT_DIRECTORY.glob("*.otf"))
    windows_fonts = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    if windows_fonts.is_dir():
        candidates.extend(windows_fonts.glob("*.ttf"))
        candidates.extend(windows_fonts.glob("*.otf"))

    options: dict[str, dict[str, str]] = {}
    for candidate in candidates:
        if candidate.is_file():
            options.setdefault(candidate.name, {"id": candidate.name, "label": candidate.stem})
    return sorted(options.values(), key=lambda font: font["label"].casefold())


def _resolve_font_path(font_id: object = None) -> Path | None:
    options = _font_options()
    selected_id = str(font_id) if font_id else None
    configured = os.getenv("VIDEO_FONT_PATH", "").strip()
    candidates = [Path(configured).expanduser()] if configured else []
    candidates.extend((STORAGE_DIRECTORY / "fonts").glob("*.ttf"))
    candidates.extend((STORAGE_DIRECTORY / "fonts").glob("*.otf"))
    candidates.extend(BUNDLED_FONT_DIRECTORY.glob("*.ttf"))
    candidates.extend(BUNDLED_FONT_DIRECTORY.glob("*.otf"))
    windows_fonts = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    if windows_fonts.is_dir():
        candidates.extend(windows_fonts.glob("*.ttf"))
        candidates.extend(windows_fonts.glob("*.otf"))
    if selected_id and selected_id not in {font["id"] for font in options}:
        raise RuntimeError("The selected font is not installed on the render server.")
    for candidate in candidates:
        if candidate.is_file() and (selected_id is None or candidate.name == selected_id):
            return candidate
    if selected_id:
        raise RuntimeError("The selected font file is no longer available on the render server.")
    return None


def _add_brand_sequences(
    job_id: str,
    source_path: Path,
    *,
    width: int,
    height: int,
    parameters: dict[str, object],
) -> Path:
    if not parameters.get("intro_enabled") and not parameters.get("outro_enabled"):
        return source_path

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    font_path = _resolve_font_path(parameters.get("font_id"))
    font_option = ""
    if font_path:
        font_option = f":fontfile='{_escape_filter_path(font_path)}'"
    background_color = str(parameters.get("brand_background", "#172A3A")).lstrip("#")
    intro_path = WORK_DIRECTORY / f"{job_id}.intro.mp4"
    outro_path = WORK_DIRECTORY / f"{job_id}.outro.mp4"
    text_paths: list[Path] = []
    clips: list[Path] = []

    def create_sting(path: Path, text: str, duration: int, suffix: str) -> None:
        text_path = WORK_DIRECTORY / f"{job_id}.{suffix}.txt"
        text_path.write_text(text, encoding="utf-8")
        text_paths.append(text_path)
        result = subprocess.run(
            [
                ffmpeg,
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                f"color=c=0x{background_color}:s={width}x{height}:r=30:d={duration}",
                "-vf",
                f"drawtext=textfile='{_escape_filter_path(text_path)}'{font_option}:"
                "expansion=none:fontcolor=white:fontsize=64:"
                "borderw=2:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2",
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "22",
                "-pix_fmt",
                "yuv420p",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=4 * 60 * 60,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip()[-1000:] or "Could not render a brand intro/outro.")
        clips.append(path)

    try:
        if parameters.get("intro_enabled"):
            create_sting(intro_path, "RecapKit", 3, "intro")
        clips.append(source_path)
        if parameters.get("outro_enabled"):
            create_sting(outro_path, "Subscribe လုပ်ပေးပါ", 5, "outro")

        temporary = WORK_DIRECTORY / f"{job_id}.brand.partial.mp4"
        command = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y"]
        for clip in clips:
            command.extend(["-i", str(clip)])
        concat_inputs = "".join(f"[{index}:v]" for index in range(len(clips)))
        command.extend([
            "-filter_complex",
            f"{concat_inputs}concat=n={len(clips)}:v=1:a=0[outv]",
            "-map",
            "[outv]",
        ])
        main_index = 1 if parameters.get("intro_enabled") else 0
        if _video_has_audio(source_path):
            audio_delay_ms = 3000 if parameters.get("intro_enabled") else 0
            command.extend(["-map", f"{main_index}:a:0", "-af", f"adelay={audio_delay_ms}|{audio_delay_ms}"])
        command.extend([
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "22",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            str(temporary),
        ])
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=4 * 60 * 60,
            check=False,
        )
        if result.returncode != 0:
            temporary.unlink(missing_ok=True)
            raise RuntimeError(result.stderr.strip()[-1000:] or "Could not join branded intro/outro.")
        temporary.replace(source_path)
        return source_path
    finally:
        for clip in clips:
            if clip != source_path:
                clip.unlink(missing_ok=True)
        for text_path in text_paths:
            text_path.unlink(missing_ok=True)


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

    if parameters.get("face_center_x") is None:
        foreground_filter = f"scale={width}:{height}:force_original_aspect_ratio=decrease"
    else:
        face_center_x = float(parameters["face_center_x"])
        foreground_filter = (
            f"scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height}:x='max(0,min(iw-ow,iw*{face_center_x:.6f}-ow/2))'"
        )
    foreground_key = "colorkey=0x00FF00:0.25:0.1," if parameters.get("remove_green_screen") else ""
    filter_parts = [
        f"[0:v]split=2[background][foreground];"
        f"[background]scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height},boxblur=20:10[blurred];"
        f"[foreground]{foreground_key}{foreground_filter}[fitted];"
        "[blurred][fitted]overlay=(W-w)/2:(H-h)/2,setsar=1[frame0]"
    ]
    current_video_label = "frame0"
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
    next_input = 1
    overlay_files: list[Path] = []
    audio_labels: list[str] = []
    source_has_audio = _video_has_audio(source_path)
    if source_has_audio:
        filter_parts.append("[0:a:0]volume=1[originalaudio]")
        audio_labels.append("[originalaudio]")

    try:
        logo_id = parameters.get("logo_asset_id")
        if parameters.get("logo_enabled") and not logo_id:
            raise RuntimeError("Upload a logo before enabling the watermark.")
        if parameters.get("logo_enabled") and logo_id:
            logo_path = find_uploaded_asset(str(logo_id), "image")
            command.extend(["-loop", "1", "-framerate", "30", "-i", str(logo_path)])
            opacity = float(parameters.get("logo_opacity", 0.8))
            scale = float(parameters.get("logo_scale", 0.16))
            output_label = f"frame{next_input}"
            filter_parts.append(
                f"[{next_input}:v]scale=w='min({width}*{scale},iw)':h=-1,"
                f"format=rgba,colorchannelmixer=aa={opacity}[logo{next_input}];"
                f"[{current_video_label}][logo{next_input}]overlay="
                f"x=W-w-36:y=H-h-36:shortest=1[{output_label}]"
            )
            current_video_label = output_label
            next_input += 1

        element_parameters = parameters.get("elements", [])
        if not isinstance(element_parameters, list):
            raise RuntimeError("Video elements must be a list.")
        font_path = _resolve_font_path(parameters.get("font_id"))
        for element_index, raw_element in enumerate(element_parameters):
            if not isinstance(raw_element, dict):
                raise RuntimeError("Each video element must be an object.")
            if float(raw_element.get("end_seconds", 86_400)) <= float(raw_element.get("start_seconds", 0)):
                raise RuntimeError("Each video element must end after it starts.")
            element_path = ELEMENT_DIRECTORY / f"{job_id}-{element_index}.png"
            render_element(
                raw_element,
                element_path,
                font_path=str(font_path) if font_path else None,
                primary_color=str(parameters.get("brand_primary", "#FF6600")),
            )
            overlay_files.append(element_path)
            command.extend(["-loop", "1", "-framerate", "30", "-i", str(element_path)])
            output_label = f"frame{next_input}"
            scale = float(raw_element.get("scale", 1))
            x = float(raw_element.get("x", 0.5))
            y = float(raw_element.get("y", 0.8))
            start = float(raw_element.get("start_seconds", 0))
            end = float(raw_element.get("end_seconds", 86_400))
            filter_parts.append(
                f"[{next_input}:v]scale=w={width * 0.16 * scale:.3f}:h=-1[sticker{next_input}];"
                f"[{current_video_label}][sticker{next_input}]overlay="
                f"x='(W-w)*{x:.6f}':y='(H-h)*{y:.6f}':"
                f"enable='between(t,{start:.3f},{end:.3f})':shortest=1[{output_label}]"
            )
            current_video_label = output_label
            next_input += 1

        bgm_id = parameters.get("bgm_asset_id")
        if bgm_id:
            bgm_path = find_uploaded_asset(str(bgm_id), "audio")
            command.extend(["-stream_loop", "-1", "-i", str(bgm_path)])
            bgm_label = f"bgm{next_input}"
            volume = float(parameters.get("bgm_volume", 0.2))
            if source_has_audio and parameters.get("bgm_ducking", True):
                filter_parts.append(
                    f"[{next_input}:a]volume={volume:.3f}[{bgm_label}pre];"
                    f"[{bgm_label}pre][originalaudio]"
                    "sidechaincompress=threshold=0.03:ratio=8:attack=20:release=250"
                    f"[{bgm_label}]"
                )
            else:
                filter_parts.append(f"[{next_input}:a]volume={volume:.3f}[{bgm_label}]")
            audio_labels.append(f"[{bgm_label}]")
            next_input += 1

        sound_effects = parameters.get("sound_effects", [])
        if not isinstance(sound_effects, list):
            raise RuntimeError("Sound effects must be a list.")
        for effect_index, effect in enumerate(sound_effects):
            if not isinstance(effect, dict):
                raise RuntimeError("Each sound effect must be an object.")
            effect_path = find_uploaded_asset(str(effect["asset_id"]), "audio")
            command.extend(["-i", str(effect_path)])
            delay_ms = round(float(effect.get("start_seconds", 0)) * 1000)
            volume = float(effect.get("volume", 0.8))
            effect_label = f"sfx{effect_index}"
            filter_parts.append(
                f"[{next_input}:a]volume={volume:.3f},adelay={delay_ms}|{delay_ms}[{effect_label}]"
            )
            audio_labels.append(f"[{effect_label}]")
            next_input += 1

        if text:
            if font_path:
                font_option = f"fontfile='{_escape_filter_path(font_path)}':"
            else:
                font_option = ""
            position = str(parameters.get("text_position", "bottom"))
            y_positions = {"top": "48", "center": "(h-text_h)/2", "bottom": "h-text_h-48"}
            y_expression = y_positions[position]
            animation = str(parameters.get("text_animation", "none"))
            base_size = int(parameters.get("text_size", 48))
            colors = {"white": "white", "yellow": "yellow", "cyan": "cyan"}
            color = colors[str(parameters.get("text_color", "white"))]

            if animation == "typewriter":
                prefixes: list[str] = []
                prefix = ""
                for cluster in _text_clusters(text)[:120]:
                    prefix += cluster
                    prefixes.append(prefix)
                for index, value in enumerate(prefixes):
                    prefix_path = WORK_DIRECTORY / f"{job_id}.typewriter-{index}.txt"
                    prefix_path.write_text(value, encoding="utf-8")
                    overlay_files.append(prefix_path)
                    enable = f"gte(t,{index * 0.08:.3f})" if index == len(prefixes) - 1 else (
                        f"between(t,{index * 0.08:.3f},{(index + 1) * 0.08:.3f})"
                    )
                    output_label = f"typewriter{index}"
                    filter_parts.append(
                        f"[{current_video_label}]drawtext="
                        f"textfile='{_escape_filter_path(prefix_path)}':expansion=none:{font_option}"
                        f"fontsize={base_size}:fontcolor={color}:borderw=2:bordercolor=black:"
                        f"x=(w-text_w)/2:y='{y_expression}':enable='{enable}'[{output_label}]"
                    )
                    current_video_label = output_label
            else:
                if animation == "fade":
                    animation_options = ":alpha='if(lt(t,1),t,1)'"
                elif animation == "slide":
                    y_expression = f"if(lt(t,0.7),h-text_h-(h-text_h-({y_expression}))*t/0.7,({y_expression}))"
                    animation_options = ""
                elif animation == "pop":
                    animation_options = f":fontsize='if(lt(t,0.5),max(18,{base_size}*t/0.5),{base_size})'"
                else:
                    animation_options = ""
                output_label = "withtext"
                text_path.write_text(text, encoding="utf-8")
                overlay_files.append(text_path)
                filter_parts.append(
                    f"[{current_video_label}]drawtext=textfile='{_escape_filter_path(text_path)}':"
                    f"expansion=none:{font_option}fontsize={base_size}:fontcolor={color}:"
                    f"borderw=2:bordercolor=black:shadowcolor=black@0.8:shadowx=2:shadowy=2:"
                    f"x=(w-text_w)/2:y='{y_expression}'{animation_options}[{output_label}]"
                )
                current_video_label = output_label

        filter_parts.append(f"[{current_video_label}]format=yuv420p[outv]")
        if audio_labels:
            filter_parts.append(
                f"{''.join(audio_labels)}amix=inputs={len(audio_labels)}:duration=longest:"
                "dropout_transition=2,alimiter=limit=0.95[outa]"
            )
        command.extend(["-filter_complex", ";".join(filter_parts), "-map", "[outv]"])
        if audio_labels:
            command.extend(["-map", "[outa]"])
        else:
            command.extend(["-map", "0:a?"])
        command.extend([
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
            "-shortest",
            "-movflags",
            "+faststart",
            str(temporary_path),
        ])

        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=4 * 60 * 60,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip()[-1000:] or "FFmpeg could not export the video design.")
        temporary_path.replace(output_path)
        return _add_brand_sequences(
            job_id,
            output_path,
            width=width,
            height=height,
            parameters=parameters,
        )
    except (OSError, RuntimeError, subprocess.TimeoutExpired):
        temporary_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)
        raise
    finally:
        for overlay_file in overlay_files:
            overlay_file.unlink(missing_ok=True)


def export_batch(
    job_id: str,
    upload_ids: list[str],
    parameters: dict[str, object],
    *,
    export_preset: str | None = None,
) -> Path:
    if not 1 <= len(upload_ids) <= 10:
        raise ValueError("Batch export accepts between one and ten videos.")
    output_path = RENDER_DIRECTORY / f"{job_id}-batch.zip"
    temporary_path = WORK_DIRECTORY / f"{job_id}.batch.partial.zip"
    rendered_paths: list[Path] = []
    try:
        for index, upload_id in enumerate(upload_ids):
            source_path = find_uploaded_video(upload_id)
            design_parameters = dict(parameters)
            preset = export_preset or ""
            if preset in {"tiktok", "youtube-shorts"}:
                design_parameters["template_ratio"] = "9:16"
            if design_parameters.pop("face_center", False):
                design_parameters["face_center_x"] = estimate_face_center_x(source_path)
            designed_path = apply_video_design(
                f"{job_id}-batch-{index}",
                source_path,
                design_parameters,
            )
            if export_preset:
                try:
                    exported_path = export_video_pro(
                        f"{job_id}-batch-{index}",
                        designed_path,
                        preset=export_preset,
                        render_directory=RENDER_DIRECTORY,
                        work_directory=WORK_DIRECTORY,
                    )
                except Exception:
                    designed_path.unlink(missing_ok=True)
                    raise
                if exported_path != designed_path:
                    designed_path.unlink(missing_ok=True)
                rendered_paths.append(exported_path)
            else:
                rendered_paths.append(designed_path)
        with ZipFile(temporary_path, "w", compression=ZIP_STORED) as archive:
            for index, render_path in enumerate(rendered_paths, start=1):
                archive.write(render_path, arcname=f"video-{index:02d}.mp4")
        temporary_path.replace(output_path)
        return output_path
    except Exception:
        temporary_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)
        raise
    finally:
        for render_path in rendered_paths:
            render_path.unlink(missing_ok=True)


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
            operation = job["operation"]
            parameters = job["parameters"]
            result_text = None
            output_path: Path | None = None
            source_path = None if operation in {
                "image-to-video",
                "batch-export",
                "export-pro-batch",
                "merge-clips",
                "angel-chat",
                "seo-metadata",
                "story-script",
            } else find_uploaded_video(job["upload_id"])
            if operation == "image-to-video":
                image_ids = parameters.get("image_asset_ids", [])
                if not isinstance(image_ids, list):
                    raise RuntimeError("Image-to-video requires a list of uploaded images.")
                image_paths = [find_uploaded_asset(str(asset_id), "image") for asset_id in image_ids]
                output_path = await asyncio.to_thread(
                    create_image_video,
                    job["id"],
                    image_paths,
                    render_directory=RENDER_DIRECTORY,
                    work_directory=WORK_DIRECTORY,
                    duration_seconds=parameters.get("image_duration", 5),
                    motion=parameters.get("image_motion", "zoom-in"),
                )
            elif operation == "batch-export":
                batch_upload_ids = parameters.get("batch_upload_ids", [])
                if not isinstance(batch_upload_ids, list):
                    raise RuntimeError("Batch export requires a list of video uploads.")
                output_path = await asyncio.to_thread(
                    export_batch,
                    job["id"],
                    batch_upload_ids,
                    parameters,
                )
            elif operation == "export-pro-batch":
                batch_upload_ids = parameters.get("batch_upload_ids", [])
                if not isinstance(batch_upload_ids, list):
                    raise RuntimeError("Pro batch export requires a list of video uploads.")
                output_path = await asyncio.to_thread(
                    export_batch,
                    job["id"],
                    batch_upload_ids,
                    parameters,
                    export_preset=parameters.get("export_preset", "tiktok"),
                )
            elif operation == "merge-clips":
                merge_clip_ids = parameters.get("merge_clip_ids", [])
                if not isinstance(merge_clip_ids, list):
                    raise RuntimeError("Merge clips requires an ordered list of uploaded videos.")
                clip_paths = [find_uploaded_video(str(upload_id)) for upload_id in merge_clip_ids]
                output_path = await asyncio.to_thread(
                    merge_clips,
                    job["id"],
                    clip_paths,
                )
            elif operation == "ai-script":
                transcript_segments = await asyncio.to_thread(
                    transcribe_segments,
                    source_path,
                    language=parameters.get("ai_language", "th"),
                    work_directory=WORK_DIRECTORY,
                )
                result_text = await asyncio.to_thread(
                    generate_recap_scenes,
                    transcript_segments,
                    parameters.get("ai_script_seconds", 60),
                )
            elif operation == "subtitle-timing":
                transcript_segments = await asyncio.to_thread(
                    transcribe_segments,
                    source_path,
                    language=parameters.get("ai_language", "th"),
                    work_directory=WORK_DIRECTORY,
                )
                result_text = segments_to_srt(transcript_segments)
            elif operation == "auto-highlights":
                output_path = await asyncio.to_thread(
                    auto_cut_highlights,
                    job["id"],
                    source_path,
                    render_directory=RENDER_DIRECTORY,
                    work_directory=WORK_DIRECTORY,
                    target_seconds=parameters.get("target_seconds", 60),
                )
            elif operation == "angel-chat":
                result_text = await asyncio.to_thread(
                    suggest_editor_changes,
                    parameters.get("ai_prompt", ""),
                    parameters.get("ai_context", ""),
                )
            elif operation == "seo-metadata":
                result_text = await asyncio.to_thread(
                    generate_seo_metadata,
                    parameters.get("ai_script", ""),
                )
            elif operation == "story-script":
                result_text = await asyncio.to_thread(
                    generate_story_script,
                    parameters.get("ai_prompt", ""),
                    parameters.get("story_genre", "drama"),
                    parameters.get("story_chapters", 5),
                )
            elif operation == "export-pro":
                design_parameters = dict(parameters)
                if design_parameters.get("export_preset") in {"tiktok", "youtube-shorts"}:
                    design_parameters["template_ratio"] = "9:16"
                if design_parameters.pop("face_center", False):
                    design_parameters["face_center_x"] = await asyncio.to_thread(
                        estimate_face_center_x,
                        source_path,
                    )
                designed_path = await asyncio.to_thread(
                    apply_video_design,
                    job["id"],
                    source_path,
                    design_parameters,
                )
                try:
                    output_path = await asyncio.to_thread(
                        export_video_pro,
                        job["id"],
                        designed_path,
                        preset=parameters.get("export_preset", "tiktok"),
                        render_directory=RENDER_DIRECTORY,
                        work_directory=WORK_DIRECTORY,
                    )
                finally:
                    designed_path.unlink(missing_ok=True)
            elif operation == "auto-cut-silence":
                output_path = await asyncio.to_thread(
                    auto_cut_silence,
                    job["id"],
                    source_path,
                    render_directory=RENDER_DIRECTORY,
                    work_directory=WORK_DIRECTORY,
                    threshold_db=parameters.get("silence_threshold_db", -40),
                    minimum_silence=parameters.get("minimum_silence", 1.0),
                )
            elif operation in {"magic-resize", "remove-green-screen"}:
                design_parameters = dict(parameters)
                if operation == "remove-green-screen":
                    design_parameters["remove_green_screen"] = True
                if operation == "magic-resize" and design_parameters.pop("face_center", False):
                    design_parameters["face_center_x"] = await asyncio.to_thread(
                        estimate_face_center_x,
                        source_path,
                    )
                output_path = await asyncio.to_thread(
                    apply_video_design,
                    job["id"],
                    source_path,
                    design_parameters,
                )
            elif operation == "export-video":
                output_path = await asyncio.to_thread(
                    apply_video_design,
                    job["id"],
                    source_path,
                    job["parameters"],
                )
            elif operation == "extract-audio":
                output_path = await asyncio.to_thread(extract_audio, job["id"], source_path)
            elif operation == "trim-video":
                output_path = await asyncio.to_thread(
                    trim_video,
                    job["id"],
                    source_path,
                    parameters.get("trim_start_seconds", 0),
                    parameters.get("trim_end_seconds", 0),
                )
            elif operation == "burn-subtitles":
                output_path = await asyncio.to_thread(
                    burn_subtitles,
                    job["id"],
                    source_path,
                    job["parameters"],
                )
            elif operation == "split-video":
                output_path = await asyncio.to_thread(
                    split_video,
                    job["id"],
                    source_path,
                    job["parameters"]["segment_seconds"],
                )
            elif operation == "hide-sub":
                output_path = await asyncio.to_thread(
                    hide_original_subtitles,
                    job["id"],
                    source_path,
                    job["parameters"].get("hide_method", "blur"),
                )
            elif operation in ("create-recap-dub", "transcribe-audio", "script-voiceover"):
                output_path, result_text = await asyncio.to_thread(
                    create_recap_dub,
                    job_id=job["id"],
                    source_path=source_path,
                    subtitle_srt=job["parameters"].get("subtitle_srt"),
                    voice=job["parameters"].get("voice", "my-MM-NilarNeural"),
                    recap_seconds=job["parameters"].get("recap_seconds", 600),
                    include_original_audio=job["parameters"].get("include_original_audio", True),
                    background_volume=job["parameters"].get("background_volume", 20),
                    mode=parameters.get("mode", "recap"),
                    source_language=parameters.get("source_language", "th"),
                    script_text=parameters.get("script_text") if operation == "script-voiceover" else None,
                )
            else:
                raise RuntimeError("Unsupported render operation.")
            if operation in {
                "burn-subtitles",
                "hide-sub",
                "create-recap-dub",
                "transcribe-audio",
                "script-voiceover",
                "auto-cut-silence",
                "image-to-video",
                "auto-highlights",
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
                if operation == "script-voiceover" and parameters.get("subtitle_srt"):
                    designed_output_path = output_path
                    try:
                        output_path = await asyncio.to_thread(
                            burn_subtitles,
                            job["id"],
                            designed_output_path,
                            parameters,
                        )
                    except Exception:
                        designed_output_path.unlink(missing_ok=True)
                        raise
                    designed_output_path.unlink(missing_ok=True)
            update_job(
                job["id"],
                status="completed",
                output_url=f"/renders/{output_path.name}" if output_path is not None else None,
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


def find_uploaded_asset(asset_id: str, kind: Literal["image", "audio"]) -> Path:
    if not re.fullmatch(r"[0-9a-f]{32}", asset_id):
        raise HTTPException(status_code=404, detail="Uploaded asset not found.")
    extensions = (
        {".png", ".jpg", ".jpeg", ".webp"}
        if kind == "image"
        else {".mp3", ".wav", ".m4a", ".aac", ".ogg"}
    )
    for path in ASSET_DIRECTORY.glob(f"{asset_id}.*"):
        if path.suffix.lower() in extensions and path.is_file():
            return path
    raise HTTPException(status_code=404, detail=f"Uploaded {kind} asset not found.")


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


@app.get("/api/fonts")
async def list_render_fonts() -> dict[str, list[dict[str, str]]]:
    return {"fonts": _font_options()}


@app.post("/api/assets", status_code=201)
async def upload_asset(
    file: UploadFile,
    category: Literal["image", "audio"] = Form(...),
) -> dict[str, str | int]:
    extension = Path(file.filename or "").suffix.lower()
    allowed_extensions = (
        {".png", ".jpg", ".jpeg", ".webp"}
        if category == "image"
        else {".mp3", ".wav", ".m4a", ".aac", ".ogg"}
    )
    max_size = 25 * 1024 * 1024 if category == "image" else 100 * 1024 * 1024
    if extension not in allowed_extensions:
        raise HTTPException(status_code=415, detail=f"Unsupported {category} file format.")
    if file.size is not None and file.size > max_size:
        raise HTTPException(status_code=413, detail=f"{category.title()} files exceed the upload limit.")

    asset_id = uuid.uuid4().hex
    temporary_path = ASSET_DIRECTORY / f"{asset_id}.upload"
    final_path = ASSET_DIRECTORY / f"{asset_id}{extension}"
    saved_size = 0
    try:
        with temporary_path.open("xb") as destination:
            while chunk := await file.read(CHUNK_SIZE):
                saved_size += len(chunk)
                if saved_size > max_size:
                    raise HTTPException(status_code=413, detail=f"{category.title()} files exceed the upload limit.")
                destination.write(chunk)
        if saved_size == 0:
            raise HTTPException(status_code=400, detail="Empty files cannot be uploaded.")
        if category == "image":
            try:
                with Image.open(temporary_path) as image:
                    image.verify()
            except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as error:
                raise HTTPException(status_code=415, detail="The uploaded file is not a valid supported image.") from error
        else:
            probe = subprocess.run(
                [imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-i", str(temporary_path)],
                capture_output=True,
                text=True,
                check=False,
            )
            if not any("Audio:" in line for line in probe.stderr.splitlines()):
                raise HTTPException(status_code=415, detail="The uploaded file does not contain a supported audio stream.")
        temporary_path.replace(final_path)
    except HTTPException:
        temporary_path.unlink(missing_ok=True)
        raise
    except OSError as error:
        temporary_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Could not store the uploaded asset.") from error
    finally:
        await file.close()

    return {
        "id": asset_id,
        "filename": Path(file.filename or "").name,
        "size_bytes": saved_size,
        "asset_url": f"/assets/{final_path.name}",
        "category": category,
    }


@app.post("/api/jobs", status_code=202)
async def create_render_job(
    request: CreateRenderJobRequest,
) -> dict[str, str | None]:
    if request.operation == "image-to-video":
        if not request.image_asset_ids:
            raise HTTPException(status_code=422, detail="Upload at least one image to create a video.")
        for asset_id in request.image_asset_ids:
            find_uploaded_asset(asset_id, "image")
    elif request.operation in {"batch-export", "export-pro-batch"}:
        if not request.batch_upload_ids:
            raise HTTPException(status_code=422, detail="Choose at least one video for batch export.")
        if len(set(request.batch_upload_ids)) != len(request.batch_upload_ids):
            raise HTTPException(status_code=422, detail="Batch video selections must be unique.")
        for upload_id in request.batch_upload_ids:
            find_uploaded_video(upload_id)
    elif request.operation == "merge-clips":
        if not 2 <= len(request.merge_clip_ids) <= 10:
            raise HTTPException(status_code=422, detail="Choose between two and ten clips to merge.")
        if len(set(request.merge_clip_ids)) != len(request.merge_clip_ids):
            raise HTTPException(status_code=422, detail="Merge clip selections must be unique.")
        for upload_id in request.merge_clip_ids:
            find_uploaded_video(upload_id)
    elif request.operation in {"angel-chat", "seo-metadata", "story-script"}:
        if request.operation == "angel-chat" and not request.ai_prompt.strip():
            raise HTTPException(status_code=422, detail="Enter an Angel chat prompt.")
        if request.operation == "seo-metadata" and not request.ai_script.strip():
            raise HTTPException(status_code=422, detail="Enter a script before generating metadata.")
        if request.operation == "story-script" and not request.ai_prompt.strip():
            raise HTTPException(status_code=422, detail="Enter a story idea before generating a script.")
    else:
        if not request.upload_id or request.upload_id == "0" * 32:
            raise HTTPException(status_code=422, detail="Upload a video before starting this operation.")
        find_uploaded_video(request.upload_id)

    if request.operation == "script-voiceover":
        if not request.script_text.strip():
            raise HTTPException(status_code=422, detail="Enter the Burmese narration script to speak.")
        if not request.subtitle_srt or "-->" not in request.subtitle_srt:
            raise HTTPException(status_code=422, detail="SRT subtitle text with timecodes is required.")

    if request.logo_asset_id:
        find_uploaded_asset(request.logo_asset_id, "image")
    if request.bgm_asset_id:
        find_uploaded_asset(request.bgm_asset_id, "audio")
    for effect in request.sound_effects:
        find_uploaded_asset(effect.asset_id, "audio")

    if request.operation == "burn-subtitles" and (
        not request.subtitle_srt or "-->" not in request.subtitle_srt
    ):
        raise HTTPException(status_code=422, detail="SRT subtitle text with timecodes is required.")
    if request.operation == "trim-video" and request.trim_end_seconds <= request.trim_start_seconds:
        raise HTTPException(status_code=422, detail="The trim end time must be after the start time.")

    job_id = uuid.uuid4().hex
    parameters = request.model_dump(
        exclude={"upload_id", "operation"},
        exclude_none=True,
    )
    return public_job(create_job(
        job_id,
        request.upload_id or "0" * 32,
        request.operation,
        parameters,
    ))


@app.post("/api/uploads/from-merge/{job_id}", status_code=201)
@app.post("/api/uploads/from-render/{job_id}", status_code=201)
async def upload_rendered_video_as_source(job_id: str) -> dict[str, str | int]:
    job = get_job(job_id)
    if job is None or job["operation"] not in {"merge-clips", "trim-video"} or job["status"] != "completed":
        raise HTTPException(status_code=404, detail="A completed trim or merge job was not found.")
    output_url = job.get("output_url")
    if not isinstance(output_url, str) or not output_url.startswith("/renders/"):
        raise HTTPException(status_code=404, detail="The rendered video output is unavailable.")
    output_path = RENDER_DIRECTORY / Path(output_url).name
    if output_path.resolve().parent != RENDER_DIRECTORY.resolve() or output_path.suffix.lower() != ".mp4":
        raise HTTPException(status_code=404, detail="The rendered video output is invalid.")
    if not output_path.is_file():
        raise HTTPException(status_code=404, detail="The rendered video output is unavailable.")
    if output_path.stat().st_size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The merged video exceeds the 2 GB source limit.")

    upload_id = uuid.uuid4().hex
    destination_path = UPLOAD_DIRECTORY / f"{upload_id}.mp4"
    try:
        await asyncio.to_thread(shutil.copyfile, output_path, destination_path)
    except OSError as error:
        destination_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Could not prepare the rendered video for editing.") from error
    return {
        "id": upload_id,
        "filename": f"{upload_id}.mp4",
        "size": destination_path.stat().st_size,
        "media_url": f"/media/{destination_path.name}",
    }


@app.get("/api/jobs/{job_id}")
async def get_render_job(job_id: str) -> dict[str, str | None]:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Render job not found.")
    return public_job(job)