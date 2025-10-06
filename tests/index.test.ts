import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpServer } from "@/index";

const createMocks = () => {
  const describeContext = vi.fn();
  const fetchLog = vi.fn();
  const openStream = vi.fn();
  const stopStream = vi.fn();

  return {
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      audit: vi.fn(),
    },
    contextResolver: {
      describe: describeContext,
    },
    logFetcher: {
      fetch: fetchLog,
      openStream,
      stopStream,
    },
  } as const;
};

describe("createMcpServer", () => {
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a successful describe-context response", async () => {
    const data = {
      primaryPane: { id: "%1", title: "vim", session: "dev", window: "1" },
      candidates: [],
    };
    mocks.contextResolver.describe.mockResolvedValue(data);

    const server = createMcpServer({
      logger: mocks.logger,
      contextResolver: mocks.contextResolver,
      logFetcher: mocks.logFetcher,
    });
    const response = await server.commands.describeContext({ paneHint: "%1" });

    expect(mocks.contextResolver.describe).toHaveBeenCalledWith({
      paneHint: "%1",
    });
    expect(response).toEqual({ success: true, data });
  });

  it("captures errors thrown by describe-context", async () => {
    mocks.contextResolver.describe.mockRejectedValue(new Error("failed"));

    const server = createMcpServer({
      logger: mocks.logger,
      contextResolver: mocks.contextResolver,
      logFetcher: mocks.logFetcher,
    });
    const response = await server.commands.describeContext({});

    expect(response).toEqual({
      success: false,
      error: {
        code: "CONTEXT_RESOLUTION_FAILED",
        message: "failed",
      },
    });
  });

  it("delegates fetch-log to the logFetcher", async () => {
    const result = {
      lines: ["a"],
      metadata: { mode: "capture", paneId: "%1" },
    };
    mocks.logFetcher.fetch.mockResolvedValue(result);

    const server = createMcpServer({
      logger: mocks.logger,
      contextResolver: mocks.contextResolver,
      logFetcher: mocks.logFetcher,
    });
    const response = await server.commands.fetchLog({
      mode: "capture",
      paneId: "%1",
    });

    expect(mocks.logFetcher.fetch).toHaveBeenCalledWith({
      mode: "capture",
      paneId: "%1",
    });
    expect(response).toEqual({ success: true, data: result });
  });

  it("returns an error code when fetch-log fails", async () => {
    mocks.logFetcher.fetch.mockRejectedValue(new Error("tmux error"));

    const server = createMcpServer({
      logger: mocks.logger,
      contextResolver: mocks.contextResolver,
      logFetcher: mocks.logFetcher,
    });
    const response = await server.commands.fetchLog({
      mode: "capture",
      paneId: "%1",
    });

    expect(response).toEqual({
      success: false,
      error: {
        code: "LOG_FETCH_FAILED",
        message: "tmux error",
      },
    });
  });

  it("handles stream-log start and stop", async () => {
    mocks.logFetcher.openStream.mockResolvedValue({
      id: "stream",
      stopToken: "token",
    });

    const server = createMcpServer({
      logger: mocks.logger,
      contextResolver: mocks.contextResolver,
      logFetcher: mocks.logFetcher,
    });
    const startResponse = await server.commands.streamLog({
      mode: "stream",
      paneId: "%3",
    });
    expect(startResponse).toEqual({
      success: true,
      data: { id: "stream", stopToken: "token" },
    });

    await server.commands.streamLog({
      mode: "stream",
      action: "stop",
      streamId: "stream",
      stopToken: "token",
    });
    expect(mocks.logFetcher.stopStream).toHaveBeenCalledWith("stream", "token");
  });

  it("start invokes onStart", () => {
    const onStart = vi.fn();
    const server = createMcpServer({
      logger: mocks.logger,
      contextResolver: mocks.contextResolver,
      logFetcher: mocks.logFetcher,
      onStart,
    });
    server.start();
    expect(onStart).toHaveBeenCalled();
  });
});
