import { describe, expect, it } from "vitest";
import { createHintInterpreter } from "@/context-resolver/hint-interpreter";

describe("HintInterpreter", () => {
  const interpreter = createHintInterpreter();

  it("generates weighted hints from single paneHint", async () => {
    const result = await interpreter.interpret({ paneHint: "Dev Pane" });

    const exact = result.weightedHints.find((hint) => hint.source === "exact");
    expect(exact?.token).toBe("dev pane");
    expect(exact?.weight ?? 0).toBeCloseTo(0.5, 5);

    const tokens = result.weightedHints.filter((hint) => hint.source === "nl");
    expect(tokens.map((hint) => hint.token)).toEqual(["dev", "pane"]);
    tokens.forEach((hint) => {
      expect(hint.weight).toBeCloseTo(0.25, 5);
    });

    expect(result.rawTokens).toEqual(["dev pane", "dev", "pane"]);
  });

  it("normalizes paneHints weights and preserves order", async () => {
    const result = await interpreter.interpret({
      paneHints: [{ value: "%1" }, { value: "Logs", weight: 3 }],
    });

    expect(result.weightedHints).toEqual([
      { token: "%1", weight: 0.25, source: "composite" },
      { token: "logs", weight: 0.75, source: "composite" },
    ]);
    expect(result.rawTokens).toEqual(["%1", "logs"]);
  });

  it("extracts natural language tokens while dropping stop words", async () => {
    const result = await interpreter.interpret({
      paneHint: "Show me the deploy logs window please",
    });

    const tokens = result.weightedHints.filter((hint) => hint.source === "nl");
    expect(tokens.map((hint) => hint.token)).toEqual([
      "deploy",
      "logs",
      "window",
    ]);
    tokens.forEach((hint) => {
      expect(hint.weight).toBeCloseTo(1 / 6, 5);
    });
  });

  it("handles Japanese text and removes common particles", async () => {
    const result = await interpreter.interpret({
      paneHint: "webpackのログを見たい",
    });

    const tokens = result.weightedHints.filter((hint) => hint.source === "nl");
    expect(tokens.map((hint) => hint.token)).toContain("webpack");
    expect(tokens.map((hint) => hint.token)).toContain("ログ");
    expect(tokens.map((hint) => hint.token)).not.toContain("の");
    expect(tokens.map((hint) => hint.token)).not.toContain("を");
  });

  it("segments complex Japanese phrases into meaningful keywords", async () => {
    const result = await interpreter.interpret({
      paneHint: "パフォーマンステストの結果を共有して",
    });

    const tokens = result.weightedHints
      .filter((hint) => hint.source === "nl")
      .map((hint) => hint.token);

    expect(tokens).toEqual(
      expect.arrayContaining(["パフォーマンス", "テスト", "結果", "共有"]),
    );
    ["の", "を", "し", "して", "て"].forEach((stopWord) => {
      expect(tokens).not.toContain(stopWord);
    });
  });

  it("reports issues when hints are empty", async () => {
    const result = await interpreter.interpret({
      paneHint: "   ",
      paneHints: [{ value: "\t" }, { value: "visible" }],
    });

    expect(result.weightedHints.map((hint) => hint.token)).toEqual(["visible"]);
    expect(result.issues.length).toBe(2);
    expect(result.issues).toContain("paneHint was empty after trimming");
    expect(result.issues).toContain("paneHints[0] was empty after trimming");
  });
});
