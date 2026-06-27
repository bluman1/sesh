import { describe, it, expect } from "vitest";
import { activeMsFromTimestamps, ACTIVE_IDLE_CAP_MS } from "../../src/db/activeTime";

const MIN = 60_000;

describe("activeMsFromTimestamps", () => {
  it("returns 0 for empty or single-turn input", () => {
    expect(activeMsFromTimestamps([])).toBe(0);
    expect(activeMsFromTimestamps([1_000])).toBe(0);
  });

  it("sums consecutive gaps that are within the cap", () => {
    const base = 1_000_000;
    // gaps: 10m, 15m  -> 25m
    const ts = [base, base + 10 * MIN, base + 25 * MIN];
    expect(activeMsFromTimestamps(ts)).toBe(25 * MIN);
  });

  it("excludes gaps larger than the cap (stepped away)", () => {
    const base = 1_000_000;
    // gaps: 10m, 90m(skip), 5m -> 15m
    const ts = [base, base + 10 * MIN, base + 100 * MIN, base + 105 * MIN];
    expect(activeMsFromTimestamps(ts)).toBe(15 * MIN);
  });

  it("counts a gap exactly equal to the cap", () => {
    const base = 1_000_000;
    expect(activeMsFromTimestamps([base, base + 30 * MIN])).toBe(30 * MIN);
  });

  it("sorts unsorted input before summing", () => {
    const base = 1_000_000;
    const ts = [base + 25 * MIN, base, base + 10 * MIN];
    expect(activeMsFromTimestamps(ts)).toBe(25 * MIN);
  });

  it("respects a custom cap", () => {
    const base = 1_000_000;
    // gap 20m, cap 15m -> excluded
    expect(activeMsFromTimestamps([base, base + 20 * MIN], 15 * MIN)).toBe(0);
  });

  it("exposes a 30-minute default cap", () => {
    expect(ACTIVE_IDLE_CAP_MS).toBe(30 * MIN);
  });
});
