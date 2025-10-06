import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import type { TmuxPane } from "@/context-resolver";
import type { WeightedHint } from "@/context-resolver/hint-interpreter";
import { createMultiStageScorer } from "@/context-resolver/multi-stage-scorer";

const weights = {
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

describe("MultiStageScorer", () => {
  it("ranks panes using hints, activity, layout, and command weights", () => {
    const scorer = createMultiStageScorer();
    const panes: TmuxPane[] = [
      {
        id: "%1",
        title: "vim main",
        session: "dev",
        window: "1",
        currentCommand: "vim",
        isActive: true,
        isActiveWindow: true,
        isActiveSession: true,
        lastUsed: 200,
      },
      {
        id: "%2",
        title: "logs tail",
        session: "dev",
        window: "1",
        currentCommand: "tail",
        isActiveSession: true,
        lastUsed: 150,
      },
      {
        id: "%3",
        title: "build",
        session: "ops",
        window: "2",
        currentCommand: "node",
        lastUsed: 100,
      },
    ];
    const hints: WeightedHint[] = [
      { token: "vim", weight: 0.6, source: "nl" },
      { token: "logs", weight: 0.4, source: "nl" },
    ];

    const { scored } = scorer.scorePanes({
      panes,
      hints,
      weights,
      feedbackAdjustments: {},
    });

    expect(scored.map((entry) => entry.pane.id)).toEqual(["%1", "%2", "%3"]);

    const primary = scored[0];
    expect(primary.stageContributions.hint).toBeCloseTo(2.4, 5);
    expect(primary.stageContributions.activePane).toBe(weights.activePane);
    expect(primary.stageContributions.commandCategory).toBe(2);
    expect(primary.stageContributions.layoutSameWindow).toBeCloseTo(1.5, 5);
    expect(primary.total).toBeCloseTo(13.15, 2);
    expect(primary.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('matched hint "vim"'),
        expect.stringContaining("pane is active"),
        expect.stringContaining("same window"),
        expect.stringContaining("command category"),
      ]),
    );

    const secondary = scored[1];
    expect(secondary.stageContributions.hint).toBeCloseTo(1.6, 5);
    expect(secondary.stageContributions.layoutSameWindow).toBeCloseTo(1.5, 5);
    expect(secondary.stageContributions.layoutSameSession).toBeCloseTo(0.75, 5);
  });

  it("breaks ties using lastUsed then pane id", () => {
    const scorer = createMultiStageScorer();
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

    const { scored } = scorer.scorePanes({
      panes,
      hints: [],
      weights,
      feedbackAdjustments: {},
    });

    expect(scored.map((entry) => entry.pane.id)).toEqual(["%1", "%3", "%2"]);
  });

  it("handles 1000 panes within 50ms", () => {
    const scorer = createMultiStageScorer();
    const panes: TmuxPane[] = Array.from({ length: 1000 }, (_, index) => ({
      id: `%${index}`,
      title: `pane-${index}`,
      session: `session-${Math.floor(index / 10)}`,
      window: `window-${Math.floor(index / 5)}`,
      lastUsed: index,
    }));

    const start = performance.now();
    const { scored } = scorer.scorePanes({
      panes,
      hints: [],
      weights,
      feedbackAdjustments: {},
    });
    const duration = performance.now() - start;

    expect(scored).toHaveLength(1000);
    expect(duration).toBeLessThan(50);
  });
});
