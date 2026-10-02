import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  Cloud,
  ExternalLink,
  FileText,
  LibraryBig,
  LockKeyhole,
  Search,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { requestApi } from "../../api/client.js";
import type { KnowledgeDocument, KnowledgeSource, SessionMessage } from "../../api/types.js";
import { Modal } from "../../components/Modal.js";
import { Spinner } from "../../components/Spinner.js";
import { getErrorMessage } from "../../utils/errors.js";
import { getSafeSourceUrl } from "../../utils/sourceUrl.js";

export function RelatedDocuments({
  message,
  loading,
  topK,
  onKnowledge,
}: {
  message?: SessionMessage;
  loading: boolean;
  topK: number;
  onKnowledge: () => void;
}) {
  const [preview, setPreview] = useState<(KnowledgeDocument & { content: string }) | null>(null);
  const [previewBusy, setPreviewBusy] = useState("");
  const [previewError, setPreviewError] = useState("");
  const request = useRef(0);
  useEffect(() => {
    request.current += 1;
    setPreviewError("");
    setPreviewBusy("");
    setPreview(null);
  }, [message?.id]);
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );
  const sources = message?.sources ?? [];
  const knowledge = message?.knowledge;
  const requested = knowledge?.requestedTopK ?? topK;
  async function viewDocument(source: KnowledgeSource) {
    const generation = ++request.current;
    setPreviewBusy(source.documentId);
    setPreviewError("");
    try {
      const data = await requestApi<{ document: KnowledgeDocument & { content: string } }>(
        `/knowledge/${source.documentId}`,
      );
      if (generation === request.current) setPreview(data.document);
    } catch (reason) {
      if (generation === request.current) setPreviewError(getErrorMessage(reason));
    } finally {
      if (generation === request.current) setPreviewBusy("");
    }
  }
  const empty = !message
    ? {
        title: "每个问题，都可以回到出处",
        body: "发送问题后，这里会展示最相关的 K 份不同文档，以及各自匹配度最高的原文片段。",
      }
    : knowledge?.status === "safety"
      ? { title: "本轮优先核实安全", body: "本轮未检索知识库。请先核实当前安全状况及可用支持。" }
      : knowledge?.status === "disabled"
        ? { title: "本轮未启用知识库", body: "打开“检索知识库”，下一条问题就会自动匹配相关资料。" }
        : knowledge?.status === "empty"
          ? {
              title: "知识库还没有可检索资料",
              body: "请先导入并启用专业资料，再发送需要查找依据的问题。",
            }
          : {
              title: "没有找到匹配文档",
              body: "试试资料中的具体主题或关键词，并确认相关文档已启用。系统不会用无关文档凑满 K 份。",
            };
  return (
    <aside
      id="main-chat-related-documents"
      className="xq-chat-documents"
      aria-label="相关知识库文档"
    >
      <header>
        <div>
          <span className="xq-chat-doc-icon">
            <LibraryBig size={18} />
          </span>
          <div>
            <h2>
              相关文档 <span>· Top {requested}</span>
            </h2>
            <p>{message ? `本轮匹配 ${sources.length} 份文档` : "随问题检索 · 保留来源"}</p>
          </div>
        </div>
        <button className="xq-icon-button" onClick={onKnowledge} aria-label="管理知识库">
          <Settings2 size={16} />
        </button>
      </header>
      <div className="xq-chat-doc-content">
        {loading && (
          <div className="xq-chat-searching" role="status">
            <Spinner />
            正在检索并等待回复…
          </div>
        )}
        {message && (
          <div className="xq-chat-source-context">
            <Search size={13} />
            <span>
              对应所选回复 ·{" "}
              {new Date(message.createdAt).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        )}
        {previewError && (
          <div className="xq-chat-small-error" role="alert">
            {previewError}
            <small>以下检索片段仍是回答时的来源快照。</small>
          </div>
        )}
        {sources.length ? (
          <>
            <p className="xq-chat-match-note">
              按文本匹配分排序，每份文档展示一个最佳片段。
              {sources.filter((source) => source.providedToModel).length} 份已提供给本轮模型。
            </p>
            <div className="xq-chat-document-list">
              {sources.map((source, index) => (
                <article className="xq-chat-document" key={`${message?.id}-${source.documentId}`}>
                  <div className="xq-chat-document-title">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <h3>{source.title}</h3>
                      <p>
                        <span>[{source.label}]</span> 匹配分 {source.score.toFixed(3)} · 片段{" "}
                        {source.chunkIndex}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`xq-chat-source-badge ${source.providedToModel ? "is-provided" : ""}`}
                  >
                    {source.providedToModel ? <Cloud size={11} /> : <LockKeyhole size={11} />}
                    {source.providedToModel ? "已提供给本轮模型" : "仅本地展示 · 本轮未发送"}
                  </span>
                  <details open={index === 0}>
                    <summary>
                      匹配原文
                      <ChevronDown size={14} />
                    </summary>
                    <p>{source.excerpt}</p>
                  </details>
                  <footer>
                    <button onClick={() => void viewDocument(source)} disabled={!!previewBusy}>
                      {previewBusy === source.documentId ? <Spinner /> : <FileText size={12} />}
                      查看当前正文
                    </button>
                    {getSafeSourceUrl(source.source) && (
                      <a href={getSafeSourceUrl(source.source)} target="_blank" rel="noreferrer">
                        原始来源
                        <ExternalLink size={11} />
                      </a>
                    )}
                  </footer>
                </article>
              ))}
            </div>
            <p className="xq-chat-doc-footnote">
              <ShieldCheck size={13} />
              <span>
                匹配分用于排序，不代表内容可信度或诊断概率。请核实资料版本、适用范围和回答引用。
              </span>
            </p>
          </>
        ) : (
          <div className="xq-chat-doc-empty">
            <span>
              <BookOpen size={30} strokeWidth={1.3} />
            </span>
            <h3>{empty.title}</h3>
            <p>{empty.body}</p>
            <button onClick={onKnowledge}>
              管理知识库
              <ArrowRight size={13} />
            </button>
          </div>
        )}
      </div>
      {preview && (
        <Modal
          title={preview.title}
          subtitle="当前知识库正文；回复旁的片段保留当时的检索内容。"
          wide
          onClose={() => setPreview(null)}
        >
          <pre className="xq-document-preview">{preview.content}</pre>
          <button
            className="xq-button xq-button-secondary xq-full-button"
            onClick={() => setPreview(null)}
          >
            关闭正文
          </button>
        </Modal>
      )}
    </aside>
  );
}
