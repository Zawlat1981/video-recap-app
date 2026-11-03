"use client";

import { ChangeEvent } from "react";
import type { AssetInfo } from "../lib/phase2";

export type SoundEffect = { asset: AssetInfo; startSeconds: number; volume: number };

type Props = {
  bgm: AssetInfo | null;
  bgmVolume: number;
  ducking: boolean;
  effects: SoundEffect[];
  onBgmUpload: (file: File) => Promise<void>;
  onEffectUpload: (file: File) => Promise<void>;
  onChange: (changes: Partial<{ bgmVolume: number; ducking: boolean; effects: SoundEffect[] }>) => void;
};

export function AudioTracksPanel({ bgm, bgmVolume, ducking, effects, onBgmUpload, onEffectUpload, onChange }: Props) {
  function chooseFile(event: ChangeEvent<HTMLInputElement>, callback: (file: File) => Promise<void>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void callback(file);
  }

  return (
    <div className="phase2-panel-content phase2-audio-grid">
      <label className="phase2-upload-control">Background music
        <input type="file" accept=".mp3,.wav,.m4a,.aac,.ogg,audio/*" onChange={(event) => chooseFile(event, onBgmUpload)} />
      </label>
      {bgm && <div className="phase2-track"><strong>{bgm.filename}</strong><audio src={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}${bgm.asset_url}`} controls preload="metadata" /></div>}
      <label>BGM volume <strong>{Math.round(bgmVolume * 100)}%</strong>
        <input type="range" min={0} max={1} step={0.05} value={bgmVolume} disabled={!bgm} onChange={(event) => onChange({ bgmVolume: Number(event.target.value) })} />
      </label>
      <label className="phase2-check"><input type="checkbox" checked={ducking} disabled={!bgm} onChange={(event) => onChange({ ducking: event.target.checked })} />Duck music under source audio</label>
      <label className="phase2-upload-control">Add sound effect
        <input type="file" accept=".mp3,.wav,.m4a,.aac,.ogg,audio/*" onChange={(event) => chooseFile(event, onEffectUpload)} />
      </label>
      <div className="phase2-track-list">
        {effects.map((effect, index) => (
          <div className="phase2-track" key={effect.asset.id}>
            <strong>{effect.asset.filename}</strong>
            <label>Start <input type="number" min={0} step={0.1} value={effect.startSeconds} onChange={(event) => onChange({ effects: effects.map((item, current) => current === index ? { ...item, startSeconds: Math.max(0, Number(event.target.value)) } : item) })} /></label>
            <label>Volume <input type="range" min={0} max={1} step={0.05} value={effect.volume} onChange={(event) => onChange({ effects: effects.map((item, current) => current === index ? { ...item, volume: Number(event.target.value) } : item) })} /></label>
            <button type="button" className="button button-secondary" onClick={() => onChange({ effects: effects.filter((_, current) => current !== index) })}>Remove</button>
          </div>
        ))}
        {!effects.length && <small className="phase2-help">Sound effects are mixed at their selected timeline positions.</small>}
      </div>
    </div>
  );
}
