import type { Db } from "./connection";

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

function priceFor(model: string | null): { in: number; out: number; cache_read: number; cache_create: number } {
  if (!model) return DEFAULT_PRICE;
  return MODEL_PRICING[model] ?? DEFAULT_PRICE;
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

export function costByFile(opts: { db: Db; since: number }): CostByFileRow[] {
  // Cost per file = sum of usd for every assistant turn that emitted at least
  // one tool_call against that path. Counts all tool_calls regardless of
  // tool name (so Read counts too) — those are signals of attention.
  const rows = opts.db
    .prepare(
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
       WHERE tc.target_path IS NOT NULL AND tc.ts >= ?`,
    )
    .all(opts.since) as {
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

export interface ModelBoardRow {
  model: string;
  turns: number;
  tokens_in_total: number;
  tokens_out_total: number;
  usd: number;
}

export function modelLeaderboard(opts: { db: Db; since: number }): ModelBoardRow[] {
  const rows = opts.db
    .prepare(
      `SELECT
         model,
         COUNT(*) AS turns,
         SUM(tokens_in) AS tokens_in_total,
         SUM(tokens_out) AS tokens_out_total,
         SUM(tokens_cache_read) AS tokens_cache_read_total,
         SUM(tokens_cache_create) AS tokens_cache_create_total
       FROM turns
       WHERE model IS NOT NULL AND ts >= ?
       GROUP BY model`,
    )
    .all(opts.since) as {
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
  longestStreak: { days: number };
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
    longestStreak: { days: streak },
    totalSessions,
    totalTurns,
    totalUsd,
  };
}

export interface StandupSummary {
  totalSessions: number;
  totalTurns: number;
  totalUsd: number;
  perProject: { project_path: string; sessions: number; usd: number }[];
}

export function todaysStandup(opts: { db: Db; todayStart: number }): StandupSummary {
  const turnRows = opts.db
    .prepare(
      `SELECT t.model, t.tokens_in, t.tokens_out, t.tokens_cache_read, t.tokens_cache_create,
              s.project_path
         FROM turns t JOIN sessions s ON s.id = t.session_id
         WHERE t.ts >= ?`,
    )
    .all(opts.todayStart) as {
      model: string | null;
      tokens_in: number;
      tokens_out: number;
      tokens_cache_read: number;
      tokens_cache_create: number;
      project_path: string;
    }[];

  const sessions = opts.db
    .prepare("SELECT COUNT(*) AS c FROM sessions WHERE last_active_at >= ?")
    .get(opts.todayStart) as { c: number };

  const perProject = new Map<string, { sessions: Set<string>; usd: number }>();
  for (const r of turnRows) {
    const existing = perProject.get(r.project_path) ?? { sessions: new Set<string>(), usd: 0 };
    existing.usd += usdForTurn(r);
    perProject.set(r.project_path, existing);
  }
  const sessionRows = opts.db
    .prepare("SELECT id, project_path FROM sessions WHERE last_active_at >= ?")
    .all(opts.todayStart) as { id: string; project_path: string }[];
  for (const r of sessionRows) {
    const existing = perProject.get(r.project_path) ?? { sessions: new Set<string>(), usd: 0 };
    existing.sessions.add(r.id);
    perProject.set(r.project_path, existing);
  }

  return {
    totalSessions: sessions.c,
    totalTurns: turnRows.length,
    totalUsd: turnRows.reduce((acc, r) => acc + usdForTurn(r), 0),
    perProject: Array.from(perProject.entries()).map(([project_path, v]) => ({
      project_path,
      sessions: v.sessions.size,
      usd: v.usd,
    })),
  };
}

export interface Commitment {
  session_id: string;
  turn_id: string;
  ts: number;
  excerpt: string;
}

const COMMITMENT_PATTERNS = [
  /\bI'?ll\s+(do|fix|finish|write|address|tackle)\s+(this|that|it|them)\s+(later|tomorrow|next time|tonight)/i,
  /\b(TODO|FIXME)\s*:?\s*(.{1,150})/i,
  /\bwe (should|could)\s+(.{1,150})/i,
  /\blet'?s\s+(eventually|later|soon)\s+(.{1,150})/i,
];

export function recentCommitments(opts: { db: Db; since: number }): Commitment[] {
  // V1 reads from FTS table (already populated by ContentIndexer).
  // Per-turn text isn't stored in turns table to keep it small; commitment
  // mining is pattern-based against the FTS-cleaned content.
  const sessions = opts.db
    .prepare(
      "SELECT session_id, content FROM session_content_fts WHERE session_id IN (SELECT id FROM sessions WHERE last_active_at >= ?)",
    )
    .all(opts.since) as { session_id: string; content: string }[];

  const out: Commitment[] = [];
  for (const s of sessions) {
    for (const pat of COMMITMENT_PATTERNS) {
      const m = s.content.match(pat);
      if (m) {
        const idx = s.content.indexOf(m[0]);
        out.push({
          session_id: s.session_id,
          turn_id: "",
          ts: 0,
          excerpt: s.content.slice(Math.max(0, idx - 30), idx + m[0].length + 60),
        });
      }
    }
  }
  return out;
}
