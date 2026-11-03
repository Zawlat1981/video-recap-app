import asyncio
import io
import os
import re
import sqlite3
import subprocess
import tempfile
import unittest
import uuid
from contextlib import closing
from pathlib import Path
from unittest.mock import Mock, patch
from zipfile import ZipFile

import imageio_ffmpeg
from PIL import Image
from starlette.datastructures import UploadFile

from backend import job_store
from backend import main
from backend.ai_providers import (
    generate_burmese_recap,
    synthesize_burmese_voice,
    translate_to_burmese,
    transcribe_burmese_audio,
)
from backend.voiceover import create_recap_dub, srt_to_plain_text


class AIProviderTests(unittest.TestCase):
    def test_openai_recap_uses_configured_model_and_returns_script(self) -> None:
        response = Mock()
        response.choices = [Mock()]
        response.choices[0].message.content = "မြန်မာ ဇာတ်လမ်းအကျဉ်း"
        with patch.dict(
            os.environ,
            {"OPENAI_API_KEY": "test-key", "OPENAI_CHAT_MODEL": "test-model"},
        ), patch("backend.ai_providers.openai.OpenAI") as client_class:
            client_class.return_value.chat.completions.create.return_value = response
            result = generate_burmese_recap("ဇာတ်လမ်းစာသား", 60)

        self.assertEqual(result, "မြန်မာ ဇာတ်လမ်းအကျဉ်း")
        request = client_class.return_value.chat.completions.create.call_args.kwargs
        self.assertEqual(request["model"], "test-model")
        self.assertIn("60 စက္ကန့်စာ", request["messages"][1]["content"])

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

    def test_translation_uses_direct_burmese_translation_prompt(self) -> None:
        response = Mock()
        response.choices = [Mock()]
        response.choices[0].message.content = "ဘဝမှာ ဘယ်လိုပဲဖြစ်ဖြစ်"
        with patch.dict(
            os.environ,
            {"OPENAI_API_KEY": "test-key", "OPENAI_CHAT_MODEL": "test-model"},
        ), patch("backend.ai_providers.openai.OpenAI") as client_class:
            client_class.return_value.chat.completions.create.return_value = response
            translated = translate_to_burmese("ถ้าชีวิตจะเป็นอย่างไร")

        self.assertEqual(translated, "ဘဝမှာ ဘယ်လိုပဲဖြစ်ဖြစ်")
        request = client_class.return_value.chat.completions.create.call_args.kwargs
        self.assertEqual(request["model"], "test-model")
        self.assertIn("Do not summarize", request["messages"][0]["content"])
        self.assertEqual(request["messages"][1]["content"], "ถ้าชีวิตจะเป็นอย่างไร")

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

    def test_dubbing_translates_thai_dialogue_without_summarizing(self) -> None:
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        job_id = uuid.uuid4().hex
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "source.mp4"
            transcription_audio = root / "source.mp3"
            voice_path = root / "voice.mp3"
            subprocess.run(
                [ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-codec:a", "libmp3lame", str(voice_path)],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                [ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=teal:s=320x180:d=2:r=12", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source_path)],
                check=True,
                capture_output=True,
            )

            with patch("backend.voiceover._extract_transcription_audio", return_value=transcription_audio), patch(
                "backend.voiceover.transcribe_audio",
                return_value="ถ้าชีวิตจะเป็นอย่างไร",
            ) as transcribe, patch(
                "backend.voiceover.translate_to_burmese",
                return_value="ဘဝမှာ ဘယ်လိုပဲဖြစ်ဖြစ်",
            ) as translate, patch(
                "backend.voiceover.synthesize_burmese_voice",
                return_value=voice_path.read_bytes(),
            ) as synthesize:
                output_path, translated_script = create_recap_dub(
                    job_id,
                    source_path,
                    subtitle_srt=None,
                    voice="my-MM-NilarNeural",
                    recap_seconds=60,
                    include_original_audio=False,
                    background_volume=0,
                    mode="dubbing",
                )

            self.assertEqual(translated_script, "ဘဝမှာ ဘယ်လိုပဲဖြစ်ဖြစ်")
            transcribe.assert_called_once_with(transcription_audio, language="th")
            translate.assert_called_once_with("ถ้าชีวิตจะเป็นอย่างไร")
            synthesize.assert_called_once_with("ဘဝမှာ ဘယ်လိုပဲဖြစ်ဖြစ်", "my-MM-NilarNeural")
            self.assertTrue(output_path.is_file())
            output_path.unlink()
            (Path(__file__).resolve().parent / "storage" / "working" / f"{job_id}.voice.mp3").unlink(missing_ok=True)


class HideOriginalSubtitlesTests(unittest.TestCase):
    def test_supported_methods_render_video_without_shell_commands(self) -> None:
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "source.mp4"
            renders = root / "renders"
            working = root / "working"
            renders.mkdir()
            working.mkdir()
            subprocess.run(
                [
                    ffmpeg,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=teal:s=320x180:d=1:r=12",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    str(source_path),
                ],
                check=True,
                capture_output=True,
            )

            with patch.object(main, "RENDER_DIRECTORY", renders), patch.object(
                main,
                "WORK_DIRECTORY",
                working,
            ):
                for method in ("blur", "blackbox", "crop"):
                    output_path = main.hide_original_subtitles(uuid.uuid4().hex, source_path, method)
                    self.assertTrue(output_path.is_file())
                    subprocess.run(
                        [ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(output_path), "-f", "null", "-"],
                        check=True,
                        capture_output=True,
                    )


class VideoDesignExportTests(unittest.TestCase):
    def test_template_and_animated_text_are_rendered_into_mp4(self) -> None:
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "source.mp4"
            renders = root / "renders"
            working = root / "working"
            renders.mkdir()
            working.mkdir()
            subprocess.run(
                [
                    ffmpeg,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=teal:s=320x180:d=1:r=12",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    str(source_path),
                ],
                check=True,
                capture_output=True,
            )

            with patch.object(main, "RENDER_DIRECTORY", renders), patch.object(
                main,
                "WORK_DIRECTORY",
                working,
            ), patch.dict(os.environ, {"VIDEO_FONT_PATH": ""}):
                for ratio, animation, expected_size in (
                    ("16:9", "none", "1920x1080"),
                    ("9:16", "fade", "1080x1920"),
                    ("1:1", "slide", "1080x1080"),
                    ("1:1", "pop", "1080x1080"),
                ):
                    output_path = main.apply_video_design(
                        uuid.uuid4().hex,
                        source_path,
                        {
                            "template_ratio": ratio,
                            "text_overlay": "Myanmar export",
                            "text_animation": animation,
                            "text_position": "bottom",
                            "text_size": 24,
                            "text_color": "white",
                        },
                    )

                    probe = subprocess.run(
                        [ffmpeg, "-hide_banner", "-i", str(output_path)],
                        check=False,
                        capture_output=True,
                        text=True,
                    )
                    self.assertIn("Video: h264", probe.stderr)
                    self.assertIn(expected_size, probe.stderr)
                    output_path.unlink()

    def test_elements_typewriter_logo_and_audio_mix_render(self) -> None:
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "source.mp4"
            assets = root / "assets"
            renders = root / "renders"
            working = root / "working"
            for path in (assets, renders, working):
                path.mkdir()
            logo_id = uuid.uuid4().hex
            bgm_id = uuid.uuid4().hex
            logo_path = assets / f"{logo_id}.png"
            Image.new("RGBA", (64, 64), (255, 102, 0, 180)).save(logo_path)
            bgm_path = assets / f"{bgm_id}.wav"
            subprocess.run(
                [
                    ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                    "sine=frequency=220:duration=1", "-y", str(bgm_path),
                ],
                check=True,
                capture_output=True,
            )
            subprocess.run(
                [
                    ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                    "color=c=teal:s=320x180:d=1:r=12", "-f", "lavfi", "-i",
                    "sine=frequency=440:duration=1", "-shortest", "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", str(source_path),
                ],
                check=True,
                capture_output=True,
            )
            with patch.object(main, "ASSET_DIRECTORY", assets), patch.object(
                main, "RENDER_DIRECTORY", renders
            ), patch.object(main, "WORK_DIRECTORY", working):
                output = main.apply_video_design(
                    uuid.uuid4().hex,
                    source_path,
                    {
                        "template_ratio": "16:9",
                        "text_overlay": "မင်္ဂလာပါ",
                        "text_animation": "typewriter",
                        "text_position": "center",
                        "text_size": 30,
                        "text_color": "white",
                        "elements": [{
                            "kind": "heart", "x": 0.2, "y": 0.3, "scale": 0.8,
                            "rotation": 10, "start_seconds": 0, "end_seconds": 1,
                        }],
                        "logo_asset_id": logo_id,
                        "logo_enabled": True,
                        "logo_opacity": 0.8,
                        "logo_scale": 0.15,
                        "bgm_asset_id": bgm_id,
                        "bgm_volume": 0.2,
                        "bgm_ducking": True,
                    },
                )
            probe = subprocess.run(
                [ffmpeg, "-hide_banner", "-i", str(output)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertIn("Video: h264", probe.stderr)
            self.assertIn("Audio: aac", probe.stderr)
            output.unlink()


class Phase2PipelineTests(unittest.TestCase):
    def test_image_video_supports_pan_preset(self) -> None:
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image_path = root / "poster.png"
            renders = root / "renders"
            working = root / "working"
            renders.mkdir()
            working.mkdir()
            Image.new("RGB", (480, 320), (70, 120, 180)).save(image_path)

            output = main.create_image_video(
                uuid.uuid4().hex,
                [image_path],
                render_directory=renders,
                work_directory=working,
                duration_seconds=3,
                motion="pan-left",
            )
            probe = subprocess.run(
                [ffmpeg, "-hide_banner", "-i", str(output)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertIn("Video: h264", probe.stderr)
            self.assertIn("1920x1080", probe.stderr)
            output.unlink()

    def test_auto_cut_silence_removes_middle_pause(self) -> None:
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.mp4"
            renders = root / "renders"
            working = root / "working"
            renders.mkdir()
            working.mkdir()
            subprocess.run(
                [
                    ffmpeg, "-hide_banner", "-loglevel", "error",
                    "-f", "lavfi", "-i", "color=c=teal:s=320x180:d=3.5:r=12",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
                    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=1.5",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
                    "-filter_complex", "[1:a][2:a][3:a]concat=n=3:v=0:a=1[a]",
                    "-map", "0:v", "-map", "[a]", "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", str(source),
                ],
                check=True,
                capture_output=True,
            )
            output = main.auto_cut_silence(
                uuid.uuid4().hex,
                source,
                render_directory=renders,
                work_directory=working,
            )
            probe = subprocess.run(
                [ffmpeg, "-hide_banner", "-i", str(output)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertIn("Audio: aac", probe.stderr)
            duration = re.search(r"Duration:\s*\d+:\d+:(\d+(?:\.\d+)?)", probe.stderr)
            self.assertIsNotNone(duration)
            self.assertLess(float(duration.group(1)), 3.0)
            output.unlink()

    def test_batch_export_writes_each_video_to_zip(self) -> None:
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            uploads = root / "uploads"
            renders = root / "renders"
            working = root / "working"
            for path in (uploads, renders, working):
                path.mkdir()
            upload_ids = [uuid.uuid4().hex for _ in range(2)]
            for upload_id in upload_ids:
                subprocess.run(
                    [
                        ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                        "color=c=teal:s=320x180:d=0.5:r=12", "-c:v", "libx264",
                        "-pix_fmt", "yuv420p", "-y", str(uploads / f"{upload_id}.mp4"),
                    ],
                    check=True,
                    capture_output=True,
                )
            with patch.object(main, "UPLOAD_DIRECTORY", uploads), patch.object(
                main, "RENDER_DIRECTORY", renders
            ), patch.object(main, "WORK_DIRECTORY", working):
                output = main.export_batch(
                    uuid.uuid4().hex,
                    upload_ids,
                    {"template_ratio": "1:1", "text_overlay": ""},
                )
            with ZipFile(output) as archive:
                self.assertEqual(archive.namelist(), ["video-01.mp4", "video-02.mp4"])
            output.unlink()

    def test_image_asset_upload_stores_supported_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            assets = Path(directory)
            image_bytes = io.BytesIO()
            Image.new("RGBA", (8, 8), (255, 102, 0, 255)).save(image_bytes, format="PNG")
            upload = UploadFile(filename="brand.png", file=io.BytesIO(image_bytes.getvalue()))
            with patch.object(main, "ASSET_DIRECTORY", assets):
                result = asyncio.run(main.upload_asset(upload, category="image"))
            self.assertEqual(result["category"], "image")
            self.assertTrue((assets / f"{result['id']}.png").is_file())


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
                ) as recap_dub, patch.object(
                    main,
                    "apply_video_design",
                    side_effect=lambda _, path, __: path,
                ) as design:
                    asyncio.run(run_worker())

                saved_job = job_store.get_job(job_id)
                self.assertIsNotNone(saved_job)
                self.assertEqual(saved_job["status"], "completed")
                self.assertEqual(saved_job["result_text"], "generated Myanmar recap")
                self.assertEqual(saved_job["output_url"], "/renders/recap.mp4")
                self.assertEqual(recap_dub.call_args.kwargs["mode"], "recap")
                self.assertEqual(recap_dub.call_args.kwargs["voice"], "my-MM-NilarNeural")
                self.assertEqual(design.call_args.args[2].get("template_ratio", "16:9"), "16:9")
            finally:
                job_store.DATABASE_PATH = original_database


if __name__ == "__main__":
    unittest.main()
