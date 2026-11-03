import type { AssetInfo, ElementKind } from "./phase2";

export type TemplateElement = {
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

export type CreatorTemplate = {
  id: string;
  name: string;
  category: string;
  description: string;
  ratio: "16:9" | "9:16" | "1:1";
  textAnimation: "none" | "fade" | "slide" | "pop" | "typewriter";
  textColor: "white" | "yellow" | "cyan";
  brandPrimary: string;
  brandBackground: string;
  textOverlay: string;
  introEnabled: boolean;
  outroEnabled: boolean;
  fontId: string;
  logo: AssetInfo | null;
  logoEnabled: boolean;
  logoOpacity: number;
  logoScale: number;
  bgm: AssetInfo | null;
  bgmVolume: number;
  bgmDucking: boolean;
  elements: TemplateElement[];
  custom?: boolean;
};

const categories = [
  { name: "Thai Drama", color: "#e95d54", ratio: "9:16", animation: "typewriter", text: "ချစ်ခြင်းနဲ့ ကံကြမ္မာကြားက ဇာတ်လမ်း" },
  { name: "Myanmar Drama", color: "#ff6600", ratio: "9:16", animation: "fade", text: "ဒီနေ့ ဇာတ်လမ်းက..." },
  { name: "Korean Drama", color: "#9b72cf", ratio: "9:16", animation: "slide", text: "မမျှော်လင့်တဲ့ အချစ်ဇာတ်လမ်း" },
  { name: "Movie Recap", color: "#d8a735", ratio: "16:9", animation: "pop", text: "တစ်မိနစ်အတွင်း ဇာတ်လမ်းအကျဉ်း" },
  { name: "Horror", color: "#754c73", ratio: "9:16", animation: "typewriter", text: "ညသန်းခေါင်က လျှို့ဝှက်ချက်" },
  { name: "Love Story", color: "#db6f91", ratio: "1:1", animation: "fade", text: "သူတို့ရဲ့ အချစ်ဇာတ်လမ်း" },
  { name: "Fight & Action", color: "#c45a32", ratio: "16:9", animation: "pop", text: "နောက်ဆုံးတိုက်ပွဲ စတင်ပြီ" },
  { name: "Comedy", color: "#51a993", ratio: "1:1", animation: "pop", text: "ရယ်မောစရာ အခိုက်အတန့်" },
] as const;

const variations = [
  { suffix: "Spotlight", element: "sparkle", outroEnabled: true },
  { suffix: "Story", element: "bubble", outroEnabled: false },
  { suffix: "Reaction", element: "shock", outroEnabled: true },
] as const;

export const BUILT_IN_TEMPLATES: CreatorTemplate[] = categories.flatMap((category, categoryIndex) =>
  variations.map((variation, variationIndex) => ({
    id: `${category.name.toLowerCase().replaceAll(" ", "-")}-${variation.suffix.toLowerCase()}`,
    name: `${category.name} ${variation.suffix}`,
    category: category.name,
    description: `${category.ratio} layout with ${category.name.toLowerCase()} styling`,
    ratio: category.ratio,
    textAnimation: category.animation,
    textColor: categoryIndex % 2 === 0 ? "yellow" : "white",
    brandPrimary: category.color,
    brandBackground: categoryIndex % 2 === 0 ? "#172A3A" : "#241D2C",
    textOverlay: category.text,
    introEnabled: variationIndex === 0,
    outroEnabled: variation.outroEnabled,
    fontId: "",
    logo: null,
    logoEnabled: false,
    logoOpacity: 0.8,
    logoScale: 0.16,
    bgm: null,
    bgmVolume: 0.2,
    bgmDucking: true,
    elements: [{
      kind: variation.element as ElementKind,
      x: 0.82,
      y: 0.25,
      scale: 0.8,
      rotation: 0,
      start_seconds: 0,
      end_seconds: 60,
      text: variation.element === "bubble" ? "ကြည့်လိုက်ပါ!" : "",
      subtitle: "",
    }],
  })),
);

export const TEMPLATE_CATEGORIES = ["All", ...categories.map(({ name }) => name), "Custom"];

export function isCreatorTemplate(value: unknown): value is CreatorTemplate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const template = value as Record<string, unknown>;
  const elementKinds: ElementKind[] = [
    "heart", "star", "sparkle", "happy", "sad", "angry", "shock", "laugh",
    "tractor", "lower-third", "bubble",
  ];
  const isAsset = (asset: unknown, category: AssetInfo["category"]) =>
    asset === null || (
      typeof asset === "object"
      && asset !== null
      && "id" in asset
      && typeof asset.id === "string"
      && /^[a-f0-9]{32}$/.test(asset.id)
      && "filename" in asset
      && typeof asset.filename === "string"
      && "asset_url" in asset
      && typeof asset.asset_url === "string"
      && "category" in asset
      && asset.category === category
    );
  return typeof template.id === "string"
    && template.id.length <= 100
    && typeof template.name === "string"
    && template.name.length <= 60
    && typeof template.category === "string"
    && ["16:9", "9:16", "1:1"].includes(String(template.ratio))
    && ["none", "fade", "slide", "pop", "typewriter"].includes(String(template.textAnimation))
    && ["white", "yellow", "cyan"].includes(String(template.textColor))
    && typeof template.brandPrimary === "string"
    && /^#[0-9a-f]{6}$/i.test(template.brandPrimary)
    && typeof template.brandBackground === "string"
    && /^#[0-9a-f]{6}$/i.test(template.brandBackground)
    && typeof template.textOverlay === "string"
    && template.textOverlay.length <= 500
    && typeof template.introEnabled === "boolean"
    && typeof template.outroEnabled === "boolean"
    && typeof template.fontId === "string"
    && typeof template.logoEnabled === "boolean"
    && typeof template.logoOpacity === "number"
    && Number.isFinite(template.logoOpacity)
    && template.logoOpacity >= 0
    && template.logoOpacity <= 1
    && typeof template.logoScale === "number"
    && Number.isFinite(template.logoScale)
    && template.logoScale >= 0.05
    && template.logoScale <= 0.5
    && isAsset(template.logo, "image")
    && (!template.logoEnabled || template.logo !== null)
    && typeof template.bgmVolume === "number"
    && Number.isFinite(template.bgmVolume)
    && template.bgmVolume >= 0
    && template.bgmVolume <= 1
    && isAsset(template.bgm, "audio")
    && typeof template.bgmDucking === "boolean"
    && Array.isArray(template.elements)
    && template.elements.length <= 30
    && template.elements.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const element = item as Record<string, unknown>;
      const within = (key: string, minimum: number, maximum: number) =>
        typeof element[key] === "number"
        && Number.isFinite(element[key])
        && element[key] >= minimum
        && element[key] <= maximum;
      return typeof element.kind === "string"
        && elementKinds.includes(element.kind as ElementKind)
        && within("x", 0, 1)
        && within("y", 0, 1)
        && within("scale", 0.2, 2)
        && within("rotation", -180, 180)
        && within("start_seconds", 0, 86_400)
        && within("end_seconds", 0.1, 86_400)
        && Number(element.end_seconds) > Number(element.start_seconds)
        && typeof element.text === "string"
        && typeof element.subtitle === "string";
    });
}
