/** Conservative routing support for a clinician. This is not a clinical risk assessment. */
export function classifySafety(content) {
  const text = String(content ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return { risk: "routine", reason: null };
  const hasSafetyLanguage =
    /自杀|自傷|自伤|自残|割腕|跳楼|跳桥|上吊|结束生命|结束自己|不想活|活不下去|想死|一了百了|活着没意思|结束一切|不如死|死掉算了|伤害自己|杀死自己|杀了自己|suicid|self.harm|kill myself|end my life|hurt myself|overdos|杀人|杀了他|杀了她|伤害别人|kill (?:him|her|them|someone)/i;
  const acuteMedical =
    /(?:吞|吃|服)(?:下|了|下了|用|用了)?.{0,5}(?:一瓶|大量|很多|过量).{0,8}(?:药|安眠)|(?:刚刚|刚才|已经|正在).{0,12}(?:割腕|跳楼|上吊)|(?:伤口|流血).{0,8}(?:不停|止不住)|(?:刚刚|已经|正在).{0,12}(?:吃药过量|服药过量)|(?:i (?:just )?(?:took|have taken)|i am taking).{0,35}(?:overdose|all (?:the|my) pills|a bottle of pills)/i;
  const clauses = text
    .split(
      /[，。；！？\n,.!?;]|但是|不过|然而|可是|但|并且|而且|\bbut\b|\bhowever\b|(?=现在|此刻|目前|\bnow\b)/,
    )
    .filter(Boolean);
  const historyPattern =
    /曾经|以前|过去|当年|几年前|多年前|[一二两三四五六七八九十\d]年前|去年|历史|既往|used to|years? ago|in the past|previously/;
  const notAcute =
    /(?:没有|从未|否认|不曾|并未|未曾).{0,6}(?:吞|吃|服|割腕|跳楼|上吊)|did not|didn't|have not|haven't/;
  if (
    clauses.some(
      (clause) =>
        acuteMedical.test(clause) && !notAcute.test(clause) && !historyPattern.test(clause),
    )
  )
    return {
      risk: "urgent",
      reason: "文字提示可能存在正在发生的伤害或过量服药，需要立即人工处置。",
    };
  if (!hasSafetyLanguage.test(text) && !acuteMedical.test(text))
    return { risk: "routine", reason: null };

  let historical = false;
  let uncertain = false;
  for (const originalClause of clauses) {
    let clause = originalClause;
    if (acuteMedical.test(clause) && !notAcute.test(clause) && historyPattern.test(clause)) {
      historical = true;
      continue;
    }
    if (!hasSafetyLanguage.test(clause)) continue;
    const doubleNegative = /不是不想|不能不想|并非没有|not (?:really )?not/.test(clause);
    if (!doubleNegative)
      clause = clause.replace(
        /(?:没有|从未|从不|否认|不再|并不|不会|不想|不打算|无)(?:任何|出现|发生|过|要|有|再|了|想要|想|目前|现在|正在|强烈的|具体的|的|自伤或|自杀或|和|或|以及|与|\s)*(?:自杀|自伤|自残|割腕|跳楼|跳桥|上吊|结束生命|杀死自己|伤害自己|伤害别人|杀人|想死|一了百了|结束一切)|不想死|(?:自杀|自伤|自残)(?:意念|想法|计划|风险)?(?:为|是)?(?:无|阴性|没有)|\b(?:not suicidal|never suicidal|no suicidal|no (?:current )?(?:suicidal|self.harm)|don'?t want to (?:kill|hurt) myself|do not want to (?:kill|hurt) myself|not going to (?:kill|hurt) myself)\b/g,
        "",
      );
    if (!hasSafetyLanguage.test(clause)) continue;
    if (
      historyPattern.test(clause) &&
      !/现在|此刻|正在|马上|今晚|今天|now|tonight|today/.test(clause)
    ) {
      historical = true;
      continue;
    }
    if (
      /什么是|是什么意思|科普|定义|教材|文献|新闻|培训|问卷.{0,6}(?:题目|第.?题)|what is|definition|textbook/.test(
        clause,
      ) &&
      !/我想|我准备|我打算|我正在|i want|i will|i am going/.test(clause)
    )
      continue;
    if (
      /自杀|割腕|跳楼|跳桥|上吊|结束生命|杀死自己|杀了自己|自残|自伤|杀人|杀了他|杀了她|伤害别人|想死|一了百了|伤害自己|结束一切|suicid|kill myself|end my life|hurt myself|self.harm|kill (?:him|her|them|someone)/.test(
        clause,
      )
    ) {
      return {
        risk: "urgent",
        reason: "文字中出现当前自伤、自杀或伤害他人的线索；需要咨询师立即核实安全状况。",
      };
    }
    uncertain = true;
  }
  if (historical)
    return {
      risk: "attention",
      reason: "提及既往安全风险经历，需要人工核实当前意念、计划及支持资源。",
    };
  if (uncertain)
    return { risk: "attention", reason: "出现绝望或死亡相关表达，建议直接询问当前安全状况。" };
  return { risk: "routine", reason: null };
}

export const SAFETY_CHECK_MESSAGE =
  "需要由咨询师直接核实安全状况：此刻是否有伤害自己或结束生命的想法？是否有具体计划、可获得的手段或已经采取的行动？是否能获得可信赖的人陪伴与现场支持？请记录来访者的原话并结合面谈判断；筛查得分不能替代风险评估。若发现即时危险，请立即进入机构危机处置流程。";

export function crisisResponse(reason) {
  return `【优先进行人工安全评估】\n${reason ?? "本次接诊存在需要人工核实的安全线索。"}\n\n请暂缓常规问诊，由咨询师直接确认：当前意念、具体计划、可获得的手段、是否已经实施，以及来访者所在地点和可获得的现场支持。\n\n如有正在发生的伤害、过量服药或即时危险，请立即联系当地急救／紧急服务，按机构危机处置流程联系督导或责任人员；在确保自身安全的前提下，协助来访者获得现场陪伴。不要等待本助手的回复来决定是否求助。\n\n这是基于文字线索的提醒，不能判定真实风险级别，也不能替代咨询师的专业评估。本条由本地规则生成，未向模型发送接诊内容。`;
}

export function mergeRisk(previous, next) {
  const priorities = { routine: 0, attention: 1, urgent: 2 };
  return priorities[next] > priorities[previous] ? next : previous;
}
