import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { requestApi } from "../../api/client.js";
import type { Session } from "../../api/types.js";
import { Modal } from "../../components/Modal.js";
import { Spinner } from "../../components/Spinner.js";
import { getErrorMessage } from "../../utils/errors.js";

const concerns = ["情绪低落", "焦虑与压力", "人际关系", "睡眠困扰", "自我探索", "其他议题"];
const ageRanges = [
  "18–24 岁",
  "25–34 岁",
  "35–44 岁",
  "45–59 岁",
  "60 岁及以上",
  "成年，年龄未提供",
];

export function IntakeDialog({
  live,
  onClose,
  onCreated,
}: {
  live: boolean;
  onClose: () => void;
  onCreated: (session: Session) => void;
}) {
  const [name, setName] = useState("");
  const [ageRange, setAgeRange] = useState("");
  const [concern, setConcern] = useState("");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const data = await requestApi<{ session: Session }>("/sessions", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), ageRange, concern, consent: live && consent }),
      });
      onCreated(data.session);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }
  return (
    <Modal
      title="开始一次新的接诊"
      subtitle="先了解基本信息，为这次倾听留出空间。本工作台面向成人接诊。"
      onClose={onClose}
    >
      <form className="xq-form" onSubmit={submit}>
        <label>
          来访者代称 <span>*</span>
          <input
            autoFocus
            required
            maxLength={40}
            placeholder="例如：来访者 A（请勿使用真实姓名）"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          年龄范围 <span>*</span>
          <select required value={ageRange} onChange={(event) => setAgeRange(event.target.value)}>
            <option value="" disabled>
              请选择年龄范围
            </option>
            {ageRanges.map((age) => (
              <option key={age}>{age}</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>
            本次主要关注 <span>*</span>
          </legend>
          <div className="xq-concern-options">
            {concerns.map((item) => (
              <label key={item}>
                <input
                  type="radio"
                  name="concern"
                  required
                  value={item}
                  checked={concern === item}
                  onChange={() => setConcern(item)}
                />
                <span>{item}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="xq-consent">
          <input
            type="checkbox"
            disabled={!live}
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>
            可选：我已取得来访者同意，将本个案资料交给当前配置的模型服务处理。
            <small>
              {live
                ? "授权后会发送叙述、近期对话、主诉、年龄范围、已保存笔记、最近一次筛查及获准外发的匹配知识片段；不勾选仍可使用本地功能。"
                : "当前未配置模型，暂不启用外部授权。建立接诊后可直接使用本地提示。"}
              会话仅在服务内存中保存，重启后清空。
            </small>
          </span>
        </label>
        {error && (
          <p className="xq-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="xq-modal-actions">
          <button className="xq-button xq-button-secondary" type="button" onClick={onClose}>
            稍后再说
          </button>
          <button
            className="xq-button xq-button-primary"
            disabled={loading || !name.trim() || !ageRange || !concern}
          >
            {loading ? <Spinner /> : <Plus size={17} />}建立接诊
          </button>
        </div>
      </form>
    </Modal>
  );
}
