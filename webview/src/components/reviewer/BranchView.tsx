import { useState, useEffect } from "react";
import { onHostMessage, postToHost, type ToWebview } from "../../messaging";
import { Dropdown, type DropdownItem } from "../Dropdown";
import { useInfiniteScrollSentinel } from "../../hooks/useInfiniteScrollSentinel";

type BranchPayload = Extract<ToWebview, { kind: "reviewerBranch" }>;
type CommitItem = BranchPayload["commits"][number];

type Props = { onNavigateToSession: (id: string) => void };

export function BranchView({ onNavigateToSession }: Props): JSX.Element {
  const [payload, setPayload] = useState<BranchPayload | null>(null);
  const [commits, setCommits] = useState<CommitItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  // Subscribe + initial fetch
  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "reviewerBranch") {
        setPayload(msg);
        if (msg.offset === 0) {
          setCommits(msg.commits);
        } else {
          setCommits((prev) => [...prev, ...msg.commits]);
        }
        setHasMore(msg.hasMore);
        setLoadingMore(false);
      }
    });
    postToHost({ kind: "getReviewerBranch" });
    return off;
  }, []);

  // When user picks a branch, reset and refetch from offset 0
  useEffect(() => {
    if (selectedBranch !== null) {
      setCommits([]);
      setHasMore(false);
      postToHost({ kind: "getReviewerBranch", branch: selectedBranch });
    }
  }, [selectedBranch]);

  function handleLoadMore() {
    if (!payload) return;
    setLoadingMore(true);
    postToHost({
      kind: "getReviewerBranch",
      branch: payload.branch ?? undefined,
      offset: commits.length,
    });
  }

  const sentinelRef = useInfiniteScrollSentinel(
    handleLoadMore,
    !!payload && payload.repoPath !== null && hasMore && !loadingMore,
  );

  if (!payload) return <div className="sesh-reviewer-loading">Loading…</div>;
  if (!payload.repoPath) {
    return <div className="sesh-reviewer-empty">No git repo detected for the current workspace.</div>;
  }

  return (
    <div>
      <div className="sesh-reviewer-toolbar">
        <span className="sesh-reviewer-repo"><code>{payload.repoPath}</code></span>
        {payload.branches.length > 0 && (
          <Dropdown
            triggerIcon="git-branch"
            value={payload.branch ?? ""}
            items={payload.branches.map((b): DropdownItem => ({ value: b, label: b }))}
            onChange={(b) => setSelectedBranch(b)}
            align="left"
          />
        )}
      </div>

      {commits.length === 0 ? (
        <div className="sesh-reviewer-empty">
          No commits indexed yet on <strong>{payload.branch ?? "this branch"}</strong>.
          Git indexing is off by default — turn on <strong>Settings → Indexing → Index git history</strong>, reload the window, then run <strong>Sesh: Reindex git</strong>.
        </div>
      ) : (
        <>
          <ul className="sesh-reviewer-list">
            {commits.map((c) => {
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
          {hasMore && (
            <div ref={sentinelRef} className="sesh-reviewer-sentinel">
              {loadingMore && <span className="sesh-reviewer-loading">Loading more…</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ConfidenceTag({ confidence }: { confidence: number }): JSX.Element {
  const level = confidence >= 0.5 ? "strong" : confidence >= 0.2 ? "partial" : "weak";
  return <span className={`sesh-reviewer-confidence-tag is-${level}`}>{level}</span>;
}
