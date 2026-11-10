"use client";

import {
  ArrowUpRight,
  AudioLines,
  AudioWaveform,
  Check,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Cloud,
  CloudUpload,
  Download,
  FileVideo,
  Film,
  FolderOpen,
  EyeOff,
  Image,
  LayoutTemplate,
  Languages,
  LoaderCircle,
  MessageCircle,
  Mic2,
  MessageSquareText,
  Scissors,
  Settings,
  Sparkles,
  Subtitles,
  Type,
  Volume2,
  Wand2,
  X,
} from "lucide-react";
import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { AngelChatBubble, AngelHalo } from "../components/AngelHalo";
import { Phase2Studio } from "../components/Phase2Studio";
import type { Phase2Tab } from "../components/Phase2Studio";
import type { Phase3Tab } from "../components/Phase3Studio";
import type { RenderJob } from "../lib/phase2";
import type { CreatorTemplate } from "../lib/templates";
import { API_BASE_URL, backendAuthHeaders, backendUrl, getBackendApiKey, saveBackendApiKey } from "../lib/api";

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
const modes = [
  { id: "recap", name: "Movie recap", detail: "Turn a full story into a short recap", icon: Film },
  { id: "dialogue", name: "Talking clip", detail: "Keep the conversation in focus", icon: MessageSquareText },
  { id: "captions", name: "Captions only", detail: "Prepare a clean subtitle video", icon: Subtitles },
] as const;

const tools = [
  { name: "Video splitter", description: "Cut a video into timed clips", icon: Scissors, tone: "mint", ready: true },
  { name: "Clip merger", description: "Join up to 10 clips into one MP4", icon: Clapperboard, tone: "blue", ready: true },
  { name: "Movie recap", description: "Draft a Burmese recap narration", icon: Mic2, tone: "lilac", ready: true },
  { name: "Auto captions", description: "Generate timed subtitles", icon: Subtitles, tone: "mint" },
  { name: "Subtitle translate", description: "Work with SRT and translations", icon: Languages, tone: "lilac" },
  { name: "Video audio sync", description: "Line up voice and video", icon: AudioLines, tone: "coral" },
  { name: "Audio dub", description: "Generate a Burmese voiceover", icon: Volume2, tone: "blue", ready: true },
] as const;

type UploadState = "idle" | "uploading" | "uploaded" | "error";
type VoiceoverMode = "recap" | "dubbing";
type SourceLanguage = "th" | "my" | "en";
type TextAnimation = "none" | "fade" | "slide" | "pop" | "typewriter";

type Phase1Action = "audio-myanmar" | "subtitle" | "hide-sub" | "script-voiceover";
type AngelMessage = { role: "angel" | "user"; text: string };
type TemplateRatio = "16:9" | "9:16" | "1:1";
type WorkspaceDestination =
  | "source" | "recap" | "captions" | "voice" | "trim" | "merge" | "audio"
  | "elements" | "brand" | "images" | "magic" | "templates" | "ai" | "story" | "export";

const workspaceGroups = [
  {
    title: "PROJECT",
    items: [
      { id: "source", label: "Media & preview", icon: FolderOpen },
      { id: "trim", label: "Trim a clip", icon: Scissors },
      { id: "merge", label: "Cut & join clips", icon: Scissors },
    ],
  },
  {
    title: "EDIT",
    items: [
      { id: "recap", label: "Recap & dubbing", icon: Film },
      { id: "captions", label: "Myanmar subtitles", icon: Subtitles },
      { id: "voice", label: "Voice & narration", icon: Mic2 },
      { id: "audio", label: "Music & sound", icon: AudioWaveform },
    ],
  },
  {
    title: "DESIGN & EXPORT",
    items: [
      { id: "elements", label: "Elements", icon: Sparkles },
      { id: "brand", label: "Brand kit", icon: Type },
      { id: "templates", label: "Templates", icon: LayoutTemplate },
      { id: "images", label: "Image to video", icon: Image },
      { id: "magic", label: "Magic tools", icon: Wand2 },
      { id: "ai", label: "AI tools", icon: Wand2 },
      { id: "story", label: "Story studio", icon: MessageCircle },
      { id: "export", label: "Export video", icon: Download },
    ],
  },
] as const;

const templateAspectRatios: Record<TemplateRatio, string> = {
  "16:9": "16 / 9",
  "9:16": "9 / 16",
  "1:1": "1 / 1",
};

const renderMessages: Record<RenderJob["operation"], { running: string; completed: string; extension: string }> = {
  "extract-audio": { running: "Extracting audio on the server...", completed: "Audio extraction complete", extension: "MP3" },
  "trim-video": { running: "Trimming the selected time range...", completed: "Video trim complete", extension: "MP4" },
  "burn-subtitles": { running: "Rendering subtitles on the server...", completed: "Subtitle render complete", extension: "MP4" },
  "split-video": { running: "Splitting video on the server...", completed: "Video split complete", extension: "ZIP" },
  "merge-clips": { running: "Joining clips into one video...", completed: "Clips joined successfully", extension: "MP4" },
  "create-recap-dub": { running: "Creating the Burmese voiceover...", completed: "Burmese voiceover complete", extension: "MP4" },
  "hide-sub": { running: "Hiding the original subtitles...", completed: "Original subtitles hidden", extension: "MP4" },
  "export-video": { running: "Exporting the video design...", completed: "Video design export complete", extension: "MP4" },
  "image-to-video": { running: "Creating a Ken Burns image video...", completed: "Image video export complete", extension: "MP4" },
  "auto-cut-silence": { running: "Detecting and removing long pauses...", completed: "Silence cut complete", extension: "MP4" },
  "magic-resize": { running: "Resizing and centering the video...", completed: "Magic resize complete", extension: "MP4" },
  "remove-green-screen": { running: "Keying the green-screen background...", completed: "Green-screen key complete", extension: "MP4" },
  "batch-export": { running: "Applying the design to each video...", completed: "Batch export complete", extension: "ZIP" },
  "ai-script": { running: "Transcribing dialogue and drafting recap scenes...", completed: "AI recap script complete", extension: "JSON" },
  "auto-highlights": { running: "Scoring audio and assembling highlight moments...", completed: "Highlight reel complete", extension: "MP4" },
  "subtitle-timing": { running: "Transcribing speech and aligning subtitle cues...", completed: "Timed subtitles complete", extension: "SRT" },
  "angel-chat": { running: "Angel is preparing editor suggestions...", completed: "Angel suggestions ready", extension: "TEXT" },
  "seo-metadata": { running: "Writing Burmese title and description...", completed: "YouTube metadata ready", extension: "JSON" },
  "export-pro": { running: "Applying the selected export profile...", completed: "Pro export complete", extension: "MP4" },
  "export-pro-batch": { running: "Rendering the pro batch queue...", completed: "Pro batch export complete", extension: "ZIP" },
  "story-script": { running: "Angel is drafting your Burmese story...", completed: "Story script ready", extension: "TEXT" },
  "script-voiceover": { running: "Speaking your Burmese script and rendering timed subtitles...", completed: "Narration and subtitle video complete", extension: "MP4" },
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSrtTimestamp(milliseconds: number) {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const fraction = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(fraction).padStart(3, "0")}`;
}

function buildTimedSubtitleSrt(text: string, durationSeconds: number) {
  const trimmedText = text.trim();
  if (!trimmedText || trimmedText.includes("-->")) return trimmedText;

  const lines = trimmedText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return "";

  const durationMs = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? Math.max(1_000, Math.round(durationSeconds * 1_000))
    : lines.length * 3_000;

  return lines.map((line, index) => {
    const startMs = Math.floor(index * durationMs / lines.length);
    const endMs = Math.max(startMs + 1, Math.floor((index + 1) * durationMs / lines.length));
    return `${index + 1}\n${formatSrtTimestamp(startMs)} --> ${formatSrtTimestamp(endMs)}\n${line}`;
  }).join("\n\n");
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mergeFilesInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceFilename, setSourceFilename] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<(typeof modes)[number]["id"]>("recap");
  const [dragging, setDragging] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [renderJob, setRenderJob] = useState<RenderJob | null>(null);
  const [startingJob, setStartingJob] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [trimStartSeconds, setTrimStartSeconds] = useState(0);
  const [trimEndSeconds, setTrimEndSeconds] = useState(0);
  const [subtitleSrt, setSubtitleSrt] = useState("");
  const [narrationScript, setNarrationScript] = useState("");
  const [fontFamily, setFontFamily] = useState("Noto Sans Myanmar");
  const [fontSize, setFontSize] = useState(32);
  const [fontColor, setFontColor] = useState<"white" | "yellow" | "cyan">("white");
  const [subtitlePosition, setSubtitlePosition] = useState<"top" | "center" | "bottom">("bottom");
  const [outline, setOutline] = useState(2);
  const [segmentSeconds, setSegmentSeconds] = useState<30 | 60 | 120>(60);
  const [mergeFiles, setMergeFiles] = useState<File[]>([]);
  const [mergeUploading, setMergeUploading] = useState(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [promotingMerge, setPromotingMerge] = useState(false);
  const [recapSeconds, setRecapSeconds] = useState<number>(600);
  const [voiceoverMode, setVoiceoverMode] = useState<VoiceoverMode>("recap");
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>("th");
  const [voice, setVoice] = useState<"my-MM-NilarNeural" | "my-MM-ThihaNeural">("my-MM-NilarNeural");
  const [includeOriginalAudio, setIncludeOriginalAudio] = useState(true);
  const [backgroundVolume, setBackgroundVolume] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [hideMethod, setHideMethod] = useState<"blur" | "blackbox" | "crop">("blur");
  const [templateRatio, setTemplateRatio] = useState<TemplateRatio>("16:9");
  const [textOverlay, setTextOverlay] = useState("");
  const [textAnimation, setTextAnimation] = useState<TextAnimation>("none");
  const [textPosition, setTextPosition] = useState<"top" | "center" | "bottom">("bottom");
  const [textSize, setTextSize] = useState(48);
  const [textColor, setTextColor] = useState<"white" | "yellow" | "cyan">("white");
  const [appliedTemplate, setAppliedTemplate] = useState<CreatorTemplate | null>(null);
  const [activePhase2Tab, setActivePhase2Tab] = useState<Phase2Tab>("elements");
  const [activePhase3Tab, setActivePhase3Tab] = useState<Phase3Tab>("templates");
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceDestination>("source");
  const [chatInput, setChatInput] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKeySettings, setShowApiKeySettings] = useState(false);
  const [chatMessages, setChatMessages] = useState<AngelMessage[]>([
    { role: "angel", text: "Mingalaba! Upload a video, then ask me to add subtitles, hide the original subtitles, or create a Burmese recap voiceover." },
  ]);
  const textOverlayRef = useRef<HTMLInputElement>(null);
  const activeJobId = renderJob?.id;
  const activeJobStatus = renderJob?.status;
  const renderBusy = mergeUploading || promotingMerge || startingJob || activeJobStatus === "queued" || activeJobStatus === "running";

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  useEffect(() => {
    const savedUploadId = window.localStorage.getItem("recapkit-upload-id");
    const savedJobId = window.localStorage.getItem("recapkit-job-id");

    if (savedUploadId) {
      void Promise.resolve().then(() => setUploadId(savedUploadId));
    }
    if (!savedJobId) return;
    if (!API_BASE_URL) return;

    const controller = new AbortController();
    void fetch(`/api/jobs?job_id=${encodeURIComponent(savedJobId)}`, { signal: controller.signal, headers: backendAuthHeaders() })
      .then(async (response) => {
        if (response.status === 404) {
          window.localStorage.removeItem("recapkit-job-id");
          window.localStorage.removeItem("recapkit-upload-id");
          setUploadId(null);
          setUploadState("idle");
          setError("Render service ပြန်စတင်သွားတဲ့အတွက် ယာယီသိမ်းထားတဲ့ job/video ပျောက်သွားနိုင်ပါတယ်။ Video ကို ပြန်ရွေးပြီး Upload လုပ်ပါ။");
          return;
        }
        if (!response.ok) {
          const result = await response.json() as { detail?: string };
          throw new Error(result.detail ?? `Saved render job could not be loaded (${response.status}).`);
        }
        const savedJob = await response.json() as RenderJob;
        if (savedJob.status === "failed") {
          window.localStorage.removeItem("recapkit-job-id");
          return;
        }
        setRenderJob(savedJob);
      })
      .catch((restoreError: unknown) => {
        if (!controller.signal.aborted) {
          setError(restoreError instanceof Error ? restoreError.message : "Saved render job could not be loaded.");
        }
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!activeJobId || !activeJobStatus || activeJobStatus === "completed" || activeJobStatus === "failed") return;
    const jobId = activeJobId;

    const controller = new AbortController();
    let timeout: number;

    async function pollJob() {
      try {
        const response = await fetch(`/api/jobs?job_id=${encodeURIComponent(jobId)}`, { signal: controller.signal, headers: backendAuthHeaders() });
        if (response.status === 404) {
          window.localStorage.removeItem("recapkit-job-id");
          window.localStorage.removeItem("recapkit-upload-id");
          setRenderJob(null);
          setUploadId(null);
          setMediaUrl(null);
          setUploadState("idle");
          setProgress(0);
          setError("Render server မှာ ဒီ job ကို မတွေ့တော့ပါ။ Free server ပြန်စတင်ချိန် ယာယီ job/video ဖိုင်တွေ ပျောက်နိုင်ပါတယ်။ Video ကို ပြန် Upload လုပ်ပြီး ထပ်စမ်းပါ။");
          return;
        }
        if (!response.ok) {
          const result = await response.json() as { detail?: string };
          const message = result.detail ?? `Job status could not be loaded (${response.status}).`;
          if (response.status < 500) {
            window.localStorage.removeItem("recapkit-job-id");
            setRenderJob((current) => current ? { ...current, status: "failed", error: message } : current);
            setError(message);
            return;
          }
          throw new Error(message);
        }
        const updatedJob = await response.json() as RenderJob;
        setRenderJob(updatedJob);
        setError(null);
        if (updatedJob.status !== "completed" && updatedJob.status !== "failed") {
          timeout = window.setTimeout(pollJob, 1200);
        }
      } catch (pollError: unknown) {
        if (!controller.signal.aborted) {
          setError(pollError instanceof Error
            ? `${pollError.message} ပြန်လည်ချိတ်ဆက်နေပါတယ်။`
            : "Job status ကို ဖတ်မရပါ။ Server သို့ ပြန်လည်ချိတ်ဆက်နေပါတယ်။");
          timeout = window.setTimeout(pollJob, 2500);
        }
      }
    }

    timeout = window.setTimeout(pollJob, 1200);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [activeJobId, activeJobStatus]);

  function chooseFile(nextFile?: File) {
    if (!nextFile) return;
    const looksLikeVideo = nextFile.type.startsWith("video/") || /\.(mp4|mov|mkv|webm)$/i.test(nextFile.name);

    if (!looksLikeVideo) {
      setError("Video ဖိုင်ကိုသာ ရွေးပေးပါ။ MP4, MOV, MKV သို့မဟုတ် WEBM ကို အသုံးပြုနိုင်ပါတယ်။");
      return;
    }
    if (nextFile.size > MAX_FILE_SIZE) {
      setError("ဖိုင်အရွယ်အစား 2 GB ထက်မကျော်ရပါ။");
      return;
    }

    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = URL.createObjectURL(nextFile);
    setPreviewUrl(previewUrlRef.current);
    setFile(nextFile);
    setVideoDuration(0);
    setTrimStartSeconds(0);
    setTrimEndSeconds(0);
    setSourceFilename(nextFile.name);
    setUploadState("idle");
    setProgress(0);
    setMediaUrl(null);
    setUploadId(null);
    setRenderJob(null);
    window.localStorage.removeItem("recapkit-upload-id");
    window.localStorage.removeItem("recapkit-job-id");
    setError(null);
  }

  function clearFile() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setFile(null);
    setVideoDuration(0);
    setTrimStartSeconds(0);
    setTrimEndSeconds(0);
    setSourceFilename("");
    setUploadState("idle");
    setProgress(0);
    setMediaUrl(null);
    setUploadId(null);
    setRenderJob(null);
    window.localStorage.removeItem("recapkit-upload-id");
    window.localStorage.removeItem("recapkit-job-id");
    setError(null);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function chooseMergeFiles(selectedFiles: File[]) {
    if (selectedFiles.length > 10) {
      setError("တစ်ကြိမ်လျှင် video clip ၂ ခုမှ ၁၀ ခုအထိသာ ရွေးနိုင်ပါတယ်။");
      return;
    }
    const invalidFile = selectedFiles.find((selectedFile) => {
      const looksLikeVideo = selectedFile.type.startsWith("video/")
        || /\.(mp4|mov|mkv|webm)$/i.test(selectedFile.name);
      return !looksLikeVideo || selectedFile.size > MAX_FILE_SIZE;
    });
    if (invalidFile) {
      setError(
        invalidFile.size > MAX_FILE_SIZE
          ? `${invalidFile.name}: ဖိုင်အရွယ်အစား 2 GB ထက်မကျော်ရပါ။`
          : `${invalidFile.name}: MP4, MOV, MKV သို့မဟုတ် WEBM ဗီဒီယိုကိုသာ ရွေးပါ။`,
      );
      return;
    }
    setMergeFiles(selectedFiles);
    setError(null);
  }

  function moveMergeFile(index: number, direction: -1 | 1) {
    setMergeFiles((currentFiles) => {
      const destination = index + direction;
      if (destination < 0 || destination >= currentFiles.length) return currentFiles;
      const reordered = [...currentFiles];
      [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
      return reordered;
    });
  }

  async function uploadAndMergeClips() {
    if (mergeFiles.length < 2 || mergeUploading || renderBusy) return;

    setMergeUploading(true);
    setMergeProgress(0);
    setError(null);
    try {
      const clipIds: string[] = [];
      for (const [index, clip] of mergeFiles.entries()) {
        const uploadData = new FormData();
        uploadData.set("file", clip);
        const uploadResponse = await fetch(backendUrl("/api/uploads"), {
          method: "POST",
          body: uploadData,
          headers: backendAuthHeaders(),
        });
        const uploadResult = await uploadResponse.json() as { id?: string; detail?: string };
        if (!uploadResponse.ok || !uploadResult.id) {
          throw new Error(uploadResult.detail ?? `Could not upload ${clip.name}.`);
        }
        clipIds.push(uploadResult.id);
        setMergeProgress(Math.round(((index + 1) / mergeFiles.length) * 100));
      }

      const jobData = new FormData();
      jobData.set("action", "merge-clips");
      jobData.set("merge_clip_ids", JSON.stringify(clipIds));
      const jobResponse = await fetch("/api/video", { method: "POST", body: jobData, headers: backendAuthHeaders() });
      const jobResult = await jobResponse.json() as RenderJob & { detail?: string };
      if (!jobResponse.ok) throw new Error(jobResult.detail ?? "Could not start the merge job.");

      setRenderJob(jobResult);
      window.localStorage.setItem("recapkit-job-id", jobResult.id);
    } catch (mergeError: unknown) {
      setError(mergeError instanceof Error ? mergeError.message : "Could not merge the selected clips.");
    } finally {
      setMergeUploading(false);
    }
  }

  async function promoteMergedVideoToSource() {
    if (renderBusy || !renderJob || !["merge-clips", "trim-video"].includes(renderJob.operation) || renderJob.status !== "completed") return;
    setPromotingMerge(true);
    setError(null);
    try {
      const response = await fetch(backendUrl(`/api/uploads/from-render/${renderJob.id}`), { method: "POST", headers: backendAuthHeaders() });
      const result = await response.json() as { id?: string; filename?: string; media_url?: string; detail?: string };
      if (!response.ok || !result.id || !result.media_url) {
        throw new Error(result.detail ?? "Could not load the rendered video as the current source.");
      }
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      const sourceUrl = backendUrl(result.media_url);
      setFile(null);
      setSourceFilename(result.filename ?? (renderJob.operation === "trim-video" ? "trimmed-video.mp4" : "merged-video.mp4"));
      setPreviewUrl(sourceUrl);
      setMediaUrl(sourceUrl);
      setUploadId(result.id);
      setUploadState("uploaded");
      setProgress(100);
      setRenderJob(null);
      window.localStorage.setItem("recapkit-upload-id", result.id);
      window.localStorage.removeItem("recapkit-job-id");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Could not use the merged video as the current source.");
    } finally {
      setPromotingMerge(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  }

  function uploadFile() {
    if (!file || uploadState === "uploading") return;

    const formData = new FormData();
    formData.append("file", file);
    setUploadState("uploading");
    setProgress(0);
    setError(null);

    const request = new XMLHttpRequest();
    try {
      request.open("POST", backendUrl("/api/uploads"));
      const apiKey = getBackendApiKey();
      if (apiKey) request.setRequestHeader("X-API-Key", apiKey);
    } catch (uploadError: unknown) {
      setError(uploadError instanceof Error ? uploadError.message : "The video backend is not configured.");
      setUploadState("error");
      return;
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        const result = JSON.parse(request.responseText) as { id: string; media_url?: string };
        setMediaUrl(result.media_url ? backendUrl(result.media_url) : null);
        setUploadId(result.id);
        window.localStorage.setItem("recapkit-upload-id", result.id);
        window.localStorage.removeItem("recapkit-job-id");
        setUploadState("uploaded");
        setProgress(100);
        return;
      }

      let message = "Upload မအောင်မြင်ပါ။ ထပ်မံကြိုးစားပါ။";
      try {
        const result = JSON.parse(request.responseText) as { detail?: string };
        if (result.detail) message = result.detail;
      } catch {
        // Use the default message when the server response is not JSON.
      }
      setError(message);
      setUploadState("error");
    };
    request.onerror = () => {
      setError("Server ကို ချိတ်ဆက်မရပါ။ FastAPI server ကို စတင်ထားပါ။");
      setUploadState("error");
    };
    request.send(formData);
  }

  async function startRenderJob(operation: RenderJob["operation"]) {
    if (!uploadId || renderBusy) return;

    const usesSubtitles = operation === "burn-subtitles" || operation === "create-recap-dub";
    const timedSubtitleSrt = buildTimedSubtitleSrt(subtitleSrt, videoDuration);
    if (usesSubtitles && subtitleSrt.trim() && !subtitleSrt.includes("-->")) setSubtitleSrt(timedSubtitleSrt);
    setStartingJob(true);
    setError(null);
    try {
      const payload = operation === "burn-subtitles"
        ? { upload_id: uploadId, operation, subtitle_srt: timedSubtitleSrt, font_family: fontFamily, font_size: fontSize, font_color: fontColor, position: subtitlePosition, outline, template_ratio: templateRatio, text_overlay: textOverlay, text_animation: textAnimation, text_position: textPosition, text_size: textSize, text_color: textColor }
        : operation === "trim-video"
          ? { upload_id: uploadId, operation, trim_start_seconds: trimStartSeconds, trim_end_seconds: trimEndSeconds }
        : operation === "split-video"
          ? { upload_id: uploadId, operation, segment_seconds: segmentSeconds }
          : operation === "create-recap-dub"
            ? { upload_id: uploadId, operation, mode: voiceoverMode, source_language: sourceLanguage, subtitle_srt: timedSubtitleSrt || undefined, voice, recap_seconds: recapSeconds, include_original_audio: includeOriginalAudio, background_volume: backgroundVolume, template_ratio: templateRatio, text_overlay: textOverlay, text_animation: textAnimation, text_position: textPosition, text_size: textSize, text_color: textColor }
            : operation === "hide-sub"
              ? { upload_id: uploadId, operation, hide_method: hideMethod, template_ratio: templateRatio, text_overlay: textOverlay, text_animation: textAnimation, text_position: textPosition, text_size: textSize, text_color: textColor }
              : operation === "export-video"
                ? { upload_id: uploadId, operation, template_ratio: templateRatio, text_overlay: textOverlay, text_animation: textAnimation, text_position: textPosition, text_size: textSize, text_color: textColor }
            : { upload_id: uploadId, operation };
      const headers = backendAuthHeaders();
      headers.set("Content-Type", "application/json");
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const result = await response.json() as RenderJob & { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Render job could not be started.");
      setRenderJob(result);
      window.localStorage.setItem("recapkit-job-id", result.id);
    } catch (jobError: unknown) {
      setError(jobError instanceof Error ? jobError.message : "Render job could not be started.");
    } finally {
      setStartingJob(false);
    }
  }

  async function submitPhase1Action(action: Phase1Action): Promise<boolean> {
    if (!uploadId || renderBusy) {
      setError("Upload a video first and wait for the current render to finish.");
      return false;
    }
    if (action === "subtitle" && !subtitleSrt.trim()) {
      setError("Add SRT subtitle text before starting the subtitle render.");
      return false;
    }
    if (action === "script-voiceover" && (!narrationScript.trim() || !subtitleSrt.trim())) {
      setError("Enter the Burmese narration script and subtitle text before rendering.");
      return false;
    }

    const timedSubtitleSrt = buildTimedSubtitleSrt(subtitleSrt, videoDuration);
    if (action !== "hide-sub" && subtitleSrt.trim() && !subtitleSrt.includes("-->")) setSubtitleSrt(timedSubtitleSrt);

    const formData = new FormData();
    formData.set("action", action);
    formData.set("upload_id", uploadId);
    if (action === "audio-myanmar") {
      formData.set("subtitle_srt", timedSubtitleSrt);
      formData.set("voice", voice);
      formData.set("mode", voiceoverMode);
      formData.set("source_language", sourceLanguage);
      formData.set("recap_seconds", String(recapSeconds));
      formData.set("include_original_audio", String(includeOriginalAudio));
      formData.set("background_volume", String(backgroundVolume));
    } else if (action === "script-voiceover") {
      formData.set("script_text", narrationScript);
      formData.set("subtitle_srt", timedSubtitleSrt);
      formData.set("voice", voice);
      formData.set("font_family", fontFamily);
      formData.set("font_size", String(fontSize));
      formData.set("font_color", fontColor);
      formData.set("position", subtitlePosition);
      formData.set("outline", String(outline));
      formData.set("include_original_audio", String(includeOriginalAudio));
      formData.set("background_volume", String(backgroundVolume));
    } else if (action === "subtitle") {
      formData.set("subtitle_srt", timedSubtitleSrt);
      formData.set("font_family", fontFamily);
      formData.set("font_size", String(fontSize));
      formData.set("font_color", fontColor);
      formData.set("position", subtitlePosition);
      formData.set("outline", String(outline));
    } else {
      formData.set("method", hideMethod);
    }
    formData.set("template_ratio", templateRatio);
    formData.set("text_overlay", textOverlay);
    formData.set("text_animation", textAnimation);
    formData.set("text_position", textPosition);
    formData.set("text_size", String(textSize));
    formData.set("text_color", textColor);

    setStartingJob(true);
    setError(null);
    try {
      const response = await fetch("/api/video", { method: "POST", body: formData, headers: backendAuthHeaders() });
      const result = await response.json() as RenderJob & { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "The Phase 1 action could not be started.");
      setRenderJob(result);
      window.localStorage.setItem("recapkit-job-id", result.id);
      return true;
    } catch (actionError: unknown) {
      setError(actionError instanceof Error ? actionError.message : "The Phase 1 action could not be started.");
      return false;
    } finally {
      setStartingJob(false);
    }
  }

  async function handleAngelCommand(message: string) {
    const command = message.toLowerCase();
    if (/hide|ဖျောက်|blur/.test(command)) {
      const started = await submitPhase1Action("hide-sub");
      setChatMessages((current) => [...current, {
        role: "angel",
        text: started ? "Original subtitle hiding is queued." : "I couldn't start that render. Check the message above and try again.",
      }]);
      return;
    }
    if (/subtitle|စာတန်း/.test(command)) {
      const started = await submitPhase1Action("subtitle");
      setChatMessages((current) => [...current, {
        role: "angel",
        text: started ? "Myanmar subtitle rendering is queued." : "I couldn't start that render. Add valid SRT text and try again.",
      }]);
      return;
    }
    if (/voice|audio|အသံ|dubb|translate|ဘာသာပြန်/.test(command)) {
      const started = await submitPhase1Action("audio-myanmar");
      setChatMessages((current) => [...current, {
        role: "angel",
        text: started
          ? voiceoverMode === "recap"
            ? "Your Burmese recap script voiceover is queued."
            : "Your source dialogue will be transcribed in Thai, translated directly into Burmese, and voiced."
          : "I couldn't start that render. Check the message above and try again.",
      }]);
      return;
    }
    if (/template|9\s*:\s*16|16\s*:\s*9|1\s*:\s*1|vertical|ဒေါင်လိုက်/.test(command)) {
      const ratio: TemplateRatio = /9\s*:\s*16|vertical|ဒေါင်လိုက်/.test(command)
        ? "9:16"
        : /1\s*:\s*1/.test(command) ? "1:1" : "16:9";
      setTemplateRatio(ratio);
      setChatMessages((current) => [...current, {
        role: "angel",
        text: `Template set to ${ratio}. The blurred-background frame will be included when you export the video.`,
      }]);
      return;
    }
    if (/text|စာသား/.test(command)) {
      const enteredText = message.replace(/^(?:text|စာသား)(?:\s+ထည့်)?\s*/i, "").trim();
      if (enteredText) {
        setTextOverlay(enteredText);
        setChatMessages((current) => [...current, {
          role: "angel",
          text: "Text added. It will be burned into the video when you export it.",
        }]);
      } else {
        textOverlayRef.current?.focus();
        setChatMessages((current) => [...current, {
          role: "angel",
          text: "Type the text you want in the Text tool field, then export the video to burn it in.",
        }]);
      }
      return;
    }
    setChatMessages((current) => [...current, {
      role: "angel",
      text: "Try a command such as “Myanmar voice”, “Subtitle ထိုးပေး”, “Original Sub ဖျောက်”, “Template 9:16”, or “Text ထည့် Hello”.",
    }]);
  }

  function sendAngelMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = chatInput.trim();
    if (!message) return;
    setChatInput("");
    setChatMessages((current) => [...current, { role: "user", text: message }]);
    void handleAngelCommand(message);
  }

  function navigateWorkspace(destination: WorkspaceDestination) {
    setActiveWorkspace(destination);
    let sectionId = "studio";
    if (destination === "source") {
      sectionId = "workspace-grid";
    } else if (destination === "captions" || destination === "voice" || destination === "recap") {
      sectionId = "studio";
    } else if (destination === "trim") {
      sectionId = "trim-editor";
    } else if (destination === "merge") {
      sectionId = "merge-clips-panel";
    } else if (destination === "templates" || destination === "ai" || destination === "story" || destination === "export") {
      setActivePhase3Tab(destination);
      sectionId = "phase3";
    } else if (destination === "elements" || destination === "brand" || destination === "audio" || destination === "images" || destination === "magic") {
      setActivePhase2Tab(destination);
      sectionId = "phase2";
    }

    window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function saveApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveBackendApiKey(apiKeyInput);
    setShowApiKeySettings(false);
    setError(null);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="RecapKit home">
          <span className="brand-mark"><Clapperboard size={21} strokeWidth={2.2} /></span>
          <span className="brand-copy">
            <strong>recapkit</strong>
            <small>MYANMAR CREATOR STUDIO</small>
          </span>
        </a>
        <div className="top-actions">
          <span className="status-pill"><span className="status-dot" /> {API_BASE_URL ? "Backend URL configured" : "Backend not configured"}</span>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              setApiKeyInput(getBackendApiKey());
              setShowApiKeySettings(true);
            }}
          >
            Backend access
          </button>
          <button className="profile-button" type="button" aria-label="Open export workspace" onClick={() => navigateWorkspace("export")}>
            <Settings size={17} />
          </button>
        </div>
      </header>

      {showApiKeySettings && (
        <div className="api-key-backdrop" role="dialog" aria-modal="true" aria-labelledby="api-key-title" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowApiKeySettings(false);
        }}>
          <form className="api-key-panel" onSubmit={saveApiKey} aria-labelledby="api-key-title">
            <button className="api-key-close" type="button" onClick={() => setShowApiKeySettings(false)} aria-label="Close API key settings">
              <X size={18} />
            </button>
            <h2 id="api-key-title">Backend access</h2>
            <p>Enter the API key configured in your backend host’s Secrets. The key stays in this browser and is not included in the deployed app.</p>
            <label htmlFor="backend-api-key">API key</label>
            <input id="backend-api-key" type="password" autoComplete="off" value={apiKeyInput} onChange={(event) => setApiKeyInput(event.target.value)} />
            <div className="api-key-actions">
              <button className="button button-secondary" type="button" onClick={() => setApiKeyInput("")}>Clear</button>
              <button className="button button-primary" type="submit">Save on this device</button>
            </div>
          </form>
        </div>
      )}

      <div className="studio-layout">
        <aside className="studio-sidebar" aria-label="Editing features">
          <div className="sidebar-project">
            <span className="sidebar-project-icon"><Clapperboard size={17} /></span>
            <span><strong>My workspace</strong><small>VIDEO PROJECT</small></span>
          </div>
          {workspaceGroups.map((group) => (
            <div className="workspace-nav-group" key={group.title}>
              <span className="workspace-nav-heading">{group.title}</span>
              {group.items.map(({ id, label, icon: Icon }) => (
                <button
                  className={`workspace-nav-item${activeWorkspace === id ? " active" : ""}`}
                  type="button"
                  key={id}
                  onClick={() => navigateWorkspace(id)}
                  aria-current={activeWorkspace === id ? "page" : undefined}
                >
                  <Icon size={17} /><span>{label}</span>
                </button>
              ))}
            </div>
          ))}
          <div className={`backend-notice${API_BASE_URL ? " configured" : ""}`} role="status">
            <span className="status-dot" />
            <span>{API_BASE_URL ? "Video server URL configured" : "Set NEXT_PUBLIC_API_URL to enable rendering"}</span>
          </div>
        </aside>
        <div className="studio-content">
      <section className="intro" id="home">
        <div>
          <div className="eyebrow"><Sparkles size={13} /> VIDEO WORKSPACE <span> / </span> EDITOR</div>
          <h1>ဗီဒီယိုကို<br /><em>တစ်နေရာတည်းမှာ ပြင်ဆင်ပါ။</em></h1>
          <p className="intro-copy">ဘယ်ဘက် Menu ကနေ လိုချင်တဲ့ tool ကိုရွေးပါ။ Clip ဖြတ်ဆက်၊ မြန်မာစာတန်းနဲ့ အသံထည့်ပြီး ဖုန်းမှာလည်း အဆင်ပြေစွာ export လုပ်နိုင်ပါတယ်။</p>
        </div>
        <div className="intro-note">
          <span className="note-icon"><Cloud size={17} /></span>
          <span><strong>Made for Myanmar creators</strong><small>Unicode captions · Flexible formats</small></span>
        </div>
      </section>

      <section className="workspace-grid" aria-label="Video upload workspace">
        <div className="upload-panel panel">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">01 / SOURCE VIDEO</span>
              <h2>Start with a video</h2>
            </div>
            <span className="file-limit"><FileVideo size={15} /> Up to 2 GB</span>
          </div>

          <div
            className={`dropzone${dragging ? " is-dragging" : ""}${previewUrl ? " has-preview" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={handleDrop}
          >
            {previewUrl ? (
              <div className="video-preview-wrap">
                <div
                  className="video-preview-frame"
                  style={{ aspectRatio: templateAspectRatios[templateRatio] }}
                >
                  <video
                    className="video-preview"
                    src={previewUrl}
                    controls
                    playsInline
                    onLoadedMetadata={(event) => {
                      const duration = event.currentTarget.duration;
                      if (Number.isFinite(duration)) {
                        setVideoDuration(duration);
                        setTrimEndSeconds(duration);
                      }
                    }}
                  />
                  {textOverlay.trim() && <span className="video-text-overlay">{textOverlay}</span>}
                </div>
                <div className="selected-file">
                  <span className="selected-file-icon"><FileVideo size={18} /></span>
                  <span className="selected-file-copy"><strong>{sourceFilename}</strong><small>{file ? formatBytes(file.size) : ""}</small></span>
                  <button className="icon-button remove-file" type="button" onClick={clearFile} aria-label="Remove selected video">
                    <X size={17} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="empty-dropzone">
                <span className="upload-symbol"><CloudUpload size={26} strokeWidth={1.8} /></span>
                <strong>Drop your video here</strong>
                <span className="dropzone-caption">သို့မဟုတ် စက်ထဲက video ဖိုင်ကို ရွေးပါ</span>
                <button className="button button-light" type="button" onClick={() => fileInputRef.current?.click()}>
                  Browse videos <ArrowUpRight size={15} />
                </button>
                <small className="format-hint">MP4 · MOV · MKV · WEBM</small>
              </div>
            )}
            <input ref={fileInputRef} className="visually-hidden" type="file" accept="video/*,.mkv" onChange={handleFileChange} />
          </div>

          {(file || error) && (
            <div className="upload-feedback" aria-live="polite">
              {uploadState === "uploading" && <><div className="progress-copy"><span>Uploading source video</span><strong>{progress}%</strong></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></>}
              {uploadState === "uploaded" && <div className="success-line"><Check size={16} /><span>Video uploaded to the render server</span>{mediaUrl && <a href={mediaUrl} target="_blank" rel="noreferrer">Open video <ArrowUpRight size={13} /></a>}</div>}
              {error && <p className="error-line" role="alert">{error}</p>}
            </div>
          )}

          <section className="trim-editor" id="trim-editor" aria-labelledby="trim-editor-heading">
            <div className="trim-editor-heading">
              <span className="section-kicker">QUICK EDIT</span>
              <h3 id="trim-editor-heading">Trim this video</h3>
              <p>စတင်ချိန်နဲ့ အဆုံးသတ်ချိန်ကို ရွေးပြီး လိုတဲ့အပိုင်းကို MP4 အဖြစ်ဖြတ်ထုတ်ပါ။</p>
            </div>
            <div className="trim-controls">
              <label>
                <span>Start (seconds)</span>
                <input
                  type="number"
                  min={0}
                  max={videoDuration || 86400}
                  step={0.1}
                  value={trimStartSeconds}
                  onChange={(event) => setTrimStartSeconds(Number(event.target.value))}
                  disabled={!videoDuration}
                />
              </label>
              <label>
                <span>End (seconds){videoDuration ? ` · ${videoDuration.toFixed(1)}s total` : ""}</span>
                <input
                  type="number"
                  min={0}
                  max={videoDuration || 86400}
                  step={0.1}
                  value={trimEndSeconds}
                  onChange={(event) => setTrimEndSeconds(Number(event.target.value))}
                  disabled={!videoDuration}
                />
              </label>
              <button
                className="button button-primary"
                type="button"
                onClick={() => void startRenderJob("trim-video")}
                disabled={!uploadId || !videoDuration || trimStartSeconds < 0 || trimEndSeconds <= trimStartSeconds || trimEndSeconds > videoDuration || renderBusy}
              >
                <Scissors size={15} /> Export trimmed clip
              </button>
            </div>
            {!uploadId && <small className="trim-hint">အရင်ဆုံး video ကိုရွေးပြီး Upload လုပ်ပါ။</small>}
          </section>

          {renderJob && (
            <div className="render-feedback" aria-live="polite">
              <div className={`job-state ${renderJob.status}`}>
                {renderJob.status === "queued" && <><LoaderCircle className="spin" size={15} /><span>Render job queued...</span></>}
                {renderJob.status === "running" && <><LoaderCircle className="spin" size={15} /><span>{renderMessages[renderJob.operation].running}</span></>}
                {renderJob.status === "completed" && <><Check size={15} /><span>{renderMessages[renderJob.operation].completed}</span></>}
                {renderJob.status === "failed" && <><X size={15} /><span>{renderJob.error ?? "Render job failed."}</span></>}
              </div>
              {renderJob.output_url && <a className="download-link" href={backendUrl(renderJob.output_url)} download><Download size={14} /> Download {renderMessages[renderJob.operation].extension}</a>}
              {["merge-clips", "trim-video"].includes(renderJob.operation) && renderJob.status === "completed" && (
                <button className="button button-secondary" type="button" onClick={() => void promoteMergedVideoToSource()} disabled={promotingMerge}>
                  {promotingMerge ? <LoaderCircle className="spin" size={15} /> : <FileVideo size={15} />}
                  {promotingMerge ? "Preparing video..." : `Continue with this ${renderJob.operation === "trim-video" ? "trimmed" : "merged"} video`}
                </button>
              )}
              {renderJob.result_text && <label className="recap-result"><span>{renderJob.operation === "ai-script" ? "Generated recap scenes" : renderJob.operation === "story-script" ? "Generated story script" : renderJob.operation === "subtitle-timing" ? "Timed subtitle cues" : renderJob.operation === "seo-metadata" ? "YouTube metadata" : renderJob.operation === "angel-chat" ? "Angel suggestions" : "Generated Burmese voice text"}</span><textarea value={renderJob.result_text} readOnly rows={5} aria-label="Generated result" /></label>}
            </div>
          )}

          <div className="upload-footer">
            <span className="storage-note"><Cloud size={15} /> Stored on your video server</span>
            {uploadState === "uploaded" ? (
              <div className="render-tools">
                <label className="split-length-field" htmlFor="split-length">
                  <Scissors size={14} />
                  <span>Clip length</span>
                  <select id="split-length" value={segmentSeconds} onChange={(event) => setSegmentSeconds(Number(event.target.value) as typeof segmentSeconds)}>
                    <option value={30}>30 sec</option>
                    <option value={60}>1 min</option>
                    <option value={120}>2 min</option>
                  </select>
                </label>
                <div className="render-actions">
                  <button className="button button-secondary" type="button" onClick={() => startRenderJob("extract-audio")} disabled={renderBusy}><AudioLines size={15} /> Extract audio</button>
                  <button className="button button-secondary" type="button" onClick={() => startRenderJob("split-video")} disabled={renderBusy}><Scissors size={15} /> Split video</button>
                  <button className="button button-primary" type="button" onClick={() => startRenderJob("burn-subtitles")} disabled={renderBusy || !subtitleSrt.trim()}><Subtitles size={15} /> Render subtitles</button>
                  <button className="button button-primary" type="button" onClick={() => startRenderJob("create-recap-dub")} disabled={renderBusy}>
                    <Mic2 size={15} /> {voiceoverMode === "recap" ? "Create recap voiceover" : "Translate and dub"}
                  </button>
                </div>
              </div>
            ) : (
              <button className="button button-primary" type="button" onClick={uploadFile} disabled={!file || uploadState === "uploading"}>
                {uploadState === "uploading" ? <LoaderCircle className="spin" size={16} /> : <CloudUpload size={16} />}
                {uploadState === "uploading" ? "Uploading..." : "Upload video"}
                {uploadState !== "uploading" && <ArrowUpRight size={15} />}
              </button>
            )}
          </div>

          <section className="merge-clips-panel" id="merge-clips-panel" aria-labelledby="merge-clips-heading">
            <div className="merge-clips-heading">
              <span className="section-kicker">JOIN VIDEO PARTS</span>
              <h3 id="merge-clips-heading">Merge clips into one video</h3>
              <p>Split ZIP ထဲက clip တွေကို အရင်ဖြည်ပြီး ရွေးပါ။ အစီအစဉ်ကို ↑↓ နဲ့ ပြင်နိုင်ပြီး output က ပထမ clip ရဲ့ အချိုးကို လိုက်နာပါတယ်။</p>
            </div>
            <input
              ref={mergeFilesInputRef}
              className="visually-hidden"
              type="file"
              accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm"
              multiple
              onChange={(event) => {
                chooseMergeFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <button
              className="button button-secondary merge-select-button"
              type="button"
              onClick={() => mergeFilesInputRef.current?.click()}
              disabled={mergeUploading || renderBusy}
            >
              <FileVideo size={15} /> Select 2–10 clips
            </button>
            {mergeFiles.length > 0 && (
              <ol className="merge-clip-list">
                {mergeFiles.map((clip, index) => (
                  <li className="merge-clip-item" key={`${clip.name}-${clip.lastModified}-${index}`}>
                    <span className="merge-clip-index">{index + 1}</span>
                    <span className="merge-clip-name" title={clip.name}>
                      <strong>{clip.name}</strong>
                      <small>{formatBytes(clip.size)}</small>
                    </span>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => moveMergeFile(index, -1)}
                      disabled={index === 0 || mergeUploading || renderBusy}
                      aria-label={`Move ${clip.name} up`}
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => moveMergeFile(index, 1)}
                      disabled={index === mergeFiles.length - 1 || mergeUploading || renderBusy}
                      aria-label={`Move ${clip.name} down`}
                    >
                      <ChevronDown size={16} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => setMergeFiles((currentFiles) => currentFiles.filter((_, fileIndex) => fileIndex !== index))}
                      disabled={mergeUploading || renderBusy}
                      aria-label={`Remove ${clip.name}`}
                    >
                      <X size={15} />
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {mergeUploading && (
              <div className="merge-progress" aria-live="polite">
                <div className="progress-copy"><span>Uploading selected clips</span><strong>{mergeProgress}%</strong></div>
                <div className="progress-track"><span style={{ width: `${mergeProgress}%` }} /></div>
              </div>
            )}
            <button
              className="button button-primary merge-submit-button"
              type="button"
              onClick={() => void uploadAndMergeClips()}
              disabled={mergeFiles.length < 2 || mergeUploading || renderBusy}
            >
              {mergeUploading || (renderBusy && renderJob?.operation === "merge-clips")
                ? <LoaderCircle className="spin" size={15} />
                : <Clapperboard size={15} />}
              {mergeUploading ? "Uploading clips..." : "Merge into one MP4"}
            </button>
          </section>
        </div>

        <aside className="settings-panel panel" id="studio">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">02 / PROJECT SETUP</span>
              <h2>Choose a direction</h2>
            </div>
            <span className="step-number">02</span>
          </div>
          <div className="mode-list" role="group" aria-label="Choose a video project type">
            {modes.map((mode) => {
              const Icon = mode.icon;
              const selected = selectedMode === mode.id;
              return (
                <button
                  className={`mode-option${selected ? " selected" : ""}`}
                  key={mode.id}
                  onClick={() => {
                    setSelectedMode(mode.id);
                    if (mode.id === "dialogue") setVoiceoverMode("dubbing");
                    if (mode.id === "recap") setVoiceoverMode("recap");
                  }}
                  type="button"
                  aria-pressed={selected}
                >
                  <span className="mode-icon"><Icon size={17} /></span>
                  <span className="mode-copy"><strong>{mode.name}</strong><small>{mode.detail}</small></span>
                  <span className="mode-radio" />
                </button>
              );
            })}
          </div>
          <div className="setup-divider" />
          <div className="language-row">
            <div className="language-label"><Languages size={16} /><span><strong>Source speech language</strong><small>Used for recap transcription; dubbing uses Thai</small></span></div>
            <select
              aria-label="Source speech language"
              value={sourceLanguage}
              onChange={(event) => setSourceLanguage(event.target.value as SourceLanguage)}
              disabled={voiceoverMode === "dubbing"}
            >
              <option value="th">Thai</option>
              <option value="my">မြန်မာ</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="subtitle-editor">
            <label className="subtitle-label" htmlFor="subtitle-srt">
              <span><Subtitles size={16} /><strong>Subtitle text</strong></span>
              <small>Text / SRT</small>
            </label>
            <textarea
              id="subtitle-srt"
              className="subtitle-input"
              value={subtitleSrt}
              onChange={(event) => setSubtitleSrt(event.target.value)}
              placeholder={"မြန်မာစာတန်းကို ဒီမှာရေးပါ\nနောက်စာတန်းတစ်ကြောင်း"}
              spellCheck={false}
            />
            <p className="subtitle-unicode-note">စာကြောင်းတစ်ကြောင်းစီကို လိုင်းခွဲရေးပါ။ Render လုပ်ချိန်မှာ video ကြာချိန်အတွင်း အချိန်ကို အညီအမျှ အလိုအလျောက်ခွဲပေးပါမယ်။ ကိုယ်တိုင်အချိန်သတ်မှတ်ထားတဲ့ SRT ကိုလည်း ထည့်နိုင်ပါတယ်။ မြန်မာစာအတွက် Unicode သုံးပါ။</p>
            <div className="subtitle-style-grid">
              <label className="style-field">
                <span>Font</span>
                <select value={fontFamily} onChange={(event) => setFontFamily(event.target.value)}>
                  <option>Noto Sans Myanmar</option>
                </select>
              </label>
              <label className="style-field">
                <span>Size <strong>{fontSize}px</strong></span>
                <input type="range" min={16} max={80} value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} aria-label="Subtitle font size" />
              </label>
              <label className="style-field">
                <span>Position</span>
                <select value={subtitlePosition} onChange={(event) => setSubtitlePosition(event.target.value as typeof subtitlePosition)}>
                  <option value="bottom">Bottom</option>
                  <option value="center">Center</option>
                  <option value="top">Top</option>
                </select>
              </label>
              <label className="style-field">
                <span>Outline <strong>{outline}px</strong></span>
                <input type="range" min={0} max={8} value={outline} onChange={(event) => setOutline(Number(event.target.value))} aria-label="Subtitle outline thickness" />
              </label>
              <div className="style-field color-field">
                <span>Text color</span>
                <div className="color-swatches" role="group" aria-label="Subtitle text color">
                  <button className={`color-swatch white${fontColor === "white" ? " selected" : ""}`} type="button" onClick={() => setFontColor("white")} aria-label="White subtitle text" aria-pressed={fontColor === "white"} />
                  <button className={`color-swatch yellow${fontColor === "yellow" ? " selected" : ""}`} type="button" onClick={() => setFontColor("yellow")} aria-label="Yellow subtitle text" aria-pressed={fontColor === "yellow"} />
                  <button className={`color-swatch cyan${fontColor === "cyan" ? " selected" : ""}`} type="button" onClick={() => setFontColor("cyan")} aria-label="Cyan subtitle text" aria-pressed={fontColor === "cyan"} />
                </div>
              </div>
            </div>
          </div>
          <div className="voiceover-editor">
            <div className="voiceover-heading"><Mic2 size={16} /><strong>Burmese voice mode</strong></div>
            <label className="narration-script-field" htmlFor="narration-script">
              <span>Your Burmese narration script</span>
              <textarea
                id="narration-script"
                value={narrationScript}
                maxLength={12000}
                onChange={(event) => setNarrationScript(event.target.value)}
                placeholder="Meta ကရေးပေးထားတဲ့ မြန်မာစကားပြော script ကို ဒီမှာ paste လုပ်ပါ။ Nilar က စာသားအတိုင်း ဖတ်ပါမယ်။"
              />
              <small>ဒီစာသားကို AI နဲ့ ပြန်မရေးဘဲ Nilar အသံနဲ့ တိုက်ရိုက်ဖတ်ပေးပါမယ်။ Subtitle အတွက် အောက်မှာ စာသားရေးပါ၊ အချိန်ကို အလိုအလျောက်ထည့်ပေးပါမယ်။</small>
            </label>
            <div className="voiceover-mode-options" role="group" aria-label="Choose voiceover mode">
              <button
                className={`voiceover-mode-option${voiceoverMode === "recap" ? " selected" : ""}`}
                type="button"
                onClick={() => setVoiceoverMode("recap")}
                aria-pressed={voiceoverMode === "recap"}
              >
                <strong>Recap TTS</strong>
                <small>Summarize the story in a new Burmese script.</small>
              </button>
              <button
                className={`voiceover-mode-option${voiceoverMode === "dubbing" ? " selected" : ""}`}
                type="button"
                onClick={() => setVoiceoverMode("dubbing")}
                aria-pressed={voiceoverMode === "dubbing"}
              >
                <strong>Thai → Myanmar dubbing</strong>
                <small>Translate the original Thai dialogue directly into Burmese.</small>
              </button>
            </div>
            <div className="voiceover-fields">
              {voiceoverMode === "recap" && (
                <label className="style-field">
                  <span>Recap length</span>
                  <select value={recapSeconds} onChange={(event) => setRecapSeconds(Number(event.target.value))}>
                    <option value={30}>About 30 sec</option>
                    <option value={60}>About 1 min</option>
                    <option value={120}>About 2 min</option>
                    <option value={300}>About 5 min</option>
                    <option value={420}>About 7 min</option>
                    <option value={600}>About 10 min</option>
                  </select>
                </label>
              )}
              <label className="style-field">
                <span>Burmese voice</span>
                <select value={voice} onChange={(event) => setVoice(event.target.value as typeof voice)}>
                  <option value="my-MM-NilarNeural">Nilar · Female</option>
                  <option value="my-MM-ThihaNeural">Thiha · Male</option>
                </select>
              </label>
            </div>
            <p className="voiceover-note">
              {voiceoverMode === "recap"
                ? "Uses the source transcript to write a new Burmese recap script. Provide SRT above or transcribe Burmese speech from the video."
                : "Provide Thai SRT above or transcribe Thai dialogue from the source audio. The dialogue is translated into Burmese before voice synthesis."}
            </p>
            <label className="voiceover-toggle">
              <input type="checkbox" checked={includeOriginalAudio} onChange={(event) => setIncludeOriginalAudio(event.target.checked)} />
              <span>Keep original audio underneath</span>
            </label>
            {includeOriginalAudio && (
              <label className="style-field background-volume-field">
                <span>Background volume <strong>{backgroundVolume}%</strong></span>
                <input type="range" min={0} max={100} step={5} value={backgroundVolume} onChange={(event) => setBackgroundVolume(Number(event.target.value))} aria-label="Original audio background volume" />
              </label>
            )}
          </div>
          <div className="setup-hint"><Sparkles size={15} /><span>Audio and subtitle renders run in a persistent local queue. Cloud storage and AI captioning are planned next.</span></div>
        </aside>
      </section>

      <section className="phase-one-section panel" id="phase1" aria-labelledby="phase-one-title">
        <div className="phase-one-heading">
          <AngelHalo size={46} />
          <div>
            <span className="section-kicker">PHASE 1 / ANGEL CONTROL EDITOR</span>
            <h2 id="phase-one-title">Six tools for your video</h2>
            <p>Template framing and animated text settings are applied to exported MP4s.</p>
          </div>
        </div>

        <div className="phase-feature-grid">
          <article className="phase-feature-card">
            <span className="phase-feature-icon lilac"><Mic2 size={18} /></span>
            <strong>1. Recap TTS or Thai dubbing</strong>
            <small>{voiceoverMode === "recap" ? "Create a new Burmese recap script and voiceover." : "Transcribe Thai dialogue, translate it to Burmese, then synthesize the translation."}</small>
            <button className="button button-secondary" type="button" onClick={() => void submitPhase1Action("audio-myanmar")} disabled={!uploadId || renderBusy}>
              <Mic2 size={15} /> {voiceoverMode === "recap" ? "Create recap voiceover" : "Translate and dub"}
            </button>
          </article>

          <article className="phase-feature-card">
            <span className="phase-feature-icon mint"><Mic2 size={18} /></span>
            <strong>Script narration + subtitles</strong>
            <small>Speak your supplied Burmese script as-is and burn subtitles onto the video in one render.</small>
            <button className="button button-secondary" type="button" onClick={() => void submitPhase1Action("script-voiceover")} disabled={!uploadId || renderBusy || !narrationScript.trim() || !subtitleSrt.trim()}>
              <Mic2 size={15} /> Create final narrated video
            </button>
          </article>

          <article className="phase-feature-card">
            <span className="phase-feature-icon mint"><Subtitles size={18} /></span>
            <strong>2. Myanmar subtitles</strong>
            <small>Render the subtitle text and style configured in Project Setup.</small>
            <button className="button button-secondary" type="button" onClick={() => void submitPhase1Action("subtitle")} disabled={!uploadId || renderBusy || !subtitleSrt.trim()}>
              <Subtitles size={15} /> Render subtitles
            </button>
          </article>

          <article className="phase-feature-card">
            <span className="phase-feature-icon coral"><EyeOff size={18} /></span>
            <strong>3. Hide original subtitles</strong>
            <small>Blur, cover, or crop the lower part of the uploaded video.</small>
            <select aria-label="Original subtitle hiding method" value={hideMethod} onChange={(event) => setHideMethod(event.target.value as typeof hideMethod)}>
              <option value="blur">Blur lower area</option>
              <option value="blackbox">Cover with black box</option>
              <option value="crop">Crop lower area</option>
            </select>
            <button className="button button-secondary" type="button" onClick={() => void submitPhase1Action("hide-sub")} disabled={!uploadId || renderBusy}>
              <EyeOff size={15} /> Hide subtitles
            </button>
          </article>

          <article className="phase-feature-card">
            <span className="phase-feature-icon mint"><LayoutTemplate size={18} /></span>
            <strong>4. Template export</strong>
            <small>Fit the video in a blurred background-fill frame and export at the selected aspect ratio.</small>
            <select aria-label="Video preview aspect ratio" value={templateRatio} onChange={(event) => setTemplateRatio(event.target.value as TemplateRatio)}>
              <option value="16:9">16:9 · YouTube</option>
              <option value="9:16">9:16 · Reels / TikTok</option>
              <option value="1:1">1:1 · Square</option>
            </select>
            <span className="phase-preview-note">Center-framed · automatic face detection is not enabled</span>
            <button className="button button-secondary" type="button" onClick={() => void startRenderJob("export-video")} disabled={!uploadId || renderBusy}>
              <Download size={15} /> Export video
            </button>
          </article>

          <article className="phase-feature-card">
            <span className="phase-feature-icon blue"><Type size={18} /></span>
            <strong>5. Animated text export</strong>
            <small>Overlay Myanmar, Thai, or English text on the exported video.</small>
            <input
              ref={textOverlayRef}
              aria-label="Export text overlay"
              maxLength={120}
              onChange={(event) => setTextOverlay(event.target.value)}
              placeholder="မြန်မာစာ / Thai / English"
              value={textOverlay}
            />
            <select aria-label="Text animation" value={textAnimation} onChange={(event) => setTextAnimation(event.target.value as TextAnimation)}>
              <option value="none">No animation</option>
              <option value="fade">Fade in</option>
              <option value="slide">Slide in</option>
              <option value="pop">Pop in</option>
              <option value="typewriter">Typewriter</option>
            </select>
            <select aria-label="Text position" value={textPosition} onChange={(event) => setTextPosition(event.target.value as typeof textPosition)}>
              <option value="top">Top</option>
              <option value="center">Center</option>
              <option value="bottom">Bottom</option>
            </select>
            <label className="style-field">
              <span>Text size <strong>{textSize}px</strong></span>
              <input type="range" min={18} max={120} value={textSize} onChange={(event) => setTextSize(Number(event.target.value))} aria-label="Export text size" />
            </label>
            <select aria-label="Text color" value={textColor} onChange={(event) => setTextColor(event.target.value as typeof textColor)}>
              <option value="white">White</option>
              <option value="yellow">Yellow</option>
              <option value="cyan">Cyan</option>
            </select>
            <span className="phase-preview-note">Configure VIDEO_FONT_PATH for Myanmar/Thai font rendering.</span>
          </article>

          <article className="phase-chat-card">
            <div className="phase-chat-heading">
              <span className="phase-feature-icon gold"><MessageCircle size={18} /></span>
              <div><strong>6. Angel chat control</strong><small>Commands: Myanmar voice, subtitle, hide, template, or text.</small></div>
            </div>
            <div className="phase-chat-log" aria-live="polite">
              {chatMessages.map((message, index) => (
                <AngelChatBubble key={`${index}-${message.role}`} role={message.role} text={message.text} />
              ))}
            </div>
            <form className="phase-chat-form" onSubmit={sendAngelMessage}>
              <input
                aria-label="Message Angel"
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="Angel, Original Sub ဖျောက်..."
                value={chatInput}
              />
              <button className="button button-primary" type="submit" aria-label="Send command" disabled={!chatInput.trim()}>
                <Wand2 size={16} />
              </button>
            </form>
          </article>
        </div>
      </section>

      <Phase2Studio
        uploadId={uploadId}
        renderBusy={renderBusy}
        job={renderJob}
        appliedTemplate={appliedTemplate}
        templateRatio={templateRatio}
        textOverlay={textOverlay}
        textAnimation={textAnimation}
        textPosition={textPosition}
        textSize={textSize}
        textColor={textColor}
        onJob={setRenderJob}
        onError={setError}
        onTemplateApply={(template: CreatorTemplate) => {
          setAppliedTemplate({ ...template });
          setTemplateRatio(template.ratio);
          setTextOverlay(template.textOverlay);
          setTextAnimation(template.textAnimation);
          setTextColor(template.textColor);
        }}
        onApplyScript={setTextOverlay}
        onApplySubtitles={setSubtitleSrt}
        activeTab={activePhase2Tab}
        onActiveTabChange={setActivePhase2Tab}
        activePhase3Tab={activePhase3Tab}
        onPhase3TabChange={setActivePhase3Tab}
      />

      <section className="toolkit-section" id="toolkit">
        <div className="section-title-row">
          <div><span className="section-kicker">COMING INTO THE STUDIO</span><h2>Your toolkit, in progress</h2></div>
          <a className="text-link" href="#toolkit">View roadmap <ArrowUpRight size={15} /></a>
        </div>
        <div className="tool-grid">
          {tools.map((tool) => {
            const Icon = tool.icon;
            const ready = "ready" in tool && tool.ready;
            return (
              <article className="tool-card" key={tool.name}>
                <span className={`tool-icon ${tool.tone}`}><Icon size={19} /></span>
                <div className="tool-card-copy"><strong>{tool.name}</strong><small>{tool.description}</small></div>
                <span className={`tool-status${ready ? " ready" : ""}`}>{ready ? "Ready" : "Planned"}</span>
              </article>
            );
          })}
        </div>
      </section>

      <footer className="page-footer"><span><Clapperboard size={14} /> recapkit</span><span>Built for stories worth sharing.</span></footer>
        </div>
      </div>
    </main>
  );
}