import { iconSpriteUrl } from "@/core/gitlab/dom";

// SVG icon from GitLab's sprite, put before the target's content. Nothing when the page has no sprite.
export function prependIcon(target: Element, iconName: string): void {
  const spriteUrl = iconSpriteUrl();
  if (!spriteUrl) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("s14", "gl-align-middle");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `${spriteUrl}#${iconName}`);
  svg.appendChild(use);
  target.prepend(svg);
}
