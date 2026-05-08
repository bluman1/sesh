# Sesh

Browse, annotate, and resume saved Claude Code and Codex CLI sessions — without leaving VSCode.

Sesh indexes the JSONL transcripts those CLIs already write to disk, gives you a fast filterable list, lets you tag and categorise sessions, full-text search across every transcript, and resume any session with one click.

## What it does

- **One panel for every saved session.** Activity bar entry, secondary-sidebar entry, editor-title button, or `Cmd+Shift+P → Sesh: Open`. Pick whichever fits your layout.
- **Search.** FTS5 across annotations and transcript content; matched terms are highlighted in titles and the transcript body.
- **Annotate.** Custom titles, colored categories, free-form tags, notes, favorited, archived. Annotations live in Sesh's own SQLite — your source JSONL files are never modified.
- **Scope filter.** Current folder, all projects, or pick a specific folder from the dropdown.
- **Transcript rendering.** Markdown + GFM for assistant text, default-collapsed tool-use / tool-result / thinking cards, line-by-line diff for Edit/Write tool calls, Prism syntax highlighting in fenced code, inline images for screenshot-bearing messages, per-tool codicons.
- **Resume.** In a terminal (`claude --resume <id>` or `codex resume <id>`, run in the session's cwd) or in the Claude Code editor panel when the workspace matches.
- **Ghost sessions.** Imports entries from Claude Code's `sessions-index.json` so titles and metadata survive transcript pruning. Pair with the `sesh.archiveTranscripts` setting to keep the bodies too.
- **Project remap.** Detects renamed folders by basename and offers to merge legacy sessions under the new path.

## Sources supported

| Source | Storage location |
|---|---|
| Claude Code | `~/.claude/projects/<encoded-cwd>/<id>.jsonl` |
| Codex CLI | `~/.codex/sessions/<year>/<month>/<day>/rollout-<ts>-<id>.jsonl` |

## Settings

| Key | Default | Effect |
|---|---|---|
| `sesh.openOnActivation` | `false` | Auto-open the panel on VSCode startup. |
| `sesh.transcriptLimit` | `10000` | Max recent messages loaded into the detail pane. |
| `sesh.archiveTranscripts` | `false` | Keep a gzipped sidecar of each transcript at `~/.sesh/transcripts/<id>.jsonl.gz` so pruned sessions stay readable. Run `Sesh: Show archive size` to inspect. |

## Commands

- `Sesh: Open` — opens or focuses the panel.
- `Sesh: Show stats` — info message with the indexed session count.
- `Sesh: Rescan all projects` — re-scan + reimport ghosts + reindex FTS.
- `Sesh: Show archive size` — disk size of the opt-in archive directory.

## Storage

- DB: `~/.sesh/db.sqlite` (SQLite, WAL, FTS5).
- Source data: read-only; Sesh never writes to your CLI's session files.
- Optional archive: `~/.sesh/transcripts/<id>.jsonl.gz` (only when enabled).

## Development

```bash
npm install
npm run typecheck                                            # tsc --noEmit
npm test                                                     # 101 tests pass
npm run build                                                # bundles extension + webview
npx @electron/rebuild -f -w better-sqlite3 -v 39.8.8         # before pressing F5
```

`better-sqlite3` is a native module — its prebuilt binary targets one runtime at a time. Use `npm rebuild better-sqlite3` to switch back to host Node for the test runner. The `39.8.8` pin matches VSCode's bundled Electron; re-check `/Applications/Visual Studio Code.app/Contents/Resources/app/package.json` if VSCode updates.

See `HANDOFF.md` at the repo root for the architecture overview and continuation notes.
