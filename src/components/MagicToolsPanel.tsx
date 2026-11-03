"use client";

import { ChangeEvent } from "react";
import type { RenderOperation } from "../lib/phase2";

type Props = {
  hasVideo: boolean;
  batchCount: number;
  batchBusy: boolean;
  onBatchFiles: (files: File[]) => Promise<void>;
  onRun: (operation: RenderOperation, options?: { faceCenter?: boolean }) => void;
  disabled: boolean;
};

export function MagicToolsPanel({ hasVideo, batchCount, batchBusy, onBatchFiles, onRun, disabled }: Props) {
  function chooseVideos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length) void onBatchFiles(files);
  }

  return (
    <div className="phase2-panel-content phase2-magic-grid">
      <article className="phase2-tool">
        <strong>Auto Cut Silence</strong><small>Detect and remove pauses longer than one second while keeping video and audio in sync.</small>
        <button type="button" className="button button-secondary" disabled={!hasVideo || disabled} onClick={() => onRun("auto-cut-silence")}>Cut silence</button>
      </article>
      <article className="phase2-tool">
        <strong>Magic Resize</strong><small>Export using the selected aspect ratio and blurred fill; optionally center a detected face.</small>
        <button type="button" className="button button-secondary" disabled={!hasVideo || disabled} onClick={() => onRun("magic-resize", { faceCenter: true })}>Resize and center face</button>
      </article>
      <article className="phase2-tool">
        <strong>Green-screen key</strong><small>Remove a solid green background. This is chroma-keying, not general-purpose AI background removal.</small>
        <button type="button" className="button button-secondary" disabled={!hasVideo || disabled} onClick={() => onRun("remove-green-screen")}>Key green screen</button>
      </article>
      <article className="phase2-tool">
        <strong>Batch export</strong><small>Select up to 10 videos and apply the current template, elements, watermark, and audio mix.</small>
        <label className="phase2-upload-control">Select videos
          <input type="file" accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm" multiple onChange={chooseVideos} />
        </label>
        <small>{batchCount} video(s) ready</small>
        <button type="button" className="button button-secondary" disabled={!batchCount || disabled || batchBusy} onClick={() => onRun("batch-export")}>{batchBusy ? "Uploading..." : "Export batch ZIP"}</button>
      </article>
      <p className="phase2-help">Face centering requires the optional OpenCV package. Green-screen keying requires evenly lit green-screen footage.</p>
    </div>
  );
}
