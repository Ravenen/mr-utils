import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".output/", ".wxt/", "dist/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions },
    },
  },
  {
    // Ported from 1.x as is; tightened while it is split into features
    files: ["src/legacy/**", "src/entrypoints/popup/main.js"],
    rules: {
      "no-empty": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
