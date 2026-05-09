import type { Embedder } from "./types";

const DEFAULT_URL = "https://api.openai.com/v1/embeddings";
const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIM = 1536;

export class CloudEmbedder implements Embedder {
  readonly modelName: string;
  readonly dim: number;
  private url: string;
  private apiKey: string;

  constructor(url: string | undefined, apiKey: string, modelName?: string, dim?: number) {
    this.url = url ?? DEFAULT_URL;
    this.apiKey = apiKey;
    this.modelName = modelName ?? DEFAULT_MODEL;
    this.dim = dim ?? DEFAULT_DIM;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.modelName, input: texts }),
    });
    if (!res.ok) throw new Error(`Cloud embedder returned ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
    // Sort by index to preserve input order.
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    return sorted.map((d) => new Float32Array(d.embedding));
  }
}
