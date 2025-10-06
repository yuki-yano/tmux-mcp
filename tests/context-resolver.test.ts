import { describe, expect, it } from "vitest";
import { createContextResolver, type TmuxPane } from "@/context-resolver";

const createResolver = (panes: TmuxPane[]) => {
  return createContextResolver({
    tmux: {
      listPanes: async () => panes,
    },
  });
};

describe("createContextResolver", () => {
  it("throws when no panes are available", async () => {
    const resolver = createResolver([]);
    await expect(resolver.describe({})).rejects.toThrow(
      "No tmux panes were detected",
    );
  });

  it("prioritizes panes matching paneHint", async () => {
    const panes: TmuxPane[] = [
      { id: "%1", title: "vim", session: "dev", window: "1", isActive: false },
      { id: "%2", title: "shell", session: "dev", window: "1", isActive: true },
    ];
    const resolver = createResolver(panes);

    const result = await resolver.describe({ paneHint: "%1" });

    expect(result.primaryPane.id).toBe("%1");
    expect(result.candidates.map((pane) => pane.id)).toEqual(["%1", "%2"]);
  });

  it("prioritizes active panes, then window and session", async () => {
    const panes: TmuxPane[] = [
      {
        id: "%1",
        title: "vim",
        session: "dev",
        window: "1",
        isActive: false,
        isActiveWindow: true,
      },
      {
        id: "%2",
        title: "server",
        session: "dev",
        window: "1",
        isActive: true,
      },
      { id: "%3", title: "logs", session: "ops", window: "2", isActive: false },
    ];
    const resolver = createResolver(panes);

    const result = await resolver.describe({});

    expect(result.primaryPane.id).toBe("%2");
    expect(result.candidates.map((pane) => pane.id)).toEqual([
      "%2",
      "%1",
      "%3",
    ]);
  });

  it("ignores active panes from other sessions", async () => {
    const panes: TmuxPane[] = [
      {
        id: "%1",
        title: "vim",
        session: "dev",
        window: "1",
        isActiveWindow: true,
        isActiveSession: true,
        lastUsed: 100,
      },
      {
        id: "%2",
        title: "ops-shell",
        session: "ops",
        window: "1",
        isActive: true,
        isActiveSession: false,
        lastUsed: 200,
      },
    ];
    const resolver = createResolver(panes);

    const result = await resolver.describe({});

    expect(result.primaryPane.id).toBe("%1");
    expect(result.candidates.map((pane) => pane.id)).toEqual(["%1", "%2"]);
  });

  it("sorts by lastUsed descending when priority ties", async () => {
    const panes: TmuxPane[] = [
      {
        id: "%1",
        title: "vim",
        session: "dev",
        window: "1",
        isActive: false,
        lastUsed: 100,
      },
      {
        id: "%2",
        title: "server",
        session: "dev",
        window: "1",
        isActive: false,
        lastUsed: 200,
      },
    ];
    const resolver = createResolver(panes);

    const result = await resolver.describe({});

    expect(result.candidates.map((pane) => pane.id)).toEqual(["%2", "%1"]);
  });
});
