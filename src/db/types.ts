// Database types for Session Collaboration MCP

export type SessionStatus = 'active' | 'inactive' | 'terminated';
export type ClaimStatus = 'active' | 'completed' | 'abandoned';
export type ClaimScope = 'small' | 'medium' | 'large';
export type DecisionCategory = 'architecture' | 'naming' | 'api' | 'database' | 'ui' | 'other';
export type UserStatus = 'active' | 'suspended' | 'deleted';

// Audit history types
export type AuditAction =
  | 'session_started'
  | 'session_ended'
  | 'claim_created'
  | 'claim_released'
  | 'conflict_detected'
  | 'queue_joined'
  | 'queue_left'
  | 'priority_changed';

export type AuditEntityType = 'session' | 'claim' | 'queue';

export interface AuditHistoryEntry {
  id: string;
  session_id: string | null;
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id: string;
  metadata: string | null; // JSON string
  created_at: string;
}

export interface AuditHistoryWithSession extends AuditHistoryEntry {
  session_name: string | null;
}

export interface AuditMetadata {
  // Claim actions
  files?: string[];
  intent?: string;
  scope?: ClaimScope;
  priority?: number;
  status?: ClaimStatus | 'partial';
  auto_release?: boolean;
  partial?: boolean;
  files_remaining?: number;

  // Conflict actions
  conflicting_session_id?: string;
  conflicting_session_name?: string;

  // Queue actions
  position?: number;
  claim_id?: string;

  // Session actions
  project_root?: string;
  memory_count?: number;

  // Generic
  reason?: string;
  old_value?: unknown;
  new_value?: unknown;
}

// Priority levels for claims
export type PriorityLevel = 'critical' | 'high' | 'normal' | 'low';

export interface PriorityInfo {
  value: number;
  level: PriorityLevel;
  label: string;
}

// Helper function to get priority level from numeric value
export function getPriorityLevel(priority: number): PriorityInfo {
  if (priority >= 90) return { value: priority, level: 'critical', label: 'Critical (90-100)' };
  if (priority >= 70) return { value: priority, level: 'high', label: 'High (70-89)' };
  if (priority >= 40) return { value: priority, level: 'normal', label: 'Normal (40-69)' };
  return { value: priority, level: 'low', label: 'Low (0-39)' };
}

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
  // Auto-release after edit completion
  auto_release_immediate: boolean;
  // Grace period before stale release (minutes)
  auto_release_delay_minutes: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  mode: 'smart',
  allow_release_others: false,
  auto_release_stale: false,
  stale_threshold_hours: 2,
  auto_release_immediate: false,
  auto_release_delay_minutes: 5,
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
  priority: number;
  created_at: string;
  updated_at: string;
  completed_summary: string | null;
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

// Symbol reference for impact tracking
export interface SymbolReference {
  id: number;
  source_file: string;
  source_symbol: string;
  ref_file: string;
  ref_line: number | null;
  ref_context: string | null;
  session_id: string;
  created_at: string;
}

// Input format for storing references
export interface ReferenceInput {
  source_file: string;
  source_symbol: string;
  references: Array<{
    file: string;
    line: number;
    context?: string;
  }>;
}

// Impact analysis result
export interface ImpactInfo {
  symbol: string;
  file: string;
  affected_claims: Array<{
    claim_id: string;
    session_name: string | null;
    intent: string;
    affected_symbols: string[];
  }>;
  reference_count: number;
  affected_files: string[];
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

// ============ Claim Queue Types ============

export interface QueueEntry {
  id: string;
  claim_id: string;
  session_id: string;
  intent: string;
  position: number;
  priority: number;
  scope: ClaimScope;
  estimated_wait_minutes: number | null;
  created_at: string;
}

export interface QueueEntryWithDetails extends QueueEntry {
  session_name: string | null;
  claim_files: string[];
  claim_session_name: string | null;
  claim_intent: string;
}

// Scope to estimated minutes mapping
export const SCOPE_WAIT_MINUTES: Record<ClaimScope, number> = {
  small: 30,
  medium: 120, // 2 hours
  large: 480, // 8 hours
};

// ============ Notification Types ============

export type NotificationType = 'claim_released' | 'queue_ready' | 'conflict_detected' | 'session_message';

// ============ Working Memory Types ============

export type MemoryCategory = 'finding' | 'decision' | 'state' | 'todo' | 'important' | 'context';

export interface WorkingMemory {
  id: number;
  session_id: string;
  category: MemoryCategory;
  key: string;
  content: string;
  priority: number;
  pinned: number; // 0 or 1 (SQLite boolean)
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  related_claim_id: string | null;
  related_decision_id: string | null;
  metadata: string | null; // JSON string
}

export interface WorkingMemoryInput {
  category: MemoryCategory;
  key: string;
  content: string;
  priority?: number;
  pinned?: boolean;
  expires_at?: string;
  related_claim_id?: string;
  related_decision_id?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkingMemoryMetadata {
  // Common fields
  source?: string; // Where this memory came from
  file_path?: string; // Related file
  line_number?: number; // Related line

  // For findings
  confidence?: number; // 0-1 confidence level
  verified?: boolean;

  // For state tracking
  previous_value?: unknown;

  // Extensible
  [key: string]: unknown;
}

export interface Notification {
  id: string;
  session_id: string;
  type: NotificationType;
  title: string;
  message: string;
  reference_type: string | null;
  reference_id: string | null;
  metadata: string | null; // JSON string
  read_at: string | null;
  created_at: string;
}

export interface NotificationMetadata {
  // claim_released
  claim_id?: string;
  files?: string[];
  released_by?: string;

  // queue_ready
  queue_position?: number;

  // conflict_detected
  conflicting_session_id?: string;
  conflicting_session_name?: string;

  // session_message
  from_session_id?: string;
  from_session_name?: string;
  is_broadcast?: boolean;
}
