import { LibraryBig } from "lucide-react";
import type { KnowledgeSource, MessageKnowledgeStatus } from "../../api/types.js";
import { SourceCards } from "./KnowledgeSources.js";

export function MessageKnowledge({
  knowledge,
  sources = [],
}: {
  knowledge?: MessageKnowledgeStatus;
  sources?: KnowledgeSource[];
}) {
  if (!knowledge) return null;
  const labels = {
    disabled: "本次接诊未启用知识库",
    empty: "暂无可用知识资料，本次未使用知识库",
    no_match: "未检索到匹配资料，本次未使用知识库",
    local: "本地检索参考 · 供咨询师核对",
    used: "已向模型提供以下检索片段 · 请复核引用",
    safety: "本次优先进行安全核实，未检索知识库",
  };
  return (
    <div className={`xq-message-knowledge xq-knowledge-${knowledge.status}`}>
      <div className="xq-message-knowledge-label">
        <LibraryBig size={13} />
        <span>{labels[knowledge.status]}</span>
      </div>
      {knowledge.status === "local" && sources.length > 0 && (
        <p>以下片段是本地检索结果，未交给外部模型生成回答。</p>
      )}
      {!!knowledge.externalExcluded && (
        <p>{knowledge.externalExcluded} 个本地专用匹配片段未发送至模型。</p>
      )}
      {sources.length > 0 && <SourceCards sources={sources} />}
    </div>
  );
}
