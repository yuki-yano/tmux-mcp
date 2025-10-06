import { describe, expect, it } from "vitest";
import {
  createContextResolver,
  type ScoringWeights,
  type TmuxPane,
} from "@/context-resolver";

const baseWeights: ScoringWeights = {
  hint: 4,
  activePane: 3,
  activeWindow: 2,
  activeSession: 1,
  defaultPane: 0.5,
  commandCategories: {
    vim: 2,
    tail: 1,
  },
  layoutBonus: {
    sameWindow: 1.5,
    sameSession: 0.75,
  },
  feedback: {
    positive: 1,
    negative: 1,
    decayMinutes: 10,
  },
};

const createResolver = (
  panes: TmuxPane[],
  weights: ScoringWeights = baseWeights,
  nowProvider?: () => number,
  agentSession: string | null = "dev",
) =>
  createContextResolver({
    tmux: {
      listPanes: async () => panes,
      getCurrentSession:
        agentSession === null
          ? undefined
          : async () => agentSession ?? undefined,
    },
    weights,
    now: nowProvider,
  });

describe("createContextResolver", () => {
  it("throws when no panes are available", async () => {
    const resolver = createResolver([]);
    await expect(resolver.describe({})).rejects.toThrow(
      "No tmux panes were detected",
    );
  });

  it("returns scores and reasons prioritizing hint matches", async () => {
    const panes: TmuxPane[] = [
      {
        id: "%1",
        title: "vim",
        session: "dev",
        window: "1",
        currentCommand: "vim",
        isActive: true,
        isActiveWindow: true,
        isActiveSession: true,
        lastUsed: 100,
      },
      {
        id: "%2",
        title: "logs",
        session: "dev",
        window: "1",
        currentCommand: "tail",
        isActiveSession: true,
        lastUsed: 90,
      },
      {
        id: "%3",
        title: "shell",
        session: "ops",
        window: "2",
        currentCommand: "bash",
        lastUsed: 80,
      },
    ];
    const resolver = createResolver(panes);

    const result = await resolver.describe({ paneHint: "vim" });

    expect(result.sessionPanes[0]?.id).toBe("%1");
    expect(result.sessionPanes[0]?.score ?? 0).toBeGreaterThan(
      result.sessionPanes[1]?.score ?? 0,
    );
    expect(result.sessionPanes[0]?.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("matched hint")]),
    );
    expect(result.sessionPanes).toHaveLength(2);
    expect(result.sessionPanes.map((pane) => pane.id)).toEqual(["%1", "%2"]);
  });

  it("includes debug information when debug flag is enabled", async () => {
    const panes: TmuxPane[] = [
      {
        id: "%1",
        title: "editor",
        session: "dev",
        window: "1",
        isActive: true,
        isActiveWindow: true,
        isActiveSession: true,
      },
      {
        id: "%2",
        title: "logs",
        session: "dev",
        window: "1",
      },
    ];
    const resolver = createResolver(panes);

    const result = await resolver.describe({ paneHint: "logs", debug: true });

    expect(result.debug).toBeDefined();
    expect(result.debug?.hints.weightedHints).not.toHaveLength(0);
    expect(result.debug?.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paneId: "%1" }),
        expect.objectContaining({ paneId: "%2" }),
      ]),
    );
    expect(result.debug?.hints.issues).toBeDefined();
    expect(result.debug?.feedback.adjustments).toBeDefined();
  });

  it("breaks ties using recency then pane id", async () => {
    const panes: TmuxPane[] = [
      {
        id: "%2",
        title: "secondary",
        session: "dev",
        window: "1",
        lastUsed: 100,
      },
      {
        id: "%1",
        title: "primary",
        session: "dev",
        window: "1",
        lastUsed: 150,
      },
      {
        id: "%3",
        title: "third",
        session: "dev",
        window: "1",
        lastUsed: 150,
      },
    ];
    const resolver = createResolver(panes, {
      ...baseWeights,
      hint: 0,
      activePane: 0,
      activeWindow: 0,
      activeSession: 0,
      layoutBonus: { sameWindow: 0, sameSession: 0 },
      commandCategories: {},
    });

    const result = await resolver.describe({});

    expect(result.sessionPanes.map((pane) => pane.id)).toEqual([
      "%1",
      "%3",
      "%2",
    ]);
  });

  it("boosts panes when positive feedback is recorded", async () => {
    const nowValue = 0;
    const panes: TmuxPane[] = [
      {
        id: "%1",
        title: "primary",
        session: "dev",
        window: "1",
        lastUsed: 200,
      },
      {
        id: "%2",
        title: "secondary",
        session: "dev",
        window: "1",
        lastUsed: 100,
      },
    ];
    const resolver = createResolver(panes, baseWeights, () => nowValue);

    const baseline = await resolver.describe({});
    expect(baseline.sessionPanes[0]?.id).toBe("%1");

    await resolver.describe({
      feedback: { paneId: "%2", rating: "match" },
    });

    const boosted = await resolver.describe({});
    expect(boosted.sessionPanes[0]?.id).toBe("%2");
    expect(boosted.sessionPanes[0]?.score ?? 0).toBeGreaterThan(
      baseline.sessionPanes[0]?.score ?? 0,
    );
    expect(boosted.sessionPanes.map((pane) => pane.id)).toEqual(["%2", "%1"]);
  });

  it("ignores panes that belong to non-active sessions", async () => {
    const panes: TmuxPane[] = [
      {
        id: "%1",
        title: "active-session-pane",
        session: "dev",
        window: "1",
        isActiveSession: true,
        lastUsed: 100,
      },
      {
        id: "%2",
        title: "other-session-pane",
        session: "ops",
        window: "1",
        isActiveSession: false,
        lastUsed: 200,
      },
    ];
    const resolver = createResolver(panes);

    const result = await resolver.describe({});

    expect(result.sessionPanes.map((pane) => pane.id)).toEqual(["%1"]);
  });

  it("falls back to active sessions when agent session is unavailable", async () => {
    const panes: TmuxPane[] = [
      {
        id: "%1",
        title: "user-active",
        session: "dev",
        window: "1",
        isActiveSession: true,
      },
      {
        id: "%2",
        title: "agent-session",
        session: "agent",
        window: "1",
        isActiveSession: false,
      },
    ];
    const resolver = createResolver(panes, baseWeights, undefined, null);

    const result = await resolver.describe({});

    expect(result.sessionPanes.map((pane) => pane.id)).toEqual(["%1"]);
  });
});
