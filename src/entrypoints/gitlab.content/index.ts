import "./style.css";
import { getCurrentUserId, gitlabApi } from "@/core/gitlab/api";
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
    startFeatures(features, { api: gitlabApi, loadSettings, getCurrentUserId }, ctx.signal);
  },
});
