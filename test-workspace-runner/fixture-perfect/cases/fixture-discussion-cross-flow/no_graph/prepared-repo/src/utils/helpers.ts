export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString();
}

export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
