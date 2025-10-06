import { randomUUID } from "node:crypto";
import { z } from "zod";
import { loadConfig } from "@/config";
import {
  type ContextResolver,
  createContextResolver,
  type DescribeContextRequest,
} from "@/context-resolver";
import { createFileTail } from "@/file-tail";
import {
  createLogFetcher,
  type FetchLogResult,
  type LogFetcher,
  type StreamHandle,
  type StreamOpenRequest,
} from "@/log-fetcher";
import type { LogFilters } from "@/log-formatting";
import { createLogger, type Logger } from "@/logger";
import { createTmuxFacade } from "@/tmux-facade";

export type CreateMcpServerOptions = {
  name?: string;
  logger?: Logger;
  auditLogger?: { record: (event: Record<string, unknown>) => Promise<void> };
  contextResolver?: ContextResolver;
  logFetcher?: LogFetcher;
  onStart?: () => void;
};

export type CommandResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

export type McpServer = {
  name: string;
  start: () => void;
  commands: {
    describeContext: (
      request: DescribeContextRequest,
    ) => Promise<CommandResponse<DescribeContextResult>>;
    fetchLog: (
      request: FetchLogInput,
    ) => Promise<CommandResponse<FetchLogResult>>;
    streamLog: (
      request: StreamLogInput,
    ) => Promise<CommandResponse<StreamHandle>>;
  };
};

type DescribeContextResult = Awaited<ReturnType<ContextResolver["describe"]>>;

const baseRequestMetaSchema = z
  .object({
    _meta: z.optional(z.object({}).passthrough()),
  })
  .passthrough();

export const describeContextShape = {
  paneHint: z.string().optional(),
  tags: z.array(z.string()).optional(),
};

export const describeContextSchema = z
  .object({
    ...baseRequestMetaSchema.shape,
    ...describeContextShape,
  })
  .passthrough();

const logModeSchema = z.enum(["capture", "file", "stream"]);

const timeRangeSchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .partial();

const logFiltersSchema: z.ZodType<LogFilters> = z
  .object({
    timeRange: timeRangeSchema.optional(),
    keywords: z.array(z.string()).optional(),
    levels: z.array(z.string()).optional(),
  })
  .partial();

export const fetchLogShape = {
  mode: logModeSchema,
  paneId: z.string().optional(),
  filePath: z.string().optional(),
  lines: z.number().int().positive().max(10_000).optional(),
  filters: logFiltersSchema.optional(),
  summary: z.boolean().optional(),
  maskPatterns: z.array(z.string()).optional(),
};

export const fetchLogSchema = z
  .object({
    ...baseRequestMetaSchema.shape,
    ...fetchLogShape,
  })
  .strict();

const streamLogStartSchema = fetchLogSchema
  .extend({
    mode: z.literal("stream"),
    action: z.literal("start").optional(),
    paneId: z.string(),
  })
  .strict();

const streamLogStopSchema = z
  .object({
    ...baseRequestMetaSchema.shape,
    mode: z.literal("stream"),
    action: z.literal("stop"),
    streamId: z.string(),
    stopToken: z.string(),
  })
  .strict();

export const streamLogSchema = z.union([
  streamLogStartSchema,
  streamLogStopSchema,
]);

export type FetchLogInput = z.infer<typeof fetchLogSchema>;
export type StreamLogInput = z.infer<typeof streamLogSchema>;

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && typeof error.message === "string")
    return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
};

const formatZodError = (issues: z.ZodIssue[]) => {
  if (issues.length === 0) return "Invalid input";
  return issues
    .map(
      (issue) =>
        `${issue.path.length > 0 ? issue.path.join(".") : "input"}: ${issue.message}`,
    )
    .join("; ");
};

type WithoutMeta<T extends { _meta?: unknown }> = Omit<T, "_meta">;

const stripMeta = <T extends { _meta?: unknown }>(value: T): WithoutMeta<T> => {
  const { _meta: _ignored, ...rest } = value;
  return rest;
};

const isStreamStopRequest = (
  value: WithoutMeta<StreamLogInput>,
): value is WithoutMeta<Extract<StreamLogInput, { action: "stop" }>> => {
  return "action" in value && value.action === "stop";
};

type CommandHandlerOptions<TInput, TResult> = {
  name: string;
  schema: z.ZodType<TInput>;
  execute: (input: TInput) => Promise<TResult>;
  auditLogger: { record: (event: Record<string, unknown>) => Promise<void> };
  errorCode: string;
};

const createCommandHandler = <TInput, TResult>({
  name,
  schema,
  execute,
  auditLogger,
  errorCode,
}: CommandHandlerOptions<TInput, TResult>) => {
  return async (rawInput: unknown): Promise<CommandResponse<TResult>> => {
    const parsed = schema.safeParse(rawInput);
    if (!parsed.success) {
      const message = formatZodError(parsed.error.issues);
      await auditLogger.record({
        type: `${name}.validation-error`,
        message,
        detail: {
          input: rawInput,
          error: message,
        },
      });
      return {
        success: false,
        error: {
          code: "INVALID_ARGUMENT",
          message,
        },
      };
    }

    try {
      const data = await execute(parsed.data);
      await auditLogger.record({
        type: `${name}.success`,
        message: "ok",
        detail: {
          request: parsed.data,
        },
      });
      return {
        success: true,
        data,
      };
    } catch (error) {
      const message = getErrorMessage(error);
      await auditLogger.record({
        type: `${name}.error`,
        message,
        detail: {
          request: parsed.data,
          error: message,
        },
        error,
      });
      return {
        success: false,
        error: {
          code: errorCode,
          message,
        },
      };
    }
  };
};

export const createMcpServer = (
  options: CreateMcpServerOptions = {},
): McpServer => {
  const name = options.name ?? "tmux-mcp";
  const config = loadConfig();
  const logger = options.logger ?? createLogger();
  const auditLogger = options.auditLogger ?? { record: logger.audit };
  const tmuxFacade = createTmuxFacade(config);
  const contextResolver =
    options.contextResolver ??
    createContextResolver({
      tmux: {
        listPanes: tmuxFacade.listPanes,
      },
    });
  const fileTail = createFileTail();
  const logFetcher =
    options.logFetcher ??
    createLogFetcher({
      tmux: {
        capturePane: tmuxFacade.capturePane,
        pipePane: tmuxFacade.pipePane,
      },
      file: {
        tail: fileTail.tail,
      },
      id: {
        generate: () => randomUUID(),
      },
    });

  const start = () => {
    options.onStart?.();
    if (process.env.NODE_ENV !== "test") {
      logger.info(`[tmux-mcp] starting server: ${name}`);
    }
  };

  const describeContext = createCommandHandler({
    name: "describe-context",
    schema: describeContextSchema,
    execute: async (input) => contextResolver.describe(stripMeta(input)),
    auditLogger,
    errorCode: "CONTEXT_RESOLUTION_FAILED",
  });

  const fetchLog = createCommandHandler({
    name: "fetch-log",
    schema: fetchLogSchema,
    execute: async (input: FetchLogInput) => {
      const request = stripMeta(input);
      return logFetcher.fetch(request);
    },
    auditLogger,
    errorCode: "LOG_FETCH_FAILED",
  });

  const streamLog = createCommandHandler({
    name: "stream-log",
    schema: streamLogSchema,
    execute: async (input: StreamLogInput) => {
      const request = stripMeta(input);
      if (isStreamStopRequest(request)) {
        await logFetcher.stopStream(request.streamId, request.stopToken);
        return {
          id: request.streamId,
          stopToken: request.stopToken,
        } satisfies StreamHandle;
      }
      const { action: _ignored, ...rest } = request as WithoutMeta<
        Extract<StreamLogInput, { action?: "start" }>
      >;
      return logFetcher.openStream(rest as StreamOpenRequest);
    },
    auditLogger,
    errorCode: "STREAM_OPEN_FAILED",
  });

  return {
    name,
    start,
    commands: {
      describeContext,
      fetchLog,
      streamLog,
    },
  };
};
