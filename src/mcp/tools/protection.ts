// Phase 3: Plan & File Protection tools
// Protects important files (plans, session-created files) from accidental deletion

import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol.js';
import type { PlanStatus } from '../../db/queries.js';
import {
  registerPlan,
  updatePlanStatus,
  getPlan,
  listPlans,
  registerCreatedFile,
  getCreatedFiles,
  isFileProtected,
  getProtectedFiles,
} from '../../db/queries.js';
import {
  errorResponse,
  successResponse,
  validationError,
  validateActiveSession,
  ERROR_CODES,
} from '../../utils/response.js';

export const protectionTools: McpTool[] = [
  {
    name: 'collab_plan_register',
    description:
      'Register a plan document for protection. Plans are automatically pinned with high priority to prevent context loss.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        file_path: {
          type: 'string',
          description: 'Path to the plan file',
        },
        title: {
          type: 'string',
          description: 'Title of the plan',
        },
        content_summary: {
          type: 'string',
          description: 'Summary of the plan content (key points, steps)',
        },
        status: {
          type: 'string',
          enum: ['draft', 'approved', 'in_progress'],
          description: 'Initial status of the plan (default: draft)',
        },
      },
      required: ['session_id', 'file_path', 'title', 'content_summary'],
    },
  },
  {
    name: 'collab_plan_update_status',
    description:
      'Update plan status. Use this to progress plan through lifecycle: draft → approved → in_progress → completed → archived',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        file_path: {
          type: 'string',
          description: 'Path to the plan file',
        },
        status: {
          type: 'string',
          enum: ['draft', 'approved', 'in_progress', 'completed', 'archived'],
          description: 'New status for the plan',
        },
        summary: {
          type: 'string',
          description: 'Optional updated summary (for completed plans, describe what was achieved)',
        },
      },
      required: ['session_id', 'file_path', 'status'],
    },
  },
  {
    name: 'collab_plan_get',
    description: 'Get plan information by file path.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        file_path: {
          type: 'string',
          description: 'Path to the plan file',
        },
      },
      required: ['session_id', 'file_path'],
    },
  },
  {
    name: 'collab_plan_list',
    description: 'List all plans for this session.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        status: {
          type: 'string',
          enum: ['draft', 'approved', 'in_progress', 'completed', 'archived'],
          description: 'Filter by status',
        },
        include_archived: {
          type: 'boolean',
          description: 'Include archived plans (default: false)',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'collab_file_register',
    description:
      'Register a file created in this session for protection. Protected files will trigger warnings before deletion.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        file_path: {
          type: 'string',
          description: 'Path to the created file',
        },
        file_type: {
          type: 'string',
          enum: ['plan', 'code', 'config', 'doc', 'other'],
          description: 'Type of file (default: other)',
        },
        description: {
          type: 'string',
          description: 'Brief description of the file purpose',
        },
      },
      required: ['session_id', 'file_path'],
    },
  },
  {
    name: 'collab_file_list_created',
    description: 'List all files created in this session.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'collab_file_check_protected',
    description:
      'Check if a file is protected. Use this before deleting or overwriting files to prevent accidental loss.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        file_path: {
          type: 'string',
          description: 'Path to check',
        },
      },
      required: ['session_id', 'file_path'],
    },
  },
  {
    name: 'collab_file_list_protected',
    description: 'List all protected files in this session (plans + created files).',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
      },
      required: ['session_id'],
    },
  },
];

export async function handleProtectionTool(
  db: DatabaseAdapter,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  switch (name) {
    case 'collab_plan_register':
      return handlePlanRegister(db, args);
    case 'collab_plan_update_status':
      return handlePlanUpdateStatus(db, args);
    case 'collab_plan_get':
      return handlePlanGet(db, args);
    case 'collab_plan_list':
      return handlePlanList(db, args);
    case 'collab_file_register':
      return handleFileRegister(db, args);
    case 'collab_file_list_created':
      return handleFileListCreated(db, args);
    case 'collab_file_check_protected':
      return handleFileCheckProtected(db, args);
    case 'collab_file_list_protected':
      return handleFileListProtected(db, args);
    default:
      return errorResponse(ERROR_CODES.UNKNOWN_TOOL, `Unknown protection tool: ${name}`);
  }
}

async function handlePlanRegister(
  db: DatabaseAdapter,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const sessionId = args.session_id as string;
  const filePath = args.file_path as string;
  const title = args.title as string;
  const contentSummary = args.content_summary as string;
  const status = (args.status as PlanStatus) ?? 'draft';

  if (!sessionId || !filePath || !title || !contentSummary) {
    return validationError('session_id, file_path, title, and content_summary are required');
  }

  const sessionCheck = await validateActiveSession(db, sessionId);
  if (!sessionCheck.valid) {
    return sessionCheck.error!;
  }

  const memory = await registerPlan(db, sessionId, {
    file_path: filePath,
    title,
    content_summary: contentSummary,
    status,
  });

  return successResponse({
    registered: true,
    plan: {
      file_path: filePath,
      title,
      status,
      priority: memory.priority,
      pinned: memory.pinned === 1,
    },
    message: `Plan registered and protected: ${title}`,
  });
}

async function handlePlanUpdateStatus(
  db: DatabaseAdapter,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const sessionId = args.session_id as string;
  const filePath = args.file_path as string;
  const status = args.status as PlanStatus;
  const summary = args.summary as string | undefined;

  if (!sessionId || !filePath || !status) {
    return validationError('session_id, file_path, and status are required');
  }

  const sessionCheck = await validateActiveSession(db, sessionId);
  if (!sessionCheck.valid) {
    return sessionCheck.error!;
  }

  const updated = await updatePlanStatus(db, sessionId, filePath, status, summary);

  if (!updated) {
    return errorResponse(ERROR_CODES.MEMORY_NOT_FOUND, `Plan not found: ${filePath}`);
  }

  let message = `Plan status updated to: ${status}`;
  if (status === 'completed') {
    message += '. Plan protection reduced (unpinned, lower priority).';
  } else if (status === 'archived') {
    message += '. Plan archived and will be excluded from active memory.';
  }

  return successResponse({
    updated: true,
    file_path: filePath,
    new_status: status,
    message,
  });
}

async function handlePlanGet(
  db: DatabaseAdapter,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const sessionId = args.session_id as string;
  const filePath = args.file_path as string;

  if (!sessionId || !filePath) {
    return validationError('session_id and file_path are required');
  }

  const sessionCheck = await validateActiveSession(db, sessionId);
  if (!sessionCheck.valid) {
    return sessionCheck.error!;
  }

  const plan = await getPlan(db, sessionId, filePath);

  if (!plan) {
    return successResponse({
      found: false,
      message: `No plan found for: ${filePath}`,
    });
  }

  return successResponse({
    found: true,
    plan,
  });
}

async function handlePlanList(
  db: DatabaseAdapter,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const sessionId = args.session_id as string;
  const status = args.status as PlanStatus | undefined;
  const includeArchived = args.include_archived as boolean | undefined;

  if (!sessionId) {
    return validationError('session_id is required');
  }

  const sessionCheck = await validateActiveSession(db, sessionId);
  if (!sessionCheck.valid) {
    return sessionCheck.error!;
  }

  const plans = await listPlans(db, sessionId, { status, include_archived: includeArchived });

  return successResponse({
    count: plans.length,
    plans,
  });
}

async function handleFileRegister(
  db: DatabaseAdapter,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const sessionId = args.session_id as string;
  const filePath = args.file_path as string;
  const fileType = args.file_type as 'plan' | 'code' | 'config' | 'doc' | 'other' | undefined;
  const description = args.description as string | undefined;

  if (!sessionId || !filePath) {
    return validationError('session_id and file_path are required');
  }

  const sessionCheck = await validateActiveSession(db, sessionId);
  if (!sessionCheck.valid) {
    return sessionCheck.error!;
  }

  const memory = await registerCreatedFile(db, sessionId, {
    file_path: filePath,
    file_type: fileType,
    description,
  });

  return successResponse({
    registered: true,
    file: {
      file_path: filePath,
      file_type: fileType ?? 'other',
      priority: memory.priority,
      pinned: memory.pinned === 1,
    },
    message: `File registered for protection: ${filePath}`,
  });
}

async function handleFileListCreated(
  db: DatabaseAdapter,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const sessionId = args.session_id as string;

  if (!sessionId) {
    return validationError('session_id is required');
  }

  const sessionCheck = await validateActiveSession(db, sessionId);
  if (!sessionCheck.valid) {
    return sessionCheck.error!;
  }

  const files = await getCreatedFiles(db, sessionId);

  return successResponse({
    count: files.length,
    files,
  });
}

async function handleFileCheckProtected(
  db: DatabaseAdapter,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const sessionId = args.session_id as string;
  const filePath = args.file_path as string;

  if (!sessionId || !filePath) {
    return validationError('session_id and file_path are required');
  }

  const sessionCheck = await validateActiveSession(db, sessionId);
  if (!sessionCheck.valid) {
    return sessionCheck.error!;
  }

  const result = await isFileProtected(db, sessionId, filePath);

  if (result.protected) {
    return successResponse({
      protected: true,
      reason: result.reason,
      details: result.details,
      warning: `⚠️ This file is protected (${result.reason}). Confirm before deleting or overwriting.`,
    });
  }

  return successResponse({
    protected: false,
    message: 'File is not protected.',
  });
}

async function handleFileListProtected(
  db: DatabaseAdapter,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const sessionId = args.session_id as string;

  if (!sessionId) {
    return validationError('session_id is required');
  }

  const sessionCheck = await validateActiveSession(db, sessionId);
  if (!sessionCheck.valid) {
    return sessionCheck.error!;
  }

  const files = await getProtectedFiles(db, sessionId);

  return successResponse({
    count: files.length,
    files,
    message: files.length > 0
      ? `${files.length} protected file(s). Check before deleting.`
      : 'No protected files.',
  });
}
