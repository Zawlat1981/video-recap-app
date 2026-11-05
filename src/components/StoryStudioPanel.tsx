"use client";

import { useState } from "react";
import { BookOpen, Copy, Sparkles } from "lucide-react";
import type { RenderJob } from "../lib/phase2";

type Props = {
  busy: boolean;
  job: RenderJob | null;
  onRun: (operation: "story-script", values: Record<string, string | number | boolean | string[]>) => void;
};

export function StoryStudioPanel({ busy, job, onRun }: Props) {
  const [idea, setIdea] = useState("");
  const [genre, setGenre] = useState("drama");
  const [chapters, setChapters] = useState(5);
  const [draft, setDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const generated = job?.status === "completed" && job.operation === "story-script" ? job.result_text ?? "" : "";
  const script = draft ?? generated;

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(script);
      setNotice("Script copied.");
    } catch {
      setNotice("Clipboard access is unavailable in this browser.");
    }
  }

  return (
    <div className="phase3-panel-content story-studio">
      <article className="phase3-ai-card story-studio-brief">
        <BookOpen size={19} />
        <strong>Start an original story</strong>
        <small>Describe your idea and Angel will draft a Burmese chapter outline, narration, and visual prompts. You can edit and copy the result.</small>
        <label>Story idea<textarea value={idea} maxLength={2000} rows={4} onChange={(event) => setIdea(event.target.value)} placeholder="ဥပမာ - မိသားစုလျှို့ဝှက်ချက်တစ်ခုကြောင့် မြို့ကိုပြန်လာတဲ့ အမျိုးသမီးတစ်ဦးအကြောင်း..." /></label>
        <div className="story-studio-options">
          <label>Genre<select value={genre} onChange={(event) => setGenre(event.target.value)}><option value="drama">Drama</option><option value="mystery">Mystery</option><option value="romance">Romance</option><option value="horror">Horror</option><option value="comedy">Comedy</option><option value="adventure">Adventure</option></select></label>
          <label>Chapters<select value={chapters} onChange={(event) => setChapters(Number(event.target.value))}><option value={3}>3</option><option value={5}>5</option><option value={7}>7</option><option value={10}>10</option><option value={12}>12</option></select></label>
        </div>
        <button className="button button-primary" type="button" disabled={busy || !idea.trim()} onClick={() => { setDraft(null); setNotice(""); onRun("story-script", { ai_prompt: idea.trim(), story_genre: genre, story_chapters: chapters }); }}>
          <Sparkles size={14} /> Generate Burmese story
        </button>
      </article>
      <article className="phase3-result-card story-studio-result">
        <div><strong>Editable story draft</strong><button className="button button-secondary" type="button" disabled={!script.trim()} onClick={() => void copyScript()}><Copy size={14} /> Copy</button></div>
        <textarea aria-label="Editable story draft" value={script} onChange={(event) => setDraft(event.target.value)} rows={18} placeholder="Your generated chapter outline will appear here. You can also write or edit the script yourself." />
        <small>AI drafts can contain language errors; review the Burmese wording before recording. This creates text only—images, narration audio, and chapter video rendering are not generated here.</small>
        {notice && <small aria-live="polite">{notice}</small>}
        {busy && job?.operation === "story-script" && <small aria-live="polite">Writing your story…</small>}
      </article>
    </div>
  );
}
