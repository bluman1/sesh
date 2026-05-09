import { useInsights } from "../../hooks/useInsights";

interface Row { model: string; turns: number; tokens_in_total: number; tokens_out_total: number; usd: number; }

export function LeaderboardView(): JSX.Element {
  const { payload } = useInsights("leaderboard", 30);
  if (!payload) return <div>Loading…</div>;
  const rows = payload as Row[];
  if (rows.length === 0) return <div>No model usage in the last 30 days.</div>;
  return (
    <div>
      <h2>Model leaderboard (last 30 days)</h2>
      <table className="sesh-insights-table">
        <thead>
          <tr><th>Model</th><th>Turns</th><th>Tokens in</th><th>Tokens out</th><th>USD</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.model}>
              <td>{r.model}</td>
              <td>{r.turns}</td>
              <td>{r.tokens_in_total.toLocaleString()}</td>
              <td>{r.tokens_out_total.toLocaleString()}</td>
              <td>${r.usd.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
