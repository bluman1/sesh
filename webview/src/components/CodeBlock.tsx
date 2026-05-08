import { Highlight, themes } from "prism-react-renderer";
import type { ComponentPropsWithoutRef } from "react";

type CodeProps = ComponentPropsWithoutRef<"code"> & {
  inline?: boolean;
};

const isLightTheme = () =>
  typeof document !== "undefined" &&
  document.body.classList.contains("vscode-light");

export function CodeBlock(props: CodeProps): JSX.Element {
  const { inline, className, children, ...rest } = props;
  const text = String(children ?? "").replace(/\n$/, "");

  // ReactMarkdown calls this renderer for both inline `code` and fenced
  // code blocks. The fenced ones carry a `language-xyz` class.
  if (inline) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }

  const match = /language-(\w+)/.exec(className ?? "");
  const language = match?.[1] ?? "";
  const theme = isLightTheme() ? themes.vsLight : themes.vsDark;

  if (!language) {
    return (
      <pre className="sesh-codeblock sesh-codeblock-plain">
        <code>{text}</code>
      </pre>
    );
  }

  return (
    <Highlight code={text} language={language} theme={theme}>
      {({ className: hlClass, style, tokens, getLineProps, getTokenProps }) => (
        <pre className={`sesh-codeblock ${hlClass}`} style={style}>
          {tokens.map((line, i) => {
            const { key: _lk, ...lineProps } = getLineProps({ line });
            return (
              <div key={i} {...lineProps}>
                {line.map((token, j) => {
                  const { key: _tk, ...tokenProps } = getTokenProps({ token });
                  return <span key={j} {...tokenProps} />;
                })}
              </div>
            );
          })}
        </pre>
      )}
    </Highlight>
  );
}
