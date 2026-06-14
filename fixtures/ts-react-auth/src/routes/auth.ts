/**
 * Fixture: auth route handler.
 * Used by scanner fixture test (PRD §13.2).
 */
import { login, type LoginResult } from "../authService";

export interface AuthRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  data?: LoginResult;
  error?: string;
}

export async function handleAuthRoute(req: AuthRequest): Promise<AuthResponse> {
  try {
    const result = await login(req.username, req.password);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
