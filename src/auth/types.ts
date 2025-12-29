// Authentication types and request/response schemas

import { z } from 'zod';

// Request schemas
export const RegisterRequestSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  display_name: z.string().min(1).max(100).optional(),
});

export const LoginRequestSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export const RefreshRequestSchema = z.object({
  refresh_token: z.string().min(1, 'Refresh token is required'),
});

export const UpdateProfileRequestSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
});

export const ChangePasswordRequestSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z.string().min(8, 'New password must be at least 8 characters'),
});

// Type aliases
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

// Response types
export interface AuthResponse {
  user: {
    id: string;
    email: string;
    display_name: string | null;
    created_at: string;
  };
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface UserResponse {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

// Auth context for authenticated requests
export interface AuthContext {
  type: 'jwt' | 'api_token' | 'legacy';
  userId: string;
  tokenId?: string; // API Token ID
  scopes?: string[];
}

// Error types
export interface AuthError {
  error: string;
  code: string;
  details?: { field: string; message: string }[];
}
