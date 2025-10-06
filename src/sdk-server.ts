import type { Readable, Writable } from "node:stream";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import type { ZodIssue } from "zod";
import type { CommandResponse } from "@/index";
import {
  type CreateMcpServerOptions,
  createMcpServer,
  describeContextSchema,
  fetchLogSchema,
  streamLogSchema,
} from "@/index";
import type { FetchLogResult, StreamHandle } from "@/log-fetcher";
import packageJson from "../package.json";

const PACKAGE_VERSION =
  (packageJson as { version?: string }).version ?? "0.0.0";

const DEFAULT_IMPLEMENTATION = {
  name: "tmux-contextual-log-mcp",
  version: PACKAGE_VERSION,
};

const textBlock = (text: string) => ({
  type: "text" as const,
  text,
});

const describeContextJsonSchema = {
  type: "object",
  properties: {
    paneHint: {
      type: "string",
      description: "Pane ID or keyword to prioritize",
    },
    tags: {
      type: "array",
      description: "Tags used to match panes",
      items: { type: "string" },
    },
  },
  additionalProperties: false,
} as const;

const fetchLogJsonSchema = {
  type: "object",
  properties: {
    mode: {
      type: "string",
      enum: ["capture", "file", "stream"],
    },
    paneId: {
      type: "string",
      description: "Target pane ID",
    },
    filePath: {
      type: "string",
      description: "Path to the log file to read",
    },
    lines: {
      type: "integer",
      minimum: 1,
      maximum: 10_000,
      description: "Number of lines to capture",
    },
    filters: {
      type: "object",
      additionalProperties: false,
      properties: {
        timeRange: {
          type: "object",
          additionalProperties: false,
          properties: {
            from: { type: "string", description: "ISO8601 start timestamp" },
            to: { type: "string", description: "ISO8601 end timestamp" },
          },
        },
        keywords: {
          type: "array",
          items: { type: "string" },
        },
        levels: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    summary: {
      type: "boolean",
      description: "Whether to include summary data",
    },
    maskPatterns: {
      type: "array",
      items: { type: "string" },
      description: "Mask patterns (strings or regex fragments)",
    },
  },
  required: ["mode"],
  additionalProperties: false,
} as const;

const streamLogJsonSchema = {
  type: "object",
  oneOf: [
    {
      type: "object",
      properties: {
        mode: { const: "stream" },
        action: { const: "stop" },
        streamId: { type: "string" },
        stopToken: { type: "string" },
      },
      required: ["mode", "action", "streamId", "stopToken"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        mode: { const: "stream" },
        action: { const: "start" },
        paneId: { type: "string" },
      },
      required: ["mode", "paneId"],
      additionalProperties: false,
    },
  ],
} as const;

const ensureContent = (blocks?: Array<{ type: "text"; text: string }>) => {
  return blocks ? [...blocks] : [];
};

const createErrorResult = (error: { code: string; message: string }) => {
  return {
    content: [textBlock(`[${error.code}] ${error.message}`)],
    structuredContent: { error },
    isError: true,
  };
};

type BuildResult<T> = (data: T) => Promise<{
  content?: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
}>;

const toCallToolResult = async <T>(
  response: CommandResponse<T>,
  build: BuildResult<T>,
) => {
  if (!response.success) return createErrorResult(response.error);
  const payload = await build(response.data);
  return {
    content: ensureContent(payload.content),
    structuredContent: payload.structuredContent,
  };
};

const readStreamToString = async (stream: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

const buildDescribeContextResult = (
  data: Awaited<
    ReturnType<
      ReturnType<typeof createMcpServer>["commands"]["describeContext"]
    > extends Promise<CommandResponse<infer R>>
      ? R
      : never
  >,
) => {
  const structuredContent = {
    primaryPane: data.primaryPane,
    candidates: data.candidates,
  };
  const summary = `Primary pane: ${data.primaryPane.title} (${data.primaryPane.session}:${data.primaryPane.window})`;
  return {
    structuredContent,
    content: [textBlock(summary)],
  };
};

const buildFetchLogResult = async (data: FetchLogResult) => {
  const structuredContent: Record<string, unknown> = {
    metadata: data.metadata,
  };
  const content: Array<{ type: "text"; text: string }> = [];

  if ("lines" in data && data.lines.length > 0) {
    structuredContent.lines = data.lines;
    content.push(textBlock(data.lines.join("\n")));
  }

  if ("summary" in data && data.summary) {
    structuredContent.summary = data.summary;
    content.push(textBlock(JSON.stringify(data.summary, null, 2)));
  }

  if ("stream" in data) {
    const text = await readStreamToString(data.stream);
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
    if (lines.length > 0) structuredContent.lines = lines;
    if (text.length > 0) content.push(textBlock(text));
  }

  return {
    structuredContent,
    content,
  };
};

const buildStreamLogResult = (data: StreamHandle) => {
  return {
    structuredContent: data,
    content: [textBlock(`Stream ready: id=${data.id}`)],
  };
};

const stripMetaField = (value: unknown) => {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "_meta" in (value as Record<string, unknown>)
  ) {
    const { _meta: _ignored, ...rest } = value as Record<string, unknown>;
    return rest;
  }
  return value;
};

const registerTools = (
  sdkServer: McpServer,
  domainServer: ReturnType<typeof createMcpServer>,
) => {
  const server = sdkServer.server;

  const tools = [
    {
      name: "describe-context",
      description: "Return information about active tmux panes",
      inputSchema: describeContextJsonSchema,
    },
    {
      name: "fetch-log",
      description: "Fetch logs from a tmux pane or file",
      inputSchema: fetchLogJsonSchema,
    },
    {
      name: "stream-log",
      description: "Start or stop a tmux pane log stream",
      inputSchema: streamLogJsonSchema,
    },
  ];

  const formatIssues = (issues: ZodIssue[]) =>
    issues
      .map(
        (issue) =>
          `${issue.path.length > 0 ? issue.path.join(".") : "input"}: ${issue.message}`,
      )
      .join("; ");

  const handlers: Record<string, (args: unknown) => Promise<CallToolResult>> = {
    "describe-context": async (args) => {
      const result = describeContextSchema.safeParse(
        stripMetaField(args ?? {}),
      );
      if (!result.success) {
        throw new McpError(
          ErrorCode.InvalidParams,
          formatIssues(result.error.issues),
        );
      }
      const response = await domainServer.commands.describeContext(result.data);
      return await toCallToolResult(response, async (data) =>
        buildDescribeContextResult(data),
      );
    },
    "fetch-log": async (args) => {
      const result = fetchLogSchema.safeParse(stripMetaField(args ?? {}));
      if (!result.success) {
        throw new McpError(
          ErrorCode.InvalidParams,
          formatIssues(result.error.issues),
        );
      }
      const response = await domainServer.commands.fetchLog(result.data);
      return await toCallToolResult(response, buildFetchLogResult);
    },
    "stream-log": async (args) => {
      const result = streamLogSchema.safeParse(stripMetaField(args ?? {}));
      if (!result.success) {
        throw new McpError(
          ErrorCode.InvalidParams,
          formatIssues(result.error.issues),
        );
      }
      const response = await domainServer.commands.streamLog(result.data);
      return await toCallToolResult(response, async (data) =>
        buildStreamLogResult(data),
      );
    },
  };

  server.registerCapabilities?.({ tools: { listChanged: true } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request, _extra) => {
    const tool = handlers[request.params.name];
    if (!tool) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Tool ${request.params.name} not found`,
      );
    }
    return tool(request.params.arguments ?? {});
  });

  sdkServer.sendToolListChanged();

  return handlers;
};

export type SdkServerOptions = CreateMcpServerOptions & {
  implementation?: {
    name: string;
    version: string;
  };
  stdin?: Readable;
  stdout?: Writable;
};

export const createSdkServer = (options: SdkServerOptions = {}) => {
  const {
    implementation = DEFAULT_IMPLEMENTATION,
    stdin: _ignoredInCreate,
    stdout: _ignoredOutCreate,
    ...domainOptions
  } = options;

  const domainServer = createMcpServer(domainOptions);
  const sdkServer = new McpServer(implementation, {
    capabilities: {
      tools: {
        listChanged: true,
      },
    },
  });
  const tools = registerTools(sdkServer, domainServer);
  return {
    domainServer,
    sdkServer,
    tools,
  };
};

export const startSdkServer = async (options: SdkServerOptions = {}) => {
  const { domainServer, sdkServer, tools } = createSdkServer(options);
  domainServer.start();
  const transport = new StdioServerTransport(options.stdin, options.stdout);
  await sdkServer.connect(transport);
  await sdkServer.sendToolListChanged();
  return {
    domainServer,
    sdkServer,
    transport,
    tools,
  };
};
