import { useInsights } from "../../hooks/useInsights";

interface Row { path: string; usd: number; tool_calls: number; sessions: number; }

function shortPath(p: string): string {
  const parts = p.split("/").filter((x) => x.length > 0);
  if (parts.length <= 2) return p;
  return ".../" + parts.slice(-2).join("/");
}

function pluralize(n: number, singular: string, plural = singular + "s"): string {
  return n === 1 ? singular : plural;
}

export function CostView(): JSX.Element {
  const { payload } = useInsights("cost", 30);
  if (!payload) return <div>Loading…</div>;
  const rows = payload as Row[];
  if (rows.length === 0) return <div>No file-attributed cost in the last 30 days.</div>;

  const total = rows.reduce((acc, r) => acc + r.usd, 0);

  return (
    <div>
      <div className="sesh-insights-table-title">
        <span className="sesh-insights-table-title-label">
          Cost by file (last 30 days)
        </span>
        <span className="sesh-insights-table-title-total">
          Total: ${total.toFixed(2)}
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
              <td className="numeric">${r.usd.toFixed(2)}</td>
              <td className="numeric">
                {r.tool_calls} {pluralize(r.tool_calls, "call")}
              </td>
              <td className="numeric">
                {r.sessions} {pluralize(r.sessions, "session")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
