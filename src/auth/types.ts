// Authentication types

// Auth context for authenticated requests
export interface AuthContext {
  type: 'jwt' | 'api_token' | 'legacy';
  userId: string;
  tokenId?: string;
  scopes?: string[];
}
