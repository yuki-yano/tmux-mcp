import { describe, expect, it } from "vitest";
import { applyLogFormatting } from "@/log-formatting";

describe("applyLogFormatting", () => {
  const sample = [
    "[2025-10-06T02:00:00Z] [INFO] start server",
    "[2025-10-06T02:05:00Z] [WARN] high latency",
    "[2025-10-06T02:10:00Z] [ERROR] crash",
    "plain line",
  ];

  it("returns lines unchanged without filters", () => {
    const result = applyLogFormatting({ lines: sample });
    expect(result.lines).toEqual(sample);
    expect(result.summary).toBeUndefined();
  });

  it("filters by time range", () => {
    const result = applyLogFormatting({
      lines: sample,
      filters: {
        timeRange: { from: "2025-10-06T02:05:00Z", to: "2025-10-06T02:10:00Z" },
      },
    });
    expect(result.lines).toEqual([
      "[2025-10-06T02:05:00Z] [WARN] high latency",
      "[2025-10-06T02:10:00Z] [ERROR] crash",
      "plain line",
    ]);
  });

  it("filters by keywords and levels", () => {
    const result = applyLogFormatting({
      lines: sample,
      filters: {
        keywords: ["crash"],
        levels: ["error"],
      },
    });
    expect(result.lines).toEqual(["[2025-10-06T02:10:00Z] [ERROR] crash"]);
  });

  it("replaces strings via mask patterns", () => {
    const result = applyLogFormatting({
      lines: ["token=abc123"],
      maskPatterns: ["abc123"],
    });
    expect(result.lines).toEqual(["token=***"]);
  });

  it("returns summary statistics when enabled", () => {
    const result = applyLogFormatting({ lines: sample, summary: true });
    expect(result.summary).toEqual({
      totalLines: 4,
      errorCount: 2,
      firstErrorLine: "[2025-10-06T02:05:00Z] [WARN] high latency",
    });
  });
});
