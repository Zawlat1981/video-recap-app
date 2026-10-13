import subprocess
import re
from pathlib import Path
import imageio_ffmpeg
from faster_whisper import WhisperModel
from gtts import gTTS

STORAGE_DIRECTORY = Path(__file__).resolve().parent / "storage"
WORK_DIRECTORY = STORAGE_DIRECTORY / "working"
RENDER_DIRECTORY = STORAGE_DIRECTORY / "renders"

# Local Whisper Model ကို ဖွင့်ထားခြင်း (CPU ဖြင့် အလုပ်လုပ်မည်)
print("Loading Local Whisper Model for Voiceover pipeline...")
whisper_model = WhisperModel("base", device="cpu", compute_type="int8")


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


def transcribe_burmese_audio(audio_path: Path) -> str:
    """Local Faster-Whisper ကိုသုံးပြီး အသံဖိုင်မှ စာသားအပြည့်အစုံ ထုတ်ယူခြင်း"""
    segments, _ = whisper_model.transcribe(str(audio_path), beam_size=5)
    texts = [segment.text for segment in segments]
    return " ".join(texts)


def generate_burmese_recap(transcript: str, recap_seconds: int) -> str:
    """
    သတ်မှတ်ထားသော recap_seconds (ဥပမာ- 10 မိနစ် = 600 စက္ကန့်) နှင့် 
    ကိုက်ညီစေရန် စာသားများကို လုံလောက်စွာ ထိန်းသိမ်းပေးခြင်း
    """
    if not transcript.strip():
        return "ဇာတ်လမ်းအကျဉ်းချုပ်မရှိပါ။"
    
    # စာလုံးရေအနည်းအများပေါ်မူတည်ပြီး အချိန်အဆနှင့် ချိန်ညှိခြင်း (၁ မိနစ်လျှင် ခန့်မှန်းခြေ စာလုံးရေ ၁၅၀-၂၀၀)
    target_length = max(1000, recap_seconds * 15) 
    
    if len(transcript) > target_length:
        return transcript[:target_length]
    else:
        # အကယ်၍ မူရင်းစာသားက တိုနေပါက အချိန်အဆပြည့် تر ပမာဏထိ ထပ်တိုးပေးခြင်း
        multiplier = (target_length // len(transcript)) + 1
        return (transcript + " ") * multiplier


def synthesize_burmese_voice(script: str, voice: str) -> bytes:
    """gTTS ကိုသုံးပြီး မြန်မာစာသားမှ အသံဖိုင် (bytes) ထုတ်လုပ်ခြင်း"""
    temp_audio_path = WORK_DIRECTORY / f"temp_tts_{Path.cwd().name}.mp3"
    
    # စာသားများများပါလာပါက အပိုင်းလိုက်ခွဲ၍ gTTS ဖြင့် သိမ်းဆည်းနိုင်သည် (သို့မဟုတ် တပြိုင်နက်တည်း)
    tts = gTTS(text=script[:5000], lang='my', slow=False)
    tts.save(str(temp_audio_path))
    
    audio_bytes = temp_audio_path.read_bytes()
    temp_audio_path.unlink(missing_ok=True)
    return audio_bytes


def create_recap_dub(
    job_id: str,
    source_path: Path,
    *,
    subtitle_srt: str | None,
    voice: str,
    recap_seconds: int,
    include_original_audio: bool,
    background_volume: int,
) -> tuple[Path, str]:
    transcript = srt_to_plain_text(subtitle_srt or "")
    transcription_audio: Path | None = None
    if not transcript:
        transcription_audio = _extract_transcription_audio(job_id, source_path)
        try:
            transcript = transcribe_burmese_audio(transcription_audio)
        finally:
            transcription_audio.unlink(missing_ok=True)

    # recap_seconds (ဥပမာ 600 စက္ကန့် / ၁၀ မိနစ်) ကို ထည့်သွင်းတွက်ချက်မည်
    script = generate_burmese_recap(transcript, recap_seconds)
    voice_path = WORK_DIRECTORY / f"{job_id}.voice.mp3"
    temporary_path = WORK_DIRECTORY / f"{job_id}.partial.mp4"
    output_path = RENDER_DIRECTORY / f"{job_id}-recap.mp4"
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