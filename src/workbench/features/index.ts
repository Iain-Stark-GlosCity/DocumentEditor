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
import { fileCommands } from "./file-commands";
import { recovery } from "./recovery";
import { help } from "./help";
import { preview } from "./preview";
import { statusCursor } from "./status-cursor";
import { statusFormat } from "./status-format";
import { tabs } from "./tabs";
import { theme } from "./theme";
import { uiCommands } from "./ui-commands";
import { viewMode } from "./view-mode";
import { windowTitle } from "./window-title";

export const defaultFeatures: readonly Feature[] = [
  fileCommands,
  editCommands,
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
  preview,
  viewMode,
];
