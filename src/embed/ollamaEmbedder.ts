import type { Embedder } from "./types";

const DEFAULT_URL = "http://localhost:11434";
const DEFAULT_MODEL = "nomic-embed-text";
const DEFAULT_DIM = 768;

export class OllamaEmbedder implements Embedder {
  readonly modelName: string;
  readonly dim: number;
  private url: string;

  constructor(url?: string, modelName?: string, dim?: number) {
    this.url = (url ?? DEFAULT_URL).replace(/\/+$/, "");
    this.modelName = modelName ?? DEFAULT_MODEL;
    this.dim = dim ?? DEFAULT_DIM;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    // Ollama's embeddings endpoint takes one prompt at a time; fan out.
    return Promise.all(
      texts.map(async (prompt) => {
        const res = await fetch(`${this.url}/api/embeddings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: this.modelName, prompt }),
        });
        if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
        const data = (await res.json()) as { embedding: number[] };
        return new Float32Array(data.embedding);
      }),
    );
  }
}
