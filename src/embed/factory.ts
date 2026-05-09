import type { Embedder, EmbedderConfig } from "./types";
import { XenovaEmbedder } from "./xenovaEmbedder";
import { OllamaEmbedder } from "./ollamaEmbedder";
import { CloudEmbedder } from "./cloudEmbedder";

export function createEmbedder(cfg: EmbedderConfig): Embedder {
  switch (cfg.kind) {
    case "local":
      return new XenovaEmbedder(cfg.model);
    case "ollama":
      return new OllamaEmbedder(cfg.url, cfg.model);
    case "cloud":
      return new CloudEmbedder(cfg.url, cfg.apiKey, cfg.model);
  }
}
