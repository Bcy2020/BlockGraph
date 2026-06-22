import { apiClient } from '../../lib/apiClient';
import type { Discussion } from '../../types/discussion';

export async function fetchDiscussions(): Promise<Discussion[]> {
  const response = await apiClient.get('/discussions');
  return response.data;
}

export async function createDiscussion(title: string, content: string): Promise<Discussion> {
  const response = await apiClient.post('/discussions', { title, content });
  return response.data;
}
