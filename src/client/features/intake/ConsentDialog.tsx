import { useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { Modal } from "../../components/Modal.js";
import { Spinner } from "../../components/Spinner.js";

export function ConsentDialog({
  onClose,
  onConfirm,
  loading,
}: {
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  const [consent, setConsent] = useState(false);
  return (
    <Modal
      title="确认外部模型处理同意"
      subtitle="请先说明接收方、发送内容和用途，再记录来访者的选择。"
      onClose={onClose}
    >
      <div className="xq-form">
        <div className="xq-inline-info">
          <LockKeyhole size={18} />
          <p>
            后续在线请求会将本次叙述、近期对话、主诉、年龄范围、已保存笔记和最近一次筛查发送至当前配置的模型服务。启用知识库后，仅文档明确允许外发的匹配片段会同时发送。请确认符合机构的数据处理规范，并获得来访者知情同意。
          </p>
        </div>
        <label className="xq-consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>我已说明当前模型服务与信息使用方式，并获得来访者的知情同意。</span>
        </label>
        <div className="xq-modal-actions">
          <button className="xq-button xq-button-secondary" onClick={onClose}>
            暂不使用
          </button>
          <button
            className="xq-button xq-button-primary"
            onClick={onConfirm}
            disabled={!consent || loading}
          >
            {loading ? <Spinner /> : <ArrowRight size={16} />}确认并继续接诊
          </button>
        </div>
      </div>
    </Modal>
  );
}
