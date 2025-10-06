import { describe, expect, it } from "vitest";
import { createFeedbackManager } from "@/context-resolver/feedback-manager";

const ttlMs = 60_000;

describe("FeedbackManager", () => {
  it("applies decay based on record age", () => {
    const manager = createFeedbackManager({ ttlMs, maxEntries: 10 });
    manager.register({ paneId: "%1", rating: "match", timestamp: 0 });

    const adjustments = manager.getAdjustments(30_000);

    expect(adjustments["%1"]).toBeCloseTo(0.5, 2);
  });

  it("removes expired records and caps maximum entries", () => {
    const manager = createFeedbackManager({ ttlMs, maxEntries: 2 });
    manager.register({ paneId: "%1", rating: "match", timestamp: 0 });
    manager.register({ paneId: "%2", rating: "mismatch", timestamp: 10_000 });
    manager.register({ paneId: "%3", rating: "match", timestamp: 20_000 });

    const adjustments = manager.getAdjustments(20_000);

    expect(Object.keys(adjustments)).toEqual(["%2", "%3"]);
    expect(adjustments["%2"]).toBeLessThan(0);
  });
});
