import fontUrl from "@gitlab/fonts/gitlab-sans/GitLabSans.woff2?url";
import "./pajamas.css";

// GitLab Sans and light/dark mode for MRFlow's own pages. GitLab's dark tokens apply under html.gl-dark.
export function applyGitLabTheme(): void {
  const font = new FontFace("GitLab Sans", `url(${fontUrl})`, { weight: "100 900" });
  document.fonts.add(font);
  void font.load().catch(() => {});

  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => document.documentElement.classList.toggle("gl-dark", dark.matches);
  apply();
  dark.addEventListener("change", apply);
}
