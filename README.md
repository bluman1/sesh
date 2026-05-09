# Sesh

> Browse, annotate, and resume saved Claude Code and Codex CLI sessions — without leaving VSCode.

[![Tests](https://img.shields.io/badge/tests-101%20passing-brightgreen)](#development)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![VSCode](https://img.shields.io/badge/VSCode-^1.94.0-007acc)](https://code.visualstudio.com/)

Sesh indexes the JSONL transcripts that Claude Code and Codex CLI already write to disk, gives you a fast filterable session list, full-text search across every transcript, structured rendering of tool calls and diffs, and one-click resume — all in a single VSCode panel.

Source data is read-only. Annotations live in Sesh's own SQLite. Your CLI's session files are never modified.

---

## Why Sesh

Claude Code and Codex CLI both quietly accumulate a long tail of sessions. After a few months you've got hundreds of transcripts in `~/.claude/` and `~/.codex/`, none of them browsable, searchable, or recoverable. The CLIs themselves give you `--resume <id>` but no way to find the id you want. Sesh fills that gap.

- **Find any past conversation.** Search by title, body, tag, category, or folder. Hits highlight inline.
- **Make sense of long sessions.** Tool calls, thinking blocks, and tool results render as collapsible cards. Edit/Write blocks become colored diffs. Code fences get Prism syntax highlighting. Screenshots inline.
- **Don't lose history when CLIs prune.** Sesh imports Claude Code's `sessions-index.json` ledger, so titles + metadata survive even after transcripts are deleted. Opt in to gzipped transcript archiving and the bodies stick around too.
- **Resume in the right place.** A click runs `claude --resume <id>` or `codex resume <id>` in a terminal opened in the session's original cwd. For Claude sessions in your current workspace, resume in the editor panel directly.

## Sources supported

| Source | Storage location | Resume command |
|---|---|---|
| Claude Code | `~/.claude/projects/<encoded-cwd>/<id>.jsonl` | `claude --resume <id>` |
| Codex CLI | `~/.codex/sessions/<year>/<month>/<day>/rollout-<ts>-<id>.jsonl` | `codex resume <id>` |

Schema is source-pluggable — adding another source means a parser + a `source` value, not a migration.

## Features in detail

**Tab navigation.** The panel has five tabs: Sessions, Knowledge, Insights, Ideas, and Reviewer. Sessions and Insights are live; the others are placeholders for upcoming substrates.

**Insights tab.** Four sub-views:
- *Today* — a daily standup: sessions active today, turns, and total spend broken down by project.
- *By file* — which files have attracted the most LLM spend across all sessions.
- *Models* — per-model turn counts and USD cost, sorted by spend.
- *Records* — personal bests: longest session, longest streak, total spend.

**Status bar.** When `sesh.statusBarShowCost` is on, the status bar shows `$(history) $X.XX today` and updates every minute. It hides on days with no activity. Click it to open the panel.

**Session list.** Virtualized 3-line rows with title (custom or auto-derived), category pill, tags, message count, source badge, last-active relative time. Each row shows an outcome dot, per-session cost, and model badge once the session has been indexed. Orphaned (pruned-transcript) sessions render in muted italics.

**Detail pane.** Sectioned layout: header, annotations, transcript. Folder pulled into its own labeled row. Tag input is inline, category dropdown supports inline create. Resume buttons hide when they'd be invalid (cross-workspace panel resume, codex panel resume).

**Search.** SQLite FTS5 across annotations and transcript bodies. Matches highlight in titles and the transcript body via `<mark>` tags. Auto-expands collapsed tool blocks when the body matches.

**Scope.** Three modes: current folder, all projects, or pick a specific folder from the dropdown (groups all known projects). Honors project remaps so renamed folders surface their legacy sessions.

**Transcript rendering.**
- Markdown + GFM via `react-markdown` for assistant text.
- Prism syntax highlighting for fenced code (theme-aware: vsLight on `.vscode-light`, vsDark otherwise).
- Default-collapsed `<details>` cards for `tool_use` / `tool_result` / `thinking` blocks, each with a per-tool codicon (Bash → terminal, Read → file, Edit → edit, Grep → search, etc.).
- Line-by-line diff for Edit / Write tool calls, derived via `diff.diffLines` and tinted with VSCode's diff editor colors.
- Inline images for screenshot-bearing messages.

**Project remap.** When the workspace path doesn't match any indexed `project_path` but a folder with the same basename does, Sesh suggests merging them. One click writes a `project_remap` row and legacy sessions show up under the new path.

**Annotations.** Custom titles, colored categories, free-form tags, notes, favorited, archived. All overlay-only — never written to source JSONL.

## Settings

| Key | Default | Effect |
|---|---|---|
| `sesh.openOnActivation` | `false` | Auto-open the panel on VSCode startup. |
| `sesh.transcriptLimit` | `10000` | Max recent messages loaded into the detail pane. Lower this if very long transcripts feel slow to open. |
| `sesh.archiveTranscripts` | `false` | Keep a gzipped sidecar of each transcript at `~/.sesh/transcripts/<id>.jsonl.gz` so pruned sessions stay readable. Roughly 1/6 the raw JSONL size after gzip. |
| `sesh.statusBarShowCost` | `true` | Show today's spend in the status bar. |
| `sesh.indexBackfillMode` | `"eager"` | `eager` indexes all sessions in the background at activation. `lazy` defers until you open a session. |
| `sesh.outcomeInferenceDays` | `30` | Days of inactivity before an un-reviewed session is auto-marked abandoned. |

## Commands

- `Sesh: Open` — opens or focuses the panel.
- `Sesh: Show stats` — info message with the indexed session count.
- `Sesh: Rescan all projects` — re-scan + reimport ghosts + reindex FTS.
- `Sesh: Show archive size` — disk size of the opt-in archive directory.
- `Sesh: Reindex analytics` — rebuild all turn, tool-call, and outcome data. Run this after a pricing-table change or if Insights numbers look wrong.

`Sesh: Open` is wired to the activity-bar entry, the secondary-sidebar entry (right strip, alongside Claude / Codex), the editor-title button (history icon), and the welcome-view links — pick whichever fits your layout.

## Storage

| Path | Purpose |
|---|---|
| `~/.sesh/db.sqlite` | Session metadata, annotations, FTS5 index. WAL mode. |
| `~/.sesh/transcripts/<id>.jsonl.gz` | Optional gzipped archive (only when `sesh.archiveTranscripts: true`). |
| `~/.claude/projects/**/*.jsonl` | Claude Code source. **Read-only.** |
| `~/.codex/sessions/**/rollout-*.jsonl` | Codex CLI source. **Read-only.** |

Deleting `~/.sesh/db.sqlite` rebuilds from source on next activation. You only lose annotations.

## Development

Sesh is a TypeScript-strict, esbuild-bundled extension with a Vite-bundled React 18 webview. Tests are Vitest, manifest is in `package.json`.

```bash
npm install
npm run typecheck                                    # tsc --noEmit on host
npm test                                             # 101 tests pass (host Node binary)
npm run build                                        # bundles extension + webview
npx @electron/rebuild -f -w better-sqlite3 -v 39.8.8 # before pressing F5
```

Then open this directory in VSCode and press <kbd>F5</kbd> to launch the Extension Development Host.

### Native binary toggling

`better-sqlite3` is a native module — its prebuilt binary at `node_modules/better-sqlite3/build/Release/better_sqlite3.node` targets one runtime at a time:

| Use case | Command |
|---|---|
| Run vitest (host Node) | `npm rebuild better-sqlite3` |
| Run extension in dev host (VSCode's Electron) | `npx @electron/rebuild -f -w better-sqlite3 -v 39.8.8` |

The `39.8.8` matches the Electron version VSCode currently bundles. Re-check `/Applications/Visual Studio Code.app/Contents/Resources/app/package.json` if VSCode updates and the rebuild fails.

To minimize flips during a dev session: finish all code changes, then **rebuild → test → rebuild → build** in one chain. When changing `package.json`, do a full F5 restart of the dev host — `Cmd+R` only reloads the webview.

## Architecture

```
src/
├── extension.ts              activate() — status bar, commands, view registration
├── host/
│   ├── seshHost.ts           DB + scan + ghost import + FTS + watcher + archive + turns backfill
│   ├── seshPanel.ts          singleton WebviewPanel, message dispatcher, light/dark iconPath
│   ├── statusBar.ts          SeshStatusBar — today's spend, refreshes every 60 s
│   └── transcriptArchive.ts  opt-in gzipped sidecar (sesh.archiveTranscripts)
├── messaging.ts              typed host↔webview protocol
├── db/
│   ├── connection.ts, migrate.ts, migrations/
│   ├── sessions.ts, tags.ts, categories.ts, search.ts
│   ├── turns.ts              TurnRepository
│   ├── toolCalls.ts          ToolCallRepository
│   ├── outcomes.ts           OutcomeRepository
│   └── analyticsQueries.ts   usdForTurn · costByFile · modelLeaderboard · personalRecords · todaysStandup · recentCommitments
└── scanner/
    ├── jsonl.ts              streaming reader — handles .jsonl.gz transparently
    ├── extract.ts            metadata extractor (Claude Code shape)
    ├── transcript.ts         transcript reader (Claude Code shape)
    ├── scan.ts               walks ~/.claude/projects/, top-level *.jsonl only
    ├── extractTurns.ts       parse JSONL → Turn[] + ToolCall[]
    ├── turnsIndexer.ts       incremental turn indexer (eager + lazy paths)
    ├── outcomeInferer.ts     age-based abandoned inference
    ├── sessionsIndex.ts      imports ghost (pruned-transcript) sessions
    ├── systemTags.ts         shared SYSTEM_TAG_RE
    ├── contentIndexer.ts     background FTS populate, source-aware
    ├── watcher.ts            chokidar add/change/unlink (Claude Code only for now)
    └── codex/                Codex CLI source adapter (extract + scan + transcript + sessionText)

webview/src/
├── App.tsx                   5-tab layout: Sessions · Knowledge · Insights · Ideas · Reviewer
├── messaging.ts              MIRROR of host messaging.ts
├── styles.css                --sesh-* design tokens, theme-decoupled muted text
├── components/
│   ├── TabBar.tsx            tab navigation
│   ├── SessionsTab.tsx       session list + detail pane
│   ├── InsightsTab.tsx       4 sub-views: Today · By file · Models · Records
│   ├── AnalyticsChip.tsx     outcome dot · cost · model badge on session rows
│   ├── PlaceholderTab.tsx    stub for Knowledge / Ideas / Reviewer
│   └── insights/             StandupView · CostView · LeaderboardView · RecordsView
└── hooks/                    useSessions, useSessionDetail, useCategories, useAllTags, useProjects, useInsights
```

### Design invariants

These are intentionally load-bearing — don't refactor them away without thinking hard:

- **Top-level JSONL only counts as a session.** `<encoded-cwd>/<id>.jsonl` is a session; `<encoded-cwd>/<id>/subagents/agent-*.jsonl` is **not** — it's a subagent invocation inside the parent session.
- **`sessions-index.json` is the ghost ledger.** Claude Code keeps it as a permanent record. After pruning, the JSONL is gone but the entry remains. Sesh imports those as `orphaned=1` rows so the user keeps title + metadata even though the transcript is gone.
- **Annotations live in Sesh's DB only.** Editing a title/category/tag/notes never touches the source JSONL.
- **Project / folder is intrinsic.** Every session has a `cwd` field in its first JSONL record — that's the "Folder" value.
- **Panel resume needs cwd match.** Claude Code's bundled `extension.js` resolves the panel resume command against `workspaceFolders[0]` only — there's no API path to resume cross-workspace.

## Contributing

Issues and PRs welcome. The project follows a tight TDD-discipline pattern — every meaningful behavior change ships with a unit test next to the file it touches. See the commit history for the cadence.

Before opening a PR:

```bash
npm run typecheck
npm rebuild better-sqlite3 && npm test
npx @electron/rebuild -f -w better-sqlite3 -v 39.8.8
npm run build
```

All four must pass.

## License

[MIT](LICENSE) © Michael Bluman.
