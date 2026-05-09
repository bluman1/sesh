import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { extractTurns } from "../../src/scanner/extractTurns";

const FIXTURE = path.join(__dirname, "..", "fixtures", "turns-sample.jsonl");

describe("extractTurns", () => {
  it("extracts user and assistant turns with seq, ts, role", async () => {
    const result = await extractTurns(FIXTURE, "s-fixture");
    const ids = result.turns.map((t) => t.id);
    expect(ids).toEqual(["u1", "a1", "u2", "a2"]);
    expect(result.turns[0].role).toBe("user");
    expect(result.turns[1].role).toBe("assistant");
    expect(result.turns[0].seq).toBe(0);
    expect(result.turns[3].seq).toBe(3);
  });

  it("extracts model and tokens for assistant turns", async () => {
    const result = await extractTurns(FIXTURE, "s-fixture");
    const a1 = result.turns.find((t) => t.id === "a1")!;
    expect(a1.model).toBe("claude-opus-4-7");
    expect(a1.tokens_in).toBe(100);
    expect(a1.tokens_out).toBe(50);
    expect(a1.tokens_cache_create).toBe(10);
  });

  it("user turns have null model and zero tokens", async () => {
    const result = await extractTurns(FIXTURE, "s-fixture");
    const u1 = result.turns.find((t) => t.id === "u1")!;
    expect(u1.model).toBeNull();
    expect(u1.tokens_in).toBe(0);
  });

  it("computes latency_ms as gap from previous turn (null for first)", async () => {
    const result = await extractTurns(FIXTURE, "s-fixture");
    expect(result.turns[0].latency_ms).toBeNull();
    expect(result.turns[1].latency_ms).toBe(5000);
    expect(result.turns[3].latency_ms).toBe(5000);
  });

  it("flags is_correction on user turns starting with rejection markers", async () => {
    const result = await extractTurns(FIXTURE, "s-fixture");
    const u2 = result.turns.find((t) => t.id === "u2")!;
    expect(u2.is_correction).toBe(1);
  });

  it("extracts tool_calls with target_path from Edit input", async () => {
    const result = await extractTurns(FIXTURE, "s-fixture");
    expect(result.toolCalls.length).toBe(1);
    const tc = result.toolCalls[0];
    expect(tc.id).toBe("tu1");
    expect(tc.turn_id).toBe("a1");
    expect(tc.name).toBe("Edit");
    expect(tc.target_path).toBe("/p/a.ts");
  });

  it("computes text_len from joined block text", async () => {
    const result = await extractTurns(FIXTURE, "s-fixture");
    const a1 = result.turns.find((t) => t.id === "a1")!;
    expect(a1.text_len).toBe("reply text".length);
  });
});
