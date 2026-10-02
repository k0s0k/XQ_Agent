export type Instrument = "phq9" | "gad7";
export type Assessment = {
  instrument: Instrument;
  answers: number[];
  score: number;
  severity: string;
  requiresSafetyCheck?: boolean;
  interpretation?: string;
};
export type KnowledgeDocument = {
  id: string;
  title: string;
  source: string;
  filename: string;
  format: string;
  enabled: boolean;
  allowExternal: boolean;
  chunkCount: number;
  characterCount: number;
  createdAt: string;
  updatedAt: string;
};
export type KnowledgeSource = {
  label: string;
  documentId: string;
  chunkId: string;
  title: string;
  source: string;
  excerpt: string;
  chunkIndex: number;
  score: number;
  allowExternal: boolean;
  providedToModel?: boolean;
};
export type MessageKnowledgeStatus = {
  status: "disabled" | "empty" | "no_match" | "local" | "used" | "safety";
  method: "bm25";
  externalExcluded?: number;
  requestedTopK?: number;
  matchedDocuments?: number;
  providedDocuments?: number;
  unit?: "documents" | "chunks";
};
export type SessionMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  sources?: KnowledgeSource[];
  knowledge?: MessageKnowledgeStatus;
  responseMode?: "llm" | "local" | "safety";
};
export type Session = {
  id: string;
  name: string;
  kind?: "chat" | "intake";
  topK?: number;
  ageRange: string;
  concern: string;
  consent: boolean;
  notes: string;
  useKnowledge: boolean;
  createdAt: string;
  updatedAt: string;
  messages: SessionMessage[];
  risk: "routine" | "attention" | "urgent";
  summary: string | null;
  assessment?: Assessment;
};
export type Status = {
  mode: "demo" | "live";
  model: string;
  configured: boolean;
  baseUrl?: string;
};
export type AssessmentDefinition = {
  id: Instrument;
  name: string;
  description: string;
  instructions?: string;
  questions: string[];
  options: { value: number; label: string }[];
  source: { title: string; url: string };
};
