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
    return <div className="sesh-insights-empty">No user messages indexed yet. The Knowledge tab will seed this once embeddings finish.</div>;
  }

  return (
    <div className="sesh-style">
      <div className="sesh-style-header">
        <div className="sesh-style-meta">
          <span className="sesh-style-meta-strong">{fp.source_chunk_count.toLocaleString()}</span> message{fp.source_chunk_count === 1 ? "" : "s"} ·{" "}
          <span className="sesh-style-meta-strong">{fp.source_session_count.toLocaleString()}</span> session{fp.source_session_count === 1 ? "" : "s"} ·{" "}
          <span className="sesh-style-meta-strong">{fp.total_chars.toLocaleString()}</span> chars
        </div>
        <div className="sesh-style-actions">
          <button
            type="button"
            className="sesh-style-action"
            onClick={() => navigator.clipboard?.writeText(JSON.stringify(fp, null, 2))}
          >Copy JSON</button>
          <button
            type="button"
            className="sesh-style-action"
            onClick={() => postToHost({ kind: "exportStyleFingerprint" })}
          >Save to file</button>
        </div>
      </div>

      <section className="sesh-style-section">
        <div className="sesh-style-section-title">Voice</div>
        <div className="sesh-style-metric-grid">
          <Metric value={fp.avg_user_chars_per_turn.toLocaleString()} label="avg chars / message" />
          <Metric value={fp.avg_words_per_sentence.toString()} label="words / sentence" />
          <Metric value={fp.question_rate_pct.toFixed(1) + "%"} label="messages that ask a question" />
          <Metric value={fp.code_block_rate_pct.toFixed(1) + "%"} label="messages w/ fenced code" />
        </div>
      </section>

      <section className="sesh-style-section">
        <div className="sesh-style-section-title">Tone</div>
        <div className="sesh-style-metric-grid">
          <Metric value={fp.hedging_per_1000_words.toString()} label="hedges / 1000 words" />
          <Metric value={fp.politeness_per_1000_words.toString()} label="please/thanks / 1000 words" />
          <Metric value={fp.exclamation_per_1000_chars.toString()} label="! / 1000 chars" />
          <Metric value={(fp.capital_letter_rate * 100).toFixed(1) + "%"} label="capital letter rate" />
        </div>
      </section>

      <section className="sesh-style-section">
        <div className="sesh-style-section-title">Vocabulary</div>
        <div className="sesh-style-metric-grid">
          <Metric value={fp.vocab_richness.toFixed(3)} label="vocab richness (unique / total)" />
        </div>
        <div className="sesh-style-tokens">
          {fp.top_tokens.slice(0, 30).map((t) => (
            <span key={t.token} className="sesh-style-token">
              <span className="sesh-style-token-text">{t.token}</span>
              <span className="sesh-style-token-weight">{t.tfidf.toFixed(2)}</span>
            </span>
          ))}
        </div>
      </section>

      {fp.by_outcome && fp.by_outcome.length >= 2 && (
        <section className="sesh-style-section">
          <div className="sesh-style-section-title">By outcome</div>
          <div className="sesh-style-section-subtitle">How your writing differs across session outcomes</div>
          <table className="sesh-style-outcome-table">
            <thead>
              <tr>
                <th>Outcome</th>
                <th>Sessions</th>
                <th>Avg chars / msg</th>
                <th>Words / sentence</th>
                <th>Question %</th>
                <th>Hedges / 1k</th>
              </tr>
            </thead>
            <tbody>
              {fp.by_outcome.map((b) => (
                <tr key={b.outcome}>
                  <td><OutcomeTag state={b.outcome} /></td>
                  <td className="sesh-style-num">{b.session_count}</td>
                  <td className="sesh-style-num">{b.avg_user_chars_per_turn.toLocaleString()}</td>
                  <td className="sesh-style-num">{b.avg_words_per_sentence}</td>
                  <td className="sesh-style-num">{b.question_rate_pct.toFixed(1)}%</td>
                  <td className="sesh-style-num">{b.hedging_per_1000_words}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {fp.top_openings.length > 0 && (
        <section className="sesh-style-section">
          <div className="sesh-style-section-title">How you start messages</div>
          <ul className="sesh-style-openings">
            {fp.top_openings.map((o) => (
              <li key={o.phrase} className="sesh-style-opening">
                <span className="sesh-style-opening-phrase">"{o.phrase}…"</span>
                <span className="sesh-style-opening-count">{o.count}×</span>
              </li>
            ))}
          </ul>
        </section>
      )}
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

function OutcomeTag({ state }: { state: string }): JSX.Element {
  const cls = `sesh-style-outcome-tag is-${state}`;
  return <span className={cls}>{state}</span>;
}
