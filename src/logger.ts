import stripAnsi from "strip-ansi";
import { createAuditLogger } from "@/audit-log";
import { loadConfig } from "@/config";

const formatConsoleMessage = (message: string) =>
  stripAnsi(message).replace(/\s+/g, " ").trim();

export type Logger = {
  info: (message: string) => void;
  error: (message: string) => void;
  audit: ReturnType<typeof createAuditLogger>["record"];
};

export const createLogger = (): Logger => {
  const config = loadConfig();
  const auditLogger = createAuditLogger({ filePath: config.auditLogPath });

  const write = (level: "info" | "error", message: string) => {
    const formatted = formatConsoleMessage(message);
    if (formatted === "") return;

    if (level === "info") console.info(formatted);
    else console.error(formatted);
  };

  return {
    info: (message) => write("info", message),
    error: (message) => write("error", message),
    audit: auditLogger.record,
  };
};

export const __internal = { formatConsoleMessage };
