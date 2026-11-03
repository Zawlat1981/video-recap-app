"use client";

import { useMemo, useState } from "react";
import { Bot, Captions, Clapperboard, Copy, Hash, MessageCircle, Scissors, WandSparkles } from "lucide-react";
import type { RenderJob, RenderOperation } from "../lib/phase2";

type Props = {
  hasVideo: boolean;
  busy: boolean;
  job: RenderJob | null;
  editorContext: string;
  onRun: (operation: RenderOperation, values?: Record<string, string | number | boolean | string[]>) => void;
  onApplyScript: (text: string) => void;
  onApplySubtitles: (srt: string) => void;
};

function scriptText(result: string): string {
  try {
    const parsed: unknown = JSON.parse(result);
    if (typeof parsed === "object" && parsed !== null && "scenes" in parsed && Array.isArray(parsed.scenes)) {
      return parsed.scenes.map((scene) => (
        typeof scene === "object" && scene !== null && "text" in scene && typeof scene.text === "string" ? scene.text : ""
      )).filter(Boolean).join("\n");
    }
  } catch {
    return result;
  }
  return result;
}

export function AIProPanel({ hasVideo, busy, job, editorContext, onRun, onApplyScript, onApplySubtitles }: Props) {
  const [duration, setDuration] = useState(60);
  const [scriptDraft, setScriptDraft] = useState<string | null>(null);
  const [angelPrompt, setAngelPrompt] = useState("");
  const [notice, setNotice] = useState("");
  const result = job?.status === "completed" ? job.result_text : null;
  const resultForOperation = useMemo(() => result ? scriptText(result) : "", [result]);
  const generatedScript = job?.operation === "ai-script" ? resultForOperation : "";
  const script = scriptDraft ?? generatedScript;
  const subtitleText = job?.operation === "subtitle-timing" ? resultForOperation : "";

  async function copyResult() {
    if (!resultForOperation) return;
    try {
      await navigator.clipboard.writeText(resultForOperation);
      setNotice("Copied to clipboard.");
    } catch {
      setNotice("Clipboard access is unavailable in this browser.");
    }
  }

  const scriptBusy = busy && job?.operation === "ai-script";
  return (
    <div className="phase3-panel-content phase3-ai-grid">
      <article className="phase3-ai-card">
        <Clapperboard size={19} /><strong>Myanmar recap script</strong><small>Transcribe Thai dialogue locally, then draft five timed Burmese scenes with your configured AI provider.</small>
        <label>Target duration<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}><option value={30}>30 seconds</option><option value={60}>60 seconds</option><option value={120}>120 seconds</option></select></label>
        <button className="button button-primary" type="button" disabled={!hasVideo || busy} onClick={() => { setScriptDraft(null); onRun("ai-script", { ai_script_seconds: duration, ai_language: "th" }); }}><WandSparkles size={14} /> Generate script</button>
      </article>
      <article className="phase3-ai-card">
        <Scissors size={19} /><strong>Auto Cut Highlights</strong><small>Rank one-second audio windows by loudness and assemble the strongest non-overlapping moments.</small>
        <button className="button button-secondary" type="button" disabled={!hasVideo || busy} onClick={() => onRun("auto-highlights", { target_seconds: 60 })}>Create 60-second highlights</button>
      </article>
      <article className="phase3-ai-card">
        <Captions size={19} /><strong>Subtitle timing</strong><small>Use Whisper speech timestamps to build an SRT file in Thai.</small>
        <button className="button button-secondary" type="button" disabled={!hasVideo || busy} onClick={() => onRun("subtitle-timing", { ai_language: "th" })}>Generate timed SRT</button>
      </article>
      <article className="phase3-ai-card">
        <Hash size={19} /><strong>YouTube metadata</strong><small>Generate a Burmese title, description, and hashtags from the edited script below.</small>
        <button className="button button-secondary" type="button" disabled={busy || !script.trim()} onClick={() => { setScriptDraft(script); onRun("seo-metadata", { ai_script: script }); }}>Generate title & hashtags</button>
      </article>
      <article className="phase3-ai-card phase3-angel-card">
        <MessageCircle size={19} /><strong>Ask Angel</strong><small>Suggestions use the editor context and available tools; no external manuals or RAG data is configured.</small>
        <textarea value={angelPrompt} maxLength={1000} onChange={(event) => setAngelPrompt(event.target.value)} placeholder="Make my video more dramatic..." />
        <button className="button button-secondary" type="button" disabled={busy || !angelPrompt.trim()} onClick={() => onRun("angel-chat", { ai_prompt: angelPrompt, ai_context: editorContext })}><Bot size={14} /> Get suggestions</button>
      </article>
      {job?.status === "completed" && job.operation === "ai-script" && (
        <div className="phase3-result-card"><label>Editable Burmese script<textarea value={script} onChange={(event) => setScriptDraft(event.target.value)} rows={6} /></label><small>Reduce the script to 120 characters to use it as a single on-video text overlay. The full script remains available to copy.</small><div><button className="button button-secondary" type="button" disabled={!script.trim() || script.length > 120} onClick={() => onApplyScript(script)}>Apply to editor text</button><button className="button button-secondary" type="button" disabled={!resultForOperation} onClick={() => void copyResult()}><Copy size={14} /> Copy</button></div></div>
      )}
      {job?.status === "completed" && job.operation === "subtitle-timing" && <div className="phase3-result-card"><strong>Timed subtitle cues</strong><pre>{subtitleText}</pre><button className="button button-secondary" type="button" onClick={() => onApplySubtitles(subtitleText)}>Apply SRT to subtitle editor</button></div>}
      {job?.status === "completed" && job.operation === "seo-metadata" && <div className="phase3-result-card"><strong>Generated YouTube metadata</strong><pre>{result}</pre></div>}
      {job?.status === "completed" && job.operation === "angel-chat" && <div className="phase3-result-card"><strong>Angel’s suggestion</strong><p>{result}</p></div>}
      {job?.status === "completed" && job.operation === "auto-highlights" && <p className="phase2-help">Highlight reel ready. Use the job panel above to download it.</p>}
      {notice && <small aria-live="polite">{notice}</small>}
      {scriptBusy && <small aria-live="polite">Transcribing and drafting your recap…</small>}
    </div>
  );
}
