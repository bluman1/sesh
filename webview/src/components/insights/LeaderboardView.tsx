import { useInsights } from "../../hooks/useInsights";

interface Row { model: string; turns: number; tokens_in_total: number; tokens_out_total: number; usd: number; }

function shortModel(m: string): string {
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  return m;
}

export function LeaderboardView(): JSX.Element {
  const { payload } = useInsights("leaderboard", 30);
  if (!payload) return <div>Loading…</div>;
  const rows = payload as Row[];
  if (rows.length === 0) return <div>No model usage in the last 30 days.</div>;

  const total = rows.reduce((acc, r) => acc + r.usd, 0);

  return (
    <div>
      <div className="sesh-insights-table-title">
        <span className="sesh-insights-table-title-label">
          Model leaderboard (last 30 days)
        </span>
        <span className="sesh-insights-table-title-total">
          Total: ${total.toFixed(2)}
        </span>
      </div>
      <table className="sesh-insights-table">
        <thead>
          <tr>
            <th>Model</th>
            <th className="numeric">Turns</th>
            <th className="numeric">Tokens in</th>
            <th className="numeric">Tokens out</th>
            <th className="numeric">USD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.model}>
              <td title={r.model}>{shortModel(r.model)}</td>
              <td className="numeric">{r.turns.toLocaleString()}</td>
              <td className="numeric">{r.tokens_in_total.toLocaleString()}</td>
              <td className="numeric">{r.tokens_out_total.toLocaleString()}</td>
              <td className="numeric">${r.usd.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
