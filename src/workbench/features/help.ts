import { APP_NAME, APP_VERSION } from "../../core/app-info";
import type { Feature } from "../feature";

export const help: Feature = {
  id: "help",
  commands: (wb) => [
    {
      id: "help.about",
      title: `About ${APP_NAME}`,
      run: async () => {
        await wb.ask({
          title: `About ${APP_NAME}`,
          message: `${APP_NAME} version ${APP_VERSION}. A document editor, starting with Markdown.`,
          actions: [{ value: "ok", label: "Close" }],
          cancelValue: "ok",
        });
      },
    },
  ],
  menuItems: [{ menu: "help", group: "1_about", command: "help.about" }],
};
