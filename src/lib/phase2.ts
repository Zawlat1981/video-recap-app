export type RenderOperation =
  | "extract-audio"
  | "trim-video"
  | "burn-subtitles"
  | "split-video"
  | "merge-clips"
  | "create-recap-dub"
  | "hide-sub"
  | "export-video"
  | "image-to-video"
  | "auto-cut-silence"
  | "magic-resize"
  | "remove-green-screen"
  | "batch-export"
  | "ai-script"
  | "auto-highlights"
  | "subtitle-timing"
  | "angel-chat"
  | "seo-metadata"
  | "export-pro"
  | "export-pro-batch"
  | "story-script"
  | "script-voiceover";

export type RenderJob = {
  id: string;
  operation: RenderOperation;
  status: "queued" | "running" | "completed" | "failed";
  result_text: string | null;
  output_url: string | null;
  error: string | null;
};

export type AssetInfo = {
  id: string;
  filename: string;
  asset_url: string;
  category: "image" | "audio";
};

export type ElementKind =
  | "heart"
  | "star"
  | "sparkle"
  | "happy"
  | "sad"
  | "angry"
  | "shock"
  | "laugh"
  | "tractor"
  | "lower-third"
  | "bubble";

export type ElementOverlay = {
  id: string;
  kind: ElementKind;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  start_seconds: number;
  end_seconds: number;
  text: string;
  subtitle: string;
};
