import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const AUDIT_ENV_KEY = "TMUX_CONTEXT_AUDIT_PATH";

export type AuditEvent = Record<string, unknown>;

export type AuditLoggerOptions = {
  filePath?: string;
  writer?: (line: string) => Promise<void> | void;
  now?: () => Date;
};

export type AuditLogger = {
  record: (event: AuditEvent) => Promise<void>;
};

const resolveWriter = (
  options: AuditLoggerOptions,
): ((line: string) => Promise<void>) => {
  if (options.writer) {
    return async (line) => {
      await options.writer?.(line);
    };
  }

  const filePath = options.filePath ?? process.env[AUDIT_ENV_KEY];
  if (filePath) {
    return async (line) => {
      await mkdir(dirname(filePath), { recursive: true });
      await appendFile(filePath, `${line}\n`, { encoding: "utf8" });
    };
  }

  return async (line) => {
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(`${line}\n`, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  };
};

export const createAuditLogger = (
  options: AuditLoggerOptions = {},
): AuditLogger => {
  const writer = resolveWriter(options);
  const clock = options.now ?? (() => new Date());

  const record = async (event: AuditEvent) => {
    const payload = {
      timestamp: clock().toISOString(),
      ...event,
    };
    const line = JSON.stringify(payload);
    await writer(line);
  };

  return { record };
};
