# Sesh — Handoff

Internal reference for Claude sessions and engineers picking up the project. Written to be read alongside the code, not instead of it.

---

## Substrate 1 — Analytics

Migration 004 (`src/db/migrations/004_analytics.sql`) added three new tables and backfilled two columns onto `sessions`.

### New tables

| Table | Purpose |
|---|---|
| `turns` | One row per assistant turn: `model`, token counts (`tokens_in`, `tokens_out`, `tokens_cache_read`, `tokens_cache_create`), `ts`, `latency_ms`, `is_correction`. Indexed on `(session_id, seq)`, `model`, `ts`. |
| `tool_calls` | One row per tool invocation within a turn: `name`, `target_path` (nullable, path the tool touched), `is_error`, `result_size`. Indexed on `session_id`, `name`, `target_path`. |
| `session_outcomes` | One row per session: `state` in `{open, shipped, shipped-partial, reverted, abandoned}`. `user_marked=1` means the user set it manually and inference must not overwrite. |

`sessions` gained `turns_indexed` and `turns_last_offset` to support incremental backfill.

### New repos

- `src/db/turns.ts` — `TurnRepository`: upsert, bulk-insert, query turns for a session.
- `src/db/toolCalls.ts` — `ToolCallRepository`: upsert, bulk-insert.
- `src/db/outcomes.ts` — `OutcomeRepository`: upsert (respects `user_marked`), get by session.

### New scanner modules

- `src/scanner/extractTurns.ts` — parses a JSONL blob into `Turn[]` and `ToolCall[]` records. Walks `message.content` arrays; extracts `usage` fields from assistant turns; links tool uses to a synthetic turn ID.
- `src/scanner/turnsIndexer.ts` — incremental indexer: reads `turns_last_offset`, streams from that byte offset, calls `extractTurns`, upserts results, updates `turns_indexed` + `turns_last_offset`. Called by `SeshHost` on eager backfill and lazy on session view.
- `src/scanner/outcomeInferer.ts` — age-only inference for substrate 1: sessions with `last_active_at` older than `sesh.outcomeInferenceDays` days and no `user_marked` outcome are marked `abandoned`. Shipped / reverted auto-inference deferred to substrate 3 (git-link).

### New analytics queries

`src/db/analyticsQueries.ts` — pure functions over a `Db` handle. No side effects.

| Export | What it returns |
|---|---|
| `usdForTurn(t)` | Single-turn USD cost from token counts + model pricing table. |
| `costByFile(opts)` | `{path, usd, tool_calls, sessions}[]` — cost allocated to each touched file, sorted by cost desc. |
| `modelLeaderboard(opts)` | Per-model aggregates: turns, total tokens, total USD, sorted by cost desc. |
| `personalRecords(opts)` | Longest session (turns), fewest tokens for a shipped session, longest streak, totals. |
| `todaysStandup(opts)` | Sessions + turns + USD for today, broken down by project. |
| `recentCommitments(opts)` | Pattern-matched excerpts from FTS content ("I'll fix this later", TODO/FIXME, "we should…"). |

Pricing table in `analyticsQueries.ts` is hard-coded and must be updated when the model lineup changes. Default falls back to Sonnet rates.

### New webview

`webview/src/App.tsx` drives a 5-tab layout via `TabBar`:

| Tab | Status |
|---|---|
| Sessions | Live — existing session list + detail pane. |
| Knowledge | Placeholder — pending its own substrate plan. |
| Insights | Live — 4 sub-views (see below). |
| Ideas | Placeholder — pending its own substrate plan. |
| Reviewer | Placeholder — pending its own substrate plan. |

**Insights tab** (`webview/src/components/InsightsTab.tsx`) has 4 sub-views:

| Sub-view | Component | Data |
|---|---|---|
| Today | `StandupView` | `todaysStandup` — today's sessions, turns, USD, per-project breakdown. |
| By file | `CostView` | `costByFile` — top files by LLM spend. |
| Models | `LeaderboardView` | `modelLeaderboard` — per-model usage + cost. |
| Records | `RecordsView` | `personalRecords` — streak, longest session, total spend. |

Data flows via the existing messaging protocol (`src/messaging.ts`): host pushes `insights` on tab focus; webview hook `useInsights` subscribes.

**AnalyticsChip** (`webview/src/components/AnalyticsChip.tsx`) — rendered on each session row in the Sessions tab. Displays: outcome state dot · session cost (USD) · model badge. Hidden when turns have not yet been indexed for a session.

### New status bar item

`src/host/statusBar.ts` — `SeshStatusBar`. Shows `$(history) $X.XX today` on the right side of the status bar. Refreshes every 60 s. Hidden when today has zero sessions or when `sesh.statusBarShowCost` is `false`. Clicking opens the Sesh panel.

### New command

`sesh.reindexAnalytics` — registered in `extension.ts`. Drops + re-inserts all turn/tool-call rows and re-runs outcome inference for all sessions. Useful after a pricing-table change or a scanner bug fix.

### New settings

| Key | Default | Effect |
|---|---|---|
| `sesh.outcomeInferenceDays` | `30` | Days of inactivity after which an un-marked session is auto-marked `abandoned`. |
| `sesh.indexBackfillMode` | `"eager"` | `eager`: background-index all sessions at activation. `lazy`: index on first view. |
| `sesh.statusBarShowCost` | `true` | Show / hide the today's-spend status bar item. |

### Backfill strategy

At activation (`extension.ts` → `SeshHost.start()`): if `indexBackfillMode === "eager"`, all sessions with `turns_indexed = 0` are queued for background indexing via `turnsIndexer`. If `lazy`, indexing is deferred until the session is opened in the detail pane. The two paths both call the same `turnsIndexer.indexOne()` — no separate code path.

---

## Pre-substrate-1 overview

### What Sesh does

Sesh indexes the JSONL transcripts that Claude Code and Codex CLI write to disk, stores metadata + annotations in SQLite, and surfaces everything in a VSCode panel.

Source JSONL is **read-only**. Sesh never writes to `~/.claude/` or `~/.codex/`.

### Storage

| Path | Purpose |
|---|---|
| `~/.sesh/db.sqlite` | All state: sessions, annotations, FTS, turns, outcomes. WAL mode. |
| `~/.sesh/transcripts/<id>.jsonl.gz` | Optional gzip archive (`sesh.archiveTranscripts`). |

Delete `~/.sesh/db.sqlite` to rebuild from source on next activation. You lose annotations + analytics; transcript data is reconstructed.

### Schema migrations

`src/db/migrations/` — numbered SQL files, run in order by `migrate.ts`. Never edit a shipped migration; add a new one.

| Migration | What it adds |
|---|---|
| 001_initial | `sessions`, `project_remaps`, `categories` |
| 002_search | FTS5 `session_content_fts` |
| 003_tokens | `tokens_in`, `tokens_out` on `sessions` |
| 004_analytics | `turns`, `tool_calls`, `session_outcomes`; backfill columns on `sessions` |

### Architecture

```
src/
├── extension.ts              activate() — status bar, commands, view registration
├── host/
│   ├── seshHost.ts           DB + scan + ghost import + FTS + watcher + archive + turns backfill
│   ├── seshPanel.ts          singleton WebviewPanel, message dispatcher
│   ├── statusBar.ts          SeshStatusBar — today's spend
│   └── transcriptArchive.ts  opt-in gzipped sidecar
├── messaging.ts              typed host↔webview protocol
├── db/
│   ├── connection.ts, migrate.ts, migrations/
│   ├── sessions.ts, tags.ts, categories.ts, search.ts
│   ├── turns.ts              TurnRepository
│   ├── toolCalls.ts          ToolCallRepository
│   ├── outcomes.ts           OutcomeRepository
│   └── analyticsQueries.ts   usdForTurn · costByFile · modelLeaderboard · personalRecords · todaysStandup · recentCommitments
└── scanner/
    ├── jsonl.ts              streaming reader (.jsonl + .jsonl.gz)
    ├── extract.ts, transcript.ts, scan.ts
    ├── extractTurns.ts       parse JSONL → Turn[] + ToolCall[]
    ├── turnsIndexer.ts       incremental turn indexer
    ├── outcomeInferer.ts     age-based abandoned inference
    ├── sessionsIndex.ts, systemTags.ts, contentIndexer.ts, watcher.ts
    └── codex/                Codex CLI source adapter

webview/src/
├── App.tsx                   5-tab layout (Sessions · Knowledge · Insights · Ideas · Reviewer)
├── components/
│   ├── TabBar.tsx            tab navigation bar
│   ├── SessionsTab.tsx       existing session list + detail pane
│   ├── InsightsTab.tsx       4 sub-views: Today · By file · Models · Records
│   ├── AnalyticsChip.tsx     outcome dot · cost · model badge on session rows
│   ├── PlaceholderTab.tsx    stub for Knowledge / Ideas / Reviewer
│   └── insights/             StandupView · CostView · LeaderboardView · RecordsView
└── hooks/
    ├── useInsights.ts        subscribes to insights messages
    └── useSessions, useSessionDetail, useCategories, useAllTags, useProjects
```

### Design invariants

Load-bearing — don't remove without thinking hard:

- **Top-level JSONL only.** `<cwd>/<id>.jsonl` is a session. `<cwd>/<id>/subagents/agent-*.jsonl` is a subagent invocation inside the parent session — not indexed as its own session.
- **`sessions-index.json` is the ghost ledger.** After transcript pruning, Sesh keeps `orphaned=1` rows so title + metadata survive.
- **Annotations in Sesh's DB only.** No writes to source JSONL, ever.
- **`user_marked` outcomes win.** Inference never overwrites a user-set outcome.
- **Panel resume needs cwd match.** Claude Code resolves panel resume against `workspaceFolders[0]` only.

### What's next (substrate backlog)

- **Substrate 2** — knowledge / ideas tabs (content extraction, linking, surfacing).
- **Substrate 3** — git-link: connect sessions to commits/PRs; enable shipped/reverted outcome inference from git history.
- Reviewer tab.

### Development

```bash
npm install
npm run typecheck
npm rebuild better-sqlite3 && npm test
npx @electron/rebuild -f -w better-sqlite3 -v 39.8.8
npm run build
# then F5 in VSCode to launch the Extension Development Host
```

Native binary note: `better-sqlite3` targets one runtime at a time. Rebuild for host Node before `npm test`; rebuild for Electron before F5. See README for the full toggle workflow.
