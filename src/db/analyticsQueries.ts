import type { Db } from "./connection";
import type { SessionAnalyticsChip } from "../messaging";
import { basename } from "../util/path";
import { activeMsFromTimestamps } from "./activeTime";

// Pricing table (USD per 1M tokens) — rough Claude prices as of 2026-05.
// Update when model lineup changes; not load-bearing for correctness.
const MODEL_PRICING: Record<string, { in: number; out: number; cache_read: number; cache_create: number }> = {
  "claude-opus-4-7": { in: 15.0, out: 75.0, cache_read: 1.5, cache_create: 18.75 },
  "claude-opus-4-6": { in: 15.0, out: 75.0, cache_read: 1.5, cache_create: 18.75 },
  "claude-sonnet-4-6": { in: 3.0, out: 15.0, cache_read: 0.3, cache_create: 3.75 },
  "claude-haiku-4-5": { in: 1.0, out: 5.0, cache_read: 0.1, cache_create: 1.25 },
  "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0, cache_read: 0.1, cache_create: 1.25 },
};
const DEFAULT_PRICE = { in: 3.0, out: 15.0, cache_read: 0.3, cache_create: 3.75 };

const _warnedModels = new Set<string>();
function warnUnknownModel(model: string): void {
  if (_warnedModels.has(model)) return;
  _warnedModels.add(model);
  console.warn(`[sesh] Unknown model "${model}" — using heuristic pricing.`);
}

function priceFor(model: string | null): { in: number; out: number; cache_read: number; cache_create: number } {
  if (!model) return DEFAULT_PRICE;
  // Exact match first
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  // Prefix-match for date-suffixed variants (e.g. claude-opus-4-7-20260301)
  for (const [prefix, price] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(prefix + "-")) return price;
  }
  // Heuristic fallback: detect family by substring
  warnUnknownModel(model);
  if (model.includes("opus")) return MODEL_PRICING["claude-opus-4-7"];
  if (model.includes("haiku")) return MODEL_PRICING["claude-haiku-4-5"];
  if (model.includes("sonnet")) return MODEL_PRICING["claude-sonnet-4-6"];
  return DEFAULT_PRICE;
}

export function usdForTurn(t: {
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  tokens_cache_read: number;
  tokens_cache_create: number;
}): number {
  const p = priceFor(t.model);
  return (
    (t.tokens_in * p.in +
      t.tokens_out * p.out +
      t.tokens_cache_read * p.cache_read +
      t.tokens_cache_create * p.cache_create) /
    1_000_000
  );
}

export interface CostByFileRow {
  path: string;
  usd: number;
  tool_calls: number;
  sessions: number;
}

export function costByFile(opts: { db: Db; since: number; until?: number }): CostByFileRow[] {
  // Cost per file = sum of usd for every assistant turn that emitted at least
  // one tool_call against that path. Counts all tool_calls regardless of
  // tool name (so Read counts too) — those are signals of attention.
  const sql =
    `SELECT
         tc.target_path AS path,
         t.model AS model,
         t.tokens_in AS tokens_in,
         t.tokens_out AS tokens_out,
         t.tokens_cache_read AS tokens_cache_read,
         t.tokens_cache_create AS tokens_cache_create,
         t.session_id AS session_id
       FROM tool_calls tc
       JOIN turns t ON t.id = tc.turn_id
       WHERE tc.target_path IS NOT NULL AND tc.ts >= ?` +
    (opts.until != null ? " AND tc.ts <= ?" : "");
  const rows = opts.db
    .prepare(sql)
    .all(...(opts.until != null ? [opts.since, opts.until] : [opts.since])) as {
      path: string;
      model: string | null;
      tokens_in: number;
      tokens_out: number;
      tokens_cache_read: number;
      tokens_cache_create: number;
      session_id: string;
    }[];

  const agg = new Map<string, { usd: number; calls: number; sessions: Set<string> }>();
  for (const r of rows) {
    const existing = agg.get(r.path) ?? { usd: 0, calls: 0, sessions: new Set<string>() };
    existing.usd += usdForTurn(r);
    existing.calls += 1;
    existing.sessions.add(r.session_id);
    agg.set(r.path, existing);
  }
  return Array.from(agg.entries())
    .map(([path, v]) => ({ path, usd: v.usd, tool_calls: v.calls, sessions: v.sessions.size }))
    .sort((a, b) => b.usd - a.usd);
}

export interface SessionForFileRow {
  session_id: string;
  title: string | null;
  project_label: string | null;
  usd: number;
  tool_calls: number;
  last_touched_at: number;
}

/**
 * For a given file path, return every session that touched it (since `since`)
 * with its share of the file's spend, tool-call count, and most recent touch.
 * Used by the By-file drill-down ("show me the sessions behind this row").
 */
export function sessionsForFile(opts: { db: Db; path: string; since: number; until?: number }): SessionForFileRow[] {
  const sql =
    `SELECT
         t.session_id        AS session_id,
         t.model             AS model,
         t.tokens_in         AS tokens_in,
         t.tokens_out        AS tokens_out,
         t.tokens_cache_read AS tokens_cache_read,
         t.tokens_cache_create AS tokens_cache_create,
         tc.ts               AS ts
       FROM tool_calls tc
       JOIN turns t ON t.id = tc.turn_id
       WHERE tc.target_path = ? AND tc.ts >= ?` +
    (opts.until != null ? " AND tc.ts <= ?" : "");
  const rows = opts.db
    .prepare(sql)
    .all(...(opts.until != null ? [opts.path, opts.since, opts.until] : [opts.path, opts.since])) as {
      session_id: string;
      model: string | null;
      tokens_in: number;
      tokens_out: number;
      tokens_cache_read: number;
      tokens_cache_create: number;
      ts: number;
    }[];

  const agg = new Map<string, { usd: number; calls: number; lastTs: number }>();
  for (const r of rows) {
    const existing = agg.get(r.session_id) ?? { usd: 0, calls: 0, lastTs: 0 };
    existing.usd += usdForTurn(r);
    existing.calls += 1;
    if (r.ts > existing.lastTs) existing.lastTs = r.ts;
    agg.set(r.session_id, existing);
  }
  if (agg.size === 0) return [];

  const ids = Array.from(agg.keys());
  const placeholders = ids.map(() => "?").join(",");
  const meta = opts.db
    .prepare(
      `SELECT id, custom_title, auto_title, repo_path, project_path
       FROM sessions
       WHERE id IN (${placeholders})`,
    )
    .all(...ids) as Array<{
      id: string;
      custom_title: string | null;
      auto_title: string | null;
      repo_path: string | null;
      project_path: string | null;
    }>;
  const metaById = new Map(meta.map((m) => [m.id, m]));

  const out: SessionForFileRow[] = ids.map((id) => {
    const v = agg.get(id)!;
    const m = metaById.get(id);
    const title = m ? (m.custom_title?.trim() || m.auto_title?.trim() || null) : null;
    const projectRaw = m?.repo_path ?? m?.project_path ?? null;
    const project_label = projectRaw ? basename(projectRaw) : null;
    return {
      session_id: id,
      title,
      project_label,
      usd: v.usd,
      tool_calls: v.calls,
      last_touched_at: v.lastTs,
    };
  });
  return out.sort((a, b) => b.usd - a.usd);
}

export interface ModelBoardRow {
  model: string;
  turns: number;
  tokens_in_total: number;
  tokens_out_total: number;
  usd: number;
}

export function modelLeaderboard(opts: { db: Db; since: number; until?: number }): ModelBoardRow[] {
  const sql =
    `SELECT
         model,
         COUNT(*) AS turns,
         SUM(tokens_in) AS tokens_in_total,
         SUM(tokens_out) AS tokens_out_total,
         SUM(tokens_cache_read) AS tokens_cache_read_total,
         SUM(tokens_cache_create) AS tokens_cache_create_total
       FROM turns
       WHERE model IS NOT NULL AND ts >= ?` +
    (opts.until != null ? " AND ts <= ?" : "") +
    " GROUP BY model";
  const rows = opts.db
    .prepare(sql)
    .all(...(opts.until != null ? [opts.since, opts.until] : [opts.since])) as {
      model: string;
      turns: number;
      tokens_in_total: number;
      tokens_out_total: number;
      tokens_cache_read_total: number;
      tokens_cache_create_total: number;
    }[];
  return rows
    .map((r) => ({
      model: r.model,
      turns: r.turns,
      tokens_in_total: r.tokens_in_total,
      tokens_out_total: r.tokens_out_total,
      usd: usdForTurn({
        model: r.model,
        tokens_in: r.tokens_in_total,
        tokens_out: r.tokens_out_total,
        tokens_cache_read: r.tokens_cache_read_total,
        tokens_cache_create: r.tokens_cache_create_total,
      }),
    }))
    .sort((a, b) => b.usd - a.usd);
}

export interface PersonalRecords {
  longestSessionTurns: { session_id: string; turns: number };
  fewestTokensShipped: { session_id: string; tokens: number } | null;
  currentStreak: { days: number };
  totalSessions: number;
  totalTurns: number;
  totalUsd: number;
}

export function personalRecords(opts: { db: Db }): PersonalRecords {
  const longest = opts.db
    .prepare(
      "SELECT session_id, COUNT(*) AS turns FROM turns GROUP BY session_id ORDER BY turns DESC LIMIT 1",
    )
    .get() as { session_id: string; turns: number } | undefined;

  const fewestShipped = opts.db
    .prepare(
      `SELECT s.id AS session_id, (s.tokens_in + s.tokens_out) AS tokens
       FROM sessions s
       JOIN session_outcomes o ON o.session_id = s.id
       WHERE o.state = 'shipped' AND (s.tokens_in + s.tokens_out) > 0
       ORDER BY tokens ASC LIMIT 1`,
    )
    .get() as { session_id: string; tokens: number } | undefined;

  const totalSessions = (opts.db.prepare("SELECT COUNT(*) AS c FROM sessions").get() as { c: number }).c;
  const totalTurns = (opts.db.prepare("SELECT COUNT(*) AS c FROM turns").get() as { c: number }).c;

  // Total USD across all turns
  const turnRows = opts.db
    .prepare(
      "SELECT model, tokens_in, tokens_out, tokens_cache_read, tokens_cache_create FROM turns",
    )
    .all() as {
      model: string | null;
      tokens_in: number;
      tokens_out: number;
      tokens_cache_read: number;
      tokens_cache_create: number;
    }[];
  const totalUsd = turnRows.reduce((acc, r) => acc + usdForTurn(r), 0);

  // Streak: count consecutive days with at least one session active
  const days = opts.db
    .prepare(
      `SELECT DISTINCT date(last_active_at / 1000, 'unixepoch') AS d
       FROM sessions ORDER BY d DESC`,
    )
    .all() as { d: string }[];
  let streak = 0;
  if (days.length > 0) {
    streak = 1;
    for (let i = 1; i < days.length; i++) {
      const a = new Date(days[i - 1].d);
      const b = new Date(days[i].d);
      const diff = (a.getTime() - b.getTime()) / 86400000;
      if (Math.round(diff) === 1) streak++;
      else break;
    }
  }

  return {
    longestSessionTurns: longest ?? { session_id: "", turns: 0 },
    fewestTokensShipped: fewestShipped ?? null,
    currentStreak: { days: streak },
    totalSessions,
    totalTurns,
    totalUsd,
  };
}

export interface ModelShareRow {
  model: string;
  share: number; // 0..1
  usd: number;
  tokens_total: number;
}

export interface OutcomeCounts {
  open: number;
  shipped: number;
  shipped_partial: number;
  reverted: number;
  abandoned: number;
}

export interface ToolCount {
  name: string;
  count: number;
}

export interface PriorComparison {
  totalUsd: number;
  totalSessions: number;
  outcomesShipped: number;
  rangeLabel: string; // e.g. "yesterday", "the previous 7 days"
}

export interface StandupSummary {
  totalSessions: number;
  totalTurns: number;
  totalUsd: number;
  perProject: { project_path: string; sessions: number; usd: number }[];

  activeMs: number;
  modelBreakdown: ModelShareRow[];
  outcomes: OutcomeCounts;
  topFile: { path: string; usd: number; sessions: number } | null;
  topTools: ToolCount[];
  cacheHitRate: number; // 0..1
  corrections: number;
  costPerTurn: number; // 0 if no turns
  costPerShipped: number | null; // null if no shipped

  comparison: PriorComparison | null;
}

export interface StandupOpts {
  db: Db;
  since: number; // unix ms
  until?: number; // unix ms inclusive upper bound (optional)
  priorRange?: { start: number; end: number; label: string }; // optional comparison range
}

export function standupSummary(opts: StandupOpts): StandupSummary {
  const { db, since, until, priorRange } = opts;

  // ─── Sessions in period ─────────────────────────────────────
  const sessionSql =
    "SELECT id, project_path FROM sessions WHERE last_active_at >= ?" +
    (until != null ? " AND last_active_at <= ?" : "");
  const sessionRows = db
    .prepare(sessionSql)
    .all(...(until != null ? [since, until] : [since])) as { id: string; project_path: string }[];
  const totalSessions = sessionRows.length;
  const sessionIds = sessionRows.map((r) => r.id);

  // ─── Turns in period ────────────────────────────────────────
  const turnSql =
    `SELECT t.model, t.tokens_in, t.tokens_out, t.tokens_cache_read,
              t.tokens_cache_create, t.is_correction, t.ts,
              s.project_path
         FROM turns t
         JOIN sessions s ON s.id = t.session_id
        WHERE t.ts >= ?` +
    (until != null ? " AND t.ts <= ?" : "");
  const turnRows = db
    .prepare(turnSql)
    .all(...(until != null ? [since, until] : [since])) as {
      model: string | null;
      tokens_in: number;
      tokens_out: number;
      tokens_cache_read: number;
      tokens_cache_create: number;
      is_correction: 0 | 1;
      ts: number;
      project_path: string;
    }[];

  let totalUsd = 0;
  let totalTokens = 0;
  let totalCacheRead = 0;
  let totalCacheReadable = 0;
  let corrections = 0;
  const turnTimestamps: number[] = [];
  const usdByModel = new Map<string, number>();
  const tokensByModel = new Map<string, number>();
  const usdByProject = new Map<string, number>();

  for (const r of turnRows) {
    const usd = usdForTurn(r);
    totalUsd += usd;
    const tokens = r.tokens_in + r.tokens_out;
    totalTokens += tokens;
    totalCacheRead += r.tokens_cache_read;
    totalCacheReadable += r.tokens_in + r.tokens_cache_read;
    if (r.is_correction === 1) corrections++;
    turnTimestamps.push(r.ts);
    if (r.model) {
      usdByModel.set(r.model, (usdByModel.get(r.model) ?? 0) + usd);
      tokensByModel.set(r.model, (tokensByModel.get(r.model) ?? 0) + tokens);
    }
    usdByProject.set(
      r.project_path,
      (usdByProject.get(r.project_path) ?? 0) + usd,
    );
  }

  // ─── Per-project (sessions + USD) ──────────────────────────
  const sessionsByProject = new Map<string, Set<string>>();
  for (const s of sessionRows) {
    const set = sessionsByProject.get(s.project_path) ?? new Set<string>();
    set.add(s.id);
    sessionsByProject.set(s.project_path, set);
  }
  const perProject = Array.from(sessionsByProject.entries())
    .map(([project_path, ids]) => ({
      project_path,
      sessions: ids.size,
      usd: usdByProject.get(project_path) ?? 0,
    }))
    .sort((a, b) => b.usd - a.usd);

  const totalTurns = turnRows.length;

  // ─── Model breakdown (share of total tokens) ────────────────
  const modelBreakdown: ModelShareRow[] = Array.from(tokensByModel.entries())
    .map(([model, tokens]) => ({
      model,
      tokens_total: tokens,
      usd: usdByModel.get(model) ?? 0,
      share: totalTokens > 0 ? tokens / totalTokens : 0,
    }))
    .sort((a, b) => b.share - a.share);

  // ─── Outcomes (count per state) ─────────────────────────────
  const outcomes: OutcomeCounts = {
    open: 0, shipped: 0, shipped_partial: 0, reverted: 0, abandoned: 0,
  };
  if (sessionIds.length > 0) {
    const placeholders = sessionIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT state, COUNT(*) AS c FROM session_outcomes
          WHERE session_id IN (${placeholders})
          GROUP BY state`,
      )
      .all(...sessionIds) as { state: string; c: number }[];
    for (const r of rows) {
      if (r.state === "open") outcomes.open = r.c;
      else if (r.state === "shipped") outcomes.shipped = r.c;
      else if (r.state === "shipped-partial") outcomes.shipped_partial = r.c;
      else if (r.state === "reverted") outcomes.reverted = r.c;
      else if (r.state === "abandoned") outcomes.abandoned = r.c;
    }
  }

  // ─── Top file (reuse costByFile, take top) ──────────────────
  const allFiles = costByFile({ db, since, until });
  const topFileRow = allFiles[0] ?? null;
  const topFile = topFileRow
    ? { path: topFileRow.path, usd: topFileRow.usd, sessions: topFileRow.sessions }
    : null;

  // ─── Top tools (count by name in period) ────────────────────
  const toolSql =
    "SELECT name, COUNT(*) AS c FROM tool_calls WHERE ts >= ?" +
    (until != null ? " AND ts <= ?" : "") +
    " GROUP BY name ORDER BY c DESC LIMIT 3";
  const toolRows = db
    .prepare(toolSql)
    .all(...(until != null ? [since, until] : [since])) as { name: string; c: number }[];
  const topTools: ToolCount[] = toolRows.map((r) => ({ name: r.name, count: r.c }));

  // ─── Cache hit rate ─────────────────────────────────────────
  const cacheHitRate =
    totalCacheReadable > 0 ? totalCacheRead / totalCacheReadable : 0;

  // ─── Cost-per-* ─────────────────────────────────────────────
  const costPerTurn = totalTurns > 0 ? totalUsd / totalTurns : 0;
  const costPerShipped = outcomes.shipped > 0 ? totalUsd / outcomes.shipped : null;

  // ─── Comparison (prior range) ───────────────────────────────
  let comparison: PriorComparison | null = null;
  if (priorRange) {
    const priorSessions = db
      .prepare(
        "SELECT id FROM sessions WHERE last_active_at >= ? AND last_active_at < ?",
      )
      .all(priorRange.start, priorRange.end) as { id: string }[];

    const priorTurnRows = db
      .prepare(
        `SELECT model, tokens_in, tokens_out, tokens_cache_read, tokens_cache_create
           FROM turns WHERE ts >= ? AND ts < ?`,
      )
      .all(priorRange.start, priorRange.end) as {
        model: string | null;
        tokens_in: number;
        tokens_out: number;
        tokens_cache_read: number;
        tokens_cache_create: number;
      }[];
    const priorUsd = priorTurnRows.reduce((acc, r) => acc + usdForTurn(r), 0);

    let priorShipped = 0;
    if (priorSessions.length > 0) {
      const placeholders = priorSessions.map(() => "?").join(",");
      const ids = priorSessions.map((s) => s.id);
      const row = db
        .prepare(
          `SELECT COUNT(*) AS c FROM session_outcomes
            WHERE state = 'shipped' AND session_id IN (${placeholders})`,
        )
        .get(...ids) as { c: number };
      priorShipped = row.c;
    }

    comparison = {
      totalUsd: priorUsd,
      totalSessions: priorSessions.length,
      outcomesShipped: priorShipped,
      rangeLabel: priorRange.label,
    };
  }

  return {
    totalSessions, totalTurns, totalUsd, perProject,
    activeMs: activeMsFromTimestamps(turnTimestamps),
    modelBreakdown, outcomes,
    topFile, topTools,
    cacheHitRate, corrections,
    costPerTurn, costPerShipped,
    comparison,
  };
}

// Backwards-compat alias for the status bar (which uses todayStart, no
// comparison). Internally calls standupSummary.
export function todaysStandup(opts: { db: Db; todayStart: number }): StandupSummary {
  return standupSummary({ db: opts.db, since: opts.todayStart });
}

export interface Commitment {
  session_id: string;
  turn_id: string;
  ts: number;
  excerpt: string;
}

export function buildAnalyticsChips(
  db: Db,
  sessionIds: string[],
): Map<string, SessionAnalyticsChip> {
  const result = new Map<string, SessionAnalyticsChip>();
  if (sessionIds.length === 0) return result;

  const placeholders = sessionIds.map(() => "?").join(",");

  // Pass 1: outcomes
  const outcomeRows = db
    .prepare(
      `SELECT session_id, state FROM session_outcomes WHERE session_id IN (${placeholders})`,
    )
    .all(...sessionIds) as { session_id: string; state: SessionAnalyticsChip["outcome"] }[];
  const outcomeMap = new Map<string, SessionAnalyticsChip["outcome"]>();
  for (const r of outcomeRows) outcomeMap.set(r.session_id, r.state);

  // Pass 2: per-(session, model) token sums. The "primary model" is the
  // model with the highest tokens_in + tokens_out for that session.
  const turnRows = db
    .prepare(
      `SELECT session_id, model,
              SUM(tokens_in) AS ti, SUM(tokens_out) AS tokens_out_sum,
              SUM(tokens_cache_read) AS tcr, SUM(tokens_cache_create) AS tcc
         FROM turns
         WHERE session_id IN (${placeholders}) AND model IS NOT NULL
         GROUP BY session_id, model`,
    )
    .all(...sessionIds) as {
      session_id: string;
      model: string;
      ti: number;
      tokens_out_sum: number;
      tcr: number;
      tcc: number;
    }[];

  // For each session, find the row with the highest token sum and compute usd.
  const primary = new Map<string, typeof turnRows[number]>();
  for (const r of turnRows) {
    const existing = primary.get(r.session_id);
    if (!existing || r.ti + r.tokens_out_sum > existing.ti + existing.tokens_out_sum) {
      primary.set(r.session_id, r);
    }
  }

  for (const id of sessionIds) {
    const top = primary.get(id);
    const usd = top
      ? usdForTurn({
          model: top.model,
          tokens_in: top.ti,
          tokens_out: top.tokens_out_sum,
          tokens_cache_read: top.tcr,
          tokens_cache_create: top.tcc,
        })
      : 0;
    result.set(id, {
      outcome: outcomeMap.get(id) ?? null,
      usd,
      primary_model: top?.model ?? null,
    });
  }

  return result;
}

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
  // Each turn is bucketed into its local calendar day. Active-time gaps do NOT
  // cross day boundaries: a turn at 23:58 and one at 00:03 next day fall in
  // different day buckets, so that gap is counted for neither day — preventing
  // double-counting and avoiding one day "owning" another day's idle time.
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

const COMMITMENT_PATTERNS = [
  /\bI'?ll\s+(do|fix|finish|write|address|tackle)\s+(this|that|it|them)\s+(later|tomorrow|next time|tonight)/i,
  /\b(TODO|FIXME)\s*:?\s*(.{1,150})/i,
  /\bwe (should|could)\s+(.{1,150})/i,
  /\blet'?s\s+(eventually|later|soon)\s+(.{1,150})/i,
];

export function recentCommitments(opts: { db: Db; since: number }): Commitment[] {
  // V1 reads from FTS table. Per-turn text isn't stored in turns table to
  // keep it small; commitment mining is pattern-based against the FTS-cleaned
  // content. Note: turn_id and ts cannot be populated accurately at this
  // layer — they're stubbed. Substrate 2's per-turn embeddings will replace
  // this with proper turn-level metadata.
  const sessions = opts.db
    .prepare(
      `SELECT scf.session_id, scf.content, s.last_active_at
         FROM session_content_fts scf
         JOIN sessions s ON s.id = scf.session_id
         WHERE s.last_active_at >= ?`,
    )
    .all(opts.since) as { session_id: string; content: string; last_active_at: number }[];

  const out: Commitment[] = [];
  for (const s of sessions) {
    for (const pat of COMMITMENT_PATTERNS) {
      // Use a fresh RegExp with the global flag so we find ALL matches.
      const gpat = new RegExp(pat.source, pat.flags.includes("g") ? pat.flags : pat.flags + "g");
      let m: RegExpExecArray | null;
      while ((m = gpat.exec(s.content)) !== null) {
        const idx = m.index;
        out.push({
          session_id: s.session_id,
          turn_id: "",  // populated in substrate 2
          ts: s.last_active_at,  // approximate — uses session-level timestamp
          excerpt: s.content.slice(Math.max(0, idx - 30), idx + m[0].length + 60),
        });
      }
    }
  }
  return out;
}
