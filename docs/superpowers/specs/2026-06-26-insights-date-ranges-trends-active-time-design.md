# Insights: custom date ranges, monthly Trends chart, active-time fix

Date: 2026-06-26
Status: Approved (design) — pending spec review

## Motivation

Three related asks for the Insights tab:

1. The sub-tabs only filter by fixed presets (Today / 7d / 30d / 1y / All). Users want an arbitrary **custom date range**.
2. Users want to **see daily values over a month** (a daily bar chart on a monthly basis) for six metrics: total cost, sessions, number of turns, active time, cache hit, and per-turn cost.
3. The existing **"active time" calculation is buggy** — it reports the span between the first and last turn, which counts all idle time and is meaningless across multiple days.

All three are addressable without DB schema changes: `turns.ts` is a per-turn UNIX-ms timestamp, indexed (`idx_turns_ts`), and the analytics queries already accept an arbitrary `since`.

## Goals

- Add a custom start–end date range to the Insights sub-tabs that filter by time (Standup, By file, Models), alongside the existing presets.
- Add a **Trends** sub-tab: a month navigator + a single daily bar chart with a switcher across the six metrics.
- Replace the active-time definition with a defensible "active working time" metric (sum of inter-turn gaps, capping idle), and use it both for the period figure (bug fix) and the new per-day chart.

## Non-goals

- No charting library (hand-rolled SVG, consistent with existing CSS bars).
- No DB schema/migration changes.
- No prior-period ("vs") comparison for custom ranges or for the Trends chart.
- Records and Style sub-tabs remain range-independent (unchanged).
- The Trends month navigator is independent of the sub-tab preset/custom range (Trends is inherently monthly).

## Current state (verified)

- Period type: `InsightsRange = "today" | "7d" | "30d" | "1y" | "all"` in `webview/src/components/insights/range.ts` (options + titles in the same file).
- Selector + sub-tabs: `webview/src/components/InsightsTab.tsx` (sub-tab list ~10-17; range button group ~40-50). Sub-views in `webview/src/components/insights/` (`StandupView.tsx`, `CostView.tsx`, `LeaderboardView.tsx`, `RecordsView.tsx`, `StyleView.tsx`).
- Fetch: `webview/src/hooks/useInsights.ts` posts `{ kind:"getInsights", tab, range }` on tab/range change.
- Messaging (kept identical in both files): `webview/src/messaging.ts` and `src/messaging.ts` — request `getInsights` carries `range`; response `{ kind:"insights", tab, payload }`.
- Host: `src/host/seshPanel.ts` `getInsights` handler (~379-441) and `sinceMsForRange` (~1020-1032) convert the range string → `sinceMs` (and a `priorRange {start,end}` for standup).
- Queries: `src/db/analyticsQueries.ts` — `usdForTurn` (~39-54) + `MODEL_PRICING` (~5-37); `standupSummary` (~359-550) filters `t.ts >= ?` / `last_active_at >= ?`; `costByFile`, `modelLeaderboard`, `sessionsForFile` all filter `ts >= ?` only (no upper bound).
- **Active time today**: `standupSummary` tracks `firstTs`/`lastTs` = min/max `turns.ts` in the period (~411-412, ~541-543) and returns `activeHours: { firstTs, lastTs }`. `StandupView.tsx:261` renders `fmtTime(firstTs) – fmtTime(lastTs)` — a time-of-day window, wrong for multi-day ranges.
- Webview stack: React 18 + Vite, **no charting lib**; visualizations are CSS `<div>` bars; theme tokens in `webview/src/styles.css` (`--vscode-charts-*`, `--sesh-*`); `Tooltip.tsx` available.

## Design

### A. Active time (shared)

New pure helper (e.g. `src/db/activeTime.ts`):

```
activeMsFromTurns(timestampsMs: number[], capMs = ACTIVE_IDLE_CAP_MS): number
```

- Sort ascending. Sum each consecutive gap `g = ts[i+1] - ts[i]` where `g <= capMs`. Skip gaps `> capMs` (stepped away). Isolated turns / empty input → 0.
- `ACTIVE_IDLE_CAP_MS = 30 * 60_000` (named constant, easy to tune).

Used in two places:

1. **Bug fix (period figure):** `standupSummary` stops returning `activeHours: {firstTs,lastTs}` and instead returns `activeMs: number` computed via `activeMsFromTurns` over all turns in the period. `StandupView` magazine hero renders a duration (e.g. `"3h 42m active"`) instead of `fmtTime(firstTs) – fmtTime(lastTs)`.
2. **Per-day chart:** see B.

Decision: a gap that straddles local midnight is attributed to the **earlier** day. (Minor; documented.)

### B. Trends query

New query in `analyticsQueries.ts`:

```
dailyMetrics({ db, monthStartMs, monthEndMs }): DailyMetric[]
```

- Select the month's turns: `model, tokens_in, tokens_out, tokens_cache_read, tokens_cache_create, session_id, ts` where `ts >= monthStartMs AND ts < monthEndMs`, ordered by `ts`.
- Bucket each turn into a **local calendar day** in JS (so days match the user's timezone, not UTC).
- Per day compute: `cost` (sum `usdForTurn`), `turns` (count), `sessions` (distinct `session_id`), `activeMs` (`activeMsFromTurns` over that day's turn timestamps), `cacheHitRate` (`sum(cache_read) / sum(tokens_in + cache_read)`, 0 if denom 0), `costPerTurn` (`cost / turns`, 0 if 0 turns).
- **Zero-fill** every calendar day of the month so the chart shows a continuous run of bars.

`DailyMetric = { day: string /* YYYY-MM-DD local */, cost, sessions, turns, activeMs, cacheHitRate, costPerTurn }`.

### C. Custom range (queries + host + messaging)

- Add optional `until?: number` (exclusive or end-of-day inclusive — pick inclusive end-of-day, documented) to `standupSummary`, `costByFile`, `modelLeaderboard`, `sessionsForFile`. SQL gains `AND ts <= ?` only when `until` is provided. Presets pass `until = now`; "all" passes no bounds.
- Messaging: extend `getInsights` to `{ kind:"getInsights", tab, range } | { kind:"getInsights", tab, range:"custom", start:number, end:number }`, where `start`/`end` are already millisecond bounds — the **webview** converts the two date-picker values to local **start-of-day** (`start`) and local **end-of-day** (`end`) ms before posting. Add `{ kind:"getDailyMetrics", month:string /* YYYY-MM */ }` → `{ kind:"dailyMetrics", month, payload: DailyMetric[] }`. Mirror in both `messaging.ts` files.
- Host: for presets the handler keeps using `sinceMsForRange`; for `range:"custom"` it reads `msg.start`/`msg.end` directly as `since`/`until` (no recomputation) and skips the prior-range. New `getDailyMetrics` handler parses `month` and computes the month's local `[monthStartMs, monthEndMs)` boundaries, then calls `dailyMetrics`.

### D. Webview

- **Custom range** — `InsightsTab.tsx`: a "Custom…" chip after the presets toggles a small panel with two `<input type="date">` (start, end). Selecting both sets `range="custom"` and posts `{start,end}` (as ms). `useInsights` includes start/end in its dependency/payload. Prior-period comparison UI is hidden when `range==="custom"`. Records/Style unaffected.
- **Trends sub-tab** — add `"trends"` to the sub-tab list; new `TrendsView.tsx` + `useDailyMetrics` hook:
  - Month navigator `‹ June 2026 ›` (state: current month; defaults to this month; can't go past current month).
  - Metric switcher: Cost / Sessions / Turns / Active / Cache hit / $/turn.
  - One hand-rolled **SVG bar chart**: one bar per day of the month, y-scaled to the selected metric's max, theme-aware fills (`--vscode-charts-*`), value formatted per metric (USD, count, duration, %). Hover tooltip (reuse `Tooltip.tsx`) → day + formatted value. Empty month → friendly empty state.

### E. Testing

- `activeMsFromTurns`: empty, single turn, all-within-cap, gap exactly at cap, gaps over cap excluded, unsorted input.
- `dailyMetrics`: bucketing across local midnight, zero-fill of inactive days, cache-hit and $/turn math, sessions distinct-count per day.
- `standupSummary`: returns `activeMs` (replaces `activeHours`); `until` upper-bound filtering excludes turns after `until`.
- `costByFile` / `modelLeaderboard` / `sessionsForFile`: `until` upper-bound filtering.

## Files touched (anticipated)

- New: `src/db/activeTime.ts`, `webview/src/components/insights/TrendsView.tsx` (+ css), `webview/src/hooks/useDailyMetrics.ts`, tests.
- Edit: `src/db/analyticsQueries.ts`, `src/host/seshPanel.ts`, `src/messaging.ts`, `webview/src/messaging.ts`, `webview/src/components/InsightsTab.tsx`, `webview/src/components/insights/range.ts`, `webview/src/components/insights/StandupView.tsx`, `webview/src/hooks/useInsights.ts`.

## Open decisions captured (defaults chosen)

- Idle cap = 30 min (named constant).
- Cross-midnight gap → earlier day.
- Custom `end` interpreted as inclusive end-of-day, local time.
- Magazine hero shows active **duration** (replaces the time-of-day window).
- Daily buckets use the host's **local** timezone.
