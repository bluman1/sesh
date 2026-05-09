import { useState, useEffect } from "react";
import { onHostMessage, postToHost, type ToWebview } from "../messaging";

type Payload = Extract<ToWebview, { kind: "nextSessionSuggestions" }>;

type Props = { onNavigateToSession: (id: string) => void };

export function NextSessionBanner({ onNavigateToSession }: Props): JSX.Element | null {
  const [suggestions, setSuggestions] = useState<Payload["suggestions"]>([]);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const [bannerHidden, setBannerHidden] = useState(false);

  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "nextSessionSuggestions") setSuggestions(msg.suggestions);
    });
    postToHost({ kind: "getNextSessionSuggestions" });
    return off;
  }, []);

  const visible = suggestions.filter((s) => !dismissedKeys.has(keyFor(s)));
  if (bannerHidden || visible.length === 0) return null;

  return (
    <div className="sesh-next-banner">
      <div className="sesh-next-banner-head">
        <strong>Pick up where you left off</strong>
        <button
          type="button"
          className="sesh-next-banner-close"
          onClick={() => setBannerHidden(true)}
          title="Hide"
        >×</button>
      </div>
      <ul className="sesh-next-banner-list">
        {visible.map((s) => {
          const k = keyFor(s);
          return (
            <li key={k} className="sesh-next-banner-item">
              <span className={`sesh-next-banner-kind sesh-next-banner-kind-${s.kind}`}>{s.kind}</span>
              <button
                type="button"
                className="sesh-next-banner-text"
                onClick={() => {
                  if (s.source_session_ids[0]) onNavigateToSession(s.source_session_ids[0]);
                }}
              >{s.text}</button>
              <button
                type="button"
                className="sesh-next-banner-dismiss"
                onClick={() => setDismissedKeys((prev) => new Set(prev).add(k))}
                title="Dismiss"
              >×</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function keyFor(s: { kind: string; text: string }): string {
  return `${s.kind}:${s.text}`;
}
