import "./style.css";
import { createGitLabApi, getCurrentUserId } from "@/core/gitlab/api";
import { csrfToken } from "@/core/gitlab/dom";
import { startFeatures } from "@/core/lifecycle";
import { loadSettings, watchSettings } from "@/core/settings";
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
      getCsrfToken: () => csrfToken(),
    });
    startFeatures(
      features,
      {
        api,
        loadSettings,
        watchSettings: (onChange, signal) => watchSettings(onChange, signal),
        getCurrentUserId: (signal) => getCurrentUserId(api, signal),
      },
      ctx.signal,
    );
  },
});
