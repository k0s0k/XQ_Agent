import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Check, LockKeyhole } from "lucide-react";
import { requestApi } from "../../api/client.js";
import type { Status } from "../../api/types.js";
import { Modal } from "../../components/Modal.js";
import { Spinner } from "../../components/Spinner.js";
import { getErrorMessage } from "../../utils/errors.js";

export function ModelSettingsDialog({
  status,
  onClose,
  onSaved,
  onKnowledge,
}: {
  status: Status | null;
  onClose: () => void;
  onSaved: (status: Status) => void;
  onKnowledge?: () => void;
}) {
  const [baseUrl, setBaseUrl] = useState("");
  const [initialBaseUrl, setInitialBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(true);
  const [error, setError] = useState("");
  const needsKey =
    !status?.configured ||
    baseUrl.trim().replace(/\/+$/, "") !== initialBaseUrl.replace(/\/+$/, "");
  useEffect(() => {
    let active = true;
    requestApi<{ baseUrl: string; model: string }>("/settings")
      .then((data) => {
        if (active) {
          setBaseUrl(data.baseUrl || "");
          setInitialBaseUrl(data.baseUrl || "");
          setModel(data.model || "");
        }
      })
      .catch((reason) => {
        if (active) setError(getErrorMessage(reason));
      })
      .finally(() => {
        if (active) setReading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const data = await requestApi<Status>("/settings", {
        method: "POST",
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      setApiKey("");
      onSaved(data);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }
  return (
    <Modal
      title="连接你的模型服务"
      subtitle="配置兼容 OpenAI 协议的模型，为辅助接诊提供语言能力。"
      onClose={onClose}
    >
      <form className="xq-form" onSubmit={submit}>
        <div className="xq-inline-info">
          <LockKeyhole size={18} />
          <p>
            密钥通过本地后端调用模型，仅保存在服务端内存；不会写入浏览器存储。在线且已授权时，接诊内容及获准外发的匹配知识片段会发送到该服务。更换服务地址后，需重新确认来访者同意。
          </p>
        </div>
        <label>
          API 地址
          <input
            required
            type="url"
            placeholder="https://api.example.com/v1"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            disabled={reading}
          />
        </label>
        <label>
          模型名称
          <input
            required
            placeholder="输入服务商提供的模型名称"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            disabled={reading}
          />
        </label>
        <label>
          API 密钥
          <input
            type="password"
            autoComplete="new-password"
            required={needsKey}
            placeholder={needsKey ? "输入当前服务的 API Key" : "已配置密钥；留空保留现有密钥"}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            disabled={reading}
          />
        </label>
        <p className="xq-field-hint">
          设置保存成功仅表示配置完成，实际连接将在发送接诊消息时验证。
        </p>
        {onKnowledge && (
          <button type="button" className="xq-knowledge-settings-link" onClick={onKnowledge}>
            管理知识库与资料外发权限
            <ArrowRight size={14} />
          </button>
        )}
        {error && (
          <p className="xq-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="xq-modal-actions">
          <button className="xq-button xq-button-secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button className="xq-button xq-button-primary" disabled={loading || reading}>
            {loading ? <Spinner /> : <Check size={16} />}保存设置
          </button>
        </div>
      </form>
    </Modal>
  );
}
