from __future__ import annotations

from array import array
import json
import math
import re
import subprocess
from pathlib import Path
from typing import Any

import imageio_ffmpeg

from backend.ai_providers import ProviderError, _chat_client, _chat_model
from backend.voiceover import get_whisper_model


def _extract_audio(source_path: Path, audio_path: Path) -> None:
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
            str(audio_path),
        ],
        capture_output=True,
        text=True,
        timeout=4 * 60 * 60,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip()[-1000:] or "Could not extract audio for AI analysis.")


def transcribe_segments(
    source_path: Path,
    *,
    language: str = "th",
    work_directory: Path,
) -> list[dict[str, float | str]]:
    audio_path = work_directory / f"{source_path.stem}.ai-transcription.wav"
    try:
        _extract_audio(source_path, audio_path)
        segments, _ = get_whisper_model().transcribe(
            str(audio_path),
            beam_size=5,
            language=language,
            word_timestamps=False,
        )
        result = [
            {
                "start": max(0.0, float(segment.start)),
                "end": max(float(segment.start), float(segment.end)),
                "text": segment.text.strip(),
            }
            for segment in segments
            if segment.text.strip()
        ]
        if not result:
            raise RuntimeError("Whisper did not recognize any speech in the selected video.")
        return result
    finally:
        audio_path.unlink(missing_ok=True)


def _chat_json(system_prompt: str, user_prompt: str) -> dict[str, Any]:
    try:
        response = _chat_client().chat.completions.create(
            model=_chat_model(),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.4,
            response_format={"type": "json_object"},
        )
    except Exception as error:
        raise ProviderError(f"AI generation failed: {error}") from error
    content = response.choices[0].message.content
    if not content or not content.strip():
        raise ProviderError("The configured AI provider returned an empty response.")
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as error:
        raise ProviderError("The AI provider returned invalid JSON.") from error
    if not isinstance(parsed, dict):
        raise ProviderError("The AI provider returned an unexpected JSON shape.")
    return parsed


def generate_recap_scenes(
    transcript_segments: list[dict[str, float | str]],
    duration_seconds: int,
) -> str:
    transcript = " ".join(str(segment["text"]) for segment in transcript_segments).strip()
    if not transcript:
        raise ProviderError("No transcript text is available to summarize.")
    response = _chat_json(
        "You write accurate, engaging Myanmar-language drama recaps. Return JSON with a scenes array of exactly five objects; each object has start, end, text, and emotion. Do not invent plot details.",
        (
            f"Write a {duration_seconds}-second Burmese recap in five consecutive scenes based only on this transcript. "
            f"Use seconds for start/end; cover 0 to {duration_seconds} without gaps or overlaps. "
            "Use concise natural Burmese and one short emotion label per scene. "
            f"Transcript:\n{transcript[:30000]}"
        ),
    )
    scenes = response.get("scenes")
    if not isinstance(scenes, list) or len(scenes) != 5:
        raise ProviderError("The AI provider must return exactly five recap scenes.")

    normalized: list[dict[str, int | float | str]] = []
    previous_end = 0.0
    for scene in scenes:
        if not isinstance(scene, dict):
            raise ProviderError("A recap scene must be a JSON object.")
        text = scene.get("text")
        emotion = scene.get("emotion")
        try:
            start = float(scene["start"])
            end = float(scene["end"])
        except (KeyError, TypeError, ValueError) as error:
            raise ProviderError("Each recap scene needs numeric start and end times.") from error
        if (
            not isinstance(text, str)
            or not text.strip()
            or not isinstance(emotion, str)
            or not math.isfinite(start)
            or not math.isfinite(end)
            or abs(start - previous_end) > 0.001
            or end <= start
            or end > duration_seconds
        ):
            raise ProviderError("The AI provider returned invalid recap scene content or timing.")
        normalized.append(
            {"start": start, "end": end, "text": text.strip(), "emotion": emotion.strip()[:40]}
        )
        previous_end = end
    if normalized[0]["start"] != 0 or normalized[-1]["end"] != duration_seconds:
        raise ProviderError("Recap scenes must cover the requested duration.")
    return json.dumps({"scenes": normalized}, ensure_ascii=False)


def _srt_timestamp(seconds: float) -> str:
    milliseconds = round(max(0.0, seconds) * 1000)
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, milliseconds = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{whole_seconds:02},{milliseconds:03}"


def segments_to_srt(segments: list[dict[str, float | str]]) -> str:
    if not segments:
        raise ValueError("No timed speech segments were provided.")
    cues: list[str] = []
    previous_end = 0.0
    for index, segment in enumerate(segments, start=1):
        text = str(segment["text"]).strip()
        start = max(previous_end, float(segment["start"]))
        end = float(segment["end"])
        if not text or end <= start:
            continue
        cues.append(f"{index}\n{_srt_timestamp(start)} --> {_srt_timestamp(end)}\n{text}")
        previous_end = end
    if not cues:
        raise ValueError("No valid timed speech segments were provided.")
    return "\n\n".join(cues) + "\n"


def generate_seo_metadata(script: str) -> str:
    if not script.strip():
        raise ProviderError("Enter a recap script before generating title and description.")
    response = _chat_json(
        "You create accurate YouTube metadata for Myanmar drama recap videos. Return JSON with string fields title and description and a hashtags array of three to eight strings. Do not invent story facts.",
        f"Create concise Burmese YouTube metadata for this recap script:\n{script.strip()[:12000]}",
    )
    title = response.get("title")
    description = response.get("description")
    hashtags = response.get("hashtags")
    if (
        not isinstance(title, str)
        or not title.strip()
        or len(title) > 120
        or not isinstance(description, str)
        or not description.strip()
        or not isinstance(hashtags, list)
        or not 3 <= len(hashtags) <= 8
        or any(not isinstance(tag, str) or not re.fullmatch(r"#[\w-]{2,50}", tag) for tag in hashtags)
    ):
        raise ProviderError("The AI provider returned invalid title, description, or hashtag fields.")
    return json.dumps(
        {
            "title": title.strip(),
            "description": description.strip(),
            "hashtags": hashtags,
        },
        ensure_ascii=False,
    )


def suggest_editor_changes(prompt: str, context: str = "") -> str:
    if not prompt.strip():
        raise ProviderError("Enter a request for Angel before asking for suggestions.")
    try:
        response = _chat_client().chat.completions.create(
            model=_chat_model(),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are Angel, a concise assistant for a Myanmar video editor. Suggest only actions available "
                        "in RecapKit: aspect ratios 16:9, 9:16, 1:1; text animations none, fade, slide, pop, typewriter; "
                        "11 built-in overlay kinds; user-uploaded music; brand colors/fonts; export presets. "
                        "Do not claim access to Kubota manuals or private knowledge bases."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Editor context:\n{context[:4000]}\n\nRequest:\n{prompt.strip()[:2000]}",
                },
            ],
            temperature=0.4,
        )
    except Exception as error:
        raise ProviderError(f"Angel suggestions failed: {error}") from error
    content = response.choices[0].message.content
    if not content or not content.strip():
        raise ProviderError("Angel returned an empty suggestion.")
    return content.strip()


def generate_story_script(idea: str, genre: str, chapter_count: int) -> str:
    if not idea.strip():
        raise ProviderError("Enter a story idea before generating a script.")
    if len(idea) > 2000 or len(genre) > 40 or not 3 <= chapter_count <= 12:
        raise ProviderError("Story details are outside the supported limits.")
    try:
        response = _chat_client().chat.completions.create(
            model=_chat_model(),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a Myanmar-language screenwriter. Create an original fictional story, not a recap "
                        "or adaptation of an existing copyrighted work. Write natural Burmese in Myanmar Unicode. "
                        "Return the requested number of chapters. For each chapter include a short title, a concise "
                        "narration/script, and a visual description that a creator could use to prepare a scene. "
                        "Do not claim to generate images, audio, or video."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Genre: {genre.strip() or 'drama'}\n"
                        f"Number of chapters: {chapter_count}\n"
                        f"Story idea:\n{idea.strip()}"
                    ),
                },
            ],
            temperature=0.7,
            max_tokens=min(450 * chapter_count, 4000),
        )
    except Exception as error:
        raise ProviderError(f"Story script generation failed: {error}") from error
    content = response.choices[0].message.content
    if not content or not content.strip():
        raise ProviderError("The AI provider returned an empty story script.")
    return content.strip()


def auto_cut_highlights(
    job_id: str,
    source_path: Path,
    *,
    render_directory: Path,
    work_directory: Path,
    target_seconds: int = 60,
) -> Path:
    if not 15 <= target_seconds <= 60:
        raise ValueError("Highlight duration must be between 15 and 60 seconds.")
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    duration_probe = subprocess.run(
        [ffmpeg, "-hide_banner", "-i", str(source_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    duration_match = re.search(
        r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)",
        duration_probe.stderr,
    )
    if not duration_match:
        raise RuntimeError("FFmpeg could not determine the video duration.")
    hours, minutes, seconds = duration_match.groups()
    duration = int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    sample_rate = 4000
    pcm = subprocess.run(
        [
            ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(source_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-f",
            "s16le",
            "pipe:1",
        ],
        capture_output=True,
        check=False,
    )
    if pcm.returncode != 0 or not pcm.stdout:
        raise RuntimeError(pcm.stderr.decode(errors="replace")[-1000:] or "Audio is required to score highlights.")

    samples_per_second = sample_rate
    total_samples = len(pcm.stdout) // 2
    scores: list[float] = []
    for second in range(math.ceil(min(duration, total_samples / sample_rate))):
        start = second * samples_per_second * 2
        end = min(len(pcm.stdout), start + samples_per_second * 2)
        chunk = pcm.stdout[start:end]
        if len(chunk) < 2:
            break
        sample_count = len(chunk) // 2
        square_sum = sum(sample * sample for sample in array("h", chunk[: sample_count * 2]))
        scores.append(math.sqrt(square_sum / sample_count))

    clip_seconds = min(12, max(3, target_seconds / 5), duration)
    if clip_seconds <= 0:
        raise RuntimeError("The uploaded video has no usable duration.")
    candidate_count = max(1, math.ceil(target_seconds / clip_seconds))
    candidates = range(max(1, math.floor(duration - clip_seconds) + 1))
    ranked = sorted(candidates, key=lambda start: sum(scores[start : start + clip_seconds]), reverse=True)
    chosen: list[int] = []
    for start in ranked:
        if all(abs(start - current) >= clip_seconds for current in chosen):
            chosen.append(start)
            if len(chosen) == candidate_count:
                break
    if not chosen:
        raise RuntimeError("No usable audio segments were found for highlight selection.")
    intervals = [(float(start), min(float(start + clip_seconds), duration)) for start in sorted(chosen)]
    remaining = float(target_seconds)
    trimmed: list[tuple[float, float]] = []
    for start, end in intervals:
        length = min(end - start, remaining)
        if length > 0:
            trimmed.append((start, start + length))
            remaining -= length
        if remaining <= 0:
            break

    filters: list[str] = []
    labels = ""
    for index, (start, end) in enumerate(trimmed):
        filters.append(
            f"[0:v]trim=start={start:.3f}:end={end:.3f},setpts=PTS-STARTPTS[v{index}]"
        )
        filters.append(
            f"[0:a:0]atrim=start={start:.3f}:end={end:.3f},asetpts=PTS-STARTPTS[a{index}]"
        )
        labels += f"[v{index}][a{index}]"
    filters.append(f"{labels}concat=n={len(trimmed)}:v=1:a=1[outv][outa]")
    output = render_directory / f"{job_id}-highlights.mp4"
    temporary = work_directory / f"{job_id}.highlights.partial.mp4"
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
            ";".join(filters),
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
        raise RuntimeError(result.stderr.strip()[-1000:] or "FFmpeg could not create the highlight reel.")
    temporary.replace(output)
    return output
