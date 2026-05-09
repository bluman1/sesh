import { describe, it, expect } from "vitest";
import { XenovaEmbedder } from "../../src/embed/xenovaEmbedder";

describe("XenovaEmbedder", () => {
  it("uses default model + dim", () => {
    const e = new XenovaEmbedder();
    expect(e.modelName).toBe("Xenova/all-MiniLM-L6-v2");
    expect(e.dim).toBe(384);
  });
  it("accepts custom model + dim", () => {
    const e = new XenovaEmbedder("custom/model", 256);
    expect(e.modelName).toBe("custom/model");
    expect(e.dim).toBe(256);
  });
  it("returns empty array for empty input without loading the pipeline", async () => {
    const e = new XenovaEmbedder();
    expect(await e.embed([])).toEqual([]);
  });
});
