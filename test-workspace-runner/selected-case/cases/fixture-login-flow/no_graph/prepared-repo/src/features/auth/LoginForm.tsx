import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { loginUser } from './authService';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { setUser } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const user = await loginUser(email, password);
    setUser(user);
  };

  return (
    <form onSubmit={handleSubmit}>
      <Input value={email} onChange={setEmail} placeholder="Email" />
      <Input value={password} onChange={setPassword} type="password" placeholder="Password" />
      <Button type="submit">Login</Button>
    </form>
  );
}
