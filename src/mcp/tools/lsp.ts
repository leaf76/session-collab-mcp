// LSP integration tools for symbol analysis and validation

import type { DatabaseAdapter } from '../../db/sqlite-adapter.js';
import type { McpTool, McpToolResult } from '../protocol';
import { createToolResult } from '../protocol';
import type { SymbolType, ConflictInfo } from '../../db/types';

// LSP Symbol Kind mapping (from LSP spec)
const LSP_SYMBOL_KIND_MAP: Record<number, SymbolType> = {
  5: 'class', // Class
  6: 'method', // Method
  9: 'function', // Constructor
  12: 'function', // Function
  13: 'variable', // Variable
  14: 'variable', // Constant
  23: 'class', // Struct
  // Map others to 'other'
};

// Input format for LSP symbols (simplified from LSP DocumentSymbol)
interface LspSymbolInput {
  name: string;
  kind: number; // LSP SymbolKind
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  children?: LspSymbolInput[];
}

interface FileSymbolInput {
  file: string;
  symbols: LspSymbolInput[];
}

// Reference input for tracking symbol dependencies
interface SymbolReference {
  symbol: string;
  file: string;
  references: Array<{
    file: string;
    line: number;
    context?: string;
  }>;
}

// Output types
interface AnalyzedSymbol {
  name: string;
  type: SymbolType;
  file: string;
  conflict_status: 'safe' | 'blocked';
  conflict_info?: {
    session_name: string | null;
    intent: string;
    claim_id: string;
  };
  // Reference impact (which other symbols/files depend on this)
  impact?: {
    references_count: number;
    affected_files: string[];
  };
}

export const lspTools: McpTool[] = [
  {
    name: 'collab_analyze_symbols',
    description: `Analyze LSP symbols for conflict detection and reference impact.

WORKFLOW:
1. Claude uses LSP.documentSymbol to get symbols from a file
2. Claude passes those symbols to this tool
3. This tool checks conflicts and returns which symbols are safe/blocked

This enables Claude to automatically proceed with safe symbols and skip blocked ones.`,
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Your session ID (to exclude your own claims)',
        },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string', description: 'File path' },
              symbols: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'Symbol name' },
                    kind: { type: 'number', description: 'LSP SymbolKind' },
                    range: {
                      type: 'object',
                      properties: {
                        start: {
                          type: 'object',
                          properties: {
                            line: { type: 'number' },
                            character: { type: 'number' },
                          },
                        },
                        end: {
                          type: 'object',
                          properties: {
                            line: { type: 'number' },
                            character: { type: 'number' },
                          },
                        },
                      },
                    },
                    children: {
                      type: 'array',
                      description: 'Nested symbols (e.g., methods in a class)',
                    },
                  },
                  required: ['name', 'kind'],
                },
                description: 'LSP DocumentSymbol array from LSP.documentSymbol',
              },
            },
            required: ['file', 'symbols'],
          },
          description: 'Files with their LSP symbols to analyze',
        },
        references: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              symbol: { type: 'string', description: 'Symbol name' },
              file: { type: 'string', description: 'File containing the symbol' },
              references: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    file: { type: 'string' },
                    line: { type: 'number' },
                    context: { type: 'string' },
                  },
                  required: ['file', 'line'],
                },
                description: 'Locations that reference this symbol (from LSP.findReferences)',
              },
            },
            required: ['symbol', 'file', 'references'],
          },
          description: 'Optional: Reference data from LSP.findReferences for impact analysis',
        },
        check_symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: Only analyze these specific symbol names (filter)',
        },
      },
      required: ['session_id', 'files'],
    },
  },
  {
    name: 'collab_validate_symbols',
    description: `Validate that symbols exist in a file before claiming them.

Use this to verify symbol names are correct before calling collab_claim.
Helps prevent claiming non-existent or misspelled symbols.`,
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'File path to validate symbols in',
        },
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Symbol names to validate',
        },
        lsp_symbols: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              kind: { type: 'number' },
            },
            required: ['name', 'kind'],
          },
          description: 'LSP symbols from the file (from LSP.documentSymbol)',
        },
      },
      required: ['file', 'symbols', 'lsp_symbols'],
    },
  },
];

// Helper: Convert LSP SymbolKind to our SymbolType
function lspKindToSymbolType(kind: number): SymbolType {
  return LSP_SYMBOL_KIND_MAP[kind] ?? 'other';
}

// Helper: Flatten nested LSP symbols into a flat list
function flattenLspSymbols(
  symbols: LspSymbolInput[],
  file: string,
  parentName?: string
): Array<{ name: string; type: SymbolType; file: string; fullName: string }> {
  const result: Array<{ name: string; type: SymbolType; file: string; fullName: string }> = [];

  for (const sym of symbols) {
    const fullName = parentName ? `${parentName}.${sym.name}` : sym.name;
    result.push({
      name: sym.name,
      type: lspKindToSymbolType(sym.kind),
      file,
      fullName,
    });

    // Recursively flatten children (e.g., methods in a class)
    if (sym.children && sym.children.length > 0) {
      result.push(...flattenLspSymbols(sym.children, file, fullName));
    }
  }

  return result;
}

export async function handleLspTool(
  db: DatabaseAdapter,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  switch (name) {
    case 'collab_analyze_symbols': {
      const sessionId = args.session_id as string;
      const files = args.files as FileSymbolInput[] | undefined;
      const references = args.references as SymbolReference[] | undefined;
      const checkSymbols = args.check_symbols as string[] | undefined;

      if (!sessionId) {
        return createToolResult(
          JSON.stringify({ error: 'INVALID_INPUT', message: 'session_id is required' }),
          true
        );
      }

      if (!files || !Array.isArray(files) || files.length === 0) {
        return createToolResult(
          JSON.stringify({ error: 'INVALID_INPUT', message: 'files array is required' }),
          true
        );
      }

      // Build reference lookup map if provided
      const referenceMap = new Map<string, SymbolReference>();
      if (references) {
        for (const ref of references) {
          const key = `${ref.file}:${ref.symbol}`;
          referenceMap.set(key, ref);
        }
      }

      // Flatten all symbols from all files
      const allSymbols: Array<{ name: string; type: SymbolType; file: string; fullName: string }> = [];
      for (const fileInput of files) {
        const flattened = flattenLspSymbols(fileInput.symbols, fileInput.file);
        allSymbols.push(...flattened);
      }

      // Filter to only requested symbols if specified
      let symbolsToAnalyze = allSymbols;
      if (checkSymbols && checkSymbols.length > 0) {
        const checkSet = new Set(checkSymbols);
        symbolsToAnalyze = allSymbols.filter((s) => checkSet.has(s.name) || checkSet.has(s.fullName));
      }

      // Query existing claims for these files
      const fileList = [...new Set(symbolsToAnalyze.map((s) => s.file))];
      const symbolNames = [...new Set(symbolsToAnalyze.map((s) => s.name))];

      // Check for symbol-level claims
      const symbolConflicts = await querySymbolConflicts(db, fileList, symbolNames, sessionId);

      // Check for file-level claims
      const fileConflicts = await queryFileConflicts(db, fileList, sessionId);

      // Build result with conflict status for each symbol
      const analyzedSymbols: AnalyzedSymbol[] = [];
      const safeSymbols: string[] = [];
      const blockedSymbols: string[] = [];

      for (const sym of symbolsToAnalyze) {
        // Check if blocked by file-level claim
        const fileConflict = fileConflicts.find((c) => c.file_path === sym.file);
        // Check if blocked by symbol-level claim
        const symbolConflict = symbolConflicts.find(
          (c) => c.file_path === sym.file && c.symbol_name === sym.name
        );

        const conflict = fileConflict ?? symbolConflict;
        const isBlocked = !!conflict;

        // Get reference impact if available
        const refKey = `${sym.file}:${sym.name}`;
        const refData = referenceMap.get(refKey);
        let impact: AnalyzedSymbol['impact'] | undefined;

        if (refData && refData.references.length > 0) {
          const affectedFiles = [...new Set(refData.references.map((r) => r.file))];
          impact = {
            references_count: refData.references.length,
            affected_files: affectedFiles,
          };
        }

        const analyzed: AnalyzedSymbol = {
          name: sym.name,
          type: sym.type,
          file: sym.file,
          conflict_status: isBlocked ? 'blocked' : 'safe',
          ...(conflict && {
            conflict_info: {
              session_name: conflict.session_name,
              intent: conflict.intent,
              claim_id: conflict.claim_id,
            },
          }),
          ...(impact && { impact }),
        };

        analyzedSymbols.push(analyzed);

        if (isBlocked) {
          blockedSymbols.push(`${sym.file}:${sym.name}`);
        } else {
          safeSymbols.push(`${sym.file}:${sym.name}`);
        }
      }

      // Determine recommendation
      const hasBlocked = blockedSymbols.length > 0;
      const hasSafe = safeSymbols.length > 0;

      let recommendation: 'proceed_all' | 'proceed_safe_only' | 'abort';
      if (!hasBlocked) {
        recommendation = 'proceed_all';
      } else if (hasSafe) {
        recommendation = 'proceed_safe_only';
      } else {
        recommendation = 'abort';
      }

      // Build message
      let message: string;
      if (recommendation === 'proceed_all') {
        message = `All ${safeSymbols.length} symbols are safe to edit. Proceed.`;
      } else if (recommendation === 'proceed_safe_only') {
        message = `Edit ONLY ${safeSymbols.length} safe symbols. ${blockedSymbols.length} symbols are blocked.`;
      } else {
        message = `All ${blockedSymbols.length} symbols are blocked. Coordinate with other sessions.`;
      }

      return createToolResult(
        JSON.stringify(
          {
            can_edit: hasSafe,
            recommendation,
            summary: {
              total: symbolsToAnalyze.length,
              safe: safeSymbols.length,
              blocked: blockedSymbols.length,
            },
            symbols: analyzedSymbols,
            safe_symbols: safeSymbols,
            blocked_symbols: blockedSymbols,
            message,
          },
          null,
          2
        )
      );
    }

    case 'collab_validate_symbols': {
      const file = args.file as string;
      const symbols = args.symbols as string[];
      const lspSymbols = args.lsp_symbols as Array<{ name: string; kind: number }>;

      if (!file || !symbols || !lspSymbols) {
        return createToolResult(
          JSON.stringify({
            error: 'INVALID_INPUT',
            message: 'file, symbols, and lsp_symbols are required',
          }),
          true
        );
      }

      // Build set of available symbol names from LSP data
      const availableSymbols = new Set<string>();
      for (const lspSym of lspSymbols) {
        availableSymbols.add(lspSym.name);
      }

      // Validate each requested symbol
      const valid: string[] = [];
      const invalid: string[] = [];
      const suggestions: Record<string, string[]> = {};

      for (const sym of symbols) {
        if (availableSymbols.has(sym)) {
          valid.push(sym);
        } else {
          invalid.push(sym);
          // Find similar names (simple prefix/suffix matching)
          const similar = Array.from(availableSymbols).filter(
            (avail) =>
              avail.toLowerCase().includes(sym.toLowerCase()) ||
              sym.toLowerCase().includes(avail.toLowerCase())
          );
          if (similar.length > 0) {
            suggestions[sym] = similar.slice(0, 3);
          }
        }
      }

      const allValid = invalid.length === 0;

      return createToolResult(
        JSON.stringify({
          valid: allValid,
          file,
          valid_symbols: valid,
          invalid_symbols: invalid,
          suggestions: Object.keys(suggestions).length > 0 ? suggestions : undefined,
          available_symbols: Array.from(availableSymbols),
          message: allValid
            ? `All ${valid.length} symbols are valid.`
            : `${invalid.length} symbol(s) not found: ${invalid.join(', ')}`,
        })
      );
    }

    default:
      return createToolResult(`Unknown LSP tool: ${name}`, true);
  }
}

// Helper: Query symbol-level conflicts from database
async function querySymbolConflicts(
  db: DatabaseAdapter,
  files: string[],
  symbolNames: string[],
  excludeSessionId: string
): Promise<ConflictInfo[]> {
  if (files.length === 0 || symbolNames.length === 0) {
    return [];
  }

  const filePlaceholders = files.map(() => '?').join(',');
  const symbolPlaceholders = symbolNames.map(() => '?').join(',');

  const query = `
    SELECT
      c.id as claim_id,
      c.session_id,
      s.name as session_name,
      cs.file_path,
      c.intent,
      c.scope,
      c.created_at,
      cs.symbol_name,
      cs.symbol_type
    FROM claim_symbols cs
    JOIN claims c ON cs.claim_id = c.id
    JOIN sessions s ON c.session_id = s.id
    WHERE c.status = 'active'
      AND s.status = 'active'
      AND c.session_id != ?
      AND cs.file_path IN (${filePlaceholders})
      AND cs.symbol_name IN (${symbolPlaceholders})
  `;

  const result = await db
    .prepare(query)
    .bind(excludeSessionId, ...files, ...symbolNames)
    .all<ConflictInfo & { symbol_name: string; symbol_type: string }>();

  return result.results.map((r) => ({
    ...r,
    conflict_level: 'symbol' as const,
  }));
}

// Helper: Query file-level conflicts from database
async function queryFileConflicts(
  db: DatabaseAdapter,
  files: string[],
  excludeSessionId: string
): Promise<ConflictInfo[]> {
  if (files.length === 0) {
    return [];
  }

  const placeholders = files.map(() => '?').join(',');

  // File-level claims are claims that have files but no symbols for those files
  const query = `
    SELECT
      c.id as claim_id,
      c.session_id,
      s.name as session_name,
      cf.file_path,
      c.intent,
      c.scope,
      c.created_at
    FROM claim_files cf
    JOIN claims c ON cf.claim_id = c.id
    JOIN sessions s ON c.session_id = s.id
    WHERE c.status = 'active'
      AND s.status = 'active'
      AND c.session_id != ?
      AND cf.file_path IN (${placeholders})
      AND NOT EXISTS (
        SELECT 1 FROM claim_symbols cs WHERE cs.claim_id = c.id AND cs.file_path = cf.file_path
      )
  `;

  const result = await db
    .prepare(query)
    .bind(excludeSessionId, ...files)
    .all<Omit<ConflictInfo, 'conflict_level'>>();

  return result.results.map((r) => ({
    ...r,
    conflict_level: 'file' as const,
  }));
}
