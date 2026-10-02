import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  Cloud,
  Database,
  FileText,
  LibraryBig,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { requestApi } from "../../api/client.js";
import type { KnowledgeDocument, KnowledgeSource } from "../../api/types.js";
import { Modal } from "../../components/Modal.js";
import { Spinner } from "../../components/Spinner.js";
import { getErrorMessage } from "../../utils/errors.js";
import { SourceCards, SourceLink } from "./KnowledgeSources.js";
import { ImportKnowledgeDialog } from "./ImportKnowledgeDialog.js";

const formatNumber = (value: number) => value.toLocaleString("zh-CN");

export function KnowledgeWorkspace({ onSettings }: { onSettings: () => void }) {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [storage, setStorage] = useState<"local" | "memory">("local");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<KnowledgeDocument | null>(null);
  const [preview, setPreview] = useState<(KnowledgeDocument & { content: string }) | null>(null);
  const [busyId, setBusyId] = useState("");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<{ sources: KnowledgeSource[]; query: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [reload, setReload] = useState(0);
  const searchGeneration = useRef(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    requestApi<{ documents: KnowledgeDocument[]; storage: "local" | "memory" }>("/knowledge")
      .then((data) => {
        if (active) {
          setDocuments(data.documents);
          setStorage(data.storage);
        }
      })
      .catch((reason) => {
        if (active) setError(getErrorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      searchGeneration.current += 1;
    };
  }, [reload]);
  function invalidateSearch() {
    searchGeneration.current += 1;
    setResult(null);
    setSearching(false);
  }
  async function updateDocument(
    document: KnowledgeDocument,
    changes: { enabled?: boolean; allowExternal?: boolean },
  ) {
    if (busyId) return;
    setBusyId(document.id);
    setError("");
    try {
      const data = await requestApi<{ document: KnowledgeDocument }>(`/knowledge/${document.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      setDocuments((previous) =>
        previous.map((item) => (item.id === document.id ? data.document : item)),
      );
      invalidateSearch();
      setNotice("资料设置已更新");
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusyId("");
    }
  }
  async function openPreview(document: KnowledgeDocument) {
    if (busyId) return;
    setBusyId(document.id);
    setError("");
    try {
      const data = await requestApi<{ document: KnowledgeDocument & { content: string } }>(
        `/knowledge/${document.id}`,
      );
      setPreview(data.document);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusyId("");
    }
  }
  async function deleteDocument() {
    if (!deleting || busyId) return;
    setBusyId(deleting.id);
    setError("");
    try {
      await requestApi(`/knowledge/${deleting.id}`, { method: "DELETE" });
      setDocuments((previous) => previous.filter((item) => item.id !== deleting.id));
      setDeleting(null);
      invalidateSearch();
      setNotice("资料及其索引已从知识库删除；既有对话中的引用快照仍会保留。");
    } catch (reason) {
      setError(getErrorMessage(reason));
      setDeleting(null);
    } finally {
      setBusyId("");
    }
  }
  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim() || searching) return;
    const generation = ++searchGeneration.current;
    setSearching(true);
    setError("");
    try {
      const data = await requestApi<{ sources: KnowledgeSource[]; query: string }>(
        "/knowledge/search",
        { method: "POST", body: JSON.stringify({ query: query.trim(), limit: 5 }) },
      );
      if (generation === searchGeneration.current) setResult(data);
    } catch (reason) {
      if (generation === searchGeneration.current) setError(getErrorMessage(reason));
    } finally {
      if (generation === searchGeneration.current) setSearching(false);
    }
  }
  const enabledCount = documents.filter((document) => document.enabled).length;
  const visibleDocuments = documents.filter((document) =>
    `${document.title} ${document.filename}`.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <div className="xq-knowledge-workspace">
      <div className="xq-knowledge-heading">
        <div>
          <span className="xq-eyebrow">KNOWLEDGE · GROUNDED IN CONTEXT</span>
          <h1>为每个建议，留一份依据。</h1>
          <p>整理专业资料，检索相关片段，回到原始出处复核。</p>
        </div>
        <button
          className="xq-button xq-button-primary"
          onClick={() => setImporting(true)}
          disabled={loading}
        >
          <Plus size={17} />
          导入资料
        </button>
      </div>
      <div className="xq-knowledge-overview">
        <div>
          <span className="xq-knowledge-stat-icon">
            <LibraryBig size={21} />
          </span>
          <span>
            <strong>
              {formatNumber(documents.length)}
              <small>份资料</small>
            </strong>
            <p>{enabledCount} 份已启用检索</p>
          </span>
        </div>
        <div>
          <span className="xq-knowledge-stat-icon">
            <Database size={21} />
          </span>
          <span>
            <strong>
              {formatNumber(documents.reduce((total, document) => total + document.chunkCount, 0))}
              <small>个片段</small>
            </strong>
            <p>自动分块 · 保留来源</p>
          </span>
        </div>
        <div>
          <span className="xq-knowledge-stat-icon">
            <LockKeyhole size={21} />
          </span>
          <span>
            <strong>本地检索</strong>
            <p>
              {storage === "local" ? "资料保存在本机，重启后保留" : "当前为内存知识库，重启后清空"}
            </p>
          </span>
        </div>
      </div>
      {error && (
        <div className="xq-knowledge-alert" role="alert">
          <span>{error}</span>
          <button className="xq-text-button" onClick={() => setReload((value) => value + 1)}>
            重新加载
          </button>
          <button
            className="xq-icon-button"
            aria-label="关闭知识库错误提示"
            onClick={() => setError("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div className="xq-knowledge-notice" role="status">
          <Check size={15} />
          <span>{notice}</span>
          <button
            className="xq-icon-button"
            aria-label="关闭知识库操作提示"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="xq-knowledge-columns">
        <section className="xq-knowledge-library">
          <div className="xq-section-heading">
            <div>
              <h2>你的知识资料</h2>
              <p>启用经审核的资料，为接诊补充可追溯线索</p>
            </div>
            <span className="xq-subtle-badge">{documents.length} 份</span>
          </div>
          {!!documents.length && (
            <label className="xq-knowledge-filter">
              <Search size={15} />
              <input
                aria-label="筛选知识资料"
                placeholder="按标题或文件名筛选"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
          )}
          {loading ? (
            <div className="xq-knowledge-empty">
              <Spinner />
              <p>正在读取本地知识库…</p>
            </div>
          ) : documents.length === 0 ? (
            <div className="xq-knowledge-empty">
              <span>
                <BookOpen size={33} strokeWidth={1.2} />
              </span>
              <h3>让专业积累成为随手可查的参考</h3>
              <p>
                导入机构接诊流程、专业指南或已审核的知识笔记。
                <br />
                每条检索结果都会保留文档标题与原文片段。
              </p>
              <button className="xq-button xq-button-secondary" onClick={() => setImporting(true)}>
                <Upload size={15} />
                导入第一份资料
              </button>
              <small>支持 TXT、Markdown、DOCX 与文本型 PDF</small>
            </div>
          ) : (
            <div className="xq-document-list">
              {visibleDocuments.map((document) => (
                <article
                  className={`xq-document-card ${!document.enabled ? "is-disabled" : ""}`}
                  key={document.id}
                >
                  <div className="xq-document-head">
                    <span className="xq-document-icon">
                      <FileText size={22} strokeWidth={1.5} />
                    </span>
                    <div>
                      <button
                        onClick={() => void openPreview(document)}
                        disabled={!!busyId}
                        className="xq-document-title"
                      >
                        {document.title}
                      </button>
                      <p>
                        <span>{document.format?.toUpperCase() || "TEXT"}</span>
                        {formatNumber(document.characterCount)} 字符<span>·</span>
                        {document.chunkCount} 个片段
                      </p>
                    </div>
                    <button
                      className="xq-icon-button"
                      aria-label={`删除资料：${document.title}`}
                      disabled={!!busyId}
                      onClick={() => setDeleting(document)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="xq-document-details">
                    <span>
                      {document.filename || "粘贴文本"} ·{" "}
                      {new Date(document.updatedAt).toLocaleDateString("zh-CN")}
                    </span>
                    <SourceLink value={document.source} />
                  </div>
                  <div className="xq-document-controls">
                    <label className="xq-knowledge-check">
                      <input
                        type="checkbox"
                        checked={document.enabled}
                        disabled={!!busyId}
                        onChange={(event) =>
                          void updateDocument(document, { enabled: event.target.checked })
                        }
                      />
                      <span>{document.enabled ? "已启用检索" : "未启用检索"}</span>
                    </label>
                    <label className="xq-knowledge-check">
                      <input
                        type="checkbox"
                        checked={document.allowExternal}
                        disabled={!!busyId}
                        onChange={(event) =>
                          void updateDocument(document, { allowExternal: event.target.checked })
                        }
                      />
                      <span>允许向模型发送片段</span>
                    </label>
                    <button
                      className="xq-text-button"
                      disabled={!!busyId}
                      onClick={() => void openPreview(document)}
                    >
                      {busyId === document.id ? <Spinner /> : "查看正文"}
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </article>
              ))}
              {visibleDocuments.length === 0 && (
                <p className="xq-knowledge-no-results">没有找到相应资料，试试其他标题。</p>
              )}
            </div>
          )}
          <div className="xq-knowledge-footnote">
            <ShieldCheck size={16} />
            <p>
              资料质量由你掌握。检索匹配不代表内容已获临床验证，请核实版本、适用范围及出处；个案记录请保留在接诊中。
            </p>
          </div>
        </section>
        <aside className="xq-knowledge-search-panel">
          <section className="xq-knowledge-search-card">
            <div className="xq-card-title">
              <span>
                <Search size={17} />
                试一试本地检索
              </span>
              <span className="xq-tiny-tag">BM25</span>
            </div>
            <p>输入主题或问题，查看启用资料中的相关片段。无需模型密钥。</p>
            <form onSubmit={search}>
              <label className="xq-sr-only" htmlFor="knowledge-query">
                知识库检索问题
              </label>
              <textarea
                id="knowledge-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="例如：初次接诊需要了解哪些信息？"
              />
              <button
                className="xq-button xq-button-primary"
                disabled={searching || !query.trim() || loading}
              >
                {searching ? <Spinner /> : <Search size={15} />}检索知识库
              </button>
            </form>
            {result && (
              <div className="xq-search-results" aria-live="polite">
                <p>
                  “{result.query}”<br />
                  <strong>
                    {result.sources.length
                      ? `找到 ${result.sources.length} 个相关片段`
                      : "未检索到匹配片段"}
                  </strong>
                </p>
                {result.sources.length ? (
                  <>
                    <SourceCards sources={result.sources} scores />
                    <small>匹配分用于排序，不是内容可信度或诊断概率。</small>
                  </>
                ) : (
                  <small>请尝试资料中的具体关键词，并确认相关资料已启用。</small>
                )}
              </div>
            )}
          </section>
          <section className="xq-knowledge-boundary">
            <span>
              <Cloud size={20} />
            </span>
            <h3>决定哪些资料可以提供给模型</h3>
            <p>
              默认只在本地检索。勾选文档的“允许向模型发送片段”后，还需在当前对话中启用知识库并允许模型处理，匹配片段才会进入模型上下文。
            </p>
            <button onClick={onSettings}>
              管理模型连接
              <ArrowRight size={14} />
            </button>
          </section>
        </aside>
      </div>
      {importing && (
        <ImportKnowledgeDialog
          onClose={() => setImporting(false)}
          onCreated={(document) => {
            setDocuments((previous) => [document, ...previous]);
            setImporting(false);
            invalidateSearch();
            setNotice(`已导入「${document.title}」，建立 ${document.chunkCount} 个检索片段。`);
          }}
        />
      )}
      {preview && (
        <Modal
          title={preview.title}
          subtitle={`${preview.chunkCount} 个片段 · ${formatNumber(preview.characterCount)} 字符 · ${preview.enabled ? "已启用检索" : "未启用检索"}`}
          onClose={() => setPreview(null)}
          wide
        >
          <div className="xq-document-preview-meta">
            <SourceLink value={preview.source} />
            <span>
              <LockKeyhole size={13} />
              {preview.allowExternal ? "允许向已授权模型发送匹配片段" : "仅供本地检索"}
            </span>
          </div>
          <pre className="xq-document-preview">{preview.content}</pre>
          <button
            className="xq-button xq-button-secondary xq-full-button"
            onClick={() => setPreview(null)}
          >
            关闭预览
          </button>
        </Modal>
      )}
      {deleting && (
        <Modal
          title="删除这份知识资料？"
          subtitle={`「${deleting.title}」的正文与检索索引将从本机知识库删除。`}
          onClose={() => {
            if (!busyId) setDeleting(null);
          }}
        >
          <p className="xq-delete-notice">
            后续问诊不会再检索这份资料。既有对话中已保存的引用片段仍会保留。此操作无法撤销。
          </p>
          <div className="xq-modal-actions">
            <button
              className="xq-button xq-button-secondary"
              onClick={() => setDeleting(null)}
              disabled={!!busyId}
            >
              保留资料
            </button>
            <button
              className="xq-button xq-button-danger"
              onClick={() => void deleteDocument()}
              disabled={!!busyId}
            >
              {busyId ? <Spinner /> : <Trash2 size={16} />}确认删除资料
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
