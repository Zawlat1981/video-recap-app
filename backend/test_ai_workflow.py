import asyncio
import os
import sqlite3
import subprocess
import tempfile
import unittest
import uuid
from contextlib import closing
from pathlib import Path
from unittest.mock import Mock, patch

import imageio_ffmpeg

from backend import job_store
from backend import main
from backend.ai_providers import (
    generate_burmese_recap,
    synthesize_burmese_voice,
    transcribe_burmese_audio,
)
from backend.voiceover import create_recap_dub, srt_to_plain_text


class AIProviderTests(unittest.TestCase):
    def test_openai_recap_uses_configured_model_and_returns_script(self) -> None:
        response = Mock(ok=True)
        response.json.return_value = {
            "choices": [{"message": {"content": "မြန်မာ ဇာတ်လမ်းအကျဉ်း"}}]
        }
        with patch.dict(
            os.environ,
            {"OPENAI_API_KEY": "test-key", "OPENAI_CHAT_MODEL": "test-model"},
        ), patch("backend.ai_providers.requests.post", return_value=response) as request:
            result = generate_burmese_recap("ဇာတ်လမ်းစာသား", 60)

        self.assertEqual(result, "မြန်မာ ဇာတ်လမ်းအကျဉ်း")
        self.assertEqual(request.call_args.kwargs["json"]["model"], "test-model")
        self.assertTrue(request.call_args.args[0].endswith("/chat/completions"))

    def test_azure_transcription_sets_burmese_locale(self) -> None:
        response = Mock(ok=True)
        response.json.return_value = {
            "combinedPhrases": [{"text": "မင်္ဂလာပါ။"}, {"text": "ဇာတ်လမ်းစတင်သည်။"}]
        }
        with tempfile.TemporaryDirectory() as directory:
            audio_path = Path(directory) / "source.mp3"
            audio_path.write_bytes(b"mock audio")
            with patch.dict(
                os.environ,
                {
                    "AZURE_SPEECH_KEY": "test-key",
                    "AZURE_SPEECH_STT_ENDPOINT": "https://example.cognitiveservices.azure.com",
                },
            ), patch("backend.ai_providers.requests.post", return_value=response) as request:
                transcript = transcribe_burmese_audio(audio_path)

        self.assertEqual(transcript, "မင်္ဂလာပါ။\nဇာတ်လမ်းစတင်သည်။")
        self.assertEqual(request.call_args.kwargs["params"]["api-version"], "2025-10-15")
        self.assertEqual(
            request.call_args.kwargs["data"]["definition"],
            '{"locales": ["my-MM"]}',
        )

    def test_azure_tts_escapes_text_in_ssml(self) -> None:
        response = Mock(ok=True, content=b"mock mp3")
        with patch.dict(
            os.environ,
            {"AZURE_SPEECH_KEY": "test-key", "AZURE_SPEECH_TTS_REGION": "southeastasia"},
        ), patch("backend.ai_providers.requests.post", return_value=response) as request:
            audio = synthesize_burmese_voice("စာသား <safe>", "my-MM-NilarNeural")

        self.assertEqual(audio, b"mock mp3")
        self.assertIn("&lt;safe&gt;", request.call_args.kwargs["data"].decode("utf-8"))
        self.assertEqual(
            request.call_args.kwargs["headers"]["X-Microsoft-OutputFormat"],
            "audio-24khz-48kbitrate-mono-mp3",
        )

    def test_srt_text_removes_cues_and_timecodes(self) -> None:
        subtitle = "1\n00:00:00,000 --> 00:00:02,000\nမင်္ဂလာပါ\n\n2\n00:00:02,000 --> 00:00:04,000\nဇာတ်လမ်း"
        self.assertEqual(srt_to_plain_text(subtitle), "မင်္ဂလာပါ ဇာတ်လမ်း")


class VoiceoverMuxTests(unittest.TestCase):
    def test_voiceover_muxes_over_original_audio_and_silent_video(self) -> None:
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        job_ids: list[str] = []
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_with_audio = root / "source-audio.mp4"
            silent_source = root / "silent-source.mp4"
            voice_path = root / "voice.mp3"
            subprocess.run(
                [ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=880:duration=1", "-codec:a", "libmp3lame", str(voice_path)],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                [ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=teal:s=320x180:d=2:r=12", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source_with_audio)],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                [ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=navy:s=320x180:d=2:r=12", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(silent_source)],
                check=True,
                capture_output=True,
            )

            with patch("backend.voiceover.generate_burmese_recap", return_value="မြန်မာ ဇာတ်လမ်းအကျဉ်း"), patch(
                "backend.voiceover.synthesize_burmese_voice",
                return_value=voice_path.read_bytes(),
            ):
                for source in (source_with_audio, silent_source):
                    job_id = uuid.uuid4().hex
                    job_ids.append(job_id)
                    output, script = create_recap_dub(
                        job_id,
                        source,
                        subtitle_srt="1\n00:00:00,000 --> 00:00:02,000\nဇာတ်လမ်း\n",
                        voice="my-MM-NilarNeural",
                        recap_seconds=30,
                        include_original_audio=True,
                        background_volume=20,
                    )
                    probe = subprocess.run(
                        [ffmpeg, "-hide_banner", "-i", str(output)],
                        check=False,
                        capture_output=True,
                        text=True,
                    )
                    self.assertEqual(script, "မြန်မာ ဇာတ်လမ်းအကျဉ်း")
                    self.assertIn("Video: h264", probe.stderr)
                    self.assertIn("Audio: aac", probe.stderr)
                    output.unlink()

        for job_id in job_ids:
            (Path(__file__).resolve().parent / "storage" / "working" / f"{job_id}.voice.mp3").unlink(missing_ok=True)


class JobStoreMigrationTests(unittest.TestCase):
    def test_old_database_migrates_and_keeps_recap_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            original_path = job_store.DATABASE_PATH
            job_store.DATABASE_PATH = Path(directory) / "jobs.sqlite3"
            try:
                with closing(sqlite3.connect(job_store.DATABASE_PATH)) as connection:
                    connection.execute(
                        "CREATE TABLE render_jobs (id TEXT PRIMARY KEY, upload_id TEXT NOT NULL, "
                        "operation TEXT NOT NULL, parameters_json TEXT NOT NULL, status TEXT NOT NULL, "
                        "output_url TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
                    )
                    connection.commit()

                job_store.initialize_job_store()
                job = job_store.create_job("a" * 32, "b" * 32, "create-recap-dub")
                job_store.update_job(job["id"], status="running", result_text="မြန်မာ recap")
                job_store.update_job(job["id"], status="completed", output_url="/renders/out.mp4")
                saved = job_store.get_job(job["id"])
                self.assertIsNotNone(saved)
                self.assertEqual(saved["result_text"], "မြန်မာ recap")
            finally:
                job_store.DATABASE_PATH = original_path


class RenderWorkerTests(unittest.TestCase):
    def test_queued_recap_dub_job_persists_script_and_video_result(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "source.mp4"
            source_path.write_bytes(b"test source")
            output_path = root / "recap.mp4"
            output_path.write_bytes(b"rendered video")
            original_database = job_store.DATABASE_PATH
            job_store.DATABASE_PATH = root / "jobs.sqlite3"
            try:
                job_store.initialize_job_store()
                job_id = uuid.uuid4().hex
                job_store.create_job(
                    job_id,
                    uuid.uuid4().hex,
                    "create-recap-dub",
                    {
                        "subtitle_srt": "SRT text",
                        "voice": "my-MM-NilarNeural",
                        "recap_seconds": 30,
                        "include_original_audio": True,
                        "background_volume": 20,
                    },
                )

                def fake_recap_dub(*args: object, **kwargs: object) -> tuple[Path, str]:
                    return output_path, "generated Myanmar recap"

                async def run_worker() -> None:
                    stop_event = asyncio.Event()
                    worker = asyncio.create_task(main.render_worker(stop_event))
                    try:
                        for _ in range(100):
                            job = job_store.get_job(job_id)
                            if job and job["status"] in {"completed", "failed"}:
                                return
                            await asyncio.sleep(0.01)
                        self.fail("The queued voiceover job did not reach a terminal state.")
                    finally:
                        stop_event.set()
                        await worker

                with patch.object(main, "find_uploaded_video", return_value=source_path), patch.object(
                    main,
                    "create_recap_dub",
                    side_effect=fake_recap_dub,
                ):
                    asyncio.run(run_worker())

                saved_job = job_store.get_job(job_id)
                self.assertIsNotNone(saved_job)
                self.assertEqual(saved_job["status"], "completed")
                self.assertEqual(saved_job["result_text"], "generated Myanmar recap")
                self.assertEqual(saved_job["output_url"], "/renders/recap.mp4")
            finally:
                job_store.DATABASE_PATH = original_database


if __name__ == "__main__":
    unittest.main()
