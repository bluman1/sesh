interface Props { name: string; }

export function PlaceholderTab({ name }: Props): JSX.Element {
  return (
    <div className="sesh-placeholder">
      <div className="sesh-placeholder-title">{name}</div>
      <div className="sesh-placeholder-body">Coming in a later substrate.</div>
    </div>
  );
}
