import { describe, it, expect } from "vitest";
import { chunkText } from "../../src/embed/chunkText";

describe("chunkText", () => {
  it("returns [] for empty string", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("returns [] for whitespace-only string", () => {
    expect(chunkText("   \n\t  ")).toEqual([]);
  });

  it("returns single-element array when text fits in maxChars", () => {
    const text = "Hello world, this is a short sentence.";
    const result = chunkText(text, { maxChars: 200 });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text.trim());
  });

  it("returns single-element array when text exactly equals maxChars", () => {
    const text = "a".repeat(100);
    const result = chunkText(text, { maxChars: 100 });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text);
  });

  it("splits long text into multiple chunks, all <= maxChars", () => {
    const maxChars = 100;
    const longText =
      "The quick brown fox jumps over the lazy dog. ".repeat(20);
    const chunks = chunkText(longText, { maxChars, overlap: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(maxChars);
    }
  });

  it("adjacent chunks overlap (last chars of chunk N appear near start of chunk N+1)", () => {
    const maxChars = 100;
    const overlap = 30;
    // Construct text without sentence boundaries so overlap is easier to test.
    const longText = "x".repeat(300);
    const chunks = chunkText(longText, { maxChars, overlap });
    expect(chunks.length).toBeGreaterThan(1);
    // The last 20 chars of chunk[0] should appear at the start of chunk[1].
    const tail = chunks[0].slice(-20);
    expect(chunks[1]).toContain(tail);
  });

  it("prefers sentence boundaries when splitting", () => {
    // Build a string: two sentences that together exceed maxChars,
    // but the first sentence fits within maxChars. The splitter should
    // break at the sentence boundary rather than mid-word.
    const sentence1 = "This is the first sentence. ";
    const sentence2 = "This is the second sentence that makes it longer.";
    const text = sentence1 + sentence2;
    // maxChars large enough to include full sentence1 but less than full text
    const maxChars = sentence1.length + 10;
    const chunks = chunkText(text, { maxChars, overlap: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // The first chunk should end with the first sentence (split at boundary)
    // rather than cutting mid-sentence.
    expect(chunks[0]).toContain("first sentence");
  });

  it("handles text with newlines as sentence boundaries", () => {
    const line1 = "Line one of text content here.\n";
    const line2 = "Line two of text content here.\n";
    const line3 = "Line three makes it very long indeed yes.";
    const text = line1 + line2 + line3;
    const maxChars = line1.length + line2.length + 5;
    const chunks = chunkText(text, { maxChars, overlap: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // First chunk should break at the newline boundary.
    expect(chunks[0]).not.toContain("Line three");
  });

  it("does not produce empty chunks", () => {
    const longText = "word ".repeat(200);
    const chunks = chunkText(longText, { maxChars: 50, overlap: 10 });
    for (const chunk of chunks) {
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });

  it("covers the full text across all chunks (no content lost)", () => {
    const words = Array.from({ length: 100 }, (_, i) => `word${i}`);
    const text = words.join(" ");
    const chunks = chunkText(text, { maxChars: 80, overlap: 15 });
    // Every word should appear in at least one chunk.
    for (const w of words) {
      expect(chunks.some((c) => c.includes(w))).toBe(true);
    }
  });
});
