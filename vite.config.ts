import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * The CSP in index.html is strict. The dev server needs inline scripts (React refresh
 * preamble) and a websocket for hot reload, so relax it for `serve` only.
 */
function devCsp(): Plugin {
  return {
    name: "dev-csp",
    apply: "serve",
    transformIndexHtml(html) {
      return html
        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
        .replace("connect-src ipc:", "connect-src ws://localhost:1420 ipc:");
    },
  };
}

/**
 * KaTeX's stylesheet lists each font as woff2, woff and ttf. WebView2 reads woff2, so keep only
 * that: three times fewer files to bundle, and nothing the strict CSP would have to consider.
 */
function katexWoff2Only(): Plugin {
  return {
    name: "katex-woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!id.split("?")[0]?.endsWith("katex/dist/katex.min.css")) return null;
      return code.replace(
        /,url\([^)]*\.woff\) format\("woff"\),url\([^)]*\.ttf\) format\("truetype"\)/g,
        "",
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), devCsp(), katexWoff2Only()],
  resolve: {
    // The package's "browser" export condition selects a build that creates a DOM element at
    // import time, which throws in the render Web Worker ("document is not defined"). Use the
    // DOM-free build everywhere; it is the same decoder, with the entity table bundled.
    alias: [
      {
        find: /^decode-named-character-reference$/,
        replacement: fileURLToPath(
          new URL("./node_modules/decode-named-character-reference/index.js", import.meta.url),
        ),
      },
    ],
  },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: "es2022",
    // The CSP has `font-src 'self'`, which does not allow `data:` URIs: never inline a font.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/i.test(file) ? false : undefined),
  },
  // The preview's render worker loads the Markdown pipeline with a dynamic import, which needs
  // an ES-module worker bundle.
  worker: { format: "es" },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    // Playwright specs run with `npm run test:e2e`.
    exclude: ["node_modules/**", "tests/e2e/**"],
  },
});
