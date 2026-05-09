import { useReviewerSessions } from "../../hooks/useReviewer";

export function SessionsView(): JSX.Element {
  const { payload } = useReviewerSessions();
  if (!payload) return <div>Loading…</div>;
  if (!payload.repoPath) return <div>No git repo detected for the current workspace.</div>;
  if (payload.sessions.length === 0) {
    return <div>No sessions linked to commits in this repo yet.</div>;
  }
  return (
    <div>
      <div className="sesh-reviewer-header">
        Sessions linked to commits in <code>{payload.repoPath}</code>
      </div>
      <ul className="sesh-reviewer-list">
        {payload.sessions.map((s) => (
          <li key={s.session_id} className="sesh-reviewer-commit">
            <div className="sesh-reviewer-commit-title">{s.title}</div>
            <div className="sesh-reviewer-commit-meta">
              Last active: {new Date(s.last_active_at).toLocaleString()}
            </div>
            <ul className="sesh-reviewer-linked-sessions">
              {s.commits.map((c) => (
                <li key={c.sha}>
                  <code className="sesh-reviewer-sha">{c.sha.slice(0, 7)}</code>{" "}
                  {c.message ?? "(no message)"}{" "}
                  <span className="sesh-reviewer-confidence">({(c.confidence * 100).toFixed(0)}%)</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
