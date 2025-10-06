import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFileTail } from "@/file-tail";

const readStream = async (stream: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

describe("createFileTail", () => {
  it("reads the specified file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "file-tail-"));
    const filePath = join(dir, "log.txt");
    await writeFile(filePath, "hello\nworld\n", "utf8");

    const fileTail = createFileTail();
    const stream = await fileTail.tail({ filePath });

    const content = await readStream(stream);
    expect(content).toBe("hello\nworld\n");
  });

  it("throws for a missing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "file-tail-"));
    const filePath = join(dir, "missing.log");

    const fileTail = createFileTail();
    await expect(fileTail.tail({ filePath })).rejects.toThrow(
      "Failed to open log file",
    );
  });
});
