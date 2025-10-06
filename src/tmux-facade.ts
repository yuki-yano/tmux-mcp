import { execFile, spawn } from "node:child_process";
import type { AppConfig } from "@/config";
import type { TmuxPane } from "@/context-resolver";

export type CapturePaneOptions = {
  paneId: string;
  lines?: number;
};

export type PipePaneOptions = {
  paneId: string;
};

export type PipeHandle = {
  stream: NodeJS.ReadableStream;
  stop: () => Promise<void>;
};

export type TmuxFacade = {
  listPanes: () => Promise<TmuxPane[]>;
  capturePane: (options: CapturePaneOptions) => Promise<{ lines: string[] }>;
  pipePane: (options: PipePaneOptions) => Promise<PipeHandle>;
};

const LIST_PANES_FORMAT =
  "#{pane_id}|#{session_name}|#{window_index}|#{pane_active}|#{window_active}|#{session_active}|#{pane_last}|#{pane_current_command}|#{pane_title}";

const trimQuotes = (value: string) => {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
};

const parseBoolean = (value: string | undefined) => {
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true";
};

const parseNumber = (value: string | undefined) => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return undefined;
  return parsed;
};

const buildTmuxError = (command: string[], error: unknown, stderr?: string) => {
  const baseMessage = `tmux ${command.join(" ")}`;
  if (stderr && stderr.trim() !== "") {
    return new Error(`${baseMessage} failed: ${stderr.trim()}`);
  }
  if (error instanceof Error) {
    return new Error(`${baseMessage} failed: ${error.message}`);
  }
  return new Error(`${baseMessage} failed`);
};

export const createTmuxFacade = (config: AppConfig): TmuxFacade => {
  const exec = async (args: string[]) => {
    return await new Promise<{ stdout: string; stderr: string }>(
      (resolve, reject) => {
        execFile(
          config.tmuxPath,
          args,
          { encoding: "utf8" },
          (error, stdout, stderr) => {
            if (error) {
              reject(buildTmuxError(args, error, stderr ?? undefined));
              return;
            }
            resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
          },
        );
      },
    );
  };

  const listPanes = async () => {
    const { stdout } = await exec([
      "list-panes",
      "-a",
      "-F",
      LIST_PANES_FORMAT,
    ]);
    if (stdout.trim() === "") return [];
    return stdout
      .trim()
      .split("\n")
      .map((line) => {
        const [
          id,
          session,
          windowIndex,
          paneActive,
          windowActive,
          sessionActive,
          paneLast,
          currentCommand,
          title,
        ] = line.split("|");
        return {
          id: trimQuotes(id),
          session: session ?? "",
          window: windowIndex ?? "",
          title: title ? trimQuotes(title) : "",
          isActive: parseBoolean(paneActive),
          isActiveWindow: parseBoolean(windowActive),
          isActiveSession: parseBoolean(sessionActive),
          lastUsed: parseNumber(paneLast),
          currentCommand: currentCommand
            ? trimQuotes(currentCommand)
            : undefined,
          tags: undefined,
        } satisfies TmuxPane;
      });
  };

  const capturePane = async ({ paneId, lines }: CapturePaneOptions) => {
    const effectiveLines = lines ?? config.defaultCaptureLines;
    const args = [
      "capture-pane",
      "-p",
      "-t",
      paneId,
      "-S",
      `-${effectiveLines}`,
      "-J",
    ];
    const { stdout } = await exec(args);
    const trimmed = stdout.replace(/\n$/, "");
    return { lines: trimmed === "" ? [] : trimmed.split("\n") };
  };

  const pipePane = async ({ paneId }: PipePaneOptions) => {
    try {
      const child = spawn(
        config.tmuxPath,
        ["pipe-pane", "-t", paneId, "-o", "-"],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      if (!child.stdout) {
        throw new Error("tmux pipe-pane did not provide stdout stream");
      }
      const stream = child.stdout;
      const stop = async () => {
        await exec(["pipe-pane", "-t", paneId]);
      };
      return { stream, stop } satisfies PipeHandle;
    } catch (error) {
      throw buildTmuxError(["pipe-pane", "-t", paneId, "-o", "-"], error);
    }
  };

  return {
    listPanes,
    capturePane,
    pipePane,
  };
};

export const __internal = {
  trimQuotes,
  parseBoolean,
  parseNumber,
  buildTmuxError,
};
