import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const voices = ["my-MM-NilarNeural", "my-MM-ThihaNeural"] as const;
const fonts = ["Noto Sans Myanmar", "Myanmar Text", "Arial"] as const;
const colors = ["white", "yellow", "cyan"] as const;
const positions = ["top", "center", "bottom"] as const;
const hideMethods = ["blur", "blackbox", "crop"] as const;
const templateRatios = ["16:9", "9:16", "1:1"] as const;
const textAnimations = ["none", "fade", "slide", "pop", "typewriter"] as const;
const elementKinds = [
  "heart", "star", "sparkle", "happy", "sad", "angry", "shock", "laugh",
  "tractor", "lower-third", "bubble",
] as const;
const imageMotions = ["zoom-in", "zoom-out", "pan-left", "pan-right", "zoom-pan"] as const;
const exportPresets = [
  "youtube-1080", "youtube-4k", "tiktok", "youtube-shorts", "instagram-square", "facebook-portrait",
] as const;
const aiLanguages = ["th", "my", "en"] as const;

const features = [
  { id: "audio-myanmar", name: "Recap TTS and direct dubbing", execution: "backend" },
  { id: "script-voiceover", name: "Speak supplied Burmese script and burn subtitles", execution: "backend" },
  { id: "subtitle", name: "Myanmar subtitle render", execution: "backend" },
  { id: "merge-clips", name: "Join and normalize multiple video clips", execution: "backend" },
  { id: "hide-sub", name: "Hide original subtitles", execution: "backend" },
  { id: "template", name: "Aspect-ratio video export", execution: "backend" },
  { id: "text", name: "Animated text video export", execution: "backend" },
  { id: "angel-chat", name: "Angel chat controls", execution: "frontend" },
  { id: "elements", name: "Export sticker and text elements", execution: "backend" },
  { id: "brand-kit", name: "Brand colors and logo watermark", execution: "backend" },
  { id: "audio-mix", name: "Background music and sound effects", execution: "backend" },
  { id: "image-to-video", name: "Image slideshow and Ken Burns export", execution: "backend" },
  { id: "magic-tools", name: "Silence cut, resize, chroma key, and batch export", execution: "backend" },
  { id: "templates-pro", name: "24 creator templates with local custom presets", execution: "frontend" },
  { id: "ai-pro", name: "Whisper recap scripts, timed subtitles, highlights, and Angel", execution: "backend" },
  { id: "export-pro", name: "YouTube, TikTok, Instagram, Facebook, and 4K exports", execution: "backend" },
  { id: "story-studio", name: "Original Burmese story scripts with editable chapter outlines", execution: "backend" },
] as const;

function formText(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value : fallback;
}

function integerField(formData: FormData, key: string, fallback: number) {
  const value = Number(formText(formData, key, String(fallback)));
  return Number.isInteger(value) ? value : Number.NaN;
}

function booleanField(formData: FormData, key: string, fallback = false) {
  const value = formText(formData, key, String(fallback));
  return value === "true" || value === "1";
}

function jsonArray(formData: FormData, key: string, limit: number): unknown[] | null {
  try {
    const value: unknown = JSON.parse(formText(formData, key, "[]"));
    return Array.isArray(value) && value.length <= limit ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validElements(items: unknown[]) {
  return items.every((item) => {
    if (!isRecord(item) || typeof item.kind !== "string"
      || !elementKinds.includes(item.kind as (typeof elementKinds)[number])) return false;
    const numberInRange = (key: string, min: number, max: number) =>
      typeof item[key] === "number" && Number.isFinite(item[key]) && item[key] >= min && item[key] <= max;
    return numberInRange("x", 0, 1)
      && numberInRange("y", 0, 1)
      && numberInRange("scale", 0.2, 2)
      && numberInRange("rotation", -180, 180)
      && numberInRange("start_seconds", 0, 86_400)
      && numberInRange("end_seconds", 0.1, 86_400)
      && typeof item.start_seconds === "number"
      && typeof item.end_seconds === "number"
      && item.end_seconds > item.start_seconds
      && (item.text === undefined || (typeof item.text === "string" && item.text.length <= 100))
      && (item.subtitle === undefined || (typeof item.subtitle === "string" && item.subtitle.length <= 100));
  });
}

function validSoundEffects(items: unknown[]) {
  return items.every((item) => isRecord(item)
    && typeof item.asset_id === "string" && /^[a-f0-9]{32}$/.test(item.asset_id)
    && typeof item.start_seconds === "number" && Number.isFinite(item.start_seconds)
    && item.start_seconds >= 0 && item.start_seconds <= 86_400
    && typeof item.volume === "number" && Number.isFinite(item.volume)
    && item.volume >= 0 && item.volume <= 1);
}

export async function GET() {
  return NextResponse.json({ phase: "Phase 3", features });
}

export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ detail: "A valid form-data request is required." }, { status: 400 });
  }

  const action = formText(formData, "action");
  const uploadId = formText(formData, "upload_id");
  const usesBatchUploads = action === "batch-export" || action === "export-pro-batch";
  const usesMergeClips = action === "merge-clips";
  const usesImageAssets = action === "image-to-video";
  const usesNoVideo = action === "angel-chat" || action === "seo-metadata" || action === "story-script";
  if (!usesBatchUploads && !usesMergeClips && !usesImageAssets && !usesNoVideo && !/^[a-f0-9]{32}$/.test(uploadId)) {
    return NextResponse.json({ detail: "Upload a video before starting this action." }, { status: 400 });
  }

  const templateRatio = formText(formData, "template_ratio", "16:9");
  const textOverlay = formText(formData, "text_overlay");
  const textAnimation = formText(formData, "text_animation", "none");
  const textPosition = formText(formData, "text_position", "bottom");
  const textSize = integerField(formData, "text_size", 48);
  const textColor = formText(formData, "text_color", "white");
  const brandPrimary = formText(formData, "brand_primary", "#FF6600");
  const brandBackground = formText(formData, "brand_background", "#172A3A");
  const bgmAssetId = formText(formData, "bgm_asset_id");
  const logoAssetId = formText(formData, "logo_asset_id");
  const fontId = formText(formData, "font_id");
  const elements = jsonArray(formData, "elements", 30);
  const soundEffects = jsonArray(formData, "sound_effects", 10);
  const logoOpacity = Number(formText(formData, "logo_opacity", "0.8"));
  const logoScale = Number(formText(formData, "logo_scale", "0.16"));
  const bgmVolume = Number(formText(formData, "bgm_volume", "0.2"));
  if (!templateRatios.includes(templateRatio as (typeof templateRatios)[number])
    || !textAnimations.includes(textAnimation as (typeof textAnimations)[number])
    || !positions.includes(textPosition as (typeof positions)[number])
    || !colors.includes(textColor as (typeof colors)[number])
    || !Number.isInteger(textSize) || textSize < 18 || textSize > 120
    || textOverlay.length > 500
    || !/^#[0-9a-f]{6}$/i.test(brandPrimary)
    || !/^#[0-9a-f]{6}$/i.test(brandBackground)
    || !elements || !soundEffects
    || !validElements(elements) || !validSoundEffects(soundEffects)
    || !Number.isFinite(logoOpacity) || logoOpacity < 0 || logoOpacity > 1
    || !Number.isFinite(logoScale) || logoScale < 0.05 || logoScale > 0.5
    || !Number.isFinite(bgmVolume) || bgmVolume < 0 || bgmVolume > 1
    || (bgmAssetId !== "" && !/^[a-f0-9]{32}$/.test(bgmAssetId))
    || (logoAssetId !== "" && !/^[a-f0-9]{32}$/.test(logoAssetId))
    || (fontId !== "" && !/^[A-Za-z0-9._ -]{1,120}$/.test(fontId))
    || (booleanField(formData, "logo_enabled") && !logoAssetId)) {
    return NextResponse.json({ detail: "Video template or text settings are invalid." }, { status: 422 });
  }
  const designOptions = {
    template_ratio: templateRatio,
    text_overlay: textOverlay,
    text_animation: textAnimation,
    text_position: textPosition,
    text_size: textSize,
    text_color: textColor,
    font_id: fontId || null,
    elements,
    logo_asset_id: logoAssetId || null,
    logo_enabled: booleanField(formData, "logo_enabled"),
    logo_opacity: logoOpacity,
    logo_scale: logoScale,
    intro_enabled: booleanField(formData, "intro_enabled"),
    outro_enabled: booleanField(formData, "outro_enabled"),
    brand_primary: brandPrimary,
    brand_background: brandBackground,
    bgm_asset_id: bgmAssetId || null,
    bgm_volume: bgmVolume,
    bgm_ducking: booleanField(formData, "bgm_ducking", true),
    sound_effects: soundEffects,
  };

  let payload: Record<string, unknown>;
  if (action === "audio-myanmar") {
    const mode = formText(formData, "mode", "recap");
    const sourceLanguage = formText(formData, "source_language", "th");
    const voice = formText(formData, "voice", voices[0]);
    const recapSeconds = integerField(formData, "recap_seconds", 600);
    const backgroundVolume = integerField(formData, "background_volume", 20);
    if (!voices.includes(voice as (typeof voices)[number])) {
      return NextResponse.json({ detail: "Choose a supported Myanmar voice." }, { status: 422 });
    }
    if (mode !== "recap" && mode !== "dubbing") {
      return NextResponse.json({ detail: "Choose Recap TTS or direct dubbing mode." }, { status: 422 });
    }
    if (!aiLanguages.includes(sourceLanguage as (typeof aiLanguages)[number])) {
      return NextResponse.json({ detail: "Choose Thai, Myanmar, or English as the source speech language." }, { status: 422 });
    }
    if (![30, 60, 120, 300, 420, 600].includes(recapSeconds)) {
      return NextResponse.json({ detail: "Choose a supported recap length." }, { status: 422 });
    }
    if (!Number.isInteger(backgroundVolume) || backgroundVolume < 0 || backgroundVolume > 100) {
      return NextResponse.json({ detail: "Background volume must be between 0 and 100." }, { status: 422 });
    }
    payload = {
      upload_id: uploadId,
      operation: "create-recap-dub",
      mode,
      source_language: sourceLanguage,
      subtitle_srt: formText(formData, "subtitle_srt"),
      voice,
      recap_seconds: recapSeconds,
      include_original_audio: formText(formData, "include_original_audio", "true") === "true",
      background_volume: backgroundVolume,
      ...designOptions,
    };
  } else if (action === "script-voiceover") {
    const script = formText(formData, "script_text").trim();
    const subtitleSrt = formText(formData, "subtitle_srt").trim();
    const voice = formText(formData, "voice", voices[0]);
    const fontFamily = formText(formData, "font_family", "Noto Sans Myanmar");
    const fontSize = integerField(formData, "font_size", 32);
    const fontColor = formText(formData, "font_color", "white");
    const position = formText(formData, "position", "bottom");
    const outline = integerField(formData, "outline", 2);
    const backgroundVolume = integerField(formData, "background_volume", 0);
    if (!script || script.length > 12000 || !subtitleSrt || subtitleSrt.length > 200000 || !subtitleSrt.includes("-->")) {
      return NextResponse.json({ detail: "Enter the Burmese narration and timed SRT subtitles." }, { status: 422 });
    }
    if (!voices.includes(voice as (typeof voices)[number])
      || !fonts.includes(fontFamily as (typeof fonts)[number])
      || !colors.includes(fontColor as (typeof colors)[number])
      || !positions.includes(position as (typeof positions)[number])
      || !Number.isInteger(fontSize) || fontSize < 16 || fontSize > 80
      || !Number.isInteger(outline) || outline < 0 || outline > 8
      || !Number.isInteger(backgroundVolume) || backgroundVolume < 0 || backgroundVolume > 100) {
      return NextResponse.json({ detail: "Voice or subtitle style settings are invalid." }, { status: 422 });
    }
    payload = {
      upload_id: uploadId,
      operation: action,
      script_text: script,
      subtitle_srt: subtitleSrt,
      voice,
      include_original_audio: booleanField(formData, "include_original_audio"),
      background_volume: backgroundVolume,
      font_family: fontFamily,
      font_size: fontSize,
      font_color: fontColor,
      position,
      outline,
      ...designOptions,
    };
  } else if (action === "subtitle") {
    const subtitleSrt = formText(formData, "subtitle_srt");
    const fontFamily = formText(formData, "font_family", "Myanmar Text");
    const fontSize = integerField(formData, "font_size", 32);
    const fontColor = formText(formData, "font_color", "white");
    const position = formText(formData, "position", "bottom");
    const outline = integerField(formData, "outline", 2);
    if (!subtitleSrt.trim() || subtitleSrt.length > 200_000 || !subtitleSrt.includes("-->")) {
      return NextResponse.json({ detail: "Valid SRT subtitle text with timecodes is required." }, { status: 422 });
    }
    if (!fonts.includes(fontFamily as (typeof fonts)[number])
      || !colors.includes(fontColor as (typeof colors)[number])
      || !positions.includes(position as (typeof positions)[number])
      || !Number.isInteger(fontSize) || fontSize < 16 || fontSize > 80
      || !Number.isInteger(outline) || outline < 0 || outline > 8) {
      return NextResponse.json({ detail: "Subtitle style settings are invalid." }, { status: 422 });
    }
    payload = {
      upload_id: uploadId,
      operation: "burn-subtitles",
      subtitle_srt: subtitleSrt,
      font_family: fontFamily,
      font_size: fontSize,
      font_color: fontColor,
      position,
      outline,
      ...designOptions,
    };
  } else if (action === "hide-sub") {
    const method = formText(formData, "method", "blur");
    if (!hideMethods.includes(method as (typeof hideMethods)[number])) {
      return NextResponse.json({ detail: "Choose blur, blackbox, or crop." }, { status: 422 });
    }
    payload = { upload_id: uploadId, operation: "hide-sub", hide_method: method, ...designOptions };
  } else if (action === "export-video") {
    payload = { upload_id: uploadId, operation: "export-video", ...designOptions };
  } else if (action === "image-to-video") {
    const imageAssetIds = jsonArray(formData, "image_asset_ids", 10);
    const motion = formText(formData, "image_motion", "zoom-in");
    const imageDuration = integerField(formData, "image_duration", 5);
    if (!imageAssetIds || imageAssetIds.length < 1
      || imageAssetIds.some((id) => typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id))
      || !imageMotions.includes(motion as (typeof imageMotions)[number])
      || imageDuration < 3 || imageDuration > 10) {
      return NextResponse.json({ detail: "Image video settings are invalid." }, { status: 422 });
    }
    payload = {
      upload_id: "0".repeat(32),
      operation: "image-to-video",
      image_asset_ids: imageAssetIds,
      image_duration: imageDuration,
      image_motion: motion,
      ...designOptions,
    };
  } else if (action === "auto-cut-silence") {
    const minimumSilence = Number(formText(formData, "minimum_silence", "1"));
    const threshold = integerField(formData, "silence_threshold_db", -40);
    if (!Number.isFinite(minimumSilence) || minimumSilence < 1 || minimumSilence > 10
      || threshold < -60 || threshold > -20) {
      return NextResponse.json({ detail: "Silence detection settings are invalid." }, { status: 422 });
    }
    payload = {
      upload_id: uploadId,
      operation: action,
      minimum_silence: minimumSilence,
      silence_threshold_db: threshold,
      ...designOptions,
    };
  } else if (action === "magic-resize") {
    payload = {
      upload_id: uploadId,
      operation: action,
      face_center: booleanField(formData, "face_center"),
      ...designOptions,
    };
  } else if (action === "remove-green-screen") {
    payload = { upload_id: uploadId, operation: action, ...designOptions };
  } else if (action === "batch-export") {
    const batchUploadIds = jsonArray(formData, "batch_upload_ids", 10);
    if (!batchUploadIds || batchUploadIds.length < 1
      || batchUploadIds.some((id) => typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id))) {
      return NextResponse.json({ detail: "Select one to ten valid videos for batch export." }, { status: 422 });
    }
    payload = {
      upload_id: "0".repeat(32),
      operation: action,
      batch_upload_ids: batchUploadIds,
      ...designOptions,
    };
  } else if (action === "merge-clips") {
    const mergeClipIds = jsonArray(formData, "merge_clip_ids", 10);
    if (!mergeClipIds || mergeClipIds.length < 2
      || mergeClipIds.some((id) => typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id))
      || new Set(mergeClipIds).size !== mergeClipIds.length) {
      return NextResponse.json({ detail: "Select two to ten unique video clips in merge order." }, { status: 422 });
    }
    payload = {
      upload_id: "0".repeat(32),
      operation: action,
      merge_clip_ids: mergeClipIds,
    };
  } else if (action === "ai-script") {
    const duration = integerField(formData, "ai_script_seconds", 60);
    const language = formText(formData, "ai_language", "th");
    if (!Number.isInteger(duration) || duration < 30 || duration > 120
      || !aiLanguages.includes(language as (typeof aiLanguages)[number])) {
      return NextResponse.json({ detail: "AI recap language or duration is invalid." }, { status: 422 });
    }
    payload = { upload_id: uploadId, operation: action, ai_script_seconds: duration, ai_language: language };
  } else if (action === "subtitle-timing") {
    const language = formText(formData, "ai_language", "th");
    if (!aiLanguages.includes(language as (typeof aiLanguages)[number])) {
      return NextResponse.json({ detail: "Choose a supported subtitle transcription language." }, { status: 422 });
    }
    payload = { upload_id: uploadId, operation: action, ai_language: language };
  } else if (action === "auto-highlights") {
    const targetSeconds = integerField(formData, "target_seconds", 60);
    if (!Number.isInteger(targetSeconds) || targetSeconds < 15 || targetSeconds > 60) {
      return NextResponse.json({ detail: "Highlight duration must be between 15 and 60 seconds." }, { status: 422 });
    }
    payload = { upload_id: uploadId, operation: action, target_seconds: targetSeconds };
  } else if (action === "angel-chat") {
    const prompt = formText(formData, "ai_prompt").trim();
    const context = formText(formData, "ai_context");
    if (!prompt || prompt.length > 2000 || context.length > 4000) {
      return NextResponse.json({ detail: "Angel prompts and editor context are invalid." }, { status: 422 });
    }
    payload = { upload_id: "0".repeat(32), operation: action, ai_prompt: prompt, ai_context: context };
  } else if (action === "seo-metadata") {
    const script = formText(formData, "ai_script").trim();
    if (!script || script.length > 12000) {
      return NextResponse.json({ detail: "Enter a recap script up to 12,000 characters." }, { status: 422 });
    }
    payload = { upload_id: "0".repeat(32), operation: action, ai_script: script };
  } else if (action === "story-script") {
    const idea = formText(formData, "ai_prompt").trim();
    const genre = formText(formData, "story_genre", "drama").trim();
    const chapters = integerField(formData, "story_chapters", 5);
    if (!idea || idea.length > 2000 || !genre || genre.length > 40
      || !Number.isInteger(chapters) || chapters < 3 || chapters > 12) {
      return NextResponse.json({ detail: "Enter a story idea, choose a genre, and select 3 to 12 chapters." }, { status: 422 });
    }
    payload = {
      upload_id: "0".repeat(32),
      operation: action,
      ai_prompt: idea,
      story_genre: genre,
      story_chapters: chapters,
    };
  } else if (action === "export-pro" || action === "export-pro-batch") {
    const preset = formText(formData, "export_preset", "tiktok");
    if (!exportPresets.includes(preset as (typeof exportPresets)[number])) {
      return NextResponse.json({ detail: "Choose a supported export preset." }, { status: 422 });
    }
    const presetOptions = {
      export_preset: preset,
      face_center: booleanField(formData, "face_center"),
      ...designOptions,
    };
    if (action === "export-pro") {
      payload = { upload_id: uploadId, operation: action, ...presetOptions };
    } else {
      const batchUploadIds = jsonArray(formData, "batch_upload_ids", 10);
      if (!batchUploadIds || batchUploadIds.length < 1
        || batchUploadIds.some((id) => typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id))) {
        return NextResponse.json({ detail: "Select one to ten valid videos for pro batch export." }, { status: 422 });
      }
      payload = {
        upload_id: "0".repeat(32),
        operation: action,
        batch_upload_ids: batchUploadIds,
        ...presetOptions,
      };
    }
  } else {
    return NextResponse.json({ detail: "This action is not available as a server render." }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE_URL}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { detail: "The video backend is unavailable. Start the FastAPI server and try again." },
      { status: 502 },
    );
  }

  let result: unknown;
  try {
    result = await upstream.json();
  } catch {
    return NextResponse.json({ detail: "The video backend returned an invalid response." }, { status: 502 });
  }
  return NextResponse.json(result, { status: upstream.status });
}
