export type Scenario = "account_locked" | "export_config" | "export_stuck";
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
}
export interface Call {
  id: string;
  customer_id: string;
  scenario: Scenario;
  status: "running" | "paused" | "resolved" | "failed" | "cancelled";
  turns: number;
  max_turns: number;
  tool_calls: number;
  escalations: number;
  knowledge_used: number;
  workflow_used: number;
  verified: number;
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
  activities: Activity[];
  articles: Article[];
  workflows: Workflow[];
  tickets: Ticket[];
  logs: AppLog[];
  usage: Usage[];
  settings: Settings;
  configuration: { ready: boolean; missing: string[]; browserEnabled: boolean };
  tools: { name: string; description: string; mutates: boolean }[];
  batch: number;
}
