import { describe, it, expect } from "vitest";
import { createEmbedder } from "../../src/embed/factory";
import { XenovaEmbedder } from "../../src/embed/xenovaEmbedder";
import { OllamaEmbedder } from "../../src/embed/ollamaEmbedder";
import { CloudEmbedder } from "../../src/embed/cloudEmbedder";

describe("createEmbedder", () => {
  it("returns XenovaEmbedder for kind=local", () => {
    const e = createEmbedder({ kind: "local" });
    expect(e).toBeInstanceOf(XenovaEmbedder);
  });

  it("returns XenovaEmbedder with custom model for kind=local", () => {
    const e = createEmbedder({ kind: "local", model: "custom/model" });
    expect(e).toBeInstanceOf(XenovaEmbedder);
    expect(e.modelName).toBe("custom/model");
  });

  it("returns OllamaEmbedder for kind=ollama", () => {
    const e = createEmbedder({ kind: "ollama" });
    expect(e).toBeInstanceOf(OllamaEmbedder);
  });

  it("returns OllamaEmbedder with custom url+model for kind=ollama", () => {
    const e = createEmbedder({ kind: "ollama", url: "http://remote:11434", model: "mxbai-embed-large" });
    expect(e).toBeInstanceOf(OllamaEmbedder);
    expect(e.modelName).toBe("mxbai-embed-large");
  });

  it("returns CloudEmbedder for kind=cloud", () => {
    const e = createEmbedder({ kind: "cloud", apiKey: "k" });
    expect(e).toBeInstanceOf(CloudEmbedder);
  });

  it("returns CloudEmbedder with custom url+model+apiKey for kind=cloud", () => {
    const e = createEmbedder({ kind: "cloud", url: "https://my.api/embed", apiKey: "secret", model: "embed-v3" });
    expect(e).toBeInstanceOf(CloudEmbedder);
    expect(e.modelName).toBe("embed-v3");
  });
});
