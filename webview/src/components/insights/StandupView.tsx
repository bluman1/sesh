import { useState } from "react";
import { useInsights } from "../../hooks/useInsights";
import { type InsightsRange, RANGE_TITLE } from "./range";
import { fmtUsd, fmtCount, pluralize } from "./format";

interface ModelShareRow { model: string; share: number; usd: number; tokens_total: number; }
interface OutcomeCounts { open: number; shipped: number; shipped_partial: number; reverted: number; abandoned: number; }
interface ToolCount { name: string; count: number; }
interface PriorComparison { totalUsd: number; totalSessions: number; outcomesShipped: number; rangeLabel: string; }

interface StandupPayload {
  totalSessions: number;
  totalTurns: number;
  totalUsd: number;
  perProject: { project_path: string; sessions: number; usd: number }[];
  activeHours: { firstTs: number; lastTs: number } | null;
  modelBreakdown: ModelShareRow[];
  outcomes: OutcomeCounts;
  topFile: { path: string; usd: number; sessions: number } | null;
  topTools: ToolCount[];
  cacheHitRate: number;
  corrections: number;
  costPerTurn: number;
  costPerShipped: number | null;
  comparison: PriorComparison | null;
}

type Mode = "magazine" | "standup";

function projectLabel(projectPath: string): string {
  if (!projectPath || projectPath === "/" || projectPath.trim() === "") {
    return "(no folder)";
  }
  const parts = projectPath.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return "(no folder)";
  const last = parts[parts.length - 1];
  return last.length > 40 ? last.slice(0, 39) + "…" : last;
}

function shortFilePath(p: string): string {
  const parts = p.split("/").filter((x) => x.length > 0);
  if (parts.length <= 2) return p;
  return ".../" + parts.slice(-2).join("/");
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).toLowerCase().replace(/\s/g, "");
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function shortModel(m: string): string {
  if (m.includes("opus")) return "Opus";
  if (m.includes("sonnet")) return "Sonnet";
  if (m.includes("haiku")) return "Haiku";
  return m;
}

function fmtDelta(current: number, prior: number): { text: string; direction: "up" | "down" | "flat" } {
  if (prior === 0 && current === 0) return { text: "no change", direction: "flat" };
  if (prior === 0) return { text: "new", direction: "up" };
  const diff = current - prior;
  const pct = Math.abs(diff) / prior;
  if (pct < 0.005) return { text: "no change", direction: "flat" };
  return {
    text: `${(pct * 100).toFixed(0)}%`,
    direction: diff < 0 ? "down" : "up",
  };
}

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }): JSX.Element {
  return (
    <section className="sesh-mag-card">
      <header className="sesh-mag-card-head">
        <h3 className="sesh-mag-card-title">{title}</h3>
        {right}
      </header>
      {children}
    </section>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" | "neutral" }): JSX.Element {
  return (
    <div className={`sesh-mag-kpi sesh-mag-kpi-${tone ?? "neutral"}`}>
      <div className="sesh-mag-kpi-label">{label}</div>
      <div className="sesh-mag-kpi-value">{value}</div>
    </div>
  );
}

function OutcomePill({ count, label, tone }: { count: number; label: string; tone: "good" | "warn" | "bad" | "muted" | "info" }): JSX.Element {
  return (
    <span className={`sesh-mag-outcome sesh-mag-outcome-${tone}${count === 0 ? " is-zero" : ""}`}>
      <span className={`sesh-mag-outcome-dot sesh-mag-outcome-dot-${tone}`} />
      <span className="sesh-mag-outcome-count">{count}</span>
      <span className="sesh-mag-outcome-label">{label}</span>
    </span>
  );
}

function DeltaRow(props: {
  label: string;
  current: number;
  prior: number;
  format: (n: number) => string;
  positiveIsGood: boolean;
}): JSX.Element {
  const { label, current, prior, format, positiveIsGood } = props;
  const delta = fmtDelta(current, prior);
  const semantic =
    delta.direction === "flat" ? "flat" :
    delta.direction === "up" ? (positiveIsGood ? "good" : "bad") :
    /* down */ (positiveIsGood ? "bad" : "good");
  const arrow =
    delta.direction === "up" ? "↑" : delta.direction === "down" ? "↓" : "·";
  return (
    <div className="sesh-mag-delta">
      <span className="sesh-mag-delta-label">{label}</span>
      <span className="sesh-mag-delta-current">{format(current)}</span>
      <span className={`sesh-mag-delta-trend sesh-mag-delta-${semantic}`}>
        <span className="sesh-mag-delta-arrow">{arrow}</span>
        <span>{delta.text}</span>
      </span>
      <span className="sesh-mag-delta-prior">was {format(prior)}</span>
    </div>
  );
}

function buildStandupProse(data: StandupPayload, range: InsightsRange): string {
  const lines: string[] = [];
  const period =
    range === "today" ? "Today" :
    range === "7d" ? "In the last 7 days" :
    range === "30d" ? "In the last 30 days" :
    range === "1y" ? "In the last year" :
    "All time";

  // Headline
  lines.push(
    `${period}: ${data.totalSessions} ${pluralize(data.totalSessions, "session")}, ${fmtCount(data.totalTurns)} turns, ${fmtUsd(data.totalUsd)}.`,
  );

  // Top model + share
  if (data.modelBreakdown.length > 0) {
    const top = data.modelBreakdown[0];
    lines.push(
      `Mostly ${shortModel(top.model)} (${fmtPct(top.share)}).`,
    );
  }

  // Outcomes
  const o = data.outcomes;
  const totalOutcomes = o.shipped + o.shipped_partial + o.reverted + o.abandoned + o.open;
  if (totalOutcomes > 0) {
    const parts: string[] = [];
    if (o.shipped > 0) parts.push(`${o.shipped} shipped`);
    if (o.shipped_partial > 0) parts.push(`${o.shipped_partial} partial`);
    if (o.reverted > 0) parts.push(`${o.reverted} reverted`);
    if (o.abandoned > 0) parts.push(`${o.abandoned} abandoned`);
    if (o.open > 0) parts.push(`${o.open} open`);
    lines.push(parts.join(" / ") + ".");
  }

  // Active hours
  if (data.activeHours) {
    lines.push(
      `Active ${fmtTime(data.activeHours.firstTs)} – ${fmtTime(data.activeHours.lastTs)}.`,
    );
  }

  // Cache hit rate
  if (data.cacheHitRate > 0) {
    lines.push(`Cache hit ${fmtPct(data.cacheHitRate)}.`);
  }

  // Heaviest project + heaviest file
  if (data.perProject.length > 0) {
    const top = data.perProject[0];
    lines.push(
      `Heaviest project: ${projectLabel(top.project_path)} (${fmtUsd(top.usd)}).`,
    );
  }
  if (data.topFile) {
    lines.push(
      `Heaviest file: ${shortFilePath(data.topFile.path)} (${fmtUsd(data.topFile.usd)}).`,
    );
  }

  // Comparison
  if (data.comparison) {
    const d = fmtDelta(data.totalUsd, data.comparison.totalUsd);
    const dir = d.direction === "down" ? "under" :
                d.direction === "up" ? "over" : "matching";
    lines.push(`${d.text} ${dir} ${data.comparison.rangeLabel}.`);
  }

  return lines.join(" ");
}

interface Props { range: InsightsRange; }

export function StandupView({ range }: Props): JSX.Element {
  // ALL hooks must be at the top — before any conditional return
  const { payload } = useInsights("standup", range);
  const [mode, setMode] = useState<Mode>("magazine");
  const [copied, setCopied] = useState(false);

  if (!payload) return <div>Loading…</div>;
  const data = payload as StandupPayload;
  const sorted = [...data.perProject].sort((a, b) => b.usd - a.usd);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(buildStandupProse(data, range));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      <div className="sesh-insights-mode-row">
        <h2 style={{ margin: 0 }}>{RANGE_TITLE[range]}</h2>
        <div className="sesh-insights-modes" role="tablist">
          <button
            className={`sesh-insights-mode${mode === "magazine" ? " is-active" : ""}`}
            onClick={() => setMode("magazine")}
            role="tab"
            aria-selected={mode === "magazine"}
          >
            Magazine
          </button>
          <button
            className={`sesh-insights-mode${mode === "standup" ? " is-active" : ""}`}
            onClick={() => setMode("standup")}
            role="tab"
            aria-selected={mode === "standup"}
          >
            Standup
          </button>
        </div>
      </div>

      {mode === "magazine" && (
        <div className="sesh-mag">
          {/* Hero */}
          <div className="sesh-mag-hero">
            <div className="sesh-mag-hero-num">{fmtUsd(data.totalUsd)}</div>
            <div className="sesh-mag-hero-sub">
              <span>{data.totalSessions} {pluralize(data.totalSessions, "session")}</span>
              <span className="sesh-mag-hero-dot">·</span>
              <span>{fmtCount(data.totalTurns)} turns</span>
              {data.activeHours && (
                <>
                  <span className="sesh-mag-hero-dot">·</span>
                  <span>{fmtTime(data.activeHours.firstTs)} – {fmtTime(data.activeHours.lastTs)}</span>
                </>
              )}
            </div>
          </div>

          {/* KPI tiles */}
          <div className="sesh-mag-kpis">
            <Kpi label="Cache hit" value={fmtPct(data.cacheHitRate)} tone={data.cacheHitRate >= 0.5 ? "good" : "neutral"} />
            <Kpi label="Per turn" value={fmtUsd(data.costPerTurn)} />
            <Kpi label="Corrections" value={fmtCount(data.corrections)} tone={data.corrections === 0 ? "good" : "neutral"} />
            {data.costPerShipped !== null && (
              <Kpi label="Per shipped" value={fmtUsd(data.costPerShipped)} />
            )}
          </div>

          {/* Outcomes pill row */}
          {(() => {
            const o = data.outcomes;
            const total = o.shipped + o.shipped_partial + o.reverted + o.abandoned + o.open;
            if (total === 0) return null;
            return (
              <div className="sesh-mag-outcomes">
                <OutcomePill count={o.shipped} label="shipped" tone="good" />
                <OutcomePill count={o.shipped_partial} label="partial" tone="warn" />
                <OutcomePill count={o.reverted} label="reverted" tone="bad" />
                <OutcomePill count={o.abandoned} label="abandoned" tone="muted" />
                <OutcomePill count={o.open} label="open" tone="info" />
              </div>
            );
          })()}

          {/* Projects card */}
          {sorted.length > 0 && (
            <Card title="Projects" right={<span className="sesh-mag-card-meta">{sorted.length} {pluralize(sorted.length, "project")}</span>}>
              <div className="sesh-mag-rows">
                {sorted.flatMap((p) => {
                  const share = data.totalUsd > 0 ? p.usd / data.totalUsd : 0;
                  return [
                    <div
                      key={`${p.project_path}-label`}
                      className="sesh-mag-row-label"
                      title={p.project_path}
                    >
                      {projectLabel(p.project_path)}
                    </div>,
                    <div key={`${p.project_path}-bar`} className="sesh-mag-bar">
                      <div
                        className="sesh-mag-bar-fill"
                        style={{ width: `${(share * 100).toFixed(1)}%` }}
                      />
                    </div>,
                    <div key={`${p.project_path}-value`} className="sesh-mag-row-value">
                      {fmtUsd(p.usd)}
                      <span className="sesh-mag-row-share">{(share * 100).toFixed(0)}%</span>
                    </div>,
                  ];
                })}
              </div>
            </Card>
          )}

          {/* Models + tools side-by-side */}
          <div className="sesh-mag-cards-row">
            {data.modelBreakdown.length > 0 && (
              <Card title="Models">
                <div className="sesh-mag-chips">
                  {data.modelBreakdown.map((m) => (
                    <span key={m.model} className="sesh-mag-chip">
                      <span className="sesh-mag-chip-strong">{shortModel(m.model)}</span>
                      <span className="sesh-mag-chip-weak">{fmtPct(m.share)}</span>
                    </span>
                  ))}
                </div>
              </Card>
            )}
            {data.topTools.length > 0 && (
              <Card title="Top tools">
                <div className="sesh-mag-chips">
                  {data.topTools.map((t) => (
                    <span key={t.name} className="sesh-mag-chip">
                      <span className="sesh-mag-chip-strong">{t.name}</span>
                      <span className="sesh-mag-chip-weak">{fmtCount(t.count)}</span>
                    </span>
                  ))}
                </div>
              </Card>
            )}
          </div>

          {/* Top file */}
          {data.topFile && (
            <Card title="Top file">
              <div className="sesh-mag-topfile">
                <span className="sesh-mag-topfile-path" title={data.topFile.path}>
                  {shortFilePath(data.topFile.path)}
                </span>
                <span className="sesh-mag-topfile-meta">
                  {fmtUsd(data.topFile.usd)} · {data.topFile.sessions} {pluralize(data.topFile.sessions, "session")}
                </span>
              </div>
            </Card>
          )}

          {/* vs prior */}
          {data.comparison && (
            <Card title={`vs ${data.comparison.rangeLabel}`}>
              <div className="sesh-mag-deltas">
                <DeltaRow
                  label="Spend"
                  current={data.totalUsd}
                  prior={data.comparison.totalUsd}
                  format={(n) => fmtUsd(n)}
                  positiveIsGood={false}
                />
                <DeltaRow
                  label="Sessions"
                  current={data.totalSessions}
                  prior={data.comparison.totalSessions}
                  format={(n) => fmtCount(n)}
                  positiveIsGood={true}
                />
                <DeltaRow
                  label="Shipped"
                  current={data.outcomes.shipped}
                  prior={data.comparison.outcomesShipped}
                  format={(n) => fmtCount(n)}
                  positiveIsGood={true}
                />
              </div>
            </Card>
          )}
        </div>
      )}

      {mode === "standup" && (
        <>
          <div className="sesh-insights-mode-row">
            <button className="sesh-standup-copy" onClick={handleCopy}>
              {copied ? (
                <span className="sesh-standup-copied">Copied!</span>
              ) : (
                "Copy as text"
              )}
            </button>
          </div>
          <div className="sesh-standup-prose">{buildStandupProse(data, range)}</div>
          <table className="sesh-insights-table">
            <thead>
              <tr>
                <th>Project</th>
                <th className="numeric">Sessions</th>
                <th className="numeric">Cost</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.project_path}>
                  <td title={p.project_path}>{projectLabel(p.project_path)}</td>
                  <td className="numeric">{fmtCount(p.sessions)}</td>
                  <td className="numeric">{fmtUsd(p.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
