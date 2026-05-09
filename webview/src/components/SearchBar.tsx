import { useState, useEffect } from "react";

type Props = {
  value: string;
  onChange: (q: string) => void;
  placeholder?: string;
};

export function SearchBar({ value, onChange, placeholder }: Props): JSX.Element {
  // Local state for instant typing feedback; debounce upstream onChange.
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    const t = setTimeout(() => onChange(local), 250);
    return () => clearTimeout(t);
  }, [local, onChange]);

  return (
    <div className="sesh-search-bar">
      <input
        type="text"
        className="sesh-search-bar-input"
        placeholder={placeholder ?? "Search annotations + transcripts…"}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
      />
    </div>
  );
}
