import { useState, useEffect, useRef } from "react";
import { onHostMessage, postToHost, type ToWebview } from "../messaging";
import "./KnowledgeTab.css";

type SearchResults = Extract<ToWebview, { kind: "searchResults" }>;
type SearchResultItem = SearchResults["results"][number];

type Props = { onNavigateToSession: (id: string) => void };

export function KnowledgeTab({ onNavigateToSession }: Props): JSX.Element {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showTips, setShowTips] = useState(false);
  const [tips, setTips] = useState<Extract<ToWebview, { kind: "claudeMdSuggestions" }>["suggestions"]>([]);

  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "searchResults") {
        setResults(msg.results);
        setSearching(false);
        setSubmittedQuery(msg.query);
      }
    });
    return off;
  }, []);

  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "claudeMdSuggestions") setTips(msg.suggestions);
    });
    postToHost({ kind: "getClaudeMdSuggestions" });
    return off;
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSubmittedQuery("");
      setSearching(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      postToHost({ kind: "semanticSearch", query: trimmed });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const tipsCount = tips.length;

  return (
    <div className="sesh-knowledge">
      <div className="sesh-knowledge-toolbar">
        <input
          type="text"
          className="sesh-knowledge-input"
          placeholder="Search across all your sessions semantically…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="sesh-knowledge-tips-button"
          onClick={() => setShowTips((s) => !s)}
          title="View CLAUDE.md improvement suggestions"
        >
          Tips ({tipsCount})
        </button>
      </div>
      {showTips && (
        <div className="sesh-knowledge-tips">
          {tips.length === 0 ? (
            <div className="sesh-knowledge-tips-empty">
              No CLAUDE.md suggestions yet. They appear when you've corrected the assistant on the same kind of thing 3+ times.
            </div>
          ) : (
            <ul className="sesh-knowledge-tips-list">
              {tips.map((t) => (
                <li key={t.id} className="sesh-knowledge-tip">
                  <pre className="sesh-knowledge-tip-body">{t.body}</pre>
                  <div className="sesh-knowledge-tip-actions">
                    <button
                      type="button"
                      className="sesh-knowledge-tip-action"
                      onClick={() => {
                        navigator.clipboard?.writeText(t.body);
                        postToHost({ kind: "setClaudeMdStatus", id: t.id, status: "accepted" });
                      }}
                    >Copy + accept</button>
                    <button
                      type="button"
                      className="sesh-knowledge-tip-action"
                      onClick={() => postToHost({ kind: "setClaudeMdStatus", id: t.id, status: "dismissed" })}
                    >Dismiss</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="sesh-knowledge-body">
        {!query.trim() && (
          <div className="sesh-knowledge-empty">
            Type to search. Knowledge searches every assistant response and user message you've had — no exact phrase match needed.
          </div>
        )}
        {query.trim() && searching && (
          <div className="sesh-knowledge-loading">Searching…</div>
        )}
        {submittedQuery && !searching && results.length === 0 && (
          <div className="sesh-knowledge-empty">
            No matches for "{submittedQuery}". Try fewer or more general words.
          </div>
        )}
        {results.length > 0 && (
          <ul className="sesh-knowledge-results">
            {results.map((r) => (
              <li key={r.chunk_id} className="sesh-knowledge-result">
                <button
                  type="button"
                  className="sesh-knowledge-result-button"
                  onClick={() => onNavigateToSession(r.session_id)}
                >
                  <div className="sesh-knowledge-result-line-1">
                    <span className="sesh-knowledge-result-title">{r.session_title}</span>
                    <span className="sesh-knowledge-result-score">
                      {Math.round(r.score * 100)}%
                    </span>
                  </div>
                  <div className="sesh-knowledge-result-snippet">{r.snippet}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
