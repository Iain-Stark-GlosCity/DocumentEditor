/**
 * Every feature the app ships with. To add one: create a file in this folder that exports a
 * `Feature` and add one line below. Nothing else needs to change.
 */
import type { Feature } from "../feature";
import { autosave } from "./autosave";
import { editCommands } from "./edit-commands";
import { editorAppearance } from "./editor-appearance";
import { externalChanges } from "./external-changes";
import { find } from "./find";
import { focusMode } from "./focus-mode";
import { fileCommands } from "./file-commands";
import { outline } from "./outline";
import { paneFocus } from "./pane-focus";
import { recovery } from "./recovery";
import { formatMenu } from "./format-menu";
import { help } from "./help";
import { images } from "./images";
import { preview } from "./preview";
import { spellcheck } from "./spellcheck";
import { statusCursor } from "./status-cursor";
import { statusFormat } from "./status-format";
import { tableMenu } from "./table-menu";
import { tabs } from "./tabs";
import { theme } from "./theme";
import { uiCommands } from "./ui-commands";
import { viewMode } from "./view-mode";
import { windowTitle } from "./window-title";
import { wordCount } from "./word-count";

export const defaultFeatures: readonly Feature[] = [
  fileCommands,
  editCommands,
  formatMenu,
  editorAppearance,
  find,
  theme,
  tabs,
  uiCommands,
  help,
  statusCursor,
  statusFormat,
  windowTitle,
  externalChanges,
  autosave,
  recovery,
  focusMode,
  outline,
  // Before `preview`: its F6 command supersedes the preview's (see pane-focus.ts).
  paneFocus,
  preview,
  spellcheck,
  wordCount,
  tableMenu,
  images,
  viewMode,
];
