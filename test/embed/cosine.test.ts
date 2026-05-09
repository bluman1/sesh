import { describe, it, expect } from "vitest";
import { cosineSim, rankByCosine } from "../../src/embed/cosine";

describe("cosineSim", () => {
  it("returns 1 for identical vectors", () => {
    const v = new Float32Array([1, 0, 0, 0]);
    expect(cosineSim(v, v)).toBeCloseTo(1);
  });
  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSim(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0);
  });
  it("returns -1 for opposite vectors", () => {
    expect(cosineSim(new Float32Array([1, 0]), new Float32Array([-1, 0]))).toBeCloseTo(-1);
  });
  it("returns 0 for any-vs-zero (no NaN)", () => {
    expect(cosineSim(new Float32Array([1, 1]), new Float32Array([0, 0]))).toBe(0);
  });
  it("returns 0 for mismatched dims", () => {
    expect(cosineSim(new Float32Array([1, 0]), new Float32Array([1, 0, 0]))).toBe(0);
  });
});

describe("rankByCosine", () => {
  it("orders candidates by similarity descending", () => {
    const q = new Float32Array([1, 0]);
    const cands = [
      new Float32Array([0, 1]),       // orthogonal
      new Float32Array([1, 0]),       // identical
      new Float32Array([0.7, 0.7]),   // partial
    ];
    const r = rankByCosine(q, cands);
    expect(r.map((x) => x.idx)).toEqual([1, 2, 0]);
  });
  it("applies limit", () => {
    const q = new Float32Array([1, 0]);
    const cands = [new Float32Array([1, 0]), new Float32Array([0, 1]), new Float32Array([0.5, 0.5])];
    expect(rankByCosine(q, cands, 2).length).toBe(2);
  });
});
