import { describe, it, expect } from 'vitest';
import { normalizeToolResult, coerceQueryValue, parseQueryParams } from '../server.js';

describe('HTTP Server Utils', () => {
  it('should coerce query values', () => {
    expect(coerceQueryValue('true')).toBe(true);
    expect(coerceQueryValue('false')).toBe(false);
    expect(coerceQueryValue('42')).toBe(42);
    expect(coerceQueryValue('text')).toBe('text');
  });

  it('should parse query params with coercion', () => {
    const url = new URL('http://localhost/v1/sessions?include_inactive=true&limit=10');
    const params = parseQueryParams(url);
    expect(params.include_inactive).toBe(true);
    expect(params.limit).toBe(10);
  });

  it('should normalize tool results', () => {
    const ok = normalizeToolResult({
      content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
    });
    expect(ok.ok).toBe(true);

    const err = normalizeToolResult({
      content: [{ type: 'text', text: JSON.stringify({ error: 'INVALID_INPUT', message: 'bad' }) }],
      isError: true,
    });
    expect(err.ok).toBe(false);
    expect(err.error?.code).toBe('INVALID_INPUT');
  });
});
