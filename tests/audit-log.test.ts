import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuditLogger } from "@/audit-log";

const decode = (line: string) => JSON.parse(line) as Record<string, unknown>;

const withTempDir = async (callback: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), "audit-test-"));
  await callback(dir);
};

describe("createAuditLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes events as JSON using the provided writer", async () => {
    const writer = vi.fn(async (_line: string) => {});
    const logger = createAuditLogger({
      writer,
      now: () => new Date("2025-10-06T02:15:00Z"),
    });

    await logger.record({ type: "test", message: "ok" });

    expect(writer).toHaveBeenCalledTimes(1);
    const [line] = writer.mock.calls[0];
    expect(decode(line)).toEqual({
      timestamp: "2025-10-06T02:15:00.000Z",
      type: "test",
      message: "ok",
    });
  });

  it("appends to the file when filePath is provided", async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, "audit.log");
      const logger = createAuditLogger({
        filePath,
        now: () => new Date("2025-10-06T02:20:00Z"),
      });

      await logger.record({ type: "file", message: "hello" });

      const content = await readFile(filePath, "utf8");
      const [line] = content.trim().split("\n");
      expect(decode(line)).toMatchObject({
        timestamp: "2025-10-06T02:20:00.000Z",
        type: "file",
      });
    });
  });

  it("writes to stdout by default", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(((
      _chunk: unknown,
      callback?: (error?: Error | null) => void,
    ) => {
      if (typeof callback === "function") callback(null);
      return true;
    }) as typeof process.stdout.write);

    const logger = createAuditLogger({
      now: () => new Date("2025-10-06T02:30:00Z"),
    });
    await logger.record({ type: "stdout", message: "stream" });

    expect(write).toHaveBeenCalledTimes(1);
    const [line] = write.mock.calls[0];
    expect(typeof line).toBe("string");
    expect(line).toContain("stdout");
  });
});
