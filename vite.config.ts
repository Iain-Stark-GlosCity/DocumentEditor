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

export default defineConfig({
  plugins: [react(), devCsp()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022" },
  // The preview's render worker loads the Markdown pipeline with a dynamic import, which needs
  // an ES-module worker bundle.
  worker: { format: "es" },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
  },
});
