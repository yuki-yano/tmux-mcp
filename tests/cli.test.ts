import { describe, expect, it, vi } from "vitest";

vi.mock("@/sdk-server", () => ({
  startSdkServer: vi.fn(async () => ({
    domainServer: { start: vi.fn() },
    sdkServer: { connect: vi.fn() },
    transport: {},
    tools: {},
  })),
}));

describe("cli", () => {
  it("startCli invokes startSdkServer", async () => {
    const module = await import("@/cli");
    await module.startCli();
    const { startSdkServer } = await import("@/sdk-server");
    expect(startSdkServer).toHaveBeenCalledWith({
      stdin: process.stdin,
      stdout: process.stdout,
    });
  });
});
