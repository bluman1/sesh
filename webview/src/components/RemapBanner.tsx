import { useEffect, useState } from "react";
import { onHostMessage, postToHost } from "../messaging";

interface Candidate {
  fromPath: string;
  basename: string;
  sessionCount: number;
}

export function RemapBanner(): JSX.Element | null {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    return onHostMessage((msg) => {
      if (msg.kind === "remapSuggestion") {
        setCandidates(msg.candidates);
        setCurrentPath(msg.currentPath);
      }
    });
  }, []);

  const visible = candidates.filter((c) => !dismissed.has(c.fromPath));
  if (!currentPath || visible.length === 0) return null;

  return (
    <div className="sesh-remap-banner">
      {visible.map((c) => (
        <div key={c.fromPath} className="sesh-remap-row">
          <span className="sesh-remap-text">
            <strong>{c.sessionCount}</strong> session{c.sessionCount === 1 ? "" : "s"} from
            <code> {c.fromPath} </code>
            look like the same project as the current folder. Treat them as part of this folder?
          </span>
          <div className="sesh-remap-actions">
            <button
              className="sesh-action-btn sesh-action-primary"
              onClick={() => {
                postToHost({
                  kind: "addRemap",
                  fromPath: c.fromPath,
                  toPath: currentPath,
                });
                setDismissed((d) => new Set([...d, c.fromPath]));
              }}
            >
              Yes, merge
            </button>
            <button
              className="sesh-action-btn"
              onClick={() =>
                setDismissed((d) => new Set([...d, c.fromPath]))
              }
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
