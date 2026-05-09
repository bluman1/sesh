export interface Embedder {
  readonly modelName: string;
  readonly dim: number;
  /** Embed a batch of texts. Returned arrays MUST have length === dim each. */
  embed(texts: string[]): Promise<Float32Array[]>;
}

export type EmbedderConfig =
  | { kind: "local"; model?: string }
  | { kind: "ollama"; url?: string; model?: string }
  | { kind: "cloud"; url?: string; apiKey: string; model?: string };
