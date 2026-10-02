import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  FileText,
  HeartHandshake,
  LayoutDashboard,
  LibraryBig,
  LockKeyhole,
  Menu,
  MessageCircle,
  MessageSquarePlus,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { requestApi } from "./api/client.js";
import type { AssessmentDefinition, Instrument, Session, Status } from "./api/types.js";
import { Modal } from "./components/Modal.js";
import { Spinner } from "./components/Spinner.js";
import { Markdown } from "./components/Markdown.js";
import { getErrorMessage } from "./utils/errors.js";
import { IntakeDashboard } from "./features/intake/IntakeDashboard.js";
import { UsageGuideDialog } from "./features/intake/UsageGuideDialog.js";
import { IntakeDialog } from "./features/intake/IntakeDialog.js";
import { AssessmentDialog } from "./features/intake/AssessmentDialog.js";
import { ConsentDialog } from "./features/intake/ConsentDialog.js";
import { ModelSettingsDialog } from "./features/settings/ModelSettingsDialog.js";
import { KnowledgeWorkspace } from "./features/knowledge/KnowledgeWorkspace.js";
import { MessageKnowledge } from "./features/knowledge/MessageKnowledge.js";
import { ChatWorkspace } from "./features/chat/ChatWorkspace.js";

const formatShortDate = (value: string) =>
  new Date(value).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
const riskLabels = {
  routine: "未触发规则提醒",
  attention: "需进一步核实安全状况",
  urgent: "优先核实安全",
};
export function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workspaceView, setWorkspaceView] = useState<"chat" | "care" | "knowledge">("chat");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [offline, setOffline] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState("");
  const [modal, setModal] = useState<
    "intake" | "settings" | "assessment" | "guide" | "delete" | "consent" | null
  >(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [activeTab, setActiveTab] = useState<"conversation" | "summary">("conversation");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<{ id: string; action: string } | null>(null);
  const [assessmentId, setAssessmentId] = useState<Instrument>("phq9");
  const [definitions, setDefinitions] = useState<AssessmentDefinition[]>([]);
  const [reload, setReload] = useState(0);
  const scrollEnd = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const current =
    workspaceView === "care"
      ? (sessions.find((session) => session.id === selectedId) ?? null)
      : null;
  const intakeSessions = sessions.filter((session) => session.kind !== "chat");
  const chatSessions = sessions.filter((session) => session.kind === "chat");
  const currentBusy = busy?.id === current?.id;
  useEffect(() => {
    let disposed = false;
    setInitializing(true);
    Promise.all([
      requestApi<{ sessions: Session[] }>("/sessions"),
      requestApi<Status>("/status"),
      requestApi<{ assessments: AssessmentDefinition[] }>("/assessments"),
    ])
      .then(([data, nextStatus, catalog]) => {
        if (!disposed) {
          setSessions(data.sessions);
          setStatus(nextStatus);
          setDefinitions(catalog.assessments);
          setOffline(false);
          setError("");
        }
      })
      .catch((reason) => {
        if (!disposed) {
          setOffline(true);
          setError(getErrorMessage(reason));
        }
      })
      .finally(() => {
        if (!disposed) setInitializing(false);
      });
    return () => {
      disposed = true;
    };
  }, [reload]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    if (modal) setMobileNav(false);
  }, [modal]);
  useEffect(() => {
    scrollEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [selectedId, current?.messages.length, busy]);
  function updateSession(session: Session) {
    setSessions((previous) =>
      [session, ...previous.filter((item) => item.id !== session.id)].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    );
  }
  function selectSession(id: string | null) {
    setWorkspaceView("care");
    setSelectedId(id);
    setActiveTab("conversation");
    setMobileNav(false);
    setError("");
  }
  function openChat() {
    setWorkspaceView("chat");
    setMobileNav(false);
    setError("");
  }
  function openKnowledge() {
    setWorkspaceView("knowledge");
    setMobileNav(false);
    setError("");
  }
  async function updateKnowledge(useKnowledge: boolean) {
    if (!current || busy) return;
    const id = current.id;
    setBusy({ id, action: "knowledge" });
    setError("");
    try {
      const data = await requestApi<{ session: Session }>(`/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ useKnowledge }),
      });
      updateSession(data.session);
      setToast(useKnowledge ? "已启用本次接诊的知识库检索" : "已关闭本次接诊的知识库检索");
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(null);
    }
  }
  function openAssessment(instrument: Instrument) {
    setAssessmentId(instrument);
    setModal("assessment");
  }
  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    if (!current || busy) return;
    const id = current.id,
      content = (drafts[id] ?? "").trim();
    if (!content) return;
    setBusy({ id, action: "message" });
    setError("");
    try {
      const data = await requestApi<{ session: Session }>(`/sessions/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      updateSession(data.session);
      setDrafts((previous) => ({ ...previous, [id]: "" }));
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(null);
    }
  }
  async function saveNotes() {
    if (!current || busy) return;
    const id = current.id;
    setBusy({ id, action: "notes" });
    setError("");
    try {
      const data = await requestApi<{ session: Session }>(`/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ notes: notes[id] ?? current.notes }),
      });
      updateSession(data.session);
      setToast("咨询师笔记已保存至当前服务内存");
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(null);
    }
  }
  async function generateSummary() {
    if (current && notes[current.id] !== undefined && notes[current.id] !== current.notes) {
      setError("随记有未保存修改，请先点击“保存”，再生成摘要。");
      return;
    }
    if (!current || busy) return;
    const id = current.id;
    setBusy({ id, action: "summary" });
    setError("");
    try {
      const data = await requestApi<{ session: Session }>(`/sessions/${id}/summary`, {
        method: "POST",
        body: "{}",
      });
      updateSession(data.session);
      if (selectedIdRef.current === id) setActiveTab("summary");
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(null);
    }
  }
  function exportSummary() {
    if (current && notes[current.id] !== undefined && notes[current.id] !== current.notes) {
      setError("随记有未保存修改，请先保存并重新生成摘要后再导出。");
      return;
    }
    if (!current?.summary) return;
    const content = `# 心桥 · 接诊辅助摘要\n\n来访者代称：${current.name}\n\n导出时间：${new Date().toLocaleString("zh-CN")}\n\n> 本摘要在本地整理，须由咨询师核实；不构成诊断。\n\n${current.summary}\n`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `心桥-接诊摘要-${new Date().toISOString().slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(url);
    setToast("摘要已导出，请妥善保管含来访信息的文件");
  }
  async function deleteSession() {
    if (!current || busy) return;
    const id = current.id;
    setBusy({ id, action: "delete" });
    try {
      await requestApi(`/sessions/${id}`, { method: "DELETE" });
      setSessions((previous) => previous.filter((session) => session.id !== id));
      setNotes((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      selectSession(null);
      setModal(null);
      setToast("接诊记录已删除");
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(null);
    }
  }
  async function updateConsent(consent: boolean) {
    if (!current || consentBusy || (consent && status?.mode !== "live")) return;
    const id = current.id;
    setConsentBusy(true);
    setError("");
    try {
      const data = await requestApi<{ session: Session }>(`/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ consent }),
      });
      updateSession(data.session);
      setModal(null);
      setToast(consent ? "已确认外部模型处理同意" : "已撤回外部处理同意，将使用本地规则建议");
    } catch (reason) {
      setModal(null);
      setError(getErrorMessage(reason));
    } finally {
      setConsentBusy(false);
    }
  }
  async function settingsSaved(nextStatus: Status) {
    setBusy({ id: "settings", action: "settings" });
    setStatus(nextStatus);
    try {
      const data = await requestApi<{ sessions: Session[] }>("/sessions");
      setSessions(data.sessions);
      setToast("模型设置已更新，密钥仅存于服务端内存");
    } catch (reason) {
      setSessions((previous) => previous.map((session) => ({ ...session, consent: false })));
      setError(getErrorMessage(reason));
    } finally {
      setBusy(null);
      setModal(null);
    }
  }
  return (
    <div className="xq-app">
      {mobileNav && (
        <button
          aria-label="关闭导航"
          className="xq-nav-backdrop"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`xq-sidebar ${mobileNav ? "is-open" : ""}`}>
        <button className="xq-brand" onClick={openChat} aria-label="心桥工作台首页">
          <span className="xq-brand-mark">
            <HeartHandshake size={28} strokeWidth={1.4} />
          </span>
          <span>
            <strong>
              心桥<span className="xq-brand-dot">.</span>
            </strong>
            <small>心理咨询工作台</small>
          </span>
        </button>
        <div className="xq-workspace-label">
          <span className="xq-workspace-avatar">心</span>
          <span>
            咨询师个人工作空间<small>专注于每一次理解</small>
          </span>
          <ChevronDown size={14} />
        </div>
        <nav aria-label="工作台导航">
          <button className={workspaceView === "chat" ? "is-active" : ""} onClick={openChat}>
            <MessageCircle size={18} />
            <span>主对话</span>
            <span className="xq-nav-count">LLM</span>
          </button>
          <button
            className={workspaceView === "care" && !current ? "is-active" : ""}
            onClick={() => selectSession(null)}
          >
            <LayoutDashboard size={18} />
            <span>接诊工作台</span>
            <span className="xq-nav-shortcut">⌘</span>
          </button>
          <button onClick={() => openAssessment("phq9")}>
            <ClipboardList size={18} />
            <span>筛查量表</span>
            <span className="xq-nav-count">02</span>
          </button>
          <button
            className={workspaceView === "knowledge" ? "is-active" : ""}
            onClick={openKnowledge}
          >
            <LibraryBig size={18} />
            <span>知识库</span>
            <span className="xq-nav-count">RAG</span>
          </button>
          <button onClick={() => setModal("guide")}>
            <BookOpen size={18} />
            <span>接诊使用指南</span>
          </button>
        </nav>
        <div className="xq-session-label">
          <span>
            接诊记录 <b>{intakeSessions.length.toString().padStart(2, "0")}</b>
          </span>
          <button onClick={() => setModal("intake")} aria-label="新建接诊">
            <Plus size={17} />
          </button>
        </div>
        <label className="xq-search">
          <Search size={15} />
          <input
            aria-label="搜索来访者代称"
            placeholder="搜索来访者代称"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
        <div className="xq-session-list">
          {initializing ? (
            <div className="xq-sidebar-empty">
              <Spinner />
              <p>正在连接工作空间…</p>
            </div>
          ) : intakeSessions.length === 0 ? (
            <div className="xq-sidebar-empty">
              <MessageCircle size={27} strokeWidth={1.1} />
              <p>还没有接诊记录</p>
              <small>从一次认真倾听开始</small>
            </div>
          ) : (
            intakeSessions
              .filter(
                (session) => session.name.includes(filter) || session.concern.includes(filter),
              )
              .map((session) => (
                <button
                  key={session.id}
                  className={`xq-session-item ${workspaceView === "care" && selectedId === session.id ? "is-active" : ""}`}
                  onClick={() => selectSession(session.id)}
                >
                  <span className="xq-session-avatar">{session.name.slice(0, 1)}</span>
                  <span>
                    <strong>{session.name}</strong>
                    <small>{session.concern || "尚未记录议题"}</small>
                  </span>
                  <time>{formatShortDate(session.updatedAt)}</time>
                  {session.risk !== "routine" && (
                    <span className="xq-risk-dot" aria-label="需要安全评估" />
                  )}
                </button>
              ))
          )}
          {!!intakeSessions.length &&
            !intakeSessions.some(
              (session) => session.name.includes(filter) || session.concern.includes(filter),
            ) && <p className="xq-sidebar-empty">没有找到相关记录</p>}
        </div>
        <div className="xq-sidebar-bottom">
          <div className="xq-private-note">
            <ShieldCheck size={17} />
            <span>
              本地记录保存在服务内存<small>重启服务后清空，请及时导出</small>
            </span>
          </div>
          <button className="xq-settings-trigger" onClick={() => setModal("settings")}>
            <span className="xq-user-avatar">咨</span>
            <span>
              <strong>咨询师工作模式</strong>
              <small>
                <i className={status?.mode === "live" ? "live" : ""} />
                {offline
                  ? "服务暂未连接"
                  : status?.mode === "live"
                    ? "模型已配置 · 在线模式"
                    : "演示模式 · 无需密钥"}
              </small>
            </span>
            <Settings2 size={18} />
          </button>
        </div>
      </aside>
      <div className="xq-body">
        <header className="xq-topbar">
          <div className="xq-breadcrumb">
            <button
              className="xq-mobile-menu xq-icon-button"
              onClick={() => setMobileNav(true)}
              aria-label="打开导航"
            >
              <Menu size={21} />
            </button>
            <span>工作空间</span>
            <ChevronRight size={14} />
            <strong>
              {workspaceView === "chat"
                ? "主对话"
                : workspaceView === "knowledge"
                  ? "知识库"
                  : current
                    ? "辅助接诊"
                    : "接诊工作台"}
            </strong>
          </div>
          <div className="xq-topbar-right">
            <span className="xq-status-pill">
              <i />
              {status?.mode === "live" ? "在线模型" : "演示模式"}
            </span>
            <button
              className="xq-icon-button"
              onClick={() => setModal("guide")}
              aria-label="查看接诊使用指南"
            >
              <CircleHelp size={19} />
            </button>
            <span className="xq-topbar-avatar">咨</span>
          </div>
        </header>
        {error && (
          <div className="xq-error" role="alert">
            <TriangleAlert size={18} />
            <span>{error}</span>
            {offline && (
              <button onClick={() => setReload((value) => value + 1)} disabled={initializing}>
                重新连接
              </button>
            )}
            <button className="xq-icon-button" aria-label="关闭提示" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        <div
          className={`xq-content-grid ${workspaceView === "chat" ? "xq-direct-grid" : workspaceView === "knowledge" ? "xq-knowledge-grid" : ""}`}
        >
          <main className={`xq-main ${current ? "xq-main-session" : ""}`}>
            <div hidden={workspaceView !== "chat"}>
              <ChatWorkspace
                sessions={chatSessions}
                selectedId={selectedChatId}
                status={status}
                disabled={offline || initializing}
                onSelect={setSelectedChatId}
                onUpdate={updateSession}
                onDelete={(id) =>
                  setSessions((previous) => previous.filter((session) => session.id !== id))
                }
                onSettings={() => setModal("settings")}
                onKnowledge={openKnowledge}
              />
            </div>
            {workspaceView === "chat" ? null : workspaceView === "knowledge" ? (
              <KnowledgeWorkspace onSettings={() => setModal("settings")} />
            ) : !current ? (
              <>
                <IntakeDashboard
                  disabled={offline || initializing}
                  onNewIntake={() => setModal("intake")}
                  onAssessment={openAssessment}
                />
              </>
            ) : (
              <>
                <div className="xq-session-heading">
                  <div>
                    <button className="xq-back-link" onClick={() => selectSession(null)}>
                      <ArrowLeft size={14} /> 返回工作台
                    </button>
                    <h1>
                      {current.name}
                      <span>接诊中</span>
                    </h1>
                    <p>
                      {current.ageRange || "年龄未记录"}
                      <span>·</span>
                      {current.concern || "议题待了解"}
                      <span>·</span>
                      {formatShortDate(current.createdAt)} 创建
                    </p>
                  </div>
                  <button
                    className="xq-icon-button xq-delete-button"
                    onClick={() => setModal("delete")}
                    disabled={!!busy}
                    aria-label="删除当前接诊记录"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
                <div className="xq-session-tabs" role="tablist" aria-label="接诊内容">
                  <button
                    role="tab"
                    aria-selected={activeTab === "conversation"}
                    className={activeTab === "conversation" ? "is-active" : ""}
                    onClick={() => setActiveTab("conversation")}
                  >
                    <MessageCircle size={17} />
                    接诊对话
                    <span>
                      {current.messages.filter((message) => message.role === "user").length}
                    </span>
                  </button>
                  <button
                    role="tab"
                    aria-selected={activeTab === "summary"}
                    className={activeTab === "summary" ? "is-active" : ""}
                    onClick={() => setActiveTab("summary")}
                  >
                    <FileText size={17} />
                    接诊摘要
                  </button>
                </div>
                {status?.mode === "live" && !current.consent && (
                  <div className="xq-consent-banner">
                    <LockKeyhole size={15} />
                    <span>当前仅使用本地规则建议；接诊信息不会发送至外部模型。</span>
                    <button onClick={() => setModal("consent")} disabled={!!busy}>
                      确认外部处理同意
                    </button>
                  </div>
                )}
                {current.risk !== "routine" && (
                  <div className={`xq-safety-alert ${current.risk}`} role="alert">
                    <TriangleAlert size={21} />
                    <div>
                      <strong>{riskLabels[current.risk]}</strong>
                      <p>
                        请由咨询师直接核实当前安全、伤害意图、计划及可用支持。存在即时危险时优先联系当地紧急服务，并确保有人陪伴。
                      </p>
                    </div>
                  </div>
                )}
                {activeTab === "conversation" ? (
                  <div className="xq-conversation-panel">
                    <div className="xq-chat-scroll">
                      <div className="xq-chat-intro">
                        <span className="xq-assistant-avatar">
                          <Sparkles size={20} />
                        </span>
                        <div>
                          <h3>心桥已就绪，和你一起梳理这次接诊</h3>
                          <p>
                            输入来访者的叙述或你的观察，我会提供追问建议、待核实线索与风险提醒。请使用代称，避免录入不必要的身份信息。
                          </p>
                          <span className="xq-mode-note">
                            {status?.mode === "live" && current.consent
                              ? `在线模式 · ${status.model}`
                              : status?.mode === "live"
                                ? "本地建议 · 未授权外部处理"
                                : "演示模式 · 使用本地规则生成建议，未连接大模型"}
                          </span>
                        </div>
                      </div>
                      {current.messages.map((message) => (
                        <article
                          key={message.id}
                          className={`xq-message xq-message-${message.role}`}
                        >
                          <span
                            className={
                              message.role === "assistant"
                                ? "xq-assistant-avatar"
                                : "xq-counselor-avatar"
                            }
                          >
                            {message.role === "assistant" ? <Sparkles size={17} /> : "咨"}
                          </span>
                          <div>
                            <div className="xq-message-label">
                              {message.role === "assistant" ? "心桥 · 接诊辅助" : "咨询师记录"}
                              <time>
                                {new Date(message.createdAt).toLocaleTimeString("zh-CN", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </time>
                            </div>
                            <div className="xq-message-bubble">
                              <Markdown>{message.content}</Markdown>
                            </div>
                            {message.role === "assistant" && (
                              <MessageKnowledge
                                knowledge={message.knowledge}
                                sources={message.sources}
                              />
                            )}
                          </div>
                        </article>
                      ))}
                      {currentBusy && busy?.action === "message" && (
                        <div className="xq-thinking">
                          <Spinner />
                          <span>正在整理叙述与追问建议…</span>
                        </div>
                      )}
                      <div ref={scrollEnd} />
                    </div>
                    <form className="xq-composer" onSubmit={sendMessage}>
                      <label className="xq-composer-label" htmlFor="narrative">
                        <span>
                          <MessageSquarePlus size={15} />
                          记录来访叙述 / 咨询师观察
                        </span>
                        <small>仅录入已获同意的信息</small>
                      </label>
                      <textarea
                        id="narrative"
                        value={drafts[current.id] ?? ""}
                        onChange={(event) =>
                          setDrafts((previous) => ({
                            ...previous,
                            [current.id]: event.target.value,
                          }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                            event.preventDefault();
                            void sendMessage();
                          }
                        }}
                        placeholder="例如：来访者提到，最近两周经常失眠，工作时很难集中注意力……"
                        rows={3}
                        maxLength={6000}
                        disabled={currentBusy}
                      />
                      <div className="xq-composer-footer">
                        <span>
                          <LockKeyhole size={12} />
                          {status?.mode === "live" && current.consent
                            ? "接诊信息及获准的知识片段将发送至模型"
                            : "本地规则建议 · 不发送至外部模型"}
                        </span>
                        <button
                          className="xq-button xq-button-primary"
                          type="submit"
                          disabled={!!busy || !(drafts[current.id] ?? "").trim()}
                        >
                          {currentBusy && busy?.action === "message" ? (
                            <Spinner />
                          ) : (
                            <Send size={16} />
                          )}
                          获取辅助建议
                        </button>
                      </div>
                    </form>
                    <p className="xq-chat-disclaimer">
                      AI 可能遗漏或误判信息，所有建议均需由咨询师复核 · Ctrl / ⌘ + Enter 发送
                    </p>
                  </div>
                ) : (
                  <div className="xq-summary-panel">
                    <div className="xq-summary-toolbar">
                      <span>
                        <FileText size={17} /> 供咨询师复核的工作草稿
                      </span>
                      <div>
                        {current.summary && (
                          <button className="xq-button xq-button-secondary" onClick={exportSummary}>
                            <ArrowDownToLine size={15} />
                            导出
                          </button>
                        )}
                        <button
                          className="xq-button xq-button-primary"
                          onClick={generateSummary}
                          disabled={!!busy}
                        >
                          {currentBusy && busy?.action === "summary" ? (
                            <Spinner />
                          ) : (
                            <Sparkles size={15} />
                          )}
                          {current.summary ? "重新生成" : "生成接诊摘要"}
                        </button>
                      </div>
                    </div>
                    {current.summary ? (
                      <>
                        <div className="xq-summary-notice">
                          <ShieldCheck size={16} />{" "}
                          请核实事实、补充遗漏，并结合本次接诊做出独立判断。
                        </div>
                        <Markdown>{current.summary}</Markdown>
                      </>
                    ) : (
                      <div className="xq-summary-empty">
                        <span>
                          <FileText size={34} strokeWidth={1.2} />
                        </span>
                        <h3>把接诊线索整理成一份清晰的摘要</h3>
                        <p>记录来访叙述后，可整理主诉、待核实信息、风险提醒和后续关注点。</p>
                        <small>摘要是辅助草稿，不构成诊断或治疗方案。</small>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </main>
          {workspaceView === "care" && (
            <aside className="xq-context-rail">
              <div className="xq-rail-title">
                <span>
                  <SlidersHorizontal size={17} />
                  接诊参考
                </span>
                <span className="xq-rail-live">实时辅助</span>
              </div>
              <section className="xq-context-card">
                <div className="xq-card-title">
                  <span>
                    <Users size={17} />
                    来访概况
                  </span>
                  {current && <span className="xq-tiny-tag">已建立</span>}
                </div>
                {current ? (
                  <>
                    <div className="xq-client-profile">
                      <span>{current.name.slice(0, 1)}</span>
                      <div>
                        <strong>{current.name}</strong>
                        <small>{current.ageRange}</small>
                      </div>
                    </div>
                    <dl className="xq-client-fields">
                      <div>
                        <dt>本次关注</dt>
                        <dd>{current.concern}</dd>
                      </div>
                      <div>
                        <dt>外部处理同意</dt>
                        <dd className="xq-green">
                          <CheckCheck size={14} />
                          {current.consent ? "已授权" : "未授权"}
                        </dd>
                      </div>
                    </dl>
                    <button
                      className="xq-consent-action"
                      disabled={
                        consentBusy || (!current.consent && (status?.mode !== "live" || !!busy))
                      }
                      onClick={() =>
                        current.consent ? void updateConsent(false) : setModal("consent")
                      }
                    >
                      {consentBusy
                        ? "正在更新…"
                        : current.consent
                          ? "撤回外部处理同意"
                          : "确认外部处理同意"}
                    </button>
                    <div className={`xq-risk-status ${current.risk}`}>
                      <span />
                      <small>
                        {riskLabels[current.risk]}
                        <em>未触发提醒也不能排除风险</em>
                      </small>
                    </div>
                  </>
                ) : (
                  <div className="xq-empty-context">
                    <span>
                      <Users size={28} strokeWidth={1.2} />
                    </span>
                    <p>等待建立新的接诊</p>
                    <small>
                      来访议题与关键线索
                      <br />
                      将在这里汇总
                    </small>
                    <button onClick={() => setModal("intake")} disabled={offline || initializing}>
                      新建接诊
                      <Plus size={14} />
                    </button>
                  </div>
                )}
              </section>
              {current && (
                <section className="xq-context-card">
                  <div className="xq-card-title">
                    <span>
                      <ClipboardList size={17} />
                      最近一次筛查
                    </span>
                  </div>
                  {current.assessment ? (
                    <div className="xq-last-assessment">
                      <span>{current.assessment.instrument === "phq9" ? "PHQ-9" : "GAD-7"}</span>
                      <strong>
                        {current.assessment.score}
                        <small> / {current.assessment.instrument === "phq9" ? 27 : 21}</small>
                      </strong>
                      <p>{current.assessment.severity}</p>
                      <small>筛查结果不等同于临床诊断</small>
                    </div>
                  ) : (
                    <p className="xq-rail-copy">
                      合适时邀请来访者完成症状筛查，为进一步访谈补充线索。
                    </p>
                  )}
                  <div className="xq-screening-buttons">
                    <button onClick={() => openAssessment("phq9")}>
                      PHQ-9
                      <ChevronRight size={13} />
                    </button>
                    <button onClick={() => openAssessment("gad7")}>
                      GAD-7
                      <ChevronRight size={13} />
                    </button>
                  </div>
                </section>
              )}
              <section className="xq-context-card xq-session-knowledge">
                <div className="xq-card-title">
                  <span>
                    <LibraryBig size={17} />
                    知识库参考
                  </span>
                </div>
                {current ? (
                  <>
                    <label className="xq-knowledge-check">
                      <input
                        type="checkbox"
                        checked={current.useKnowledge !== false}
                        disabled={!!busy}
                        onChange={(event) => void updateKnowledge(event.target.checked)}
                      />
                      <span>本次接诊启用检索</span>
                    </label>
                    <p className="xq-rail-copy">
                      检索相关资料并保留原文片段。仅获准外发的资料会随已授权接诊提供给模型。
                    </p>
                  </>
                ) : (
                  <p className="xq-rail-copy">导入可信资料，为接诊补充有来源的参考。</p>
                )}
                <button className="xq-knowledge-manage" onClick={openKnowledge}>
                  管理资料与检索
                  <ArrowRight size={14} />
                </button>
              </section>
              <section className="xq-context-card xq-notes-card">
                <div className="xq-card-title">
                  <span>
                    <FileText size={17} />
                    咨询师随记
                  </span>
                  {current && (
                    <button
                      className="xq-text-button"
                      onClick={saveNotes}
                      disabled={!!busy || (notes[current.id] ?? current.notes) === current.notes}
                    >
                      {currentBusy && busy?.action === "notes" ? "保存中" : "保存"}
                    </button>
                  )}
                </div>
                {current ? (
                  <>
                    <textarea
                      aria-label="咨询师随记"
                      placeholder="记录你的观察、待追问的问题，或后续接诊安排……"
                      value={notes[current.id] ?? current.notes ?? ""}
                      onChange={(event) =>
                        setNotes((previous) => ({ ...previous, [current.id]: event.target.value }))
                      }
                      maxLength={16000}
                    />
                    <div className="xq-note-foot">
                      <LockKeyhole size={11} />
                      {(notes[current.id] ?? current.notes) !== current.notes
                        ? "有未保存修改"
                        : "笔记保存在当前服务内存"}
                    </div>
                    <p className="xq-note-sharing">在线且已授权时，已保存笔记也会发送至模型。</p>
                  </>
                ) : (
                  <div className="xq-note-placeholder">
                    <span />
                    <span />
                    <span />
                    <p>建立接诊后，即可随时记录观察与思考。</p>
                  </div>
                )}
              </section>
              <section className="xq-care-card">
                <span className="xq-care-icon">
                  <HeartHandshake size={22} strokeWidth={1.4} />
                </span>
                <h3>把安全与支持放在前面</h3>
                <p>如发现自伤、伤人或其他即时危险信号，请优先进行面对面的安全核实与危机处理。</p>
                <div>
                  <span>中国大陆 · 心理援助热线</span>
                  <a href="tel:12356">
                    12356 <ArrowRight size={14} />
                  </a>
                </div>
                <footer>
                  即时危险：急救 <a href="tel:120">120</a> / 报警 <a href="tel:110">110</a>
                  <br />
                  其他地区请联系当地紧急服务
                </footer>
              </section>
              <p className="xq-rail-footer">
                <ShieldCheck size={13} /> 尊重隐私 · 知情同意 · 专业复核
              </p>
            </aside>
          )}
        </div>
      </div>
      {toast && (
        <div className="xq-toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {modal === "intake" && (
        <IntakeDialog
          live={status?.mode === "live"}
          onClose={() => setModal(null)}
          onCreated={(session) => {
            updateSession(session);
            selectSession(session.id);
            setModal(null);
          }}
        />
      )}
      {modal === "settings" && (
        <ModelSettingsDialog
          status={status}
          onClose={() => setModal(null)}
          onSaved={settingsSaved}
          onKnowledge={() => {
            setModal(null);
            openKnowledge();
          }}
        />
      )}
      {modal === "assessment" && (
        <AssessmentDialog
          definitions={definitions}
          initialId={assessmentId}
          session={current}
          onClose={() => setModal(null)}
          onSaved={(session) => {
            updateSession(session);
            setToast("筛查结果已更新，请结合访谈核实");
          }}
          onNewSession={() => setModal("intake")}
        />
      )}
      {modal === "guide" && <UsageGuideDialog onClose={() => setModal(null)} />}
      {modal === "consent" && current && (
        <ConsentDialog
          onClose={() => setModal(null)}
          onConfirm={() => void updateConsent(true)}
          loading={consentBusy}
        />
      )}
      {modal === "delete" && current && (
        <Modal
          title="删除这次接诊记录？"
          subtitle={`「${current.name}」的对话、笔记、量表和摘要将从当前服务中删除。`}
          onClose={() => setModal(null)}
        >
          <p className="xq-delete-notice">此操作无法撤销。如果需要留存，请先返回摘要页导出。</p>
          <div className="xq-modal-actions">
            <button className="xq-button xq-button-secondary" onClick={() => setModal(null)}>
              保留记录
            </button>
            <button
              className="xq-button xq-button-danger"
              onClick={deleteSession}
              disabled={!!busy}
            >
              {busy ? <Spinner /> : <Trash2 size={16} />}确认删除
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
