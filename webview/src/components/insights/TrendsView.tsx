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
  const bw = rows.length > 0 ? W / rows.length : W;
  if (rows.length === 0 || values.every((v) => v === 0)) return <div className="sesh-trends-empty">No activity in {label.toLowerCase()} this month.</div>;
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
