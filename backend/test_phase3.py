from __future__ import annotations

import asyncio
import json
import subprocess
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

import imageio_ffmpeg

from backend.ai_pro import (
    auto_cut_highlights,
    generate_recap_scenes,
    generate_seo_metadata,
    segments_to_srt,
)
from backend.export_pro import export_video
from backend import job_store, main


class Phase3AIWorkflowTests(unittest.TestCase):
    def test_recap_script_requires_five_well_timed_scenes(self) -> None:
        scenes = [
            {"start": index * 12, "end": (index + 1) * 12, "text": f"ဇာတ်ကွက် {index + 1}", "emotion": "drama"}
            for index in range(5)
        ]
        with patch("backend.ai_pro._chat_json", return_value={"scenes": scenes}):
            result = json.loads(generate_recap_scenes([{"start": 0, "end": 10, "text": "Thai dialogue"}], 60))

        self.assertEqual(len(result["scenes"]), 5)
        self.assertEqual(result["scenes"][0]["start"], 0)
        self.assertEqual(result["scenes"][-1]["end"], 60)

    def test_subtitle_segments_preserve_whisper_timestamps(self) -> None:
        result = segments_to_srt([
            {"start": 0.125, "end": 1.75, "text": "สวัสดีค่ะ"},
            {"start": 1.8, "end": 3.2, "text": "မင်္ဂလာပါ"},
        ])
        self.assertIn("00:00:00,125 --> 00:00:01,750", result)
        self.assertIn("00:00:01,800 --> 00:00:03,200", result)
        self.assertIn("မင်္ဂလာပါ", result)

    def test_seo_metadata_is_validated_and_serialized(self) -> None:
        metadata = {
            "title": "မြန်မာဇာတ်လမ်းအကျဉ်း",
            "description": "ဇာတ်လမ်းအကျဉ်းချုပ်",
            "hashtags": ["#MyanmarDrama", "#ThaiDramaRecap", "#RecapKit"],
        }
        with patch("backend.ai_pro._chat_json", return_value=metadata):
            result = json.loads(generate_seo_metadata("ဇာတ်လမ်းအကျဉ်း"))
        self.assertEqual(result["title"], metadata["title"])
        self.assertEqual(result["hashtags"], metadata["hashtags"])

    def test_angel_job_completes_without_a_source_video(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "jobs.sqlite3"
            original_database = job_store.DATABASE_PATH
            job_store.DATABASE_PATH = database
            try:
                job_store.initialize_job_store()
                job_id = uuid.uuid4().hex
                job_store.create_job(
                    job_id,
                    "0" * 32,
                    "angel-chat",
                    {"ai_prompt": "Make this more dramatic", "ai_context": "TikTok 9:16"},
                )

                async def run_worker() -> None:
                    stop_event = asyncio.Event()
                    worker = asyncio.create_task(main.render_worker(stop_event))
                    try:
                        for _ in range(100):
                            current = job_store.get_job(job_id)
                            if current and current["status"] in {"completed", "failed"}:
                                return
                            await asyncio.sleep(0.01)
                        self.fail("Angel chat job did not finish.")
                    finally:
                        stop_event.set()
                        await worker

                with patch.object(main, "suggest_editor_changes", return_value="Try suspense music and typewriter captions."):
                    asyncio.run(run_worker())

                result = job_store.get_job(job_id)
                self.assertIsNotNone(result)
                self.assertEqual(result["status"], "completed")
                self.assertIsNone(result["output_url"])
                self.assertEqual(result["result_text"], "Try suspense music and typewriter captions.")
            finally:
                job_store.DATABASE_PATH = original_database


class Phase3FFmpegTests(unittest.TestCase):
    def test_auto_highlights_exports_synchronized_audio_and_video(self) -> None:
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
                    "-f", "lavfi", "-i", "color=c=teal:s=320x180:d=18:r=12",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=18",
                    "-shortest", "-c:v", "libx264", "-preset", "ultrafast",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", str(source),
                ],
                check=True,
                capture_output=True,
            )
            result = auto_cut_highlights(
                uuid.uuid4().hex,
                source,
                render_directory=renders,
                work_directory=working,
                target_seconds=15,
            )
            probe = subprocess.run(
                [ffmpeg, "-hide_banner", "-i", str(result)],
                check=False,
                capture_output=True,
                text=True,
            )
        self.assertIn("Video: h264", probe.stderr)
        self.assertIn("Audio: aac", probe.stderr)
        self.assertLess(float(probe.stderr.split("Duration: ")[1].split(",")[0].split(":")[-1]), 16)

    def test_export_presets_render_exact_aspect_sizes_and_4k(self) -> None:
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
                    "-f", "lavfi", "-i", "color=c=orange:s=160x90:d=0.5:r=12",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5",
                    "-shortest", "-c:v", "libx264", "-preset", "ultrafast",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", str(source),
                ],
                check=True,
                capture_output=True,
            )
            for preset, dimensions in (("youtube-4k", "3840x2160"), ("facebook-portrait", "1080x1350")):
                output = export_video(
                    uuid.uuid4().hex,
                    source,
                    preset=preset,
                    render_directory=renders,
                    work_directory=working,
                )
                probe = subprocess.run(
                    [ffmpeg, "-hide_banner", "-i", str(output)],
                    check=False,
                    capture_output=True,
                    text=True,
                )
                self.assertIn(dimensions, probe.stderr)
                self.assertIn("Audio: aac", probe.stderr)
                output.unlink()


if __name__ == "__main__":
    unittest.main()
