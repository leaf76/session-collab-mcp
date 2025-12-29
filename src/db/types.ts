// Database types for Session Collaboration MCP

export type SessionStatus = 'active' | 'inactive' | 'terminated';
export type ClaimStatus = 'active' | 'completed' | 'abandoned';
export type ClaimScope = 'small' | 'medium' | 'large';
export type DecisionCategory = 'architecture' | 'naming' | 'api' | 'database' | 'ui' | 'other';
export type UserStatus = 'active' | 'suspended' | 'deleted';

// User and authentication types
export interface User {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  status: UserStatus;
}

export interface UserPublic {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

export interface ApiToken {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  scopes: string; // JSON array string
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface ApiTokenPublic {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface RefreshToken {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
  user_agent: string | null;
  ip_address: string | null;
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

// Session configuration
export type ConflictMode = 'strict' | 'smart' | 'bypass';

export interface SessionConfig {
  mode: ConflictMode;
  allow_release_others: boolean;
  auto_release_stale: boolean;
  stale_threshold_hours: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  mode: 'smart',
  allow_release_others: false,
  auto_release_stale: false,
  stale_threshold_hours: 2,
};

export interface SessionProgress {
  completed: number;
  total: number;
  percentage: number;
}

export interface Session {
  id: string;
  name: string | null;
  project_root: string;
  machine_id: string | null;
  user_id: string | null;
  created_at: string;
  last_heartbeat: string;
  status: SessionStatus;
  current_task: string | null;
  progress: string | null; // JSON string of SessionProgress
  todos: string | null; // JSON string of TodoItem[]
  config: string | null; // JSON string of SessionConfig
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

// Symbol types for fine-grained conflict detection
export type SymbolType = 'function' | 'class' | 'method' | 'variable' | 'block' | 'other';

export interface ClaimSymbol {
  id: number;
  claim_id: string;
  file_path: string;
  symbol_name: string;
  symbol_type: SymbolType;
  created_at: string;
}

// Input format for claiming symbols
export interface SymbolClaim {
  file: string;
  symbols: string[];
  symbol_type?: SymbolType;
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
  // Symbol-level conflict info (optional)
  symbol_name?: string;
  symbol_type?: SymbolType;
  conflict_level: 'file' | 'symbol';
}
