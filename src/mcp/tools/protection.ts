// Protection tools - Unified to 1 tool with action parameter

import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol.js';
import type { PlanStatus } from '../../db/queries.js';
import {
  registerPlan,
  listPlans,
  registerCreatedFile,
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
    name: 'collab_protect',
    description: `Unified tool for file protection. Use action parameter to:
- "register": Register a plan or file for protection
- "check": Check if a file is protected before deleting
- "list": List all protected files`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['register', 'check', 'list'],
          description: 'Action to perform',
        },
        session_id: {
          type: 'string',
          description: 'Your session ID',
        },
        file_path: {
          type: 'string',
          description: 'File path (for register/check)',
        },
        type: {
          type: 'string',
          enum: ['plan', 'file'],
          description: 'Type of protection (for register). Default: file',
        },
        title: {
          type: 'string',
          description: 'Title (for plan registration)',
        },
        content_summary: {
          type: 'string',
          description: 'Summary (for plan registration)',
        },
      },
      required: ['action', 'session_id'],
    },
  },
];

export async function handleProtectionTool(
  db: DatabaseAdapter,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  if (name !== 'collab_protect') {
    return errorResponse(ERROR_CODES.UNKNOWN_TOOL, `Unknown tool: ${name}`);
  }

  const action = args.action as string;
  const sessionId = args.session_id as string;

  if (!action || !sessionId) {
    return validationError('action and session_id are required');
  }

  const sessionCheck = await validateActiveSession(db, sessionId);
  if (!sessionCheck.valid) {
    return sessionCheck.error!;
  }

  switch (action) {
    case 'register': {
      const filePath = args.file_path as string;
      const type = (args.type as 'plan' | 'file') ?? 'file';

      if (!filePath) {
        return validationError('file_path is required for register');
      }

      if (type === 'plan') {
        const title = args.title as string;
        const contentSummary = args.content_summary as string;

        if (!title || !contentSummary) {
          return validationError('title and content_summary are required for plan registration');
        }

        const memory = await registerPlan(db, sessionId, {
          file_path: filePath,
          title,
          content_summary: contentSummary,
          status: 'in_progress' as PlanStatus,
        });

        return successResponse({
          registered: true,
          type: 'plan',
          file_path: filePath,
          title,
          priority: memory.priority,
          pinned: memory.pinned === 1,
          message: `Plan registered and protected: ${title}`,
        });
      } else {
        const description = args.description as string | undefined;

        const memory = await registerCreatedFile(db, sessionId, {
          file_path: filePath,
          file_type: 'other',
          description,
        });

        return successResponse({
          registered: true,
          type: 'file',
          file_path: filePath,
          priority: memory.priority,
          message: `File registered for protection: ${filePath}`,
        });
      }
    }

    case 'check': {
      const filePath = args.file_path as string;

      if (!filePath) {
        return validationError('file_path is required for check');
      }

      const result = await isFileProtected(db, sessionId, filePath);

      if (result.protected) {
        return successResponse({
          protected: true,
          reason: result.reason,
          warning: `⚠️ Protected (${result.reason}). Confirm before deleting.`,
        });
      }

      return successResponse({
        protected: false,
        message: 'File is not protected.',
      });
    }

    case 'list': {
      const files = await getProtectedFiles(db, sessionId);
      const plans = await listPlans(db, sessionId, { include_archived: false });

      return successResponse({
        protected_files: files.length,
        plans: plans.length,
        files,
        plan_list: plans.map(p => ({
          file_path: p.file_path,
          title: p.title,
          status: p.status,
        })),
        message: `${files.length} protected file(s), ${plans.length} plan(s)`,
      });
    }

    default:
      return errorResponse(ERROR_CODES.UNKNOWN_TOOL, `Unknown action: ${action}`);
  }
}
