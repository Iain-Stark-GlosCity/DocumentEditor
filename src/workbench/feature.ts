/**
 * A Feature is one self-contained contribution to the workbench. Each lives in its own file
 * under `src/workbench/features/` and is listed once in `features/index.ts`. Adding one needs
 * no change to `App.tsx`, `workbench.ts` or any other feature.
 *
 * Everything is optional; use only what the feature needs.
 */
import type { Extension } from "@codemirror/state";
import type { ComponentType } from "react";
import type { Command } from "../core/commands";
import type { OpenDocument } from "../core/documents";
import type { SettingKey } from "../core/settings";
import type { Workbench } from "./workbench";

export interface FeatureComponentProps {
  workbench: Workbench;
}

/** An item in the status bar. Return null from the component to show nothing. */
export interface StatusItem {
  id: string;
  /** Default `left`. */
  align?: "left" | "right";
  /** Lower sorts first within its side. Default 100. */
  order?: number;
  component: ComponentType<FeatureComponentProps>;
}

/**
 * Places a registered command in a menu. `menu` is `file`, `edit`, `format`, `view` or `help` (any other
 * id creates a new menu before Help). Groups are separated by dividers and sorted by name, so
 * prefix them with a number to control order, for example `1_new`.
 */
export interface MenuItem {
  menu: string;
  group: string;
  /** Id of a registered command. Items whose command is missing are skipped. */
  command: string;
  /** Lower sorts first within its group. Default 100. */
  order?: number;
  /** Overrides the command title in the menu. */
  label?: string;
}

/** A pane beside the editor, in a resizable two-pane layout. */
export interface SidePane {
  id: string;
  /** Accessible name of the pane. */
  title: string;
  /** Which side of the editor the pane docks to. Default `right`. */
  side?: "left" | "right";
  /** Initial width as a percentage of the editor area. Default 40. */
  defaultSize?: number;
  /**
   * A React hook (called on every render of the slot) saying whether the pane is shown. Read
   * settings or documents with the hooks in `workbench/hooks.ts`.
   */
  useVisible(workbench: Workbench): boolean;
  component: ComponentType<FeatureComponentProps>;
}

export interface Feature {
  /** Unique, for example `file-commands`. */
  id: string;

  /** Commands to register while the workbench runs. Removed automatically on dispose. */
  commands?(workbench: Workbench): readonly Command[];

  /**
   * CodeMirror extensions for a document. Held in a Compartment, so they can be rebuilt without
   * losing editor state: list the settings the result depends on in `reconfigureOn`, or call
   * `workbench.reconfigureEditors(id)` yourself.
   */
  editorExtensions?(doc: OpenDocument, workbench: Workbench): Extension;
  reconfigureOn?: readonly SettingKey[];

  statusItems?: readonly StatusItem[];
  menuItems?: readonly MenuItem[];
  sidePane?: SidePane;
  /**
   * Components rendered once at the end of the app, for modal pickers and the like. Each decides
   * for itself whether to show anything.
   */
  overlays?: readonly ComponentType<FeatureComponentProps>[];

  /** Runs when the workbench starts. May return a function that undoes whatever it did. */
  activate?(workbench: Workbench): void | (() => void);
}
