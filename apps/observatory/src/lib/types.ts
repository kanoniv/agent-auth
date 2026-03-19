export interface ConnectionConfig {
  apiUrl: string;
  apiKey: string;
  agentName: string;
  llmApiKey?: string;
}

export interface AgentRecord {
  id: string;
  name: string;
  status: string;
  capabilities: string[];
  description: string | null;
  last_seen_at: string;
  registered_at: string;
  metadata: Record<string, unknown>;
  did: string | null;
  reputation: {
    composite_score: number;
    total_actions: number;
    success_rate: number;
    tenure_days: number;
    action_diversity?: number;
    feedback_score?: number;
    last_computed_at: string | null;
    action_breakdown?: Record<string, number>;
  } | null;
}

export interface ProvenanceEntry {
  id: string;
  agent_name: string;
  action: string;
  entity_ids: string[];
  parent_ids: string[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Delegation {
  id: string;
  grantor_name: string;
  agent_name: string;
  scopes: string[];
  source_restrictions: string[] | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface OutcomeEntry {
  id: string;
  entry_type: string;
  title: string;
  content: string;
  metadata: {
    action?: string;
    result?: string;
    reward_signal?: number;
  };
  author: string;
  created_at: string;
}

export interface TaskEntry {
  id: string;
  title: string;
  content: string;
  status: string;
  metadata: {
    assigned_to?: string;
    priority?: string;
    status?: string;
  };
  author: string;
  created_at: string;
}

export interface MemoryEntry {
  id: string;
  entry_type: string;
  title: string;
  content: string;
  status: string;
  author: string;
  subject_did?: string;
  linked_agents?: string[];
  created_at: string;
}

export interface RecallSummary {
  total_outcomes: number;
  judged: number;
  successes: number;
  failures: number;
  success_rate: number | null;
  avg_reward: number | null;
  recent_trend: 'improving' | 'declining' | 'stable';
  top_success_actions: string[];
  top_failure_actions: string[];
}

export interface RecallResponse {
  did: string;
  summary: RecallSummary;
  entries: OutcomeEntry[];
}

export interface TrendPoint {
  time: string;
  total: number;
  successes: number;
  failures: number;
  avg_reward: number | null;
}

export interface TrendResponse {
  did: string;
  window: string;
  bucket: string;
  points: TrendPoint[];
}

export interface GraphNode {
  id: string;
  name: string;
  status: string;
  score: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  scopes: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  timestamp: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'success' | 'error';
}

export interface Conversation {
  id: string;
  title: string | null;
  agent_name: string;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
}
