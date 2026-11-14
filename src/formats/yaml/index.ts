import type { TextFormatProvider } from "../../core/format";
import { problemChecking } from "../../core/problems";
import { dataEditing } from "../shared/data-editing";
import { lazyLanguage } from "../shared/lazy-language";
import { yamlDiagnosticsFor } from "./lint";

const language = lazyLanguage(() => import("@codemirror/lang-yaml").then((m) => m.yaml()));

/**
 * YAML, with problems from the `yaml` package. There is no formatter: reformatting YAML without
 * losing comments and anchors is a larger job than whitespace. Tab inserts spaces, because YAML
 * does not allow tabs for indentation.
 */
export const yamlProvider: TextFormatProvider = {
  kind: "text",
  id: "yaml",
  name: "YAML",
  fileExtensions: ["yaml", "yml"],
  viewModes: ["source"],
  spellcheck: false,
  settings: ["yaml.lint"],
  editorExtensions: (context) => [
    language(),
    dataEditing({ indent: 2, closeBrackets: true }),
    context.setting("yaml.lint", true)
      ? problemChecking({ source: (state) => yamlDiagnosticsFor(state.doc.toString()) })
      : [],
  ],
};
