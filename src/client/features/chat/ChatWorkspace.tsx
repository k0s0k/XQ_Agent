import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  BookOpen,
  Cloud,
  LibraryBig,
  LockKeyhole,
  MessageCircle,
  Plus,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Markdown } from "../../components/Markdown.js";
import { requestApi } from "../../api/client.js";
import type { Session, SessionMessage, Status } from "../../api/types.js";
import { Modal } from "../../components/Modal.js";
import { Spinner } from "../../components/Spinner.js";
import { getErrorMessage } from "../../utils/errors.js";
import { RelatedDocuments } from "./RelatedDocuments.js";

type ChatPreferences = { topK: number; useKnowledge: boolean; consent: boolean };
type ChatWorkspaceProps = {
  sessions: Session[];
  selectedId: string | null;
  status: Status | null;
  disabled: boolean;
  onSelect: (id: string | null) => void;
  onUpdate: (session: Session) => void;
  onDelete: (id: string) => void;
  onSettings: () => void;
  onKnowledge: () => void;
};
const prompts = [
  {
    label: "梳理接诊流程",
    text: "请帮我梳理初次心理咨询接诊时需要了解的信息，并区分已知事实和待核实问题。",
  },
  {
    label: "查找知识依据",
    text: "请检索知识库中与建立咨询关系相关的资料，概括主要观点并标注来源。",
  },
  { label: "整理专业笔记", text: "怎样把一次咨询的工作笔记整理得清晰、客观，并保护来访者隐私？" },
];
const getResponseLabel = (message: SessionMessage) =>
  message.responseMode === "llm"
    ? "心桥 · 模型回答"
    : message.responseMode === "local"
      ? "心桥 · 本地检索提示"
      : message.responseMode === "safety"
        ? "心桥 · 安全核实提示"
        : "心桥回复";
export function ChatWorkspace({
  sessions,
  selectedId,
  status,
  disabled,
  onSelect,
  onUpdate,
  onDelete,
  onSettings,
  onKnowledge,
}: ChatWorkspaceProps) {
  const [preferences, setPreferences] = useState<ChatPreferences>({
    topK: 5,
    useKnowledge: true,
    consent: false,
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [selectedResponses, setSelectedResponses] = useState<Record<string, string | null>>({});
  const [pending, setPending] = useState<{ id: string; content: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [patchBusy, setPatchBusy] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const current = sessions.find((session) => session.id === selectedId) ?? null;
  const key = current?.id ?? "new";
  const topK = current?.topK ?? preferences.topK;
  const useKnowledge = current?.useKnowledge ?? preferences.useKnowledge;
  const consent = current?.consent ?? preferences.consent;
  const live = status?.mode === "live";
  const connected = live && consent;
  const draft = drafts[key] ?? "";
  const isPending = pending?.id === key;
  const allResponses = current?.messages.filter((message) => message.role === "assistant") ?? [];
  const selectedResponse =
    allResponses.find((message) => message.id === selectedResponses[key]) ??
    allResponses[allResponses.length - 1];
  const busy = !!pending || creating || deleteBusy;
  useEffect(() => {
    setPreferences((previous) => ({ ...previous, consent: false }));
  }, [status]);
  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" });
  }, [current?.id, current?.messages.length, isPending]);
  function newConversation() {
    if (busy) return;
    onSelect(null);
    setPreferences((previous) => ({ ...previous, consent: false }));
    setDrafts((previous) => ({ ...previous, new: "" }));
    setError("");
  }
  function selectResponse(id: string) {
    setSelectedResponses((previous) => ({ ...previous, [key]: id }));
    if (window.matchMedia("(max-width: 1080px)").matches) {
      requestAnimationFrame(() =>
        document.getElementById("main-chat-related-documents")?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
          block: "start",
        }),
      );
    }
  }
  async function changePreferences(changes: Partial<ChatPreferences>) {
    if (patchBusy) return;
    setError("");
    if (!current) {
      setPreferences((previous) => ({ ...previous, ...changes }));
      return;
    }
    setPatchBusy(true);
    try {
      const data = await requestApi<{ session: Session }>(`/sessions/${current.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      onUpdate(data.session);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setPatchBusy(false);
    }
  }
  async function deleteConversation() {
    if (!current || busy) return;
    const id = current.id;
    setDeleteBusy(true);
    setError("");
    try {
      await requestApi(`/sessions/${id}`, { method: "DELETE" });
      onDelete(id);
      onSelect(null);
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      setSelectedResponses((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      setPreferences((previous) => ({ ...previous, consent: false }));
      setDeleting(false);
    } catch (reason) {
      setDeleting(false);
      setError(getErrorMessage(reason));
    } finally {
      setDeleteBusy(false);
    }
  }
  async function send(event?: FormEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || sending.current || patchBusy || disabled) return;
    sending.current = true;
    setError("");
    let active = current;
    try {
      if (!active) {
        setCreating(true);
        const data = await requestApi<{ session: Session }>("/sessions", {
          method: "POST",
          body: JSON.stringify({
            kind: "chat",
            name: content.slice(0, 30),
            topK,
            useKnowledge,
            consent: !!live && consent,
          }),
        });
        active = data.session;
        onUpdate(active);
        onSelect(active.id);
        setPreferences((previous) => ({ ...previous, consent: false }));
        setDrafts((previous) => ({ ...previous, [active!.id]: content, new: "" }));
      }
      setCreating(false);
      setPending({ id: active.id, content });
      const data = await requestApi<{ session: Session }>(`/sessions/${active.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      onUpdate(data.session);
      setDrafts((previous) => ({ ...previous, [active!.id]: "" }));
      setSelectedResponses((previous) => ({ ...previous, [active!.id]: null }));
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      sending.current = false;
      setCreating(false);
      setPending(null);
    }
  }
  return (
    <div className="xq-direct-chat">
      <div className="xq-direct-heading">
        <div>
          <span className="xq-eyebrow">CONVERSATION · CONNECTED TO KNOWLEDGE</span>
          <h1>把问题展开，让依据可见。</h1>
          <p>直接与模型对话，随时查阅与你的问题相关的知识资料。</p>
        </div>
        <div className="xq-chat-heading-actions">
          {current && (
            <button
              className="xq-icon-button"
              aria-label="删除当前主对话"
              disabled={busy || patchBusy || disabled}
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={16} />
            </button>
          )}
          <button
            className="xq-button xq-button-secondary"
            onClick={newConversation}
            disabled={busy || disabled}
          >
            <Plus size={16} />
            新对话
          </button>
        </div>
      </div>
      <div className="xq-direct-toolbar">
        <label className="xq-chat-picker">
          <MessageCircle size={16} />
          <select
            aria-label="选择主对话"
            value={current?.id ?? ""}
            disabled={busy || disabled}
            onChange={(event) => {
              onSelect(event.target.value || null);
              setError("");
            }}
          >
            <option value="">新的对话</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.name}
              </option>
            ))}
          </select>
        </label>
        <div className="xq-chat-controls">
          <label className="xq-knowledge-check">
            <input
              type="checkbox"
              checked={useKnowledge}
              disabled={busy || patchBusy || disabled}
              onChange={(event) => void changePreferences({ useKnowledge: event.target.checked })}
            />
            <span>检索知识库</span>
          </label>
          <label className="xq-chat-topk">
            Top K
            <select
              aria-label="相关文档数量 Top K"
              value={topK}
              disabled={busy || patchBusy || disabled || !useKnowledge}
              onChange={(event) => void changePreferences({ topK: Number(event.target.value) })}
            >
              {Array.from({ length: 10 }, (_, index) => (
                <option value={index + 1} key={index + 1}>
                  {index + 1}
                </option>
              ))}
            </select>
            <span>份文档</span>
          </label>
        </div>
      </div>
      <div className="xq-direct-layout">
        <section className="xq-direct-conversation" aria-label="主对话窗口">
          <div className={`xq-chat-connection ${connected ? "is-connected" : ""}`}>
            <span>{connected ? <Cloud size={16} /> : <LockKeyhole size={16} />}</span>
            <div>
              <strong>
                {connected
                  ? `在线模式 · ${status?.model}`
                  : live
                    ? "模型已配置，等待本对话授权"
                    : "配置模型后，即可开始 LLM 对话"}
              </strong>
              <p>
                {connected
                  ? "发送时会提供对话历史及获准外发的知识片段。"
                  : live
                    ? "未授权时仅本地检索，不会生成模型回答。"
                    : "当前可先体验本地知识检索；密钥仅保存在服务内存。"}
              </p>
            </div>
            <button onClick={onSettings}>
              <Settings2 size={13} />
              模型设置
            </button>
          </div>
          <label className="xq-chat-consent">
            <input
              type="checkbox"
              checked={!!live && consent}
              disabled={!live || disabled || patchBusy || (busy && !consent)}
              onChange={(event) => void changePreferences({ consent: event.target.checked })}
            />
            <span>
              允许本对话发送至模型
              <small>请仅发送获准处理的信息。知识资料另需启用“允许向模型发送片段”。</small>
            </span>
            {patchBusy && <Spinner />}
          </label>
          {error && (
            <div className="xq-chat-error" role="alert">
              <TriangleAlert size={15} />
              <span>{error}</span>
              <button
                className="xq-icon-button"
                aria-label="关闭主对话提示"
                onClick={() => setError("")}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div className="xq-direct-scroll" ref={scroll}>
            {!current?.messages.length && !isPending && (
              <div className="xq-chat-welcome">
                <span className="xq-chat-welcome-mark">
                  <Sparkles size={28} strokeWidth={1.3} />
                </span>
                <h2>你好，今天想一起探索什么？</h2>
                <p>
                  可以提问、整理思路，或对知识库中的资料追问。
                  <br />
                  不需要先建立来访者档案。
                </p>
                <div className="xq-chat-prompts">
                  {prompts.map((prompt) => (
                    <button
                      key={prompt.label}
                      onClick={() => setDrafts((previous) => ({ ...previous, [key]: prompt.text }))}
                      disabled={busy || disabled}
                    >
                      <BookOpen size={15} />
                      <span>{prompt.label}</span>
                      <ArrowRight size={13} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {current?.messages.map((message) => (
              <article
                key={message.id}
                className={`xq-direct-message xq-direct-message-${message.role}`}
              >
                <span
                  className={
                    message.role === "assistant" ? "xq-assistant-avatar" : "xq-counselor-avatar"
                  }
                >
                  {message.role === "assistant" ? <Sparkles size={16} /> : "咨"}
                </span>
                <div>
                  <div className="xq-direct-message-meta">
                    <span>{message.role === "assistant" ? getResponseLabel(message) : "你"}</span>
                    <time>
                      {new Date(message.createdAt).toLocaleTimeString("zh-CN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <div className="xq-direct-bubble">
                    <Markdown>{message.content}</Markdown>
                  </div>
                  {message.role === "assistant" && (
                    <button
                      className={`xq-view-related ${selectedResponse?.id === message.id ? "is-selected" : ""}`}
                      aria-pressed={selectedResponse?.id === message.id}
                      onClick={() => selectResponse(message.id)}
                    >
                      <LibraryBig size={13} />
                      {message.knowledge?.status === "safety"
                        ? "查看本轮安全处理状态"
                        : `查看本轮相关文档 · ${message.sources?.length ?? 0} 份`}
                      <ArrowRight size={12} />
                    </button>
                  )}
                </div>
              </article>
            ))}
            {isPending && (
              <>
                <article className="xq-direct-message xq-direct-message-user">
                  <span className="xq-counselor-avatar">咨</span>
                  <div>
                    <div className="xq-direct-message-meta">
                      <span>你</span>
                      <span>发送中</span>
                    </div>
                    <div className="xq-direct-bubble">
                      <p className="xq-chat-pending-text">{pending.content}</p>
                    </div>
                  </div>
                </article>
                <div className="xq-thinking" role="status">
                  <Spinner />
                  <span>
                    {connected
                      ? useKnowledge
                        ? "正在检索相关资料并等待模型回答…"
                        : "正在等待模型回答…"
                      : useKnowledge
                        ? "正在本地检索相关资料…"
                        : "正在处理问题…"}
                  </span>
                </div>
              </>
            )}
          </div>
          <form className="xq-direct-composer" onSubmit={send}>
            <label className="xq-sr-only" htmlFor="main-chat-message">
              向模型提问
            </label>
            <textarea
              id="main-chat-message"
              rows={3}
              maxLength={6000}
              value={draft}
              disabled={busy || disabled}
              onChange={(event) =>
                setDrafts((previous) => ({ ...previous, [key]: event.target.value }))
              }
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  (event.ctrlKey || event.metaKey)
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder="输入你的问题，或围绕知识库中的资料展开讨论…"
            />
            <div>
              <span>
                {useKnowledge ? (
                  <>
                    <LibraryBig size={12} />
                    最多匹配 {topK} 份不同文档
                  </>
                ) : (
                  <>
                    <MessageCircle size={12} />
                    本轮不检索知识库
                  </>
                )}
              </span>
              <button
                className="xq-button xq-button-primary"
                type="submit"
                disabled={busy || patchBusy || disabled || !draft.trim()}
              >
                {busy ? <Spinner /> : <Send size={15} />}
                {creating
                  ? "建立对话中…"
                  : busy
                    ? "等待回复…"
                    : connected
                      ? "发送"
                      : useKnowledge
                        ? "发送并本地检索"
                        : "查看连接提示"}
              </button>
            </div>
          </form>
          <p className="xq-direct-footnote">
            模型回答需专业复核 · 对话仅存服务内存 · Ctrl / ⌘ + Enter 发送
          </p>
        </section>
        <RelatedDocuments
          message={selectedResponse}
          loading={isPending}
          topK={topK}
          onKnowledge={onKnowledge}
        />
      </div>
      {deleting && current && (
        <Modal
          title="删除这段主对话？"
          subtitle={`「${current.name}」的消息及来源快照将从当前服务中删除。`}
          onClose={() => {
            if (!deleteBusy) setDeleting(false);
          }}
        >
          <p className="xq-delete-notice">此操作无法撤销。知识库中的原始文档会继续保留。</p>
          <div className="xq-modal-actions">
            <button
              className="xq-button xq-button-secondary"
              disabled={deleteBusy}
              onClick={() => setDeleting(false)}
            >
              保留对话
            </button>
            <button
              className="xq-button xq-button-danger"
              disabled={deleteBusy}
              onClick={() => void deleteConversation()}
            >
              {deleteBusy ? <Spinner /> : <Trash2 size={15} />}确认删除对话
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
