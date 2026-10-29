import "./style.css";
import { createGitLabApi, getCurrentUserId } from "@/core/gitlab/api";
import { startFeatures } from "@/core/lifecycle";
import { loadSettings } from "@/core/settings";
import { features } from "@/features";

export default defineContentScript({
  matches: [
    "*://*.gitlab.com/*/merge_requests/",
    "*://*.gitlab.com/*/merge_requests",
    "*://*.gitlab.com/*/merge_requests*",
  ],
  runAt: "document_end",
  cssInjectionMode: "manifest",
  main(ctx) {
    const api = createGitLabApi({
      origin: location.origin,
      getCsrfToken: () => document.querySelector('meta[name="csrf-token"]')?.getAttribute("content"),
    });
    startFeatures(
      features,
      { api, loadSettings, getCurrentUserId: (signal) => getCurrentUserId(api, signal) },
      ctx.signal,
    );
  },
});
