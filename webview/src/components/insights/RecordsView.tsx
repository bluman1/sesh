import { useInsights } from "../../hooks/useInsights";

interface Payload {
  longestSessionTurns: { session_id: string; turns: number };
  fewestTokensShipped: { session_id: string; tokens: number } | null;
  currentStreak: { days: number };
  totalSessions: number;
  totalTurns: number;
  totalUsd: number;
}

export function RecordsView(): JSX.Element {
  const { payload } = useInsights("records", 0);
  if (!payload) return <div>Loading…</div>;
  const r = payload as Payload;
  return (
    <div>
      <h2>Personal records</h2>
      <ul>
        <li>Longest session: {r.longestSessionTurns.turns} turns ({r.longestSessionTurns.session_id})</li>
        <li>{r.fewestTokensShipped
          ? `Fewest tokens to ship: ${r.fewestTokensShipped.tokens.toLocaleString()} (${r.fewestTokensShipped.session_id})`
          : "Fewest tokens to ship: no shipped sessions yet"}</li>
        <li>Current streak: {r.currentStreak.days} day(s)</li>
        <li>Total sessions: {r.totalSessions.toLocaleString()}</li>
        <li>Total turns: {r.totalTurns.toLocaleString()}</li>
        <li>Total USD spent: ${r.totalUsd.toFixed(2)}</li>
      </ul>
    </div>
  );
}
