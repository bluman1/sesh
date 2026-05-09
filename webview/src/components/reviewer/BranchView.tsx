import { useState, useEffect } from "react";
import { onHostMessage, postToHost, type ToWebview } from "../../messaging";

type BranchPayload = Extract<ToWebview, { kind: "reviewerBranch" }>;

type Props = { onNavigateToSession: (id: string) => void };

export function BranchView({ onNavigateToSession }: Props): JSX.Element {
  const [payload, setPayload] = useState<BranchPayload | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  // Subscribe + initial fetch
  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "reviewerBranch") setPayload(msg);
    });
    postToHost({ kind: "getReviewerBranch" });
    return off;
  }, []);

  // When user picks a branch, refetch
  useEffect(() => {
    if (selectedBranch !== null) {
      postToHost({ kind: "getReviewerBranch", branch: selectedBranch });
    }
  }, [selectedBranch]);

  if (!payload) return <div className="sesh-reviewer-loading">Loading…</div>;
  if (!payload.repoPath) {
    return <div className="sesh-reviewer-empty">No git repo detected for the current workspace.</div>;
  }

  return (
    <div>
      <div className="sesh-reviewer-toolbar">
        <span className="sesh-reviewer-repo"><code>{payload.repoPath}</code></span>
        {payload.branches.length > 0 && (
          <select
            className="sesh-reviewer-branch-select"
            value={payload.branch ?? ""}
            onChange={(e) => setSelectedBranch(e.target.value)}
          >
            {payload.branches.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        )}
      </div>

      {payload.commits.length === 0 ? (
        <div className="sesh-reviewer-empty">
          No commits indexed yet on <strong>{payload.branch ?? "this branch"}</strong>.
          Run <strong>Sesh: Reindex git</strong>.
        </div>
      ) : (
        <ul className="sesh-reviewer-list">
          {payload.commits.map((c) => {
            const url = payload.repoUrl ? `${payload.repoUrl}/commit/${c.sha}` : null;
            return (
              <li key={c.sha} className="sesh-reviewer-commit">
                <div className="sesh-reviewer-commit-title">
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer" className="sesh-reviewer-sha-link">
                      <code className="sesh-reviewer-sha">{c.sha.slice(0, 7)}</code>
                    </a>
                  ) : (
                    <code className="sesh-reviewer-sha">{c.sha.slice(0, 7)}</code>
                  )}{" "}
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
                        <button
                          type="button"
                          className="sesh-reviewer-session-link"
                          onClick={() => onNavigateToSession(s.session_id)}
                        >
                          {s.title}
                        </button>{" "}
                        <ConfidenceTag confidence={s.confidence} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ConfidenceTag({ confidence }: { confidence: number }): JSX.Element {
  const level = confidence >= 0.5 ? "strong" : confidence >= 0.2 ? "partial" : "weak";
  return <span className={`sesh-reviewer-confidence-tag is-${level}`}>{level}</span>;
}
