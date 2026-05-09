import { useState } from "react";
import { useReviewerPRs } from "../../hooks/useReviewer";
import { useInfiniteScrollSentinel } from "../../hooks/useInfiniteScrollSentinel";

const PAGE_SIZE = 15;

export function PRsView(): JSX.Element {
  const { payload } = useReviewerPRs();
  const [visible, setVisible] = useState(PAGE_SIZE);

  const total = payload?.prs.length ?? 0;
  const hasMore = total > visible;

  const sentinelRef = useInfiniteScrollSentinel(
    () => setVisible((n) => Math.min(n + PAGE_SIZE, total)),
    !!payload && payload.ghAvailable && hasMore,
  );

  if (!payload) return <div className="sesh-reviewer-loading">Loading…</div>;
  if (!payload.ghAvailable) {
    return (
      <div className="sesh-reviewer-empty">
        <div>{payload.ghReason ?? "GitHub CLI not available."}</div>
        <div style={{ marginTop: "1em" }}>
          See{" "}
          <a href="https://cli.github.com/" target="_blank" rel="noreferrer">
            cli.github.com
          </a>{" "}
          to install, then run{" "}
          <code>gh auth login</code>.
        </div>
      </div>
    );
  }
  if (payload.prs.length === 0) {
    return <div className="sesh-reviewer-empty">No open PRs in this repo.</div>;
  }

  const shown = payload.prs.slice(0, visible);

  return (
    <div>
      <ul className="sesh-reviewer-list">
        {shown.map((pr) => {
          const sessionCount = new Set(
            pr.commits.flatMap((c) => c.sessions),
          ).size;
          return (
            <li key={pr.number} className="sesh-reviewer-commit">
              <div className="sesh-reviewer-commit-title">
                <a href={pr.url} target="_blank" rel="noreferrer">
                  #{pr.number}
                </a>{" "}
                {pr.title}
              </div>
              <div className="sesh-reviewer-commit-meta">
                {pr.head} · {pr.commits.length} commit
                {pr.commits.length === 1 ? "" : "s"} ·{" "}
                <strong>{sessionCount}</strong> session
                {sessionCount === 1 ? "" : "s"} involved
              </div>
              {sessionCount > 0 && (
                <ul className="sesh-reviewer-linked-sessions">
                  {pr.commits
                    .filter((c) => c.sessions.length > 0)
                    .map((c) => (
                      <li key={c.sha}>
                        <code className="sesh-reviewer-sha">
                          {c.sha.slice(0, 7)}
                        </code>{" "}
                        — {c.sessions.length} session
                        {c.sessions.length === 1 ? "" : "s"}
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
          <span className="sesh-reviewer-loading">Loading more…</span>
        </div>
      )}
    </div>
  );
}
