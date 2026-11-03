from __future__ import annotations

import re
import subprocess
from pathlib import Path

import imageio_ffmpeg


def estimate_face_center_x(source_path: Path) -> float:
    try:
        import cv2
    except ImportError as error:
        raise RuntimeError(
            "Face-centered resize needs OpenCV. Install the optional backend/requirements-magic.txt dependencies."
        ) from error

    capture = cv2.VideoCapture(str(source_path))
    if not capture.isOpened():
        raise RuntimeError("OpenCV could not open the uploaded video for face detection.")
    classifier = cv2.CascadeClassifier(
        str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml")
    )
    centers: list[float] = []
    try:
        fps = capture.get(cv2.CAP_PROP_FPS) or 30
        frame_count = capture.get(cv2.CAP_PROP_FRAME_COUNT)
        sample_count = min(60, max(1, int(frame_count // max(1, round(fps)))))
        frame_indices = [round(index * frame_count / sample_count) for index in range(sample_count)]
        for frame_index in frame_indices:
            capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            succeeded, frame = capture.read()
            if not succeeded:
                continue
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = classifier.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40))
            if len(faces):
                largest = max(faces, key=lambda face: face[2] * face[3])
                centers.append((largest[0] + largest[2] / 2) / frame.shape[1])
        if not centers:
            raise RuntimeError("No face was detected. Disable face-centered resize or choose a different clip.")
        return sum(centers) / len(centers)
    finally:
        capture.release()


def _has_audio(source_path: Path) -> bool:
    probe = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-i", str(source_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    return any("Audio:" in line and re.search(r"Stream #\d+:\d+", line) for line in probe.stderr.splitlines())


def auto_cut_silence(
    job_id: str,
    source_path: Path,
    *,
    render_directory: Path,
    work_directory: Path,
    threshold_db: int = -40,
    minimum_silence: float = 1.0,
) -> Path:
    if not _has_audio(source_path):
        raise RuntimeError("Auto Cut Silence requires a source video with an audio track.")

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    detection = subprocess.run(
        [
            ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-i",
            str(source_path),
            "-af",
            f"silencedetect=noise={threshold_db}dB:d={minimum_silence}",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        timeout=4 * 60 * 60,
        check=False,
    )
    if detection.returncode != 0:
        raise RuntimeError(detection.stderr.strip()[-1000:] or "FFmpeg could not analyze source silence.")

    silences: list[tuple[float, float]] = []
    start: float | None = None
    for line in detection.stderr.splitlines():
        start_match = re.search(r"silence_start:\s*(-?\d+(?:\.\d+)?)", line)
        end_match = re.search(r"silence_end:\s*(-?\d+(?:\.\d+)?)", line)
        if start_match:
            start = max(0.0, float(start_match.group(1)))
        if end_match and start is not None:
            end = max(start, float(end_match.group(1)))
            if end - start >= minimum_silence:
                silences.append((start, end))
            start = None

    duration_match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", detection.stderr)
    if not duration_match:
        raise RuntimeError("FFmpeg could not determine the source duration.")
    hours, minutes, seconds = duration_match.groups()
    duration = int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    if start is not None and duration - start >= minimum_silence:
        silences.append((start, duration))

    kept: list[tuple[float, float]] = []
    cursor = 0.0
    for silence_start, silence_end in silences:
        silence_start = min(duration, silence_start)
        silence_end = min(duration, silence_end)
        if silence_start > cursor:
            kept.append((cursor, silence_start))
        cursor = max(cursor, silence_end)
    if cursor < duration:
        kept.append((cursor, duration))
    if not silences:
        raise RuntimeError("No silence longer than one second was detected.")
    if not kept:
        raise RuntimeError("The source contains no audible segments to keep.")

    output = render_directory / f"{job_id}-silence-cut.mp4"
    temporary = work_directory / f"{job_id}.silence.partial.mp4"
    segments: list[str] = []
    for index, (clip_start, clip_end) in enumerate(kept):
        segments.append(
            f"[0:v]trim=start={clip_start:.6f}:end={clip_end:.6f},setpts=PTS-STARTPTS[v{index}]"
        )
        segments.append(
            f"[0:a:0]atrim=start={clip_start:.6f}:end={clip_end:.6f},asetpts=PTS-STARTPTS[a{index}]"
        )
    segment_labels = "".join(f"[v{index}][a{index}]" for index in range(len(kept)))
    segments.append(f"{segment_labels}concat=n={len(kept)}:v=1:a=1[outv][outa]")

    result = subprocess.run(
        [
            ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source_path),
            "-filter_complex",
            ";".join(segments),
            "-map",
            "[outv]",
            "-map",
            "[outa]",
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
            str(temporary),
        ],
        capture_output=True,
        text=True,
        timeout=4 * 60 * 60,
        check=False,
    )
    if result.returncode != 0:
        temporary.unlink(missing_ok=True)
        raise RuntimeError(result.stderr.strip()[-1000:] or "FFmpeg could not remove silent sections.")
    temporary.replace(output)
    return output


def create_image_video(
    job_id: str,
    image_paths: list[Path],
    *,
    render_directory: Path,
    work_directory: Path,
    duration_seconds: int = 5,
    motion: str = "zoom-in",
) -> Path:
    if not 1 <= len(image_paths) <= 10:
        raise ValueError("Choose between one and ten images.")
    if not 3 <= duration_seconds <= 10:
        raise ValueError("Image video duration must be between 3 and 10 seconds per image.")

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    segments: list[Path] = []
    try:
        for index, image_path in enumerate(image_paths):
            segment = work_directory / f"{job_id}.image-{index:02d}.mp4"
            zoom = {
                "zoom-out": "if(lte(zoom,1),1.08,max(1.0,zoom-0.0015))",
                "pan-left": "1.04",
                "pan-right": "1.04",
                "zoom-in": "min(zoom+0.0015,1.08)",
                "zoom-pan": "min(zoom+0.0015,1.08)",
            }.get(motion)
            if zoom is None:
                raise ValueError("Choose a supported image motion preset.")
            if motion == "pan-left":
                x_position = f"min(iw-iw/zoom,(iw-iw/zoom)*on/{duration_seconds * 30})"
            elif motion == "pan-right":
                x_position = f"max(0,(iw-iw/zoom)*(1-on/{duration_seconds * 30}))"
            else:
                x_position = "iw/2-(iw/zoom/2)"
            graph = (
                "scale=1920:1080:force_original_aspect_ratio=increase,"
                "crop=1920:1080,"
                f"zoompan=z='{zoom}':x='{x_position}':y='ih/2-(ih/zoom/2)':"
                f"d=1:s=1920x1080:fps=30,trim=duration={duration_seconds},setpts=PTS-STARTPTS"
            )
            result = subprocess.run(
                [
                    ffmpeg,
                    "-nostdin",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-loop",
                    "1",
                    "-framerate",
                    "30",
                    "-t",
                    str(duration_seconds),
                    "-i",
                    str(image_path),
                    "-vf",
                    graph,
                    "-an",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "22",
                    "-pix_fmt",
                    "yuv420p",
                    "-movflags",
                    "+faststart",
                    str(segment),
                ],
                capture_output=True,
                text=True,
                timeout=4 * 60 * 60,
                check=False,
            )
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip()[-1000:] or "FFmpeg could not animate an image.")
            segments.append(segment)

        concat_file = work_directory / f"{job_id}.images.txt"
        concat_file.write_text(
            "".join(f"file '{path.resolve().as_posix()}'\n" for path in segments),
            encoding="utf-8",
        )
        temporary = work_directory / f"{job_id}.images.partial.mp4"
        output = render_directory / f"{job_id}-images.mp4"
        result = subprocess.run(
            [
                ffmpeg,
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(concat_file),
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                str(temporary),
            ],
            capture_output=True,
            text=True,
            timeout=4 * 60 * 60,
            check=False,
        )
        concat_file.unlink(missing_ok=True)
        if result.returncode != 0:
            temporary.unlink(missing_ok=True)
            raise RuntimeError(result.stderr.strip()[-1000:] or "FFmpeg could not join the image clips.")
        temporary.replace(output)
        return output
    finally:
        for segment in segments:
            segment.unlink(missing_ok=True)
