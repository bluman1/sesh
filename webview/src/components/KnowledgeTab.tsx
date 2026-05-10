import { useState, useEffect, useMemo } from "react";
import { onHostMessage, postToHost, type ToWebview } from "../messaging";
import "./KnowledgeTab.css";

type TopicsPayload = Extract<ToWebview, { kind: "topics" }>;
type GlossaryPayload = Extract<ToWebview, { kind: "glossary" }>;
type ClaudeMdPayload = Extract<ToWebview, { kind: "claudeMdSuggestions" }>;

type Props = { onNavigateToSession: (id: string) => void };

export function KnowledgeTab({ onNavigateToSession }: Props): JSX.Element {
  const [filter, setFilter] = useState("");
  const [topics, setTopics] = useState<TopicsPayload["topics"]>([]);
  const [glossary, setGlossary] = useState<GlossaryPayload["entries"]>([]);
  const [tips, setTips] = useState<ClaudeMdPayload["suggestions"]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null);

  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "topics") {
        setTopics(msg.topics);
        setTopicsLoading(false);
      }
      if (msg.kind === "glossary") setGlossary(msg.entries);
      if (msg.kind === "claudeMdSuggestions") setTips(msg.suggestions);
    });
    postToHost({ kind: "getTopics", limit: 30 });
    postToHost({ kind: "getGlossary", limit: 50 });
    postToHost({ kind: "getClaudeMdSuggestions" });
    return off;
  }, []);

  const f = filter.trim().toLowerCase();
  const filteredTopics = useMemo(
    () => f ? topics.filter((t) => t.label.toLowerCase().includes(f) || t.representative.toLowerCase().includes(f)) : topics,
    [topics, f],
  );
  const filteredGlossary = useMemo(
    () => f ? glossary.filter((g) => g.term.toLowerCase().includes(f)) : glossary,
    [glossary, f],
  );
  const filteredTips = useMemo(
    () => f ? tips.filter((t) => t.body.toLowerCase().includes(f)) : tips,
    [tips, f],
  );

  return (
    <div className="sesh-knowledge">
      <div className="sesh-knowledge-toolbar">
        <input
          type="text"
          className="sesh-knowledge-filter"
          placeholder="Filter topics, lessons, glossary…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="sesh-knowledge-body">
        <Section title="Lessons" subtitle="Patterns where you've corrected the assistant — distill into CLAUDE.md">
          {filteredTips.length === 0 ? (
            <div className="sesh-knowledge-empty">No lessons yet. They surface after you've corrected the assistant on the same kind of thing 3+ times.</div>
          ) : (
            <ul className="sesh-knowledge-tips-list">
              {filteredTips.map((t) => (
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
        </Section>

        <Section title="Topics" subtitle={`${filteredTopics.length} clusters across your sessions`}>
          {topicsLoading ? (
            <div className="sesh-knowledge-loading">Computing topics…</div>
          ) : filteredTopics.length === 0 ? (
            <div className="sesh-knowledge-empty">
              No topics yet. Run <strong>Sesh: Reindex embeddings</strong> from the command palette to index your sessions; progress shows in the status bar at the bottom-left.
            </div>
          ) : (
            <ul className="sesh-knowledge-topics">
              {filteredTopics.map((t) => {
                const isExpanded = expandedTopicId === t.id;
                return (
                  <li key={t.id} className={`sesh-knowledge-topic${isExpanded ? " is-expanded" : ""}`}>
                    <button
                      type="button"
                      className="sesh-knowledge-topic-button"
                      onClick={() => setExpandedTopicId(isExpanded ? null : t.id)}
                    >
                      <div className="sesh-knowledge-topic-head">
                        <span className="sesh-knowledge-topic-label">{t.label}</span>
                        <span className="sesh-knowledge-topic-size">{t.size} mention{t.size === 1 ? "" : "s"} · {t.session_count} session{t.session_count === 1 ? "" : "s"}</span>
                      </div>
                      <div className="sesh-knowledge-topic-rep">{t.representative}</div>
                    </button>
                    {isExpanded && t.examples.length > 0 && (
                      <ul className="sesh-knowledge-topic-examples">
                        {t.examples.map((ex) => (
                          <li key={ex.session_id} className="sesh-knowledge-topic-example">
                            <button
                              type="button"
                              className="sesh-knowledge-topic-example-button"
                              onClick={() => onNavigateToSession(ex.session_id)}
                            >
                              {ex.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Glossary" subtitle="Recurring names, project terms, and file paths">
          {filteredGlossary.length === 0 ? (
            <div className="sesh-knowledge-empty">Glossary builds up as you use Sesh.</div>
          ) : (
            <div className="sesh-knowledge-glossary">
              {filteredGlossary.map((g) => (
                <button
                  key={g.term}
                  type="button"
                  className="sesh-knowledge-glossary-item"
                  onClick={() => setFilter(g.term)}
                  title={`${g.count} mention${g.count === 1 ? "" : "s"} across ${g.session_count} session${g.session_count === 1 ? "" : "s"} — click to filter`}
                >
                  <span className="sesh-knowledge-glossary-term">{g.term}</span>
                  <span className="sesh-knowledge-glossary-count">{g.count}</span>
                </button>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="sesh-knowledge-section">
      <div className="sesh-knowledge-section-head">
        <span className="sesh-knowledge-section-title">{title}</span>
        <span className="sesh-knowledge-section-subtitle">{subtitle}</span>
      </div>
      {children}
    </section>
  );
}
