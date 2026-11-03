"use client";

import { useState } from "react";
import { BrainCircuit, LayoutTemplate, Settings2 } from "lucide-react";
import { AIProPanel } from "./AIProPanel";
import { ExportProPanel } from "./ExportProPanel";
import { TemplatesProPanel } from "./TemplatesProPanel";
import type { RenderJob, RenderOperation } from "../lib/phase2";
import type { CreatorTemplate } from "../lib/templates";

const tabs = [
  { id: "templates", label: "Templates Pro", icon: LayoutTemplate },
  { id: "ai", label: "AI Pro", icon: BrainCircuit },
  { id: "export", label: "Export Pro", icon: Settings2 },
] as const;

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
};

export function Phase3Studio(props: Props) {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]["id"]>("templates");
  return (
    <section className="phase3-section panel" id="phase3" aria-labelledby="phase3-title">
      <div className="phase2-heading">
        <div><span className="section-kicker">PHASE 3 / CREATOR PRO</span><h2 id="phase3-title">Templates, AI and export profiles</h2></div>
        <span className="phase2-pill">Local-first tools</span>
      </div>
      <div className="phase2-tabs" role="tablist" aria-label="Phase 3 creator tools">
        {tabs.map(({ id, label, icon: Icon }) => <button type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? "active" : ""} key={id} onClick={() => setActiveTab(id)}><Icon size={15} />{label}</button>)}
      </div>
      {activeTab === "templates" && <TemplatesProPanel currentTemplate={props.currentTemplate} appliedTemplateId={props.appliedTemplateId} onApply={props.onTemplateApply} />}
      {activeTab === "ai" && <AIProPanel hasVideo={props.hasVideo} busy={props.busy} job={props.job} editorContext={props.editorContext} onRun={props.onRun} onApplyScript={props.onApplyScript} onApplySubtitles={props.onApplySubtitles} />}
      {activeTab === "export" && <ExportProPanel hasVideo={props.hasVideo} busy={props.busy} onRun={props.onRun} />}
    </section>
  );
}
