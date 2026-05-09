import { useReviewerBranch } from "../../hooks/useReviewer";

export function BranchView(): JSX.Element {
  const { payload } = useReviewerBranch();
  if (!payload) return <div>Loading…</div>;
  if (!payload.repoPath) {
    return <div>No git repo detected for the current workspace.</div>;
  }
  if (payload.commits.length === 0) {
    return (
      <div>
        <div>Repo: <code>{payload.repoPath}</code></div>
        <div>Branch: {payload.branch ?? "(detached)"}</div>
        <div style={{ marginTop: "1em" }}>No commits indexed yet. Run <strong>Sesh: Reindex git</strong>.</div>
      </div>
    );
  }
  return (
    <div>
      <div className="sesh-reviewer-header">
        <strong>{payload.branch ?? "(detached)"}</strong> · <code>{payload.repoPath}</code>
      </div>
      <ul className="sesh-reviewer-list">
        {payload.commits.map((c) => (
          <li key={c.sha} className="sesh-reviewer-commit">
            <div className="sesh-reviewer-commit-title">
              <code className="sesh-reviewer-sha">{c.sha.slice(0, 7)}</code>{" "}
              {c.message ?? "(no message)"}
            </div>
            <div className="sesh-reviewer-commit-meta">
              {c.author ?? "(no author)"} · {new Date(c.authored_at).toLocaleString()}
              {c.sessions.length > 0 && (
                <> · <strong>{c.sessions.length}</strong> linked session{c.sessions.length === 1 ? "" : "s"}</>
              )}
            </div>
            {c.sessions.length > 0 && (
              <ul className="sesh-reviewer-linked-sessions">
                {c.sessions.map((s) => (
                  <li key={s.session_id}>
                    {s.title} <span className="sesh-reviewer-confidence">({(s.confidence * 100).toFixed(0)}%)</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
