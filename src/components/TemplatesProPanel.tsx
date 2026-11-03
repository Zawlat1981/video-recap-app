"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Search, Save, Sparkles } from "lucide-react";
import {
  BUILT_IN_TEMPLATES,
  isCreatorTemplate,
  TEMPLATE_CATEGORIES,
  type CreatorTemplate,
} from "../lib/templates";

const STORAGE_KEY = "recapkit-custom-templates";

type Props = {
  currentTemplate: CreatorTemplate | null;
  appliedTemplateId: string | null;
  onApply: (template: CreatorTemplate) => void;
};

export function TemplatesProPanel({ currentTemplate, appliedTemplateId, onApply }: Props) {
  const [customTemplates, setCustomTemplates] = useState<CreatorTemplate[]>([]);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [customName, setCustomName] = useState("");
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (!saved) return;
        const parsed: unknown = JSON.parse(saved);
        if (!Array.isArray(parsed) || !parsed.every(isCreatorTemplate)) {
          throw new Error("Saved custom templates have an invalid format.");
        }
        setCustomTemplates(parsed);
      } catch (error: unknown) {
        setStorageError(error instanceof Error ? error.message : "Custom templates could not be loaded.");
      }
    });
    return () => { active = false; };
  }, []);

  const templates = useMemo(() => {
    const all = [...BUILT_IN_TEMPLATES, ...customTemplates];
    return all.filter((template) =>
      (category === "All" || (category === "Custom" ? template.custom : template.category === category))
      && `${template.name} ${template.category} ${template.description}`.toLowerCase().includes(search.toLowerCase()),
    );
  }, [category, customTemplates, search]);

  function saveTemplate() {
    if (!currentTemplate) return;
    const name = customName.trim();
    if (!name || name.length > 60) {
      setStorageError("Enter a template name between 1 and 60 characters.");
      return;
    }
    const saved: CreatorTemplate = {
      ...currentTemplate,
      id: `custom-${crypto.randomUUID()}`,
      name,
      category: "Custom",
      custom: true,
      elements: currentTemplate.elements.map((element) => ({ ...element })),
    };
    const updated = [saved, ...customTemplates];
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setCustomTemplates(updated);
      setCustomName("");
      setStorageError(null);
    } catch (error: unknown) {
      setStorageError(error instanceof Error ? error.message : "The custom template could not be saved in this browser.");
    }
  }

  function removeTemplate(id: string) {
    const updated = customTemplates.filter((template) => template.id !== id);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setCustomTemplates(updated);
      setStorageError(null);
    } catch (error: unknown) {
      setStorageError(error instanceof Error ? error.message : "The custom template could not be removed.");
    }
  }

  return (
    <div className="phase3-panel-content">
      <div className="phase3-toolbar">
        <label className="phase3-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search templates" /></label>
        <label className="phase3-save-current">Save current as custom
          <span><input value={customName} maxLength={60} onChange={(event) => setCustomName(event.target.value)} placeholder="Template name" /><button className="button button-secondary" type="button" disabled={!currentTemplate || !customName.trim()} onClick={saveTemplate}><Save size={14} /> Save</button></span>
        </label>
      </div>
      <div className="phase3-category-list" aria-label="Template categories">
        {TEMPLATE_CATEGORIES.map((item) => <button key={item} type="button" className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
      </div>
      {storageError && <p className="phase2-error" role="alert">{storageError}</p>}
      <div className="phase3-template-grid">
        {templates.map((template, index) => (
          <article className={`phase3-template-card${appliedTemplateId === template.id ? " selected" : ""}`} key={template.id}>
            <button type="button" className={`phase3-template-art art-${index % 8}`} style={{ aspectRatio: template.ratio.replace(":", " / "), background: `linear-gradient(145deg, ${template.brandPrimary}, #172a3a 75%)` }} onClick={() => onApply(template)} aria-label={`Apply ${template.name}`}>
              <span className="phase3-art-kicker">{template.category}</span><strong>{template.textOverlay}</strong><span className="phase3-art-brand">RECAPKIT</span>
            </button>
            <div className="phase3-template-info"><span><strong>{template.name}</strong><small>{template.description}</small></span>{appliedTemplateId === template.id ? <Check size={17} /> : <Sparkles size={16} />}</div>
            <div className="phase3-template-actions"><button className="button button-secondary" type="button" onClick={() => onApply(template)}>Apply template</button>{template.custom && <button className="phase3-remove-template" type="button" onClick={() => removeTemplate(template.id)}>Remove</button>}</div>
          </article>
        ))}
        {!templates.length && <p className="phase2-help">No templates match this search.</p>}
      </div>
      <p className="phase2-help">24 built-in presets apply the ratio, text style, brand colors, intro/outro, and overlay settings. Saving the current editor also stores its selected font, logo, and uploaded BGM reference. Custom presets stay in this browser.</p>
    </div>
  );
}
