import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const voices = ["my-MM-NilarNeural", "my-MM-ThihaNeural"] as const;
const fonts = ["Noto Sans Myanmar", "Myanmar Text", "Arial"] as const;
const colors = ["white", "yellow", "cyan"] as const;
const positions = ["top", "center", "bottom"] as const;
const hideMethods = ["blur", "blackbox", "crop"] as const;
const templateRatios = ["16:9", "9:16", "1:1"] as const;
const textAnimations = ["none", "fade", "slide", "pop"] as const;

const features = [
  { id: "audio-myanmar", name: "Recap TTS and direct dubbing", execution: "backend" },
  { id: "subtitle", name: "Myanmar subtitle render", execution: "backend" },
  { id: "hide-sub", name: "Hide original subtitles", execution: "backend" },
  { id: "template", name: "Aspect-ratio video export", execution: "backend" },
  { id: "text", name: "Animated text video export", execution: "backend" },
  { id: "angel-chat", name: "Angel chat controls", execution: "frontend" },
] as const;

function formText(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value : fallback;
}

function integerField(formData: FormData, key: string, fallback: number) {
  const value = Number(formText(formData, key, String(fallback)));
  return Number.isInteger(value) ? value : Number.NaN;
}

export async function GET() {
  return NextResponse.json({ phase: "Phase 1", features });
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
  if (!/^[a-f0-9]{32}$/.test(uploadId)) {
    return NextResponse.json({ detail: "Upload a video before starting this action." }, { status: 400 });
  }

  const templateRatio = formText(formData, "template_ratio", "16:9");
  const textOverlay = formText(formData, "text_overlay");
  const textAnimation = formText(formData, "text_animation", "none");
  const textPosition = formText(formData, "text_position", "bottom");
  const textSize = integerField(formData, "text_size", 48);
  const textColor = formText(formData, "text_color", "white");
  if (!templateRatios.includes(templateRatio as (typeof templateRatios)[number])
    || !textAnimations.includes(textAnimation as (typeof textAnimations)[number])
    || !positions.includes(textPosition as (typeof positions)[number])
    || !colors.includes(textColor as (typeof colors)[number])
    || !Number.isInteger(textSize) || textSize < 18 || textSize > 120
    || textOverlay.length > 500) {
    return NextResponse.json({ detail: "Video template or text settings are invalid." }, { status: 422 });
  }
  const designOptions = {
    template_ratio: templateRatio,
    text_overlay: textOverlay,
    text_animation: textAnimation,
    text_position: textPosition,
    text_size: textSize,
    text_color: textColor,
  };

  let payload: Record<string, string | number | boolean>;
  if (action === "audio-myanmar") {
    const mode = formText(formData, "mode", "recap");
    const voice = formText(formData, "voice", voices[0]);
    const recapSeconds = integerField(formData, "recap_seconds", 600);
    const backgroundVolume = integerField(formData, "background_volume", 20);
    if (!voices.includes(voice as (typeof voices)[number])) {
      return NextResponse.json({ detail: "Choose a supported Myanmar voice." }, { status: 422 });
    }
    if (mode !== "recap" && mode !== "dubbing") {
      return NextResponse.json({ detail: "Choose Recap TTS or direct dubbing mode." }, { status: 422 });
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
      subtitle_srt: formText(formData, "subtitle_srt"),
      voice,
      recap_seconds: recapSeconds,
      include_original_audio: formText(formData, "include_original_audio", "true") === "true",
      background_volume: backgroundVolume,
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
