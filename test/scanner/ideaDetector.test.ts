import { describe, it, expect } from "vitest";
import { detectIdeas } from "../../src/scanner/ideaDetector";

describe("detectIdeas", () => {
  it("returns [] for empty string", () => {
    expect(detectIdeas("")).toEqual([]);
  });

  it("returns [] for text shorter than MIN_LEN", () => {
    expect(detectIdeas("short")).toEqual([]);
    expect(detectIdeas("I should go.")).toEqual([]);
  });

  it("detects a single idea from a matching sentence", () => {
    const results = detectIdeas("I should refactor the auth module someday.");
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("I should refactor the auth module someday.");
    expect(results[0].confidence).toBeCloseTo(0.8, 1);
  });

  it("returns [] for non-matching text", () => {
    const results = detectIdeas("This is fine and everything looks great here.");
    expect(results).toEqual([]);
  });

  it("detects multiple ideas from multi-sentence text", () => {
    const text =
      "I should refactor the auth module someday. We could add caching next session. This sentence is fine.";
    const results = detectIdeas(text);
    expect(results.length).toBeGreaterThanOrEqual(2);
    const texts = results.map((r) => r.text);
    expect(texts.some((t) => t.includes("refactor"))).toBe(true);
    expect(texts.some((t) => t.includes("caching"))).toBe(true);
  });

  it("deduplicates the same sentence appearing twice", () => {
    const sentence = "I should refactor the auth module someday.";
    const text = `${sentence} Some unrelated filler content here. ${sentence}`;
    const results = detectIdeas(text);
    const matching = results.filter((r) => r.text === sentence);
    expect(matching).toHaveLength(1);
  });

  it("boosts confidence when multiple patterns match the same sentence", () => {
    // "TODO" (weight 0.9) + "I should" (weight 0.8) → matchCount=2 → boost applied
    const text = "TODO: I should refactor this entire authentication module now.";
    const results = detectIdeas(text);
    expect(results).toHaveLength(1);
    // With 2 matches avg = (0.9+0.8)/2 = 0.85, boost = 0.05 → 0.90
    expect(results[0].confidence).toBeGreaterThan(0.8);
  });

  it("handles newline-delimited sentences", () => {
    const text = "We should add tests for this module.\nI need to revisit the config file later.";
    const results = detectIdeas(text);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("filters out sentences longer than MAX_LEN", () => {
    const longSentence = "I should " + "x".repeat(250);
    const results = detectIdeas(longSentence);
    expect(results).toEqual([]);
  });
});
