import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { extractCodexMetadata } from "../../../src/scanner/codex/extract";

const FIXTURE = path.join(
  __dirname,
  "..",
  "..",
  "fixtures",
  "codex",
  "sample.jsonl",
);

describe("extractCodexMetadata", () => {
  it("pulls cwd from session_meta", async () => {
    const meta = await extractCodexMetadata(FIXTURE);
    expect(meta.cwd).toBe("/Users/test/proj");
  });

  it("counts user + assistant messages, ignoring reasoning + tool records", async () => {
    const meta = await extractCodexMetadata(FIXTURE);
    // developer-role message + user(env_context) + user(real prompt) + 2x assistant = 5
    // (developer role is not user/assistant so it's filtered, leaving 4)
    expect(meta.message_count).toBe(4);
  });

  it("uses My request for Codex heading as auto_title source when present", async () => {
    const meta = await extractCodexMetadata(FIXTURE);
    expect(meta.auto_title).toBe("Run the build for me");
  });

  it("captures created_at and last_active_at from timestamps", async () => {
    const meta = await extractCodexMetadata(FIXTURE);
    expect(meta.created_at).toBe(
      new Date("2026-04-04T10:00:00.000Z").getTime(),
    );
    expect(meta.last_active_at).toBe(
      new Date("2026-04-04T10:00:09.000Z").getTime(),
    );
  });

  it("reads token usage from the latest token_count event_msg", async () => {
    const meta = await extractCodexMetadata(FIXTURE);
    // Sample fixture has no token_count events → all zero.
    expect(meta.tokens.tokens_in).toBe(0);
    expect(meta.tokens.tokens_out).toBe(0);
    expect(meta.tokens.tokens_cache_read).toBe(0);
    expect(meta.tokens.tokens_cache_create).toBe(0);
  });

  it("aggregates Codex token_count, subtracting cached from input", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const tmp = path.join(
      os.tmpdir(),
      `sesh-codex-tokens-${Date.now()}.jsonl`,
    );
    fs.writeFileSync(
      tmp,
      [
        JSON.stringify({
          timestamp: "2026-04-04T10:00:00.000Z",
          type: "session_meta",
          payload: { cwd: "/tmp/p", id: "x" },
        }),
        // First token_count — should be replaced by the next
        JSON.stringify({
          timestamp: "2026-04-04T10:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 100,
                cached_input_tokens: 30,
                output_tokens: 50,
                reasoning_output_tokens: 10,
              },
            },
          },
        }),
        // Latest — wins
        JSON.stringify({
          timestamp: "2026-04-04T10:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 500,
                cached_input_tokens: 200,
                output_tokens: 80,
                reasoning_output_tokens: 25,
              },
            },
          },
        }),
      ].join("\n") + "\n",
    );
    try {
      const meta = await extractCodexMetadata(tmp);
      // tokens_in = input_tokens (500) - cached_input_tokens (200) = 300
      // tokens_out = output_tokens (80) + reasoning_output_tokens (25) = 105
      expect(meta.tokens.tokens_in).toBe(300);
      expect(meta.tokens.tokens_out).toBe(105);
      expect(meta.tokens.tokens_cache_read).toBe(200);
      expect(meta.tokens.tokens_cache_create).toBe(0);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("throws when session_meta has no cwd", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const tmp = path.join(os.tmpdir(), `sesh-codex-no-cwd-${Date.now()}.jsonl`);
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        timestamp: "2026-04-04T10:00:00.000Z",
        type: "session_meta",
        payload: { id: "abc" },
      }) + "\n",
    );
    try {
      await expect(extractCodexMetadata(tmp)).rejects.toThrow(
        /no session_meta cwd/,
      );
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
