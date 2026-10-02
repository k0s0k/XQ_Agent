export type AssessmentId = "phq9" | "gad7";
export type AssessmentAnswer = 0 | 1 | 2 | 3;
export type AssessmentSeverity = "极轻或无明显症状" | "轻度" | "中度" | "中重度" | "重度";

export interface AssessmentOption {
  readonly value: AssessmentAnswer;
  readonly label: string;
}

export interface AssessmentDefinition {
  readonly id: AssessmentId;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly questions: readonly string[];
  readonly options: readonly AssessmentOption[];
  readonly source: {
    readonly title: string;
    readonly url: string;
  };
}

export interface AssessmentResult {
  instrument: AssessmentId;
  answers: AssessmentAnswer[];
  score: number;
  severity: AssessmentSeverity;
  /** PHQ-9 item 9 > 0; false is not a finding of safety. */
  requiresSafetyCheck: boolean;
  interpretation: string;
}

export const ASSESSMENTS: readonly AssessmentDefinition[];

/** Validates all items before scoring; throws TypeError for invalid input. */
export function scoreAssessment(
  instrument: AssessmentId,
  answers: readonly number[],
): AssessmentResult;
