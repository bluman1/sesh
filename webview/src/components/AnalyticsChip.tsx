import "./AnalyticsChip.css";
import type { SessionAnalyticsChip } from "../messaging";

interface Props { chip?: SessionAnalyticsChip; }

const OUTCOME_LABEL: Record<NonNullable<SessionAnalyticsChip["outcome"]>, string> = {
  open: "open",
  shipped: "shipped",
  "shipped-partial": "partial",
  reverted: "reverted",
  abandoned: "abandoned",
};

function shortModel(model: string | null): string | null {
  if (!model) return null;
  if (model.includes("opus")) return "opus";
  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("haiku")) return "haiku";
  return model.split("-").slice(-1)[0] ?? model;
}

function fmtUsd(usd: number): string {
  if (usd < 0.01) return "<$0.01";
  if (usd < 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(2)}`;
}

export function AnalyticsChip({ chip }: Props): JSX.Element | null {
  if (!chip) return null;
  const parts: JSX.Element[] = [];
  if (chip.outcome) {
    parts.push(
      <span key="outcome" className={`sesh-chip-outcome is-${chip.outcome}`}>
        <span className="sesh-chip-dot" />
        {OUTCOME_LABEL[chip.outcome]}
      </span>,
    );
  }
  if (chip.usd > 0) {
    parts.push(<span key="usd" className="sesh-chip">{fmtUsd(chip.usd)}</span>);
  }
  const m = shortModel(chip.primary_model);
  if (m) parts.push(<span key="m" className="sesh-chip">{m}</span>);
  if (parts.length === 0) return null;
  return <div className="sesh-chip-line">{parts}</div>;
}
