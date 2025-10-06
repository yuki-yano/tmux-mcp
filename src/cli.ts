import { startSdkServer } from "@/sdk-server";

export const startCli = async () => {
  await startSdkServer({
    stdin: process.stdin,
    stdout: process.stdout,
  });
};

const isMainEntry = () => {
  if (typeof process.argv[1] !== "string") return false;
  const scriptPath = process.argv[1];
  try {
    return (
      new URL(import.meta.url).pathname ===
      new URL(`file://${scriptPath}`).pathname
    );
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
