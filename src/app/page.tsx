"use client";

import {
  ArrowUpRight,
  AudioLines,
  Check,
  Clapperboard,
  Cloud,
  CloudUpload,
  Download,
  FileVideo,
  Film,
  EyeOff,
  LayoutTemplate,
  Languages,
  LoaderCircle,
  MessageCircle,
  Mic2,
  MessageSquareText,
  Scissors,
  Settings2,
  Sparkles,
  Subtitles,
  Type,
  Volume2,
  Wand2,
  X,
} from "lucide-react";
import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { AngelChatBubble, AngelHalo } from "../components/AngelHalo";

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const modes = [
  { id: "recap", name: "Movie recap", detail: "Turn a full story into a short recap", icon: Film },
  { id: "dialogue", name: "Talking clip", detail: "Keep the conversation in focus", icon: MessageSquareText },
  { id: "captions", name: "Captions only", detail: "Prepare a clean subtitle video", icon: Subtitles },
] as const;

const tools = [
  { name: "Video splitter", description: "Cut a video into timed clips", icon: Scissors, tone: "mint", ready: true },
  { name: "Movie recap", description: "Draft a Burmese recap narration", icon: Mic2, tone: "lilac", ready: true },
  { name: "Auto captions", description: "Generate timed subtitles", icon: Subtitles, tone: "mint" },
  { name: "Subtitle translate", description: "Work with SRT and translations", icon: Languages, tone: "lilac" },
  { name: "Video audio sync", description: "Line up voice and video", icon: AudioLines, tone: "coral" },
  { name: "Audio dub", description: "Generate a Burmese voiceover", icon: Volume2, tone: "blue", ready: true },
] as const;

type UploadState = "idle" | "uploading" | "uploaded" | "error";
type VoiceoverMode = "recap" | "dubbing";
type TextAnimation = "none" | "fade" | "slide" | "pop";
type RenderJob = {
  id: string;
  operation: "extract-audio" | "burn-subtitles" | "split-video" | "create-recap-dub" | "hide-sub" | "export-video";
  status: "queued" | "running" | "completed" | "failed";
  result_text: string | null;
  output_url: string | null;
  error: string | null;
};

type Phase1Action = "audio-myanmar" | "subtitle" | "hide-sub";
type AngelMessage = { role: "angel" | "user"; text: string };
type TemplateRatio = "16:9" | "9:16" | "1:1";

const templateAspectRatios: Record<TemplateRatio, string> = {
  "16:9": "16 / 9",
  "9:16": "9 / 16",
  "1:1": "1 / 1",
};

const renderMessages: Record<RenderJob["operation"], { running: string; completed: string; extension: string }> = {
  "extract-audio": { running: "Extracting audio on the server...", completed: "Audio extraction complete", extension: "MP3" },
  "burn-subtitles": { running: "Rendering subtitles on the server...", completed: "Subtitle render complete", extension: "MP4" },
  "split-video": { running: "Splitting video on the server...", completed: "Video split complete", extension: "ZIP" },
  "create-recap-dub": { running: "Creating the Burmese voiceover...", completed: "Burmese voiceover complete", extension: "MP4" },
  "hide-sub": { running: "Hiding the original subtitles...", completed: "Original subtitles hidden", extension: "MP4" },
  "export-video": { running: "Exporting the video design...", completed: "Video design export complete", extension: "MP4" },
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<(typeof modes)[number]["id"]>("recap");
  const [dragging, setDragging] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [renderJob, setRenderJob] = useState<RenderJob | null>(null);
  const [startingJob, setStartingJob] = useState(false);
  const [subtitleSrt, setSubtitleSrt] = useState("");
  const [fontFamily, setFontFamily] = useState("Myanmar Text");
  const [fontSize, setFontSize] = useState(32);
  const [fontColor, setFontColor] = useState<"white" | "yellow" | "cyan">("white");
  const [subtitlePosition, setSubtitlePosition] = useState<"top" | "center" | "bottom">("bottom");
  const [outline, setOutline] = useState(2);
  const [segmentSeconds, setSegmentSeconds] = useState<30 | 60 | 120>(60);
  const [recapSeconds, setRecapSeconds] = useState<number>(600);
  const [voiceoverMode, setVoiceoverMode] = useState<VoiceoverMode>("recap");
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
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<AngelMessage[]>([
    { role: "angel", text: "Mingalaba! Upload a video, then ask me to add subtitles, hide the original subtitles, or create a Burmese recap voiceover." },
  ]);
  const textOverlayRef = useRef<HTMLInputElement>(null);
  const activeJobId = renderJob?.id;
  const activeJobStatus = renderJob?.status;
  const renderBusy = startingJob || activeJobStatus === "queued" || activeJobStatus === "running";

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

    const controller = new AbortController();
    void fetch(`${API_BASE_URL}/api/jobs/${savedJobId}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Saved render job is no longer available.");
        setRenderJob(await response.json() as RenderJob);
      })
      .catch(() => {
        if (!controller.signal.aborted) window.localStorage.removeItem("recapkit-job-id");
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!activeJobId || !activeJobStatus || activeJobStatus === "completed" || activeJobStatus === "failed") return;

    const controller = new AbortController();
    let timeout: number;

    async function pollJob() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/jobs/${activeJobId}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Job status could not be loaded.");
        const updatedJob = await response.json() as RenderJob;
        setRenderJob(updatedJob);
        setError(null);
        if (updatedJob.status !== "completed" && updatedJob.status !== "failed") {
          timeout = window.setTimeout(pollJob, 1200);
        }
      } catch (pollError: unknown) {
        if (!controller.signal.aborted) {
          setError(pollError instanceof Error ? pollError.message : "Job status could not be loaded.");
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
    request.open("POST", `${API_BASE_URL}/api/uploads`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        const result = JSON.parse(request.responseText) as { id: string; media_url?: string };
        setMediaUrl(result.media_url ? new URL(result.media_url, API_BASE_URL).toString() : null);
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

    setStartingJob(true);
    setError(null);
    try {
      const payload = operation === "burn-subtitles"
        ? { upload_id: uploadId, operation, subtitle_srt: subtitleSrt, font_family: fontFamily, font_size: fontSize, font_color: fontColor, position: subtitlePosition, outline, template_ratio: templateRatio, text_overlay: textOverlay, text_animation: textAnimation, text_position: textPosition, text_size: textSize, text_color: textColor }
        : operation === "split-video"
          ? { upload_id: uploadId, operation, segment_seconds: segmentSeconds }
          : operation === "create-recap-dub"
            ? { upload_id: uploadId, operation, mode: voiceoverMode, subtitle_srt: subtitleSrt || undefined, voice, recap_seconds: recapSeconds, include_original_audio: includeOriginalAudio, background_volume: backgroundVolume, template_ratio: templateRatio, text_overlay: textOverlay, text_animation: textAnimation, text_position: textPosition, text_size: textSize, text_color: textColor }
            : operation === "hide-sub"
              ? { upload_id: uploadId, operation, hide_method: hideMethod, template_ratio: templateRatio, text_overlay: textOverlay, text_animation: textAnimation, text_position: textPosition, text_size: textSize, text_color: textColor }
              : operation === "export-video"
                ? { upload_id: uploadId, operation, template_ratio: templateRatio, text_overlay: textOverlay, text_animation: textAnimation, text_position: textPosition, text_size: textSize, text_color: textColor }
            : { upload_id: uploadId, operation };
      const response = await fetch(`${API_BASE_URL}/api/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

    const formData = new FormData();
    formData.set("action", action);
    formData.set("upload_id", uploadId);
    if (action === "audio-myanmar") {
      formData.set("subtitle_srt", subtitleSrt);
      formData.set("voice", voice);
      formData.set("mode", voiceoverMode);
      formData.set("recap_seconds", String(recapSeconds));
      formData.set("include_original_audio", String(includeOriginalAudio));
      formData.set("background_volume", String(backgroundVolume));
    } else if (action === "subtitle") {
      formData.set("subtitle_srt", subtitleSrt);
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
      const response = await fetch("/api/video", { method: "POST", body: formData });
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
        <nav className="top-nav" aria-label="Main navigation">
          <a href="#studio">Cloud studio</a>
          <a href="#toolkit">Tools</a>
        </nav>
        <div className="top-actions">
          <span className="status-pill"><span className="status-dot" /> Local workspace</span>
          <button className="profile-button" type="button" aria-label="Workspace settings">
            <Settings2 size={17} />
          </button>
        </div>
      </header>

      <section className="intro" id="home">
        <div>
          <div className="eyebrow"><Sparkles size={13} /> VIDEO WORKSPACE <span> / </span> 01</div>
          <h1>Make a story<br /><em>out of every video.</em></h1>
          <p className="intro-copy">ဗီဒီယိုတင်ပြီး recap လုပ်ဖို့ အရင်ဆုံးစလိုက်ပါ။ နောက်အဆင့်တွေမှာ subtitle နဲ့ audio tools တွေကို တစ်ခုချင်းထည့်သွားမယ်။</p>
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
                  <video className="video-preview" src={previewUrl} controls playsInline />
                  {textOverlay.trim() && <span className="video-text-overlay">{textOverlay}</span>}
                </div>
                <div className="selected-file">
                  <span className="selected-file-icon"><FileVideo size={18} /></span>
                  <span className="selected-file-copy"><strong>{file?.name}</strong><small>{file ? formatBytes(file.size) : ""}</small></span>
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
              {uploadState === "uploaded" && <div className="success-line"><Check size={16} /><span>Video uploaded to local storage</span>{mediaUrl && <a href={mediaUrl} target="_blank" rel="noreferrer">Open video <ArrowUpRight size={13} /></a>}</div>}
              {error && <p className="error-line" role="alert">{error}</p>}
            </div>
          )}

          {renderJob && (
            <div className="render-feedback" aria-live="polite">
              <div className={`job-state ${renderJob.status}`}>
                {renderJob.status === "queued" && <><LoaderCircle className="spin" size={15} /><span>Render job queued...</span></>}
                {renderJob.status === "running" && <><LoaderCircle className="spin" size={15} /><span>{renderMessages[renderJob.operation].running}</span></>}
                {renderJob.status === "completed" && <><Check size={15} /><span>{renderMessages[renderJob.operation].completed}</span></>}
                {renderJob.status === "failed" && <><X size={15} /><span>{renderJob.error ?? "Render job failed."}</span></>}
              </div>
              {renderJob.output_url && <a className="download-link" href={new URL(renderJob.output_url, API_BASE_URL).toString()} download><Download size={14} /> Download {renderMessages[renderJob.operation].extension}</a>}
              {renderJob.result_text && <label className="recap-result"><span>Generated Burmese voice text</span><textarea value={renderJob.result_text} readOnly rows={5} aria-label="Generated Burmese voice text" /></label>}
            </div>
          )}

          <div className="upload-footer">
            <span className="storage-note"><Cloud size={15} /> Stored on your development server</span>
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
            <div className="language-label"><Languages size={16} /><span><strong>Caption language</strong><small>Transcript and subtitle language</small></span></div>
            <select aria-label="Caption language" defaultValue="my">
              <option value="my">မြန်မာ</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="subtitle-editor">
            <label className="subtitle-label" htmlFor="subtitle-srt">
              <span><Subtitles size={16} /><strong>Subtitle text</strong></span>
              <small>SRT</small>
            </label>
            <textarea
              id="subtitle-srt"
              className="subtitle-input"
              value={subtitleSrt}
              onChange={(event) => setSubtitleSrt(event.target.value)}
              placeholder={"1\n00:00:00,000 --> 00:00:03,000\nမြန်မာစာတန်းကို ဒီမှာရေးပါ\n\n2\n00:00:03,000 --> 00:00:06,000\nနောက်စာတန်းတစ်ကြောင်း"}
              spellCheck={false}
            />
            <div className="subtitle-style-grid">
              <label className="style-field">
                <span>Font</span>
                <select value={fontFamily} onChange={(event) => setFontFamily(event.target.value)}>
                  <option>Myanmar Text</option>
                  <option>Noto Sans Myanmar</option>
                  <option>Arial</option>
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
            <span className="phase-feature-icon mint"><Subtitles size={18} /></span>
            <strong>2. Myanmar subtitles</strong>
            <small>Render the SRT text and style configured in Project Setup.</small>
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
    </main>
  );
}