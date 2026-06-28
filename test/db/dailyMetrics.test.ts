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
function addTurn(
  d: Db,
  o: {
    id: string;
    session_id: string;
    ts: number;
    out?: number;
    cacheRead?: number;
    tin?: number;
    cacheCreate?: number;
  },
) {
  d.prepare(
    `INSERT INTO turns (id, session_id, seq, role, model, ts, tokens_in, tokens_out,
       tokens_cache_read, tokens_cache_create, text_len, latency_ms, is_correction)
     VALUES (?, ?, 0, 'assistant', 'claude-sonnet-4-6', ?, ?, ?, ?, ?, 0, NULL, 0)`,
  ).run(o.id, o.session_id, o.ts, o.tin ?? 0, o.out ?? 0, o.cacheRead ?? 0, o.cacheCreate ?? 0);
}

describe("dailyMetrics", () => {
  it("buckets turns by local day, zero-fills empty days, and computes metrics", () => {
    const d = db();
    addSession(d, "s1");
    addSession(d, "s2");
    const monthStart = new Date(2026, 4, 1, 0, 0, 0).getTime(); // May 2026 local
    const monthEnd = new Date(2026, 5, 1, 0, 0, 0).getTime(); // Jun 1 local
    const MIN = 60_000;
    const may2 = new Date(2026, 4, 2, 9, 0, 0).getTime();
    // May 2: two turns, gap 10m, two sessions
    addTurn(d, { id: "a", session_id: "s1", ts: may2, out: 100, tin: 100, cacheRead: 100 });
    addTurn(d, { id: "b", session_id: "s2", ts: may2 + 10 * MIN, out: 100 });
    const { days } = dailyMetrics({ db: d, monthStartMs: monthStart, monthEndMs: monthEnd });

    expect(days.length).toBe(31); // all of May
    expect(days[0].day).toBe("2026-05-01");
    expect(days[0].turns).toBe(0); // zero-filled
    const may2Row = days.find((r) => r.day === "2026-05-02")!;
    expect(may2Row.turns).toBe(2);
    expect(may2Row.sessions).toBe(2);
    expect(may2Row.activeMs).toBe(10 * MIN);
    expect(may2Row.cost).toBeGreaterThan(0);
    expect(may2Row.costPerTurn).toBeCloseTo(may2Row.cost / 2);
    // cache hit = cacheRead / (tin + cacheRead + cacheCreate) = 100 / (100 + 100 + 0) = 0.5
    expect(may2Row.cacheHitRate).toBeCloseTo(0.5);
  });

  it("includes cache_create in the cache-hit denominator", () => {
    const d = db();
    addSession(d, "s1");
    const monthStart = new Date(2026, 4, 1).getTime();
    const monthEnd = new Date(2026, 5, 1).getTime();
    const may3 = new Date(2026, 4, 3, 12, 0, 0).getTime();
    // read=100, in=0, create=300 → hit = 100 / (0 + 100 + 300) = 0.25
    // (the old buggy formula read/(in+read) would have given 1.0)
    addTurn(d, { id: "c", session_id: "s1", ts: may3, cacheRead: 100, cacheCreate: 300 });
    const { days } = dailyMetrics({ db: d, monthStartMs: monthStart, monthEndMs: monthEnd });
    const may3Row = days.find((r) => r.day === "2026-05-03")!;
    expect(may3Row.cacheHitRate).toBeCloseTo(0.25);
  });

  it("returns a monthly summary: accurate distinct sessions, month-total cache hit, and notable days", () => {
    const d = db();
    addSession(d, "s1");
    addSession(d, "s2");
    const monthStart = new Date(2026, 4, 1).getTime();
    const monthEnd = new Date(2026, 5, 1).getTime();
    const at = (day: number, h: number) => new Date(2026, 4, day, h, 0, 0).getTime();
    // s1 spans two days (May 2 and May 4) — must count once in the month total.
    addTurn(d, { id: "a", session_id: "s1", ts: at(2, 9), cacheRead: 300, tin: 100 }); // hit 0.75
    addTurn(d, { id: "b", session_id: "s1", ts: at(4, 9), cacheRead: 0, tin: 100, cacheCreate: 300 }); // hit 0.0
    addTurn(d, { id: "c", session_id: "s2", ts: at(4, 10), cacheRead: 0, tin: 100 }); // hit 0.0
    const { summary } = dailyMetrics({ db: d, monthStartMs: monthStart, monthEndMs: monthEnd });

    expect(summary.totalTurns).toBe(3);
    expect(summary.totalSessions).toBe(2); // distinct, not 1 (May2) + 2 (May4) = 3
    // month cache hit = read / cacheable
    //   = 300 / ((100+300+0) + (100+0+300) + (100+0+0)) = 300 / 900 = 0.333
    expect(summary.cacheHitRate).toBeCloseTo(1 / 3);
    expect(summary.topTurnsDay?.day).toBe("2026-05-04"); // 2 turns vs 1
    expect(summary.bestCacheDay?.day).toBe("2026-05-02"); // 0.75 best
  });

  it("summary notable days are null when the month is empty", () => {
    const d = db();
    const monthStart = new Date(2026, 4, 1).getTime();
    const monthEnd = new Date(2026, 5, 1).getTime();
    const { summary } = dailyMetrics({ db: d, monthStartMs: monthStart, monthEndMs: monthEnd });
    expect(summary.totalTurns).toBe(0);
    expect(summary.totalSessions).toBe(0);
    expect(summary.cacheHitRate).toBe(0);
    expect(summary.topCostDay).toBeNull();
    expect(summary.bestCacheDay).toBeNull();
  });

  it("excludes turns outside the month window", () => {
    const d = db();
    addSession(d, "s1");
    const monthStart = new Date(2026, 4, 1).getTime();
    const monthEnd = new Date(2026, 5, 1).getTime();
    addTurn(d, { id: "x", session_id: "s1", ts: new Date(2026, 5, 1, 0, 0, 0).getTime(), out: 100 }); // Jun 1, excluded
    const { days } = dailyMetrics({ db: d, monthStartMs: monthStart, monthEndMs: monthEnd });
    expect(days.every((r) => r.turns === 0)).toBe(true);
  });
});
