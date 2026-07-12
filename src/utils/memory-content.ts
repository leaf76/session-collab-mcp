// Working-memory content size guards

import {
  MAX_MEMORY_CONTENT_CHARS,
  DEFAULT_RECALL_MAX_ITEMS,
  MAX_RECALL_MAX_ITEMS,
} from '../constants.js';

export type ContentClampResult = {
  content: string;
  truncated: boolean;
  original_length: number;
};

/** Clamp memory content to MAX_MEMORY_CONTENT_CHARS (append ellipsis if truncated). */
export function clampMemoryContent(
  content: string,
  maxChars: number = MAX_MEMORY_CONTENT_CHARS
): ContentClampResult {
  const original_length = content.length;
  if (original_length <= maxChars) {
    return { content, truncated: false, original_length };
  }
  const ellipsis = '…';
  const keep = Math.max(0, maxChars - ellipsis.length);
  return {
    content: content.slice(0, keep) + ellipsis,
    truncated: true,
    original_length,
  };
}

export function resolveRecallMaxItems(requested?: number): number {
  if (requested === undefined || Number.isNaN(requested)) {
    return DEFAULT_RECALL_MAX_ITEMS;
  }
  return Math.min(MAX_RECALL_MAX_ITEMS, Math.max(0, Math.floor(requested)));
}
