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

function ComparisonDelta(props: {
  current: number;
  prior: number;
  format: (n: number) => string;
  positiveIsGood: boolean;
}): JSX.Element {
  const { current, prior, format, positiveIsGood } = props;
  const delta = fmtDelta(current, prior);
  const semantic =
    delta.direction === "flat" ? "flat" :
    delta.direction === "up" ? (positiveIsGood ? "good" : "bad") :
    /* down */ (positiveIsGood ? "bad" : "good");
  const arrow =
    delta.direction === "up" ? "↑" : delta.direction === "down" ? "↓" : "·";
  return (
    <span className={`sesh-comparison sesh-comparison-${semantic}`}>
      <span className="sesh-vital-emphasis">{format(current)}</span>{" "}
      <span className="sesh-comparison-arrow">{arrow}</span>{" "}
      <span className="sesh-comparison-delta">{delta.text}</span>{" "}
      <span className="sesh-comparison-prior">(was {format(prior)})</span>
    </span>
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
        <>
          <div className="sesh-magazine-headline">{fmtUsd(data.totalUsd)}</div>
          <div className="sesh-magazine-subtitle">
            {data.totalSessions} {pluralize(data.totalSessions, "session")} ·{" "}
            {fmtCount(data.totalTurns)} turns
            {data.activeHours && (
              <> · {fmtTime(data.activeHours.firstTs)} – {fmtTime(data.activeHours.lastTs)}</>
            )}
          </div>

          <div className="sesh-magazine-section-label">Projects</div>
          <div className="sesh-magazine-rows">
            {sorted.flatMap((p) => {
              const share = data.totalUsd > 0 ? p.usd / data.totalUsd : 0;
              return [
                <div
                  key={`${p.project_path}-label`}
                  className="sesh-magazine-row-label"
                  title={p.project_path}
                >
                  {projectLabel(p.project_path)}
                </div>,
                <div key={`${p.project_path}-bar`} className="sesh-magazine-bar">
                  <div
                    className="sesh-magazine-bar-fill"
                    style={{ width: `${(share * 100).toFixed(1)}%` }}
                  />
                </div>,
                <div key={`${p.project_path}-value`} className="sesh-magazine-row-value">
                  {fmtUsd(p.usd)}
                </div>,
              ];
            })}
          </div>

          <div className="sesh-magazine-section-label">Shape of the day</div>
          <div className="sesh-vital-signs">
            {data.modelBreakdown.length > 0 && (
              <div className="sesh-vital-line">
                {data.modelBreakdown.map((m, i) => (
                  <span key={m.model}>
                    {i > 0 && " · "}
                    <span className="sesh-vital-emphasis">{fmtPct(m.share)}</span>{" "}
                    {shortModel(m.model)}
                  </span>
                ))}
              </div>
            )}
            <div className="sesh-vital-line">
              <span>
                <span className="sesh-vital-emphasis">{data.outcomes.shipped}</span> shipped
              </span>
              {" · "}
              <span>
                <span className="sesh-vital-emphasis">{data.outcomes.shipped_partial}</span> partial
              </span>
              {" · "}
              <span>
                <span className="sesh-vital-emphasis">{data.outcomes.reverted}</span> reverted
              </span>
              {" · "}
              <span>
                <span className="sesh-vital-emphasis">{data.outcomes.abandoned}</span> abandoned
              </span>
              {" · "}
              <span>
                <span className="sesh-vital-emphasis">{data.outcomes.open}</span> open
              </span>
            </div>
            <div className="sesh-vital-line">
              <span>
                <span className="sesh-vital-emphasis">{fmtPct(data.cacheHitRate)}</span>{" "}
                cache hit
              </span>
              {" · "}
              <span>
                <span className="sesh-vital-emphasis">{data.corrections}</span>{" "}
                {pluralize(data.corrections, "correction")}
              </span>
              {" · "}
              <span>
                <span className="sesh-vital-emphasis">{fmtUsd(data.costPerTurn)}</span> per turn
              </span>
              {data.costPerShipped !== null && (
                <>
                  {" · "}
                  <span>
                    <span className="sesh-vital-emphasis">{fmtUsd(data.costPerShipped)}</span>{" "}
                    per shipped
                  </span>
                </>
              )}
            </div>
          </div>

          {data.topFile && (
            <>
              <div className="sesh-magazine-section-label">Top file</div>
              <div className="sesh-vital-line" title={data.topFile.path}>
                <span className="sesh-vital-emphasis">{shortFilePath(data.topFile.path)}</span>{" "}
                — {fmtUsd(data.topFile.usd)} across{" "}
                {data.topFile.sessions} {pluralize(data.topFile.sessions, "session")}
              </div>
            </>
          )}

          {data.topTools.length > 0 && (
            <>
              <div className="sesh-magazine-section-label">Top tools</div>
              <div className="sesh-vital-line">
                {data.topTools.map((t, i) => (
                  <span key={t.name}>
                    {i > 0 && " · "}
                    {t.name}{" "}
                    <span className="sesh-vital-emphasis">({fmtCount(t.count)})</span>
                  </span>
                ))}
              </div>
            </>
          )}

          {data.comparison && (
            <>
              <div className="sesh-magazine-section-label">
                vs {data.comparison.rangeLabel}
              </div>
              <div className="sesh-vital-line">
                Spend:{" "}
                <ComparisonDelta
                  current={data.totalUsd}
                  prior={data.comparison.totalUsd}
                  format={(n) => fmtUsd(n)}
                  positiveIsGood={false}
                />
                {" · "}
                Sessions:{" "}
                <ComparisonDelta
                  current={data.totalSessions}
                  prior={data.comparison.totalSessions}
                  format={(n) => fmtCount(n)}
                  positiveIsGood={true}
                />
                {" · "}
                Shipped:{" "}
                <ComparisonDelta
                  current={data.outcomes.shipped}
                  prior={data.comparison.outcomesShipped}
                  format={(n) => fmtCount(n)}
                  positiveIsGood={true}
                />
              </div>
            </>
          )}
        </>
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
