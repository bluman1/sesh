import { useState, useEffect } from "react";
import { onHostMessage, postToHost, type ToWebview } from "../messaging";
import "./IdeasTab.css";

type IdeasPayload = Extract<ToWebview, { kind: "ideas" }>;

type Props = { onNavigateToSession: (id: string) => void };

export function IdeasTab({ onNavigateToSession }: Props): JSX.Element {
  const [payload, setPayload] = useState<IdeasPayload | null>(null);

  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "ideas") setPayload(msg);
    });
    postToHost({ kind: "getIdeas" });
    return off;
  }, []);

  if (!payload) return <div className="sesh-ideas-loading">Loading…</div>;

  if (payload.clusters.length === 0) {
    return (
      <div className="sesh-ideas-empty">
        No ideas mined yet. Idea mining is off by default — turn on <strong>Settings → Indexing → Mine ideas from user messages</strong> and reload the window. Once on, intent-bearing messages ("I should refactor X", "TODO: handle Y") surface here grouped by similarity.
      </div>
    );
  }

  // Sort clusters by size DESC, then by most recent idea.
  const sortedClusters = [...payload.clusters].sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size;
    const aMax = Math.max(...a.ideas.map((i) => i.detected_at));
    const bMax = Math.max(...b.ideas.map((i) => i.detected_at));
    return bMax - aMax;
  });

  return (
    <div className="sesh-ideas">
      <div className="sesh-ideas-header">
        <strong>Idea graveyard</strong>{" "}
        <span className="sesh-ideas-meta">
          {sortedClusters.length} clusters · {sortedClusters.reduce((n, c) => n + c.size, 0)} ideas
        </span>
      </div>
      <ul className="sesh-ideas-clusters">
        {sortedClusters.map((cluster) => {
          const headIdea = cluster.ideas[0];
          return (
            <li key={cluster.cluster_id} className="sesh-ideas-cluster">
              <div className="sesh-ideas-cluster-head">
                <span className="sesh-ideas-cluster-text">{headIdea?.text ?? ""}</span>
                <span className="sesh-ideas-cluster-size">×{cluster.size}</span>
              </div>
              <ul className="sesh-ideas-mentions">
                {cluster.ideas.map((idea) => (
                  <li key={idea.id} className="sesh-ideas-mention">
                    <button
                      type="button"
                      className="sesh-ideas-mention-button"
                      onClick={() => onNavigateToSession(idea.source_session_id)}
                    >
                      <span className="sesh-ideas-mention-text">{idea.text}</span>
                      <span className="sesh-ideas-mention-time">
                        {new Date(idea.detected_at).toLocaleDateString()}
                      </span>
                    </button>
                    <div className="sesh-ideas-mention-actions">
                      <button
                        type="button"
                        className="sesh-ideas-action sesh-ideas-action-done"
                        onClick={() => postToHost({ kind: "setIdeaStatus", id: idea.id, status: "done" })}
                        title="Mark done"
                      >done</button>
                      <button
                        type="button"
                        className="sesh-ideas-action sesh-ideas-action-dismiss"
                        onClick={() => postToHost({ kind: "setIdeaStatus", id: idea.id, status: "dismissed" })}
                        title="Dismiss"
                      >dismiss</button>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
