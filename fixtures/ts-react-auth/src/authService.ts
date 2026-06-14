/**
 * Fixture: authService with login function.
 * Used by scanner fixture test (PRD §13.2).
 */
import { post } from "./apiClient";

export interface LoginResult {
  token: string;
  userId: string;
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const response = await post("/api/auth/login", { username, password });
  return response as LoginResult;
}

export function logout(): void {
  localStorage.removeItem("auth_token");
}
