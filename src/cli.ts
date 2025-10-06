#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startSdkServer } from "@/sdk-server";

export const startCli = async () => {
  await startSdkServer({
    stdin: process.stdin,
    stdout: process.stdout,
  });
};

const isMainEntry = () => {
  const scriptArg = process.argv[1];
  if (typeof scriptArg !== "string") return false;
  try {
    const entryPath = realpathSync(scriptArg);
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    return entryPath === modulePath;
  } catch {
    return false;
  }
};

if (isMainEntry()) {
  startCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[tmux-contextual-log-mcp] fatal: ${message}`);
    process.exitCode = 1;
  });
}
