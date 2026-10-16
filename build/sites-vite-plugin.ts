// Build-output adaptation of the upstream plugin. See sites-vite-plugin.LICENSE.
import { access, cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

// Preserve the deployment artifact consumed by the current host. Authentication
// is handled by Afterparty's Discord and password sessions, including previews.
export function sites({ hostingConfigFile = ".openai/hosting.json" } = {}): Plugin {
  let root = process.cwd();
  let command: "build" | "serve" = "build";
  return {
    name: "afterparty-hosting-output",
    configResolved(config) {
      root = config.root;
      command = config.command;
    },
    async closeBundle() {
      if (command !== "build") return;
      const output = resolve(root, "dist", ".openai");
      await rm(output, { recursive: true, force: true });
      await mkdir(output, { recursive: true });
      await cp(resolve(root, hostingConfigFile), resolve(output, "hosting.json"));
      if (await exists(resolve(root, "drizzle"))) {
        await cp(resolve(root, "drizzle"), resolve(output, "drizzle"), { recursive: true });
      }
    },
  };
}
