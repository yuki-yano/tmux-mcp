import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recordSpy = vi.fn();
const loadConfigMock = vi.fn(() => ({
  tmuxPath: "tmux",
  defaultCaptureLines: 2000,
  auditLogPath: undefined,
}));

describe("createLogger", () => {
  beforeEach(() => {
    vi.resetModules();
    recordSpy.mockClear();
    loadConfigMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const setup = async () => {
    vi.mock("@/config", () => ({
      loadConfig: loadConfigMock,
    }));
    vi.mock("@/audit-log", () => ({
      createAuditLogger: vi.fn(() => ({ record: recordSpy })),
    }));

    const module = await import("@/logger");
    const logger = module.createLogger();
    return logger;
  };

  it("normalizes info logs before printing", async () => {
    const logger = await setup();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    logger.info("\u001b[31m Hello World \u001b[0m\n");

    expect(info).toHaveBeenCalledWith("Hello World");
  });

  it("does not output empty messages", async () => {
    const logger = await setup();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    logger.info("   \n\t");

    expect(info).not.toHaveBeenCalled();
  });

  it("writes error logs to console.error", async () => {
    const logger = await setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.error("\u001b[31m failure \u001b[0m");

    expect(error).toHaveBeenCalledWith("failure");
  });

  it("delegates to the audit logger", async () => {
    const logger = await setup();

    await logger.audit({ type: "test", message: "ok" });

    expect(recordSpy).toHaveBeenCalledWith({ type: "test", message: "ok" });
  });
});
