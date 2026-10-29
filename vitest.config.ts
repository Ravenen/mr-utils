import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

// WxtVitest resolves the "@/" alias and auto-imports, and gives tests a fake `browser`
export default defineConfig({
  plugins: [WxtVitest(), vue()],
});
