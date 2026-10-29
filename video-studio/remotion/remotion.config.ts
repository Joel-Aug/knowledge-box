import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);

// Reuse an already-installed Chrome Headless Shell when Remotion can't download its own
// (e.g. sandboxed networks). Override with REMOTION_BROWSER_EXECUTABLE.
const findChrome = (): string | null => {
  if (process.env.REMOTION_BROWSER_EXECUTABLE) return process.env.REMOTION_BROWSER_EXECUTABLE;
  const hfDir = join(homedir(), ".cache/hyperframes/chrome/chrome-headless-shell");
  if (existsSync(hfDir)) {
    for (const v of readdirSync(hfDir).sort().reverse()) {
      const bin = join(hfDir, v, "chrome-headless-shell-linux64/chrome-headless-shell");
      if (existsSync(bin)) return bin;
    }
  }
  return null;
};

const chrome = findChrome();
if (chrome) Config.setBrowserExecutable(chrome);
