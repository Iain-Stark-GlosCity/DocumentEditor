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
import "./styles/live.css";
import { App } from "./workbench/App";

const registry = createRegistry();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App platform={getPlatform()} registry={registry} />
  </StrictMode>,
);
