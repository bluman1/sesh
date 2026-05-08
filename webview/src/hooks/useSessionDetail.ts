import { useEffect, useState } from "react";
import {
  onHostMessage,
  postToHost,
  type SessionDetail,
  type TranscriptMessage,
} from "../messaging";

export function useSessionDetail(id: string | null): {
  session: SessionDetail | null;
  transcript: TranscriptMessage[];
  loading: boolean;
} {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return onHostMessage((msg) => {
      if (msg.kind === "sessionDetail" && msg.session.id === id) {
        setSession(msg.session);
        setLoading(false);
      } else if (msg.kind === "transcript" && msg.id === id) {
        setTranscript(msg.messages);
      }
    });
  }, [id]);

  useEffect(() => {
    if (!id) {
      setSession(null);
      setTranscript([]);
      return;
    }
    setLoading(true);
    setSession(null);
    setTranscript([]);
    postToHost({ kind: "getSession", id });
    // Limit is read from sesh.transcriptLimit on the host side.
    postToHost({ kind: "getTranscript", id });
  }, [id]);

  return { session, transcript, loading };
}
