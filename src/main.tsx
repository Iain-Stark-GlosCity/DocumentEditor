import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FormatRegistry } from "./core/registry";
import { markdownProvider } from "./formats/markdown";
import { getPlatform } from "./platform";
import "./styles/theme.css";
import "./styles/app.css";
import { App } from "./workbench/App";

const registry = new FormatRegistry();
registry.register(markdownProvider);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App platform={getPlatform()} registry={registry} />
  </StrictMode>,
);
