import { constants, createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import type { Readable } from "node:stream";

export type FileTailOptions = {
  filePath: string;
};

export type FileTail = {
  tail: (options: FileTailOptions) => Promise<Readable>;
};

const ensureFileExists = async (filePath: string) => {
  await access(filePath, constants.F_OK | constants.R_OK);
  if ((await stat(filePath)).isDirectory()) {
    throw new Error(`The provided path points to a directory: ${filePath}`);
  }
};

export const createFileTail = (): FileTail => {
  const tail = async ({ filePath }: FileTailOptions) => {
    try {
      await ensureFileExists(filePath);
    } catch (error) {
      const message =
        error instanceof Error && error.message !== ""
          ? error.message
          : "Unable to access the file";
      throw new Error(`Failed to open log file: ${filePath} (${message})`);
    }

    return createReadStream(filePath, {
      encoding: "utf8",
      flags: "r",
    });
  };

  return { tail };
};

export const __internal = { ensureFileExists };
