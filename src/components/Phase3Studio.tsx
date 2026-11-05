"use client";

import { BookOpen, BrainCircuit, LayoutTemplate, Settings2 } from "lucide-react";
import { AIProPanel } from "./AIProPanel";
import { ExportProPanel } from "./ExportProPanel";
import { StoryStudioPanel } from "./StoryStudioPanel";
import { TemplatesProPanel } from "./TemplatesProPanel";
import type { RenderJob, RenderOperation } from "../lib/phase2";
import type { CreatorTemplate } from "../lib/templates";

const tabs = [
  { id: "templates", label: "Templates Pro", icon: LayoutTemplate },
  { id: "ai", label: "AI Pro", icon: BrainCircuit },
  { id: "story", label: "Story Studio", icon: BookOpen },
  { id: "export", label: "Export Pro", icon: Settings2 },
] as const;

export type Phase3Tab = (typeof tabs)[number]["id"];

type Props = {
  hasVideo: boolean;
  busy: boolean;
  job: RenderJob | null;
  currentTemplate: CreatorTemplate | null;
  appliedTemplateId: string | null;
  editorContext: string;
  onTemplateApply: (template: CreatorTemplate) => void;
  onRun: (operation: RenderOperation, values?: Record<string, string | number | boolean | string[]>) => void;
  onApplyScript: (text: string) => void;
  onApplySubtitles: (srt: string) => void;
  activeTab: Phase3Tab;
  onActiveTabChange: (tab: Phase3Tab) => void;
};

export function Phase3Studio(props: Props) {
  return (
    <section className="phase3-section panel" id="phase3" aria-labelledby="phase3-title">
      <div className="phase2-heading">
        <div><span className="section-kicker">PHASE 3 / CREATOR PRO</span><h2 id="phase3-title">Templates, AI, stories and export profiles</h2></div>
        <span className="phase2-pill">Local-first tools</span>
      </div>
      <div className="phase2-tabs" role="tablist" aria-label="Phase 3 creator tools">
        {tabs.map(({ id, label, icon: Icon }) => <button type="button" role="tab" aria-selected={props.activeTab === id} className={props.activeTab === id ? "active" : ""} key={id} onClick={() => props.onActiveTabChange(id)}><Icon size={15} />{label}</button>)}
      </div>
      <div hidden={props.activeTab !== "templates"}><TemplatesProPanel currentTemplate={props.currentTemplate} appliedTemplateId={props.appliedTemplateId} onApply={props.onTemplateApply} /></div>
      <div hidden={props.activeTab !== "ai"}><AIProPanel hasVideo={props.hasVideo} busy={props.busy} job={props.job} editorContext={props.editorContext} onRun={props.onRun} onApplyScript={props.onApplyScript} onApplySubtitles={props.onApplySubtitles} /></div>
      <div hidden={props.activeTab !== "story"}><StoryStudioPanel busy={props.busy} job={props.job} onRun={(operation, values) => props.onRun(operation, values)} /></div>
      <div hidden={props.activeTab !== "export"}><ExportProPanel hasVideo={props.hasVideo} busy={props.busy} onRun={props.onRun} /></div>
    </section>
  );
}
