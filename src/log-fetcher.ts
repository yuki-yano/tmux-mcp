import { randomUUID } from "node:crypto";
import {
  type ApplyLogFormattingResult,
  applyLogFormatting,
  type LogFilters,
} from "@/log-formatting";

export type CaptureRequest = {
  mode: "capture";
  paneId?: string;
  lines?: number;
  filters?: LogFilters;
  maskPatterns?: string[];
  summary?: boolean;
};

export type FileRequest = {
  mode: "file";
  filePath?: string;
};

export type StreamOpenRequest = {
  mode: "stream";
  paneId?: string;
};

export type LogFetchRequest = CaptureRequest | FileRequest | StreamOpenRequest;

type FormattingInput = {
  lines: string[];
  filters?: LogFilters;
  maskPatterns?: string[];
  summary?: boolean;
};

export type CaptureFetchResult = {
  lines: string[];
  summary?: ApplyLogFormattingResult["summary"];
  metadata: {
    paneId: string;
    mode: "capture";
  };
};

export type FileFetchResult = {
  stream: NodeJS.ReadableStream;
  metadata: {
    filePath: string;
    mode: "file";
  };
};

export type FetchLogResult = CaptureFetchResult | FileFetchResult;

export type StreamHandle = {
  id: string;
  stopToken: string;
};

export type LogFetcherDependencies = {
  tmux: {
    capturePane: (options: {
      paneId: string;
      lines?: number;
    }) => Promise<{ lines: string[] }>;
    pipePane: (options: {
      paneId: string;
    }) => Promise<{ stream: NodeJS.ReadableStream; stop: () => Promise<void> }>;
  };
  file: {
    tail: (options: { filePath: string }) => Promise<NodeJS.ReadableStream>;
  };
  id: {
    generate: () => string;
  };
  format?: (input: FormattingInput) => ApplyLogFormattingResult;
  stopToken?: () => string;
};

export type LogFetcher = {
  fetch: (request: LogFetchRequest) => Promise<FetchLogResult>;
  openStream: (request: StreamOpenRequest) => Promise<StreamHandle>;
  stopStream: (streamId: string, stopToken: string) => Promise<void>;
};

const createMissingPaneError = () => new Error("paneId is required");
const createMissingFilePathError = () => new Error("filePath is required");
const createInvalidTokenError = () => new Error("Invalid stop token");
const createStreamNotFoundError = (streamId: string) =>
  new Error(`Stream not found: ${streamId}`);
const createFileTailError = (filePath: string, error: unknown) => {
  const message =
    error instanceof Error && error.message !== ""
      ? error.message
      : "Unknown error";
  return new Error(`Unable to tail log file: ${filePath} (${message})`);
};

const createStopToken = (generator?: () => string) => {
  if (generator) return generator();
  return randomUUID();
};

export const createLogFetcher = (
  dependencies: LogFetcherDependencies,
): LogFetcher => {
  const streams = new Map<
    string,
    {
      token: string;
      stop: () => Promise<void>;
    }
  >();

  const format =
    dependencies.format ??
    ((input: FormattingInput) => applyLogFormatting(input));

  const fetch = async (request: LogFetchRequest): Promise<FetchLogResult> => {
    if (request.mode === "capture") {
      if (!request.paneId) throw createMissingPaneError();
      const result = await dependencies.tmux.capturePane({
        paneId: request.paneId,
        lines: request.lines,
      });
      const formatted = format({
        lines: result.lines,
        filters: request.filters,
        maskPatterns: request.maskPatterns,
        summary: request.summary,
      });
      return {
        lines: formatted.lines,
        summary: formatted.summary,
        metadata: {
          paneId: request.paneId,
          mode: "capture",
        },
      };
    }

    if (request.mode === "file") {
      if (!request.filePath) throw createMissingFilePathError();
      let stream: NodeJS.ReadableStream;
      try {
        stream = await dependencies.file.tail({ filePath: request.filePath });
      } catch (error) {
        throw createFileTailError(request.filePath, error);
      }
      return {
        stream,
        metadata: {
          filePath: request.filePath,
          mode: "file",
        },
      };
    }

    if (request.mode === "stream") {
      throw new Error("Use openStream for stream mode");
    }

    const mode = (request as { mode: string }).mode;
    throw new Error(`Unsupported log fetch mode: ${mode}`);
  };

  const openStream = async (
    request: StreamOpenRequest,
  ): Promise<StreamHandle> => {
    if (!request.paneId) throw createMissingPaneError();
    const handle = await dependencies.tmux.pipePane({ paneId: request.paneId });
    const id = dependencies.id.generate();
    const token = createStopToken(dependencies.stopToken);
    streams.set(id, {
      token,
      stop: handle.stop,
    });
    return { id, stopToken: token };
  };

  const stopStream = async (streamId: string, stopToken: string) => {
    const entry = streams.get(streamId);
    if (!entry) throw createStreamNotFoundError(streamId);
    if (entry.token !== stopToken) throw createInvalidTokenError();
    streams.delete(streamId);
    await entry.stop();
  };

  return {
    fetch,
    openStream,
    stopStream,
  };
};

export const __internal = {
  createMissingPaneError,
  createMissingFilePathError,
  createInvalidTokenError,
  createStreamNotFoundError,
  createFileTailError,
};
