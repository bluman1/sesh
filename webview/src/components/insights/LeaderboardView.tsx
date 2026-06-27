import { useInsights } from "../../hooks/useInsights";
import { type InsightsRange, RANGE_TITLE } from "./range";
import { fmtUsd, fmtCount } from "./format";

interface Row { model: string; turns: number; tokens_in_total: number; tokens_out_total: number; usd: number; }

function shortModel(m: string): string {
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  return m;
}

interface Props { range: InsightsRange; custom?: { start: number; end: number } | null; }

export function LeaderboardView({ range, custom }: Props): JSX.Element {
  const { payload } = useInsights("leaderboard", range, custom);

  if (!payload) return <div>Loading…</div>;
  const rows = payload as Row[];
  if (rows.length === 0) return <div>No model usage for {RANGE_TITLE[range].toLowerCase()}.</div>;

  const total = rows.reduce((acc, r) => acc + r.usd, 0);

  return (
    <div>
      <div className="sesh-insights-table-title">
        <span className="sesh-insights-table-title-label">
          Model leaderboard ({RANGE_TITLE[range].toLowerCase()})
        </span>
        <span className="sesh-insights-table-title-total">
          Total: {fmtUsd(total)}
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
              <td className="numeric">{fmtCount(r.turns)}</td>
              <td className="numeric">{r.tokens_in_total.toLocaleString()}</td>
              <td className="numeric">{r.tokens_out_total.toLocaleString()}</td>
              <td className="numeric">{fmtUsd(r.usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
