// test/db/dailyMetrics.test.ts
import { describe, it, expect } from "vitest";
import { openDb, type Db } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrate";
import { dailyMetrics } from "../../src/db/analyticsQueries";

function db(): Db {
  const d = openDb(":memory:");
  runMigrations(d);
  return d;
}
function addSession(d: Db, id: string) {
  d.prepare(
    `INSERT INTO sessions (id, source, project_path, file_path, file_mtime, file_size,
       created_at, last_active_at, message_count)
     VALUES (?, 'claude', '/p', '/f', 0, 0, 0, 0, 0)`,
  ).run(id);
}
function addTurn(d: Db, o: { id: string; session_id: string; ts: number; out?: number; cacheRead?: number; tin?: number }) {
  d.prepare(
    `INSERT INTO turns (id, session_id, seq, role, model, ts, tokens_in, tokens_out,
       tokens_cache_read, tokens_cache_create, text_len, latency_ms, is_correction)
     VALUES (?, ?, 0, 'assistant', 'claude-sonnet-4-6', ?, ?, ?, ?, 0, 0, NULL, 0)`,
  ).run(o.id, o.session_id, o.ts, o.tin ?? 0, o.out ?? 0, o.cacheRead ?? 0);
}

describe("dailyMetrics", () => {
  it("buckets turns by local day, zero-fills empty days, and computes metrics", () => {
    const d = db();
    addSession(d, "s1");
    addSession(d, "s2");
    const monthStart = new Date(2026, 4, 1, 0, 0, 0).getTime(); // May 2026 local
    const monthEnd = new Date(2026, 5, 1, 0, 0, 0).getTime();   // Jun 1 local
    const MIN = 60_000;
    const may2 = new Date(2026, 4, 2, 9, 0, 0).getTime();
    // May 2: two turns, gap 10m, two sessions
    addTurn(d, { id: "a", session_id: "s1", ts: may2, out: 100, tin: 100, cacheRead: 100 });
    addTurn(d, { id: "b", session_id: "s2", ts: may2 + 10 * MIN, out: 100 });
    const rows = dailyMetrics({ db: d, monthStartMs: monthStart, monthEndMs: monthEnd });

    expect(rows.length).toBe(31); // all of May
    expect(rows[0].day).toBe("2026-05-01");
    expect(rows[0].turns).toBe(0); // zero-filled
    const may2Row = rows.find((r) => r.day === "2026-05-02")!;
    expect(may2Row.turns).toBe(2);
    expect(may2Row.sessions).toBe(2);
    expect(may2Row.activeMs).toBe(10 * MIN);
    expect(may2Row.cost).toBeGreaterThan(0);
    expect(may2Row.costPerTurn).toBeCloseTo(may2Row.cost / 2);
    // cache hit = cacheRead / (tin + cacheRead) over the day = 100 / (100 + 100) = 0.5
    expect(may2Row.cacheHitRate).toBeCloseTo(0.5);
  });

  it("excludes turns outside the month window", () => {
    const d = db();
    addSession(d, "s1");
    const monthStart = new Date(2026, 4, 1).getTime();
    const monthEnd = new Date(2026, 5, 1).getTime();
    addTurn(d, { id: "x", session_id: "s1", ts: new Date(2026, 5, 1, 0, 0, 0).getTime(), out: 100 }); // Jun 1, excluded
    const rows = dailyMetrics({ db: d, monthStartMs: monthStart, monthEndMs: monthEnd });
    expect(rows.every((r) => r.turns === 0)).toBe(true);
  });
});
