import { useState, type FormEvent } from "react";
import { FileText, Plus, Upload } from "lucide-react";
import { requestApi } from "../../api/client.js";
import type { KnowledgeDocument } from "../../api/types.js";
import { Modal } from "../../components/Modal.js";
import { Spinner } from "../../components/Spinner.js";
import { getErrorMessage } from "../../utils/errors.js";
import { getSafeSourceUrl } from "../../utils/sourceUrl.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取文件，请重新选择。"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

export function ImportKnowledgeDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (document: KnowledgeDocument) => void;
}) {
  const [mode, setMode] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [source, setSource] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [allowExternal, setAllowExternal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  function chooseFile(next: File | null) {
    setError("");
    if (!next) {
      setFile(null);
      return;
    }
    if (!/\.(txt|md|markdown|docx|pdf)$/i.test(next.name)) {
      setFile(null);
      setError("请选择 TXT、Markdown、DOCX 或包含文本层的 PDF 文件。");
      return;
    }
    if (next.size > MAX_FILE_BYTES) {
      setFile(null);
      setError("文件大小不能超过 5 MB。");
      return;
    }
    setFile(next);
    if (!title.trim()) setTitle(next.name.replace(/\.[^.]+$/, "").slice(0, 160));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setError("");
    if (source.trim() && !getSafeSourceUrl(source.trim())) {
      setError("来源链接应为不含账号密码的 HTTP 或 HTTPS 地址。");
      return;
    }
    if (mode === "file" && !file) {
      setError("请先选择需要导入的文件。");
      return;
    }
    setLoading(true);
    try {
      const payload = {
        title: title.trim(),
        source: source.trim(),
        enabled,
        allowExternal,
        ...(mode === "file" && file
          ? { filename: file.name, dataBase64: await readFileAsBase64(file) }
          : { content: content.trim() }),
      };
      const data = await requestApi<{ document: KnowledgeDocument }>("/knowledge", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      onCreated(data.document);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }
  return (
    <Modal
      title="把可信资料加入工作空间"
      subtitle="资料在本机解析、分块和建立检索索引。请先核实内容及使用权限。"
      onClose={() => {
        if (!loading) onClose();
      }}
      wide
    >
      <div className="xq-instrument-tabs">
        <button
          className={mode === "file" ? "is-active" : ""}
          onClick={() => setMode("file")}
          disabled={loading}
        >
          <Upload size={15} />
          导入文件
        </button>
        <button
          className={mode === "text" ? "is-active" : ""}
          onClick={() => setMode("text")}
          disabled={loading}
        >
          <FileText size={15} />
          粘贴文本
        </button>
      </div>
      <form className="xq-form xq-knowledge-form" onSubmit={submit}>
        {mode === "file" && (
          <label className="xq-upload-zone">
            <Upload size={25} />
            <strong>{file ? file.name : "选择一份知识资料"}</strong>
            <span>
              {file
                ? `${Math.ceil(file.size / 1024).toLocaleString("zh-CN")} KB · 点击重新选择`
                : "TXT / Markdown / DOCX / PDF · 单文件不超过 5 MB"}
            </span>
            <input
              aria-label="选择知识资料文件"
              type="file"
              accept=".txt,.md,.markdown,.docx,.pdf"
              disabled={loading}
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            />
            <small>PDF 需包含可选中的文本；扫描件请先进行 OCR。</small>
          </label>
        )}
        <label>
          资料标题 <span>*</span>
          <input
            required
            value={title}
            maxLength={160}
            disabled={loading}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：机构接诊流程（已审核版）"
          />
        </label>
        {mode === "text" && (
          <label>
            资料正文 <span>*</span>
            <textarea
              rows={8}
              required
              maxLength={200000}
              value={content}
              disabled={loading}
              onChange={(event) => setContent(event.target.value)}
              placeholder="粘贴经过审核的专业资料、机构工作流程或知识笔记……"
            />
            <small className="xq-field-hint">
              最多 200,000 字符；请勿将来访者个案记录作为公共知识资料。
            </small>
          </label>
        )}
        <label>
          原始来源链接 <small>（可选）</small>
          <input
            type="url"
            value={source}
            maxLength={2000}
            disabled={loading}
            onChange={(event) => setSource(event.target.value)}
            placeholder="https://… · 用于标明出处，不会自动抓取网页"
          />
        </label>
        <div className="xq-knowledge-permissions">
          <label className="xq-consent">
            <input
              type="checkbox"
              checked={enabled}
              disabled={loading}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>
              导入后启用本地检索<small>关闭时仅保留文档，不参与接诊与检索测试。</small>
            </span>
          </label>
          <label className="xq-consent">
            <input
              type="checkbox"
              checked={allowExternal}
              disabled={loading}
              onChange={(event) => setAllowExternal(event.target.checked)}
            />
            <span>
              允许匹配片段随已授权的对话发送至模型
              <small>
                默认关闭。仅在该文档已启用、当前对话启用知识库且已允许模型处理时发送匹配片段。
              </small>
            </span>
          </label>
        </div>
        {error && (
          <p className="xq-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="xq-modal-actions">
          <button
            className="xq-button xq-button-secondary"
            type="button"
            onClick={onClose}
            disabled={loading}
          >
            取消
          </button>
          <button
            className="xq-button xq-button-primary"
            disabled={loading || !title.trim() || (mode === "file" ? !file : !content.trim())}
          >
            {loading ? <Spinner /> : <Plus size={16} />}
            {loading ? "正在解析与建立索引…" : "导入知识库"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
