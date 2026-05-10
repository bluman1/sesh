import { useEffect, useState } from "react";
import { onHostMessage, postToHost, type ToWebview } from "../messaging";
import { Icon } from "./Icon";

type Payload = Extract<ToWebview, { kind: "nextSessionSuggestions" }>;
type Suggestion = Payload["suggestions"][number];

const STORAGE_KEY = "sesh.nextBanner.expanded";

type Props = {
  onNavigateToSession: (id: string) => void;
  scope?: "global" | "workspace";
};

export function NextSessionBanner({ onNavigateToSession, scope = "workspace" }: Props): JSX.Element | null {
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
            const title = displayTitle(s);
            const snippet = displaySnippet(s, title);
            const showProject = scope === "global" && s.project_label;
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
                >
                  <span className="sesh-pickup-row1">
                    <span className="sesh-pickup-item-title">{title}</span>
                    {showProject && (
                      <span className="sesh-pickup-project" title={`From workspace ${s.project_label}`}>
                        <Icon name="folder" className="sesh-pickup-project-icon" />
                        {s.project_label}
                      </span>
                    )}
                  </span>
                  {snippet && <span className="sesh-pickup-item-snippet">{snippet}</span>}
                </button>
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

function keyFor(s: { kind: string; text: string; source_session_ids?: string[] }): string {
  return `${s.kind}:${s.source_session_ids?.[0] ?? ""}:${s.text}`;
}

/**
 * Pick the best display title.
 *  - Prefer the source session's stored title.
 *  - Fall back to a cleaned-up first sentence of the suggestion text.
 *  - Last resort: truncated raw text.
 */
function displayTitle(s: Suggestion): string {
  if (s.session_title && s.session_title.trim().length > 0) return s.session_title.trim();
  const cleaned = cleanFragment(s.text);
  return truncate(cleaned, 80);
}

function displaySnippet(s: Suggestion, title: string): string | null {
  const text = cleanFragment(s.text);
  // If we used the session title above, the snippet IS the suggestion text.
  // If we already used the suggestion text as the title, no separate snippet.
  if (s.session_title && s.session_title.trim().length > 0 && text !== title) {
    return truncate(text, 140);
  }
  return null;
}

function cleanFragment(raw: string): string {
  if (!raw) return "";
  // Strip wrapping backticks/quotes and stray markdown noise that often
  // shows up in mined idea fragments.
  let s = raw.trim();
  s = s.replace(/^[`*_>#\-\s]+/, "").replace(/[`*_>#\-\s]+$/, "");
  // Collapse newlines and runs of whitespace.
  s = s.replace(/\s+/g, " ");
  return s;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
