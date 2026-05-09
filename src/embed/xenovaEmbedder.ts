import type { Embedder } from "./types";

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_DIM = 384;

export interface XenovaProgressEvent {
  status: "initiate" | "download" | "progress" | "done" | "ready";
  name?: string;
  file?: string;
  loaded?: number;
  total?: number;
  /** 0..100 — present on `progress` events. */
  progress?: number;
}

export type XenovaProgressCallback = (event: XenovaProgressEvent) => void;

/**
 * Local embedder using @huggingface/transformers. Lazy-initialises the
 * pipeline on first embed() (or explicit preload()) call so import cost
 * is amortised. The pipeline is loaded via a dynamic import so the heavy
 * library is not pulled into the Node module graph at startup.
 */
export class XenovaEmbedder implements Embedder {
  readonly modelName: string;
  readonly dim: number;
  private pipe: unknown = null;
  private loadPromise: Promise<unknown> | null = null;
  private progressListeners = new Set<XenovaProgressCallback>();

  constructor(modelName?: string, dim?: number) {
    this.modelName = modelName ?? DEFAULT_MODEL;
    this.dim = dim ?? DEFAULT_DIM;
  }

  /**
   * Subscribe to model-load progress events. Returns an unsubscribe
   * function. Subscribing AFTER the pipeline has finished loading is
   * still valid — no events will fire, but a final synthetic `ready`
   * event is dispatched immediately to let callers move on.
   */
  onProgress(cb: XenovaProgressCallback): () => void {
    this.progressListeners.add(cb);
    if (this.pipe) {
      // Already loaded — fire a synthetic ready so a late subscriber can resolve.
      cb({ status: "ready" });
    }
    return () => this.progressListeners.delete(cb);
  }

  /**
   * Force the pipeline to load. Safe to call multiple times — returns the
   * same in-flight promise. Use this to surface progress to the user
   * before the first embed() is invoked.
   */
  preload(): Promise<void> {
    return this.ensurePipeline().then(() => undefined);
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const pipe = await this.ensurePipeline();
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

  private fireProgress(event: XenovaProgressEvent): void {
    for (const cb of this.progressListeners) {
      try { cb(event); } catch { /* listener errors don't break loading */ }
    }
  }

  private async ensurePipeline(): Promise<unknown> {
    if (this.pipe) return this.pipe;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const mod = (await import("@huggingface/transformers")) as {
          pipeline: (
            task: string,
            model: string,
            opts?: { progress_callback?: (e: XenovaProgressEvent) => void },
          ) => Promise<unknown>;
        };
        const p = await mod.pipeline("feature-extraction", this.modelName, {
          progress_callback: (e) => this.fireProgress(e),
        });
        this.pipe = p;
        this.fireProgress({ status: "ready" });
        return p;
      })();
    }
    return this.loadPromise;
  }
}
