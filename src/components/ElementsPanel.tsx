"use client";

import { useRef, useState } from "react";
import type { ElementKind, ElementOverlay } from "../lib/phase2";

const elementCatalog: { kind: ElementKind; label: string; glyph: string }[] = [
  { kind: "heart", label: "Love", glyph: "♥" },
  { kind: "star", label: "Star", glyph: "★" },
  { kind: "sparkle", label: "Sparkle", glyph: "✦" },
  { kind: "happy", label: "Happy", glyph: "☺" },
  { kind: "sad", label: "Sad", glyph: "☹" },
  { kind: "angry", label: "Angry", glyph: "!" },
  { kind: "shock", label: "Shock", glyph: "?" },
  { kind: "laugh", label: "Laugh", glyph: "☻" },
  { kind: "tractor", label: "Tractor", glyph: "🚜" },
  { kind: "lower-third", label: "Lower third", glyph: "▰" },
  { kind: "bubble", label: "Speech bubble", glyph: "▱" },
];

type Props = {
  elements: ElementOverlay[];
  onChange: (elements: ElementOverlay[]) => void;
};

export function ElementsPanel({ elements, onChange }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = elements.find((element) => element.id === selectedId);

  function addElement(kind: ElementKind) {
    const item: ElementOverlay = {
      id: crypto.randomUUID(),
      kind,
      x: 0.5,
      y: 0.76,
      scale: 1,
      rotation: 0,
      start_seconds: 0,
      end_seconds: 86_400,
      text: kind === "bubble" ? "မင်္ဂလာပါ" : kind === "lower-third" ? "Name" : "",
      subtitle: "",
    };
    onChange([...elements, item]);
    setSelectedId(item.id);
  }

  function updateSelected(changes: Partial<ElementOverlay>) {
    if (!selectedId) return;
    onChange(elements.map((element) => element.id === selectedId ? { ...element, ...changes } : element));
  }

  function moveElement(id: string, clientX: number, clientY: number) {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const x = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height));
    onChange(elements.map((element) => element.id === id ? { ...element, x, y } : element));
  }

  return (
    <div className="phase2-panel-content">
      <div className="phase2-element-grid">
        {elementCatalog.map((item) => (
          <button className="phase2-element-choice" type="button" key={item.kind} onClick={() => addElement(item.kind)}>
            <span>{item.glyph}</span><small>{item.label}</small>
          </button>
        ))}
      </div>
      <div className="phase2-element-stage" ref={stageRef} aria-label="Drag elements to position them">
        {elements.map((element) => {
          const item = elementCatalog.find((candidate) => candidate.kind === element.kind);
          return (
            <button
              className={`phase2-stage-element${element.id === selectedId ? " selected" : ""}`}
              key={element.id}
              type="button"
              draggable
              onClick={() => setSelectedId(element.id)}
              onDragEnd={(event) => moveElement(element.id, event.clientX, event.clientY)}
              style={{ left: `${element.x * 100}%`, top: `${element.y * 100}%`, transform: `translate(-50%, -50%) rotate(${element.rotation}deg) scale(${element.scale})` }}
              aria-label={`Move ${item?.label ?? element.kind}`}
            >
              {element.kind === "bubble" || element.kind === "lower-third" ? element.text || item?.label : item?.glyph}
            </button>
          );
        })}
        {!elements.length && <span className="phase2-stage-empty">Add an element, then drag it to position.</span>}
      </div>
      {selected && (
        <div className="phase2-element-controls">
          {(selected.kind === "bubble" || selected.kind === "lower-third") && (
            <>
              <label>Text<input value={selected.text} maxLength={100} onChange={(event) => updateSelected({ text: event.target.value })} /></label>
              {selected.kind === "lower-third" && <label>Subtitle<input value={selected.subtitle} maxLength={100} onChange={(event) => updateSelected({ subtitle: event.target.value })} /></label>}
            </>
          )}
          <label>Scale <strong>{selected.scale.toFixed(1)}×</strong><input type="range" min={0.2} max={2} step={0.1} value={selected.scale} onChange={(event) => updateSelected({ scale: Number(event.target.value) })} /></label>
          <label>Rotation <strong>{selected.rotation}°</strong><input type="range" min={-180} max={180} step={5} value={selected.rotation} onChange={(event) => updateSelected({ rotation: Number(event.target.value) })} /></label>
          <label>Start (seconds)<input type="number" min={0} step={0.1} value={selected.start_seconds} onChange={(event) => updateSelected({ start_seconds: Math.max(0, Number(event.target.value)) })} /></label>
          <label>End (seconds)<input type="number" min={0.1} step={0.1} value={selected.end_seconds} onChange={(event) => updateSelected({ end_seconds: Math.max(selected.start_seconds + 0.1, Number(event.target.value)) })} /></label>
          <button type="button" className="button button-secondary" onClick={() => { onChange(elements.filter((element) => element.id !== selected.id)); setSelectedId(null); }}>Remove element</button>
        </div>
      )}
      <p className="phase2-help">The export currently includes 11 original, editable stickers and title/speech overlays. Drag items on the canvas to move them.</p>
    </div>
  );
}
