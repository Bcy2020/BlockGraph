import { apiClient } from '../../lib/apiClient';
import type { User } from '../../types/user';

export async function loginUser(email: string, password: string): Promise<User> {
  const response = await apiClient.post('/auth/login', { email, password });
  return response.data;
}

export async function logoutUser(): Promise<void> {
  await apiClient.post('/auth/logout');
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    const response = await apiClient.get('/auth/me');
    return response.data;
  } catch {
    return null;
  }
}
