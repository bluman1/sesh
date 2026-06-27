# Insights: Custom Date Ranges, Monthly Trends Chart, Active-Time Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a custom start–end date range to the Insights sub-tabs, add a "Trends" sub-tab with a month navigator and a switchable daily bar chart (cost, sessions, turns, active time, cache hit, $/turn), and fix the broken "active time" metric.

**Architecture:** All heavy logic lives in the backend (`src/`, covered by vitest): a pure `activeMsFromTimestamps` helper, new optional `until` upper bounds on existing analytics queries, and a new `dailyMetrics` query that buckets a month's turns into local calendar days. The webview is presentation only (React, no unit-test harness): a custom-range control, a new `TrendsView` with a hand-rolled SVG bar chart, and an updated Standup hero. Messaging stays mirrored between `src/messaging.ts` and `webview/src/messaging.ts`.

**Tech Stack:** TypeScript, node:sqlite (via `src/db/connection.ts`), vitest (root, tests under `test/**`, run with the repo's `npx vitest run`), React 18 + Vite (webview), esbuild (extension bundle).

## Global Constraints

- node:sqlite only via `openDb`/`Db` from `src/db/connection.ts`; never import a SQL driver directly. (See `src/node-sqlite.d.ts`.)
- `src/messaging.ts` and `webview/src/messaging.ts` are byte-identical for shared message types and MUST be edited in lockstep.
- No new runtime dependencies; charts are hand-rolled SVG using existing theme tokens (`--vscode-charts-*`, `--sesh-*` in `webview/src/styles.css`).
- No DB schema/migration changes. `turns.ts` is per-turn UNIX **milliseconds** (indexed `idx_turns_ts`).
- Cost is computed with `usdForTurn` + `MODEL_PRICING` in `src/db/analyticsQueries.ts` (do not reimplement pricing).
- Idle cap constant = 30 minutes. Daily buckets and custom date bounds use the host's **local** timezone. Custom end-date is inclusive end-of-day. Cross-midnight active gaps attribute to the earlier day.
- Run backend tests with `npx vitest run <path>` from `sesh/`. Typecheck with `npx tsc --noEmit -p tsconfig.json`. Build webview with `npm run build:webview`; bundle with `npm run build:extension`.

## File Structure

- **Create** `src/db/activeTime.ts` — `ACTIVE_IDLE_CAP_MS`, `activeMsFromTimestamps()`. One responsibility: turn timestamps → active duration.
- **Create** `test/db/activeTime.test.ts`, `test/db/dailyMetrics.test.ts`.
- **Modify** `src/db/analyticsQueries.ts` — `standupSummary` returns `activeMs` (not `activeHours`); add optional `until` to `standupSummary`/`costByFile`/`modelLeaderboard`/`sessionsForFile`; add `dailyMetrics()` + `DailyMetric`.
- **Modify** `test/db/analyticsQueries.test.ts` (and any standup/costByFile tests) — `activeMs`, `until` filtering.
- **Modify** `src/messaging.ts` + `webview/src/messaging.ts` — custom `getInsights` variant; `getDailyMetrics`/`dailyMetrics` pair.
- **Modify** `src/host/seshPanel.ts` — custom-range branch in the `getInsights` handler; new `getDailyMetrics` handler.
- **Modify** `webview/src/components/insights/range.ts` — custom-range types/helpers.
- **Modify** `webview/src/hooks/useInsights.ts` — carry custom start/end.
- **Modify** `webview/src/components/InsightsTab.tsx` — custom-range UI + "Trends" sub-tab entry.
- **Create** `webview/src/hooks/useDailyMetrics.ts`.
- **Create** `webview/src/components/insights/TrendsView.tsx` + `TrendsView.css`.
- **Modify** `webview/src/components/insights/StandupView.tsx` — render active **duration** instead of a time-of-day window.

**Webview verification note:** the repo's vitest only covers `src/**` (tests in `test/**`). The webview has no unit-test harness, so webview tasks are verified by `npx tsc --noEmit` + `npm run build:webview` + the manual checklist in Task 9. Keep all testable logic in the backend.

---

### Task 1: Active-time helper (pure, TDD)

**Files:**
- Create: `src/db/activeTime.ts`
- Test: `test/db/activeTime.test.ts`

**Interfaces:**
- Produces: `ACTIVE_IDLE_CAP_MS: number` (= 1_800_000) and `activeMsFromTimestamps(tsMs: number[], capMs?: number): number`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/db/activeTime.test.ts
import { describe, it, expect } from "vitest";
import { activeMsFromTimestamps, ACTIVE_IDLE_CAP_MS } from "../../src/db/activeTime";

const MIN = 60_000;

describe("activeMsFromTimestamps", () => {
  it("returns 0 for empty or single-turn input", () => {
    expect(activeMsFromTimestamps([])).toBe(0);
    expect(activeMsFromTimestamps([1_000])).toBe(0);
  });

  it("sums consecutive gaps that are within the cap", () => {
    const base = 1_000_000;
    // gaps: 10m, 15m  -> 25m
    const ts = [base, base + 10 * MIN, base + 25 * MIN];
    expect(activeMsFromTimestamps(ts)).toBe(25 * MIN);
  });

  it("excludes gaps larger than the cap (stepped away)", () => {
    const base = 1_000_000;
    // gaps: 10m, 90m(skip), 5m -> 15m
    const ts = [base, base + 10 * MIN, base + 100 * MIN, base + 105 * MIN];
    expect(activeMsFromTimestamps(ts)).toBe(15 * MIN);
  });

  it("counts a gap exactly equal to the cap", () => {
    const base = 1_000_000;
    expect(activeMsFromTimestamps([base, base + 30 * MIN])).toBe(30 * MIN);
  });

  it("sorts unsorted input before summing", () => {
    const base = 1_000_000;
    const ts = [base + 25 * MIN, base, base + 10 * MIN];
    expect(activeMsFromTimestamps(ts)).toBe(25 * MIN);
  });

  it("respects a custom cap", () => {
    const base = 1_000_000;
    // gap 20m, cap 15m -> excluded
    expect(activeMsFromTimestamps([base, base + 20 * MIN], 15 * MIN)).toBe(0);
  });

  it("exposes a 30-minute default cap", () => {
    expect(ACTIVE_IDLE_CAP_MS).toBe(30 * MIN);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/db/activeTime.test.ts`
Expected: FAIL — cannot find module `../../src/db/activeTime`.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// src/db/activeTime.ts
/** Idle cap: gaps between turns longer than this count as "stepped away". */
export const ACTIVE_IDLE_CAP_MS = 30 * 60_000;

/**
 * Estimate active working time from turn timestamps (UNIX ms): sum each
 * consecutive gap that is <= capMs. Gaps over the cap are excluded; a single
 * turn or empty input is 0. Input may be unsorted.
 */
export function activeMsFromTimestamps(
  tsMs: number[],
  capMs: number = ACTIVE_IDLE_CAP_MS,
): number {
  if (tsMs.length < 2) return 0;
  const sorted = [...tsMs].sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap <= capMs) total += gap;
  }
  return total;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/db/activeTime.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/activeTime.ts test/db/activeTime.test.ts
git commit -m "feat(db): add activeMsFromTimestamps helper (gap-based active time)"
```

---

### Task 2: standupSummary returns activeMs (bug fix)

**Files:**
- Modify: `src/db/analyticsQueries.ts` (`StandupSummary` interface ~334-351; `standupSummary` body — `firstTs`/`lastTs` tracking ~411-412 and the returned object ~541-543)
- Test: `test/db/analyticsQueries.test.ts` (standup-related tests)

**Interfaces:**
- Consumes: `activeMsFromTimestamps` from Task 1.
- Produces: `StandupSummary.activeMs: number` replaces `StandupSummary.activeHours`.

- [ ] **Step 1: Write the failing test** (add to the standup describe block in `test/db/analyticsQueries.test.ts`; reuse that file's existing DB/seed helpers — read the file first to match its fixture style)

```typescript
it("reports activeMs as gap-based active time, capping idle", () => {
  const db = makeDb(); // existing helper in this test file
  const MIN = 60_000;
  const base = Date.now() - 60 * MIN;
  // three turns: gaps 10m then 90m(skip) — active = 10m
  seedTurn(db, { id: "t1", session_id: "s1", ts: base, model: "claude-sonnet-4-6" });
  seedTurn(db, { id: "t2", session_id: "s1", ts: base + 10 * MIN, model: "claude-sonnet-4-6" });
  seedTurn(db, { id: "t3", session_id: "s1", ts: base + 100 * MIN, model: "claude-sonnet-4-6" });
  const out = standupSummary({ db, since: 0 });
  expect(out.activeMs).toBe(10 * MIN);
  // @ts-expect-error activeHours is removed
  expect(out.activeHours).toBeUndefined();
});
```

(If the test file has no `seedTurn`/`makeDb`, add a local helper that inserts a `sessions` row and `turns` rows directly with `db.prepare(...).run(...)`, matching the `turns` columns: `id, session_id, seq, role, model, ts, tokens_in, tokens_out, tokens_cache_read, tokens_cache_create, text_len, latency_ms, is_correction`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/db/analyticsQueries.test.ts`
Expected: FAIL — `out.activeMs` is `undefined` / type error on `activeMs`.

- [ ] **Step 3: Implement**

In `src/db/analyticsQueries.ts`:
1. Add import at top: `import { activeMsFromTimestamps } from "./activeTime";`
2. In the `StandupSummary` interface, replace the line `activeHours: { firstTs: number; lastTs: number } | null;` with `activeMs: number;`.
3. In `standupSummary`, collect turn timestamps and compute active time. Where `firstTs`/`lastTs` are declared and updated in the turn loop (~411-412), instead push `r.ts` into an array:

```typescript
const turnTimestamps: number[] = [];
// ...inside the `for (const r of turnRows)` loop, replace the firstTs/lastTs lines with:
turnTimestamps.push(r.ts);
```

4. In the returned object, replace `activeHours: firstTs !== null && lastTs !== null ? { firstTs, lastTs } : null,` with:

```typescript
activeMs: activeMsFromTimestamps(turnTimestamps),
```

5. Remove now-unused `firstTs`/`lastTs` declarations.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/db/analyticsQueries.test.ts`
Expected: PASS. Fix any sibling standup tests that referenced `activeHours` (update them to `activeMs`).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.json` (expect 0 errors from this file; `StandupView.tsx` is fixed in Task 8 — if tsc flags it now, leave it; webview tsc is separate and built in Task 8). 

```bash
git add src/db/analyticsQueries.ts test/db/analyticsQueries.test.ts
git commit -m "fix(insights): compute standup active time as gap-based duration (activeMs)"
```

---

### Task 3: Optional `until` upper bound on time-filtered queries

**Files:**
- Modify: `src/db/analyticsQueries.ts` — `standupSummary` (`StandupOpts`), `costByFile`, `modelLeaderboard`, `sessionsForFile`
- Test: `test/db/analyticsQueries.test.ts`

**Interfaces:**
- Produces: each of these gains an optional `until?: number` (inclusive upper bound on the timestamp used for filtering). When omitted, behavior is unchanged.

- [ ] **Step 1: Write the failing test**

```typescript
it("standupSummary excludes turns after `until`", () => {
  const db = makeDb();
  const day = 86_400_000;
  const base = 1_700_000_000_000;
  seedSession(db, { id: "s1", project_path: "/p", last_active_at: base });
  seedTurn(db, { id: "t1", session_id: "s1", ts: base, model: "claude-sonnet-4-6", tokens_out: 100 });
  seedTurn(db, { id: "t2", session_id: "s1", ts: base + 2 * day, model: "claude-sonnet-4-6", tokens_out: 100 });
  const all = standupSummary({ db, since: base });
  const bounded = standupSummary({ db, since: base, until: base + day });
  expect(all.totalTurns).toBe(2);
  expect(bounded.totalTurns).toBe(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/db/analyticsQueries.test.ts`
Expected: FAIL — `until` not honored (bounded.totalTurns === 2).

- [ ] **Step 3: Implement** (read each function first; apply the same pattern)

For `StandupOpts` add `until?: number;`. In `standupSummary`, thread `until` into both the sessions and turns queries. Example for the turns query — change the SQL to conditionally add an upper bound and bind it:

```typescript
const { db, since, until, priorRange } = opts;
const turnSql =
  `SELECT t.model, t.tokens_in, t.tokens_out, t.tokens_cache_read,
          t.tokens_cache_create, t.is_correction, t.ts, s.project_path
     FROM turns t JOIN sessions s ON s.id = t.session_id
    WHERE t.ts >= ?` + (until != null ? " AND t.ts <= ?" : "");
const turnRows = db.prepare(turnSql).all(...(until != null ? [since, until] : [since])) as /* same row type */;
```

Apply the equivalent change to the sessions query (`last_active_at >= ?` → add `AND last_active_at <= ?`).

For `costByFile` (filters `tc.ts >= ?`), `modelLeaderboard` (`ts >= ?`), `sessionsForFile` (`tc.ts >= ?`): add `until?: number` to their opts, append `AND <tsCol> <= ?` when provided, and bind `until`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/db/analyticsQueries.test.ts`
Expected: PASS (existing tests unchanged since `until` is optional).

- [ ] **Step 5: Commit**

```bash
git add src/db/analyticsQueries.ts test/db/analyticsQueries.test.ts
git commit -m "feat(insights): optional `until` upper bound on analytics queries (custom ranges)"
```

---

### Task 4: `dailyMetrics` query + `DailyMetric` type

**Files:**
- Modify: `src/db/analyticsQueries.ts` — add `DailyMetric` + `dailyMetrics()`
- Test: `test/db/dailyMetrics.test.ts`

**Interfaces:**
- Consumes: `usdForTurn` (existing), `activeMsFromTimestamps` (Task 1).
- Produces:
  ```typescript
  export interface DailyMetric {
    day: string;          // "YYYY-MM-DD", local
    cost: number;
    sessions: number;
    turns: number;
    activeMs: number;
    cacheHitRate: number; // 0..1, 0 when denom 0
    costPerTurn: number;  // 0 when 0 turns
  }
  export function dailyMetrics(opts: { db: Db; monthStartMs: number; monthEndMs: number }): DailyMetric[];
  ```
  Returns one entry per local calendar day in `[monthStartMs, monthEndMs)`, zero-filled, ascending by `day`.

- [ ] **Step 1: Write the failing test** (timestamps built with `new Date(y, m, d, h)` so construction and bucketing share the machine's local tz — deterministic on any CI)

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/db/dailyMetrics.test.ts`
Expected: FAIL — `dailyMetrics` is not exported.

- [ ] **Step 3: Implement** (add to `src/db/analyticsQueries.ts`)

```typescript
function localDayKey(tsMs: number): string {
  const d = new Date(tsMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface DailyMetric {
  day: string;
  cost: number;
  sessions: number;
  turns: number;
  activeMs: number;
  cacheHitRate: number;
  costPerTurn: number;
}

export function dailyMetrics(opts: {
  db: Db;
  monthStartMs: number;
  monthEndMs: number;
}): DailyMetric[] {
  const { db, monthStartMs, monthEndMs } = opts;
  const rows = db
    .prepare(
      `SELECT model, tokens_in, tokens_out, tokens_cache_read, tokens_cache_create,
              session_id, ts
         FROM turns
        WHERE ts >= ? AND ts < ?
        ORDER BY ts ASC`,
    )
    .all(monthStartMs, monthEndMs) as {
    model: string | null;
    tokens_in: number;
    tokens_out: number;
    tokens_cache_read: number;
    tokens_cache_create: number;
    session_id: string;
    ts: number;
  }[];

  type Acc = {
    cost: number; turns: number; sessions: Set<string>;
    ts: number[]; cacheRead: number; cacheable: number;
  };
  const byDay = new Map<string, Acc>();
  for (const r of rows) {
    const key = localDayKey(r.ts);
    let a = byDay.get(key);
    if (!a) { a = { cost: 0, turns: 0, sessions: new Set(), ts: [], cacheRead: 0, cacheable: 0 }; byDay.set(key, a); }
    a.cost += usdForTurn(r);
    a.turns += 1;
    a.sessions.add(r.session_id);
    a.ts.push(r.ts);
    a.cacheRead += r.tokens_cache_read;
    a.cacheable += r.tokens_in + r.tokens_cache_read;
  }

  // Zero-fill every local calendar day in [monthStart, monthEnd).
  const out: DailyMetric[] = [];
  const cursor = new Date(monthStartMs);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(monthEndMs);
  while (cursor.getTime() < end.getTime()) {
    const key = localDayKey(cursor.getTime());
    const a = byDay.get(key);
    out.push(
      a
        ? {
            day: key,
            cost: a.cost,
            sessions: a.sessions.size,
            turns: a.turns,
            activeMs: activeMsFromTimestamps(a.ts),
            cacheHitRate: a.cacheable > 0 ? a.cacheRead / a.cacheable : 0,
            costPerTurn: a.turns > 0 ? a.cost / a.turns : 0,
          }
        : { day: key, cost: 0, sessions: 0, turns: 0, activeMs: 0, cacheHitRate: 0, costPerTurn: 0 },
    );
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/db/dailyMetrics.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/analyticsQueries.ts test/db/dailyMetrics.test.ts
git commit -m "feat(insights): dailyMetrics query (per-local-day cost/sessions/turns/active/cache/\$turn)"
```

---

### Task 5: Messaging types + host handlers (custom range + getDailyMetrics)

**Files:**
- Modify: `src/messaging.ts`, `webview/src/messaging.ts` (lockstep)
- Modify: `src/host/seshPanel.ts` — `getInsights` handler (~379-441) + `sinceMsForRange` (~1020-1032); add `getDailyMetrics` handler
- Verification: typecheck + bundle build (no unit test; host is vscode-coupled)

**Interfaces:**
- Consumes: `standupSummary`/`costByFile`/`modelLeaderboard` with `until` (Task 3), `dailyMetrics` (Task 4).
- Produces (message types): request `{ kind:"getInsights"; tab; range:"today"|"7d"|"30d"|"1y"|"all" } | { kind:"getInsights"; tab; range:"custom"; start:number; end:number }`; request `{ kind:"getDailyMetrics"; month:string /* "YYYY-MM" */ }`; response `{ kind:"dailyMetrics"; month:string; payload: DailyMetric[] }`.

- [ ] **Step 1: Edit both messaging files (lockstep).** Read the current `getInsights` line in each, then widen it to the union above and add the new request/response kinds. Keep the two files identical. Example shape for the `ToHost` union member and the `ToWebview` response:

```typescript
// in the ToHost union:
| { kind: "getInsights"; tab: "standup" | "cost" | "leaderboard" | "records"; range: "today" | "7d" | "30d" | "1y" | "all" }
| { kind: "getInsights"; tab: "standup" | "cost" | "leaderboard" | "records"; range: "custom"; start: number; end: number }
| { kind: "getDailyMetrics"; month: string }
// in the ToWebview union:
| { kind: "dailyMetrics"; month: string; payload: unknown }
```

- [ ] **Step 2: Edit the host `getInsights` handler** in `src/host/seshPanel.ts`. Read the current handler (~379-441). For `msg.range === "custom"`, set `sinceMs = msg.start`, `untilMs = msg.end`, `priorRange = undefined`; otherwise keep the existing preset switch and set `untilMs = Date.now()` (and `undefined` for "all"). Pass `until: untilMs` into `standupSummary`/`costByFile`/`modelLeaderboard`. Example:

```typescript
let sinceMs: number;
let untilMs: number | undefined;
let priorRange: { start: number; end: number; label: string } | undefined;
if (msg.range === "custom") {
  sinceMs = msg.start;
  untilMs = msg.end;
  priorRange = undefined;
} else {
  // ...existing preset switch sets sinceMs + priorRange...
  untilMs = msg.range === "all" ? undefined : Date.now();
}
// then, per tab, add `until: untilMs` to the query opts.
```

- [ ] **Step 3: Add the `getDailyMetrics` handler** near `getInsights`. Parse `"YYYY-MM"` into local month bounds and call `dailyMetrics`:

```typescript
if (msg.kind === "getDailyMetrics") {
  const [y, m] = msg.month.split("-").map(Number);
  const monthStartMs = new Date(y, m - 1, 1, 0, 0, 0, 0).getTime();
  const monthEndMs = new Date(y, m, 1, 0, 0, 0, 0).getTime();
  const payload = dailyMetrics({ db: this.host.rawDb!, monthStartMs, monthEndMs });
  this.send({ kind: "dailyMetrics", month: msg.month, payload });
  return;
}
```

(Match the file's actual handler dispatch style, `db` accessor, and `send`/`postMessage` method — read the surrounding handlers first. Import `dailyMetrics` from `../db/analyticsQueries`.)

- [ ] **Step 4: Typecheck + build the bundle**

Run: `npx tsc --noEmit -p tsconfig.json` → expect 0 errors.
Run: `npm run build:extension` → expect a clean build.

- [ ] **Step 5: Commit**

```bash
git add src/messaging.ts webview/src/messaging.ts src/host/seshPanel.ts
git commit -m "feat(insights): wire custom-range + getDailyMetrics through messaging and host"
```

---

### Task 6: Webview — custom date range control

**Files:**
- Modify: `webview/src/components/insights/range.ts`
- Modify: `webview/src/hooks/useInsights.ts`
- Modify: `webview/src/components/InsightsTab.tsx`
- Verification: `npx tsc --noEmit` (webview tsconfig) + `npm run build:webview` + manual

**Interfaces:**
- Produces: `InsightsRange` gains `"custom"`; a `CustomRange = { start: number; end: number } | null` concept passed alongside the range; `useInsights` accepts an optional custom range and posts the custom message.

- [ ] **Step 1: Extend `range.ts`** — add `"custom"` to `InsightsRange`, a label entry, and helpers to convert date-input strings (`"YYYY-MM-DD"`) to local start-of-day / end-of-day ms:

```typescript
export type InsightsRange = "today" | "7d" | "30d" | "1y" | "all" | "custom";
// add to RANGE_TITLE:
//   custom: "Custom range",

export function localStartOfDayMs(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}
export function localEndOfDayMs(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}
```

(Leave `RANGE_OPTIONS` as the five presets; "custom" is triggered by a separate chip, not a preset button.)

- [ ] **Step 2: Update `useInsights.ts`** to accept an optional custom range and post the right message:

```typescript
export function useInsights(
  tab: InsightsTabId,
  range: InsightsRange,
  custom?: { start: number; end: number } | null,
): { payload: unknown; reload: () => void } {
  const [payload, setPayload] = useState<unknown>(null);
  const send = () => {
    if (range === "custom" && custom) {
      postToHost({ kind: "getInsights", tab, range: "custom", start: custom.start, end: custom.end });
    } else if (range !== "custom") {
      postToHost({ kind: "getInsights", tab, range });
    }
  };
  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "insights" && msg.tab === tab) setPayload(msg.payload);
    });
    send();
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, range, custom?.start, custom?.end]);
  return { payload, reload: send };
}
```

- [ ] **Step 3: Add the custom-range UI in `InsightsTab.tsx`** — a "Custom…" chip after the preset buttons that toggles a small panel with two `<input type="date">`. Hold `customDraft` (start/end ISO strings) and an applied `custom` (`{start,end}` ms) in state; when both dates are set, compute ms via `localStartOfDayMs`/`localEndOfDayMs`, set `range="custom"`, and pass `custom` to the sub-views' `useInsights`. Hide the prior-period comparison when `range === "custom"` (the standup payload's `comparison` will already be null, but also don't render the "vs" affordance). Match the existing button-group markup/classes.

- [ ] **Step 4: Typecheck + build**

Run (from `sesh/webview`): `npx tsc --noEmit` then from `sesh/`: `npm run build:webview`. Expect clean.

- [ ] **Step 5: Commit**

```bash
git add webview/src/components/insights/range.ts webview/src/hooks/useInsights.ts webview/src/components/InsightsTab.tsx
git commit -m "feat(insights): custom start-end date range control for sub-tabs"
```

---

### Task 7: Webview — Trends sub-tab (month nav + switchable SVG chart)

**Files:**
- Create: `webview/src/hooks/useDailyMetrics.ts`
- Create: `webview/src/components/insights/TrendsView.tsx`, `webview/src/components/insights/TrendsView.css`
- Modify: `webview/src/components/InsightsTab.tsx` (add the "Trends" sub-tab + render `TrendsView`)
- Verification: tsc + `npm run build:webview` + manual

**Interfaces:**
- Consumes: `{ kind:"getDailyMetrics", month }` / `{ kind:"dailyMetrics", month, payload }` (Task 5); `DailyMetric` shape (Task 4) — redeclare the row type locally in the webview (webview doesn't import from `src/`).
- Produces: `TrendsView` React component; `useDailyMetrics(month: string)` hook.

- [ ] **Step 1: Create `useDailyMetrics.ts`**

```typescript
import { useEffect, useState } from "react";
import { onHostMessage, postToHost } from "../messaging";

export interface DailyMetric {
  day: string; cost: number; sessions: number; turns: number;
  activeMs: number; cacheHitRate: number; costPerTurn: number;
}

export function useDailyMetrics(month: string): DailyMetric[] | null {
  const [rows, setRows] = useState<DailyMetric[] | null>(null);
  useEffect(() => {
    setRows(null);
    const off = onHostMessage((msg) => {
      if (msg.kind === "dailyMetrics" && msg.month === month) {
        setRows(msg.payload as DailyMetric[]);
      }
    });
    postToHost({ kind: "getDailyMetrics", month });
    return off;
  }, [month]);
  return rows;
}
```

- [ ] **Step 2: Create `TrendsView.tsx`** — month navigator (`‹ {label} ›`, state defaults to current month `YYYY-MM`, the `›` disabled when already at the current month), a metric switcher (6 buttons), and an SVG bar chart. Metric config drives label + value formatting:

```tsx
import { useState } from "react";
import { useDailyMetrics, type DailyMetric } from "../../hooks/useDailyMetrics";
import "./TrendsView.css";

type MetricKey = "cost" | "sessions" | "turns" | "activeMs" | "cacheHitRate" | "costPerTurn";
const METRICS: { key: MetricKey; label: string; fmt: (n: number) => string }[] = [
  { key: "cost", label: "Total cost", fmt: (n) => `$${n.toFixed(2)}` },
  { key: "sessions", label: "Sessions", fmt: (n) => `${n}` },
  { key: "turns", label: "Turns", fmt: (n) => `${n}` },
  { key: "activeMs", label: "Active time", fmt: fmtDur },
  { key: "cacheHitRate", label: "Cache hit", fmt: (n) => `${Math.round(n * 100)}%` },
  { key: "costPerTurn", label: "$ / turn", fmt: (n) => `$${n.toFixed(3)}` },
];
function fmtDur(ms: number): string {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function TrendsView() {
  const [month, setMonth] = useState<string>(thisMonth());
  const [metric, setMetric] = useState<MetricKey>("cost");
  const rows = useDailyMetrics(month);
  const cfg = METRICS.find((x) => x.key === metric)!;
  const atCurrent = month >= thisMonth();

  return (
    <div className="sesh-trends">
      <div className="sesh-trends-nav">
        <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
        <span className="sesh-trends-month">{monthLabel(month)}</span>
        <button onClick={() => setMonth(shiftMonth(month, 1))} disabled={atCurrent} aria-label="Next month">›</button>
      </div>
      <div className="sesh-trends-metrics">
        {METRICS.map((x) => (
          <button key={x.key} className={x.key === metric ? "is-active" : ""} onClick={() => setMetric(x.key)}>
            {x.label}
          </button>
        ))}
      </div>
      {rows === null ? (
        <div className="sesh-trends-empty">Loading…</div>
      ) : (
        <TrendChart rows={rows} metric={metric} fmt={cfg.fmt} label={cfg.label} />
      )}
    </div>
  );
}

function TrendChart({ rows, metric, fmt, label }: { rows: DailyMetric[]; metric: MetricKey; fmt: (n: number) => string; label: string }) {
  const values = rows.map((r) => r[metric] as number);
  const max = Math.max(1, ...values);
  const W = 100, H = 40, gap = 0.5;
  const bw = W / rows.length;
  if (values.every((v) => v === 0)) return <div className="sesh-trends-empty">No activity in {label.toLowerCase()} this month.</div>;
  return (
    <svg className="sesh-trends-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label} per day`}>
      {rows.map((r, i) => {
        const v = r[metric] as number;
        const h = (v / max) * H;
        return (
          <rect key={r.day} x={i * bw + gap} y={H - h} width={bw - gap * 2} height={h} className="sesh-trends-bar">
            <title>{`${r.day}: ${fmt(v)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 3: Create `TrendsView.css`** — theme-aware, matching existing bar styling:

```css
.sesh-trends { display: flex; flex-direction: column; gap: 12px; }
.sesh-trends-nav { display: flex; align-items: center; gap: 12px; }
.sesh-trends-nav button { background: none; border: none; color: var(--sesh-fg); cursor: pointer; font-size: 16px; padding: 2px 8px; }
.sesh-trends-nav button:disabled { opacity: 0.4; cursor: default; }
.sesh-trends-month { font-weight: 600; }
.sesh-trends-metrics { display: flex; flex-wrap: wrap; gap: 6px; }
.sesh-trends-metrics button { font-size: 12px; padding: 3px 10px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--sesh-fg) 18%, transparent); background: none; color: var(--sesh-fg); cursor: pointer; }
.sesh-trends-metrics button.is-active { background: color-mix(in srgb, var(--vscode-charts-blue, #4d8df6) 30%, transparent); border-color: transparent; }
.sesh-trends-svg { width: 100%; height: 160px; }
.sesh-trends-bar { fill: color-mix(in srgb, var(--vscode-charts-blue, #4d8df6) 70%, transparent); }
.sesh-trends-bar:hover { fill: var(--vscode-charts-blue, #4d8df6); }
.sesh-trends-empty { opacity: 0.6; font-size: 13px; padding: 24px 0; text-align: center; }
```

- [ ] **Step 4: Wire into `InsightsTab.tsx`** — add `"trends"` to the sub-tab list (label "Trends"), and render `<TrendsView />` when selected. Trends ignores the range/custom selector (it has its own month nav) — hide or disable the range controls while on the Trends sub-tab (the existing pattern already hides the range selector for "records"/"style"; add "trends" to that condition). Import `TrendsView`.

- [ ] **Step 5: Typecheck + build**

Run (from `sesh/webview`): `npx tsc --noEmit`; from `sesh/`: `npm run build:webview`. Expect clean.

- [ ] **Step 6: Commit**

```bash
git add webview/src/hooks/useDailyMetrics.ts webview/src/components/insights/TrendsView.tsx webview/src/components/insights/TrendsView.css webview/src/components/InsightsTab.tsx
git commit -m "feat(insights): Trends sub-tab with monthly daily-metric chart"
```

---

### Task 8: Webview — Standup hero shows active duration

**Files:**
- Modify: `webview/src/components/insights/StandupView.tsx` (~258-264; the standup data type for the `insights` payload it casts to)
- Verification: tsc + `npm run build:webview` + manual

**Interfaces:**
- Consumes: `StandupSummary.activeMs` (Task 2) — update the local TS type the component casts the payload to (replace `activeHours` with `activeMs`).

- [ ] **Step 1: Update the local standup payload type** in `StandupView.tsx` (the interface/type it casts `payload` to): replace `activeHours: { firstTs: number; lastTs: number } | null;` with `activeMs: number;`.

- [ ] **Step 2: Replace the hero render** (~258-263). Swap the time-of-day window for a duration:

```tsx
{data.activeMs > 0 && (
  <>
    <span className="sesh-mag-hero-dot">·</span>
    <span>{fmtDuration(data.activeMs)} active</span>
  </>
)}
```

- [ ] **Step 3: Add `fmtDuration`** — locate the webview formatter module first: `grep -rn "export function fmtUsd" webview/src` (the module that also defines `fmtCount`/`fmtTime`). If it lacks a duration formatter, add `fmtDuration` there and import it into `StandupView.tsx`; then update `TrendsView.tsx` (Task 7) to import this `fmtDuration` instead of its local `fmtDur` (DRY). Implementation:

```typescript
export function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
```

Remove the now-unused `fmtTime` import in `StandupView.tsx` if nothing else uses it.

- [ ] **Step 4: Typecheck + build**

Run (from `sesh/webview`): `npx tsc --noEmit`; from `sesh/`: `npm run build:webview`. Expect clean.

- [ ] **Step 5: Commit**

```bash
git add webview/src/components/insights/StandupView.tsx <formatter-module-path-from-step-3>
git commit -m "fix(insights): standup hero shows active duration instead of time-of-day window"
```

---

### Task 9: Integration — full verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Full backend suite**

Run: `npx vitest run`
Expected: all pass (prior 440 + new activeTime/dailyMetrics/standup/until tests).

- [ ] **Step 2: Typecheck both projects**

Run: `npx tsc --noEmit -p tsconfig.json` (extension) and from `sesh/webview`: `npx tsc --noEmit`. Expect 0 errors.

- [ ] **Step 3: Full build**

Run: `npm run build` (webview + extension). Expect clean.

- [ ] **Step 4: Manual smoke (F5 Extension Development Host, dev DB `~/.sesh/dev/`)**

Verify each:
- Insights → Standup/By file/Models show presets **and** a "Custom…" chip; picking a start+end filters the data; comparison ("vs prior") is hidden for custom.
- Insights → **Trends**: month navigator moves between months (`›` disabled on the current month); the six metric buttons switch the chart; bars render theme-correctly in light and dark themes; hovering a bar shows `day: value`; an empty month shows the empty state.
- Standup magazine hero shows "Xh Ym active" (a duration), and it's sane for Today, 7d, and 30d (no longer a multi-day time-of-day window).

- [ ] **Step 5: Final commit (if any manual-fix tweaks were needed)**

```bash
git add -A
git commit -m "chore(insights): polish after manual verification"
```

---

## Notes for the implementer

- Read each existing file before editing; match its exact style, `send`/dispatch method, and test helpers. Signatures quoted here (e.g. `StandupOpts`, `StandupSummary`, the `turns` columns) were verified against the current source on 2026-06-27.
- The webview cannot import from `src/`; redeclare shared row shapes (`DailyMetric`) locally and rely on the mirrored `messaging.ts` for message contracts.
- This change does not bump the extension version or package VSIXes — that's a separate release step the user runs when ready.
