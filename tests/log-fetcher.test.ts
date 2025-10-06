import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLogFetcher, type LogFetcherDependencies } from "@/log-fetcher";

describe("createLogFetcher", () => {
  let dependencies: LogFetcherDependencies;

  beforeEach(() => {
    dependencies = {
      tmux: {
        capturePane: async () => ({ lines: ["a", "b"] }),
        pipePane: async () => ({
          stream: Readable.from(["chunk"]),
          stop: async () => {},
        }),
      },
      file: {
        tail: async () => Readable.from(["file"]),
      },
      id: {
        generate: () => "stream-1",
      },
      format: (input) => ({
        lines: input.lines ?? [],
        summary: input.summary ? { totalLines: 0, errorCount: 0 } : undefined,
      }),
      stopToken: () => "token-1",
    };
  });

  it("returns formatted lines in capture mode", async () => {
    const fetcher = createLogFetcher(dependencies);
    const result = await fetcher.fetch({ mode: "capture", paneId: "pane" });

    expect(result).toEqual({
      lines: ["a", "b"],
      summary: undefined,
      metadata: { paneId: "pane", mode: "capture" },
    });
  });

  it("throws when paneId is missing", async () => {
    const fetcher = createLogFetcher(dependencies);
    await expect(fetcher.fetch({ mode: "capture" })).rejects.toThrow(
      "paneId is required",
    );
  });

  it("returns a stream in file mode", async () => {
    const fetcher = createLogFetcher(dependencies);
    const result = await fetcher.fetch({ mode: "file", filePath: "/tmp/log" });

    expect(result).toMatchObject({
      stream: expect.any(Readable),
      metadata: { mode: "file", filePath: "/tmp/log" },
    });
  });

  it("opens and stops a stream", async () => {
    const stop = vi.fn();
    dependencies.tmux.pipePane = async () => ({
      stream: Readable.from(["chunk"]),
      stop,
    });

    const fetcher = createLogFetcher(dependencies);
    const handle = await fetcher.openStream({ mode: "stream", paneId: "pane" });

    expect(handle).toEqual({ id: "stream-1", stopToken: "token-1" });

    await fetcher.stopStream("stream-1", "token-1");
    expect(stop).toHaveBeenCalled();
  });

  it("fails to stop with an invalid token", async () => {
    const fetcher = createLogFetcher(dependencies);
    await fetcher.openStream({ mode: "stream", paneId: "pane" });
    await expect(fetcher.stopStream("stream-1", "wrong")).rejects.toThrow(
      "Invalid stop token",
    );
  });

  it("rejects fetch in stream mode", async () => {
    const fetcher = createLogFetcher(dependencies);
    await expect(
      fetcher.fetch({ mode: "stream", paneId: "pane" }),
    ).rejects.toThrow("Use openStream for stream mode");
  });
});
