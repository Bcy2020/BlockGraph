export function mockApi<T>(data: T): Promise<{ data: T }> {
  return Promise.resolve({ data });
}

export function createMockUser(overrides?: Partial<{ id: string; name: string; email: string }>) {
  return {
    id: overrides?.id ?? 'user-1',
    name: overrides?.name ?? 'Test User',
    email: overrides?.email ?? 'test@example.com',
    role: 'user' as const,
  };
}
