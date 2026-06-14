/**
 * Fixture: apiClient wrapping fetch.
 * Used by scanner fixture test (PRD §13.2).
 */

const BASE_URL = "https://api.example.com";

export async function get(path: string): Promise<unknown> {
  const response = await fetch(`${BASE_URL}${path}`);
  return response.json();
}

export async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}
