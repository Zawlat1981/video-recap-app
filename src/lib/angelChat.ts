import type { CreatorTemplate } from "./templates";

export function templateSuggestionContext(template: CreatorTemplate | null): string {
  if (!template) return "No template has been selected yet.";
  return [
    `Template: ${template.name}`,
    `Category: ${template.category}`,
    `Aspect ratio: ${template.ratio}`,
    `Text animation: ${template.textAnimation}`,
  ].join("\n");
}
