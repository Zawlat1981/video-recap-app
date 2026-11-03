from __future__ import annotations

import subprocess
from pathlib import Path

import imageio_ffmpeg


EXPORT_PRESETS: dict[str, tuple[int, int, int, int, int | None]] = {
    "youtube-1080": (1920, 1080, 8_000_000, 30, None),
    "youtube-4k": (3840, 2160, 35_000_000, 30, None),
    "tiktok": (1080, 1920, 6_000_000, 30, 60),
    "youtube-shorts": (1080, 1920, 6_000_000, 30, 60),
    "instagram-square": (1080, 1080, 8_000_000, 30, None),
    "facebook-portrait": (1080, 1350, 8_000_000, 30, None),
}


def export_video(
    job_id: str,
    source_path: Path,
    *,
    preset: str,
    render_directory: Path,
    work_directory: Path,
) -> Path:
    if preset not in EXPORT_PRESETS:
        raise ValueError("Choose a supported export preset.")
    width, height, bitrate, frame_rate, max_duration = EXPORT_PRESETS[preset]
    output = render_directory / f"{job_id}-{preset}.mp4"
    temporary = work_directory / f"{job_id}.{preset}.partial.mp4"
    scale_crop = (
        f"scale={width}:{height}:force_original_aspect_ratio=increase:flags=lanczos,"
        f"crop={width}:{height},setsar=1"
    )
    command = [
        imageio_ffmpeg.get_ffmpeg_exe(),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source_path),
        "-vf",
        scale_crop,
        "-r",
        str(frame_rate),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-b:v",
        str(bitrate),
        "-maxrate",
        str(bitrate),
        "-bufsize",
        str(bitrate * 2),
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
    ]
    if max_duration is not None:
        command.extend(["-t", str(max_duration)])
    command.append(str(temporary))
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=4 * 60 * 60,
        check=False,
    )
    if result.returncode != 0:
        temporary.unlink(missing_ok=True)
        raise RuntimeError(result.stderr.strip()[-1000:] or "FFmpeg could not create the selected export preset.")
    temporary.replace(output)
    return output
