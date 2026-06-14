import { apiClient } from '../../lib/apiClient';
import type { Team } from '../../types/team';

export async function fetchTeams(): Promise<Team[]> {
  const response = await apiClient.get('/teams');
  return response.data;
}

export async function createTeam(name: string): Promise<Team> {
  const response = await apiClient.post('/teams', { name });
  return response.data;
}
