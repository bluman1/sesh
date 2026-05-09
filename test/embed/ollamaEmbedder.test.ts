import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OllamaEmbedder } from "../../src/embed/ollamaEmbedder";

describe("OllamaEmbedder", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it("posts to /api/embeddings and returns Float32Arrays", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    }) as unknown as typeof fetch;
    const e = new OllamaEmbedder("http://localhost:11434", "nomic-embed-text", 3);
    const result = await e.embed(["hello"]);
    expect(result.length).toBe(1);
    expect(result[0][0]).toBeCloseTo(0.1, 4);
    expect(result[0][1]).toBeCloseTo(0.2, 4);
    expect(result[0][2]).toBeCloseTo(0.3, 4);
  });

  it("strips trailing slash from url", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embedding: [0] }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const e = new OllamaEmbedder("http://localhost:11434/", "m", 1);
    await e.embed(["x"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/embeddings",
      expect.any(Object),
    );
  });

  it("throws when server returns non-OK", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" }) as unknown as typeof fetch;
    const e = new OllamaEmbedder();
    await expect(e.embed(["x"])).rejects.toThrow(/500/);
  });

  it("returns empty for empty input without calling fetch", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const e = new OllamaEmbedder();
    expect(await e.embed([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
