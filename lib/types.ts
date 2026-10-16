export type Scenario =
  | "account_locked"
  | "export_config"
  | "export_stuck"
  | "report_guidance"
  | "export_multi_fault"
  | "export_engineering";
export type ScenarioChoice = Scenario | "random";
export interface CaseOptions {
  seed?: string;
  difficulty?: "standard" | "challenge";
  followUp?: boolean;
}
export interface ScenarioCase {
  selection: ScenarioChoice;
  seed: string;
  difficulty: "standard" | "challenge";
  customerGoal: string;
  symptom: "login" | "export" | "builder";
  followUp: string | null;
  targetRange: string;
  targetColumns: string[];
  actionLimit: number;
  recoveryFailures: number;
  noise: boolean;
  referenceTools: number;
  referenceTurns: number;
}
export type Profile = "fast" | "balanced" | "advanced";
export interface Customer {
  id: string;
  name: string;
  email: string;
  company: string;
  initials: string;
  personality: string;
  skill: string;
  style: string;
  voice: number;
  status: string;
  role: string;
  export_format: string;
  export_job: string;
  export_bug: string;
  recovery_failures: number;
  report_range: string;
  report_columns: string;
  draft_range: string;
  draft_columns: string;
  report_applied: number;
  report_downloaded: number;
  report_builder: number;
}
export interface Call {
  id: string;
  customer_id: string;
  scenario: Scenario;
  status:
    | "running"
    | "paused"
    | "resolved"
    | "escalated"
    | "incomplete"
    | "failed"
    | "cancelled";
  turns: number;
  max_turns: number;
  tool_calls: number;
  escalations: number;
  knowledge_used: number;
  workflow_used: number;
  verified: number;
  repair_verified: number;
  closing_customer_message_id: number | null;
  scenario_seed?: string | null;
  scenario_case?: string | null;
  followup_asked?: number;
  outcome_verified?: number;
  outcome?: "resolution" | "engineering_handoff" | null;
  error: string | null;
  learning_status: string;
  batch: number;
  started_at: string;
  ended_at: string | null;
  busy_until: number;
}
export interface Message {
  id: number;
  call_id: string;
  role: "customer" | "support" | "system";
  text: string;
  kind?: "dialogue" | "closing";
  created_at: string;
}
export interface CompletionCheck {
  id: number;
  call_id: string;
  customer_message_id: number;
  customer_satisfied: number;
  explanation_complete: number;
  evidence_supported: number;
  requires_investigation?: number;
  assessment_error?: string | null;
  open_questions: string;
  reason: string;
  created_at: string;
}
export interface Activity {
  id: number;
  call_id: string;
  name: string;
  input: string;
  output: string;
  success: number;
  duration_ms: number;
  created_at: string;
}
export interface Article {
  id: string;
  signature: string;
  title: string;
  body: string;
  evidence: string;
  source_call: string;
  uses: number;
  created_at: string;
}
export interface Workflow {
  id: string;
  signature: string;
  title: string;
  recipe: string;
  active: number;
  uses: number;
  source_call: string;
  created_at: string;
}
export interface Ticket {
  id: string;
  call_id: string;
  customer_id: string;
  subject: string;
  status: string;
  resolution: string | null;
  created_at: string;
}
export interface AppLog {
  id: number;
  customer_id: string;
  level: string;
  event: string;
  detail: string;
  created_at: string;
}
export interface Usage {
  id: number;
  call_id: string;
  role: string;
  profile: Profile;
  provider: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}
export interface EngineeringHandoff {
  id: string;
  call_id: string;
  ticket_id: string;
  customer_id: string;
  status: string;
  severity: string;
  summary: string;
  customer_impact: string;
  reproduction_steps: string;
  expected_result: string;
  actual_result: string;
  evidence: string;
  created_at: string;
}
export interface CallPerformance {
  call_id: string;
  supportTools: number;
  customerActions: number;
  avoidableActions: number;
  failedTools: number;
  failedCustomerActions: number;
  modelTokens: number;
  toolMilliseconds: number;
  referenceTools: number;
  referenceTurns: number;
  completedOutcome: boolean;
}
export interface ModelConfig {
  provider: "openai" | "google" | "openrouter";
  model: string;
  reasoning?: "default" | "off" | "low" | "medium" | "high";
  maxOutputTokens?: number;
}
export interface Settings {
  profiles: Record<Profile, ModelConfig>;
  disabledTools: string[];
}
export interface Snapshot {
  customers: Customer[];
  calls: Call[];
  messages: Message[];
  completionChecks: CompletionCheck[];
  activities: Activity[];
  articles: Article[];
  workflows: Workflow[];
  tickets: Ticket[];
  logs: AppLog[];
  usage: Usage[];
  engineering: EngineeringHandoff[];
  performance: CallPerformance[];
  settings: Settings;
  configuration: { ready: boolean; missing: string[]; browserEnabled: boolean };
  tools: { name: string; description: string; mutates: boolean }[];
  batch: number;
}
