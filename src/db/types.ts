// Database types for Session Collaboration MCP

export type SessionStatus = 'active' | 'inactive' | 'terminated';
export type ClaimStatus = 'active' | 'completed' | 'abandoned';
export type ClaimScope = 'small' | 'medium' | 'large';
export type DecisionCategory = 'architecture' | 'naming' | 'api' | 'database' | 'ui' | 'other';

export interface Session {
  id: string;
  name: string | null;
  project_root: string;
  machine_id: string | null;
  created_at: string;
  last_heartbeat: string;
  status: SessionStatus;
}

export interface Claim {
  id: string;
  session_id: string;
  intent: string;
  scope: ClaimScope;
  status: ClaimStatus;
  created_at: string;
  updated_at: string;
  completed_summary: string | null;
}

export interface ClaimFile {
  id: number;
  claim_id: string;
  file_path: string;
  is_pattern: number; // 0 or 1, SQLite boolean
}

export interface Message {
  id: string;
  from_session_id: string;
  to_session_id: string | null;
  content: string;
  read_at: string | null;
  created_at: string;
}

export interface Decision {
  id: string;
  session_id: string;
  category: DecisionCategory | null;
  title: string;
  description: string;
  created_at: string;
}

// Extended types with joins
export interface ClaimWithFiles extends Claim {
  files: string[];
  session_name: string | null;
}

export interface ConflictInfo {
  claim_id: string;
  session_id: string;
  session_name: string | null;
  file_path: string;
  intent: string;
  scope: ClaimScope;
  created_at: string;
}
