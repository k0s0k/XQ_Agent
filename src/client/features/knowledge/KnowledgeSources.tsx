import { BookOpen, ExternalLink } from "lucide-react";
import type { KnowledgeSource } from "../../api/types.js";
import { getSafeSourceUrl } from "../../utils/sourceUrl.js";

export function SourceLink({ value }: { value?: string }) {
  const href = getSafeSourceUrl(value);
  return href ? (
    <a className="xq-knowledge-source-link" href={href} target="_blank" rel="noreferrer">
      查看原始来源
      <ExternalLink size={12} />
    </a>
  ) : null;
}
export function SourceCards({
  sources,
  scores = false,
}: {
  sources: KnowledgeSource[];
  scores?: boolean;
}) {
  return (
    <div className="xq-knowledge-sources">
      {sources.map((source) => (
        <details className="xq-knowledge-source" key={`${source.documentId}-${source.chunkId}`}>
          <summary>
            <span className="xq-source-label">[{source.label}]</span>
            <span>
              {source.title}
              <small>
                片段 {source.chunkIndex}
                {scores && ` · 匹配分 ${source.score.toFixed(3)}`}
              </small>
            </span>
            <BookOpen size={15} />
          </summary>
          <div className="xq-source-body">
            <p>{source.excerpt}</p>
            <SourceLink value={source.source} />
            {scores && (
              <span className="xq-source-privacy">
                {source.allowExternal ? "允许随已授权对话发送片段" : "仅供本地检索"}
              </span>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
