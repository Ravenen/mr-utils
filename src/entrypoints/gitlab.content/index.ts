import "./style.css";
import { startContentScript } from "@/legacy/content-script";

export default defineContentScript({
  matches: [
    "*://*.gitlab.com/*/merge_requests/",
    "*://*.gitlab.com/*/merge_requests",
    "*://*.gitlab.com/*/merge_requests*",
  ],
  runAt: "document_end",
  cssInjectionMode: "manifest",
  main() {
    startContentScript();
  },
});
