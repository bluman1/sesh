import { useState } from "react";
import {
  useDailyMetrics,
  type DailyMetric,
  type DayValue,
  type MonthlySummary,
} from "../../hooks/useDailyMetrics";
import { fmtDuration, fmtUsd, fmtCount } from "./format";
import "./TrendsView.css";

type MetricKey = "cost" | "sessions" | "turns" | "activeMs" | "cacheHitRate" | "costPerTurn";

interface MetricCfg {
  key: MetricKey;
  label: string;
  fmt: (n: number) => string;
  /** Month-wide value for the readout default (NOT a naive sum of daily). */
  total: (s: MonthlySummary) => number;
}

const fmtUsd3 = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const METRICS: MetricCfg[] = [
  { key: "cost", label: "Total cost", fmt: fmtUsd, total: (s) => s.totalCost },
  { key: "sessions", label: "Sessions", fmt: (n) => fmtCount(Math.round(n)), total: (s) => s.totalSessions },
  { key: "turns", label: "Turns", fmt: (n) => fmtCount(Math.round(n)), total: (s) => s.totalTurns },
  { key: "activeMs", label: "Active time", fmt: fmtDuration, total: (s) => s.totalActiveMs },
  { key: "cacheHitRate", label: "Cache hit", fmt: (n) => `${Math.round(n * 100)}%`, total: (s) => s.cacheHitRate },
  { key: "costPerTurn", label: "$ / turn", fmt: fmtUsd3, total: (s) => s.costPerTurn },
];

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
function dayShort(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function dayNum(day: string): number {
  return Number(day.slice(8, 10));
}

export function TrendsView() {
  const [month, setMonth] = useState<string>(thisMonth());
  const [metric, setMetric] = useState<MetricKey>("cost");
  const data = useDailyMetrics(month);
  const cfg = METRICS.find((x) => x.key === metric)!;
  const atCurrent = month >= thisMonth();

  return (
    <div className="sesh-trends">
      <div className="sesh-trends-nav">
        <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">&#8249;</button>
        <span className="sesh-trends-month">{monthLabel(month)}</span>
        <button onClick={() => setMonth(shiftMonth(month, 1))} disabled={atCurrent} aria-label="Next month">&#8250;</button>
      </div>
      <div className="sesh-trends-metrics">
        {METRICS.map((x) => (
          <button key={x.key} className={x.key === metric ? "is-active" : ""} onClick={() => setMetric(x.key)}>
            {x.label}
          </button>
        ))}
      </div>
      {data === null ? (
        <div className="sesh-trends-empty">Loading…</div>
      ) : (
        <>
          <TrendChart days={data.days} summary={data.summary} metric={metric} cfg={cfg} />
          <TrendRecords summary={data.summary} />
        </>
      )}
    </div>
  );
}

function TrendChart({
  days,
  summary,
  metric,
  cfg,
}: {
  days: DailyMetric[];
  summary: MonthlySummary;
  metric: MetricKey;
  cfg: MetricCfg;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const values = days.map((r) => r[metric] as number);
  // Scale to the metric's own max so sub-$1 metrics ($/turn) and rates
  // (cache hit) show variation instead of hugging the axis.
  const max = Math.max(...values) || 1;
  const W = 100, H = 40, gap = 0.5;
  const bw = days.length > 0 ? W / days.length : W;
  const hasData = days.length > 0 && !values.every((v) => v === 0);

  if (!hasData) {
    return <div className="sesh-trends-empty">No activity in {cfg.label.toLowerCase()} this month.</div>;
  }

  const focus = hover !== null ? days[hover] : null;
  const readoutValue = focus ? cfg.fmt(focus[metric] as number) : cfg.fmt(cfg.total(summary));
  const readoutCaption = focus ? dayShort(focus.day) : `${cfg.label} · this month`;

  return (
    <div className="sesh-trends-chart">
      <div className="sesh-trends-readout">
        <span className="sesh-trends-readout-val">{readoutValue}</span>
        <span className="sesh-trends-readout-cap">{readoutCaption}</span>
      </div>
      <svg
        className="sesh-trends-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${cfg.label} per day`}
        onMouseLeave={() => setHover(null)}
      >
        {days.map((r, i) => {
          const v = r[metric] as number;
          const h = (v / max) * H;
          return (
            <rect
              key={`bar-${r.day}`}
              x={i * bw + gap}
              y={H - h}
              width={bw - gap * 2}
              height={h}
              className={"sesh-trends-bar" + (hover === i ? " is-focus" : "")}
            />
          );
        })}
        {/* Full-height transparent hit areas on top so any point in a day's
            column triggers hover, and carries the native tooltip. */}
        {days.map((r, i) => (
          <rect
            key={`hit-${r.day}`}
            x={i * bw}
            y={0}
            width={bw}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          >
            <title>{`${dayShort(r.day)}: ${cfg.fmt(r[metric] as number)}`}</title>
          </rect>
        ))}
      </svg>
      <div className="sesh-trends-axis" aria-hidden="true">
        {days.map((r, i) => {
          const n = dayNum(r.day);
          const show = i === 0 || i === days.length - 1 || n % 5 === 0;
          return (
            <span key={r.day} className="sesh-trends-axis-tick">
              {show ? n : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function TrendRecords({ summary: s }: { summary: MonthlySummary }) {
  if (s.totalTurns === 0) return null;
  const dv = (d: DayValue | null, fmt: (n: number) => string) =>
    d ? `${dayShort(d.day)} · ${fmt(d.value)}` : "—";
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const count = (n: number) => fmtCount(Math.round(n));
  return (
    <div className="sesh-trends-records">
      <div className="sesh-trends-records-title">This month</div>
      <div className="sesh-trends-records-grid">
        <Stat label="Total cost" value={fmtUsd(s.totalCost)} />
        <Stat label="Sessions" value={count(s.totalSessions)} />
        <Stat label="Turns" value={count(s.totalTurns)} />
        <Stat label="Active time" value={fmtDuration(s.totalActiveMs)} />
        <Stat label="Cache hit" value={pct(s.cacheHitRate)} />
        <Stat label="$ / turn" value={fmtUsd3(s.costPerTurn)} />
      </div>
      <div className="sesh-trends-records-title">Notable days</div>
      <div className="sesh-trends-records-grid">
        <Stat label="Top cost" value={dv(s.topCostDay, fmtUsd)} />
        <Stat label="Most turns" value={dv(s.topTurnsDay, count)} />
        <Stat label="Longest active" value={dv(s.topActiveDay, fmtDuration)} />
        <Stat label="Best cache" value={dv(s.bestCacheDay, pct)} />
        <Stat label="Worst cache" value={dv(s.worstCacheDay, pct)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="sesh-trends-stat">
      <div className="sesh-trends-stat-label">{label}</div>
      <div className="sesh-trends-stat-value">{value}</div>
    </div>
  );
}
