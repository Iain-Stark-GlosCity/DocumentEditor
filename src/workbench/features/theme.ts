import type { SettingValue } from "../../core/settings";
import type { Feature } from "../feature";

type ThemeChoice = SettingValue<"appearance.theme">;

const THEME_TITLES: Record<ThemeChoice, string> = {
  system: "Theme: follow system",
  light: "Theme: light",
  dark: "Theme: dark",
};
const CYCLE: readonly ThemeChoice[] = ["system", "light", "dark"];

/** Sets `data-theme` on the root element; "system" follows the operating system live. */
export const theme: Feature = {
  id: "theme",
  activate(wb) {
    const query =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    const apply = () => {
      const choice = wb.settings.get("appearance.theme");
      const resolved = choice === "system" ? (query?.matches ? "dark" : "light") : choice;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    const off = wb.settings.subscribe("appearance.theme", apply);
    query?.addEventListener("change", apply);
    return () => {
      off();
      query?.removeEventListener("change", apply);
    };
  },
  commands: (wb) => [
    ...CYCLE.map((choice) => ({
      id: `view.theme.${choice}`,
      title: THEME_TITLES[choice],
      run: () => wb.settings.set("appearance.theme", choice),
    })),
    {
      id: "view.cycleTheme",
      title: "Cycle theme",
      run: () => {
        const at = CYCLE.indexOf(wb.settings.get("appearance.theme"));
        wb.settings.set("appearance.theme", CYCLE[(at + 1) % CYCLE.length] ?? "system");
      },
    },
  ],
  menuItems: CYCLE.map((choice, order) => ({
    menu: "view",
    group: "3_theme",
    command: `view.theme.${choice}`,
    order,
  })),
};
