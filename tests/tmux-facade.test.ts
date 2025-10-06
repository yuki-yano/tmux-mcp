import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();
const spawnMock = vi.fn();

describe("createTmuxFacade", () => {
  beforeEach(() => {
    vi.resetModules();
    execFileMock.mockReset();
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const importFacade = async () => {
    vi.mock("node:child_process", () => ({
      execFile: execFileMock,
      spawn: spawnMock,
    }));

    const { createTmuxFacade } = await import("@/tmux-facade");
    return createTmuxFacade({
      tmuxPath: "/usr/bin/tmux",
      defaultCaptureLines: 2000,
    });
  };

  it("parses list-panes output", async () => {
    execFileMock.mockImplementation((_cmd, _args, _options, callback) => {
      const cb = typeof _options === "function" ? _options : callback;
      cb?.(
        null,
        '%1|dev|1|1|1|1|123|bash|"title"\n%2|dev|2|0|0|0|0|zsh|other',
        "",
      );
      return {} as unknown as import("node:child_process").ChildProcess;
    });

    const facade = await importFacade();
    const panes = await facade.listPanes();

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(panes).toEqual([
      {
        id: "%1",
        session: "dev",
        window: "1",
        title: "title",
        isActive: true,
        isActiveWindow: true,
        isActiveSession: true,
        lastUsed: 123,
        currentCommand: "bash",
        tags: undefined,
      },
      {
        id: "%2",
        session: "dev",
        window: "2",
        title: "other",
        isActive: false,
        isActiveWindow: false,
        isActiveSession: false,
        lastUsed: 0,
        currentCommand: "zsh",
        tags: undefined,
      },
    ]);
  });

  it("uses the default line count for capture-pane", async () => {
    execFileMock.mockImplementation((_cmd, argsParam, _options, callback) => {
      const cb = typeof _options === "function" ? _options : callback;
      if (Array.isArray(argsParam) && argsParam[0] === "capture-pane") {
        cb?.(null, "line1\nline2\n", "");
      } else {
        cb?.(null, "", "");
      }
      return {} as unknown as import("node:child_process").ChildProcess;
    });

    const facade = await importFacade();
    const result = await facade.capturePane({ paneId: "%1" });

    const [, args] = execFileMock.mock.calls[0];
    expect(args).toEqual([
      "capture-pane",
      "-p",
      "-t",
      "%1",
      "-S",
      "-2000",
      "-J",
    ]);
    expect(result.lines).toEqual(["line1", "line2"]);
  });

  it("cleans up using pipe-pane stop", async () => {
    execFileMock.mockImplementation((_cmd, _args, _options, callback) => {
      const cb = typeof _options === "function" ? _options : callback;
      cb?.(null, "", "");
      return {} as unknown as import("node:child_process").ChildProcess;
    });

    const stream = Readable.from(["chunk"]);
    spawnMock.mockReturnValue({
      stdout: stream,
    } as unknown as import("node:child_process").ChildProcessWithoutNullStreams);

    const facade = await importFacade();
    const handle = await facade.pipePane({ paneId: "%9" });

    expect(handle.stream).toBe(stream);

    await handle.stop();

    expect(execFileMock).toHaveBeenLastCalledWith(
      "/usr/bin/tmux",
      ["pipe-pane", "-t", "%9"],
      { encoding: "utf8" },
      expect.any(Function),
    );
  });
});
