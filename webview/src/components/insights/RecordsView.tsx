import { useInsights } from "../../hooks/useInsights";
import { fmtUsd, fmtCount, pluralize } from "./format";

interface Payload {
  longestSessionTurns: { session_id: string; turns: number };
  fewestTokensShipped: { session_id: string; tokens: number } | null;
  currentStreak: { days: number };
  totalSessions: number;
  totalTurns: number;
  totalUsd: number;
}

export function RecordsView(): JSX.Element {
  const { payload } = useInsights("records", "all");

  if (!payload) return <div>Loading…</div>;
  const r = payload as Payload;
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Personal records</h2>
      <ul className="sesh-records-list">
        <li className="sesh-records-row">
          <span className="sesh-records-label">Longest session</span>
          <span className="sesh-records-value">
            {fmtCount(r.longestSessionTurns.turns)} turns
          </span>
        </li>
        <li className="sesh-records-row">
          <span className="sesh-records-label">Fewest tokens to ship</span>
          <span className="sesh-records-value">
            {r.fewestTokensShipped
              ? fmtCount(r.fewestTokensShipped.tokens) + " tokens"
              : "—"}
          </span>
        </li>
        <li className="sesh-records-row">
          <span className="sesh-records-label">Current streak</span>
          <span className="sesh-records-value">
            {fmtCount(r.currentStreak.days)} {pluralize(r.currentStreak.days, "day")}
          </span>
        </li>
        <li className="sesh-records-row">
          <span className="sesh-records-label">Total sessions</span>
          <span className="sesh-records-value">
            {fmtCount(r.totalSessions)}
          </span>
        </li>
        <li className="sesh-records-row">
          <span className="sesh-records-label">Total turns</span>
          <span className="sesh-records-value">
            {fmtCount(r.totalTurns)}
          </span>
        </li>
        <li className="sesh-records-row">
          <span className="sesh-records-label">Total spent</span>
          <span className="sesh-records-value">{fmtUsd(r.totalUsd)}</span>
        </li>
      </ul>
    </div>
  );
}
