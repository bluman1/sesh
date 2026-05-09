export function fmtUsd(usd: number): string {
  return "$" + usd.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function pluralize(n: number, singular: string, plural = singular + "s"): string {
  return n === 1 ? singular : plural;
}
