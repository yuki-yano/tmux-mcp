import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@/config";

type EnvSnapshot = Record<string, string | undefined>;

const ENV_KEYS = [
  "TMUX_CONTEXT_TMUX_PATH",
  "TMUX",
  "TMUX_CONTEXT_CAPTURE_LINES",
  "TMUX_CONTEXT_AUDIT_PATH",
];

const snapshotEnv = (): EnvSnapshot => {
  return ENV_KEYS.reduce<EnvSnapshot>((acc, key) => {
    acc[key] = process.env[key];
    return acc;
  }, {});
};

const restoreEnv = (snapshot: EnvSnapshot) => {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

describe("loadConfig", () => {
  let snapshot: EnvSnapshot;

  beforeEach(() => {
    snapshot = snapshotEnv();
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    restoreEnv(snapshot);
  });

  it("returns default values", () => {
    const config = loadConfig();
    expect(config.tmuxPath).toBe("tmux");
    expect(config.defaultCaptureLines).toBe(2000);
    expect(config.auditLogPath).toBeUndefined();
  });

  it("applies custom tmux path and capture lines", () => {
    process.env.TMUX_CONTEXT_TMUX_PATH = "/usr/local/bin/tmux";
    process.env.TMUX_CONTEXT_CAPTURE_LINES = "1200";
    process.env.TMUX_CONTEXT_AUDIT_PATH = "/tmp/logs/audit.log";

    const config = loadConfig();
    expect(config.tmuxPath).toBe("/usr/local/bin/tmux");
    expect(config.defaultCaptureLines).toBe(1200);
    expect(config.auditLogPath).toBe("/tmp/logs/audit.log");
  });

  it("falls back to the TMUX environment variable", () => {
    process.env.TMUX = "/opt/bin/tmux";

    const config = loadConfig();
    expect(config.tmuxPath).toBe("/opt/bin/tmux");
  });

  it("falls back to defaults when capture lines are invalid", () => {
    process.env.TMUX_CONTEXT_CAPTURE_LINES = "-5";

    const config = loadConfig();
    expect(config.defaultCaptureLines).toBe(2000);
  });
});
