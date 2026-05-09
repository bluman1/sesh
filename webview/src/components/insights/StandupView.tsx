import { useState } from "react";
import { useInsights } from "../../hooks/useInsights";
import { type InsightsRange, RANGE_TITLE } from "./range";
import { fmtUsd, fmtCount, pluralize } from "./format";

interface StandupPayload {
  totalSessions: number;
  totalTurns: number;
  totalUsd: number;
  perProject: { project_path: string; sessions: number; usd: number }[];
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

function buildStandupProse(data: StandupPayload, range: InsightsRange): string {
  const projectCount = data.perProject.length;
  const sorted = [...data.perProject].sort((a, b) => b.usd - a.usd);
  const lines: string[] = [];
  const period =
    range === "today" ? "Today" :
    range === "7d" ? "In the last 7 days" :
    range === "30d" ? "In the last 30 days" :
    range === "1y" ? "In the last year" :
    "All time";
  lines.push(
    `${period}, ${data.totalSessions} ${pluralize(data.totalSessions, "session")} across ${projectCount} ${pluralize(projectCount, "project")} ran ${fmtCount(data.totalTurns)} turns and spent ${fmtUsd(data.totalUsd)}.`,
  );
  if (sorted.length > 0) {
    const top = sorted[0];
    lines.push(
      `Most of the cost (${fmtUsd(top.usd)}) was in ${projectLabel(top.project_path)} across ${top.sessions} ${pluralize(top.sessions, "session")}.`,
    );
  }
  if (sorted.length > 1) {
    const second = sorted[1];
    lines.push(
      `${projectLabel(second.project_path)} came in second at ${fmtUsd(second.usd)} (${second.sessions} ${pluralize(second.sessions, "session")}).`,
    );
  }
  return lines.join(" ");
}

interface Props { range: InsightsRange; }

export function StandupView({ range }: Props): JSX.Element {
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
            {fmtCount(data.totalSessions)} {pluralize(data.totalSessions, "session")} ·{" "}
            {fmtCount(data.totalTurns)} turns
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
