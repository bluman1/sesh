import { describe, it, expect } from "vitest";
import {
  extractChunksFromTurns,
  type TurnWithText,
} from "../../src/scanner/chunkExtractor";
import type { TurnRow } from "../../src/db/turns";

function makeTurn(overrides: Partial<TurnRow> & { id: string }): TurnRow {
  return {
    id: overrides.id,
    session_id: overrides.session_id ?? "s1",
    seq: overrides.seq ?? 0,
    role: overrides.role ?? "assistant",
    model: overrides.model ?? null,
    ts: overrides.ts ?? 0,
    tokens_in: overrides.tokens_in ?? 0,
    tokens_out: overrides.tokens_out ?? 0,
    tokens_cache_read: overrides.tokens_cache_read ?? 0,
    tokens_cache_create: overrides.tokens_cache_create ?? 0,
    text_len: overrides.text_len ?? 0,
    latency_ms: overrides.latency_ms ?? null,
    is_correction: overrides.is_correction ?? 0,
  };
}

describe("extractChunksFromTurns", () => {
  it("two turns with short text each → one chunk per turn", () => {
    const turns: TurnWithText[] = [
      { turn: makeTurn({ id: "t1", role: "assistant" }), text: "Hello world" },
      { turn: makeTurn({ id: "t2", role: "user", seq: 1 }), text: "Hi there" },
    ];
    const chunks = extractChunksFromTurns(turns);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].source_id).toBe("t1");
    expect(chunks[0].position).toBe(0);
    expect(chunks[1].source_id).toBe("t2");
    expect(chunks[1].position).toBe(0);
  });

  it("one turn with long text → multiple chunks at sequential positions", () => {
    const longText = "word ".repeat(300); // well over 512 chars
    const turns: TurnWithText[] = [
      { turn: makeTurn({ id: "t1", role: "assistant" }), text: longText },
    ];
    const chunks = extractChunksFromTurns(turns);
    expect(chunks.length).toBeGreaterThan(1);
    // Positions should be sequential starting at 0.
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].position).toBe(i);
    }
  });

  it("empty text produces no chunks", () => {
    const turns: TurnWithText[] = [
      { turn: makeTurn({ id: "t1", role: "assistant" }), text: "" },
    ];
    expect(extractChunksFromTurns(turns)).toHaveLength(0);
  });

  it("whitespace-only text produces no chunks", () => {
    const turns: TurnWithText[] = [
      { turn: makeTurn({ id: "t1", role: "assistant" }), text: "   \n  " },
    ];
    expect(extractChunksFromTurns(turns)).toHaveLength(0);
  });

  it("user-role turn gets source_kind 'user_msg'", () => {
    const turns: TurnWithText[] = [
      {
        turn: makeTurn({ id: "u1", role: "user" }),
        text: "Please help me with something.",
      },
    ];
    const chunks = extractChunksFromTurns(turns);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].source_kind).toBe("user_msg");
  });

  it("assistant-role turn gets source_kind 'turn'", () => {
    const turns: TurnWithText[] = [
      {
        turn: makeTurn({ id: "a1", role: "assistant" }),
        text: "Sure, I can help with that.",
      },
    ];
    const chunks = extractChunksFromTurns(turns);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].source_kind).toBe("turn");
  });

  it("chunk id follows pattern '${turn.id}#${i}'", () => {
    const turns: TurnWithText[] = [
      { turn: makeTurn({ id: "myTurnId", role: "assistant" }), text: "Hello" },
    ];
    const chunks = extractChunksFromTurns(turns);
    expect(chunks[0].id).toBe("myTurnId#0");
  });

  it("chunk id increments for multi-chunk turns", () => {
    const longText = "word ".repeat(300);
    const turns: TurnWithText[] = [
      { turn: makeTurn({ id: "t1", role: "assistant" }), text: longText },
    ];
    const chunks = extractChunksFromTurns(turns);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].id).toBe(`t1#${i}`);
    }
  });

  it("session_id is propagated from turn", () => {
    const turns: TurnWithText[] = [
      {
        turn: makeTurn({ id: "t1", session_id: "session-abc" }),
        text: "test text",
      },
    ];
    const chunks = extractChunksFromTurns(turns);
    expect(chunks[0].session_id).toBe("session-abc");
  });

  it("char_count matches chunk text length", () => {
    const turns: TurnWithText[] = [
      { turn: makeTurn({ id: "t1" }), text: "Short text." },
    ];
    const chunks = extractChunksFromTurns(turns);
    for (const c of chunks) {
      expect(c.char_count).toBe(c.text.length);
    }
  });

  it("uses provided timestamp for created_at", () => {
    const now = 1700000000000;
    const turns: TurnWithText[] = [
      { turn: makeTurn({ id: "t1" }), text: "hello" },
    ];
    const chunks = extractChunksFromTurns(turns, now);
    expect(chunks[0].created_at).toBe(now);
  });

  it("empty turns array returns []", () => {
    expect(extractChunksFromTurns([])).toEqual([]);
  });
});
