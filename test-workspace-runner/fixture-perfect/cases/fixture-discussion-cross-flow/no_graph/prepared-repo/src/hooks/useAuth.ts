import { useState, useCallback } from 'react';
import type { User } from '../types/user';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);

  const logout = useCallback(() => {
    setUser(null);
  }, []);

  return { user, setUser, logout };
}
