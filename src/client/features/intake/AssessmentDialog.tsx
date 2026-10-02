import { useState, type FormEvent } from "react";
import { Check, Plus, TriangleAlert } from "lucide-react";
import { requestApi } from "../../api/client.js";
import type { AssessmentDefinition, Instrument, Session } from "../../api/types.js";
import { Modal } from "../../components/Modal.js";
import { Spinner } from "../../components/Spinner.js";
import { getErrorMessage } from "../../utils/errors.js";

export function AssessmentDialog({
  definitions,
  initialId,
  session,
  onClose,
  onSaved,
  onNewSession,
}: {
  definitions: AssessmentDefinition[];
  initialId: Instrument;
  session: Session | null;
  onClose: () => void;
  onSaved: (session: Session) => void;
  onNewSession: () => void;
}) {
  const [id, setId] = useState(initialId);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Session["assessment"]>();
  const definition = definitions.find((item) => item.id === id);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session || !definition || loading) return;
    if (Object.keys(answers).length !== definition.questions.length) {
      setError("请完成所有题目后再提交。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await requestApi<{ session: Session }>(`/sessions/${session.id}/assessment`, {
        method: "POST",
        body: JSON.stringify({
          instrument: id,
          answers: definition.questions.map((_, index) => answers[index]),
        }),
      });
      setResult(data.session.assessment);
      onSaved(data.session);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }
  return (
    <Modal
      title="症状筛查 · 为访谈补充线索"
      subtitle={
        session
          ? `当前接诊：${session.name} · 保存后更新最近一次筛查记录`
          : "先了解量表，在获得知情同意后结合接诊使用。"
      }
      onClose={onClose}
      wide
    >
      <div className="xq-instrument-tabs">
        {(["phq9", "gad7"] as Instrument[]).map((instrument) => (
          <button
            className={instrument === id ? "is-active" : ""}
            key={instrument}
            onClick={() => {
              setId(instrument);
              setAnswers({});
              setResult(undefined);
              setError("");
            }}
            disabled={loading}
          >
            {instrument === "phq9" ? "PHQ-9 抑郁症状" : "GAD-7 焦虑症状"}
          </button>
        ))}
      </div>
      {!definition ? (
        <p className="xq-form-error">暂时无法加载量表，请确认后端服务连接。</p>
      ) : (
        <>
          <div className="xq-assessment-intro">
            <h3>{definition.name}</h3>
            <p>
              {definition.instructions ||
                "过去两周内，以下情况困扰您的频率是？请由来访者根据自身情况作答。"}
            </p>
            <small>{definition.description} · 适用于成人症状筛查，不能单独用于诊断。</small>
          </div>
          {result ? (
            <div className="xq-assessment-result">
              <div className="xq-result-score">
                {result.score}
                <small> / {id === "phq9" ? "27" : "21"}</small>
              </div>
              <h3>{result.severity}</h3>
              <p>
                {result.interpretation ||
                  "请结合症状持续时间、功能受损和临床访谈解读筛查结果，不能据此确定诊断。"}
              </p>
              {(result.requiresSafetyCheck || (id === "phq9" && (result.answers[8] ?? 0) > 0)) && (
                <div className="xq-inline-warning">
                  <TriangleAlert size={19} />
                  <span>
                    第 9
                    题提示需要直接开展安全核实，无论总分高低，都应进一步评估当前想法、意图、计划及支持资源。
                  </span>
                </div>
              )}
              <button className="xq-button xq-button-primary" onClick={onClose}>
                <Check size={16} />
                完成并返回接诊
              </button>
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="xq-assessment-questions">
                {definition.questions.map((question, index) => (
                  <fieldset key={`${id}-${index}`} className="xq-question" disabled={loading}>
                    <legend>
                      <span>{(index + 1).toString().padStart(2, "0")}</span>
                      {question}
                    </legend>
                    <div>
                      {definition.options.map((option) => (
                        <label key={option.value}>
                          <input
                            type="radio"
                            required
                            name={`question-${index}`}
                            value={option.value}
                            checked={answers[index] === option.value}
                            onChange={() =>
                              setAnswers((previous) => ({ ...previous, [index]: option.value }))
                            }
                          />
                          <span>
                            <b>{option.value}</b>
                            {option.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
              {error && (
                <p className="xq-form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="xq-assessment-footer">
                <span>
                  已完成 {Object.keys(answers).length} / {definition.questions.length} 题
                </span>
                {session ? (
                  <button
                    className="xq-button xq-button-primary"
                    disabled={
                      loading || Object.keys(answers).length !== definition.questions.length
                    }
                  >
                    {loading ? <Spinner /> : <Check size={16} />}计算并保存筛查结果
                  </button>
                ) : (
                  <button
                    type="button"
                    className="xq-button xq-button-primary"
                    onClick={onNewSession}
                  >
                    <Plus size={16} />
                    先建立接诊以保存结果
                  </button>
                )}
              </div>
            </form>
          )}
          <p className="xq-assessment-source">
            量表资料：
            <a href={definition.source.url} target="_blank" rel="noreferrer">
              {definition.source.title}
            </a>
            。分数仅表示症状程度，须由专业人员复核。
          </p>
        </>
      )}
    </Modal>
  );
}
