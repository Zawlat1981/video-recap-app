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
  Languages,
  LoaderCircle,
  Mic2,
  MessageSquareText,
  Scissors,
  Settings2,
  Sparkles,
  Subtitles,
  Volume2,
  X,
} from "lucide-react";
import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";

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
type RenderJob = {
  id: string;
  operation: "extract-audio" | "burn-subtitles" | "split-video" | "create-recap-dub";
  status: "queued" | "running" | "completed" | "failed";
  result_text: string | null;
  output_url: string | null;
  error: string | null;
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
  const [recapSeconds, setRecapSeconds] = useState<30 | 60 | 90>(60);
  const [voice, setVoice] = useState<"my-MM-NilarNeural" | "my-MM-ThihaNeural">("my-MM-NilarNeural");
  const [includeOriginalAudio, setIncludeOriginalAudio] = useState(true);
  const [backgroundVolume, setBackgroundVolume] = useState(20);
  const [error, setError] = useState<string | null>(null);
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
        ? { upload_id: uploadId, operation, subtitle_srt: subtitleSrt, font_family: fontFamily, font_size: fontSize, font_color: fontColor, position: subtitlePosition, outline }
        : operation === "split-video"
          ? { upload_id: uploadId, operation, segment_seconds: segmentSeconds }
          : operation === "create-recap-dub"
            ? { upload_id: uploadId, operation, subtitle_srt: subtitleSrt || undefined, voice, recap_seconds: recapSeconds, include_original_audio: includeOriginalAudio, background_volume: backgroundVolume }
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
                <video className="video-preview" src={previewUrl} controls playsInline />
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
                {renderJob.status === "running" && <><LoaderCircle className="spin" size={15} /><span>{renderJob.operation === "burn-subtitles" ? "Rendering subtitles on the server..." : renderJob.operation === "split-video" ? "Splitting video on the server..." : renderJob.operation === "create-recap-dub" ? "Writing and voicing the recap..." : "Extracting audio on the server..."}</span></>}
                {renderJob.status === "completed" && <><Check size={15} /><span>{renderJob.operation === "burn-subtitles" ? "Subtitle render complete" : renderJob.operation === "split-video" ? "Video split complete" : renderJob.operation === "create-recap-dub" ? "AI recap and voiceover complete" : "Audio extraction complete"}</span></>}
                {renderJob.status === "failed" && <><X size={15} /><span>{renderJob.error ?? "Render job failed."}</span></>}
              </div>
              {renderJob.output_url && <a className="download-link" href={new URL(renderJob.output_url, API_BASE_URL).toString()} download><Download size={14} /> Download {renderJob.operation === "burn-subtitles" || renderJob.operation === "create-recap-dub" ? "MP4" : renderJob.operation === "split-video" ? "ZIP" : "MP3"}</a>}
              {renderJob.result_text && <label className="recap-result"><span>AI recap script</span><textarea value={renderJob.result_text} readOnly rows={5} aria-label="AI recap script" /></label>}
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
                  <button className="button button-primary" type="button" onClick={() => startRenderJob("create-recap-dub")} disabled={renderBusy}><Mic2 size={15} /> AI recap + dub</button>
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
                <button className={`mode-option${selected ? " selected" : ""}`} key={mode.id} onClick={() => setSelectedMode(mode.id)} type="button" aria-pressed={selected}>
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
            <div className="voiceover-heading"><Mic2 size={16} /><strong>Movie recap + Burmese voiceover</strong></div>
            <div className="voiceover-fields">
              <label className="style-field">
                <span>Narration length</span>
                <select value={recapSeconds} onChange={(event) => setRecapSeconds(Number(event.target.value) as typeof recapSeconds)}>
                  <option value={30}>About 30 sec</option>
                  <option value={60}>About 1 min</option>
                  <option value={90}>About 90 sec</option>
                  <option value={120}>About 2 min</option>
                  <option value={180}>About 3 min</option>
                  <option value={300}>About 5 min</option>
                  <option value={420}>About 7 min</option>
                  <option value={600}>About 10 min</option>
                </select>
              </label>
              <label className="style-field">
                <span>Burmese voice</span>
                <select value={voice} onChange={(event) => setVoice(event.target.value as typeof voice)}>
                  <option value="my-MM-NilarNeural">Nilar · Female</option>
                  <option value="my-MM-ThihaNeural">Thiha · Male</option>
                </select>
              </label>
            </div>
            <p className="voiceover-note">Uses the SRT text above when provided; otherwise, transcribes Burmese speech from the source video.</p>
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