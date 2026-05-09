import { useState, useEffect } from "react";
import { onHostMessage, postToHost, type ToWebview } from "../../messaging";
import { Icon } from "../Icon";
import { useInfiniteScrollSentinel } from "../../hooks/useInfiniteScrollSentinel";

type SessionsPayload = Extract<ToWebview, { kind: "reviewerSessions" }>;
type SessionItem = SessionsPayload["sessions"][number];

type Props = { onNavigateToSession: (id: string) => void };

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function SessionsView({ onNavigateToSession }: Props): JSX.Element {
  const [payload, setPayload] = useState<SessionsPayload | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "reviewerSessions") {
        setPayload(msg);
        if (msg.offset === 0) {
          setSessions(msg.sessions);
        } else {
          setSessions((prev) => [...prev, ...msg.sessions]);
        }
        setHasMore(msg.hasMore);
        setLoadingMore(false);
      }
    });
    postToHost({ kind: "getReviewerSessions" });
    return off;
  }, []);

  function handleLoadMore() {
    setLoadingMore(true);
    postToHost({ kind: "getReviewerSessions", offset: sessions.length });
  }

  const sentinelRef = useInfiniteScrollSentinel(
    handleLoadMore,
    !!payload && payload.repoPath !== null && hasMore && !loadingMore,
  );

  if (!payload) return <div className="sesh-reviewer-loading">Loading…</div>;
  if (!payload.repoPath) return <div className="sesh-reviewer-empty">No git repo detected for the current workspace.</div>;
  if (sessions.length === 0) {
    return <div className="sesh-reviewer-empty">No sessions linked to commits in this repo yet.</div>;
  }

  return (
    <div>
      <div className="sesh-reviewer-toolbar">
        <span className="sesh-reviewer-repo">
          {sessions.length}{hasMore ? "+" : ""} session{sessions.length === 1 ? "" : "s"} linked to commits in <code>{payload.repoPath}</code>
        </span>
      </div>
      <ul className="sesh-reviewer-session-rows">
        {sessions.map((s) => {
          const top = s.commits[0]?.confidence ?? 0;
          const firstMsg = s.commits[0]?.message ?? "(no message)";
          return (
            <li key={s.session_id} className="sesh-reviewer-session-row">
              <button
                type="button"
                className="sesh-reviewer-session-row-button"
                onClick={() => onNavigateToSession(s.session_id)}
              >
                <div className="sesh-reviewer-session-row-line-1">
                  <span className="sesh-reviewer-session-row-title">{s.title}</span>
                  <ConfidenceTag confidence={top} />
                  <span className="sesh-reviewer-session-row-time" title={new Date(s.last_active_at).toLocaleString()}>
                    {relativeTime(s.last_active_at)}
                  </span>
                </div>
                <div className="sesh-reviewer-session-row-line-2">
                  <span className="sesh-reviewer-session-row-count">
                    <Icon name="git-commit" /> {s.commits.length}
                  </span>
                  <span className="sesh-reviewer-session-row-sep">·</span>
                  <span className="sesh-reviewer-session-row-msg">{firstMsg}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <div ref={sentinelRef} className="sesh-reviewer-sentinel">
          {loadingMore && <span className="sesh-reviewer-loading">Loading more…</span>}
        </div>
      )}
    </div>
  );
}

function ConfidenceTag({ confidence }: { confidence: number }): JSX.Element {
  const level = confidence >= 0.5 ? "strong" : confidence >= 0.2 ? "partial" : "weak";
  return <span className={`sesh-reviewer-confidence-tag is-${level}`}>{level}</span>;
}
