import { useInsights } from "../../hooks/useInsights";
import { type InsightsRange, RANGE_TITLE } from "./range";
import { fmtUsd, fmtCount, pluralize } from "./format";

interface Row { path: string; usd: number; tool_calls: number; sessions: number; }

function shortPath(p: string): string {
  const parts = p.split("/").filter((x) => x.length > 0);
  if (parts.length <= 2) return p;
  return ".../" + parts.slice(-2).join("/");
}

interface Props { range: InsightsRange; }

export function CostView({ range }: Props): JSX.Element {
  const { payload } = useInsights("cost", range);

  if (!payload) return <div>Loading…</div>;
  const rows = payload as Row[];
  if (rows.length === 0) return <div>No file-attributed cost for {RANGE_TITLE[range].toLowerCase()}.</div>;

  const total = rows.reduce((acc, r) => acc + r.usd, 0);

  return (
    <div>
      <div className="sesh-insights-table-title">
        <span className="sesh-insights-table-title-label">
          Cost by file ({RANGE_TITLE[range].toLowerCase()})
        </span>
        <span className="sesh-insights-table-title-total">
          Total: {fmtUsd(total)}
        </span>
      </div>
      <table className="sesh-insights-table">
        <thead>
          <tr>
            <th>File</th>
            <th className="numeric">Cost</th>
            <th className="numeric">Tool calls</th>
            <th className="numeric">Sessions</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((r) => (
            <tr key={r.path}>
              <td title={r.path}>{shortPath(r.path)}</td>
              <td className="numeric">{fmtUsd(r.usd)}</td>
              <td className="numeric">
                {fmtCount(r.tool_calls)} {pluralize(r.tool_calls, "call")}
              </td>
              <td className="numeric">
                {fmtCount(r.sessions)} {pluralize(r.sessions, "session")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
