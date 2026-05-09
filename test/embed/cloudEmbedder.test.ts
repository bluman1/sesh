import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CloudEmbedder } from "../../src/embed/cloudEmbedder";

describe("CloudEmbedder", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it("uses default model + dim + url", () => {
    const e = new CloudEmbedder(undefined, "key-123");
    expect(e.modelName).toBe("text-embedding-3-small");
    expect(e.dim).toBe(1536);
  });

  it("accepts custom url, model, and dim", () => {
    const e = new CloudEmbedder("https://my.api/embed", "k", "custom-model", 512);
    expect(e.modelName).toBe("custom-model");
    expect(e.dim).toBe(512);
  });

  it("posts batch and returns Float32Arrays in index order", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { index: 1, embedding: [0.4, 0.5] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const e = new CloudEmbedder(undefined, "test-key", "model", 2);
    const result = await e.embed(["first", "second"]);
    expect(result.length).toBe(2);
    // index 0 comes first after sort
    expect(result[0][0]).toBeCloseTo(0.1, 4);
    expect(result[0][1]).toBeCloseTo(0.2, 4);
    expect(result[1][0]).toBeCloseTo(0.4, 4);
    expect(result[1][1]).toBeCloseTo(0.5, 4);
  });

  it("sends Authorization header with Bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ index: 0, embedding: [0] }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const e = new CloudEmbedder(undefined, "secret-key", "m", 1);
    await e.embed(["hello"]);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["authorization"]).toBe("Bearer secret-key");
  });

  it("throws when server returns non-OK", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    }) as unknown as typeof fetch;
    const e = new CloudEmbedder(undefined, "bad-key");
    await expect(e.embed(["x"])).rejects.toThrow(/401/);
  });

  it("returns empty for empty input without calling fetch", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const e = new CloudEmbedder(undefined, "key");
    expect(await e.embed([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
