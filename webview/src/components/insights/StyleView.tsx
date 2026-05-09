import { useState, useEffect } from "react";
import { onHostMessage, postToHost, type ToWebview } from "../../messaging";

type StylePayload = Extract<ToWebview, { kind: "styleFingerprint" }>;

export function StyleView(): JSX.Element {
  const [fp, setFp] = useState<StylePayload["fingerprint"] | null>(null);

  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "styleFingerprint") setFp(msg.fingerprint);
    });
    postToHost({ kind: "getStyleFingerprint" });
    return off;
  }, []);

  if (!fp) return <div className="sesh-insights-loading">Loading…</div>;

  if (fp.source_session_count === 0) {
    return <div className="sesh-insights-empty">No user messages indexed yet. Try the Knowledge tab to seed the index.</div>;
  }

  return (
    <div className="sesh-style">
      <div className="sesh-style-toolbar">
        <span className="sesh-style-meta">
          From {fp.source_session_count} session{fp.source_session_count === 1 ? "" : "s"} · {fp.source_chunk_count} message{fp.source_chunk_count === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          className="sesh-style-action"
          onClick={() => navigator.clipboard?.writeText(JSON.stringify(fp, null, 2))}
        >Copy as JSON</button>
        <button
          type="button"
          className="sesh-style-action"
          onClick={() => postToHost({ kind: "exportStyleFingerprint" })}
        >Save to file…</button>
      </div>
      <div className="sesh-style-grid">
        <Metric label="avg chars / message" value={fp.avg_user_chars_per_turn.toLocaleString()} />
        <Metric label="words / sentence" value={fp.avg_words_per_sentence.toString()} />
        <Metric label="hedges / 1000 words" value={fp.hedging_per_1000_words.toString()} />
        <Metric label="exclamations / 1000 chars" value={fp.exclamation_per_1000_chars.toString()} />
        <Metric label="capital letter rate" value={(fp.capital_letter_rate * 100).toFixed(1) + "%"} />
      </div>
      <div className="sesh-style-section">
        <div className="sesh-style-section-title">Top tokens (tf-idf weighted)</div>
        <ul className="sesh-style-tokens">
          {fp.top_tokens.slice(0, 30).map((t) => (
            <li key={t.token} className="sesh-style-token">
              <span className="sesh-style-token-text">{t.token}</span>
              <span className="sesh-style-token-weight">{t.tfidf.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="sesh-style-metric">
      <div className="sesh-style-metric-value">{value}</div>
      <div className="sesh-style-metric-label">{label}</div>
    </div>
  );
}
