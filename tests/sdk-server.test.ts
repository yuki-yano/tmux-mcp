import { Readable } from "node:stream";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const domainDescribe = vi.fn();
const domainFetch = vi.fn();
const domainStream = vi.fn();
const domainStart = vi.fn();

const domainServerStub = {
  start: domainStart,
  commands: {
    describeContext: domainDescribe,
    fetchLog: domainFetch,
    streamLog: domainStream,
  },
};

vi.mock("@/index", async () => {
  const actual = await vi.importActual<typeof import("@/index")>("@/index");
  return {
    ...actual,
    createMcpServer: vi.fn(() => domainServerStub),
  };
});

class FakeMcpServer {
  info: unknown;
  options: unknown;
  server: {
    registerCapabilities: ReturnType<typeof vi.fn>;
    setRequestHandler: ReturnType<typeof vi.fn>;
  };
  sendToolListChanged = vi.fn(async () => {});
  connect = vi.fn(async () => {});
  close = vi.fn(async () => {});

  constructor(info: unknown, options: unknown) {
    this.info = info;
    this.options = options;
    this.server = {
      registerCapabilities: vi.fn(),
      setRequestHandler: vi.fn(),
    };
  }
}

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: FakeMcpServer,
}));

const transportInstances: unknown[] = [];
class FakeTransport {
  stdin: unknown;
  stdout: unknown;
  constructor(stdin?: unknown, stdout?: unknown) {
    this.stdin = stdin;
    this.stdout = stdout;
    this.onmessage = undefined;
    transportInstances.push(this);
  }
  onmessage?: unknown;
  onclose?: unknown;
  onerror?: unknown;
  async start() {}
}

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: FakeTransport,
}));

describe("sdk-server", () => {
  beforeEach(() => {
    vi.resetModules();
    domainDescribe.mockReset();
    domainFetch.mockReset();
    domainStream.mockReset();
    domainStart.mockReset();
    transportInstances.length = 0;
  });

  it("registers tools and executes handlers via createSdkServer", async () => {
    const module = await import("@/sdk-server");
    domainDescribe.mockResolvedValue({
      success: true,
      data: {
        sessionPanes: [{ id: "%1", title: "vim", session: "dev", window: "1" }],
      },
    });

    const { sdkServer, tools } = module.createSdkServer();
    const fakeServer = sdkServer as unknown as FakeMcpServer;

    expect(fakeServer.server.registerCapabilities).toHaveBeenCalledWith({
      tools: { listChanged: true },
    });

    const listHandlerCall = fakeServer.server.setRequestHandler.mock.calls.find(
      ([schema]) => schema === ListToolsRequestSchema,
    );
    if (!listHandlerCall) {
      throw new Error("list handler not registered");
    }
    const listHandler = listHandlerCall[1];
    if (typeof listHandler !== "function") {
      throw new Error("list handler is not a function");
    }
    const listResponse = await listHandler();
    expect(listResponse.tools).toHaveLength(3);

    const callHandlerCall = fakeServer.server.setRequestHandler.mock.calls.find(
      ([schema]) => schema === CallToolRequestSchema,
    );
    expect(callHandlerCall).toBeDefined();

    const handler = tools["describe-context"];
    const result = await handler({ paneHint: "%1" });
    expect(domainDescribe).toHaveBeenCalledWith({ paneHint: "%1" });
    expect(result).toMatchObject({
      structuredContent: { sessionPanes: [{ id: "%1" }] },
    });
  });

  it("returns an error from the tool handler", async () => {
    const module = await import("@/sdk-server");
    domainDescribe.mockResolvedValue({
      success: false,
      error: { code: "ERR", message: "bad" },
    });

    const { tools } = module.createSdkServer();
    const handler = tools["describe-context"];
    const result = await handler({});

    expect(result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "ERR" } },
    });
  });

  it("starts the connection in startSdkServer", async () => {
    const module = await import("@/sdk-server");
    domainDescribe.mockResolvedValue({
      success: true,
      data: {
        sessionPanes: [{ id: "%1", title: "vim", session: "dev", window: "1" }],
      },
    });
    domainFetch.mockResolvedValue({
      success: true,
      data: { lines: ["a"], metadata: { mode: "capture", paneId: "%1" } },
    });
    domainStream.mockResolvedValue({
      success: true,
      data: { id: "s", stopToken: "t" },
    });

    const stdin = Readable.from([]);
    const { sdkServer } = await module.startSdkServer({ stdin });

    expect(domainStart).toHaveBeenCalled();
    expect(sdkServer.connect).toHaveBeenCalled();
    const transport = transportInstances[0] as FakeTransport | undefined;
    expect(transport?.stdin).toBe(stdin);
    expect(
      (sdkServer as unknown as FakeMcpServer).sendToolListChanged,
    ).toHaveBeenCalled();
  });
});
