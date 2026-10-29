import { defineConfig } from "wxt";
import type { Plugin } from "vite";

// The bundler names virtual modules by absolute path in its comments. Strip the project root so a
// rebuild from the AMO sources zip in another directory gives the same files.
function stripProjectRoot(): Plugin {
  let root = "";
  return {
    name: "mrflow:strip-project-root",
    configResolved(config) {
      root = config.root.replace(/\/?$/, "/");
    },
    renderChunk(code) {
      return code.includes(root) ? { code: code.replaceAll(root, ""), map: null } : null;
    },
  };
}

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: "src",
  manifestVersion: 3,
  // Readable output: AMO reviewers compare it with the sources zip, and bug reports get real stack traces
  vite: () => ({ build: { minify: false }, plugins: [stripProjectRoot()] }),
  manifest: ({ browser }) => ({
    name: "MRFlow",
    icons: {
      48: "icons/icon48.png",
      96: "icons/icon96.png",
      128: "icons/icon128.png",
    },
    action: {},
    permissions: ["storage"],
    ...(browser === "firefox" && {
      browser_specific_settings: {
        gecko: {
          id: "{d16c5235-1761-48f3-9fb3-85e3a592e362}",
          strict_min_version: "140.0",
          data_collection_permissions: { required: ["none"] },
        },
      },
    }),
  }),
  zip: {
    // AMO reviewers rebuild the extension from this archive (see README, "Building from source")
    excludeSources: [".github/**", "docs/**", "e2e/**", "**/*.test.ts", "src/test/**"],
  },
});
