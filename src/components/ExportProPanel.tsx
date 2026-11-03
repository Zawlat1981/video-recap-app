"use client";

import { ChangeEvent, useState } from "react";
import { Download, Film, Smartphone, UploadCloud } from "lucide-react";
import type { RenderOperation } from "../lib/phase2";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const presets = [
  { id: "youtube-1080", label: "YouTube 1080p", size: "1920 × 1080", detail: "H.264 · 30 fps" },
  { id: "youtube-4k", label: "YouTube 4K", size: "3840 × 2160", detail: "Lanczos upscale · 35 Mbps" },
  { id: "tiktok", label: "TikTok / Reels", size: "1080 × 1920", detail: "9:16 · 60 sec max · 6 Mbps" },
  { id: "youtube-shorts", label: "YouTube Shorts", size: "1080 × 1920", detail: "9:16 · 60 sec max" },
  { id: "instagram-square", label: "Instagram Square", size: "1080 × 1080", detail: "1:1 · H.264" },
  { id: "facebook-portrait", label: "Facebook Portrait", size: "1080 × 1350", detail: "4:5 · H.264" },
] as const;

type Props = {
  hasVideo: boolean;
  busy: boolean;
  onRun: (operation: RenderOperation, values?: Record<string, string | number | boolean | string[]>) => void;
};

export function ExportProPanel({ hasVideo, busy, onRun }: Props) {
  const [preset, setPreset] = useState<(typeof presets)[number]["id"]>("tiktok");
  const [watermarkFree, setWatermarkFree] = useState(true);
  const [faceCenter, setFaceCenter] = useState(false);
  const [batchVideos, setBatchVideos] = useState<{ id: string; filename: string }[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activePreset = presets.find((item) => item.id === preset) ?? presets[2];

  async function uploadBatch(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setError(null);
    setBatchBusy(true);
    try {
      if (files.length + batchVideos.length > 10) throw new Error("Batch export supports up to ten videos.");
      const uploaded = await Promise.all(files.map(async (file) => {
        const formData = new FormData();
        formData.set("file", file);
        const response = await fetch(`${API_BASE_URL}/api/uploads`, { method: "POST", body: formData });
        const data = await response.json() as { id?: string; filename?: string; detail?: string };
        if (!response.ok || !data.id) throw new Error(data.detail ?? `Could not upload ${file.name}.`);
        return { id: data.id, filename: data.filename ?? file.name };
      }));
      setBatchVideos((current) => [...current, ...uploaded]);
    } catch (uploadError: unknown) {
      setError(uploadError instanceof Error ? uploadError.message : "Batch videos could not be uploaded.");
    } finally {
      setBatchBusy(false);
    }
  }

  return (
    <div className="phase3-panel-content phase3-export-grid">
      <div className="phase3-export-presets">
        {presets.map((item) => (
          <button type="button" key={item.id} className={preset === item.id ? "active" : ""} onClick={() => { setPreset(item.id); if (item.id !== "tiktok" && item.id !== "youtube-shorts") setFaceCenter(false); }}>
            {item.id === "tiktok" || item.id === "youtube-shorts" ? <Smartphone size={18} /> : <Film size={18} />}
            <span><strong>{item.label}</strong><small>{item.size} · {item.detail}</small></span>
          </button>
        ))}
      </div>
      <div className="phase3-export-options">
        <div><strong>{activePreset.label}</strong><small>{activePreset.size} · H.264 video / AAC audio. Exports are stored locally on the render server.</small></div>
        <label className="phase2-check"><input type="checkbox" checked={watermarkFree} onChange={(event) => setWatermarkFree(event.target.checked)} />Watermark-free export</label>
        {(preset === "tiktok" || preset === "youtube-shorts") && <label className="phase2-check"><input type="checkbox" checked={faceCenter} onChange={(event) => setFaceCenter(event.target.checked)} />Try optional face centering (OpenCV)</label>}
        <button className="button button-primary" type="button" disabled={!hasVideo || busy} onClick={() => onRun("export-pro", { export_preset: preset, logo_enabled: !watermarkFree, face_center: faceCenter })}><Download size={15} /> Export {activePreset.label}</button>
        {preset === "tiktok" && <small>Six Mbps targets a smaller upload; final file size depends on video duration and audio.</small>}
      </div>
      <div className="phase3-batch">
        <strong>Batch export with the same preset</strong>
        <small>Upload up to 10 videos. Each uses the current template, brand kit, and selected export profile.</small>
        <label className="button button-secondary phase3-batch-upload"><UploadCloud size={15} /> Select batch videos<input type="file" accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm" multiple onChange={(event) => void uploadBatch(event)} /></label>
        {batchVideos.map((video) => <span className="phase3-batch-file" key={video.id}>{video.filename}<button type="button" aria-label={`Remove ${video.filename}`} onClick={() => setBatchVideos((current) => current.filter((item) => item.id !== video.id))}>×</button></span>)}
        <button className="button button-secondary" type="button" disabled={!batchVideos.length || busy || batchBusy} onClick={() => onRun("export-pro-batch", { export_preset: preset, logo_enabled: !watermarkFree, face_center: faceCenter, batch_upload_ids: JSON.stringify(batchVideos.map((video) => video.id)) })}>{batchBusy ? "Uploading…" : `Export ${batchVideos.length} video(s) as ZIP`}</button>
        {error && <p className="phase2-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
