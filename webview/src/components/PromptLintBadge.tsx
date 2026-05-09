import { useEffect, useState } from "react";
import { onHostMessage, postToHost, type ToWebview } from "../messaging";

type LintsPayload = Extract<ToWebview, { kind: "promptLints" }>;

type Props = { sessionId: string | null };

export function PromptLintBadge({ sessionId }: Props): JSX.Element | null {
  const [lints, setLints] = useState<LintsPayload["lints"]>([]);
  const [forSessionId, setForSessionId] = useState<string | null>(null);

  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.kind === "promptLints" && msg.sessionId === sessionId) {
        setLints(msg.lints);
        setForSessionId(msg.sessionId);
      }
    });
    if (sessionId) {
      postToHost({ kind: "getPromptLints", sessionId });
    } else {
      setLints([]);
      setForSessionId(null);
    }
    return off;
  }, [sessionId]);

  if (!sessionId || forSessionId !== sessionId || lints.length === 0) return null;

  return (
    <div className="sesh-prompt-lint">
      {lints.map((l) => (
        <div key={l.id} className="sesh-prompt-lint-item">
          <div className="sesh-prompt-lint-message">{l.message}</div>
          <button
            type="button"
            className="sesh-prompt-lint-dismiss"
            onClick={() => {
              postToHost({ kind: "setPromptLintStatus", id: l.id, status: "dismissed" });
              setLints((prev) => prev.filter((x) => x.id !== l.id));
            }}
            title="Dismiss"
          >×</button>
        </div>
      ))}
    </div>
  );
}
