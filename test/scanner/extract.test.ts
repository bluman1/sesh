import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  extractMetadata,
  truncateGraphemes,
} from "../../src/scanner/extract";

const FIXTURE = path.join(__dirname, "..", "fixtures", "sample.jsonl");
const LONG_PROMPT = path.join(__dirname, "..", "fixtures", "long-prompt.jsonl");
const NO_CWD = path.join(__dirname, "..", "fixtures", "no-cwd.jsonl");
const SYSTEM_REMINDER_PROMPT = path.join(
  __dirname,
  "..",
  "fixtures",
  "system-reminder-prompt.jsonl",
);
const ALL_SYSTEM_PROMPT = path.join(
  __dirname,
  "..",
  "fixtures",
  "all-system-prompt.jsonl",
);
const IDE_OPENED_FILE_PROMPT = path.join(
  __dirname,
  "..",
  "fixtures",
  "ide-opened-file-prompt.jsonl",
);
const EMOJI_PROMPT = path.join(
  __dirname,
  "..",
  "fixtures",
  "emoji-prompt.jsonl",
);

function graphemeCount(s: string): number {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof Intl.Segmenter !== "function") return s.length;
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].length;
}

describe("extractMetadata", () => {
  it("extracts cwd, auto_title, timestamps, and message count", async () => {
    const meta = await extractMetadata(FIXTURE, "sample-id");
    expect(meta.cwd).toBe("/tmp/proj");
    expect(meta.auto_title).toBe("first prompt");
    expect(meta.created_at).toBe(new Date("2026-04-21T08:47:11.844Z").getTime());
    expect(meta.last_active_at).toBe(new Date("2026-04-21T08:50:00.000Z").getTime());
    expect(meta.message_count).toBeGreaterThanOrEqual(3);
  });

  it("truncates auto_title to 80 chars", async () => {
    const meta = await extractMetadata(LONG_PROMPT, "long-id");
    expect(meta.auto_title?.length).toBe(80);
    expect(meta.auto_title?.startsWith("This is a very long")).toBe(true);
  });

  it("falls back to decoded dirname when cwd missing", async () => {
    const meta = await extractMetadata(NO_CWD, "no-cwd-id", {
      fallbackEncodedDir: "-tmp-otherproj",
    });
    expect(meta.cwd).toBe("/tmp/otherproj");
  });

  it("throws when neither cwd nor fallbackEncodedDir is available", async () => {
    await expect(extractMetadata(NO_CWD, "no-cwd-id")).rejects.toThrow(
      /no cwd in JSONL and no fallbackEncodedDir/,
    );
  });

  it("strips system-reminder blocks from auto_title", async () => {
    const meta = await extractMetadata(SYSTEM_REMINDER_PROMPT, "sr-id");
    expect(meta.auto_title).toBe("actual prompt here");
  });

  it("falls through to next user record when first is only system tags", async () => {
    const meta = await extractMetadata(ALL_SYSTEM_PROMPT, "all-sys-id");
    expect(meta.auto_title).toBe("real first prompt");
  });

  it("strips ide_opened_file blocks from auto_title", async () => {
    const meta = await extractMetadata(IDE_OPENED_FILE_PROMPT, "ide-id");
    expect(meta.auto_title).toBe("Fix the typo in the README");
  });

  it("truncates auto_title at grapheme boundary, not surrogate-pair midpoint", async () => {
    const meta = await extractMetadata(EMOJI_PROMPT, "emoji-id");
    expect(meta.auto_title).toBeTruthy();
    // Each emoji occupies 2 UTF-16 code units, so .slice(0, 80) without
    // grapheme-awareness would split a surrogate pair right at the boundary.
    expect(graphemeCount(meta.auto_title!)).toBe(80);
    // Encoding/decoding should round-trip — broken surrogate halves would
    // turn into U+FFFD replacement chars.
    expect(meta.auto_title!.includes("�")).toBe(false);
  });
});

describe("extractMetadata token + ai-title fields", () => {
  it("aggregates assistant.message.usage across the session", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const tmp = path.join(os.tmpdir(), `sesh-extract-tokens-${Date.now()}.jsonl`);
    fs.writeFileSync(
      tmp,
      [
        JSON.stringify({
          type: "user",
          cwd: "/tmp/p",
          message: { role: "user", content: "go" },
          timestamp: "2026-05-01T10:00:00.000Z",
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: "ok",
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_read_input_tokens: 1000,
              cache_creation_input_tokens: 200,
            },
          },
          timestamp: "2026-05-01T10:00:01.000Z",
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: "more",
            usage: {
              input_tokens: 300,
              output_tokens: 75,
              cache_read_input_tokens: 1100,
              cache_creation_input_tokens: 0,
            },
          },
          timestamp: "2026-05-01T10:00:02.000Z",
        }),
      ].join("\n") + "\n",
    );
    try {
      const meta = await extractMetadata(tmp, "tok-id");
      expect(meta.tokens.tokens_in).toBe(400);
      expect(meta.tokens.tokens_out).toBe(125);
      expect(meta.tokens.tokens_cache_read).toBe(2100);
      expect(meta.tokens.tokens_cache_create).toBe(200);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("prefers ai-title records over the first user prompt", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const tmp = path.join(os.tmpdir(), `sesh-extract-aititle-${Date.now()}.jsonl`);
    fs.writeFileSync(
      tmp,
      [
        JSON.stringify({
          type: "user",
          cwd: "/tmp/p",
          message: { role: "user", content: "raw first prompt with lots of noise" },
          timestamp: "2026-05-01T10:00:00.000Z",
        }),
        JSON.stringify({
          type: "ai-title",
          aiTitle: "Refactor the auth middleware",
          sessionId: "x",
        }),
      ].join("\n") + "\n",
    );
    try {
      const meta = await extractMetadata(tmp, "ai-title-id");
      expect(meta.auto_title).toBe("Refactor the auth middleware");
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("falls back to stripped first prompt when no ai-title is present", async () => {
    const meta = await extractMetadata(FIXTURE, "sample-id");
    // Sample fixture has no ai-title record, so we should fall back to the
    // existing behavior (first user message).
    expect(meta.auto_title).toBe("first prompt");
  });

  it("returns zero tokens for a session with only user messages", async () => {
    const meta = await extractMetadata(FIXTURE, "sample-id");
    // sample fixture has one assistant reply but no usage object
    expect(meta.tokens.tokens_in).toBe(0);
    expect(meta.tokens.tokens_out).toBe(0);
    expect(meta.tokens.tokens_cache_read).toBe(0);
    expect(meta.tokens.tokens_cache_create).toBe(0);
  });
});

describe("truncateGraphemes", () => {
  it("returns input unchanged when shorter than max", () => {
    expect(truncateGraphemes("hello", 10)).toBe("hello");
  });

  it("respects grapheme clusters for emoji", () => {
    expect(truncateGraphemes("🚀🎉🔥", 2)).toBe("🚀🎉");
  });

  it("respects combining marks (a + acute = one grapheme)", () => {
    // "é" written as e + combining acute accent (U+0065 + U+0301)
    const composed = "café"; // 5 code units, 4 graphemes
    expect(truncateGraphemes(composed, 4)).toBe(composed);
    expect(truncateGraphemes(composed, 3)).toBe("caf");
  });

  it("returns empty string when max is zero", () => {
    expect(truncateGraphemes("hello", 0)).toBe("");
  });
});
