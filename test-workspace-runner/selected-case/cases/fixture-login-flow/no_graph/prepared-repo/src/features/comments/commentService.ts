import { apiClient } from '../../lib/apiClient';
import type { Comment } from '../../types/comment';

export async function fetchComments(discussionId: string): Promise<Comment[]> {
  const response = await apiClient.get(`/discussions/${discussionId}/comments`);
  return response.data;
}

export async function addComment(discussionId: string, text: string): Promise<Comment> {
  const response = await apiClient.post(`/discussions/${discussionId}/comments`, { text });
  return response.data;
}
