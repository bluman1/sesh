import { useInsights } from "../../hooks/useInsights";

interface Payload {
  longestSessionTurns: { session_id: string; turns: number };
  fewestTokensShipped: { session_id: string; tokens: number } | null;
  currentStreak: { days: number };
  totalSessions: number;
  totalTurns: number;
  totalUsd: number;
}

function pluralize(n: number, singular: string, plural = singular + "s"): string {
  return n === 1 ? singular : plural;
}

export function RecordsView(): JSX.Element {
  const { payload } = useInsights("records", 0);
  if (!payload) return <div>Loading…</div>;
  const r = payload as Payload;
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Personal records</h2>
      <ul className="sesh-records-list">
        <li className="sesh-records-row">
          <span className="sesh-records-label">Longest session</span>
          <span className="sesh-records-value">
            {r.longestSessionTurns.turns.toLocaleString()} turns
          </span>
        </li>
        <li className="sesh-records-row">
          <span className="sesh-records-label">Fewest tokens to ship</span>
          <span className="sesh-records-value">
            {r.fewestTokensShipped
              ? r.fewestTokensShipped.tokens.toLocaleString() + " tokens"
              : "—"}
          </span>
        </li>
        <li className="sesh-records-row">
          <span className="sesh-records-label">Current streak</span>
          <span className="sesh-records-value">
            {r.currentStreak.days} {pluralize(r.currentStreak.days, "day")}
          </span>
        </li>
        <li className="sesh-records-row">
          <span className="sesh-records-label">Total sessions</span>
          <span className="sesh-records-value">
            {r.totalSessions.toLocaleString()}
          </span>
        </li>
        <li className="sesh-records-row">
          <span className="sesh-records-label">Total turns</span>
          <span className="sesh-records-value">
            {r.totalTurns.toLocaleString()}
          </span>
        </li>
        <li className="sesh-records-row">
          <span className="sesh-records-label">Total spent</span>
          <span className="sesh-records-value">${r.totalUsd.toFixed(2)}</span>
        </li>
      </ul>
    </div>
  );
}
