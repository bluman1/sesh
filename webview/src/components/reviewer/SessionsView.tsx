import { useState, useEffect } from "react";
import { onHostMessage, postToHost, type ToWebview } from "../../messaging";

type SessionsPayload = Extract<ToWebview, { kind: "reviewerSessions" }>;

type Props = { onNavigateToSession: (id: string) => void };

export function SessionsView({ onNavigateToSession }: Props): JSX.Element {
  const [payload, setPayload] = useState<SessionsPayload | null>(null);

  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "reviewerSessions") setPayload(msg);
    });
    postToHost({ kind: "getReviewerSessions" });
    return off;
  }, []);

  if (!payload) return <div className="sesh-reviewer-loading">Loading…</div>;
  if (!payload.repoPath) return <div className="sesh-reviewer-empty">No git repo detected for the current workspace.</div>;
  if (payload.sessions.length === 0) {
    return <div className="sesh-reviewer-empty">No sessions linked to commits in this repo yet.</div>;
  }

  return (
    <div>
      <div className="sesh-reviewer-toolbar">
        <span className="sesh-reviewer-repo">
          {payload.sessions.length} session{payload.sessions.length === 1 ? "" : "s"} linked to commits in <code>{payload.repoPath}</code>
        </span>
      </div>
      <ul className="sesh-reviewer-session-cards">
        {payload.sessions.map((s) => {
          const top = s.commits[0]?.confidence ?? 0;
          return (
            <li key={s.session_id} className="sesh-reviewer-session-card">
              <button
                type="button"
                className="sesh-reviewer-session-card-button"
                onClick={() => onNavigateToSession(s.session_id)}
              >
                <div className="sesh-reviewer-session-card-header">
                  <span className="sesh-reviewer-session-card-title">{s.title}</span>
                  <ConfidenceTag confidence={top} />
                </div>
                <div className="sesh-reviewer-session-card-meta">
                  {s.commits.length} commit{s.commits.length === 1 ? "" : "s"} · last active {new Date(s.last_active_at).toLocaleDateString()}
                </div>
                <div className="sesh-reviewer-session-card-commits">
                  {s.commits.slice(0, 3).map((c) => (
                    <span key={c.sha} className="sesh-reviewer-session-card-commit">
                      <code className="sesh-reviewer-sha">{c.sha.slice(0, 7)}</code>{" "}
                      <span className="sesh-reviewer-session-card-msg">{c.message ?? "(no message)"}</span>
                    </span>
                  ))}
                  {s.commits.length > 3 && (
                    <span className="sesh-reviewer-session-card-more">+{s.commits.length - 3} more</span>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ConfidenceTag({ confidence }: { confidence: number }): JSX.Element {
  const level = confidence >= 0.5 ? "strong" : confidence >= 0.2 ? "partial" : "weak";
  return <span className={`sesh-reviewer-confidence-tag is-${level}`}>{level}</span>;
}
