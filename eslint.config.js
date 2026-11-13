import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const tauriPattern = {
  group: ["@tauri-apps/*"],
  message: "Only src/platform/ may import @tauri-apps/* (CLAUDE.md rule 2). Use the Platform interface.",
};

export default defineConfig(
  { ignores: ["dist", "node_modules", "src-tauri/target", "src-tauri/gen"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Rule 2: no Tauri outside src/platform/.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/platform/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [tauriPattern] }] },
  },
  {
    // Rule 3: src/core/ is plain TypeScript. zustand/vanilla only (the root export pulls in React).
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "src/core/ must not import React (CLAUDE.md rule 3)." },
            { name: "react-dom", message: "src/core/ must not import React (CLAUDE.md rule 3)." },
            { name: "zustand", message: "Use zustand/vanilla in src/core/ (CLAUDE.md rule 3)." },
          ],
          patterns: [
            tauriPattern,
            { group: ["react/*", "react-dom/*"], message: "src/core/ must not import React (CLAUDE.md rule 3)." },
          ],
        },
      ],
    },
  },
  {
    // Rule 4: the workbench reaches formats only through the registry.
    files: ["src/workbench/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            tauriPattern,
            {
              group: ["**/formats/*", "**/formats"],
              message: "The workbench must not import from a format folder (CLAUDE.md rule 4). Use the registry.",
            },
          ],
        },
      ],
    },
  },
);
