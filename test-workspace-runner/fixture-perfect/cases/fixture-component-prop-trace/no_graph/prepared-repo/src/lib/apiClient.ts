const BASE_URL = process.env.API_URL || 'http://localhost:3000/api';

export const apiClient = {
  async get(path: string) {
    const response = await fetch(`${BASE_URL}${path}`);
    return response.json();
  },

  async post(path: string, data?: unknown) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  },

  async put(path: string, data?: unknown) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  },
};
