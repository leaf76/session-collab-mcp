export type ClaimHit = {
  session_id: string;
  session_name: string;
  file_path: string;
};

export type PretoolDecision = {
  decision: 'allow' | 'deny';
  reason?: string;
};

export function decidePretoolWrite(options: {
  disabled?: boolean;
  selfCollabSessionId?: string | null;
  soleActiveSessionId?: string | null;
  hits: ClaimHit[];
}): PretoolDecision {
  if (options.disabled) {
    return { decision: 'allow' };
  }
  if (options.hits.length === 0) {
    return { decision: 'allow' };
  }

  const self = options.selfCollabSessionId ?? options.soleActiveSessionId ?? null;
  const foreign = options.hits.filter((hit) => hit.session_id !== self);
  if (foreign.length === 0) {
    return { decision: 'allow' };
  }

  const owners = [...new Set(foreign.map((hit) => hit.session_name || hit.session_id))];
  const file = foreign[0]?.file_path ?? 'file';
  return {
    decision: 'deny',
    reason: `session-collab: ${file} is claimed by ${owners.join(', ')}. Do not overwrite; coordinate or wait.`,
  };
}

export function extractWritePath(toolName: string, toolInput: Record<string, unknown> | undefined): string | null {
  if (!toolInput) return null;
  if (toolName === 'NotebookEdit') {
    const notebookPath = toolInput.notebook_path;
    return typeof notebookPath === 'string' && notebookPath ? notebookPath : null;
  }
  if (toolName === 'Write' || toolName === 'Edit') {
    const filePath = toolInput.file_path;
    return typeof filePath === 'string' && filePath ? filePath : null;
  }
  return null;
}
