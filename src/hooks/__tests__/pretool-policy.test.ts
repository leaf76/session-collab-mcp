import { describe, it, expect } from 'vitest';
import { decidePretoolWrite, extractWritePath } from '../pretool-policy.js';

describe('pretool policy', () => {
  it('allows when there are no claims', () => {
    expect(decidePretoolWrite({ hits: [] }).decision).toBe('allow');
  });

  it('allows the claim owner', () => {
    const decision = decidePretoolWrite({
      selfCollabSessionId: 'self',
      hits: [{ session_id: 'self', session_name: 'mine', file_path: 'src/a.ts' }],
    });
    expect(decision.decision).toBe('allow');
  });

  it('denies a foreign claim', () => {
    const decision = decidePretoolWrite({
      selfCollabSessionId: 'self',
      hits: [{ session_id: 'other', session_name: 'feature-auth', file_path: 'src/a.ts' }],
    });
    expect(decision.decision).toBe('deny');
    expect(decision.reason).toContain('feature-auth');
  });

  it('treats a sole active session as self when unmapped', () => {
    const decision = decidePretoolWrite({
      soleActiveSessionId: 'only',
      hits: [{ session_id: 'only', session_name: 'solo', file_path: 'src/a.ts' }],
    });
    expect(decision.decision).toBe('allow');
  });

  it('extracts write paths', () => {
    expect(extractWritePath('Write', { file_path: 'a.ts' })).toBe('a.ts');
    expect(extractWritePath('NotebookEdit', { notebook_path: 'n.ipynb' })).toBe('n.ipynb');
    expect(extractWritePath('Bash', { command: 'rm' })).toBeNull();
  });
});
