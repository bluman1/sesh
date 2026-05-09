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
      </div>
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
