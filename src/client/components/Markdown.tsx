import ReactMarkdown from "react-markdown";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="xq-markdown">
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
