import { Fragment, useMemo } from "react";

interface Props {
  text: string;
  query: string;
}

const STOP_WORDS = new Set(["and", "or", "not"]);

function parseTerms(query: string): string[] {
  return query
    .split(/\s+/)
    .map((t) => t.replace(/^["']|["']$/g, "").trim().toLowerCase())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function Highlight({ text, query }: Props): JSX.Element {
  const terms = useMemo(() => parseTerms(query), [query]);
  if (terms.length === 0) return <>{text}</>;
  const re = new RegExp(`(${terms.map(escapeRegex).join("|")})`, "gi");
  // String.split with a capture group: even-indexed = non-match, odd-indexed = match.
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="sesh-hl">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
