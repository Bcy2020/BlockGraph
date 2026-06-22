import { apiClient } from '../../lib/apiClient';
import type { User } from '../../types/user';

export async function fetchUser(id: string): Promise<User> {
  const response = await apiClient.get(`/users/${id}`);
  return response.data;
}

export async function updateUser(id: string, data: Partial<User>): Promise<User> {
  const response = await apiClient.put(`/users/${id}`, data);
  return response.data;
}
