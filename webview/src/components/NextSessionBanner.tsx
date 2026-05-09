import { useEffect, useState } from "react";
import { onHostMessage, postToHost, type ToWebview } from "../messaging";
import { Icon } from "./Icon";

type Payload = Extract<ToWebview, { kind: "nextSessionSuggestions" }>;

const STORAGE_KEY = "sesh.nextBanner.expanded";

type Props = { onNavigateToSession: (id: string) => void };

export function NextSessionBanner({ onNavigateToSession }: Props): JSX.Element | null {
  const [suggestions, setSuggestions] = useState<Payload["suggestions"]>([]);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch { return false; }
  });

  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "nextSessionSuggestions") setSuggestions(msg.suggestions);
    });
    postToHost({ kind: "getNextSessionSuggestions" });
    return off;
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, expanded ? "1" : "0"); } catch { /* ignore */ }
  }, [expanded]);

  const visible = suggestions.filter((s) => !dismissedKeys.has(keyFor(s)));
  if (hidden || visible.length === 0) return null;

  return (
    <div className={`sesh-pickup ${expanded ? "is-expanded" : "is-collapsed"}`}>
      <button
        type="button"
        className="sesh-pickup-head"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <Icon name={expanded ? "chevron-down" : "chevron-right"} className="sesh-pickup-chevron" />
        <span className="sesh-pickup-title">Pick up where you left off</span>
        <span className="sesh-pickup-count">{visible.length}</span>
        <span className="sesh-pickup-spacer" />
        <span
          className="sesh-pickup-close"
          role="button"
          aria-label="Hide"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); setHidden(true); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setHidden(true); }
          }}
        >×</span>
      </button>
      {expanded && (
        <ul className="sesh-pickup-list">
          {visible.map((s) => {
            const k = keyFor(s);
            return (
              <li key={k} className="sesh-pickup-item">
                <span className={`sesh-pickup-dot sesh-pickup-dot-${s.kind}`} aria-hidden="true" />
                <button
                  type="button"
                  className="sesh-pickup-text"
                  onClick={() => {
                    if (s.source_session_ids[0]) onNavigateToSession(s.source_session_ids[0]);
                  }}
                  title={s.text}
                >{s.text}</button>
                <button
                  type="button"
                  className="sesh-pickup-dismiss"
                  onClick={() => setDismissedKeys((prev) => new Set(prev).add(k))}
                  title="Dismiss"
                  aria-label="Dismiss suggestion"
                >×</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function keyFor(s: { kind: string; text: string }): string {
  return `${s.kind}:${s.text}`;
}
