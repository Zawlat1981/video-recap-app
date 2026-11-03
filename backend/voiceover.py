import os
import subprocess
import re
from pathlib import Path
from typing import Literal
import imageio_ffmpeg
from faster_whisper import WhisperModel
from backend.ai_providers import (
    generate_burmese_recap as generate_recap_script,
    synthesize_burmese_voice as synthesize_voice,
    translate_to_burmese,
)

STORAGE_DIRECTORY = Path(__file__).resolve().parent / "storage"
WORK_DIRECTORY = STORAGE_DIRECTORY / "working"
RENDER_DIRECTORY = STORAGE_DIRECTORY / "renders"

whisper_model: WhisperModel | None = None


def get_whisper_model() -> WhisperModel:
    global whisper_model
    if whisper_model is None:
        whisper_model = WhisperModel(
            os.getenv("WHISPER_MODEL_SIZE", "base"),
            device="cpu",
            compute_type="int8",
        )
    return whisper_model


def _has_audio_stream(source_path: Path) -> bool:
    probe = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-i", str(source_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    return any(
        "Audio:" in line and re.search(r"Stream #\d+:\d+", line)
        for line in probe.stderr.splitlines()
    )


def srt_to_plain_text(subtitle_srt: str) -> str:
    lines: list[str] = []
    for line in subtitle_srt.splitlines():
        stripped = line.strip()
        if not stripped or stripped.isdigit() or "-->" in stripped or stripped.upper() == "WEBVTT":
            continue
        if stripped.startswith(("NOTE ", "STYLE")):
            continue
        lines.append(stripped)
    return " ".join(lines)


def _extract_transcription_audio(job_id: str, source_path: Path) -> Path:
    audio_path = WORK_DIRECTORY / f"{job_id}.transcription.mp3"
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
            "-ac",
            "1",
            "-ar",
            "16000",
            "-b:a",
            "48k",
            str(audio_path),
        ],
        capture_output=True,
        text=True,
        timeout=4 * 60 * 60,
        check=False,
    )
    if result.returncode != 0:
        audio_path.unlink(missing_ok=True)
        raise RuntimeError(result.stderr.strip()[-1000:] or "Could not prepare audio for transcription.")
    return audio_path


def transcribe_audio(audio_path: Path, language: str) -> str:
    if not audio_path.exists():
        raise RuntimeError(f"Audio file not found: {audio_path}")
    segments, _ = get_whisper_model().transcribe(str(audio_path), beam_size=5, language=language)
    transcript = " ".join(segment.text.strip() for segment in segments if segment.text.strip())
    if not transcript:
        raise RuntimeError(f"Whisper did not recognize any {language} speech.")
    return transcript


def transcribe_burmese_audio(audio_path: Path) -> str:
    return transcribe_audio(audio_path, language="my")


def generate_burmese_recap(transcript: str, recap_seconds: int) -> str:
    return generate_recap_script(transcript, recap_seconds)


def synthesize_burmese_voice(script: str, voice: str) -> bytes:
    return synthesize_voice(script, voice)


def create_recap_dub(
    job_id: str,
    source_path: Path,
    *,
    subtitle_srt: str | None,
    voice: str,
    recap_seconds: int,
    include_original_audio: bool,
    background_volume: int,
    mode: Literal["recap", "dubbing"] = "recap",
) -> tuple[Path, str]:
    transcript = srt_to_plain_text(subtitle_srt or "")
    transcription_audio: Path | None = None
    if not transcript:
        transcription_audio = _extract_transcription_audio(job_id, source_path)
        try:
            transcript = transcribe_audio(
                transcription_audio,
                language="th" if mode == "dubbing" else "my",
            )
        finally:
            transcription_audio.unlink(missing_ok=True)

    script = (
        translate_to_burmese(transcript)
        if mode == "dubbing"
        else generate_burmese_recap(transcript, recap_seconds)
    )
    voice_path = WORK_DIRECTORY / f"{job_id}.voice.mp3"
    temporary_path = WORK_DIRECTORY / f"{job_id}.partial.mp4"
    output_path = RENDER_DIRECTORY / f"{job_id}-{mode}.mp4"
    mix_original_audio = include_original_audio and _has_audio_stream(source_path)

    try:
        voice_path.write_bytes(synthesize_burmese_voice(script, voice))
        if mix_original_audio:
            audio_filter = (
                f"[0:a:0]volume={background_volume / 100},apad[background];"
                "[1:a:0]apad[voice];"
                "[background][voice]amix=inputs=2:duration=first:dropout_transition=2[aout]"
            )
        else:
            audio_filter = "[1:a:0]apad[voice]"
            
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
                "-i",
                str(voice_path),
                "-filter_complex",
                audio_filter,
                "-map",
                "0:v:0",
                "-map",
                "[aout]" if mix_original_audio else "[voice]",
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
            ],
            capture_output=True,
            text=True,
            timeout=4 * 60 * 60,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip()[-1000:] or "FFmpeg could not render the Burmese voiceover.")
        temporary_path.replace(output_path)
        return output_path, script
    except Exception:
        temporary_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)
        raise
    finally:
        voice_path.unlink(missing_ok=True)