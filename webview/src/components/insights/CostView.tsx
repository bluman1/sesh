import { useMemo, useState } from "react";
import { useInsights } from "../../hooks/useInsights";
import { type InsightsRange, RANGE_TITLE } from "./range";
import { fmtUsd, fmtCount, pluralize } from "./format";

interface Row { path: string; usd: number; tool_calls: number; sessions: number; }

type SortKey = "cost" | "calls" | "sessions" | "perCall";

function shortPath(p: string): string {
  const parts = p.split("/").filter((x) => x.length > 0);
  if (parts.length <= 2) return p;
  return ".../" + parts.slice(-2).join("/");
}

function fileKind(p: string): "test" | "config" | "doc" | "code" {
  if (/\.(test|spec)\.[a-z]+$/i.test(p)) return "test";
  if (/\.(json|yaml|yml|toml|ini|env)$/i.test(p) || /package\.json$/.test(p)) return "config";
  if (/\.(md|mdx|txt|rst)$/i.test(p)) return "doc";
  return "code";
}

interface Props { range: InsightsRange; }

export function CostView({ range }: Props): JSX.Element {
  const { payload } = useInsights("cost", range);
  const [sortKey, setSortKey] = useState<SortKey>("cost");

  const rows = (payload ?? []) as Row[];

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      switch (sortKey) {
        case "cost": return b.usd - a.usd;
        case "calls": return b.tool_calls - a.tool_calls;
        case "sessions": return b.sessions - a.sessions;
        case "perCall": return (b.usd / Math.max(1, b.tool_calls)) - (a.usd / Math.max(1, a.tool_calls));
      }
    });
    return arr;
  }, [rows, sortKey]);

  if (!payload) return <div>Loading…</div>;
  if (rows.length === 0) return <div>No file-attributed cost for {RANGE_TITLE[range].toLowerCase()}.</div>;

  const total = rows.reduce((acc, r) => acc + r.usd, 0);
  const totalCalls = rows.reduce((acc, r) => acc + r.tool_calls, 0);
  const top = sorted[0];
  const topShare = total > 0 ? top.usd / total : 0;
  // Cumulative share — how many files account for 80% of spend?
  const cumulative: number[] = [];
  let acc = 0;
  for (const r of [...rows].sort((a, b) => b.usd - a.usd)) {
    acc += r.usd;
    cumulative.push(acc / Math.max(0.0001, total));
  }
  const filesFor80 = cumulative.findIndex((c) => c >= 0.8) + 1;

  // Derive hint signals.
  const concentrated = topShare >= 0.4;
  const longTail = filesFor80 > 0 && filesFor80 / rows.length >= 0.6;
  const expensiveCallFiles = sorted
    .filter((r) => r.tool_calls > 0 && r.usd / r.tool_calls > 0.4)
    .slice(0, 3);
  const hotCrossSession = sorted
    .filter((r) => r.sessions >= 3)
    .slice(0, 3);

  const limit = 50;
  const visible = sorted.slice(0, limit);

  return (
    <div className="sesh-mag">
      {/* Hero */}
      <div className="sesh-mag-hero">
        <div className="sesh-mag-hero-num">{fmtUsd(total)}</div>
        <div className="sesh-mag-hero-sub">
          <span>across {rows.length} {pluralize(rows.length, "file")}</span>
          <span className="sesh-mag-hero-dot">·</span>
          <span>{fmtCount(totalCalls)} tool {pluralize(totalCalls, "call")}</span>
          <span className="sesh-mag-hero-dot">·</span>
          <span>{RANGE_TITLE[range].toLowerCase()}</span>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="sesh-mag-kpis">
        <Kpi label="Top file" value={`${(topShare * 100).toFixed(0)}%`} sub={shortPath(top.path)} tone={concentrated ? "warn" : "neutral"} />
        <Kpi label="Files for 80%" value={filesFor80 > 0 ? `${filesFor80}` : "—"} sub={`of ${rows.length} total`} />
        <Kpi label="Avg per file" value={fmtUsd(total / Math.max(1, rows.length))} />
        <Kpi label="Avg per tool call" value={totalCalls > 0 ? fmtUsd(total / totalCalls) : "—"} />
      </div>

      {/* Insights / suggestions */}
      {(concentrated || expensiveCallFiles.length > 0 || hotCrossSession.length > 0) && (
        <section className="sesh-mag-card">
          <header className="sesh-mag-card-head">
            <h3 className="sesh-mag-card-title">Action ideas</h3>
          </header>
          <ul className="sesh-cost-actions">
            {concentrated && (
              <li>
                <strong>{shortPath(top.path)}</strong> alone ate{" "}
                <span className="sesh-cost-action-emphasis">{(topShare * 100).toFixed(0)}%</span>{" "}
                of today's spend. If it's a config or memory file, consider adding its key invariants to{" "}
                <code>CLAUDE.md</code> so future sessions don't reload it from scratch.
              </li>
            )}
            {longTail && (
              <li>
                Spend is spread out — top 80% needs{" "}
                <span className="sesh-cost-action-emphasis">{filesFor80}</span> files. Healthy distribution; no obvious hotspot to fix.
              </li>
            )}
            {expensiveCallFiles.length > 0 && (
              <li>
                High <span className="sesh-cost-action-emphasis">$/tool-call</span>:{" "}
                {expensiveCallFiles.map((f, i) => (
                  <span key={f.path}>
                    {i > 0 && ", "}
                    <code title={f.path}>{shortPath(f.path)}</code>{" "}
                    <span className="sesh-cost-action-meta">({fmtUsd(f.usd / f.tool_calls)}/call)</span>
                  </span>
                ))}
                . Each touch is expensive — likely a long file. Splitting or summarizing it could cut cost.
              </li>
            )}
            {hotCrossSession.length > 0 && (
              <li>
                Touched in many sessions:{" "}
                {hotCrossSession.map((f, i) => (
                  <span key={f.path}>
                    {i > 0 && ", "}
                    <code title={f.path}>{shortPath(f.path)}</code>{" "}
                    <span className="sesh-cost-action-meta">({f.sessions} sessions)</span>
                  </span>
                ))}
                . Strong CLAUDE.md candidates — document what they do once instead of re-explaining each session.
              </li>
            )}
          </ul>
        </section>
      )}

      {/* Table */}
      <section className="sesh-mag-card">
        <header className="sesh-mag-card-head">
          <h3 className="sesh-mag-card-title">Files</h3>
          <div className="sesh-cost-sort">
            <SortBtn k="cost" label="Cost" current={sortKey} onPick={setSortKey} />
            <SortBtn k="perCall" label="$/call" current={sortKey} onPick={setSortKey} />
            <SortBtn k="calls" label="Calls" current={sortKey} onPick={setSortKey} />
            <SortBtn k="sessions" label="Sessions" current={sortKey} onPick={setSortKey} />
          </div>
        </header>
        <table className="sesh-cost-table">
          <thead>
            <tr>
              <th>File</th>
              <th className="numeric">Cost</th>
              <th className="numeric">$/call</th>
              <th className="numeric">Calls</th>
              <th className="numeric">Sessions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const share = total > 0 ? r.usd / total : 0;
              const perCall = r.tool_calls > 0 ? r.usd / r.tool_calls : 0;
              const kind = fileKind(r.path);
              return (
                <tr key={r.path}>
                  <td title={r.path}>
                    <span className={`sesh-cost-kind sesh-cost-kind-${kind}`} aria-hidden />
                    <span className="sesh-cost-path">{shortPath(r.path)}</span>
                  </td>
                  <td className="numeric sesh-cost-cost-cell">
                    <div className="sesh-cost-share-bar">
                      <div className="sesh-cost-share-bar-fill" style={{ width: `${(share * 100).toFixed(1)}%` }} />
                    </div>
                    <span className="sesh-cost-cost-amount">{fmtUsd(r.usd)}</span>
                    <span className="sesh-cost-cost-share">{(share * 100).toFixed(0)}%</span>
                  </td>
                  <td className="numeric">{fmtUsd(perCall)}</td>
                  <td className="numeric">{fmtCount(r.tool_calls)}</td>
                  <td className="numeric">{fmtCount(r.sessions)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > limit && (
          <div className="sesh-cost-table-more">… and {rows.length - limit} more</div>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" | "neutral" }): JSX.Element {
  return (
    <div className={`sesh-mag-kpi sesh-mag-kpi-${tone ?? "neutral"}`}>
      <div className="sesh-mag-kpi-label">{label}</div>
      <div className="sesh-mag-kpi-value">{value}</div>
      {sub && <div className="sesh-mag-kpi-sub" title={sub}>{sub}</div>}
    </div>
  );
}

function SortBtn({ k, label, current, onPick }: { k: SortKey; label: string; current: SortKey; onPick: (k: SortKey) => void }): JSX.Element {
  return (
    <button
      type="button"
      className={`sesh-cost-sort-btn${current === k ? " is-active" : ""}`}
      onClick={() => onPick(k)}
    >
      {label}
    </button>
  );
}
