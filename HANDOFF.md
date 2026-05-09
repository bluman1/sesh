# Sesh — Handoff

Internal reference for Claude sessions and engineers picking up the project. Written to be read alongside the code, not instead of it.

---

## Substrate 2 — Semantic (embeddings · Knowledge · Ideas · CLAUDE.md improver · prompt linter · style fingerprint · next-session suggester)

### Schema — migration 006

`src/db/migrations/006_semantic.sql` adds five tables:

| Table | Purpose |
|---|---|
| `chunks` | Sliding-window text chunks extracted from turns (≤200 tokens, 50-token stride). `session_id`, `turn_id`, `seq`, `text`, `role`. |
| `embeddings` | One row per chunk: `chunk_id`, `model` (embedder model), `vector` (BLOB, 384 floats for default model). |
| `ideas` | Intent-bearing user messages mined by `ideaDetector`: `session_id`, `turn_id`, `text`, `cluster_id` (nullable, assigned by cosine clustering). |
| `claude_md_suggestions` | Patterns from repeated corrections: `pattern` text, `suggestion`, `example_session_id`, `score`. |
| `prompt_lints` | Per-session lints: `session_id`, `matched_pattern`, `suggestion`, `score`. |

Note: migration 005 was never created — sequence jumps from 004 to 006 intentionally.

### New repos

| Repo | File |
|---|---|
| `ChunkRepository` | `src/db/chunks.ts` |
| `EmbeddingRepository` | `src/db/embeddings.ts` |
| `IdeaRepository` | `src/db/ideas.ts` |
| `ClaudeMdSuggestionRepository` | `src/db/claudeMd.ts` |
| `PromptLintRepository` | `src/db/promptLints.ts` |

Also new: `src/db/semanticQueries.ts` — pure functions for semantic search (cosine ranking against stored embedding vectors) and idea cluster retrieval.

### Embedder runtime (`src/embed/`)

| File | Purpose |
|---|---|
| `types.ts` | `Embedder` interface + `EmbedderConfig` union |
| `xenovaEmbedder.ts` | `XenovaEmbedder` — on-device WASM via `@huggingface/transformers`. Default model: `Xenova/all-MiniLM-L6-v2` (384 dims). Lazy-loads the pipeline on first call. |
| `ollamaEmbedder.ts` | `OllamaEmbedder` — local Ollama HTTP endpoint. Default model: `nomic-embed-text`. |
| `cloudEmbedder.ts` | `CloudEmbedder` — OpenAI-compatible endpoint. Default model: `text-embedding-3-small`. |
| `factory.ts` | `createEmbedder(cfg)` — routes to the right impl. |
| `cosine.ts` | `cosineSimilarity(a, b)` — pure, no deps. |
| `chunkText.ts` | `chunkText(text, opts)` — sliding window chunker used by `chunkExtractor`. |

`@huggingface/transformers` is externalized from the esbuild bundle (runtime dep, not inlined). `onnxruntime-node` is similarly external.

### New scanner modules

| Module | File | What it does |
|---|---|---|
| `chunkExtractor` | `src/scanner/chunkExtractor.ts` | Splits indexed turns into `Chunk` rows. Runs before embedding. |
| `EmbeddingIndexer` | `src/scanner/embeddingIndexer.ts` | Walks un-embedded chunks, batches calls to the `Embedder`, stores vectors. Incremental; skips already-embedded chunks. Supports `cancel()`. |
| `ideaDetector` | `src/scanner/ideaDetector.ts` | Pure classifier: given a turn text, returns `true` if it's intent-bearing ("I should…", "we need to…", "TODO", etc.). |
| `IdeaIndexer` | `src/scanner/ideaIndexer.ts` | Walks recent sessions, calls `ideaDetector`, upserts `ideas` rows, assigns cluster IDs by cosine distance. |
| `CorrectionMiner` | `src/scanner/correctionMiner.ts` | Finds `is_correction=1` turns, clusters by embedding similarity, writes `claude_md_suggestions`. |
| `PromptLinter` | `src/scanner/promptLinter.ts` | On session open, compares the opening prompt against stored correction patterns; writes `prompt_lints` if a pattern fires. |
| `styleFingerprint` | `src/scanner/styleFingerprint.ts` | Computes writing-style metrics from user turns: avg sentence length, hedging rate, top tokens. Exports to JSON via `exportFingerprintToFile`. |
| `nextSessionSuggester` | `src/scanner/nextSessionSuggester.ts` | Combines recurring idea clusters + recent commitments into a banner text shown above the Sessions list. |

### New webview components and views

| Component | Location | What it does |
|---|---|---|
| `KnowledgeTab` | `webview/src/components/KnowledgeTab.tsx` | Semantic search across all sessions (no exact phrase needed) + CLAUDE.md tips panel surfacing `claude_md_suggestions`. |
| `IdeasTab` | `webview/src/components/IdeasTab.tsx` | Graveyard of intent-bearing user messages, grouped by cluster. |
| `StyleView` | `webview/src/components/insights/StyleView.tsx` | Insights sub-tab showing avg sentence length, hedging rate, top tokens. |
| `PromptLintBadge` | `webview/src/components/PromptLintBadge.tsx` | Badge on session detail header when a `prompt_lint` has fired for that session. |
| `NextSessionBanner` | `webview/src/components/NextSessionBanner.tsx` | Banner above the Sessions list combining idea clusters + recent commitments. |

`InsightsTab` updated to add a fifth sub-view: **Style** (`StyleView`).

### Activation wiring (`src/extension.ts`)

After `host.start()`, when `sesh.embeddingsEnabled` is `true` (the default):

1. `Embedder` constructed via `createEmbedder` from config.
2. `ChunkRepository`, `EmbeddingRepository` constructed.
3. `EmbeddingIndexer` constructed; `host.setEmbeddingIndexer` + `host.setEmbedder` called.
4. If `sesh.ideaMining` is `true`: `IdeaRepository` + `IdeaIndexer` constructed; `host.setIdeaIndexer` called.
5. `CorrectionMiner` constructed; `host.setCorrectionMiner` called.
6. `PromptLinter` constructed; `host.setPromptLinter` called.
7. **Eager chain** fires in background (void async IIFE): `embeddingIndexer.run()` → `ideaIndexer.run()` → `correctionMiner.run()` → `promptLinter.run()`. Errors are caught and logged; they don't surface to the user.

All three new commands registered:
- `sesh.reindexEmbeddings` — re-runs `embeddingIndexer.run()`.
- `sesh.suggestClaudeMd` — re-runs `correctionMiner.run()`, then opens the panel (Knowledge tab).
- `sesh.exportStyleFingerprint` — computes fingerprint and opens a save dialog.

### New settings

| Key | Default | Effect |
|---|---|---|
| `sesh.embeddingsEnabled` | `true` | Enable/disable the entire semantic layer. |
| `sesh.embedder` | `"local"` | `local` (XenovaEmbedder, on-device WASM), `ollama` (local Ollama), `cloud` (OpenAI-compatible). |
| `sesh.embedderModel` | `""` | Override model; blank uses embedder default. |
| `sesh.embedderApiKey` | `""` | API key for cloud embedder (stored in VSCode settings plaintext). |
| `sesh.embedderApiUrl` | `""` | Override endpoint URL; blank uses embedder default. |
| `sesh.ideaMining` | `true` | Enable/disable idea graveyard population. |
| `sesh.ideaMiningSinceDays` | `30` | Only mine ideas from sessions active within this many days. |

### New commands

| Command | Effect |
|---|---|
| `Sesh: Reindex embeddings` | Re-runs the full embedding indexer. |
| `Sesh: Suggest CLAUDE.md improvements` | Runs correction miner, opens panel to Knowledge tab tips panel. |
| `Sesh: Export style fingerprint` | Computes style metrics and saves as JSON via save dialog. |

### Test count

401 tests across 55 test files (combined substrate 2 + 3 baselines). Run `npx vitest run` to confirm.

---

## Substrate 3 — Git-Link

Migration 005 (`src/db/migrations/005_git_link.sql`) adds git-linkage tables and a repo_path cache column.

### New tables

| Table | Purpose |
|---|---|
| `commits` | One row per commit: `sha`, `repo_path`, `branch`, `authored_at`, `author`, `message`. |
| `commit_files` | One row per file touched in a commit: `sha`, `path`, `status`, `additions`, `deletions`. |
| `session_commits` | Join table: `session_id`, `commit_sha`, `confidence` (0–1 float). |

`sessions` gained `repo_path` — a cached result from repo-discovery to avoid repeated filesystem walks.

### New repos

- `src/db/commits.ts` — `CommitRepository`: upsertCommit, upsertFiles, listForRepo[Since], findBySha, listFiles, latestCommitTimestampForRepo, deleteForRepo.
- `src/db/sessionCommits.ts` — `SessionCommitRepository`: upsertMany, commitsForSession, sessionsForCommit, deleteForSession, topConfidenceForSession.

### New scanner / git modules

- `src/git/repoDiscovery.ts` — `findRepoRoot`: walks up the directory tree to find the enclosing `.git`.
- `src/git/gitLog.ts` — `parseGitLog`: reads `--numstat` output into `Commit[]` + `CommitFile[]` arrays.
- `src/git/runGit.ts` — `runGitLog` and `runCurrentBranch`: async shell wrappers around `git`.
- `src/git/gitIndexer.ts` — `GitIndexer`: incremental indexer, lifecycle mirrors `TurnsIndexer`. Uses `latestCommitTimestampForRepo` to pick up only new commits on subsequent runs.
- `src/git/discoverRepos.ts` — walks sessions without a `repo_path`, calls `findRepoRoot`, writes result back.
- `src/git/linker.ts` — `linkSessionsToCommits`: confidence = Jaccard(session files ∩ commit files) × time-overlap × 0.3 time-decay. Threshold 0.2 — links below that are discarded.
- `src/git/runFullGitReindex.ts` — orchestrates discovery → index → link → infer-outcomes in one pipeline.
- `src/git/ghCompanion.ts` — `gh` CLI wrappers: `isGhAvailable`, `listOpenPRsWithCommits`, `parseGhPRList`, `parseGhPRView`.

### Outcome inference upgrade

`src/scanner/outcomeInferer.ts` now uses git linkage when available:

| Condition | Inferred state |
|---|---|
| Top linked commit confidence ≥ 0.5 | `shipped` |
| 0.2 ≤ top confidence < 0.5 | `shipped-partial` |
| A `Revert "..."` commit (authored after the original) touches a file the session's commits also touched | `reverted` |
| No git linkage; session inactive > `outcomeInferenceDays` days | `abandoned` |

`user_marked` outcomes still win — inference never overwrites them.

### Reviewer tab

`webview/src/components/ReviewerTab.tsx` — replaces the placeholder. Three sub-tabs:

| Sub-tab | Content |
|---|---|
| Branch | Recent commits in the current repo with linked sessions and confidence percentages. |
| Sessions | Sessions in this repo grouped by their linked commits. |
| PRs | Open PRs via `gh` CLI with linked-session counts. Graceful empty-state when `gh` is missing or unauthenticated. |

Data flows via new messaging pairs:

- **ToHost**: `getReviewerBranch`, `getReviewerSessions`, `getReviewerPRs`, `triggerReindexGit`
- **ToWebview**: `reviewerBranch`, `reviewerSessions`, `reviewerPRs`

### New command

`sesh.reindexGit` (`Sesh: Reindex git`) — runs the full discovery → index → link → infer pipeline manually. Registered in `extension.ts`.

### New setting

| Key | Default | Effect |
|---|---|---|
| `sesh.gitIndexerEnabled` | `true` | Disable git indexing for huge monorepos where walking git log is too slow. |

### Known limitations / deferred

- Per-line AI git-blame deferred to a future sub-substrate.
- Renames not tracked — `--numstat` only; `--diff-filter=R` path is not wired up.
- Branch-aware filtering on the Branch view uses the `branch` column captured at index time; no `git for-each-ref` cross-reference.
- Cross-repo (submodule-spanning) session linking is out of scope.

### Test counts

245 tests passing across 35 test files (was 180 pre-substrate-3).

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
| 005_git_link | `commits`, `commit_files`, `session_commits`; `repo_path` on `sessions` |

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
│   ├── analyticsQueries.ts   usdForTurn · costByFile · modelLeaderboard · personalRecords · todaysStandup · recentCommitments
│   ├── commits.ts            CommitRepository
│   └── sessionCommits.ts     SessionCommitRepository
├── git/
│   ├── repoDiscovery.ts      findRepoRoot — walks up to find .git
│   ├── gitLog.ts             parseGitLog — numstat → Commit[] + CommitFile[]
│   ├── runGit.ts             runGitLog · runCurrentBranch async shell wrappers
│   ├── gitIndexer.ts         GitIndexer — incremental commit indexer
│   ├── discoverRepos.ts      caches repo_path on sessions
│   ├── linker.ts             linkSessionsToCommits — Jaccard × time-overlap × decay
│   ├── runFullGitReindex.ts  discovery → index → link → infer pipeline
│   └── ghCompanion.ts        gh CLI wrappers (isGhAvailable · listOpenPRsWithCommits)
└── scanner/
    ├── jsonl.ts              streaming reader (.jsonl + .jsonl.gz)
    ├── extract.ts, transcript.ts, scan.ts
    ├── extractTurns.ts       parse JSONL → Turn[] + ToolCall[]
    ├── turnsIndexer.ts       incremental turn indexer
    ├── outcomeInferer.ts     git-aware outcome inference (shipped · shipped-partial · reverted · abandoned)
    ├── sessionsIndex.ts, systemTags.ts, contentIndexer.ts, watcher.ts
    └── codex/                Codex CLI source adapter

webview/src/
├── App.tsx                   5-tab layout (Sessions · Knowledge · Insights · Ideas · Reviewer)
├── components/
│   ├── TabBar.tsx            tab navigation bar
│   ├── SessionsTab.tsx       existing session list + detail pane
│   ├── InsightsTab.tsx       4 sub-views: Today · By file · Models · Records
│   ├── AnalyticsChip.tsx     outcome dot · cost · model badge on session rows
│   ├── ReviewerTab.tsx       3 sub-tabs: Branch · Sessions · PRs
│   ├── PlaceholderTab.tsx    stub for Knowledge / Ideas
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
- **Substrate 4a** — Reviewer tab enhancements: per-line AI git-blame, rename tracking, cross-repo linking.

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
