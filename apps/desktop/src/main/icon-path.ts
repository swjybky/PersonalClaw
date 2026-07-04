import { app } from "electron";
import { join } from "node:path";

export function resolveAppIconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "resources", "icon.png");
  }

  return join(__dirname, "../../resources/icon.png");
}
