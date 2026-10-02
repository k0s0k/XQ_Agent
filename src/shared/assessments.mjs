/**
 * Deterministic adult self-report screening. Never infer answers from chat text.
 * Chinese item sources and reproduction notices are documented in
 * docs/clinical-notes.md.
 */

const options = Object.freeze([
  Object.freeze({ value: 0, label: "完全没有" }),
  Object.freeze({ value: 1, label: "有几天" }),
  Object.freeze({ value: 2, label: "一半以上的天数" }),
  Object.freeze({ value: 3, label: "几乎每天" }),
]);

const instructions =
  "请由成年来访者根据过去两周的实际体验逐题作答，咨询师可协助理解题意，但不要代答。所有题目完成后才能计分。结果仅用于症状筛查，不能作为诊断，须由咨询师结合访谈复核。";

export const ASSESSMENTS = Object.freeze([
  Object.freeze({
    id: "phq9",
    name: "PHQ-9 抑郁症状筛查",
    description: "过去两周 · 9 个问题 · 成人自评 · 总分 0–27",
    instructions,
    questions: Object.freeze([
      "做事时提不起劲或没有乐趣",
      "感到心情低落、沮丧或绝望",
      "入睡困难、睡不安稳或睡眠过多",
      "感觉疲倦或没有活力",
      "食欲不振或吃太多",
      "觉得自己很糟或觉得自己很失败，或让自己或家人失望",
      "对事物专注有困难，例如阅读报纸或看电视",
      "动作或说话速度缓慢到别人已经觉察？或正好相反——烦躁或坐立不安、动来动去的情况更胜于平常",
      "有不如死掉或用某种方式伤害自己的念头",
    ]),
    options,
    source: Object.freeze({
      title: "PHQ-9 简体中文版 · El Camino Health；第 6、8 项参照华西医院完整表述",
      url: "https://www.elcaminohealth.org/sites/default/files/2024-03/chi-PHQ9-simpchi.pdf",
    }),
  }),
  Object.freeze({
    id: "gad7",
    name: "GAD-7 焦虑症状筛查",
    description: "过去两周 · 7 个问题 · 成人自评 · 总分 0–21",
    instructions,
    questions: Object.freeze([
      "感到紧张、不安或烦躁",
      "无法停止或者控制忧虑",
      "过分忧虑不同的事情",
      "难以放松",
      "心绪不宁以至坐立不安",
      "容易心烦或易怒",
      "感到害怕，就像要发生可怕的事情",
    ]),
    options,
    source: Object.freeze({
      title: "El Camino Health · GAD-7 简体中文版（2024）",
      url: "https://www.elcaminohealth.org/sites/default/files/2024-05/chi-GAD7-simpchi.pdf",
    }),
  }),
]);

/**
 * @param {unknown} instrument
 * @param {unknown} answers Complete answers in displayed question order.
 * @returns {{instrument: 'phq9'|'gad7', answers: number[], score: number, severity: string, requiresSafetyCheck: boolean, interpretation: string}}
 * @throws {TypeError} Unknown instruments or incomplete/invalid responses.
 */
export function scoreAssessment(instrument, answers) {
  const assessment = ASSESSMENTS.find((item) => item.id === instrument);
  if (!assessment) throw new TypeError("不支持的量表，请选择 phq9 或 gad7。");
  if (!Array.isArray(answers) || answers.length !== assessment.questions.length) {
    throw new TypeError(`${assessment.name}需要完整的 ${assessment.questions.length} 项答案。`);
  }

  // An indexed loop rejects sparse arrays; Array.every would skip missing items.
  for (let index = 0; index < answers.length; index += 1) {
    if (
      !Object.hasOwn(answers, index) ||
      !Number.isInteger(answers[index]) ||
      answers[index] < 0 ||
      answers[index] > 3
    ) {
      throw new TypeError(`第 ${index + 1} 项必须是 0、1、2 或 3，不能缺失或用字符串代替。`);
    }
  }

  const normalizedAnswers = [...answers];
  const score = normalizedAnswers.reduce((total, answer) => total + answer, 0);
  const severity =
    score < 5
      ? "极轻或无明显症状"
      : score < 10
        ? "轻度"
        : score < 15
          ? "中度"
          : assessment.id === "phq9" && score < 20
            ? "中重度"
            : "重度";
  const requiresSafetyCheck = assessment.id === "phq9" && normalizedAnswers[8] > 0;
  const symptom = assessment.id === "phq9" ? "抑郁" : "焦虑";
  let interpretation = `本次总分 ${score}，处于${severity}的${symptom}症状区间。结果仅为过去两周的自评筛查，不是诊断；请由咨询师结合持续时间、生活功能、病史和面谈复核。`;
  if (score >= 10) {
    interpretation += "建议进一步专业评估，并根据访谈确定是否需要转介。";
  }
  if (requiresSafetyCheck) {
    interpretation +=
      "第 9 项大于 0，须由咨询师及时直接核查当前自伤或自杀想法、意图、计划、可用手段及支持资源；此提示本身不代表存在即刻危险。";
  }
  interpretation +=
    assessment.id === "phq9"
      ? "低总分或第 9 项为 0 也不能排除安全风险。"
      : "低总分也不能排除安全风险，本量表不直接评估自伤或自杀风险。";

  return {
    instrument: assessment.id,
    answers: normalizedAnswers,
    score,
    severity,
    requiresSafetyCheck,
    interpretation,
  };
}
