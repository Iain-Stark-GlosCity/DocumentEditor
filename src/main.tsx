import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createRegistry } from "./create-registry";
import { getPlatform } from "./platform";
import "./styles/theme.css";
import "./styles/app.css";
import "./styles/syntax.css";
import "./styles/search.css";
import "./styles/preview.css";
import "./styles/outline.css";
import "./styles/parts.css";
import "./styles/live.css";
import "./styles/ribbon.css";
import "./styles/format-switcher.css";
import "./styles/csv.css";
import "./styles/lint.css";
import "./styles/docx.css";
import { App } from "./workbench/App";

const registry = createRegistry();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App platform={getPlatform(registry)} registry={registry} />
  </StrictMode>,
);
