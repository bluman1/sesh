import { useInsights } from "../../hooks/useInsights";

interface Row { path: string; usd: number; tool_calls: number; sessions: number; }

export function CostView(): JSX.Element {
  const { payload } = useInsights("cost", 30);
  if (!payload) return <div>Loading…</div>;
  const rows = payload as Row[];
  if (rows.length === 0) return <div>No file-attributed cost in the last 30 days.</div>;
  return (
    <div>
      <h2>Cost by file (last 30 days)</h2>
      <table className="sesh-insights-table">
        <thead>
          <tr><th>File</th><th>Cost</th><th>Tool calls</th><th>Sessions</th></tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((r) => (
            <tr key={r.path}>
              <td title={r.path}>{r.path.split("/").slice(-2).join("/")}</td>
              <td>${r.usd.toFixed(2)}</td>
              <td>{r.tool_calls}</td>
              <td>{r.sessions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
