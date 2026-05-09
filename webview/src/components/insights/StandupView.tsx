import { useInsights } from "../../hooks/useInsights";

interface StandupPayload {
  totalSessions: number;
  totalTurns: number;
  totalUsd: number;
  perProject: { project_path: string; sessions: number; usd: number }[];
}

export function StandupView(): JSX.Element {
  const { payload } = useInsights("standup", 1);
  if (!payload) return <div>Loading…</div>;
  const data = payload as StandupPayload;
  return (
    <div>
      <h2>Today's standup</h2>
      <p>
        {data.totalSessions} sessions · {data.totalTurns} turns · ${data.totalUsd.toFixed(2)}
      </p>
      <ul>
        {data.perProject.map((p) => (
          <li key={p.project_path}>
            <strong>{p.project_path.split("/").slice(-2).join("/")}</strong> — {p.sessions} sessions, ${p.usd.toFixed(2)}
          </li>
        ))}
      </ul>
    </div>
  );
}
