"use client";

import { ChangeEvent } from "react";
import type { AssetInfo } from "../lib/phase2";

type Props = {
  images: AssetInfo[];
  duration: number;
  motion: string;
  onUpload: (files: File[]) => Promise<void>;
  onChange: (changes: Partial<{ duration: number; motion: string }>) => void;
  onCreate: () => void;
  disabled: boolean;
};

export function ImageToVideoPanel({ images, duration, motion, onUpload, onChange, onCreate, disabled }: Props) {
  function chooseImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length) void onUpload(files);
  }

  return (
    <div className="phase2-panel-content">
      <label className="phase2-upload-control">Images (up to 10)
        <input type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" multiple onChange={chooseImages} />
      </label>
      <div className="phase2-image-list">
        {images.map((image, index) => <div key={image.id} className="phase2-image-item"><span>{index + 1}</span><strong>{image.filename}</strong></div>)}
      </div>
      <label>Ken Burns motion
        <select value={motion} onChange={(event) => onChange({ motion: event.target.value })}>
          <option value="zoom-in">Slow zoom in</option>
          <option value="zoom-out">Slow zoom out</option>
          <option value="pan-left">Pan left</option>
          <option value="pan-right">Pan right</option>
          <option value="zoom-pan">Zoom and pan</option>
        </select>
      </label>
      <label>Seconds per image <strong>{duration}</strong>
        <input type="range" min={3} max={10} value={duration} onChange={(event) => onChange({ duration: Number(event.target.value) })} />
      </label>
      <p className="phase2-help">Images are encoded at 16:9/1080p with a gentle Ken Burns motion. Selected Brand Kit, text, and audio settings are applied at export.</p>
      <button type="button" className="button button-primary" disabled={disabled || images.length === 0} onClick={onCreate}>Create image video</button>
    </div>
  );
}
