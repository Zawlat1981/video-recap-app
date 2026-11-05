"use client";

import { useState } from "react";
import { AudioTracksPanel, type SoundEffect } from "./AudioTracksPanel";
import { BrandKitPanel } from "./BrandKitPanel";
import { ElementsPanel } from "./ElementsPanel";
import { ImageToVideoPanel } from "./ImageToVideoPanel";
import { MagicToolsPanel } from "./MagicToolsPanel";
import { Phase3Studio } from "./Phase3Studio";
import type { Phase3Tab } from "./Phase3Studio";
import type { AssetInfo, ElementOverlay, RenderJob, RenderOperation } from "../lib/phase2";
import type { CreatorTemplate } from "../lib/templates";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const tabs = [
  { id: "elements", label: "Elements" },
  { id: "brand", label: "Brand Kit" },
  { id: "audio", label: "BGM / SFX" },
  { id: "images", label: "Image to Video" },
  { id: "magic", label: "Magic Tools" },
] as const;

export type Phase2Tab = (typeof tabs)[number]["id"];

type Props = {
  uploadId: string | null;
  renderBusy: boolean;
  templateRatio: "16:9" | "9:16" | "1:1";
  textOverlay: string;
  textAnimation: "none" | "fade" | "slide" | "pop" | "typewriter";
  textPosition: "top" | "center" | "bottom";
  textSize: number;
  textColor: "white" | "yellow" | "cyan";
  job: RenderJob | null;
  appliedTemplate: CreatorTemplate | null;
  onJob: (job: RenderJob) => void;
  onError: (message: string | null) => void;
  onTemplateApply: (template: CreatorTemplate) => void;
  onApplyScript: (text: string) => void;
  onApplySubtitles: (srt: string) => void;
  activeTab: Phase2Tab;
  onActiveTabChange: (tab: Phase2Tab) => void;
  activePhase3Tab: Phase3Tab;
  onPhase3TabChange: (tab: Phase3Tab) => void;
};

export function Phase2Studio({
  uploadId, renderBusy, templateRatio, textOverlay, textAnimation, textPosition, textSize, textColor, job, appliedTemplate, onJob, onError,
  onTemplateApply, onApplyScript, onApplySubtitles, activeTab, onActiveTabChange, activePhase3Tab, onPhase3TabChange,
}: Props) {
  const [elements, setElements] = useState<ElementOverlay[]>([]);
  const [primary, setPrimary] = useState("#FF6600");
  const [background, setBackground] = useState("#172A3A");
  const [fontId, setFontId] = useState("");
  const [logo, setLogo] = useState<AssetInfo | null>(null);
  const [logoEnabled, setLogoEnabled] = useState(false);
  const [logoOpacity, setLogoOpacity] = useState(0.8);
  const [logoScale, setLogoScale] = useState(0.16);
  const [introEnabled, setIntroEnabled] = useState(false);
  const [outroEnabled, setOutroEnabled] = useState(false);
  const [bgm, setBgm] = useState<AssetInfo | null>(null);
  const [bgmVolume, setBgmVolume] = useState(0.2);
  const [ducking, setDucking] = useState(true);
  const [effects, setEffects] = useState<SoundEffect[]>([]);
  const [images, setImages] = useState<AssetInfo[]>([]);
  const [imageDuration, setImageDuration] = useState(5);
  const [imageMotion, setImageMotion] = useState("zoom-in");
  const [batchVideos, setBatchVideos] = useState<{ id: string; filename: string }[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const currentTemplate: CreatorTemplate = {
    id: "current-editor-settings",
    name: "Current editor settings",
    category: "Custom",
    description: "Save the current text, ratio, elements, and brand settings",
    ratio: templateRatio,
    textAnimation,
    textColor,
    brandPrimary: primary,
    brandBackground: background,
    textOverlay,
    introEnabled,
    outroEnabled,
    fontId,
    logo,
    logoEnabled,
    logoOpacity,
    logoScale,
    bgm,
    bgmVolume,
    bgmDucking: ducking,
    elements: elements.map((element) => ({
      kind: element.kind,
      x: element.x,
      y: element.y,
      scale: element.scale,
      rotation: element.rotation,
      start_seconds: element.start_seconds,
      end_seconds: element.end_seconds,
      text: element.text,
      subtitle: element.subtitle,
    })),
  };

  async function uploadAsset(file: File, category: "image" | "audio"): Promise<AssetInfo> {
    const formData = new FormData();
    formData.set("file", file);
    formData.set("category", category);
    const response = await fetch("/api/assets", { method: "POST", body: formData });
    const result = await response.json() as AssetInfo & { detail?: string };
    if (!response.ok) throw new Error(result.detail ?? `${category} upload failed.`);
    return result;
  }

  async function withUpload(callback: () => Promise<void>) {
    onError(null);
    try {
      await callback();
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : "Asset upload failed.");
    }
  }

  async function uploadImages(files: File[]) {
    await withUpload(async () => {
      if (images.length + files.length > 10) throw new Error("Choose no more than ten images.");
      const newAssets = await Promise.all(files.map((file) => uploadAsset(file, "image")));
      setImages((current) => [...current, ...newAssets]);
    });
  }

  async function uploadAudio(file: File, kind: "bgm" | "effect") {
    await withUpload(async () => {
      if (kind === "effect" && effects.length >= 10) throw new Error("Choose no more than ten sound effects.");
      const asset = await uploadAsset(file, "audio");
      if (kind === "bgm") setBgm(asset);
      else setEffects((current) => [...current, { asset, startSeconds: 0, volume: 0.8 }]);
    });
  }

  async function uploadLogo(file: File) {
    await withUpload(async () => setLogo(await uploadAsset(file, "image")));
  }

  async function uploadBatch(files: File[]) {
    setBatchBusy(true);
    onError(null);
    try {
      if (files.length + batchVideos.length > 10) throw new Error("Batch export supports up to ten videos.");
      const uploads = await Promise.all(files.map(async (file) => {
        const formData = new FormData();
        formData.set("file", file);
        const response = await fetch(`${API_BASE_URL}/api/uploads`, { method: "POST", body: formData });
        const result = await response.json() as { id?: string; filename?: string; detail?: string };
        if (!response.ok || !result.id) throw new Error(result.detail ?? `Could not upload ${file.name}.`);
        return { id: result.id, filename: result.filename ?? file.name };
      }));
      setBatchVideos((current) => [...current, ...uploads]);
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : "Batch video upload failed.");
    } finally {
      setBatchBusy(false);
    }
  }

  async function submit(
    action: RenderOperation,
    extra: Record<string, string | number | boolean | string[]> = {},
  ) {
    if (renderBusy) return;
    const needsBatch = action === "batch-export" || action === "export-pro-batch";
    const needsVideo = action !== "image-to-video" && !needsBatch
      && action !== "angel-chat" && action !== "seo-metadata" && action !== "story-script";
    if (needsVideo && !uploadId) {
      onError("Upload a source video before starting this operation.");
      return;
    }
    onError(null);
    const formData = new FormData();
    formData.set("action", action);
    if (uploadId) formData.set("upload_id", uploadId);
    formData.set("template_ratio", templateRatio);
    formData.set("text_overlay", textOverlay);
    formData.set("text_animation", textAnimation);
    formData.set("text_position", textPosition);
    formData.set("text_size", String(textSize));
    formData.set("text_color", textColor);
    formData.set("elements", JSON.stringify(elements));
    formData.set("brand_primary", primary);
    formData.set("brand_background", background);
    formData.set("font_id", fontId);
    formData.set("logo_asset_id", logo?.id ?? "");
    formData.set("logo_enabled", String(logoEnabled));
    formData.set("logo_opacity", String(logoOpacity));
    formData.set("logo_scale", String(logoScale));
    formData.set("intro_enabled", String(introEnabled));
    formData.set("outro_enabled", String(outroEnabled));
    formData.set("bgm_asset_id", bgm?.id ?? "");
    formData.set("bgm_volume", String(bgmVolume));
    formData.set("bgm_ducking", String(ducking));
    formData.set("sound_effects", JSON.stringify(effects.map((effect) => ({
      asset_id: effect.asset.id,
      start_seconds: effect.startSeconds,
      volume: effect.volume,
    }))));
    Object.entries(extra).forEach(([key, value]) => {
      formData.set(key, typeof value === "string" ? value : String(value));
    });

    try {
      const response = await fetch("/api/video", { method: "POST", body: formData });
      const result = await response.json() as RenderJob & { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Render job could not be started.");
      onJob(result);
      window.localStorage.setItem("recapkit-job-id", result.id);
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : "Render job could not be started.");
    }
  }

  return (
    <>
    <section className="phase2-section panel" id="phase2" aria-labelledby="phase2-title">
      <div className="phase2-heading">
        <div><span className="section-kicker">PHASE 2 / CREATOR TOOLS</span><h2 id="phase2-title">Build your video’s look and sound</h2></div>
        <span className="phase2-pill">Local export tools</span>
      </div>
      <div className="phase2-tabs" role="tablist" aria-label="Phase 2 creator tools">
        {tabs.map((tab) => (
          <button type="button" role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "active" : ""} key={tab.id} onClick={() => onActiveTabChange(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === "elements" && <ElementsPanel elements={elements} onChange={setElements} />}
      {activeTab === "brand" && (
        <BrandKitPanel
          primary={primary} background={background} logo={logo} logoEnabled={logoEnabled} logoOpacity={logoOpacity}
          logoScale={logoScale} introEnabled={introEnabled} outroEnabled={outroEnabled} fontId={fontId}
          onChange={(changes) => {
            if (changes.primary !== undefined) setPrimary(changes.primary);
            if (changes.background !== undefined) setBackground(changes.background);
            if (changes.logoEnabled !== undefined) setLogoEnabled(changes.logoEnabled);
            if (changes.logoOpacity !== undefined) setLogoOpacity(changes.logoOpacity);
            if (changes.logoScale !== undefined) setLogoScale(changes.logoScale);
            if (changes.introEnabled !== undefined) setIntroEnabled(changes.introEnabled);
            if (changes.outroEnabled !== undefined) setOutroEnabled(changes.outroEnabled);
            if (changes.fontId !== undefined) setFontId(changes.fontId);
          }}
          onUploadLogo={uploadLogo}
        />
      )}
      {activeTab === "audio" && (
        <AudioTracksPanel
          bgm={bgm} bgmVolume={bgmVolume} ducking={ducking} effects={effects}
          onBgmUpload={(file) => uploadAudio(file, "bgm")}
          onEffectUpload={(file) => uploadAudio(file, "effect")}
          onChange={(changes) => {
            if (changes.bgmVolume !== undefined) setBgmVolume(changes.bgmVolume);
            if (changes.ducking !== undefined) setDucking(changes.ducking);
            if (changes.effects !== undefined) setEffects(changes.effects);
          }}
        />
      )}
      {activeTab === "images" && (
        <ImageToVideoPanel
          images={images} duration={imageDuration} motion={imageMotion} onUpload={uploadImages}
          onChange={(changes) => {
            if (changes.duration !== undefined) setImageDuration(changes.duration);
            if (changes.motion !== undefined) setImageMotion(changes.motion);
          }}
          onCreate={() => void submit("image-to-video", {
            image_asset_ids: JSON.stringify(images.map((image) => image.id)),
            image_duration: imageDuration,
            image_motion: imageMotion,
          })}
          disabled={renderBusy}
        />
      )}
      {activeTab === "magic" && (
        <MagicToolsPanel
          hasVideo={Boolean(uploadId)} batchCount={batchVideos.length} batchBusy={batchBusy}
          onBatchFiles={uploadBatch}
          onRun={(operation, options) => {
            if (operation === "batch-export") {
              void submit(operation, { batch_upload_ids: JSON.stringify(batchVideos.map((video) => video.id)) });
            } else {
              void submit(operation, options?.faceCenter ? { face_center: true } : {});
            }
          }}
          disabled={renderBusy}
        />
      )}
      {activeTab === "elements" && <button className="button button-primary phase2-export-button" type="button" disabled={!uploadId || renderBusy} onClick={() => void submit("export-video")}>Export with current elements and brand kit</button>}
      {activeTab === "brand" && <button className="button button-primary phase2-export-button" type="button" disabled={!uploadId || renderBusy} onClick={() => void submit("export-video")}>Export with Brand Kit</button>}
      {activeTab === "audio" && <button className="button button-primary phase2-export-button" type="button" disabled={!uploadId || renderBusy} onClick={() => void submit("export-video")}>Export with audio tracks</button>}
      {activeTab === "magic" && batchVideos.length > 0 && <div className="phase2-batch-list">{batchVideos.map((video) => <span key={video.id}>{video.filename}<button type="button" aria-label={`Remove ${video.filename}`} onClick={() => setBatchVideos((current) => current.filter((item) => item.id !== video.id))}>×</button></span>)}</div>}
    </section>
    <Phase3Studio
      hasVideo={Boolean(uploadId)}
      busy={renderBusy}
      job={job}
      currentTemplate={currentTemplate}
      appliedTemplateId={appliedTemplate?.id ?? null}
      editorContext={`Aspect ratio: ${templateRatio}\nPrimary color: ${primary}\nText animation: ${textAnimation}`}
      onTemplateApply={(template) => {
        setPrimary(template.brandPrimary);
        setBackground(template.brandBackground);
        setIntroEnabled(template.introEnabled);
        setOutroEnabled(template.outroEnabled);
        if (template.fontId) setFontId(template.fontId);
        if (template.logo) setLogo(template.logo);
        setLogoEnabled(template.logoEnabled);
        setLogoOpacity(template.logoOpacity);
        setLogoScale(template.logoScale);
        if (template.bgm) setBgm(template.bgm);
        setBgmVolume(template.bgmVolume);
        setDucking(template.bgmDucking);
        setElements(template.elements.map((element) => ({ ...element, id: crypto.randomUUID() })));
        onTemplateApply(template);
      }}
      onRun={(operation, values) => void submit(operation, values)}
      onApplyScript={onApplyScript}
      onApplySubtitles={onApplySubtitles}
      activeTab={activePhase3Tab}
      onActiveTabChange={onPhase3TabChange}
    />
    </>
  );
}
