# Sesh (extension)

VSCode extension package for Sesh.

## Status

**Plan A — Foundation: shipped.** Indexer reads `~/.claude/projects/*/*.jsonl` on activation and persists session metadata to `~/.sesh/db.sqlite`. No UI yet — the `Sesh: Open` command is a stub.

## Development

```bash
npm install
npm run build
npm test
```

To run the extension in a dev host:

1. Open this directory in VSCode.
2. Press F5.

## Native binary toggling (real)

`better-sqlite3` is a native module. Its prebuilt binary at `node_modules/better-sqlite3/build/Release/better_sqlite3.node` targets ONE runtime at a time:

- **For tests (host Node):** `npm rebuild better-sqlite3`
- **For dev host (VSCode's Electron):** `npx @electron/rebuild -f -w better-sqlite3 -v 39.8.8`

Switching contexts overwrites the binary. The `-v 39.8.8` pin matches VSCode 1.118.1's Electron version — re-check `/Applications/Visual Studio Code.app/Contents/Resources/app/package.json` if VSCode updates and the rebuild fails.

If this toggle becomes painful, the fallback is to switch to `@sqlite.org/sqlite-wasm` (WASM, no native binary). That's tracked in the design doc as an open item.

## Commands

- **Sesh: Show stats** — shows the count of indexed sessions.
- **Sesh: Open** — stub; webview ships in Plan B.

## Storage

- Sessions DB: `~/.sesh/db.sqlite` (SQLite, WAL mode).
- Source data: `~/.claude/projects/*/*.jsonl` (read-only, never modified).
