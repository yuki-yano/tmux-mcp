const DEFAULT_CAPTURE_LINES = 2_000;

const parsePositiveInteger = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
};

export type AppConfig = {
  tmuxPath: string;
  defaultCaptureLines: number;
  auditLogPath?: string;
};

export const loadConfig = (): AppConfig => {
  const tmuxPath =
    process.env.TMUX_CONTEXT_TMUX_PATH ?? process.env.TMUX ?? "tmux";
  const defaultCaptureLines = parsePositiveInteger(
    process.env.TMUX_CONTEXT_CAPTURE_LINES,
    DEFAULT_CAPTURE_LINES,
  );
  const auditLogPath = process.env.TMUX_CONTEXT_AUDIT_PATH ?? undefined;

  return {
    tmuxPath,
    defaultCaptureLines,
    auditLogPath,
  };
};

export const __internal = {
  parsePositiveInteger,
};
