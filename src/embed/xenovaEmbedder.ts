import type { Embedder } from "./types";

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_DIM = 384;

/**
 * Local embedder using @huggingface/transformers. Lazy-initialises the
 * pipeline on first embed() call so import cost is amortised, and so a
 * test environment can exercise the surrounding code without paying
 * model-download time. The pipeline is loaded via a dynamic import so
 * the heavy library is not pulled into the Node module graph at startup.
 */
export class XenovaEmbedder implements Embedder {
  readonly modelName: string;
  readonly dim: number;
  private pipe: unknown = null;
  private loadPromise: Promise<unknown> | null = null;

  constructor(modelName?: string, dim?: number) {
    this.modelName = modelName ?? DEFAULT_MODEL;
    this.dim = dim ?? DEFAULT_DIM;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const pipe = await this.ensurePipeline();
    // pipe is a FeatureExtractionPipeline. Call with the array; it returns
    // a Tensor whose `.data` is a Float32Array of length texts.length * dim,
    // and `.dims` describes [N, dim] (after pooling).
    const result = (await (pipe as (...a: unknown[]) => unknown)(texts, {
      pooling: "mean",
      normalize: true,
    })) as { data: Float32Array; dims: number[] };
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      const slice = new Float32Array(this.dim);
      slice.set(result.data.subarray(i * this.dim, (i + 1) * this.dim));
      out.push(slice);
    }
    return out;
  }

  private async ensurePipeline(): Promise<unknown> {
    if (this.pipe) return this.pipe;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const mod = (await import("@huggingface/transformers")) as {
          pipeline: (task: string, model: string) => Promise<unknown>;
        };
        const p = await mod.pipeline("feature-extraction", this.modelName);
        this.pipe = p;
        return p;
      })();
    }
    return this.loadPromise;
  }
}
