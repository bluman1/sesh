interface Props {
  name: string;
  className?: string;
  title?: string;
}

export function Icon({ name, className, title }: Props): JSX.Element {
  return (
    <i
      className={`codicon codicon-${name}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      title={title}
    />
  );
}
