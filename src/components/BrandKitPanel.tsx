"use client";

import { ChangeEvent, useEffect, useState } from "react";
import type { AssetInfo } from "../lib/phase2";

type Props = {
  primary: string;
  background: string;
  logo: AssetInfo | null;
  logoEnabled: boolean;
  logoOpacity: number;
  logoScale: number;
  introEnabled: boolean;
  outroEnabled: boolean;
  fontId: string;
  onChange: (changes: Partial<{
    primary: string;
    background: string;
    logoEnabled: boolean;
    logoOpacity: number;
    logoScale: number;
    introEnabled: boolean;
    outroEnabled: boolean;
    fontId: string;
  }>) => void;
  onUploadLogo: (file: File) => Promise<void>;
};

type FontOption = { id: string; label: string };

export function BrandKitPanel({
  primary, background, logo, logoEnabled, logoOpacity, logoScale, introEnabled, outroEnabled, fontId, onChange, onUploadLogo,
}: Props) {
  const [fonts, setFonts] = useState<FontOption[]>([]);
  const [fontError, setFontError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/fonts", { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { fonts?: FontOption[]; detail?: string };
        if (!response.ok) throw new Error(result.detail ?? "Font list could not be loaded.");
        setFonts(result.fonts ?? []);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setFontError(error instanceof Error ? error.message : "Font list could not be loaded.");
      });
    return () => controller.abort();
  }, []);

  function chooseLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void onUploadLogo(file);
  }

  return (
    <div className="phase2-panel-content phase2-brand-grid">
      <label>Primary color <input type="color" value={primary} onChange={(event) => onChange({ primary: event.target.value })} /></label>
      <label>Canvas background <input type="color" value={background} onChange={(event) => onChange({ background: event.target.value })} /></label>
      <label>Myanmar font
        <select value={fontId} onChange={(event) => onChange({ fontId: event.target.value })}>
          <option value="">Use server default font</option>
          {fonts.map((font) => <option value={font.id} key={font.id}>{font.label}</option>)}
        </select>
      </label>
      {fontError && <p className="phase2-error" role="alert">{fontError}</p>}
      {!fonts.length && !fontError && <small className="phase2-help">Install a TTF/OTF in backend/storage/fonts or set VIDEO_FONT_PATH to enable font choices.</small>}
      <label className="phase2-upload-control">
        Logo watermark (PNG/JPG/WEBP)
        <input type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onChange={chooseLogo} />
      </label>
      {logo && <small className="phase2-asset-name">Logo ready: {logo.filename}</small>}
      <label className="phase2-check"><input type="checkbox" checked={logoEnabled} disabled={!logo} onChange={(event) => onChange({ logoEnabled: event.target.checked })} />Apply bottom-right watermark</label>
      {logoEnabled && <>
        <label>Watermark opacity <strong>{Math.round(logoOpacity * 100)}%</strong><input type="range" min={0.1} max={1} step={0.05} value={logoOpacity} onChange={(event) => onChange({ logoOpacity: Number(event.target.value) })} /></label>
        <label>Watermark scale <strong>{Math.round(logoScale * 100)}%</strong><input type="range" min={0.05} max={0.5} step={0.01} value={logoScale} onChange={(event) => onChange({ logoScale: Number(event.target.value) })} /></label>
      </>}
      <label className="phase2-check"><input type="checkbox" checked={introEnabled} onChange={(event) => onChange({ introEnabled: event.target.checked })} />Add 3-second RecapKit intro</label>
      <label className="phase2-check"><input type="checkbox" checked={outroEnabled} onChange={(event) => onChange({ outroEnabled: event.target.checked })} />Add 5-second Burmese subscribe outro</label>
      <p className="phase2-help">Font options are discovered from the backend’s configured font and backend/storage/fonts. Never upload secrets in a font file.</p>
    </div>
  );
}
